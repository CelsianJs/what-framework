import { report, setNextBinding } from './diagnostics.js';
// What Framework - Fine-Grained DOM Runtime
// Components run ONCE. Signals create individual DOM effects.
// No VDOM reconciler, no diffing — direct DOM manipulation driven by signals.

import { effect, untrack, createRoot, getOwner, onCleanup, _currentComponent, _componentOwner, _enterOwner, _exitOwner, _isDisposed, runWithOwner, __DEV__ } from './reactive.js';
import { _renderComponent, _region, _listFragment, _valuesToNodes, _toFunctionComponent, _adoptDetached, _isDomNode, applyRef, setClassList, _writeClass } from './render.js';
import { REFUSED_ATTRS, URL_ATTRS, ATTRIBUTE_VALUE_TYPES, isAriaAttr, isUnsafeUrl, selectedOptions } from './markup-rules.js';
import { isVNode } from './vnode-renderer.js';
// SVG elements that need namespace
const SVG_ELEMENTS = new Set([
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
  'g', 'defs', 'use', 'symbol', 'clipPath', 'mask', 'pattern', 'image',
  'text', 'tspan', 'textPath', 'foreignObject', 'linearGradient', 'radialGradient', 'stop',
  'marker', 'animate', 'animateTransform', 'animateMotion', 'set', 'filter',
  'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
  'feDiffuseLighting', 'feDisplacementMap', 'feFlood', 'feGaussianBlur', 'feImage',
  'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'feSpecularLighting',
  'feTile', 'feTurbulence',
]);
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
export function _isAriaAttr(key) {
  return isAriaAttr(key);
}


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
  if (typeof container === 'string') {
    container = document.querySelector(container);
  }
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
  let frame;
  if (parent != null) {
    const saved = _enterOwner(parent);
    frame = _componentOwner(Component);
    _exitOwner(saved);
  } else {
    frame = _componentOwner(Component);
  }
  frame._parentCtx = parent !== undefined ? parent : parentFrame(frame);
  frame._outer = _enterOwner(frame);
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
  _exitOwner(frame._outer);
  frame._outer = null;
}

/** Run `fn` with an existing SSR frame as the current owner. */
export function _runInComponentSSR(frame, fn) {
  return runWithOwner(frame, fn);
}

// --- _installLazyChildren(Component, target, lazyChildren) ---
// Deferred children from compiled JSX arrive as a zero-arg factory instead of
// built DOM. This defines target.children over that factory and returns a
// function that ends the current read burst (or null when there is none).
//
// Reads are cached only for the duration of one burst, i.e. the component's own
// execution. Within a burst a component that inspects its children and then
// renders them gets one array with one set of nodes, so rendering them twice
// moves them instead of duplicating them. Across bursts the cache is dropped,
// because realized children are single-use DOM: a DocumentFragment is drained
// by its first insertion and removed nodes have had their effects disposed, so
// a component that re-reads props.children from a reactive thunk must get a
// freshly built subtree rather than the corpse of the previous one.
//
// A component that establishes a scope its children depend on (a context
// provider, an error or suspense boundary) cannot use the getter at all: the
// scope only exists after the component returns, and reading props.children
// anywhere, including destructuring it in the parameter list, would build the
// subtree first. Those set _deferChildren and receive the factory itself, which
// the render paths realize once the scope exists and which a boundary
// re-invokes to rebuild its subtree on a later attempt.
export function _installLazyChildren(Component, target, lazyChildren) {
  if (Component._deferChildren) {
    target.children = lazyChildren;
    return null;
  }
  let realized;
  let cached = false;
  let inPass = true;
  Object.defineProperty(target, 'children', {
    get() {
      if (!inPass) return lazyChildren();
      if (!cached) {
        cached = true;
        realized = lazyChildren();
      }
      return realized;
    },
    enumerable: true,
    configurable: true,
  });
  return () => { inPass = false; cached = false; realized = undefined; };
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
  let { tag: Component, props, children } = vnode;
  const proto = Component.prototype;
  if (proto && (proto.isReactComponent || proto.render)) Component = _toFunctionComponent(Component);

  const mergedProps = Object.assign(Object.create(null), props);
  if (children.length > 0) mergedProps.children = children.length === 1 ? children[0] : children;
  const lazyChildren = props && props._$lazyChildren;
  const endChildrenPass = lazyChildren ? _installLazyChildren(Component, mergedProps, lazyChildren) : null;
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

  const svgContext = isSvg || SVG_ELEMENTS.has(tag);
  const el = svgContext
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);

  // Apply props
  if (props) {
    applyProps(el, props, {}, svgContext);
  }

  // Append children
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
//     last is skipped, which leaves what the user has done since. The value a
//     prop holds is what a form reset keeps (_resetForm), any value as its
//     string (`true` is "true", as React writes it), checked as a boolean.
//   - Null or undefined releases a field the prop controlled: it shows
//     nothing (an empty value, unchecked, no option selected), and a reset
//     restores its default. A field it never controlled is left as it is.
//   - `defaultValue`, `defaultChecked`, an <option>'s `selected` and
//     `defaultSelected`, and a <select>'s `defaultValue` (the options it
//     names) are the field's default: its content attribute (what a reset
//     restores, what a server writes), which shows only while nothing has
//     controlled or changed the field.
// A select's value selects the options markup-rules' selectedOptions names.
// Its options may not be in the DOM yet (children are appended after props),
// so a value or default they do not show is written once more after them;
// a later write, null included, supersedes that retry.

/**
 * Write prop `key` of a form field `el` and return true, or return false
 * when `key` is not a field prop of `el`.
 */
export function _setFieldProp(el, key, value) {
  const tag = el.tagName;
  if (tag === 'OPTION') {
    if (key !== 'selected' && key !== 'defaultSelected') return false;
    el.defaultSelected = !!value;
    _keepSelection(el);
    return true;
  }
  if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
  const own = tag !== 'INPUT' || !ATTRIBUTE_VALUE_TYPES.has(el.type);
  if (key === 'value' && own) _setFieldValue(el, value);
  else if (key === 'defaultValue' && own) {
    if (tag === 'SELECT') setSelectDefault(el, value);
    else el.defaultValue = value == null ? '' : String(value);
  } else if (key === 'checked' && tag === 'INPUT') {
    const on = value == null ? undefined : !!value;
    if (el._$checked !== on) {
      el._$checked = on;
      el.checked = on === true;
    }
  } else if (key === 'defaultChecked' && tag === 'INPUT') {
    el.defaultChecked = !!value;
    // A default checks a radio nothing has changed, which unchecks the others
    // in its group, a radio a prop controls among them: that one is checked
    // again.
    if (value && el.type === 'radio' && el._$checked === undefined && el.form) {
      for (const other of el.form.elements) if (other._$checked && other.name === el.name) other.checked = true;
    }
  } else return false;
  return true;
}

/** The value of a text field or select (see Form fields above). */
export function _setFieldValue(el, value) {
  if (el.tagName === 'SELECT') return _setSelectValue(el, value);
  const str = value == null ? undefined : String(value);
  if (el._$value !== str) {
    el._$value = str;
    el.value = str ?? '';
  }
}

export function _setSelectValue(el, value) {
  if (value == null && el._$value === undefined) return;
  el._$value = value ?? undefined;
  const write = (el._$selectWrite = (el._$selectWrite || 0) + 1);
  if (!markOptions(el, value, 'selected')) {
    queueMicrotask(() => el._$selectWrite === write && markOptions(el, value, 'selected'));
  }
}

// Write `prop` (`selected`, or `defaultSelected`) of every option of `el`:
// true for the options `value` names, false for the rest (null names none;
// a single select then shows none, as unselecting the last option of one
// would select its first). Whether its options were there to name.
function markOptions(el, value, prop) {
  const { options } = el;
  const values = [...options].map((option) => option.value);
  const chosen = selectedOptions(values, value);
  for (let i = 0; i < options.length; i++) options[i][prop] = chosen[i];
  if (prop === 'selected' && !el.multiple && !chosen.includes(true)) el.selectedIndex = -1;
  return values.length > 0 && [value].flat().every((v) => values.includes(String(v)));
}

// An option's default (its selected attribute) can move what its select
// shows even after a script selected options (Chromium lets it; JSDOM, like
// the HTML standard, does not once an option was written): a select a value
// controls selects its options again. Called after every write of an
// option's default, and by hydration after it rewrites an option's attributes.
export function _keepSelection(option) {
  const select = option.closest('select');
  if (select !== null && select._$value !== undefined) markOptions(select, select._$value, 'selected');
}

// A select's defaultValue: the options it names are the default-selected
// ones. Written now and once more after the options are in place: hydration
// writes each option's own props after its select's, which would take the
// mark away from an option the select named.
function setSelectDefault(el, value) {
  if (value == null) return;
  el._$default = value;
  const apply = () => {
    if (el._$default !== value) return;
    markOptions(el, value, 'defaultSelected');
    if (el._$value !== undefined) markOptions(el, el._$value, 'selected');
  };
  apply();
  queueMicrotask(apply);
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
export function _setVNodeProp(el, key, value, isSvg) {
  setProp(el, key, value, isSvg);
}

function setProp(el, key, value, isSvg) {
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
    if (eventName.endsWith('Capture')) {
      eventName = eventName.slice(0, -7);
      useCapture = true;
    }
    const event = eventName.toLowerCase();
    const storageKey = useCapture ? event + '_capture' : event;
    const old = el._events?.[storageKey];
    if (old && old._original === value) return;
    if (old) el.removeEventListener(event, old, useCapture);
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
        el.removeEventListener(event, wrappedHandler, eventOpts || useCapture || undefined);
        if (el._events[storageKey] === wrappedHandler) delete el._events[storageKey];
        return;
      }
      if (!e.nativeEvent) e.nativeEvent = e;
      return untrack(() => wrappedHandler._handler(e));
    };
    wrappedHandler._handler = value;
    wrappedHandler._original = value;
    el._events[storageKey] = wrappedHandler;
    const eventOpts = value._eventOpts;
    el.addEventListener(event, wrappedHandler, eventOpts || useCapture || undefined);
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

  // Style
  if (key === 'style') {
    if (typeof value === 'string') {
      el.style.cssText = value;
      el._prevStyle = null;
    } else if (typeof value === 'object') {
      // The object is the element's whole inline style: the first one replaces
      // what the element had (a string's declarations, the server's).
      const oldStyle = el._prevStyle;
      if (oldStyle == null) {
        if (el.hasAttribute('style')) el.removeAttribute('style');
      } else {
        for (const prop in oldStyle) {
          if (!(prop in value)) el.style[prop] = '';
        }
      }
      for (const prop in value) {
        el.style[prop] = value[prop] ?? '';
      }
      el._prevStyle = { ...value };
    }
    return;
  }

  // dangerouslySetInnerHTML
  if (key === 'dangerouslySetInnerHTML') {
    const html = value?.__html ?? '';
    if (__DEV__ && typeof html === 'string' && /(<script|onerror\s*=|onload\s*=|javascript:)/i.test(html)) {
      console.warn('[what] dangerouslySetInnerHTML contains potential XSS vectors. Ensure content is sanitized.');
    }
    el.innerHTML = html;
    return;
  }

  // innerHTML — require { __html: ... } wrapper to prevent XSS
  if (key === 'innerHTML') {
    if (value == null) return; // null/undefined — do nothing
    if (value && typeof value === 'object' && '__html' in value) {
      const html = value.__html ?? '';
      if (__DEV__ && typeof html === 'string' && /(<script|onerror\s*=|onload\s*=|javascript:)/i.test(html)) {
        console.warn('[what] dangerouslySetInnerHTML contains potential XSS vectors. Ensure content is sanitized.');
      }
      el.innerHTML = html;
    } else {
      // Refuse to set raw string innerHTML — prevent XSS
      if (__DEV__) report('ERR_UNSAFE_INNERHTML', { subject: { kind: 'element', name: el.localName } });
      return;
    }
    return;
  }

  // A form field's state, before the nullish and boolean branches below,
  // which would write its value as its default (Form fields above).
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
  // boolean syntax. See _isAriaAttr.
  // data-* joins aria-* here rather than falling through to the boolean branch
  // below. Both are enumerated: `data-open="false"` is a distinct state from an
  // absent `data-open`, and `[data-open="false"]` is an ordinary CSS selector,
  // so collapsing false to "remove the attribute" throws information away.
  // The compiled path in render.js has always stringified these, so keeping the
  // generic boolean branch first is also what made an SSR page disagree with
  // its own compiled client on hydration.
  if (_isAriaAttr(key) || key.startsWith('data-')) {
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

// A form's reset after its action succeeded (what-server's <Form>), as React 19
// resets one: its uncontrolled fields go back to their defaults, and a
// controlled field (a value or checked prop) keeps the value its prop holds.
// The form's own reset and elements, read from its prototype: a control named
// "reset" or "elements" shadows them on the form itself. A write that throws
// (a control's own setter, a custom element's formResetCallback) goes to
// `onError`, and every other field is still restored.
export function _resetForm(form, onError) {
  const proto = Object.getPrototypeOf(form);
  const fields = [...Reflect.get(proto, 'elements', form)];
  const held = fields.map((el) => [el._$value, el._$checked]);
  const attempt = (write) => {
    try { write(); } catch (error) { onError(error); }
  };
  attempt(() => proto.reset.call(form));
  fields.forEach((el, i) => {
    const [value, checked] = held[i];
    if (value !== undefined) attempt(() => (el.tagName === 'SELECT' ? _setSelectValue(el, value) : (el.value = value)));
    if (checked !== undefined) attempt(() => { el.checked = checked; });
  });
}
