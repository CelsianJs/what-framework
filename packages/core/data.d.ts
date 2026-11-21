// what-core/data (what-framework/data): the query, SWR and fetch hooks and their shared cache.

// --- Data Fetching ---

export function useFetch<T = any>(url: string, options?: Record<string, any>): {
  /** null until the first response lands. It was declared as bare `T`, so strict-mode callers skipped the check they need. */
  data: () => T | null;
  error: () => any;
  isLoading: () => boolean;
  refetch: () => Promise<void>;
  mutate: (newData: T) => void;
};

export function useSWR<T = any>(key: string | null | false, fetcher: (key: string, ctx?: { signal: AbortSignal }) => Promise<T>, options?: Record<string, any>): {
  data: () => T | null;
  error: () => any;
  isLoading: () => boolean;
  isValidating: () => boolean;
  mutate: (newData: T | ((prev: T | null) => T), shouldRevalidate?: boolean) => void;
  revalidate: () => Promise<T | void>;
};

/**
 * 'idle' is a real state, not a placeholder: a query with `enabled: false` and
 * nothing cached is idle, and reporting it as loading is what renders a spinner
 * that never comes down.
 */
export type QueryStatus = 'idle' | 'loading' | 'success' | 'error';
/** Whether a request is on the wire, independent of whether data exists. */
export type FetchStatus = 'idle' | 'fetching';

/**
 * Any array key is joined into a single normalized string, so an array and its
 * normalization address the same cache entry everywhere a key is accepted.
 */
export type QueryKey = string | readonly unknown[];

export function useQuery<T = any>(options: Record<string, any>): {
  data: () => T | null;
  error: () => any;
  status: () => QueryStatus;
  fetchStatus: () => FetchStatus;
  isLoading: () => boolean;
  isFetching: () => boolean;
  isError: () => boolean;
  isSuccess: () => boolean;
  isIdle: () => boolean;
  /** Whether the `enabled` gate is currently open. */
  isEnabled: () => boolean;
  refetch: () => Promise<T | void>;
};

/**
 * Pages, plus the param each was fetched with. `pageParams[i]` names `pages[i]`.
 */
export interface InfiniteData<T> {
  pages: T[];
  pageParams: unknown[];
}

/**
 * `data()` hands back the page CONTAINER, not a flat array. It was declared as
 * `T[]`, so `data().map(...)` type-checked and threw. The rows are in
 * `data().pages`. A `select` option replaces the container wholesale, and that
 * transformation is not expressible here.
 */
export function useInfiniteQuery<T = any>(options: Record<string, any>): {
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
  fetchNextPage: () => Promise<void>;
  fetchPreviousPage: () => Promise<void>;
  refetch: () => Promise<void>;
};

/**
 * Synchronous. It was declared as returning Promise<void>, so `await
 * invalidateQueries(...)` awaited undefined and read as "the refetches are
 * done" when they had only been kicked off. The subscribers it wakes fetch on
 * their own.
 *
 * An array key is a PREFIX unless `exact` is set: invalidateQueries(['todos'])
 * also invalidates ['todos', 1]. `hard` clears the cached value immediately
 * (loading state); the default keeps stale data on screen while it refetches.
 */
export function invalidateQueries(
  keyOrPredicate: QueryKey | ((key: string) => boolean),
  options?: { exact?: boolean; hard?: boolean },
): void;

export function prefetchQuery<T = any>(key: QueryKey, fetcher: (key: string) => Promise<T>): Promise<T>;
export function setQueryData<T = any>(key: QueryKey, updater: T | ((prev: T | null) => T)): void;
/** `undefined` for a key the cache has never held; `null` for one that was emptied. */
export function getQueryData<T = any>(key: QueryKey): T | null | undefined;
export function clearCache(): void;
