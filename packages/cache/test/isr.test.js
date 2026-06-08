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
