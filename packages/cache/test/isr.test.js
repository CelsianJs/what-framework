import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCacheEngine } from '../src/isr.js';
import { createMemoryStore } from '../src/stores/memory-store.js';

// Controllable clock + counting render so we can assert exactly how many renders
// happen under each cache state.
function harness({ revalidate = 60, swr = 600, onMiss, renderDelay = 0 } = {}) {
  let t = 1_000_000;
  const now = () => t;
  const advance = (sec) => { t += sec * 1000; };
  let renders = 0;
  const render = async () => {
    renders++;
    if (renderDelay) await new Promise((r) => setTimeout(r, renderDelay));
    return { html: `<p>render#${renders}</p>`, head: '', state: null, tags: ['posts'] };
  };
  const store = createMemoryStore();
  const engine = createCacheEngine({ store, render, now });
  const route = { path: '/p', query: {}, config: { mode: 'static', revalidate, swr, onMiss } };
  return { engine, route, advance, now, store, renders: () => renders };
}

describe('ISR engine', () => {
  it('cold miss renders once and serves MISS', async () => {
    const h = harness();
    const r = await h.engine.handle(h.route);
    assert.equal(r.cacheStatus, 'MISS');
    assert.match(r.html, /render#1/);
    assert.equal(h.renders(), 1);
  });

  it('serves a fresh entry from cache with no re-render (HIT)', async () => {
    const h = harness();
    await h.engine.handle(h.route);
    const r = await h.engine.handle(h.route);
    assert.equal(r.cacheStatus, 'HIT');
    assert.equal(h.renders(), 1, 'no second render within revalidate window');
  });

  it('serves stale immediately then regenerates in the background (STALE)', async () => {
    const h = harness({ revalidate: 60, swr: 600 });
    await h.engine.handle(h.route);   // render #1
    h.advance(120);                   // now stale (past 60s, within swr)
    const r = await h.engine.handle(h.route);
    assert.equal(r.cacheStatus, 'STALE');
    assert.match(r.html, /render#1/, 'stale content served immediately');
    // background regeneration happens; wait a tick
    await new Promise((res) => setTimeout(res, 20));
    assert.equal(h.renders(), 2, 'one background regeneration fired');
    // next request is fresh again
    const r2 = await h.engine.handle(h.route);
    assert.equal(r2.cacheStatus, 'HIT');
    assert.match(r2.html, /render#2/);
  });

  it('dedupes concurrent regenerations (one render for N concurrent cold hits)', async () => {
    const h = harness({ renderDelay: 30 });
    const results = await Promise.all(Array.from({ length: 25 }, () => h.engine.handle(h.route)));
    assert.equal(h.renders(), 1, 'exactly one render despite 25 concurrent misses');
    for (const r of results) assert.match(r.html, /render#1/);
  });

  it('emits Cache-Control headers with the cache status', async () => {
    const h = harness();
    const r = await h.engine.handle(h.route);
    assert.match(r.headers['Cache-Control'], /s-maxage=60/);
    assert.equal(r.headers['X-What-Cache'], 'MISS');
    assert.equal(r.headers['Cache-Tag'], 'posts');
  });

  it('past the swr window, a cold-ish entry blocks and re-renders (MISS)', async () => {
    const h = harness({ revalidate: 60, swr: 60 });
    await h.engine.handle(h.route);  // #1
    h.advance(600);                  // way past expires+swr
    const r = await h.engine.handle(h.route);
    assert.equal(r.cacheStatus, 'MISS');
    assert.match(r.html, /render#2/);
  });

  it('never caches non-200 renders (soft-404s re-render on every request)', async () => {
    let t = 0; const now = () => t;
    let renders = 0;
    const render = async () => {
      renders++;
      return { html: '<p>Not found</p>', head: '', state: null, tags: [], status: 404 };
    };
    const store = createMemoryStore();
    const engine = createCacheEngine({ store, render, now });
    const route = { path: '/blog/nope', query: {}, config: { mode: 'static', revalidate: 60, swr: 600 } };

    const r1 = await engine.handle(route);
    assert.equal(r1.status, 404, 'real status passes through');
    assert.equal(r1.cacheStatus, 'MISS');
    assert.match(r1.headers['Cache-Control'], /no-store/, '404 must not be CDN-cacheable');
    assert.deepEqual(await store.keys(), [], '404 entry must not be stored');

    const r2 = await engine.handle(route);
    assert.equal(r2.cacheStatus, 'MISS', 'no HIT for a 404 — re-rendered');
    assert.equal(r2.status, 404);
    assert.equal(renders, 2, 'each request re-renders; nothing was cached');
  });

  it('never caches 5xx renders either', async () => {
    const store = createMemoryStore();
    const engine = createCacheEngine({
      store,
      render: async () => ({ html: '<p>boom</p>', status: 500, tags: [] }),
      now: () => 0,
    });
    const route = { path: '/err', query: {}, config: { mode: 'static', revalidate: 60 } };
    const r = await engine.handle(route);
    assert.equal(r.status, 500);
    assert.deepEqual(await store.keys(), []);
  });

  it('a non-200 background regeneration leaves the cached 200 entry intact', async () => {
    let t = 1_000_000; const now = () => t;
    let renders = 0;
    const render = async () => {
      renders++;
      return renders === 1
        ? { html: '<p>good</p>', head: '', state: null, tags: [] }          // 200
        : { html: '<p>Not found</p>', head: '', state: null, tags: [], status: 404 };
    };
    const store = createMemoryStore();
    const engine = createCacheEngine({ store, render, now });
    const route = { path: '/p', query: {}, config: { mode: 'static', revalidate: 60, swr: 600 } };

    await engine.handle(route);             // cache the 200
    t += 120_000;                           // stale, within swr
    const r = await engine.handle(route);   // serves stale, regen → 404 in background
    assert.equal(r.cacheStatus, 'STALE');
    await new Promise((res) => setTimeout(res, 20));
    assert.equal(renders, 2, 'background regeneration ran');
    const [key] = await store.keys();
    assert.ok(key, 'good entry still stored');
    const entry = await store.get(key);
    assert.match(entry.html, /good/, '404 regen must not overwrite the cached 200');
    assert.equal(entry.status, 200);
  });

  it('stale-if-error serves stale when regeneration throws', async () => {
    let t = 0; const now = () => t;
    let calls = 0;
    const render = async () => {
      calls++;
      if (calls === 1) return { html: '<p>ok</p>', head: '', state: null, tags: [] };
      throw new Error('upstream down');
    };
    const store = createMemoryStore();
    const engine = createCacheEngine({ store, render, now });
    const route = { path: '/p', query: {}, config: { mode: 'static', revalidate: 1, swr: 1, onMiss: 'stale-if-error' } };
    await engine.handle(route);     // cache ok
    t += 10_000;                    // expire beyond swr
    const r = await engine.handle(route);
    assert.match(r.html, /ok/, 'served stale despite regeneration failure');
  });
});
