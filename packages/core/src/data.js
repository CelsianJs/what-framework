// What Framework - Data Fetching
// SWR-like data fetching with caching, revalidation, and optimistic updates

import { signal, effect, batch, computed, __DEV__ } from './reactive.js';
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

// Create an effect scoped to the current component's lifecycle.
// When the component unmounts, the effect is automatically disposed.
function scopedEffect(fn) {
  const ctx = getCurrentComponent?.();
  const dispose = effect(fn);
  if (ctx) ctx.effects.push(dispose);
  return dispose;
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

export function useSWR(key, fetcher, options = {}) {
  const {
    revalidateOnFocus = true,
    revalidateOnReconnect = true,
    refreshInterval = 0,
    dedupingInterval = 2000,
    fallbackData,
    onSuccess,
    onError,
    suspense = false,
  } = options;

  // Support null/undefined/false key for conditional/dependent fetching
  // When key is falsy, don't fetch — return idle state
  if (key == null || key === false) {
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

  // Shared reactive cache signals — all useSWR instances with the same key
  // read from these signals, so mutating from one component updates all others.
  const cacheS = getCacheSignal(key);
  const error = getErrorSignal(key);
  const isValidating = getValidatingSignal(key);
  const data = computed(() => cacheS() ?? fallbackData ?? null);
  const isLoading = computed(() => cacheS() == null && isValidating());

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

    const promise = fetcher(key, { signal: abortSignal });
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
      if (onSuccess) onSuccess(result, key);
      return result;
    } catch (e) {
      if (abortSignal.aborted) return;
      error.set(e);
      if (onError) onError(e, key);
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
    revalidate().catch(() => {});
    // Cleanup: abort and unsubscribe on unmount
    return () => {
      if (abortController) abortController.abort();
      unsubscribe();
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

  const cacheS = getCacheSignal(key);
  const data = computed(() => {
    const d = cacheS();
    return select && d !== null ? select(d) : d;
  });
  const error = getErrorSignal(key);
  const status = signal(cacheS.peek() != null ? 'success' : 'loading');
  const fetchStatus = signal('idle');

  let lastFetchTime = 0;
  let abortController = null;
  let cleanupTimer = null;

  // See the note on useSWR's revalidate: an invalidation must not be answered
  // from the freshness window, or `invalidateQueries` becomes a no-op for every
  // query with a staleTime.
  async function fetchQuery({ force = false } = {}) {
    if (!enabled) return;

    // Check if data is still fresh
    const now = Date.now();
    if (!force && cacheS.peek() != null && now - lastFetchTime < staleTime) {
      return cacheS.peek();
    }

    // Abort previous request
    if (abortController) abortController.abort();
    abortController = new AbortController();
    const { signal: abortSignal } = abortController;

    fetchStatus.set('fetching');
    if (cacheS.peek() == null) {
      status.set('loading');
    }

    let attempts = 0;

    async function attemptFetch() {
      try {
        const result = await queryFn({ queryKey: Array.isArray(queryKey) ? queryKey : [queryKey], signal: abortSignal });
        if (abortSignal.aborted) return;
        batch(() => {
          cacheS.set(result); // Updates all components reading this key
          error.set(null);
          status.set('success');
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
          status.set('error');
          fetchStatus.set('idle');
        });

        if (onError) onError(e);
        if (onSettled) onSettled(null, e);

        throw e;
      }
    }

    return attemptFetch();
  }

  // Initial fetch, plus the invalidation subscription for this key.
  // Subscribing inside the effect is deliberate: see the matching comment in
  // useSWR above. A query whose queryFn reads a signal re-runs this effect, and
  // a subscription created once outside it was cancelled by the first such
  // re-run, leaving the query permanently deaf to invalidateQueries().
  scopedEffect(() => {
    const unsubscribe = subscribeToKey(key, () => fetchQuery({ force: true }).catch(() => {}));
    if (enabled) {
      fetchQuery().catch(() => {});
    }
    return () => {
      if (abortController) abortController.abort();
      unsubscribe();
    };
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
    isFetching: () => fetchStatus() === 'fetching',
    refetch: fetchQuery,
  };
}

// --- useInfiniteQuery Hook ---
// For paginated/infinite scroll data

export function useInfiniteQuery(options) {
  const {
    queryKey,
    queryFn,
    getNextPageParam,
    getPreviousPageParam,
    initialPageParam,
    ...rest
  } = options;

  const pages = signal([]);
  const pageParams = signal([initialPageParam]);
  const hasNextPage = signal(true);
  const hasPreviousPage = signal(false);
  const isFetchingNextPage = signal(false);
  const isFetchingPreviousPage = signal(false);

  const key = normalizeQueryKey(queryKey);
  let abortController = null;

  let isRefetching = false;

  async function fetchPage(pageParam, direction = 'next') {
    // Abort previous page fetch
    if (abortController) abortController.abort();
    abortController = new AbortController();
    const { signal: abortSignal } = abortController;

    const loading = direction === 'next' ? isFetchingNextPage : isFetchingPreviousPage;
    loading.set(true);

    try {
      const result = await queryFn({
        queryKey: Array.isArray(queryKey) ? queryKey : [queryKey],
        pageParam,
        signal: abortSignal,
      });

      if (abortSignal.aborted) return;

      batch(() => {
        if (isRefetching) {
          // Refetch: replace all pages with fresh first page (SWR pattern —
          // old pages stayed visible during fetch, now swap atomically)
          pages.set([result]);
          pageParams.set([pageParam]);
          isRefetching = false;
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
      });

      return result;
    } finally {
      if (!abortSignal.aborted) loading.set(false);
    }
  }

  // Initial fetch, abort on unmount
  scopedEffect(() => {
    fetchPage(initialPageParam).catch(() => {});
    return () => {
      if (abortController) abortController.abort();
    };
  });

  return {
    data: () => ({ pages: pages(), pageParams: pageParams() }),
    hasNextPage: () => hasNextPage(),
    hasPreviousPage: () => hasPreviousPage(),
    isFetchingNextPage: () => isFetchingNextPage(),
    isFetchingPreviousPage: () => isFetchingPreviousPage(),
    fetchNextPage: async () => {
      const lastPage = pages.peek()[pages.peek().length - 1];
      const nextParam = getNextPageParam?.(lastPage, pages.peek());
      if (nextParam !== undefined) {
        return fetchPage(nextParam, 'next');
      }
    },
    fetchPreviousPage: async () => {
      const firstPage = pages.peek()[0];
      const prevParam = getPreviousPageParam?.(firstPage, pages.peek());
      if (prevParam !== undefined) {
        return fetchPage(prevParam, 'previous');
      }
    },
    refetch: async () => {
      // Keep old pages visible during refetch (SWR pattern).
      // The fetchPage callback swaps them atomically when data arrives.
      isRefetching = true;
      return fetchPage(initialPageParam);
    },
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
    for (const [key] of cacheSignals) {
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

export function clearCache() {
  cacheSignals.clear();
  errorSignals.clear();
  validatingSignals.clear();
  cacheTimestamps.clear();
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
