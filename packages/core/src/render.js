// What Framework - Fine-Grained Rendering Primitives
// Solid-style rendering: components run once, signals create individual DOM effects.
// No VDOM diffing — direct DOM manipulation with surgical signal-driven updates.
//
// This module is everything compiled JSX needs and nothing it does not: vnodes
// (h(), the automatic JSX runtime, boundaries, portals) are handed to the
// renderer in vnode-renderer.js, which only a vnode producer installs, so a
// compiled-only bundle never contains dom.js's createDOM.

import { _symbolChild, signal, effect, untrack, batch, createRoot, _provide, _contextOf, _itemScope, _runScope, _rowItem, _readRowItem, _propField, _setRowItem, _livesWithRow, _readAlone, _effectWhenNeeded, _tracking, _ownerRecord, _componentOwner, _holdUser, _releaseUser, _runOwned, _disposeOwner, _handleError, _handlePending, _isNotReady, _adoptOwner, _currentComponent, _isDisposed, HANDLED, _devAnchor, _devError, _devMounted, __ownerPath, memo, onCleanup, getOwner, runWithOwner, __DEV__, __devtools } from './reactive.js';
import { isServerRender } from './server-context.js';
import { __resetIdCounter } from './a11y.js';
import { _trackRoot, _liveRegionNodes, _setFieldProp, _showControlled, _selectionKeeper, _changedFields, _restoreFields, _writableProp, _isUnsafeAttr, _isEventProp, _installLazyChildren, _place, _placeFlat, _takeFlat, _copyProps, _copyProp, _setOwnProp, _isLiveProp, _isOwnProps, _markProps, _ownProps, PROPS, _setOutsideRead, _mountTarget, _handleNavigationSignal, _controlFields, _selectsFor } from './dom.js';
import { isEnumeratedAttr, markupName, FIELD_PROPS, FIELD_TAGS, ATTRIBUTE_VALUE_TYPES } from './markup-rules.js';
import { _onChange } from './dom.js';
import { report, setNextBinding, recordObservation, _thrownMessage } from './diagnostics.js';
import { VNode, isVNode, vnodeRenderer, vnodeRows, vnodeProp, vnodeRefuses, SVG_TAG } from './vnode-renderer.js';
import { adoptVNodeKinds, adoptVNodeRows } from './vnode-adoption.js';
// The vnode renderer slot (vnode-renderer.js), for a renderer of another
// package's elements in a program that has none of what-core's: what-react's
// mixed mode places its elements, and keeps a hole's keyed rows, through it.
export { _installVNodeRuntime } from './vnode-renderer.js';
import { _assignHydrationOwnerPath, _hydrationRoot, _ownerCounter, _installSeeding, _swapArrived } from './hydration-data.js';
export { effect, untrack };
// The eager memo, for compiled output (branch memoization: the compiler emits
// _$memo(() => cond) so conditional branches only re-create DOM when the
// condition value actually changes, not on every dependency write). The root
// entry's `memo` is React's component memo.
export { memo as _$memo };
// The lazy one: the condition of a branch that may never be reached (an inner
// arm of a ternary chain, a <Show> fallback, a ternary handed to a component
// as JSX), evaluated on its first read, so a condition its outer arms guard
// (`q.data().items.length` behind `q.isLoading()`) is never read unguarded.
export { computed as _$lazyMemo } from './reactive.js';
export { _place as _$place };
// What `<Counter client:idle />` compiles to: an island that hydrates itself.
export { _$Island } from './components.js';

/**
 * @internal What what-compiler found while it compiled a module, in a
 * development build (ERR_PROP_READ_ONCE, ERR_STATE_READ_ONCE): reported on
 * the diagnostics channel when the module loads, so the console, the MCP
 * tools and getDiagnostics() show it beside what the runtime reports. The
 * component is the subject, so what_explain lists it under the component.
 * @param {Array<{ code: string, data: Record<string, any>, loc: string }>} records
 */
export function _$buildDiagnostics(records) {
  if (__DEV__) {
    for (const { code, data, loc } of records) report(code, { data, loc, owner: [], subject: { kind: 'component', name: data.component, id: loc } });
  }
}
// The compiler rewrites `sig() === row.key` in keyed .map() rows to a selector.
export { createSelector } from './selector.js';
// A compiled `.map()` row reads its item with _$item (mapArray's follow mode).
export { _readRowItem as _$item };
// A component body's member read of a prop (`props.item.id`): reactive.js _propField.
export { _propField as _$propField };

// --- Generic text insertion hook ---
// External text engines (e.g., what-text) register a callback here via
// _setTextInsertHook(). When null (default), zero cost — no module loaded,
// no branch taken. The hook receives (parentElement, textString) on every
// dynamic text insertion and update.
/** @type {((parent: any, text: string) => void) | null} */
let _onTextInsert = null;

export function _setTextInsertHook(fn) {
  _onTextInsert = typeof fn === 'function' ? fn : null;
}

// Dynamic text was written in `parent`: the text engine hears it, and a
// select follows an option whose text is its value, one with no `value`
// attribute (dom.js _optionsChanged, which passes over the text of an option
// with a value: its label, which changes nothing the select shows). `options`
// is inOptions(parent), which a binding whose parent stays the same asks once.
function textWritten(parent, text, options = inOptions(parent)) {
  if (_onTextInsert !== null) _onTextInsert(parent, text);
  if (options) optionsChanged(parent, 1);
}

// Whether text written in `parent` can change what a select shows: text in
// an option, or directly in an optgroup or a select. Text anywhere else
// changes no option, and is not reported.
function inOptions(parent) {
  const tag = parent.localName;
  return tag === 'option' || tag === 'optgroup' || tag === 'select';
}

// --- Vnodes ---

function vnodeRuntimeMissing(what) {
  return Object.assign(new Error(__DEV__
    ? _thrownMessage('ERR_NO_VNODE_RENDERER', `${what} reached the compiled-JSX runtime, but no vnode renderer is installed. ` +
      'Compiled JSX builds DOM directly; the renderer for vnodes is installed by importing h, ' +
      'Fragment or html from what-framework, by the automatic JSX runtime, or by a component ' +
      'that returns vnodes (ErrorBoundary, Suspense, Portal, lazy, Island).')
    : '[what] no vnode renderer installed'), { code: 'ERR_NO_VNODE_RENDERER' });
}

// A compiled children factory returns an array; a component reads a single
// child as the child itself.
function lazyChildren(factory) {
  const lazy = () => {
    const kids = factory();
    return kids.length === 1 ? kids[0] : kids;
  };
  lazy._lazyChildren = true;
  return lazy;
}

// `children` (an array, or the factory of compiled JSX) and the slots of
// `props` (_$slots) on `merged`, the copy a compiled component runs with:
// what ends the burst of their reads, or null.
function lazyProps(Component, merged, props, children) {
  const slots = props != null ? props._$slots : undefined;
  if (typeof children === 'function') return _installLazyChildren(Component, merged, lazyChildren(children), slots);
  if (children != null && children.length > 0) _setOwnProp(merged, 'children', children.length === 1 ? children[0] : children);
  return slots !== undefined ? _installLazyChildren(Component, merged, null, slots) : null;
}

// --- _$componentVNode(Component, props, children) ---
// The VNode half of _$createComponent: same argument protocol, stopping one step
// short of building anything.
//
// The JSX handed straight to hydrate() in a hydratable build lowers to this:
// written as the call's argument it is evaluated before hydrate() runs, and a
// component that ran then would have nothing to claim. hydrate() runs it when
// its walk reaches it, as it runs a component vnode from h().

export function _$componentVNode(Component, props, children, devLoc) {
  const vnode = componentVNode(Component, props, children);
  if (__DEV__ && devLoc) /** @type {any} */ (vnode)._loc = devLoc;
  return vnode;
}

/**
 * _$componentVNode for a root whose tag may be a string held in a binding
 * (`hydrate(<Tag />)`): hydrate() runs it as the component that claims the
 * server's element where its walk stands (claimedTag), as _$hcreateComponent
 * runs such a tag anywhere else.
 */
export function _$hcomponentVNode(Component, props, children, devLoc) {
  return _$componentVNode(typeof Component === 'string' ? claimedTag(Component) : Component, props, children, devLoc);
}

function componentVNode(Component, props, children) {
  // Deferred children (compiled JSX): the compiler passes a zero-arg factory
  // when children contain elements, so their DOM is not built before this
  // component runs, and the factories of the props it passed JSX in
  // (_$slots). hydrate() reads the _$lazyChildren and _$slots markers, so the
  // protocol survives the unbuilt route intact.
  const slots = props != null ? props._$slots : undefined;
  const lazy = typeof children === 'function';
  if (lazy || slots !== undefined) {
    // Copy first. The lazy marker is an expando, and `props` may be a
    // user-owned object (a lone JSX spread, or a hand-written call).
    props = _copyProps(props);
    if (lazy) Object.defineProperty(props, '_$lazyChildren', { value: lazyChildren(children), configurable: true });
    else if (children && children.length > 0) _setOwnProp(props, 'children', children.length === 1 ? children[0] : children);
    if (slots !== undefined) Object.defineProperty(props, '_$slots', { value: slots, configurable: true });
    return new VNode(Component, props, lazy ? [] : children || [], null);
  }
  if (children && children.length > 0) {
    const mergedChildren = children.length === 1 ? children[0] : children;
    // Never write onto the object we were handed. A lone spread is the
    // caller's value; writing `children` onto it leaks into the next call
    // that reuses the same object and permanently corrupts user state.
    // A props object What built keeps its getters (dom.js _copyProps); any
    // other object's getters are read once, as Object.assign reads them.
    props = _copyProps(props);
    _setOwnProp(props, 'children', mergedChildren);
  }
  return new VNode(Component, props || {}, children || [], null);
}

/**
 * Compiled JSX: `props` with `slots`, the factories of the props its JSX
 * passed as JSX or forwarded (`header={<Nav />}`, `fallback={props.fallback}`),
 * which the component reads as lazy getters (dom.js _installLazyChildren).
 */
export function _$slots(props, slots) {
  Object.defineProperty(props, '_$slots', { value: slots });
  return props;
}

// --- _$createComponent(Component, props, children, devLoc) ---
// The compiler's target for `<Component />`. Runs the component once and
// returns its output: the element itself when the component returned one
// element, else a DocumentFragment, <!--c:start--> its output <!--c:end-->.
//
// `children` is an array, or a zero-arg factory when the children contain
// elements: building them waits until this component's owner is current, so a
// provider's context reaches its own subtree. `devLoc` is the compiler's
// development metadata, "Name@src/File.jsx:12:5".

export function _$createComponent(Component, props, children, devLoc) {
  return _$createLazyFn(asComponent(Component), props, children, devLoc);
}

/**
 * _$createComponent for a module whose every component is a plain function,
 * which what-compiler can tell (dom.js isPlainFunctionComponent): no class
 * component to run through its bridge, and no tag (asComponent below), so an
 * app none of whose modules may call one does not carry them. what-compiler
 * imports it under the same name, as it picks _$mapKeyed for a module of
 * keyed lists.
 */
export function _$createLazyFn(Component, props, children, devLoc) {
  const merged = ownProps(props);
  return _renderComponent(Component, merged, lazyProps(Component, merged, props, children), false, devLoc);
}

/**
 * _$createComponent for a module whose JSX hands no component children and no
 * JSX in a prop, and still passes the empty children array. With nothing to
 * build lazily, the lazy getters (dom.js _installLazyChildren, readLazy) are
 * not reached from here, so an app none of whose modules needs them does not
 * carry them.
 */
export function _$createLeaf(Component, props, _children, devLoc) {
  return _$createFn(asComponent(Component), props, _children, devLoc);
}

/** _$createLeaf for a module whose every component is a plain function (_$createLazyFn). */
export function _$createFn(Component, props, _children, devLoc) {
  return _renderComponent(Component, ownProps(props), null, false, devLoc);
}

// What a compiled component call runs `Component` as when what-compiler cannot
// tell it is a plain function: a class component through its bridge, and a
// string as the element it names, as React renders one
// (`const Tag = props.as || 'div'; <Tag {...rest} />`).
function asComponent(Component) {
  return typeof Component === 'string' ? tagComponent(Component) : _toFunctionComponent(Component);
}

// The component a tag held in a binding renders as: its element, with its
// props spread on it as `<tag {...props}>` spreads them (a field's value and
// checked bound as a binding does, a select's or an option's with the select
// code) and its children inserted. what-compiler writes a tag it can read
// (`const Tag = 'select'`) as the element itself.
function tagComponent(tag) {
  return (props) => {
    const el = tagElement(tag);
    _selectsFor(el);
    spread(FIELD_TAGS.has(el.localName) ? _$controlled(el) : el, props);
    const children = props.children;
    if (children != null) insert(el, children);
    return el;
  };
}

// The element a tag held in a binding names, in the namespace of where it is
// built. A name only SVG has (`circle`, `clipPath`) is SVG and one only MathML
// has (`mi`) is MathML, wherever it stands, as the compiler places a template
// root by its tag; a name SVG shares with HTML (`a`, `title`, `script`,
// `style`) is in the namespace of its place: compiled JSX gives a component it
// calls in <svg> or <math>, or in HTML inside one, its place's namespace
// (_$inNs), which what the component builds inherits through its owners.
// Anything else is HTML.
const NAMESPACES = ['http://www.w3.org/1999/xhtml', 'http://www.w3.org/2000/svg', 'http://www.w3.org/1998/Math/MathML'];
const MATH_TAG = /^(?:math|m(?:action|enclose|error|fenced|frac|i|multiscripts|n|o|over|padded|phantom|prescripts|root|row|s|space|sqrt|style|sub|subsup|sup|table|td|text|tr|under|underover)|annotation(?:-xml)?|semantics)$/i;
// The context key _$inNs provides the namespace under, and whether it ever did.
const PLACED_NS = {};
let placedNs = false;

function tagElement(tag) {
  const placed = placedNs && /^(?:a|script|style|title)$/i.test(tag) ? _contextOf(PLACED_NS) : null;
  const ns = placed !== null ? placed.get(PLACED_NS) : SVG_TAG.test(tag) ? NAMESPACES[1] : MATH_TAG.test(tag) ? NAMESPACES[2] : null;
  return ns == null ? document.createElement(tag) : document.createElementNS(ns, tag);
}

/**
 * @internal Compiled JSX: `build()`, a component call placed in SVG (`ns` 1),
 * MathML (2), or HTML inside one of them (0), in a scope that tells the tags
 * held in bindings below it which namespace they stand in (tagElement).
 */
export function _$inNs(ns, build) {
  placedNs = true;
  return createRoot(() => {
    _provide(PLACED_NS, NAMESPACES[ns]);
    return build();
  });
}

// The props object a compiled component runs with, a plain object as React's
// props are. Compiled JSX builds a fresh object when it passes live props
// (getters, dom.js _isLiveProp), marked (`_$marked({ … })`, or `[_$props]:
// true` in the literal) or with no prototype: that object is the component's
// own, made a plain one in place so its getters stay live (dom.js _ownProps).
// A props object What marked (a merge of spreads that kept a getter, _$merge;
// what-react's) is taken as it is. Any other object is copied: it may be the
// caller's (a hand-written call). The copy holds no getter, as a spread reads
// each one, so it is not marked (dom.js _copyProps); the lazy getters of the
// component's children mark it when they are defined (_installLazyChildren).
function ownProps(props) {
  if (props == null) return {};
  // A spread defines `__proto__` as a key, where Object.assign would set the prototype.
  if (!_isOwnProps(props)) return { ...props };
  return Object.isExtensible(props) ? _ownProps(props) : props;
}

// The key a props object of compiled JSX is marked with (`{ [_$props]: true, … }`),
// and compiled JSX's mark of its props literal, hidden (`_$marked({ … })`).
export { PROPS as _$props, _markProps as _$marked };

/**
 * Compiled JSX's spread props (`<Box a {...s} b />`): the sources merged in
 * order into one plain object. A getter of a props object What marked (a
 * forwarded `{...props}`, a live prop) stays a getter, and the merge is
 * marked when it kept one, so a wrapper that forwards its props keeps them
 * live; any other object's properties are copied by value, as Object.assign
 * copies them.
 */
export function _$merge() {
  const out = {};
  let live = false;
  for (let i = 0; i < arguments.length; i++) {
    // As object spread takes a source: null, undefined, a boolean or a
    // number gives nothing, a string its characters (`{ ...(on && x) }`).
    const src = Object(arguments[i]);
    const own = _isOwnProps(src);
    // Every own enumerable key, symbols too, as Object.assign copies them.
    for (const key of Reflect.ownKeys(src)) if (Object.prototype.propertyIsEnumerable.call(src, key) && _copyProp(out, src, key, own)) live = true;
  }
  return live ? _markProps(out) : out;
}

// Compiled JSX's rest element of destructured props (`({ a, ...rest })`):
// `props` without the keys named, its getters kept, so `<button {...rest} />`
// and `<Inner {...rest} />` stay live.
export { _copyProps as _$omit };

// A class component runs as a function component that constructs it and calls
// render(); any other component is returned as it is. Every path that runs a
// component it was handed asks here: compiled JSX (asComponent), the vnode
// renderer and hydration, memo(), and an <ErrorBoundary>'s fallback. It lives
// here rather than with the vnode renderer because compiled JSX renders class
// components too, and a bundle with no vnode producer has no vnode renderer.
export function _toFunctionComponent(ClassComp) {
  const proto = ClassComp.prototype;
  if (proto == null || !(proto.isReactComponent || proto.render)) return ClassComp;
  const Bridge = function ClassComponentBridge(props) {
    const instance = new ClassComp(props);
    return instance.render();
  };
  Bridge.displayName = ClassComp.displayName || ClassComp.name || 'ClassComponent';
  return Bridge;
}

// --- _renderComponent(Component, props, endChildrenPass, isSvg, devLoc) ---
// The component lifecycle, shared by compiled JSX (above) and the vnode
// renderer (dom.js createComponent). `props` is the finished object the
// component receives, as is: there is nothing to keep reactive about a props
// object in a run-once model, so it is not wrapped.
//
// The component is an owner, created under the current one: its body and its
// output are built under it, untracked, so its hooks, context values and every
// effect, binding and nested component it creates belong to it, and whoever
// disposes the owner it was created under (a region's run, a list row, a
// boundary's arm, a mount root) disposes all of it.

export function _renderComponent(Component, props, endChildrenPass, isSvg, devLoc) {
  // Props are read-only to the component; in development a write throws.
  if (__DEV__) Object.freeze(props);
  const owner = _componentOwner(Component, props);
  if (__DEV__) devComponent(owner, devLoc);
  // Its output, and the node that opens it: the element, or its start comment.
  /** @type {any} */
  let out;
  /** @type {any} */
  let first;
  // Its useEffect and onMount first runs wait for its output, so its
  // children's come first, as in React (reactive.js _holdUser).
  const held = _holdUser();
  try {
    const result = _runOwned(owner, Component, props);
    if (__DEV__ && result != null && typeof result.then === 'function') devAsyncComponent(Component);
    // Its JSX props are read after its run from here on (dom.js
    // _installLazyChildren).
    if (endChildrenPass !== null) endChildrenPass(owner);
    // One element is its own range: nothing the component built can change
    // where its output starts or ends, so it needs no markers and no fragment
    // to carry them (a hydrated component has none either). Anything else (a
    // fragment, an array, a region, a list, text, nothing) is bracketed.
    if (result != null && result.nodeType === 1 && result._owner === undefined) out = first = result;
    else first = (out = _runOwned(owner, bracketOutput, result, isSvg)).firstChild;
  } catch (error) {
    _disposeOwner(owner);
    // Its markers with nothing between them: a component that suspended is
    // rendered again there.
    const container = bracketOutput(null, isSvg);
    const left = failComponent(error, owner.owner, /** @type {Comment} */ (container.firstChild), /** @type {Comment} */ (container.lastChild), Component, props, isSvg, devLoc);
    if (left !== HANDLED) {
      console.error('[what] Uncaught error in component:', Component.name || 'Anonymous', left);
      throw left;
    }
    return container;
  } finally {
    _releaseUser(held);
  }
  if (__DEV__) devOutput(owner, first);
  // Built under no owner: compiled `mount(<App />, el)` builds App before
  // mount() makes its root. The root adopts it (_adoptDetached).
  if (owner.owner === null) {
    first._owner = owner;
    detached++;
  }
  return out;
}

// Components built under no owner and not yet adopted.
let detached = 0;

// Components that suspended while they were built, and were left to be
// rendered again in their place (renderWhenSettled). One that did so in a
// list row may have bound plain fields of the row before it did
// (bindRowField), which the row lets go of once it is built (rowBuilt,
// dropFailedFields). A component that fails any other way leaves no such
// field behind: the children of an error boundary inside the row are built
// under a root of their own, which is not a component, so nothing there is a
// field of the row; a boundary outside the row disposes the list; and a
// navigation leaves the page.
let failures = 0;

/**
 * Give the components in `nodes` that were built under no owner to the
 * current owner (mount()'s or hydrate()'s root). Walks `nodes` only while such
 * a component exists.
 */
export function _adoptDetached(nodes) {
  for (let i = 0; i < nodes.length && detached > 0; i++) adoptIn(nodes[i]);
}

function adoptIn(node) {
  const owner = node._owner;
  if (owner !== undefined) {
    node._owner = undefined;
    detached--;
    _adoptOwner(owner);
  }
  // On: an element that is a component's whole output holds what the
  // component placed in it, which can be another component built under no
  // owner (a module-scope `const side = <Side />`). A start comment holds
  // nothing.
  for (let c = node.firstChild; c !== null && detached > 0; c = c.nextSibling) adoptIn(c);
}

// A component's output between its markers, in a fragment. Comment boundaries
// rather than a wrapper element: no DOM pollution, no CSS selector breakage.
function bracketOutput(result, isSvg) {
  const container = document.createDocumentFragment();
  container.appendChild(document.createComment('c:start'));
  const nodes = valuesToNodes(result, container, [], isSvg);
  for (let i = 0; i < nodes.length; i++) container.appendChild(nodes[i]);
  container.appendChild(document.createComment('c:end'));
  return container;
}

// A component suspended: it threw a promise (lazy() before its chunk, use()
// before its promise settles, or a not-ready read of an async value in its
// body). It renders nothing for now, between its own markers, and is rendered
// there again once the promise settles, unless its place is gone by then. The
// nearest Suspense waits for that retry; one that has shown its content shows
// its fallback again only for a promise that is not an async value's
// (`showsFallback`). A promise that already settled is
// not a suspension: thrown again it would loop, so it is a failure (its
// rejection, or an error saying so). Only what can suspend a component
// (lazy(), use(), Suspense, async values) installs this, so an app that uses
// none of them does not carry it: a promise thrown there is an error.
/** @type {(error: any, parentOwner: any, start: Comment, end: Comment, Component: any, props: any, isSvg: any, devLoc: any) => any} */
let failComponent = componentFailed;

/** @internal Let components suspend and be rendered again in place. */
export function _enableSuspense() {
  failComponent = renderWhenSettled;
}

/** @type {WeakMap<object, { failed: boolean, reason: any }> | null} */
let settledPromises = null;

// What _renderComponent hands a failure to once anything can suspend, with
// the arguments it was called with. Returns what componentFailed returns.
function renderWhenSettled(thenable, parentOwner, start, end, Component, props, isSvg, devLoc) {
  if (thenable == null || typeof thenable.then !== 'function') return componentFailed(thenable, parentOwner);
  const settled = (settledPromises || (settledPromises = new WeakMap())).get(thenable);
  if (settled !== undefined) {
    const error = settled.failed ? settled.reason : new Error(__DEV__
      ? '[what] A component suspended on a promise that had already settled, so rendering it again would suspend again forever. Read a settled promise with use(promise), which returns its value.'
      : '[what] suspended on a settled promise');
    // A promise rejected with a thenable: that one goes to the nearest
    // Suspense as it is, before an error boundary.
    if (error != null && typeof error.then === 'function' && _handlePending(parentOwner, error)) return HANDLED;
    return componentFailed(error, parentOwner);
  }
  // The promise's callbacks hold only `job`, which lets go of the component
  // (its props, its place, its owner) once that place is disposed, so a
  // promise nobody waits for any more retains none of it. `retried` settles
  // when the component has been rendered again, or its place is gone: what
  // the nearest Suspense waits for.
  /** @type {{ retry: (() => void) | null }} */
  const job = { retry: retryIn(parentOwner, start, end, Component, props, isSvg, devLoc) };
  /** @type {any} */
  let release = null;
  /** @type {any} */
  const retried = new Promise((resolve) => { release = resolve; });
  const record = /** @type {WeakMap<object, any>} */ (settledPromises);
  const run = (outcome) => {
    record.set(thenable, outcome);
    const retry = job.retry;
    job.retry = null;
    if (retry !== null) retry();
    release();
  };
  Promise.resolve(thenable).then((value) => run({ failed: false, reason: value }), (reason) => run({ failed: true, reason }));
  if (parentOwner !== null) {
    runWithOwner(parentOwner, () => onCleanup(() => {
      job.retry = null;
      release();
    }));
  }
  failures++;
  retried.showsFallback = !_isNotReady(thenable);
  if (__DEV__) retried.component = Component.displayName || Component.name || 'Anonymous';
  if (!_handlePending(parentOwner, retried) && __DEV__) {
    report('ERR_ASYNC_WITHOUT_SUSPENSE', { data: { component: retried.component } });
  }
  return HANDLED;
}

// Render a suspended component again in its place, unless the place is gone.
// Made apart from the callbacks that call it, so they do not share its scope.
function retryIn(parentOwner, start, end, Component, props, isSvg, devLoc) {
  return () => {
    if ((parentOwner !== null && _isDisposed(parentOwner)) || end.parentNode === null) return;
    const host = end.parentNode;
    while (start.nextSibling !== end) host.removeChild(/** @type {ChildNode} */ (start.nextSibling));
    try {
      host.insertBefore(runWithOwner(parentOwner, () => _renderComponent(Component, props, null, isSvg, devLoc)), end);
    } catch { /* reported by the attempt itself */ }
  };
}

// A component threw while it was built. A navigation signal carries its own
// handler. Anything else goes to the nearest error boundary (`_onError`).
// Returns HANDLED, or the error nothing took. A thrown thenable is a
// suspension, which renderWhenSettled takes before it gets here: only a
// Suspense has an `_onPending` handler, and it installs renderWhenSettled
// (_enableSuspense) before it creates the owner that has one, so a program
// that cannot suspend has no handler to look for and does not carry the walk
// (reactive.js _handlePending). What can still meet a thenable with a
// Suspense above it asks for itself: a suspension whose promise had settled
// (renderWhenSettled), and a component that throws one while it hydrates
// (adoptComponent).
function componentFailed(error, owner) {
  if (_handleNavigationSignal(error)) return HANDLED;
  if (__DEV__ && __devtools) _devError(error, { type: 'component', owner });
  return _handleError(owner, error);
}

// Development: what devtools and the owner API know about a component: its
// name and source location, the nearest component above it, and its mount and
// unmount; then (devOutput) the node that opens its output.
function devComponent(owner, devLoc) {
  if (devLoc) owner.devLoc = devLoc;
  owner._parentCtx = parentComponent(owner);
  _devMounted(owner);
}

// An element that is the whole output of several components (`Outer` returns
// `<Inner />`) opens each one's output: it stays the innermost one's, which is
// built first, as a node between nested markers is.
function devOutput(owner, first) {
  owner._wrapper = first;
  _devAnchor(first, owner, first.nodeType === 1);
}

// Development: a component returned a promise, as an `async function`
// component does. Components run once and synchronously; its output is the
// promise's text.
function devAsyncComponent(Component) {
  report('ERR_ASYNC_COMPONENT', { data: { component: Component.displayName || Component.name || 'Anonymous' } });
}

// The nearest component owner above `owner`.
function parentComponent(owner) {
  for (let o = owner.owner; o != null; o = o.owner) {
    if (o.Component !== undefined) return o;
  }
  return null;
}

// --- Templates ---
// A template is parsed once into a <template> element; every instance is a
// cloneNode(true) of it.
//
// _$template is the compiler's form. It parses on first use, so markup for a
// component that never renders is never parsed and importing a compiled module
// touches no DOM. With `flag` 2 the compiler has wrapped the markup in an <svg>
// or <math> element so that its root parses in that namespace, and the
// template is the wrapper's only child. Table parts (<tr>, <td>, ...) need no
// wrapper: a <template> element parses them where they stand.
//
// The runtime does not detect namespaces itself; the flag is the compiler's
// promise, and a compiler and runtime of the same minor version keep it. Output
// from an older compiler, which relied on detection, has no flag on an SVG or
// MathML root, and in development that throws ERR_TEMPLATE_NAMESPACE rather
// than rendering the root as an unknown HTML element.

function invalidNesting(root) {
  const nodes = [...root.childNodes];
  const name = (node) => (node ? node.nodeName.toLowerCase() : 'that element');
  const inner = nodes.find((node, i) => i > 0 && node.nodeType === 1);
  return Object.assign(
    new Error(_thrownMessage('ERR_INVALID_HTML_NESTING',
      `<${name(nodes[0])}> cannot contain <${name(inner)}>: ` +
      'the HTML parser closed the outer tag early, so the rendered tree does not match your JSX.')),
    { code: 'ERR_INVALID_HTML_NESTING' },
  );
}

function parseTemplate(html, unwrap) {
  const t = document.createElement('template');
  t.innerHTML = html;
  const root = unwrap ? /** @type {Node} */ (t.content.firstChild) : t.content;
  // The compiler emits exactly one root per template. More than one top-level
  // node means the parser restructured invalid nesting (`<p>a<div>b</div></p>`
  // becomes four nodes), and the compiled node walk would die on a null
  // firstChild inside generated code. Dev-only: production markup is known-good
  // and this is on the first-render path. So is an HTML-parsed root that names
  // an SVG or MathML element (see _$template).
  if (__DEV__) {
    if (root.childNodes.length !== 1) throw invalidNesting(root);
    if (!unwrap) checkTemplateRoot(/** @type {Node} */ (root.firstChild));
  }
  return /** @type {Node} */ (root.firstChild);
}

export function _$template(html, flag) {
  /** @type {Node | null} */
  let node = null;
  return () => (node === null ? (node = parseTemplate(html, flag === 2)) : node).cloneNode(true);
}

function checkTemplateRoot(node) {
  // An SVG or MathML name the HTML parser took as an unknown HTML element.
  if (node.nodeType !== 1 || node.namespaceURI !== NAMESPACES[0] || !(SVG_TAG.test(node.localName) || MATH_TAG.test(node.localName))) return;
  throw Object.assign(new Error(_thrownMessage('ERR_TEMPLATE_NAMESPACE',
    `The template for <${node.localName}> has no namespace flag, so its root would render ` +
    'as an unknown HTML element instead of SVG or MathML. Compiled output like this comes from a ' +
    'what-compiler older than this runtime: compiler and runtime versions move together, so ' +
    'recompile it with the what-compiler release that matches what-framework.',
  )), { code: 'ERR_TEMPLATE_NAMESPACE' });
}

// template() and svgTemplate() are the hand-written forms. They parse
// immediately and take the markup as given: template() parses HTML (table
// parts included), svgTemplate() parses SVG.
let _templateWarned = false;
export function template(html) {
  if (__DEV__ && !_templateWarned) {
    _templateWarned = true;
    console.warn(
      '[what] template() is a compiler internal. Use JSX instead. ' +
      'Direct calls with user input can lead to XSS vulnerabilities.'
    );
  }
  const node = parseTemplate(html.trim(), false);
  return () => node.cloneNode(true);
}

// A complete <svg> element parses in the SVG namespace by itself; an inner SVG
// element (path, circle, g, ...) is parsed inside an <svg> wrapper and extracted.
export function svgTemplate(html) {
  const trimmed = html.trim();
  const node = /^<svg[\s/>]/i.test(trimmed)
    ? parseTemplate(trimmed, false)
    : parseTemplate(`<svg>${trimmed}</svg>`, true);
  return () => node.cloneNode(true);
}

// --- insert(parent, child, marker?) ---
// Places `child` in `parent` before `marker`:
// - string/number → text
// - function → reactive region (an effect keeps it current)
// - mapArray inserter → a self-managing list
// - DOM node → inserted as is
// - array, vnode, anything else → reconciled
//
// `marker` undefined (not null) is the compiler saying "this child is the
// element's only content": a text value is then set with one textContent write
// instead of creating and inserting a text node. null means "append".
// `devName` is the compiler's development name for the binding,
// "li.children@src/App.jsx:15:11".

// What has a select a value controls select its options again when a region
// or list changes the children of `parent` (dom.js _optionsChanged): installed
// by the field code once a value controls a select, so a program without one
// carries none of it. Until then, a select another copy of what-core wrote the
// value of carries that copy's code (`_$select`, dom.js _setSelectValue): the
// options under it, or under one of its groups, changed, so it writes its
// value again. `text` 1: the text of `parent` was written.
/** @type {(parent: any, text?: 1) => void} */
let optionsChanged = (parent) => {
  if (!parent._$select) parent = parent.parentNode;
  parent?._$select?.(parent, parent._$value);
};

/** @internal */
export function _installOptionsChanged(fn) {
  optionsChanged = fn;
}
// The same, called by keyed rows of another package (what-react's mixed.js).
export { optionsChanged as _$childrenChanged };

export function insert(parent, child, marker, devName) {
  const type = typeof child;
  if (type === 'string' || type === 'number') {
    if (marker === undefined && child !== '' && parent.firstChild === null) {
      parent.textContent = child;
      return parent.firstChild;
    }
    return parent.insertBefore(document.createTextNode(String(child)), marker || null);
  }

  if (type === 'function') {
    if (child._mapArray) return child(parent, marker || null);
    // Deferred component children: realize once, no reactive wrapper.
    if (child._lazyChildren) return insert(parent, child(), marker);
    // insertReactive, written out: a frame fewer under each level of a
    // recursive component.
    effect(region(parent, child, marker, vnodeRows !== null ? getOwner() : null), __DEV__ ? { name: devName || 'children', binding: parent } : undefined);
    return;
  }

  if (child != null && type === 'object' && child.nodeType > 0) {
    return parent.insertBefore(child, marker || null);
  }

  return reconcileInsert(parent, child, null, marker || null);
}

// child() is evaluated exactly once per run, inside the effect. The first run
// decides between the text fast path (later runs write textNode.data, no
// allocation) and the general reconcile path. The effect owns what each run
// builds and disposes it before the next run, so a component or binding a run
// creates goes away with the content it belongs to.
// Compiled JSX calls it directly (`_$reactive`) for a function written in the
// hole itself, which insert() could only pass on.
function insertReactive(parent, child, marker, devName) {
  // Keyed vnode rows outlive the region's runs: they belong to the owner the
  // region is created under (see _vnodeRows).
  effect(region(parent, child, marker, vnodeRows !== null ? getOwner() : null), __DEV__ ? { name: devName || 'children', binding: parent } : undefined);
}

export { insertReactive as _$reactive };

// The function a region's effect runs. While its value is text, a run writes
// its text node when the text differs from the text the region wrote last,
// which it keeps (`text`), not from the node's: text something else wrote
// into the node stays until the value changes. Technique credit: Solid's
// insertExpression compares with the value it last inserted.
function region(parent, child, marker, scope) {
  const m = marker || null;
  /** @type {any} */
  let current = null;
  /** @type {Text | null} */
  let textNode = null;
  let text = '';
  let options = false;
  let mounted = false;
  /** @type {any} */
  let rows = null;

  return () => {
    const val = child();
    const vt = typeof val;
    if (!mounted) {
      mounted = true;
      if (vt === 'string' || vt === 'number') {
        const str = String(val);
        if (marker === undefined && str !== '' && parent.firstChild === null) {
          parent.textContent = str;
          textNode = /** @type {Text} */ (parent.firstChild);
        } else {
          textNode = parent.insertBefore(document.createTextNode(str), m);
        }
        text = str;
        textWritten(parent, str, options = inOptions(parent));
        current = textNode;
        return;
      }
    } else if (textNode !== null && (vt === 'string' || vt === 'number')) {
      const str = String(val);
      if (str !== text) textNode.data = text = str;
      textWritten(parent, str, options);
      return;
    }
    // Not text (or no longer text): this region holds content of its own.
    textNode = null;
    if (vnodeRows !== null) {
      const keyed = vnodeRows(val, rows, false, scope);
      if (keyed !== null) {
        if (current !== null) current = reconcileInsert(parent, null, current, m);
        rows = keyed;
        rows.update(parent, m, val);
        return;
      }
      if (rows !== null) {
        rows.remove();
        optionsChanged(parent);
      }
    }
    current = reconcileInsert(parent, val, current, m);
  };
}

// Text `str` as a child of `parent` before `marker`: its text node, or, with
// `marker` undefined (the element's only content) and nothing in it yet, one
// textContent write and `parent` itself: the node is then its first child,
// which is not looked up (the browser makes its object then) until someone
// needs it.
function textAt(parent, str, marker) {
  if (marker === undefined && str !== '' && parent.firstChild === null) {
    parent.textContent = str;
    return parent;
  }
  return parent.insertBefore(document.createTextNode(str), marker || null);
}

// The text node of the row field at `i`. A field that is its element's only
// content holds the element (textAt) until its node is first needed. One
// hydration claimed inside the server's merged text holds its part of it
// (claimOwnText), which answers as such an element does: its first child is
// the node it becomes.
function fieldNode(fields, i) {
  const node = fields[i];
  if (node.nodeType !== 1) return node;
  const text = node.firstChild;
  return (fields[i] = text !== null && text.nodeType === 3 ? text : node.insertBefore(document.createTextNode(''), text));
}

// --- _$plain(parent, read, marker, devName) ---
// The compiler's form of a child that is an expression with no call in it
// (`{props.title}`, `{item.price * item.qty}`): reading it twice is reading it
// once, and nothing but what it reads can change it. It is read once, as the
// first run of an effect, and what it read decides how it is kept current:
// - nothing reactive (a prop handed a plain value): its text is written and
//   nothing is kept;
// - only the item of a list row being built (a row's component handed the
//   item, `<Row item={item} />`, reading `props.item.label`): its text node is
//   a field of the row, which the row's item cell writes when the row gets
//   another item (_$field), with no effect per field;
// - anything else, or a value that is not text: the region any reactive child
//   is, its first run this one.
export function _$plain(parent, read, marker, devName) {
  _effectWhenNeeded(read, bindPlain, parent, marker, __DEV__ ? { name: devName || 'children', binding: parent } : undefined);
}

// What _effectWhenNeeded hands the first value of a plain child to.
function bindPlain(value, source, read, parent, marker, owner) {
  if (source === null) {
    const type = typeof value;
    if (value == null || type === 'boolean' || type === 'symbol') {
      if (__DEV__ && type === 'symbol') symbolChild(value);
      return null;
    }
    if (type === 'string' || type === 'number') {
      const str = String(value);
      textAt(parent, str, marker);
      textWritten(parent, str);
      return null;
    }
  } else if (rowField !== null && rowField(value, source, read, parent, marker, owner)) return null;
  return plainRegion(value, read, parent, marker, owner);
}

// --- Plain children that are fields of a list row ---
// Reached only through _$rowFields, which what-compiler writes in the options
// of a keyed list whose rows can hold such a child (a component, or a plain
// child that is more than one field of the item): a program with no such list
// carries none of this, and a plain child that reads a row's item is then the
// region any reactive child is.

/** @type {((value: any, source: any, read: () => any, parent: Node, marker: any, owner: any) => boolean) | null} */
let rowField = null;
/** @type {((cell: any) => void) | null} */
let sweepFields = null;
// Whether what `owner` holds lives exactly as long as the row whose item
// `cell` holds, for _$field: it is the row's scope, until a row can hold a
// component (the same call installs both), whose children's fields live as
// long as the row too.
/** @type {(cell: any, owner: any) => boolean} */
let fieldLives = (cell, owner) => owner === cell.building;

/**
 * @internal Let a plain child (_$plain) that reads only the item of the list
 * row being built be a field of that row. Returns true: what-compiler writes
 * the call as the value of an option of the list (`fields: _$rowFields()`).
 */
export function _$rowFields() {
  rowField = bindRowField;
  sweepFields = dropFailedFields;
  fieldLives = _livesWithRow;
  return true;
}

// A plain child whose first value came from `source`, the item of a list row,
// alone: text that belongs to something that lives exactly as long as the row
// (reactive.js _livesWithRow) is a field of the row, kept with what it
// belongs to, under which it is read again. Anything else is not: a field of
// something that goes before its row (the run of a region, an inner list's
// row, a boundary's arm) would be held, and written, until the row's next
// item. Returns whether it bound one.
function bindRowField(value, source, read, parent, marker, owner) {
  const text = fieldText(value);
  if (text === null || !_livesWithRow(source, owner)) return false;
  bindField(source, textAt(parent, text, marker), read, writePlain, _ownerRecord(owner), text);
  textWritten(parent, text);
  return true;
}

// The row whose item `cell` holds is built. Once a component has suspended
// (`failures`), one may have done so while this row was built: the fields it
// bound before it did are not in the row and belong to nothing.
function dropFailedFields(cell) {
  const fields = cell.fields;
  if (failures === 0 || fields === null) return;
  for (let i = 0; i < fields.length; i += 5) {
    const owner = fields[i + 3];
    if (owner !== null && _isDisposed(owner)) dropField(fields, i);
  }
}

// The region a plain child is when it needs an effect, its first value shown:
// the region's first run is handed the value already read, and reads from
// then on.
function plainRegion(value, read, parent, marker, owner) {
  let first = true;
  const run = region(parent, () => {
    if (!first) return read();
    first = false;
    const v = value;
    value = undefined;
    return v;
  }, marker, vnodeRows !== null ? _ownerRecord(owner) : null);
  run();
  return run;
}

// A plain child that is a row's field (bindRowField): its row has another
// item. It is read again, creating nothing (reactive.js _readAlone), and text
// from the row's item alone is written to its node. Anything else (it read
// something reactive, its value is not text, it threw) is read once more as
// it was first read, as the first run of an effect under the owner it was
// created under, which becomes the region it then needs (rebindPlain); an
// error goes where an effect's goes, and the field is read again for the
// row's next item.
function writePlain(fields, i, item, cell) {
  const read = fields[i + 1];
  const owner = fields[i + 3];
  try {
    const text = fieldText(_readAlone(read, cell));
    if (text !== null) {
      writeText(fields, i, text);
      return true;
    }
  } catch { /* thrown again below, where an effect's first run fails or is held */ }
  try {
    runWithOwner(owner, () => _effectWhenNeeded(read, rebindPlain, fields, i));
  } catch (err) {
    const left = _handleError(owner, err);
    if (left !== HANDLED) {
      try { console.error('[what] Uncaught error in effect during update:', left); } catch { /* no console */ }
    }
  }
  return true;
}

// The field's new value: text from its row's item alone is written to its
// node; anything else makes it the region it would have been, in the node's
// place, from here on.
function rebindPlain(value, source, read, fields, i, owner) {
  // Gone since the read began (a held read that landed after an upgrade).
  if (fields[i] === null) return null;
  if (source === null || source.fields === fields) {
    const text = fieldText(value);
    if (text !== null) {
      writeText(fields, i, text);
      return null;
    }
  }
  const node = fieldNode(fields, i);
  dropField(fields, i);
  const parent = node.parentNode;
  // Not in the document any more: nothing to show it in.
  if (parent === null) return null;
  const marker = node.nextSibling;
  parent.removeChild(node);
  return plainRegion(value, read, parent, marker, owner);
}

// The field at `i` is no longer its row's: it holds nothing and writes nothing.
function dropField(fields, i) {
  fields[i] = fields[i + 1] = fields[i + 3] = fields[i + 4] = null;
  fields[i + 2] = fieldGone;
}

function fieldGone() {
  return true;
}

/** @internal Whether `value` is a DOM node (or looks like one: a node of another realm). */
export function _isDomNode(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof Node !== 'undefined' && value instanceof Node) return true;
  return typeof value.nodeType === 'number' && typeof value.nodeName === 'string';
}

// Check if parent is an SVG element. Cached typeof check avoids repeated lookups.
const _hasSVGElement = typeof SVGElement !== 'undefined';
export function _isSvgParent(parent) {
  return _hasSVGElement
    && parent instanceof SVGElement
    && parent.tagName !== 'foreignObject';
}

// --- _region(fn, isSvg) ---
// A reactive region between two comment markers: <!--fn--> value <!--/fn-->.
// The effect re-reads the live parent from the end marker on every run, so the
// region survives being built in a fragment and moved into the document. Like
// insertReactive's, the effect owns what each run builds.
export function _region(fn, isSvg) {
  const startMarker = document.createComment('fn');
  const endMarker = document.createComment('/fn');
  const frag = document.createDocumentFragment();
  frag.appendChild(startMarker);
  frag.appendChild(endMarker);
  const scope = vnodeRows !== null ? getOwner() : null;
  /** @type {Node[]} */
  let current = [];
  /** @type {any} */
  let rows = null;
  if (__DEV__) setNextBinding(endMarker, fn.name || 'region');
  effect(() => {
    const val = fn();
    const host = endMarker.parentNode;
    if (host === null) return;
    if (vnodeRows !== null) {
      const keyed = vnodeRows(val, rows, isSvg, scope);
      if (keyed !== null) {
        removeRegionNodes(host, current);
        current = [];
        rows = keyed;
        rows.update(host, endMarker, val);
        return;
      }
      if (rows !== null) rows.remove();
    }
    removeRegionNodes(host, current);
    current = valuesToNodes(val, host, [], isSvg);
    for (let i = 0; i < current.length; i++) host.insertBefore(current[i], endMarker);
    optionsChanged(host);
  });
  // Everything between the markers is replaced on every run, so an OUTER
  // region that embeds this one removes the live range rather than trusting a
  // snapshot. See _liveRegionNodes.
  /** @type {any} */ (startMarker)._rangeEnd = endMarker;
  return frag;
}

// The removal set is the LIVE one: a list or a nested region inside the region
// has been replacing its own nodes since they were recorded.
function removeRegionNodes(host, current) {
  for (const old of _liveRegionNodes(current)) {
    if (old.parentNode === host) host.removeChild(old);
  }
}

// --- _listFragment(inserter) ---
// A mapArray inserter rendered as a value (a list inside a fragment root, a
// component's children, a region's value) rather than through insert(). The
// <!--list--> start marker pairs with the inserter's own <!--/list--> end
// marker, so whoever embeds the fragment can find every row the list ever
// inserts, not just the rows that existed when it was embedded.
export function _listFragment(inserter) {
  const frag = document.createDocumentFragment();
  const startMarker = document.createComment('list');
  frag.appendChild(startMarker);
  /** @type {any} */ (startMarker)._rangeEnd = inserter(frag, null);
  return frag;
}

// --- Keyed vnode rows ---
// A region whose value is an array of vnodes that all carry a key (the h() and
// JSX-runtime spelling of a keyed list, and the runtime <For>) keeps a row per
// key from one run to the next, as a compiled keyed list does: a key that
// persists keeps its row, nodes and component while its new vnode renders what
// its old one did (sameVNode), a new key builds a row, and a key that is gone
// disposes and removes its row. A key whose vnode changed (its item was
// replaced by one with other fields) gets a row built from the new vnode, in
// place. A key may repeat: its rows are claimed in order.
//
// Only a program that can make vnodes needs this, so the regions reach it
// through the vnode-renderer slot, which h.js fills with _vnodeRows. It is not
// the compiled lists' reconciler, which an h() app would otherwise carry
// whole: rows are matched by key and put back in order with the fewest
// checks, not the fewest moves.
//
// A row is the range of nodes from `first` to `last`, the stable ends of what
// its vnode rendered (an element, a component's or region's markers), built in
// a root of its own under the owner the region was created under: the region's
// runs do not own it, the owner disposes it with everything else it owns, and
// the region disposes it when its key goes. The rows sit before their own
// <!--/list--> comment, and the region drops them when its value stops being a
// keyed list.

// The rows a region renders `value` through (`rows`, or new ones), or null
// when `value` is not a keyed list. An empty array still goes through rows the
// region holds, which clears them. With `end`, the rows hydrate() adopted
// (`adopted`, before `end`).
export function _vnodeRows(value, rows, isSvg, scope, end, adopted) {
  if (end !== undefined) return createVNodeRows(isSvg, scope, end, adopted);
  if (!keyedVNodes(value)) return null;
  if (value.length === 0 && (rows === null || !rows.live())) return null;
  return rows || createVNodeRows(isSvg, scope);
}

// An array of vnodes that all carry a key (the empty array included).
function keyedVNodes(value) {
  if (!Array.isArray(value)) return false;
  for (const v of value) {
    if (!isVNode(v) || v.key == null) return false;
  }
  return true;
}

// For the duplicate-key check: a key <For> took from a primitive item is the
// item itself and may repeat, so it never counts as a duplicate.
function vnodeCheckedKey(vnode) {
  return vnode._itemKey === true ? vnode : vnode.key;
}

const VNODE_LIST = {};

function eachRowNode(row, fn) {
  for (let n = row.first; ;) {
    const next = n.nextSibling;
    fn(n);
    if (n === row.last) return;
    n = next;
  }
}

// Whether a row built from vnode `x` renders what one built from `y` would: the
// same tag, and props and children that are equal, plain objects and arrays
// compared by their contents. A function (a handler, a binding, a reactive
// child) is made again by every run of the region, so one made by the same
// code counts as the same function: a kept row keeps the functions it was
// built with, and what they closed over. The item's fields the row renders
// directly are compared, so a row whose item was replaced by one with other
// fields is built again.
function sameVNode(x, y) {
  if (Object.is(x, y)) return true;
  if (typeof x === 'function') return typeof y === 'function' && String(x) === String(y);
  if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') return false;
  const proto = Object.getPrototypeOf(x);
  if (proto !== Object.getPrototypeOf(y)) return false;
  if (isVNode(x)) return x.tag === y.tag && x.key === y.key && sameVNode(x.props || {}, y.props || {}) && sameVNode(x.children, y.children);
  if (proto !== Object.prototype && proto !== Array.prototype && proto !== null) return false;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const k of keys) if (!Object.hasOwn(y, k) || !sameVNode(x[k], y[k])) return false;
  return true;
}

// `end` and `rows` are given when the rows are adopted from server markup
// (adoptVNodeRows).
function createVNodeRows(isSvg, scope, end = document.createComment('/list'), rows = []) {
  const build = (vnode) => runWithOwner(scope, () => createRoot((dispose) => {
    const host = end.parentNode;
    const frag = document.createDocumentFragment();
    for (const n of valuesToNodes(vnode, host, [], isSvg || _isSvgParent(host))) frag.appendChild(n);
    if (frag.firstChild === null) frag.appendChild(document.createComment(''));
    return { key: vnode.key, vnode, dispose, first: frag.firstChild, last: frag.lastChild };
  }));
  const drop = (row) => {
    row.dispose();
    eachRowNode(row, (n) => { n.remove(); });
  };
  return {
    live: () => rows.length > 0,
    update(host, marker, vnodes) {
      if (end.parentNode !== host) host.insertBefore(end, marker);
      if (__DEV__) reportDuplicateKey(vnodes, vnodeCheckedKey, VNODE_LIST);
      const byKey = new Map();
      for (const row of rows) {
        const same = byKey.get(row.key);
        if (same === undefined) byKey.set(row.key, [row]);
        else same.push(row);
      }
      const stale = [];
      const next = vnodes.map((vnode) => {
        const same = byKey.get(vnode.key);
        if (same === undefined || same.length === 0) return build(vnode);
        const row = same.shift();
        if (sameVNode(row.vnode, vnode)) return row;
        stale.push(row);
        return build(vnode);
      });
      for (const same of byKey.values()) same.forEach(drop);
      stale.forEach(drop);
      // The first rows go in in document order (see reconcileNodes). A
      // kept row moves as a compiled list's row does, and one built for this
      // update goes in from its fragment (moveRow).
      if (rows.length === 0) {
        for (const row of next) moveRow(host, row.first, null, end);
      } else {
        let ref = end;
        for (let i = next.length - 1; i >= 0; i--) {
          const row = next[i];
          if (row.last.nextSibling !== ref) moveRow(host, row.first, row.last.nextSibling, ref);
          ref = row.first;
        }
      }
      rows = next;
      optionsChanged(host);
    },
    // The region's value is no longer a keyed list: drop the rows and their end.
    remove() {
      if (end.parentNode === null) return;
      rows.forEach(drop);
      rows = [];
      end.remove();
    },
  };
}

function asNodeArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

// Realize a render value as a flat list of DOM nodes (not yet inserted).
//
// A function is a reactive thunk: the compiler passes `() => x()` through
// component children and fragment roots, where there is no host element to
// insert() into, so it becomes a marked region of its own. DocumentFragments
// are flattened, because inserting a fragment empties it and a later reconcile
// must still be able to find and remove the nodes it carried.
function valuesToNodes(value, parent, out, isSvg) {
  if (value == null || typeof value === 'boolean' || typeof value === 'symbol') {
    if (__DEV__ && typeof value === 'symbol') symbolChild(value);
    return out;
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      valuesToNodes(value[i], parent, out, isSvg);
    }
    return out;
  }

  if (typeof value === 'function') {
    if (value._lazyChildren) return valuesToNodes(value(), parent, out, isSvg);
    // A list brings its own fragment (_listFragment, its `_mapArray`).
    const frag = value._mapArray ? value._mapArray(value) : _region(value, isSvg);
    for (let node = frag.firstChild; node !== null; node = node.nextSibling) out.push(node);
    return out;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    out.push(document.createTextNode(String(value)));
    return out;
  }

  if (_isDomNode(value)) {
    if (value.nodeType === 11 && value.childNodes.length > 0) {
      for (let node = value.firstChild; node !== null; node = node.nextSibling) out.push(node);
    } else {
      out.push(value);
    }
    return out;
  }

  // The renderer writes a vnode (by its brand) as DOM and any other object as
  // its text; it asks whether `parent` is an SVG element (h.js). With no
  // renderer installed no vnode producer is in the program, and a vnode
  // another copy of what-core made (a library bundled with its own) carries
  // that copy's renderer (vnode-renderer.js, `_$r`): anything else is text.
  // Development still explains a vnode that reaches a copy with neither.
  const render = vnodeRenderer !== null ? vnodeRenderer : value._$r;
  if (typeof render === 'function') return valuesToNodes(render(value, parent, isSvg, 1), parent, out, isSvg);
  if (__DEV__ && isVNode(value)) throw vnodeRuntimeMissing('A vnode');

  out.push(document.createTextNode(String(value)));
  return out;
}

export { valuesToNodes as _valuesToNodes };

function sameNodeArray(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function reconcileInsert(parent, value, current, marker) {
  const nodes = reconcileNodes(parent, value, current, marker);
  if (nodes !== current) optionsChanged(parent);
  return nodes;
}

function reconcileNodes(parent, value, current, marker) {
  // Guard: parent must be a node that supports child operations.
  // This catches cases where a stale DOM reference (e.g., a comment node from
  // shifted childNodes indices) is mistakenly passed as the parent.
  if (!parent || typeof parent.insertBefore !== 'function') {
    if (__DEV__) {
      console.warn('[what] reconcileInsert called with invalid parent:', parent);
    }
    return current;
  }

  const targetMarker = marker || null;

  // Nothing to show (null, undefined, a boolean) takes the general path below
  // with no new nodes: every live node of `current` is removed, in order.
  if ((typeof value === 'string' || typeof value === 'number')
      && current && !Array.isArray(current) && current.nodeType === 3) {
    const text = String(value);
    if (current.data !== text) current.data = text;
    optionsChanged(parent);
    return current;
  }

  // Fast path: single DOM node value with single current node — skip array allocations.
  //
  // DocumentFragments (nodeType 11) are deliberately EXCLUDED on both sides. A
  // component realizes to a fragment `[<!--c:start-->, ...content, <!--c:end-->]`;
  // inserting a fragment absorbs its children into the DOM and leaves the fragment
  // empty. If the fast path stored that emptied fragment as `current`, it would
  // lose the reference to the real inserted nodes, so the next switch away could
  // not remove them and copies would stack (the "doubled empty-state" bug). Route
  // fragments through valuesToNodes below, which flattens them to their child
  // nodes and tracks each one for correct removal on the next reconcile.
  if (typeof value === 'object' && value !== null && value.nodeType > 0
      && value.nodeType !== 11 && !Array.isArray(value)) {
    if (value === current) return current;
    if (current && !Array.isArray(current) && current.nodeType > 0 && current.nodeType !== 11) {
      // Replace single node with single node
      if (current.parentNode === parent) {
        parent.replaceChild(value, current);
      } else {
        if (targetMarker) parent.insertBefore(value, targetMarker);
        else parent.appendChild(value);
      }
      return value;
    }
  }

  const newNodes = valuesToNodes(value, parent, []);
  const oldNodes = asNodeArray(current);

  if (sameNodeArray(oldNodes, newNodes)) {
    return current;
  }

  // Remove old nodes not in the new set. For small arrays (typical case),
  // linear scan is faster than Set allocation + hashing.
  //
  // The removal set is the LIVE one: an embedded list has been editing its own
  // rows since this region recorded them, and the rows it added late are just as
  // much this region's to remove as the ones it saw at mount.
  const staleNodes = _liveRegionNodes(oldNodes);
  const newLen = newNodes.length;
  for (let i = 0; i < staleNodes.length; i++) {
    const oldNode = staleNodes[i];
    if (oldNode.parentNode !== parent) continue;
    let found = false;
    for (let j = 0; j < newLen; j++) {
      if (newNodes[j] === oldNode) { found = true; break; }
    }
    if (!found) parent.removeChild(oldNode);
  }

  // Nodes none of which is in place yet go in in document order, as a parser
  // would put them: a single select that gains options selects as it would
  // if they had been there (the first, or the last one marked selected).
  let fresh = true;
  for (let i = 0; i < newLen && fresh; i++) fresh = newNodes[i].parentNode !== parent;
  if (fresh) {
    const at = targetMarker !== null && targetMarker.parentNode === parent ? targetMarker : null;
    for (let i = 0; i < newLen; i++) parent.insertBefore(newNodes[i], at);
  } else {
    let ref = targetMarker;
    for (let i = newNodes.length - 1; i >= 0; i--) {
      const node = newNodes[i];
      if (node.parentNode !== parent || node.nextSibling !== ref) {
        // Guard against stale ref from nested reconciliation
        if (ref && ref.parentNode !== parent) ref = null;
        if (ref) parent.insertBefore(node, ref);
        else parent.appendChild(node);
      }
      ref = node;
    }
  }

  if (newNodes.length === 0) return null;
  return newNodes.length === 1 ? newNodes[0] : newNodes;
}

// --- mapArray(source, mapFn, options?) ---
// Reactive list rendering with a scope per row.
// - key + raw: mapFn receives (item, index), the raw item; rows are identified
//   by key, so a row survives its item being replaced by one with the same key,
//   and keeps what it built from the first one.
// - key, not raw: mapFn receives (itemAccessor, index, item); when a key
//   persists with a new item, the row's accessor updates in place. `item` is
//   the one the row was built from, for what it reads that cannot change while
//   the row lives: its key.
// - key + follow: mapFn receives (itemCell, index, item) and reads the cell with
//   _$item(itemCell), which bindings track. A row that read its item as a value
//   while it was built (a component's prop, a statement in its body:
//   reactive.js _rowItem) is built again from a new item instead, since what
//   it built cannot follow the cell. what-compiler lowers `.map()` with a key
//   prop to this whenever the row reads the item for more than its key.
// - no key: mapFn receives (item, index); rows are identified by the item
//   itself, so a new reference is a new row.
//
// Both kinds share one reconciler: without a key, the item is its own key. A
// key may repeat: every occurrence gets a row of its own, and from one update
// to the next the rows of a repeated key are matched in order of appearance,
// so no row is ever left behind. Repeated items are ordinary in an unkeyed
// list; a repeated key in a keyed list is a mistake, reported in development
// (ERR_DUPLICATE_KEY) with `options.loc` when the compiler supplies it.
//
// `source` is an accessor, or an array for a list that never changes (what
// `<For each={rows}>` passes for a plain value).

export function mapArray(source, mapFn, options) {
  if (typeof source !== 'function') {
    const items = source;
    source = () => items;
  }
  const keyFn = options?.key;
  return keyFn
    ? listInserter(source, mapFn, keyFn, options.raw ? RAW : options.follow ? FOLLOW : ACCESSOR, options)
    : listInserter(source, mapFn, itemKey, RAW, null);
}

// What a keyed list hands each row (`keyedSignals` below): the raw item, an
// accessor, or (`follow`) the item's cell, which compiled code reads with
// _$item, for a row that is built again from a new item when it read its item
// as a value while it was built.
const RAW = 0;
const ACCESSOR = 1;
const FOLLOW = 2;

function itemKey(item) {
  return item;
}

// --- _$mapKeyed(source, mapFn, { key, follow? }) ---
// The compiler's list for `.map()` with a key prop: keyed, raw items, or with
// `follow` the rows mapArray's follow mode builds. A module whose lists are
// all of that kind imports this instead of mapArray.
export function _$mapKeyed(source, mapFn, options) {
  return listInserter(source, mapFn, options.key, options.follow ? FOLLOW : RAW, options);
}

// `keyed` is the options object of a list with a key of its own, null for an
// unkeyed one.
//
// The list's effect belongs to the owner the list is inserted under. Its rows
// are item scopes that outlive the runs of that effect, so they are not owned
// by it: the reconciler disposes a row when its key goes, and the cleanup
// registered here disposes the rest with the list's owner.
function listInserter(source, mapFn, keyFn, keyedSignals, keyed) {
  if (__DEV__) source = checkedSource(source, keyFn, keyed);
  const inserter = (parent, marker) => {
    let items = [];
    const mappedNodes = [];
    const disposeFns = [];

    const endMarker = document.createComment('/list');
    parent.insertBefore(endMarker, marker || null);

    if (__DEV__) setNextBinding(endMarker, keyed?.loc ? `list@${keyed.loc}` : 'list');
    effect(() => {
      const newItems = source() || [];
      // Resolve the LIVE parent from the end marker each run: a list built into
      // a fragment (`<>{items().map(...)}</>`) moves with that fragment, and the
      // captured `parent` goes stale.
      const host = endMarker.parentNode || parent;
      reconcileKeyed(host, endMarker, items, newItems, mappedNodes, disposeFns, mapFn, keyFn, keyedSignals);
      optionsChanged(host);
      // Snapshot for the next diff, defended against in-place mutation.
      items = newItems.length > 0 ? newItems.slice() : newItems;
    });
    onCleanup(() => {
      disposeRows(disposeFns, disposeFns.length);
      mappedNodes.length = 0;
      disposeFns.length = 0;
    });
    return endMarker;
  };
  // The mark of a list inserter, and what renders one as a value: a program
  // without a list does not carry _listFragment, which only a list reaches.
  inserter._mapArray = _listFragment;
  // The server has no DOM to insert into, so it renders the rows from the
  // inserter's inputs instead (_mapArrayToArray), in the same order and with
  // the same item protocol the client uses; hydrate() adopts the rows it
  // rendered (adoptList). The inserter itself comes fifth: a copy of these
  // properties on another inserter is not this list. Last is the number
  // what-compiler gave the list (hydration-data.js _enterRow).
  inserter._list = [source, mapFn, keyFn, keyedSignals, inserter, keyed?.slot];
  return inserter;
}

// Development: a keyed list's source, checked for duplicate keys on every read.
// An unkeyed list may repeat its items, so its source is left as it is.
function checkedSource(source, keyFn, keyed) {
  if (keyed === null) return source;
  const read = () => {
    const items = source();
    if (items) reportDuplicateKey(items, keyFn, keyed);
    return items;
  };
  read._listLoc = keyed.loc;
  return read;
}

// A keyed list whose items repeat a key. Every row is still rendered and none
// is lost, but rows with the same key are told apart only by their order, so a
// reorder can hand one row's DOM and state to another item. The report names
// the scope it is made in: the list's effect, under its component.
function reportDuplicateKey(items, keyFn, keyed) {
  if (items.length < 2) return;
  const seen = new Set();
  for (let i = 0; i < items.length; i++) {
    const key = keyFn(items[i], i);
    if (seen.size === seen.add(key).size) {
      report('ERR_DUPLICATE_KEY', {
        data: { key: describeKey(key) },
        loc: keyed.loc || null,
      });
      return;
    }
  }
}

// A key that is a signal or a computed is described by its value, read
// untracked so the check subscribes the list to nothing: coercing the accessor
// would print its source text.
function describeKey(key) {
  const value = typeof key === 'function' && key._signal ? untrack(key) : key;
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * Render a mapArray inserter's rows without a DOM. Server-side only.
 *
 * Mirrors the item protocol reconcileKeyed uses, because a row built here is
 * hydrated by one built there: keyed mode hands the mapFn an ACCESSOR (so
 * `item()` works), follow mode the item's cell, raw mode the raw item.
 * Getting this wrong produces server HTML that differs from the client's on
 * every row.
 */
export function _mapArrayToArray(inserter) {
  const [source, mapFn, keyFn, keyed, , slot] = inserter._list;
  const items = source() || [];
  const rows = items.map((item, index) => {
    if (keyed === RAW) return mapFn(item, index, item);
    const cell = _rowItem(item);
    cell.building = false;
    return mapFn(keyed === FOLLOW ? cell : () => _readRowItem(cell), index, item);
  });
  // A keyed list's keys, which the server writes with its rows (what-server
  // rowKeys) for hydrate() to adopt each row by its key.
  if (keyFn !== itemKey) {
    rows._keys = items.map(keyFn);
    rows._slot = slot;
  }
  return rows;
}

// --- Rows ---
//
// A row is built by buildKeyedRow inside its own item scope, and `disposeFns[i]` is
// that scope's dispose function. In keyed-signal mode it also carries `_item`,
// the signal behind the row's item accessor. Disposing the scope disposes
// everything the row built (bindings, components, nested lists, regions and
// what they render), so removing a row never walks its DOM.
//
// `mappedNodes[i]` is the row's first node. A row that renders one element or
// text node is that node; any other row is a <!--i--> comment followed by its
// nodes. Every row start carries `_$row` set to its list's end marker, which is
// how a scan finds where one row ends and the next begins without mistaking a
// nested list's rows, or a user comment, for a boundary.

// The row whose item `cell` holds is built.
function rowBuilt(cell) {
  cell.building = false;
  if (sweepFields !== null) sweepFields(cell);
}

// A row is normally one node already. Anything else (a string, an array, a
// thunk) is realized here, while the row's scope is still current.
function rowNode(value) {
  if (value != null && value.nodeType > 0) return value;
  const nodes = valuesToNodes(value, null, []);
  if (nodes.length === 1) return nodes[0];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < nodes.length; i++) frag.appendChild(nodes[i]);
  return frag;
}

// Build a row and return what to insert: the row's own node, or a fragment
// holding its <!--i--> start comment and its nodes.
function buildKeyedRow(endMarker, item, idx, keyedSignals, mapFn, mappedArr, disposeArr) {
  if (keyedSignals === RAW) return markRow(_runScope(_itemScope(undefined, disposeArr, idx), mapFn, item, idx, item, rowNode), endMarker, idx, mappedArr);
  const cell = _rowItem(item);
  const node = _runScope(_itemScope(cell, disposeArr, idx), mapFn, keyedSignals === FOLLOW ? cell : () => _readRowItem(cell), idx, item, rowNode);
  rowBuilt(cell);
  disposeArr[idx]._item = cell;
  return markRow(node, endMarker, idx, mappedArr);
}

// The row's first node goes in `mappedArr[idx]`; returns what to insert.
function markRow(node, endMarker, idx, mappedArr) {
  if (node.nodeType === 1 || node.nodeType === 3) {
    node._$row = endMarker;
    mappedArr[idx] = node;
    return node;
  }
  const start = document.createComment('i');
  /** @type {any} */ (start)._$row = endMarker;
  const frag = document.createDocumentFragment();
  frag.appendChild(start);
  frag.appendChild(node);
  mappedArr[idx] = start;
  return frag;
}

// The node after a row's last node (the next row's start, or endMarker).
function rowEnd(start, endMarker) {
  if (start.nodeType !== 8) return start.nextSibling;
  let n = start.nextSibling;
  while (n !== null && n !== endMarker && n._$row !== endMarker) n = n.nextSibling;
  return n;
}

// moveBefore (Chromium, Firefox) moves a node without taking it out, so a
// field being edited in the row keeps the focus and its caret; insertBefore
// blurs it (and Chromium fires blur, which a form validating on blur reads
// as the visitor leaving the field). Only for a row in the document: a
// detached one holds no focus, and the first browsers to ship moveBefore
// threw for a parent outside it, as moveBefore does for a node outside it (a
// row just built, in its fragment).
function moveRow(parent, start, end, ref) {
  const move = (start.isConnected && parent.moveBefore) || parent.insertBefore;
  let n = start;
  while (n !== null && n !== end) {
    const next = n.nextSibling;
    move.call(parent, n, ref);
    n = next;
  }
}

function removeRow(parent, start, end) {
  let n = start;
  while (n !== null && n !== end) {
    const next = n.nextSibling;
    parent.removeChild(n);
    n = next;
  }
}

function disposeRows(disposeFns, len) {
  for (let i = 0; i < len; i++) {
    const dispose = disposeFns[i];
    if (dispose !== undefined) dispose();
  }
}

// Remove every row of a list at once: dispose the rows, then drop their nodes
// with a single DOM operation. When the list is all its parent holds, that is
// one textContent write; otherwise a Range over the rows.
// Technique credit: dom-expressions / Solid's list clearing (MIT, Ryan Carniato).
function clearRows(parent, endMarker, mappedNodes, disposeFns, len) {
  disposeRows(disposeFns, len);
  const first = mappedNodes[0];
  if (parent.firstChild === first && parent.lastChild === endMarker) {
    parent.textContent = '';
    parent.appendChild(endMarker);
  } else {
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndBefore(endMarker);
    range.deleteContents();
  }
}

// Longest Increasing Subsequence — returns indices into the input array.
// O(n log n) using patience sorting. Uses typed arrays for performance.
function _lis(arr, len) {
  if (len === 0) return [];
  if (len === 1) return [0];

  const tails = new Int32Array(len); // indices into arr
  const predecessors = new Int32Array(len);
  let tailLen = 1;
  tails[0] = 0;
  predecessors[0] = -1;

  for (let i = 1; i < len; i++) {
    if (arr[i] > arr[tails[tailLen - 1]]) {
      predecessors[i] = tails[tailLen - 1];
      tails[tailLen++] = i;
    } else {
      let lo = 0, hi = tailLen - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[tails[mid]] < arr[i]) lo = mid + 1;
        else hi = mid;
      }
      tails[lo] = i;
      predecessors[i] = lo > 0 ? tails[lo - 1] : -1;
    }
  }

  const result = new Array(tailLen);
  let k = tails[tailLen - 1];
  for (let i = tailLen - 1; i >= 0; i--) {
    result[i] = k;
    k = predecessors[k];
  }
  return result;
}

// Keyed-signal mode: hand the row in `slot` the item at `index` now. Its
// bindings follow it; in follow mode, a row that took its item as a value
// while it was built (_rowItem) is built again from the new one, in its
// place. A row whose item did not change is left alone.
function renewItem(parent, endMarker, slot, index, item, mapFn, mappedNodes, disposeFns, follow) {
  if (!_setRowItem(disposeFns[slot]._item, item, follow)) return;
  const old = mappedNodes[slot];
  const oldDispose = disposeFns[slot];
  const cell = _rowItem(item);
  const node = _runScope(_itemScope(cell, disposeFns, slot), mapFn, cell, index, item, rowNode);
  rowBuilt(cell);
  disposeFns[slot]._item = cell;
  parent.insertBefore(markRow(node, endMarker, slot, mappedNodes), old);
  removeKeyedRow(parent, endMarker, old, oldDispose);
}


// --- reconcileKeyed ---
// Reconciliation by key: a row is kept, and moved if needed, for as long as its
// key is in the list. In keyed-signal mode, a kept row whose item reference
// changed gets the new item through its accessor, with no DOM rebuilt; only
// the effects reading the accessor re-run.

function reconcileKeyed(parent, endMarker, oldItems, newItems, mappedNodes, disposeFns, mapFn, keyFn, keyedSignals) {
  const newLen = newItems.length;
  const oldLen = oldItems.length;

  // --- Fast path: clear all ---
  if (newLen === 0) {
    if (oldLen > 0) {
      clearRows(parent, endMarker, mappedNodes, disposeFns, oldLen);
      mappedNodes.length = 0;
      disposeFns.length = 0;
    }
    return;
  }

  // --- Fast path: all new --- (rows go straight into the live parent)
  if (oldLen === 0) {
    for (let i = 0; i < newLen; i++) {
      parent.insertBefore(buildKeyedRow(endMarker, newItems[i], i, keyedSignals, mapFn, mappedNodes, disposeFns), endMarker);
    }
    return;
  }
  reconcileRows(parent, endMarker, oldItems, newItems, mappedNodes, disposeFns, mapFn, keyFn, keyedSignals);
}

// reconcileKeyed for a list that had rows and has rows. Kept out of it, so
// that the frame a row built into an empty list stands on is small: a
// recursive keyed tree holds one at each level, and this one has dozens of
// locals.
function reconcileRows(parent, endMarker, oldItems, newItems, mappedNodes, disposeFns, mapFn, keyFn, keyedSignals) {
  const newLen = newItems.length;
  const oldLen = oldItems.length;

  // The key of the item at `i`. A key function is handed the item's index:
  // a key that reads it (`key={`${t.term}-${i}`}`) keys the row by item and
  // position, as React does.
  const oldKey = (i) => keyFn(oldItems[i], i);
  const newKey = (i) => keyFn(newItems[i], i);

  // --- Common prefix: skip matching keys at the start ---
  let start = 0;
  const minLen = Math.min(oldLen, newLen);
  while (start < minLen) {
    if (oldItems[start] !== newItems[start]) {
      if (oldKey(start) !== newKey(start)) break;
      if (keyedSignals) renewItem(parent, endMarker, start, start, newItems[start], mapFn, mappedNodes, disposeFns, keyedSignals === FOLLOW);
    }
    start++;
  }

  // --- Common suffix: skip matching keys at the end ---
  let oldEnd = oldLen - 1;
  let newEnd = newLen - 1;
  // A key that reads the index (`key={`${t.term}-${i}`}`, `(item, i) => …`)
  // is the position's too: an item that moved is not its row.
  const moved = keyFn.length > 1 && oldEnd !== newEnd;
  while (oldEnd >= start && newEnd >= start) {
    if (moved || oldItems[oldEnd] !== newItems[newEnd]) {
      if (oldKey(oldEnd) !== newKey(newEnd)) break;
      if (keyedSignals) renewItem(parent, endMarker, oldEnd, newEnd, newItems[newEnd], mapFn, mappedNodes, disposeFns, keyedSignals === FOLLOW);
    }
    oldEnd--;
    newEnd--;
  }

  if (start > oldEnd && start > newEnd) return;

  const midNewLen = newEnd - start + 1;
  const midOldLen = oldEnd - start + 1;

  // --- Only removals in middle, or a window that slid --- The rows after
  // the removed ones move up, in place. A capped log (a chat, a log tail)
  // drops rows at the start as items arrive at the end, with nothing after
  // them: the rows that stay hold the same items in the same order, so the
  // dropped rows are removed the same way and the added items built after
  // the rest, with no map of keys and no positioning walk. Not when an added
  // item is a dropped one (it moved), or a dropped row's key is in the new
  // range (the general path keeps that row for it).
  let drop = midNewLen ? 0 : midOldLen;
  if (!drop && newEnd === newLen - 1 && keyFn.length < 2) {
    let p = start;
    while (++p <= oldEnd && oldItems[p] !== newItems[start]);
    const added = start + oldEnd - p + 1;
    let i = p;
    while (i <= oldEnd && oldItems[i] === newItems[start + i - p]) i++;
    if (p <= oldEnd && i > oldEnd && added <= newEnd) {
      for (i = start; i < p && oldItems[i] !== newItems[added]; i++);
      if (i === p) {
        const dropped = new Set();
        for (i = start; i < p; i++) dropped.add(oldKey(i));
        for (i = start; i <= newEnd && !dropped.has(newKey(i)); i++);
        if (i > newEnd) drop = p - start;
      }
    }
  }
  if (drop) {
    for (let i = start; i < start + drop; i++) {
      removeKeyedRow(parent, endMarker, mappedNodes[i], disposeFns[i]);
    }
    mappedNodes.splice(start, drop);
    disposeFns.splice(start, drop);
    for (let i = start + midOldLen - drop; i <= newEnd; i++) {
      parent.insertBefore(buildKeyedRow(endMarker, newItems[i], i, keyedSignals, mapFn, mappedNodes, disposeFns), endMarker);
    }
    return;
  }

  // --- Fast paths for common small-move cases ---
  // Detect swap (2 mismatches) or single-move (contiguous shift) cheaply
  // before falling through to the expensive LIS + backward-walk general case.
  // Count positions where keys differ. The same item has the same key, so
  // only a position whose item changed reads keys; one whose key stayed is
  // an item replaced under its key (`replaced`).
  const small = midNewLen === midOldLen && midNewLen >= 2;
  let mismatchCount = 0;
  let mm1 = -1, mm2 = -1; // first two mismatch indices (relative to start)
  let replaced = false;
  if (small) {
    for (let i = 0; i < midNewLen && mismatchCount <= 4; i++) {
      const oldItem = oldItems[start + i];
      const newItem = newItems[start + i];
      if (oldItem === newItem) continue;
      if (oldKey(start + i) !== newKey(start + i)) {
        if (mismatchCount === 0) mm1 = i;
        else if (mismatchCount === 1) mm2 = i;
        mismatchCount++;
      } else {
        replaced = true;
      }
    }
  }

  // --- Fast path A: Pure swap (exactly 2 key mismatches, keys exchanged) ---
  // The two rows trade places, in the DOM and in place in the row arrays.
  if (mismatchCount === 2) {
    const i1 = start + mm1, i2 = start + mm2;
    if (oldKey(i1) === newKey(i2) && oldKey(i2) === newKey(i1)) {
      // DOM moves: swap the two items' DOM ranges. Adjacent rows need one
      // move. For non-adjacent rows a placeholder remembers where the later
      // row was, and the earlier row's end is recomputed after the first move.
      const lo = Math.min(i1, i2), hi = Math.max(i1, i2);
      if (hi === lo + 1) {
        moveRow(parent, mappedNodes[hi], rowEnd(mappedNodes[hi], endMarker), mappedNodes[lo]);
      } else {
        const end2 = rowEnd(mappedNodes[i2], endMarker);
        const placeholder = document.createComment('tmp');
        parent.insertBefore(placeholder, mappedNodes[i2]);
        moveRow(parent, mappedNodes[i2], end2, mappedNodes[i1]);
        moveRow(parent, mappedNodes[i1], rowEnd(mappedNodes[i1], endMarker), placeholder);
        parent.removeChild(placeholder);
      }

      const tmpM = mappedNodes[i1]; mappedNodes[i1] = mappedNodes[i2]; mappedNodes[i2] = tmpM;
      const tmpD = disposeFns[i1]; disposeFns[i1] = disposeFns[i2]; disposeFns[i2] = tmpD;
      // The scan covered the whole range (two mismatches never stop it), so
      // the rows between the pair have new items only if it saw one.
      if (keyedSignals && (replaced || newItems[i1] !== oldItems[i2] || newItems[i2] !== oldItems[i1])) {
        for (let i = start; i <= newEnd; i++) {
          if (newItems[i] !== oldItems[i === i1 ? i2 : i === i2 ? i1 : i]) {
            renewItem(parent, endMarker, i, i, newItems[i], mapFn, mappedNodes, disposeFns, keyedSignals === FOLLOW);
          }
        }
      }
      return;
    }
  }

  const newMapped = new Array(newLen);
  const newDispose = new Array(newLen);
  for (let i = 0; i < start; i++) {
    newMapped[i] = mappedNodes[i];
    newDispose[i] = disposeFns[i];
  }
  for (let i = newEnd + 1; i < newLen; i++) {
    const oldI = oldEnd + 1 + (i - newEnd - 1);
    newMapped[i] = mappedNodes[oldI];
    newDispose[i] = disposeFns[oldI];
  }

  // --- Only additions in middle ---
  if (midOldLen === 0) {
    const ref = newEnd + 1 < newLen && newMapped[newEnd + 1] ? newMapped[newEnd + 1] : endMarker;
    for (let i = start; i <= newEnd; i++) {
      parent.insertBefore(buildKeyedRow(endMarker, newItems[i], i, keyedSignals, mapFn, newMapped, newDispose), ref);
    }
    _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen);
    return;
  }

  if (small) {
    // --- Fast path B: Single item relocated ---
    // One item removed from position `from` and inserted at position `to`,
    // everything between shifted by one.
    if (mismatchCount >= 2 && mismatchCount <= midNewLen) {
      // Forward move: old[from] = new[to], old[from+1..to] = new[from..to-1]
      // Backward move: old[from] = new[to], old[to..from-1] = new[to+1..from]
      const fromRel = mm1; // first mismatch - the moved item was here in old OR went here in new
      let fromAbs = -1, toAbs = -1;
      let isMove = false;

      // Check forward move: item at old[start+fromRel] moved later
      const candidateKey = oldKey(start + fromRel);
      let destRel = -1;
      for (let i = fromRel; i < midNewLen; i++) {
        if (newKey(start + i) === candidateKey) { destRel = i; break; }
      }
      if (destRel > fromRel) {
        let match = true;
        for (let i = fromRel; i < destRel; i++) {
          if (oldKey(start + i + 1) !== newKey(start + i)) { match = false; break; }
        }
        if (match) {
          let afterMatch = true;
          for (let i = destRel + 1; i < midNewLen; i++) {
            if (oldKey(start + i) !== newKey(start + i)) { afterMatch = false; break; }
          }
          if (afterMatch) {
            isMove = true;
            fromAbs = start + fromRel;
            toAbs = start + destRel;
          }
        }
      }

      if (!isMove) {
        // Check backward move: item from later in old moved to start+fromRel in new
        const candidateKey2 = newKey(start + fromRel);
        let srcRel = -1;
        for (let i = fromRel; i < midOldLen; i++) {
          if (oldKey(start + i) === candidateKey2) { srcRel = i; break; }
        }
        if (srcRel > fromRel) {
          let match = true;
          for (let i = fromRel; i < srcRel; i++) {
            if (oldKey(start + i) !== newKey(start + i + 1)) { match = false; break; }
          }
          if (match) {
            let afterMatch = true;
            for (let i = srcRel + 1; i < midNewLen; i++) {
              if (oldKey(start + i) !== newKey(start + i)) { afterMatch = false; break; }
            }
            if (afterMatch) {
              isMove = true;
              fromAbs = start + srcRel;
              toAbs = start + fromRel;
            }
          }
        }
      }

      if (isMove) {
        for (let i = start; i <= oldEnd; i++) {
          newMapped[i] = mappedNodes[i];
          newDispose[i] = disposeFns[i];
        }

        // Shift entries in newMapped/newDispose to reflect the move
        const movedStart = newMapped[fromAbs];
        const movedDispose = newDispose[fromAbs];
        if (fromAbs < toAbs) {
          for (let i = fromAbs; i < toAbs; i++) {
            newMapped[i] = newMapped[i + 1];
            newDispose[i] = newDispose[i + 1];
          }
        } else {
          for (let i = fromAbs; i > toAbs; i--) {
            newMapped[i] = newMapped[i - 1];
            newDispose[i] = newDispose[i - 1];
          }
        }
        newMapped[toAbs] = movedStart;
        newDispose[toAbs] = movedDispose;

        // Single DOM move: the moved row goes before the row that now follows it.
        const movedEnd = rowEnd(movedStart, endMarker);
        let ref = toAbs + 1 < newLen ? newMapped[toAbs + 1] : endMarker;
        if (toAbs >= newEnd + 1 || (ref && ref.parentNode !== parent)) ref = endMarker;
        moveRow(parent, movedStart, movedEnd, ref);

        _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen);
        if (keyedSignals) {
          // Where the row now at i was: the moved row came from fromAbs, the
          // rows it passed shifted by one toward it.
          const lo = Math.min(fromAbs, toAbs), hi = Math.max(fromAbs, toAbs), shift = fromAbs < toAbs ? 1 : -1;
          for (let i = start; i <= newEnd; i++) {
            const was = i === toAbs ? fromAbs : i >= lo && i <= hi ? i + shift : i;
            if (newItems[i] !== oldItems[was]) {
              renewItem(parent, endMarker, i, i, newItems[i], mapFn, mappedNodes, disposeFns, keyedSignals === FOLLOW);
            }
          }
        }
        return;
      }
    }
  }

  // --- General case: reconcile middle section ---
  // Old rows by key. A key that repeats in the old range leaves the map short
  // of the range; then each occurrence is chained to the next one with the same
  // key, and new items claim them in order.
  const oldKeyMap = new Map();
  for (let i = start; i <= oldEnd; i++) oldKeyMap.set(oldKey(i), i);
  /** @type {Int32Array | null} */
  let nextSameKey = null;
  if (oldKeyMap.size !== midOldLen) {
    nextSameKey = new Int32Array(midOldLen).fill(-1);
    oldKeyMap.clear();
    for (let i = oldEnd; i >= start; i--) {
      const key = oldKey(i);
      const later = oldKeyMap.get(key);
      if (later !== undefined) nextSameKey[i - start] = later;
      oldKeyMap.set(key, i);
    }
  }

  const oldIndices = new Int32Array(midNewLen);
  oldIndices.fill(-1);
  let reusedCount = 0;

  for (let i = start; i <= newEnd; i++) {
    const key = newKey(i);
    const oldIdx = oldKeyMap.get(key);
    if (oldIdx === undefined) continue;
    const next = nextSameKey === null ? -1 : nextSameKey[oldIdx - start];
    if (next === -1) oldKeyMap.delete(key);
    else oldKeyMap.set(key, next);
    newMapped[i] = mappedNodes[oldIdx];
    newDispose[i] = disposeFns[oldIdx];
    oldIndices[i - start] = oldIdx;
    reusedCount++;
    if (keyedSignals && newItems[i] !== oldItems[oldIdx]) renewItem(parent, endMarker, i, i, newItems[i], mapFn, newMapped, newDispose, keyedSignals === FOLLOW);
  }

  // --- Replace all: no row survives, so clear in one operation and rebuild ---
  if (reusedCount === 0 && start === 0 && oldEnd === oldLen - 1 && newEnd === newLen - 1) {
    clearRows(parent, endMarker, mappedNodes, disposeFns, oldLen);
    mappedNodes.length = 0;
    disposeFns.length = 0;
    for (let i = 0; i < newLen; i++) {
      parent.insertBefore(buildKeyedRow(endMarker, newItems[i], i, keyedSignals, mapFn, mappedNodes, disposeFns), endMarker);
    }
    return;
  }

  // Remove the rows no new item claimed: every index left in the map, and the
  // occurrences chained behind it.
  for (const oldIdx of oldKeyMap.values()) {
    for (let i = oldIdx; i !== -1; i = nextSameKey === null ? -1 : nextSameKey[i - start]) {
      removeKeyedRow(parent, endMarker, mappedNodes[i], disposeFns[i]);
    }
  }

  // Create new items detached; they are positioned in the pass below.
  const created = new Array(midNewLen);
  for (let i = start; i <= newEnd; i++) {
    if (!newMapped[i]) {
      created[i - start] = buildKeyedRow(endMarker, newItems[i], i, keyedSignals, mapFn, newMapped, newDispose);
    }
  }

  // Position using LIS
  let alreadySorted = true;
  let lastOldIdx = -1;
  for (let i = 0; i < midNewLen; i++) {
    if (oldIndices[i] !== -1) {
      if (oldIndices[i] <= lastOldIdx) alreadySorted = false;
      lastOldIdx = oldIndices[i];
    }
  }

  const inLIS = new Uint8Array(midNewLen);

  if (alreadySorted) {
    for (let i = 0; i < midNewLen; i++) {
      if (oldIndices[i] !== -1) inLIS[i] = 1;
    }
  } else if (reusedCount > 1) {
    const seq = new Int32Array(reusedCount);
    const seqToMid = new Int32Array(reusedCount);
    let k = 0;
    for (let i = 0; i < midNewLen; i++) {
      if (oldIndices[i] !== -1) {
        seq[k] = oldIndices[i];
        seqToMid[k] = i;
        k++;
      }
    }
    const lisResult = _lis(seq, reusedCount);
    for (let i = 0; i < lisResult.length; i++) {
      inLIS[seqToMid[lisResult[i]]] = 1;
    }
  } else if (reusedCount === 1) {
    for (let i = 0; i < midNewLen; i++) {
      if (oldIndices[i] !== -1) { inLIS[i] = 1; break; }
    }
  }

  // Position: work backwards, moving rows not in the LIS and inserting new ones.
  _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen);

  // Start ref at the first suffix row (not endMarker) so moved rows land before
  // the suffix, not after it.
  let ref = newEnd + 1 < newLen && mappedNodes[newEnd + 1]
    ? mappedNodes[newEnd + 1] : endMarker;
  for (let i = newEnd; i >= start; i--) {
    const mi = i - start;
    const rowStart = mappedNodes[i];
    if (oldIndices[mi] === -1) {
      parent.insertBefore(created[mi], ref);
    } else if (!inLIS[mi]) {
      moveRow(parent, rowStart, rowEnd(rowStart, endMarker), ref);
    }
    ref = rowStart;
  }
}

function removeKeyedRow(parent, endMarker, start, dispose) {
  if (dispose !== undefined) dispose();
  // The row's end is read from the live DOM: an adjacent removal earlier in the
  // same pass can already have detached the next row's start.
  removeRow(parent, start, rowEnd(start, endMarker));
}

function _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen) {
  mappedNodes.length = newLen;
  disposeFns.length = newLen;
  for (let i = 0; i < newLen; i++) {
    mappedNodes[i] = newMapped[i];
    disposeFns[i] = newDispose[i];
  }
}

// --- spread(el, props) ---
// Fine-grained prop effects. Function props create individual effects.
// Event props use direct assignment.

function spread(el, props, after, options) {
  // A props object What built (forwarded props, a rest element) may hold live
  // props (dom.js _isLiveProp): each is bound like a reactive attribute,
  // reading the getter again when what it read changes.
  const live = props != null && _isOwnProps(props);
  // Own keys only, as React spreads props: a key written onto Object.prototype
  // is no prop. A key named `__proto__` is never written (setProp).
  const keys = Object.keys(Object(props));
  // An event is one whatever the case of its name (`onClick`, `onclick`):
  // the last name the props hold for it is its handler (`last`, by each
  // key's name: an event's in lower case).
  const last = {};
  for (const key of keys) last[_isEventProp(key) ? key.toLowerCase() : key] = key;
  for (const key of keys) {
    const event = _isEventProp(key);
    const name = event ? key.toLowerCase() : key;
    // Children are never an attribute: compiled JSX places a spread's
    // children in an element that has none of its own (common.js
    // spreadChildren), as React renders `<a {...props} />`.
    // A key an attribute written after the spread sets is that attribute's
    // (`<a {...rest} href="/x" />`, compiled JSX's `after`, an event's name
    // in lower case), as in React.
    if (key === 'children' || after?.includes(name) || last[name] !== key) continue;
    // A getter is bound as an accessor of it: a live prop, and a prop handed
    // on to the component that spreads it (`<Tag href={rest.href} />`, a lazy
    // slot that forwards the live prop: dom.js readLazy reads it again).
    const get = live && key !== 'ref' && /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(props, key)).get;
    const value = get ? () => props[key] : props[key];

    // A field's value or checked that follows state is bound as an attribute
    // of the field binds it, so the field shows it after its events.
    if (fieldSpread && typeof value === 'function' && (key === 'value' || key === 'checked')) fieldSpread(el, key, value);
    // An event handler: a listener the current owner removes. A live one
    // (`onClick={open() ? close : show}` handed through a rest) is the
    // current handler, bound again when the parent hands another, as React
    // calls the handler of its last render.
    else if (event) {
      if (get) effect(() => listen(el, name, value(), options));
      else listen(el, name, value, options);
    }
    // Anything else is written as setProp writes a prop: a ref is handed the
    // element (a function ref is a callback, never an accessor: a
    // `{...register('email')}` ref once saw undefined), a classList its
    // classes, and any other function is an accessor bound as a binding of
    // its own, owned like every binding. An input's type and a select's
    // multiple write the field's value again when they change it (retype).
    else retype(el, key, value);
  }
}

/**
 * @internal setProp() for a spread's props, and for an input's `type` and a
 * select's `multiple` as compiled JSX writes them. Those two decide what the
 * field's value can be (`date` drops `abc`, `text` keeps it; one option or
 * several), so a write that changes one writes the value and checked the
 * field's props hold again, as React writes them after its type, whether a
 * new writer, an accessor's next value or a writer's removal changed it. A
 * field the user edited and no prop controls keeps the edit. What changed is
 * read from the element's `type`, which a select's multiple changes too
 * (`select-one`, `select-multiple`), so a name in any case is one (`TYPE`,
 * which an HTML element folds; on an SVG element it is an attribute of its
 * own, which changes no `type`). An accessor is bound here, so each of its
 * values is compared, except where setProp takes a function as it is (a ref's
 * callback, a classList's, a key).
 */
function retype(el, key, value) {
  if (typeof value === 'function' && key !== 'ref' && key !== 'key' && key !== 'classList') {
    if (__DEV__) setNextBinding(el, `${el.localName}.${key}`);
    return effect(() => retype(el, key, value()));
  }
  const was = el.type;
  setProp(el, key, value);
  if (el.type !== was) _showControlled(el);
}
export { retype as _$retype };

/**
 * Compiled JSX's spreads with other writers (`<button {...rest} {...{ title:
 * 'last', onClick: b }} />`, `<a title={t} {...rest} />`, `{...attrs()}`):
 * `sources` are the spreads and the attributes between them in source order,
 * an array, or a function that gives one, read again when what it read
 * changes, as React renders an object spread again with its new keys. Each
 * name has one writer, the last source that holds it, in the place the first
 * one put it; a name is one whatever its spelling (writerName). A name the
 * sources no longer hold is removed. Only what-compiler's output for such an
 * element imports it: an element with one plain spread calls _$spread.
 */
export function _$spreads(el, sources, after) {
  if (typeof sources !== 'function') return spread(el, winners(sources, el), after);
  // Read again: each name's writer is bound under a scope of its own, the
  // element's owner's, so a run rebinds only the names whose writer changed
  // (a getter of a props object What built that stays, which its binding
  // follows; the same plain value, each read once a run), and unbinds and
  // clears a name no source holds. A field's value and checked are bound
  // last, once its other props (`type`, `multiple`, `max`) are written; a
  // later change of its type or multiple writes them again (retype).
  const owner = getOwner();
  /** @type {Map<string, { key: string, src: any, get: any, value: any, field: any, dispose: () => void }>} */
  const shown = new Map();
  // The names the attributes after the spreads write, as the sources' names
  // are compared (`tabIndex` after `{...{ tabindex }}` on an HTML element).
  after = after?.map((key) => writerName(key, el));
  const bind = (name, src, key) => {
    const get = _isOwnProps(src) ? /** @type {PropertyDescriptor} */ (Object.getOwnPropertyDescriptor(src, key)).get : undefined;
    const value = get ? undefined : src[key];
    const was = shown.get(name);
    if (was !== undefined) {
      if (get ? was.get === get && was.src === src : !was.get && was.key === key && Object.is(was.value, value)) return;
      // A field's plain value or checked is state the spread holds: a new
      // plain value is written to it, and the field, bound to it, shows it
      // again after its events (render.js fieldSpread), as a binding that
      // read state does. A writer of another kind is bound anew.
      if (was.field !== null && !get && was.key === key && typeof value !== 'function') {
        was.field(was.value = value);
        return;
      }
      was.dispose();
    }
    // A function (a signal, an accessor) is bound as it is, as `value={v}`.
    const field = !get && (key === 'value' || key === 'checked') && typeof value !== 'function' ? signal(value) : null;
    const dispose = untrack(() => runWithOwner(owner, () => createRoot((dispose) => {
      const one = Object.create(null);
      // A getter is called on its own source, as reading `src[key]` would
      // (one that reads `this.label`).
      if (get) Object.defineProperty(one, key, { get: () => get.call(src), enumerable: true });
      else if (field !== null) Object.defineProperty(one, key, { get: field, enumerable: true });
      else one[key] = value;
      spread(el, one);
      // A ref is let go of when its writer changes and when the element goes.
      if (key === 'ref') {
        const ref = get ? one.ref : value;
        onCleanup(() => applyRef(ref, null));
      }
      return dispose;
    })));
    shown.set(name, { key, src, get, value, field, dispose });
  };
  effect(() => {
    const next = writers(sources(), el);
    for (const [name, was] of shown) {
      if (next.has(name)) continue;
      was.dispose();
      shown.delete(name);
      // The one writer of the markup is dangerouslySetInnerHTML's.
      if (!_isEventProp(name)) retype(el, name === 'innerhtml' ? 'dangerouslySetInnerHTML' : was.key, undefined);
    }
    for (const [name, [src, key]] of next) {
      if (name !== 'children' && name !== 'value' && name !== 'checked' && !after?.includes(name)) bind(name, src, key);
    }
    for (const name of ['value', 'checked']) {
      const w = next.get(name);
      if (w !== undefined && !after?.includes(name)) bind(name, w[0], w[1]);
    }
  });
}

// The last writer of each name among `sources`, as one props object (getters
// of a props object What built kept: render.js _$merge).
function winners(sources, el) {
  const out = Object.create(null);
  for (const [src, key] of writers(sources, el).values()) _copyProp(out, src, key, _isOwnProps(src));
  return out;
}

// Each name's last writer among `sources`: [source, key], in the order the
// names first appear.
function writers(sources, el) {
  /** @type {Map<string, [any, string]>} */
  const names = new Map();
  for (let src of sources) {
    src = Object(src);
    for (const key of Object.keys(src)) names.set(writerName(key, el), [src, key]);
  }
  return names;
}

// The name a key writes on `el`, as the element reads it. An event's is in
// lower case (`onClick` and `onclick` are one listener), and so is an
// attribute's on an HTML element, which folds their case (`tabIndex` and
// `tabindex` are one); SVG's are not (`viewBox` and `viewbox` are two).
// React's names for one property are made one on every element: `class` for
// `className`, `for` for `htmlFor`, `innerhtml` for `dangerouslySetInnerHTML`,
// and an XLink or XML name is the attribute the namespace writer (_$xlink)
// writes for it: `xlink:href` for `xlinkHref` and `xlink:Href`, `xml:lang` for
// `xmlLang` and `xml:Lang`.
function writerName(key, el) {
  const name = key.toLowerCase();
  const html = el.namespaceURI === NAMESPACES[0];
  const xml = XML_NAME.exec(html ? name : key);
  return xml ? xml[1] + ':' + xml[2].toLowerCase()
    : name === 'classname' ? 'class' : name === 'htmlfor' ? 'for' : name === 'dangerouslysetinnerhtml' ? 'innerhtml'
    : html || _isEventProp(key) ? name : key;
}

// An XLink or XML attribute's name (`xlinkHref`, `xlink:href`, `xmlLang`), as
// a prefix and a local name; `xmlns` is neither.
const XML_NAME = /^(xlink|xml(?!ns)):?(.+)/;

// `name`: an event prop's name in lower case (`onclick`). onDoubleClick is
// React's name for `dblclick`, and onChange is React's change event (dom.js
// _onChange): it hears a text field's `input` too.
// `options`: compiled JSX's for an onChange with modifiers (`onChange__once`).
function listen(el, name, handler, options) {
  if (typeof handler !== 'function') return;
  name = name.slice(2);
  if (name === 'doubleclick') name = 'dblclick';
  if (name === 'change') {
    const change = handler;
    on(el, 'input', handler = (e) => _onChange(e, change), options);
  }
  on(el, name, handler, options);
}

/** @type {((el: Element, key: string, value: any) => boolean) | null} */
let xlink = null;

/**
 * @internal Install the writer of SVG's XLink and XML attributes
 * (`xlinkHref`, `xlink:href`, `xmlLang`, `xml:lang`), in their namespace as
 * React writes them: compiled JSX calls it at module scope where an SVG
 * element has such an attribute or a spread, so an app with neither carries
 * none of it.
 */
export function _$xlink() {
  xlink = (el, key, value) => {
    const name = XML_NAME.exec(key);
    if (name === null) return false;
    const [, prefix, local] = name;
    const ns = prefix === 'xml' ? 'http://www.w3.org/XML/1998/namespace' : 'http://www.w3.org/1999/xlink';
    if (value == null || value === false) el.removeAttributeNS(ns, local.toLowerCase());
    else el.setAttributeNS(ns, prefix + ':' + local.toLowerCase(), value);
    return true;
  };
}

// NOTE: this is the fine-grained-compiler path's setProp. A second
// implementation lives in dom.js (h()/diff path). See the longer note above
// the dom.js version. Key differences vs. dom.js setProp:
//   - assumes events are handled by the compiler (delegation or direct
//     addEventListener) — no el._events bookkeeping here.
//   - sanitizes URL attributes (href/src) against javascript: protocol.
//   - enforces innerHTML must be { __html: ... } — plain strings are warned.
function setProp(el, key, value) {
  // Ref handling — assign element to ref object/callback (defense in depth)
  if (key === 'ref') {
    applyRef(value, el);
    return;
  }

  // `key` identifies a list row and is never an attribute (defense in depth),
  // `__proto__` would set the element's prototype, and an event is the
  // compiler's (delegation, addEventListener).
  if (key === 'key' || key === '__proto__' || _isEventProp(key)) return;

  // A function classList, or an object with function entries, is reactive in
  // setClassList itself.
  if (key === 'classList') {
    setClassList(el, value);
    return;
  }

  // Reactive accessor: function values on non-event props are treated as
  // reactive getters. Wrap in an effect so the prop auto-updates.
  if (typeof value === 'function') {
    if (__DEV__) setNextBinding(el, `${el.localName}.${key}`);
    effect(() => setProp(el, key, value()));
    return;
  }

  // Sanitize URL attributes: reject dangerous protocols and srcdoc. A refused
  // value leaves no attribute, not even one an earlier write set.
  if (_isUnsafeAttr(key, value)) {
    el.removeAttribute(key);
    if (typeof console !== 'undefined') {
      console.warn(`[what] Blocked unsafe URL in "${key}" attribute:`, value);
    }
    return;
  }

  const isSvg = _hasSVGElement && el instanceof SVGElement;

  // An XLink or XML attribute (`xlinkHref`, `xlink:href`, `xmlLang`) in its
  // namespace, once a module whose JSX may write one installed the writer
  // (_$xlink).
  if (isSvg && xlink?.(el, key, value)) return;

  if (key === 'class' || key === 'className') {
    _writeClass(el, value, isSvg);
  } else if (key === 'dangerouslySetInnerHTML' || key === 'innerHTML') {
    // innerHTML takes { __html } only: a string is refused, { __html } marks
    // markup someone trusted.
    if (key === 'dangerouslySetInnerHTML' || (value && typeof value === 'object' && '__html' in value)) {
      const html = value?.__html ?? '';
      if (typeof __DEV__ !== 'undefined' && __DEV__ && typeof html === 'string' && /(<script|onerror\s*=|onload\s*=|javascript:)/i.test(html)) {
        console.warn('[what] dangerouslySetInnerHTML contains potential XSS vectors. Ensure content is sanitized.');
      }
      el.innerHTML = html;
    } else if (__DEV__ && value != null && value !== '') {
      report('ERR_UNSAFE_INNERHTML', { subject: { kind: 'element', name: el.localName } });
    }
  } else if (key === 'style') {
    setStyle(el, value);
  } else if (_setFieldProp(el, key, value)) {
    // A form field's state, before the nullish and boolean branches (dom.js
    // Form fields).
  } else if (value == null) {
    // null / undefined — attribute must be ABSENT (React/Solid semantics), not
    // stringified to "undefined"/"null". Caught before the data-*/aria-*, SVG
    // and property-reflected branches. Reflected props (e.g. el.title) are reset
    // first so removeAttribute() clears both the attribute and the property.
    if (_writableProp(el, key)) {
      try { el[key] = ''; } catch { /* a property '' does not fit (files) */ }
    }
    el.removeAttribute(key);
  } else if (isEnumeratedAttr(key)) {
    el.setAttribute(key, value);
  } else if (typeof value === 'boolean') {
    if (value) el.setAttribute(key, '');
    else el.removeAttribute(key);
  } else if (isSvg) {
    el.setAttribute(key, value);
  } else if (_writableProp(el, key)) {
    el[key] = value;
  } else {
    el.setAttribute(key, value);
  }
}

// --- Specialized attribute setters ---
// The compiler statically knows most attribute names, so it emits direct calls
// to these monomorphic helpers instead of routing everything through the
// generic setProp() dispatcher (which re-checks ref/key/url/class/style/...
// string-compares on every reactive update). setProp() remains the target for
// spreads, URL attributes (href/src/action — sanitization lives there) and any
// name the compiler can't classify.
//
// Function values are reactive ACCESSORS (e.g. `value={() => user().name}`),
// exactly like setProp treats them: wrap in an effect that re-applies the
// resolved value.

// The write is a binding's, which the last argument tells setValue and
// setChecked (the other setters take two).
function _wrapPropAccessor(el, accessor, apply) {
  if (__DEV__) setNextBinding(el, `${el.localName}.${apply.name}`);
  effect(() => apply(el, accessor(), 1));
}

// class / className — hottest dynamic attribute in real apps. The compiler emits
// className() for elements it knows are HTML (or MathML), which skips the SVG
// check; setClass() is for SVG elements and anything it cannot place.
export function className(el, value) {
  if (typeof value === 'function') return _wrapPropAccessor(el, value, className);
  _writeClass(el, value, false);
}

export function setClass(el, value) {
  if (typeof value === 'function') return _wrapPropAccessor(el, value, setClass);
  _writeClass(el, value, _hasSVGElement && el instanceof SVGElement);
}

// --- class and classList ---
// `class` (or `className`) sets the class attribute and `classList` toggles
// classes over it, composed in prop order exactly as the server folds them into
// one attribute: a classList after class toggles over what class writes, then
// and on every later write of that class; a class after classList replaces the
// attribute, then and on every later write, and the classList no longer shows.
//
// `el._cl` is the classList's state, from the classList's first write: `on`,
// each key's resolved truthiness; `base`, the attribute as class last wrote it
// (or as it stood when the classList arrived), which a key that leaves the
// object falls back to; `overClass`, whether the element had a class attribute
// when the classList arrived, which a class prop before it always leaves (an
// empty one included), so that its later writes are toggled over; `replaced`,
// set once a class prop that came after the classList has written. A class
// write on an element without a classList touches nothing else.
//
// A class of null, undefined or false writes no attribute, as the server
// writes none; `el._cl` is then null until a classList arrives, which composes
// over an empty attribute, as the server folds the two. With a classList the
// attribute is empty, as the server folds it. Any other value is written as
// its text, as the server writes it.

// Every class write on every path goes through here.
export function _writeClass(el, value, svg) {
  const cl = el._cl;
  if (value == null || value === false) {
    if (cl == null) {
      el.removeAttribute('class');
      el._cl = null;
      return;
    }
    value = '';
  }
  const cls = String(value);
  if (svg) el.setAttribute('class', cls);
  else el.className = cls;
  if (cl == null) return;
  cl.base = cls;
  if (!cl.overClass) {
    cl.replaced = true;
    return;
  }
  const list = el.classList;
  for (const key in cl.on) toggleClasses(list, key, cl.on[key]);
}

// classList={{ active: isActive(), done: () => done() }}: each key is toggled
// by the truthiness of its value, and a key may name several space-separated
// classes. A function classList, or a function entry, is a reactive accessor:
// one effect re-applies the object whenever what it reads changes. A key an
// earlier object had and this one lacks falls back to the class attribute.
// A classList of null or undefined on an element without one is none, as the
// server folds none.
export function setClassList(el, value) {
  if (typeof value === 'function') return _wrapPropAccessor(el, value, applyClassList);
  if (value == null) {
    if (el._cl != null) applyClassList(el, value);
    return;
  }
  if (hasAccessorEntry(value)) return _wrapPropAccessor(el, () => value, applyClassList);
  applyClassList(el, value);
}

function hasAccessorEntry(value) {
  for (const key in value) {
    if (typeof value[key] === 'function') return true;
  }
  return false;
}

function applyClassList(el, value) {
  let cl = el._cl;
  if (cl == null) {
    if (cl === null) el.setAttribute('class', '');
    const base = el.getAttribute('class');
    el._cl = cl = { on: null, base, overClass: base !== null, replaced: false };
  }
  const prev = cl.on;
  /** @type {Record<string, boolean>} */
  const next = {};
  if (value != null) {
    for (const key in value) {
      const on = value[key];
      next[key] = !!(typeof on === 'function' ? on() : on);
    }
  }
  cl.on = next;
  if (cl.replaced) return;
  const list = el.classList;
  if (prev !== null) {
    for (const key in prev) {
      if (!(key in next)) restoreClasses(list, key, cl.base);
    }
  }
  for (const key in next) toggleClasses(list, key, next[key]);
}

function toggleClasses(list, key, on) {
  if (!/\s/.test(key)) {
    if (key) list.toggle(key, on);
    return;
  }
  for (const name of key.split(/\s+/)) {
    if (name) list.toggle(name, on);
  }
}

// A key gone from the classList: each of its classes goes back to whether the
// class attribute has it.
function restoreClasses(list, key, base) {
  const tokens = base ? base.split(/[\t\n\f\r ]+/) : [];
  for (const name of key.split(/\s+/)) {
    if (name) list.toggle(name, tokens.includes(name));
  }
}

// ref={...}: a callback is called with the element, a ref object gets
// `.current`. Anything else is left to the caller: an unassigned `let el`, or
// one that still holds the element of an earlier render, which is a node and
// not a ref object. The return value is what the compiler assigns back to a
// `let`/`var` ref.
export function applyRef(ref, el) {
  if (typeof ref === 'function') ref(el);
  else if (ref !== null && typeof ref === 'object' && ref.nodeType === undefined) ref.current = el;
  else return el;
  return ref;
}

// style: a string is the element's whole inline style (cssText), and so is
// an object, written property by property: the first object replaces what
// the element had (a string's declarations, the server's), a later one
// clears the properties the previous one set and it does not. Anything else
// (null, undefined, false) clears the inline style. Every path writes it
// here: h() and runtime setProp (dom.js), compiled JSX, spreads, hydration.
// A custom property (`--accent`), like a dashed name, is not a property of
// the CSSOM object: it is set and removed by name, as React does.
export function setStyle(el, value) {
  if (typeof value === 'function') return _wrapPropAccessor(el, value, setStyle);
  const prev = el._lastStyleObj;
  if (value !== null && typeof value === 'object') {
    const style = el.style;
    if (prev != null) {
      for (const prop in prev) if (!(prop in value)) writeStyle(style, prop, '');
    } else if (el.hasAttribute('style')) {
      el.removeAttribute('style');
    }
    for (const prop in value) writeStyle(style, prop, value[prop] ?? '');
    el._lastStyleObj = { ...value };
    return;
  }
  el._lastStyleObj = null;
  if (typeof value === 'string') el.style.cssText = value;
  else if (el.hasAttribute('style')) el.removeAttribute('style');
}

function writeStyle(style, prop, value) {
  if (prop[0] === '-') style.setProperty(prop, value);
  else style[prop] = value;
}

// Plain attribute set — used for data-*/aria-* (statically recognizable).
// null/undefined removes the attribute rather than writing "null"/"undefined".
// Booleans are stringified ("true"/"false") because aria-* boolean strings are
// meaningful.
export function setAttr(el, name, value) {
  if (typeof value === 'function') {
    return _wrapPropAccessor(el, value, (e2, v) => setAttr(e2, name, v));
  }
  if (value == null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

// value and checked — a form field's state (dom.js Form fields): a property
// write that a default never moves, null releasing the field. On an element
// whose value is an attribute (an <option>, a checkbox's value), setProp.
// `bound`: 1 when the write is a binding's (the compiler's, in the effect it
// wraps an expression that can read state in; an accessor's, which
// _wrapPropAccessor applies). A field a binding that read state controls
// shows what the binding holds after each of its events (dom.js
// _controlFields).
function setValue(el, value, bound) {
  if (typeof value === 'function') return _wrapPropAccessor(el, value, setValue);
  if (bound === 1) _controlFields(el);
  if (!_setFieldProp(el, 'value', value)) setProp(el, 'value', value);
}

export function setChecked(el, value, bound) {
  if (typeof value === 'function') return _wrapPropAccessor(el, value, setChecked);
  if (bound === 1) _controlFields(el);
  if (!_setFieldProp(el, 'checked', value)) setProp(el, 'checked', value);
}

// spread(), setProp() and setValue() as code written by hand calls them: one
// given a <select> or an <option> brings the code that keeps their selection
// (dom.js _installSelects). Compiled JSX imports them without it (`_$spread`,
// `_$setProp`, `_$setValue`) and installs it from a module whose JSX has a
// select or an option (`_$selects()`), so an app that makes none carries none.
function handSpread(el, props) {
  _selectsFor(el);
  spread(el, props);
}

function handSetProp(el, key, value) {
  _selectsFor(el);
  setProp(el, key, value);
}

function handSetValue(el, value, bound) {
  _selectsFor(el);
  setValue(el, value, bound);
}

export { handSpread as spread, handSetProp as setProp, handSetValue as setValue, spread as _$spread, setProp as _$setProp, setValue as _$setValue };
export { _installSelects as _$selects } from './dom.js';

// What spread() hands a value or checked that follows state (a live prop, an
// accessor) to, once a spread on a field exists: the binding an attribute of
// the field would be.
/** @type {((el: Element, key: string, accessor: () => any) => void) | null} */
let fieldSpread = null;

/** @internal Compiler output: `el`, an <input>, <textarea> or <select> whose props a spread sets (`_$spread(_$controlled(el), props)`). */
export function _$controlled(el) {
  fieldSpread = (field, key, accessor) => (key === 'value' ? setValue : setChecked)(field, accessor);
  return el;
}

// --- delegateEvents(eventNames, root?) ---
// One native listener per event type on `root` (the document by default; a
// shadow root or an element works too); each element keeps its handler as
// `el.$$click`, `el.$$input` and so on. Calling this again for an event the
// root already delegates is a no-op, so the compiler can call it lazily from
// every module that needs it.
//
// A handler belongs to the owner it was set under (_$own: the component, list
// row or root that built or claimed the element): once that owner is disposed
// it never runs again, and goes the first time an event reaches it, also on an
// element that outlived its owner (a node the next hydrate() of the same
// container claims, one the app keeps and inserts again).
//
// The listener walks the event's propagation path, innermost node first, and
// calls each handler it finds until one stops propagation:
//   - The path is composedPath(), so handlers inside open shadow trees run.
//     e.target reads as the native target does at each handler's node: inside
//     a shadow tree it is the node the event came from, and leaving the shadow
//     tree that node lives in retargets it to that tree's host. A light-DOM
//     node slotted into a shadow tree is not inside it, so passing through
//     that tree does not retarget it.
//   - A handler on a disabled element is skipped, as a native listener would be.
//   - The walk runs up to and including `root`, and starts above any other
//     root on the path that delegates the same event (a shadow root or an
//     element delegating for its own subtree): that root's own listener has
//     already run those handlers.
//   - e.currentTarget reads as the element whose handler is running. Both
//     properties are handed back afterwards, also when a handler throws.
//   - A stop ends the walk when a handler made it: one made before the walk
//     began (onInput's, before onChange's walk) leaves it.
//   - `$$change` is the DOM's change event, and onChange, React's change
//     event, once a module of compiled JSX that binds one installs it
//     (_$changes): a text field's `input` then reaches the `$$change`
//     handlers on its path too, after the `$$input` ones, as React dispatches
//     onInput and then onChange.
// Technique credit: dom-expressions' delegated eventHandler (MIT, Ryan Carniato).

const delegatedRoots = new WeakMap();

export function delegateEvents(eventNames, root = document) {
  let names = delegatedRoots.get(root);
  if (names === undefined) delegatedRoots.set(root, (names = new Set()));
  for (const name of eventNames) {
    if (names.has(name)) continue;
    names.add(name);
    root.addEventListener(name, dispatchDelegated);
  }
}

/**
 * @internal Compiler output, from a module that binds onChange: the `$$change`
 * handlers under `root` are React's change event (dom.js _onChange), which a
 * text field's `input` events reach, after the `$$input` handlers, as well as
 * its `change`.
 */
export function _$changes(root = document) {
  delegateEvents(['input'], root);
  const names = /** @type {Set<string>} */ (delegatedRoots.get(root));
  if (names.has('onchange')) return;
  names.add('onchange').add('change');
  root.removeEventListener('change', dispatchDelegated);
  root.addEventListener('input', dispatchChange);
  root.addEventListener('change', dispatchChange);
}

/** @this {EventTarget} */
function dispatchChange(e) {
  dispatchDelegated.call(this, e, '$$change', _onChange);
}

/**
 * @this {EventTarget}
 * @param {any} e
 * @param {string} [key] the handlers' property: `$$` and the name delegated
 * @param {(e: any, handler: Function) => void} [call] what calls each handler (dispatchChange: dom.js _onChange)
 */
function dispatchDelegated(e, key = '$$' + e.type, call) {
  const root = this;
  const name = key.slice(2);
  const path = e.composedPath();
  let first = 0;
  let last = 0;
  for (; last < path.length && path[last] !== root; last++) {
    const names = delegatedRoots.get(path[last]);
    if (names !== undefined && names.has(name)) first = last + 1;
  }
  let node = null;
  Object.defineProperty(e, 'currentTarget', {
    configurable: true,
    get() { return node || root; },
  });
  let target = path[0];
  let retargeted = false;
  const stopped = e.cancelBubble;
  try {
    for (let i = 0; i <= last && i < path.length; i++) {
      const n = path[i];
      if (n.nodeType === 11 && n.host) {
        // Leaving a shadow tree: a target inside it now reads as its host.
        if (target.getRootNode() === n) target = n.host;
        continue;
      }
      if (i < first) continue;
      const handler = n[key];
      if (typeof handler !== 'function' || n.disabled === true) continue;
      const owner = n.$$owner;
      if (owner != null && _isDisposed(owner)) {
        n[key] = undefined;
        continue;
      }
      node = n;
      if (target !== e.target) {
        Object.defineProperty(e, 'target', { configurable: true, value: target });
        retargeted = true;
      }
      if (call) call(e, handler);
      else handler(e);
      if (e.cancelBubble && !stopped) break;
    }
  } finally {
    // Hand the native properties back to later listeners.
    delete e.currentTarget;
    if (retargeted) delete e.target;
  }
}

/** Mark `el`'s delegated handlers as the current owner's (compiler output). */
export function _$own(el) {
  el.$$owner = getOwner();
}

// --- addEventListener helper for non-delegated events ---
// The listener goes with the current owner, and the returned function removes
// it sooner. `event` is the DOM's: `on(el, 'change', fn)` hears the native
// change event, which a text field fires when the user commits an edit (on
// blur or Enter), where the onChange prop is React's (dom.js _onChange).
export function on(el, event, handler, options) {
  el.addEventListener(event, handler, options);
  const off = () => el.removeEventListener(event, handler, options);
  onCleanup(off);
  return off;
}

// --- classList(el, classes): setClassList for hand-written code ---
export function classList(el, classes) {
  setClassList(el, classes);
}

// =========================================================================
// Hydration
// =========================================================================
// hydrate() adopts the DOM a server rendered from the same tree instead of
// building it again. One walk serves every producer: h() and JSX-runtime
// vnodes, compiled JSX built for hydration (what-compiler's `hydratable`
// option: a template claims the node the walk stands on instead of cloning
// one, see _$claim), and trees that mix the two. The server's half of the
// protocol is what-server's (compiled.js):
//
//   data-hk="PATH"        a component's owner path (hydration-data.js), on the
//                         first element of its output: checked, then removed
//   <!--$-->…<!--/$-->    a reactive child; the region keeps both markers
//   <!--[]-->…<!--/[]-->  an array; a keyed list keeps the closing marker as
//                         its end
//   <!--b-->…<!--/b-->    a boundary showing its children, <!--b!--> one
//                         showing its fallback; <template id="pl-ID"> right
//                         after the opening marker: one still streaming
//
// The markers make adoption exact and free of new nodes. Markup without them
// (renderToString, a page written by hand) is adopted by position: the
// client's own values say how much of the server's DOM each part takes, and a
// region makes the markers it needs. Text the HTML parser merged (a static run
// next to a plain value) is read across, never split: a value in it that can
// change keeps its part of the server's node until it first does
// (claimOwnText).
//
// Where the server's DOM is not what the client renders, the walk reports one
// ERR_HYDRATION_MISMATCH per region in development (kind, owner path, DOM
// path, expected, found), calls options.onHydrationError in every build, and
// client-renders the smallest part it can: the element, the text, the nodes
// left over, the content of a region. Nothing the server wrote outlives the
// walk unless the client renders it too: a claimed element keeps only the
// attributes its template or vnode has (the bindings then write the dynamic
// ones through the client's sanitizing setters), its text is the client's
// text, and raw inner HTML is the client's value.

const REGION_OPEN = '$';
const REGION_CLOSE = '/$';
const ARRAY_OPEN = '[]';
const ARRAY_CLOSE = '/[]';
const BOUNDARY_OPEN = 'b';
const BOUNDARY_FALLBACK = 'b!';
const BOUNDARY_CLOSE = '/b';

// Region and array markers belong to whichever value wants them: a region or
// a list consumes its own, and every other claim steps over them, so a value
// the server rendered from a reactive child is adopted the same way whether
// the client's is reactive or not.
const TRANSPARENT = new Set([REGION_OPEN, REGION_CLOSE, ARRAY_OPEN, ARRAY_CLOSE]);

// So is a keyed list's keys comment (inServerOrder), where a client that renders
// no keyed list there meets it.
function transparent(data) {
  return TRANSPARENT.has(data) || isRowKeys(data);
}

// The comment after a keyed list's opening marker (what-server rowKeys): its
// render's salt and its rows' key digests, or `k!` when a key was one
// hydrate() cannot compare.
function isRowKeys(data) {
  return data.startsWith('k:') || data === 'k!';
}

// The digits a digest and a salt are written in: none of them is '-' or '>',
// so no run of them ends a comment.
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_.';
// The length of a digest (and of a salt): 64 bits, six to a digit.
const DIGEST_LENGTH = 11;

/**
 * A keyed list's row key as the server writes it (what-server rowKeys) and
 * hydrate() compares it: a 64-bit HalfSipHash-2-4 of the render's `salt`, the
 * key's type and its value, in DIGEST_LENGTH digits, so the page does not
 * carry the key. The salt is random for each render and written beside the
 * digests: no digest can be computed before the page exists, two keys of one
 * list collide by accident with odds of 2^-64, and making one key's digest
 * equal another's under a page's salt takes a preimage of a 64-bit hash. A
 * key with little entropy (a small integer id) can still be confirmed by
 * guessing, page by page. Strings and finite numbers only: null for any other
 * key.
 */
export function _rowKeyDigest(key, salt) {
  if (typeof key !== 'string' && !(typeof key === 'number' && Number.isFinite(key))) return null;
  SIP.set(SIP_START);
  sipWords(salt + (typeof key === 'string' ? 's' : 'n') + key, 0, true);
  return digits(sipHi, sipLo);
}

// HalfSipHash-2-4 with a zero key and a 64-bit output, a word being two UTF-16
// code units, its state in SIP. sipWords absorbs the words of `text`, `lead`
// code units after the start; with `finish`, also the last word (the whole
// length and the odd unit) and the finalization, leaving the digest's two
// halves in sipHi and sipLo. A state saved after words every key of a list
// shares (the salt and the key's type) is where each key's digest goes on from
// (_rowKeysInOrder), as what-server's rowKeys (compiled.js) does on its side.
const SIP_START = /* @__PURE__ */ new Int32Array([0, 0xee, 0x6c796765, 0x74656462]);
const SIP = /* @__PURE__ */ new Int32Array(4);
let sipHi = 0;
let sipLo = 0;

function sipRounds(n) {
  let v0 = SIP[0], v1 = SIP[1], v2 = SIP[2], v3 = SIP[3];
  for (let r = 0; r < n; r++) {
    v0 = (v0 + v1) | 0; v1 = (v1 << 5) | (v1 >>> 27); v1 ^= v0; v0 = (v0 << 16) | (v0 >>> 16);
    v2 = (v2 + v3) | 0; v3 = (v3 << 8) | (v3 >>> 24); v3 ^= v2;
    v0 = (v0 + v3) | 0; v3 = (v3 << 7) | (v3 >>> 25); v3 ^= v0;
    v2 = (v2 + v1) | 0; v1 = (v1 << 13) | (v1 >>> 19); v1 ^= v2; v2 = (v2 << 16) | (v2 >>> 16);
  }
  SIP[0] = v0; SIP[1] = v1; SIP[2] = v2; SIP[3] = v3;
}

function sipWord(m) {
  SIP[3] ^= m;
  sipRounds(2);
  SIP[0] ^= m;
}

function sipWords(text, lead, finish) {
  const length = text.length;
  const end = length & ~1;
  for (let i = 0; i < end; i += 2) sipWord(text.charCodeAt(i) | (text.charCodeAt(i + 1) << 16));
  if (!finish) return;
  sipWord(((lead + length) << 16) | (end < length ? text.charCodeAt(end) : 0));
  SIP[2] ^= 0xee;
  sipRounds(4);
  sipHi = SIP[1] ^ SIP[3];
  SIP[1] ^= 0xdd;
  sipRounds(4);
  sipLo = SIP[1] ^ SIP[3];
}

// The state after the words of `text` (of even length), from the start.
function sipPrefix(text) {
  SIP.set(SIP_START);
  sipWords(text, 0, false);
  return SIP.slice();
}

/**
 * @internal Whether `written` (a keyed list's digests, as the server writes
 * them after its salt) is, in order, the digest of each of `keys` under
 * `salt`, with no two of them equal: what inServerOrder needs to adopt the
 * server's rows as the client's in its order, read without making a string
 * for any digest. False leaves the question to the comparison of each digest.
 */
export function _rowKeysInOrder(keys, salt, written) {
  const count = keys.length;
  if (salt.length !== DIGEST_LENGTH || written.length !== count * DIGEST_LENGTH) return false;
  const lead = DIGEST_LENGTH + 1;
  /** @type {Int32Array | null} */
  let strings = null;
  /** @type {Int32Array | null} */
  let numbers = null;
  // The digests' high halves seen so far: two equal ones (two keys of one
  // digest, or the same key twice) leave the list to the full comparison.
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    const key = keys[i];
    let state;
    if (typeof key === 'string') state = strings ??= sipPrefix(salt + 's');
    else if (typeof key === 'number' && Number.isFinite(key)) state = numbers ??= sipPrefix(salt + 'n');
    else return false;
    SIP.set(state);
    sipWords('' + key, lead, true);
    const at = i * DIGEST_LENGTH;
    if (!digitsOf(written, at, sipHi >>> 8, 4) || !digitsOf(written, at + 4, ((sipHi & 0xff) << 16) | (sipLo >>> 16), 4)
      || !digitsOf(written, at + 8, sipLo & 0xffff, 3) || seen.has(sipHi)) return false;
    seen.add(sipHi);
  }
  return true;
}

// Whether `text` holds at `at` the `count` digits of `n`, as digits() writes them.
function digitsOf(text, at, n, count) {
  for (let i = count - 1; i >= 0; i--, n >>>= 6) if (text.charCodeAt(at + i) !== DIGITS.charCodeAt(n & 63)) return false;
  return true;
}

/**
 * @internal A render's salt for its keyed lists' digests (what-server
 * rowKeys): 64 random bits, in the digits of a digest.
 */
export function _rowKeySalt() {
  const [hi, lo] = crypto.getRandomValues(new Uint32Array(2));
  return digits(hi, lo);
}

// 64 bits, `hi` and `lo`, in DIGEST_LENGTH digits.
function digits(hi, lo) {
  const put = (n, count) => {
    let out = '';
    for (let i = 0; i < count; i++, n >>>= 6) out = DIGITS[n & 63] + out;
    return out;
  };
  return put(hi >>> 8, 4) + put(((hi & 0xff) << 16) | (lo >>> 16), 4) + put(lo & 0xffff, 3);
}

// The walk's position: the parent (p), the next node to claim (n, null at the
// parent's end), how far a text claim has read into it (o), whether the
// server's text at it begins with a value's that differed from the client's
// (x: true, see replaceText) or may begin with the server's value for an
// empty one (x: 1, see adoptRegion), where the region it walks ends (e: its
// closing marker, or null for the parent's end),
// whether it claims server DOM (h) or steps through a client clone, and, in
// compiled template code, the template node it stands on (t).
/** @type {any} */
let cur = null;
/** @type {any[]} */
const outer = [];
// One hydrate() call: its container, the onHydrationError hook, the regions
// already reported (one report each), what was built before the walk could
// claim it (_$outside), the compiled arrays whose members were adopted as they
// were built (_$members), the <Suspense> records whose children are being
// adopted (once a component under one suspends, its walk is dropped, and what
// the walk finds out of place is not reported), the counter of its root-level
// components (hydration-data.js), and whether the walk has matched the
// server's structure so far (`ordered`). A boundary that resumes later walks
// in a session of its own with the same container, hook and counter.
/** @type {any} */
let session = null;

function newSession(container, onError, ownerRoot) {
  _setOutsideRead(_$outside);
  return {
    root: container,
    onError,
    reported: new WeakSet(),
    prebuilt: new WeakSet(),
    built: new WeakSet(),
    warned: false,
    lenient: false,
    dropping: [],
    ownerRoot,
    ordered: true,
    // The fields the user changed before the walk claimed them, and what
    // runs once it is done (dom.js: What the user changed before hydration).
    fields: [],
    radios: new WeakSet(),
    after: [],
  };
}

// The walk `walk` is done: what waited for it runs, then the fields the user
// changed show what they showed. Called inside the walk's batch, so that the
// mount callbacks and effects the walk queued, which run when the batch ends,
// read every field as the user left it.
function walkDone(walk) {
  for (const fn of walk.after) fn();
  if (walk.fields.length > 0) /** @type {Function} */ (restoreFields)(walk.fields);
}

// What the user changed before hydration is kept for the form controls a walk
// claims, before the claim or the props write anything: compiled JSX claims
// one with _$control (_$claimControl for a template's root), and a vnode's
// element claim keeps one (adoptVNode). (dom.js: What the user changed
// before hydration.)
/** @type {((fields: any[]) => void) | null} */
let restoreFields = null;

/** The server's form control `el`, which the walking hydration claims: what the user changed in it stays. */
function _keepControl(el) {
  restoreFields = _restoreFields;
  _changedFields(el, session.fields, session.radios);
}

// The server's element at the cursor, when it is the form control about to be claimed.
function keepControlAt(c) {
  const n = next(c);
  if (n !== null && n.nodeType === 1) _keepControl(n);
}

/** _$next for a form control (what the user changed in it stays). */
export function _$control(k, flags) {
  const c = cur;
  if (c !== null && c.h) {
    while (k-- > 0) stepStatic(c);
    k = 0;
    keepControlAt(c);
  }
  return _$next(k, flags);
}

/** _$claim for a template whose root is a form control. */
export function _$claimControl(tmpl, flags) {
  if (cur !== null && cur.h) keepControlAt(cur);
  return _$claim(tmpl, flags);
}
// The owner path of the component whose output has not written its first node
// yet: the server put it on that node if it is an element.
/** @type {string | null} */
let pendingKey = null;
// A client build inside a hydration (a recovery, a boundary arm, JSX built
// before it is placed): compiled code clones rather than claims.
const CLIENT = { h: false };

export function isHydrating() {
  return cur !== null && cur.h;
}

/**
 * @internal Run `fn` when the hydration walking now is done; false when none
 * is. A client build inside the walk waits for it too: what it builds may
 * take a claimed node's place (placeBuilt), whose user changes are shown
 * once the walk is done.
 */
export function _afterWalk(fn) {
  if (cur === null || session === null) return false;
  session.after.push(fn);
  return true;
}

/**
 * @internal While hydrating: the nodes the server bracketed at the cursor
 * (`<!--[]-->`…`<!--/[]-->`, or a region's `<!--$-->`…`<!--/$-->`), taken
 * whole for a renderer of its own: what-react's islands, whose HTML the
 * server rendered with React's rules and always brackets. They stay where
 * they are, and the walk continues after the closing marker. A keyed row
 * starts past its opening marker (adoptListRows steps over it to find the
 * row's first node), so the marker just before the cursor counts as well.
 * Returns [open, close], or null when there is no bracket there (or nothing
 * is hydrating).
 */
export function _claimRegion() {
  const c = cur;
  if (c === null || !c.h) return null;
  pendingKey = null;
  let open = nextOwn(c);
  if (!isBracket(open)) {
    const before = c.o > 0 || c.x ? null : anchorOf(c);
    open = isBracket(before) ? before : null;
  }
  if (open === null) return null;
  const close = closeOf(open, open.data === ARRAY_OPEN ? ARRAY_CLOSE : REGION_CLOSE);
  if (close === null || close === c.e) return null;
  c.n = close.nextSibling;
  c.o = 0;
  c.x = false;
  return [open, close];
}

function isBracket(node) {
  return node !== null && node !== undefined && (isMarker(node, ARRAY_OPEN) || isMarker(node, REGION_OPEN));
}

/**
 * @internal A hydration walk of the server's nodes between the markers `open`
 * and `close` (exclusive, in one parent), as hydrate() walks a container:
 * what `fn` builds claims them (compiled JSX, _$hcreateComponent, a vnode it
 * returns), a node the client does not render is reported to `onError` and
 * removed, and what waited for the walk (_afterWalk: an island inside) runs
 * at its end. For what-react: a native component a React island renders
 * hydrates in the bracket the server wrote for it, after what-core's own walk
 * is done. Returns what `fn` returned.
 */
export function _hydrateRange(open, close, fn, onError) {
  const parent = close.parentNode;
  const saved = { cur, depth: outer.length, session, pendingKey };
  const walk = (session = newSession(parent, onError || null, _hydrationRoot(parent)));
  let value;
  batch(() => {
    cur = { p: parent, n: open.nextSibling, o: 0, x: false, e: close, h: true, t: null };
    pendingKey = null;
    try {
      value = fn();
      adopt(value);
      finish(cur);
    } finally {
      cur = saved.cur;
      outer.length = saved.depth;
      session = saved.session;
      pendingKey = saved.pendingKey;
      if (saved.depth === 0) releaseCursors();
    }
    walkDone(walk);
  });
  return value;
}

/**
 * @internal The onHydrationError hook of the hydrate() walking now, or null:
 * what a hydration it defers (an island's) reports to.
 */
export function _hydrationErrorHook() {
  return cur !== null && cur.h && session !== null ? session.onError : null;
}

function clientBuild(fn, a, b, c) {
  const saved = cur;
  cur = CLIENT;
  try {
    return fn(a, b, c);
  } finally {
    cur = saved;
  }
}

/**
 * hydrate(tree, container, options?)
 * Adopt the server-rendered DOM in `container` as the DOM of `tree` (an h()
 * or JSX-runtime vnode, compiled JSX built with `hydratable`, or a mix):
 * bindings, events and components attach to the nodes the server wrote.
 * Returns the unmount function, as mount() does. The tree is built in a root
 * of its own (under the current owner, if any: an island hydrates under its
 * component); hydrating or mounting into a container that already holds a
 * root disposes that root first. `options.onHydrationError(info)` is called
 * for every mismatch, in production too.
 */
export function hydrate(tree, container, options) {
  container = _mountTarget(container, 'hydrate');
  /** @type {() => void} */
  let unmount = () => {};
  createRoot((dispose) => {
    unmount = _trackRoot(container, dispose);
    const saved = { cur, depth: outer.length, session, pendingKey };
    if (__DEV__ && __devtools?.onRecord) /** @type {any} */ (saved).devNodes = devHydrationNodes(container);
    const walk = (session = newSession(container, (options && options.onHydrationError) || null, _hydrationRoot(container)));
    // The server counts useId from 1 for every render; the client restarts so
    // `for` and `aria-labelledby` keep pointing at the ids the server wrote.
    __resetIdCounter();
    // Async values made during the walk start from the server's values.
    _installSeeding();
    // Effects a write during the walk would re-run wait for its end, when
    // nothing claims any more.
    batch(() => {
      cur = { p: container, n: container.firstChild, o: 0, x: false, e: null, h: true, t: null };
      pendingKey = null;
      try {
        adopt(tree);
        // <body> and <html> also hold the page's scripts and data, which no
        // tree renders: only a container of its own is checked for leftovers.
        if (container !== document.body && container !== document.documentElement) finish(cur);
      } finally {
        cur = saved.cur;
        outer.length = saved.depth;
        session = saved.session;
        pendingKey = saved.pendingKey;
        if (saved.depth === 0) releaseCursors();
      }
      walkDone(walk);
    });
    _adoptDetached(container.childNodes);
    if (__DEV__ && /** @type {any} */ (saved).devNodes) devHydrationComplete(container, /** @type {any} */ (saved).devNodes);
  });
  return unmount;
}

// Count the completed tree by node identity. Comments are hydration protocol
// markers, not elements or text the app rendered.
function devHydrationNodes(container) {
  const nodes = new Set();
  const walk = container.ownerDocument.createTreeWalker(container, 5);
  for (let node = walk.nextNode(); node !== null; node = walk.nextNode()) nodes.add(node);
  return nodes;
}

function devHydrationComplete(container, before) {
  const after = devHydrationNodes(container);
  let adopted = 0;
  for (const node of after) if (before.has(node)) adopted++;
  recordObservation(__devtools, 'hydration:complete', container, { adopted, created: after.size - adopted });
}

// --- The cursor ---

function isMarker(node, data) {
  return node !== null && node.nodeType === 8 && /** @type {Comment} */ (node).data === data;
}

// The next node to claim, past empty text and the transparent markers; null
// at the end of the region.
function next(c) {
  if (c.x) dropDiffering(c, '');
  if (c.o > 0) return c.n;
  let n = c.n;
  while (n !== null && n !== c.e) {
    const type = n.nodeType;
    if (type === 8 ? !transparent(n.data) : type !== 3 || n.data !== '') break;
    n = n.nextSibling;
  }
  c.n = n;
  return n === c.e ? null : n;
}

// Where next() would stand, without moving the cursor.
function past(c) {
  let n = c.n;
  while (n !== null && n !== c.e
    && ((n.nodeType === 8 && transparent(n.data)) || (n.nodeType === 3 && n.data === ''))) n = n.nextSibling;
  return n;
}

// What the server has where a component's output starts (hydration-data.js
// _assignHydrationOwnerPath): the key of the element there, '' when there is
// something without one, null when there is nothing.
function serverKeyAt(c) {
  if (c.o > 0 || c.x) return '';
  const n = past(c);
  if (n === c.e || n === null) return null;
  return n.nodeType === 1 ? /** @type {Element} */ (n).getAttribute('data-hk') || '' : '';
}

// The next node past empty text only: where a region or a list looks for its
// own markers. Text an empty value may have rendered on the server (x: 1)
// stays for the next claim of text to read.
function nextOwn(c) {
  if (c.x === true) dropDiffering(c, '');
  if (c.o > 0) return null;
  let n = c.n;
  while (n !== null && n !== c.e && n.nodeType === 3 && n.data === '') n = n.nextSibling;
  c.n = n;
  return n === c.e ? null : n;
}

// The marker closing `open`, counting the markers nested in between.
function closeOf(open, close) {
  const data = open.data;
  let depth = 0;
  for (let n = open.nextSibling; n !== null; n = n.nextSibling) {
    if (n.nodeType !== 8) continue;
    const d = n.data;
    if (d === data || (close === BOUNDARY_CLOSE && (d === BOUNDARY_OPEN || d === BOUNDARY_FALLBACK))) depth++;
    else if (d === close) {
      if (depth === 0) return n;
      depth--;
    }
  }
  return null;
}

// Walk the region between `open` and `close` (exclusive) with `fn`, then
// continue after `close`.
function within(open, close, fn, a) {
  const c = cur;
  outer.push(c);
  cur = { p: c.p, n: open.nextSibling, o: 0, x: false, e: close, h: true, t: null };
  try {
    fn(a);
    finish(cur);
  } finally {
    cur = outer.pop();
  }
  c.n = close.nextSibling;
  c.o = 0;
  c.x = false;
}

// Text a claim read only part of becomes a node of its own from here on.
// Text that may hold a value's server text (x) stays for the next claim.
function splitHere(c) {
  if (c.o > 0) {
    c.n = /** @type {Text} */ (c.n).splitText(c.o);
    c.o = 0;
  }
}

// The node before the cursor. Claims and recoveries only touch what lies
// after it, so a value adopted from here holds the nodes from the one after
// the anchor up to the cursor.
function anchorOf(c) {
  return c.n === null ? c.p.lastChild : c.n.previousSibling;
}

function afterAnchor(c, anchor) {
  return anchor === null ? c.p.firstChild : anchor.nextSibling;
}

// The nodes left in a region after its last claim are server markup the
// client does not render: reported, and removed.
function finish(c) {
  splitHere(c);
  const top = c.p === session.root && c.e === null;
  for (let x = next(c); x !== null && x !== c.e;) {
    const following = x.nextSibling;
    if (frozen()) break;
    if (!top || !streamElement(x)) {
      mismatch('extra-nodes', 'nothing', describe(x), x);
      x.remove();
    }
    x = following;
  }
  c.n = c.e;
}

// What a stream writes after the page into the container it renders into,
// which no tree renders: its data elements, the content templates of
// boundaries not yet swapped in, and its inline scripts, all of which call
// the stream's _$W functions (what-server stream.js). Only the container's
// top level holds them.
function streamElement(x) {
  if (x.nodeType !== 1) return false;
  if (x.localName === 'template') return x.id !== '';
  if (x.localName !== 'script') return false;
  if (x.getAttribute('type') === 'application/json') return x.id === '__what_data' || x.hasAttribute('data-what-data');
  const code = x.textContent;
  return code.startsWith('_$W.') || code.startsWith('(self._$W=');
}

// --- Mismatches ---

function describe(node) {
  if (node == null) return 'nothing';
  if (node.nodeType === 3) return JSON.stringify(short(node.data));
  if (node.nodeType === 8) return `<!--${short(node.data)}-->`;
  if (node.nodeType !== 1) return node.nodeName;
  let open = '<' + node.localName;
  const id = node.getAttribute('id');
  const cls = node.getAttribute('class');
  if (id) open += ` id="${short(id)}"`;
  if (cls) open += ` class="${short(cls)}"`;
  return open + '>';
}

function short(text) {
  return text.length > 40 ? text.slice(0, 37) + '...' : text;
}

// The node's place under the hydrate() container: `main>ul>li[1]` (an index
// counts the earlier siblings with the same tag).
function domPath(node) {
  const parts = [];
  for (let n = node; n != null && n !== session.root && n.nodeType !== 9; n = n.parentNode) {
    if (n.nodeType !== 1) {
      parts.push(n.nodeType === 3 ? '#text' : '#comment');
      continue;
    }
    let index = 0;
    for (let s = n.previousElementSibling; s !== null; s = s.previousElementSibling) {
      if (s.localName === n.localName) index++;
    }
    parts.push(index ? `${n.localName}[${index}]` : n.localName);
  }
  return parts.reverse().join('>');
}

function regionOf(c) {
  return c.e !== null ? c.e : c.p;
}

// Whether a component under a <Suspense> being adopted has suspended: that
// boundary's walk will be dropped and walked again once what it waits for
// lands (hydrateSuspense), so from here on the walk changes nothing of the
// server's DOM, and reports nothing.
function frozen() {
  return session.dropping.some((b) => b.thenables > 0);
}

// One report per region (a marked region, by its closing marker; else the
// element the walk is in): what follows a mismatch in the same region is the
// recovery's own doing. Any but a text mismatch means the two sides' trees
// differ in structure, so components are no longer numbered in order.
function mismatch(kind, expected, found, at, recovery = 'client-render') {
  const s = session;
  const region = regionOf(cur);
  if (frozen()) return;
  // A prebuilt node took the server's place in the same structure.
  if (kind !== 'text' && kind !== 'prebuilt') s.ordered = false;
  if (s.reported.has(region)) return;
  s.reported.add(region);
  if (!__DEV__ && s.onError === null) return;
  const owner = _currentComponent();
  const info = {
    kind,
    component: owner ? owner.Component.displayName || owner.Component.name || 'Anonymous' : 'root',
    ownerPath: owner && owner._ownerPath !== undefined ? owner._ownerPath : null,
    path: domPath(at),
    expected,
    found,
    recovery,
  };
  if (__DEV__) {
    const where = __ownerPath(owner || getOwner());
    report('ERR_HYDRATION_MISMATCH', {
      data: info, owner: where, loc: where.loc,
      subject: { kind: 'hydration', id: `${info.ownerPath ?? 'root'}|${info.path}|${kind}`, name: info.component },
    });
  }
  if (s.onError !== null) s.onError(info);
}

// The client's node in place of the one the cursor stands on (or before the
// end), after reporting what the server had there.
function recover(c, node, expected, kind) {
  splitHere(c);
  const found = next(c);
  if (frozen()) return node;
  mismatch(kind || (found === null ? 'missing' : found.nodeType === 8 ? 'marker' : found.nodeType === 3 ? 'text'
    : /** @type {Element} */ (found).shadowRoot != null ? 'shadow-root' : 'tag'), expected, describe(found), found || c.p);
  if (found !== null && (found.nodeType === 1 || found.nodeType === 3)) {
    c.p.replaceChild(node, found);
    c.n = node.nextSibling;
  } else {
    c.p.insertBefore(node, c.n);
  }
  return node;
}

// --- Claims ---

// The element the cursor stands on, when it is a `tag` element. One that
// hosts a shadow root (a declarative one, <template shadowrootmode="open"> in
// the server's markup) is not what the client renders: what the page shows is
// the shadow tree, not the children the walk would claim.
function takeElement(c, tag) {
  const n = next(c);
  if (n === null || n.nodeType !== 1) return null;
  const name = n.localName;
  if ((name !== tag && name !== tag.toLowerCase()) || /** @type {Element} */ (n).shadowRoot != null) return null;
  c.n = n.nextSibling;
  settleKey(n);
  return n;
}

// The first node a component's output writes settles its key on the server:
// placed when it is an element, dropped otherwise. The client checks the key
// it finds against the component that claims the element; the attribute goes
// with the others the client does not render.
function settleKey(el) {
  const expected = pendingKey;
  if (expected === null) return;
  pendingKey = null;
  const key = el.getAttribute('data-hk');
  if (key !== null && key !== expected && !session.lenient) {
    mismatch('key', `data-hk="${expected}"`, `data-hk="${key}"`, el, 'none');
  }
}

// `text`, read from the server's text at the cursor across the nodes the
// parser merged it into; the client's text where it differs.
function claimText(text) {
  pendingKey = null;
  if (text === '') return;
  if (text.indexOf('\r') >= 0) text = text.replace(/\r\n?/g, '\n');
  const c = cur;
  if (c.x) dropDiffering(c, text);
  for (let i = 0; i < text.length;) {
    const n = next(c);
    if (n === null || n.nodeType !== 3) {
      recover(c, document.createTextNode(text.slice(i)), JSON.stringify(short(text.slice(i))), n === null ? 'missing' : 'text');
      return;
    }
    const data = n.data;
    const take = Math.min(data.length - c.o, text.length - i);
    if (!data.startsWith(i === 0 && take === text.length ? text : text.slice(i, i + take), c.o)) {
      replaceText(c, text.slice(i));
      return;
    }
    i += take;
    c.o += take;
    if (c.o === data.length) {
      c.n = n.nextSibling;
      c.o = 0;
    }
  }
}

// The server's text node at the cursor, whose text differs from the client's
// `text`, takes the client's text in place (returned; null while frozen). Where
// the server's text for that value ends is not in the DOM when the parser
// merged it with the text that follows (a row's index and its label), so the
// server's text goes on in a node after it until the next claim shows where
// that starts (dropDiffering): what follows is still claimed, and the nodes
// after it kept.
function replaceText(c, text) {
  splitHere(c);
  const node = /** @type {Text} */ (c.n);
  if (frozen()) {
    c.n = node.nextSibling;
    return null;
  }
  mismatch('text', JSON.stringify(short(text)), describe(node), node);
  c.x = true;
  const rest = c.p.insertBefore(node.cloneNode(), node.nextSibling);
  node.data = text;
  c.n = rest;
  return node;
}

// The server's text of a value that differed (replaceText): from the cursor
// to where `text`, what the next claim reads, starts in that node (where its
// beginning ends the node, when it runs on into the next one), or the whole
// node when the next claim is not text or `text` is not there. Removed.
// After an empty value (x: 1), that text was the server's value for it,
// reported here: none when `text` starts the node, or is not in it (the next
// claim's own text differs, and that claim reports it).
function dropDiffering(c, text) {
  const empty = c.x === 1;
  c.x = false;
  const node = c.n;
  if (node === null || node.nodeType !== 3) return;
  const data = /** @type {Text} */ (node).data;
  let end = text === '' ? data.length : data.indexOf(text);
  if (end < 0) {
    if (empty) return;
    end = data.length;
    for (let b = Math.max(1, data.length - text.length + 1); b < data.length; b++) {
      if (text.startsWith(data.slice(b))) {
        end = b;
        break;
      }
    }
  }
  if (end === 0) return;
  if (end < data.length) /** @type {Text} */ (node).splitText(end);
  if (empty) mismatch('text', '""', describe(node), node);
  c.n = node.nextSibling;
  node.remove();
}

// A claimed element's attributes become its template node's: the server's
// that the template does not write are stale, and a static one the server
// left out or wrote otherwise takes the template's value. `owned` names the
// attributes the element's bindings write in full on their first run
// (what-compiler, separated by spaces): the server's stay for them to write.
// Every other attribute the server wrote goes, the bindings writing the
// dynamic ones again.
function keepTemplateAttrs(el, t, owned) {
  const want = templateAttrs(t);
  // Names, not el.attributes: the attribute map is an object per element.
  const names = el.hasAttributes() ? el.getAttributeNames() : null;
  let left = names === null ? 0 : names.length;
  if (owned !== undefined && names !== null) {
    for (let i = 0; i < names.length; i++) if (owns(owned, names[i])) left--;
  }
  let same = left * 3 === want.length;
  for (let i = 0; same && i < want.length; i += 3) same = el.getAttribute(want[i]) === want[i + 1];
  if (same) return;
  if (names !== null) {
    for (let i = 0; i < names.length; i++) {
      if (!t.hasAttribute(names[i]) && (owned === undefined || !owns(owned, names[i]))) el.removeAttribute(names[i]);
    }
  }
  for (let i = 0; i < want.length; i += 3) {
    if (el.getAttribute(want[i]) !== want[i + 1]) el.setAttributeNS(want[i + 2], want[i], want[i + 1]);
  }
  if (_selectionKeeper !== null && el.localName === 'option') _selectionKeeper(el);
}

// Whether attribute `name` is one of `owned` (keepTemplateAttrs).
function owns(owned, name) {
  return owned === name || (owned.length > name.length && (' ' + owned + ' ').includes(' ' + name + ' '));
}

// Development: a claimed element's attributes as the server wrote them, held
// against the client's once the walk `session` is done, when every binding
// has written its first value and nothing a write queued has run yet. `want`
// names the attributes the client writes for certain (a template's static
// ones and those its bindings own, or the attributes a vnode's props write):
// each differs when its value does, the server's or the client's left out
// included. Any other the server wrote is compared only when the client
// writes it again; one it leaves out (data-hk, a stale one) was removed as
// before, and a custom element's own are its business. Reported as the
// diagnostic only: onHydrationError hears the same records in every build.
function watchAttrs(el, want) {
  const s = session;
  if (frozen()) return;
  let list = s.attrs;
  if (list === undefined) {
    list = s.attrs = [];
    s.after.push(() => checkAttrs(list, s));
  }
  const server = new Map();
  for (const name of el.getAttributeNames()) server.set(name, el.getAttribute(name));
  // An HTML element's attribute names are lower case (tabIndex is tabindex).
  if (el.namespaceURI === NAMESPACES[0]) want = new Set([...want].map((name) => name.toLowerCase()));
  list.push({ el, server, want, owner: _currentComponent(), at: getOwner() });
}

// The template's static attributes and the `owned` ones (keepTemplateAttrs).
function templateWants(t, owned) {
  const want = new Set();
  const attrs = templateAttrs(t);
  for (let i = 0; i < attrs.length; i += 3) want.add(attrs[i]);
  if (owned !== undefined) for (const name of owned.split(' ')) want.add(name);
  return want;
}

function checkAttrs(list, s) {
  // domPath reads the walk's container from `session`, which the walk has
  // already handed back.
  const saved = session;
  session = s;
  try {
    checkEach(list);
  } finally {
    session = saved;
  }
}

function checkEach(list) {
  for (const { el, server, want, owner, at } of list) {
    const custom = el.localName.includes('-');
    for (const name of new Set([...want, ...server.keys()])) {
      const now = el.getAttribute(name);
      const was = server.has(name) ? server.get(name) : null;
      if (!want.has(name) && (now === null || custom)) continue;
      if (sameAttr(el, name, was, now)) continue;
      const component = owner ? owner.Component.displayName || owner.Component.name || 'Anonymous' : 'root';
      const info = {
        kind: 'attribute',
        component,
        ownerPath: owner && owner._ownerPath !== undefined ? owner._ownerPath : null,
        path: domPath(el),
        attribute: name,
        expected: now === null ? `no ${name}` : `${name}="${short(now)}"`,
        found: was === null ? `no ${name}` : `${name}="${short(was)}"`,
        recovery: 'client-value',
      };
      const where = __ownerPath(owner || at);
      report('ERR_HYDRATION_MISMATCH', {
        data: info, owner: where, loc: where.loc,
        subject: { kind: 'hydration', id: `${info.ownerPath ?? 'root'}|${info.path}|attribute|${name}`, name: component },
      });
    }
  }
}

// HTML's boolean attributes: present is true whatever the value (made on
// the first comparison, in development).
/** @type {Set<string> | null} */
let booleanAttrs = null;
const booleanAttributes = () => booleanAttrs ??= new Set(['allowfullscreen', 'async', 'autofocus', 'autoplay', 'checked', 'controls', 'default', 'defer', 'disabled', 'formnovalidate', 'inert', 'ismap', 'itemscope', 'loop', 'multiple', 'muted', 'nomodule', 'novalidate', 'open', 'playsinline', 'readonly', 'required', 'reversed', 'selected']);

// Whether the server's value `was` of attribute `name` is the client's `now`
// as the DOM reads it: a boolean attribute by its presence, `style` by the
// declarations it holds, and a text field's value left out as the empty one.
// Anything else, class token order and a URL as written included, by its
// text.
function sameAttr(el, name, was, now) {
  if (was === now) return true;
  if (el.namespaceURI !== NAMESPACES[0]) return false;
  if (name === 'value' && el.localName === 'input' && !ATTRIBUTE_VALUE_TYPES.has(/** @type {HTMLInputElement} */ (el).type)) return (was ?? '') === (now ?? '');
  if (was === null || now === null) return false;
  if (booleanAttributes().has(name)) return true;
  if (name !== 'style') return false;
  const probe = el.ownerDocument.createElement('div');
  probe.setAttribute('style', was);
  const before = probe.style.cssText;
  probe.setAttribute('style', now);
  return probe.style.cssText === before;
}

// A template node's attributes as [name, value, namespace, ...], read from
// the node once.
function templateAttrs(t) {
  const node = /** @type {any} */ (t);
  if (node._attrs === undefined) {
    node._attrs = [];
    for (const attr of t.attributes) node._attrs.push(attr.name, attr.value, attr.namespaceURI);
  }
  return node._attrs;
}

// Whether the setter for prop `key` would write `value` as the attribute
// value `current` the server wrote: a string or number it writes as it is.
// Not a value the URL and attribute rules refuse (dom.js _isUnsafeAttr, from
// the renderer slot: a vnode exists only where h.js installed it), `value` (a
// property, not the attribute), or an empty string for a property the element
// reads as a boolean (`disabled: ''` is not disabled, `disabled=""` is; any
// other string is true both ways).
function keepsAttr(el, key, value, current) {
  if ((typeof value !== 'string' && typeof value !== 'number') || current !== String(value)) return false;
  if (key === 'value' || /** @type {Function} */ (vnodeRefuses)(key, value)) return false;
  // A custom element's own property need not reflect its attribute (a setter
  // that keeps state of its own): it takes the prop as a mount does.
  if (el.localName.includes('-') && _writableProp(el, key)) return false;
  return current !== '' || !(key in el && typeof el[key] === 'boolean');
}

// The attribute a prop writes on `el`, or null for a prop that writes none of
// its own: children, key, ref, a delegated handler ($$click), raw inner HTML,
// a listener, a classList (it writes class, which `fold` removed first), and
// a form field's value or checked (a property: the server's attribute there
// showed it, and goes unless a default prop writes it).
function attrOf(el, key) {
  if (key === 'children' || key === 'key' || key === 'ref' || key.startsWith('$$') || key === 'innerHTML'
    || key === 'dangerouslySetInnerHTML' || key === 'classList' || _isEventProp(key)) return null;
  if (FIELD_PROPS.has(key) && FIELD_TAGS.has(el.localName)) {
    if (el.localName !== 'input') return null;
    if (key === 'checked') return null;
    if (key === 'value' && !ATTRIBUTE_VALUE_TYPES.has(el.type)) return null;
  }
  return markupName(key);
}

// The server attributes no prop renders, removed: an event handler's name
// (a listener, not an attribute), a key, anything the client never writes.
function dropUnrendered(el, props, fold, names) {
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    let rendered = name === 'class' && fold;
    for (const k in props) {
      if (rendered) break;
      const a = attrOf(el, k);
      rendered = a !== null && (a === name || a.toLowerCase() === name);
    }
    if (!rendered) el.removeAttribute(name);
  }
  if (_selectionKeeper !== null && el.localName === 'option') _selectionKeeper(el);
}

// A reactive prop whose attribute the server wrote: the attribute stands
// until the effect's first run writes the client's value over it (every
// setter writes its attribute whole), and goes when that run is held on a
// value that has not landed, as a client render would show none yet.
function hydrateReactiveProp(el, key, value, svg, name) {
  let ran = false;
  /** @type {Function} */ (vnodeProp)(el, key, () => {
    const v = value();
    ran = true;
    return v;
  }, svg);
  if (!ran) el.removeAttribute(name);
}

// --- Values ---

// Adopt `value` at the cursor: what the client renders for it claims the
// server's nodes for it, in document order.
function adopt(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'symbol') {
    if (__DEV__ && typeof value === 'symbol') symbolChild(value);
    return;
  }
  const type = typeof value;
  if (type === 'string' || type === 'number') {
    claimText(String(value));
    return;
  }
  if (type === 'function') {
    // Compiled children placed among other members (a boundary's, an h()
    // element's): the server wrote them in place.
    if (value._lazyChildren) adopt(_placeFlat(value));
    else if (value._mapArray) adoptList(value);
    else adoptRegion(value);
    return;
  }
  if (Array.isArray(value)) {
    if (session.built.has(value)) return;
    // An array the server bracketed (one a component or a reactive child
    // returned) is walked between its markers, so what follows it starts
    // after its closing one: a boundary or a region after it finds its own
    // opening marker there. One whose first node claimed the server's in
    // place (the nodes a component adopted, which it returns, first in it or
    // in an array first in it) was walked as it was built: markers at the
    // cursor are the next value's.
    const at = nextOwn(cur);
    let first = value[0];
    while (Array.isArray(first)) first = first[0];
    const claimed = _isDomNode(first) && first.parentNode === cur.p;
    const close = at !== null && isMarker(at, ARRAY_OPEN) && !claimed ? closeOf(at, ARRAY_CLOSE) : null;
    if (close !== null) within(at, close, adoptEach, value);
    else {
      adoptEach(value);
      // Its claims stepped past the server's opening marker (the first of
      // the nodes a component adopted, when its claim passed it): the
      // closing one, where the walk stands now, is passed too, so what
      // follows finds its own markers.
      const open = !claimed ? null : isMarker(first, ARRAY_OPEN) ? first : first.previousSibling;
      if (open !== null && isMarker(open, ARRAY_OPEN) && nextOwn(cur) === closeOf(open, ARRAY_CLOSE)) cur.n = cur.n.nextSibling;
    }
    return;
  }
  if (isVNode(value)) {
    adoptVNode(value);
    return;
  }
  if (_isDomNode(value)) {
    adoptNode(value);
    return;
  }
  claimText(String(value));
}

// The members of an array or of an element's children, a vnode with a key
// as a keyed row (hydration-data.js _enterRow), and any other that can hold
// a component or a list in its slot (takesSlot), as what-server renders them.
function adoptEach(values) {
  /** @type {object | null} */
  let list = null;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    const key = isVNode(value) ? value.key : null;
    if (key != null) adoptRow(list ??= {}, key, adopt, value);
    else if (takesSlot(value)) adoptRow(null, i, adopt, value);
    else adopt(value);
  }
}

// Whether a member can hold a component or a list in the frame adopting it,
// by what-server's rule (stream.js takesSlot): a function, an array, a
// component, or an element with a child that is not text. The factory of
// compiled children is the server's markup, which takes none.
function takesSlot(value) {
  if (typeof value === 'function') return !value._lazyChildren;
  if (Array.isArray(value)) return true;
  if (!isVNode(value)) return false;
  if (typeof value.tag === 'function') return true;
  const kids = value.children;
  if (kids) {
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i];
      if (typeof kid === 'function' || (typeof kid === 'object' && kid !== null)) return true;
    }
  }
  return false;
}

// The keyed rows hydration enters (hydration-data.js _enterRow and
// _leaveRow), for the keys of server actions' useActionState: installed by
// the first server action an app defines (what-server action()), so an app
// with none carries no row tracking.
/** @type {any} */
let rowEntry = null;
/** @type {any} */
let rowExit = null;

/** @internal What-core's keyed rows, for hydration to enter (hydration-data.js _installRowKeys). */
export function _installRowEntry(enter, exit) {
  rowEntry = enter;
  rowExit = exit;
}

// `fn(a)` as the keyed row `key` of `list`, in the component adopting it.
function adoptRow(list, key, fn, a) {
  if (rowEntry === null) return fn(a);
  const root = session.ownerRoot;
  const saved = rowEntry(undefined, root, list, key);
  try {
    return fn(a);
  } finally {
    rowExit(undefined, root, saved);
  }
}

// A node: one a compiled claim took in place (nothing left to do), or one the
// client built before the walk reached it, which takes the place of the
// server's rendering of it.
function adoptNode(node) {
  const c = cur;
  if (node.parentNode === c.p && node !== c.n) return;
  if (!session.prebuilt.has(node)) notHydratable();
  placeBuilt(c, node);
}

// Built DOM where the server rendered the same JSX: the server's nodes for it
// are consumed by the built nodes' structure and replaced by them. JSX built
// off the walk (_$outside) is reported where it replaces the server's nodes
// (kind prebuilt), and what the user changed in the server's form controls
// there goes to the built ones (carryFields).
function placeBuilt(c, value) {
  if (frozen()) return;
  const nodes = value.nodeType === 11 ? Array.from(value.childNodes) : [value];
  splitHere(c);
  let same = true;
  let report = session.prebuilt.has(value);
  for (let i = 0; i < nodes.length && same; i++) {
    const b = nodes[i];
    if (b.nodeType === 1) {
      const s = next(c);
      if (s !== null && s.nodeType === 1 && s.localName === b.localName) {
        if (report) mismatch('prebuilt', describe(b), describe(s), s);
        report = false;
        carryFields(s, b);
        c.n = s.nextSibling;
        s.remove();
      } else {
        same = false;
      }
    } else if (b.nodeType === 3) {
      const s = next(c);
      if (report && b.data !== '' && s !== null && s.nodeType === 3) mismatch('prebuilt', describe(b), describe(s), s);
      report = false;
      same = dropText(c, b.data);
    } else if (b.nodeType === 8 && (b.data === 'fn' || b.data === 'list')) {
      const s = nextOwn(c);
      const close = s !== null && s.nodeType === 8 && (s.data === REGION_OPEN || s.data === ARRAY_OPEN)
        ? closeOf(s, s.data === REGION_OPEN ? REGION_CLOSE : ARRAY_CLOSE) : null;
      if (close !== null) {
        c.n = close.nextSibling;
        for (let x = s; x !== c.n;) {
          const following = x.nextSibling;
          x.remove();
          x = following;
        }
      }
    }
  }
  if (!same) mismatch('tag', describe(nodes[0]), describe(next(c)), next(c) || c.p);
  c.p.insertBefore(value, c.n);
}

// What the user changed in the server's form controls in `server` (the
// element and its descendants) goes to the built controls in `built` that
// correspond: the walk shows it once it is done (walkDone), and a file input
// gets the files chosen in it. Controls correspond when they have the same
// tag, type, name and form attribute (and value, for a checkbox or a radio),
// taken in document order where both trees hold as many such controls; where
// they do not, nothing is carried for them, never what another control
// holds. A control in a <noscript> corresponds to none: the server's document
// parsed that as text, a built tree (cloned from a template) as controls.
function carryFields(server, built) {
  const from = controlsIn(server);
  if (from.size === 0) return;
  const to = controlsIn(built);
  restoreFields = _restoreFields;
  for (const [key, list] of from) {
    const into = to.get(key);
    if (into !== undefined && into.length === list.length) list.forEach((f, i) => carryField(f, into[i]));
  }
}

function carryField(f, t) {
  if (f.type === 'file') {
    if (f.files !== null && f.files.length > 0) t.files = f.files;
  } else if (f.type === 'radio') {
    if (f.checked !== f.defaultChecked) session.fields.push([t, f.checked]);
  } else {
    const changed = [];
    _changedFields(f, changed, session.radios);
    for (const [, shown, live] of changed) {
      if (live === undefined) session.fields.push([t, shown]);
      else if (t.options.length === shown.length) {
        t._$chosen = true;
        session.fields.push([t, [...t.options], live]);
      }
    }
  }
}

// The form controls of `el` and its descendants outside a <noscript>, by what
// makes them correspond (carryFields), each list in document order, which a
// selector list on a detached tree does not give in every DOM (jsdom).
function controlsIn(el) {
  /** @type {Map<string, any[]>} */
  const found = new Map();
  for (const d of FIELD_TAGS.has(el.localName) ? [el] : el.getElementsByTagName('*')) {
    if (!FIELD_TAGS.has(d.localName) || d.closest('noscript') !== null) continue;
    const key = [d.localName, d.type, d.name, d.getAttribute('form'), d.type === 'checkbox' || d.type === 'radio' ? d.value : ''].join('\0');
    const list = found.get(key);
    if (list === undefined) found.set(key, [d]);
    else list.push(d);
  }
  return found;
}

// Remove `text` from the server's text at the cursor; false when it is not
// there.
function dropText(c, text) {
  if (c.x) dropDiffering(c, text);
  const n = next(c);
  if (n === null || n.nodeType !== 3 || !n.data.startsWith(text, c.o)) return text === '';
  splitHere(c);
  const node = /** @type {Text} */ (c.n);
  if (node.data.length > text.length) node.splitText(text.length);
  c.n = node.nextSibling;
  node.remove();
  return true;
}

// DOM built before the walk could claim the server's: compiled JSX built
// without the hydratable option, or nodes made by hand. One cause, so one
// report for the whole hydrate(); what the replacement leaves of the server's
// DOM in a region is its doing, not another mismatch.
function notHydratable() {
  const region = regionOf(cur);
  if (session.warned) {
    session.reported.add(region);
    return;
  }
  session.warned = true;
  splitHere(cur);
  const at = nextOwn(cur);
  mismatch('not-hydratable', 'DOM built before hydrate() could claim it', describe(at), at || cur.p);
  session.reported.add(region);
}

// A vnode. A component's is adopted here: the JSX handed to hydrate() lowers
// to one (_$componentVNode). Every other kind comes from a vnode producer
// (h.js) and is adopted by _adoptVNodeKinds, reached through
// vnode-adoption.js, so a build that compiles all of its JSX for hydration
// can leave that out (see there).
function adoptVNode(vnode) {
  if (typeof vnode.tag === 'function') adoptComponent(...componentArgs(vnode), undefined, vnode._loc);
  else adoptVNodeKinds(vnode);
}

/** @internal An h() element, boundary or portal vnode, adopted at the cursor (adoptVNode). */
export function _adoptVNodeKinds(vnode) {
  const tag = vnode.tag;
  if (tag === '__errorBoundary') {
    hydrateErrorBoundary(vnode);
    return;
  }
  if (tag === '__suspense') {
    hydrateSuspense(vnode);
    return;
  }
  const c = cur;
  // An internal tag other than the boundaries' is a <Portal>, which renders
  // nothing on the server: its placeholder goes in here.
  if (tag.startsWith('__')) {
    const placeholder = clientBuild(vnodeRenderer, vnode, c.p);
    if (placeholder) c.p.insertBefore(placeholder, c.n);
    return;
  }
  const el = takeElement(c, tag);
  if (el === null) {
    recover(c, clientBuild(vnodeRenderer, vnode, c.p, _isSvgParent(c.p)), `<${tag}>`);
    return;
  }
  if (tag === 'input' || tag === 'select' || tag === 'textarea') _keepControl(el);
  const props = vnode.props || {};
  hydrateElementProps(el, props);
  const html = props.dangerouslySetInnerHTML ?? props.innerHTML;
  // A <noscript>'s content is not the client's: with scripts on, the browser
  // parsed what the server wrote there as text, and it stays (React's rule).
  if (html != null || tag === 'noscript') return;
  // An element the client leaves empty keeps what the server put in it only
  // where the client says it will: an island's host, which the island fills
  // from that markup when it hydrates. Anywhere else it is left over.
  const children = vnode.children;
  const empty = !children || children.length === 0;
  // A <textarea>'s text is its default: what the server wrote there showed
  // its value, and the props have written its default (dom.js Form fields).
  if (empty && tag === 'textarea') {
    if (props.defaultValue === undefined) el.defaultValue = '';
    return;
  }
  if (empty && (el.firstChild === null || props['data-island'] != null)) return;
  enterNode(el, null);
  try {
    if (!empty) adoptEach(children);
    finish(cur);
  } finally {
    cur = outer.pop();
  }
}

// What a vnode element's props render, written onto the claimed element as
// createDOM writes them (dom.js _setVNodeProp, from the renderer slot), so
// that its attributes end exactly as a client render's: an attribute the
// server wrote stays as it is where a prop renders exactly that value
// (keepsAttr), every other prop is written by its setter, each of which
// writes its attribute whole (a refused URL removes it, a style object
// replaces the inline style), and an attribute no prop renders is removed.
// The server attributes the props name are counted on the way: when that is
// all of them, none is left over. `value` is a property, so its attribute
// goes first. With a classList the server folded class and classList into
// one attribute; writing them in prop order from no attribute ends on the
// attribute the server wrote. Raw inner HTML is the client's: written again
// only when it differs.
function hydrateElementProps(el, props) {
  const fold = props.classList != null;
  if (__DEV__) {
    const want = new Set(fold ? ['class'] : []);
    for (const key in props) {
      const name = attrOf(el, key);
      if (name !== null) want.add(name);
    }
    watchAttrs(el, want);
  }
  if (fold) el.removeAttribute('class');
  // Whether it is an SVG element, read when a setter first needs it.
  /** @type {boolean | null} */
  let svg = null;
  const raw = props.dangerouslySetInnerHTML ?? props.innerHTML;
  const keepHtml = raw != null && typeof raw === 'object' && el.innerHTML === (raw.__html ?? '');
  // Names, not el.attributes: the attribute map is an object per element.
  const names = el.hasAttributes() ? el.getAttributeNames() : null;
  // The server attributes the props name, and whether two props name one.
  let named = 0;
  let twice = false;
  for (const key in props) {
    const value = props[key];
    const name = attrOf(el, key);
    if (name === null) {
      if (key === 'ref') applyRef(value, el);
      // `$$click` and the like: a delegated handler, assigned as compiled code does.
      else if (key.startsWith('$$')) {
        el[key] = value;
        el.$$owner = getOwner();
      } else if (key !== 'children' && key !== 'key' && !(keepHtml && (key === 'innerHTML' || key === 'dangerouslySetInnerHTML'))) {
        /** @type {Function} */ (vnodeProp)(el, key, value, svg ??= _hasSVGElement && el instanceof SVGElement);
      }
      continue;
    }
    const current = names === null ? null : el.getAttribute(name);
    if (current !== null) {
      named++;
      if (!twice && (name !== key || key !== key.toLowerCase())) {
        twice = (name !== key && Object.hasOwn(props, name)) || (name.toLowerCase() !== key && Object.hasOwn(props, name.toLowerCase()));
      }
      if (!(fold && name === 'class')) {
        if (keepsAttr(el, key, value, current)) continue;
        if (typeof value === 'function' && key !== 'value') {
          hydrateReactiveProp(el, key, value, svg ??= _hasSVGElement && el instanceof SVGElement, name);
          continue;
        }
        if (key === 'value') el.removeAttribute(name);
      }
    }
    /** @type {Function} */ (vnodeProp)(el, key, value, svg ??= _hasSVGElement && el instanceof SVGElement);
  }
  if (names !== null && (named !== names.length || twice)) dropUnrendered(el, props, fold, names);
}


// The (Component, props, endChildrenPass) createDOM renders a component vnode
// with (dom.js createComponent).
function componentArgs(vnode) {
  const Component = _toFunctionComponent(vnode.tag);
  const props = vnode.props;
  const children = vnode.children || [];
  const merged = _copyProps(props);
  if (children.length > 0) _setOwnProp(merged, 'children', children.length === 1 ? children[0] : children);
  const lazy = props && props._$lazyChildren;
  const slots = props && props._$slots;
  return [Component, merged, lazy || slots ? _installLazyChildren(Component, merged, lazy, slots) : null];
}

// A component, hydrated: an owner of its own with the owner path the server
// gave its frame (hydration-data.js), so its keyless resources adopt the
// server's values; its body runs once and its output claims the server's
// nodes. Returns the top-level nodes it adopted, which is what compiled code
// receives (_$hcreateComponent). `site` is the compiled JSX's number
// (hydration-data.js _assignOwnerPath).
function adoptComponent(Component, props, endChildrenPass, site, devLoc) {
  if (__DEV__) Object.freeze(props);
  // What the placement building it said of the server's markers is for the
  // children it places, not for this component's output (dom.js _place).
  _takeFlat();
  const owner = _componentOwner(Component);
  if (__DEV__) {
    if (devLoc) owner.devLoc = devLoc;
    owner._parentCtx = parentComponent(owner);
    _devMounted(owner);
  }
  const c = cur;
  const outerKey = pendingKey;
  const serverKey = serverKeyAt(c);
  // A built-in the compiler lowers away has no key: the next component's, or
  // its parent's, still waits for the first element.
  const stepped = _assignHydrationOwnerPath(owner, session.ownerRoot, serverKey, session.ordered, site);
  const key = owner._ownerPath;
  if (stepped !== 0) pendingKey = key !== undefined && key[0] !== '~' ? key : null;
  if (stepped === 2 && !session.lenient) {
    // The server's component here is not this one: the markup may still
    // match, so only the report, and this component fetches.
    _runOwned(owner, () => mismatch('key', `data-hk="${key.slice(1)}"`, `data-hk="${serverKey}"`, past(c), 'none'));
  }
  splitHere(c);
  const anchor = anchorOf(c);
  const held = _holdUser();
  try {
    const result = _runOwned(owner, Component, props);
    if (endChildrenPass !== null) endChildrenPass(owner);
    _runOwned(owner, adoptOutput, result);
  } catch (error) {
    pendingKey = outerKey;
    _disposeOwner(owner);
    // A throw while hydrating is classified as _renderComponent classifies it
    // (a thenable belongs to the nearest <Suspense>), but never escapes
    // hydrate(): the rest of the page still hydrates.
    const left = error != null && typeof error.then === 'function' && _handlePending(owner.owner, error) ? HANDLED : componentFailed(error, owner.owner);
    if (left !== HANDLED) console.error('[what] Error in component during hydration:', Component.name || 'Anonymous', left);
    return [];
  } finally {
    _releaseUser(held);
  }
  if (stepped !== 0 && pendingKey === key) pendingKey = outerKey;
  const nodes = [];
  for (let n = afterAnchor(c, anchor); n !== null && n !== c.n; n = n.nextSibling) nodes.push(n);
  if (__DEV__ && nodes.length > 0) {
    owner._wrapper = nodes[0];
    _devAnchor(nodes[0], owner);
  }
  return nodes;
}

// A component's output. Children it returns as they came (the factory a
// component that defers its children gets) are its output, an array the
// server brackets as any a component returns.
function adoptOutput(result) {
  adopt(typeof result === 'function' && result._lazyChildren ? result() : result);
}

// --- Regions ---

// A reactive child: one effect whose first run adopts what the server
// rendered for it, between the server's markers, and whose later runs render
// before the closing marker as any region does. The child is evaluated once
// per run, the first included. A child whose first run read nothing reactive
// never runs again: it adopts what it renders and keeps nothing, neither a
// node nor a marker of its own. Without markers (markup the server wrote as
// plain text, as h() writes a text child), a region whose value is text is the
// text node it claimed, or its part of text the parser merged it with
// (claimOwnText), updated in place, until its value is anything but text: only
// then does it take the markers a region needs. Its text is compared with the
// text the node held when it was claimed, then with what the region wrote
// last (region()), so a first write corrects server text that differs. The
// place of a live prop (dom.js _place, `_forward`) has no markers: the server
// writes the prop's value, so markers there are those of what that value or
// what follows renders.
function adoptRegion(fn, devName) {
  const c = cur;
  const parent = c.p;
  pendingKey = null;
  const at = nextOwn(c);
  const close = at !== null && !fn._forward && isMarker(at, REGION_OPEN) ? closeOf(at, REGION_CLOSE) : null;
  /** @type {any} */
  let start = null;
  /** @type {any} */
  let end = close;
  // Without markers: where the region starts, in the server's text it starts
  // inside of when `startAt` > 0, which is split there only once the region
  // needs a node of its own.
  /** @type {any} */
  const startNode = c.n;
  const startAt = c.o;
  /** @type {any} */
  let anchor = null;
  if (close !== null) {
    start = /** @type {Node} */ (at);
    outer.push(c);
    cur = { p: parent, n: start.nextSibling, o: 0, x: false, e: close, h: true, t: null };
  } else {
    anchor = startAt > 0 ? startNode : anchorOf(c);
  }
  const scope = vnodeRows !== null ? getOwner() : null;
  // What the region shows: undefined once adopted, for everything between
  // its markers when it next runs.
  /** @type {any} */
  let current = null;
  /** @type {any} */
  let rows = null;
  let first = true;
  let keep = true;
  let text = false;
  /** @type {any} */
  let textNode = null;
  let written = '';
  try {
    effect(() => {
      if (first) {
        first = false;
        let value;
        try {
          value = fn();
        } catch (error) {
          // Held on an async value that has not landed (or failed): the
          // server's content stays between the markers, and the run that
          // renders replaces it.
          if (close !== null) {
            cur.n = close;
            cur.o = 0;
            cur.x = false;
          }
          throw error;
        }
        keep = _tracking();
        const w = cur;
        text = (typeof value === 'string' && value !== '') || typeof value === 'number';
        if (keep && text && close === null && w.n === startNode && w.o === startAt && (textNode = claimOwnText(w, written = String(value))) !== null) return;
        if (vnodeRows !== null && keyedVNodes(value) && value.length > 0) {
          const open = nextOwn(w);
          rows = adoptVNodeRows(value, scope);
          if (isMarker(open, ARRAY_OPEN)) current = open;
        } else if (close === null && (value == null || value === false || value === '') && nextOwn(w) !== null && w.n.nodeType === 3) {
          // Without markers, text where an empty region stands is either the
          // server's value for it or what follows it: the next claim decides
          // (dropDiffering), by where its own text starts in it.
          if (!frozen()) w.x = 1;
        } else {
          adopt(value);
        }
        return;
      }
      const value = fn();
      if (textNode !== null) {
        if (textNode.nodeType === 1) textNode = partNode(textNode);
        if (typeof value === 'string' || typeof value === 'number') {
          const data = String(value);
          if (data !== written) textNode.data = written = data;
          if (textNode.parentNode !== null) textWritten(textNode.parentNode, data);
          return;
        }
        const host = textNode.parentNode;
        if (host === null) return;
        start = host.insertBefore(document.createComment(REGION_OPEN), textNode);
        end = host.insertBefore(document.createComment(REGION_CLOSE), textNode.nextSibling);
        start._rangeEnd = end;
        current = textNode;
        textNode = null;
      }
      const host = end.parentNode;
      if (host === null) return;
      if (current === undefined) {
        // Read now, not when the region was adopted: text split off a part of
        // the server's text since (partNode), and the markers and nodes of a
        // region in it that now shows something else, are the region's too.
        const owned = [];
        for (let n = start.nextSibling; n !== null && n !== end; n = n.nextSibling) owned.push(n);
        current = owned.length === 0 ? null : owned.length === 1 ? owned[0] : owned;
      }
      if (vnodeRows !== null) {
        const keyed = vnodeRows(value, rows, false, scope);
        if (keyed !== null) {
          if (current !== null) current = reconcileInsert(host, null, current, end);
          rows = keyed;
          rows.update(host, end, value);
          return;
        }
        if (rows !== null) {
          rows.remove();
          optionsChanged(host);
        }
      }
      current = reconcileInsert(host, value, current, end);
    }, __DEV__ ? { name: devName || fn.name || 'region', binding: parent } : undefined);
    if (close !== null) finish(cur);
  } finally {
    if (close !== null) cur = outer.pop();
  }
  if (close !== null) {
    c.n = close.nextSibling;
    c.o = 0;
    c.x = false;
    if (!keep) return;
  } else {
    if (!keep || textNode !== null) return;
    // The server's text it starts inside of, split where it starts.
    if (startAt > 0 && startNode.data.length > startAt) {
      const rest = startNode.splitText(startAt);
      if (c.n === startNode) {
        c.n = rest;
        c.o -= startAt;
      }
    }
    splitHere(c);
    const node = afterAnchor(c, anchor);
    if (text && rows === null && node !== c.n && node.nodeType === 3 && node.nextSibling === c.n) {
      textNode = /** @type {Text} */ (node);
      written = textNode.data;
      return;
    }
    start = parent.insertBefore(document.createComment(REGION_OPEN), node);
    end = parent.insertBefore(document.createComment(REGION_CLOSE), c.n);
  }
  // The region owns everything between its markers; keyed rows own theirs.
  if (rows === null) current = undefined;
  start._rangeEnd = end;
}

/**
 * @internal h() keyed rows (_vnodeRows), adopted: each row hydrates its vnode
 * in a root of its own under the owner the region was created under, as a
 * built row would be, and the server's closing array marker is the rows' end.
 * Reached through vnode-adoption.js, as _adoptVNodeKinds is.
 */
export function _adoptVNodeRows(value, scope) {
  const c = cur;
  const at = nextOwn(c);
  const close = at !== null && isMarker(at, ARRAY_OPEN) ? closeOf(at, ARRAY_CLOSE) : null;
  const order = close !== null ? inServerOrder(at, close, value, vnodeKey) : null;
  const vnodes = order === null ? value : order.map((i) => value[i]);
  const rows = [];
  const list = {};
  const adoptRows = () => {
    const rc = cur;
    for (let i = 0; i < vnodes.length; i++) {
      const vnode = vnodes[i];
      rows.push(runWithOwner(scope, () => createRoot((dispose) => {
        next(rc);
        splitHere(rc);
        const anchor = anchorOf(rc);
        adoptRow(list, vnode.key, adopt, vnode);
        splitHere(rc);
        let first = afterAnchor(rc, anchor);
        let last = anchorOf(rc);
        if (first === rc.n) first = last = rc.p.insertBefore(document.createComment(''), rc.n);
        return { key: vnode.key, vnode, dispose, first, last };
      })));
    }
  };
  let end;
  if (close !== null) {
    within(at, close, adoptRows);
    end = close;
  } else {
    adoptRows();
    splitHere(c);
    end = c.p.insertBefore(document.createComment('/list'), c.n);
  }
  const kept = /** @type {Function} */ (vnodeRows)(null, null, false, scope, end, rows);
  if (vnodes !== value) kept.update(end.parentNode, end, value);
  return kept;
}

function vnodeKey(vnode) {
  return vnode.key;
}

// --- Lists ---

// The client indexes of the items the server's rows (after `open`, up to
// `close`) are the rows of, in the server's order, read from the key digests
// the server wrote after the list's opening marker (what-server rowKeys),
// which come out of the DOM: null when they are the client's keys in the
// client's order (or the server wrote none), and the rows are `items` in
// order; the indexes of their keys' items in their order, when every server
// row's key is among the client's (the rows are adopted by key, then put in
// the client's order); else none, and the server's rows go (the client builds
// the list), as they do when the server marked a key it could not write, or
// when two different keys of the client have one digest. A row is adopted
// only for a key whose digest under the page's salt is the row's, which no
// other key of the client reaches by accident or without a preimage of the
// digest (_rowKeyDigest). Anything but null is reported: the two sides
// rendered the list from different data, or with keys hydration cannot
// compare.
function inServerOrder(open, close, items, keyFn) {
  const n = open.nextSibling;
  if (n === close || n.nodeType !== 8 || !isRowKeys(n.data)) return null;
  n.remove();
  const keys = items.map(keyFn);
  // k:<salt>:<digests>, each DIGEST_LENGTH digits.
  const salt = n.data.slice(2, 2 + DIGEST_LENGTH);
  const written = n.data.slice(3 + DIGEST_LENGTH);
  if (n.data[2 + DIGEST_LENGTH] === ':' && _rowKeysInOrder(keys, salt, written)) return null;
  const mine = keys.map((key) => _rowKeyDigest(key, salt));
  const theirs = n.data === 'k!' || n.data[2 + DIGEST_LENGTH] !== ':' || written.length % DIGEST_LENGTH !== 0 ? null
    : Array.from({ length: written.length / DIGEST_LENGTH }, (_, i) => written.slice(i * DIGEST_LENGTH, (i + 1) * DIGEST_LENGTH));
  // The client's rows of each digest, in order: none for a digest of two
  // different keys, which cannot tell them apart.
  const byDigest = new Map();
  mine.forEach((digest, i) => {
    const list = byDigest.get(digest);
    if (list === undefined) byDigest.set(digest, [i]);
    else if (list.length > 0 && keys[list[0]] === keys[i]) list.push(i);
    else list.length = 0;
  });
  if (theirs !== null && theirs.length === mine.length && theirs.every((digest, i) => digest === mine[i] && byDigest.get(digest).length > 0)) return null;
  const order = [];
  for (const digest of theirs || []) {
    const list = byDigest.get(digest);
    if (list === undefined || list.length === 0) {
      order.length = 0;
      break;
    }
    order.push(list.shift());
  }
  if (order.length === 0) {
    while (open.nextSibling !== close) open.nextSibling.remove();
  }
  // The server's keys: those of the rows taken, in its order, when they all
  // were.
  const describeKeys = (list) => short(list.slice(0, 40).map(String).join());
  mismatch('key', describeKeys(keys), order.length > 0 ? describeKeys(order.map((i) => keys[i])) : theirs === null ? 'keys it cannot compare' : 'rows of other keys', open, order.length > 0 ? 'move' : 'client-render');
  return order;
}

// A compiled list (mapArray / _$mapKeyed), adopted: each item's row claims the
// server's nodes for it inside an item scope, as buildRow builds one, and the
// list's effect reconciles from there on. The source is read once per run,
// the first included. A <For fallback> pairs the list with the fallback's
// region (what-compiler's lowering); the server rendered one or the other,
// and each adopts what it renders: the rows, then the fallback after them.
function adoptList(inserter) {
  const [source, mapFn, keyFn, keyedSignals, list, slot] = inserter._list;
  const c = cur;
  const parent = c.p;
  pendingKey = null;
  const fallback = inserter._fallback;
  if (list !== inserter && fallback === undefined) {
    placeInserter(c, inserter);
    return;
  }
  /** @type {[any, any, any, any, any, any]} */
  const args = [source, mapFn, keyFn, keyedSignals, parent, slot];
  const adoptAll = fallback === undefined ? adoptListRows : () => {
    adoptListRows(args);
    adoptRegion(fallback);
  };
  const at = nextOwn(c);
  const regionClose = at !== null && isMarker(at, REGION_OPEN) ? closeOf(at, REGION_CLOSE) : null;
  if (regionClose !== null) within(at, regionClose, adoptAll, args);
  else adoptAll(args);
}

function adoptListRows([source, mapFn, keyFn, keyedSignals, parent, slot]) {
  const c = cur;
  const at = nextOwn(c);
  const close = at !== null && isMarker(at, ARRAY_OPEN) ? closeOf(at, ARRAY_CLOSE) : null;
  // The list's start, paired with its end (_liveRegionNodes): a region that
  // holds the list removes the rows it adds later too.
  let start = at;
  if (close === null) {
    splitHere(c);
    start = c.p.insertBefore(document.createComment('list'), c.n);
  }
  let items = [];
  const mappedNodes = [];
  const disposeFns = [];
  /** @type {any} */
  let endMarker = close;
  let first = true;
  // The client index of each adopted row, when the server's rows are in
  // another order (inServerOrder): the row's callback is given that index.
  /** @type {number[] | null} */
  let order = null;
  // A keyed list's rows are keyed rows (_enterRow), as the server rendered them.
  const list = keyFn !== itemKey ? { slot } : null;
  const adoptRows = (newItems) => {
    const rc = cur;
    for (let i = 0; i < newItems.length; i++) {
      const item = newItems[i];
      const cell = keyedSignals === RAW ? null : _rowItem(item);
      // Markers the server wrapped the rows in (a region, the list's array)
      // stay outside the rows; a row of several nodes the server bracketed as
      // an array starts at its opening marker.
      next(rc);
      splitHere(rc);
      const anchor = anchorOf(rc);
      const build = () => _runScope(_itemScope(undefined, disposeFns, i), mapFn, cell === null ? item : keyedSignals === FOLLOW ? cell : () => _readRowItem(cell), order === null ? i : order[i], item, adopt);
      if (list === null) build();
      else adoptRow(list, keyFn(item, i), build);
      if (cell !== null) {
        cell.building = false;
        disposeFns[i]._item = cell;
      }
      splitHere(rc);
      const first = afterAnchor(rc, anchor);
      const single = first !== rc.n && first.nextSibling === rc.n && (first.nodeType === 1 || first.nodeType === 3);
      mappedNodes[i] = single ? first
        : anchor !== start && isMarker(anchor, ARRAY_OPEN) ? anchor
          : rc.p.insertBefore(document.createComment('i'), first);
    }
  };
  // Whether the first run was held: the server's rows stay up until the run
  // that renders the list.
  let held = false;
  if (__DEV__) setNextBinding(endMarker || parent, source._listLoc ? `list@${source._listLoc}` : 'list');
  effect(() => {
    let newItems;
    if (first) {
      first = false;
      try {
        newItems = source() || [];
      } catch (error) {
        held = true;
        if (close !== null) {
          c.n = close.nextSibling;
          c.o = 0;
          c.x = false;
        }
        throw error;
      }
      order = close !== null ? inServerOrder(at, close, newItems, keyFn) : null;
      // The list takes its place with no rows too, as the server's does.
      if (list !== null && rowEntry !== null) rowEntry(undefined, session.ownerRoot, list, undefined);
      const adopted = order === null ? newItems : order.map((i) => newItems[i]);
      if (close !== null) within(at, close, adoptRows, adopted);
      else adoptRows(adopted);
      if (adopted !== newItems) {
        for (let i = 0; i < mappedNodes.length; i++) mappedNodes[i]._$row = endMarker;
        reconcileKeyed(endMarker.parentNode || parent, endMarker, adopted, newItems, mappedNodes, disposeFns, mapFn, keyFn, keyedSignals);
      }
    } else {
      newItems = source() || [];
      if (held) {
        held = false;
        while (start.nextSibling !== null && start.nextSibling !== endMarker) start.nextSibling.remove();
      }
      const host = endMarker.parentNode || parent;
      reconcileKeyed(host, endMarker, items, newItems, mappedNodes, disposeFns, mapFn, keyFn, keyedSignals);
      optionsChanged(host);
    }
    items = newItems.length > 0 ? newItems.slice() : newItems;
  });
  onCleanup(() => {
    disposeRows(disposeFns, disposeFns.length);
    mappedNodes.length = 0;
    disposeFns.length = 0;
  });
  if (endMarker === null) {
    splitHere(c);
    endMarker = c.p.insertBefore(document.createComment('/list'), c.n);
  }
  start._rangeEnd = endMarker;
  for (let i = 0; i < mappedNodes.length; i++) mappedNodes[i]._$row = endMarker;
}

// An inserter that is not a plain list: the server's region for it is
// replaced by the client's rendering.
function placeInserter(c, inserter) {
  const at = nextOwn(c);
  const close = at !== null && isMarker(at, REGION_OPEN) ? closeOf(at, REGION_CLOSE) : null;
  if (close !== null) {
    for (let n = at.nextSibling; n !== close;) {
      const following = n.nextSibling;
      n.remove();
      n = following;
    }
    c.n = close;
  }
  clientBuild(inserter, c.p, c.n);
  if (close !== null) c.n = close.nextSibling;
}

// --- Boundaries ---
//
// An <ErrorBoundary> or a <Suspense> is a region between the server's
// boundary markers that holds its children or its fallback. The opening marker
// says which the server rendered:
//
//   - <!--b-->: the children, which hydrate against it under the boundary's
//     handler.
//   - <!--b!-->: the fallback (the server's children threw, or were still
//     waiting in a renderer that does not wait). The children are built on
//     the client first, as the server tried them first and numbered the
//     fallback's components after them. When they render they replace the
//     fallback; while they fail or wait, the fallback hydrates against the
//     server's.
//   - <!--b--> holding <template id="pl-ID">: a boundary still streaming. Its
//     fallback hydrates now, and its children hydrate against the content
//     when it arrives (_resumeBoundary, which the stream's swap calls).
//   - no marker (renderToString, markup written by hand): the boundary makes
//     its own. A <Suspense> whose fallback renders exactly what the cursor
//     stands on showed its fallback; anything else showed its children.
//
// Each kind reads its state synchronously, untracked, right after its
// children's first run, and keeps the arm the walk adopted until the walk is
// over. An <ErrorBoundary> then rebuilds the arm its error signal names
// whenever the signal changes, as components.js's createErrorBoundary does. A <Suspense>
// is driven by its boundary record (components.js) and keeps its children
// mounted, as mountSuspense does.

// The server's closing marker for a boundary whose opening marker is `at`.
// The node a boundary's own markers start at: the opening marker of an array
// around the boundary, which the walk has not entered (an array whose members
// claim where they are created), is passed, as an element's claim passes it.
function boundaryAt(c) {
  let at = nextOwn(c);
  while (at !== null && isMarker(at, ARRAY_OPEN)) {
    c.n = at.nextSibling;
    at = nextOwn(c);
  }
  return at;
}

function boundaryClose(at) {
  return at !== null && (isMarker(at, BOUNDARY_OPEN) || isMarker(at, BOUNDARY_FALLBACK)) ? closeOf(at, BOUNDARY_CLOSE) : null;
}

// A boundary the stream has not filled in yet: `adoptFallback` adopts its
// fallback now, between the placeholder and its <!--pl-ID--> comment. Once the
// content has been swapped in, `resume(walk)` runs under the boundary's owner;
// `walk(fn)` runs `fn` in a hydration walk of the region, with the children
// numbered as the server numbered them: from where their owner's count stood
// before the fallback. Returns false when the boundary is not waiting.
function awaitStream(at, close, adoptFallback, resume) {
  const placeholder = at.nextSibling;
  if (at.data !== BOUNDARY_OPEN || placeholder === null || placeholder.nodeType !== 1
      || placeholder.localName !== 'template' || !placeholder.id.startsWith('pl-') || _swapArrived(placeholder)) return false;
  const id = placeholder.id.slice(3);
  const fallbackEnd = commentAfter(placeholder, 'pl-' + id);
  const owner = getOwner();
  const holder = _ownerCounter(_currentComponent(), session.ownerRoot);
  const counter = holder._ownerChildren;
  const { root, onError, ownerRoot } = session;
  within(at, close, () => {
    const pc = cur;
    pc.n = placeholder.nextSibling;
    if (fallbackEnd !== null) pc.e = fallbackEnd;
    adoptFallback();
    if (fallbackEnd !== null) {
      finish(pc);
      pc.e = close;
      pc.n = fallbackEnd.nextSibling;
    }
  });
  const entry = () => {
    if (waiting.get(id) === entry) waiting.delete(id);
    if (at.parentNode === null || (owner !== null && _isDisposed(owner))) return;
    runWithOwner(owner, () => resume((fn) => resumeIn(newSession(root, onError, ownerRoot), at, close, () => {
      holder._ownerChildren = counter;
      fn();
    })));
  };
  waiting.set(id, entry);
  // Unmounted before its content arrives: nothing is left waiting for it, so
  // the boundary's DOM is not kept alive by an id the stream may never send.
  onCleanup(() => {
    if (waiting.get(id) === entry) waiting.delete(id);
  });
  installResumeHook();
  return true;
}

// The fallback, adopted. The server numbered its components after the
// children it tried first, so their keys are not checked.
function adoptLeniently(content) {
  session.lenient = true;
  try {
    return createRoot((dispose) => {
      adopt(content);
      return dispose;
    });
  } finally {
    session.lenient = false;
  }
}

/**
 * <ErrorBoundary>, hydrated. Its arm is the one its error signal names once
 * the walk is over; each later change of the signal (an error, reset())
 * builds the arm it names in the region, in a root of its own under the
 * boundary's owner.
 */
function hydrateErrorBoundary(vnode) {
  const { errorState, reset, handleError } = vnode.props;
  const children = vnode.children || [];
  const contentFor = (error) => {
    if (!error) return children;
    const fallback = vnode.props.fallback;
    return typeof fallback === 'function' ? _toFunctionComponent(fallback)({ error, reset }) : fallback;
  };
  const c = cur;
  const parent = c.p;
  const owner = getOwner();
  pendingKey = null;
  const at = boundaryAt(c);
  const close = boundaryClose(at);
  /** @type {any} */
  let startComment = at;
  /** @type {any} */
  let endComment = close;
  /** @type {(() => void) | null} */
  let arm = null;
  let armAfterWalk = untrack(errorState);
  // Whether the region holds the arm `armAfterWalk` names when the walk ends.
  let regionHoldsArm = true;

  // The children, built on the client; the signal says whether they rendered.
  const buildChildren = () => clientBuild(() => createRoot((dispose) => {
    getOwner()._onError = handleError;
    const nodes = [];
    try {
      for (const child of children) {
        const node = /** @type {Function} */ (vnodeRenderer)(child, parent);
        if (node) nodes.push(node);
      }
    } catch (error) {
      handleError(error);
    }
    return { dispose, nodes };
  }));

  const adoptFallback = () => {
    arm = adoptLeniently(contentFor(armAfterWalk || true));
  };

  // <!--b-->: the children hydrate against what the server rendered.
  const adoptChildren = (bracketed) => {
    const dispose = createRoot((dispose) => {
      getOwner()._onError = handleError;
      try {
        adoptEach(children);
      } catch (error) {
        handleError(error);
      }
      return dispose;
    });
    armAfterWalk = untrack(errorState);
    if (armAfterWalk) {
      // A child threw on the client: the effect below renders the fallback
      // into the region in its place.
      dispose();
      regionHoldsArm = false;
      if (bracketed) {
        cur.n = cur.e;
        cur.o = 0;
        cur.x = false;
      }
    } else {
      arm = dispose;
    }
  };

  // <!--b!-->: children that render on the client replace the server's
  // fallback; children that throw there too keep it.
  const childrenOrFallback = () => {
    const built = buildChildren();
    armAfterWalk = untrack(errorState);
    if (armAfterWalk) {
      built.dispose();
      adoptFallback();
      return;
    }
    for (let n = cur.n; n !== null && n !== cur.e;) {
      const following = n.nextSibling;
      n.remove();
      n = following;
    }
    cur.n = cur.e;
    cur.o = 0;
    cur.x = false;
    for (const node of built.nodes) parent.insertBefore(node, cur.e);
    arm = built.dispose;
  };

  if (close === null) {
    splitHere(c);
    startComment = parent.insertBefore(document.createComment(BOUNDARY_OPEN), c.n);
    adoptChildren(false);
    splitHere(c);
    endComment = parent.insertBefore(document.createComment(BOUNDARY_CLOSE), c.n);
    watch();
    return;
  }
  if (awaitStream(at, close, adoptFallback, (walk) => {
    if (arm !== null) arm();
    arm = null;
    armAfterWalk = untrack(errorState);
    walk(() => {
      if (startComment.data === BOUNDARY_FALLBACK) childrenOrFallback();
      else adoptChildren(true);
    });
    watch();
  })) return;
  within(at, close, at.data === BOUNDARY_FALLBACK ? childrenOrFallback : () => adoptChildren(true));
  watch();

  function watch() {
    let claimedFromServer = true;
    effect(() => {
      const current = errorState();
      if (claimedFromServer) {
        claimedFromServer = false;
        if (regionHoldsArm && current === armAfterWalk) return;
      }
      const host = startComment.parentNode;
      if (!host) return;
      untrack(() => {
        if (arm !== null) arm();
        while (startComment.nextSibling && startComment.nextSibling !== endComment) host.removeChild(startComment.nextSibling);
        arm = runWithOwner(owner, () => createRoot((dispose) => {
          if (!current) getOwner()._onError = handleError;
          const content = contentFor(current);
          const vnodes = Array.isArray(content) ? content : [content];
          try {
            for (const v of vnodes) {
              const node = clientBuild(/** @type {Function} */ (vnodeRenderer), v, host);
              if (node && endComment.parentNode) endComment.parentNode.insertBefore(node, endComment);
            }
          } catch (error) {
            if (current) throw error;
            handleError(error);
          }
          return dispose;
        }));
      });
    });
  }
}

/**
 * <Suspense>, hydrated. Its boundary record (components.js) counts what the
 * children wait for, holds their onMount and useEffect until it reveals them,
 * and calls `show` and `conceal`, which this sets as mountSuspense does: the
 * children stay mounted, in the region or out of the document in `holder`
 * while the fallback stands in.
 *
 * Children the server rendered are adopted in place under the record, and
 * revealed when the walk is over: an async value read under them is the
 * server's, and a binding waiting on one the server did not send keeps the
 * server's content until it lands. Children the server did not render (it
 * showed the fallback), and children with a component that suspends while it
 * hydrates (code that has not loaded on the client: a lazy() chunk), are
 * built on the client into `holder`, and shown once nothing they wait for is
 * pending. In the first case the server's fallback is adopted meanwhile; in
 * the second, the walk's claims are dropped and the fallback is built.
 */
function hydrateSuspense(vnode) {
  const b = vnode.props.boundary;
  const children = vnode.children || [];
  const c = cur;
  const parent = c.p;
  const owner = getOwner();
  // The hydrate() call this walk belongs to, for the walk of the children
  // that reveals them later (settle): a boundary the stream fills in after
  // the page hydrated settles once that walk is over, outside any session.
  const { root, onError, ownerRoot } = session;
  pendingKey = null;
  const at = boundaryAt(c);
  const close = boundaryClose(at);
  /** @type {any} */
  let start = at;
  /** @type {any} */
  let end = close;
  const holder = document.createDocumentFragment();
  // Whether the region shows the fallback, and the root that holds it (none
  // for the server's fallback before it is adopted).
  let fallbackShown = false;
  /** @type {(() => void) | null} */
  let fallbackArm = null;
  /** @type {(() => void) | null} */
  let childrenArm = null;

  const clear = () => {
    for (let n = start.nextSibling; n !== null && n !== end; n = start.nextSibling) n.remove();
  };
  const buildFallback = () => {
    fallbackShown = true;
    const content = clientBuild(() => b.fallback);
    fallbackArm = runWithOwner(owner, () => createRoot((dispose) => {
      for (const v of Array.isArray(content) ? content : [content]) {
        const node = clientBuild(/** @type {Function} */ (vnodeRenderer), v, end.parentNode);
        if (node) end.parentNode.insertBefore(node, end);
      }
      return dispose;
    }));
  };
  b.show = () => {
    if (fallbackShown) {
      fallbackShown = false;
      if (fallbackArm !== null) fallbackArm();
      fallbackArm = null;
      clear();
    }
    end.parentNode.insertBefore(holder, end);
  };
  b.conceal = () => {
    for (let n = start.nextSibling; n !== null && n !== end; n = start.nextSibling) holder.appendChild(n);
    buildFallback();
  };

  // The children, built on the client into `holder`; shown at once when
  // nothing they read waits.
  const build = () => {
    childrenArm = runWithOwner(owner, () => clientBuild(() => createRoot((dispose) => {
      b.attach(getOwner(), false);
      for (const child of children) {
        const node = /** @type {Function} */ (vnodeRenderer)(child, parent);
        if (node) holder.appendChild(node);
      }
      return dispose;
    })));
    b.check();
  };

  const adoptFallback = () => {
    fallbackShown = true;
    fallbackArm = adoptLeniently(b.fallback);
  };

  // The children the server rendered, adopted in place.
  const adoptChildren = (bracketed) => {
    session.dropping.push(b);
    try {
      childrenArm = createRoot((dispose) => {
        b.attach(getOwner(), true);
        adoptEach(children);
        return dispose;
      });
    } finally {
      session.dropping.pop();
    }
    b.walked();
    if (!b.revealed && bracketed) {
      cur.n = cur.e;
      cur.o = 0;
      cur.x = false;
    }
  };

  // The server's fallback stands: the children are built first, and the
  // fallback is adopted while they wait.
  const childrenOrFallback = () => {
    fallbackShown = true;
    build();
    if (b.revealed) {
      cur.n = cur.e;
      cur.o = 0;
      cur.x = false;
    } else {
      adoptFallback();
    }
  };

  // After a walk of the children: a component that suspended there (code
  // that has not loaded on the client: a lazy() chunk) drops it, and the
  // server's content stays up, as the walk left it, until what the component
  // waits for has landed: the boundary's reveal then walks it again.
  const settle = () => {
    if (b.revealed || fallbackShown) return;
    if (childrenArm !== null) childrenArm();
    childrenArm = null;
    const show = b.show;
    const walk = newSession(root, onError, ownerRoot);
    b.show = () => {
      b.show = show;
      if (start.parentNode === null || (owner !== null && _isDisposed(owner))) return;
      runWithOwner(owner, () => resumeIn(walk, start, end, () => adoptChildren(true)));
    };
  };

  if (close === null) {
    splitHere(c);
    start = parent.insertBefore(document.createComment(BOUNDARY_OPEN), c.n);
    if (showsFallback(c, b)) {
      end = parent.insertBefore(document.createComment(BOUNDARY_CLOSE), /** @type {Node} */ (next(c)).nextSibling);
      within(start, end, childrenOrFallback);
    } else {
      // The children are adopted before the region they end has an end: what
      // they reveal or conceal while they are adopted waits for it.
      const { show, conceal } = b;
      let held = /** @type {(() => void) | null} */ (null);
      b.show = () => { held = show; };
      b.conceal = () => { held = conceal; };
      adoptChildren(false);
      splitHere(c);
      end = parent.insertBefore(document.createComment(BOUNDARY_CLOSE), c.n);
      b.show = show;
      b.conceal = conceal;
      if (held !== null) held();
      settle();
    }
    return;
  }
  if (awaitStream(at, close, adoptFallback, (walk) => {
    if (start.data === BOUNDARY_FALLBACK) {
      // The boundary failed on the server: its fallback stays up until the
      // children built here have rendered.
      build();
      return;
    }
    // The swap replaced the fallback with the content.
    if (fallbackArm !== null) fallbackArm();
    fallbackArm = null;
    fallbackShown = false;
    walk(() => adoptChildren(true));
    settle();
  })) return;
  within(at, close, at.data === BOUNDARY_FALLBACK ? childrenOrFallback : () => adoptChildren(true));
  settle();
}

// Whether the fallback a markerless <Suspense> would show is what the cursor
// stands on: the same tag, attributes and text.
function showsFallback(c, b) {
  const s = next(c);
  if (s === null || s.nodeType !== 1) return false;
  const built = clientBuild(() => createRoot((dispose) => {
    const fallback = b.fallback;
    if (fallback == null) return null;
    const node = typeof fallback === 'function' ? fallback() : fallback;
    const out = _isDomNode(node) ? node : /** @type {Function} */ (vnodeRenderer)(node, c.p);
    dispose();
    return out;
  }));
  return built != null && built.nodeType === 1 && built.isEqualNode(s);
}

// The `<!--pl-ID-->` comment closing a streaming boundary's fallback.
function commentAfter(placeholder, data) {
  for (let n = placeholder.nextSibling; n !== null; n = n.nextSibling) {
    if (n.nodeType === 8 && n.data === data) return n;
  }
  return null;
}

// Boundaries waiting for streamed content, by boundary id.
/** @type {Map<string, () => void>} */
const waiting = new Map();

// Hydrate the region between `start` and `end` in a walk of its own: a
// boundary whose content arrived after the page hydrated, reported to the
// hook of the hydrate() call it belongs to.
function resumeIn(walk, start, end, fn) {
  const saved = { cur, depth: outer.length, session, pendingKey };
  session = walk;
  batch(() => {
    cur = { p: start.parentNode, n: start.nextSibling, o: 0, x: false, e: end, h: true, t: null };
    pendingKey = null;
    try {
      fn();
      finish(cur);
    } finally {
      cur = saved.cur;
      outer.length = saved.depth;
      session = saved.session;
      pendingKey = saved.pendingKey;
      if (saved.depth === 0) releaseCursors();
    }
    walkDone(walk);
  });
}

/**
 * A streamed boundary's content arrived (or it failed): hydrate it now. The
 * stream's swap script calls this through `self._$W.h` once a page that
 * hydrated while the boundary was waiting has installed it, and
 * applyStreamedBoundaries() calls it for the boundaries it swaps.
 */
export function _resumeBoundary(id) {
  const resume = waiting.get(id);
  if (resume !== undefined) resume();
}

// Every tier of what-core the page loaded (each holds a copy of this module)
// waits for its own boundaries: the stream's script calls each of them.
function installResumeHook() {
  const W = /** @type {any} */ (globalThis)._$W || (/** @type {any} */ (globalThis)._$W = {});
  if (W.hs === undefined) {
    W.hs = new Set();
    W.h = (id) => { for (const resume of W.hs) resume(id); };
  }
  W.hs.add(_resumeBoundary);
}

// --- Compiled JSX built for hydration ---
//
// what-compiler's `hydratable` option compiles templates to the helpers below
// instead of cloning and walking each template with firstChild/nextSibling
// paths: the server's DOM holds what the client's holes render between the
// template's nodes, so a path computed from the template cannot reach them.
// An element's code takes its nodes in document order instead, through a
// cursor (one per entered element):
//
//   const el = _$claim(tmpl, 1);    // the template's root; 1: enter it
//   _$skip(1);                      // a static child (here, text)
//   const li = _$next(0, 1);        // the next child with bindings, entered
//   _$hole(li, () => label(), 3);   // a dynamic child, and where it goes
//   _$exit(); _$exit();
//
// While hydrating, each step claims the server's counterpart of the
// template's node: the cursor walks the template and the server's DOM in step
// (the server's text runs read across, the holes adopt what they render), and
// a node that does not match is reported and replaced by the template's own.
// Outside a hydration the same calls clone the template and step through the
// clone, so a hydratable build renders on the client too. A hole's flag says
// where a client render inserts: 0 before the next node, 1 before the `<!>`
// the template has for it, 2 at the end, 3 as the element's only content.

/** The compiler's template for hydratable output: _$template, plus the parsed root for claims. */
export function _$htemplate(html, flag) {
  /** @type {Node | null} */
  let node = null;
  const root = () => (node === null ? (node = parseTemplate(html, flag === 2)) : node);
  const clone = () => root().cloneNode(true);
  clone.root = root;
  return clone;
}

// The cursors compiled code enters, one per depth and reused: at a depth only
// one is in use at a time, and template code enters and leaves an element for
// every template it runs.
const entered = [];

// Once the outermost walk is over, the pooled cursors let go of the nodes
// they last stood on.
function releaseCursors() {
  for (let i = 0; i < entered.length; i++) {
    const c = entered[i];
    if (c !== undefined) {
      c.p = null;
      c.n = null;
      c.e = null;
      c.t = null;
    }
  }
}

function enterNode(el, t) {
  outer.push(cur);
  const depth = outer.length;
  let c = entered[depth];
  if (c === undefined) entered[depth] = c = { p: null, n: null, o: 0, x: false, e: null, h: false, t: null };
  c.p = el;
  c.n = el.firstChild;
  c.o = 0;
  c.x = false;
  c.e = null;
  c.h = t !== undefined;
  c.t = t === undefined ? null : t;
  cur = c;
}

/** A template's root: the server's element while hydrating, a clone otherwise. `flags` 1: enter it; 2: a binding writes its content. `owned`: the attributes its bindings write (keepTemplateAttrs). */
export function _$claim(tmpl, flags, owned) {
  const c = cur;
  const t = c === null || !c.h ? null : tmpl.root();
  if (t === null || (headDepth > 0 && HEAD_TAGS.has(t.localName) && next(c)?.localName !== t.localName)) {
    const el = tmpl();
    if (flags & 1) enterNode(el, undefined);
    return el;
  }
  const el = takeElement(c, t.localName);
  if (el === null) {
    const built = recover(c, tmpl(), describe(t));
    if (flags & 1) enterNode(built, undefined);
    return built;
  }
  claimNode(el, t, flags, owned);
  return el;
}

// The server's counterpart of the template node the cursor stands on, which
// is static: text read, an element claimed (its subtree is the template's),
// a `<!>` placeholder passed (a region's closing marker stands in for it).
function stepStatic(c) {
  const t = c.t;
  c.t = t.nextSibling;
  if (t.nodeType === 3) claimText(t.data);
  else if (t.nodeType === 1) claimStatic(c, t);
}

function claimStatic(c, t) {
  const el = takeElement(c, t.localName);
  if (el === null) return recover(c, t.cloneNode(true), describe(t));
  claimNode(el, t, 0);
  return el;
}

// The server's element claimed for template node `t`, entered (`flags` 1)
// for the code that follows or else claimed with its subtree, which is all
// the template's: adopted whole when the server wrote exactly the template's
// node (isEqualNode, which does not see shadow roots: hasShadowRoot), and
// otherwise claimed node by node, so each difference is reported and
// replaced. An element the template leaves empty keeps what the server put in
// it only when a binding writes its content (`flags` 2: innerHTML); anything
// else in it is left over, apart from an empty <textarea>'s text: that is its
// default, which showed the server's value and which its props write again
// (dom.js Form fields), and a <noscript>'s: the compiler leaves its content
// out of a client template, and the browser keeps what the server wrote
// there as text. `owned`: the attributes its bindings write
// (keepTemplateAttrs).
function claimNode(el, t, flags, owned) {
  if (__DEV__) watchAttrs(el, templateWants(t, owned));
  if (flags & 1) {
    keepTemplateAttrs(el, t, owned);
    enterNode(el, t.firstChild);
  } else if (!el.isEqualNode(t) || hasShadowRoot(el)) {
    keepTemplateAttrs(el, t, owned);
    if (t.localName === 'noscript') return;
    if (t.firstChild === null && t.localName === 'textarea') {
      /** @type {HTMLTextAreaElement} */ (el).defaultValue = '';
    } else if (t.firstChild !== null || (el.firstChild !== null && (flags & 2) === 0)) {
      enterNode(el, t.firstChild);
      _$exit();
    }
  }
}

// Whether an element below `el` hosts a shadow root (`el`'s own was checked
// when it was taken).
function hasShadowRoot(el) {
  for (let child = el.firstElementChild; child !== null; child = child.nextElementSibling) {
    if (child.shadowRoot != null || hasShadowRoot(child)) return true;
  }
  return false;
}

/** Step over `k` static children. */
export function _$skip(k) {
  const c = cur;
  if (c.h) {
    while (k-- > 0) stepStatic(c);
    return;
  }
  let n = c.n;
  while (k-- > 0) n = n.nextSibling;
  c.n = n;
}

/** The next child after `k` static ones: an element with bindings. `flags` 1: enter it; 2: a binding writes its content. `owned`: the attributes its bindings write (keepTemplateAttrs). */
export function _$next(k, flags, owned) {
  const c = cur;
  if (c.h) {
    while (k-- > 0) stepStatic(c);
    const t = c.t;
    c.t = t.nextSibling;
    const el = takeElement(c, t.localName);
    if (el === null) {
      const built = recover(c, t.cloneNode(true), describe(t));
      if (flags & 1) enterNode(built, undefined);
      return built;
    }
    claimNode(el, t, flags, owned);
    return el;
  }
  let n = c.n;
  while (k-- > 0) n = n.nextSibling;
  c.n = n.nextSibling;
  if (flags & 1) enterNode(n, undefined);
  return n;
}

/** A dynamic child of `parent`: adopted while hydrating, inserted where `flag` says otherwise. */
export function _$hole(parent, value, flag, devName) {
  const c = cur;
  if (c.h) {
    if (typeof value === 'function' && !value._lazyChildren && !value._mapArray) adoptRegion(value, devName);
    else adopt(value);
    if (flag === 1) c.t = c.t.nextSibling;
    return;
  }
  let marker;
  if (flag === 2) marker = null;
  else if (flag !== 3) {
    marker = c.n;
    if (flag === 1) c.n = marker.nextSibling;
  }
  insert(parent, value, marker, devName);
}

// --- Plain fields of a keyed row's item ---
//
// A keyed row's text that reads a plain field of the row's item (`{row.label}`
// in a keyed .map(), what-compiler's lowering) is a text node of its own,
// which the row's item cell rewrites when the row is handed a new item
// (reactive.js _setRowItem): no effect, region or markers per field. The
// server writes such a field as plain text when it is text (a string, a
// number; null, undefined and booleans render nothing), and the walk claims
// that text node. A value that is not text (a vnode, a function, an array) is
// a reactive child read through the cell, as any other read of the item is,
// and a later item whose field is not text has the row built again.

function fieldText(value) {
  const type = typeof value;
  if (type === 'string') return value;
  if (type === 'number') return String(value);
  if (__DEV__ && type === 'symbol') symbolChild(value);
  return value == null || type === 'boolean' || type === 'symbol' ? '' : null;
}

// Development: a Symbol child dropped here (ERR_SYMBOL_CHILD), on the path
// the render is on.
function symbolChild(value) {
  _symbolChild(value, cur !== null && cur.h ? 'hydration' : isServerRender() ? 'server' : 'client');
}

function writeField(fields, i, item) {
  const text = fieldText(fields[i + 1](item));
  if (text === null) return false;
  writeText(fields, i, text);
  return true;
}

// `text` in the field at `i`, written when it differs from the text the
// field wrote last (`fields[i + 4]`), not from its node's, as a region's text
// is: text something else wrote into the node stays until the value changes.
function writeText(fields, i, text) {
  if (fields[i + 4] === text) return;
  fields[i + 4] = text;
  const node = fieldNode(fields, i);
  node.data = text;
  if (node.parentNode !== null) textWritten(node.parentNode, text);
}

// `node` shows a field of the row whose item `cell` holds, `text` at first:
// `write(fields, i, item)` shows it for the row's next item (reactive.js
// _setRowItem). `owner` is what a plain child belongs to (writePlain).
function bindField(cell, node, read, write, owner, text) {
  const fields = cell.fields;
  if (fields === null) cell.fields = [node, read, write, owner, text];
  else fields.push(node, read, write, owner, text);
}

/**
 * A keyed row's plain field of its item, placed as insert() places a child
 * (`marker`). `elsewhere`: the compiler's 1 for a field that is not in the
 * template its row's callback returns.
 */
export function _$field(parent, cell, value, marker, read, elsewhere) {
  const text = fieldText(value);
  // Text that can go before its row does (in a region of the row that runs
  // again, in a row of a list inside the row) is not the row's to write: its
  // node would be held, and written, for as long as the row lives.
  if (text === null || (elsewhere === 1 && !fieldLives(cell, getOwner()))) {
    insert(parent, () => read(_readRowItem(cell)), marker);
    return;
  }
  bindField(cell, textAt(parent, text, marker), read, writeField, null, text);
  textWritten(parent, text);
}

/** _$field for hydratable output: placed where `flag` says (_$hole), the server's text claimed while hydrating. */
export function _$hfield(parent, cell, value, flag, read, elsewhere) {
  const c = cur;
  const text = fieldText(value);
  if (text === null || !c.h) {
    if (c.h) {
      _$hole(parent, () => read(_readRowItem(cell)), flag);
      return;
    }
    let marker;
    if (flag === 2) marker = null;
    else if (flag !== 3) {
      marker = c.n;
      if (flag === 1) c.n = marker.nextSibling;
    }
    _$field(parent, cell, value, marker, read, elsewhere);
    return;
  }
  bindField(cell, claimField(c, text), read, writeField, null, text);
  if (flag === 1) c.t = c.t.nextSibling;
}

/** _$plain for hydratable output: placed where `flag` says (_$hole); while hydrating it is the region the server rendered. */
export function _$hplain(parent, read, flag, devName) {
  const c = cur;
  if (c.h) {
    _$hole(parent, read, flag, devName);
    return;
  }
  let marker;
  if (flag === 2) marker = null;
  else if (flag !== 3) {
    marker = c.n;
    if (flag === 1) c.n = marker.nextSibling;
  }
  _$plain(parent, read, marker, devName);
}

// The server's text for a field: its text node, or its part of text the
// parser merged it with (claimOwnText), which becomes a node of its own when the
// field is first written; the client's text in its place where it differs,
// and a node of its own where the server wrote none.
function claimField(c, text) {
  pendingKey = null;
  const want = text.indexOf('\r') >= 0 ? text.replace(/\r\n?/g, '\n') : text;
  const own = want === '' ? null : claimOwnText(c, want);
  if (own !== null) return own;
  splitHere(c);
  // An empty field's node goes where the walk stands, before the server's
  // text the next claim reads (x: replaceText, adoptRegion).
  const n = c.x ? c.n : next(c);
  if (want !== '' && n !== null && n.nodeType === 3 && !frozen()) return /** @type {Text} */ (replaceText(c, text));
  const node = document.createTextNode(text);
  if (want === '') c.p.insertBefore(node, c.n);
  else recover(c, node, JSON.stringify(short(text)), n === null ? 'missing' : 'text');
  return node;
}

// --- Parts of merged text ---
// The server writes a plain value as text with no markers, so the parser
// merges it with the text around it (`Card 1 of 3` is one text node). A field
// or a region whose text lies inside such a node claims its part of it in
// place: `{ n: node, a: offset, t: text, r: null }`, listed on the node
// (`$p`), with no node split off until the value is first written (partNode),
// so a value that never changes adds no node at all. A part answers as the
// element a field that is its element's only content holds does (fieldNode):
// `nodeType` 1, and its first child the node it becomes. The walk only splits
// text at the cursor, after every part already claimed, so a node keeps the
// text before the cursor and each part's offset into it.

/** The server's text at the cursor when it is `text` (not empty): its text node when that is all the node holds, else `text`'s part of it; the cursor moved past it. Null when the server's text there is not `text`. */
function claimOwnText(c, text) {
  if (c.x) dropDiffering(c, text);
  const n = next(c);
  const at = c.o;
  if (n === null || n.nodeType !== 3 || !n.data.startsWith(text, at)) return null;
  if (at === 0 && n.data.length === text.length) {
    c.n = n.nextSibling;
    return n;
  }
  const part = { n, a: at, t: text, r: null, nodeType: 1, get firstChild() { return partNode(this); } };
  (n.$p ??= []).push(part);
  if ((c.o = at + text.length) === n.data.length) {
    c.n = n.nextSibling;
    c.o = 0;
  }
  return part;
}

// The node of its own a part becomes. Every part of its text node is split
// off at once, the last first, so each earlier part's offset still holds. A
// part whose text is no longer there (something other than What changed the
// node) writes a node of its own, which is not in the document.
function partNode(part) {
  if (part.r === null) {
    const node = part.n;
    const parts = node.$p;
    node.$p = undefined;
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k];
      const end = p.a + p.t.length;
      if (!node.data.startsWith(p.t, p.a)) p.r = document.createTextNode(p.t);
      else {
        if (end < node.data.length) node.splitText(end);
        p.r = p.a > 0 ? node.splitText(p.a) : node;
      }
    }
  }
  return part.r;
}

/** Leave the entered element: while hydrating, its remaining static children are claimed and leftovers removed. */
export function _$exit() {
  const c = cur;
  if (c.h) {
    while (c.t !== null) stepStatic(c);
    finish(c);
  }
  cur = outer.pop();
}

/** _$createComponent for hydratable output: while hydrating, the component adopts the server's nodes and the nodes come back as an array. `site` is the number what-compiler gave the JSX (hydration-data.js _assignOwnerPath). */
export function _$hcreateComponent(Component, props, children, site, devLoc) {
  return _$hcreateFn(typeof Component === 'string' ? claimedTag(Component) : asComponent(Component), props, children, site, devLoc);
}

// A tag held in a binding, in hydratable output: while hydrating, the
// server's element where the walk stands, claimed as compiled
// `<a {...props}>{props.children}</a>` claims its own (the attributes the
// props do not write go, its children are adopted); anything else is built
// as tagComponent builds it.
function claimedTag(tag) {
  const build = tagComponent(tag);
  return (props) => {
    const c = cur;
    if (c === null || !c.h) return build(props);
    const fresh = tagElement(tag);
    let el = takeElement(c, tag);
    if (el === null) enterNode(el = recover(c, fresh, `<${tag}>`), undefined);
    else {
      keepTemplateAttrs(el, fresh);
      enterNode(el, null);
    }
    _selectsFor(el);
    spread(FIELD_TAGS.has(el.localName) ? _$controlled(el) : el, props);
    _$hole(el, _place(props, 'children', 1), 3);
    _$exit();
    return el;
  };
}

/** _$hcreateComponent for a module whose every component is a plain function (_$createLazyFn). */
export function _$hcreateFn(Component, props, children, site, devLoc) {
  const c = cur;
  if (c === null || !c.h) return _$createLazyFn(Component, props, children, devLoc);
  const merged = ownProps(props);
  return adoptComponent(Component, merged, lazyProps(Component, merged, props, children), site, devLoc);
}

/**
 * A compiled array whose members claim the server's nodes in document order
 * as `build` creates them: an element or a component claims when it is
 * created, and `_$member` adopts each other member where it stands. While
 * hydrating it is built between the server's array markers, and placing it
 * afterwards adopts nothing again. `nested` 1: a member of an array other
 * code builds (a row a `.map()` callback returns), whose markers come first,
 * so the walk steps over them all. 2: a component's children, which have
 * markers of their own only where their placement is the whole value of a
 * component or a reactive child (dom.js _place).
 */
export function _$members(build, nested) {
  const c = cur;
  if (c === null || !c.h) return build();
  const at = nested === 2 ? (_takeFlat() ? null : nextOwn(c)) : nested === 1 ? null : nextOwn(c);
  const close = at !== null && isMarker(at, ARRAY_OPEN) ? closeOf(at, ARRAY_CLOSE) : null;
  /** @type {any} */
  let value;
  if (close !== null) within(at, close, (fn) => { value = fn(); }, build);
  else value = build();
  session.built.add(value);
  return value;
}

/** A `_$members` member that is not an element or a component (text, a reactive child, a list, a value): while hydrating, adopted here, as member `index`. */
export function _$member(value, index) {
  const c = cur;
  if (c !== null && c.h) adoptRow(null, index, adopt, value);
  return value;
}

// While <Head> builds its compiled children (head.js), a <title>, <meta> or
// <link> among them goes to document.head, never where Head stands, and the
// server wrote none there: one the walk does not stand on is built on the
// client and claims nothing (_$claim). Head's other children claim the
// server's nodes where they render.
let headDepth = 0;
const HEAD_TAGS = /* @__PURE__ */ new Set(['title', 'meta', 'link']);

/** @internal <Head>'s compiled children, built where the walk stands, their head tags built on the client. */
export function _headChildren(children) {
  headDepth++;
  try {
    return children();
  } finally {
    headDepth--;
  }
}

/**
 * JSX built before the walk reaches the place it renders in (assigned to a
 * variable, passed as a prop other than children): built on the client while
 * hydrating, and it takes the place of the server's copy where it is placed.
 */
export function _$outside(build) {
  const c = cur;
  if (c === null || !c.h) return build();
  const value = clientBuild(build);
  builtOutside(value);
  return value;
}

function builtOutside(value) {
  if (value === null || typeof value !== 'object') return;
  session.prebuilt.add(value);
  if (Array.isArray(value)) for (const v of value) builtOutside(v);
}
