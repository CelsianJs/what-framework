// A navigation is a transition: navigate() prepares the destination (its
// lazy chunk and the queries its `preload` starts), then commits the URL in
// startTransition, so the page being left stays until the new one can show
// at once, and everything the new URL reaches commits in one flush.
//
// Its own file: the router keeps module-scoped URL state.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });

const { h, mount, useTransition, Suspense, ErrorBoundary } = await import('what-core');
const { query, invalidatePath, clearCache } = await import('what-core/data');
const { Router, navigate, route, afterNavigate } = await import('../src/index.js');

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function remote() {
  const calls = [];
  const fetcher = (key) => {
    const call = { key, ...Promise.withResolvers() };
    calls.push(call);
    return call.promise;
  };
  return { calls, fetcher };
}

let stop = null;
function show(vnode) {
  const el = document.getElementById('app');
  stop = mount(vnode, el);
  return el;
}
afterEach(async () => {
  if (stop) stop();
  stop = null;
  clearCache();
  await navigate('/', { transition: false, flushSync: true });
});

describe('a navigation to a route with preload', () => {
  it('keeps the old page until the preloaded data has landed, then shows the new page with it', async () => {
    const { calls, fetcher } = remote();
    const user = (id) => query(['user', id], fetcher, { staleTime: 60_000 });
    const routes = [
      { path: '/', component: () => h('h1', null, 'home') },
      {
        path: '/users/:id',
        preload: ({ params }) => user(params.id),
        component: ({ params, data }) => {
          const same = user(params.id);
          return h('h1', null, () => `${data().name} / ${same().name}`);
        },
      },
    ];
    const el = show(h(Suspense, { fallback: h('p', null, 'loading') }, h(Router, { routes })));
    assert.equal(el.textContent, 'home');

    const going = navigate('/users/7');
    await tick();
    assert.equal(el.textContent, 'home', 'the page being left stays; no fallback');
    assert.equal(route.isNavigating, true);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].key, ['user', '7']);

    calls[0].resolve({ name: 'Ada' });
    await going;
    assert.equal(el.textContent, 'Ada / Ada', 'the page reads the preloaded entry: no second fetch, no wait');
    assert.equal(calls.length, 1);
    assert.equal(route.isNavigating, false);
    assert.equal(location.pathname, '/users/7');
  });

  it('a newer navigation supersedes one still preparing', async () => {
    const { calls, fetcher } = remote();
    const routes = [
      { path: '/', component: () => h('h1', null, 'home') },
      { path: '/slow', preload: () => query('slow', fetcher), component: () => h('h1', null, 'slow') },
      { path: '/fast', component: () => h('h1', null, 'fast') },
    ];
    const el = show(h(Router, { routes }));
    const slow = navigate('/slow');
    await tick();
    const fast = navigate('/fast');
    await fast;
    assert.equal(el.textContent, 'fast');
    calls[0].resolve('late');
    await slow;
    await tick();
    assert.equal(el.textContent, 'fast', 'the superseded navigation never commits');
    assert.equal(location.pathname, '/fast');
  });

  it('a newer navigation supersedes one whose View Transition has not run its commit yet', async () => {
    const updates = [];
    document.startViewTransition = (update) => {
      const done = Promise.withResolvers();
      updates.push(async () => {
        try { done.resolve(await update()); } catch (error) { done.reject(error); }
      });
      return { ready: done.promise, finished: done.promise };
    };
    const after = [];
    const off = afterNavigate((to) => after.push(to));
    try {
      const routes = [
        { path: '/', component: () => h('h1', null, 'home') },
        { path: '/b', component: () => h('h1', null, 'b') },
        { path: '/c', component: () => h('h1', null, 'c') },
      ];
      const el = show(h(Router, { routes }));
      const b = navigate('/b');
      await tick();
      assert.equal(updates.length, 1, 'the browser holds the commit of /b');
      await navigate('/c', { transition: false });
      assert.deepEqual([route.path, location.pathname, el.textContent], ['/c', '/c', 'c']);
      await updates[0]();
      await b;
      assert.deepEqual([route.path, location.pathname, el.textContent], ['/c', '/c', 'c'], 'the superseded commit does nothing');
      assert.deepEqual(after, ['/c'], 'afterNavigate runs for the navigation that committed only');
      assert.equal(route.isNavigating, false);
    } finally {
      off();
      delete document.startViewTransition;
    }
  });

  it('useTransition\'s isPending follows a navigation started in it', async () => {
    const { calls, fetcher } = remote();
    let pending;
    let start;
    const routes = [
      { path: '/', component: () => { [pending, start] = useTransition(); return h('h1', null, 'home'); } },
      { path: '/report', preload: () => query('report', fetcher), component: () => h('h1', null, 'report') },
    ];
    show(h(Router, { routes }));
    start(() => navigate('/report'));
    await tick();
    assert.equal(pending(), true);
    calls[0].resolve('ready');
    await tick(5);
    assert.equal(pending(), false);
    assert.equal(location.pathname, '/report');
  });

  it('route.isNavigating shows at once for a navigation started inside a transition, and the transition resolves', async () => {
    const { calls, fetcher } = remote();
    const { startTransition } = await import('what-core');
    const routes = [
      { path: '/', component: () => h('h1', null, 'home') },
      { path: '/report', preload: () => query('report', fetcher), component: () => h('h1', null, 'report') },
    ];
    const el = show(h('div', null, h('i', null, () => (route.isNavigating ? 'busy ' : 'idle ')), h(Router, { routes })));
    const going = startTransition(() => navigate('/report'));
    await tick();
    assert.equal(el.textContent, 'busy home', 'the indicator is not held by the transition the navigation runs in');
    calls[0].resolve('ready');
    await going;
    assert.equal(el.textContent, 'idle report');
  });

  it('data the page reads beyond preload: the page shows it pending after the commit, and the navigation goes on until it has landed', async () => {
    const { calls, fetcher } = remote();
    const routes = [
      { path: '/', component: () => h('h1', null, 'home') },
      {
        path: '/feed',
        preload: () => query('feed:head', fetcher),
        component: ({ data }) => {
          const items = query('feed:items', fetcher);
          return h('div', null, h('h1', null, () => data()), h(Suspense, { fallback: h('p', null, 'items…') }, h('ul', null, () => items().join(','))));
        },
      },
    ];
    const el = show(h('div', null, h('i', null, () => (route.isNavigating ? 'busy ' : 'idle ')), h(Router, { routes })));
    let done = false;
    const going = navigate('/feed').then(() => { done = true; });
    await tick();
    assert.equal(el.textContent, 'busy home', 'the page being left stays while preload loads');
    calls[0].resolve('Feed');
    await tick(5);
    assert.equal(calls.length, 2, 'the page fetched what preload did not return');
    assert.equal(el.textContent, 'busy Feeditems…', 'committed: the page shows it pending, and the navigation is still on');
    assert.equal(done, false, 'navigate() waits for it');
    calls[1].resolve(['a', 'b']);
    await going;
    assert.equal(el.textContent, 'idle Feeda,b');
  });

  it('started inside useTransition, the navigation also goes on after the action\'s commit until the page\'s data has landed', async () => {
    const { calls, fetcher } = remote();
    let start;
    const routes = [
      { path: '/', component: () => { [, start] = useTransition(); return h('h1', null, 'home'); } },
      { path: '/later', component: () => { const v = query('later', fetcher); return h('h1', null, () => v()); } },
    ];
    const el = show(h('div', null, h('i', null, () => (route.isNavigating ? 'busy ' : 'idle ')), h(Router, { routes })));
    await start(() => navigate('/later'));
    await tick();
    assert.equal(location.pathname, '/later');
    assert.equal(el.textContent, 'busy ', 'committed; the page\'s query is pending and the navigation is on');
    calls[0].resolve('Later');
    await tick(5);
    assert.equal(el.textContent, 'idle Later');
  });

  it('invalidatePath(path) refetches the route data preloaded on it', async () => {
    let fetches = 0;
    const routes = [
      { path: '/', component: () => h('h1', null, 'home') },
      {
        path: '/inbox',
        preload: () => query('inbox', async () => `${++fetches} new`),
        component: ({ data }) => h('h1', null, () => data()),
      },
    ];
    const el = show(h(Router, { routes }));
    await navigate('/inbox');
    assert.equal(el.textContent, '1 new');
    await invalidatePath('/inbox');
    await tick();
    assert.equal(el.textContent, '2 new');
  });

  it('a preload that throws shows the error in the route\'s error boundary, or the nearest one', async () => {
    const routes = [
      { path: '/', component: () => h('h1', null, 'home') },
      {
        path: '/failure',
        preload() { throw new Error('preload offline'); },
        component: () => h('h1', null, 'destination'),
        error: ({ error }) => h('p', null, `route: ${error.message}`),
      },
      { path: '/bare', preload() { throw new Error('bare offline'); }, component: () => h('h1', null, 'bare') },
    ];
    const el = show(h(ErrorBoundary, { fallback: ({ error }) => h('p', null, `app: ${error.message}`) }, h(Router, { routes })));
    await navigate('/failure', { transition: false });
    assert.deepEqual([location.pathname, route.isNavigating, el.textContent], ['/failure', false, 'route: preload offline']);
    await navigate('/bare', { transition: false });
    assert.deepEqual([location.pathname, route.isNavigating, el.textContent], ['/bare', false, 'app: bare offline']);
  });

  it('runs its commit inside a View Transition when the browser has them', async () => {
    const order = [];
    document.startViewTransition = (update) => {
      order.push('start');
      const done = Promise.resolve(update()).then(() => order.push('updated'));
      return { ready: done, finished: done, updateCallbackDone: done };
    };
    try {
      const routes = [
        { path: '/', component: () => h('h1', null, 'home') },
        { path: '/about', component: () => h('h1', null, 'about') },
      ];
      const el = show(h(Router, { routes }));
      await navigate('/about');
      assert.deepEqual(order, ['start', 'updated']);
      assert.equal(el.textContent, 'about', 'the update callback resolved once the page was on screen');
    } finally {
      delete document.startViewTransition;
    }
  });
});
