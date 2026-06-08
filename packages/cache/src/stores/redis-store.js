// Redis/KV cache store — the multi-instance story (N app servers share one
// cache). Takes an INJECTED client (ioredis / node-redis shaped:
// get/set/del/sadd/srem/smembers, optional keys) so this package keeps zero deps.

export function createRedisStore({ client, namespace = 'what' } = {}) {
  if (!client) throw new Error('[what-cache] createRedisStore requires { client }');

  const ck = (key) => `${namespace}:cache:${key}`;
  const tk = (tag) => `${namespace}:tag:${tag}`;
  const pk = (path) => `${namespace}:path:${path}`;

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
      if (typeof client.keys === 'function') {
        const all = await client.keys(`${namespace}:*`);
        for (const k of all) await client.del(k);
      }
    },
    async keys() {
      if (typeof client.keys !== 'function') return [];
      const prefix = `${namespace}:cache:`;
      const all = await client.keys(`${prefix}*`);
      return all.map((k) => k.slice(prefix.length));
    },
  };
}
