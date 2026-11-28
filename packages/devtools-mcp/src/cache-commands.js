// The page side of what_cache and what_invalidate_cache: the query cache as
// what-core exposes it to tools (what-core/internal).

/**
 * The page side of what_cache: every entry of the query cache (what-core's
 * __getCacheSnapshot), its value previewed.
 */
export function cacheSnapshot(core, devtools) {
  if (typeof core.__getCacheSnapshot !== 'function') return { entries: [] };
  const entries = core.__getCacheSnapshot().map((e) => ({
    ...e,
    data: devtools ? devtools.preview(e.data, 400) : undefined,
  }));
  return { entries };
}

/**
 * The page side of what_invalidate_cache: invalidate the entries `key` names
 * (a normalized key, or a JSON array key, which is a prefix), every entry when
 * it is omitted. Returns the keys that matched.
 */
export function invalidateCache(core, key) {
  if (typeof core.__invalidateFromDevtools !== 'function') return { error: 'The page has no query cache (what-framework/data is not loaded).' };
  let target = key;
  if (typeof key === 'string' && key.trim().startsWith('[')) {
    try { target = JSON.parse(key); } catch { /* a key that only looks like JSON */ }
  }
  return { invalidated: core.__invalidateFromDevtools(target) };
}
