// what-core/data (what-framework/data): one query cache on async values, the
// signal-native query() that reads it, the React-ecosystem hooks over it, and
// the cache operations (docs/DATA.md).

import type { AsyncComputed } from './index.js';

/**
 * A cache key. An array key is joined into one normalized string
 * (`['todos', 1]` is `"todos:1"`), so an array and its normalization address
 * the same entry everywhere a key is accepted, and a string key shares the
 * namespace: `query('todos')`, `useSWR('todos')` and
 * `useQuery({ queryKey: ['todos'] })` are one entry.
 */
export type QueryKey = string | readonly unknown[];

/** A key, or a function of signals that returns one; null, false or undefined: no key (nothing is fetched). */
export type QueryKeySource<K extends QueryKey = QueryKey> = K | null | false | undefined | (() => K | null | false | undefined);

export interface QueryOptions<T> {
  /** How long (ms) a landed value is fresh: a reader attaching within it is answered from the cache. Default 0. */
  staleTime?: number;
  /** How long (ms) an entry nothing reads is kept before it is dropped. Default 5 minutes. */
  gcTime?: number;
  /** Total attempts for a failing fetch (a number), or whether to try again. Default 1: no retry. */
  retry?: number | boolean | ((failures: number, error: unknown) => boolean);
  retryDelay?: (attempt: number) => number;
  /** The entry's value before the first fetch lands (or a function returning it). */
  initialData?: T | (() => T);
}

/**
 * The signal-native read of the cache: an async value for the entry `key`
 * names now. `key` may be a function of signals; when it moves, the value
 * fetches the new key's entry (or shows it at once, if it is cached and
 * fresh) and keeps the old value meanwhile (`pending()` is true). Reading it
 * before the first value lands holds the reader, or suspends its
 * `<Suspense>`; `refresh(q)` fetches the entry again; a server render sends
 * the value in the hydration data channel, under the key, and the hydrating
 * client adopts it with no request. Readers of one key share one request.
 */
export function query<T, K extends QueryKey = QueryKey>(
  key: QueryKeySource<K>,
  fetcher: (key: K, ctx: { signal: AbortSignal }) => Promise<T> | T,
  options?: QueryOptions<T>,
): AsyncComputed<T>;

// --- The hooks: React-ecosystem shapes over the same cache ---

export function useFetch<T = any>(url: string | null | (() => string | null | undefined), options?: {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Applied to the parsed JSON before it is cached. */
  transform?: (data: any) => T;
  /** What data() is before the first response. Default null. */
  initialData?: T | null;
  /** The fetch implementation. Default globalThis.fetch. */
  fetch?: typeof fetch;
}): {
  /** null (or initialData) until the first response lands. */
  data: () => T | null;
  error: () => any;
  isLoading: () => boolean;
  /** Fetches again; never rejects (a failure shows in error()). */
  refetch: () => Promise<void>;
  mutate: (newData: T) => void;
};

export interface SWROptions<T> {
  revalidateOnFocus?: boolean;
  revalidateOnReconnect?: boolean;
  /** Poll every n ms (0: never). */
  refreshInterval?: number;
  /** A fetch within this many ms of the last one answers a new reader, a focus or a reconnect. Default 2000. */
  dedupingInterval?: number;
  /** What data() is while the cache has nothing for the key (not stored in the cache). */
  fallbackData?: T;
  /**
   * Structural sharing (TanStack Query's default): a response equal to the
   * cached data keeps the cached references, and a changed one keeps every
   * part it did not change, so a keyed list sees the same row objects after
   * a refetch. A function picks what is kept from (cached, response); false
   * takes every response as it arrives. Default true.
   */
  structuralSharing?: boolean | ((prev: T | undefined, next: T) => T);
  /** Show the previous key's data while a new key loads. */
  keepPreviousData?: boolean;
  /** Called when a fetch this reader started succeeds. */
  onSuccess?: (data: T, key: any) => void;
  onError?: (error: any, key: any) => void;
}

/**
 * SWR's shape. A null, false or throwing key (or a function returning one)
 * pauses it. `fetcher(key, { signal })` receives the key as written.
 */
export function useSWR<T = any, K = any>(
  key: K | null | false | (() => K | null | false | undefined),
  fetcher: (key: K, ctx: { signal: AbortSignal }) => Promise<T> | T,
  options?: SWROptions<T>,
): {
  /** The cached value, or fallbackData, or null. */
  data: () => T | null;
  error: () => any;
  /** No data yet, and fetching. */
  isLoading: () => boolean;
  /** Fetching. */
  isValidating: () => boolean;
  /** Put data in the cache for every reader of the key, then (by default) fetch again. mutate() alone revalidates. */
  mutate: (newData?: T | ((prev: T | null) => T), shouldRevalidate?: boolean) => Promise<T | void>;
  revalidate: () => Promise<T | void>;
};

/**
 * 'idle' is a real state: nothing cached and nothing in flight (a disabled
 * query). Reporting it as loading is what renders a spinner that never comes
 * down.
 */
export type QueryStatus = 'idle' | 'loading' | 'success' | 'error';
/** Whether a request is on the wire, independent of whether data exists. */
export type FetchStatus = 'idle' | 'fetching';

export interface UseQueryOptions<T, D = T> {
  /** The key. A function of signals moves the query to the key it returns. */
  queryKey: QueryKeySource;
  /**
   * Fetches the key's value. `queryKey` is this query's own key as it wrote it
   * (as an array), even when another spelling of it (`'todos:1'` for
   * `['todos', 1]`) created the cache entry they share.
   */
  queryFn: (ctx: { queryKey: readonly unknown[]; signal: AbortSignal }) => Promise<T> | T;
  /** A boolean, a signal or a thunk: automatic fetching starts when it turns true. Explicit refetch() is never gated. */
  enabled?: boolean | (() => boolean);
  /** Default 0. */
  staleTime?: number;
  /** How long an unread entry is kept. Default 5 minutes. `cacheTime` is the same option. */
  gcTime?: number;
  cacheTime?: number;
  refetchOnWindowFocus?: boolean;
  refetchOnReconnect?: boolean;
  refetchInterval?: number | false;
  /** Total attempts for a failing fetch. Default 3. */
  retry?: number | boolean | ((failures: number, error: unknown) => boolean);
  retryDelay?: (attempt: number) => number;
  /** Called when a fetch this query started lands. */
  onSuccess?: (data: T) => void;
  onError?: (error: any) => void;
  onSettled?: (data: T | null, error: any) => void;
  select?: (data: T) => D;
  /** Shown while the entry has no data; a function receives the previous key's data. */
  placeholderData?: D | ((previous: D | undefined) => D | undefined);
  /** Show the previous key's data while a new key loads. */
  keepPreviousData?: boolean;
  initialData?: T | (() => T);
  initialDataUpdatedAt?: number;
  /**
   * Structural sharing (TanStack Query's default): a response equal to the
   * cached data keeps the cached references, and a changed one keeps every
   * part it did not change, so a keyed list sees the same row objects after
   * a refetch. A function picks what is kept from (cached, response); false
   * takes every response as it arrives. Default true.
   */
  structuralSharing?: boolean | ((prev: T | undefined, next: T) => T);
}

/** TanStack Query's shape. data() never suspends; for a value that suspends, use query(). */
export function useQuery<T = any, D = T>(options: UseQueryOptions<T, D>): {
  data: () => D | undefined;
  error: () => any;
  status: () => QueryStatus;
  fetchStatus: () => FetchStatus;
  isLoading: () => boolean;
  isFetching: () => boolean;
  isError: () => boolean;
  isSuccess: () => boolean;
  isIdle: () => boolean;
  /** Whether data() is placeholderData or the previous key's data. */
  isPlaceholderData: () => boolean;
  /** Whether the `enabled` gate is open. */
  isEnabled: () => boolean;
  /** When the data landed (ms since the epoch), 0 before. */
  dataUpdatedAt: () => number;
  /** Fetch now: never gated by `enabled`, never answered from the freshness window. Resolves with the data. */
  refetch: () => Promise<T | undefined>;
};

/** Pages, plus the param each was fetched with. `pageParams[i]` names `pages[i]`. */
export interface InfiniteData<T> {
  pages: T[];
  pageParams: unknown[];
}

/**
 * TanStack Query's shape. `data()` is the page CONTAINER, not a flat array:
 * the rows are in `data().pages`. The pages are one cache entry; invalidating
 * its key refetches page one and replaces the list.
 */
export function useInfiniteQuery<T = any>(options: {
  queryKey: QueryKeySource;
  queryFn: (ctx: { queryKey: readonly unknown[]; pageParam: any; signal: AbortSignal }) => Promise<T> | T;
  getNextPageParam?: (lastPage: T, pages: T[]) => unknown;
  getPreviousPageParam?: (firstPage: T, pages: T[]) => unknown;
  initialPageParam?: unknown;
  enabled?: boolean | (() => boolean);
  staleTime?: number;
  gcTime?: number;
  cacheTime?: number;
  /** Default false: a focus refetch replaces the list with page one. */
  refetchOnWindowFocus?: boolean;
  refetchInterval?: number | false;
  select?: (data: InfiniteData<T>) => any;
  retry?: number | boolean | ((failures: number, error: unknown) => boolean);
  retryDelay?: (attempt: number) => number;
  /** Called with the page a fetch this query started returned. */
  onSuccess?: (page: T) => void;
  onError?: (error: any) => void;
  onSettled?: (page: T | null, error: any) => void;
}): {
  data: () => InfiniteData<T>;
  error: () => any;
  status: () => QueryStatus;
  isLoading: () => boolean;
  isError: () => boolean;
  isSuccess: () => boolean;
  isIdle: () => boolean;
  isFetching: () => boolean;
  isEnabled: () => boolean;
  hasNextPage: () => boolean;
  hasPreviousPage: () => boolean;
  isFetchingNextPage: () => boolean;
  isFetchingPreviousPage: () => boolean;
  /** An empty list's next page is the first page. Resolves with the page fetched. */
  fetchNextPage: () => Promise<T | undefined>;
  fetchPreviousPage: () => Promise<T | undefined>;
  refetch: () => Promise<T | undefined>;
};

// --- The cache ---

/**
 * Mark the entries `keyOrPredicate` names stale, and fetch again those
 * something shows (inside a transition, the refetch joins it). An array key
 * is a PREFIX unless `exact` is set: invalidateQueries(['todos']) also
 * invalidates ['todos', 1]. A predicate receives each normalized key. `hard`
 * empties the entries first (a request already in flight still refills
 * them). Resolves once the refetches have landed; never rejects.
 */
export function invalidateQueries(
  keyOrPredicate: QueryKey | ((key: string) => boolean),
  options?: { exact?: boolean; hard?: boolean },
): Promise<void>;

/**
 * The client side of a revalidated path: the entries read on `path` (a
 * route's preload data, and every query read while the page was at that
 * path) are invalidated, and the onRevalidate callbacks for it run. A server
 * action with `revalidate: [path]` calls it. Resolves once the refetches have
 * landed.
 */
export function invalidatePath(path: string): Promise<void>;

/** Call `callback` whenever invalidatePath(path) runs. Returns the unsubscribe. */
export function onRevalidate(path: string, callback: () => void): () => void;

/** Fetch `key` into the cache unless it holds a value fresher than `staleTime`, and resolve with it. Rejects with a failed fetch's error. */
export function prefetchQuery<T = any, K extends QueryKey = QueryKey>(
  key: K,
  fetcher: (key: K, ctx: { signal: AbortSignal }) => Promise<T> | T,
  options?: { staleTime?: number; retry?: number },
): Promise<T>;

/** Put `updater` (a value, or a function of the current value) in the cache now, for every reader of the key. */
export function setQueryData<T = any>(key: QueryKey, updater: T | ((prev: T | undefined) => T)): void;

/** `undefined` for a key with nothing cached; `null` for one emptied by a hard invalidation. */
export function getQueryData<T = any>(key: QueryKey): T | null | undefined;

/**
 * Empty the cache (logout): what is in flight is dropped, entries something
 * shows stay attached to their readers, empty (a mounted query() fetches
 * again), and the page's server data is not adopted again.
 */
export function clearCache(): void;
