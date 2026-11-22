// The origin a request was sent to, one rule for the CSRF check, the Node
// adapter's request URL and the ISR key: the Host, with the scheme a proxy in
// front reports in X-Forwarded-Proto (else the connection's). And what the
// cache stores: GET (and HEAD) renders of the origins the site names, nothing
// else.
//
// Before, the Node adapter built the URL from the socket alone, so behind a
// TLS proxy `origins: ['https://…']` matched no request and ISR was off; a
// POST with no `_action` was rendered and stored under the GET key, so a
// cross-site text/plain post set the page every later visitor got; a
// request for an origin outside `origins` was answered `public, s-maxage`;
// and an origin listed without its scheme crashed with a bare "Invalid URL".

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCacheEngine, createMemoryStore } from 'what-isr';

const { h, useLoaderData } = await import('what-core');
const { createRequestHandler } = await import('../src/index.js');
const { createServer } = await import('../src/adapter/node.js');
const { requestOrigin, requestScheme } = await import('../src/request-url.js');

const quiet = { warn() {}, error() {} };

function Page() {
  const { method, url, q } = useLoaderData();
  return h('p', { id: 'r' }, `${method} ${url} ${q}`);
}

async function loader({ request }) {
  const q = request.method === 'POST' ? (await request.text()).slice(0, 40) : '';
  return { method: request.method, url: request.url, q };
}

function site(origins) {
  const store = createMemoryStore();
  const cache = createCacheEngine({ store, logger: quiet, origins });
  const handle = createRequestHandler({ routes: [{ path: '/p', component: Page, loader, page: { mode: 'hybrid', revalidate: 60 } }], cache, csrf: false });
  return { store, handle };
}

const text = async (res) => (/<p[^>]* id="r"[^>]*>([^<]*)</.exec(await res.text()) || [])[1];

describe('the origin a request was sent to', () => {
  it('takes the scheme X-Forwarded-Proto reports, else the connection\'s', () => {
    assert.equal(requestScheme({ 'x-forwarded-proto': 'https' }, 'http'), 'https');
    assert.equal(requestScheme({ 'x-forwarded-proto': 'HTTPS, http' }, 'http'), 'https');
    assert.equal(requestScheme({ 'x-forwarded-proto': 'gopher' }, 'http'), 'http');
    assert.equal(requestScheme(new Headers(), 'https'), 'https');
    assert.equal(requestOrigin({ host: 'shop.example', 'x-forwarded-proto': 'https' }, 'http://shop.example/x'), 'https://shop.example');
    assert.equal(requestOrigin({ host: 'shop.example/admin?' }, '/x'), null);
  });

  it('keys an ISR entry on it behind a TLS proxy, so a listed https origin is cached', async () => {
    const { store, handle } = site(['https://shop.example']);
    const get = () => handle(new Request('http://shop.example/p', { headers: { 'x-forwarded-proto': 'https' } }));
    const first = await get();
    assert.equal(first.headers.get('x-what-cache'), 'MISS');
    assert.match(await text(first), /^GET https:\/\/shop\.example\/p/);
    assert.equal((await get()).headers.get('x-what-cache'), 'HIT');
    assert.deepEqual((await store.keys()).map((k) => k.split('\u0000')[0]), ['https://shop.example']);
  });

  it('builds the Node adapter\'s request URL with it', async () => {
    const server = createServer({ routes: [{ path: '/p', component: Page, loader, page: { mode: 'server' } }], csrf: false });
    await new Promise((resolve) => server.listen(8611, '127.0.0.1', resolve));
    try {
      const proxied = await fetch('http://127.0.0.1:8611/p', { headers: { 'x-forwarded-proto': 'https' } });
      assert.match(await text(proxied), /^GET https:\/\/127\.0\.0\.1:8611\/p/);
      const direct = await fetch('http://127.0.0.1:8611/p');
      assert.match(await text(direct), /^GET http:\/\/127\.0\.0\.1:8611\/p/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe('what the cache stores', () => {
  it('answers an origin it does not name for itself alone: private, no-store', async () => {
    const { store, handle } = site(['https://shop.example']);
    const res = await handle(new Request('http://evil.test/p'));
    assert.equal(res.headers.get('x-what-cache'), 'BYPASS');
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(await store.keys(), []);
  });

  it('never stores or serves a POST\'s render, whatever its body', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const { store, handle } = site(undefined);
      const posted = await handle(new Request('http://shop.example/p', { method: 'POST', headers: { 'content-type': type, 'sec-fetch-site': 'cross-site' }, body: 'q=ATTACKER' }));
      assert.equal(posted.headers.get('cache-control'), 'private, no-store', type);
      assert.match(await text(posted), /^POST /);
      assert.deepEqual(await store.keys(), [], type);
      const next = await handle(new Request('http://shop.example/p'));
      assert.equal(next.headers.get('x-what-cache'), 'MISS', type);
      assert.doesNotMatch(await text(next), /ATTACKER/, type);
    }
  });

  it('bypasses a POST a custom server hands the engine itself', async () => {
    const store = createMemoryStore();
    const engine = createCacheEngine({ store, logger: quiet, render: async () => ({ html: '<p>posted</p>' }) });
    const out = await engine.handle({ path: '/p', query: {}, config: { mode: 'hybrid', revalidate: 60 }, request: new Request('http://shop.example/p', { method: 'POST', body: 'x' }) });
    assert.equal(out.cacheStatus, 'BYPASS');
    assert.match(JSON.stringify(out.headers), /private, no-store/);
    assert.deepEqual(await store.keys(), []);
  });

  it('refuses an origin given without its scheme, and an empty list, naming the value', () => {
    assert.throws(() => createCacheEngine({ store: createMemoryStore(), origins: ['blog.example'] }), /"blog\.example" in `origins` is not an origin/);
    assert.throws(() => createCacheEngine({ store: createMemoryStore(), origins: ['ftp://blog.example'] }), /not an origin/);
    assert.throws(() => createCacheEngine({ store: createMemoryStore(), origins: [] }), /`origins` is \[\]/);
    assert.throws(() => createCacheEngine({ store: createMemoryStore(), origin: 'blog.example' }), /in `origin` is not an origin/);
    assert.doesNotThrow(() => createCacheEngine({ store: createMemoryStore(), origins: ['https://blog.example/'] }));
  });
});
