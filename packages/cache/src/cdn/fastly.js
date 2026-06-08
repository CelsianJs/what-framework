// Fastly CDN adapter — surrogate-key purge (tags) and URL purge.

export function createFastlyCDN({ serviceId, apiToken } = {}) {
  const headers = { 'Fastly-Key': apiToken, Accept: 'application/json' };

  async function purgeKey(key) {
    if (!serviceId || !apiToken) return;
    await fetch(`https://api.fastly.com/service/${serviceId}/purge/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers,
    });
  }

  return {
    async purge(urls) {
      for (const url of urls) {
        if (!apiToken) return;
        await fetch(url, { method: 'PURGE', headers });
      }
    },
    async purgeTags(tags) {
      for (const t of tags) await purgeKey(t);
    },
  };
}
