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

  // Cloudflare purges by absolute URL, and the engine hands a purge local
  // paths: they are joined to `baseUrl`, its path kept. Before, the local
  // path was sent as it was, which names no URL Cloudflare caches.
  it('purge joins a local path to baseUrl, keeping its path', async () => {
    await createCloudflareCDN({ zoneId: 'z', apiToken: 't', baseUrl: 'https://site.example' }).purge(['/app/x?q=1', 'https://x.com/a']);
    await createCloudflareCDN({ zoneId: 'z', apiToken: 't', baseUrl: 'https://site.example/shop/' }).purge(['/x', '/.//evil.test/x']);
    assert.deepEqual(calls.map((call) => JSON.parse(call.opts.body)), [
      { files: ['https://site.example/app/x?q=1', 'https://x.com/a'] },
      { files: ['https://site.example/shop/x'] },
    ]);
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

  it('purge never sends the API key to a non-local target', async () => {
    const cdn = createFastlyCDN({ serviceId: 'svc', apiToken: 'k', baseUrl: 'https://site.example' });
    await cdn.purge([
      'https://attacker.example/x',
      'http://169.254.169.254/latest/meta-data/',
      '//attacker.example/x',
      '/\\attacker.example/x',
    ]);
    assert.deepEqual(calls, [], 'no request left the process');

    await cdn.purge(['/blog']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://site.example/blog');
    assert.equal(calls[0].opts.method, 'PURGE');
  });

  // A baseUrl with a path ('https://site.example/shop') keeps it. Before,
  // `new URL('/x', baseUrl)` dropped it and purged 'https://site.example/x'.
  it('purge keeps the path of baseUrl, and no path names another host', async () => {
    for (const baseUrl of ['https://site.example/shop', 'https://site.example/shop/']) {
      await createFastlyCDN({ serviceId: 'svc', apiToken: 'k', baseUrl }).purge(['/blog?page=2']);
    }
    await createFastlyCDN({ serviceId: 'svc', apiToken: 'k', baseUrl: 'https://site.example//evil.test' }).purge(['/x']);
    assert.deepEqual(calls.map((call) => call.url), [
      'https://site.example/shop/blog?page=2',
      'https://site.example/shop/blog?page=2',
      'https://site.example//evil.test/x',
    ]);
  });

  it('purge no-ops without a baseUrl to resolve paths against', async () => {
    const cdn = createFastlyCDN({ serviceId: 'svc', apiToken: 'k' });
    await cdn.purge(['/blog']);
    assert.deepEqual(calls, []);
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

// A site served below a base path caches each page below it, so a purge of
// '/x' names '/app/x': the engine's `basePath`, written as the request
// handler's. Before, the CDN was handed '/x', which it does not cache.
describe('revalidatePath below a base path', () => {
  it('hands the CDN the path below the base', async () => {
    const { createCacheEngine, createMemoryStore } = await import('../src/index.js');
    const purged = [];
    for (const basePath of ['/app', '/app/', 'app', undefined, '/']) {
      const engine = createCacheEngine({ store: createMemoryStore(), basePath, cdn: { purge: async (paths) => { purged.push(...paths); } } });
      await engine.revalidatePath('/x?q=1');
    }
    assert.deepEqual(purged, ['/app/x?q=1', '/app/x?q=1', '/app/x?q=1', '/x?q=1', '/x?q=1']);
  });

  it('renders a regeneration with no request below the base', async () => {
    const { createCacheEngine, createMemoryStore } = await import('../src/index.js');
    const urls = [];
    const render = async (match) => {
      urls.push(match.request.url);
      return { html: 'x', status: 200, headers: {}, tags: [] };
    };
    const engine = createCacheEngine({ store: createMemoryStore(), render, basePath: 'app' });
    await engine.regenerate({ path: '/about', query: {}, params: {}, config: { mode: 'static', revalidate: 60 }, route: {} });
    assert.deepEqual(urls, ['http://localhost/app/about']);
  });
});

// A path whose canonical form is protocol-relative ("/.//evil.test/x" is
// "//evil.test/x" once URL removes the dot segment) never reaches a custom
// adapter, which may resolve it against its origin and send its token there.
describe('revalidatePath hands a CDN adapter local paths only', () => {
  it('drops a path that canonicalizes to another host', async () => {
    const { createCacheEngine, createMemoryStore } = await import('../src/index.js');
    const purged = [];
    const engine = createCacheEngine({ store: createMemoryStore(), cdn: { name: 'custom', purge: async (paths) => { purged.push(...paths); } } });
    for (const path of ['/.//evil.test/x', '/..//evil.test/x', '/%2e//evil.test/x', '/x/..//evil.test/x', '/./\t/evil.test/x', '/ok']) {
      await engine.revalidatePath(path).catch(() => {});
    }
    assert.deepEqual(purged, ['/ok']);
  });
});
