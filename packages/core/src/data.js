// What Framework - Data: one query cache on async values (docs/DATA.md).
//
// Every key the app reads is one entry, and every entry is one async value in
// the reactive graph (reactive.js _asyncComputed): what reads it waits for it
// the way it waits for any async value, a transition holds what its refetch
// reaches, settled() waits for its fetch, and a server render serializes it in
// the hydration channel under its key, so the client adopts it instead of
// fetching. On top of the entries:
//
//   query(key, fetcher)    the signal-native read: an async value whose key may
//                          be reactive (suspends, holds, pending(), refresh())
//   useQuery, useSWR,      the React-ecosystem shapes (TanStack Query, SWR):
//   useInfiniteQuery,      views that never suspend, with status flags
//   useFetch
//   invalidateQueries, invalidatePath, prefetchQuery, setQueryData,
//   getQueryData, clearCache    the cache, whichever hook reads it
//
// An entry's fetches are flights. One flight is current; a newer one
// supersedes it (aborting its signal), and a flight whose result can no longer
// be shown (its readers all left, or clearCache() ran) is killed: its result is
// dropped and nothing is delivered. Readers are observers: an entry with none
// is not fetched, and is dropped after its gcTime.

import {
  signal,
  effect,
  computed,
  untrack,
  onCleanup,
  getOwner,
  createRoot,
  runWithOwner,
  _detached,
  _asyncComputed,
  _refresh,
  _asyncStatus,
  _asyncError,
  _setAsyncValue,
  _installSeedOps,
  _isNotReady,
  __DEV__,
} from './reactive.js';
import { _seedFor, getResource, getResourceError, _errorFromRecord } from './hydration-data.js';
import { getServerContext, _isServerProcess } from './server-context.js';
import { report } from './diagnostics.js';
import { _enableSuspense, isHydrating } from './render.js';

const PLAIN = 0;
const INFINITE = 1;

// An entry's value before anything landed, or after clearCache(): no data.
const IDLE = /* @__PURE__ */ Object.freeze({ toString: () => '[what] no data' });

// What the next run of an entry's node does (entry.next).
const FETCH = 1;    // start a flight
const ADOPT = 2;    // wait for the flight already in flight (after a hard invalidation)

const DEFAULT_GC_TIME = 5 * 60 * 1000;

function noop() {}

// Every timer here is housekeeping or polling, which is no reason to keep a
// Node process alive.
function unrefTimer(timer) {
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}

// --- Keys ---
// Array keys are joined into the same flat string space as string keys, so
// `useQuery({ queryKey: ['todos'] })`, `useSWR('todos')` and `query('todos')`
// are one entry, and every entry point (invalidateQueries, getQueryData, the
// predicate a caller writes) sees the same spelling. Segments escape ':' so
// ['user', 'a:b'] cannot collide with ['user', 'a', 'b'].
function normalizeQueryKey(key) {
  if (!Array.isArray(key)) return String(key);
  return key
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part) ?? String(part)))
    .map((part) => part.replace(/([\\:])/g, '\\$1'))
    .join(':');
}

const CHANNEL = 'query:';

// --- The cache ---
// The client keeps one cache per page. A server render keeps one per render
// (a request's data must never answer another request), released with it.
const clientCache = [new Map(), new Map()];
/** @type {WeakMap<object, Map<string, any>[]>} */
const serverCaches = new WeakMap();

function cacheOf(kind) {
  const ctx = getServerContext();
  if (ctx === null) {
    if (!_isServerProcess()) return clientCache[kind];
    // On a server, outside every render, loader and action: no request to
    // bind to, and a cache every request shares would hand one user's data to
    // another. The call gets an empty cache nothing else sees.
    if (__DEV__) report('ERR_QUERY_OUTSIDE_RENDER');
    return new Map();
  }
  let caches = serverCaches.get(ctx);
  if (caches === undefined) serverCaches.set(ctx, caches = [new Map(), new Map()]);
  return caches[kind];
}

// Server values the page carried, taken once per key: a key read again later
// (after it was dropped) fetches, it does not adopt the page's old value.
/** @type {Set<string>} */
const adopted = new Set();
let channelOpen = true;

function hydrationSeed(hash) {
  if (!channelOpen || adopted.has(hash)) return null;
  const value = getResource(CHANNEL + hash);
  if (value !== undefined) {
    adopted.add(hash);
    return { value, track: false };
  }
  const record = getResourceError(CHANNEL + hash);
  if (record === undefined) return null;
  adopted.add(hash);
  return { error: _errorFromRecord(record), track: false };
}

function entryFor(kind, hash, key, observer) {
  const cache = cacheOf(kind);
  let e = cache.get(hash);
  if (e === undefined) {
    e = newEntry(kind, hash, key, cache, observer);
    cache.set(hash, e);
  }
  return e;
}

function newEntry(kind, hash, key, cache, observer) {
  const e = {
    kind,
    hash,
    key,
    cache,
    /** @type {any} */ node: null,
    dispose: noop,
    /** @type {any} */ flight: null,
    next: 0,
    /** @type {any} */ error: undefined,
    version: 0,
    updatedAt: 0,
    fetchedAt: 0,
    fetches: 0,
    /** @type {any} */ last: null,
    hydrated: false,
    /** @type {Set<any>} */ observers: new Set(),
    gcTime: DEFAULT_GC_TIME,
    /** @type {any} */ timer: null,
    /** @type {any} */ conf: observer !== null ? observer.conf : null,
    /** @type {any} */ by: null,
    /** @type {any} */ op: null,
    /** @type {Set<string> | null} */ paths: null,
    dir: kind === INFINITE ? signal(/** @type {string | null} */ (null)) : null,
    // Moves at every landing: query() reads it, not the node, while the entry
    // has no data, so the engine never sees "a value being refetched" there.
    tick: signal(0),
    /** @type {{ promise: Promise<any>, resolve: (v: any) => void, reject: (e: any) => void } | null} */ arrival: null,
    dropped: false,
  };
  const ctx = getServerContext();
  /** @type {any} */
  let seed;
  if (ctx !== null) {
    seed = _seedFor(CHANNEL + hash, false);
  } else {
    seed = kind === PLAIN ? hydrationSeed(hash) : null;
    if (seed !== null) {
      e.hydrated = true;
      e.updatedAt = Date.now();
      if ('error' in seed) e.error = seed.error;
      queueMicrotask(() => { e.hydrated = false; });
    } else if (observer !== null && observer.initialData !== undefined) {
      const initial = typeof observer.initialData === 'function' ? observer.initialData() : observer.initialData;
      seed = { value: initial === undefined ? IDLE : initial, track: false };
      if (initial !== undefined) e.updatedAt = observer.initialDataUpdatedAt ?? Date.now();
    } else {
      seed = { value: IDLE, track: false };
    }
  }
  _installSeedOps();
  const make = () => createRoot((dispose) => {
    e.dispose = dispose;
    e.node = _asyncComputed(run(e), seed);
  });
  // Entries outlive the component that first read them; a server render's
  // belong to the render, which releases them with everything else it made.
  if (ctx !== null && ctx.owner) runWithOwner(ctx.owner, make);
  else _detached(make);
  return e;
}

// The function of an entry's node: what one run of it does.
function run(e) {
  return () => {
    const op = e.next;
    e.next = 0;
    if (op === ADOPT && e.flight !== null) return e.flight.promise;
    if (op === 0 && !wanted(e)) {
      // A run nothing asked for (what the fetcher read changed, an error
      // boundary's reset) while nothing would show the result: no request.
      if (e.error !== undefined) throw e.error;
      return untrack(() => e.node.peek());
    }
    return startFlight(e).promise;
  };
}

// Whether anything would show a fetch nothing asked for by name.
function wanted(e) {
  if (getServerContext() !== null) return true;
  for (const o of e.observers) if (o.active()) return true;
  return false;
}

function valueOf(e) {
  const v = untrack(() => e.node.peek());
  return v === IDLE ? undefined : v;
}

// --- Flights ---

function startFlight(e) {
  const prev = e.flight;
  if (prev !== null) kill(e, prev, true);
  const ac = new AbortController();
  const op = e.op;
  e.op = null;
  const f = {
    ac,
    dead: false,
    superseded: false,
    by: e.by,
    // The observer that asked fetches with its own fetcher; the cache's own
    // fetches use the last observer's.
    conf: (e.by !== null && e.by.conf) || e.conf,
    op,
    /** @type {any} */ promise: null,
    failed: false,
    /** @type {any} */ result: undefined,
    /** @type {any} */ page: undefined,
    started: Date.now(),
    /** @type {(() => void) | null} */ onKill: null,
  };
  e.by = null;
  e.flight = f;
  e.fetchedAt = f.started;
  e.fetches++;
  let first;
  try {
    first = callFetcher(e, f);
  } catch (err) {
    // A fetcher that threw before it started, or read an input that is not
    // ready: the node takes that as its run's answer. A throw is the entry's
    // error, as a rejection would be; the query() whose run this is reads it
    // from the entry at once, so the landing does not run it again.
    e.flight = null;
    f.dead = true;
    if (_isNotReady(err)) e.version++;
    else record(e, f, err, true);
    throw err;
  }
  f.promise = retrying(e, f, first);
  // Before the engine lands the result: readers that re-run on the landing see
  // the new version, so they can tell it from a refresh.
  f.promise.then((v) => landed(e, f, v, false), (err) => landed(e, f, err, true));
  // After it: callbacks see the value in the cache.
  f.promise.then(noop, noop).then(() => deliver(e, f));
  return f;
}

function callFetcher(e, f) {
  const conf = f.conf;
  if (e.kind === PLAIN) return conf.run(e.key, f.ac.signal);
  const base = valueOf(e) ?? { pages: [], pageParams: [] };
  const op = f.op || { param: conf.initialPageParam, place: 'first' };
  return Promise.resolve(conf.run(e.key, op.param, f.ac.signal)).then((page) => {
    f.page = page;
    if (op.place === 'next') return { pages: [...base.pages, page], pageParams: [...base.pageParams, op.param] };
    if (op.place === 'previous') return { pages: [page, ...base.pages], pageParams: [op.param, ...base.pageParams] };
    return { pages: [page], pageParams: [op.param] };
  });
}

// The first attempt is called synchronously (what the fetcher reads before its
// first await is tracked); a failed attempt is retried after retryDelay, up to
// `retry` attempts in all, unless the flight is aborted meanwhile.
async function retrying(e, f, first) {
  let pending = first;
  for (let tries = 1; ; tries++) {
    try {
      return await pending;
    } catch (err) {
      const conf = f.conf;
      if (f.dead || tries >= attemptsOf(conf.retry, tries, err)) throw err;
      await wait(conf.retryDelay(tries), f.ac.signal);
      if (f.dead) throw err;
      pending = callFetcher(e, f);
    }
  }
}

function attemptsOf(retry, tries, err) {
  if (typeof retry === 'function') return retry(tries - 1, err) ? tries + 1 : tries;
  if (retry === true) return Infinity;
  if (retry === false) return 1;
  return Math.max(1, Number(retry) || 0);
}

function wait(ms, abortSignal) {
  return new Promise((resolve, reject) => {
    const id = unrefTimer(setTimeout(resolve, ms));
    abortSignal.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

function landed(e, f, result, failed) {
  f.failed = failed;
  f.result = result;
  if (f.dead) return;
  if (e.flight === f) e.flight = null;
  record(e, f, result, failed);
  e.tick((n) => n + 1);
}

// A fetch's result, on the entry.
function record(e, f, result, failed) {
  e.version++;
  const now = Date.now();
  e.updatedAt = now;
  e.error = failed ? result : undefined;
  e.last = { at: now, ms: now - f.started, ok: !failed };
  if (e.dir !== null) e.dir(null);
  answer(e, result, failed);
}

// The entry got a value or an error: a query() waiting for its first one
// lands with it, and runs again to read the node from then on.
function arrive(e, result, failed) {
  answer(e, result, failed);
  e.tick((n) => n + 1);
}

function answer(e, result, failed) {
  const a = e.arrival;
  if (a !== null) {
    e.arrival = null;
    (failed ? a.reject : a.resolve)(result);
  }
}

function arrival(e) {
  if (e.arrival === null) {
    /** @type {(value: any) => void} */
    let resolve = noop;
    /** @type {(error: any) => void} */
    let reject = noop;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    e.arrival = { promise, resolve, reject };
  }
  return e.arrival.promise;
}

// A flight's result is dropped: superseded by a newer flight, or nothing can
// show it any more.
function kill(e, f, superseded) {
  if (f.dead) return;
  f.dead = true;
  f.superseded = superseded;
  f.ac.abort();
  if (e.flight === f) e.flight = null;
  if (f.onKill !== null) f.onKill();
}

// The callbacks of the observer that asked for a flight, once its result is in
// the cache. A flight the cache started itself (an invalidation) belongs to
// the entry's first observer.
function deliver(e, f) {
  if (f.dead) return;
  const o = f.by;
  if (o === null || !o.alive) return;
  if (f.failed) {
    if (o.onError) o.onError(f.result, e.key);
    if (o.onSettled) o.onSettled(null, f.result);
  } else {
    // An infinite query's callbacks hear the page that was fetched.
    const value = e.kind === INFINITE ? f.page : f.result;
    if (o.onSuccess) o.onSuccess(value, e.key);
    if (o.onSettled) o.onSettled(value, null);
  }
}

// What a fetch the caller asked for gave: its value (an infinite query's: the
// page it fetched), the value of the flight that superseded it, or undefined
// when its result was dropped.
function outcome(e, f) {
  const settled = f.promise.then(
    (v) => (f.dead ? follow(e, f) : e.kind === INFINITE ? f.page : v),
    (err) => (f.dead ? follow(e, f) : Promise.reject(err)),
  );
  if (f.dead) return settled;
  // Dropped, it answers at once, without waiting for a transport that may
  // ignore the abort: the newer flight is in place by the time this runs.
  const dropped = new Promise((resolve) => {
    const prev = f.onKill;
    f.onKill = () => {
      if (prev !== null) prev();
      resolve(undefined);
    };
  }).then(() => follow(e, f));
  return Promise.race([settled, dropped]);
}

function follow(e, f) {
  return f.superseded && e.flight !== null ? outcome(e, e.flight) : undefined;
}

// Fetch an entry now, superseding what is in flight. `by` is the observer
// whose callbacks hear the result. Returns the flight, or null when the run
// answered at once.
function fetchEntry(e, by, op) {
  e.by = by;
  e.op = op || null;
  e.next = FETCH;
  if (e.dir !== null) e.dir(op ? op.dir : 'next');
  refreshNode(e);
  e.next = 0;
  e.by = null;
  e.op = null;
  return e.flight;
}

// Run an entry's node now. A failed run's error is the entry's, which its
// readers see; the promise refresh() returns adds nothing to that.
function refreshNode(e) {
  _refresh(e.node).then(noop, noop);
}

function refetchOf(e, by, op) {
  const f = fetchEntry(e, by, op);
  return f !== null ? outcome(e, f) : Promise.resolve(valueOf(e));
}

// Make `value` the entry's value now, dropping what is in flight. It lands as
// a fetch's would, so its readers run; the engine ends the node's run in
// flight, and a transition waiting for that run stops waiting.
function commitValue(e, value) {
  if (e.flight !== null) kill(e, e.flight, false);
  if (e.dir !== null) e.dir(null);
  e.version++;
  _setAsyncValue(e.node, value);
  if (value !== IDLE) arrive(e, value, false);
  else e.tick((n) => n + 1);
}

// Land `value` in the entry now, as a fetch would.
function setEntry(e, value) {
  e.updatedAt = Date.now();
  e.error = undefined;
  commitValue(e, value);
}

function dropEntry(e) {
  if (e.dropped) return;
  e.dropped = true;
  if (e.timer !== null) clearTimeout(e.timer);
  if (e.flight !== null) kill(e, e.flight, false);
  if (e.cache.get(e.hash) === e) e.cache.delete(e.hash);
  e.dispose();
}

// --- Observers ---
// Each query(), useQuery(), useSWR()... call is an observer of the entry its
// key names now. It counts as a reader of that entry from its first run until
// its owner is disposed or its key moves on; a key change hands it to the new
// key's entry. On a server render there are no observers: entries live as
// long as the render.

let pathTag = /** @type {string | null} */ (null);

/**
 * @internal Run `fn` and tag the entries its observers read with `path`, so
 * invalidatePath(path) reaches them (the router's route data).
 */
export function _tagQueries(path, fn) {
  const prev = pathTag;
  pathTag = path;
  try {
    return fn();
  } finally {
    pathTag = prev;
  }
}

/**
 * @internal what-router: resolves once no entry read on `path` is fetching
 * its first value: the data a page a navigation committed reads, and what
 * that data makes fetch in turn.
 */
export function _pathLoaded(path) {
  const waits = [];
  for (const e of allEntries()) {
    if (e.flight !== null && e.paths !== null && e.paths.has(path) && e.error === undefined && valueOf(e) === undefined) {
      waits.push(outcome(e, e.flight).then(noop, noop));
    }
  }
  return waits.length === 0 ? Promise.resolve() : Promise.all(waits).then(() => _pathLoaded(path));
}

function acquire(e, o) {
  if (e.dropped) {
    // Dropped (clearCache) between choosing it and attaching: take it back.
    e.dropped = false;
    if (!e.cache.has(e.hash)) e.cache.set(e.hash, e);
  }
  if (e.timer !== null) {
    clearTimeout(e.timer);
    e.timer = null;
  }
  // An entry is kept unread for the longest gcTime among its readers.
  e.gcTime = e.observers.size === 0 ? o.gcTime : Math.max(e.gcTime, o.gcTime);
  e.observers.add(o);
  e.conf = o.conf;
  const path = o.path ?? (typeof location !== 'undefined' ? location.pathname : null);
  if (path != null) (e.paths || (e.paths = new Set())).add(path);
}

function release(e, o) {
  if (!e.observers.delete(o) || e.observers.size > 0) return;
  // Nothing shows this entry now: what is in flight is cancelled (its readers
  // keep the last value), and the entry is dropped once it has stayed unread
  // for its gcTime.
  if (e.flight !== null) commitValue(e, untrack(() => e.node.peek()));
  armGc(e);
}

function armGc(e) {
  if (getServerContext() !== null || e.observers.size > 0 || e.dropped) return;
  if (e.timer !== null) clearTimeout(e.timer);
  e.timer = Number.isFinite(e.gcTime)
    ? unrefTimer(setTimeout(() => {
      e.timer = null;
      if (e.observers.size === 0) dropEntry(e);
    }, e.gcTime))
    : null;
}

// An observer reads `e` now: it holds it, and lets go of the entries it read
// before.
function settle(o, e) {
  for (const x of o.entries) {
    if (x !== e) {
      o.entries.delete(x);
      release(x, o);
    }
  }
  if (e !== null) hold(o, e);
  o.entry = e;
}

function hold(o, e) {
  if (o.entries.has(e)) return;
  o.entries.add(e);
  acquire(e, o);
}

// query()'s value reads a new key's entry before the observer's effect runs
// (a transition holds that effect until it commits): it holds the entry at
// once, and lets go of the old one after the evaluation, which must not
// change the graph it is reading.
function holdFromRead(o, e) {
  if (getServerContext() !== null || !o.alive) return;
  hold(o, e);
  if (o.entries.size > 1 && !o.sweeping) {
    o.sweeping = true;
    queueMicrotask(() => {
      o.sweeping = false;
      if (o.alive) settle(o, untrack(o.current));
    });
  }
}

function readKey(keyFn, lenient) {
  if (!lenient) return keyFn();
  // SWR's contract: a key function that throws (its input is not there yet)
  // means "not now", like a null key.
  try {
    return keyFn();
  } catch {
    return null;
  }
}

/**
 * @param {number} kind
 * @param {any} key a key, or a function returning one (null/false: none)
 * @param {any} conf what fetches: { run, retry, retryDelay, ... }
 * @param {any} opts { gate, staleTime, gcTime, initialData, callbacks, lenient }
 */
function observe(kind, key, conf, opts) {
  const o = {
    kind,
    conf,
    alive: true,
    /** @type {any} */ entry: null,
    /** @type {Set<any>} */ entries: new Set(),
    /** @type {any} */ previous: null,
    sweeping: false,
    gate: opts.gate || null,
    staleTime: opts.staleTime ?? 0,
    gcTime: opts.gcTime ?? DEFAULT_GC_TIME,
    initialData: opts.initialData,
    initialDataUpdatedAt: opts.initialDataUpdatedAt,
    onSuccess: opts.onSuccess,
    onError: opts.onError,
    onSettled: opts.onSettled,
    path: pathTag,
    active: () => o.alive && (o.gate === null || o.gate.peek()),
    /** @type {() => any} */ current: noop,
    /** @type {() => string | null} */ hash: () => null,
  };
  const keyFn = typeof key === 'function' ? key : () => key;
  let raw;
  const hash = computed(() => {
    const k = readKey(keyFn, opts.lenient);
    raw = k;
    return k == null || k === false ? null : normalizeQueryKey(k);
  });
  o.hash = hash;
  let last = null;
  o.current = computed(() => {
    const h = hash();
    const e = h === null ? null : entryFor(kind, h, raw, o);
    // The entry the key named before: what keepPreviousData shows.
    if (e !== last) {
      if (last !== null) o.previous = last;
      last = e;
    }
    return e;
  });
  if (getServerContext() !== null) return o;

  let wasOpen = false;
  effect(() => {
    const e = o.current();
    const open = o.gate === null || o.gate();
    untrack(() => {
      // An attach, or the gate opening, fetches what is stale. An entry the
      // value already read (inside a transition that held this effect) was
      // fetched then; what it got since is not news to refetch.
      const attaching = e !== null && !o.entries.has(e);
      const opening = open && !wasOpen;
      wasOpen = open;
      settle(o, e);
      if (e !== null && open && (attaching || opening) && stale(e, o)) fetchEntry(e, o);
    });
  });
  if (getOwner() !== null) {
    onCleanup(() => {
      o.alive = false;
      settle(o, null);
    });
  }
  return o;
}

// Whether an observer attaching to `e` (or hearing focus, reconnect) fetches
// it: nothing in flight, and no value, a failure, or a value older than its
// staleTime. A value the page's data channel carried counts as fresh for the
// observers that attach in the task that adopted it.
function stale(e, o) {
  if (e.flight !== null || e.hydrated) return false;
  if (e.error !== undefined || valueOf(e) === undefined) return true;
  return Date.now() - e.updatedAt > o.staleTime;
}

// What a hook shows of the entry its key names now. Tracked: it re-runs when a
// fetch starts or ends and when the value changes. Never suspends.
function stateOf(o) {
  if (getServerContext() !== null || isHydrating()) return firstState(o);
  const e = o.current();
  if (e === null) return { value: undefined, error: null, fetching: false, first: false, e };
  const n = e.node;
  const status = _asyncStatus(n);
  // Subscribes to the value as well, without holding the reader: a value that
  // is not ready, or failed, is what `status` already says.
  try { n(); } catch { /* see status */ }
  const v = n.peek();
  return {
    value: v === IDLE ? undefined : v,
    error: status === 'errored' ? _asyncError(n) : null,
    fetching: status === 'pending' || status === 'unresolved',
    first: false,
    e,
  };
}

// A hook does not fetch on the server, and it renders the same there as in
// the hydration walk that adopts the server's DOM: its first state, with its
// own initialData and nothing else the cache holds. What a query() of the same
// key fetched depends on the order the server rendered the two in, which the
// client cannot know. Right after the walk it shows the cache, with no request
// for a value the page carried.
const walked = /* @__PURE__ */ signal(0);
let walkEnding = false;

function firstState(o) {
  if (getServerContext() === null) {
    walked();
    if (!walkEnding) {
      walkEnding = true;
      queueMicrotask(() => {
        walkEnding = false;
        walked((n) => n + 1);
      });
    }
  }
  const initial = o.initialData;
  return { value: typeof initial === 'function' ? untrack(initial) : initial, error: null, fetching: false, first: true, e: null };
}

// The `enabled` gate, mirrored into a signal: an effect that reads the
// caller's thunk re-runs whenever anything it reads moves, and only a flip of
// the gate is news to a query.
function createGate(enabled) {
  const read = typeof enabled === 'function' ? enabled : () => enabled;
  const gate = signal(untrack(() => !!read()));
  if (getServerContext() === null) effect(() => { gate(!!read()); });
  return gate;
}

function onWindow(o, events, check) {
  if (getServerContext() !== null || typeof window === 'undefined') return;
  effect(() => {
    const handler = () => {
      if (events[0] === 'visibilitychange' && document.visibilityState !== 'visible') return;
      const e = o.entry;
      if (e !== null && o.active() && check(e)) fetchEntry(e, o);
    };
    const target = events[0] === 'visibilitychange' ? document : window;
    target.addEventListener(events[0], handler);
    return () => target.removeEventListener(events[0], handler);
  });
}

function poll(o, interval) {
  if (!interval || getServerContext() !== null) return;
  effect(() => {
    const id = unrefTimer(setInterval(() => {
      const e = o.entry;
      if (e !== null && o.active() && e.flight === null) fetchEntry(e, o);
    }, interval));
    return () => clearInterval(id);
  });
}

function asArray(key) {
  return Array.isArray(key) ? key : [key];
}

const defaultRetryDelay = (attempt) => Math.min(1000 * 2 ** attempt, 30000);

// --- query ---

/**
 * The signal-native read of the cache: an async value for the entry `key`
 * names now. `key` may be a function of signals; when it moves, the value
 * fetches the new key's entry (or shows it at once, if it is cached) and keeps
 * the old value meanwhile (`pending()`). Reading it before the first value
 * lands holds the reader, or suspends its <Suspense>, like any async value;
 * `refresh(q)` fetches the entry again. `fetcher(key, { signal })` gets the
 * key as written.
 */
export function query(key, fetcher, options = {}) {
  _enableSuspense();
  const o = observe(PLAIN, key, {
    run: (k, abortSignal) => fetcher(k, { signal: abortSignal }),
    retry: options.retry ?? 1,
    retryDelay: options.retryDelay ?? defaultRetryDelay,
  }, {
    staleTime: options.staleTime,
    gcTime: options.gcTime,
    initialData: options.initialData,
  });
  if (getServerContext() !== null) {
    // A server render reads the key once, and nothing in it changes: the
    // value is the entry's node, which belongs to the render and is in its
    // data channel. It starts now, so sibling queries fetch side by side; a
    // retried render finds it in the render's cache.
    const e = untrack(o.current);
    if (e === null) return _asyncComputed(noop, { value: undefined, track: false });
    // Its first evaluation fetches, unless the render's store had it.
    untrack(() => _asyncStatus(e.node));
    return e.node;
  }
  /** @type {{ e: any, version: number } | null} */
  let seen = null;
  return _asyncComputed(() => {
    const e = o.current();
    if (e === null) {
      seen = null;
      return undefined;
    }
    holdFromRead(o, e);
    // A run with the same entry at the same version is not a change reaching
    // this value (every landing bumps the version first): it is a refresh()
    // of it, or an error boundary's reset. Fetch the entry again.
    const again = seen !== null && seen.e === e && seen.version === e.version;
    seen = { e, version: e.version };
    if (untrack(() => e.node.peek()) === IDLE) {
      // No data yet (a fetch that landed undefined is data): wait for the
      // entry's first landing, subscribed to the landing itself rather than to
      // the node, whose placeholder is not a value to show as pending.
      e.tick();
      if (again || (e.flight === null && e.error === undefined)) fetchEntry(e, o);
      seen.version = e.version;
      if (e.error !== undefined && e.flight === null) throw e.error;
      return arrival(e);
    }
    if (again) fetchEntry(e, o);
    seen.version = e.version;
    const read = attempt(e.node);
    if (read.waiting !== null) return read.waiting.then(() => settledValue(e));
    if (read.failed) throw read.value;
    return read.value;
  }, null);
}

// A tracked read of an entry's node that reports, instead of throwing, a value
// that is not ready.
function attempt(n) {
  try {
    return { value: n(), waiting: null, failed: false };
  } catch (err) {
    if (_isNotReady(err)) return { value: undefined, waiting: err, failed: false };
    return { value: err, waiting: null, failed: true };
  }
}

function settledValue(e) {
  return untrack(() => {
    const n = e.node;
    if (_asyncStatus(n) === 'errored') throw _asyncError(n);
    const v = n.peek();
    return v === IDLE ? undefined : v;
  });
}

// --- useQuery ---
// TanStack Query's shape. `status` is 'idle' (nothing cached, nothing in
// flight: a disabled query), 'loading', 'success' or 'error'; `fetchStatus`
// is 'fetching' while a request is on the wire. `data()` never suspends.

export function useQuery(options) {
  const {
    queryKey,
    queryFn,
    enabled = true,
    staleTime = 0,
    cacheTime,
    gcTime = cacheTime ?? DEFAULT_GC_TIME,
    refetchOnWindowFocus = true,
    refetchOnReconnect = true,
    refetchInterval = false,
    retry = 3,
    retryDelay = defaultRetryDelay,
    onSuccess,
    onError,
    onSettled,
    select,
    placeholderData,
    keepPreviousData = false,
    initialData,
    initialDataUpdatedAt,
  } = options;

  const gate = createGate(enabled);
  const o = observe(PLAIN, queryKey, {
    run: (k, abortSignal) => queryFn({ queryKey: asArray(k), signal: abortSignal }),
    retry,
    retryDelay,
  }, { gate, staleTime, gcTime, initialData, initialDataUpdatedAt, onSuccess, onError, onSettled });
  if (refetchOnWindowFocus) onWindow(o, ['visibilitychange'], (e) => stale(e, o));
  if (refetchOnReconnect) onWindow(o, ['online'], (e) => stale(e, o));
  poll(o, refetchInterval);

  const view = () => {
    const s = stateOf(o);
    if (s.value != null) return { data: select ? select(s.value) : s.value, placeholder: false, s };
    // keepPreviousData (or placeholderData: (previous) => ...): the data of
    // the key this query named before, while the new one loads.
    const before = o.previous !== null && o.previous !== s.e ? valueOf(o.previous) : undefined;
    if (before != null && (keepPreviousData || typeof placeholderData === 'function')) {
      const previous = select ? select(before) : before;
      return { data: typeof placeholderData === 'function' ? placeholderData(previous) : previous, placeholder: true, s };
    }
    const data = typeof placeholderData === 'function' ? placeholderData(undefined) : placeholderData;
    return { data, placeholder: data !== undefined, s };
  };
  const status = () => {
    const s = stateOf(o);
    if (s.error != null) return 'error';
    if (s.value != null) return 'success';
    return s.fetching || (s.first && gate.peek()) ? 'loading' : 'idle';
  };

  return {
    data: () => view().data,
    error: () => stateOf(o).error,
    status,
    fetchStatus: () => (stateOf(o).fetching ? 'fetching' : 'idle'),
    isLoading: () => status() === 'loading',
    isError: () => status() === 'error',
    isSuccess: () => status() === 'success',
    isIdle: () => status() === 'idle',
    isFetching: () => stateOf(o).fetching,
    isPlaceholderData: () => view().placeholder,
    isEnabled: () => gate(),
    dataUpdatedAt: () => {
      const e = stateOf(o).e;
      return e !== null ? e.updatedAt : 0;
    },
    // An explicit request: never gated by `enabled`, never answered from the
    // freshness window. Resolves with the data it fetched.
    refetch: () => {
      const e = untrack(o.current);
      return e === null ? Promise.resolve(undefined) : refetchOf(e, o);
    },
  };
}

// --- useSWR ---
// SWR's shape: `data()` is the cached value (or fallbackData, or null),
// `isLoading()` is "no data yet and fetching", `isValidating()` is "fetching".
// A null, false or throwing key pauses it. `fetcher(key, { signal })` gets the
// key as written. A fetch within `dedupingInterval` of the last one answers
// a new reader, a focus or a reconnect.

export function useSWR(key, fetcher, options = {}) {
  const {
    revalidateOnFocus = true,
    revalidateOnReconnect = true,
    refreshInterval = 0,
    dedupingInterval = 2000,
    fallbackData,
    keepPreviousData = false,
    onSuccess,
    onError,
  } = options;

  const o = observe(PLAIN, key, {
    run: (k, abortSignal) => fetcher(k, { signal: abortSignal }),
    retry: 1,
    retryDelay: defaultRetryDelay,
  }, { staleTime: dedupingInterval, onSuccess, onError, lenient: true });
  if (revalidateOnFocus) onWindow(o, ['visibilitychange'], (e) => stale(e, o));
  if (revalidateOnReconnect) onWindow(o, ['online'], (e) => stale(e, o));
  poll(o, refreshInterval);

  const data = () => {
    const s = stateOf(o);
    if (s.value != null) return s.value;
    if (keepPreviousData && o.previous !== null && o.previous !== s.e) {
      const before = valueOf(o.previous);
      if (before != null) return before;
    }
    return fallbackData ?? null;
  };
  const revalidate = () => {
    const e = untrack(o.current);
    if (e === null) return Promise.resolve(undefined);
    return e.flight !== null ? outcome(e, e.flight) : refetchOf(e, o);
  };

  return {
    data,
    error: () => stateOf(o).error,
    isLoading: () => {
      const s = stateOf(o);
      return s.value == null && s.fetching;
    },
    isValidating: () => stateOf(o).fetching,
    // mutate(data, shouldRevalidate = true): put data in the cache for every
    // reader of the key, then fetch it again. mutate() alone revalidates.
    mutate: (...args) => {
      if (args.length === 0) return revalidate();
      const [next, shouldRevalidate = true] = args;
      const e = untrack(o.current);
      if (e === null) return Promise.resolve(undefined);
      setEntry(e, typeof next === 'function' ? next(valueOf(e) ?? null) : next);
      return shouldRevalidate ? refetchOf(e, o) : Promise.resolve(valueOf(e));
    },
    revalidate,
  };
}

// --- useInfiniteQuery ---
// TanStack Query's shape: `data()` is `{ pages, pageParams }`; pageParams[i]
// names pages[i]. The pages are one cache entry: invalidating its key
// refetches page one and replaces the list. Explicit calls (fetchNextPage,
// refetch) are not gated by `enabled`.

export function useInfiniteQuery(options) {
  const {
    queryKey,
    queryFn,
    getNextPageParam,
    getPreviousPageParam,
    initialPageParam,
    enabled = true,
    staleTime = 0,
    cacheTime,
    gcTime = cacheTime ?? DEFAULT_GC_TIME,
    refetchOnWindowFocus = false,
    refetchInterval = false,
    select,
    retry = 3,
    retryDelay = defaultRetryDelay,
    onSuccess,
    onError,
    onSettled,
  } = options;

  const gate = createGate(enabled);
  const o = observe(INFINITE, queryKey, {
    run: (k, pageParam, abortSignal) => queryFn({ queryKey: asArray(k), pageParam, signal: abortSignal }),
    retry,
    retryDelay,
    initialPageParam,
  }, { gate, staleTime, gcTime, onSuccess, onError, onSettled });
  if (refetchOnWindowFocus) onWindow(o, ['visibilitychange'], (e) => stale(e, o));
  poll(o, refetchInterval);

  const pagesOf = (s) => (s.value != null ? s.value : { pages: [], pageParams: [] });
  const status = () => {
    const s = stateOf(o);
    if (s.error != null) return 'error';
    if (s.value != null && s.value.pages.length > 0) return 'success';
    return s.fetching ? 'loading' : 'idle';
  };
  const direction = (dir) => {
    const s = stateOf(o);
    return s.fetching && s.e !== null && s.e.dir() === dir;
  };
  const page = (place, dir, param) => {
    const e = untrack(o.current);
    return e === null ? Promise.resolve(undefined) : refetchOf(e, o, { place, dir, param });
  };
  const first = (dir) => page('first', dir, initialPageParam);

  return {
    data: () => {
      const data = pagesOf(stateOf(o));
      return select ? select(data) : data;
    },
    error: () => stateOf(o).error,
    status,
    isLoading: () => status() === 'loading',
    isError: () => status() === 'error',
    isSuccess: () => status() === 'success',
    isIdle: () => status() === 'idle',
    isFetching: () => stateOf(o).fetching,
    isEnabled: () => gate(),
    hasNextPage: () => {
      const { pages } = pagesOf(stateOf(o));
      return pages.length === 0 || (getNextPageParam ? getNextPageParam(pages[pages.length - 1], pages) !== undefined : false);
    },
    hasPreviousPage: () => {
      const { pages } = pagesOf(stateOf(o));
      return pages.length > 0 && getPreviousPageParam ? getPreviousPageParam(pages[0], pages) !== undefined : false;
    },
    isFetchingNextPage: () => direction('next'),
    isFetchingPreviousPage: () => direction('previous'),
    // An empty list has no last page to ask getNextPageParam about: the next
    // page of nothing is the first page.
    fetchNextPage: async () => {
      const { pages } = pagesOf(untrack(() => stateOf(o)));
      if (pages.length === 0) return first('next');
      const param = getNextPageParam?.(pages[pages.length - 1], pages);
      if (param !== undefined) return page('next', 'next', param);
    },
    fetchPreviousPage: async () => {
      const { pages } = pagesOf(untrack(() => stateOf(o)));
      if (pages.length === 0) return first('previous');
      const param = getPreviousPageParam?.(pages[0], pages);
      if (param !== undefined) return page('previous', 'previous', param);
    },
    refetch: () => first('next'),
  };
}

// --- useFetch ---
// One URL's JSON, from the cache. `url` may be a function of signals.

export function useFetch(url, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    transform = (data) => data,
    initialData = null,
    fetch: request = globalThis.fetch,
  } = options;
  const keyOf = (u) => (u == null ? null : ['what:fetch', method, u, body ?? null]);
  const key = typeof url === 'function' ? () => keyOf(url()) : keyOf(url);
  const o = observe(PLAIN, key, {
    run: async (k, abortSignal) => {
      const response = await request(k[2], {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: abortSignal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return transform(await response.json());
    },
    retry: 1,
    retryDelay: defaultRetryDelay,
  }, {});
  return {
    data: () => stateOf(o).value ?? initialData,
    error: () => stateOf(o).error,
    isLoading: () => {
      const s = stateOf(o);
      return s.fetching || (s.e !== null && s.value === undefined && s.error === null && s.e.fetches === 0);
    },
    // Never rejects: a failure shows in error().
    refetch: () => {
      const e = untrack(o.current);
      return e === null ? Promise.resolve() : refetchOf(e, o).then(noop, noop);
    },
    mutate: (next) => {
      const e = untrack(o.current);
      if (e !== null) setEntry(e, next);
    },
  };
}

// --- The cache, whichever hook reads it ---

function allEntries() {
  const ctx = getServerContext();
  const caches = ctx === null ? clientCache : (serverCaches.get(ctx) || []);
  const out = [];
  for (const cache of caches) for (const e of cache.values()) out.push(e);
  return out;
}

function matching(target, exact) {
  const out = [];
  if (typeof target === 'function') {
    for (const e of allEntries()) if (target(e.hash)) out.push(e);
  } else if (Array.isArray(target) && !exact) {
    // An array key is a prefix, on segment boundaries: ['todos'] matches
    // ['todos', 1], never 'todosx'.
    const prefix = normalizeQueryKey(target);
    const scoped = prefix + ':';
    for (const e of allEntries()) if (e.hash === prefix || e.hash.startsWith(scoped)) out.push(e);
  } else {
    const exactKey = normalizeQueryKey(target);
    for (const e of allEntries()) if (e.hash === exactKey) out.push(e);
  }
  return out;
}

function firstActive(e) {
  for (const o of e.observers) if (o.active()) return o;
  return null;
}

// Mark an entry stale and fetch it now if something shows it; a `hard`
// invalidation empties it first (a request already in flight still refills
// it). Resolves when the refetch has landed.
function invalidateEntry(e, hard) {
  e.updatedAt = 0;
  if (hard) {
    const f = e.flight;
    e.version++;
    e.error = undefined;
    _setAsyncValue(e.node, null);
    if (f !== null && !f.dead) {
      e.next = ADOPT;
      refreshNode(e);
      e.next = 0;
    }
  }
  const by = firstActive(e);
  if (by === null) return e.flight !== null ? outcome(e, e.flight).then(noop, noop) : Promise.resolve();
  if (hard && e.flight !== null) return outcome(e, e.flight).then(noop, noop);
  return refetchOf(e, by).then(noop, noop);
}

/**
 * Mark the entries `keyOrPredicate` names stale, and fetch again those
 * something shows (inside a transition, the refetch joins it). An array key is
 * a prefix unless `exact`; a predicate gets each normalized key. `hard`
 * empties them first. Resolves when the refetches have landed; never rejects.
 */
export function invalidateQueries(keyOrPredicate, options = {}) {
  const { hard = false, exact = false } = options;
  const entries = matching(keyOrPredicate, exact);
  // Server actions record the normalized cache entries they actually touched.
  if (__DEV__ && arguments[2]) {
    for (const e of entries) arguments[2].add(e.hash);
  }
  return Promise.all(entries.map((e) => invalidateEntry(e, hard))).then(noop);
}

const revalidationCallbacks = new Map();

/**
 * Call `callback` whenever `invalidatePath(path)` runs (a server action that
 * revalidates `path`). Returns the unsubscribe.
 */
export function onRevalidate(path, callback) {
  if (!revalidationCallbacks.has(path)) revalidationCallbacks.set(path, new Set());
  revalidationCallbacks.get(path).add(callback);
  return () => {
    revalidationCallbacks.get(path)?.delete(callback);
  };
}

/**
 * The client side of a revalidated path: the entries read on `path` (the
 * route data and every query read while the page was at that path) are
 * invalidated, and the onRevalidate callbacks for it run. Resolves when the
 * refetches have landed.
 */
export function invalidatePath(path) {
  const callbacks = revalidationCallbacks.get(path);
  if (callbacks) {
    for (const cb of callbacks) {
      try { cb(); } catch (e) { console.error('[what] Revalidation error:', e); }
    }
  }
  const waits = [];
  for (const e of allEntries()) if (e.paths !== null && e.paths.has(path)) waits.push(invalidateEntry(e, false));
  return Promise.all(waits).then(noop);
}

/**
 * Fetch `key` into the cache unless it holds a value fresher than
 * `staleTime`, and resolve with it. Rejects with a failed fetch's error.
 */
export function prefetchQuery(key, fetcher, options = {}) {
  const e = entryFor(PLAIN, normalizeQueryKey(key), key, null);
  if (e.observers.size === 0) {
    e.conf = { run: (k, abortSignal) => fetcher(k, { signal: abortSignal }), retry: options.retry ?? 1, retryDelay: defaultRetryDelay };
  }
  const v = valueOf(e);
  let done;
  if (e.flight !== null) done = outcome(e, e.flight);
  else if (v !== undefined && e.error === undefined && Date.now() - e.updatedAt <= (options.staleTime ?? 0)) done = Promise.resolve(v);
  else done = refetchOf(e, null);
  armGc(e);
  return done;
}

/** Put `updater` (a value, or a function of the current one) in the cache now. */
export function setQueryData(key, updater) {
  const e = entryFor(PLAIN, normalizeQueryKey(key), key, null);
  setEntry(e, typeof updater === 'function' ? updater(valueOf(e)) : updater);
  armGc(e);
}

/** The cached value: undefined for a key with nothing cached, null for one emptied by a hard invalidation. */
export function getQueryData(key) {
  const e = cacheOf(PLAIN).get(normalizeQueryKey(key));
  return e === undefined ? undefined : valueOf(e);
}

/**
 * Empty the cache (logout). What is in flight is dropped, so no response
 * requested before the clear lands after it; entries something shows stay
 * attached to their readers, empty; the rest are forgotten. The page's
 * server data is not adopted again.
 */
export function clearCache() {
  channelOpen = false;
  for (const e of allEntries()) {
    if (e.observers.size > 0) {
      e.error = undefined;
      e.updatedAt = 0;
      commitValue(e, IDLE);
    } else {
      dropEntry(e);
    }
  }
}

function messageOf(error) {
  return error == null ? null : String((error && error.message) || error);
}

function statusOf(e) {
  const status = _asyncStatus(e.node);
  if (status === 'errored') return 'error';
  const value = valueOf(e);
  if (status === 'pending' || status === 'unresolved') return value === undefined || value === null ? 'loading' : 'refreshing';
  return value === undefined || value === null ? 'idle' : 'success';
}

/**
 * @internal The cache for devtools (what_cache): each entry's key, kind,
 * status, value, error, readers, last fetch and how often its value changed.
 */
export function __getCacheSnapshot() {
  return untrack(() => allEntries().map((e) => ({
    key: e.hash,
    kind: e.kind === INFINITE ? 'infinite' : 'query',
    status: statusOf(e),
    data: valueOf(e),
    error: messageOf(e.error !== undefined ? e.error : (_asyncStatus(e.node) === 'errored' ? _asyncError(e.node) : null)),
    isValidating: e.flight !== null,
    observers: e.observers.size,
    updatedAt: e.updatedAt || null,
    fetches: e.fetches,
    lastFetch: e.last,
    version: e.version,
    paths: e.paths !== null ? [...e.paths] : [],
  })));
}

/**
 * @internal what_invalidate_cache: invalidate the entries under `key` (all of
 * them when it is omitted) and report how many matched.
 */
export function __invalidateFromDevtools(key) {
  const entries = key == null ? allEntries() : matching(key, false);
  for (const e of entries) invalidateEntry(e, false);
  return entries.map((e) => e.hash);
}
