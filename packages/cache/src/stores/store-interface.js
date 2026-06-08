// CacheStore contract (JSDoc only — JS source, .d.ts ships types) + helpers.
//
// A store maps a cache key -> Entry. All methods are async so memory, filesystem
// and Redis adapters share one interface (memory just resolves synchronously).
//
// @typedef {Object} Entry
// @property {string} html        Rendered body HTML.
// @property {string} [head]      Collected <head> HTML.
// @property {*} [state]          Serialized hydration state (loaderData/resources).
// @property {string[]} [tags]    Tags for group invalidation (revalidateTag).
// @property {string} [path]      Normalized path (for revalidatePath).
// @property {number} renderedAt  ms epoch when rendered.
// @property {number} maxAge      Revalidate seconds (0 = never time-stale).
// @property {number} expiresAt   renderedAt + maxAge*1000 (precomputed).
// @property {number} swrWindow   Grace seconds an expired entry is still served.
// @property {number} [status]    HTTP status (for 404 stubs / fallback skeletons).
// @property {boolean} [partial]  True for fallback skeletons (never durable).
//
// @typedef {Object} CacheStore
// @property {(key:string)=>Promise<Entry|null>} get
// @property {(key:string, entry:Entry)=>Promise<void>} set
// @property {(key:string)=>Promise<boolean>} delete
// @property {(tag:string)=>Promise<string[]>} deleteByTag   returns deleted keys
// @property {(path:string)=>Promise<string[]>} deleteByPath returns deleted keys
// @property {()=>Promise<void>} clear
// @property {()=>Promise<string[]>} keys

/**
 * Fill an Entry's time fields from `now` + a route config. Used by the ISR
 * engine so every store receives consistent expiry metadata.
 */
export function makeEntry(out, config = {}, now = Date.now()) {
  const maxAge = Number(config.revalidate) || 0;
  const swrWindow = config.swr != null ? Number(config.swr) : maxAge;
  return {
    html: out.html || '',
    head: out.head || '',
    state: out.state ?? null,
    tags: out.tags || config.tags || [],
    path: out.path || config.path,
    status: out.status || 200,
    partial: !!out.partial,
    renderedAt: now,
    maxAge,
    swrWindow,
    expiresAt: maxAge > 0 ? now + maxAge * 1000 : Infinity,
  };
}

/** Freshness check against a clock. */
export function isFresh(entry, now = Date.now()) {
  return entry.expiresAt === Infinity || now < entry.expiresAt;
}

/** Within the stale-while-revalidate grace window (servable while regenerating). */
export function isServableStale(entry, now = Date.now()) {
  if (isFresh(entry, now)) return true;
  if (entry.swrWindow == null) return false;
  return now < entry.expiresAt + entry.swrWindow * 1000;
}
