// End-to-end proof of the store: boots the real Node adapter with the shop
// routes and exercises SSR + loader + getStaticPaths + ISR (MISS->HIT) + a
// mode:'server' dashboard (no-store + auth gate) + a cart action that
// revalidates the `products` tag (purging the cached storefront).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { toNodeListener } from 'what-framework/server';
import { createHandler } from '../server.js';

let server, base;
before(async () => {
  server = http.createServer(toNodeListener(createHandler()));
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function get(path, headers) {
  const res = await fetch(base + path, { headers });
  return {
    status: res.status,
    cache: res.headers.get('x-what-cache'),
    cc: res.headers.get('cache-control'),
    body: await res.text(),
  };
}

describe('shop e2e', () => {
  it('SSRs the storefront with loader data + SSR <head>', async () => {
    const r = await get('/');
    assert.equal(r.status, 200);
    assert.match(r.body, /What Shop/);
    assert.match(r.body, /Signal Mug/);                 // loader data
    assert.match(r.body, /<title>What Shop<\/title>/);  // SSR head
    assert.match(r.body, /id="__what_data"/);           // hydration payload
  });

  it('ISR: product page MISS then HIT with s-maxage', async () => {
    const first = await get('/product/tee');
    assert.equal(first.cache, 'MISS');
    const second = await get('/product/tee');
    assert.equal(second.cache, 'HIT');
    assert.match(second.cc, /s-maxage=60/);
    assert.match(second.body, /No-VDOM Tee/);
  });

  it("getStaticPaths fallback:blocking renders an unbuilt product on first hit", async () => {
    const r = await get('/product/mug');
    assert.equal(r.status, 200);
    assert.match(r.body, /Signal Mug/);
  });

  it("dashboard is mode:'server' — no-store and gated by auth", async () => {
    const anon = await get('/dashboard');
    assert.match(anon.cc, /no-store/);                  // never cached
    assert.match(anon.body, /Not authorized/);          // auth gate
    const admin = await get('/dashboard', { 'x-demo-admin': '1' });
    assert.match(admin.body, /Dashboard/);
  });

  it('addToCart action revalidates the products tag (storefront re-renders)', async () => {
    await get('/');                                     // cache storefront
    assert.equal((await get('/')).cache, 'HIT');

    const res = await fetch(base + '/__what_action', {
      method: 'POST',
      headers: { 'x-what-action': 'addToCart', 'content-type': 'application/json' },
      body: JSON.stringify({ args: [{ id: 'mug' }] }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, count: 1 });

    // revalidateTag('products') purged the tagged storefront -> next hit MISS.
    assert.equal((await get('/')).cache, 'MISS');

    // The server-rendered dashboard reflects the new cart line.
    const admin = await get('/dashboard', { 'x-demo-admin': '1' });
    assert.match(admin.body, /Signal Mug ×1/);
  });
});
