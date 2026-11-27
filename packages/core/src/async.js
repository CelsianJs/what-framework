// What Framework - Async values
//
// The async surface of the root entry, on the engine's async computeds and
// transitions (reactive.js):
//
//   computed(fn)          a computed whose function may return a promise or an
//                         async iterable: an async value in the graph
//   refresh(c)            fetch it again
//   isPending(fn)         is a value fn reads being fetched again?
//   startTransition(fn)   commit what fn's writes cause in one step, once the
//                         async work they started has landed
//   useTransition()       [isPending, startTransition]
//   useOptimistic(s, fn)  [optimistic state, addOptimistic]
//   use(x)                read a promise, a context or an accessor
//   settled()             resolves when nothing is queued, fetching or open
//
// docs/ASYNC.md describes the model and what it guarantees.

import {
  _asyncComputed,
  _devCallSite,
  _refresh,
  _isPending,
  _startTransition,
  _currentTransition,
  _onCommit,
  _urgent,
  _latestComputed,
  _runHeldReaders,
  _busy,
  _onQuiet,
  _currentComponent,
  signal,
  untrack,
  getOwner,
  onCleanup,
  __DEV__,
  __devtools,
} from './reactive.js';
import { _seedFor } from './hydration-data.js';
import { _enableSuspense } from './render.js';
import { useContext } from './hooks.js';
import { report, recordObservation, _thrownMessage } from './diagnostics.js';

/**
 * A computed. Its function may return a promise, a thenable or an async
 * iterable: the computed is then an async value. It keeps its last value while
 * a newer run is in flight, supersedes and aborts older runs, and a function
 * that takes an argument gets `{ signal }`, the run's AbortSignal. A tracked
 * read of a value that has not landed holds the reader (see docs/ASYNC.md).
 */
export function computed(fn) {
  _enableSuspense();
  if (__DEV__) return /** @type {any} */ (_asyncComputed)(fn, _seedFor(null, true), _devCallSite(arguments[1] || fn.name, computed));
  return _asyncComputed(fn, _seedFor(null, true));
}

/**
 * Run an async computed again now. Its readers see it as pending (once it has
 * a value) until the new value lands. Resolves with the value when it lands,
 * rejects with its error.
 */
export function refresh(c) {
  return _refresh(c);
}

/**
 * Whether an async computed that `fn` reads, directly or through computeds,
 * has a value and is fetching a new one. False on first load, before any value
 * has landed. Tracked like a read: a binding re-runs when the answer changes.
 */
export function isPending(fn) {
  return _isPending(fn);
}

/**
 * Hold everything the writes inside `fn` reach until the async work they
 * started has landed, then commit it in one flush. Writes outside `fn` commit
 * as usual. Returns a promise that resolves when the transition commits and
 * rejects with an async `fn`'s rejection. Writes `fn` makes after an `await`
 * are ordinary writes, as in React.
 */
export function startTransition(fn) {
  return _startTransition(fn);
}

/**
 * React's useTransition: `[isPending, startTransition]`. `isPending` is an
 * accessor, `isPending()`, true from the moment `startTransition` is called
 * until the transition commits. Leaving the component stops waiting for the
 * async part of its transitions. A rejection goes to the error boundary above
 * the component, as in React 19; the returned promise rejects too.
 */
export function useTransition() {
  const open = signal(0);
  /** @type {Set<any>} */
  const calls = new Set();
  const owner = getOwner();
  if (owner !== null) onCleanup(() => { for (const call of calls) call.abandon(); });
  const isPending = () => open() > 0;
  const start = (fn) => _startTransition(fn, (t, call) => {
    open((n) => n + 1);
    call.owner = owner;
    calls.add(call);
    _onCommit(t, () => {
      open((n) => n - 1);
      calls.delete(call);
    });
  });
  return [isPending, start];
}

/**
 * React 19's useOptimistic. Returns `[optimistic, addOptimistic]`:
 * `optimistic()` is `state` (an accessor, or a plain value) with every overlay
 * added by `addOptimistic(value)` applied through `update(current, value)`
 * (or replacing it, without `update`). An overlay lives as long as the
 * transition it was added in: it shows at once and drops when that transition
 * commits, in the same flush that shows the real result, so neither the
 * confirmation nor the rollback of a failed action flickers. Call
 * `addOptimistic` synchronously inside `startTransition`.
 */
export function useOptimistic(state, update) {
  const overlays = signal(/** @type {Array<{ value: any }>} */ ([]));
  const base = typeof state === 'function' ? state : () => state;
  const optimistic = _latestComputed(() => {
    let value = base();
    for (const o of overlays()) value = update === undefined ? o.value : update(value, o.value);
    return value;
  });
  const addOptimistic = (value) => {
    const overlay = { value };
    const place = (t) => {
      if (__DEV__) recordObservation(__devtools, 'optimistic:add', overlay, { transition: t, owner: getOwner() });
      // Urgent, also where a transition holds a reader of the view.
      _urgent(() => {
        overlays((list) => [...list, overlay]);
        _runHeldReaders(optimistic);
      });
      _onCommit(t, () => overlays((list) => (
        __DEV__ && recordObservation(__devtools, 'optimistic:drop', overlay, { transition: t }),
        list.filter((o) => o !== overlay)
      )));
    };
    const t = _currentTransition();
    if (t !== null) {
      place(t);
      return;
    }
    // Outside a transition the overlay has nothing to last for: it shows, and
    // drops once the current flush is over, as in React.
    if (__DEV__) report('ERR_OPTIMISTIC_OUTSIDE_TRANSITION');
    _startTransition(noop, place);
  };
  return [optimistic, addOptimistic];
}

function noop() {}

// What use() knows about each promise it has seen.
/** @type {WeakMap<object, { status: 'pending' | 'fulfilled' | 'rejected', value?: any, reason?: any }>} */
const promises = new WeakMap();

/**
 * React 19's use(). A context reads like useContext. A promise returns its
 * value once it has settled (or throws its error); until then the component
 * suspends and is rendered again when it settles, so the promise must outlive
 * the component (made outside it, or passed in): one made in the body is new
 * on every attempt. An accessor (an async computed) is read untracked, which
 * suspends the component the same way while it has no value.
 */
export function use(x) {
  _enableSuspense();
  if (typeof x === 'function') return x.Provider === x ? useContext(x) : untrack(x);
  if (x != null && typeof x.then === 'function') {
    let entry = promises.get(x);
    if (entry === undefined) {
      const fresh = { status: /** @type {'pending' | 'fulfilled' | 'rejected'} */ ('pending'), value: undefined, reason: undefined };
      promises.set(x, entry = fresh);
      x.then((value) => { fresh.status = 'fulfilled'; fresh.value = value; }, (reason) => { fresh.status = 'rejected'; fresh.reason = reason; });
    }
    if (entry.status === 'fulfilled') {
      readSettled(x);
      return entry.value;
    }
    if (entry.status === 'rejected') throw entry.reason;
    suspendOn(x);
    throw x;
  }
  throw new TypeError(__DEV__
    ? '[what] use(x) reads a promise, a context or an accessor; it was given ' + (x === null ? 'null' : typeof x) + '.'
    : '[what] use: unsupported value');
}

// A component that keeps suspending on a promise it has never seen, after the
// one it suspended on before has settled and was not read again, makes a new
// promise every time it runs: it would never finish, and a promise that is
// already resolved retries at once, so the page would never get to paint. The
// third such suspension in a row is an error instead. The count is per
// instance: a component rendered again in place keeps its props object.
/** @type {WeakMap<object, { last: any, strikes: number }>} */
const suspensions = new WeakMap();

function suspensionsOf() {
  const frame = _currentComponent();
  if (frame === null) return null;
  const instance = frame.props !== undefined ? frame.props : frame.Component;
  let d = suspensions.get(instance);
  if (d === undefined) suspensions.set(instance, d = { last: null, strikes: 0 });
  return d;
}

function readSettled(x) {
  const d = suspensionsOf();
  if (d !== null && d.last === x) d.strikes = 0;
}

function suspendOn(x) {
  const d = suspensionsOf();
  if (d === null) return;
  const prior = d.last !== null ? promises.get(d.last) : undefined;
  if (prior !== undefined && d.last !== x && prior.status !== 'pending' && ++d.strikes >= 3) {
    d.last = null;
    d.strikes = 0;
    const frame = /** @type {any} */ (_currentComponent());
    const component = frame.Component.displayName || frame.Component.name || 'Anonymous';
    if (__DEV__) report('ERR_USE_UNCACHED_PROMISE', { data: { component } });
    throw Object.assign(new Error(__DEV__
      ? _thrownMessage('ERR_USE_UNCACHED_PROMISE', `Component "${component}" keeps suspending on a new promise: use() received a promise made in the component body. Make it outside the component, or use computed().`)
      : '[what] use: a new promise on every run'), { code: 'ERR_USE_UNCACHED_PROMISE' });
  }
  d.last = x;
}

/**
 * A promise that resolves once the graph is quiet: no effect is queued to
 * run, no async computed is fetching, no transition is open, and no
 * <Suspense> waits on a promise. For tests and agents: act, then
 * `await settled()`, then read the DOM. It never resolves while something
 * keeps fetching (polling, a promise that never settles).
 */
export function settled() {
  return new Promise((resolve) => {
    let stop = noop;
    // Async work tells the quiet hook when it ends; queued effects run in a
    // flush that is on its way, so they are looked at again after it.
    const check = () => {
      const busy = _busy();
      if (busy === 0) {
        stop();
        resolve(undefined);
      } else if (busy === 1) {
        queueMicrotask(check);
      }
    };
    stop = _onQuiet(check);
    check();
  });
}
