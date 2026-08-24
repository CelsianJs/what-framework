// Route-level code splitting depends on a lazy() route resolving when it is
// reached by navigation, not just on first paint. It did not: the router renders
// through a reactive region, and everything a re-run of that region created lost
// its owner chain, so the Suspense boundary above the router was invisible and
// lazy()'s pending promise escaped as an uncaught error. The route rendered
// blank, permanently.
//
// Its own file: the router keeps module-scoped URL state, so sharing a process
// with other router suites makes the starting URL depend on test order.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });

const { h, mount, lazy, Suspense } = await import('what-core');
const { Router, navigate } = await import('../src/index.js');

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const app = () => document.getElementById('app');

describe('a lazy route reached by navigation', () => {
  let resolveLazy;
  let uncaught = [];

  before(() => {
    const origError = console.error;
    console.error = (...args) => { uncaught.push(args.join(' ')); origError(...args); };
  });

  it('shows the boundary fallback, then the resolved page', async () => {
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

    await navigate('/lazy');
    await tick();
    assert.equal(app().textContent, 'loading', 'the suspension must reach the boundary above the router');

    resolveLazy();
    await tick(80);
    assert.equal(app().textContent, 'LAZY PAGE', 'the chunk must render once it resolves');
  });

  it('did not report an uncaught promise', () => {
    const escaped = uncaught.filter((m) => m.includes('Uncaught') || m.includes('[object Promise]'));
    assert.deepEqual(escaped, [], `promises escaped to the console:\n${escaped.join('\n')}`);
  });
});
