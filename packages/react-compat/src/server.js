/**
 * what-react on the server: a React island's HTML (mixed.js ReactIsland).
 *
 * The island's React elements are rendered once, with React's server rules:
 * hooks give their initial values, effects never run, a <Suspense> whose
 * children suspend shows its fallback. What comes out is a tree of what-core
 * vnodes (host elements and text, and native What components as vnodes), which
 * what-server renders and escapes as it renders any other tree, native
 * components inside included.
 *
 * A hydratable render (what-server's renderToHydratableString, the stream)
 * also writes what the browser needs to take that HTML for its own
 * (hydrate.js), and nothing more:
 *
 *   <!--$--><!--/$-->     between two texts, which the HTML parser would
 *                         otherwise read as one text node (React writes
 *                         <!-- --> there)
 *   <!--[]-->…<!--/[]-->  around what native What renders inside the island
 *                         (a native component, a What vnode) and around a
 *                         <Suspense>'s content
 *   <!--$-->…<!--/$-->    around a <Suspense>'s fallback: the browser renders
 *                         that boundary afresh, as React does
 *
 * A plain renderToString writes none of them.
 */

import { h } from 'what-core';
import { isVNode, _provide, _currentOwnerPath } from 'what-core/internal';
import { Suspense } from './index.js';
import { _islandIds } from './hooks.js';
import { HOST, SVG_ATTR_MAP, IS_NON_DIMENSIONAL, _serverInstance, _renderOnServer } from './runtime.js';

/**
 * The vnodes what-server renders for an island's elements `element` (what-react
 * elements), under the compat instance `parent`: a flat list, each text
 * separated from the next.
 */
export function serverTree(element, parent) {
  if (!namesIds) {
    namesIds = true;
    _islandIds(islandId);
  }
  // The island's own instance names its components' ids (islandId), from
  // its owner path, which a hydratable render gives it.
  const root = _serverInstance(serverTree, null, parent);
  const path = _currentOwnerPath();
  if (path !== undefined) root._ids = idsOf(path);
  return childList(expand(element, root, false));
}

let namesIds = false;

// ---- useId ----
// React's ids name a component by its place in the tree, so the server's and
// the browser's are the same. An island the server rendered numbers the ids
// of its components in render order, which is the same on the server and in
// the render that hydrates it (the client render matches the server's or
// hydration reports it), behind the island's own place among the native
// components of the page (its owner path, which what-core gives it the same
// on both sides).

/**
 * The ids of an island at the owner path `path`. A hydrate() root that
 * what-core cannot place in the server's render (no hydration data beside
 * it) numbers its components in the same order under a prefix no server path
 * has (`~`): without it the path is the server's, as long as the two sides
 * render the same components.
 */
export function idsOf(path) {
  return { prefix: '_R_' + path.replace(/~/g, '') + '_', n: 0 };
}

/** The id the next useId of `inst` gets, when it renders in an island that names its own; else ''. */
export function islandId(inst) {
  for (let p = inst; p != null; p = p.parent) {
    const ids = p._ids;
    if (ids !== undefined) return ids.prefix + (ids.n++).toString(36) + '_';
  }
  return '';
}

/**
 * A vnode's tag as the compat runtime marks it: a compat component's bridge
 * carries the React function (runtime.js), a native wrapper its What
 * component (mixed.js).
 * @typedef {Function & { _compatType?: CompatTag, _whatNative?: unknown, _getNative?: () => unknown }} CompatTag
 */

function expand(v, parent, svg) {
  if (v == null || typeof v === 'boolean') return null;
  const type = typeof v;
  if (type === 'string' || type === 'number' || type === 'bigint') return String(v);
  // A native accessor placed in React elements: what-server reads it.
  if (type === 'function') return v;
  if (Array.isArray(v)) return v.map((child) => expand(child, parent, svg));
  if (type !== 'object' || !isVNode(v)) return typeof v?.nodeType === 'number' ? null : String(v);
  const tag = v.tag;
  if (typeof tag === 'string') {
    if (tag === '__portal') return null; // portals render on the client, as in React
    if (tag === '__suspense' || tag === '__errorBoundary') return v; // What's own boundaries
    return element(v, parent, svg);
  }
  if (typeof tag !== 'function') return null;
  const compatTag = /** @type {CompatTag} */ (tag);
  const renderFn = compatTag._compatType;
  // A native vnode: what-server renders it, bracketed.
  if (renderFn === undefined && !/** @type {{ _compat?: boolean }} */ (v)._compat) return h(Native, { children: v });
  const component = renderFn || compatTag;
  if (component._whatNative !== undefined) return nativeComponent(component, v.props || {}, parent, svg);
  return reactComponent(component, v.props || {}, parent, svg);
}

function reactComponent(type, props, parent, svg) {
  const inst = _serverInstance(type, props, parent);
  if (type === Suspense) {
    // React's server rules: a <Suspense> whose children suspend shows its
    // fallback. Each is marked, so the browser knows which it hydrates.
    let content;
    try {
      content = childList(expand(props.children, inst, svg));
    } catch (error) {
      if (error === null || typeof error !== 'object' || typeof error.then !== 'function') throw error;
      const fallback = childList(expand(props.fallback ?? null, inst, svg));
      return () => fallback;
    }
    return h(Native, { children: content });
  }
  return expand(_renderOnServer(inst), inst, svg);
}

// A native component a React tree renders: what-server renders it, under a
// frame that names its compat host, so a React island inside it finds the
// React context above.
function nativeComponent(type, props, parent, svg) {
  const Comp = type._whatNative === true ? type._getNative() : type._whatNative;
  const inst = _serverInstance(type, props, parent);
  const plain = {};
  let children = [];
  for (const key in props) {
    const value = props[key];
    if (key === 'children') children = [expand(value, inst, svg)];
    else if (key !== 'key' && key !== 'ref') plain[key] = isElementLike(value) ? expand(value, inst, svg) : value;
  }
  return h(NativeHost, { host: inst, Comp, props: plain, children });
}

// Its output is an array: what-server brackets it, and the browser finds
// where the native component's nodes end.
function NativeHost(props) {
  _provide(HOST, props.host);
  return [h(props.Comp, props.props, ...props.children)];
}

// What native What renders inside an island (a native vnode, a <Suspense>'s
// content), as an array: bracketed.
function Native(props) {
  const content = props.children;
  return Array.isArray(content) ? content : [content];
}

// Neither takes a step in the owner paths of the native components below
// (what-core hydration-data.js): they are this file's, not the app's.
/** @type {any} */ (NativeHost)._lowered = true;
/** @type {any} */ (Native)._lowered = true;

function isElementLike(value) {
  if (value == null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(isElementLike);
  return isVNode(value);
}

// Text that ends a hydratable render's text node: two texts in a row would
// be one in the browser's DOM. A plain render writes nothing for it.
const SEPARATOR = () => '';

// The elements whose content is raw text, in which no marker can stand.
const RAW_TEXT = new Set(['script', 'style', 'title', 'textarea', 'noscript', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext']);

// `kids` (expanded children, arrays nested as components returned them) as
// one flat list without holes, a separator between two texts unless
// `joined` (raw text). An empty text writes nothing, so it is left out.
function childList(kids, joined = false) {
  const out = [];
  pushChild(kids, out, joined);
  return out;
}

function pushChild(kid, out, joined) {
  if (kid == null || kid === '') return;
  if (Array.isArray(kid)) {
    for (let i = 0; i < kid.length; i++) pushChild(kid[i], out, joined);
    return;
  }
  if (!joined && typeof kid === 'string' && out.length > 0 && typeof out[out.length - 1] === 'string') out.push(SEPARATOR);
  out.push(kid);
}

// --- Host elements: React's props as HTML attributes ---

const DROPPED = new Set(['children', 'key', 'ref', 'suppressHydrationWarning', 'suppressContentEditableWarning', 'defaultValue', 'defaultChecked']);
export const RENAMED = { acceptCharset: 'accept-charset', httpEquiv: 'http-equiv' };

function element(v, parent, svg) {
  const tag = v.tag;
  const inSvg = (svg || tag === 'svg') && tag !== 'foreignObject';
  const props = v.props || {};
  const attrs = {};
  for (const key in props) {
    const value = props[key];
    if (DROPPED.has(key) || typeof value === 'function') continue; // handlers attach on the client
    if (key === 'dangerouslySetInnerHTML') {
      if (value && value.__html != null) attrs.innerHTML = { __html: String(value.__html) };
      continue;
    }
    if (key === 'style' && value !== null && typeof value === 'object') {
      const css = styleText(value);
      if (css) attrs.style = css;
      continue;
    }
    const name = RENAMED[key] ?? (inSvg ? SVG_ATTR_MAP[key] ?? key : key);
    attrs[name] = value;
  }
  // An uncontrolled field's initial value is its value in the HTML.
  if (props.value === undefined && props.defaultValue !== undefined && tag !== 'textarea') attrs.value = props.defaultValue;
  if (props.checked === undefined && props.defaultChecked !== undefined) attrs.checked = props.defaultChecked;
  let kids = v.children !== undefined ? v.children : props.children;
  if (tag === 'textarea') {
    const text = props.value ?? props.defaultValue;
    delete attrs.value;
    kids = text != null ? [String(text)] : kids;
  }
  return h(tag, attrs, ...childList(expand(kids, parent, inSvg), RAW_TEXT.has(tag)));
}

/** A style object as the text of a `style` attribute: what the server writes and hydration compares. */
export function styleText(style) {
  let css = '';
  for (const key in style) {
    const value = style[key];
    if (value == null || value === '' || typeof value === 'boolean') continue;
    const name = key[0] === '-' ? key : key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()).replace(/^ms-/, '-ms-');
    const text = typeof value === 'number' && value !== 0 && key[0] !== '-' && !IS_NON_DIMENSIONAL.test(key) ? value + 'px' : String(value);
    css += (css ? ';' : '') + name + ':' + text;
  }
  return css;
}
