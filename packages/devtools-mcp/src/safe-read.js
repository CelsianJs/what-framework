/**
 * The page reads what_eval answers without --unsafe-eval.
 *
 * A read is one of the fixed paths below and nothing else: no expression is
 * parsed or evaluated. Each path is resolved with the browser's own accessor,
 * captured from the platform prototypes (or the unforgeable window and
 * location properties) when this module loads, which the Vite plugin arranges
 * to happen before app code. A getter, setter or Proxy the page defines later
 * is never called, and a property the page overwrote with a value is not read.
 *
 * The same list gates the MCP server side, so both ends agree on what counts as
 * a safe read. `window.` in front of a path is accepted and ignored.
 */

export const SAFE_READ_PATHS = Object.freeze([
  'document.title',
  'document.URL',
  'document.readyState',
  'document.visibilityState',
  'document.referrer',
  'document.characterSet',
  'document.contentType',
  'document.compatMode',
  'location.href',
  'location.origin',
  'location.protocol',
  'location.host',
  'location.hostname',
  'location.port',
  'location.pathname',
  'location.search',
  'location.hash',
  'innerWidth',
  'innerHeight',
  'outerWidth',
  'outerHeight',
  'devicePixelRatio',
  'scrollX',
  'scrollY',
  'isSecureContext',
  'navigator.userAgent',
  'navigator.language',
  'navigator.languages',
  'navigator.onLine',
  'navigator.platform',
  'navigator.hardwareConcurrency',
  'navigator.maxTouchPoints',
  'navigator.webdriver',
  'screen.width',
  'screen.height',
  'screen.availWidth',
  'screen.availHeight',
  'screen.colorDepth',
  'performance.timeOrigin',
]);

/** The canonical path for an input, or null when it is not a safe read. */
export function normalizeSafeRead(input) {
  const path = String(input ?? '').trim().replace(/^window\./, '');
  return SAFE_READ_PATHS.includes(path) ? path : null;
}

function accessor(target, key) {
  for (let o = target; o; o = Object.getPrototypeOf(o)) {
    const desc = Object.getOwnPropertyDescriptor(o, key);
    if (desc) return typeof desc.get === 'function' ? desc.get : null;
  }
  return null;
}

// path → () => value, built from accessors captured now.
function captureReaders() {
  if (typeof window === 'undefined') return null;
  const readers = new Map();
  const globals = {
    document: [accessor(window, 'document'), window],
    location: [accessor(window, 'location'), window],
    navigator: [accessor(window, 'navigator'), window],
    screen: [accessor(window, 'screen'), window],
    performance: [accessor(window, 'performance'), window],
  };
  for (const path of SAFE_READ_PATHS) {
    const dot = path.indexOf('.');
    if (dot === -1) {
      const get = accessor(window, path);
      if (get) readers.set(path, () => get.call(window));
      continue;
    }
    const [base, key] = [path.slice(0, dot), path.slice(dot + 1)];
    const [getBase, holder] = globals[base];
    if (!getBase) continue;
    const object = getBase.call(holder);
    const get = object ? accessor(object, key) : null;
    if (get) readers.set(path, () => get.call(getBase.call(holder)));
  }
  return readers;
}

const readers = captureReaders();

/**
 * Resolve a safe read in the page. Returns { value } or { error }.
 * @param {string} input
 */
export function resolveSafeRead(input) {
  const path = normalizeSafeRead(input);
  if (!path) return { error: `Not a safe read: ${String(input).slice(0, 80)}` };
  const read = readers?.get(path);
  if (!read) return { error: `${path} is not available in this browser` };
  const value = read();
  return { path, value: Array.isArray(value) ? [...value] : value };
}
