// createRequestHandler({ basePath }) strips the base from a request's path on a
// segment boundary before matching: '/app/x' matches '/x' and '/app' matches
// '/', written '/app' or '/app/' (as Vite writes its base), while
// '/application' is not below '/app' and is matched as it is. Before, the
// prefix was cut wherever it matched, so '/application' was matched as
// 'lication', and a base written with its trailing slash left '/app/x' as
// 'x', which no route matches.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { Router, setBase } from 'what-router';
import { createCacheEngine, createMemoryStore } from 'what-isr';
import { createRequestHandler, createRouteRenderer } from '../src/index.js';

const routes = [
  { path: '/', component: () => h('p', null, 'home'), mode: 'server' },
  { path: '/x', component: () => h('p', null, 'page x'), mode: 'server' },
  { path: '/application', component: () => h('p', null, 'application page'), mode: 'server' },
];

async function get(handler, path) {
  const response = await handler(new Request('http://app.test' + path));
  return { status: response.status, body: await response.text() };
}

describe('createRequestHandler basePath', () => {
  for (const basePath of ['/app', '/app/']) {
    it(`strips ${basePath} on a segment boundary`, async () => {
      const handler = createRequestHandler({ routes, basePath, csrf: false });
      assert.match((await get(handler, '/app/x')).body, /page x/);
      assert.match((await get(handler, '/app/')).body, /home/);
      assert.match((await get(handler, '/app')).body, /home/);
      assert.match((await get(handler, '/app?q=1')).body, /home/);
      assert.match((await get(handler, '/application')).body, /application page/);
    });
  }
});

// A request outside the base is matched as it is, but it is not the page its
// cache key names: '/about' and '/app/about' are both the key '/about', and a
// Router below the base routes nothing at '/about'. It is rendered as its own
// and never stored, so it cannot replace the page every visitor below the
// base is served. Before, its render (the Router's fallback) was stored and
// served at '/app/about'.
describe('createRequestHandler basePath and the cache', () => {
  it('never stores the render of a request outside the base', async () => {
    setBase('/app');
    try {
      const pages = [{ path: '/about', component: () => h('h1', null, 'about') }];
      const App = () => h(Router, { routes: pages, fallback: () => h('p', null, 'not found') });
      const cached = [{ path: '/about', component: App, mode: 'static', page: { mode: 'static', revalidate: 60 } }];
      const handler = createRequestHandler({ routes: cached, cache: createCacheEngine({ store: createMemoryStore() }), basePath: '/app', csrf: false });
      const outside = await handler(new Request('http://app.test/about'));
      assert.equal(outside.headers.get('x-what-cache'), null, 'rendered outside the cache');
      assert.match(await outside.text(), /not found/);
      const below = await handler(new Request('http://app.test/app/about'));
      assert.equal(below.headers.get('x-what-cache'), 'MISS');
      assert.match(await below.text(), /<h1[^>]*>about<\/h1>/);
      const again = await handler(new Request('http://app.test/app/about'));
      assert.equal(again.headers.get('x-what-cache'), 'HIT');
      assert.match(await again.text(), /<h1[^>]*>about<\/h1>/);
    } finally {
      setBase('');
    }
  });
});

// A regeneration no request started (revalidatePath with `regenerate`, a
// scheduler's tick, a stale default entry's refresh) renders the page from a
// GET the engine makes: below the base, as a visitor's request is. Before,
// it was a GET of the path without the base, where a Router below the base
// routes nothing, and its render (the Router's fallback) was stored and
// served to every visitor.
describe('createRequestHandler basePath and a regeneration with no request', () => {
  it('renders the page below the base', async () => {
    setBase('/app');
    try {
      const pages = [{ path: '/about', component: () => h('h1', null, 'about') }];
      const App = () => h(Router, { routes: pages, fallback: () => h('p', null, 'not found') });
      const cached = [{ path: '/about', component: App, mode: 'static', page: { mode: 'static', revalidate: 60 } }];
      const cache = createCacheEngine({ store: createMemoryStore(), render: createRouteRenderer() });
      const handler = createRequestHandler({ routes: cached, cache, basePath: '/app', csrf: false });
      assert.match(await (await handler(new Request('http://app.test/app/about'))).text(), /<h1[^>]*>about<\/h1>/);
      await cache.revalidatePath('/about', { regenerate: true });
      const again = await handler(new Request('http://app.test/app/about'));
      assert.equal(again.headers.get('x-what-cache'), 'HIT', 'served the regenerated entry');
      assert.match(await again.text(), /<h1[^>]*>about<\/h1>/);
      // A match a caller hands the renderer with no request renders as a GET below its base.
      const out = await createRouteRenderer()({ path: '/about', base: '/app', query: {}, params: {}, config: {}, route: cached[0] });
      assert.match(out.html, /<h1[^>]*>about<\/h1>/);
    } finally {
      setBase('');
    }
  });
});
