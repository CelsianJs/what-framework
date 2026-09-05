// Cache key scheme. A key uniquely identifies a cacheable render:
//   <normalizedPath>\0<normalizedQuery>\0<varyString>
// NUL separators avoid cross-field collisions. Tracking params are stripped so
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
 * It is a CONSTANT because it used to be spelled twice and the two spellings
 * disagreed: cacheKey() joined with a raw NUL while redactVary() searched for a
 * space. redactVary therefore never found a separator and returned every key
 * unchanged, so the redaction that exists to keep session tokens out of Redis
 * key names and out of cache files on disk had never once fired on a real key.
 * Both readers now use this binding and cannot drift apart again.
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

function queryToEntries(query) {
  if (!query) return [];
  if (typeof query === 'string') {
    const s = query.startsWith('?') ? query.slice(1) : query;
    if (!s) return [];
    return [...new URLSearchParams(s).entries()];
  }
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

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
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
 * This exists because the key builder and the Cache-Control builder each used to
 * test the declaration themselves, and they disagreed. `vary: 'cookie:session'`
 * (the most natural shorthand) was passed through as if it were an
 * already-resolved name -> value map, so varyString() ran Object.entries() over
 * the STRING and keyed on its character indices: one constant key for every
 * user, plus `Cache-Control: public`, which is the cross-user leak the vary
 * mechanism exists to prevent. Both callers now read this one function, so a
 * third shape cannot desynchronise the key from the header again.
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
  const cookies = parseCookies(lower.cookie);

  const out = {};
  for (const raw of declared) {
    const name = String(raw);
    const i = name.indexOf(':');
    const kind = i < 0 ? 'header' : name.slice(0, i).toLowerCase();
    const source = i < 0 ? name : name.slice(i + 1);
    if (kind === 'cookie') out[name] = cookies[source] ?? '';
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
 * @param {string} [request.path]
 * @param {string|Record<string, any>} [request.query]
 * @param {string|string[]|Record<string, any>} [request.vary]
 * @param {Record<string, any>} [request.headers]
 */
export function cacheKey({ path, query, vary, headers } = {}) {
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
      new Error('[what-isr] cannot build a cache key: `vary` is declared but could not be resolved against the request (unsupported shape, or no request headers were supplied)'),
      { code: 'ERR_ISR_VARY_UNRESOLVED' },
    );
  }
  return [normalizePath(path), normalizeQuery(query), varyString(resolved)].join(KEY_SEP);
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
