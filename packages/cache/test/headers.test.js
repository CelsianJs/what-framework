import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCacheHeaders } from '../src/headers.js';

describe('buildCacheHeaders', () => {
  it('emits s-maxage + stale-while-revalidate for a cacheable entry', () => {
    const h = buildCacheHeaders({ maxAge: 60, swrWindow: 600, tags: [] }, { mode: 'static' }, 'HIT');
    assert.match(h['Cache-Control'], /public/);
    assert.match(h['Cache-Control'], /s-maxage=60/);
    assert.match(h['Cache-Control'], /stale-while-revalidate=600/);
    assert.equal(h['X-What-Cache'], 'HIT');
  });

  it('emits no-store for server-rendered / uncacheable routes', () => {
    const h = buildCacheHeaders({ maxAge: 0 }, { mode: 'server' }, 'BYPASS');
    assert.match(h['Cache-Control'], /no-store/);
    assert.match(h['Cache-Control'], /private/);
  });

  it('includes Cache-Tag and Surrogate-Key for tagged entries', () => {
    const h = buildCacheHeaders({ maxAge: 60, swrWindow: 60, tags: ['posts', 'home'] }, { mode: 'static' }, 'HIT');
    assert.equal(h['Cache-Tag'], 'posts,home');
    assert.equal(h['Surrogate-Key'], 'posts home');
  });

  it('forces s-maxage=0 for partial/skeleton entries', () => {
    const h = buildCacheHeaders({ maxAge: 60, swrWindow: 60, tags: [], partial: true }, { mode: 'static' }, 'MISS');
    assert.match(h['Cache-Control'], /s-maxage=0/);
  });

  it('always reports the cache status', () => {
    assert.equal(buildCacheHeaders({ maxAge: 30, swrWindow: 30 }, {}, 'STALE')['X-What-Cache'], 'STALE');
  });

  it('emits no-store for non-200 entries even on static routes (404/500 never CDN-cached)', () => {
    for (const status of [404, 500]) {
      const h = buildCacheHeaders({ maxAge: 60, swrWindow: 600, tags: ['posts'], status }, { mode: 'static' }, 'MISS');
      assert.match(h['Cache-Control'], /no-store/, `status ${status} must be no-store`);
      assert.match(h['Cache-Control'], /private/);
      assert.equal(h['Cache-Tag'], undefined, 'no purge tags on uncacheable responses');
    }
  });

  it('an explicit status 200 stays cacheable', () => {
    const h = buildCacheHeaders({ maxAge: 60, swrWindow: 600, tags: [], status: 200 }, { mode: 'static' }, 'MISS');
    assert.match(h['Cache-Control'], /s-maxage=60/);
  });
});
