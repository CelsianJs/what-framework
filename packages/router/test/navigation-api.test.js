// Tests for What Framework - Router navigation API
// useParams / useSearch / useNavigate / redirect / prefetchRoute /
// beforeNavigate / afterNavigate
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/',
});
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;
global.history = dom.window.history;
global.location = dom.window.location;
global.scrollX = 0;
global.scrollY = 0;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

if (!global.customElements) {
  const registry = new Map();
  global.customElements = {
    get: (name) => registry.get(name),
    define: (name, cls) => registry.set(name, cls),
  };
}

const { h } = await import('../../core/src/h.js');
const { mount } = await import('../../core/src/dom.js');

const {
  Router,
  navigate,
  route,
  useParams,
  useSearch,
  useNavigate,
  redirect,
  prefetchRoute,
  beforeNavigate,
  afterNavigate,
} = await import('../src/index.js');

async function flush() {
  await new Promise(r => queueMicrotask(r));
  await new Promise(r => queueMicrotask(r));
  await new Promise(r => queueMicrotask(r));
}

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

function UserPage() {
  return h('div', { id: 'user' }, 'User');
}

const routes = [
  { path: '/', component: () => h('div', { id: 'home' }, 'Home') },
  { path: '/users/:id', component: UserPage },
];

// Install a route match so the singleton route state is populated.
async function goto(url) {
  const container = getContainer();
  history.pushState(null, '', url);
  await navigate(url, { replace: true, transition: false });
  await flush();
  mount(h(Router, { routes }), container);
  await flush();
}

// =========================================================================
// useParams / useSearch / useNavigate / prefetchRoute
// =========================================================================

describe('route accessors', () => {
  it('useParams returns the current route params', async () => {
    await goto('/users/42');
    assert.deepEqual(useParams(), { id: '42' });
  });

  it('useParams tracks a param change across navigation', async () => {
    await goto('/users/42');
    await navigate('/users/7', { replace: true, transition: false });
    await flush();
    assert.deepEqual(useParams(), { id: '7' });
  });

  it('useSearch returns the parsed query string', async () => {
    await goto('/users/42?tab=posts&page=2');
    assert.equal(useSearch().tab, 'posts');
    assert.equal(useSearch().page, '2');
  });

  it('useNavigate returns a callable navigate', () => {
    assert.equal(typeof useNavigate(), 'function');
    assert.equal(useNavigate(), navigate);
  });

  it('prefetchRoute appends a prefetch link', () => {
    prefetchRoute('/users/99');
    const link = document.head.querySelector('link[rel="prefetch"][href="/users/99"]');
    assert.ok(link, 'a prefetch link element should have been appended');
  });
});

// =========================================================================
// redirect()
// =========================================================================

describe('redirect()', () => {
  it('throws a navigation signal rather than returning', async () => {
    assert.throws(() => redirect('/login'), (e) => e && e.to === '/login');
    const realWarn = console.warn;
    console.warn = () => {};
    try { await flush(); } finally { console.warn = realWarn; }
  });

  it('a signal swallowed before the Router still navigates, with a warning', async () => {
    await navigate('/pre-swallow', { replace: true, transition: false });
    await flush();

    const warnings = [];
    const realWarn = console.warn;
    console.warn = (msg) => warnings.push(String(msg));
    try {
      try { redirect('/swallowed'); } catch { /* a user catch that drops it */ }
      await flush();
    } finally {
      console.warn = realWarn;
    }

    assert.equal(route.path, '/swallowed', 'the swallowed redirect should still navigate');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /swallowed it/);
  });

  it('refuses an unsafe target', () => {
    assert.throws(() => redirect('//evil.com/x'), /unsafe|invalid/i);
    assert.throws(() => redirect('javascript:alert(1)'), /unsafe|invalid/i);
  });

  it('the unsafe error carries a code, a fix and an example', () => {
    try {
      redirect('//evil.com/x');
      assert.fail('redirect should have thrown');
    } catch (e) {
      assert.equal(e.code, 'ERR_UNSAFE_REDIRECT');
      assert.ok(e.suggestion && e.suggestion.length > 0, 'error should carry a fix');
      assert.ok(e.codeExample && e.codeExample.includes('redirect('), 'error should carry an example');
    }
  });

  it('is caught at the Router boundary when thrown from middleware', async () => {
    const container = getContainer();
    history.pushState(null, '', '/private');
    await navigate('/private', { replace: true, transition: false });
    await flush();

    const guarded = [
      { path: '/login', component: () => h('div', { id: 'login' }, 'Login') },
      {
        path: '/private',
        component: () => h('div', { id: 'private' }, 'Private'),
        middleware: [() => redirect('/login')],
      },
    ];

    mount(h(Router, { routes: guarded }), container);
    await flush();
    await flush();

    assert.equal(route.path, '/login', 'the redirect should have navigated to /login');
    assert.ok(!container.querySelector('#private'), 'the private page must not render');
  });
});

// =========================================================================
// beforeNavigate / afterNavigate
// =========================================================================

describe('navigation hooks', () => {
  it('beforeNavigate can cancel and returns an unsubscribe', async () => {
    await navigate('/start', { replace: true, transition: false });
    await flush();

    const off = beforeNavigate(() => false);
    const before = location.pathname;
    await navigate('/blocked', { transition: false });

    assert.equal(location.pathname, before, 'navigation should have been cancelled');
    assert.equal(route.path, before, 'route state should not have moved');
    off();

    await navigate('/blocked', { transition: false });
    assert.equal(location.pathname, '/blocked', 'unsubscribe should re-allow navigation');
  });

  it('beforeNavigate receives to and from and runs before the URL changes', async () => {
    await navigate('/hook-from', { replace: true, transition: false });
    await flush();

    const seen = [];
    const off = beforeNavigate((to, from) => {
      seen.push([to, from, location.pathname]);
      return true;
    });
    await navigate('/hook-to', { transition: false });
    off();

    assert.deepEqual(seen, [['/hook-to', '/hook-from', '/hook-from']]);
  });

  it('an async beforeNavigate guard can cancel', async () => {
    await navigate('/async-from', { replace: true, transition: false });
    await flush();

    const off = beforeNavigate(async () => false);
    await navigate('/async-to', { transition: false });
    off();

    assert.equal(location.pathname, '/async-from');
  });

  it('afterNavigate fires with to and from', async () => {
    await navigate('/after-from', { replace: true, transition: false });
    await flush();

    const seen = [];
    const off = afterNavigate((to, from) => seen.push([to, from]));
    await navigate('/next', { transition: false });

    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], ['/next', '/after-from']);
    off();

    await navigate('/after-off', { transition: false });
    assert.equal(seen.length, 1, 'unsubscribe should stop the hook firing');
  });

  it('cancelling a popstate navigation restores the address bar', async () => {
    await navigate('/pop-from', { replace: true, transition: false });
    await flush();

    // The browser has already moved the URL by the time popstate fires, so a
    // cancelled back/forward has to push the previous entry back.
    history.pushState(null, '', '/pop-to');
    const off = beforeNavigate(() => false);
    await navigate('/pop-to', { replace: true, transition: false, _fromPopstate: true });
    off();

    assert.equal(location.pathname, '/pop-from', 'the previous URL should be restored');
    assert.equal(route.path, '/pop-from');
  });

  it('afterNavigate fires for a popstate navigation', async () => {
    await navigate('/pop2-from', { replace: true, transition: false });
    await flush();

    const seen = [];
    const off = afterNavigate((to, from) => seen.push([to, from]));
    history.pushState(null, '', '/pop2-to');
    await navigate('/pop2-to', { transition: false, _fromPopstate: true });
    off();

    assert.deepEqual(seen, [['/pop2-to', '/pop2-from']]);
  });

  it('afterNavigate does not fire for a cancelled navigation', async () => {
    await navigate('/cancel-from', { replace: true, transition: false });
    await flush();

    const seen = [];
    const offBefore = beforeNavigate(() => false);
    const offAfter = afterNavigate((to) => seen.push(to));
    await navigate('/cancel-to', { transition: false });
    offBefore();
    offAfter();

    assert.equal(seen.length, 0);
  });
});
