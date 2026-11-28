// <Router> rendered on the server shows the URL of the request being rendered
// (or its `url` prop), with the route's `preload` run for that render: the
// page server-renders with its data, the page hydrates clean, and the client
// adopts the preloaded value instead of fetching it again. It used to render
// the root URL's match (or the 404) whatever the request, so a page with a
// route of its own hydrated as a mismatch.
//
// Its own file: the router keeps module-scoped URL state, and this one starts
// at /users/7.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let core;
let data;
let internal;
let server;
let router;
before(async () => {
  env = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://app.test/users/7' });
  core = await import('what-core');
  data = await import('what-core/data');
  internal = await import('what-core/internal');
  server = await import('../../server/src/index.js');
  router = await import('../src/index.js');
});
after(() => env.cleanup());

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function collect(stream) {
  let html = '';
  for await (const chunk of stream) html += chunk;
  return html;
}

function app(calls) {
  const { h, Suspense } = core;
  const user = (id) => data.query(['user', id], async (key) => {
    calls.push({ id: key[1], server: internal.getServerContext() !== null });
    return { name: `user ${key[1]}` };
  });
  const routes = [
    { path: '/', component: () => h('p', null, 'home') },
    { path: '/users/:id', preload: ({ params }) => user(params.id), component: ({ data: u }) => h('h1', null, () => u().name) },
  ];
  return (props) => h(Suspense, { fallback: h('em', null, 'loading') }, h(router.Router, { routes, ...props }));
}

describe('<Router> on the server', () => {
  it('renders the request\'s URL with its preload, and the page hydrates clean, adopting the data', async () => {
    const calls = [];
    const App = app(calls);
    const other = await collect(server.renderToStream(core.h(App, {}), { request: new Request('http://app.test/users/9') }));
    assert.match(other, /user 9/, 'the request\'s URL, not the one this process\'s window shows');
    calls.length = 0;
    const html = await collect(server.renderToStream(core.h(App, {}), { request: new Request('http://app.test/users/7') }));
    assert.match(html, /<h1[^>]*>(<!--\$-->)?user 7/, 'the server rendered the route of the request, with its data');
    assert.deepEqual(calls, [{ id: '7', server: true }]);
    document.body.innerHTML = `<div id="app">${html}</div>`;
    internal.__resetHydrationData();
    core.applyStreamedBoundaries();
    const heading = document.querySelector('h1');
    const mismatches = [];
    const stop = core.hydrate(core.h(App, {}), document.getElementById('app'), { onHydrationError: (info) => mismatches.push(info) });
    await tick();
    assert.deepEqual(mismatches, []);
    assert.equal(document.querySelector('h1'), heading, 'the server\'s heading is adopted');
    assert.equal(document.querySelector('h1').textContent, 'user 7');
    assert.deepEqual(calls, [{ id: '7', server: true }], 'the client fetched nothing');
    stop();
    data.clearCache();
  });

  it('renders the `url` prop when it is given, and the root without a request', async () => {
    const App = app([]);
    const at = (await server.renderToStringAsync(core.h(App, { url: '/users/3' }))).body;
    assert.match(at, /user 3/);
    const root = (await server.renderToStringAsync(core.h(App, {}))).body;
    assert.match(root, /home/);
    assert.equal(location.pathname, '/users/7', 'a server render does not touch the client\'s URL');
  });
});
