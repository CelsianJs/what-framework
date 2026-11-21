// A cached (ISR) route and the per-request response API (security review #1,
// functional review M2 and M3).
//
// The cache path ignored everything a render set through the response API: a
// loader that set `cache-control: private` or a cookie was stored as public
// and served to the next visitor, the cookie was dropped, a redirect lost its
// Location, and the first visitor disconnecting aborted the regeneration every
// other visitor was waiting on.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h, getResponse } from 'what-core';
import { createCacheEngine, createMemoryStore } from 'what-isr';
import { createRequestHandler } from '../src/index.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function handlerFor(routes) {
  const cache = createCacheEngine({ store: createMemoryStore() });
  return { cache, handle: createRequestHandler({ routes, cache, csrf: false }) };
}

function cookieOf(user) {
  return { headers: { cookie: `session=${user}` } };
}

describe('what makes a cached route\'s render private', () => {
  it('a loader that marks the page private is never stored, and each visitor gets their own page (the review\'s balance)', async () => {
    const { handle } = handlerFor([{
      path: '/account',
      page: { mode: 'hybrid', revalidate: 60 },
      loader: ({ request, response }) => {
        response.setHeader('cache-control', 'private, no-store');
        return { user: /session=(\w+)/.exec(request.headers.get('cookie'))[1] };
      },
      component: ({ loaderData }) => h('p', null, `balance of ${loaderData.user}`),
    }]);
    const alice = await handle(new Request('http://x/account', cookieOf('alice')));
    assert.equal(alice.headers.get('cache-control'), 'private, no-store');
    assert.match(await alice.text(), /balance of alice/);
    const bob = await handle(new Request('http://x/account', cookieOf('bob')));
    assert.equal(bob.headers.get('x-what-cache'), 'MISS');
    const html = await bob.text();
    assert.match(html, /balance of bob/);
    assert.doesNotMatch(html, /alice/);
  });

  it('a render that sets a cookie is private: the cookie reaches its own visitor only and is never replayed', async () => {
    let renders = 0;
    const { handle } = handlerFor([{
      path: '/welcome',
      page: { mode: 'static' },
      loader: ({ response }) => { renders++; response.setHeader('set-cookie', `visit=${renders}; Path=/`); return {}; },
      component: () => h('p', null, 'welcome'),
    }]);
    const first = await handle(new Request('http://x/welcome'));
    assert.deepEqual(first.headers.getSetCookie(), ['visit=1; Path=/']);
    assert.equal(first.headers.get('cache-control'), 'private, no-store');
    const second = await handle(new Request('http://x/welcome'));
    assert.equal(second.headers.get('x-what-cache'), 'MISS', 'a render with a cookie was stored');
    assert.deepEqual(second.headers.getSetCookie(), ['visit=2; Path=/']);
  });

  it('a component\'s cookie makes the render private too', async () => {
    const { handle, cache } = handlerFor([{
      path: '/c',
      page: { mode: 'static' },
      component: () => { getResponse().setHeader('set-cookie', 'seen=1'); return h('p', null, 'c'); },
    }]);
    await handle(new Request('http://x/c'));
    assert.equal(await cache.store.get(cache.keyFor({ path: '/c', query: {}, config: { mode: 'static' } })), null);
    assert.equal((await handle(new Request('http://x/c'))).headers.get('x-what-cache'), 'MISS');
  });

  it('reading a request header the cache key does not vary on keeps the render out of the cache', async () => {
    const warn = console.warn;
    const warnings = [];
    console.warn = (message) => warnings.push(message);
    try {
      const { handle } = handlerFor([{
        path: '/me',
        page: { mode: 'hybrid', revalidate: 60 },
        loader: ({ request }) => ({ user: /session=(\w+)/.exec(request.headers.get('cookie') || '')?.[1] ?? 'nobody' }),
        component: ({ loaderData }) => h('p', null, `hello ${loaderData.user}`),
      }]);
      assert.match(await (await handle(new Request('http://x/me', cookieOf('alice')))).text(), /hello alice/);
      const bob = await handle(new Request('http://x/me', cookieOf('bob')));
      assert.equal(bob.headers.get('x-what-cache'), 'MISS');
      assert.match(await bob.text(), /hello bob/);
      assert.match(warnings.join('\n'), /read the request header\(s\) cookie/);
    } finally {
      console.warn = warn;
    }
  });

  it('a header the route varies on may be read: the render is cached per value', async () => {
    let renders = 0;
    const { handle } = handlerFor([{
      path: '/lang',
      page: { mode: 'hybrid', revalidate: 60, vary: ['accept-language'] },
      loader: ({ request }) => { renders++; return { lang: request.headers.get('accept-language') }; },
      component: ({ loaderData }) => h('p', null, `lang ${loaderData.lang}`),
    }]);
    const de = { headers: { 'accept-language': 'de' } };
    await handle(new Request('http://x/lang', de));
    const again = await handle(new Request('http://x/lang', de));
    assert.equal(again.headers.get('x-what-cache'), 'HIT');
    assert.match(await again.text(), /lang de/);
    assert.equal(renders, 1);
  });
});

describe('what a cached entry keeps', () => {
  it('the page\'s own headers are stored and replayed on a HIT; the engine owns Cache-Control', async () => {
    const { handle } = handlerFor([{
      path: '/doc',
      page: { mode: 'static', revalidate: 60 },
      loader: ({ response }) => {
        response.setHeader('x-custom', 'yes');
        response.setHeader('content-language', 'en');
        response.setHeader('cache-control', 'public, max-age=5');
        return {};
      },
      component: () => h('p', null, 'doc'),
    }]);
    const miss = await handle(new Request('http://x/doc'));
    assert.equal(miss.headers.get('x-custom'), 'yes');
    const hit = await handle(new Request('http://x/doc'));
    assert.equal(hit.headers.get('x-what-cache'), 'HIT');
    assert.equal(hit.headers.get('x-custom'), 'yes');
    assert.equal(hit.headers.get('content-language'), 'en');
    assert.match(hit.headers.get('cache-control'), /^public, s-maxage=60/);
  });

  it('a redirect keeps its status and Location, and is not stored', async () => {
    const { handle } = handlerFor([{
      path: '/moved',
      page: { mode: 'static' },
      loader: ({ response }) => response.redirect('/new', 301),
      component: () => h('p', null, 'never'),
    }]);
    for (let i = 0; i < 2; i++) {
      const res = await handle(new Request('http://x/moved'));
      assert.equal(res.status, 301);
      assert.equal(res.headers.get('location'), '/new');
      assert.equal(res.headers.get('x-what-cache'), 'MISS');
      assert.equal(res.headers.get('cache-control'), 'private, no-store');
      assert.equal(await res.text(), '');
    }
  });

  it('another status keeps its status and headers, and is not stored', async () => {
    const { handle } = handlerFor([{
      path: '/gone',
      page: { mode: 'static' },
      loader: ({ response }) => { response.setStatus(410); response.setHeader('x-reason', 'retired'); return {}; },
      component: () => h('p', null, 'gone'),
    }]);
    const res = await handle(new Request('http://x/gone'));
    assert.equal(res.status, 410);
    assert.equal(res.headers.get('x-reason'), 'retired');
    assert.equal((await handle(new Request('http://x/gone'))).headers.get('x-what-cache'), 'MISS');
  });
});

describe('a shared regeneration is not tied to one visitor', () => {
  function slowRoute(log) {
    return [{
      path: '/slow',
      page: { mode: 'static' },
      loader: async ({ signal }) => {
        log.push('loader');
        signal.addEventListener('abort', () => log.push('aborted'));
        await delay(30);
        return { at: 1 };
      },
      component: () => h('p', null, 'slow page'),
    }];
  }

  it('the first visitor disconnecting does not fail the visitor still waiting', async () => {
    const log = [];
    const { handle } = handlerFor(slowRoute(log));
    const first = new AbortController();
    const a = handle(new Request('http://x/slow', { signal: first.signal }));
    await delay(5);
    const b = handle(new Request('http://x/slow'));
    await delay(5);
    first.abort();
    const [ra, rb] = await Promise.allSettled([a, b]);
    assert.equal(ra.status, 'rejected');
    assert.equal(ra.reason.name, 'AbortError');
    assert.equal(rb.status, 'fulfilled');
    assert.equal(rb.value.status, 200);
    assert.match(await rb.value.text(), /slow page/);
    assert.deepEqual(log, ['loader'], 'the shared render ran once and was not aborted');
  });

  it('when every waiting visitor has gone, the render is told to stop', async () => {
    const log = [];
    const { handle } = handlerFor(slowRoute(log));
    const one = new AbortController();
    const two = new AbortController();
    const a = handle(new Request('http://x/slow', { signal: one.signal }));
    await delay(5);
    const b = handle(new Request('http://x/slow', { signal: two.signal }));
    const settled = Promise.allSettled([a, b]);
    await delay(5);
    one.abort();
    await delay(1);
    assert.deepEqual(log, ['loader']);
    two.abort();
    await settled;
    assert.deepEqual(log, ['loader', 'aborted']);
  });
});
