// Two shipped-broken public surfaces found while verifying the nested-layout and
// error-convention specs (2026-08-09 parity work).
//
// Own file: the router keeps module-scoped URL state, so a shared process makes
// the starting URL depend on test order.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/dashboard',
  pretendToBeVisual: true,
});
global.window = dom.window;
global.document = dom.window.document;
global.location = dom.window.location;
global.history = dom.window.history;

const { h, mount } = await import('what-core');
const { nestedRoutes, FileRouter } = await import('../src/index.js');
const { matchRoute } = await import('../src/match.js');

const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const app = () => document.getElementById('app');

describe("nestedRoutes: an index child addresses the base, not base + '/'", () => {
  // The README documents exactly this shape. Naive concatenation produced
  // '/dashboard/', which '/dashboard' does not match, so the documented example
  // 404s on its own index route.
  const routes = nestedRoutes('/dashboard', [
    { path: '/', component: () => h('div', { id: 'home' }, 'Home') },
    { path: '/settings', component: () => h('div', { id: 'settings' }, 'Settings') },
  ], { layout: ({ children }) => h('div', { id: 'shell' }, children) });

  it('generates the base path for the index child', () => {
    assert.deepEqual(routes.map((r) => r.path), ['/dashboard', '/dashboard/settings']);
  });

  it('matches the base URL', () => {
    assert.ok(matchRoute('/dashboard', routes), '/dashboard must match its own index route');
    assert.ok(matchRoute('/dashboard/settings', routes));
  });

  it('still applies the shared layout to every child', () => {
    assert.ok(routes.every((r) => typeof r.layout === 'function'));
  });

  it('handles a trailing slash on the base and a bare child path', () => {
    const r = nestedRoutes('/admin/', [{ path: '', component: () => null }, { path: 'users', component: () => null }]);
    assert.deepEqual(r.map((x) => x.path), ['/admin', '/admin/users']);
  });

  it('keeps a root base usable', () => {
    const r = nestedRoutes('/', [{ path: '/', component: () => null }]);
    assert.deepEqual(r.map((x) => x.path), ['/']);
  });
});

describe('FileRouter forwards the per-route conventions it was dropping', () => {
  it('renders a route error component, using the `error` prop as the default', async () => {
    const Boom = () => { throw new Error('page exploded'); };
    const routes = [{ path: '/dashboard', component: Boom, mode: 'client' }];

    mount(h(FileRouter, { routes, error: ({ error }) => h('div', { id: 'err' }, `caught: ${error.message}`) }), '#app');
    await flush();

    const el = app().querySelector('#err');
    assert.ok(el, 'the `error` prop was declared, destructured, and then never used');
    assert.match(el.textContent, /page exploded/);
  });

  it("prefers a route's own error component over the global one", async () => {
    app().innerHTML = '';
    const Boom = () => { throw new Error('nope'); };
    const routes = [{
      path: '/dashboard',
      component: Boom,
      mode: 'client',
      error: () => h('div', { id: 'own' }, 'route-level'),
    }];

    mount(h(FileRouter, { routes, error: () => h('div', { id: 'global' }, 'global') }), '#app');
    await flush();

    assert.ok(app().querySelector('#own'), "the route's own error component wins");
    assert.equal(app().querySelector('#global'), null);
  });
});
