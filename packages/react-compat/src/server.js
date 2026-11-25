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
import { isVNode, _provide, _currentOwnerPath, getServerContext } from 'what-core/internal';
import { Suspense } from './index.js';
import { _islandIds } from './hooks.js';
import { HOST, _serverInstance, _renderOnServer, _hostInstance } from './runtime.js';
import { idsOf, islandId, boundaryIds, apart, attrOf, styleText } from './markup.js';

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

/**
 * An island's HTML when it renders on the server (mixed.js ReactIsland), as
 * a flat array; undefined in the browser, where the island mounts. What-server's
 * hydratable renderers bracket an array a component returns
 * (<!--[]-->…<!--/[]-->), also when it is empty, and hydration hands that
 * bracket to the island whole (runtime.js adoptIsland), a keyed row's
 * included.
 * @param {() => any} view
 * @returns {any[] | undefined}
 */
export function serverIsland(view) {
  if (typeof document !== 'undefined' && getServerContext() == null) return undefined;
  const parent = _hostInstance();
  try {
    return serverTree(view(), parent);
  } catch (error) {
    // A hook that found no component rendering was not called by this
    // runtime's render: the server loaded two copies of what-react (a bundle
    // that inlines one and imports another), or native code called a React
    // hook. Every island of the page would come out empty, so the render
    // fails instead.
    if (error && error.code === 'ERR_HOOK_OUTSIDE_RENDER') {
      error.message = `[what-react] A React island cannot render on the server. If the server bundle holds two copies of what-react, keep what-react in Vite's ssr.noExternal (reactCompat() puts it there). ${error.message}`;
      throw error;
    }
    // The island renders in the browser instead; the page still renders.
    // Said in production too: the server's HTML is missing this island.
    console.warn('[what-react] A React island could not render on the server, so it renders in the browser:', error && error.message ? error.message : error);
    return [null];
  }
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
    // fallback. Each is marked, so the browser knows which it hydrates. It
    // names its ids first, whatever its content does (useId above).
    boundaryIds(inst);
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

const DROPPED = new Set(['children', 'key', 'ref', 'suppressHydrationWarning', 'suppressContentEditableWarning', 'defaultValue', 'defaultChecked', 'innerHTML']);

function element(v, parent, svg) {
  const tag = v.tag;
  const inSvg = (svg || tag === 'svg') && tag !== 'foreignObject';
  const props = v.props || {};
  const attrs = {};
  for (const key in props) {
    const value = props[key];
    if ((key === 'action' || key === 'formAction') && typeof value === 'function') {
      // A function action runs once the island has hydrated: until then the
      // guard (React's) keeps a submit from sending the fields to the page's
      // own URL, and the page's capture script keeps it for then.
      attrs[key] = FORM_GUARD;
      if (key === 'formAction') actions = true;
      continue;
    }
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
    // A field's state: what-server writes it as a field shows it.
    if ((key === 'value' || key === 'checked') && FIELDS.has(tag)) {
      attrs[key] = value;
      continue;
    }
    const attr = attrOf(key, value, tag, inSvg);
    if (attr !== null) attrs[attr[0]] = attr[1];
  }
  // An uncontrolled field's initial value is its value in the HTML.
  if (props.value === undefined && props.defaultValue !== undefined && (tag === 'input' || tag === 'select')) attrs.value = props.defaultValue;
  if (props.checked === undefined && props.defaultChecked !== undefined && tag === 'input') attrs.checked = props.defaultChecked;
  let kids = v.children !== undefined ? v.children : props.children;
  if (tag === 'textarea') {
    const text = props.value ?? props.defaultValue;
    delete attrs.value;
    kids = text != null ? [String(text)] : kids;
  }
  if (tag === 'form') {
    const outer = actions;
    actions = false;
    const out = childList(expand(kids, parent, inSvg));
    // The capture script, once a page: its last child, which hydration
    // leaves where it is (a form keeps nodes the client does not render).
    if ((actions || attrs.action === FORM_GUARD) && captureScript()) out.push(h('script', { innerHTML: { __html: CAPTURE } }));
    actions = outer;
    return h(tag, attrs, ...out);
  }
  // What a <noscript> holds renders on the server only: its ids are apart.
  const out = tag === 'noscript' ? apart(parent, 'N', () => expand(kids, parent, inSvg)) : expand(kids, parent, inSvg);
  return h(tag, attrs, ...childList(out, RAW_TEXT.has(tag)));
}

// ---- A form submitted before its island hydrates ----
// React 19's way: the action is a javascript: URL that only throws, and a
// small script, once a page, takes a submit of such a form before the page
// has hydrated (preventDefault) and keeps its form, its submitter and its
// data. Once the island hydrates, what-react runs the action with that data
// (hydrate.js replaySubmits), as React replays it into useActionState.
export const FORM_GUARD = "javascript:throw new Error('React form unexpectedly submitted.')";
const CAPTURE = `(function(){var d=document;if(d.$$whatForms)return;d.$$whatForms=[];addEventListener("submit",function(e){if(e.defaultPrevented)return;var f=e.target,s=e.submitter,a=f.getAttribute("action"),b;if(s&&s.getAttribute("formaction")!=null)a=s.getAttribute("formaction");if(a!==${JSON.stringify(FORM_GUARD)})return;e.preventDefault();try{b=new FormData(f,s)}catch(x){b=new FormData(f);if(s&&s.name)b.append(s.name,s.value)}d.$$whatForms.push(f,s,b)})})()`;

// Whether a function action was rendered since the enclosing <form> began.
let actions = false;
/** @type {WeakSet<object>} the server renders that wrote the capture script */
const captured = new WeakSet();

// True the first time a render asks (always, outside a request's context:
// the script does nothing a second time).
function captureScript() {
  const context = getServerContext();
  if (context == null || typeof context !== 'object') return true;
  if (captured.has(context)) return false;
  captured.add(context);
  return true;
}

const FIELDS = new Set(['input', 'select', 'textarea', 'option']);
