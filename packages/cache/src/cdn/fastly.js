// Fastly CDN adapter — surrogate-key purge (tags) and URL purge.

import { safeLocalPath } from '../local-path.js';

/**
 * @param {object} [credentials]
 * @param {string} [credentials.serviceId]
 * @param {string} [credentials.apiToken]
 * @param {string} [credentials.baseUrl]
 */
export function createFastlyCDN({ serviceId, apiToken, baseUrl } = {}) {
  /** @type {Record<string, string>} */
  const headers = { 'Fastly-Key': apiToken ?? '', Accept: 'application/json' };

  // A URL purge is a request to an arbitrary host carrying the Fastly API key,
  // so only local paths resolved against the configured baseUrl are ever sent.
  function purgeUrl(target) {
    if (!baseUrl) return null;
    const local = safeLocalPath(target);
    if (local === null) return null;
    try {
      return new URL(local, baseUrl).href;
    } catch {
      return null;
    }
  }

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
      for (const p of paths) {
        const url = purgeUrl(p);
        if (url) await fetch(url, { method: 'PURGE', headers });
      }
    },
    async purgeTags(tags) {
      for (const t of tags) await purgeKey(t);
    },
  };
}
