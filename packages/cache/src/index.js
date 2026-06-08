// what-cache — origin-first ISR engine for What Framework.
//
// Works on ANY host with no CDN: the origin store does stale-while-revalidate,
// on-demand purge (revalidatePath/revalidateTag), and poll regeneration. With a
// CDN, Cache-Control headers + the CDN adapters add edge ISR + edge purge as a
// pure bonus — no infra lock-in.

export { createCacheEngine } from './isr.js';

// Stores
export { createMemoryStore } from './stores/memory-store.js';
export { createFilesystemStore } from './stores/filesystem-store.js';
export { createRedisStore } from './stores/redis-store.js';
export { makeEntry, isFresh, isServableStale } from './stores/store-interface.js';

// Keying + headers
export { cacheKey, normalizePath, normalizeQuery, hashKey } from './key.js';
export { buildCacheHeaders } from './headers.js';

// Dynamic paths (getStaticPaths)
export { resolveStaticPaths, buildPath, decideFallback, isKnownParams } from './paths.js';

// On-demand invalidation webhook + poll scheduler
export { createRevalidateWebhook } from './webhook.js';
export { createScheduler } from './scheduler.js';

// CDN adapters (optional)
export { createCloudflareCDN, createFastlyCDN, createVercelCDN } from './cdn/index.js';
