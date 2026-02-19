// What Framework - Hooks
// React-familiar hooks backed by signals. Zero overhead when deps don't change.

import { signal, computed, effect, batch, untrack, __DEV__ } from './reactive.js';
import { getCurrentComponent } from './dom.js';

function getCtx() {
  const ctx = getCurrentComponent();
  if (!ctx) {
    throw new Error(
      '[what] Hooks must be called inside a component function. ' +
      'If you need reactive state outside a component, use signal() directly.'
    );
  }
  return ctx;
}

function getHook(ctx) {
  const index = ctx.hookIndex++;
  return { index, exists: index < ctx.hooks.length };
}

let _useMemoNoDepsWarned = false;

// --- useState ---
// Returns [value, setter]. Setter triggers re-render of this component only.

export function useState(initial) {
  const ctx = getCtx();
  const { index, exists } = getHook(ctx);

  if (!exists) {
    const s = signal(typeof initial === 'function' ? initial() : initial);
    ctx.hooks[index] = s;
  }

  const s = ctx.hooks[index];
  return [s(), s.set];
}

// --- useSignal ---
// Returns the raw signal. More powerful: read with sig(), write with sig.set(v).
// Avoids array destructuring overhead.

export function useSignal(initial) {
  const ctx = getCtx();
  const { index, exists } = getHook(ctx);

  if (!exists) {
    ctx.hooks[index] = signal(typeof initial === 'function' ? initial() : initial);
  }

  return ctx.hooks[index];
}

// --- useComputed ---
// Derived value. Only recomputes when signal deps change.

export function useComputed(fn) {
  const ctx = getCtx();
  const { index, exists } = getHook(ctx);

  if (!exists) {
    ctx.hooks[index] = computed(fn);
  }

  return ctx.hooks[index];
}

// --- useEffect ---
// Side effect that runs after render. Cleanup function returned by fn is called
// before re-running and on unmount.

export function useEffect(fn, deps) {
  const ctx = getCtx();
  const { index, exists } = getHook(ctx);

  if (!exists) {
    ctx.hooks[index] = { deps: undefined, cleanup: null };
  }

  const hook = ctx.hooks[index];

  if (depsChanged(hook.deps, deps)) {
    // Schedule after current render
    queueMicrotask(() => {
      if (ctx.disposed) return;
      if (hook.cleanup) hook.cleanup();
      hook.cleanup = fn() || null;
    });
    hook.deps = deps;
  }
}

// --- useMemo ---
// Memoized value. Only recomputes when deps change.

export function useMemo(fn, deps) {
  const ctx = getCtx();
  const { index, exists } = getHook(ctx);

  if (__DEV__ && deps === undefined && !_useMemoNoDepsWarned) {
    _useMemoNoDepsWarned = true;
    console.warn(
      '[what] useMemo() called without a deps array. ' +
      'This recomputes every render. Use useComputed() for signal-derived values, ' +
      'or pass deps to useMemo().'
    );
  }

  if (!exists) {
    ctx.hooks[index] = { value: undefined, deps: undefined };
  }

  const hook = ctx.hooks[index];

  if (depsChanged(hook.deps, deps)) {
    hook.value = fn();
    hook.deps = deps;
  }

  return hook.value;
}

// --- useCallback ---
// Memoized callback. Identity-stable when deps don't change.

export function useCallback(fn, deps) {
  return useMemo(() => fn, deps);
}

// --- useRef ---
// Mutable ref object. Does NOT trigger re-renders.

export function useRef(initial) {
  const ctx = getCtx();
  const { index, exists } = getHook(ctx);

  if (!exists) {
    ctx.hooks[index] = { current: initial };
  }

  return ctx.hooks[index];
}

// --- useContext ---
// Read from the nearest Provider in the component tree, or the default value.
// Uses _parentCtx chain (persistent tree) instead of componentStack (runtime stack)
// so context works correctly in re-renders, effects, and event handlers.

export function useContext(context) {
  // Walk up the _parentCtx chain to find the nearest provider
  let ctx = getCurrentComponent();
  if (__DEV__ && !ctx) {
    console.warn(
      `[what] useContext(${context?.displayName || 'Context'}) called outside of component render. ` +
      'useContext must be called during component rendering, not inside effects or event handlers. ' +
      'Store the context value in a variable during render and use that variable in your callback.'
    );
  }
  while (ctx) {
    if (ctx._contextValues && ctx._contextValues.has(context)) {
      const val = ctx._contextValues.get(context);
      // If the stored value is a signal, read it to subscribe
      return (val && val._signal) ? val() : val;
    }
    ctx = ctx._parentCtx;
  }
  return context._defaultValue;
}

// --- createContext ---
// Tree-scoped context: Provider sets value for its subtree only.
// Multiple providers can coexist — each subtree sees its own value.
// Context values are wrapped in signals so consumers re-render when values change.

export function createContext(defaultValue) {
  const context = {
    _defaultValue: defaultValue,
    Provider: ({ value, children }) => {
      const ctx = getCtx();
      if (!ctx._contextValues) ctx._contextValues = new Map();
      if (!ctx._contextSignals) ctx._contextSignals = new Map();

      // Create or update the context signal
      if (!ctx._contextSignals.has(context)) {
        const s = signal(value);
        ctx._contextSignals.set(context, s);
        ctx._contextValues.set(context, s);
      } else {
        ctx._contextSignals.get(context).set(value);
      }
      return children;
    },
    // React-compatible Consumer: <Context.Consumer>{value => ...}</Context.Consumer>
    Consumer: ({ children }) => {
      const value = useContext(context);
      return typeof children === 'function' ? children(value) : children;
    },
  };
  return context;
}

// --- useReducer ---
// State management with a reducer function (like React).

export function useReducer(reducer, initialState, init) {
  const ctx = getCtx();
  const { index, exists } = getHook(ctx);

  if (!exists) {
    const initial = init ? init(initialState) : initialState;
    const s = signal(initial);
    const dispatch = (action) => {
      s.set(prev => reducer(prev, action));
    };
    ctx.hooks[index] = { signal: s, dispatch };
  }

  const hook = ctx.hooks[index];
  return [hook.signal(), hook.dispatch];
}

// --- onMount ---
// Run callback once when component mounts. SolidJS-style lifecycle.

export function onMount(fn) {
  const ctx = getCtx();
  if (!ctx.mounted) {
    ctx._mountCallbacks = ctx._mountCallbacks || [];
    ctx._mountCallbacks.push(fn);
  }
}

// --- onCleanup ---
// Register cleanup function to run when component unmounts.

export function onCleanup(fn) {
  const ctx = getCtx();
  ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
  ctx._cleanupCallbacks.push(fn);
}

// --- createResource ---
// Reactive data fetching primitive (SolidJS-style).
// Returns [data, { loading, error, refetch, mutate }]

export function createResource(fetcher, options = {}) {
  const data = signal(options.initialValue ?? null);
  const loading = signal(!options.initialValue);
  const error = signal(null);

  let controller = null;

  const refetch = async (source) => {
    // Abort previous request
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal: abortSignal } = controller;

    loading.set(true);
    error.set(null);

    try {
      const result = await fetcher(source, { signal: abortSignal });

      // Only update if not aborted
      if (!abortSignal.aborted) {
        batch(() => {
          data.set(result);
          loading.set(false);
        });
      }
    } catch (e) {
      if (!abortSignal.aborted) {
        batch(() => {
          error.set(e);
          loading.set(false);
        });
      }
    }
  };

  const mutate = (value) => {
    data.set(typeof value === 'function' ? value(data()) : value);
  };

  // Register cleanup with component lifecycle: abort on unmount
  const ctx = getCurrentComponent?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(() => {
      if (controller) controller.abort();
    });
  }

  // Initial fetch if no initial value
  if (!options.initialValue) {
    refetch(options.source);
  }

  return [data, { loading, error, refetch, mutate }];
}

// --- Dep comparison ---

function depsChanged(oldDeps, newDeps) {
  if (oldDeps === undefined) return true;
  if (!oldDeps || !newDeps) return true;
  if (oldDeps.length !== newDeps.length) return true;
  for (let i = 0; i < oldDeps.length; i++) {
    if (!Object.is(oldDeps[i], newDeps[i])) return true;
  }
  return false;
}
