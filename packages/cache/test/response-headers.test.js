// A render's own response headers and the cache (security review #1,
// functional review M2/M3): which make a render private, which an entry keeps
// and replays, and that a shared regeneration answers each waiting request
// with what it may see.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createCacheEngine } from '../src/isr.js';
import { createMemoryStore } from '../src/stores/memory-store.js';
import { makeEntry } from '../src/stores/store-interface.js';
import { isPrivateResponse, responseHeaderList, storableHeaders } from '../src/headers.js';

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

describe('response headers', () => {
  it('a Set-Cookie, a private, no-store or no-cache Cache-Control, or a Vary makes a render private', () => {
    const cases = [
      [{ 'set-cookie': 'a=1' }, true],
      [{ 'Cache-Control': 'private, max-age=0' }, true],
      [{ 'cache-control': 'no-store' }, true],
      [{ 'cache-control': 'max-age=0, no-cache' }, true],
      [{ vary: 'Accept-Language' }, true],
      [{ 'cache-control': 'public, max-age=60' }, false],
      [{ 'x-custom': 'private' }, false],
      [{}, false],
    ];
    for (const [headers, expected] of cases) {
      assert.equal(isPrivateResponse(responseHeaderList(headers)), expected, JSON.stringify(headers));
      assert.equal(makeEntry({ html: 'x', headers }, { mode: 'static' }, 0).private, expected, JSON.stringify(headers));
    }
  });

  it('reads a Headers object, every Set-Cookie included', () => {
    const headers = new Headers();
    headers.append('set-cookie', 'a=1');
    headers.append('set-cookie', 'b=2');
    headers.set('X-App', 'v');
    assert.deepEqual(responseHeaderList(headers).sort(), [['set-cookie', 'a=1'], ['set-cookie', 'b=2'], ['x-app', 'v']].sort());
  });

  it('an entry keeps the page\'s own headers, never a cookie, the engine\'s headers or framing', () => {
    const kept = storableHeaders(responseHeaderList({
      'x-app': 'v',
      'content-language': 'en',
      link: '</a.css>; rel=preload',
      'set-cookie': ['s=1'],
      'cache-control': 'public, max-age=9',
      'content-length': '12',
      location: '/x',
      vary: 'Cookie',
      'x-what-cache': 'HIT',
    }));
    assert.deepEqual(kept, { 'x-app': 'v', 'content-language': 'en', link: '</a.css>; rel=preload' });
  });
});

describe('the engine and a render\'s headers', () => {
  const config = { mode: 'static', revalidate: 60 };
  const route = (extra = {}) => ({ path: '/p', query: {}, config, ...extra });

  it('a stored entry replays the page\'s headers on HIT and STALE', async () => {
    let now = 1000;
    const engine = createCacheEngine({
      store: createMemoryStore(),
      now: () => now,
      render: () => ({ html: 'x', headers: { 'x-app': 'v', 'set-cookie': 'leak=1' } }),
    });
    const miss = await engine.handle(route());
    assert.equal(miss.cacheStatus, 'MISS');
    assert.deepEqual(miss.headers['set-cookie'], ['leak=1'], 'the render\'s own requester gets its cookie');
    assert.match(miss.headers['Cache-Control'], /private, no-store/);
    // A render with a cookie is not stored, so make a public one to check replay.
    const publicEngine = createCacheEngine({
      store: createMemoryStore(),
      now: () => now,
      render: () => ({ html: 'x', headers: { 'x-app': 'v' } }),
    });
    await publicEngine.handle(route());
    const hit = await publicEngine.handle(route());
    assert.equal(hit.cacheStatus, 'HIT');
    assert.equal(hit.headers['x-app'], 'v');
    assert.equal(hit.headers['set-cookie'], undefined);
    now += 61_000;
    const stale = await publicEngine.handle(route());
    assert.equal(stale.cacheStatus, 'STALE');
    assert.equal(stale.headers['x-app'], 'v');
  });

  it('a private render keeps its own private Cache-Control', async () => {
    const engine = createCacheEngine({
      store: createMemoryStore(),
      render: () => ({ html: 'x', headers: { 'cache-control': 'private, max-age=30' } }),
    });
    const out = await engine.handle(route());
    assert.equal(out.headers['Cache-Control'], 'private, max-age=30');
  });

  it('a redirect or a non-200 is not shared with the requests waiting on the same regeneration', async () => {
    const gate = deferred();
    const started = deferred();
    const calls = [];
    const engine = createCacheEngine({
      store: createMemoryStore(),
      render: async (rm) => {
        calls.push(rm.user);
        if (rm.user === 'alice') { started.resolve(); await gate.promise; }
        return rm.user === 'alice'
          ? { html: '', status: 302, headers: { location: '/users/alice' } }
          : { html: rm.user, status: 200 };
      },
    });
    const alice = engine.handle(route({ user: 'alice' }));
    await started.promise;
    const bob = engine.handle(route({ user: 'bob' }));
    await setImmediate();
    gate.resolve();
    const [a, b] = await Promise.all([alice, bob]);
    assert.equal(a.status, 302);
    assert.equal(a.headers.location, '/users/alice');
    assert.equal(b.status, 200);
    assert.equal(b.html, 'bob');
    assert.equal(b.headers.location, undefined);
    assert.deepEqual(calls, ['alice', 'bob']);
  });

  it('render() gets a signal that only the last waiting request can abort, and never for a background refresh', async () => {
    let renderSignal;
    const gate = deferred();
    let now = 0;
    const engine = createCacheEngine({
      store: createMemoryStore(),
      now: () => now,
      render: async (_rm, ctx) => { renderSignal = ctx.signal; await gate.promise; return { html: 'x' }; },
    });
    const one = new AbortController();
    const two = new AbortController();
    const a = engine.handle(route({ signal: one.signal }));
    const b = engine.handle(route({ signal: two.signal }));
    const settled = Promise.allSettled([a, b]);
    await setImmediate();
    one.abort();
    await setImmediate();
    assert.equal(renderSignal.aborted, false);
    two.abort();
    assert.equal(renderSignal.aborted, true);
    gate.resolve();
    const results = await settled;
    assert.deepEqual(results.map((r) => r.status), ['rejected', 'rejected']);

    // A background refresh (a stale entry being served) is never aborted.
    const store = createMemoryStore();
    const refresh = deferred();
    let refreshSignal;
    const bg = createCacheEngine({
      store,
      now: () => now,
      render: async (_rm, ctx) => { refreshSignal = ctx.signal; await refresh.promise; return { html: 'new' }; },
    });
    await store.set(bg.keyFor(route()), makeEntry({ html: 'old' }, { mode: 'static', revalidate: 1, swr: 100 }, 0));
    now = 5000;
    const leaving = new AbortController();
    const stale = await bg.handle(route({ signal: leaving.signal, config: { mode: 'static', revalidate: 1, swr: 100 } }));
    assert.equal(stale.cacheStatus, 'STALE');
    leaving.abort();
    await setImmediate();
    assert.equal(refreshSignal.aborted, false);
    refresh.resolve();
  });
});
