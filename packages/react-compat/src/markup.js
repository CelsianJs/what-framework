/**
 * What an island's server render and its hydration share (server.js,
 * hydrate.js): the ids useId gives, and React's rules for the attributes a
 * host element's props write. A client build carries this file only when it
 * hydrates; server.js, which renders the island's HTML, only on the server
 * (vite-plugin.js stubs it out of a client build).
 */

import { Suspense } from './index.js';
import { SVG_ATTR_MAP } from './runtime.js';

// ---- useId ----
// React's ids name a component by its place in the tree, so the server's and
// the browser's are the same. An island the server rendered numbers the ids
// of its components in render order, which is the same on the server and in
// the render that hydrates it (the client render matches the server's or
// hydration reports it), behind the island's own place among the native
// components of the page (its owner path, which what-core gives it the same
// on both sides).
//
// What renders on one side only does not shift the ids after it:
// - a <Suspense> takes one id of the numbering around it as it renders, on
//   both sides, and what renders inside it is numbered behind that id. So
//   content the server gave up on (it wrote the fallback), or that suspends
//   while it hydrates, changes no id after the boundary; and a boundary that
//   hydrates once its promise settles numbers its content from the start
//   again (hydrate.js rehydrate), as the server did.
// - a portal's content (rendered in the browser only) and a <noscript>'s
//   (rendered on the server only) are numbered apart (`apart`), behind a
//   segment no counter writes (P, N).
// Still in render order, so still different on the two sides: a component
// that renders on one side only, with no node (it returns null) and a
// useId, before another that uses one; a component that calls useId a
// different number of times on each side; and anything after a part whose
// structure differs (which hydration reports).

/**
 * The ids of an island at the owner path `path`. A hydrate() root that
 * what-core cannot place in the server's render (no hydration data beside
 * it) numbers its components in the same order under a prefix no server path
 * has (`~`): without it the path is the server's, as long as the two sides
 * render the same components.
 */
export function idsOf(path) {
  return { prefix: '_R_' + path.replace(/~/g, '') + '_', n: 0, x: 0 };
}

/** The id the next useId of `inst` gets, when it renders in an island that names its own; else ''. */
export function islandId(inst) {
  const ids = separate !== null ? separate : namespaceOf(inst);
  return ids === null ? '' : ids.prefix + (ids.n++).toString(36) + '_';
}

// The numbering `inst` takes its ids from: its island's, or the nearest
// <Suspense>'s inside it. Null outside an island that names its ids.
function namespaceOf(inst) {
  for (let p = inst; p != null; p = p.parent) {
    if (p._ids !== undefined) return p._ids;
    if (p.type === Suspense) return boundaryIds(p);
  }
  return null;
}

/** A <Suspense>'s own numbering, named by one id of the numbering around it (taken once). */
export function boundaryIds(inst) {
  if (inst._ids === undefined) {
    const id = islandId(inst.parent);
    inst._ids = id === '' ? null : { prefix: id, n: 0, x: 0 };
  }
  return inst._ids;
}

/**
 * Where the numbering of what `inst` renders stands now, to give the same
 * ids again (idsBack) to a render that replaces one thrown away (hydrate.js);
 * `from`: start that numbering there instead. Null where nothing names ids.
 */
export function idsMark(inst, from) {
  const ids = separate !== null ? separate : namespaceOf(inst);
  return ids === null ? null : [ids, from === undefined ? ids.n : from, ids.x];
}

export function idsBack(mark) {
  if (mark === null) return;
  mark[0].n = mark[1];
  mark[0].x = mark[2];
}

/** @type {{ prefix: string, n: number, x: number } | null} */
let separate = null;

/**
 * Run `fn` with the ids it gives numbered apart from those around `inst`
 * (behind `mark`, P or N, and a count of its own): what renders on one side
 * only (a portal's content, a <noscript>'s) shifts no id the other side
 * gives.
 */
export function apart(inst, mark, fn) {
  const saved = separate;
  const ids = saved !== null ? saved : namespaceOf(inst);
  separate = ids === null ? null : { prefix: ids.prefix + mark + (ids.x++).toString(36) + '_', n: 0, x: 0 };
  try {
    return fn();
  } finally {
    separate = saved;
  }
}

// --- Attributes ---

const RENAMED = { acceptCharset: 'accept-charset', httpEquiv: 'http-equiv', tabIndex: 'tabindex', crossOrigin: 'crossorigin', xmlnsXlink: 'xmlns:xlink' };

// react-dom 19.3.0's server renderer, measured (test/island-server.test.js):
// the attributes it writes as a boolean (bare, which the browser reads as
// ''), the ones whose true and false are the text "true" and "false", and the
// numbers it leaves out when they are not one.
const BOOLEAN = new Set(('allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback '
  + 'formNoValidate hidden inert loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope checked multiple muted selected').split(' '));
const BOOLEANISH = new Set(['contentEditable', 'draggable', 'spellCheck', 'value', 'autoReverse', 'externalResourcesRequired', 'focusable', 'preserveAlpha']);
const POSITIVE = new Set(['cols', 'rows', 'size', 'span']);

/** The attribute a prop writes (also what hydration compares, hydrate.js). */
export function attrName(key, svg) {
  if (key === 'className') return 'class';
  if (key === 'htmlFor') return 'for';
  const renamed = RENAMED[key];
  if (renamed !== undefined) return renamed;
  // xlinkHref, xmlLang: the namespaced attribute (xlink:href, xml:lang).
  if (key.length > 4 && key.startsWith('xlink') && key[5] >= 'A' && key[5] <= 'Z') return 'xlink:' + key.slice(5).toLowerCase();
  if (key.length > 3 && key.startsWith('xml') && key[3] >= 'A' && key[3] <= 'Z') return 'xml:' + key.slice(3).toLowerCase();
  return svg ? SVG_ATTR_MAP[key] || key : key;
}

/**
 * What the host prop `key` of a `tag` writes, by React's rules: [attribute,
 * text] (text true: written bare), or null for none. Not `style`, the field
 * state (`value`, `checked` and their defaults) or raw HTML, which have rules
 * of their own. what-server then refuses what it refuses (an event handler's
 * name, an unsafe URL or name).
 */
export function attrOf(key, value, tag, svg) {
  if (value == null || typeof value === 'function' || typeof value === 'symbol') return null;
  const name = attrName(key, svg);
  if (!svg && tag.includes('-')) {
    // A custom element: an object or false is no attribute (React sets an
    // object as a property in the browser), true is ''.
    if (value === false || typeof value === 'object') return null;
    return [name, value === true ? true : String(value)];
  }
  // <option selected> is its select's choice; elsewhere React writes no selected.
  if (key === 'selected' && tag !== 'option') return null;
  if (typeof value === 'boolean') {
    if (BOOLEANISH.has(key) || key.startsWith('data-') || key.startsWith('aria-')) return [name, String(value)];
    // On any other attribute but a boolean one (and download, capture) a boolean writes nothing.
    return value && (BOOLEAN.has(key) || key === 'download' || key === 'capture') ? [name, true] : null;
  }
  if (BOOLEAN.has(key)) {
    return value === '' || value === 0 ? null : key === 'hidden' && value === 'until-found' ? [name, value] : [name, true];
  }
  if (POSITIVE.has(key) ? !(Number(value) >= 1) : (key === 'rowSpan' || key === 'start') && Number.isNaN(Number(value))) return null;
  return [name, String(value)];
}

// React's unitless CSS properties (react-dom 19.3.0 isUnitlessNumber): a
// number is written as it is; any other number gets px.
const UNITLESS = new Set(('animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup '
  + 'columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn '
  + 'gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity '
  + 'floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth').split(' '));

function unitless(key) {
  if (UNITLESS.has(key)) return true;
  // Vendor-prefixed: WebkitLineClamp, msFlex, MozBoxFlex.
  const m = /^(?:Webkit|Moz|ms|O)([A-Z].*)$/.exec(key);
  return m !== null && UNITLESS.has(m[1][0].toLowerCase() + m[1].slice(1));
}

/** A style object as the text of a `style` attribute: what the server writes and hydration compares. */
export function styleText(style) {
  let css = '';
  for (const key in style) {
    const value = style[key];
    if (value == null || value === '' || typeof value === 'boolean') continue;
    const name = key[0] === '-' ? key : key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()).replace(/^ms-/, '-ms-');
    // React trims every value, a custom property's included.
    const text = typeof value === 'number' && value !== 0 && key[0] !== '-' && !unitless(key) ? value + 'px' : String(value).trim();
    css += (css ? ';' : '') + name + ':' + text;
  }
  return css;
}
