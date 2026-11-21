// A server render's route state is its own. Overlapping requests each render
// their own URL, params, query and hash, whichever order they resume in, in a
// layout, after an await and in a <Suspense> boundary that renders later
// (interleaved-renders.js; server-request-state-no-als.test.js runs it
// without AsyncLocalStorage); the
// route's middleware runs before its preload; redirects answer with the
// response; and a server render never writes the browser's router state.
//
// No DOM: a server process has none, so the client's route state is the root
// URL with no params, and any server write to it would show.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderInterleaved } from './interleaved-renders.js';

const { h, Suspense } = await import('what-core');
const { query } = await import('what-core/data');
const server = await import('../../server/src/index.js');
const { Router, Link, redirect, route, useParams, useSearch, useRoute, beforeNavigate } = await import('../src/index.js');

async function collect(stream) {
  let html = '';
  for await (const chunk of stream) html += chunk;
  return html;
}

const clientState = () => ({ url: route.url, path: route.path, hash: route.hash, params: { ...route.params }, query: { ...route.query } });
const initial = clientState();

describe('<Router> state on the server is per request', () => {
  it('keeps 120 interleaved, paused renders apart, whatever order they resume in', async () => {
    const { results, client } = await renderInterleaved({ server, h, Suspense, query, Router, route, useParams, useSearch, useRoute });
    for (const { i, foreign, fields } of results) {
      assert.deepEqual(foreign, [], `render ${i} shows another request's route state`);
      for (const [name, value] of Object.entries(fields)) assert.equal(value, 'own', `render ${i}: ${name}`);
    }
    assert.deepEqual(clientState(), initial, 'no server render wrote the browser\'s route state');
    assert.deepEqual(client, initial);
  });

  it('shows the request URL in route accessors and active links outside the matched page', async () => {
    const routes = [{ path: '/docs/:page', component: ({ params }) => h('p', null, params.page) }];
    const Shell = ({ children }) => h('div', null, h(Link, { href: '/docs/intro' }, 'Intro'), h(Link, { href: '/blog' }, 'Blog'), children);
    const { body } = await server.renderToStringAsync(h(Router, { routes, globalLayout: Shell }), {
      request: new Request('http://app.test/docs/intro?from=nav#top'),
    });
    assert.match(body, /<a [^>]*href="\/docs\/intro" class="active exact-active"/);
    assert.match(body, /<a [^>]*href="\/blog">/);
    const { body: atProp } = await server.renderToStringAsync(h(Router, { routes, url: '/docs/api#x' }), {
      request: new Request('http://app.test/docs/intro'),
    });
    assert.match(atProp, />api</);
  });
});

describe('route middleware on the server', () => {
  it('runs before the preload, which never runs for a route it declines', async () => {
    for (const verdict of [false, '/login', 'redirect']) {
      const calls = [];
      const routes = [
        {
          path: '/private/:id',
          middleware: [({ params }) => {
            calls.push('middleware ' + params.id);
            return verdict === 'redirect' ? redirect('/login') : verdict;
          }],
          preload: () => { calls.push('preload'); return 'secret'; },
          component: ({ data }) => h('p', null, data),
        },
        { path: '/login', component: () => h('p', null, 'login') },
      ];
      await collect(server.renderToStream(h(Router, { routes }), { request: new Request('http://app.test/private/1') }));
      assert.deepEqual(calls, ['middleware 1'], `verdict ${verdict}`);
    }
    const calls = [];
    const routes = [{
      path: '/open',
      middleware: [() => { calls.push('middleware'); }],
      preload: () => { calls.push('preload'); return 'data'; },
      component: ({ data }) => h('p', null, data),
    }];
    const { body } = await server.renderToStringAsync(h(Router, { routes }), { request: new Request('http://app.test/open') });
    assert.deepEqual(calls, ['middleware', 'preload']);
    assert.match(body, />data</);
  });

  it('answers a middleware redirect with a redirect response, not a client navigation', async () => {
    const routes = [
      { path: '/old', middleware: [() => '/new?from=old'], component: () => h('p', null, 'old') },
      { path: '/thrown', middleware: [() => redirect('/new')], component: () => h('p', null, 'thrown') },
      { path: '/new', component: () => h('p', null, 'new') },
    ];
    for (const [path, location] of [['/old', '/new?from=old'], ['/thrown', '/new']]) {
      const response = server.createResponse();
      await server.renderToStringAsync(h(Router, { routes }), { request: new Request('http://app.test' + path), response });
      assert.equal(response.status, 302, path);
      assert.equal(response.location, location, path);
    }
    assert.equal(route.isNavigating, false, 'the browser\'s router did not start a navigation');
    assert.deepEqual(clientState(), initial);
  });
});

describe('the query string on the server', () => {
  it('keeps a second "?" in the value, as URL parses it, for the preload and the page', async () => {
    const routes = [{
      path: '/search',
      preload: ({ query }) => query.q,
      component: ({ query, data }) => h('p', null, query.q + '|' + data + '|' + route.query.q),
    }];
    const { body } = await server.renderToStringAsync(h(Router, { routes }), {
      request: new Request('http://app.test/search?q=a?b=c&n=1#frag?x'),
    });
    const expected = new URL('http://app.test/search?q=a?b=c&n=1#frag?x').searchParams.get('q');
    assert.equal(expected, 'a?b=c');
    assert.match(body, /a\?b=c\|a\?b=c\|a\?b=c/);
  });
});

describe('navigation hooks during a server render', () => {
  it('keeps no hook a component subscribes while it renders on the server', async () => {
    const hooks = [];
    function Page() {
      const stop = beforeNavigate(() => { hooks.push('before'); });
      assert.equal(typeof stop, 'function');
      return h('p', null, 'page');
    }
    for (let i = 0; i < 3; i++) {
      await server.renderToStringAsync(h(Router, { routes: [{ path: '/', component: Page }] }), { request: new Request('http://app.test/') });
    }
    const { navigate } = await import('../src/index.js');
    await navigate('/elsewhere');
    assert.deepEqual(hooks, []);
  });
});
