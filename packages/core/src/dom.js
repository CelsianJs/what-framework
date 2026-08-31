// What Framework - Fine-Grained DOM Runtime
// Components run ONCE. Signals create individual DOM effects.
// No VDOM reconciler, no diffing — direct DOM manipulation driven by signals.

import { effect, untrack, signal, __DEV__, __devtools } from './reactive.js';
import { reportError, _injectGetCurrentComponent } from './components.js';
import { _setComponentRef } from './helpers.js';
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
// Attributes whose value is a URL: reject javascript:, data:, vbscript:
// protocols (case-insensitive, trimmed). xlink:href matters because SVG <a>
// executes it, and ping/object[data] are fetched by the browser.
const URL_ATTRS = new Set([
  'href', 'src', 'action', 'formaction', 'formAction',
  'data', 'ping', 'xlink:href', 'xlinkHref',
]);

// srcdoc is entity-decoded and parsed as a document by the browser, so HTML
// escaping is not a defense. Refuse it outright rather than trying to clean it.
const REFUSED_ATTRS = new Set(['srcdoc', 'srcDoc']);

function isSafeUrl(url) {
  if (url == null) return true;
  // A boxed String or an object with toString() still stringifies into a live
  // href, so coerce before the protocol check rather than trusting the type.
  // A value with no usable toString (Object.create(null), { toString: null },
  // both reachable from JSON) throws here, so refuse it rather than letting the
  // TypeError abort the render.
  let normalized;
  try {
    normalized = String(url).trim().replace(/[\s\x00-\x1f]/g, '').toLowerCase();
  } catch {
    return false;
  }
  if (normalized.startsWith('javascript:')) return false;
  if (normalized.startsWith('data:')) return false;
  if (normalized.startsWith('vbscript:')) return false;
  return true;
}

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
  if (REFUSED_ATTRS.has(key) || REFUSED_ATTRS.has(lower)) return true;
  if (!URL_ATTRS.has(key) && !URL_ATTRS.has(lower)) return false;
  return !isSafeUrl(value);
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
  return key === 'role' || key.startsWith('aria-');
}

// Track all mounted component contexts for disposal
const mountedComponents = new Set();

// WeakMap: comment node → component context (for comment-node boundaries)
const _commentCtxMap = new WeakMap();

function isDomNode(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof Node !== 'undefined' && value instanceof Node) return true;
  return typeof value.nodeType === 'number' && typeof value.nodeName === 'string';
}

function isVNode(value) {
  return !!value && typeof value === 'object' && (value._vnode === true || 'tag' in value);
}

// Dispose a component: run effect cleanups, hook cleanups, onCleanup callbacks
function disposeComponent(ctx) {
  if (ctx.disposed) return;
  ctx.disposed = true;

  // Run cleanup callbacks
  if (ctx.cleanups) {
    for (const cleanup of ctx.cleanups) {
      try { cleanup(); } catch (e) { console.error('[what] cleanup error:', e); }
    }
  }

  // Run effect disposals
  if (ctx.effects) {
    for (const dispose of ctx.effects) {
      try { dispose(); } catch { /* already disposed */ }
    }
  }

  // Run hook cleanups (useEffect return values)
  if (ctx.hooks) {
    for (const hook of ctx.hooks) {
      if (hook && typeof hook.cleanup === 'function') {
        try { hook.cleanup(); } catch (e) { console.error('[what] hook cleanup error:', e); }
      }
    }
  }

  // Run onCleanup callbacks
  if (ctx._cleanupCallbacks) {
    for (const fn of ctx._cleanupCallbacks) {
      try { fn(); } catch (e) { console.error('[what] onCleanup error:', e); }
    }
  }

  if (__DEV__ && __devtools?.onComponentUnmount) __devtools.onComponentUnmount?.(ctx);
  mountedComponents.delete(ctx);
}

// Hydration has no wrapper fragment and no comment markers to hang a component
// ctx or a reactive-child effect on, so it anchors them to the DOM node they
// produced. Without an anchor disposeTree cannot reach them and every hydrated
// component leaks its cleanups and effects.
export function addHydrationDisposer(node, fn) {
  if (!node || typeof fn !== 'function') return;
  if (node._hydrationDisposers) node._hydrationDisposers.push(fn);
  else node._hydrationDisposers = [fn];
}

export function addHydratedComponent(node, ctx) {
  addHydrationDisposer(node, () => disposeComponent(ctx));
}

// Dispose all components and reactive effects attached to a DOM subtree.
// Performance: checks _componentCtx / _dispose / _propEffects before walking
// children, and only checks _commentCtxMap for comment nodes (nodeType 8).
export function disposeTree(node) {
  if (!node) return;
  if (node._componentCtx) {
    disposeComponent(node._componentCtx);
  }
  if (node._hydrationDisposers) {
    const disposers = node._hydrationDisposers;
    node._hydrationDisposers = null;
    for (let i = 0; i < disposers.length; i++) {
      try { disposers[i](); } catch { /* already disposed */ }
    }
  }
  // Check comment node WeakMap for component context — only for comment nodes
  if (node.nodeType === 8) {
    const commentCtx = _commentCtxMap.get(node);
    if (commentCtx) {
      disposeComponent(commentCtx);
    }
  }
  // Dispose reactive function child effects ({() => ...} wrappers)
  if (node._dispose) {
    try { node._dispose(); } catch { /* already disposed */ }
  }
  // Dispose reactive prop effects (value: () => ..., class: () => ..., etc.)
  if (node._propEffects) {
    for (const key in node._propEffects) {
      try { node._propEffects[key](); } catch { /* already disposed */ }
    }
  }
  // Recursively dispose children
  const children = node.childNodes;
  if (children && children.length > 0) {
    for (let i = 0; i < children.length; i++) {
      disposeTree(children[i]);
    }
  }
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

// Mount a component tree into a DOM container
export function mount(vnode, container) {
  if (typeof container === 'string') {
    container = document.querySelector(container);
  }
  disposeTree(container); // Clean up any previous mount
  container.textContent = '';
  const node = createDOM(vnode, container);
  if (node) container.appendChild(node);
  return () => {
    disposeTree(container);
    container.textContent = '';
  };
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
  if (isDomNode(vnode)) {
    return vnode;
  }

  // Self-managing list inserter (mapArray) — it owns its own end marker and
  // reconciliation effect and expects to be called as (parent, marker), NOT as
  // a zero-arg reactive accessor. Reached when a keyed `.map()` is the child of
  // a fragment-as-root (e.g. `<>{items().map(...)}</>`), which the compiler
  // lowers to a bare `_$mapArray(...)`. Without this special-case the generic
  // function branch below would call vnode() with no parent and throw.
  if (typeof vnode === 'function' && vnode._mapArray) {
    const frag = document.createDocumentFragment();
    // Open the list with a start marker, the same bracket shape the reactive
    // region below uses, and for the same reason: whoever embeds this fragment
    // has to be able to find the list's content LATER, not just now.
    //
    // A list reached through here is embedded in some other region's value —
    // `{cond && <>{items.map(...)}<p/></>}` and every variation of it. That
    // region records the nodes it inserted and reuses the record as its removal
    // set on the next run. The record is a snapshot, and the list is not
    // snapshot-shaped: it owns an effect and goes on inserting and removing rows
    // for as long as it is mounted. Rows appended after mount were absent from
    // the record, so switching the region off removed the mount-time rows and
    // orphaned the rest — and switching it back on rendered a second, complete
    // list beside the orphans.
    //
    // Two markers describe a moving target that a list of nodes cannot:
    // everything the list ever inserts lands between them, so reconcileInsert
    // (render.js) can sweep the live range at teardown instead of trusting the
    // snapshot. `_rangeEnd` is the pairing it reads.
    const startMarker = document.createComment('list');
    frag.appendChild(startMarker);
    // Passing a null marker makes the inserter APPEND its own `/list` end marker
    // to `frag` (insertBefore(node, null) is an append) and insert every row
    // before it, so the list closes the range itself and no second bookend is
    // needed. Once `frag` is appended to the real DOM the markers and the rows
    // between them carry over together.
    /** @type {any} */ (startMarker)._rangeEnd = vnode(frag, null);
    return frag;
  }

  // Deferred component children (compiled JSX). The value is static (the
  // factory only exists so the owning component runs before its children are
  // built), so realize it in place rather than through the reactive path below.
  if (typeof vnode === 'function' && vnode._lazyChildren) {
    return createDOM(vnode(), parent, isSvg);
  }

  // Reactive function child — use comment markers (no wrapper element)
  // to avoid polluting the DOM and breaking CSS selectors like :first-child.
  if (typeof vnode === 'function') {
    const startMarker = document.createComment('fn');
    const endMarker = document.createComment('/fn');
    let currentNodes = [];
    // We need a parent to insert between markers. The caller (createElementFromVNode
    // or createComponent) will appendChild both markers and the content. We return
    // a document fragment containing start marker, then the effect will manage nodes
    // between start and end markers once they're in the real DOM.
    const frag = document.createDocumentFragment();
    frag.appendChild(startMarker);
    frag.appendChild(endMarker);

    // Capture the owning component at CREATION time.
    //
    // This effect re-runs long after the synchronous render that created it,
    // when the component stack is empty. Everything it builds on a re-run
    // therefore got `parentCtx = null`, severing the owner chain, and the two
    // things that walk that chain both went blind:
    //   - suspend() found no Suspense boundary, so a lazy() component reached by
    //     a signal update (any client-side navigation) threw its pending promise
    //     as an uncaught error and left the region permanently empty.
    //   - the ErrorBoundary lookup found nothing, so a throw from a component
    //     rendered after any state change escaped the boundary wrapping it.
    // Both worked on first paint and only failed once the app was interactive.
    const owner = componentStack[componentStack.length - 1] || null;

    const dispose = effect(() => {
      // Already on top during the initial synchronous run; only re-push when the
      // stack has since unwound.
      const restoreOwner = owner !== null && componentStack[componentStack.length - 1] !== owner;
      if (restoreOwner) componentStack.push(owner);
      try {
      const val = vnode();
      const vnodes = (val == null || val === false || val === true)
        ? []
        : Array.isArray(val) ? val : [val];

      const realParent = endMarker.parentNode;
      if (!realParent) return; // not mounted yet — first run handled below

      // Remove old nodes between markers. The removal set is the LIVE one: a
      // list or a nested region inside this one has been replacing its own
      // nodes since they were recorded, and what it produced late is just as
      // much this region's to remove as what it produced at mount.
      for (const old of _liveRegionNodes(currentNodes)) {
        disposeTree(old);
        if (old.parentNode === realParent) realParent.removeChild(old);
      }
      currentNodes = [];

      // Add new nodes before endMarker
      for (const v of vnodes) {
        const node = createDOM(v, realParent, parent?._isSvg);
        if (node) {
          // If createDOM returned a DocumentFragment, track individual children
          // since fragment nodes get absorbed into the DOM on insertion.
          if (node.nodeType === 11 /* DOCUMENT_FRAGMENT_NODE */) {
            const children = Array.from(node.childNodes);
            realParent.insertBefore(node, endMarker);
            for (const child of children) currentNodes.push(child);
          } else {
            realParent.insertBefore(node, endMarker);
            currentNodes.push(node);
          }
        }
      }
      } finally {
        if (restoreOwner) componentStack.pop();
      }
    });

    startMarker._dispose = dispose;
    // Also store dispose on endMarker so disposeTree can find it from either marker
    endMarker._dispose = dispose;
    // This region manages itself, so an OUTER region that embeds it cannot
    // describe it with a list of nodes: everything between the markers is
    // replaced whenever this effect re-runs. Pairing them lets the outer
    // teardown sweep the live range. See _liveRegionNodes.
    /** @type {any} */ (startMarker)._rangeEnd = endMarker;
    return frag;
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

  // VNode with component tag — component runs ONCE
  if (isVNode(vnode) && typeof vnode.tag === 'function') {
    return createComponent(vnode, parent, isSvg);
  }

  // VNode with special boundary tags — route to boundary handlers
  if (isVNode(vnode) && typeof vnode.tag === 'string') {
    if (vnode.tag === '__errorBoundary') return createErrorBoundary(vnode, parent);
    if (vnode.tag === '__suspense') return createSuspenseBoundary(vnode, parent);
    if (vnode.tag === '__portal') return createPortalDOM(vnode, parent);
    return createElementFromVNode(vnode, parent, isSvg);
  }

  // Unknown — convert to text
  return document.createTextNode(String(vnode));
}

// --- Component Rendering ---
// Components run ONCE. Props are passed as a signal for reactive access.

// Shared Proxy handler for reactive props — defined once, reused by all components.
// The Proxy target must be a plain object (not a function) so that ownKeys
// invariants are satisfied. The propsSignal is stored as target._sig.
const _propsProxyHandler = {
  get(target, key) {
    if (key === '_sig') return undefined; // hide internal property
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
    return target._sig()[key];
  },
  has(target, key) {
    if (key === '_sig') return false;
    return key in target._sig();
  },
  ownKeys(target) {
    return Reflect.ownKeys(target._sig());
  },
  getOwnPropertyDescriptor(target, key) {
    if (key === '_sig') return undefined;
    const current = target._sig();
    if (key in current) {
      return { value: current[key], writable: false, enumerable: true, configurable: true };
    }
    return undefined;
  },
  set(_target, _key) {
    // Props are read-only from the component's perspective.
    // Reject all writes — especially dangerous prototype-chain keys.
    return false;
  },
};

const componentStack = [];

export function getCurrentComponent() {
  return componentStack[componentStack.length - 1];
}

// Inject into components.js and helpers.js to avoid circular imports
_injectGetCurrentComponent(getCurrentComponent);
_setComponentRef(getCurrentComponent);

export function getComponentStack() {
  return componentStack;
}

/**
 * Run a component during SSR under a real component context.
 *
 * renderToString used to call `vnode.tag(props)` directly, with nothing on the
 * component stack. Every hook that needs a context (useState, useSignal,
 * useComputed, useEffect, useMemo, useCallback, useRef, useReducer, onMount,
 * onCleanup, and Context.Provider) resolves it through getCurrentComponent(),
 * so all of them threw on the server. A single useState anywhere in the tree
 * meant the component could not be server-rendered at all: the page failed at
 * render time, not with a hydration warning.
 *
 * The context is the same shape createComponent and the hydration path build,
 * for the same reason: `useContext` walks `_parentCtx`, so a Provider's context
 * has to stay on the stack while its children render. Hence the callback.
 *
 * Nothing here ever mounts, so nothing deferred may run. Every hook that defers
 * work (useEffect in all three of its dep shapes) re-checks `ctx.disposed`
 * inside its microtask, and onMount/onCleanup only collect callbacks that a
 * mount would later invoke. _endComponentSSR marks the context disposed, which
 * is what makes an SSR render leave no live effects behind.
 *
 * Begin/end rather than a wrapper callback because one of the three SSR call
 * sites is a generator: renderToStream has to hold the frame open across yields
 * until the subtree has finished streaming.
 *
 * Always pair these in a try/finally.
 */
export function _beginComponentSSR(Component) {
  const ctx = {
    hooks: [],
    hookIndex: 0,
    /** @type {Array<() => void>} */
    effects: [],
    cleanups: [],
    mounted: false,
    disposed: false,
    Component,
    _parentCtx: componentStack[componentStack.length - 1] || null,
    _errorBoundary: null,
  };
  componentStack.push(ctx);
  return ctx;
}

export function _endComponentSSR(ctx) {
  const top = componentStack[componentStack.length - 1];
  // Defensive: an async component that interleaved with another render could
  // otherwise pop someone else's frame and silently reparent every context
  // lookup after it.
  if (top === ctx) componentStack.pop();
  ctx.disposed = true;
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
// Symbol.for('what.navigation.signal'). what-router's redirect() throws one, so
// a redirect from a component body runs the navigation instead of reaching an
// ErrorBoundary, which would render error UI for a value that is not an error.
// Returns true when the value was a signal and has been handled.
//
// Both component paths route through this (createComponent below and the
// hydration branch in render.js) so the two cannot drift.
const NAV_SIGNAL = Symbol.for('what.navigation.signal');

export function _handleNavigationSignal(error) {
  if (error == null) return false;
  const handler = error[NAV_SIGNAL];
  if (typeof handler !== 'function') return false;
  handler(error);
  return true;
}

function createComponent(vnode, parent, isSvg) {
  let { tag: Component, props, children } = vnode;

  // Class component detection
  if (typeof Component === 'function' &&
      (Component.prototype?.isReactComponent || Component.prototype?.render)) {
    const ClassComp = Component;
    Component = function ClassComponentBridge(props) {
      const instance = new ClassComp(props);
      return instance.render();
    };
    Component.displayName = ClassComp.displayName || ClassComp.name || 'ClassComponent';
  }

  // Handle special boundary components
  if (Component === '__errorBoundary' || vnode.tag === '__errorBoundary') {
    return createErrorBoundary(vnode, parent);
  }
  if (Component === '__suspense' || vnode.tag === '__suspense') {
    return createSuspenseBoundary(vnode, parent);
  }
  if (Component === '__portal' || vnode.tag === '__portal') {
    return createPortalDOM(vnode, parent);
  }

  // Component context for hooks
  // Error boundary lookup: walk the parent chain once, cache the result.
  const parentCtx = componentStack[componentStack.length - 1] || null;
  let errorBoundary = null;
  if (parentCtx) {
    // Fast path: if parent has an error boundary, use it directly
    errorBoundary = parentCtx._errorBoundary || null;
    if (!errorBoundary) {
      let p = parentCtx._parentCtx;
      while (p) {
        if (p._errorBoundary) { errorBoundary = p._errorBoundary; break; }
        p = p._parentCtx;
      }
    }
  }
  const ctx = {
    hooks: [],
    hookIndex: 0,
    /** @type {Array<() => void>} */
    effects: [],
    cleanups: [],
    mounted: false,
    disposed: false,
    Component,
    _parentCtx: parentCtx,
    _errorBoundary: errorBoundary,
  };

  // Component boundaries: use comment nodes instead of <span style="display:contents">
  // to avoid DOM pollution, CSS selector breakage, and a11y issues.
  const startComment = document.createComment('c:start');
  const endComment = document.createComment('c:end');
  _commentCtxMap.set(startComment, ctx);
  ctx._startComment = startComment;
  ctx._endComment = endComment;

  // Fragment to hold comment boundaries + component output
  const container = document.createDocumentFragment();
  container._componentCtx = ctx;
  ctx._wrapper = startComment; // Reference for context lookup

  // Track for disposal
  mountedComponents.add(ctx);
  if (__DEV__ && __devtools?.onComponentMount) __devtools.onComponentMount?.(ctx);

  // Props signal for reactive updates from parent
  const propsChildren = children.length === 0 ? undefined : children.length === 1 ? children[0] : children;
  // Merge children into props without spreading when possible
  let mergedProps;
  if (propsChildren !== undefined) {
    mergedProps = props ? Object.assign({}, props, { children: propsChildren }) : { children: propsChildren };
  } else {
    mergedProps = props ? Object.assign({}, props) : {};
  }
  const lazyChildren = props && props._$lazyChildren;
  const endChildrenPass = lazyChildren ? _installLazyChildren(Component, mergedProps, lazyChildren) : null;

  const propsSignal = signal(mergedProps);
  ctx._propsSignal = propsSignal;

  // Create a reactive props proxy: reading any prop inside an effect
  // will auto-track the dependency on the propsSignal. This makes prop
  // access reactive across re-renders without requiring the component
  // to be re-executed.
  // Reuse shared trap handlers to minimize per-component allocation.
  // Store propsSignal on a plain object target (Proxy invariant: ownKeys must
  // match non-configurable own properties of target; functions have 'prototype').
  const reactiveProps = new Proxy({ _sig: propsSignal }, _propsProxyHandler);

  // Component runs ONCE — not inside an effect.
  // untrack() prevents the component's signal reads and effect creation
  // from being captured by any parent effect (e.g., reconcileInsert).
  // Without this, dynamically-rendered components leak their internal
  // reactivity into the parent, causing infinite re-creation loops.
  componentStack.push(ctx);

  let result;
  try {
    result = untrack(() => Component(reactiveProps));
  } catch (error) {
    componentStack.pop();
    // A thrown thenable is a suspension, not a failure: hand it to the nearest
    // Suspense boundary, which swaps in its fallback and re-renders on resolve.
    // A navigation signal is neither: it carries its own handler.
    if (!_handleNavigationSignal(error)
        && !(error && typeof error.then === 'function' && suspend(error, ctx))
        && !reportError(error, ctx)) {
      console.error('[what] Uncaught error in component:', Component.name || 'Anonymous', error);
      throw error;
    }
    // Return fragment with just comment boundaries on error
    container.appendChild(startComment);
    container.appendChild(endComment);
    return container;
  }
  // The component has run; anything that reads props.children from here on is a
  // later render pass and must build its own children.
  if (endChildrenPass) endChildrenPass();

  ctx.mounted = true;

  // Run onMount callbacks after DOM is ready
  if (ctx._mountCallbacks) {
    queueMicrotask(() => {
      if (ctx.disposed) return;
      for (const fn of ctx._mountCallbacks) {
        try { fn(); } catch (e) { console.error('[what] onMount error:', e); }
      }
    });
  }

  // Build fragment: <!-- c:start --> [component output] <!-- c:end -->
  // ctx stays on the stack while children are realized so that a child's
  // parentCtx (and therefore useContext / error-boundary lookup) resolves to
  // this component rather than to whatever rendered it.
  container.appendChild(startComment);
  const vnodes = Array.isArray(result) ? result : [result];
  try {
    for (const v of vnodes) {
      const node = createDOM(v, container, isSvg);
      if (node) container.appendChild(node);
    }
  } finally {
    componentStack.pop();
  }
  container.appendChild(endComment);

  return container;
}

// Walk up from ctx to the nearest Suspense boundary and notify it. Returns
// false when nothing in the chain can handle the suspension.
function suspend(promise, ctx) {
  let c = ctx;
  while (c) {
    if (c._suspenseBoundary) {
      c._suspenseBoundary.onSuspend(promise);
      return true;
    }
    c = c._parentCtx;
  }
  return false;
}

// Error boundary component handler
function createErrorBoundary(vnode, parent) {
  const { errorState, handleError, fallback, reset } = vnode.props;
  const children = vnode.children;

  // Use comment node boundaries instead of <span style="display:contents">
  // to avoid DOM pollution, CSS selector breakage, and a11y issues.
  const startComment = document.createComment('eb:start');
  const endComment = document.createComment('eb:end');

  const boundaryCtx = {
    hooks: /** @type {any[]} */ ([]), hookIndex: 0,
    effects: /** @type {Array<() => void>} */ ([]),
    cleanups: /** @type {Array<() => void>} */ ([]),
    mounted: false, disposed: false,
    _parentCtx: componentStack[componentStack.length - 1] || null,
    _errorBoundary: handleError,
    _startComment: startComment,
    _endComment: endComment,
  };
  _commentCtxMap.set(startComment, boundaryCtx);

  const container = document.createDocumentFragment();
  container._componentCtx = boundaryCtx;
  container.appendChild(startComment);
  container.appendChild(endComment);

  const dispose = effect(() => {
    const error = errorState();

    componentStack.push(boundaryCtx);

    // Remove old content between comment boundaries
    const openParent = startComment.parentNode;
    if (openParent) {
      while (startComment.nextSibling && startComment.nextSibling !== endComment) {
        const old = startComment.nextSibling;
        disposeTree(old);
        openParent.removeChild(old);
      }
    }

    let vnodes;
    if (error) {
      vnodes = typeof fallback === 'function' ? [fallback({ error, reset })] : [fallback];
    } else {
      vnodes = children;
    }

    vnodes = Array.isArray(vnodes) ? vnodes : [vnodes];

    for (const v of vnodes) {
      const node = createDOM(v, parent);
      if (node) {
        // Insert before endComment
        if (endComment.parentNode) {
          endComment.parentNode.insertBefore(node, endComment);
        } else {
          // Still in fragment before first mount
          container.insertBefore(node, endComment);
        }
      }
    }

    componentStack.pop();
  });

  boundaryCtx.effects.push(dispose);
  return container;
}

// Suspense boundary component handler
function createSuspenseBoundary(vnode, parent) {
  const { boundary, fallback, loading } = vnode.props;
  const children = vnode.children;

  // Use comment node boundaries instead of <span style="display:contents">
  // to avoid DOM pollution, CSS selector breakage, and a11y issues.
  const startComment = document.createComment('sb:start');
  const endComment = document.createComment('sb:end');

  const boundaryCtx = {
    hooks: /** @type {any[]} */ ([]), hookIndex: 0,
    effects: /** @type {Array<() => void>} */ ([]),
    cleanups: /** @type {Array<() => void>} */ ([]),
    mounted: false, disposed: false,
    _parentCtx: componentStack[componentStack.length - 1] || null,
    _suspenseBoundary: boundary,
    _startComment: startComment,
    _endComment: endComment,
  };
  _commentCtxMap.set(startComment, boundaryCtx);

  const container = document.createDocumentFragment();
  container._componentCtx = boundaryCtx;
  container.appendChild(startComment);
  container.appendChild(endComment);

  // A child suspending mid-render flips `loading` while this effect is still
  // running, which can re-enter it. The generation counter lets the outer run
  // detect that a newer run already replaced the content and bail out.
  let generation = 0;

  const dispose = effect(() => {
    const isLoading = loading();
    const vnodes = isLoading ? [fallback] : children;
    const normalized = Array.isArray(vnodes) ? vnodes : [vnodes];
    const gen = ++generation;

    componentStack.push(boundaryCtx);

    // Remove old content between comment boundaries
    const openParent = startComment.parentNode;
    if (openParent) {
      while (startComment.nextSibling && startComment.nextSibling !== endComment) {
        const old = startComment.nextSibling;
        disposeTree(old);
        openParent.removeChild(old);
      }
    }

    try {
      for (const v of normalized) {
        const node = createDOM(v, parent);
        if (gen !== generation) {
          if (node) disposeTree(node);
          break;
        }
        if (node) {
          // Insert before endComment
          if (endComment.parentNode) {
            endComment.parentNode.insertBefore(node, endComment);
          } else {
            // Still in fragment before first mount
            container.insertBefore(node, endComment);
          }
        }
      }
    } finally {
      componentStack.pop();
    }
  });

  boundaryCtx.effects.push(dispose);
  return container;
}

// Portal component handler
function createPortalDOM(vnode, _parent) {
  const { container } = vnode.props;
  const children = vnode.children;

  if (!container) {
    console.warn('[what] Portal: target container not found');
    return document.createComment('portal:empty');
  }

  const portalCtx = {
    hooks: /** @type {any[]} */ ([]), hookIndex: 0,
    effects: /** @type {Array<() => void>} */ ([]),
    cleanups: /** @type {Array<() => void>} */ ([]),
    mounted: false, disposed: false,
    _parentCtx: componentStack[componentStack.length - 1] || null,
  };

  const placeholder = document.createComment('portal');
  placeholder._componentCtx = portalCtx;

  const portalNodes = [];
  for (const child of children) {
    const node = createDOM(child, container);
    if (node) {
      container.appendChild(node);
      portalNodes.push(node);
    }
  }

  portalCtx._cleanupCallbacks = [() => {
    for (const node of portalNodes) {
      disposeTree(node);
      if (node.parentNode) node.parentNode.removeChild(node);
    }
  }];

  return placeholder;
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

  el._vnode = vnode;
  return el;
}

// --- Prop Application ---
// Only applied once for fine-grained (no diffing). Reactive props use effects.

function applyProps(el, newProps, oldProps, isSvg) {
  if (!newProps) return;

  for (const key in newProps) {
    if (key === 'key' || key === 'children') continue;

    // Handle ref
    if (key === 'ref') {
      const ref = newProps.ref;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
      continue;
    }

    setProp(el, key, newProps[key], isSvg);
  }
}

// <select> needs its value set after <option> children mount. Setting it
// immediately can fail if the matching <option> isn't in the DOM yet; the
// microtask retry fixes up after the options are appended.
export function _setSelectValue(el, value) {
  el.value = value;
  if (el.value !== String(value)) {
    queueMicrotask(() => { el.value = value; });
  }
}

// NOTE: there are intentionally TWO `setProp` implementations in this codebase:
//   - dom.js setProp (this one) — h()/createDOM/diff-style path. Handles
//     addEventListener bookkeeping (el._events with capture variants and the
//     untrack wrapper), supports `isSvg` flag from the caller. Used by the
//     legacy diff-driven update path.
//   - render.js setProp — fine-grained-compiler output path. No event-handler
//     bookkeeping (events go through delegation / direct addEventListener at
//     compile time), but adds the innerHTML `{__html}` enforcement that the
//     compiler relies on.
// Both share the `el._propEffects[key]` disposer convention and both gate
// attributes through _isUnsafeAttr() so URL sanitization cannot diverge. Do not
// merge without consolidating the event/listener model: they have different callers.
function setProp(el, key, value, isSvg) {
  // Reactive function props — wrap in effect for fine-grained updates
  if (typeof value === 'function' && !_isEventProp(key) && key !== 'ref') {
    if (!el._propEffects) el._propEffects = {};
    if (el._propEffects[key]) {
      try { el._propEffects[key](); } catch { /* already disposed */ }
    }
    el._propEffects[key] = effect(() => {
      const resolved = value();
      setProp(el, key, resolved, isSvg);
    });
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
    // signal subscriptions inside event handlers.
    const wrappedHandler = (e) => {
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

  // Reject dangerous URL protocols and srcdoc
  if (_isUnsafeAttr(key, value)) {
    if (typeof console !== 'undefined') {
      console.warn(`[what] Blocked unsafe URL in "${key}" attribute:`, value);
    }
    return;
  }

  // className / class
  if (key === 'className' || key === 'class') {
    if (isSvg) {
      el.setAttribute('class', value || '');
    } else {
      el.className = value || '';
    }
    return;
  }

  // Style
  if (key === 'style') {
    if (typeof value === 'string') {
      el.style.cssText = value;
      el._prevStyle = null;
    } else if (typeof value === 'object') {
      const oldStyle = el._prevStyle || {};
      for (const prop in oldStyle) {
        if (!(prop in value)) el.style[prop] = '';
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
      if (__DEV__) {
        console.warn(
          '[what] innerHTML received a raw string. This is a security risk (XSS). ' +
          'Use innerHTML={{ __html: trustedString }} or dangerouslySetInnerHTML={{ __html: trustedString }} instead.'
        );
      }
      // Refuse to set raw string innerHTML — prevent XSS
      return;
    }
    return;
  }

  // null / undefined — attribute must be ABSENT (React/Solid semantics), not
  // stamped as the literal string "undefined"/"null". Runs before the boolean,
  // data-*/aria-*, SVG and property-reflected branches, all of which would
  // otherwise stringify a nullish value. Reflected props (e.g. el.title) are
  // reset first so removeAttribute() clears both the attribute and the property.
  if (value == null) {
    if (key in el) {
      try { el[key] = ''; } catch { /* read-only reflected prop */ }
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

  // <select> value must be set after <option> children are in the DOM
  if (key === 'value' && el.tagName === 'SELECT') {
    _setSelectValue(el, value);
    return;
  }

  // Default: property if exists, otherwise attribute
  if (key in el) {
    el[key] = value;
  } else {
    el.setAttribute(key, value);
  }
}
