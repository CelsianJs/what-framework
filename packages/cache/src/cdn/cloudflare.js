// Cloudflare CDN adapter — edge purge by URL or cache-tag (Enterprise tag purge).
// Uses global fetch (Node 18+); credentials injected by the deploy adapter.
//
// Cloudflare purges by absolute URL. The engine hands a purge local paths
// ('/app/x'), which are joined to `baseUrl` (its path kept); an absolute URL
// is purged as it is. Either way the URL only travels in the body of a
// request to Cloudflare's API. Without `baseUrl` a local path is skipped,
// with one warning: Cloudflare's API refuses a request that names one.

import { noBaseUrlWarning, purgeUrlsBelow } from '../local-path.js';

/**
 * @param {object} [credentials]
 * @param {string} [credentials.zoneId]
 * @param {string} [credentials.apiToken]
 * @param {string} [credentials.baseUrl] the site's URL at the CDN, which a purged path is joined to
 */
export function createCloudflareCDN({ zoneId, apiToken, baseUrl } = {}) {
  const endpoint = `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`;
  const headers = { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' };
  const warn = noBaseUrlWarning('createCloudflareCDN');

  async function post(body) {
    if (!zoneId || !apiToken) return;
    await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  return {
    purge: async (urls) => {
      const files = purgeUrlsBelow(baseUrl, urls, true, warn);
      if (files.length) await post({ files });
    },
    purgeTags: (tags) => post({ tags }),
  };
}
