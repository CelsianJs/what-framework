// What Framework - Element Descriptors
// Minimal element descriptor objects. No classes, no fibers, just plain objects.

// h(tag, props, ...children) -> VNode
// h(Component, props, ...children) -> VNode
// VNode: { tag, props, children, key }, branded (vnode-renderer.js)

import { createDOM, _setVNodeProp, _isUnsafeAttr } from './dom.js';
import { _vnodeRows, _isSvgParent } from './render.js';
import { VNode } from './vnode-renderer.js';
import { installVNodeRuntime } from './vnode-adoption.js';
import { _symbolChild, __DEV__ } from './reactive.js';
import { isServerRender } from './server-context.js';

// Every vnode is made by h, _jsxVNode or _vnode, and defining each of them
// installs the renderer for vnodes and the keyed rows for keyed vnode lists
// (see vnode-renderer.js). The definitions are marked pure, so a bundler drops
// a producer nothing uses together with its install, from the source and from
// the single-chunk dist alike: a program that makes no vnode never contains
// createDOM.
/**
 * @template T
 * @param {T} produce
 * @returns {T}
 */
function vnodeProducer(produce) {
  // Closures over the imports, read when a vnode renders, not the bindings as
  // they are now: this module evaluates inside an import cycle (dom.js and
  // render.js import each other), and a transform that defines a module's
  // exports where they are written rather than hoisting them (Vite 5's SSR
  // transform, which Vitest 2 runs what-core's source through when it inlines
  // it: a linked or monorepo copy) has not defined createDOM or _vnodeRows yet.
  // Installed as they are, they would stay undefined and every vnode would
  // throw "vnodeRows is not a function".
  installVNodeRuntime(
    // `inParent` 1: a vnode rendered as a value of `parent` (render.js
    // valuesToNodes) is SVG in an SVG element, which only this renderer asks,
    // so a program that makes no vnode does not carry the question.
    (vnode, parent, isSvg, inParent) => createDOM(vnode, parent, isSvg || (inParent === 1 && _isSvgParent(parent))),
    (value, rows, isSvg, scope, end, adopted) => _vnodeRows(value, rows, isSvg, scope, end, adopted),
    (el, key, value, isSvg) => _setVNodeProp(el, key, value, isSvg),
    (key, value) => _isUnsafeAttr(key, value),
  );
  return produce;
}

const EMPTY_OBJ = Object.create(null);
const EMPTY_ARR = [];

/**
 * Children are collected from `arguments` rather than a rest param so a
 * 0-1 child call does not allocate. `@type` (not `@param`) is what TS 7
 * uses to type that hidden tail; do not turn it into `...children`.
 *
 * @type {(tag: any, props?: any, ...children: any[]) => any}
 */
export const h = /* @__PURE__ */ vnodeProducer(function h(tag, props) {
  props = props || EMPTY_OBJ;
  // Collect children from arguments[2..n] without rest args — avoids array allocation
  // when there are 0-1 children (common case: leaf elements, text nodes).
  const argLen = arguments.length;
  let flat;
  if (argLen <= 2) {
    // An element given its children as a prop (`h('button', { ...props })`,
    // React's createElement form) renders them, as React's does; children
    // passed as arguments win over the prop.
    flat = typeof tag === 'string' && props.children != null ? _flattenSingle(props.children) : EMPTY_ARR;
  } else if (argLen === 3) {
    flat = _flattenSingle(arguments[2]);
  } else {
    // Multiple children: flatten all arguments from position 2 onward
    const out = [];
    for (let i = 2; i < argLen; i++) {
      _flattenInto(arguments[i], out);
    }
    flat = out;
  }

  // A function that is not a signal is not a row's key but a prop:
  // <For key={(item) => item.id}>.
  const keyed = props.key !== undefined && (typeof props.key !== 'function' || props.key._signal === true);
  const key = keyed ? props.key ?? null : null;

  // Strip key from the props passed to the component/element. A rest copy
  // rather than copy-then-delete: `delete` drops the object into dictionary
  // mode, and every later read of it pays for that.
  if (keyed) {
    const { key: _key, ...rest } = props;
    props = rest;
  }

  return new VNode(tag, props, flat, key);
});

// The automatic JSX runtime's vnode: `props` is already a fresh object without
// `key` or `children`, so h()'s copy is skipped. Children flatten as in h().
export const _jsxVNode = /* @__PURE__ */ vnodeProducer(function _jsxVNode(tag, props, children, key) {
  let flat;
  if (children === undefined) flat = EMPTY_ARR;
  else if (Array.isArray(children)) {
    flat = [];
    _flattenInto(children, flat);
  } else flat = _flattenSingle(children);
  return new VNode(tag, props, flat, key);
});

// A vnode whose children are already a normalized array. ErrorBoundary,
// Suspense and Portal build theirs with this, which is also what brings this
// module, and with it the vnode renderer, into any bundle that uses them.
export const _vnode = /* @__PURE__ */ vnodeProducer(function _vnode(tag, props, children) {
  return new VNode(tag, props, children, null);
});

// The built-ins what-compiler lowers away (compiled JSX renders <Show>,
// <For>, <Switch> and <Match> as a conditional or a list, and `<>` as an array
// or as its element's own children, with no component of its own) take no
// step in owner paths when they run as components, so a subtree has the same
// paths and hydration keys whichever way each side rendered it
// (hydration-data.js _assignOwnerPath).
export function lowered(Component) {
  Component._lowered = true;
  return Component;
}

// Fragment — just returns children
export const Fragment = /* @__PURE__ */ lowered(function Fragment({ children }) {
  return children;
});

// Children are kept as they are, objects included: a vnode, a DOM node (JSX
// built before it was placed) and compiled server markup are all objects, and
// whether one renders as an element is the renderer's decision, made by the
// brand (vnode-renderer.js). Any other object renders as its text.

// Fast path for single child (most common case)
function _flattenSingle(child) {
  if (child == null || child === false || child === true || typeof child === 'symbol') {
    if (__DEV__ && typeof child === 'symbol') symbolChild(child);
    return EMPTY_ARR;
  }
  if (Array.isArray(child)) {
    const out = [];
    _flattenInto(child, out);
    return out;
  }
  const type = typeof child;
  return [type === 'object' || type === 'function' ? child : String(child)];
}

// Development: a Symbol child h() drops (ERR_SYMBOL_CHILD).
function symbolChild(child) {
  _symbolChild(child, isServerRender() ? 'server' : 'client');
}

// Flatten a child (or array of children) into the output array
function _flattenInto(child, out) {
  if (child == null || child === false || child === true || typeof child === 'symbol') {
    if (__DEV__ && typeof child === 'symbol') symbolChild(child);
    return;
  }
  if (Array.isArray(child)) {
    for (let i = 0; i < child.length; i++) {
      _flattenInto(child[i], out);
    }
    return;
  }
  const type = typeof child;
  out.push(type === 'object' || type === 'function' ? child : String(child));
}

// JSX-like tagged template alternative (no build step needed):
// html`<div class="foo">${content}</div>`
//
// A small parser, not full HTML. Interpolated values are never parsed as
// markup: a value is a child, a prop, a spread (`...${props}` or a bare
// `${props}` in attribute position) or the tag itself (`<${Component}>`).
// Text follows JSX's whitespace rule. Every input ends in a vnode: a `<` that
// starts no tag is text, a closing tag closes the innermost open element
// whatever its name (`</${Component}>` and `<//>` too), a stray closing tag
// and a `<!-- comment -->` are dropped, and void elements (`<br>`, `<input>`)
// take no children.

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const PLACEHOLDER = /^\x00(\d+)\x00/;
const OPEN_TAG = /^<(?:([a-zA-Z][\w:.-]*)|\x00(\d+)\x00)/;
const ATTR_NAME = /^[a-zA-Z_@:][\w:.-]*/;

export function html(strings, ...values) {
  const src = strings.reduce((acc, str, i) =>
    acc + str + (i < values.length ? `\x00${i}\x00` : ''), '');
  const nodes = [];
  parseChildren(src.trim(), 0, values, nodes, true);
  return nodes.length === 1 ? nodes[0] : nodes;
}

// Parses children into `out` from `i` to the closing tag (returns the index
// after it) or to the end of the source.
function parseChildren(src, i, values, out, topLevel) {
  let text = '';
  const flushText = () => {
    const t = jsxText(text);
    if (t) out.push(t);
    text = '';
  };
  while (i < src.length) {
    if (src[i] === '<') {
      if (src.startsWith('<!--', i)) {
        const close = src.indexOf('-->', i + 4);
        i = close === -1 ? src.length : close + 3;
        continue;
      }
      if (src[i + 1] === '/') {
        const close = src.indexOf('>', i + 2);
        i = close === -1 ? src.length : close + 1;
        if (topLevel) continue;
        flushText();
        return i;
      }
      const el = parseElement(src, i, values);
      if (el) {
        flushText();
        out.push(el.node);
        i = el.end;
        continue;
      }
    }
    const ph = src[i] === '\x00' && PLACEHOLDER.exec(src.slice(i));
    if (ph) {
      flushText();
      out.push(values[Number(ph[1])]);
      i += ph[0].length;
      continue;
    }
    text += src[i++];
  }
  flushText();
  return i;
}

function parseElement(src, start, values) {
  const open = OPEN_TAG.exec(src.slice(start));
  if (!open) return null;
  const tag = open[1] ?? values[Number(open[2])];
  let i = start + open[0].length;
  const props = {};
  let selfClosed = false;

  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.startsWith('/>', i)) { selfClosed = true; i += 2; break; }
    if (src[i] === '>') { i++; break; }

    // A spread: ...${props}, or a bare ${props}
    const spread = PLACEHOLDER.exec(src.slice(src.startsWith('...', i) ? i + 3 : i));
    if (spread) {
      Object.assign(props, values[Number(spread[1])]);
      i += (src.startsWith('...', i) ? 3 : 0) + spread[0].length;
      continue;
    }

    const name = ATTR_NAME.exec(src.slice(i));
    if (!name) { i++; continue; }
    i += name[0].length;
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src[i] !== '=') {
      props[name[0]] = true;
      continue;
    }
    i++;
    while (i < src.length && /\s/.test(src[i])) i++;
    const quote = src[i] === '"' || src[i] === "'" ? src[i++] : null;
    const parts = [];
    let str = '';
    while (i < src.length && (quote ? src[i] !== quote : !/[\s>]/.test(src[i]) && !src.startsWith('/>', i))) {
      const ph = src[i] === '\x00' && PLACEHOLDER.exec(src.slice(i));
      if (ph) {
        if (str) parts.push(str);
        str = '';
        parts.push(values[Number(ph[1])]);
        i += ph[0].length;
      } else str += src[i++];
    }
    if (quote) i++;
    if (str) parts.push(str);
    props[name[0]] = attrValue(parts, quote);
  }

  const children = [];
  if (!selfClosed && !(typeof tag === 'string' && VOID_TAGS.has(tag.toLowerCase()))) {
    i = parseChildren(src, i, values, children, false);
  }
  return {
    node: h(tag, Object.keys(props).length ? props : null, ...children),
    end: i,
  };
}

// An attribute written as one interpolation (`a=${v}` or `a="${v}"`) takes the
// value as it is. One with text around an interpolation is a string, built as
// a template literal builds it, and stays live when an interpolated value is a
// function (a signal): class="item ${selected}".
function attrValue(parts, quoted) {
  if (parts.length === 1 && typeof parts[0] !== 'string') return parts[0];
  if (parts.length === 0) return quoted ? '' : true;
  const join = () => parts.map(p => typeof p === 'function' ? p() : p).join('');
  return parts.some(p => typeof p === 'function') ? join : join();
}

// JSX's rule for literal text: a run of whitespace that contains a line break
// is removed at the start and end of the text and becomes one space between
// words; whitespace on a single line is kept.
function jsxText(raw) {
  if (!/[\r\n]/.test(raw)) return raw;
  const lines = raw.split(/\r\n|\n|\r/);
  let out = '';
  for (let k = 0; k < lines.length; k++) {
    let line = lines[k].replace(/\t/g, ' ');
    if (k > 0) line = line.replace(/^ +/, '');
    if (k < lines.length - 1) line = line.replace(/ +$/, '');
    if (line) out += (out ? ' ' : '') + line;
  }
  return out;
}
