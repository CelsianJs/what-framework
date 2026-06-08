import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStaticPaths, buildPath, decideFallback, isKnownParams } from '../src/paths.js';

describe('getStaticPaths resolution', () => {
  it('resolves a function returning { paths, fallback }', async () => {
    const gsp = async () => ({ paths: [{ params: { slug: 'a' } }, { params: { slug: 'b' } }], fallback: 'blocking' });
    const r = await resolveStaticPaths(gsp);
    assert.equal(r.paths.length, 2);
    assert.equal(r.fallback, 'blocking');
  });

  it('defaults to empty paths + fallback:false when absent', async () => {
    const r = await resolveStaticPaths(undefined);
    assert.deepEqual(r, { paths: [], fallback: false });
  });

  it('builds a concrete URL from a pattern + params', () => {
    assert.equal(buildPath('/blog/:slug', { slug: 'hello' }), '/blog/hello');
    assert.equal(buildPath('/shop/:cat/:id', { cat: 'tools', id: '7' }), '/shop/tools/7');
  });

  it('builds catch-all segments', () => {
    assert.equal(buildPath('/docs/*path', { path: 'a/b/c' }), '/docs/a/b/c');
  });

  it('isKnownParams matches a path in the static list', () => {
    const known = [{ params: { slug: 'a' } }, { params: { slug: 'b' } }];
    assert.ok(isKnownParams(known, { slug: 'a' }));
    assert.ok(!isKnownParams(known, { slug: 'z' }));
  });

  it('decideFallback: unknown + blocking -> render', () => {
    assert.equal(decideFallback('blocking', false), 'render');
  });

  it('decideFallback: unknown + true -> skeleton', () => {
    assert.equal(decideFallback(true, false), 'skeleton');
  });

  it('decideFallback: unknown + false -> notfound', () => {
    assert.equal(decideFallback(false, false), 'notfound');
  });

  it('decideFallback: known -> serve regardless of fallback', () => {
    assert.equal(decideFallback(false, true), 'serve');
    assert.equal(decideFallback('blocking', true), 'serve');
  });
});
