// Fastly CDN adapter — surrogate-key purge (tags) and URL purge.

import { noBaseUrlWarning, purgeUrlsBelow } from '../local-path.js';

/**
 * @param {object} [credentials]
 * @param {string} [credentials.serviceId]
 * @param {string} [credentials.apiToken]
 * @param {string} [credentials.baseUrl] the site's URL at the CDN, which a purged path is joined to
 */
export function createFastlyCDN({ serviceId, apiToken, baseUrl } = {}) {
  /** @type {Record<string, string>} */
  const headers = { 'Fastly-Key': apiToken ?? '', Accept: 'application/json' };

  // A URL purge is a request to an arbitrary host carrying the Fastly API key,
  // so only local paths below the configured baseUrl are ever sent. A path in
  // baseUrl is kept ('https://example.com/shop' purges '/x' at
  // 'https://example.com/shop/x'). Without baseUrl nothing is purged by URL,
  // with one warning.
  const warn = noBaseUrlWarning('createFastlyCDN');

  async function purgeKey(key) {
    if (!serviceId || !apiToken) return;
    await fetch(`https://api.fastly.com/service/${serviceId}/purge/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers,
    });
  }

  return {
    async purge(paths) {
      if (!apiToken) return;
      for (const url of purgeUrlsBelow(baseUrl, paths, false, warn)) await fetch(url, { method: 'PURGE', headers });
    },
    async purgeTags(tags) {
      for (const t of tags) await purgeKey(t);
    },
  };
}
