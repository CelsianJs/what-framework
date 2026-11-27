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
//
// A sender can make the engine store an entry for any host it names, so the
// origins a regeneration renders are chosen: the ones a request read most
// recently first, then the ones only stored, at most MAX_ORIGINS. An app that
// names its public origins (`origins`) gets exactly those: a request for any
// other host is rendered for it alone (not stored, not served from the
// store), and a regeneration renders each named origin's entry.

import { cacheKey, canonicalMatch, keyOrigin, keyTarget, normalizePath, normalizeQuery, resolveVary, declaredVary } from './key.js';
import { makeEntry, isFresh, isServableStale } from './stores/store-interface.js';
import { buildCacheHeaders, responseHeaderList, servedHeaders } from './headers.js';
import { basePathOf, safeLocalPath } from './local-path.js';

function isShareable(entry) {
  return entry.status === 200 && !entry.private;
}

function abortError(signal) {
  return signal.reason ?? Object.assign(new Error('The request was aborted.'), { name: 'AbortError' });
}

// The origin of the request a route match answers: the scheme and host its
// render sees in `request.url`, which the adapter took from a validated Host
// and, for the scheme, what a proxy in front reports in X-Forwarded-Proto
// (what-server's request-url.js requestScheme, the rule its CSRF check uses).
function originOf(routeMatch) {
  const request = routeMatch.request;
  if (request == null || typeof request.url !== 'string') return '';
  try {
    return new URL(request.url).origin;
  } catch {
    return '';
  }
}

// `value`, an option holding a public origin, as one: an http or https URL's
// scheme and host.
function originNamed(value, option) {
  /** @type {URL | null} */
  let url = null;
  try {
    url = new URL(String(value));
  } catch { /* not a URL */ }
  if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:') || !url.host) {
    throw new TypeError(`[what-isr] createCacheEngine: ${JSON.stringify(value)} in \`${option}\` is not an origin: give its scheme and host, as in "https://shop.example".`);
  }
  return url.origin;
}

// The most origins one regeneration with no request renders (storedOrigins).
const MAX_ORIGINS = 16;
// What the engine remembers of the paths it serves (`known`): at most this
// many paths, each with at most this many origins.
const MAX_KNOWN_TARGETS = 1024;
const MAX_KNOWN_ORIGINS = 4 * MAX_ORIGINS;

// `routeMatch` with the GET request a regeneration with no request renders
// it from: its path and query at `origin`, the path below the base path the
// app is served below (`routeMatch.base`, as a request for it was, else
// `base`, the engine's).
function requestAt(routeMatch, origin, base) {
  const below = routeMatch.base || base;
  const url = new URL(below + normalizePath(routeMatch.path), origin);
  const query = normalizeQuery(routeMatch.query);
  if (query) url.search = query;
  // The match carries the base, as a request handler's does: the page
  // renders and redirects below it.
  return below ? { ...routeMatch, base: below, request: new Request(url) } : { ...routeMatch, request: new Request(url) };
}

/**
 * @param {object} [options]
 * @param {any} [options.store] cache store (see stores/store-interface.js)
 * @param {(routeMatch: any, ctx?: any) => any} [options.render] injected by the adapter
 * @param {any} [options.cdn] optional CDN adapter for edge fan-out
 * @param {() => number} [options.now]
 * @param {any} [options.logger]
 * @param {string} [options.origin] the public origin a default entry is rendered at
 * @param {string[]} [options.origins] the public origins the site serves: only their entries are stored
 * @param {string} [options.basePath] the path the site is served below, as the request handler's `basePath`
 */
export function createCacheEngine({ store, render, cdn, now = Date.now, logger = console, origin: publicOrigin, origins: publicOrigins, basePath } = {}) {
  // The path the site is served below ('/app'), or '': a CDN caches each page
  // below it, so a purge names the URL there, and a regeneration with no
  // request renders below it. The `basePath` option, else the one the request
  // handler the engine serves gives it (_setBasePath).
  let base = basePathOf(basePath);
  const defaultOrigin = publicOrigin ? originNamed(publicOrigin, 'origin') : 'http://localhost';
  if (publicOrigins !== undefined && (!Array.isArray(publicOrigins) || publicOrigins.length === 0)) {
    throw new TypeError(`[what-isr] createCacheEngine: \`origins\` is ${JSON.stringify(publicOrigins)}: list the public origins the site serves (['https://shop.example']), or leave it out to cache a page for any Host a request names.`);
  }
  /** @type {Set<string> | null} */
  const served = publicOrigins !== undefined ? new Set(publicOrigins.map((o) => originNamed(o, 'origins'))) : null;
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
      const match = requestAt(routeMatch, origin || defaultOrigin, base);
      return regenerate(origin ? keyFor(match) : defaultKeyFor(routeMatch), match, undefined, { background: true });
    }));
    return results.length ? results[0].entry : null;
  }

  // What the engine knows of each path and query (targetOf) it served or
  // stored: the origins with an entry ('' the default entry), each with when
  // a request last read it (0: stored, not read since), and the last route
  // match rendered for it, which a revalidation with no routeResolver renders
  // again. Seeded from the store's keys once per target, so a scheduled tick
  // does not list the store every time (a Redis store SCANs it).
  /** @type {Map<string, { origins: Map<string, number>, match: any, seeded: boolean }>} */
  const known = new Map();
  const targetOf = (routeMatch) => `${normalizePath(routeMatch.path)}?${normalizeQuery(routeMatch.query)}`;
  function knownFor(target) {
    let k = known.get(target);
    if (k === undefined) {
      if (known.size >= MAX_KNOWN_TARGETS) known.delete(/** @type {string} */ (known.keys().next().value));
      k = { origins: new Map(), match: null, seeded: false };
    } else {
      known.delete(target);
    }
    known.set(target, k);
    return k;
  }
  // An entry of `origin` for `routeMatch` was stored (`read` 0) or read by a
  // request (`read`, its time).
  function note(routeMatch, origin, read) {
    const k = knownFor(targetOf(routeMatch));
    const last = k.origins.get(origin);
    k.origins.delete(origin);
    k.origins.set(origin, Math.max(read, last ?? 0));
    if (k.origins.size > MAX_KNOWN_ORIGINS) {
      let oldest = '';
      let oldestAt = Infinity;
      for (const [o, t] of k.origins) {
        if (t < oldestAt) {
          oldest = o;
          oldestAt = t;
        }
      }
      k.origins.delete(oldest);
    }
    k.match = { ...routeMatch, request: undefined, signal: undefined, varyHeaders: undefined };
  }

  // The origins a regeneration with no request renders for `routeMatch`:
  // every named origin; else those with an entry, the ones a request read
  // most recently first, then the ones stored most recently, at most
  // MAX_ORIGINS; else the default entry ('').
  async function storedOrigins(routeMatch) {
    if (served !== null) return served;
    const target = targetOf(routeMatch);
    const k = knownFor(target);
    if (!k.seeded) {
      k.seeded = true;
      for (const key of await store.keys()) {
        const { path, query } = keyTarget(key);
        const origin = keyOrigin(key);
        if (`${path}?${query}` === target && !k.origins.has(origin)) k.origins.set(origin, 0);
      }
    }
    const ordered = [...k.origins].reverse().sort((a, b) => b[1] - a[1]).slice(0, MAX_ORIGINS);
    return ordered.length ? new Set(ordered.map(([origin]) => origin)) : new Set(['']);
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
      note(routeMatch, keyOrigin(key), 0);
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
    // left unresolved (caching it would publish one user's HTML to everyone),
    // a request for an origin the site does not name, and a request that is
    // not a GET (or a HEAD): a POST's render is that post's, whatever its
    // body holds. Always render, never store; the last three are the
    // request's own (private, no-store).
    const origin = originOf(routeMatch);
    const method = routeMatch.request != null ? routeMatch.request.method : 'GET';
    const own = (served !== null && origin !== '' && !served.has(origin)) || (method !== 'GET' && method !== 'HEAD');
    if (config.mode === 'server' || vary === null || own) {
      if (vary === null) {
        // ERROR_CODES.ISR_VARY_NO_HEADERS
        logger.warn?.(`ERR_ISR_VARY_NO_HEADERS [what-isr] route declares \`vary\` but the adapter supplied no request headers; refusing to cache. (${routeMatch.path})`);
      }
      const out = await (renderOverride || render)(routeMatch, { signal: routeMatch.signal });
      const entry = makeEntry({ ...out, path: routeMatch.path, private: vary === null || own || out.private }, config, now());
      return serve(entry, 'BYPASS', routeMatch, responseHeaderList(out.headers));
    }

    const ownKey = cacheKey({ origin, path: routeMatch.path, query: routeMatch.query, vary });
    let key = ownKey;
    let entry = await store.get(ownKey);
    // No entry of its own origin: the path's default entry, which a stale
    // one refreshes as it was made, from no visitor's request. A site that
    // names its origins has none.
    let refresh = routeMatch;
    if (!entry && served === null && key !== defaultKeyFor(routeMatch)) {
      const shared = await store.get(defaultKeyFor(routeMatch));
      if (shared) {
        key = defaultKeyFor(routeMatch);
        entry = shared;
        refresh = requestAt(routeMatch, defaultOrigin, base);
      }
    }
    const t = now();
    if (entry) note(routeMatch, keyOrigin(key), t);

    if (entry && isFresh(entry, t)) {
      return serve(entry, 'HIT', routeMatch);
    }

    if (entry && isServableStale(entry, t)) {
      // Serve stale immediately; refresh in the background (deduped, non-blocking).
      regenerate(key, refresh, refresh === routeMatch ? renderOverride : undefined, { background: true })
        .catch((e) => logger.error?.('[what-isr] background regenerate failed:', e));
      return serve(entry, 'STALE', routeMatch);
    }
    key = ownKey;

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
    if (isShareable(fresh.entry)) note(routeMatch, origin, t);
    return serve(fresh.entry, 'MISS', routeMatch, fresh.headers);
  }

  // The route a regeneration with no request renders for the stored key or
  // path `target`: the caller's routeResolver's, else the last one the engine
  // rendered for it, else none.
  function routeFor(target, routeResolver, { path, query }) {
    if (routeResolver) return routeResolver(target);
    const k = known.get(`${path}?${query}`);
    return k !== undefined && k.match !== null ? k.match : null;
  }

  // Forget the entries a purge deleted.
  function forget(keys) {
    for (const key of keys) {
      const { path, query } = keyTarget(key);
      known.get(`${path}?${query}`)?.origins.delete(keyOrigin(key));
    }
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
    forget(deleted);
    // The CDN caches the page at its URL below the base.
    if (cdn && cdn.purge) await cdn.purge([base + local]);
    if (regen) {
      const route = routeFor(norm, routeResolver, { path: norm, query: '' });
      if (route === null) {
        // Nothing says how to render it: its entries are gone, and the next
        // request for it renders them.
        logger.warn?.(`[what-isr] revalidatePath(${JSON.stringify(norm)}, { regenerate: true }): no route to render it from (pass routeResolver); its entries were purged and the next request renders it.`);
        return deleted;
      }
      // The origins it held (the named ones on a site that names them), or
      // the default entry. keyFor() can throw (a route declaring `vary` with
      // no headers), so it has to run inside the try: as an argument
      // expression the .catch() never attached and the rejection escaped
      // revalidatePath.
      try {
        if (originOf(route)) await regenerate(keyFor(route), route, undefined, { background: true });
        else await regenerateAt(route, served ?? (deleted.length ? new Set(deleted.map(keyOrigin).slice(-MAX_ORIGINS)) : new Set([''])));
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
    forget(deleted);
    if (cdn && cdn.purgeTags) await cdn.purgeTags([tag]);
    if (regen) {
      for (const key of deleted) {
        const route = routeFor(key, routeResolver, keyTarget(key));
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
    /**
     * The request handler's `basePath`, which the engine serves below unless
     * it was given a `basePath` of its own.
     * @internal
     * @param {string} handlerBase
     */
    _setBasePath(handlerBase) {
      if (basePath === undefined) base = basePathOf(handlerBase);
    },
  };
}
