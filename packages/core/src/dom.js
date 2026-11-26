import { report, setNextBinding } from './diagnostics.js';
// What Framework - Fine-Grained DOM Runtime
// Components run ONCE. Signals create individual DOM effects.
// No VDOM reconciler, no diffing — direct DOM manipulation driven by signals.

import { effect, untrack, createRoot, getOwner, onCleanup, _currentComponent, _serverComponentOwner, _enterFrame, _exitFrame, _isDisposed, _tracking, runWithOwner, _runOwned, __DEV__ } from './reactive.js';
import { _renderComponent, _region, _listFragment, _valuesToNodes, _toFunctionComponent, _adoptDetached, _isDomNode, _afterWalk, _installOptionsChanged, applyRef, setClassList, setStyle, _writeClass } from './render.js';
import { REFUSED_ATTRS, URL_ATTRS, ATTRIBUTE_VALUE_TYPES, isAriaAttr, isUnsafeUrl, selectedOptions } from './markup-rules.js';
import { isVNode, SVG_TAG } from './vnode-renderer.js';
const SVG_NS = 'http://www.w3.org/2000/svg';

// --- Attribute sanitization (shared by both setProp implementations) ---
// The refused props, the URL attributes and the scheme check are the markup
// rules what-server and what-compiler apply too (markup-rules.js).

// Event-handler prop test, case-insensitive. A case-sensitive `on` prefix lets
// `ONCLICK` fall through to setAttribute, where the browser honours it as a live
// inline handler. Shared by dom.js and render.js so the two cannot diverge.
export function _isEventProp(key) {
  if (key.length <= 2) return false;
  const a = key.charCodeAt(0);
  const b = key.charCodeAt(1);
  return (a === 111 || a === 79) && (b === 110 || b === 78);
}

// Returns true when the attribute must not be applied. Both the h()/html`` path
// (dom.js setProp) and the compiled-JSX path (render.js setProp) call this so
// they enforce identical rules.
export function _isUnsafeAttr(key, value) {
  const lower = key.toLowerCase();
  return REFUSED_ATTRS.has(lower) || (URL_ATTRS.has(lower) && isUnsafeUrl(value));
}

// ARIA attributes and `role` take ENUMERATED string values, never HTML boolean
// syntax. `aria-checked=""` is not a valid value, and an ABSENT `aria-expanded`
// means something different from `aria-expanded="false"` (unsupported versus
// collapsed) to assistive technology.
//
// This is shared because the three render paths disagreed. The client
// (dom.js setProp) hit a generic `typeof value === 'boolean'` branch before it
// ever reached its aria branch, so it emitted `aria-checked=""` for true and
// removed the attribute for false. The server special-cased `true` correctly but
// skipped every falsy value earlier in the loop, so it dropped `false` entirely.
// So SSR emitted valid ARIA and the first client update silently corrupted it,
// while `aria-*={false}` was wrong everywhere. Every widget built on the a11y
// module is affected, since useAriaExpanded/useAriaSelected/useAriaChecked all
// return booleans.
export { isAriaAttr as _isAriaAttr };


// --- _liveRegionNodes(tracked) ---
//
// The nodes a reactive region must remove, as the DOM stands NOW rather than as
// it stood when the region last rendered.
//
// A region records what its value produced and reuses that record as the removal
// set on its next run. For content the region built outright the record stays
// true, because nothing else edits those nodes. Content that manages ITSELF is
// not like that: a mapArray list and a nested reactive region both own an effect
// and keep replacing their own nodes on their own schedule, so by the time the
// outer region is torn down its record describes a shape that no longer exists.
//
// Removing only the recorded nodes therefore stranded everything the inner
// effect had produced since:
//
//   {() => show() && <>{() => items().map(i => <li key={i}>{i}</li>)}<p>z</p></>}
//
// mounted with two items and grown to three, then switched off, removed the two
// rows it had recorded and left the third in the DOM. Switching back on rendered
// a full fresh list beside that orphan, and the orphan survived every later
// cycle because it was never in any record.
//
// Self-managing content is bracketed by a start/end marker pair for exactly this
// reason: `<!--list-->`/`<!--/list-->` around an embedded list, `<!--fn-->`/
// `<!--/fn-->` around a nested region. Everything the inner effect ever inserts
// lands between the pair, so walking the live range picks up what was added late
// and passes over what has already gone. `_rangeEnd` on the start marker is the
// pairing this reads.
//
// Only teardown calls this. A region's record stays exactly what it produced,
// because that is also what decides whether anything changed and what gets
// repositioned on a re-render, and an inner effect's nodes are its own business
// in both of those.
//
// The walk appends the live range to the record rather than replacing it, so a
// node still standing is named twice. That is deliberate: every caller already
// skips a node whose parent is not the one it is clearing, so the second visit
// costs a pointer compare, and both disposal routes are idempotent by design.
// Deduplicating would mean a Set on a path that runs for every teardown, to
// prevent nothing.
export function _liveRegionNodes(tracked) {
  /** @type {any[] | null} */
  let out = null;
  for (const node of tracked) {
    const end = /** @type {any} */ (node)._rangeEnd;
    // Not a range start, or a range whose two ends have been separated by an
    // earlier teardown: walking that would run past where the range closed and
    // sweep up whatever comes after it. Two orphaned markers share a null parent
    // and pass this test, but an orphan has no nextSibling, so the walk below is
    // empty and the guard does not need to say so a second time.
    if (!end || end.parentNode !== node.parentNode) continue;
    if (!out) out = tracked.slice();
    const buf = /** @type {any[]} */ (out);
    for (let n = node.nextSibling; n; n = n.nextSibling) {
      buf.push(n);
      if (n === end) break;
    }
  }
  // No range in the record — which is the overwhelmingly common case — means no
  // allocation and the caller iterates exactly what it passed in.
  return out || tracked;
}

// Mount a tree into a DOM container: compiled DOM, a vnode from h() or the JSX
// runtime, a thunk, or an array of them. Returns the unmount function.
//
// Realized through render.js, which hands vnodes to the renderer h.js installs,
// so an app that only mounts compiled JSX does not pull createDOM in through
// this function. The tree is built in a root that owns every component, effect
// and binding it creates, so unmounting is disposing that root. A container
// that already holds a mounted (or hydrated) root has that root disposed
// first.
export function mount(node, container) {
  container = _mountTarget(container, 'mount');
  /** @type {() => void} */
  let unmount = () => {};
  createRoot((dispose) => {
    unmount = _trackRoot(container, dispose);
    container.textContent = '';
    const nodes = _valuesToNodes(node, container, [], false);
    _adoptDetached(nodes);
    for (let i = 0; i < nodes.length; i++) container.appendChild(nodes[i]);
  });
  return unmount;
}

// The element mount() or hydrate() (`fn`) renders into: `container`, or the
// element its selector matches. None is a coded error, not a failure deeper
// in.
export function _mountTarget(container, fn) {
  const el = typeof container === 'string' ? document.querySelector(container) : container;
  if (el == null || typeof el.nodeType !== 'number') {
    const what = __DEV__ ? `: ${typeof container === 'string' ? `no element matches "${container}"` : `it was ${String(container)}`}` : '';
    throw Object.assign(new Error(`[what] ${fn}() got no container element${what}`), { code: 'ERR_MOUNT_TARGET_MISSING' });
  }
  return el;
}

// The root mounted or hydrated into each container.
const mountedRoots = /* @__PURE__ */ new WeakMap();

/**
 * Record `dispose` as the root of `container`, disposing the root it held
 * before. Returns the unmount function: it disposes the root and, while that
 * root is still the container's, empties the container.
 */
export function _trackRoot(container, dispose) {
  const previous = mountedRoots.get(container);
  const unmount = () => {
    if (mountedRoots.get(container) === unmount) {
      mountedRoots.delete(container);
      dispose();
      container.textContent = '';
    } else {
      dispose();
    }
  };
  mountedRoots.set(container, unmount);
  if (previous !== undefined) previous();
  return unmount;
}

// --- Create DOM from VNode ---

export function createDOM(vnode, parent, isSvg) {
  // Null/false/true → placeholder comment (preserves child indices for reconciliation)
  if (vnode == null || vnode === false || vnode === true) {
    return document.createComment('');
  }

  // Text
  if (typeof vnode === 'string' || typeof vnode === 'number') {
    return document.createTextNode(String(vnode));
  }

  // DOM node passthrough (fine-grained components return real nodes)
  if (_isDomNode(vnode)) {
    return vnode;
  }

  // A mapArray inserter is called as (parent, marker), never as a thunk; a
  // deferred children factory is static and realized in place; any other
  // function is a reactive region between comment markers (no wrapper element,
  // so CSS selectors like :first-child keep working).
  if (typeof vnode === 'function') {
    if (vnode._lazyChildren) return createDOM(vnode(), parent, isSvg);
    return vnode._mapArray ? _listFragment(vnode) : _region(vnode, isSvg);
  }

  // Array of vnodes
  if (Array.isArray(vnode)) {
    const frag = document.createDocumentFragment();
    for (const child of vnode) {
      const node = createDOM(child, parent, isSvg);
      if (node) frag.appendChild(node);
    }
    return frag;
  }

  // Anything that is not a vnode (by its brand, vnode-renderer.js) is text,
  // whatever properties it carries.
  if (!isVNode(vnode)) return document.createTextNode(String(vnode));

  // VNode with component tag — component runs ONCE
  if (typeof vnode.tag === 'function') {
    return createComponent(vnode, parent, isSvg);
  }

  // VNode with special tags. A boundary's or a portal's vnode carries its
  // client renderer (components.js, createPortalDOM below), so a bundle that
  // never uses one does not carry it.
  if (vnode.tag === '__errorBoundary' || vnode.tag === '__portal') return vnode.props.mount(vnode, parent);
  if (vnode.tag === '__suspense') return vnode.props.boundary.mount(vnode, parent);
  return createElementFromVNode(vnode, parent, isSvg);
}

// --- Component Rendering ---
// Components run ONCE: render.js's _renderComponent holds the lifecycle that
// compiled JSX and vnodes share. A component is an owner (reactive.js
// _componentOwner); the component whose hooks run now is the nearest one above
// the current owner.

export function getCurrentComponent() {
  return _currentComponent();
}

/**
 * Run a component during SSR under a real component owner.
 *
 * Every hook that needs a component (useState, useSignal, useComputed,
 * useMemo, useCallback, useRef, useReducer, onCleanup and Context.Provider)
 * resolves it through the current owner, so the server renderers enter a
 * frame for each component, under `parent` (the frame it renders in) or else
 * the current owner, which during a server render is the render's own root
 * (what-server's createRenderContext, entered by runWithServerContext): every
 * frame, and everything its component creates, is disposed when the render is
 * released. `_parentCtx` is the frame it renders in, for owner paths.
 *
 * Nothing here ever mounts, so nothing deferred may run: useEffect and onMount
 * do nothing during a server render.
 *
 * A frame is current only for a synchronous call. renderToStream interleaves
 * with other requests at every await; it passes `parent` explicitly and
 * re-enters a frame with _runInComponentSSR whenever later work in that
 * frame's subtree needs it.
 *
 * Always pair begin and end in a try/finally.
 */
export function _beginComponentSSR(Component, parent) {
  const frame = _serverComponentOwner(Component, parent);
  frame._parentCtx = parent !== undefined ? parent : parentFrame(frame);
  _enterFrame(frame);
  return frame;
}

function parentFrame(frame) {
  for (let o = frame.owner; o != null; o = o.owner) {
    if (o.Component !== undefined) return o;
  }
  return null;
}

// Restores the owner that was current before the frame began.
export function _endComponentSSR(frame) {
  _exitFrame(frame);
}

/** Run `fn` with an existing SSR frame as the current owner. */
export function _runInComponentSSR(frame, fn) {
  return runWithOwner(frame, fn);
}

// --- _installLazyChildren(Component, target, lazyChildren, slots) ---
// JSX that compiled code hands a component, as its children or through any
// other prop (`slots`, a key -> factory map: render.js _$slots), arrives as a
// zero-arg factory instead of built DOM. This defines a getter over each
// factory on target and returns the function that ends the component's run
// for them, called with the component's owner (or null when there is none).
//
// Such a value is built where it is placed, once per placement, as an h()
// vnode is, and building it reads no signal into the scope around the place
// (a <Show>, a condition, an effect): the reactive reads of its JSX track
// inside it.
// - A read where the value is placed (compiled code reads it with _place)
//   builds it there, under the owner of that place, so the same children
//   placed twice are two copies, as h() and the server render them, and
//   children a condition shows again are built again.
// - Any other read during the run (an inspection: `children.length`, a test,
//   an alias) builds it once, and the first placement after it takes that
//   build: a component that inspects its children and then renders them
//   renders the nodes it inspected.
// - Once its JSX is placed, and after the run (a test in onMount or
//   useEffect, a read in an event handler, a hand-written thunk), a read that
//   does not place it gets a placeable: the same truthy value at every read,
//   built where it is placed, as a vnode is. Its first placement takes a
//   build still waiting for one; every later placement builds afresh (built
//   DOM is single-use: a fragment is drained by its first insertion). A test
//   in onMount is true without running the components again, and a handler
//   that shows it in a dialog shows a copy owned by that place. A prop the
//   run never read is built at the first such read, once, under the
//   component's owner (its context, its error boundary), to know whether it
//   is JSX.
// - A build with no owner current (JSX built in an event handler places the
//   value) is the component's.
// A value that is not JSX (a prop handed on: data, a function) is given as
// it is.
//
// While hydrating, a placement builds where the walk stands, so its JSX
// claims the server's nodes for it. Any other read builds off the walk
// (outsideRead, render.js _$outside): the value is placed later, where it
// takes the place of the server's copy and is reported.
//
// A component that establishes a scope its children depend on (a context
// provider, an error or suspense boundary) cannot use the getter for its
// children: the scope only exists after the component returns, and reading
// props.children anywhere, including destructuring it in the parameter list,
// would build the subtree first. Those set _deferChildren and receive the
// children factory itself, which the render paths realize once the scope
// exists and which a boundary re-invokes to rebuild its subtree on a later
// attempt. Their other props are getters like anyone's.
let placing = false;

/** @type {((build: () => any) => any) | null} */
let outsideRead = null;

/** Hydration's off-walk build, for reads that do not place what they read (render.js). */
export function _setOutsideRead(fn) {
  outsideRead = fn;
}

// Whether what is built now is placed where the server wrote its members in
// place, with no array markers of its own around them: compiled children in
// an element's hole or among a fragment's or an array's members, a boundary's
// or an h() element's children. A component's several children are an array
// the server brackets only where it is the whole value of a component or of
// a reactive child; their _$members (render.js) asks.
let flat = false;

/**
 * Compiled code's read of `props[key]` where the value is placed. `inPlace`
 * is 1 where the server writes the value with no markers of its own around it.
 */
export function _place(props, key, inPlace, fallback) {
  // A live prop (`label={name()}` compiles to a getter, see _isLiveProp) is
  // placed as a reactive child: the place reads the getter again whenever
  // what it read changes. `fallback` is a destructured prop's default
  // (`({ label = 'x' })`), taken where the value is undefined.
  const fallsBack = arguments.length > 3;
  if (_isLiveProp(props, key)) {
    /** @type {(() => any) & { _forward?: boolean }} */
    const read = fallsBack ? () => { const v = props[key]; return v === undefined ? fallback : v; } : () => props[key];
    // A prop handed on to a component (`<Leaf counts={props.data} />`) is a
    // lazy slot whose factory is this call: readLazy recognises the read and
    // passes the live prop through, the value to a read and this to a place.
    read._forward = true;
    return read;
  }
  placing = true;
  const outer = flat;
  flat = inPlace === 1;
  try {
    const v = props[key];
    return fallsBack && v === undefined ? fallback : v;
  } finally {
    placing = false;
    flat = outer;
  }
}

// --- Live props ---
// Compiled JSX passes a component a prop whose value reads a signal
// (`<Badge on={count() > 0} />`) as a getter over the expression, in an
// object with no prototype (`{ __proto__: null, get on() { … } }`), so the
// component sees the current value wherever it reads `props.on`: a JSX
// binding that reads it re-runs when `count` changes, as it would for
// `count()` written there. Every props object What builds is one of its own:
// the props a component runs with (render.js ownProps, which gives compiled
// JSX's object Object.prototype in place), a spread's merge (render.js
// _$merge) and a rest element (_$omit). A getter on one of them is kept by
// every copy and merge; a getter on any other object (a user's object spread
// into props) is read once, as Object.assign reads it. The lazy getters
// _installLazyChildren defines for children and slots are not live props: a
// read of one builds JSX (they carry _lazy).
//
// The props a component sees, a rest element and a merge are plain objects,
// as React's props are (`props.hasOwnProperty(k)`, `String(props)`,
// classnames and lodash's isPlainObject take them), marked as What's by a
// property no listing shows (PROPS: not enumerable, a symbol; Symbol.for, so
// another copy of what-core on the page takes them as its own too). An object
// with no prototype counts as one as well: compiled JSX's, before the
// component gets it, what-react's for a native component, and a live() view.
// Only own keys are copied or spread, so a key written onto Object.prototype
// never reaches a component or an element, and a key named `__proto__` is
// defined as a property like any other (_setOwnProp): no copy sets a
// prototype with it.
//
// Compiled JSX may write the mark into its literal (`{ [_$props]: true, get
// on() { … } }`, render.js _$props): the component gets that object with the
// mark hidden (_ownProps). Its object with no prototype is given
// Object.prototype in place instead, which V8 serves more slowly: each such
// object gets a hidden class of its own, so every read of it is a lookup.
export const PROPS = Symbol.for('what-core.props.v1');
const MARK = { value: true };
const HIDE = { enumerable: false };

/** `props`, a plain object, marked as a props object of What's (PROPS). */
export function _markProps(props) {
  return Object.defineProperty(props, PROPS, MARK);
}

/** A new props object of What's: a plain object, marked. */
export function _newProps() {
  return _markProps({});
}

/** Compiled JSX's props object made the one its component sees, in place: Object.prototype, the mark hidden. */
export function _ownProps(props) {
  if (Object.getPrototypeOf(props) === null) return Object.defineProperty(Object.setPrototypeOf(props, Object.prototype), PROPS, MARK);
  if (Object.prototype.propertyIsEnumerable.call(props, PROPS)) Object.defineProperty(props, PROPS, HIDE);
  return props;
}

/** Whether the object `x` is a props object What built, whose getters are live props: marked, or with no prototype. */
export function _isOwnProps(x) {
  return x[PROPS] === true || Object.getPrototypeOf(x) === null;
}

/** Whether `props[key]` is a live prop: a getter, not a lazy JSX one, of a props object What built. */
export function _isLiveProp(props, key) {
  if (props == null || typeof props !== 'object' || !_isOwnProps(props)) return false;
  const d = Object.getOwnPropertyDescriptor(props, key);
  return d !== undefined && d.get !== undefined && /** @type {any} */ (d.get)._lazy !== true;
}

/**
 * A props object of What's (_newProps) with the own enumerable properties of
 * `props`, without the keys in `omit` (a rest element, render.js _$omit). A
 * props object What built keeps its getters (live props, lazy children); any
 * other object is copied by value, as a spread copies it.
 */
export function _copyProps(props, omit) {
  if (props == null) return _newProps();
  const own = _isOwnProps(props);
  // A spread defines each key, `__proto__` too, where Object.assign would set
  // the prototype with it.
  if (!own && !omit) return _markProps({ ...props });
  const out = _newProps();
  for (const key in props) {
    if (Object.hasOwn(props, key) && !(omit && omit.includes(key))) _copyProp(out, props, key, own);
  }
  return out;
}

/** `src[key]` onto `out`: a getter of a props object What built (`own`) as the getter, never read; anything else as its value. */
export function _copyProp(out, src, key, own) {
  const get = own ? /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(src, key)).get : undefined;
  if (get) Object.defineProperty(out, key, { get, enumerable: true, configurable: true });
  else _setOwnProp(out, key, src[key]);
}

/**
 * `props[key] = value` on a props object that may hold a getter under `key`
 * (a forwarded live prop, lazy children), or inherit one: `__proto__` and
 * Object.prototype's other names are defined as own properties, so a key
 * named `__proto__` never sets the prototype.
 */
export function _setOwnProp(props, key, value) {
  if (key in props) Object.defineProperty(props, key, { value, writable: true, enumerable: true, configurable: true });
  else props[key] = value;
}

/** `build()`, placed where the server wrote it with no markers of its own (_place). */
export function _placeFlat(build) {
  const outer = flat;
  flat = true;
  try {
    return build();
  } finally {
    flat = outer;
  }
}

/** Whether the children built now are placed with no markers of their own (_place); asked once, by their _$members. */
export function _takeFlat() {
  const was = flat;
  flat = false;
  return was;
}

export function _installLazyChildren(Component, target, lazyChildren, slots) {
  // cache[0] is the component's owner once its run is over, null during it.
  // Then, for each prop: its factory, what its reads got (PLACED once its JSX
  // is placed), 0 while unread, 1 while that waits for its placement, 2 once
  // placed, and its placeable.
  /** @type {any[]} */
  const cache = [null];
  const define = (key, factory) => {
    const at = cache.push(factory, undefined, 0, null) - 4;
    /** @type {(() => any) & { _lazy?: boolean }} */
    const get = function () {
      const place = placing;
      placing = false;
      return readLazy(cache, at, place);
    };
    // Not a live prop (_isLiveProp): a read of it builds JSX.
    get._lazy = true;
    Object.defineProperty(target, key, { get, enumerable: true, configurable: true });
  };
  if (lazyChildren) {
    if (Component._deferChildren) target.children = lazyChildren;
    else define('children', lazyChildren);
  }
  if (slots) for (const key in slots) define(key, slots[key]);
  return cache.length === 1 ? null : (owner) => { cache[0] = owner; };
}

// What a prop's reads got once its JSX is placed: its nodes are not kept.
const PLACED = {};
// The state of a slot that forwards a live prop (_place's read, `_forward`):
// every read reads it through, a place gets the read as a reactive child.
const FORWARDS = 3;

// A placing read (and a placeable's placement) takes the build that waits
// for its placement, else builds anew, under the owner of the place (the
// component's when there is none). Any other read gets what a read got, else
// a build (the component's after its run, off the walk while hydrating) that
// waits for its placement; once its JSX is placed, and for any JSX after the
// run, the placeable.
function readLazy(cache, at, place) {
  const home = cache[0];
  let value = cache[at + 1];
  const state = cache[at + 2];
  // A forwarded live prop (`<Leaf counts={props.data} />`, data.counts a
  // getter): the child reads the current value wherever it reads it, never
  // the read function, and a place shows it as a reactive child.
  if (state === FORWARDS) return place ? value : value();
  if (place) {
    if (state !== 1) value = buildLazy(cache[at], home !== null && getOwner() === null ? home : null);
    cache[at + 1] = holdsNodes(value) ? PLACED : value;
    cache[at + 2] = value?._forward ? FORWARDS : 2;
    return value;
  }
  if (state === 0) {
    const build = () => buildLazy(cache[at], home);
    value = cache[at + 1] = outsideRead === null ? build() : outsideRead(build);
    cache[at + 2] = 1;
    if (value?._forward) return (cache[at + 2] = FORWARDS, value());
  }
  if (value !== PLACED && (home === null || !holdsNodes(value))) return value;
  if (cache[at + 3] === null) {
    // An array holding its build: a signal stores it as it is (a function
    // would be called as an updater), and every render path builds it there.
    const build = () => readLazy(cache, at, true);
    build._lazyChildren = true;
    cache[at + 3] = [build];
  }
  return cache[at + 3];
}

function buildLazy(factory, owner) {
  return owner !== null ? _runOwned(owner, factory) : untrack(factory);
}

// Whether a value holds built DOM (an element, a component's fragment, the
// array a fragment or a .map() gives), not data a prop hands on (an object, a
// function, a vnode, which is built where it is placed).
function holdsNodes(value) {
  return _isDomNode(value) || (Array.isArray(value) && value.some(holdsNodes));
}

// --- _handleNavigationSignal(error) ---
// A thrown value may carry its own handler under
// Symbol.for('what.navigation.signal.v1'). what-router's redirect() throws one, so
// a redirect from a component body runs the navigation instead of reaching an
// ErrorBoundary, which would render error UI for a value that is not an error.
// Returns true when the value was a signal and has been handled.
//
// Both component paths route through this (_renderComponent and the hydration
// branch, both in render.js) so the two cannot drift.
const NAV_SIGNAL = Symbol.for('what.navigation.signal.v1');

export function _handleNavigationSignal(error) {
  if (error == null) return false;
  const handler = error[NAV_SIGNAL];
  if (typeof handler !== 'function') return false;
  handler(error);
  return true;
}

function createComponent(vnode, parent, isSvg) {
  const { props, children } = vnode;
  const Component = _toFunctionComponent(vnode.tag);

  const mergedProps = _copyProps(props);
  if (children.length > 0) _setOwnProp(mergedProps, 'children', children.length === 1 ? children[0] : children);
  const lazyChildren = props && props._$lazyChildren;
  const slots = props && props._$slots;
  const endChildrenPass = lazyChildren || slots ? _installLazyChildren(Component, mergedProps, lazyChildren, slots) : null;
  if (__DEV__ && vnode._loc) return _renderComponent(Component, mergedProps, endChildrenPass, isSvg, vnode._loc);
  return _renderComponent(Component, mergedProps, endChildrenPass, isSvg);
}

// <Portal>: its children are built into `container` under the portal's owner,
// so context and boundaries reach them, and removed from it when that owner
// is disposed. A portal's vnode carries it (`mount`): helpers.js Portal and
// react-compat's createPortal (through what-core/internal).
export function createPortalDOM(vnode, _parent) {
  const { container } = vnode.props;
  const children = vnode.children;

  if (!container) {
    console.warn('[what] Portal: target container not found');
    return document.createComment('portal:empty');
  }

  // A component child arrives as a fragment, which inserting empties: track
  // the nodes it carried, or the cleanup below finds nothing to remove.
  const portalNodes = [];
  for (const child of children) {
    const node = createDOM(child, container);
    if (!node) continue;
    if (node.nodeType === 11) {
      for (let n = node.firstChild; n !== null; n = n.nextSibling) portalNodes.push(n);
    } else {
      portalNodes.push(node);
    }
    container.appendChild(node);
  }
  onCleanup(() => {
    for (const node of portalNodes) {
      if (node.parentNode) node.parentNode.removeChild(node);
    }
  });
  return document.createComment('portal');
}

// --- Create Element from VNode ---
// For h()-based VNodes with string tags

function createElementFromVNode(vnode, parent, isSvg) {
  const { tag, props, children } = vnode;

  // In SVG, or an element only SVG has (vnode-renderer.js SVG_TAG).
  const svgContext = isSvg || SVG_TAG.test(tag);
  const el = svgContext
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);

  // Apply props
  if (props) {
    applyProps(el, props, {}, svgContext);
  }

  // Append children. A <noscript>'s are not rendered: with scripts on, the
  // browser keeps its content as text, as React does.
  if (tag === 'noscript') return el;
  const isSvgChildren = svgContext && tag !== 'foreignObject';
  for (let i = 0; i < children.length; i++) {
    const node = createDOM(children[i], el, isSvgChildren);
    if (node) el.appendChild(node);
  }

  return el;
}

// --- Prop Application ---
// Only applied once for fine-grained (no diffing). Reactive props use effects.

function applyProps(el, newProps, oldProps, isSvg) {
  if (!newProps) return;

  for (const key in newProps) {
    if (key === 'key' || key === 'children') continue;

    if (key === 'ref') {
      applyRef(newProps.ref, el);
      continue;
    }

    setProp(el, key, newProps[key], isSvg);
  }
}

// --- Form fields ---
//
// A form field's state, through every client path that writes it (h()
// setProp, compiled setProp, setValue and setChecked, a spread, hydration),
// as React 19 documents it for controlled and uncontrolled fields:
//   - `value` (an <input> whose value is its own, a <textarea>, a <select>)
//     and `checked` (an <input>) control what the field shows. They are
//     written as properties, which mark the field changed, so a default
//     written later never moves what it shows; a write of the value it wrote
//     last is skipped, which leaves the caret where it is. The value a prop
//     holds is what a form reset keeps (_resetForm), any value as its string
//     (`true` is "true", as React writes it), checked as a boolean. A field
//     whose value or checked compiled JSX binds to state shows the state:
//     after each of its input and change events, once its handlers and the
//     updates they caused are done, it shows what the prop holds again
//     (showControlled), as React restores a controlled field whose handler
//     did not take the edit. Any other field keeps the edit until the prop's
//     next write: one whose value reads no state (a constant, a value a
//     spread read once, as `{...register('name')}` gives), and one made with
//     h().
//   - Null or undefined releases a field the prop controlled: it shows
//     nothing (an empty value, unchecked, no option selected), and a reset
//     restores its default. A field it never controlled is left as it is.
//   - `defaultValue`, `defaultChecked`, an <option>'s `selected` and
//     `defaultSelected`, and a <select>'s `defaultValue` (the options it
//     names) are the field's default: its content attribute (what a reset
//     restores, what a server writes), which shows only while nothing has
//     controlled or changed the field. An <option>'s `value` is what names
//     it.
// A select's value selects the options markup-rules' selectedOptions names.
// Its options may not be in the DOM yet (children are appended after props),
// so a value or default they do not show is written once more after them;
// a later write, null included, supersedes that retry. A select a value
// controls follows it whenever its option values change: a region or list
// that adds or removes options (its own, or a group's), an option's `value`
// written, or the text of an option with no `value` (its value) written, has
// it select them again (_optionsChanged), as does an option's default
// changing (_keepSelection). A select with a default and no value follows its
// default the same way until the user changes what it shows.

/**
 * Write prop `key` of a form field `el` and return true, or return false
 * when `key` is not a field prop of `el`.
 */
export function _setFieldProp(el, key, value) {
  const tag = el.tagName;
  if (tag === 'OPTION' || tag === 'SELECT') {
    if (selects !== null) return selects(el, tag, key, value);
    // Every path that writes one installs the code first (_installSelects).
    if (__DEV__) console.error(`[what] internal: a <${el.localName}>'s ${key} was written before what-core installed its select code.`);
    return false;
  }
  if (tag === 'INPUT' && key === 'checked') {
    const on = value == null ? undefined : !!value;
    if (el._$checked !== on) el.checked = (el._$checked = on) === true;
  } else if (tag === 'INPUT' && key === 'defaultChecked') {
    el.defaultChecked = !!value;
    // A default checks a radio nothing has changed, which unchecks the others
    // in its group, a radio a prop controls among them: that one is checked
    // again.
    if (value && el.type === 'radio' && el._$checked === undefined && el.form) {
      for (const other of _formMember(el.form, 'elements')) if (other._$checked && other.name === el.name) other.checked = true;
    }
  } else if ((key !== 'value' && key !== 'defaultValue')
    || (tag === 'INPUT' ? ATTRIBUTE_VALUE_TYPES.has(el.type) : tag !== 'TEXTAREA')) {
    return false;
  } else if (key === 'defaultValue') {
    el.defaultValue = value == null ? '' : String(value);
  } else {
    const str = value == null ? undefined : String(value);
    if (el._$value !== str) {
      el._$value = str;
      // A number field that shows the number already ("04" typed for 4,
      // "1.0" for 1) keeps what the user typed, as React's does.
      if (str === undefined || el.type !== 'number' || el.validity.badInput || (el.value || NaN) != +str) writeValue(el, str ?? '');
    }
  }
  return true;
}

// What writes a text field's value: what its onChange has seen (_onChange)
// when the field showed what onChange saw last. A field that holds an edit
// no onChange has heard yet (an onInput handler's state, written before the
// onChange handlers of the same `input` run) keeps it for onChange to hear,
// and one whose onChange saw nothing yet hears whatever comes next.
function writeValue(el, value) {
  const was = el._$seen;
  const seen = was === el.value;
  el.value = value;
  el._$seen = seen ? el.value : was;
}

// The props of a <select> and its <option>s: their value, their default and
// the selection kept in step with them (below). Installed by what can write
// one, so a program that makes no select does not carry the code: compiled
// JSX whose module writes a prop of a <select> or an <option> (`_$selects()`,
// at module scope), the h() renderer and hydration writing a vnode's props
// (setProp below), and the setters written by hand given one (render.js
// setProp, setValue, spread).
// A select whose value a prop wrote carries the code that wrote it
// (`_$select`), which showControlled and _resetForm write it again with: the
// copy of what-core that does is not always the one that wrote it.
/** @type {typeof selectProp | null} */
let selects = null;

/** @internal Install what the props of a <select> and its <option>s need. */
export function _installSelects() {
  selects = selectProp;
}

/** @internal Install the select code for `el` when it is a select or an option. */
export function _selectsFor(el) {
  if (selects === null && (el.tagName === 'SELECT' || el.tagName === 'OPTION')) selects = selectProp;
}

function selectProp(el, tag, key, value) {
  if (tag === 'OPTION') {
    // Its value names it: a select a value controls selects again when the
    // value changed, and after its default changed (_keepSelection).
    if (key === 'value') {
      if (value == null) el.removeAttribute('value');
      else el.value = value;
      _optionsChanged(el);
    } else if (key === 'selected' || key === 'defaultSelected') {
      el.defaultSelected = !!value;
      _keepSelection(el);
    } else return false;
  } else if (key === 'defaultValue') setSelectDefault(el, value);
  else if (key === 'value') _setSelectValue(el, value);
  else return false;
  return true;
}

// --- A controlled field shows what controls it ---
//
// The window of a field a prop controls hears every input, change and
// compositionend event, in both phases: nothing is added per field, and any
// other field is passed over at once. The bubble phase comes after
// every handler, the element's own and the delegated ones, and after the
// updates their writes caused when the browser dispatched the event (it runs
// microtasks after each listener); for an event a script dispatched those are
// still queued, ahead of the microtask taken here. A handler that stops the
// event keeps it from the bubble phase, so the capture phase, which nothing
// below the window can stop, schedules the same check as a task. While an
// input method composes, the field holds text the prop never will: it is
// left alone until the composition ends.
//
// A field is put back once every event of the user's action has been handled.
// The browser runs microtasks after each listener of an event it dispatches,
// so a check taken after `input` would run before a `change` of the same
// action is dispatched, and its handlers would read the field as it was
// (e.target.checked false on the click that checked it). Clicking or
// pressing a checkbox or radio, and picking in a select, fire `input` and then
// `change` in one task (the HTML standard's activation behaviour and select
// update notifications): their field is checked after the `change`. A text
// field is checked after each `input`, which its onChange handlers hear
// (_onChange below), and after a `change`.
//
// A form's reset gives each of its fields its default once the `reset` event
// is over: a field a prop controls shows what the prop holds again after it,
// as React's does (it keeps a controlled field's value attribute in step).
// The event comes before the reset: a reset a script calls (`form.reset()`)
// is done by the microtask the bubble phase takes, and one the user makes (a
// reset button) is done by the task the capture phase takes.
//
// Reached only from the bindings compiled JSX makes for a field's value and
// checked (render.js setValue, setChecked, and a spread on a field,
// _$controlled), so a program with no such binding does not carry it. A
// binding that read state marks its field (`_$kept`), and only a marked field
// is put back: the edit of any other field stands until its prop's next
// write, whatever else the page holds.
//
// A page can hold two copies of what-core (a library bundled with its own):
// the first to bind a field listens for the window, and puts back the fields
// of both. Everything it reads and writes is on the field, so it needs none
// of the other copy's code: a select is written again by the select code that
// wrote its value, which leaves itself on the select (`_$select`), so a copy
// without select code puts back the other copy's select.

/**
 * @internal Called by a binding of `el`'s value or checked, in its run, with
 * the value read: when the run read state, `el` shows what its props hold
 * after each of its events.
 */
export function _controlFields(el) {
  if (!_tracking()) return;
  el._$kept = true;
  // A field cloned from a template is in the template's document, which has
  // no window, until it is placed: its events will reach this one's.
  const win = el.ownerDocument.defaultView || globalThis.window;
  if (!win || win._$controlled) return;
  win._$controlled = true;
  for (const type of ['input', 'change', 'compositionend', 'reset']) {
    win.addEventListener(type, controlledChanged, true);
    win.addEventListener(type, controlledChanged);
  }
}

function controlledChanged(e) {
  const el = e.composedPath()[0];
  // A form, on its reset (showControlled shows its fields, and passes over
  // anything else a script dispatched one at); else a field, and before a
  // change only a text field (not a select, the one field with options, a
  // checkbox or a radio).
  if (e.type !== 'reset' && (e.isComposing || !el?._$kept
    || (e.type !== 'change' && (el.options || el.type === 'checkbox' || el.type === 'radio')))) return;
  if (e.eventPhase === 1) setTimeout(showControlled, 0, el);
  else queueMicrotask(() => showControlled(el));
}

// --- onChange ---
//
// `onChange` is React's change event in every path that binds one: compiled
// JSX's delegated `$$change` (render.js _$changes) and its listener for an
// event with modifiers, a spread's (render.js listen), an h() element's props
// (setProp below). On a field or above one (a form's hears its
// fields), it fires for a text field (a <textarea>, an <input> of a type the
// user types in, the types React lists) as the user edits it, from its
// `input` events and from a `change` that reports an edit no `input` did; for
// a checkbox, a radio, a select and a file field on their `change`, as the
// DOM's does. A text field's event is an edit when the field holds what it
// did not when its onChange handlers last ran or What last wrote it
// (`_$seen`): the `change` it sends when it loses focus is none after the
// `input` that reported the edit, and an `input` that left its value as it
// was (`1.` typed on the way to `1.5`, which a number field holds as `1`)
// none, as React's value tracker decides. What a handler writes
// (`e.target.value = e.target.value.toUpperCase()`) is what it saw. A field
// forgets what it held at the user's `change` (not one a script dispatched),
// so a value a script wrote while the user was elsewhere (a button that
// clears it, a form reset) is changed by the user's next edit, whatever it
// holds. React sees a script's write itself
// (it shadows the field's `value`), so an event that follows one is no edit
// there; here it is one when the value differs, as in what-react. Decided once
// per event, for every handler on its path, with what it reads kept on the
// event and the field, so two copies of what-core on a page decide alike.
// `on(el, 'change', fn)` (render.js) is the DOM's change event, unchanged.

/** @internal Call `handler` with `e`, an `input` or `change` event, when it is React's change event. */
export function _onChange(e, handler) {
  const el = e.target;
  const change = e.type === 'change';
  // An <input> or a <textarea> (`selectionStart` is theirs alone), of a type
  // whose value is the user's: not a file field (`files`), a checkbox, a
  // radio or a button.
  const text = 'selectionStart' in el && !el.files && !ATTRIBUTE_VALUE_TYPES.has(el.type);
  e._$change ??= text ? el.value !== el._$seen : change;
  if (e._$change) handler(e);
  if (text) {
    el._$seen = change && e.isTrusted ? undefined : el.value;
    hearScriptWrites(el);
  }
}

// A script's write to a text field it has heard (`el.value = ''` once a chat
// box has sent, while the field keeps the focus) makes the field forget what
// onChange saw, so the next edit is heard, one that types what the field held
// before the write included. The `value` setter of the field's prototype
// (HTMLInputElement's, HTMLTextAreaElement's) is wrapped on the field, as
// React's value tracker wraps it; What's writes (writeValue) keep what
// onChange saw. A field that already has its own `value` (a copy of
// what-core, or a library, wrapped it) is left as it is.
function hearScriptWrites(el) {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
  const set = desc?.set;
  if (set === undefined || Object.hasOwn(el, 'value')) return;
  Object.defineProperty(el, 'value', {
    configurable: true,
    get: /** @type {PropertyDescriptor} */ (desc).get,
    set(next) {
      set.call(this, next);
      this._$seen = undefined;
    },
  });
}

// Show what the props of `el` hold, where the field shows something else.
// Nothing is written to a field that already shows it, so the caret stays.
// A number field is compared as a number, and left alone while what it holds
// is not one yet ("1." on the way to "1.5", which it reports as bad input);
// an empty one is not the number 0, so a value of 0 is written to it, as
// React writes it. A file field holds only what the user picked: nothing is
// written to it (any value but '' throws), and it shows the value once it is
// another kind of field again. A radio is checked or unchecked with the rest
// of its group: checking one unchecked the one a prop keeps checked. Also
// called once an input's type or a select's multiple changed what the field
// shows (render.js retype).
function showControlled(el) {
  // A form after its reset: its fields a prop controls.
  if (el.localName === 'form') {
    for (const field of _formMember(el, 'elements')) if (field._$kept) showControlled(field);
    return;
  }
  const value = el._$value;
  if (value !== undefined) {
    // A select's value was written by the select code it carries (above).
    if (el._$select) el._$select(el, value);
    // `files` is a file field's alone (null on any other input).
    else if (!el.files && el.value !== value && (el.type !== 'number' || (!el.validity.badInput && (el.value || NaN) != +value))) writeValue(el, value);
  }
  if (el._$checked === undefined) return;
  const group = el.type !== 'radio' || !el.name ? [el]
    : el.form ? _formMember(el.form, 'elements') : el.getRootNode().querySelectorAll('input[type=radio]');
  for (const field of group) {
    if (field._$kept && field._$checked !== undefined && field.type === el.type && field.name === el.name) field.checked = field._$checked;
  }
}
export { showControlled as _showControlled };

function _setSelectValue(el, value) {
  if (value == null && el._$value === undefined) return;
  _selectionKeeper = _keepSelection;
  el._$value = value ?? undefined;
  // What writes it again (showControlled, _resetForm), from any copy.
  el._$select = _setSelectValue;
  _installOptionsChanged(_optionsChanged);
  const write = (el._$selectWrite = (el._$selectWrite || 0) + 1);
  if (!markOptions(el, value, 'selected')) {
    const retry = () => el._$selectWrite === write && markOptions(el, value, 'selected');
    if (!_afterWalk(retry)) queueMicrotask(retry);
  }
}

// Write `prop` (`selected`, or `defaultSelected`) of every option of `el`:
// true for the options `value` names, false for the rest (null names none;
// a single select then shows none, as unselecting the last option of one
// would select its first). Whether its options were there to name.
function markOptions(el, value, prop) {
  const options = [...el.options];
  const values = options.map((option) => option.value);
  el._$marked = [options, values];
  const chosen = selectedOptions(values, value);
  // Only the options whose mark changes: each write runs the select's
  // selectedness algorithm over all of them.
  for (let i = 0; i < options.length; i++) if (options[i][prop] !== chosen[i]) options[i][prop] = chosen[i];
  if (prop === 'selected' && !el.multiple && !chosen.includes(true)) el.selectedIndex = -1;
  return values.length > 0 && [value].flat().every((v) => values.includes(String(v)));
}

// An option's default (its selected attribute) can move what its select
// shows even after a script selected options (Chromium lets it; JSDOM, like
// the HTML standard, does not once an option was written): a select a value
// controls selects its options again. Called with an option after every
// write of its default, by hydration after it rewrites an option's
// attributes (_selectionKeeper), and with a select after a write of its
// default.
function _keepSelection(el) {
  const select = el.closest('select');
  if (select !== null) refollow(select, true);
}

/**
 * A region, a list or a text write changed the options under `parent` (a
 * select, an optgroup or an option), or an option's value was written: its
 * select selects them again when its option values changed (other options,
 * or another value of one), and leaves what it shows alone otherwise, so a
 * label written in place of another keeps what the user chose.
 */
function _optionsChanged(parent, text) {
  const tag = parent.localName;
  // The text of an option with a value is its label.
  if (text === 1 && tag === 'option' && parent.hasAttribute('value')) return;
  const select = tag === 'select' ? parent : tag === 'optgroup' || tag === 'option' ? parent.closest('select') : null;
  if (select !== null) refollow(select, false);
}

// A select follows its options again (`always`, or when their values
// changed): now, or, while a hydration walk claims them one by one, once
// when the walk is done, so hydrating a select is linear in its options.
function refollow(select, always) {
  if (select._$refollow !== undefined) {
    select._$refollow ||= always;
    return;
  }
  select._$refollow = always;
  const run = () => {
    const now = select._$refollow;
    select._$refollow = undefined;
    if (now || optionValuesChanged(select)) follow(select);
  };
  if (!_afterWalk(run)) run();
}

// Whether `select` has other options, or other values of them, than the ones
// it marked last (markOptions).
function optionValuesChanged(select) {
  const marked = select._$marked;
  if (marked === undefined) return true;
  const [options, values] = marked;
  const now = select.options;
  if (now.length !== options.length) return true;
  for (let i = 0; i < options.length; i++) {
    if (now[i] !== options[i] || now[i].value !== values[i]) return true;
  }
  return false;
}

// A select shows what its value names, else, until the user changes what it
// shows (a change event, or an edit before hydration: _changedFields), what
// its default names: an option set that changed under a select the user left
// alone gets the default's marks again. A hydration rewrites its options one
// by one, so it marks them once, when its walk is done.
function follow(select) {
  if (select._$value !== undefined) markOptions(select, select._$value, 'selected');
  else if (select._$default !== undefined && !select._$chosen && !select._$following) {
    select._$following = true;
    const mark = () => {
      select._$following = false;
      if (select._$value === undefined && !select._$chosen) markOptions(select, select._$default, 'defaultSelected');
    };
    if (!_afterWalk(mark)) mark();
  }
}


// What hydration calls with an option whose attributes it rewrote: the above,
// installed by the first write of a select's value or default, so the
// hydration walk itself does not reach the option marking. The select code
// it belongs to is itself installed (_installSelects).
/** @type {((option: Element) => void) | null} */
export let _selectionKeeper = null;

// A select's defaultValue: the options it names are the default-selected
// ones. Written now and once more after the options are in place: hydration
// writes each option's own props after its select's, which would take the
// mark away from an option the select named, so a hydration writes it again
// when its walk is done.
function setSelectDefault(el, value) {
  if (value == null) return;
  if (el._$default === undefined) el.addEventListener('change', () => { el._$chosen = true; });
  el._$default = value;
  _selectionKeeper = _keepSelection;
  _installOptionsChanged(_optionsChanged);
  const apply = () => {
    if (el._$default !== value) return;
    markOptions(el, value, 'defaultSelected');
    _keepSelection(el);
  };
  apply();
  if (!_afterWalk(apply)) queueMicrotask(apply);
}

// --- What the user changed before hydration ---
//
// A field the user changed between the first paint and hydration keeps what
// they left in it, controlled or not, and no event is dispatched for it: the
// handlers see the edits made after hydration. Released React does the same
// for every field but a textarea (react-dom 19.3 leaves the live value alone
// and dispatches nothing, and puts a textarea back to the server's text). The
// fields show the user's values before the hydration's mount callbacks run
// (render.js walkDone). A value the browser restored on a history navigation looks
// exactly like an edit, so replaying one would run a handler the user never
// triggered. A field is changed when what it shows is not what the same
// markup shows untouched (the server wrote what it showed there). An input
// or a textarea that shows exactly what its markup says (its value attribute
// or text, its checked attribute) is untouched: what it shows is a value the
// browser kept, and the same markup shows it untouched. Any other, and every
// select, is compared with the browser's own reset algorithm run on a copy:
// its value (a range at its midpoint, a color at #000000), its checkedness,
// or the options a reset selects. A controlled field's prop still counts as
// written, so a write of the same value leaves the user's change, and any
// other value replaces it. A file input keeps the files chosen in it:
// hydration writes none.

/**
 * The fields hydration is claiming with `el` that the user changed, each as
 * [el, what it shows], pushed to `out`: `el`, or every radio of its group,
 * which the props of the first one claimed would change (`seen` holds the
 * radios already read).
 */
export function _changedFields(el, out, seen) {
  if (el.type !== 'radio') {
    const changed = changedField(el);
    if (changed !== null) out.push(changed);
    return;
  }
  const group = el.form !== null ? _formMember(el.form, 'elements') : el.ownerDocument.getElementsByName(el.name);
  const radios = [];
  for (const radio of group) {
    // A native radio only: a form-associated custom element reporting
    // `type === 'radio'` is no member of the group's reset, and a copy of it
    // would run its constructor. It is left as it is.
    if (radio.localName !== 'input' || radio.type !== 'radio' || radio.name !== el.name || radio.form !== el.form || seen.has(radio)) continue;
    seen.add(radio);
    radios.push(radio);
  }
  if (radios.length === 0 || radios.every((radio) => radio.checked === radio.hasAttribute('checked'))) return;
  const copies = untouched(radios);
  radios.forEach((radio, i) => { if (radio.checked !== copies[i].checked) out.push([radio, radio.checked]); });
}

// What `els` show untouched: copies of them, reset by the browser in a form
// of their own (a radio group resets together, so the last `checked` wins).
// A copy is made from the field's markup alone (copyOf), so it runs no
// customized element's constructor and loads no image: the reset needs a
// form in a document with a browsing context, where a clone would do both.
function untouched(els) {
  const doc = els[0].ownerDocument;
  const form = doc.createElement('form');
  const copies = els.map((el) => copyOf(el, doc));
  _formMember(form, 'append')(...copies);
  _formMember(form, 'reset')();
  return copies;
}

// An element of `el`'s tag with its attributes but `is` (a customized
// built-in is decided when the element is made); for a textarea its text,
// for a select its options, each with its attributes and text, in their
// groups.
function copyOf(el, doc) {
  const copy = doc.createElement(el.localName);
  for (const name of el.getAttributeNames()) if (name !== 'is') copy.setAttribute(name, el.getAttribute(name));
  if (el.localName === 'textarea') copy.textContent = el.defaultValue;
  else if (el.localName === 'select') {
    let group = null;
    let groupCopy = null;
    for (const option of el.options) {
      const parent = option.parentElement;
      let into = copy;
      if (parent !== el && parent !== null && parent.localName === 'optgroup') {
        if (parent !== group) {
          group = parent;
          groupCopy = copy.appendChild(copyOf(parent, doc));
        }
        into = groupCopy;
      }
      into.appendChild(copyOf(option, doc)).textContent = option.text;
    }
  }
  return copy;
}

function changedField(el) {
  if (el.type === 'file' || el.type === 'image') return null;
  if (el.tagName === 'SELECT') {
    const [copy] = untouched([el]);
    const options = [...el.options];
    const live = options.map((option) => option.selected);
    const reset = copy.options;
    if (!live.some((selected, i) => selected !== reset[i].selected)) return null;
    el._$chosen = true;
    return [el, options, live];
  }
  if (el.type === 'checkbox') {
    if (el.checked === el.hasAttribute('checked')) return null;
    return el.checked !== untouched([el])[0].checked ? [el, el.checked] : null;
  }
  if (el.value === (el.tagName === 'TEXTAREA' ? el.defaultValue : el.getAttribute('value') ?? '')) return null;
  return el.value !== untouched([el])[0].value ? [el, el.value] : null;
}

/** The fields a hydration claimed changed (_changedFields) show what they showed. */
export function _restoreFields(fields) {
  for (const [el, shown, live] of fields) {
    if (live !== undefined) {
      shown.forEach((option, i) => { if (!live[i]) option.selected = false; });
      shown.forEach((option, i) => { if (live[i]) option.selected = true; });
      if (!el.multiple && !live.includes(true)) el.selectedIndex = -1;
    } else if (shown === false) el.checked = false;
    else if (shown !== true && el.value !== shown) el.value = shown;
  }
  // A radio checked last unchecks the rest of its group.
  for (const [el, shown] of fields) if (shown === true) el.checked = true;
}

// Whether `el` takes prop `key` through a property it can write: one with a
// setter (value, checked, a custom element's accessor) or a writable data
// property. A getter-only reflection (an input's `form` owner, its `list`
// datalist, a select's `type`) takes the attribute instead: assigning to it
// throws in a module.
export function _writableProp(el, key) {
  for (let o = el; o !== null; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, key);
    if (d !== undefined) return d.writable === true || d.set !== undefined;
  }
  return false;
}

// NOTE: there are intentionally TWO `setProp` implementations in this codebase:
//   - dom.js setProp (this one) — h()/createDOM path. Handles addEventListener
//     bookkeeping (el._events with capture variants and the untrack wrapper),
//     supports `isSvg` flag from the caller.
//   - render.js setProp — fine-grained-compiler output path. No event-handler
//     bookkeeping (events go through delegation / direct addEventListener at
//     compile time), but adds the innerHTML `{__html}` enforcement that the
//     compiler relies on.
// Both gate attributes through _isUnsafeAttr() so URL sanitization cannot
// diverge. Do not merge without consolidating the event/listener model: they
// have different callers. hydrate() writes a vnode's props onto the element it
// claims through this one too (render.js, from the renderer slot), so a
// hydrated element behaves as a built one.
export { setProp as _setVNodeProp };

function setProp(el, key, value, isSvg) {
  // A prop named `__proto__` (a user object's own key) would set the
  // element's prototype: it is never written.
  if (key === '__proto__') return;
  // A function classList, or an object with function entries, is reactive in
  // setClassList itself.
  if (key === 'classList') {
    setClassList(el, value);
    return;
  }

  // Reactive function props — wrap in effect for fine-grained updates
  if (typeof value === 'function' && !_isEventProp(key) && key !== 'ref') {
    if (__DEV__) setNextBinding(el, `${el.localName}.${key}`);
    effect(() => { setProp(el, key, value(), isSvg); });
    return;
  }

  // Event handlers
  if (_isEventProp(key)) {
    if (typeof value !== 'function' && value != null) return;
    let eventName = key.slice(2);
    let useCapture = false;
    // onGotPointerCapture and onLostPointerCapture are events of their own.
    if (eventName.endsWith('Capture') && !eventName.endsWith('PointerCapture')) {
      eventName = eventName.slice(0, -7);
      useCapture = true;
    }
    // onDoubleClick is React's name for the DOM's `dblclick`.
    let event = eventName.toLowerCase();
    if (event === 'doubleclick') event = 'dblclick';
    const storageKey = useCapture ? event + '_capture' : event;
    // onChange is React's change event (_onChange): it hears `input` too.
    const types = event === 'change' ? ['input', event] : [event];
    const old = el._events?.[storageKey];
    if (old && old._original === value) return;
    if (old) for (const type of types) el.removeEventListener(type, old, useCapture);
    if (value == null) return;
    if (!el._events) el._events = {};
    // Single closure per event listener. Uses untrack to prevent accidental
    // signal subscriptions inside event handlers. The listener belongs to the
    // owner it was set under: once that owner is disposed it never runs again
    // and removes itself when an event reaches it (an element that outlived
    // its owner: a node the next hydrate() of the same container claims, one
    // the app keeps and inserts again).
    const owner = getOwner();
    const wrappedHandler = (e) => {
      if (owner !== null && _isDisposed(owner)) {
        for (const type of types) el.removeEventListener(type, wrappedHandler, eventOpts || useCapture || undefined);
        if (el._events[storageKey] === wrappedHandler) delete el._events[storageKey];
        return;
      }
      if (!e.nativeEvent) e.nativeEvent = e;
      return untrack(() => event === 'change' ? _onChange(e, wrappedHandler._handler) : wrappedHandler._handler(e));
    };
    wrappedHandler._handler = value;
    wrappedHandler._original = value;
    el._events[storageKey] = wrappedHandler;
    const eventOpts = value._eventOpts;
    for (const type of types) el.addEventListener(type, wrappedHandler, eventOpts || useCapture || undefined);
    return;
  }

  // Reject dangerous URL protocols and srcdoc. A refused value leaves no
  // attribute: not one an earlier write set, not one the server wrote.
  if (_isUnsafeAttr(key, value)) {
    el.removeAttribute(key);
    if (typeof console !== 'undefined') {
      console.warn(`[what] Blocked unsafe URL in "${key}" attribute:`, value);
    }
    return;
  }

  // className / class
  if (key === 'className' || key === 'class') {
    _writeClass(el, value, isSvg);
    return;
  }

  if (key === 'style') {
    setStyle(el, value);
    return;
  }

  // Raw inner HTML: dangerouslySetInnerHTML, or innerHTML given as
  // { __html } (null writes nothing; a string is refused, to prevent XSS:
  // { __html } marks markup someone trusted).
  if (key === 'dangerouslySetInnerHTML' || key === 'innerHTML') {
    if (key === 'innerHTML' && !(value && typeof value === 'object' && '__html' in value)) {
      if (__DEV__ && value != null) report('ERR_UNSAFE_INNERHTML', { subject: { kind: 'element', name: el.localName } });
      return;
    }
    const html = value?.__html ?? '';
    if (__DEV__ && typeof html === 'string' && /(<script|onerror\s*=|onload\s*=|javascript:)/i.test(html)) {
      console.warn('[what] dangerouslySetInnerHTML contains potential XSS vectors. Ensure content is sanitized.');
    }
    el.innerHTML = html;
    return;
  }

  // A form field's state, before the nullish and boolean branches below,
  // which would write its value as its default (Form fields above). The h()
  // renderer and hydration, which write props here, carry the select code.
  selects = selectProp;
  if (_setFieldProp(el, key, value)) return;

  // null / undefined — attribute must be ABSENT (React/Solid semantics), not
  // stamped as the literal string "undefined"/"null". Runs before the boolean,
  // data-*/aria-*, SVG and property-reflected branches, all of which would
  // otherwise stringify a nullish value. Reflected props (e.g. el.title) are
  // reset first so removeAttribute() clears both the attribute and the property.
  if (value == null) {
    if (_writableProp(el, key)) {
      try { el[key] = ''; } catch { /* a property '' does not fit (files) */ }
    }
    el.removeAttribute(key);
    return;
  }

  // aria-*/role BEFORE the boolean fast-path: these are enumerated string
  // attributes, so a boolean has to serialize as "true"/"false", never as HTML
  // boolean syntax. See _isAriaAttr above.
  // data-* joins aria-* here rather than falling through to the boolean branch
  // below. Both are enumerated: `data-open="false"` is a distinct state from an
  // absent `data-open`, and `[data-open="false"]` is an ordinary CSS selector,
  // so collapsing false to "remove the attribute" throws information away.
  // The compiled path in render.js has always stringified these, so keeping the
  // generic boolean branch first is also what made an SSR page disagree with
  // its own compiled client on hydration.
  if (isAriaAttr(key) || key.startsWith('data-')) {
    el.setAttribute(key, typeof value === 'boolean' ? String(value) : value);
    return;
  }

  // Boolean attributes. A genuine HTML boolean like `disabled` is present or
  // absent; there is no `disabled="false"`.
  if (typeof value === 'boolean') {
    if (value) el.setAttribute(key, '');
    else el.removeAttribute(key);
    return;
  }

  // SVG
  if (isSvg) {
    if (value === false || value == null) {
      el.removeAttribute(key);
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
    return;
  }

  // Default: property if the element can write one, otherwise attribute
  if (_writableProp(el, key)) {
    el[key] = value;
  } else {
    el.setAttribute(key, value);
  }
}

/**
 * @internal A member of a form, read from its prototype; a method comes back
 * bound to the form. HTMLFormElement is [LegacyOverrideBuiltIns]: a control
 * whose name or id is a member's (`reset`, `elements`, `action`, `append`,
 * `dispatchEvent`, any of them) stands in for that member on the form itself,
 * so the framework's reads of the members a form's own code uses (its
 * fields, reset, submit and events, in dom.js, form.js and islands.js) go
 * through here. The element reads every renderer makes of any element
 * (`getAttribute`, `addEventListener`, ...) do not: a control named after one
 * of those breaks its form's hydration (docs/GOTCHAS.md).
 */
export function _formMember(form, name) {
  const value = Reflect.get(Object.getPrototypeOf(form), name, form);
  return typeof value === 'function' ? value.bind(form) : value;
}

// A form's reset after its action succeeded (what-server's <Form>), as React 19
// resets one: its uncontrolled fields go back to their defaults, and a
// controlled field (a value or checked prop) keeps the value its prop holds.
// A write that throws (a control's own setter, a custom element's
// formResetCallback) goes to `onError`, and every other field is still
// restored.
export function _resetForm(form, onError) {
  const fields = [..._formMember(form, 'elements')];
  const held = fields.map((el) => [el._$value, el._$checked]);
  const attempt = (write) => {
    try { write(); } catch (error) { onError(error); }
  };
  attempt(_formMember(form, 'reset'));
  fields.forEach((el, i) => {
    const [value, checked] = held[i];
    // A select's value was written by the select code it carries (_setSelectValue).
    if (value !== undefined) attempt(() => (el._$select ? el._$select(el, value) : (el.value = value)));
    if (checked !== undefined) attempt(() => { el.checked = checked; });
  });
}
