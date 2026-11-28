// Hovering a <Link> (or calling prefetch()) starts downloading the lazy()
// chunk of the route the link goes to, so the navigation that follows does
// not wait for it. A route behind middleware is left to the navigation,
// which downloads it only once the middleware admits it.
//
// Its own file: the router keeps module-scoped URL state, so sharing a process
// with other router suites makes the starting URL depend on test order.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });

const { h, mount, lazy, Suspense } = await import('what-core');
const { Router, Link, navigate, prefetch, prefetchRoute } = await import('../src/index.js');

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const app = () => document.getElementById('app');

// A lazy page whose chunk lands when the test says, counting downloads.
function page(text) {
  const out = { loads: 0, land: null };
  out.component = lazy(() => {
    out.loads++;
    return new Promise((resolve) => { out.land = () => resolve({ default: () => h('h1', {}, text) }); });
  });
  return out;
}

describe('prefetching a lazy route', () => {
  const docs = page('DOCS');
  const guide = page('GUIDE');
  const later = page('LATER');
  const admin = page('ADMIN');

  mount(h(Suspense, { fallback: h('p', {}, 'loading') }, h(Router, {
    routes: [
      { path: '/', component: () => h('div', {}, h('h1', {}, 'HOME'), h(Link, { href: '/guide', id: 'guide' }, 'Guide')) },
      { path: '/docs', component: docs.component },
      { path: '/guide', component: guide.component },
      { path: '/later', component: later.component },
      { path: '/admin', component: admin.component, middleware: [() => false] },
    ],
  })), '#app');

  it('prefetch(href) downloads the chunk of the route it matches, before any navigation', async () => {
    await tick();
    assert.equal(app().textContent, 'HOMEGuide');
    prefetch('/docs');
    assert.equal(docs.loads, 1, 'the chunk download started');
    docs.land();
    await tick();
    const navigation = navigate('/docs');
    await tick();
    assert.equal(app().textContent, 'DOCS', 'the navigation had nothing to wait for');
    await navigation;
    assert.equal(docs.loads, 1, 'the navigation downloaded nothing again');
  });

  it('hovering a <Link> downloads its route\'s chunk', async () => {
    await navigate('/');
    await tick();
    document.getElementById('guide').dispatchEvent(new window.MouseEvent('mouseenter'));
    assert.equal(guide.loads, 1);
    guide.land();
    await tick();
    document.getElementById('guide').click();
    await tick();
    assert.equal(app().textContent, 'GUIDE');
    assert.equal(guide.loads, 1);
  });

  it('prefetchRoute(href) does the same', async () => {
    prefetchRoute('/later');
    assert.equal(later.loads, 1);
  });

  it('a route behind middleware is not downloaded by a prefetch', async () => {
    prefetch('/admin');
    await tick();
    assert.equal(admin.loads, 0);
  });
});
