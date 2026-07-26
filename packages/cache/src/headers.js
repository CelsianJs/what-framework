// Cache-Control header builder. Origin ISR works without these, but emitting
// them lets ANY standards-compliant CDN do edge ISR for free (s-maxage +
// stale-while-revalidate), and Cache-Tag/Surrogate-Key enable CDN tag purge.

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
 * @param {object} entry   { maxAge, swrWindow, tags?, partial?, private?, status? }
 * @param {object} config  route page config { mode, vary?, ... }
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
  const declared = vary !== undefined ? vary : config.vary;
  const varies = Array.isArray(declared) && declared.length > 0;
  if (varies) headers.Vary = varyHeaderNames(declared);

  // Non-200 responses (soft-404s, error pages) are never cacheable — the
  // origin engine doesn't store them, and a CDN must not either.
  const isOk = entry.status == null || entry.status === 200;
  const cacheable = isOk
    && !varies
    && !entry.private
    && (entry.maxAge > 0 || config.mode === 'static' || config.mode === 'hybrid')
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
