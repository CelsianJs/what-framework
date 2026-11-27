// A server render of a request below the base path renders the page the
// browser shows at that URL: the route matches the URL without the base, its
// links render below the base, and the page hydrates clean. A request outside
// the base is not routed. A redirect (a middleware verdict, redirect(),
// navigate() in a render) answers with a Location below the base.
//
// Its own file: the router keeps module-scoped URL state and its base, and
// this one starts at /app/users/7 below the base /app.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let core;
let internal;
let server;
let router;
before(async () => {
  env = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://app.test/app/users/7' });
  core = await import('what-core');
  internal = await import('what-core/internal');
  server = await import('../../server/src/index.js');
  router = await import('../src/index.js');
  router.setBase('/app');
});
after(() => {
  router.setBase('');
  env.cleanup();
});

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function collect(stream) {
  let html = '';
  for await (const chunk of stream) html += chunk;
  return html;
}

function app() {
  const { h } = core;
  const { Router, Link, navigate, redirect, route } = router;
  const routes = [
    { path: '/', component: () => h('p', null, 'home') },
    { path: '/users/:id', component: ({ params }) => h('h1', null, 'user ', params.id) },
    { path: '/old', middleware: [() => '/login?from=old'], component: () => h('p', null, 'old') },
    { path: '/thrown', component: () => redirect('/login') },
    { path: '/navigates', component: () => { navigate('next'); return null; } },
    { path: '*', component: () => h('p', null, 'catch-all ', () => route.path) },
  ];
  const Shell = ({ children }) => h('div', null,
    h('nav', null, h(Link, { href: '/' }, 'home'), h(Link, { href: '/users' }, 'users'), h(Link, { href: '8' }, 'next')),
    children);
  return (props) => h(Router, { routes, globalLayout: Shell, fallback: () => h('p', null, 'not found'), ...props });
}

async function render(url, props = {}) {
  const response = server.createResponse();
  const { body } = await server.renderToStringAsync(core.h(app(), props), { request: new Request('http://app.test' + url), response });
  return { body, response };
}

describe('a server render below the base path', () => {
  it('renders the route the URL without the base matches, with links below the base, and the page hydrates clean', async () => {
    const App = app();
    const html = await collect(server.renderToStream(core.h(App, {}), { request: new Request('http://app.test/app/users/7') }));
    assert.match(html, /<h1[^>]*>user (<!--[^>]*-->)?7/);
    assert.match(html, /<a [^>]*href="\/app\/"[^>]*>home/);
    assert.match(html, /<a [^>]*href="\/app\/users" class="active"[^>]*>users/);
    assert.match(html, /<a [^>]*href="8"[^>]*>next/);
    document.body.innerHTML = `<div id="app">${html}</div>`;
    internal.__resetHydrationData();
    const heading = document.querySelector('h1');
    const mismatches = [];
    const stop = core.hydrate(core.h(App, {}), document.getElementById('app'), { onHydrationError: (info) => mismatches.push(info) });
    await tick();
    assert.deepEqual(mismatches, []);
    assert.equal(document.querySelector('h1'), heading, 'the server\'s heading is adopted');
    assert.equal(document.querySelector('nav a').getAttribute('href'), '/app/');
    stop();
  });

  it('renders the base itself as the root, and routes nothing outside the base, a catch-all included', async () => {
    assert.match((await render('/app')).body, /home/);
    assert.match((await render('/app/?q=1')).body, /home/);
    assert.match((await render('/app/anything')).body, /catch-all (<!--[^>]*-->)?\/anything/);
    for (const url of ['/', '/users/7', '/application/users/7']) {
      const { body } = await render(url);
      assert.match(body, /not found/, url);
      assert.doesNotMatch(body, /catch-all|<h1/, url);
    }
  });

  it('shows the `url` prop as a URL of the app', async () => {
    assert.match((await render('/app/', { url: '/users/3' })).body, /user (<!--[^>]*-->)?3/);
  });

  it('answers a redirect with a Location below the base', async () => {
    for (const [url, location] of [['/app/old', '/app/login?from=old'], ['/app/thrown', '/app/login'], ['/app/navigates', '/app/next']]) {
      const { response } = await render(url);
      assert.equal(response.status, 302, url);
      assert.equal(response.location, location, url);
    }
  });
});
