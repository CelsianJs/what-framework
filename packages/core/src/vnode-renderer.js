// What Framework - vnodes, and the vnode renderer slot
//
// Compiled JSX builds DOM directly and never produces a vnode. Vnodes come from
// h(), the automatic JSX runtime and the components built on them, and rendering
// one needs dom.js's createDOM with the element, prop, boundary and portal code
// behind it. render.js reaches that renderer only through this slot, which h.js
// fills when it is imported, so a bundle with no vnode producer never contains
// createDOM.
//
// This module must stay import-free. h.js fills the slot while the
// render.js -> dom.js -> components.js -> h.js import cycle is still evaluating,
// and a binding declared in any module of that cycle can still be in its
// temporal dead zone at that moment.

// A vnode is an instance of VNode, and every renderer (the client's, both of
// what-server's, its compiled-markup runtime) recognises one by the private
// brand alone. JSON, structuredClone, a store proxy and a Proxy that answers
// every property cannot produce it: `#brand in value` consults no trap and no
// own property, so `{ "tag": "div", "props": { "dangerouslySetInnerHTML": … } }`
// arriving from data renders as the text it is. h(), the JSX runtime and
// _vnode (h.js) are the producers; a library making elements calls one of them.
//
// A program can hold two copies of what-core: a server bundle that inlined one
// while the server renderer imports another (a linked workspace package), or
// two installed versions. Each copy's class has a brand of its own, so the
// first vnode a copy makes registers its brand check where every copy finds it
// (a global set, keyed by a registered symbol), and a value another copy made
// is a vnode too.
const BRANDS = Symbol.for('what-core.vnode.v1');
let registered = false;

export class VNode {
  #brand;

  constructor(tag, props, children, key) {
    this.tag = tag;
    this.props = props;
    this.children = children;
    this.key = key;
    if (!registered) {
      registered = true;
      /** @type {any} */
      const global = globalThis;
      (global[BRANDS] ??= new Set()).add(VNode.own);
    }
  }

  static own(value) {
    return #brand in value;
  }

  static is(value) {
    if (typeof value !== 'object' || value === null) return false;
    if (#brand in value) return true;
    const brands = /** @type {any} */ (globalThis)[BRANDS];
    if (brands !== undefined) {
      for (const own of brands) if (own !== VNode.own && own(value)) return true;
    }
    return false;
  }
}

/** Whether `value` is a vnode made by h(), the JSX runtime or a boundary, in this copy of what-core or another. */
export function isVNode(value) {
  return VNode.is(value);
}

/** @type {((vnode: any, parent?: any, isSvg?: boolean, inParent?: 1) => Node) | null} */
export let vnodeRenderer = null;

// The elements only SVG has, by name in any case (`clipPath`, `clippath`): the
// vnode renderer creates one in SVG wherever it stands (dom.js
// createElementFromVNode), as what-compiler places a template root by its tag,
// and so does a tag held in a binding (render.js tagElement).
export const SVG_TAG = /^(?:svg|animate(?:motion|transform)?|circle|clippath|defs|desc|ellipse|fe[a-z]+|filter|foreignobject|g|image|line|lineargradient|marker|mask|metadata|mpath|path|pattern|poly(?:gon|line)|radialgradient|rect|set|stop|switch|symbol|text|textpath|tspan|use|view)$/i;

// The keyed vnode rows a reactive region renders a keyed vnode list through
// (render.js _vnodeRows), installed with the renderer for the same reason, and
// what hydrate() writes a vnode's props onto the element it claims with: the
// renderer's prop writer (dom.js _setVNodeProp) and the attribute rules it
// refuses values by (dom.js _isUnsafeAttr). A bundle whose only JSX is
// compiled carries none of them.
/** @type {((value: any, rows: any, isSvg: boolean, scope: any, end?: any, adopted?: any) => any) | null} */
export let vnodeRows = null;
/** @type {((el: any, key: string, value: any, isSvg: boolean) => void) | null} */
export let vnodeProp = null;
/** @type {((key: string, value: any) => boolean) | null} */
export let vnodeRefuses = null;

export function _installVNodeRuntime(render, keyedRows, setProp, refuses) {
  vnodeRenderer = render;
  // Every vnode carries this copy's renderer, for a copy of what-core that
  // has none to render it with (render.js valuesToNodes): a vnode is
  // rendered by the copy that made it.
  /** @type {any} */ (VNode.prototype)._$r = render;
  vnodeRows = keyedRows;
  vnodeProp = setProp;
  vnodeRefuses = refuses;
}
