// Deploy adapter core (Phase 7): the Web-Fetch request handler tying route
// match -> ISR cache -> render -> action dispatch -> revalidate webhook.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { createCacheEngine, createMemoryStore, createRevalidateWebhook } from 'what-isr';
import { createRequestHandler } from '../src/adapter/core.js';
import { createActionHandler, action } from '../src/index.js';

const routes = [
  { path: '/', component: () => h('main', {}, 'home'), mode: 'static', page: { mode: 'static', revalidate: 60 } },
  { path: '/srv', component: () => h('main', {}, 'srv'), mode: 'server', page: { mode: 'server' } },
  { path: '/blog/:slug', component: ({ slug }) => h('main', {}, slug), mode: 'static', page: { mode: 'static', revalidate: 60, tags: ['posts'] } },
];

function countingRender() {
  let n = 0;
  const render = async (rm) => { n++; return { html: `<main>${rm.path}#${n}</main>`, status: 200, tags: rm.config?.tags || [], path: rm.path }; };
  return { render, count: () => n };
}

describe('createRequestHandler', () => {
  it('passes complete decoded query values through a real request', async () => {
    const handle = createRequestHandler({
      routes, csrf: false,
      render: async ({ query }) => ({ html: JSON.stringify(query), status: 200 }),
    });
    const res = await handle(new Request('http://x/srv?q=hello+world&token=a=b&broken=%'));
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(await res.text()), { q: 'hello world', token: 'a=b', broken: '%' });
  });

  it('never serves an ISR entry for a differently ordered duplicate query', async () => {
    let renders = 0;
    const handle = createRequestHandler({
      routes, csrf: false,
      cache: createCacheEngine({ store: createMemoryStore() }),
      render: async ({ query }) => { renders++; return { html: JSON.stringify(query.sort), status: 200 }; },
    });
    const first = await handle(new Request('http://x/?z=1&sort=a&sort=b'));
    assert.equal(await first.text(), '["a","b"]');
    const reversed = await handle(new Request('http://x/?sort=b&z=1&sort=a'));
    assert.equal(reversed.headers.get('x-what-cache'), 'MISS');
    assert.equal(await reversed.text(), '["b","a"]');
    const equivalent = await handle(new Request('http://x/?sort=b&sort=a&z=1'));
    assert.equal(equivalent.headers.get('x-what-cache'), 'HIT');
    assert.equal(await equivalent.text(), '["b","a"]');
    assert.equal(renders, 2);
  });

  it('cold GET is a MISS, repeat is a HIT (no re-render)', async () => {
    const { render, count } = countingRender();
    const cache = createCacheEngine({ store: createMemoryStore() });
    const handle = createRequestHandler({ routes, cache, render });

    const r1 = await handle(new Request('http://x/'));
    assert.equal(r1.status, 200);
    assert.equal(r1.headers.get('x-what-cache'), 'MISS');
    assert.match(await r1.text(), /#1/);

    const r2 = await handle(new Request('http://x/'));
    assert.equal(r2.headers.get('x-what-cache'), 'HIT');
    assert.equal(count(), 1, 'second request served from cache');
    assert.match(r2.headers.get('cache-control'), /s-maxage=60/);
  });

  it('server-mode routes bypass cache and render every time', async () => {
    const { render, count } = countingRender();
    const cache = createCacheEngine({ store: createMemoryStore() });
    const handle = createRequestHandler({ routes, cache, render });
    await handle(new Request('http://x/srv'));
    await handle(new Request('http://x/srv'));
    assert.equal(count(), 2);
    const r = await handle(new Request('http://x/srv'));
    assert.match(r.headers.get('cache-control'), /no-store/);
  });

  it('dispatches POST /__what_action', async () => {
    action(async (a, b) => ({ sum: a + b }), { id: 'adapter-sum' });
    const handle = createRequestHandler({ routes, actionHandler: createActionHandler({ skipCsrf: true }) });
    const res = await handle(new Request('http://x/__what_action', {
      method: 'POST',
      headers: { 'x-what-action': 'adapter-sum', 'content-type': 'application/json' },
      body: JSON.stringify({ args: [2, 3] }),
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { sum: 5 });
  });

  it('handles POST /__what_revalidate with a secret', async () => {
    const { render } = countingRender();
    const cache = createCacheEngine({ store: createMemoryStore() });
    const handle = createRequestHandler({
      routes, cache, render,
      revalidateWebhook: createRevalidateWebhook(cache, { secret: 'sek' }),
    });
    await handle(new Request('http://x/blog/a'));
    const res = await handle(new Request('http://x/__what_revalidate', {
      method: 'POST',
      headers: { 'x-what-revalidate-secret': 'sek', 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['posts'] }),
    }));
    assert.equal(res.status, 200);
    assert.match(await res.text(), /revalidated/);
  });

  it('rejects an oversized POST /__what_revalidate body with 413 before the webhook runs', async () => {
    let called = 0;
    const handle = createRequestHandler({
      routes,
      revalidateWebhook: async () => { called++; return { status: 401, body: { message: 'Unauthorized' } }; },
    });
    const res = await handle(new Request('http://x/__what_revalidate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(1024 * 1024 + 1),
    }));
    assert.equal(res.status, 413);
    assert.equal(called, 0, 'the body must not be buffered into the webhook');
  });

  it('returns 404 for unmatched routes', async () => {
    const handle = createRequestHandler({ routes });
    const res = await handle(new Request('http://x/nope'));
    assert.equal(res.status, 404);
  });

  it('default render produces a full HTML document with hydration payload', async () => {
    const mod = {
      path: '/p',
      component: ({ loaderData }) => h('main', {}, loaderData.msg),
      loader: () => ({ msg: 'docrender' }),
      mode: 'server',
      page: { mode: 'server' },
    };
    const handle = createRequestHandler({ routes: [mod] });
    const res = await handle(new Request('http://x/p'));
    const html = await res.text();
    assert.match(html, /<!DOCTYPE html>/i);
    assert.match(html, /<main>docrender<\/main>/);
    assert.match(html, /id="__what_data"/);
  });
});

// The vary control never executed outside unit tests: no shipped adapter set
// routeMatch.varyHeaders, so every vary route warned and bypassed the cache.
describe('vary routes through the real adapter', () => {
  const varyRoutes = [
    {
      path: '/account',
      component: () => h('main', {}, 'account'),
      mode: 'hybrid',
      page: { mode: 'hybrid', revalidate: 60, vary: ['cookie:session'] },
    },
  ];

  function sessionRender() {
    let n = 0;
    const render = async (rm) => {
      n++;
      const cookie = (rm.varyHeaders || {}).cookie || '';
      return { html: `<main>${cookie}#${n}</main>`, status: 200, tags: [], path: rm.path };
    };
    return { render, count: () => n };
  }

  const get = (handle, cookie) => handle(new Request('http://x/account', { headers: { cookie } }));

  it('supplies the declared request headers so the cache keys per user', async () => {
    const { render, count } = sessionRender();
    const store = createMemoryStore();
    const handle = createRequestHandler({ routes: varyRoutes, cache: createCacheEngine({ store }), render });

    const alice = await get(handle, 'session=alice');
    const bob = await get(handle, 'session=bob');
    assert.match(await alice.text(), /session=alice/);
    assert.match(await bob.text(), /session=bob/, "Alice's HTML must not be served to Bob");
    assert.notEqual(alice.headers.get('x-what-cache'), 'BYPASS', 'the vary control never ran');
    assert.equal((await store.keys()).length, 2, 'one cache entry per user');

    const aliceAgain = await get(handle, 'session=alice');
    assert.equal(aliceAgain.headers.get('x-what-cache'), 'HIT');
    assert.match(await aliceAgain.text(), /session=alice/);
    assert.equal(count(), 2, 'the repeat visit is served from cache');
  });

  it('never advertises a per-user render as publicly shareable', async () => {
    const { render } = sessionRender();
    const handle = createRequestHandler({ routes: varyRoutes, cache: createCacheEngine({ store: createMemoryStore() }), render });

    const res = await get(handle, 'session=alice');
    assert.match(res.headers.get('cache-control'), /private, no-store/);
    assert.doesNotMatch(res.headers.get('cache-control'), /public/);
  });

  it('does not warn on every request for a vary route', async () => {
    const { render } = sessionRender();
    const warnings = [];
    const cache = createCacheEngine({
      store: createMemoryStore(),
      logger: { warn: (m) => warnings.push(m), error() {} },
    });
    const handle = createRequestHandler({ routes: varyRoutes, cache, render });

    await get(handle, 'session=alice');
    await get(handle, 'session=alice');
    assert.deepEqual(warnings, [], `vary route warned per request: ${warnings.join(' | ')}`);
  });
});

describe('render result headers', () => {
  it('honours out.headers on the direct-render path, like the cache path', async () => {
    // A custom `render` could set response headers for a cached route and not
    // for an uncached one. The asymmetry meant a render returning a redirect
    // produced a 302 with no Location: an empty page, and nothing saying why.
    const render = async (rm) => ({
      html: '',
      status: 302,
      tags: [],
      path: rm.path,
      headers: { Location: '/login' },
    });
    const handle = createRequestHandler({ routes, render });

    const res = await handle(new Request('http://x/srv'));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login');
  });

  it('still sets Cache-Control on a server-mode route that returns headers', async () => {
    const render = async (rm) => ({ html: '<main>x</main>', status: 200, tags: [], path: rm.path, headers: { 'x-custom': '1' } });
    const handle = createRequestHandler({ routes, render });

    const res = await handle(new Request('http://x/srv'));
    assert.equal(res.headers.get('x-custom'), '1');
    assert.match(res.headers.get('cache-control') || '', /no-store/);
  });

  it('does not let a render drop the CSRF cookie', async () => {
    // The cookie is the other half of the double-submit check. A render that
    // sets its own set-cookie must not be able to remove it.
    const render = async (rm) => ({
      html: '<main>x</main>',
      status: 200,
      tags: [],
      path: rm.path,
      headers: { 'set-cookie': 'mine=1' },
    });
    const handle = createRequestHandler({ routes, render, csrf: true });

    const res = await handle(new Request('http://x/srv'));
    const cookie = res.headers.get('set-cookie') || '';
    assert.ok(cookie.includes('csrf'), `expected the CSRF cookie to survive, got: ${cookie}`);
  });
});
