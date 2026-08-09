import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRedisStore } from '../src/stores/redis-store.js';
import { cacheKey } from '../src/key.js';

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
  // These five tests build their keys with the REAL cacheKey(), never by hand.
  //
  // They used to hand-write `/dash<space><space>cookie%3Asession=secret`, and
  // that is why they were green while production leaked: cacheKey() joins its
  // three fields with NUL, redactVary() searched for a SPACE, and the two had
  // drifted apart. Given a hand-built space-separated key redactVary found a
  // separator and redacted; given a real key it found none and returned the key
  // verbatim, session token and all. The suite asserted the property on a string
  // the system never produces. Building keys through the real function is the
  // only version of this test that can fail when the property breaks.
  const varyKey = (session) =>
    cacheKey({ path: '/dash', vary: ['cookie:session'], headers: { cookie: `session=${session}` } });

  it('never puts a vary value (session cookie) into a Redis key name', async () => {
    // Redis stores key names verbatim: they are readable via SCAN, echoed by
    // MONITOR and captured in RDB/AOF backups.
    const client = fakeRedis();
    const s = createRedisStore({ client });
    const secret = 'sid-SUPERSECRETTOKEN';
    const key = varyKey(secret);
    assert.ok(key.includes(secret), 'guard: the unredacted key must contain the secret');
    await s.set(key, entry({ path: '/dash', tags: ['dash'] }));

    const names = [...(await client.keys('what:*'))];
    for (const n of names) {
      assert.ok(!n.includes(secret), `secret leaked into Redis key name: ${n}`);
    }
    assert.equal((await s.get(key)).path, '/dash', 'the redacted key still round-trips');
  });

  it('never puts a vary value into a reverse-index set member', async () => {
    const client = fakeRedis();
    const s = createRedisStore({ client });
    const secret = 'sid-ANOTHERSECRET';
    await s.set(varyKey(secret), entry({ path: '/dash', tags: ['dash'] }));
    for (const set of ['what:tag:dash', 'what:path:/dash']) {
      for (const m of await client.smembers(set)) {
        assert.ok(!m.includes(secret), `secret leaked into set ${set}: ${m}`);
      }
    }
  });

  it('still purges vary-keyed entries by path', async () => {
    const s = createRedisStore({ client: fakeRedis() });
    await s.set(varyKey('aaa'), entry({ path: '/dash', tags: ['dash'] }));
    await s.set(varyKey('bbb'), entry({ path: '/dash', tags: ['dash'] }));
    assert.equal((await s.deleteByPath('/dash')).length, 2);
    assert.deepEqual(await s.keys(), []);
  });

  it('still purges vary-keyed entries by tag', async () => {
    const s = createRedisStore({ client: fakeRedis() });
    await s.set(varyKey('ccc'), entry({ path: '/dash', tags: ['dash'] }));
    assert.equal((await s.deleteByTag('dash')).length, 1);
    assert.deepEqual(await s.keys(), []);
  });

  it('keeps distinct vary values in distinct entries', async () => {
    const s = createRedisStore({ client: fakeRedis() });
    await s.set(varyKey('aaa'), entry({ html: '<i>A</i>', path: '/dash' }));
    await s.set(varyKey('bbb'), entry({ html: '<i>B</i>', path: '/dash' }));
    assert.equal((await s.get(varyKey('aaa'))).html, '<i>A</i>');
    assert.equal((await s.get(varyKey('bbb'))).html, '<i>B</i>');
  });
});
