import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createCloudflareCDN, createFastlyCDN, createVercelCDN } from '../src/cdn/index.js';

let calls;
const realFetch = globalThis.fetch;
beforeEach(() => {
  calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('Cloudflare CDN adapter', () => {
  it('purgeTags posts tags to the zone purge endpoint with auth', async () => {
    const cdn = createCloudflareCDN({ zoneId: 'zone1', apiToken: 'tok' });
    await cdn.purgeTags(['posts']);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /zones\/zone1\/purge_cache/);
    assert.match(calls[0].opts.headers.Authorization, /Bearer tok/);
    assert.deepEqual(JSON.parse(calls[0].opts.body), { tags: ['posts'] });
  });

  it('purge posts files', async () => {
    const cdn = createCloudflareCDN({ zoneId: 'z', apiToken: 't' });
    await cdn.purge(['https://x.com/a']);
    assert.deepEqual(JSON.parse(calls[0].opts.body), { files: ['https://x.com/a'] });
  });
});

describe('Fastly CDN adapter', () => {
  it('purgeTags issues a surrogate-key purge per tag', async () => {
    const cdn = createFastlyCDN({ serviceId: 'svc', apiToken: 'k' });
    await cdn.purgeTags(['posts', 'home']);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /service\/svc\/purge\/posts/);
    assert.equal(calls[0].opts.headers['Fastly-Key'], 'k');
  });
});

describe('Vercel CDN adapter', () => {
  it('purgeTags hits the revalidation API when a token is present', async () => {
    const cdn = createVercelCDN({ token: 'vtok', projectId: 'prj' });
    await cdn.purgeTags(['posts']);
    assert.equal(calls.length, 1);
    assert.match(calls[0].opts.headers.Authorization, /Bearer vtok/);
  });

  it('no-ops without a token (header-driven ISR only)', async () => {
    const cdn = createVercelCDN({});
    await cdn.purgeTags(['posts']);
    assert.equal(calls.length, 0);
  });
});
