// Cache key scheme. A key uniquely identifies a cacheable render:
//   <origin>\0<normalizedPath>\0<normalizedQuery>\0<varyString>
// the origin (scheme and host) when the request names one: a shared render
// sees the request's URL, so two hosts serving one app keep two entries, and
// a Host one sender chose never reaches another host's visitors. NUL
// separators avoid cross-field collisions. Tracking params are stripped so
// /p?utm_source=x and /p share one cache entry.

import { createHash } from 'node:crypto';

/**
 * Field separator between <normalizedPath>, <normalizedQuery> and <varyString>.
 *
 * NUL is deliberate and load-bearing: it cannot appear in any of the three
 * fields, so it cannot be used to forge a key collision. It is written as an
 * escape rather than a raw 0x00 byte so this file stays plain text, which means
 * grep can search it and git can diff it without a .gitattributes override.
 *
 * It is a CONSTANT so cacheKey(), which joins with it, and redactVary(), which
 * searches for it, cannot disagree. If they did, redactVary would never find a
 * separator and would return every key unchanged, and the redaction that keeps
 * session tokens out of Redis key names and out of cache files on disk would
 * never fire.
 */
const KEY_SEP = '\u0000';

const STRIP_EXACT = new Set(['fbclid', 'gclid', '_', 'mc_cid', 'mc_eid']);
const STRIP_PREFIXES = ['utm_'];

function shouldStrip(name) {
  if (STRIP_EXACT.has(name)) return true;
  for (const p of STRIP_PREFIXES) if (name.startsWith(p)) return true;
  return false;
}

/** Normalize a path: drop query/hash, strip trailing slash (except root). */
export function normalizePath(path) {
  if (!path) return '/';
  let p = String(path).split('?')[0].split('#')[0];
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p || '/';
}

// URLSearchParams takes one leading '?' off itself, as URL's searchParams
// does: '??a=1' is the key '?a'.
function queryToEntries(query) {
  if (!query) return [];
  if (typeof query === 'string') return [...new URLSearchParams(query).entries()];
  // plain object — values may be arrays
  const out = [];
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) for (const item of v) out.push([k, String(item)]);
    else out.push([k, String(v)]);
  }
  return out;
}

// Name and value are percent-encoded so a value containing "=" or "&" cannot
// forge an extra field: ?q=hello%26x=1 and ?q=hello&x=1 are different renders
// and must be different keys.
const enc = (s) => encodeURIComponent(String(s));

/** Normalize a query → key-sorted "k=v&k=v", preserving repeated value order. */
export function normalizeQuery(query) {
  const entries = queryToEntries(query)
    .filter(([k]) => !shouldStrip(k))
    // Stable sort groups names without changing the order a loader observes
    // for repeated values; sorting values would cache a different request.
    .sort((a, b) => (a[0] === b[0] ? 0 : a[0] < b[0] ? -1 : 1));
  return entries.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
}

// A Cookie header's pairs, one per name: the first, as the `cookie` package,
// what-server's readCookie and most server code read a repeated name.
function cookiePairs(header) {
  const pairs = new Map();
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    if (name && !pairs.has(name)) pairs.set(name, part.slice(i + 1).trim());
  }
  return pairs;
}

/** `header` with one pair per cookie name, the first: the view the key varies on. */
export function canonicalCookie(header) {
  return [...cookiePairs(header)].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** `query` (a string or an object) without the parameters the key ignores. */
export function keyedQuery(query) {
  if (!query) return query;
  if (typeof query === 'string') {
    const params = new URLSearchParams(query);
    for (const name of new Set(params.keys())) if (shouldStrip(name)) params.delete(name);
    const s = params.toString();
    return query.startsWith('?') && s ? `?${s}` : s;
  }
  // Null-prototype, as the router's parseQuery makes it: a cached route sees
  // the query object an uncached one sees.
  const kept = Object.create(null);
  for (const [name, value] of Object.entries(query)) if (!shouldStrip(name)) kept[name] = value;
  return kept;
}

/**
 * `routeMatch` as a render that may be stored sees it: made of what its key
 * is made of. A query parameter the key ignores (utm_*, fbclid, ...) is gone
 * from the query and from the request's URL, and a cookie name the request
 * repeats keeps its first value in the Cookie header. Otherwise one request
 * could store, under the key every visitor shares, a render made from an
 * input that key never saw (`?utm_source=<text>`, `theme=<text>; theme=dark`).
 */
export function canonicalMatch(routeMatch) {
  const out = { ...routeMatch, query: keyedQuery(routeMatch.query) };
  for (const field of ['varyHeaders', 'headers']) {
    const headers = routeMatch[field];
    if (!headers || typeof headers !== 'object') continue;
    out[field] = Object.fromEntries(Object.entries(headers).map(([name, value]) =>
      [name, name.toLowerCase() === 'cookie' ? canonicalCookie(Array.isArray(value) ? value.join('; ') : value) : value]));
  }
  const request = routeMatch.request;
  if (typeof Request !== 'undefined' && request instanceof Request && (request.method === 'GET' || request.method === 'HEAD')) {
    const url = new URL(request.url);
    for (const name of new Set(url.searchParams.keys())) if (shouldStrip(name)) url.searchParams.delete(name);
    const headers = new Headers(request.headers);
    if (headers.has('cookie')) headers.set('cookie', canonicalCookie(headers.get('cookie')));
    out.request = new Request(url, { method: request.method, headers, signal: request.signal });
  }
  return out;
}

/**
 * The one place that decides which vary declaration a routeMatch is using. The
 * cache key and the Cache-Control/Vary headers both read it, so they cannot
 * disagree about whether a render is per-user.
 */
export function declaredVary(routeMatch) {
  const rm = routeMatch || {};
  return rm.vary != null ? rm.vary : (rm.config || {}).vary;
}

/**
 * Coerce a `vary` declaration into the canonical `string[]` form, or null when
 * it is a shape we cannot resolve.
 *
 * The key builder and the Cache-Control builder both read this one function,
 * so no shape can desynchronise the key from the header. Were each to test the
 * declaration itself, `vary: 'cookie:session'` (the most natural shorthand)
 * could pass through one of them as an already-resolved name -> value map, and
 * varyString() would run Object.entries() over the STRING and key on its
 * character indices: one constant key for every user, plus
 * `Cache-Control: public`, which is the cross-user leak the vary mechanism
 * exists to prevent.
 *
 * Anything that is neither a string nor an array of strings returns null, which
 * every caller treats as "refuse to cache". Failing closed is the only safe
 * default here: the cost of a false bypass is a slower page, and the cost of a
 * false cache is serving one visitor's authenticated HTML to everyone.
 */
export function normalizeVaryDeclaration(vary) {
  if (vary == null) return [];
  if (typeof vary === 'string') return vary ? [vary] : [];
  if (!Array.isArray(vary)) return null;
  const out = [];
  for (const raw of vary) {
    if (typeof raw !== 'string' || !raw) return null;
    out.push(raw);
  }
  return out;
}

/**
 * Resolve a declared vary list (['cookie:session', 'authorization']) against the
 * request headers the adapter supplied, producing the name -> VALUE map the key
 * is built from. Returns null when the values cannot be resolved (no headers
 * supplied, an unresolvable declaration shape, or an unrecognized source) so
 * callers can refuse to cache instead of keying one shared entry for every user.
 */
export function resolveVary(vary, headers) {
  const declared = normalizeVaryDeclaration(vary);
  if (declared === null) return null;
  if (!declared.length) return {};
  if (!headers || typeof headers !== 'object') return null;

  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
  const cookies = cookiePairs(lower.cookie);

  const out = {};
  for (const raw of declared) {
    const name = String(raw);
    const i = name.indexOf(':');
    const kind = i < 0 ? 'header' : name.slice(0, i).toLowerCase();
    const source = i < 0 ? name : name.slice(i + 1);
    if (kind === 'cookie') out[name] = cookies.get(source) ?? '';
    else if (kind === 'header') out[name] = lower[source.toLowerCase()] ?? '';
    else return null;
  }
  return out;
}

function varyString(vary) {
  if (!vary) return '';
  return Object.entries(vary)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&');
}

/**
 * Build the canonical cache key for a request. `vary` may be a resolved
 * name -> value map, or a declared list resolved here against `headers`.
 *
 * @param {object} [request]
 * @param {string} [request.origin] the request URL's origin, when it has one
 * @param {string} [request.path]
 * @param {string|Record<string, any>} [request.query]
 * @param {string|string[]|Record<string, any>} [request.vary]
 * @param {Record<string, any>} [request.headers]
 */
export function cacheKey({ origin, path, query, vary, headers } = {}) {
  // A string or an array is a DECLARATION and has to be resolved against the
  // request. A plain object is an already-resolved name -> value map (what the
  // ISR engine passes). Anything else is refused rather than silently producing
  // one shared key: varyString() would run Object.entries() over it and emit an
  // empty or index-keyed segment, which is exactly the cross-user leak.
  const isDeclaration = typeof vary === 'string' || Array.isArray(vary);
  const isResolvedMap = vary == null || (typeof vary === 'object' && !Array.isArray(vary));
  const resolved = isDeclaration ? resolveVary(vary, headers) : (isResolvedMap ? vary : null);
  if (resolved === null) {
    // ERROR_CODES.ISR_VARY_UNRESOLVED
    throw Object.assign(
      new Error('[what-isr] cannot build a cache key: `vary` is declared but could not be resolved against the request.'),
      { code: 'ERR_ISR_VARY_UNRESOLVED' },
    );
  }
  const fields = [normalizePath(path), normalizeQuery(query), varyString(resolved)];
  return (origin ? [String(origin), ...fields] : fields).join(KEY_SEP);
}

/**
 * Replace the vary segment of a key with its SHA-256. The vary segment carries
 * raw header/cookie values (session tokens), and some stores put the key itself
 * somewhere readable: Redis key names show up in SCAN, MONITOR and RDB backups.
 * Path and query stay in the clear so a key is still recognizable in ops tools.
 */
export function redactVary(key) {
  const s = String(key);
  const i = s.lastIndexOf(KEY_SEP);
  if (i < 0) return s;
  const vary = s.slice(i + 1);
  // varyString() always emits `name=value` pairs, so a segment without `=` is
  // either empty or an already-redacted digest. Skipping it keeps this
  // idempotent, which matters because stores hand redacted keys back out.
  if (!vary.includes('=')) return s;
  return s.slice(0, i + 1) + createHash('sha256').update(vary).digest('hex');
}

/** Hash a key to a sharded, filesystem-safe path: aa/bb/<hex>. */
export function hashKey(key) {
  const hex = createHash('sha256').update(key).digest('hex');
  return `${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex.slice(4)}`;
}
