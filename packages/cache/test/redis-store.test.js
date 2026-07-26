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

  it('sets an expiry so entries cannot outlive their swr window', async () => {
    const client = fakeRedis();
    const expires = [];
    client.expire = async (k, ttl) => { expires.push([k, ttl]); };
    const s = createRedisStore({ client });
    await s.set('k', entry({ expiresAt: Date.now() + 60_000, swrWindow: 600 }));
    assert.equal(expires.length, 1);
    assert.equal(expires[0][0], 'what:cache:k');
    assert.ok(expires[0][1] >= 600 && expires[0][1] <= 662, `unexpected ttl ${expires[0][1]}`);
  });

  it('does not expire entries with no expiry (durable static pages)', async () => {
    const client = fakeRedis();
    const expires = [];
    client.expire = async (...a) => { expires.push(a); };
    const s = createRedisStore({ client });
    await s.set('k', entry({ expiresAt: Infinity }));
    assert.deepEqual(expires, []);
  });

  it('enumerates with SCAN rather than the blocking KEYS command', async () => {
    const client = fakeRedis();
    client.keys = async () => { throw new Error('KEYS must not be used when SCAN is available'); };
    const pages = [];
    client.scan = async (cursor, ...args) => {
      pages.push([cursor, ...args]);
      return cursor === '0' ? ['7', ['what:cache:a']] : ['0', ['what:cache:b']];
    };
    const s = createRedisStore({ client });
    assert.deepEqual((await s.keys()).sort(), ['a', 'b'], 'every cursor page is collected');
    assert.equal(pages.length, 2);
    assert.deepEqual(pages[0].slice(1), ['MATCH', 'what:cache:*', 'COUNT', 500]);
  });

  it('namespaces keys to avoid collisions', async () => {
    const client = fakeRedis();
    const s = createRedisStore({ client, namespace: 'app1' });
    await s.set('k', entry());
    assert.ok((await client.keys('app1:cache:*')).length === 1);
  });
});
