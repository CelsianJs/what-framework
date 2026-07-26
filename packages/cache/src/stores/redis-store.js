// Redis/KV cache store — the multi-instance story (N app servers share one
// cache). Takes an INJECTED client (ioredis / node-redis shaped:
// get/set/del/sadd/srem/smembers, optional expire/scan/keys) so this package
// keeps zero deps.

export function createRedisStore({ client, namespace = 'what' } = {}) {
  if (!client) throw new Error('[what-isr] createRedisStore requires { client }');

  const ck = (key) => `${namespace}:cache:${key}`;
  const tk = (tag) => `${namespace}:tag:${tag}`;
  const pk = (path) => `${namespace}:path:${path}`;

  // Redis must reclaim an entry once it is past its swr window, otherwise the
  // keyspace grows without bound. Entries with no expiry (durable static pages)
  // get no TTL and are dropped by explicit purge only.
  function ttlSeconds(entry, now = Date.now()) {
    const expiresAt = entry && entry.expiresAt;
    if (expiresAt == null || expiresAt === Infinity || !Number.isFinite(expiresAt)) return 0;
    const swr = Number(entry.swrWindow) || 0;
    return Math.max(1, Math.ceil((expiresAt - now) / 1000) + swr);
  }

  // SCAN, never KEYS: KEYS is O(N) and blocks single-threaded Redis for the
  // whole keyspace scan.
  async function scanKeys(pattern) {
    if (typeof client.scan === 'function') {
      const found = new Set();
      let cursor = '0';
      do {
        const res = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        const [next, batch] = Array.isArray(res) ? res : [res.cursor, res.keys];
        cursor = String(next);
        for (const k of batch || []) found.add(k);
      } while (cursor !== '0');
      return [...found];
    }
    if (typeof client.keys === 'function') return (await client.keys(pattern)) || [];
    return [];
  }

  async function deindex(key, entry) {
    if (!entry) return;
    for (const t of entry.tags || []) await client.srem(tk(t), key);
    if (entry.path) await client.srem(pk(entry.path), key);
  }

  async function deleteBySet(setKey) {
    const keys = (await client.smembers(setKey)) || [];
    for (const k of keys) await client.del(ck(k));
    await client.del(setKey);
    return keys;
  }

  return {
    async get(key) {
      const v = await client.get(ck(key));
      return v ? JSON.parse(v) : null;
    },
    async set(key, entry) {
      const prev = await this.get(key);
      if (prev) await deindex(key, prev);
      await client.set(ck(key), JSON.stringify(entry));
      const ttl = ttlSeconds(entry);
      if (ttl > 0 && typeof client.expire === 'function') await client.expire(ck(key), ttl);
      for (const t of entry.tags || []) await client.sadd(tk(t), key);
      if (entry.path) await client.sadd(pk(entry.path), key);
    },
    async delete(key) {
      const entry = await this.get(key);
      await client.del(ck(key));
      await deindex(key, entry);
      return !!entry;
    },
    async deleteByTag(tag) {
      return deleteBySet(tk(tag));
    },
    async deleteByPath(path) {
      return deleteBySet(pk(path));
    },
    async clear() {
      for (const k of await scanKeys(`${namespace}:*`)) await client.del(k);
    },
    async keys() {
      const prefix = `${namespace}:cache:`;
      const all = await scanKeys(`${prefix}*`);
      return all.map((k) => k.slice(prefix.length));
    },
  };
}
