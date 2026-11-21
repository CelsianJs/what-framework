// Where the data layer, the async engine, hydration and the router meet: a
// query() read under <Suspense> is server-rendered and streamed, the page
// hydrates (adopting the value, fetching nothing), and then a server action
// that invalidates the key runs while a router navigation with a route
// `preload` is preparing. Each is a transition of its own; neither may hold
// the other forever, the action's refetch shows on the page being left, and
// the navigation commits with the data its preload fetched.
//
// Its own file: the router keeps module-scoped URL state.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

let env;
let core;
let data;
let internal;
let server;
let actions;
let router;
let collect;
let respond = null;
const posts = [];

before(async () => {
  env = installDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://app.test/' });
  // The action endpoint answers when the test says so.
  globalThis.fetch = async (url, init) => {
    posts.push(JSON.parse(init.body));
    const answer = await new Promise((resolve) => { respond = resolve; });
    return { ok: true, status: 200, json: async () => answer };
  };
  core = await import('what-core');
  data = await import('what-core/data');
  internal = await import('what-core/internal');
  server = await import('../src/index.js');
  actions = await import('../src/actions.js');
  router = await import('../../router/src/index.js');
  ({ collect } = await import('./stream-helpers.js'));
});
after(() => env.cleanup());

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// The remote side: each fetch waits until the test answers it.
function remote() {
  const calls = [];
  const fetcher = (key) => {
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    calls.push({ key, resolve, server: internal.getServerContext() !== null });
    return promise;
  };
  return { calls, fetcher };
}

// Each test reads its own key: a hydrating client adopts a key's server value
// once per page (and never after clearCache()).
function app(key, inbox, users) {
  const { h, Suspense } = core;
  function Home() {
    const list = data.query(key, inbox.fetcher);
    return h('main', null, h(Suspense, { fallback: h('em', null, 'loading') }, h('p', { id: 'inbox' }, () => list().join(','))));
  }
  function User({ data: user }) {
    return h('h1', null, () => user().name);
  }
  const routes = [
    { path: '/', component: Home },
    { path: '/users/:id', preload: ({ params }) => data.query(['user', params.id], users.fetcher), component: User },
  ];
  return () => h(router.Router, { routes });
}

async function streamedAndHydrated(App, inbox, first) {
  const rendering = collect(server.renderToStream(core.h(App, {})));
  await tick();
  assert.equal(inbox.calls.length, 1);
  assert.equal(inbox.calls[0].server, true);
  inbox.calls[0].resolve(first);
  const html = await rendering;
  document.body.innerHTML = `<div id="app">${html}</div>`;
  internal.__resetHydrationData();
  core.applyStreamedBoundaries();
  const mismatches = [];
  const stop = core.hydrate(core.h(App, {}), document.getElementById('app'), { onHydrationError: (info) => mismatches.push(info) });
  await tick();
  assert.deepEqual(mismatches, []);
  assert.equal(inbox.calls.length, 1, 'the client adopted the streamed value');
  assert.equal(document.getElementById('inbox').textContent, first.join(','));
  return stop;
}

describe('a streamed query, hydrated, invalidated by an action while a navigation with preload prepares', () => {
  it('the action starts while the navigation prepares: its refetch shows on the page being left, then the navigation commits', async () => {
    const inbox = remote();
    const users = remote();
    const App = app('inbox:1', inbox, users);
    const stop = await streamedAndHydrated(App, inbox, ['a', 'b']);
    const markRead = actions.action(async () => {}, { id: 'markRead', invalidates: ['inbox:1'] });
    try {
      const going = router.navigate('/users/7');
      await tick();
      assert.equal(router.route.isNavigating, true);
      assert.equal(users.calls.length, 1, 'preload fetches the destination\'s data');
      const p = document.getElementById('inbox');

      const acting = markRead();
      await tick();
      assert.equal(posts.length, 1);
      respond(null);
      await tick();
      assert.equal(inbox.calls.length, 2, 'the action refetches the key it invalidates');
      assert.equal(p.textContent, 'a,b', 'held by the action until the refetch lands');
      inbox.calls[1].resolve(['a']);
      await acting;
      await tick();
      assert.equal(document.getElementById('inbox'), p, 'the page being left is still on screen');
      assert.equal(p.textContent, 'a', 'the refetch committed with the action');
      assert.equal(router.route.isNavigating, true);

      users.calls[0].resolve({ name: 'Ada' });
      await going;
      assert.equal(location.pathname, '/users/7');
      assert.equal(document.querySelector('h1').textContent, 'Ada');
      assert.equal(router.route.isNavigating, false);
      assert.equal(users.calls.length, 1, 'the page read the preloaded entry');
    } finally {
      stop();
      posts.length = 0;
      await router.navigate('/', { transition: false, flushSync: true });
    }
  });

  it('the navigation starts while the action is in flight: both commit, neither waits for the other forever', async () => {
    const inbox = remote();
    const users = remote();
    const App = app('inbox:2', inbox, users);
    const stop = await streamedAndHydrated(App, inbox, ['x', 'y']);
    const markRead = actions.action(async () => {}, { id: 'markRead', invalidates: ['inbox:2'] });
    try {
      const acting = markRead();
      await tick();
      const going = router.navigate('/users/8');
      await tick();
      assert.equal(users.calls.length, 1);
      respond(null);
      await tick();
      assert.equal(inbox.calls.length, 2);
      users.calls[0].resolve({ name: 'Lin' });
      await tick();
      inbox.calls[1].resolve(['x']);
      const outcome = await Promise.race([Promise.all([acting, going]).then(() => 'both'), tick(200).then(() => 'stuck')]);
      assert.equal(outcome, 'both');
      assert.equal(location.pathname, '/users/8');
      assert.equal(document.querySelector('h1').textContent, 'Lin');
      assert.equal(router.route.isNavigating, false);
    } finally {
      stop();
      posts.length = 0;
      await router.navigate('/', { transition: false, flushSync: true });
    }
  });
});
