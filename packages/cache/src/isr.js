// ISR engine — origin-first Incremental Static Regeneration.
//
// Stale-while-revalidate at the ORIGIN: a fresh entry is served from cache; a
// stale entry (past `revalidate`, within `swr`) is served IMMEDIATELY while a
// single background regeneration refreshes it; a cold/expired entry blocks and
// renders. Concurrent regenerations of the same key are deduped to ONE render.
//
// `render(routeMatch, ctx)` is INJECTED by the adapter (wraps renderPage +
// serializeState) — the engine never imports what-server, keeping it standalone.

import { cacheKey, normalizePath } from './key.js';
import { makeEntry, isFresh, isServableStale } from './stores/store-interface.js';
import { buildCacheHeaders } from './headers.js';

export function createCacheEngine({ store, render, cdn, now = Date.now, logger = console } = {}) {
  const inFlight = new Map(); // key -> Promise<entry>  (dedupe)

  function keyFor(routeMatch) {
    return cacheKey({ path: routeMatch.path, query: routeMatch.query, vary: routeMatch.vary });
  }

  // Render + store, deduping concurrent calls for the same key. `renderOverride`
  // lets a caller (e.g. the deploy adapter) supply the render for this route
  // without baking it into the engine — keeps the engine decoupled.
  function regenerate(key, routeMatch, renderOverride) {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const doRender = renderOverride || render;
    const p = (async () => {
      const out = await doRender(routeMatch, {});
      const entry = makeEntry({ ...out, path: routeMatch.path }, routeMatch.config || {}, now());
      await store.set(key, entry);
      return entry;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }

  function serve(entry, cacheStatus, config) {
    return {
      html: entry.html,
      head: entry.head,
      state: entry.state,
      status: entry.status || 200,
      cacheStatus,
      headers: buildCacheHeaders(entry, config || {}, cacheStatus),
    };
  }

  async function handle(routeMatch, renderOverride) {
    const config = routeMatch.config || {};

    // Uncacheable (server-rendered) routes: always render, never store.
    if (config.mode === 'server') {
      const out = await (renderOverride || render)(routeMatch, {});
      const entry = makeEntry({ ...out, path: routeMatch.path }, config, now());
      return serve(entry, 'BYPASS', config);
    }

    const key = keyFor(routeMatch);
    const entry = await store.get(key);
    const t = now();

    if (entry && isFresh(entry, t)) {
      return serve(entry, 'HIT', config);
    }

    if (entry && isServableStale(entry, t)) {
      // Serve stale immediately; refresh in the background (deduped, non-blocking).
      regenerate(key, routeMatch, renderOverride).catch((e) => logger.error?.('[what-isr] background regenerate failed:', e));
      return serve(entry, 'STALE', config);
    }

    // Cold miss or expired beyond the swr window.
    if (entry && config.onMiss === 'stale-if-error') {
      try {
        const fresh = await regenerate(key, routeMatch, renderOverride);
        return serve(fresh, 'MISS', config);
      } catch (e) {
        logger.error?.('[what-isr] regenerate failed, serving stale:', e);
        return serve(entry, 'STALE', config);
      }
    }

    const fresh = await regenerate(key, routeMatch, renderOverride);
    return serve(fresh, 'MISS', config);
  }

  // --- On-demand invalidation (origin purge + optional CDN fan-out) ---

  async function revalidatePath(path, { regenerate: regen = false, routeResolver } = {}) {
    const norm = normalizePath(path);
    const deleted = await store.deleteByPath(norm);
    if (cdn && cdn.purge) await cdn.purge([path]);
    if (regen) {
      const route = routeResolver ? routeResolver(norm) : { path: norm, query: {}, config: {} };
      await regenerate(keyFor(route), route).catch((e) => logger.error?.('[what-isr] regen after revalidatePath failed:', e));
    }
    return deleted;
  }

  async function revalidateTag(tag, { regenerate: regen = false, routeResolver } = {}) {
    const deleted = await store.deleteByTag(tag);
    if (cdn && cdn.purgeTags) await cdn.purgeTags([tag]);
    if (regen && routeResolver) {
      for (const key of deleted) {
        const route = routeResolver(key);
        if (route) await regenerate(keyFor(route), route).catch(() => {});
      }
    }
    return deleted;
  }

  return {
    handle,
    regenerate: (routeMatch) => regenerate(keyFor(routeMatch), routeMatch),
    revalidatePath,
    revalidateTag,
    keyFor,
    store,
    _inFlight: inFlight,
    _now: now,
    _cdn: cdn,
  };
}
