// Deploy adapter core (Phase 7): the Web-Fetch request handler tying route
// match -> ISR cache -> render -> action dispatch -> revalidate webhook.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { createCacheEngine, createMemoryStore, createRevalidateWebhook } from 'what-cache';
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
