/**
 * what-react/hooks — React hooks with REAL React semantics (value-returning).
 *
 * Unlike what-core's hooks (which return signal accessors for the run-once
 * model), these hooks return plain VALUES and trigger re-renders through the
 * compat runtime's scheduler:
 *
 *   const [count, setCount] = useState(0);   // count is a NUMBER
 *   const doubled = useMemo(() => count * 2, [count]); // doubled is a NUMBER
 *
 * They are only valid inside components rendered by the compat runtime
 * (anything created via what-react's createElement / jsx-runtime).
 */

import {
  _requireInstance,
  _getCurrentInstance,
  _getHookSlot,
  scheduleUpdate,
  _pushLayout,
  _pushPassive,
  flushUpdates,
} from './runtime.js';

function depsChanged(oldDeps, newDeps) {
  if (oldDeps === undefined || newDeps === undefined) return true;
  if (oldDeps === null || newDeps === null) return true;
  if (oldDeps.length !== newDeps.length) return true;
  for (let i = 0; i < oldDeps.length; i++) {
    if (!Object.is(oldDeps[i], newDeps[i])) return true;
  }
  return false;
}

// ---- useState ----

export function useState(initial) {
  const inst = _requireInstance('useState');
  const slot = _getHookSlot(inst);
  if (!slot.init) {
    slot.init = true;
    slot.value = typeof initial === 'function' ? initial() : initial;
    slot.set = (next) => {
      const resolved = typeof next === 'function' ? next(slot.value) : next;
      if (Object.is(resolved, slot.value)) return;
      slot.value = resolved;
      scheduleUpdate(inst);
    };
  }
  return [slot.value, slot.set];
}

// ---- useReducer ----

export function useReducer(reducer, initialArg, init) {
  const inst = _requireInstance('useReducer');
  const slot = _getHookSlot(inst);
  if (!slot.init) {
    slot.init = true;
    slot.value = init ? init(initialArg) : initialArg;
    slot.reducer = reducer;
    slot.dispatch = (action) => {
      const next = slot.reducer(slot.value, action);
      if (Object.is(next, slot.value)) return;
      slot.value = next;
      scheduleUpdate(inst);
    };
  }
  slot.reducer = reducer; // always use the latest reducer closure
  return [slot.value, slot.dispatch];
}

// ---- useMemo / useCallback ----

export function useMemo(factory, deps) {
  const inst = _requireInstance('useMemo');
  const slot = _getHookSlot(inst);
  if (!slot.init || depsChanged(slot.deps, deps)) {
    slot.init = true;
    slot.deps = deps;
    slot.value = factory();
  }
  return slot.value;
}

export function useCallback(callback, deps) {
  const inst = _requireInstance('useCallback');
  const slot = _getHookSlot(inst);
  if (!slot.init || depsChanged(slot.deps, deps)) {
    slot.init = true;
    slot.deps = deps;
    slot.value = callback;
  }
  return slot.value;
}

// ---- useRef ----

export function useRef(initial) {
  const inst = _requireInstance('useRef');
  const slot = _getHookSlot(inst);
  if (!slot.init) {
    slot.init = true;
    slot.value = { current: initial };
  }
  return slot.value;
}

// ---- useEffect / useLayoutEffect / useInsertionEffect ----

function useEffectImpl(hookName, push, fn, deps) {
  const inst = _requireInstance(hookName);
  const slot = _getHookSlot(inst);
  if (!slot.init) {
    slot.init = true;
    slot._isEffect = true;
    slot.cleanup = null;
    slot.deps = undefined;
    slot._pending = null;
  }
  if (depsChanged(slot.deps, deps)) {
    slot.deps = deps;
    push(inst, slot, fn);
  }
}

export function useEffect(fn, deps) {
  useEffectImpl('useEffect', _pushPassive, fn, deps);
}

export function useLayoutEffect(fn, deps) {
  useEffectImpl('useLayoutEffect', _pushLayout, fn, deps);
}

// Runs synchronously during render (before this component's DOM mutations) —
// the closest approximation of React's insertion phase for CSS-in-JS libs.
export function useInsertionEffect(fn, deps) {
  const inst = _requireInstance('useInsertionEffect');
  const slot = _getHookSlot(inst);
  if (!slot.init) {
    slot.init = true;
    slot._isEffect = true;
    slot.cleanup = null;
    slot.deps = undefined;
  }
  if (depsChanged(slot.deps, deps)) {
    slot.deps = deps;
    if (slot.cleanup) {
      try { slot.cleanup(); } catch (e) { console.error('[what-react] insertion effect cleanup error:', e); }
      slot.cleanup = null;
    }
    try {
      const result = fn();
      if (typeof result === 'function') slot.cleanup = result;
    } catch (e) {
      console.error('[what-react] insertion effect error:', e);
    }
  }
}

// ---- useImperativeHandle ----

export function useImperativeHandle(ref, createHandle, deps) {
  useLayoutEffect(() => {
    if (typeof ref === 'function') {
      const handle = createHandle();
      ref(handle);
      return () => ref(null);
    } else if (ref && typeof ref === 'object') {
      ref.current = createHandle();
      return () => { ref.current = null; };
    }
  }, deps == null ? deps : [...deps, ref]);
}

// ---- useContext / createContext ----

export function createContext(defaultValue) {
  const context = {
    $$typeof: Symbol.for('react.context'),
    _defaultValue: defaultValue,
    displayName: 'Context',
  };

  function Provider(props) {
    const inst = _requireInstance('Context.Provider');
    if (!inst._ctxProvided) inst._ctxProvided = new Map();
    const had = inst._ctxProvided.has(context);
    const prev = inst._ctxProvided.get(context);
    inst._ctxProvided.set(context, props.value);
    if (had && !Object.is(prev, props.value) && inst._ctxSubs) {
      // Context propagation: consumers re-render even if intermediate
      // components bailed out (identical-element / memo skip).
      const subs = inst._ctxSubs.get(context);
      if (subs) {
        for (const sub of subs) scheduleUpdate(sub);
      }
    }
    return props.children;
  }
  Provider.displayName = 'Context.Provider';
  Provider._context = context;

  function Consumer(props) {
    const value = useContext(context);
    const children = props.children;
    return typeof children === 'function' ? children(value) : children;
  }
  Consumer.displayName = 'Context.Consumer';
  Consumer._context = context;

  context.Provider = Provider;
  context.Consumer = Consumer;
  return context;
}

export function useContext(context) {
  const inst = _requireInstance('useContext');
  let p = inst.parent;
  while (p) {
    if (p._ctxProvided && p._ctxProvided.has(context)) {
      // Subscribe for direct propagation (needed when ancestors bail out).
      if (!p._ctxSubs) p._ctxSubs = new Map();
      let subs = p._ctxSubs.get(context);
      if (!subs) {
        subs = new Set();
        p._ctxSubs.set(context, subs);
      }
      if (!subs.has(inst)) {
        subs.add(inst);
        (inst._ctxDeps || (inst._ctxDeps = [])).push([p, context]);
      }
      return p._ctxProvided.get(context);
    }
    p = p.parent;
  }
  return context._defaultValue;
}

// ---- useSyncExternalStore ----
// Spec-compliant: returns the snapshot VALUE and re-renders on store change.

export function useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
  const inst = _requireInstance('useSyncExternalStore');
  const slot = _getHookSlot(inst);
  if (!slot.init) {
    slot.init = true;
    slot._isEffect = true; // unmount runs slot.cleanup (the unsubscribe)
    slot.cleanup = null;
    slot.subscribe = undefined;
    slot._pending = null;
  }
  const value = getSnapshot();
  slot.value = value;
  slot.getSnapshot = getSnapshot;

  if (slot.subscribe !== subscribe) {
    slot.subscribe = subscribe;
    _pushLayout(inst, slot, () => {
      const handleChange = () => {
        const next = slot.getSnapshot();
        if (!Object.is(slot.value, next)) {
          slot.value = next;
          scheduleUpdate(inst);
        }
      };
      const unsubscribe = subscribe(handleChange);
      handleChange(); // catch changes between render and subscription
      return unsubscribe;
    });
  }

  return value;
}

// ---- useTransition / useDeferredValue / startTransition ----
// Rendering here is synchronous — transitions degrade to immediate updates.

export function useTransition() {
  _requireInstance('useTransition');
  return [false, startTransition];
}

export function startTransition(fn) {
  fn();
  flushUpdates();
}

export function useDeferredValue(value) {
  return value;
}

// ---- useId ----

let idCounter = 0;

export function useId() {
  const inst = _requireInstance('useId');
  const slot = _getHookSlot(inst);
  if (!slot.init) {
    slot.init = true;
    slot.value = ':w' + (++idCounter).toString(36) + ':';
  }
  return slot.value;
}

// ---- useDebugValue ----

export function useDebugValue() {}

// ---- use (React 19-style, minimal) ----
// Context → useContext. Thenable → resolved value or throw for Suspense.

export function use(usable) {
  if (usable !== null && typeof usable === 'object') {
    if (typeof usable.then === 'function') {
      const thenable = usable;
      if (thenable._whatStatus === 'fulfilled') return thenable._whatValue;
      if (thenable._whatStatus === 'rejected') throw thenable._whatReason;
      if (thenable._whatStatus === undefined) {
        thenable._whatStatus = 'pending';
        thenable.then(
          (v) => { thenable._whatStatus = 'fulfilled'; thenable._whatValue = v; },
          (e) => { thenable._whatStatus = 'rejected'; thenable._whatReason = e; },
        );
      }
      throw thenable; // caught by the nearest Suspense boundary
    }
    if (usable.$$typeof === Symbol.for('react.context')) {
      return useContext(usable);
    }
  }
  throw new Error('[what-react] use() expects a promise or a context.');
}

// ---- useSignal (escape hatch) ----
// Bridge helper for mixed codebases: subscribe a compat component to a
// what-core signal. Re-renders this component when the signal changes.

export function useWhatSignal(sig) {
  return useSyncExternalStore(
    (notify) => {
      // what-core signals don't expose subscribe directly; poll via effect-free
      // microtask comparison is wasteful — use sig.subscribe if present.
      if (typeof sig.subscribe === 'function') return sig.subscribe(notify);
      // Fallback: no subscription available; value still read each render.
      return () => {};
    },
    () => sig(),
  );
}
