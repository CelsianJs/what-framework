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
    // A returning browser sends the CSRF cookie back; a response that has to
    // set it is never public, so no shared cache keeps one visitor's token.
    const second = await get('/product/tee', { cookie: 'what-csrf=returning-visitor' });
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

    // CSRF is on by default: present the auto-provisioned cookie token
    // (double-submit) exactly like the in-page fetch client does.
    const csrf = 'e2e-csrf-token-shop';
    const res = await fetch(base + '/__what_action', {
      method: 'POST',
      headers: {
        'x-what-action': 'addToCart',
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        cookie: `what-csrf=${csrf}`,
      },
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

  // The product page is cached: its HTML is shared, so it can never carry a
  // visitor's CSRF token. Its "Add to cart" form is a plain HTML form post
  // (no JavaScript on this site), with the headers every current browser
  // sends with it, and no token and no cookie.
  async function postForm(fields, headers) {
    return fetch(base + '/__what_action', {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
      body: new URLSearchParams(fields).toString(),
    });
  }

  it('"Add to cart" on a cached product page posts and lands on the cart', async () => {
    const page = await get('/product/tee');
    assert.equal((await get('/product/tee', { cookie: 'what-csrf=returning-visitor' })).cache, 'HIT');
    // The form names its action and where to go, and carries no token.
    assert.match(page.body, /<form[^>]*action="\/__what_action"/);
    assert.match(page.body, /name="_action" value="addToCart"/);
    assert.match(page.body, /name="_redirect" value="\/cart"/);
    assert.doesNotMatch(page.body, /what-csrf-token/);

    const fields = { _action: 'addToCart', _redirect: '/cart', id: 'tee' };
    const fetchMetadata = await postForm(fields, { 'sec-fetch-site': 'same-origin', origin: base, referer: base + '/product/tee' });
    assert.equal(fetchMetadata.status, 303);
    assert.equal(fetchMetadata.headers.get('location'), '/cart');
    // A browser that sends Origin but not Sec-Fetch-Site.
    const originOnly = await postForm(fields, { origin: base });
    assert.equal(originOnly.status, 303);

    const cart = await get('/cart');
    assert.match(cart.cc, /no-store/);
    assert.match(cart.body, /No-VDOM Tee ×2/);
  });

  it('refuses the same post from another site', async () => {
    const cartLines = async () => (await get('/cart')).body.match(/<main[^]*<\/main>/)[0];
    const before = await cartLines();
    const crossSite = await postForm({ _action: 'addToCart', id: 'tee' }, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' });
    assert.equal(crossSite.status, 403);
    const foreignOrigin = await postForm({ _action: 'addToCart', id: 'tee' }, { origin: 'https://evil.example' });
    assert.equal(foreignOrigin.status, 403);
    // Neither header and no token: the double-submit check still applies.
    const bare = await postForm({ _action: 'addToCart', id: 'tee' }, {});
    assert.equal(bare.status, 403);
    assert.equal(await cartLines(), before, 'nothing was added');
  });
});
