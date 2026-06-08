import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRedisStore } from '../src/stores/redis-store.js';

// Minimal in-memory Redis-shaped client (get/set/del/sadd/srem/smembers/keys).
function fakeRedis() {
  const kv = new Map();
  const sets = new Map();
  const setOf = (k) => sets.get(k) || sets.set(k, new Set()).get(k);
  return {
    async get(k) { return kv.has(k) ? kv.get(k) : null; },
    async set(k, v) { kv.set(k, v); },
    async del(k) { kv.delete(k); sets.delete(k); },
    async sadd(k, m) { setOf(k).add(m); },
    async srem(k, m) { sets.get(k)?.delete(m); },
    async smembers(k) { return [...(sets.get(k) || [])]; },
    async keys(pattern) {
      const prefix = pattern.replace(/\*$/, '');
      return [...kv.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

const entry = (over = {}) => ({ html: '<p>r</p>', tags: [], path: '/p', ...over });

describe('redis store', () => {
  it('set/get round-trips via the injected client', async () => {
    const s = createRedisStore({ client: fakeRedis() });
    await s.set('k', entry({ html: '<i>redis</i>' }));
    assert.equal((await s.get('k')).html, '<i>redis</i>');
  });

  it('get returns null when missing', async () => {
    const s = createRedisStore({ client: fakeRedis() });
    assert.equal(await s.get('missing'), null);
  });

  it('deleteByTag purges tagged keys and returns them', async () => {
    const s = createRedisStore({ client: fakeRedis() });
    await s.set('a', entry({ tags: ['posts'] }));
    await s.set('b', entry({ tags: ['posts'] }));
    const deleted = await s.deleteByTag('posts');
    assert.deepEqual(deleted.sort(), ['a', 'b']);
    assert.equal(await s.get('a'), null);
  });

  it('deleteByPath purges path variants', async () => {
    const s = createRedisStore({ client: fakeRedis() });
    await s.set('x1', entry({ path: '/list' }));
    await s.set('x2', entry({ path: '/list' }));
    assert.equal((await s.deleteByPath('/list')).length, 2);
  });

  it('delete cleans up the tag index', async () => {
    const client = fakeRedis();
    const s = createRedisStore({ client });
    await s.set('a', entry({ tags: ['t'] }));
    await s.delete('a');
    assert.deepEqual(await s.deleteByTag('t'), [], 'tag set no longer references a');
  });

  it('namespaces keys to avoid collisions', async () => {
    const client = fakeRedis();
    const s = createRedisStore({ client, namespace: 'app1' });
    await s.set('k', entry());
    assert.ok((await client.keys('app1:cache:*')).length === 1);
  });
});
