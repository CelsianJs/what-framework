// Shared JSDOM setup for tests.
//
// 68 test files were building a JSDOM and wiring globals by hand, and they did
// not agree on which globals to wire: 70 set `document`, 53 `HTMLElement`, 48
// `window`, 46 `Node`, 40 `requestAnimationFrame`, 38 `queueMicrotask`, 35
// `SVGElement`. That is not only duplication. A file that omits `SVGElement`
// and then renders an <svg> is testing a different environment from the one
// next to it, and whichever way it comes out — pass or fail — the result is
// about the setup rather than the framework.
//
// installDOM() installs one environment, the same one every time.
//
//   import { installDOM } from '../../../test-utils/dom.js';
//   const { document, window, cleanup } = installDOM();
//   const { mount } = await import('../src/dom.js');
//
// Framework modules must be imported AFTER it, with a dynamic import, because
// several of them read `typeof document` at module scope to decide whether
// they are on a server.

import { JSDOM } from 'jsdom';

const DEFAULT_HTML = '<!DOCTYPE html><html><body><div id="app"></div></body></html>';

// Everything installDOM writes onto globalThis, so cleanup() can put the
// previous values back rather than deleting keys that were already there.
const INSTALLED_KEYS = [
  'window', 'document', 'navigator', 'location', 'history',
  'Node', 'Element', 'HTMLElement', 'SVGElement', 'DocumentFragment',
  'Text', 'Comment', 'NodeFilter', 'CSS', 'getComputedStyle',
  'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'FocusEvent',
  'FormData', 'DOMParser', 'customElements',
  'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask',
];

/**
 * Install a JSDOM environment onto globalThis.
 *
 * @param {string} [html] document to parse; defaults to a body with #app
 * @param {object} [options]
 * @param {string} [options.url] document URL, for tests that read location
 * @param {boolean} [options.rafSync] run requestAnimationFrame callbacks on a
 *   0ms timer (the default) rather than JSDOM's frame emulation
 * @returns {{ dom: import('jsdom').JSDOM, window: any, document: any, cleanup: () => void }}
 */
export function installDOM(html = DEFAULT_HTML, options = {}) {
  const { url = 'http://localhost/', rafSync = true } = options;
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  const win = dom.window;

  const previous = new Map();
  for (const key of INSTALLED_KEYS) {
    previous.set(key, Object.hasOwn(globalThis, key) ? globalThis[key] : undefined);
  }

  globalThis.window = win;
  globalThis.document = win.document;
  // Node defines `navigator` as a getter-only own property on globalThis, so a
  // plain assignment throws. defineProperty replaces the descriptor outright.
  define('navigator', win.navigator);
  define('location', win.location);
  globalThis.history = win.history;

  globalThis.Node = win.Node;
  globalThis.Element = win.Element;
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.SVGElement = win.SVGElement;
  globalThis.DocumentFragment = win.DocumentFragment;
  globalThis.Text = win.Text;
  globalThis.Comment = win.Comment;
  globalThis.NodeFilter = win.NodeFilter;
  globalThis.CSS = win.CSS;
  globalThis.getComputedStyle = win.getComputedStyle.bind(win);

  globalThis.Event = win.Event;
  globalThis.CustomEvent = win.CustomEvent;
  globalThis.MouseEvent = win.MouseEvent;
  globalThis.KeyboardEvent = win.KeyboardEvent;
  globalThis.FocusEvent = win.FocusEvent;
  globalThis.FormData = win.FormData;
  globalThis.DOMParser = win.DOMParser;

  // JSDOM only defines customElements in newer versions; the framework's
  // custom-element path needs *something* to register against either way.
  globalThis.customElements = win.customElements || makeCustomElementsStub();

  if (rafSync) {
    globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  } else {
    globalThis.requestAnimationFrame = win.requestAnimationFrame.bind(win);
    globalThis.cancelAnimationFrame = win.cancelAnimationFrame.bind(win);
  }
  globalThis.queueMicrotask = globalThis.queueMicrotask || ((fn) => Promise.resolve().then(fn));

  return {
    dom,
    window: win,
    document: win.document,
    cleanup() {
      for (const [key, value] of previous) {
        if (value === undefined) delete globalThis[key];
        else define(key, value);
      }
      win.close();
    },
  };
}

// Some of these keys exist on globalThis as getter-only own properties
// (`navigator` on Node 21+, `location` under some runtimes). Assignment throws
// on those, so install them through a descriptor.
function define(key, value) {
  Object.defineProperty(globalThis, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

function makeCustomElementsStub() {
  const registry = new Map();
  return {
    get: (name) => registry.get(name),
    define: (name, cls) => registry.set(name, cls),
    whenDefined: () => Promise.resolve(),
  };
}

/** Flush the microtask queue twice, which is what most of these tests want. */
export async function flushMicrotasks() {
  await new Promise((r) => queueMicrotask(() => r()));
  await new Promise((r) => queueMicrotask(() => r()));
}
