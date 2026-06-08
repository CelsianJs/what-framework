// Cloudflare CDN adapter — edge purge by URL or cache-tag (Enterprise tag purge).
// Uses global fetch (Node 18+); credentials injected by the deploy adapter.

export function createCloudflareCDN({ zoneId, apiToken } = {}) {
  const endpoint = `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`;
  const headers = { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' };

  async function post(body) {
    if (!zoneId || !apiToken) return;
    await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  }

  return {
    purge: (urls) => post({ files: urls }),
    purgeTags: (tags) => post({ tags }),
  };
}
