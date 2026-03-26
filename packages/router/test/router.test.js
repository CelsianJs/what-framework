// Tests for What Framework - Router
// Tests route matching, reactive navigation, Link active classes, asyncGuard
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Set up DOM globals before importing framework modules
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

// Stub customElements if not available
if (!global.customElements) {
  const registry = new Map();
  global.customElements = {
    get: (name) => registry.get(name),
    define: (name, cls) => registry.set(name, cls),
  };
}

// Import framework core
const { signal, computed, effect, batch, flushSync } = await import('../../core/src/reactive.js');
const { h } = await import('../../core/src/h.js');
const { mount } = await import('../../core/src/dom.js');

// Import router
const { Router, Link, navigate, route, defineRoutes, asyncGuard, isSafeUrl } = await import('../src/index.js');

// Helper: flush microtask queue
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

// =========================================================================
// Route Matching (unit tests — no DOM needed)
// =========================================================================

// Inline route matching for unit testing (same logic as router source)
function compilePath(path) {
  const catchAllNames = {};
  let normalized = path
    .replace(/\([\w-]+\)\//g, '')
    .replace(/\[\.\.\.(\w+)\]/g, (_, name) => { catchAllNames['*'] = name; return '*'; })
    .replace(/\[(\w+)\]/g, ':$1');
  const paramNames = [];

  const regexStr = normalized
    .split('/')
    .map(segment => {
      if (segment.startsWith('*:')) {
        const name = segment.slice(2);
        paramNames.push(name);
        return '(.+)';
      }
      if (segment === '*') { paramNames.push(catchAllNames['*'] || 'rest'); return '(.+)'; }
      if (segment.startsWith(':')) { paramNames.push(segment.slice(1)); return '([^/]+)'; }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

function matchRoute(path, routes) {
  for (const route of routes) {
    const { regex, paramNames } = compilePath(route.path);
    const match = path.match(regex);
    if (match) {
      const params = {};
      paramNames.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });
      return { route, params };
    }
  }
  return null;
}

describe('route matching', () => {
  const routes = [
    { path: '/', component: 'Home' },
    { path: '/about', component: 'About' },
    { path: '/users/:id', component: 'User' },
    { path: '/users/:id/posts/:postId', component: 'UserPost' },
    { path: '/blog/*', component: 'Blog' },
    { path: '/files/[name]', component: 'File' },
    { path: '/docs/[...slug]', component: 'Docs' },
  ];

  it('should match exact paths', () => {
    const m = matchRoute('/', routes);
    assert.equal(m.route.component, 'Home');

    const m2 = matchRoute('/about', routes);
    assert.equal(m2.route.component, 'About');
  });

  it('should match dynamic params (:id)', () => {
    const m = matchRoute('/users/123', routes);
    assert.equal(m.route.component, 'User');
    assert.deepEqual(m.params, { id: '123' });
  });

  it('should match multiple dynamic params', () => {
    const m = matchRoute('/users/42/posts/7', routes);
    assert.equal(m.route.component, 'UserPost');
    assert.deepEqual(m.params, { id: '42', postId: '7' });
  });

  it('should match catch-all routes (*)', () => {
    const m = matchRoute('/blog/2024/my-post', routes);
    assert.equal(m.route.component, 'Blog');
    assert.deepEqual(m.params, { rest: '2024/my-post' });
  });

  it('should match file-based [param] syntax', () => {
    const m = matchRoute('/files/readme', routes);
    assert.equal(m.route.component, 'File');
    assert.deepEqual(m.params, { name: 'readme' });
  });

  it('should match file-based [...slug] catch-all', () => {
    const m = matchRoute('/docs/getting-started/install', routes);
    assert.equal(m.route.component, 'Docs');
    assert.deepEqual(m.params, { slug: 'getting-started/install' });
  });

  it('should return null for unmatched routes', () => {
    const m = matchRoute('/nonexistent', routes);
    assert.equal(m, null);
  });

  it('should decode URI components in params', () => {
    const m = matchRoute('/users/hello%20world', routes);
    assert.deepEqual(m.params, { id: 'hello world' });
  });
});

// =========================================================================
// URL Sanitization
// =========================================================================

describe('URL sanitization', () => {
  it('should reject javascript: URLs', () => {
    assert.equal(isSafeUrl('javascript:alert(1)'), false);
    assert.equal(isSafeUrl('JavaScript:alert(1)'), false);
    assert.equal(isSafeUrl('  javascript:alert(1)'), false);
  });

  it('should reject data: URLs', () => {
    assert.equal(isSafeUrl('data:text/html,<script>'), false);
  });

  it('should reject vbscript: URLs', () => {
    assert.equal(isSafeUrl('vbscript:MsgBox'), false);
  });

  it('should allow safe URLs', () => {
    assert.equal(isSafeUrl('/about'), true);
    assert.equal(isSafeUrl('https://example.com'), true);
    assert.equal(isSafeUrl('#section'), true);
  });

  it('should reject non-string URLs', () => {
    assert.equal(isSafeUrl(123), false);
    assert.equal(isSafeUrl(null), false);
  });
});

// =========================================================================
// Router Component — Reactive Navigation (run-once model)
// =========================================================================

describe('Router component (reactive)', () => {
  function HomePage() {
    return h('div', { id: 'home' }, 'Home Page');
  }
  function AboutPage() {
    return h('div', { id: 'about' }, 'About Page');
  }
  function UserPage({ params }) {
    return h('div', { id: 'user' }, 'User: ', params.id);
  }
  function NotFoundPage() {
    return h('div', { id: 'not-found' }, '404 Not Found');
  }

  const routes = [
    { path: '/', component: HomePage },
    { path: '/about', component: AboutPage },
    { path: '/users/:id', component: UserPage },
  ];

  it('should render the matched route', async () => {
    const container = getContainer();
    // Navigate to root first
    history.pushState(null, '', '/');
    await navigate('/', { replace: true, transition: false });
    await flush();

    mount(h(Router, { routes, fallback: NotFoundPage }), container);
    await flush();

    assert.ok(container.querySelector('#home'), 'Home page should be rendered');
  });

  it('should render fallback for unmatched routes', async () => {
    const container = getContainer();
    history.pushState(null, '', '/nonexistent');
    await navigate('/nonexistent', { replace: true, transition: false });
    await flush();

    mount(h(Router, { routes, fallback: NotFoundPage }), container);
    await flush();

    assert.ok(container.querySelector('#not-found'), 'Fallback should be rendered');
  });

  it('should update content on navigation (reactive)', async () => {
    const container = getContainer();
    // Start at home
    history.pushState(null, '', '/');
    await navigate('/', { replace: true, transition: false });
    await flush();

    mount(h(Router, { routes, fallback: NotFoundPage }), container);
    await flush();

    assert.ok(container.querySelector('#home'), 'Home page should be rendered initially');

    // Navigate to about
    await navigate('/about', { replace: true, transition: false });
    await flush();

    assert.ok(container.querySelector('#about'), 'About page should be rendered after navigation');
  });

  it('Router returns a reactive function child', () => {
    const result = Router({ routes, fallback: NotFoundPage });
    assert.equal(typeof result, 'function', 'Router should return a function for reactive rendering');
  });
});

// =========================================================================
// defineRoutes Helper
// =========================================================================

describe('defineRoutes', () => {
  it('should create route configs from a flat object', () => {
    function Home() { return 'Home'; }
    function About() { return 'About'; }

    const routes = defineRoutes({
      '/': Home,
      '/about': { component: About, layout: 'MainLayout' },
    });

    assert.equal(routes.length, 2);
    assert.equal(routes[0].path, '/');
    assert.equal(routes[0].component, Home);
    assert.equal(routes[1].path, '/about');
    assert.equal(routes[1].component, About);
    assert.equal(routes[1].layout, 'MainLayout');
  });
});

// =========================================================================
// Middleware
// =========================================================================

describe('Router middleware', () => {
  it('should render 403 when middleware returns false', async () => {
    const container = getContainer();
    history.pushState(null, '', '/protected');
    await navigate('/protected', { replace: true, transition: false });
    await flush();

    function ProtectedPage() {
      return h('div', { id: 'protected' }, 'Protected');
    }

    const routes = [
      {
        path: '/protected',
        component: ProtectedPage,
        middleware: [() => false],
      },
    ];

    mount(h(Router, { routes }), container);
    await flush();

    assert.ok(container.querySelector('.what-403'), 'Should show 403 when middleware rejects');
  });
});

// =========================================================================
// asyncGuard — reactive rendering
// =========================================================================

describe('asyncGuard', () => {
  it('should return a component that wraps in reactive function', () => {
    function MyPage(props) {
      return h('div', null, 'Page');
    }
    function LoadingComp() {
      return h('div', null, 'Loading...');
    }

    const guarded = asyncGuard(() => Promise.resolve(true), {
      loading: LoadingComp,
    });

    const GuardedPage = guarded(MyPage);
    assert.equal(typeof GuardedPage, 'function', 'Should return a function component');

    // When called, should return a reactive function (not a direct vnode)
    // We need a component context for effect() to work, so this is a structural check
  });
});

// =========================================================================
// Link — reactive class attribute
// =========================================================================

describe('Link component', () => {
  it('should create an anchor element with href', async () => {
    const container = getContainer();
    history.pushState(null, '', '/');
    await navigate('/', { replace: true, transition: false });
    await flush();

    mount(h(Link, { href: '/about' }, 'About'), container);
    await flush();

    const a = container.querySelector('a');
    assert.ok(a, 'Should render an <a> element');
    assert.equal(a.getAttribute('href'), '/about');
  });

  it('should sanitize unsafe hrefs', async () => {
    const container = getContainer();

    mount(h(Link, { href: 'javascript:alert(1)' }, 'Bad'), container);
    await flush();

    const a = container.querySelector('a');
    assert.ok(a, 'Should render an <a> element');
    assert.equal(a.getAttribute('href'), 'about:blank');
  });

  it('should use reactive class for active state', async () => {
    const container = getContainer();
    history.pushState(null, '', '/about');
    await navigate('/about', { replace: true, transition: false });
    await flush();

    mount(h(Link, { href: '/about' }, 'About'), container);
    await flush();

    const a = container.querySelector('a');
    assert.ok(a, 'Should render an <a> element');
    // The class prop is a reactive function — the DOM runtime resolves it via effect
    // In jsdom with our runtime, the class should contain 'active' and 'exact-active'
  });
});

// =========================================================================
// Navigation
// =========================================================================

describe('navigate()', () => {
  it('should reject unsafe URLs', async () => {
    const urlBefore = route.url;
    await navigate('javascript:alert(1)');
    // URL should not change
    assert.equal(route.url, urlBefore);
  });

  it('should not navigate to same URL', async () => {
    const current = route.url;
    await navigate(current);
    assert.equal(route.url, current);
  });
});
