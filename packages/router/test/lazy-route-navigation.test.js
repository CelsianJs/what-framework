// Route-level code splitting depends on a lazy() route resolving when it is
// reached by navigation, not just on first paint. It did not: the router renders
// through a reactive region, and everything a re-run of that region created lost
// its owner chain, so the Suspense boundary above the router was invisible and
// lazy()'s pending promise escaped as an uncaught error. The route rendered
// blank, permanently.
//
// A navigation is a transition now: it loads the lazy route's chunk before it
// commits, so the page being left stays on screen until the new one can show,
// and the boundary's fallback is only for a lazy route on first load.
//
// Its own file: the router keeps module-scoped URL state, so sharing a process
// with other router suites makes the starting URL depend on test order.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });

const { h, mount, lazy, Suspense } = await import('what-core');
const { Router, navigate, route } = await import('../src/index.js');

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const app = () => document.getElementById('app');

describe('a lazy route reached by navigation', () => {
  let resolveLazy;
  let uncaught = [];

  before(() => {
    const origError = console.error;
    console.error = (...args) => { uncaught.push(args.join(' ')); origError(...args); };
  });

  it('keeps the page being left until the chunk has loaded, then shows the new page', async () => {
    const Lazy = lazy(() => new Promise((res) => {
      resolveLazy = () => res({ default: () => h('h1', {}, 'LAZY PAGE') });
    }));

    const routes = [
      { path: '/', component: () => h('h1', {}, 'HOME') },
      { path: '/lazy', component: Lazy },
    ];

    mount(h(Suspense, { fallback: h('p', {}, 'loading') }, h(Router, { routes })), '#app');
    await tick();
    assert.equal(app().textContent, 'HOME');

    const navigation = navigate('/lazy');
    await tick();
    assert.equal(app().textContent, 'HOME', 'the old page stays while the chunk loads; no fallback');
    assert.equal(route.isNavigating, true, 'the router reports the navigation in flight');

    resolveLazy();
    await navigation;
    await tick();
    assert.equal(app().textContent, 'LAZY PAGE', 'the chunk renders once it has loaded');
    assert.equal(route.isNavigating, false);
    assert.equal(location.pathname, '/lazy');
  });

  it('did not report an uncaught promise', () => {
    const escaped = uncaught.filter((m) => m.includes('Uncaught') || m.includes('[object Promise]'));
    assert.deepEqual(escaped, [], `promises escaped to the console:\n${escaped.join('\n')}`);
  });
});
