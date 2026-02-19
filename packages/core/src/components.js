// What Framework - Component Utilities
// memo, lazy, Suspense, ErrorBoundary

import { h } from './h.js';
import { signal, effect, untrack, __DEV__ } from './reactive.js';

// Legacy errorBoundaryStack removed — tree-based resolution via _parentCtx._errorBoundary
// is now the only mechanism. See reportError() below.

// --- memo ---
// Skip re-render when parent re-renders with unchanged props.
// Signal-safe: when an internal signal changes, the component always re-renders
// (memo never blocks signal-triggered updates).
//
// How it works:
// - In our architecture, Component(propsSignal()) is called inside an effect.
// - When parent re-renders: propsSignal is set to a new object → props is a NEW reference
// - When an internal signal changes: propsSignal unchanged → props is the SAME reference
// - memo only skips when: props is a new reference AND structurally equal to previous

export function memo(Component, areEqual) {
  const compare = areEqual || shallowEqual;

  function MemoWrapper(props) {
    const ctx = _getCurrentComponent?.();
    if (ctx && ctx._memoResult !== undefined) {
      if (props === ctx._memoPropsRef) {
        // Same reference → signal-triggered re-render → must re-run
        // to pick up new signal values (do NOT skip)
      } else if (compare(ctx._memoProps, props)) {
        // New reference but structurally equal → parent-triggered, safe to skip
        ctx._memoPropsRef = props;
        return ctx._memoResult;
      }
    }
    if (ctx) {
      ctx._memoPropsRef = props;
      ctx._memoProps = { ...props };
    }
    const result = Component(props);
    if (ctx) ctx._memoResult = result;
    return result;
  }

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

export function Show({ when, fallback = null, children }) {
  // when can be a signal or a value
  const condition = typeof when === 'function' ? when() : when;
  return condition ? children : fallback;
}

// --- For ---
// Efficient list rendering with keyed reconciliation.

export function For({ each, fallback = null, children }) {
  const list = typeof each === 'function' ? each() : each;
  if (!list || list.length === 0) return fallback;

  // children should be a function (item, index) => vnode
  const renderFn = Array.isArray(children) ? children[0] : children;
  if (typeof renderFn !== 'function') {
    console.warn('[what] For: children must be a render function, e.g. <For each={items}>{(item) => ...}</For>');
    return fallback;
  }

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
