// Cache-Control header builder. Origin ISR works without these, but emitting
// them lets ANY standards-compliant CDN do edge ISR for free (s-maxage +
// stale-while-revalidate), and Cache-Tag/Surrogate-Key enable CDN tag purge.

/**
 * @param {object} entry   { maxAge, swrWindow, tags?, partial?, status? }
 * @param {object} config  route page config { mode, ... }
 * @param {string} cacheStatus  HIT | STALE | MISS | BYPASS
 */
export function buildCacheHeaders(entry = {}, config = {}, cacheStatus = 'MISS') {
  const headers = { 'X-What-Cache': cacheStatus };

  // Non-200 responses (soft-404s, error pages) are never cacheable — the
  // origin engine doesn't store them, and a CDN must not either.
  const isOk = entry.status == null || entry.status === 200;
  const cacheable = isOk
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
