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
  _isStuck,
  _hostParent,
  _pushInsertion,
  _pushLayout,
  _pushPassive,
  _setFormActionRunner,
  EFFECT_INSERTION,
  EFFECT_LAYOUT,
  EFFECT_PASSIVE,
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

// ---- State queues (useState, useReducer) ----
// A setter queues its action and the next render applies the queue in order,
// as React's update queue does. A reducer or an updater therefore runs while
// the component renders: what it throws reaches the error boundary, an
// updater queued behind another sees the result of the one before it, and
// one whose component unmounts first never runs.
//
// With nothing queued the action is tried at the call (React's eager state):
// a state that does not change schedules no render, and the result is kept
// for the render, so the updater runs once. What it throws there is dropped:
// the render runs it again, and throws where a boundary catches it.
// useReducer takes the same path with the reducer of the last render, as
// React 17 did (React 18 runs every action at render and discards a render
// whose state came out the same; a render is not discarded here).

function basicStateReducer(state, action) {
  return typeof action === 'function' ? action(state) : action;
}

function enqueueAction(inst, slot, action, reducer) {
  // The update-loop guard stopped this component (runtime.js): the update is
  // refused, so the state stays what the screen shows.
  if (_isStuck(inst)) return;
  const update = { action, eager: false, value: undefined };
  if (slot.queue.length === 0) {
    try {
      const next = reducer(slot.value, action);
      if (Object.is(next, slot.value)) return;
      update.eager = true;
      update.value = next;
    } catch { /* thrown again by the render */ }
  }
  if (inst.unmounted) return;
  slot.queue.push(update);
  scheduleUpdate(inst);
}

// The state for this render: the queued actions applied to the last one. An
// action that throws takes the queue with it (the boundary above replaces
// the component).
function applyActions(slot, reducer) {
  const queue = slot.queue;
  if (queue.length === 0) return;
  slot.queue = [];
  let value = slot.value;
  for (let i = 0; i < queue.length; i++) {
    const update = queue[i];
    value = update.eager ? update.value : reducer(value, update.action);
  }
  slot.value = value;
}

// ---- useState ----

export function useState(initial) {
  const inst = _requireInstance('useState');
  const slot = _getHookSlot(inst);
  if (!slot.init) {
    slot.init = true;
    slot.value = typeof initial === 'function' ? initial() : initial;
    slot.queue = [];
    slot.set = (next) => {
      // Inside a transition the update waits for the transition (below).
      if (currentTransition !== null) {
        currentTransition.updates.push(() => slot.set(next));
        return;
      }
      enqueueAction(inst, slot, next, basicStateReducer);
    };
  } else {
    applyActions(slot, basicStateReducer);
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
    slot.queue = [];
    slot.dispatch = (action) => {
      if (currentTransition !== null) {
        currentTransition.updates.push(() => slot.dispatch(action));
        return;
      }
      enqueueAction(inst, slot, action, slot.reducer);
    };
  } else {
    // Queued actions run with this render's reducer (it may close over props).
    applyActions(slot, reducer);
  }
  slot.reducer = reducer;
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
// The hook queues its effect; the commit runs it (runtime.js): insertion
// effects first, then layout effects, then passive ones after the commit.

function useEffectImpl(hookName, kind, push, fn, deps) {
  const inst = _requireInstance(hookName);
  const slot = _getHookSlot(inst);
  if (!slot.init) {
    slot.init = true;
    slot._effect = kind;
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
  useEffectImpl('useEffect', EFFECT_PASSIVE, _pushPassive, fn, deps);
}

export function useLayoutEffect(fn, deps) {
  useEffectImpl('useLayoutEffect', EFFECT_LAYOUT, _pushLayout, fn, deps);
}

// In the commit, before refs attach and layout effects run, children before
// parents: where a CSS-in-JS library writes its rules.
export function useInsertionEffect(fn, deps) {
  useEffectImpl('useInsertionEffect', EFFECT_INSERTION, _pushInsertion, fn, deps);
}

// ---- useImperativeHandle ----

export function useImperativeHandle(ref, createHandle, deps) {
  useLayoutEffect(() => {
    if (typeof ref === 'function') {
      const handle = createHandle();
      const cleanup = ref(handle);
      return typeof cleanup === 'function' ? cleanup : () => ref(null);
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
    // React's fields: the value outside every provider. (React also keeps
    // the nearest provider's value here while it renders; this does not.)
    _currentValue: defaultValue,
    _currentValue2: defaultValue,
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
  // The brands React 18 gives them, which react-is 18 reads from an
  // element's type (isContextProvider, isContextConsumer).
  Provider.$$typeof = Symbol.for('react.provider');

  function Consumer(props) {
    const value = useContext(context);
    const children = props.children;
    return typeof children === 'function' ? children(value) : children;
  }
  Consumer.displayName = 'Context.Consumer';
  Consumer._context = context;
  Consumer.$$typeof = Symbol.for('react.context');

  context.Provider = Provider;
  context.Consumer = Consumer;
  // React 19: <Context value> is the provider (index.js renders the context
  // object as its Provider).
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

export function useSyncExternalStore(subscribe, getSnapshot, _getServerSnapshot) {
  const inst = _requireInstance('useSyncExternalStore');
  const slot = _getHookSlot(inst);
  if (!slot.init) {
    slot.init = true;
    slot._effect = EFFECT_LAYOUT; // unmount runs slot.cleanup (the unsubscribe)
    slot.cleanup = null;
    slot.subscribe = undefined;
    slot._pending = null;
  }
  // On the server, React reads getServerSnapshot when there is one.
  const value = inst._server && typeof _getServerSnapshot === 'function' ? _getServerSnapshot() : getSnapshot();
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
// Rendering here is not time-sliced: a transition's updates render in the
// next flush, like any other. What a transition adds is its async form
// (React 19 actions): while the promise its callback returned is pending,
// useTransition reports isPending and optimistic state stays in place.

/**
 * The transition whose callback is running. State updates made while it runs
 * are its updates, and optimistic updates last as long as it does.
 * @type {{ settle: Array<() => void>, wait: Array<Promise<unknown>>, updates: Array<() => void> } | null}
 */
let currentTransition = null;
/** Async transitions (actions) still running, and the state updates held for them. */
let asyncTransitions = 0;
/** @type {Array<() => void>} */
const heldUpdates = [];

function applyUpdates(updates) {
  for (let i = 0; i < updates.length; i++) updates[i]();
}

// Run `fn` as a transition; `done` runs when it has finished, also when it
// threw or its promise rejected. Returns a promise for an async one (its
// callback returned a promise, or dispatched an action that is still
// running), or null for a sync one.
//
// A sync transition's updates render in the next flush. An async one's are
// held until it has finished, with those of every transition started
// meanwhile (a `startTransition` after an `await`), and then render together
// with the end of its pending and optimistic state: React commits an action's
// updates in one go, so the screen never shows the new state next to the
// optimistic one.
function runTransition(fn, done) {
  const scope = { settle: /** @type {Array<() => void>} */ ([]), wait: /** @type {Array<Promise<unknown>>} */ ([]), updates: /** @type {Array<() => void>} */ ([]) };
  const prev = currentTransition;
  currentTransition = scope;
  let result;
  /** @type {{ error: unknown } | null} */
  let thrown = null;
  try {
    result = fn();
  } catch (error) {
    thrown = { error };
  }
  currentTransition = prev;
  const thenable = thrown === null && result !== null && typeof result === 'object' && typeof result.then === 'function';
  if (thenable || scope.wait.length > 0) {
    asyncTransitions++;
    for (const update of scope.updates) heldUpdates.push(update);
    const finish = () => {
      if (--asyncTransitions === 0) applyUpdates(heldUpdates.splice(0));
      for (const settle of scope.settle) settle();
      if (done) done();
    };
    const all = Promise.all([result, ...scope.wait]);
    all.then(finish, finish);
    return all;
  }
  // A sync transition: its updates apply now, unless an action is running
  // (they are part of what it commits). It is over once they have rendered.
  if (asyncTransitions > 0) for (const update of scope.updates) heldUpdates.push(update);
  else applyUpdates(scope.updates);
  queueMicrotask(() => {
    for (const settle of scope.settle) settle();
    if (done) done();
  });
  if (thrown !== null) throw thrown.error;
  return null;
}

export function useTransition() {
  const inst = _requireInstance('useTransition');
  const slot = _getHookSlot(inst);
  if (!slot.init) {
    slot.init = true;
    slot.pending = 0;
    slot.start = (fn) => {
      let counted = false;
      const promise = runTransition(fn, () => {
        if (counted && --slot.pending === 0) scheduleUpdate(inst);
      });
      if (promise !== null) {
        counted = true;
        if (slot.pending++ === 0) scheduleUpdate(inst);
        // React reports a rejected action at the nearest error boundary.
        promise.then(undefined, (error) => { slot.error = { error }; scheduleUpdate(inst); });
      }
    };
  }
  if (slot.error) {
    const { error } = slot.error;
    slot.error = null;
    throw error;
  }
  return [slot.pending > 0, slot.start];
}

export function startTransition(fn) {
  const promise = runTransition(fn, null);
  if (promise !== null) promise.then(undefined, (error) => { console.error('[what-react] a transition rejected:', error); });
}

// React 19's second argument: the value for the first render, which commits
// before a render with `value` follows. Later changes of `value` are not
// deferred (rendering here is not time-sliced).
export function useDeferredValue(value, initialValue) {
  const inst = _requireInstance('useDeferredValue');
  const slot = _getHookSlot(inst);
  if (!slot.init) {
    slot.init = true;
    slot.initial = initialValue !== undefined && !Object.is(initialValue, value);
  }
  if (slot.initial) {
    // Queued on every render until it ran (a render that suspends drops it).
    _pushPassive(inst, slot, () => {
      slot.initial = false;
      scheduleUpdate(inst);
    });
    return initialValue;
  }
  return value;
}

// ---- useOptimistic ----
// The value with the optimistic updates applied, for as long as the
// transition (action) that added them is running; then `passthrough` again.

export function useOptimistic(passthrough, reducer) {
  const inst = _requireInstance('useOptimistic');
  const slot = _getHookSlot(inst);
  if (!slot.init) {
    slot.init = true;
    slot.actions = [];
    slot.add = (action) => {
      const entry = { action };
      slot.actions.push(entry);
      scheduleUpdate(inst);
      const revert = () => {
        const at = slot.actions.indexOf(entry);
        if (at !== -1) slot.actions.splice(at, 1);
        scheduleUpdate(inst);
      };
      // Outside a transition React drops the update at once.
      if (currentTransition !== null) currentTransition.settle.push(revert);
      else queueMicrotask(revert);
    };
  }
  slot.reducer = reducer;
  let value = passthrough;
  for (const entry of slot.actions) value = typeof slot.reducer === 'function' ? slot.reducer(value, entry.action) : entry.action;
  return [value, slot.add];
}

// ---- useActionState ----
// [state, dispatch, isPending]: dispatch(payload) runs action(state, payload)
// in a transition, one call after the other, each with the last one's result.

export function useActionState(action, initialState) {
  const inst = _requireInstance('useActionState');
  const slot = _getHookSlot(inst);
  if (!slot.init) {
    slot.init = true;
    slot.state = initialState;
    slot.pending = 0;
    slot.queue = Promise.resolve();
    slot.dispatch = (payload) => {
      if (slot.pending++ === 0) scheduleUpdate(inst);
      const run = () => {
        const result = runTransition(() => slot.action(slot.state, payload), null);
        return result === null ? slot.lastSync : result.then((values) => values[0]);
      };
      const done = slot.queue.then(run).then(
        (next) => { slot.state = next; },
        (error) => { slot.error = { error }; },
      ).then(() => {
        slot.pending--;
        scheduleUpdate(inst);
      });
      slot.queue = done;
      // The transition that dispatched (a form action) lasts as long as the action.
      if (currentTransition !== null) currentTransition.wait.push(done);
    };
  }
  // The latest action, wrapped so a sync result is kept for the queue.
  slot.action = (state, payload) => {
    const result = action(state, payload);
    slot.lastSync = result;
    return result;
  };
  if (slot.error) {
    const { error } = slot.error;
    slot.error = null;
    throw error;
  }
  return [slot.state, slot.dispatch, slot.pending > 0];
}

// ---- useEffectEvent ----
// A function that always calls the latest `fn`, for use inside effects.

export function useEffectEvent(fn) {
  const inst = _requireInstance('useEffectEvent');
  const slot = _getHookSlot(inst);
  slot.fn = fn;
  if (!slot.init) {
    slot.init = true;
    slot.call = (...args) => slot.fn(...args);
  }
  return slot.call;
}

// ---- Form actions and useFormStatus (react-dom) ----

const NOT_PENDING = Object.freeze({ pending: false, data: null, method: null, action: null });
const formStatusListeners = new Set();

// How a form's function action runs (runtime.js calls this on submit): in a
// transition, with the form's status published for useFormStatus, and the
// form's uncontrolled fields reset once it has succeeded.
_setFormActionRunner((form, action, data) => {
  const publish = (status) => {
    form._compatStatus = status;
    for (const listener of [...formStatusListeners]) listener();
  };
  publish({ pending: true, data, method: 'post', action });
  let failed = false;
  try {
    const promise = runTransition(() => action(data), () => {
      publish(NOT_PENDING);
      if (!failed && form.isConnected) form.reset();
    });
    if (promise !== null) promise.then(undefined, (error) => { failed = true; console.error('[what-react] a form action rejected:', error); });
  } catch (error) {
    failed = true;
    console.error('[what-react] a form action threw:', error);
  }
});

/** The status of the <form> this component is inside (react-dom's useFormStatus). */
export function useFormStatus() {
  const inst = _requireInstance('useFormStatus');
  return useSyncExternalStore(
    (notify) => { formStatusListeners.add(notify); return () => formStatusListeners.delete(notify); },
    () => {
      const parent = _hostParent(inst);
      const form = parent && typeof parent.closest === 'function' ? parent.closest('form') : null;
      return (form && form._compatStatus) || NOT_PENDING;
    },
    () => NOT_PENDING,
  );
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

export function useDebugValue(_value, _format) {}

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
  // ERROR_CODES.USE_INVALID_ARG
  throw Object.assign(
    new Error('[what-react] use() expects a promise or a context.'),
    { code: 'ERR_USE_INVALID_ARG' },
  );
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
