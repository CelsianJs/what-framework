// What Framework - Hooks
// React-familiar hooks backed by signals. Zero overhead when deps don't change.

import { signal, computed, effect, batch, untrack } from './reactive.js';
import { getCurrentComponent } from './dom.js';

function getCtx() {
  const ctx = getCurrentComponent();
  if (!ctx) throw new Error('Hooks must be called inside a component');
  return ctx;
}

function getHook(ctx) {
  const index = ctx.hookIndex++;
  return { index, exists: index < ctx.hooks.length };
}

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
// Read from a context created by createContext().

export function useContext(context) {
  return context._value;
}

// --- createContext ---
// Simple context: set a default, override with Provider component.

export function createContext(defaultValue) {
  const ctx = {
    _value: defaultValue,
    Provider: ({ value, children }) => {
      ctx._value = value;
      return children;
    },
  };
  return ctx;
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
