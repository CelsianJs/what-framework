// what-framework/data (what-core/data): one query cache on async values, the
// signal-native query() that reads it, the React-ecosystem hooks over it, and
// the cache operations (docs/DATA.md).
export {
  query,
  useFetch,
  useSWR,
  useQuery,
  useInfiniteQuery,
  invalidateQueries,
  invalidatePath,
  onRevalidate,
  prefetchQuery,
  setQueryData,
  getQueryData,
  clearCache,
} from '../data.js';
