// Cache-Control header builder. Origin ISR works without these, but emitting
// them lets ANY standards-compliant CDN do edge ISR for free (s-maxage +
// stale-while-revalidate), and Cache-Tag/Surrogate-Key enable CDN tag purge.

import { normalizeVaryDeclaration } from './key.js';

// --- A render's own response headers ---
//
// A render may set response headers (what-server's response API: a loader's
// `response`, a component's getResponse()). How they meet the cache:
//
//   - Some of them say the page is one visitor's: a Set-Cookie, a
//     Cache-Control with private, no-store or no-cache, or a Vary (the origin
//     cache keys only on the route's declared `vary`). Such a render is
//     private: never stored, never shared with a request waiting on the same
//     regeneration, and sent to its own requester only, with its own headers.
//   - The rest describe the page itself (Content-Language, Link, an app's
//     X-* header). They are stored with the entry and sent on every HIT and
//     STALE, as they were on the MISS that stored it.
//   - The engine owns Cache-Control, Vary, X-What-Cache, Cache-Tag and
//     Surrogate-Key; Set-Cookie is never stored or replayed; framing and
//     hop-by-hop headers are the server's own business.

const ENGINE_HEADERS = new Set(['cache-control', 'vary', 'x-what-cache', 'cache-tag', 'surrogate-key']);
const UNSTORED_HEADERS = new Set([
  'set-cookie', 'content-length', 'content-encoding', 'transfer-encoding', 'connection', 'keep-alive',
  'proxy-connection', 'upgrade', 'te', 'trailer', 'date', 'age', 'etag', 'last-modified', 'expires', 'location',
]);
const PRIVATE_CACHE_CONTROL = /(?:^|[\s,])(?:private|no-store|no-cache)(?:$|[\s,=])/i;

/**
 * A render's response headers as [name, value] pairs, names lowercased and each
 * Set-Cookie on its own. Accepts a Headers object or a plain object whose
 * `set-cookie` may be an array.
 * @returns {Array<[string, string]>}
 */
export function responseHeaderList(headers) {
  /** @type {Array<[string, string]>} */
  const out = [];
  if (!headers) return out;
  if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
    if (typeof headers.getSetCookie === 'function') for (const cookie of headers.getSetCookie()) out.push(['set-cookie', cookie]);
    headers.forEach((value, name) => {
      const lower = name.toLowerCase();
      if (lower !== 'set-cookie' || typeof headers.getSetCookie !== 'function') out.push([lower, String(value)]);
    });
    return out;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (value == null) continue;
    const lower = name.toLowerCase();
    for (const item of lower === 'set-cookie' ? [].concat(value) : [value]) out.push([lower, String(item)]);
  }
  return out;
}

/** Whether a render's headers make it one visitor's page (see above). */
export function isPrivateResponse(list) {
  for (const [name, value] of list) {
    if (name === 'set-cookie' || name === 'vary') return true;
    if (name === 'cache-control' && PRIVATE_CACHE_CONTROL.test(value)) return true;
  }
  return false;
}

/** The headers stored with a cache entry and replayed with it. */
export function storableHeaders(list) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [name, value] of list) {
    if (ENGINE_HEADERS.has(name) || UNSTORED_HEADERS.has(name)) continue;
    out[name] = name in out ? `${out[name]}, ${value}` : value;
  }
  return out;
}

/**
 * The headers to send for one request: the page's own headers, then the
 * engine's. `list` is the full header list of a render made for this request
 * (its cookies, its Location), or null for a stored entry, whose storable
 * headers are sent instead. A private render that set its own private
 * Cache-Control keeps it.
 */
export function servedHeaders(entry, list, engineHeaders) {
  /** @type {Record<string, any>} */
  const out = {};
  if (list) {
    for (const [name, value] of list) {
      if (name === 'set-cookie') (out['set-cookie'] ||= []).push(value);
      else if (!ENGINE_HEADERS.has(name)) out[name] = name in out ? `${out[name]}, ${value}` : value;
    }
  } else {
    Object.assign(out, entry.headers);
  }
  Object.assign(out, engineHeaders);
  if (list && entry.private) {
    const own = list.find(([name, value]) => name === 'cache-control' && PRIVATE_CACHE_CONTROL.test(value));
    if (own) out['Cache-Control'] = own[1];
  }
  return out;
}

// A declared vary source ('cookie:session') maps to the HTTP header a shared
// cache would have to key on.
function varyHeaderNames(vary) {
  const names = new Set();
  for (const raw of vary) {
    const name = String(raw);
    const i = name.indexOf(':');
    const kind = i < 0 ? 'header' : name.slice(0, i).toLowerCase();
    names.add(kind === 'cookie' ? 'Cookie' : (i < 0 ? name : name.slice(i + 1)));
  }
  return [...names].join(', ');
}

/**
 * @param {{ maxAge?: number, swrWindow?: number, tags?: string[], partial?: boolean, private?: boolean, status?: number }} [entry]
 * @param {{ mode?: string, vary?: any }} [config]
 * @param {string} cacheStatus  HIT | STALE | MISS | BYPASS
 * @param {string[]} [vary] The declared vary the cache key used. Callers that
 *   omit it fall back to config.vary, which is only correct when the routeMatch
 *   carries no vary of its own.
 */
export function buildCacheHeaders(entry = {}, config = {}, cacheStatus = 'MISS', vary) {
  const headers = { 'X-What-Cache': cacheStatus };

  // A route that varies on cookies/auth renders per user. The origin cache keys
  // those variants separately, but a shared cache must never hold them, so no
  // `public` here regardless of maxAge.
  //
  // This reads normalizeVaryDeclaration() rather than testing the raw value,
  // because the cache key reads it too. When these two disagreed, a declaration
  // like `vary: 'cookie:session'` produced a constant key AND a `public` header,
  // and the two failures pointed the same way so nothing caught it. An
  // unresolvable declaration (null) is treated as varying: refusing to mark it
  // public is the fail-closed direction.
  const rawDeclared = vary !== undefined ? vary : config.vary;
  const declared = normalizeVaryDeclaration(rawDeclared);
  const varies = declared === null || declared.length > 0;
  if (declared && declared.length > 0) headers.Vary = varyHeaderNames(declared);

  // Non-200 responses (soft-404s, error pages) are never cacheable — the
  // origin engine doesn't store them, and a CDN must not either.
  const isOk = entry.status == null || entry.status === 200;
  const cacheable = isOk
    && !varies
    && !entry.private
    && ((entry.maxAge ?? 0) > 0 || config.mode === 'static' || config.mode === 'hybrid')
    && config.mode !== 'server';

  if (!cacheable) {
    headers['Cache-Control'] = 'private, no-store';
    return headers;
  }

  const sMaxAge = entry.partial ? 0 : (entry.maxAge || 0);
  const swr = entry.swrWindow != null ? entry.swrWindow : sMaxAge;
  headers['Cache-Control'] = `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`;

  if (entry.tags && entry.tags.length) {
    headers['Cache-Tag'] = entry.tags.join(',');       // Cloudflare / Fastly
    headers['Surrogate-Key'] = entry.tags.join(' ');   // Fastly surrogate keys
  }

  return headers;
}
