// What Framework - Component Utilities
// memo, lazy, Suspense, ErrorBoundary

import { h } from './h.js';
import { signal, effect, untrack, __DEV__ } from './reactive.js';

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

  // Suspense boundary marker
  const boundary = {
    _suspense: true,
    onSuspend(promise) {
      loading.set(true);
      pendingPromises.add(promise);
      promise.finally(() => {
        pendingPromises.delete(promise);
        if (pendingPromises.size === 0) {
          loading.set(false);
        }
      });
    },
  };

  return {
    tag: '__suspense',
    props: { boundary, fallback, loading },
    children: Array.isArray(children) ? children : [children],
    _vnode: true,
  };
}

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
// Reactively shows/hides children based on the `when` condition.

export function Show({ when, fallback = null, children }) {
  // If `when` is a signal or function, return a reactive function
  // so the DOM runtime tracks changes via its effect wrapper
  if (typeof when === 'function') {
    return () => when() ? children : fallback;
  }
  // Static value — just return directly
  return when ? children : fallback;
}

// --- For ---
// Reactive list rendering with keyed reconciliation.
// Takes a signal (or function returning an array) as `each` and reactively
// adds/removes/moves DOM nodes when the array changes.
// Uses mapArray from render.js for efficient keyed reconciliation with LIS.
//
// Usage: <For each={items}>{(item, index) => <div>{item}</div>}</For>
// - `each`: signal or function returning an array
// - `children`: render function (item, index) => vnode
// - `fallback`: shown when array is empty
// - `key`: optional key function (item) => key for keyed reconciliation

export function For({ each, fallback = null, children, key: keyFn }) {
  // children should be a function (item, index) => vnode
  const renderFn = Array.isArray(children) ? children[0] : children;
  if (typeof renderFn !== 'function') {
    if (__DEV__) {
      console.warn('[what] For: children must be a render function, e.g. <For each={items}>{(item) => ...}</For>');
    }
    return fallback;
  }

  // Normalize `each` to a function that returns the current array
  const source = typeof each === 'function' ? each : () => each;

  // Build the map function that wraps renderFn with auto-key detection
  const mapFn = (item, index) => {
    const vnode = renderFn(item, index);
    // Auto-detect keys for efficient keyed reconciliation
    if (vnode && typeof vnode === 'object' && vnode.key == null) {
      const rawItem = typeof item === 'function' && item._signal ? item() : item;
      if (rawItem != null && typeof rawItem === 'object') {
        if (rawItem.id != null) vnode.key = rawItem.id;
        else if (rawItem.key != null) vnode.key = rawItem.key;
      } else if (typeof rawItem === 'string' || typeof rawItem === 'number') {
        vnode.key = rawItem;
      }
    }
    return vnode;
  };

  // Return a reactive function. The DOM runtime (createDOM in dom.js)
  // wraps functions in effects, so this will re-evaluate whenever the
  // source signal changes. For simple cases (no mapArray integration),
  // this provides correct reactivity by re-rendering the list on change.
  //
  // The effect wrapper in createDOM (lines 140-190 in dom.js) handles:
  // - Creating DOM nodes for new vnodes
  // - Removing old DOM nodes
  // - Inserting between comment markers
  return () => {
    const list = source();
    if (!list || list.length === 0) return fallback;
    return list.map((item, i) => mapFn(item, i));
  };
}

// --- Switch / Match ---
// Multi-condition rendering (like switch statement).

export function Switch({ fallback = null, children }) {
  const kids = Array.isArray(children) ? children : [children];

  for (const child of kids) {
    if (child && child.tag === Match) {
      const condition = typeof child.props.when === 'function'
        ? child.props.when()
        : child.props.when;
      if (condition) {
        return child.children;
      }
    }
  }

  return fallback;
}

export function Match({ when, children }) {
  // Match is just a marker component, Switch handles the logic
  return { tag: Match, props: { when }, children, _vnode: true };
}

// --- Island ---
// Deferred hydration component for islands architecture.
// Usage: h(Island, { component: Counter, mode: 'idle' })
// The babel plugin compiles <Counter client:idle /> into this.

export function Island({ component: Component, mode, mediaQuery, ...props }) {
  const placeholder = h('div', { 'data-island': Component.name || 'Island', 'data-hydrate': mode });

  // We need to return a vnode that the reconciler can handle.
  // The actual hydration scheduling happens after mount via an effect.
  const wrapper = signal(null);
  const hydrated = signal(false);

  function doHydrate() {
    if (hydrated()) return;
    hydrated.set(true);
    // Render the actual component
    wrapper.set(h(Component, props));
  }

  // Schedule hydration based on mode
  function scheduleHydration(el) {
    switch (mode) {
      case 'load':
        queueMicrotask(doHydrate);
        break;

      case 'idle':
        if (typeof requestIdleCallback !== 'undefined') {
          requestIdleCallback(doHydrate);
        } else {
          setTimeout(doHydrate, 200);
        }
        break;

      case 'visible': {
        const observer = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) {
            observer.disconnect();
            doHydrate();
          }
        });
        observer.observe(el);
        break;
      }

      case 'interaction': {
        const hydrate = () => {
          el.removeEventListener('click', hydrate);
          el.removeEventListener('focus', hydrate);
          el.removeEventListener('mouseenter', hydrate);
          doHydrate();
        };
        el.addEventListener('click', hydrate, { once: true });
        el.addEventListener('focus', hydrate, { once: true });
        el.addEventListener('mouseenter', hydrate, { once: true });
        break;
      }

      case 'media': {
        if (!mediaQuery) { doHydrate(); break; }
        const mq = window.matchMedia(mediaQuery);
        if (mq.matches) {
          queueMicrotask(doHydrate);
        } else {
          const checkMedia = () => {
            if (mq.matches) {
              mq.removeEventListener('change', checkMedia);
              doHydrate();
            }
          };
          mq.addEventListener('change', checkMedia);
        }
        break;
      }

      default:
        // Unknown mode, hydrate immediately
        queueMicrotask(doHydrate);
    }
  }

  // Use ref callback to get the DOM element and schedule hydration
  const refCallback = (el) => {
    if (el) scheduleHydration(el);
  };

  // Return: show placeholder until hydrated, then show the real component
  return h('div', { 'data-island': Component.name || 'Island', 'data-hydrate': mode, ref: refCallback },
    hydrated() ? wrapper() : null
  );
}
