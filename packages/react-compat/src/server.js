/**
 * what-react on the server: a React island's HTML (mixed.js ReactIsland).
 *
 * The island's React elements are rendered once, with React's server rules:
 * hooks give their initial values, effects never run, a <Suspense> whose
 * children suspend shows its fallback. What comes out is a tree of what-core
 * vnodes (host elements and text, and native What components as vnodes), which
 * what-server renders and escapes as it renders any other tree, native
 * components inside included.
 */

import { h } from 'what-core';
import { isVNode, _provide } from 'what-core/internal';
import { Suspense } from './index.js';
import { HOST, SVG_ATTR_MAP, IS_NON_DIMENSIONAL, _serverInstance, _renderOnServer } from './runtime.js';

/** The vnodes what-server renders for `element` (what-react elements), under the compat instance `parent`. */
export function serverTree(element, parent) {
  return expand(element, parent, false);
}

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
  const renderFn = tag._compatType;
  if (renderFn === undefined && !v._compat) return v; // a native vnode: what-server renders it
  const component = renderFn || tag;
  if (component._whatNative !== undefined) return nativeComponent(component, v.props || {}, parent, svg);
  return reactComponent(component, v.props || {}, parent, svg);
}

function reactComponent(type, props, parent, svg) {
  const inst = _serverInstance(type, props, parent);
  if (type === Suspense) {
    // React's server rules: a <Suspense> whose children suspend shows its fallback.
    try {
      return expand(props.children, inst, svg);
    } catch (error) {
      if (error === null || typeof error !== 'object' || typeof error.then !== 'function') throw error;
      return expand(props.fallback ?? null, inst, svg);
    }
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

function NativeHost(props) {
  _provide(HOST, props.host);
  return h(props.Comp, props.props, ...props.children);
}

function isElementLike(value) {
  if (value == null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(isElementLike);
  return isVNode(value);
}

// --- Host elements: React's props as HTML attributes ---

const DROPPED = new Set(['children', 'key', 'ref', 'suppressHydrationWarning', 'suppressContentEditableWarning', 'defaultValue', 'defaultChecked']);
const RENAMED = { acceptCharset: 'accept-charset', httpEquiv: 'http-equiv' };

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
  const list = kids == null ? [] : Array.isArray(kids) ? kids : [kids];
  return h(tag, attrs, ...list.map((child) => expand(child, parent, inSvg)));
}

function styleText(style) {
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
