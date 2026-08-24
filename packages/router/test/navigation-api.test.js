// Tests for What Framework - Router navigation API
// useParams / useSearch / useNavigate / redirect / prefetchRoute /
// beforeNavigate / afterNavigate
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
global.scrollX = 0;
global.scrollY = 0;

const { h } = await import('../../core/src/h.js');
const { mount } = await import('../../core/src/dom.js');
const { ErrorBoundary } = await import('../../core/src/components.js');

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

// Every mount replaces the previous one: without disposing it, each Router's
// reactive region stays subscribed to the singleton _url for the rest of the
// file and later route assertions run against several live Routers.
let _unmount = null;

function getContainer() {
  if (_unmount) _unmount();
  _unmount = null;
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

function mountRouter(props, container) {
  _unmount = mount(h(Router, props), container);
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
  mountRouter({ routes }, container);
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

// Mount a Router at `url` and let its reactive content settle.
async function mountAt(url, routerRoutes, extraProps = {}) {
  const container = getContainer();
  history.pushState(null, '', url);
  await navigate(url, { replace: true, transition: false });
  await flush();
  mountRouter({ routes: routerRoutes, ...extraProps }, container);
  await flush();
  await flush();
  return container;
}

// Collect console.error output for the duration of fn.
async function captureErrors(fn) {
  const seen = [];
  const real = console.error;
  console.error = (...args) => seen.push(args.map(String).join(' '));
  try { await fn(); } finally { console.error = real; }
  return seen;
}

describe('redirect()', () => {
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

  it('throws a navigation signal from middleware, which the Router catches', async () => {
    let signal = null;
    const guarded = [
      { path: '/login', component: () => h('div', { id: 'login' }, 'Login') },
      {
        path: '/private',
        component: () => h('div', { id: 'private' }, 'Private'),
        middleware: [() => {
          // Inspect the signal, then rethrow it so the Router still sees it.
          try { redirect('/login'); } catch (e) { signal = e; throw e; }
        }],
      },
    ];

    const container = await mountAt('/private', guarded);

    assert.equal(signal.to, '/login', 'the signal names its target');
    assert.equal(signal.name, 'RouterRedirect');
    assert.ok(signal[Symbol.for('what.router.redirect')], 'the signal is branded');
    assert.equal(route.path, '/login', 'the redirect should have navigated to /login');
    assert.ok(!container.querySelector('#private'), 'the private page must not render');
  });

  it('forwards options, so { replace: false } pushes instead of replacing', async () => {
    const guarded = [
      { path: '/pushed', component: () => h('div', { id: 'pushed' }, 'Pushed') },
      {
        path: '/push-from',
        component: () => h('div', {}, 'From'),
        middleware: [() => redirect('/pushed', { replace: false })],
      },
    ];

    await navigate('/settle', { replace: true, transition: false });
    await flush();
    const before = history.length;
    await mountAt('/push-from', guarded);

    assert.equal(route.path, '/pushed');
    assert.ok(history.length > before, 'replace: false should push a history entry');
  });

  it('navigates when thrown from a component body', async () => {
    const cb = [
      { path: '/login', component: () => h('div', { id: 'login' }, 'Login') },
      { path: '/component-body', component: () => { redirect('/login'); } },
    ];

    const container = await mountAt('/component-body', cb);

    assert.equal(route.path, '/login', 'the component-body redirect should navigate');
    assert.ok(container.querySelector('#login'), 'the target page should render');
  });

  it('reaches the Router from a component body under a per-route ErrorBoundary', async () => {
    let captured = null;
    const cb = [
      { path: '/login', component: () => h('div', { id: 'login' }, 'Login') },
      {
        path: '/guarded-body',
        component: () => { redirect('/login'); },
        error: ({ error }) => { captured = error; return h('div', { id: 'boom' }, 'Boom'); },
      },
    ];

    const container = await mountAt('/guarded-body', cb);

    assert.equal(captured, null, 'the boundary must not treat a redirect as an error');
    assert.ok(!container.querySelector('#boom'), 'no stranded error UI');
    assert.equal(route.path, '/login');
  });

  it('reaches the Router from a component body under nested ErrorBoundaries', async () => {
    let outer = null;
    const Inner = () => { redirect('/login'); };
    const Nested = () => h(ErrorBoundary,
      { fallback: () => h('div', { id: 'inner-eb' }, 'inner') },
      h(Inner, {}));

    const cb = [
      { path: '/login', component: () => h('div', { id: 'login' }, 'Login') },
      {
        path: '/nested-body',
        component: Nested,
        error: ({ error }) => { outer = error; return h('div', { id: 'outer-eb' }, 'outer'); },
      },
    ];

    const container = await mountAt('/nested-body', cb);

    assert.equal(outer, null, 'the outer boundary must not see the signal');
    assert.ok(!container.querySelector('#inner-eb'), 'the inner boundary must not see it either');
    assert.equal(route.path, '/login');
  });

  it('lets a non-redirect throw from a component body reach the ErrorBoundary', async () => {
    let captured = null;
    const cb = [{
      path: '/body-throws',
      component: () => { throw new Error('component exploded'); },
      error: ({ error }) => { captured = error; return h('div', { id: 'boom' }, 'Boom'); },
    }];

    const container = await mountAt('/body-throws', cb);

    assert.ok(captured, 'a plain error must still reach the boundary');
    assert.equal(captured.message, 'component exploded');
    assert.ok(container.querySelector('#boom'), 'the boundary still renders its fallback');
    assert.equal(route.path, '/body-throws', 'a plain error must not navigate');
  });

  it('an uncaught signal carries a code, a fix and an example', () => {
    try {
      redirect('/login');
      assert.fail('redirect should have thrown');
    } catch (e) {
      assert.equal(e.code, 'ERR_REDIRECT_NOT_CAUGHT');
      assert.ok(e.suggestion.includes('navigate('), 'the fix names navigate()');
      assert.ok(e.codeExample.includes('redirect('), 'the example shows redirect()');
      assert.equal(e.to, '/login');
    }
  });

  it('lets a non-redirect throw propagate out of the matching pass unchanged', async () => {
    const boom = [{
      path: '/throws',
      component: () => h('div', {}, 'never'),
      middleware: [() => { throw new Error('middleware exploded'); }],
    }];

    const container = getContainer();
    history.pushState(null, '', '/throws');
    await navigate('/throws', { replace: true, transition: false });
    await flush();

    // The redirect try/catch must re-throw anything unbranded, so the app's own
    // ErrorBoundary above the Router still sees it.
    assert.throws(() => mountRouter({ routes: boom }, container), /middleware exploded/);
    assert.equal(route.path, '/throws', 'a plain error must not navigate');
  });
});

// =========================================================================
// Redirect loop detection, reachable from both call sites
// =========================================================================

describe('redirect loop detection', () => {
  it('stops a cycle of middleware string redirects', async () => {
    const cyclic = [
      { path: '/loop-a', component: () => h('div', {}, 'A'), middleware: [() => '/loop-b'] },
      { path: '/loop-b', component: () => h('div', {}, 'B'), middleware: [() => '/loop-a'] },
    ];

    let container;
    const errors = await captureErrors(async () => {
      container = await mountAt('/loop-a', cyclic);
    });

    assert.ok(errors.some(e => /Redirect (cycle|loop) detected/.test(e)),
      `expected a loop diagnostic, got ${JSON.stringify(errors)}`);
    assert.ok(container.querySelector('.what-redirect-loop'), 'the loop screen should render');
  });

  it('stops a cycle of thrown redirect() signals', async () => {
    const cyclic = [
      { path: '/sig-a', component: () => h('div', {}, 'A'), middleware: [() => redirect('/sig-b')] },
      { path: '/sig-b', component: () => h('div', {}, 'B'), middleware: [() => redirect('/sig-a')] },
    ];

    let container;
    const errors = await captureErrors(async () => {
      container = await mountAt('/sig-a', cyclic);
    });

    assert.ok(errors.some(e => /Redirect (cycle|loop) detected/.test(e)),
      `expected a loop diagnostic, got ${JSON.stringify(errors)}`);
    assert.ok(container.querySelector('.what-redirect-loop'), 'the loop screen should render');
  });

  // Without this the process runs out of memory: every hop matches its route
  // successfully before the component throws the next redirect, so a chain
  // scoped to the match would reset on each hop and never see the cycle.
  it('stops a cycle of component-body redirects', async () => {
    const cyclic = [
      { path: '/body-a', component: () => { redirect('/body-b'); } },
      { path: '/body-b', component: () => { redirect('/body-a'); } },
    ];

    const errors = await captureErrors(async () => {
      await mountAt('/body-a', cyclic);
      for (let i = 0; i < 40; i++) await flush();
    });

    assert.ok(errors.some(e => /Redirect (cycle|loop) detected/.test(e)),
      `expected a loop diagnostic, got ${JSON.stringify(errors)}`);
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

  it('beforeNavigate is not consulted for a same-page hash navigation', async () => {
    await navigate('/hash-page', { replace: true, transition: false });
    await flush();

    const seen = [];
    const off = beforeNavigate((to) => { seen.push(to); return false; });
    await navigate('#section', { transition: false });
    off();

    assert.deepEqual(seen, [], 'a hash link scrolls, it does not change the route');
    assert.equal(route.url, '/hash-page#section', 'the hash still applied');
  });

  // The navigating flag is claimed in the same tick as the concurrency check,
  // so an awaited guard cannot open a gap two navigations both get through. The
  // visible consequence is this: a route with a loading: component shows it
  // while an async guard runs, not only while the next route loads.
  it('a route loading: component renders while an async guard is still running', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const loadingRoutes = [
      {
        path: '/slow-guard',
        component: () => h('div', { id: 'page' }, 'Page'),
        loading: () => h('div', { id: 'spinner' }, 'Loading'),
      },
      { path: '/slow-guard-to', component: () => h('div', { id: 'other' }, 'Other') },
    ];

    const container = await mountAt('/slow-guard', loadingRoutes);
    assert.ok(container.querySelector('#page'), 'the page renders before the guard runs');

    const off = beforeNavigate(async () => { await gate; return true; });
    const pending = navigate('/slow-guard-to', { transition: false });
    await flush();

    assert.ok(container.querySelector('#spinner'), 'the loading component should be showing');

    release();
    await pending;
    await flush();
    off();

    assert.equal(route.path, '/slow-guard-to');
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
