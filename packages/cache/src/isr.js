// ISR engine — origin-first Incremental Static Regeneration.
//
// Stale-while-revalidate at the ORIGIN: a fresh entry is served from cache; a
// stale entry (past `revalidate`, within `swr`) is served IMMEDIATELY while a
// single background regeneration refreshes it; a cold/expired entry blocks and
// renders.
//
// What is stored and shared. Only a public 200 render is stored, and only a
// public 200 result is shared with the requests that waited on the same
// regeneration. Anything else (a private render, a redirect, any other status)
// was made for the request that triggered it: that request gets it with all of
// its own headers (its cookies, its Location), and every other waiting request
// renders for itself. What makes a render private, and which of its headers an
// entry keeps and replays, is decided in headers.js.
//
// A regeneration is shared work, so it is not tied to the request that started
// it. render() receives `ctx.signal`, which aborts only when every request
// waiting on that regeneration has gone (and never for a background refresh);
// a request that goes away stops waiting at once, with its own abort reason.
// A request's signal is `routeMatch.signal`.
//
// `render(routeMatch, ctx)` is INJECTED by the adapter (wraps renderPage +
// serializeState) — the engine never imports what-server, keeping it standalone.
//
// Origins. An entry a request rendered is keyed on that request's origin: a
// Host one sender chose never reaches another host's visitors. A regeneration
// with no request (a scheduler's engine.regenerate(route), revalidatePath and
// revalidateTag with `regenerate`) refreshes what visitors read: the entry of
// every origin stored for the path, each rendered from a GET request the
// engine makes at that origin. When none is stored, it renders the path's
// default entry, keyed without an origin, from a request at the engine's
// `origin` (else http://localhost); a request whose origin has no entry of
// its own is served the default entry. No visitor's request makes a default
// entry, so no sender's Host can reach another host through one.

import { cacheKey, canonicalMatch, keyOrigin, keyTarget, normalizePath, normalizeQuery, resolveVary, declaredVary } from './key.js';
import { makeEntry, isFresh, isServableStale } from './stores/store-interface.js';
import { buildCacheHeaders, responseHeaderList, servedHeaders } from './headers.js';
import { safeLocalPath } from './local-path.js';

function isShareable(entry) {
  return entry.status === 200 && !entry.private;
}

function abortError(signal) {
  return signal.reason ?? Object.assign(new Error('The request was aborted.'), { name: 'AbortError' });
}

// The origin of the request a route match answers: the scheme and host its
// render sees in `request.url`, which the adapter took from a validated Host.
function originOf(routeMatch) {
  const request = routeMatch.request;
  if (request == null || typeof request.url !== 'string') return '';
  try {
    return new URL(request.url).origin;
  } catch {
    return '';
  }
}

// The most origins one regeneration with no request renders (storedOrigins).
const MAX_ORIGINS = 16;

// `routeMatch` with the GET request a regeneration with no request renders
// it from: its path and query at `origin`.
function requestAt(routeMatch, origin) {
  const url = new URL(normalizePath(routeMatch.path), origin);
  const query = normalizeQuery(routeMatch.query);
  if (query) url.search = query;
  return { ...routeMatch, request: new Request(url) };
}

/**
 * @param {object} [options]
 * @param {any} [options.store] cache store (see stores/store-interface.js)
 * @param {(routeMatch: any, ctx?: any) => any} [options.render] injected by the adapter
 * @param {any} [options.cdn] optional CDN adapter for edge fan-out
 * @param {() => number} [options.now]
 * @param {any} [options.logger]
 * @param {string} [options.origin] the public origin a default entry is rendered at
 */
export function createCacheEngine({ store, render, cdn, now = Date.now, logger = console, origin: publicOrigin } = {}) {
  const defaultOrigin = publicOrigin ? new URL(publicOrigin).origin : 'http://localhost';
  // key -> { promise: Promise<{ entry, headers }>, waiters, pinned, controller }
  const inFlight = new Map();

  // A route may declare `vary` (['cookie:session']) in its page config; the
  // adapter supplies the request headers those names resolve against. Null means
  // the values are unavailable, so the render is per-user and must not be cached.
  function varyFor(routeMatch) {
    return resolveVary(declaredVary(routeMatch), routeMatch.varyHeaders || routeMatch.headers);
  }

  function keyFor(routeMatch) {
    const vary = varyFor(routeMatch);
    if (vary === null) {
      // ERROR_CODES.ISR_VARY_NO_HEADERS
      throw Object.assign(
        new Error('[what-isr] route declares `vary` but the adapter supplied no request headers; refusing to cache'),
        { code: 'ERR_ISR_VARY_NO_HEADERS' },
      );
    }
    return cacheKey({ origin: originOf(routeMatch), path: routeMatch.path, query: routeMatch.query, vary });
  }

  // The path's default entry: keyed without an origin.
  function defaultKeyFor(routeMatch) {
    return keyFor({ ...routeMatch, request: undefined });
  }

  // A regeneration with no request, of `routeMatch`, for each origin in
  // `origins` ('' for the default entry): each rendered from a request the
  // engine makes. Resolves with the first one's entry.
  async function regenerateAt(routeMatch, origins) {
    const results = await Promise.all([...origins].map((origin) => {
      const match = requestAt(routeMatch, origin || defaultOrigin);
      return regenerate(origin ? keyFor(match) : defaultKeyFor(routeMatch), match, undefined, { background: true });
    }));
    return results.length ? results[0].entry : null;
  }

  // The origins whose entry for `routeMatch`'s path and query is stored: ''
  // for the default entry. The default entry when there are none. At most
  // MAX_ORIGINS, the last the store lists (a memory store lists the most
  // recently used last): a sender can make the engine store an entry for any
  // host it names, and a scheduled tick must not render each of them.
  async function storedOrigins(routeMatch) {
    const path = normalizePath(routeMatch.path);
    const query = normalizeQuery(routeMatch.query);
    const origins = new Set();
    for (const key of await store.keys()) {
      const target = keyTarget(key);
      if (target.path !== path || target.query !== query) continue;
      const origin = keyOrigin(key);
      origins.delete(origin);
      origins.add(origin);
    }
    return origins.size ? new Set([...origins].slice(-MAX_ORIGINS)) : new Set(['']);
  }

  // Render + store. `renderOverride` lets a caller (e.g. the deploy adapter)
  // supply the render for this route
  // without baking it into the engine — keeps the engine decoupled. Resolves
  // with the entry and the render's full header list.
  async function renderEntry(key, routeMatch, renderOverride, signal) {
    const doRender = renderOverride || render;
    const out = await doRender(canonicalMatch(routeMatch), { signal });
    const entry = makeEntry({ ...out, path: routeMatch.path }, routeMatch.config || {}, now());
    // Only public 200 renders are cached. Storing a non-200 (soft-404, error
    // page) would serve it as a HIT until expiry (bad for correctness and
    // SEO), and storing a per-user render would serve one visitor's HTML to
    // everyone. The response is still returned to the caller with its real
    // status; any previously cached good entry is left in place.
    if (isShareable(entry)) {
      await store.set(key, entry);
    }
    return { entry, headers: responseHeaderList(out.headers) };
  }

  // Wait for a regeneration on behalf of the request whose signal is
  // `signal`. Leaving early rejects at once; the last waiter leaving aborts
  // the render, unless something that cannot leave (a background refresh, a
  // caller with no signal) is waiting on it too: that pins it.
  function wait(flight, signal) {
    if (!signal) {
      flight.pinned = true;
      return flight.promise;
    }
    if (signal.aborted) return Promise.reject(abortError(signal));
    flight.waiters++;
    return new Promise((resolve, reject) => {
      let waiting = true;
      const stop = () => {
        if (!waiting) return false;
        waiting = false;
        flight.waiters--;
        signal.removeEventListener('abort', leave);
        return true;
      };
      const leave = () => {
        if (!stop()) return;
        if (flight.waiters === 0 && !flight.pinned) flight.controller.abort(abortError(signal));
        reject(abortError(signal));
      };
      signal.addEventListener('abort', leave, { once: true });
      flight.promise.then(
        (result) => { if (stop()) resolve(result); },
        (error) => { if (stop()) reject(error); },
      );
    });
  }

  // The result for one request: `{ entry, headers }`, where `headers` is the
  // render's full list when the render was this request's own, and null when
  // the request receives a shared public result.
  async function regenerate(key, routeMatch, renderOverride, { background = false } = {}) {
    const signal = background ? null : routeMatch.signal || null;
    const existing = inFlight.get(key);
    if (existing) {
      // Whether a result can be shared is known only after rendering. A
      // follower reuses a public 200, and renders anything else with its own
      // request and override. These rerenders do not own the shared slot.
      const result = await wait(existing, signal);
      if (isShareable(result.entry)) return { entry: result.entry, headers: null };
      return renderEntry(key, routeMatch, renderOverride, signal || undefined);
    }
    const controller = new AbortController();
    const flight = { promise: /** @type {Promise<any>} */ (/** @type {unknown} */ (null)), waiters: 0, pinned: false, controller };
    flight.promise = renderEntry(key, routeMatch, renderOverride, controller.signal).finally(() => {
      if (inFlight.get(key) === flight) inFlight.delete(key);
    });
    flight.promise.catch(() => {});
    inFlight.set(key, flight);
    return wait(flight, signal);
  }

  /** @param {Array<[string, string]> | null} [headerList] */
  function serve(entry, cacheStatus, routeMatch, headerList = null) {
    return {
      html: entry.html,
      head: entry.head,
      state: entry.state,
      status: entry.status || 200,
      cacheStatus,
      headers: servedHeaders(entry, headerList,
        buildCacheHeaders(entry, routeMatch.config || {}, cacheStatus, declaredVary(routeMatch))),
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
        // ERROR_CODES.ISR_VARY_NO_HEADERS
        logger.warn?.(`ERR_ISR_VARY_NO_HEADERS [what-isr] route declares \`vary\` but the adapter supplied no request headers; refusing to cache. (${routeMatch.path})`);
      }
      const out = await (renderOverride || render)(routeMatch, { signal: routeMatch.signal });
      const entry = makeEntry({ ...out, path: routeMatch.path, private: vary === null || out.private }, config, now());
      return serve(entry, 'BYPASS', routeMatch, responseHeaderList(out.headers));
    }

    const own = cacheKey({ origin: originOf(routeMatch), path: routeMatch.path, query: routeMatch.query, vary });
    let key = own;
    let entry = await store.get(own);
    // No entry of its own origin: the path's default entry, which a stale
    // one refreshes as it was made, from no visitor's request.
    let refresh = routeMatch;
    if (!entry && key !== defaultKeyFor(routeMatch)) {
      const shared = await store.get(defaultKeyFor(routeMatch));
      if (shared) {
        key = defaultKeyFor(routeMatch);
        entry = shared;
        refresh = requestAt(routeMatch, defaultOrigin);
      }
    }
    const t = now();

    if (entry && isFresh(entry, t)) {
      return serve(entry, 'HIT', routeMatch);
    }

    if (entry && isServableStale(entry, t)) {
      // Serve stale immediately; refresh in the background (deduped, non-blocking).
      regenerate(key, refresh, refresh === routeMatch ? renderOverride : undefined, { background: true })
        .catch((e) => logger.error?.('[what-isr] background regenerate failed:', e));
      return serve(entry, 'STALE', routeMatch);
    }
    key = own;

    // Cold miss or expired beyond the swr window.
    if (entry && config.onMiss === 'stale-if-error') {
      try {
        const fresh = await regenerate(key, routeMatch, renderOverride);
        return serve(fresh.entry, 'MISS', routeMatch, fresh.headers);
      } catch (e) {
        if (routeMatch.signal && routeMatch.signal.aborted) throw e;
        logger.error?.('[what-isr] regenerate failed, serving stale:', e);
        return serve(entry, 'STALE', routeMatch);
      }
    }

    const fresh = await regenerate(key, routeMatch, renderOverride);
    return serve(fresh.entry, 'MISS', routeMatch, fresh.headers);
  }

  // --- On-demand invalidation (origin purge + optional CDN fan-out) ---

  /**
   * @param {string} path
   * @param {{ regenerate?: boolean, routeResolver?: (path: string) => any }} [options]
   */
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
      // The origins it held, or the default entry. keyFor() can throw (a
      // route declaring `vary` with no headers), so it has to run inside the
      // try: as an argument expression the .catch() never attached and the
      // rejection escaped revalidatePath.
      try {
        if (originOf(route)) await regenerate(keyFor(route), route, undefined, { background: true });
        else await regenerateAt(route, deleted.length ? new Set(deleted.map(keyOrigin).slice(-MAX_ORIGINS)) : new Set(['']));
      } catch (e) {
        logger.error?.('[what-isr] regen after revalidatePath failed:', e);
      }
    }
    return deleted;
  }

  /**
   * @param {string} tag
   * @param {{ regenerate?: boolean, routeResolver?: (key: string) => any }} [options]
   */
  async function revalidateTag(tag, { regenerate: regen = false, routeResolver } = {}) {
    const deleted = await store.deleteByTag(tag);
    if (cdn && cdn.purgeTags) await cdn.purgeTags([tag]);
    if (regen && routeResolver) {
      for (const key of deleted) {
        const route = routeResolver(key);
        if (!route) continue;
        try {
          if (originOf(route)) await regenerate(keyFor(route), route, undefined, { background: true });
          else await regenerateAt(route, [keyOrigin(key)]);
        } catch { /* best effort: a purge must not fail because a regen did */ }
      }
    }
    return deleted;
  }

  return {
    handle,
    // A route with a request regenerates that request's entry; one with none
    // (a scheduler's) every origin's stored for it, else the default entry.
    regenerate: async (routeMatch) => (originOf(routeMatch)
      ? (await regenerate(keyFor(routeMatch), routeMatch, undefined, { background: true })).entry
      : regenerateAt(routeMatch, await storedOrigins(routeMatch))),
    revalidatePath,
    revalidateTag,
    keyFor,
    store,
    _inFlight: inFlight,
    _now: now,
    _cdn: cdn,
  };
}
