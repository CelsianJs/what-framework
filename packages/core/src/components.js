// What Framework - Component Utilities
// memo, lazy, Suspense, ErrorBoundary

import { h } from './h.js';
import { signal, __DEV__ } from './reactive.js';
import { isServerRender } from './server-context.js';

// Legacy errorBoundaryStack removed — tree-based resolution via _parentCtx._errorBoundary
// is now the only mechanism. See reportError() below.

// --- memo ---
// In the run-once model, components execute exactly once and never re-render.
// Signals update the DOM directly via fine-grained effects. Therefore, memo()
// is a no-op identity wrapper — there is no re-render to skip.
// Kept for API compatibility with React-style code.

export function memo(Component, _areEqual) {
  // No-op in run-once model — just return the component as-is
  const MemoWrapper = function MemoWrapper(props) {
    return Component(props);
  };
  MemoWrapper.displayName = `Memo(${Component.name || 'Anonymous'})`;
  return MemoWrapper;
}

// Injected by dom.js
let _getCurrentComponent = null;
export function _injectGetCurrentComponent(fn) { _getCurrentComponent = fn; }

export function shallowEqual(a, b) {
  if (a === b) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.is(a[key], b[key])) return false;
  }
  return true;
}

// --- lazy ---
// Code-split a component. Returns a wrapper that loads on first render.

export function lazy(loader) {
  let Component = null;
  let loadPromise = null;
  let loadError = null;
  const listeners = new Set();

  function LazyWrapper(props) {
    if (loadError) throw loadError;
    if (Component) return h(Component, props);

    if (!loadPromise) {
      loadPromise = loader()
        .then(mod => {
          Component = mod.default || mod;
          // Notify all waiting instances
          listeners.forEach(fn => fn());
          listeners.clear();
        })
        .catch(err => { loadError = err; });
    }

    // Throw promise for Suspense to catch
    throw loadPromise;
  }

  LazyWrapper.displayName = 'Lazy';
  LazyWrapper._lazy = true;
  LazyWrapper._onLoad = (fn) => {
    if (Component) fn();
    else listeners.add(fn);
  };
  return LazyWrapper;
}

// --- Suspense ---
// Show fallback while children are loading (lazy components).
// Works with lazy() and async components.

export function Suspense({ fallback, children }) {
  const loading = signal(false);
  const pendingPromises = new Set();
  let failed = false;

  // Suspense boundary marker
  const boundary = {
    _suspense: true,
    onSuspend(promise) {
      if (failed) return;
      loading.set(true);
      pendingPromises.add(promise);
      // Rejection is handled separately from fulfilment. Clearing the fallback
      // on a rejection re-renders the child, which suspends on the same
      // rejected thenable again, forever. Latch the failure and stay put.
      promise.then(
        () => {
          pendingPromises.delete(promise);
          if (pendingPromises.size === 0) {
            loading.set(false);
          }
        },
        (err) => {
          failed = true;
          pendingPromises.delete(promise);
          console.error('[what] Suspense: a suspended child rejected:', err);
        },
      );
    },
  };

  return {
    tag: '__suspense',
    props: { boundary, fallback, loading },
    children: Array.isArray(children) ? children : [children],
    _vnode: true,
  };
}

// The boundary context only exists once createSuspenseBoundary runs, so
// compiled children must not be built during this call. See createComponent.
Suspense._deferChildren = true;

// --- ErrorBoundary ---
// Catch errors in children and show fallback.
// Uses a signal to track error state so it works with reactive rendering.

export function ErrorBoundary({ fallback, children, onError }) {
  const errorState = signal(null);

  // Error handler that will be registered with the component tree
  const handleError = (error) => {
    errorState.set(error);
    if (onError) {
      try {
        onError(error);
      } catch (e) {
        console.error('Error in onError handler:', e);
      }
    }
  };

  // Reset function to recover from error
  const reset = () => errorState.set(null);

  return {
    tag: '__errorBoundary',
    props: { errorState, handleError, fallback, reset },
    children: Array.isArray(children) ? children : [children],
    _vnode: true,
  };
}

// The boundary context only exists once createErrorBoundary runs, so compiled
// children must not be built during this call. See createComponent.
ErrorBoundary._deferChildren = true;

// Helper to report error to nearest boundary
// Walks the component context tree (not a runtime stack) so async errors are caught
export function reportError(error, startCtx) {
  // Walk up the _parentCtx chain to find the nearest _errorBoundary
  let ctx = startCtx || _getCurrentComponent?.();
  while (ctx) {
    if (ctx._errorBoundary) {
      ctx._errorBoundary(error);
      return true;
    }
    ctx = ctx._parentCtx;
  }
  return false;
}

// _getCurrentComponent is already declared above and injected via _injectGetCurrentComponent

// --- Show ---
// Conditional rendering component. Cleaner than ternaries.
//
// Components run ONCE and never re-execute, so reading `when()` in the body
// would snapshot the condition a single time — the content would render once
// and never advance when the signal flips (the classic `<Show when={() =>
// authed()}>` identity-gate trap). Instead we return a reactive THUNK: when a
// component returns a function, createDOM installs a fine-grained fn-child
// effect (packages/core/src/dom.js) that re-evaluates it — the same reactive
// form the fine-grained compiler lowers `<Show>` to. Works on both JSX
// pipelines (the babel plugin lowers inline; the automatic `jsxImportSource`
// runtime / h() route here via _$createComponent).

export function Show({ when, fallback = null, children }) {
  return () => {
    // `when` can be a signal getter, a plain thunk, or a static value.
    const condition = typeof when === 'function' ? when() : when;
    return condition ? children : fallback;
  };
}

// --- For ---
// List rendering. Returns a reactive thunk (see Show above) so the list
// re-renders when `each` changes. The thunk re-reads `each()` inside the
// framework's fn-child effect, tracking it. The preferred, keyed-efficient
// pattern is `.map()` with a `key` prop (auto-lowered to _$mapArray by the
// compiler) or `<For>` compiled by the fine-grained plugin; this runtime form
// is the fallback for the automatic JSX runtime / h() path.

export function For({ each, fallback = null, children }) {
  // children should be a function (item, index) => vnode. Resolve/validate it
  // once at creation — it does not change across list updates.
  const renderFn = Array.isArray(children) ? children[0] : children;
  if (typeof renderFn !== 'function') {
    console.warn('[what] For: children must be a render function, e.g. <For each={items}>{(item) => ...}</For>');
    return fallback;
  }

  return () => {
    const list = typeof each === 'function' ? each() : each;
    if (!list || list.length === 0) return fallback;

    return list.map((item, index) => {
      const vnode = renderFn(item, index);
      // Auto-detect keys for efficient keyed reconciliation
      if (vnode && typeof vnode === 'object' && vnode.key == null) {
        if (item != null && typeof item === 'object') {
          // Use item.id or item.key if available
          if (item.id != null) vnode.key = item.id;
          else if (item.key != null) vnode.key = item.key;
        } else if (typeof item === 'string' || typeof item === 'number') {
          // Primitive items can be their own key
          vnode.key = item;
        }
      }
      return vnode;
    });
  };
}

// --- Switch / Match ---
// Multi-condition rendering (like switch statement).

export function Switch({ fallback = null, children }) {
  // The Match children are static, so resolve them once. The match loop, which
  // reads each Match's reactive `when`, must run inside a reactive thunk (see
  // Show/For above): components run once, so evaluating `when()` in the body
  // here would snapshot the active arm a single time and `<Switch>`/`<Match
  // when={() => sig()}>` would render once and never update.
  // This is the runtime path, for h() and the automatic JSX runtime, where a
  // <Match> arrives as an unexecuted marker vnode. The fine-grained compiler
  // lowers <Switch> to the same conditional thunk and never reaches here; a
  // <Switch> it cannot lower is a build error rather than a call into this.
  const kids = Array.isArray(children) ? children : [children];

  return () => {
    for (const child of kids) {
      if (child && child.tag === Match) {
        const when = child.props.when;
        const condition = typeof when === 'function' ? when() : when;
        if (condition) return child.children;
      }
    }
    return fallback;
  };
}

export function Match(props) {
  // Executed rather than left as a marker, which is what a lone compiled
  // <Match> does. Returning a `{ tag: Match }` vnode here would send createDOM
  // straight back into Match forever, so return a reactive thunk that renders
  // the arm when it matches.
  return () => {
    const condition = typeof props.when === 'function' ? props.when() : props.when;
    return condition ? props.children : null;
  };
}

// --- Island ---
// Islands architecture: the content ships as server-rendered HTML and only the
// *interactivity* is deferred to a client trigger. The babel plugin compiles
// `<Counter client:idle />` into h(Island, { component: Counter, mode: 'idle' }).
//
// This used to render an empty marker div on every path, on the server AND the
// client, in every mode: the SSR branch never rendered the component, and the
// client branch read `hydrated()` once in a run-once component so the swap-in
// never happened. Every `client:*` directive silently deleted its component.

// Late-bound renderers, injected by render.js. components.js cannot import
// render.js directly (render -> dom -> components is already a cycle), so the
// same injection precedent as _injectGetCurrentComponent applies here.
let _islandRuntime = null;

/** @internal */
export function _injectIslandRuntime(runtime) {
  _islandRuntime = runtime;
}

// Island props cross the server/client boundary as JSON, so anything that is not
// representable is dropped rather than throwing mid-render. Functions in
// particular are common (event handlers passed down) and are simply not
// transferable: the island re-creates its own handlers when it hydrates.
function serializeIslandProps(props) {
  const out = {};
  for (const key in props) {
    const value = props[key];
    if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) continue;
    out[key] = value;
  }
  try {
    return JSON.stringify(out);
  } catch {
    return '{}';
  }
}

export function Island({ component: Component, mode, mediaQuery, name, children, ...props }) {
  const islandName = name || Component?.name || 'Island';
  const resolvedMode = mode || 'idle';

  const marker = {
    'data-island': islandName,
    'data-island-mode': resolvedMode,
    'data-hydrate': resolvedMode,
    // Tells hydrateIslands() to leave this element alone: a compiler-emitted
    // island holds a direct component reference and hydrates itself, so it
    // needs no registry entry and must not be claimed twice.
    'data-island-self': '1',
  };

  // Server: render the island's HTML inline, inside the marker. An island that
  // emits nothing costs SEO and LCP to buy lazy hydration, which is a strictly
  // worse trade than not using the directive at all.
  // Children arrive as props here but must be handed to the component
  // positionally: the renderers rebuild `props.children` from the vnode's own
  // children list, so anything passed through props alone is overwritten.
  const childList = children == null ? [] : (Array.isArray(children) ? children : [children]);

  if (isServerRender()) {
    return h(
      'div',
      { ...marker, 'data-island-props': serializeIslandProps(props) },
      h(Component, props, ...childList)
    );
  }

  let hydrated = false;

  function hydrateInto(el) {
    if (hydrated) return;
    hydrated = true;

    const vnode = h(Component, props, ...childList);

    // Server-rendered children present => hydrate in place, reusing the DOM.
    // Nothing there => a client-only render, so build it from scratch.
    if (el.childNodes.length > 0 && _islandRuntime?.hydrate) {
      _islandRuntime.hydrate(vnode, el);
    } else if (_islandRuntime?.insert) {
      _islandRuntime.insert(el, vnode, null);
    }

    el.removeAttribute('data-hydrate');
    el.removeAttribute('data-island-self');
    el.setAttribute('data-island-hydrated', '');
    // Build the event in the element's own realm. A global CustomEvent belongs
    // to a different realm inside an iframe or a DOM shim, and dispatchEvent
    // rejects it as "not of type 'Event'".
    const view = el.ownerDocument?.defaultView ?? globalThis;
    if (typeof view.CustomEvent === 'function') {
      el.dispatchEvent(new view.CustomEvent('island:hydrated', {
        bubbles: true,
        detail: { name: islandName, mode: resolvedMode },
      }));
    }
  }

  function scheduleHydration(el) {
    const trigger = () => hydrateInto(el);

    switch (resolvedMode) {
      case 'load':
        queueMicrotask(trigger);
        break;

      case 'idle':
        if (typeof requestIdleCallback !== 'undefined') requestIdleCallback(trigger);
        else setTimeout(trigger, 200);
        break;

      case 'visible': {
        if (typeof IntersectionObserver === 'undefined') { queueMicrotask(trigger); break; }
        const observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            trigger();
          }
        }, { rootMargin: '200px' });
        observer.observe(el);
        break;
      }

      case 'interaction':
      case 'action': {
        const events = ['click', 'focus', 'mouseenter', 'touchstart'];
        const onInteract = () => {
          for (const type of events) el.removeEventListener(type, onInteract);
          trigger();
        };
        for (const type of events) el.addEventListener(type, onInteract, { once: true });
        break;
      }

      case 'media': {
        if (!mediaQuery || typeof window === 'undefined' || !window.matchMedia) { trigger(); break; }
        const mq = window.matchMedia(mediaQuery);
        if (mq.matches) { queueMicrotask(trigger); break; }
        const onChange = () => {
          if (!mq.matches) return;
          mq.removeEventListener('change', onChange);
          trigger();
        };
        mq.addEventListener('change', onChange);
        break;
      }

      // 'static' ships no JS at all: the server HTML is the whole island.
      case 'static':
        break;

      default:
        queueMicrotask(trigger);
    }
  }

  return h('div', { ...marker, ref: (el) => { if (el) scheduleHydration(el); } });
}
