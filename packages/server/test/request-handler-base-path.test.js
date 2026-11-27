// createRequestHandler({ basePath }) strips the base from a request's path on a
// segment boundary before matching: '/app/x' matches '/x' and '/app' matches
// '/', written '/app' or '/app/' (as Vite writes its base), while
// '/application' is not below '/app' and is matched as it is. Before, the
// prefix was cut wherever it matched, so '/application' was matched as
// 'lication', and a base written with its trailing slash left '/app/x' as
// 'x', which no route matches.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h, getResponse } from 'what-core';
import { Router, setBase } from 'what-router';
import { createCacheEngine, createMemoryStore } from 'what-isr';
import { action, createRequestHandler, createRouteRenderer } from '../src/index.js';

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
  for (const basePath of ['/app', '/app/', 'app', 'app/']) {
    it(`strips ${basePath} on a segment boundary`, async () => {
      const handler = createRequestHandler({ routes, basePath, csrf: false });
      assert.match((await get(handler, '/app/x')).body, /page x/);
      assert.match((await get(handler, '/app/')).body, /home/);
      assert.match((await get(handler, '/app')).body, /home/);
      assert.match((await get(handler, '/app?q=1')).body, /home/);
      assert.match((await get(handler, '/application')).body, /application page/);
    });
  }

  // A base written without its leading slash is the same base: a page below
  // it is cached, and a redirect goes below it. Before, 'app' was never a
  // prefix of a path, so every request was outside it, rendered outside the
  // cache, and a 303 answered the relative 'app/thanks'.
  it('reads a base written without its leading slash as the path from the root', async () => {
    action(async () => {
      getResponse().redirect('/thanks');
      return { ok: true };
    }, { id: 'base-path/thanks' });
    const cached = [{ path: '/about', component: () => h('h1', null, 'about'), page: { mode: 'static', revalidate: 60 } }];
    const handler = createRequestHandler({ routes: cached, cache: createCacheEngine({ store: createMemoryStore() }), basePath: 'app/', csrf: false });
    assert.equal((await handler(new Request('http://app.test/app/about'))).headers.get('x-what-cache'), 'MISS');
    assert.equal((await handler(new Request('http://app.test/app/about'))).headers.get('x-what-cache'), 'HIT');
    const posted = await handler(new Request('http://app.test/app/__what_action', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '_action=base-path%2Fthanks',
    }));
    assert.equal(posted.status, 303);
    assert.equal(posted.headers.get('location'), '/app/thanks');
  });

  for (const basePath of ['', '/']) {
    it(`reads ${JSON.stringify(basePath)} as no base`, async () => {
      const handler = createRequestHandler({ routes, basePath, csrf: false });
      assert.match((await get(handler, '/x')).body, /page x/);
      assert.match((await get(handler, '/')).body, /home/);
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

// A path a page redirects to with what-server's response (a loader's
// `response.redirect('/login')`, a component's getResponse().redirect()) is
// answered as written, outside the base, while the same call in a server
// action is a URL of the app (`/app/login`), as the router's redirect() is.
// Left for a decision: prefixing it here would prefix the router's redirects,
// which are below the base already, a second time.
describe('createRequestHandler basePath and a page\'s own redirect', () => {
  it('answers a loader\'s and a component\'s local redirect below the base', { todo: 'a page redirect below the base is a design decision (see the round 8 review-edge report)' }, async () => {
    setBase('/app');
    try {
      const routes = [
        { path: '/a', component: () => h('p', null, 'a'), loader: ({ response }) => { response.redirect('/login'); }, mode: 'server' },
        { path: '/b', component: () => { getResponse().redirect('/login'); return h('p', null, 'b'); }, mode: 'server' },
      ];
      const handler = createRequestHandler({ routes, basePath: '/app', csrf: false });
      for (const path of ['/app/a', '/app/b']) {
        assert.equal((await handler(new Request('http://app.test' + path))).headers.get('location'), '/app/login', path);
      }
    } finally {
      setBase('');
    }
  });
});
