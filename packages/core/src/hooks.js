// What Framework - Hooks
// React-familiar hooks backed by signals for run-once component model.
// Components run ONCE. Hooks return signal accessors (functions) so the
// fine-grained runtime handles reactive updates automatically via effects.

import { signal, computed, untrack, getOwner, onCleanup as onOwnerCleanup, _userEffect, _currentComponent, _contextOf, _devAsyncWork, _devCallSite, _asyncComputed, _asyncStatus, _asyncError, _refresh, _setAsyncValue, _installSeedOps, __DEV__ } from './reactive.js';
import { getServerContext, isServerRender } from './server-context.js';
import { getLoaderData as _getLoaderData, getResource as _getResource, getResourceError as _getResourceError, _seedFor, _errorFromRecord } from './hydration-data.js';
import { computed as asyncComputed } from './async.js';
import { _enableSuspense } from './render.js';
import { report } from './diagnostics.js';

// --- useLoaderData ---
// Returns the current page's server loader data. Works during SSR (reads the
// active render context) and during/after hydration on the client (reads the
// consolidated #__what_data payload). Intentionally NOT a component-scoped hook
// (no hook slot) so it is safe to call anywhere — components, effects, helpers.
export function useLoaderData() {
  // The branch is on "is a server render in progress", NOT on "does a document
  // exist". Those are different questions, and `typeof document === 'undefined'`
  // answers the wrong one: jsdom and happy-dom are loaded process-wide by a huge
  // number of test setups, and some SSR runtimes ship a DOM shim outright, so a
  // REAL server render routinely sees a `document`. It then took the client path
  // and returned the #__what_data payload left over from a PREVIOUS render
  // instead of this request's loader result — the page silently served another
  // request's data, and under concurrency, another user's.
  //
  // isServerRender() asks the render scope (see server-context.js), which is the
  // same correction 0.12.0 applied to renderToString.
  if (isServerRender()) {
    const ctx = getServerContext();
    return ctx ? ctx.loaderData : undefined;
  }
  // Client: read from the consolidated hydration payload (cached, single parse).
  return _getLoaderData();
}

// The component a hook belongs to: the nearest component owner above the
// current owner (reactive.js _componentOwner).
function getCtx(hookName) {
  const ctx = _currentComponent();
  if (!ctx) {
    throw Object.assign(new Error(
      `[what] ${hookName || 'Hook'}() can only be called inside a component function. ` +
      `Did you call it outside of a component or in an async callback? ` +
      `If you need reactive state outside a component, use signal() directly.`
    ), { code: 'ERR_HOOK_OUTSIDE_COMPONENT' });
  }
  return ctx;
}

function getHook(ctx) {
  if (ctx.hooks === null) ctx.hooks = [];
  const index = ctx.hookIndex++;
  return { index, exists: index < ctx.hooks.length };
}

// --- useState ---
// Returns [signalAccessor, setter]. The accessor is a function — call it to read.
// In JSX, {count} (where count is the signal function) auto-binds reactively
// via insert()'s effect wrapper. For interpolation, use count() explicitly.
// This matches Solid's API and works with the run-once component model.

export function useState(initial) {
  const ctx = getCtx('useState');
  const { index, exists } = getHook(ctx);

  if (!exists) {
    const s = signal(typeof initial === 'function' ? initial() : initial);
    ctx.hooks[index] = s;
  }

  const s = ctx.hooks[index];
  return [s, s.set];
}

// --- useSignal ---
// Returns the raw signal. More powerful: read with sig(), write with sig.set(v).
// Avoids array destructuring overhead.

export function useSignal(initial) {
  const ctx = getCtx('useSignal');
  const { index, exists } = getHook(ctx);

  if (!exists) {
    ctx.hooks[index] = signal(typeof initial === 'function' ? initial() : initial);
  }

  return ctx.hooks[index];
}

// --- useComputed ---
// computed() as a hook: a derived value, which may be async (see async.js).

export function useComputed(fn) {
  const ctx = getCtx('useComputed');
  const { index, exists } = getHook(ctx);

  if (!exists) {
    ctx.hooks[index] = asyncComputed(fn);
  }

  return ctx.hooks[index];
}

// --- useEffect ---
// Side effect that runs after mount, in the user phase: after the render-phase
// effects (the DOM bindings) of the same flush, so it sees settled DOM. The
// first run is on the microtask after the component body (or at the end of
// the batch, or in the flush, that builds the component). In the run-once
// model, deps-based re-running only works if deps are signal accessors:
// - No deps (undefined): re-runs whenever a signal it read changes
// - Empty deps []: runs once on mount, cleanup on unmount
// - Deps [a, b]: re-runs when a signal among the deps changes; what the
//   callback reads is untracked
// A returned function is the cleanup, run before each re-run and on unmount.
// The effect belongs to the component: unmounting disposes it.

// Dev-mode: a value in the deps array (count() rather than count) is read once
// and never changes. Kept out of line: written inline after another statement,
// esbuild folds `if (seq, false) { loop }` without dropping the loop, which
// kept this report() call and the whole catalogue in production bundles.
function reportPlainDeps(deps) {
  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i];
    if (dep != null && typeof dep !== 'function') {
      report('ERR_EFFECT_DEP_NOT_FUNCTION', { data: { index: i } });
    }
  }
}

// A callback's result as an effect's: a function is the cleanup. In
// development, a thenable (an async callback) is work the component started,
// so an effect created after its `await`, under no owner, is reported; an
// async useEffect callback is reported itself, since its promise is not a
// cleanup and its runs can finish out of order (an async onMount, which runs
// once, passes `mounting`).
function cleanupOf(result, ctx, mounting) {
  if (typeof result === 'function') return result;
  if (__DEV__ && result != null && typeof result.then === 'function') {
    _devAsyncWork(ctx, result);
    if (!mounting) report('ERR_ASYNC_EFFECT', { data: { effectName: 'useEffect' } });
  }
  return undefined;
}

export function useEffect(fn, deps) {
  const ctx = getCtx('useEffect');
  getHook(ctx);
  if (__DEV__ && Array.isArray(deps)) reportPlainDeps(deps);
  // A server render never mounts.
  if (isServerRender()) return;

  let run;
  if (deps === undefined) {
    run = () => cleanupOf(fn(), ctx);
  } else if (deps.length === 0) {
    run = () => cleanupOf(untrack(fn), ctx);
  } else {
    run = () => {
      for (let i = 0; i < deps.length; i++) {
        const dep = deps[i];
        if (typeof dep === 'function' && dep._signal) dep();
      }
      return cleanupOf(untrack(fn), ctx);
    };
  }
  if (__DEV__) {
    /** @type {any} */ (run).inner = fn;
    /** @type {any} */ (_userEffect)(run, _devCallSite(fn.name || 'useEffect', useEffect));
  } else {
    _userEffect(run);
  }
}

// --- useMemo ---
// Memoized computed value. Uses computed() for automatic signal tracking.
// The deps array is accepted for API compatibility but ignored internally —
// computed() auto-tracks signal dependencies.
// Returns a computed signal function (call it to read the value).

export function useMemo(fn, _deps) {
  const ctx = getCtx('useMemo');
  const { index, exists } = getHook(ctx);

  if (!exists) {
    ctx.hooks[index] = { computed: computed(__DEV__ ? devMemo(fn) : fn) };
  }

  return ctx.hooks[index].computed;
}

// Development: useMemo keeps a promise its function returns as the value, as
// React's does; one that does is almost always meant to be an async value.
function devMemo(fn) {
  const memo = () => {
    const value = fn();
    if (value != null && typeof value.then === 'function') report('ERR_ASYNC_MEMO');
    return value;
  };
  memo.inner = fn;
  return memo;
}

// --- useCallback ---
// Memoized callback. In the run-once model, the component function only
// executes once, so the callback reference is inherently stable.
// Simply store and return the function on first call.

export function useCallback(fn, _deps) {
  const ctx = getCtx('useCallback');
  const { index, exists } = getHook(ctx);

  if (!exists) {
    ctx.hooks[index] = { callback: fn };
  }

  return ctx.hooks[index].callback;
}

// --- useRef ---
// Mutable ref object. Does NOT trigger re-renders.
// Works correctly in run-once model — the ref persists for the component lifetime.

export function useRef(initial) {
  const ctx = getCtx('useRef');
  const { index, exists } = getHook(ctx);

  if (!exists) {
    ctx.hooks[index] = { current: initial };
  }

  return ctx.hooks[index];
}

// --- useContext ---
// Read from the nearest Provider above the current owner, or the default
// value. Providers keep their values on their component's owner, and the walk
// goes up the owner tree, so context resolves the same way in a component
// body, in an effect or region that re-runs long after it, and in a list row.
// A stored signal is read, so the reader subscribes to it.

export function useContext(context) {
  const map = _contextOf(context);
  if (map !== null) {
    const val = map.get(context);
    return (val && val._signal) ? val() : val;
  }
  if (__DEV__) {
    if (!_currentComponent()) {
      report('ERR_HOOK_OUTSIDE_COMPONENT', { data: { hookName: 'useContext', context: context?.displayName || 'Context' } });
    } else if (!context._hasDefault) {
      // createContext() with no argument means the value must come from a provider.
      report('ERR_CONTEXT_NOT_PROVIDED', { data: { context: context.displayName || 'Context' } });
    }
  }
  return context._defaultValue;
}

// --- createContext ---
// Tree-scoped context: a provider sets the value for its subtree only.
// Multiple providers can coexist — each subtree sees its own value.
// Context values are wrapped in signals so consumers re-render when values change.
// The context is its own provider, as in React 19 and Solid 2: <Ctx value={v}>
// and <Ctx.Provider value={v}> render the same component.

export function createContext(defaultValue) {
  function context({ value, children }) {
    const ctx = getCtx('Context.Provider');
    const values = ctx.context || (ctx.context = new Map());
    const current = values.get(context);
    if (current === undefined) values.set(context, signal(value));
    else current.set(value);
    return children;
  }
  context._defaultValue = defaultValue;
  context._hasDefault = arguments.length > 0;
  context.Provider = context;
  // React-compatible Consumer: <Context.Consumer>{value => ...}</Context.Consumer>
  context.Consumer = ({ children }) => {
    const value = useContext(context);
    return typeof children === 'function' ? children(value) : children;
  };
  // The context value is only published once the provider body runs, so
  // compiled children must not be built during this call. See createComponent.
  context._deferChildren = true;
  return context;
}

// --- useReducer ---
// State management with a reducer function.
// Returns [signalAccessor, dispatch] — accessor is a signal function.

export function useReducer(reducer, initialState, init) {
  const ctx = getCtx('useReducer');
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
  return [hook.signal, hook.dispatch];
}

// --- onMount ---
// Run callback once when the component mounts, in the user phase of the flush
// that follows its creation (see useEffect), so it sees settled DOM. Disposed
// with the component if that comes first.

export function onMount(fn) {
  const ctx = getCtx('onMount');
  if (isServerRender()) return;
  _userEffect(() => { cleanupOf(untrack(fn), ctx, true); });
}

// --- onCleanup ---
// Run `fn` when the current owner goes away: the component being rendered (on
// unmount), the effect whose run is executing (before it runs again, and when
// it is disposed), or the root, list row or region around the call.

export function onCleanup(fn) {
  if (getOwner() !== null) onOwnerCleanup(fn);
  else if (__DEV__) report('ERR_CLEANUP_WITHOUT_OWNER');
}

// --- createResource ---
// createResource(fetcher, options) -> [data, { loading, error, refetch, mutate }].
// `data` is an async computed (async.js): reading it before the first value
// lands holds the reader, as any async value does, and a <Suspense> above it
// shows its fallback. `fetcher(source, { signal })` runs untracked: the
// resource fetches when it is created and on refetch(source), not when a
// signal the fetcher reads changes. On the server it takes part in the
// hydration data channel like any async value made in a component, under
// `options.key` when it has one: the client adopts the value (or the error)
// instead of fetching. `initialValue` starts it with a value and no fetch.

export function createResource(fetcher, options = {}) {
  _enableSuspense();
  _installSeedOps();
  let source = options.source;
  const ctx = isServerRender() ? getServerContext() : null;
  const keyed = options.key != null;
  /** @type {any} */
  let seed;
  if (ctx !== null) {
    seed = _seedFor(options.key, false);
  } else if (keyed) {
    // A keyed value is adopted wherever it is read, not only while hydrating.
    const value = options.initialValue != null ? options.initialValue : _getResource(options.key);
    const record = value === undefined ? _getResourceError(options.key) : undefined;
    seed = value !== undefined ? { value, track: false } : record ? { error: _errorFromRecord(record), track: false } : null;
  } else {
    // Asked even with an initialValue: every keyless value consumes its owner key.
    seed = _seedFor(null, false);
    if (options.initialValue != null) seed = { value: options.initialValue, track: false };
  }
  const data = _asyncComputed(({ signal }) => untrack(() => (ctx !== null
    ? fetcher(source ?? true, { signal: ctx.signal, request: ctx.request })
    : fetcher(source, { signal }))), seed);
  // A server render suspends the component that makes it until it settles,
  // and finds it in the render's store when the component runs again.
  if (ctx !== null && _asyncStatus(data) === 'unresolved') data();

  const loading = () => {
    const status = _asyncStatus(data);
    return status === 'unresolved' || status === 'pending';
  };
  const error = () => {
    _asyncStatus(data);
    return _asyncError(data);
  };
  // Never rejects: a failed refetch shows in error().
  const refetch = (next) => {
    source = next;
    return _refresh(data).then(() => undefined, () => undefined);
  };
  const mutate = (value) => {
    _setAsyncValue(data, typeof value === 'function' ? value(data.peek()) : value);
  };

  return [data, { loading, error, refetch, mutate }];
}

// A local `depsChanged` lived here, commented "kept for potential external
// use". It was never exported, so there was no external use to keep it for,
// and nothing in this package called it. react-compat has its own copy, which
// is the one that is actually used.
