// ISR engine — origin-first Incremental Static Regeneration.
//
// Stale-while-revalidate at the ORIGIN: a fresh entry is served from cache; a
// stale entry (past `revalidate`, within `swr`) is served IMMEDIATELY while a
// single background regeneration refreshes it; a cold/expired entry blocks and
// renders. Concurrent regenerations of the same key are deduped to ONE render.
//
// `render(routeMatch, ctx)` is INJECTED by the adapter (wraps renderPage +
// serializeState) — the engine never imports what-server, keeping it standalone.

import { cacheKey, normalizePath, resolveVary, declaredVary } from './key.js';
import { makeEntry, isFresh, isServableStale } from './stores/store-interface.js';
import { buildCacheHeaders } from './headers.js';
import { safeLocalPath } from './local-path.js';

export function createCacheEngine({ store, render, cdn, now = Date.now, logger = console } = {}) {
  const inFlight = new Map(); // key -> Promise<entry>  (dedupe)

  // A route may declare `vary` (['cookie:session']) in its page config; the
  // adapter supplies the request headers those names resolve against. Null means
  // the values are unavailable, so the render is per-user and must not be cached.
  function varyFor(routeMatch) {
    return resolveVary(declaredVary(routeMatch), routeMatch.varyHeaders || routeMatch.headers);
  }

  function keyFor(routeMatch) {
    const vary = varyFor(routeMatch);
    if (vary === null) {
      throw new Error('[what-isr] route declares `vary` but the adapter supplied no request headers; refusing to cache');
    }
    return cacheKey({ path: routeMatch.path, query: routeMatch.query, vary });
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
      // Only public 200 renders are cached. Storing a non-200 (soft-404, error
      // page) would serve it as a HIT until expiry (bad for correctness and
      // SEO), and storing a per-user render would serve one visitor's HTML to
      // everyone. The response is still returned to the caller with its real
      // status; any previously cached good entry is left in place.
      if (entry.status === 200 && !entry.private) {
        await store.set(key, entry);
      }
      return entry;
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }

  function serve(entry, cacheStatus, routeMatch) {
    return {
      html: entry.html,
      head: entry.head,
      state: entry.state,
      status: entry.status || 200,
      cacheStatus,
      headers: buildCacheHeaders(entry, routeMatch.config || {}, cacheStatus, declaredVary(routeMatch)),
    };
  }

  async function handle(routeMatch, renderOverride) {
    const config = routeMatch.config || {};
    const vary = varyFor(routeMatch);

    // Uncacheable routes: server-rendered, or a `vary` declaration the adapter
    // left unresolved (caching it would publish one user's HTML to everyone).
    // Always render, never store.
    if (config.mode === 'server' || vary === null) {
      if (vary === null) {
        logger.warn?.(`[what-isr] ${routeMatch.path} declares \`vary\` but no request headers were supplied; bypassing the cache`);
      }
      const out = await (renderOverride || render)(routeMatch, {});
      const entry = makeEntry({ ...out, path: routeMatch.path, private: vary === null || out.private }, config, now());
      return serve(entry, 'BYPASS', routeMatch);
    }

    const key = cacheKey({ path: routeMatch.path, query: routeMatch.query, vary });
    const entry = await store.get(key);
    const t = now();

    if (entry && isFresh(entry, t)) {
      return serve(entry, 'HIT', routeMatch);
    }

    if (entry && isServableStale(entry, t)) {
      // Serve stale immediately; refresh in the background (deduped, non-blocking).
      regenerate(key, routeMatch, renderOverride).catch((e) => logger.error?.('[what-isr] background regenerate failed:', e));
      return serve(entry, 'STALE', routeMatch);
    }

    // Cold miss or expired beyond the swr window.
    if (entry && config.onMiss === 'stale-if-error') {
      try {
        const fresh = await regenerate(key, routeMatch, renderOverride);
        return serve(fresh, 'MISS', routeMatch);
      } catch (e) {
        logger.error?.('[what-isr] regenerate failed, serving stale:', e);
        return serve(entry, 'STALE', routeMatch);
      }
    }

    const fresh = await regenerate(key, routeMatch, renderOverride);
    return serve(fresh, 'MISS', routeMatch);
  }

  // --- On-demand invalidation (origin purge + optional CDN fan-out) ---

  async function revalidatePath(path, { regenerate: regen = false, routeResolver } = {}) {
    // Never let a caller-supplied target reach the CDN adapter: a purge carries
    // the CDN API token, so an absolute URL would exfiltrate it (SSRF).
    const local = safeLocalPath(typeof path === 'string' ? path : '');
    if (local === null) {
      logger.warn?.(`[what-isr] refusing to revalidate a non-local path: ${path}`);
      return [];
    }
    const norm = normalizePath(local);
    const deleted = await store.deleteByPath(norm);
    if (cdn && cdn.purge) await cdn.purge([local]);
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
