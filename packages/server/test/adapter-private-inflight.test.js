import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createRequestHandler } from '../src/index.js';
import { createCacheEngine, createMemoryStore } from 'what-isr';
import { h } from 'what-core';

describe('request handler ISR in-flight privacy', () => {
  for (const marker of ['private', 'usedRequestHeaders']) {
    for (const state of ['cold', 'expired']) {
      it(`isolates ${state} concurrent Request objects when render returns ${marker}`, async () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const store = createMemoryStore();
        const calls = [];
        const page = { mode: 'hybrid', revalidate: 60, swr: 0 };
        let now = 0;
        const cache = createCacheEngine({ store, now: () => now, render: async () => ({ html: 'old public' }) });
        if (state === 'expired') {
          await cache.regenerate({ path: '/account', query: {}, config: page });
          now = 120_000;
        }
        const handle = createRequestHandler({
          csrf: false,
          routes: [{ path: '/account', page }], cache,
          render: async ({ request }) => {
            const user = request.headers.get('x-user');
            calls.push(user);
            if (user === 'alice') await gate;
            return { html: user, [marker]: true };
          },
        });
        const get = (user) => handle(new Request('http://local.test/account', { headers: { 'x-user': user } }));
        const alice = get('alice');
        await setImmediate();
        const bob = get('bob');
        await setImmediate();
        assert.deepEqual(calls, ['alice']);
        release();
        const responses = await Promise.all([alice, bob]);
        assert.deepEqual(await Promise.all(responses.map((response) => response.text())), ['alice', 'bob']);
        assert.deepEqual(calls, ['alice', 'bob']);
        for (const response of responses) {
          assert.equal(response.status, 200);
          assert.match(response.headers.get('cache-control'), /private, no-store/);
        }
        const keys = await store.keys();
        assert.equal(keys.length, state === 'expired' ? 1 : 0);
        if (keys.length) assert.equal((await store.get(keys[0])).html, 'old public');
      });
    }
  }

  for (const mode of ['public', 'vary', 'server']) {
    it(`preserves the ${mode} concurrency control`, async () => {
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const store = createMemoryStore();
      const calls = [];
      const page = { mode: mode === 'server' ? 'server' : 'hybrid', revalidate: 60 };
      if (mode === 'vary') page.vary = ['header:x-user'];
      const handle = createRequestHandler({
        csrf: false, routes: [{ path: '/account', page }],
        cache: createCacheEngine({ store }),
        render: async ({ request }) => {
          const user = request.headers.get('x-user');
          calls.push(user);
          await gate;
          return { html: mode === 'public' ? 'public' : user };
        },
      });
      const get = (user) => handle(new Request('http://local.test/account', { headers: { 'x-user': user } }));
      const alice = get('alice');
      const bob = get('bob');
      await setImmediate();
      assert.equal(calls.length, mode === 'public' ? 1 : 2);
      release();
      const responses = await Promise.all([alice, bob]);
      assert.deepEqual(await Promise.all(responses.map((response) => response.text())), mode === 'public' ? ['public', 'public'] : ['alice', 'bob']);
      assert.equal((await store.keys()).length, mode === 'server' ? 0 : mode === 'vary' ? 2 : 1);
      if (mode === 'public') {
        assert.match(responses[0].headers.get('cache-control'), /public/);
        assert.equal((await get('carol')).headers.get('x-what-cache'), 'HIT');
        assert.equal(calls.length, 1);
      } else {
        assert.match(responses[0].headers.get('cache-control'), /private, no-store/);
      }
    });
  }
});

// A cached route's render that reads what its `vary` does not name is private,
// never stored. The Cookie header carries every cookie, so reading it counts
// as reading each cookie the request has; a copy of the request (`clone()`) is
// watched like the request. The request is a real Request, so native code can
// use it whole (`new Request(request)`, `fetch(request)`); used that way it
// carries only the headers the key varies on.
describe('request handler ISR: what a shared render read', () => {
  const cookie = (headers, name) => (new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(headers.get('cookie') || '') || [])[1] || 'anon';
  const Page = ({ loaderData }) => h('p', { id: 'who' }, `signed in as ${loaderData.uid}`);
  const page = { mode: 'hybrid', revalidate: 60 };
  const routes = [
    { path: '/vary-theme', component: Page, loader: ({ request }) => ({ uid: cookie(request.headers, 'uid') }), page: { ...page, vary: ['cookie:theme'] } },
    { path: '/theme-only', component: Page, loader: ({ request }) => ({ uid: cookie(request.headers, 'theme') }), page: { ...page, vary: ['cookie:theme'] } },
    { path: '/clone', component: Page, loader: ({ request }) => ({ uid: cookie(request.clone().headers, 'uid') }), page },
  ];
  const who = async (handle, path, cookieHeader) => {
    const res = await handle(new Request(`http://shop.test${path}`, { headers: { cookie: cookieHeader } }));
    return (/signed in as (\w+)/.exec(await res.text()) || [])[1];
  };

  it('a cookie the route does not vary on, read through the Cookie header or a clone, keeps the page out of the cache', async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const cache = createCacheEngine({ store: createMemoryStore(), logger: { warn() {}, error() {} } });
      const handle = createRequestHandler({ routes, cache });
      for (const path of ['/vary-theme', '/clone']) {
        assert.equal(await who(handle, path, 'uid=alice; theme=dark'), 'alice', path);
        assert.equal(await who(handle, path, 'uid=bob; theme=dark'), 'bob', `${path}: bob never gets alice's page`);
      }
    } finally {
      console.warn = warn;
    }
  });

  it('a render that could only see the cookies its route varies on is still stored', async () => {
    let renders = 0;
    const cache = createCacheEngine({ store: createMemoryStore(), logger: { warn() {}, error() {} } });
    const counted = [{ ...routes[1], loader: (ctx) => { renders++; return routes[1].loader(ctx); } }];
    const handle = createRequestHandler({ routes: counted, cache });
    assert.equal(await who(handle, '/theme-only', 'theme=dark'), 'dark');
    assert.equal(await who(handle, '/theme-only', 'theme=dark'), 'dark');
    assert.equal(renders, 1, 'served from the cache the second time');
  });

  it('the request used whole is a real Request that carries only the keyed headers, so the page is still stored', async () => {
    let renders = 0;
    const seen = [];
    const cache = createCacheEngine({ store: createMemoryStore(), logger: { warn() {}, error() {} } });
    const handle = createRequestHandler({
      cache,
      routes: [{
        path: '/copy',
        component: Page,
        page: { ...page, vary: ['cookie:theme', 'accept-language'] },
        loader: ({ request }) => {
          renders++;
          const copy = new Request(request);
          seen.push([copy.headers.get('cookie'), copy.headers.get('accept-language'), copy.headers.get('authorization'), copy.signal.aborted]);
          return { uid: cookie(copy.headers, 'uid') };
        },
      }],
    });
    const visit = async (cookieHeader) => {
      const res = await handle(new Request('http://shop.test/copy', { headers: { cookie: cookieHeader, 'accept-language': 'fr', authorization: 'Bearer secret' } }));
      return (/signed in as (\w+)/.exec(await res.text()) || [])[1];
    };
    assert.equal(await visit('uid=alice; theme=dark; theme=light'), 'anon');
    assert.equal(await visit('uid=bob; theme=dark'), 'anon');
    assert.deepEqual(seen, [['theme=dark', 'fr', null, false]]);
    assert.equal(renders, 1, 'served from the cache the second time');
  });

  it('a write to the watched headers reaches a copy of the request', async () => {
    const cache = createCacheEngine({ store: createMemoryStore(), logger: { warn() {}, error() {} } });
    let copied;
    const handle = createRequestHandler({
      cache,
      routes: [{
        path: '/write',
        component: Page,
        page,
        loader: ({ request }) => {
          request.headers.set('x-trace', 'abc');
          copied = [new Request(request).headers.get('x-trace'), request.clone().headers.get('x-trace'), request instanceof Request];
          return { uid: 'anon' };
        },
      }],
    });
    await handle(new Request('http://shop.test/write'));
    assert.deepEqual(copied, ['abc', 'abc', true]);
  });
});
