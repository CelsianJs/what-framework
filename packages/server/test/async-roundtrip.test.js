// Async computeds through the server and back (docs/ASYNC.md, "Server
// rendering"): a not-ready read suspends its <Suspense> on the server, the
// settled values travel in the hydration data channel, and the hydrating
// client adopts them: no client fetch, no fallback flash.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let cleanup;
let core;
let internal;
let server;
let collect;
let content;

before(async () => {
  ({ cleanup } = installDOM());
  core = await import('what-core');
  internal = await import('what-core/internal');
  server = await import('../src/index.js');
  ({ collect, content } = await import('./stream-helpers.js'));
});
after(() => cleanup());

const drain = () => new Promise((resolve) => setImmediate(resolve));
const bodyOf = (html) => html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));

// An API that, like fetch, sends nothing when its signal is already aborted,
// and records where each request was made.
function api(calls) {
  const request = (name, value, signal) => {
    if (signal.aborted) return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    calls.push(`${name}@${internal.getServerContext() ? 'server' : 'client'}`);
    return new Promise((resolve) => setTimeout(() => resolve(value), 2));
  };
  return {
    user: (signal) => request('user', { name: 'Ada', teamId: 7 }, signal),
    team: (id, signal) => request('team', { name: 'team ' + id }, signal),
    posts: (signal) => request('posts', ['p1', 'p2'], signal),
  };
}

function app(calls) {
  const { h, computed, Suspense } = core;
  const remote = api(calls);
  function Profile() {
    const user = computed(({ signal }) => remote.user(signal));
    const team = computed(({ signal }) => remote.team(user().teamId, signal));
    return h('section', null, h('h1', null, () => user().name), h('p', { id: 'team' }, () => team().name));
  }
  function Posts() {
    const posts = computed(({ signal }) => remote.posts(signal));
    return h('ul', null, () => posts().map((p) => h('li', { key: p }, p)));
  }
  return function App() {
    return h('main', null, h(Suspense, { fallback: h('i', { id: 'fb' }, 'loading') }, h(Profile), h(Posts)));
  };
}

// Hydrate `container`, recording whether the fallback ever showed.
async function hydrateWatching(App, container) {
  let flashed = false;
  const observer = new window.MutationObserver(() => { if (container.querySelector('#fb')) flashed = true; });
  observer.observe(container, { childList: true, subtree: true });
  internal.__resetHydrationData();
  core.hydrate(core.h(App, {}), container);
  if (container.querySelector('#fb')) flashed = true;
  for (let i = 0; i < 4; i++) await drain();
  observer.disconnect();
  return flashed;
}

describe('async computeds through the server and back', () => {
  it('renderToString cannot wait: the boundary renders its fallback', () => {
    const calls = [];
    const html = server.renderToString(core.h(app(calls), {}));
    assert.equal(html, '<main><i id="fb">loading</i></main>');
  });

  it('renderToString with no boundary throws what was not ready, with a message that says so', () => {
    const { h, computed } = core;
    function Bare() {
      const value = computed(async () => 'later');
      return h('p', null, () => value());
    }
    assert.throws(() => server.renderToString(h(Bare, {})), (error) => /read before it settled/.test(error.message));
  });

  it('renderDocument resolves every value, sends it once, and the client adopts it: no fetch, no fallback', async () => {
    const calls = [];
    const App = app(calls);
    const html = await server.renderDocument({ default: App });
    assert.match(content(html), /<h1>Ada<\/h1><p id="team">team 7<\/p><\/section><ul><li>p1<\/li><li>p2<\/li><\/ul>/);
    assert.deepEqual(calls.sort(), ['posts@server', 'team@server', 'user@server']);
    const payload = JSON.parse(html.match(/<script id="__what_data" type="application\/json">(.*?)<\/script>/)[1]);
    assert.deepEqual(Object.values(payload.owned).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      [['p1', 'p2'], { name: 'Ada', teamId: 7 }, { name: 'team 7' }]);
    document.body.innerHTML = bodyOf(html);
    const h1 = document.querySelector('h1');
    calls.length = 0;
    const flashed = await hydrateWatching(App, document.body);
    assert.deepEqual(calls, [], 'the client fetched nothing');
    assert.equal(flashed, false, 'the fallback never showed');
    assert.equal(document.querySelector('h1'), h1, 'the server\'s DOM was adopted');
    assert.equal(document.querySelector('main').textContent, 'Adateam 7p1p2');
  });

  it('renderToStream streams the boundary, and the client adopts the streamed values', async () => {
    const calls = [];
    const App = app(calls);
    const html = await collect(server.renderToStream(core.h(App, {})));
    assert.match(html, /<i id="fb">loading<\/i>/, 'the shell carries the fallback');
    document.body.innerHTML = `<div id="app">${html}</div>`;
    internal.__resetHydrationData();
    core.applyStreamedBoundaries();
    const container = document.getElementById('app');
    assert.equal(container.querySelector('main').textContent, 'Adateam 7p1p2');
    calls.length = 0;
    const flashed = await hydrateWatching(App, container);
    assert.deepEqual(calls, []);
    assert.equal(flashed, false);
    assert.equal(container.querySelector('main').textContent, 'Adateam 7p1p2');
  });

  it('a hydrated async computed still refetches when what it read changes', async () => {
    const { h, computed, signal, Suspense } = core;
    const calls = [];
    const id = signal(1);
    function Page() {
      const user = computed(({ signal: abort }) => {
        const n = id();
        if (abort.aborted) return Promise.reject(new Error('aborted'));
        calls.push(`user${n}@${internal.getServerContext() ? 'server' : 'client'}`);
        return Promise.resolve('user' + n);
      });
      return h(Suspense, { fallback: 'fb' }, h('p', null, () => user()));
    }
    const html = await server.renderDocument({ default: Page });
    document.body.innerHTML = bodyOf(html);
    calls.length = 0;
    await hydrateWatching(Page, document.body);
    assert.deepEqual(calls, []);
    id(2);
    for (let i = 0; i < 3; i++) await drain();
    assert.deepEqual(calls, ['user2@client']);
    assert.equal(document.querySelector('p').textContent, 'user2');
  });

  it('a value the server failed to get is adopted as failed: the client\'s error boundary shows, nothing refetches', async () => {
    const { h, computed, ErrorBoundary } = core;
    const calls = [];
    function Page() {
      const user = computed(({ signal }) => {
        if (signal.aborted) return Promise.reject(new Error('aborted'));
        calls.push(internal.getServerContext() ? 'server' : 'client');
        return Promise.reject(new Error('no user'));
      });
      return h(ErrorBoundary, { fallback: ({ error }) => h('em', null, 'failed: ' + error.message) }, h('p', null, () => user()));
    }
    const html = await server.renderDocument({ default: Page }, {}, { onError: () => {} });
    document.body.innerHTML = bodyOf(html);
    calls.length = 0;
    const consoleError = console.error;
    console.error = () => {};
    try {
      await hydrateWatching(Page, document.body);
    } finally {
      console.error = consoleError;
    }
    assert.deepEqual(calls, []);
    assert.match(document.body.textContent, /failed: /);
  });
});
