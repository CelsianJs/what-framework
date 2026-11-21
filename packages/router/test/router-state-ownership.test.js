// Route state belongs to the <Router> that shows it and to the navigation that
// made it, and every decision a navigation makes is made once:
//   - a nested Router has state of its own: on the server it never writes its
//     parent's (a sibling that renders after it, or later in a stream, still
//     reads the outer route), and in the browser it does not take over the
//     tab's params, pattern or the routes navigate() prepares against;
//   - a navigation runs its middleware once: the render shows the verdict it
//     reached (a redirect, a decline, what an async middleware threw), and a
//     route it declined never preloads;
//   - a navigation that something supersedes (its own middleware calling
//     navigate()) writes nothing more and preloads nothing;
//   - the router commits the URL the address bar commits (dot segments
//     resolved), and splits it as URL does ('??a=1' is the key '?a');
//   - on a server nothing navigates: navigate() redirects the response, a
//     redirect() thrown from a component body redirects it too, and nothing a
//     render does reaches the module state a later render reads.
//
// Its own file: the router keeps module-scoped URL state.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });

const { h, mount, settled, ErrorBoundary, Suspense } = await import('what-core');
const { query } = await import('what-core/data');
const server = await import('../../server/src/index.js');
const { Router, navigate, route, redirect, afterNavigate } = await import('../src/index.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const read = () => [route.path, route.params.id, route.query.q, route.hash].join('|');
const home = { path: '/', component: () => h('p', null, 'home') };
const request = (path) => new Request('http://app.test' + path);
async function collect(stream) {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

let stop = () => {};
afterEach(async () => {
  stop();
  stop = () => {};
  await navigate('/', { transition: false, flushSync: true });
});

function show(routes) {
  const host = document.getElementById('app');
  stop = mount(h(ErrorBoundary, { fallback: ({ error }) => 'error:' + error.code }, h(Router, { routes })), host);
  return host;
}

describe('a nested Router has route state of its own', () => {
  it('on the server, in a string render and in a boundary a stream renders later', async () => {
    const gate = Promise.withResolvers();
    const inner = [{ path: '/embedded/:id', component: () => h('p', null, 'inner=' + read()) }];
    const Late = () => {
      query('nested-router-late', () => gate.promise)();
      return h('p', null, 'late=' + read());
    };
    const outer = [{
      path: '/main/:id',
      component: () => [
        h(() => h('p', null, 'before=' + read())),
        h(Suspense, { fallback: h('p', null, 'waiting') }, h(Late)),
        h(Router, { routes: inner, url: '/embedded/2?q=inner#two' }),
        h(() => h('p', null, 'after=' + read())),
      ],
    }];
    const outerState = /\/main\/1\|1\|outer\|#one/;
    gate.resolve();
    const { body } = await server.renderToStringAsync(h(Router, { routes: outer }), { request: request('/main/1?q=outer#one') });
    assert.match(body, new RegExp('before=' + outerState.source));
    assert.match(body, /inner=\/embedded\/2\|2\|inner\|#two/);
    assert.match(body, new RegExp('after=' + outerState.source));
    const streamed = await collect(server.renderToStream(h(Router, { routes: outer }), { request: request('/main/1?q=outer#one') }));
    assert.match(streamed, new RegExp('late=' + outerState.source));
    assert.match(streamed, new RegExp('after=' + outerState.source));
  });

  it('in the browser, the outer Router keeps the tab\'s params and the routes navigate() prepares', async () => {
    const seen = [];
    const inner = [{ path: '/shop/:id', component: () => h('i', null, 'inner:' + route.params.id) }];
    const host = show([home, {
      path: '/shop/:id',
      preload: ({ params }) => { seen.push('outer preload ' + params.id); },
      component: () => [h(Router, { routes: inner }), h(() => h('b', null, () => 'outer:' + route.params.id))],
    }]);
    await navigate('/shop/7', { transition: false });
    assert.equal(host.textContent, 'inner:7outer:7');
    await navigate('/shop/8', { transition: false });
    assert.equal(host.textContent, 'inner:8outer:8');
    assert.deepEqual(seen, ['outer preload 7', 'outer preload 8']);
  });
});

describe('a navigation decides once', () => {
  it('runs the middleware once, before the preload', async () => {
    const calls = [];
    const host = show([home, {
      path: '/target',
      middleware: [() => { calls.push('middleware'); }],
      preload: () => { calls.push('preload'); return 'loaded'; },
      component: ({ data }) => h('p', null, data),
    }]);
    await navigate('/target', { transition: false });
    assert.equal(host.textContent, 'loaded');
    assert.deepEqual(calls, ['middleware', 'preload']);
  });

  it('shows what an async middleware threw, having started it once and preloaded nothing', async () => {
    let calls = 0;
    let preloads = 0;
    const host = show([home, {
      path: '/async',
      middleware: [async () => { calls++; throw new Error('rejected'); }],
      preload: () => { preloads++; },
      component: () => 'async',
    }]);
    await navigate('/async', { transition: false });
    await settled();
    assert.deepEqual([host.textContent, calls, preloads], ['error:ERR_ASYNC_MIDDLEWARE', 1, 0]);
  });

  it('follows the redirect its middleware returned the one time it ran', async () => {
    let once = true;
    const calls = [];
    const host = show([home, {
      path: '/old',
      middleware: [() => {
        if (once) { once = false; return '/new'; }
        return true;
      }],
      preload: () => { calls.push('old preload'); },
      component: () => 'old page',
    }, { path: '/new', component: () => 'new page' }]);
    await navigate('/old', { transition: false });
    await tick();
    assert.deepEqual([route.path, host.textContent, calls], ['/new', 'new page', []]);
  });

  it('stops when its middleware starts another navigation: the obsolete route never preloads', async () => {
    const calls = [];
    const after = [];
    const off = afterNavigate((to) => after.push(to));
    try {
      const host = show([home, {
        path: '/old',
        middleware: [() => { void navigate('/new', { transition: false }); }],
        preload: () => { calls.push('old preload'); },
        component: () => 'old',
      }, {
        path: '/new',
        preload: () => { calls.push('new preload'); return 'new'; },
        component: ({ data }) => data,
      }]);
      await navigate('/old', { transition: false });
      await tick();
      assert.deepEqual([route.path, host.textContent, after, calls], ['/new', 'new', ['/new'], ['new preload']]);
    } finally {
      off();
    }
  });
});

describe('the URL as the address bar has it', () => {
  it('commits the URL with its dot segments resolved', async () => {
    const host = show([home, { path: '/find', component: () => 'search' }]);
    await navigate('/old/../find?q=red?blue#one#two', { transition: false });
    assert.deepEqual([location.pathname, route.path, route.url, route.hash, host.textContent],
      ['/find', '/find', '/find?q=red?blue#one#two', '#one#two', 'search']);
  });

  it('splits the query as URL does, a key beginning with "?" included, on the server and in the browser', async () => {
    const url = '/search??term=warm?cold#one#two?three';
    const expected = [...new URL(url, 'http://x').searchParams];
    const seen = [];
    const routes = [{
      path: '/search',
      middleware: [({ query: q }) => { seen.push(Object.entries(q)); }],
      preload: ({ query: q }) => { seen.push(Object.entries(q)); },
      component: ({ query: q }) => {
        seen.push(Object.entries(q), Object.entries(route.query));
        return null;
      },
    }];
    await server.renderToStringAsync(h(Router, { routes }), { request: request(url) });
    assert.deepEqual(seen, Array(4).fill(expected));
    seen.length = 0;
    show([home, ...routes]);
    await navigate(url, { transition: false });
    assert.deepEqual(seen, Array(4).fill(expected));
  });
});

describe('a server never navigates', () => {
  it('navigate() during a render redirects its response, and a later render shows its own page', async () => {
    const routes = [
      { path: '/', component: () => { navigate('/dashboard'); return h('p', null, 'landing'); } },
      { path: '/dashboard', loading: () => h('p', null, 'dashboard loading'), component: () => h('p', null, 'dashboard') },
      { path: '/products', component: () => h('p', null, 'products') },
    ];
    const response = server.createResponse();
    await server.renderToStringAsync(h(Router, { routes }), { request: request('/'), response });
    assert.deepEqual([response.status, response.location], [302, '/dashboard']);
    for (const render of [
      async () => (await server.renderToStringAsync(h(Router, { routes }), { request: request('/products') })).body,
      () => collect(server.renderToStream(h(Router, { routes }), { request: request('/products') })),
    ]) {
      const html = await render();
      assert.match(html, /products/);
      assert.doesNotMatch(html, /loading/);
    }
    assert.equal(route.isNavigating, false);
  });

  it('a redirect() thrown from a component body redirects the response', async () => {
    const Guarded = () => redirect('/login');
    const routes = [{ path: '/private', component: () => h('section', null, h(Guarded)) }];
    const response = server.createResponse();
    await server.renderToStringAsync(h(Router, { routes }), { request: request('/private'), response });
    assert.deepEqual([response.status, response.location], [302, '/login']);
  });
});
