// What Framework - Element Descriptors
// Minimal element descriptor objects. No classes, no fibers, just plain objects.

// h(tag, props, ...children) -> VNode
// h(Component, props, ...children) -> VNode
// VNode: { tag, props, children, key }, branded (vnode-renderer.js)

import { createDOM, _setVNodeProp, _isUnsafeAttr } from './dom.js';
import { _vnodeRows } from './render.js';
import { VNode, _installVNodeRuntime } from './vnode-renderer.js';

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
  _installVNodeRuntime(createDOM, _vnodeRows, _setVNodeProp, _isUnsafeAttr);
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
    flat = EMPTY_ARR;
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

// Fragment — just returns children
export function Fragment({ children }) {
  return children;
}

// Children are kept as they are, objects included: a vnode, a DOM node (JSX
// built before it was placed) and compiled server markup are all objects, and
// whether one renders as an element is the renderer's decision, made by the
// brand (vnode-renderer.js). Any other object renders as its text.

// Fast path for single child (most common case)
function _flattenSingle(child) {
  if (child == null || child === false || child === true) return EMPTY_ARR;
  if (Array.isArray(child)) {
    const out = [];
    _flattenInto(child, out);
    return out;
  }
  const type = typeof child;
  return [type === 'object' || type === 'function' ? child : String(child)];
}

// Flatten a child (or array of children) into the output array
function _flattenInto(child, out) {
  if (child == null || child === false || child === true) return;
  if (Array.isArray(child)) {
    for (let i = 0; i < child.length; i++) {
      _flattenInto(child[i], out);
    }
    return;
  }
  const type = typeof child;
  out.push(type === 'object' || type === 'function' ? child : String(child));
}

// JSX-like tagged template alternative (no build step needed)
// html`<div class="foo">${content}</div>`
// Uses a simple parser, not full HTML — good enough for most cases.

export function html(strings, ...values) {
  const src = strings.reduce((acc, str, i) =>
    acc + str + (i < values.length ? `\x00${i}\x00` : ''), '');
  return parseTemplate(src, values);
}

function parseTemplate(src, values) {
  // Lightweight tagged template parser
  // Supports: <tag attr="val">, <tag ...${spread}>, ${children}, self-closing
  src = src.trim();
  const nodes = [];
  let i = 0;

  while (i < src.length) {
    if (src[i] === '<') {
      const result = parseElement(src, i, values);
      if (result) {
        nodes.push(result.node);
        i = result.end;
        continue;
      }
    }
    // Text or interpolation
    const result = parseText(src, i, values);
    if (result.text) nodes.push(result.text);
    i = result.end;
  }

  return nodes.length === 1 ? nodes[0] : nodes;
}

function parseElement(src, start, values) {
  // Opening tag
  const openMatch = src.slice(start).match(/^<([a-zA-Z][a-zA-Z0-9-]*|[A-Z]\w*)/);
  if (!openMatch) return null;

  const tag = openMatch[1];
  let i = start + openMatch[0].length;
  const props = {};

  // Parse attributes
  while (i < src.length) {
    // Skip whitespace
    while (i < src.length && /\s/.test(src[i])) i++;

    // Self-closing or end of opening tag
    if (src.slice(i, i + 2) === '/>') {
      return { node: h(tag, Object.keys(props).length ? props : null), end: i + 2 };
    }
    if (src[i] === '>') {
      i++;
      break;
    }

    // Spread: ...${obj}
    if (src.slice(i, i + 3) === '...') {
      const placeholder = src.slice(i + 3).match(/^\x00(\d+)\x00/);
      if (placeholder) {
        Object.assign(props, values[Number(placeholder[1])]);
        i += 3 + placeholder[0].length;
        continue;
      }
    }

    // Attribute: name=${val} or name="val" or name
    const attrMatch = src.slice(i).match(/^([a-zA-Z_@:][a-zA-Z0-9_:.-]*)/);
    if (!attrMatch) break;

    const attrName = attrMatch[1];
    i += attrMatch[0].length;

    // Skip whitespace around =
    while (i < src.length && /\s/.test(src[i])) i++;

    if (src[i] === '=') {
      i++;
      while (i < src.length && /\s/.test(src[i])) i++;

      // Value is a placeholder
      const ph = src.slice(i).match(/^\x00(\d+)\x00/);
      if (ph) {
        props[attrName] = values[Number(ph[1])];
        i += ph[0].length;
      } else if (src[i] === '"' || src[i] === "'") {
        const q = src[i];
        i++;
        let val = '';
        while (i < src.length && src[i] !== q) {
          const tph = src.slice(i).match(/^\x00(\d+)\x00/);
          if (tph) {
            val += String(values[Number(tph[1])]);
            i += tph[0].length;
          } else {
            val += src[i];
            i++;
          }
        }
        i++; // closing quote
        props[attrName] = val;
      }
    } else {
      props[attrName] = true;
    }
  }

  // Parse children until closing tag
  const children = [];
  const closeTag = `</${tag}>`;

  while (i < src.length) {
    if (src.slice(i, i + closeTag.length) === closeTag) {
      i += closeTag.length;
      break;
    }

    if (src[i] === '<') {
      const child = parseElement(src, i, values);
      if (child) {
        children.push(child.node);
        i = child.end;
        continue;
      }
    }

    const text = parseText(src, i, values);
    if (text.text != null) children.push(text.text);
    i = text.end;
  }

  return {
    node: h(tag, Object.keys(props).length ? props : null, ...children),
    end: i,
  };
}

function parseText(src, start, values) {
  let i = start;
  let text = '';

  while (i < src.length && src[i] !== '<') {
    const ph = src.slice(i).match(/^\x00(\d+)\x00/);
    if (ph) {
      if (text.trim()) {
        return { text: text.trim(), end: i };
      }
      return { text: values[Number(ph[1])], end: i + ph[0].length };
    }
    text += src[i];
    i++;
  }

  return { text: text.trim() || null, end: i };
}
