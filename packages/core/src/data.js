// What Framework - Data Fetching
// SWR-like data fetching with caching, revalidation, and optimistic updates

import { signal, effect, batch, computed, untrack, __DEV__ } from './reactive.js';
import { getCurrentComponent } from './dom.js';

// --- Reactive Cache ---
// Each cache key maps to shared signals so all components reading the same key
// see updates when ANY component mutates/revalidates that key.
// Shared per key: data signal, error signal, isValidating signal.
const cacheSignals = new Map();  // key -> signal(value)
const errorSignals = new Map();  // key -> signal(error)
const validatingSignals = new Map(); // key -> signal(boolean)
const cacheTimestamps = new Map(); // key -> last access time (for LRU)
const MAX_CACHE_SIZE = 200;

// --- Query key normalization ---
// Array keys are joined into the same flat string space as useSWR's string keys,
// so `useQuery({queryKey: ['todos']})` and `useSWR('todos')` share one cache
// entry by design. Every cache-facing entry point must normalize identically:
// useQuery used to be the only one that did, so `invalidateQueries(['todos'])`
// looked up a raw Array object as a Map key, found nothing, and silently did
// nothing. The documented shape was the broken one.
//
// Segments escape ':' so `['user', 'a:b']` cannot collide with
// `['user', 'a', 'b']`. A collision here serves one query's data to another,
// which is worse than a miss.
function normalizeQueryKey(key) {
  if (!Array.isArray(key)) return key;
  return key
    .map((part) => (typeof part === 'string' ? part : JSON.stringify(part) ?? String(part)))
    .map((part) => part.replace(/([\\:])/g, '\\$1'))
    .join(':');
}

function getCacheSignal(key) {
  cacheTimestamps.set(key, Date.now());
  if (!cacheSignals.has(key)) {
    cacheSignals.set(key, signal(null));
    // Evict oldest entries if cache exceeds limit
    if (cacheSignals.size > MAX_CACHE_SIZE) {
      evictOldest();
    }
  }
  return cacheSignals.get(key);
}

function getErrorSignal(key) {
  if (!errorSignals.has(key)) errorSignals.set(key, signal(null));
  return errorSignals.get(key);
}

function getValidatingSignal(key) {
  if (!validatingSignals.has(key)) validatingSignals.set(key, signal(false));
  return validatingSignals.get(key);
}

function evictOldest() {
  // Remove the 20% oldest entries
  const entries = [...cacheTimestamps.entries()].sort((a, b) => a[1] - b[1]);
  const toRemove = Math.floor(MAX_CACHE_SIZE * 0.2);
  for (let i = 0; i < toRemove && i < entries.length; i++) {
    const key = entries[i][0];
    // Don't evict keys with active subscribers
    if (revalidationSubscribers.has(key) && revalidationSubscribers.get(key).size > 0) continue;
    cacheSignals.delete(key);
    errorSignals.delete(key);
    validatingSignals.delete(key);
    cacheTimestamps.delete(key);
    lastFetchTimestamps.delete(key);
  }
}

// Subscribers for invalidation: key -> Set<revalidateFn>
// When invalidateQueries is called, all subscribers re-fetch
const revalidationSubscribers = new Map();

function subscribeToKey(key, revalidateFn) {
  if (!revalidationSubscribers.has(key)) revalidationSubscribers.set(key, new Set());
  revalidationSubscribers.get(key).add(revalidateFn);
  return () => {
    const subs = revalidationSubscribers.get(key);
    if (subs) {
      subs.delete(revalidateFn);
      if (subs.size === 0) revalidationSubscribers.delete(key);
    }
  };
}

// What clearCache() cannot reach by walking the cache Maps.
//
// Two different things live outside them. useInfiniteQuery keeps its pages in
// signals local to the hook (see the note above it on why), so walking
// cacheSignals emptied nothing at all for it. And EVERY hook keeps the request
// it currently has in flight in a local AbortController: emptying the cache
// does not cancel a request that is already on the wire, so the previous user's
// response lands a moment after the clear and writes their data straight back
// onto the screen. That is the exact failure clearCache exists to prevent, at
// the exact moment (logout) it is called for, and it was guarded in
// useInfiniteQuery and nowhere else.
//
// A handler is registered for the lifetime of the hook's effect, the same
// lifetime as its invalidation subscription, so it goes away on unmount with
// everything else.
const clearCacheHandlers = new Set();

function registerClearCacheHandler(handler) {
  clearCacheHandlers.add(handler);
  return () => clearCacheHandlers.delete(handler);
}

const inFlightRequests = new Map(); // key -> { promise, timestamp, refCount, epoch }
const lastFetchTimestamps = new Map(); // key -> timestamp of last completed fetch

// How many times each key has been invalidated. This orders invalidations
// against in-flight requests, which a wall clock cannot: Date.now() has 1ms
// resolution, so a refetch and an unrelated invalidation issued microseconds
// apart share a timestamp, and the invalidation would be answered by a request
// that predates the mutation. A counter has no ties.
const keyEpochs = new Map();

function currentEpoch(key) {
  return keyEpochs.get(key) || 0;
}

function bumpEpoch(key) {
  keyEpochs.set(key, currentEpoch(key) + 1);
}

// Every timer this module arms is housekeeping or polling. None of it is work
// worth keeping a Node process alive for, and on the server the usual owner of a
// timer (a component that unmounts) does not exist, so nothing ever clears them:
// an SSR render that touched one query pinned the event loop for minutes and kept
// firing the query function long after the HTML had been sent.
function unrefTimer(timer) {
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}

// EVERY computed() in this file reads EVERY signal it depends on
// UNCONDITIONALLY, even when a short circuit would let it skip one.
//
// This is not a style preference, it is a requirement of the reactive core. A
// computed is backed by an effect, and _runEffect auto-promotes an effect to
// "stable" when it had exactly one dependency before a re-run and the same
// single dependency after it (the assumption being that a one-dependency effect
// cannot have conditional reads). A stable effect re-runs with currentEffect
// set to null: it still produces a fresh value, but it can never SUBSCRIBE to
// anything it was not already subscribed to.
//
// So a computed of the shape `a() === 'x' && b()` is one re-run away from
// permanent deafness to `b`: any re-run in which `a` is not 'x' reads only `a`,
// promotes the computed, and from then on `b` can change without the computed
// ever being notified. It goes stale silently and forever, and only for some
// orderings of the writes, which is why both instances of this in the file
// looked fine in tests and failed in an app. See the notes on useQuery's
// `status` and useSWR's `isLoading` for what each one actually broke.
//
// Reading everything unconditionally fixes it whatever the promotion rule is:
// the dependency set never varies, so there is nothing left to lose.

// Create an effect scoped to the current component's lifecycle.
// When the component unmounts, the effect is automatically disposed.
function scopedEffect(fn) {
  const ctx = getCurrentComponent?.();
  const dispose = effect(fn);
  if (ctx) ctx.effects.push(dispose);
  return dispose;
}

// Register a teardown with the component that owns this hook.
//
// scopedEffect's cleanup is not the right home for all of it: that cleanup runs
// before every RE-RUN of the effect as well as on disposal, and some teardown
// (cancelling a request the application explicitly asked for) must happen only
// when the component actually goes away. Outside a component there is nothing
// to unmount and the effect is never disposed either, so the two agree.
function onComponentDispose(fn) {
  const ctx = getCurrentComponent?.();
  if (ctx) ctx.effects.push(fn);
}

// `enabled` as a READABLE gate rather than a value captured once.
//
// Components run once here, so a plain boolean read at call time is frozen for
// the lifetime of the query: `enabled: userId() != null` could never become
// true, and the whole point of the option (a dependent query that starts when
// its dependency arrives) was unreachable. Accepting a signal or any thunk lets
// the query's own effect track it, so flipping the flag starts the query.
//
// The thunk is MIRRORED into a boolean signal rather than read by the query's
// own effect. Reading it there subscribes that effect to everything the thunk
// touches, and re-running it is destructive: it aborts whatever request is in
// flight. So `enabled: () => tab() === 'reports'` let an unrelated move of
// `tab` cancel the query even though the gate's value never changed, which
// silently killed an explicit refetch() (its promise resolved with `undefined`:
// no data, no error, no rejection), and `enabled: () => userId() != null`
// issued a redundant second fetch on every change of `userId`, into the
// queryKey captured at hook creation, i.e. the OLD key. A signal does not
// notify when it is written the value it already holds, so mirroring collapses
// "something the thunk reads moved" down to "the gate flipped", which is the
// only event a query has any business reacting to.
//
// A boolean is still accepted and still behaves exactly as before: it reads no
// signals, so the mirroring effect tracks no dependencies and the reactive core
// releases it on the spot.
function createGate(enabled) {
  const read = typeof enabled === 'function' ? enabled : () => enabled;
  const gate = signal(untrack(() => !!read()));
  scopedEffect(() => { gate.set(!!read()); });
  return gate;
}

// --- useFetch Hook ---
// Simple fetch with automatic JSON parsing and error handling

export function useFetch(url, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    transform = (data) => data,
    initialData = null,
  } = options;

  const data = signal(initialData);
  const error = signal(null);
  const isLoading = signal(true);
  let abortController = null;

  async function fetchData() {
    // Abort previous request
    if (abortController) abortController.abort();
    abortController = new AbortController();
    const { signal: abortSignal } = abortController;

    isLoading.set(true);
    error.set(null);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: abortSignal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();
      if (!abortSignal.aborted) {
        data.set(transform(json));
      }
    } catch (e) {
      if (!abortSignal.aborted) {
        error.set(e);
      }
    } finally {
      if (!abortSignal.aborted) {
        isLoading.set(false);
      }
    }
  }

  // Fetch on mount, abort on unmount
  scopedEffect(() => {
    fetchData();
    return () => {
      if (abortController) abortController.abort();
    };
  });

  return {
    data: () => data(),
    error: () => error(),
    isLoading: () => isLoading(),
    refetch: fetchData,
    mutate: (newData) => data.set(newData),
  };
}

// --- useSWR Hook ---
// Stale-while-revalidate pattern with caching

export function useSWR(rawKey, fetcher, options = {}) {
  const { revalidateOnFocus = true, revalidateOnReconnect = true, refreshInterval = 0, dedupingInterval = 2000, fallbackData, onSuccess, onError } = options;

  // Support null/undefined/false key for conditional/dependent fetching
  // When key is falsy, don't fetch — return idle state
  if (rawKey == null || rawKey === false) {
    const data = signal(fallbackData || null);
    const error = signal(null);
    return {
      data: () => data(),
      error: () => error(),
      isLoading: () => false,
      isValidating: () => false,
      mutate: (newData) => data.set(typeof newData === 'function' ? newData(data()) : newData),
      revalidate: () => Promise.resolve(),
    };
  }

  // Normalized into the same flat string space every other cache-facing entry
  // point uses (see normalizeQueryKey, which says every one of them must
  // normalize identically). useSWR was the one that did not, so an ARRAY key
  // was used as a Map key by object IDENTITY, and the documented array-key
  // shape `useSWR(['/api/user', id], ...)` broke three ways at once: two
  // components passing equal-but-distinct arrays got two cache entries and
  // never saw each other's data, getQueryData(['/api/user', 1]) could not find
  // what was there, and an Array reached invalidateQueries' predicate, where
  // the documented `key => key.startsWith('/api/posts')` throws -- before any
  // key has been bumped, so ONE array key anywhere in the app turned every
  // predicate invalidation into a no-op that reported itself as a TypeError.
  //
  // The FETCHER still receives the original key. SWR's contract is
  // `useSWR(['/api/user', id], ([url, id]) => ...)`, and how the cache spells a
  // key internally is none of the fetcher's business.
  const key = normalizeQueryKey(rawKey);

  // Shared reactive cache signals — all useSWR instances with the same key
  // read from these signals, so mutating from one component updates all others.
  const cacheS = getCacheSignal(key);
  const error = getErrorSignal(key);
  const isValidating = getValidatingSignal(key);
  const data = computed(() => cacheS() ?? fallbackData ?? null);
  // Both reads are unconditional. See the note on conditional reads above
  // scopedEffect: as `cacheS() == null && isValidating()` this computed dropped
  // to a single dependency on any re-run that found the cache full (a mutate(),
  // a setQueryData(), a second successful fetch), was promoted to a stable
  // effect there, and never tracked isValidating again -- after which
  // isLoading() answered false for the rest of the page's life, including with
  // an empty cache and a request in flight, which is the one state it exists to
  // report.
  const isLoading = computed(() => {
    const empty = cacheS() == null;
    const fetching = isValidating();
    return empty && fetching;
  });

  let abortController = null;

  // `force` is invalidateQueries(): "this data is wrong now". It bypasses the
  // FRESHNESS window, which is the one caller that must never be answered from
  // it (with the default 2s dedupingInterval an invalidation issued right after
  // a fetch was silently swallowed and the stale data stayed on screen).
  //
  // It does NOT bypass request COALESCING, which is a different mechanism
  // wearing a similar name. Every component reading a key subscribes
  // separately, so one invalidateQueries() call fans out to N subscribers; the
  // in-flight map is what collapses those back into one request. Skipping it
  // opened N concurrent fetches of the same key whose responses then raced to
  // write the cache.
  //
  // What force does change is WHICH in-flight request is acceptable. A response
  // to a request that started before the data was invalidated is already stale,
  // so it cannot answer the invalidation. One that started after it is a
  // sibling subscriber's, and is exactly what we want to join.
  async function revalidate({ force = false } = {}) {
    const now = Date.now();
    const epoch = currentEpoch(key);

    // Deduplication: if there's already a request in flight, reuse it
    if (inFlightRequests.has(key)) {
      const existing = inFlightRequests.get(key);
      const usable = force
        ? existing.epoch === epoch
        : now - existing.timestamp < dedupingInterval;
      if (usable) {
        existing.refCount++;
        return existing.promise;
      }
    }

    // Also deduplicate against recently completed fetches
    const lastFetch = lastFetchTimestamps.get(key);
    if (!force && lastFetch && now - lastFetch < dedupingInterval && cacheS.peek() != null) {
      return cacheS.peek();
    }

    // Abort previous request only if no other subscribers are using it
    if (abortController) {
      const existing = inFlightRequests.get(key);
      if (!existing || existing.refCount <= 1) {
        abortController.abort();
      }
    }
    abortController = new AbortController();
    const { signal: abortSignal } = abortController;

    isValidating.set(true);

    // rawKey, not the normalized one: see the note where `key` is derived.
    const promise = fetcher(rawKey, { signal: abortSignal });
    inFlightRequests.set(key, { promise, timestamp: now, refCount: 1, epoch });

    try {
      const result = await promise;
      if (abortSignal.aborted) return;
      batch(() => {
        cacheS.set(result); // Updates ALL components reading this key
        error.set(null);
      });
      cacheTimestamps.set(key, Date.now());
      lastFetchTimestamps.set(key, Date.now());
      if (onSuccess) onSuccess(result, rawKey);
      return result;
    } catch (e) {
      if (abortSignal.aborted) return;
      error.set(e);
      if (onError) onError(e, rawKey);
      throw e;
    } finally {
      if (!abortSignal.aborted) isValidating.set(false);
      const flight = inFlightRequests.get(key);
      if (flight) {
        flight.refCount--;
        if (flight.refCount <= 0) inFlightRequests.delete(key);
      }
    }
  }

  // Initial fetch, plus the invalidation subscription for this key.
  //
  // The subscription lives INSIDE the effect. It used to be created once
  // outside, while the effect's cleanup tore it down, and this effect re-runs
  // whenever the fetcher reads a signal that changed. So the first reactive
  // refetch unsubscribed the key and never resubscribed: from then on
  // invalidateQueries() had no subscriber to call and silently did nothing.
  // Re-subscribing per run keeps the two halves in the same lifecycle.
  scopedEffect(() => {
    const unsubscribe = subscribeToKey(key, () => revalidate({ force: true }).catch(() => {}));
    // clearCache() empties this key's shared signals, but the request already on
    // the wire is not in any Map it can walk: it landed after the clear and put
    // the previous user's data back. See registerClearCacheHandler.
    const releaseHandler = registerClearCacheHandler(() => {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      // isValidating is the SHARED signal for this key and clearCache has
      // already set it false; the aborted request deliberately returns without
      // touching it, so there is nothing left to reset here.
    });
    revalidate().catch(() => {});
    // Cleanup: abort and unsubscribe on unmount
    return () => {
      if (abortController) abortController.abort();
      unsubscribe();
      releaseHandler();
    };
  });

  // Revalidate on focus
  if (revalidateOnFocus && typeof window !== 'undefined') {
    scopedEffect(() => {
      const handler = () => {
        if (document.visibilityState === 'visible') {
          revalidate().catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    });
  }

  // Revalidate on reconnect
  if (revalidateOnReconnect && typeof window !== 'undefined') {
    scopedEffect(() => {
      const handler = () => revalidate().catch(() => {});
      window.addEventListener('online', handler);
      return () => window.removeEventListener('online', handler);
    });
  }

  // Polling
  if (refreshInterval > 0) {
    scopedEffect(() => {
      const interval = unrefTimer(setInterval(() => {
        revalidate().catch(() => {});
      }, refreshInterval));
      return () => clearInterval(interval);
    });
  }

  return {
    data: () => data(),
    error: () => error(),
    isLoading: () => isLoading(),
    isValidating: () => isValidating(),
    mutate: (newData, shouldRevalidate = true) => {
      const resolved = typeof newData === 'function' ? newData(cacheS.peek()) : newData;
      cacheS.set(resolved); // Updates ALL components reading this key
      cacheTimestamps.set(key, Date.now());
      if (shouldRevalidate) {
        revalidate().catch(() => {});
      }
    },
    revalidate,
  };
}

// --- useQuery Hook ---
// TanStack Query-like API

export function useQuery(options) {
  const {
    queryKey,
    queryFn,
    enabled = true,
    staleTime = 0,
    cacheTime = 5 * 60 * 1000,
    refetchOnWindowFocus = true,
    refetchInterval = false,
    retry = 3,
    retryDelay = (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    onSuccess,
    onError,
    onSettled,
    select,
    placeholderData,
  } = options;

  const key = normalizeQueryKey(queryKey);
  const gate = createGate(enabled);

  const cacheS = getCacheSignal(key);
  const data = computed(() => {
    const d = cacheS();
    // `!= null`, not `!== null`: an emptied entry reads `undefined` (see
    // clearCache), and handing a user's select() an undefined it was never
    // written to expect turns a cleared cache into a crash inside their code.
    return select && d != null ? select(d) : d;
  });
  const error = getErrorSignal(key);
  // What this hook WRITES. Components read the derived `status` just below.
  //
  // A disabled query with nothing cached is NOT loading: no request is in
  // flight and none will be until it is enabled or refetch() is called.
  // Reporting 'loading' forever made "waiting for the user" indistinguishable
  // from "waiting for the network", so a spinner rendered on isLoading() never
  // came down. 'idle' is the honest third state, and isLoading() is false in it.
  const rawStatus = signal(
    cacheS.peek() != null ? 'success' : (gate.peek() ? 'loading' : 'idle')
  );
  const fetchStatus = signal('idle');

  // A settled status only holds while the cache still holds what it settled on.
  // The data lives in a SHARED signal that something this hook never hears
  // about can empty -- clearCache() on logout, a sibling's
  // setQueryData(key, null) -- and a per-hook status signal has no way to
  // notice. That left status 'success' with data() === undefined, which walks
  // the canonical guarded render
  //
  //   if (q.isLoading()) return 'Loading...';
  //   if (q.isError()) return 'Error';
  //   if (q.isIdle()) return 'Idle';
  //   return q.data().name;
  //
  // past every guard and into a TypeError, at the one moment (logout) when
  // clearCache is most likely to be called. Deriving keeps status and data
  // moving together whatever emptied the entry, instead of requiring every
  // writer of the shared cache to know about every hook reading it.
  //
  // All four reads are UNCONDITIONAL, and that is load-bearing rather than
  // tidy. Written as `s === 'success' && cacheS() == null` this computed reads
  // the cache only in the success branch, so a re-run that finds any other
  // status reads rawStatus alone -- one dependency -- and the reactive core
  // promotes it to a stable effect that can never subscribe to anything new.
  // See the note on conditional reads above scopedEffect.
  //
  // A query created with `enabled: false` takes exactly that path and an
  // enabled one does not, which is why this looked fixed: 'idle' -> 'loading'
  // (refetch starts) is a one-dependency re-run, where an enabled query goes
  // straight from 'loading' to 'success' in a batch that writes the cache too,
  // and so keeps both dependencies. So after refetch() a disabled query's
  // status was permanently deaf to its own cache, and clearCache() left it
  // reporting 'success' with data() === undefined -- walking the guarded render
  // above into the TypeError this computed was written to prevent, at logout,
  // with the previous user's value still painted on screen.
  const status = computed(() => {
    const s = rawStatus();
    const hasData = cacheS() != null;
    const hasError = error() != null;
    // 'loading' only when something really is on its way to refill the entry.
    // clearCache() starts no request, so reporting 'loading' there would render
    // a spinner that never comes down -- the same defect, moved.
    const refilling = fetchStatus() === 'fetching';
    const lostData = s === 'success' && !hasData;
    const lostError = s === 'error' && !hasError;
    if (lostData || lostError) return refilling ? 'loading' : 'idle';
    return s;
  });

  let lastFetchTime = 0;
  // The request this hook has in flight, and who asked for it. An AUTOMATIC
  // fetch (mount, focus, polling, invalidation) belongs to the effect below and
  // dies with it; a `manual` one was asked for by application code, and the
  // effect's cleanup must leave it alone. One shared controller meant an
  // unrelated re-render cancelled a button click's refetch(), whose promise
  // then resolved with `undefined`.
  let inFlight = null;
  let cleanupTimer = null;

  // See the note on useSWR's revalidate: an invalidation must not be answered
  // from the freshness window, or `invalidateQueries` becomes a no-op for every
  // query with a staleTime.
  //
  // `manual` separates an explicit refetch() from AUTOMATIC fetching (mount,
  // window focus, polling, invalidation). Only the automatic paths are gated by
  // `enabled`: a call from application code is a direct request for data, and
  // gating it left `enabled: false` + "fetch on a button click" with no
  // supported form at all. The gate is peeked, not read reactively, because
  // this function is also called from detached callbacks (a focus handler, an
  // invalidation subscriber) where a tracked read would attach the gate to
  // whatever effect happened to be running; the effect below does the tracked
  // read.
  async function fetchQuery({ force = false, manual = false } = {}) {
    if (!manual && !gate.peek()) return;

    // Check if data is still fresh
    const now = Date.now();
    if (!force && cacheS.peek() != null && now - lastFetchTime < staleTime) {
      return cacheS.peek();
    }

    // Supersede whatever this hook had in flight: one request per hook, as
    // before, whoever asked for it. Superseding REPLACES the request, which is
    // why it may do this to a manual one; the effect cleanup below only
    // cancels, which is why it may not.
    if (inFlight) inFlight.controller.abort();
    const controller = new AbortController();
    inFlight = { controller, manual };
    const { signal: abortSignal } = controller;

    fetchStatus.set('fetching');
    if (cacheS.peek() == null) {
      rawStatus.set('loading');
    }

    let attempts = 0;

    async function attemptFetch() {
      try {
        const result = await queryFn({ queryKey: Array.isArray(queryKey) ? queryKey : [queryKey], signal: abortSignal });
        if (abortSignal.aborted) return;
        batch(() => {
          cacheS.set(result); // Updates all components reading this key
          error.set(null);
          rawStatus.set('success');
          fetchStatus.set('idle');
        });
        lastFetchTime = Date.now();
        cacheTimestamps.set(key, Date.now());

        if (onSuccess) onSuccess(result);
        if (onSettled) onSettled(result, null);

        // Schedule cache cleanup (only if no active subscribers).
        //
        // Replaces the previous timer instead of arming another: every
        // successful fetch used to add one and clear none, so a polling query
        // accumulated pending Timeout objects at roughly (fetch rate x cacheTime).
        if (cleanupTimer) clearTimeout(cleanupTimer);
        cleanupTimer = unrefTimer(setTimeout(() => {
          if (Date.now() - lastFetchTime >= cacheTime) {
            const subs = revalidationSubscribers.get(key);
            if (!subs || subs.size === 0) {
              cacheSignals.delete(key);
              errorSignals.delete(key);
              validatingSignals.delete(key);
              cacheTimestamps.delete(key);
              lastFetchTimestamps.delete(key);
            }
          }
        }, cacheTime));

        return result;
      } catch (e) {
        if (abortSignal.aborted) return;
        attempts++;
        if (attempts < retry) {
          // Abort-aware retry delay: cancel the wait if the component unmounts
          await new Promise((resolve, reject) => {
            const id = unrefTimer(setTimeout(resolve, retryDelay(attempts)));
            abortSignal.addEventListener('abort', () => {
              clearTimeout(id);
              reject(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
          }).catch(e => { if (e.name === 'AbortError') return; throw e; });
          if (abortSignal.aborted) return;
          return attemptFetch();
        }

        batch(() => {
          error.set(e);
          rawStatus.set('error');
          fetchStatus.set('idle');
        });

        if (onError) onError(e);
        if (onSettled) onSettled(null, e);

        throw e;
      }
    }

    try {
      return await attemptFetch();
    } finally {
      // Release ownership, but only if this request is still the current one:
      // a newer fetch may already have superseded it while it was awaiting.
      if (inFlight && inFlight.controller === controller) inFlight = null;
    }
  }

  // clearCache() empties this key's shared signals, but the request this hook
  // already has in flight is local to it and went on running: it landed a
  // moment after the clear and wrote the previous user's data back into the
  // entry the component is reading. See registerClearCacheHandler.
  //
  // A manual refetch() is cancelled too, unlike in the effect cleanup below.
  // The caller's promise then resolves with undefined, which is the right trade
  // against painting a logged-out user's data: clearCache() is a nuke, and
  // useInfiniteQuery has always treated it as one.
  function resetOnClearCache() {
    if (inFlight) {
      inFlight.controller.abort();
      inFlight = null;
    }
    // An aborted fetch deliberately returns without touching either status
    // signal, so nothing else would ever clear them. fetchStatus is the one
    // that must not be left behind: the derived status above reads it to decide
    // whether an emptied entry is being refilled, so 'fetching' would describe
    // a request that no longer exists as a load in progress, and render a
    // spinner that never comes down.
    batch(() => {
      if (rawStatus.peek() !== 'idle') rawStatus.set('idle');
      if (fetchStatus.peek() !== 'idle') fetchStatus.set('idle');
    });
  }

  // Initial fetch, plus the invalidation subscription for this key.
  // Subscribing inside the effect is deliberate: see the matching comment in
  // useSWR above. A query whose queryFn reads a signal re-runs this effect, and
  // a subscription created once outside it was cancelled by the first such
  // re-run, leaving the query permanently deaf to invalidateQueries().
  scopedEffect(() => {
    const unsubscribe = subscribeToKey(key, () => fetchQuery({ force: true }).catch(() => {}));
    const releaseHandler = registerClearCacheHandler(resetOnClearCache);
    // Tracked read of the MIRRORED gate, so this effect re-runs when the gate
    // actually flips (and when the query function's own signals move), not
    // whenever some unrelated signal a gate thunk happens to touch moves.
    if (gate()) {
      fetchQuery().catch(() => {});
    } else if (!inFlight?.manual) {
      // Turning a query off settles it. The cleanup below aborted anything the
      // effect itself started, and an aborted request deliberately returns
      // without touching either status signal, so nothing else would ever clear
      // them. A request refetch() owns is still running, though, so this must
      // not report 'idle' over the top of one.
      batch(() => {
        if (rawStatus.peek() === 'loading') rawStatus.set('idle');
        if (fetchStatus.peek() !== 'idle') fetchStatus.set('idle');
      });
    }
    return () => {
      // Cancel only what this effect started. Cancelling a manual refetch here
      // destroyed it without replacing it, and the caller saw nothing at all.
      if (inFlight && !inFlight.manual) {
        inFlight.controller.abort();
        inFlight = null;
      }
      unsubscribe();
      releaseHandler();
    };
  });

  // Unmount cancels everything, including the manual request the effect's own
  // cleanup deliberately spares.
  onComponentDispose(() => {
    if (inFlight) {
      inFlight.controller.abort();
      inFlight = null;
    }
  });

  // Refetch on focus
  if (refetchOnWindowFocus && typeof window !== 'undefined') {
    scopedEffect(() => {
      const handler = () => {
        if (document.visibilityState === 'visible') {
          fetchQuery().catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    });
  }

  // Polling
  if (refetchInterval) {
    scopedEffect(() => {
      const interval = unrefTimer(setInterval(() => {
        fetchQuery().catch(() => {});
      }, refetchInterval));
      return () => clearInterval(interval);
    });
  }

  return {
    data: () => data() ?? placeholderData,
    error: () => error(),
    status: () => status(),
    fetchStatus: () => fetchStatus(),
    isLoading: () => status() === 'loading',
    isError: () => status() === 'error',
    isSuccess: () => status() === 'success',
    // A query that is disabled and has never resolved. Its complement used to
    // be reported as isLoading(), which is why a disabled query rendered a
    // spinner that never came down.
    isIdle: () => status() === 'idle',
    isFetching: () => fetchStatus() === 'fetching',
    isEnabled: () => gate(),
    // Explicit: never gated by `enabled`, and never answered from the freshness
    // window. A manual "get me fresh data now" that a staleTime silently
    // swallows is a no-op the caller has no way to see, which is the same bug
    // class that made invalidateQueries() a no-op.
    refetch: () => fetchQuery({ force: true, manual: true }),
  };
}

// --- useInfiniteQuery Hook ---
// For paginated/infinite scroll data

// Every base query option used to fall into an unused `...rest`, so `enabled`,
// `select`, `retry`, `onSuccess` and the rest were accepted and silently
// dropped. Those are honoured here.
//
// DEFERRED, on purpose: joining the shared cache. `key` is normalized and used
// for the invalidation subscription, but the pages live in signals local to
// this hook rather than in cacheSignals, so staleTime/cacheTime, getQueryData,
// setQueryData and cross-component sharing do not reach an infinite query yet.
// The shared cache holds ONE value per key, and an infinite query holds a
// growing list plus its page params; storing that under the same key would
// collide head-on with a useQuery on the same key (each would serve the other
// the wrong shape) and hand setQueryData a structure it has no way to describe.
// That needs a cache entry with a declared kind, which is a design change, not
// a patch. The options that depend on it (staleTime, cacheTime, placeholderData,
// refetchOnWindowFocus, refetchInterval) are still not honoured.
export function useInfiniteQuery(options) {
  const {
    queryKey,
    queryFn,
    getNextPageParam,
    getPreviousPageParam,
    initialPageParam,
    enabled = true,
    select,
    retry = 3,
    retryDelay = (attempt) => Math.min(1000 * 2 ** attempt, 30000),
    onSuccess,
    onError,
    onSettled,
  } = options;

  const gate = createGate(enabled);

  const pages = signal([]);
  // Starts EMPTY. It used to be seeded with initialPageParam AND appended to by
  // the first fetch, so one page in produced [0, 0]: pageParams[i] no longer
  // named pages[i], and anything walking the two together (a "load newer"
  // control reading pageParams[0]) held a param for a page that did not exist.
  const pageParams = signal([]);
  const hasNextPage = signal(true);
  const hasPreviousPage = signal(false);
  const isFetchingNextPage = signal(false);
  const isFetchingPreviousPage = signal(false);
  // An infinite query had no failure surface at all: a rejected queryFn was
  // swallowed by the effect's .catch() and the list just stayed empty forever,
  // with no way for a component to tell "no results" from "the request failed".
  // index.d.ts already promised error/status/isLoading here.
  //
  // These are local rather than the shared getErrorSignal(key), for the reason
  // in the note above: an infinite query does not own the shared entry for its
  // key, so writing errors into it would clobber a useQuery reading the same key.
  const error = signal(null);
  const status = signal(gate.peek() ? 'loading' : 'idle');

  const key = normalizeQueryKey(queryKey);
  // The page request in flight and who asked for it. See the matching note in
  // useQuery: an explicit fetchNextPage()/refetch() belongs to the caller, and
  // the effect's cleanup must not cancel one just because it re-ran.
  let inFlight = null;

  // clearCache() reaches an infinite query through here, because its pages
  // never entered cacheSignals for clearCache to empty. Same nuke: drop the
  // pages, drop the error, and cancel anything in flight -- a request issued
  // for the PREVIOUS user would otherwise land after the clear and put their
  // rows back on screen, which is the whole thing we are preventing.
  function resetOnClearCache() {
    if (inFlight) {
      inFlight.controller.abort();
      inFlight = null;
    }
    batch(() => {
      pages.set([]);
      pageParams.set([]);
      hasNextPage.set(true);
      hasPreviousPage.set(false);
      isFetchingNextPage.set(false);
      isFetchingPreviousPage.set(false);
      error.set(null);
      // Nothing is in flight and the clear started nothing, so 'idle' -- the
      // same honest report useQuery derives for an emptied entry.
      status.set('idle');
    });
  }

  // `replace` is a per-call argument, not a flag on the hook. As a flag it was
  // set before the fetch and cleared only on success, so a refetch that aborted
  // or failed left "replace the whole list" armed for whichever fetchNextPage()
  // ran next, which silently deleted every loaded page.
  async function fetchPage(pageParam, direction = 'next', { replace = false, manual = false } = {}) {
    // Supersede the previous page fetch, whoever asked for it.
    if (inFlight) inFlight.controller.abort();
    const controller = new AbortController();
    // `direction` is recorded so the finally below can tell whether the request
    // that replaced this one owns the same loading flag. See the note there.
    inFlight = { controller, manual, direction };
    const { signal: abortSignal } = controller;

    const loading = direction === 'next' ? isFetchingNextPage : isFetchingPreviousPage;
    loading.set(true);
    // Only the first page is 'loading'. Paging through an existing list keeps
    // status 'success' and reports itself through isFetchingNextPage, so a list
    // does not blink back to a spinner every time it grows.
    if (pages.peek().length === 0) status.set('loading');

    let attempts = 0;

    try {
      // Retry loop, with the same accounting as useQuery: `retry` is the total
      // number of attempts, and the wait between them is abort-aware so an
      // unmount cancels the pending retry instead of firing it into a dead
      // component.
      for (;;) {
        try {
          const result = await queryFn({
            queryKey: Array.isArray(queryKey) ? queryKey : [queryKey],
            pageParam,
            signal: abortSignal,
          });

          if (abortSignal.aborted) return;

          batch(() => {
            if (replace) {
              // Refetch: replace all pages with fresh first page (SWR pattern —
              // old pages stayed visible during fetch, now swap atomically)
              pages.set([result]);
              pageParams.set([pageParam]);
            } else if (direction === 'next') {
              pages.set([...pages.peek(), result]);
              pageParams.set([...pageParams.peek(), pageParam]);
            } else {
              pages.set([result, ...pages.peek()]);
              pageParams.set([pageParam, ...pageParams.peek()]);
            }

            const nextParam = getNextPageParam?.(result, pages.peek());
            hasNextPage.set(nextParam !== undefined);

            if (getPreviousPageParam) {
              const prevParam = getPreviousPageParam(result, pages.peek());
              hasPreviousPage.set(prevParam !== undefined);
            }

            error.set(null);
            status.set('success');
          });

          if (onSuccess) onSuccess(result);
          if (onSettled) onSettled(result, null);

          return result;
        } catch (e) {
          if (abortSignal.aborted) return;
          attempts++;
          if (attempts < retry) {
            // Abort-aware retry delay: cancel the wait if the component unmounts
            await new Promise((resolve, reject) => {
              const id = unrefTimer(setTimeout(resolve, retryDelay(attempts)));
              abortSignal.addEventListener('abort', () => {
                clearTimeout(id);
                reject(new DOMException('Aborted', 'AbortError'));
              }, { once: true });
            }).catch((err) => { if (err.name === 'AbortError') return; throw err; });
            if (abortSignal.aborted) return;
            continue;
          }

          batch(() => {
            error.set(e);
            status.set('error');
          });

          if (onError) onError(e);
          if (onSettled) onSettled(null, e);

          throw e;
        }
      }
    } finally {
      // Clear this direction's loading flag unless a LIVE request in the SAME
      // direction has taken it over.
      //
      // `if (!abortSignal.aborted)` alone was too blunt. It exists so that an
      // aborted fetch cannot report "not fetching" over the top of the fetch
      // that replaced it, which is only a risk when the replacement uses the
      // same flag. Every other abort left the flag stuck true with nothing
      // alive behind it: fetchPreviousPage() over a fetchNextPage() still in
      // flight left isFetchingNextPage() true for the rest of the page's life,
      // and so isFetching() with it, which is a "loading more" spinner that
      // never comes down. The effect's cleanup abort (a gate flip, or the query
      // function's own signals moving) does the same for whichever direction it
      // interrupted.
      const successor = inFlight && inFlight.controller !== controller ? inFlight : null;
      if (!abortSignal.aborted || !successor || successor.direction !== direction) {
        loading.set(false);
      }
      // Release ownership, unless a newer fetch already superseded this one.
      if (inFlight && inFlight.controller === controller) inFlight = null;
    }
  }

  // Explicit call from application code, so never gated by `enabled` (the same
  // rule as useQuery's refetch). `manual` distinguishes the public refetch()
  // from the invalidation subscriber below, which is automatic fetching aimed
  // at a key and is owned by the effect.
  function refetchAll({ manual = false } = {}) {
    // Keep old pages visible during refetch (SWR pattern).
    // fetchPage swaps them atomically when the data arrives.
    return fetchPage(initialPageParam, 'next', { replace: true, manual });
  }

  const view = computed(() => {
    const raw = { pages: pages(), pageParams: pageParams() };
    return select ? select(raw) : raw;
  });

  // Initial fetch, plus the invalidation subscription for this key. See the
  // matching comment in useQuery for why the subscription lives INSIDE the
  // effect.
  scopedEffect(() => {
    // The normalized key was computed and then never used, so an infinite query
    // was invisible to invalidateQueries(). Refetching from the first page is
    // the only coherent answer for a list whose later pages may no longer exist
    // once the data behind it changed.
    const unsubscribe = subscribeToKey(key, () => {
      if (gate.peek()) refetchAll().catch(() => {});
    });
    const releaseHandler = registerClearCacheHandler(resetOnClearCache);
    // Tracked read of the MIRRORED gate: this effect re-runs when the gate
    // actually flips, not whenever some unrelated signal a gate thunk happens
    // to touch moves. See createGate.
    if (gate()) {
      // `replace`, because a re-run of this effect means an input to page one
      // changed (the query function read a signal that moved, or `enabled`
      // flipped). Appending in that case left a stale copy of page one sitting
      // above the fresh one, forever. On the first run the list is empty, so
      // replacing and appending are the same thing.
      fetchPage(initialPageParam, 'next', { replace: true }).catch(() => {});
    } else if (!inFlight?.manual) {
      // Turning it off settles it: the cleanup below aborted anything the
      // effect started, and an aborted page fetch returns without clearing its
      // own loading flag. A page an explicit call is still fetching is left
      // alone, and so is the status describing it.
      batch(() => {
        if (status.peek() === 'loading') status.set('idle');
        if (isFetchingNextPage.peek()) isFetchingNextPage.set(false);
        if (isFetchingPreviousPage.peek()) isFetchingPreviousPage.set(false);
      });
    }
    return () => {
      // Cancel only what this effect started; see the matching note in useQuery.
      if (inFlight && !inFlight.manual) {
        inFlight.controller.abort();
        inFlight = null;
      }
      unsubscribe();
      releaseHandler();
    };
  });

  // Unmount cancels everything, including a page fetch the application asked
  // for that the effect's own cleanup spares.
  onComponentDispose(() => {
    if (inFlight) {
      inFlight.controller.abort();
      inFlight = null;
    }
  });

  return {
    data: () => view(),
    error: () => error(),
    status: () => status(),
    isLoading: () => status() === 'loading',
    isError: () => status() === 'error',
    isSuccess: () => status() === 'success',
    isIdle: () => status() === 'idle',
    isFetching: () => isFetchingNextPage() || isFetchingPreviousPage(),
    isEnabled: () => gate(),
    hasNextPage: () => hasNextPage(),
    hasPreviousPage: () => hasPreviousPage(),
    isFetchingNextPage: () => isFetchingNextPage(),
    isFetchingPreviousPage: () => isFetchingPreviousPage(),
    // "Load more" is an explicit call from application code, so it is `manual`
    // for the same reason refetch() is: a re-run of the effect must not cancel
    // a page the user asked for and hand the caller back `undefined`.
    //
    // An EMPTY page list is answered by fetching page one, and the user's
    // getNextPageParam/getPreviousPageParam is not consulted at all.
    //
    // Both of these are ungated by `enabled`, like refetch(), but a disabled
    // query's state is always the empty list, and the empty list had no last
    // page to derive a param from. So they called the user's callback with
    // `undefined`, and the documented callback shape
    // `(lastPage) => lastPage.nextCursor` throws on it -- while a defensive
    // `lastPage?.nextCursor` returns undefined and made the call a silent
    // no-op that fetched nothing. Either way refetch() was the only thing that
    // could load a disabled list, so "explicit calls run either way" was true
    // of one of the three. There is exactly one page it can mean here, and it
    // is the first one; asking a getNextPageParam what follows a page that does
    // not exist is not a question it can answer.
    //
    // `replace`, because this IS page one: it must land as the whole list, not
    // as an append onto whatever a racing call left behind.
    fetchNextPage: async () => {
      const loaded = pages.peek();
      if (loaded.length === 0) {
        return fetchPage(initialPageParam, 'next', { replace: true, manual: true });
      }
      const nextParam = getNextPageParam?.(loaded[loaded.length - 1], loaded);
      if (nextParam !== undefined) {
        return fetchPage(nextParam, 'next', { manual: true });
      }
    },
    fetchPreviousPage: async () => {
      const loaded = pages.peek();
      if (loaded.length === 0) {
        // Same reasoning, and the direction is kept so that a caller watching
        // isFetchingPreviousPage() still sees the request it made.
        return fetchPage(initialPageParam, 'previous', { replace: true, manual: true });
      }
      const prevParam = getPreviousPageParam?.(loaded[0], loaded);
      if (prevParam !== undefined) {
        return fetchPage(prevParam, 'previous', { manual: true });
      }
    },
    refetch: () => refetchAll({ manual: true }),
  };
}

// --- Cache Management ---

// Every key the cache knows about. A query that has subscribed but not yet
// resolved has a revalidation subscriber before it has a cache signal, and
// invalidating it is exactly how you tell it to fetch, so both maps count.
function allKnownKeys() {
  const keys = new Set(cacheSignals.keys());
  for (const key of revalidationSubscribers.keys()) keys.add(key);
  return keys;
}

export function invalidateQueries(keyOrPredicate, options = {}) {
  const { hard = false, exact = false } = options;
  const keysToInvalidate = [];
  if (typeof keyOrPredicate === 'function') {
    // allKnownKeys, not cacheSignals: a query that has subscribed but not yet
    // resolved has no cache entry, and an infinite query never gets one at all
    // (its pages are local), so iterating the data Map made a predicate blind
    // to exactly the queries an invalidation is aimed at. The prefix branch
    // below already looks in both places.
    for (const key of allKnownKeys()) {
      if (keyOrPredicate(key)) keysToInvalidate.push(key);
    }
  } else if (Array.isArray(keyOrPredicate) && !exact) {
    // An array key is a PREFIX: invalidateQueries(['todos']) invalidates
    // ['todos', 1] and ['todos', {done: true}] too, which is what the shape
    // implies and what every peer library does. Matching is on segment
    // boundaries, so ['todo'] never matches 'todos'.
    const prefix = normalizeQueryKey(keyOrPredicate);
    const scoped = prefix + ':';
    for (const key of allKnownKeys()) {
      if (key === prefix || (typeof key === 'string' && key.startsWith(scoped))) {
        keysToInvalidate.push(key);
      }
    }
  } else {
    keysToInvalidate.push(normalizeQueryKey(keyOrPredicate));
  }

  for (const key of keysToInvalidate) {
    // Before notifying anyone: every subscriber woken below reads this epoch, so
    // they agree on one refetch, and any request already in flight is now a
    // generation behind and cannot answer for them.
    bumpEpoch(key);
    // Hard invalidation clears data immediately (shows loading state)
    // Soft invalidation (default) keeps stale data visible during re-fetch (SWR pattern)
    if (hard && cacheSignals.has(key)) cacheSignals.get(key).set(null);
    // Trigger all subscribers to re-fetch
    const subs = revalidationSubscribers.get(key);
    if (subs) {
      for (const revalidate of subs) revalidate();
    }
  }
}

export function prefetchQuery(key, fetcher) {
  key = normalizeQueryKey(key);
  const cacheS = getCacheSignal(key);
  return fetcher(key).then(result => {
    cacheS.set(result);
    cacheTimestamps.set(key, Date.now());
    return result;
  });
}

export function setQueryData(key, updater) {
  key = normalizeQueryKey(key);
  const cacheS = getCacheSignal(key);
  const current = cacheS.peek();
  cacheS.set(typeof updater === 'function' ? updater(current) : updater);
  cacheTimestamps.set(key, Date.now());
}

export function getQueryData(key) {
  key = normalizeQueryKey(key);
  return cacheSignals.has(key) ? cacheSignals.get(key).peek() : undefined;
}

// Empty the cache without detaching anything that is currently on screen.
//
// This used to .clear() the Maps. A mounted component captured its key's signal
// OBJECTS when it mounted, so dropping the entries produced two failures at
// once: the component kept displaying the old value (the signal it holds was
// never reset, which is precisely wrong for the case clearCache exists for, a
// logout), and the next getCacheSignal() for that key minted a FRESH signal, so
// every later write (setQueryData, a sibling component's fetch, prefetchQuery)
// landed somewhere the mounted component was not reading. That contradicts the
// documented promise that components sharing a key share one set of signals.
//
// So: every key is EMPTIED IN PLACE, which is the only write that reaches what
// is currently on screen. It is emptied to `undefined`, not `null`, so the
// entry reads as ABSENT afterwards: getQueryData() answers `undefined` for a
// cleared key whether or not the object had to be kept alive for a consumer.
// That matters because "is anything still reading this?" is a guess, and it is
// a wrong one for a hook created OUTSIDE a component (a module-scope store
// query is never disposed, so its subscription is immortal); callers have no
// business being able to tell those two cases apart.
//
// Dropping the entry is then purely about reclaiming memory, and the guess is
// free to be wrong: a key whose emptied signals are kept reads exactly like one
// whose entry went away.
//
// Deliberately NOT cleared: revalidationSubscribers. A subscriber is the live
// wiring between a mounted component and its key; dropping it would deafen
// every mounted query to invalidateQueries() forever, which is the same
// detachment bug in the other channel. Subscriptions are owned by the effect
// that created them and are released on unmount.
export function clearCache() {
  batch(() => {
    for (const key of allKnownKeys()) {
      cacheSignals.get(key)?.set(undefined);
      errorSignals.get(key)?.set(null);
      validatingSignals.get(key)?.set(false);

      const subs = revalidationSubscribers.get(key);
      if (subs !== undefined && subs.size > 0) {
        cacheTimestamps.set(key, Date.now());
      } else {
        cacheSignals.delete(key);
        errorSignals.delete(key);
        validatingSignals.delete(key);
        cacheTimestamps.delete(key);
      }
    }

    // What walking the Maps above cannot reach: an infinite query's pages,
    // which live in signals local to the hook, and every hook's in-flight
    // REQUEST, which is not data at all but lands as data a moment later. See
    // registerClearCacheHandler.
    //
    // Last, and inside the batch: the handlers read the emptied signals to
    // decide what to settle to, so they must run after every key is emptied.
    for (const handler of clearCacheHandlers) handler();
  });
  lastFetchTimestamps.clear();
  inFlightRequests.clear();
  keyEpochs.clear();
}

/**
 * Get a snapshot of all cache entries for devtools.
 * @internal
 */
export function __getCacheSnapshot() {
  const entries = [];
  for (const [key, sig] of cacheSignals) {
    entries.push({
      key,
      data: sig.peek(),
      error: errorSignals.has(key) ? errorSignals.get(key).peek() : null,
      isValidating: validatingSignals.has(key) ? validatingSignals.get(key).peek() : false,
    });
  }
  return entries;
}
