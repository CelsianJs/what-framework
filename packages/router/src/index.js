// What Framework - Router
// Production-grade file-based routing with nested layouts, loading states,
// route groups, view transitions, and middleware.

import { signal, effect, computed, batch, h, ErrorBoundary } from 'what-core';

// --- URL Sanitization ---
// Rejects javascript:, data:, vbscript: protocols (case-insensitive, trimmed).

export function isSafeUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  // Check for dangerous protocols (case-insensitive, ignoring whitespace/control chars)
  const normalized = trimmed.replace(/[\s\x00-\x1f]/g, '').toLowerCase();
  if (normalized.startsWith('javascript:')) return false;
  if (normalized.startsWith('data:')) return false;
  if (normalized.startsWith('vbscript:')) return false;
  return true;
}

// --- Route State (global singleton) ---

const _url = signal(typeof location !== 'undefined' ? location.pathname + location.search + location.hash : '/');
const _params = signal({});
const _query = signal({});
const _isNavigating = signal(false);
const _navigationError = signal(null);

export const route = {
  get url() { return _url(); },
  get path() { return _url().split('?')[0].split('#')[0]; },
  get params() { return _params(); },
  get query() { return _query(); },
  get hash() {
    const h = _url().split('#')[1];
    return h ? '#' + h : '';
  },
  get isNavigating() { return _isNavigating(); },
  get error() { return _navigationError(); },
};

// --- Navigation with View Transitions ---

export async function navigate(to, opts = {}) {
  const { replace = false, state = null, transition = true, _fromPopstate = false } = opts;

  // Reject unsafe URLs
  if (!isSafeUrl(to)) {
    if (typeof console !== 'undefined') {
      console.warn(`[what-router] Blocked navigation to unsafe URL: ${to}`);
    }
    return;
  }

  // Handle same-page hash links — use replaceState and scroll directly
  if (typeof window !== 'undefined' && to.startsWith('#')) {
    const currentUrl = _url();
    const basePath = currentUrl.split('#')[0];
    const newUrl = basePath + to;
    history.replaceState(state, '', newUrl);
    _url.set(newUrl);
    const el = document.querySelector(to);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  // Don't navigate if already on the same URL
  if (to === _url()) return;

  // Prevent concurrent navigations — wait for current to finish
  if (_isNavigating.peek()) return;

  _isNavigating.set(true);
  _navigationError.set(null);

  const doNavigation = () => {
    // Skip history manipulation on popstate (browser already updated the URL)
    if (!_fromPopstate) {
      // Save scroll position for current URL before navigating away
      if (typeof window !== 'undefined') {
        scrollPositions.set(_url(), { x: scrollX, y: scrollY });
      }
      if (replace) {
        history.replaceState(state, '', to);
      } else {
        history.pushState(state, '', to);
      }
    }
    _url.set(to);
    _isNavigating.set(false);
  };

  // Use View Transitions API if available and enabled
  if (transition && typeof document !== 'undefined' && document.startViewTransition) {
    try {
      await document.startViewTransition(doNavigation).finished;
    } catch (e) {
      // Transition failed, navigation still happened
    }
  } else {
    doNavigation();
  }
}

// Back/forward support — route through navigate() so middleware runs
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    // Save scroll position for the URL we're leaving
    scrollPositions.set(_url(), { x: scrollX, y: scrollY });

    const newUrl = location.pathname + location.search + location.hash;
    // Use _fromPopstate flag so navigate() skips pushState (browser already updated URL)
    navigate(newUrl, { replace: true, _fromPopstate: true, transition: false }).then(() => {
      // Restore saved scroll position for the URL we're arriving at
      const saved = scrollPositions.get(newUrl);
      if (saved) {
        requestAnimationFrame(() => window.scrollTo(saved.x, saved.y));
      }
    });
  });
}

// --- Route Matching ---

function compilePath(path) {
  // /users/:id -> regex + param names
  // /posts/* -> catch-all
  // /[slug] -> dynamic (file-based syntax)
  // (group) -> route group (ignored in URL)

  // Remove route groups from path (they don't affect URL matching)
  const normalized = path
    .replace(/\([\w-]+\)\//g, '') // Remove (group)/ prefixes
    .replace(/\[\.\.\.(\w+)\]/g, (_, name) => `*:${name}`) // Preserve catch-all name
    .replace(/\[(\w+)\]/g, ':$1'); // File-based [param] to :param

  const paramNames = [];
  let catchAll = null;

  const regexStr = normalized
    .split('/')
    .map(segment => {
      if (segment.startsWith('*:')) {
        catchAll = segment.slice(2);
        paramNames.push(catchAll);
        return '(.+)';
      }
      if (segment === '*') {
        catchAll = 'rest';
        paramNames.push('rest');
        return '(.+)';
      }
      if (segment.startsWith(':')) {
        paramNames.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  const regex = new RegExp(`^${regexStr}$`);
  return { regex, paramNames, catchAll };
}

function matchRoute(path, routes) {
  // Filter out routes without a path (layout-only routes, etc.)
  const routable = routes.filter(r => r.path);

  // Sort routes by specificity (more specific first)
  const sorted = routable.sort((a, b) => {
    const aSpecific = (a.path.match(/:/g) || []).length + (a.path.includes('*') ? 100 : 0);
    const bSpecific = (b.path.match(/:/g) || []).length + (b.path.includes('*') ? 100 : 0);
    return aSpecific - bSpecific;
  });

  for (const route of sorted) {
    const { regex, paramNames } = compilePath(route.path);
    const match = path.match(regex);
    if (match) {
      const params = {};
      paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1]);
      });
      return { route, params };
    }
  }
  return null;
}

function parseQuery(search) {
  const params = {};
  if (!search) return params;
  const qs = search.startsWith('?') ? search.slice(1) : search;
  for (const pair of qs.split('&')) {
    const [key, val] = pair.split('=');
    if (!key) continue;
    const decodedKey = decodeURIComponent(key);
    const decodedVal = val ? decodeURIComponent(val) : '';
    if (decodedKey in params) {
      // Collect repeated keys into arrays
      if (Array.isArray(params[decodedKey])) {
        params[decodedKey].push(decodedVal);
      } else {
        params[decodedKey] = [params[decodedKey], decodedVal];
      }
    } else {
      params[decodedKey] = decodedVal;
    }
  }
  return params;
}

// --- Nested Layouts ---

// Build the layout chain for a route
function buildLayoutChain(route, routes) {
  const layouts = [];
  if (!route.path) return layouts;

  // Check for nested layouts based on path segments
  const segments = route.path.split('/').filter(Boolean);
  let currentPath = '';

  for (const segment of segments) {
    currentPath += '/' + segment;

    // Find layout for this path level
    const layoutRoute = routes.find(r =>
      r.layout && r.path === currentPath + '/_layout'
    );
    if (layoutRoute) {
      layouts.push(layoutRoute.layout);
    }
  }

  // Add route's own layout if specified
  if (route.layout) {
    layouts.push(route.layout);
  }

  return layouts;
}

// --- Middleware redirect loop detection ---
const _redirectHistory = [];
const MAX_REDIRECTS = 10;

// --- Router Component ---

export function Router({ routes, fallback, globalLayout }) {
  const currentUrl = _url();
  const path = currentUrl.split('?')[0].split('#')[0];
  const search = currentUrl.split('?')[1]?.split('#')[0] || '';
  const isNavigating = _isNavigating();

  const matched = matchRoute(path, routes);

  if (matched) {
    batch(() => {
      _params.set(matched.params);
      _query.set(parseQuery(search));
    });

    const { route: r, params } = matched;
    const queryObj = parseQuery(search);

    // Run middleware (sync only — async middleware should use asyncGuard)
    if (r.middleware && r.middleware.length > 0) {
      for (const mw of r.middleware) {
        const result = mw({ path, params, query: queryObj, route: r });
        if (result === false) {
          // Middleware rejected — show fallback
          if (fallback) return h(fallback, {});
          return h('div', { class: 'what-403' }, h('h1', null, '403'), h('p', null, 'Access denied'));
        }
        if (typeof result === 'string') {
          // Redirect loop detection
          _redirectHistory.push(result);
          if (_redirectHistory.length > MAX_REDIRECTS) {
            const cycle = _redirectHistory.slice(-5).join(' → ');
            _redirectHistory.length = 0;
            console.error(`[what-router] Redirect loop detected: ${cycle}`);
            _isNavigating.set(false);
            return h('div', { class: 'what-redirect-loop' },
              h('h1', null, 'Redirect Loop'),
              h('p', null, 'Too many redirects. Check your middleware configuration.')
            );
          }
          // Check for direct cycle (A → B → A)
          const seen = new Set();
          let hasCycle = false;
          for (const url of _redirectHistory) {
            if (seen.has(url)) { hasCycle = true; break; }
            seen.add(url);
          }
          if (hasCycle) {
            const cycle = _redirectHistory.join(' → ');
            _redirectHistory.length = 0;
            console.error(`[what-router] Redirect cycle detected: ${cycle}`);
            _isNavigating.set(false);
            return h('div', { class: 'what-redirect-loop' },
              h('h1', null, 'Redirect Loop'),
              h('p', null, 'Circular redirect detected. Check your middleware configuration.')
            );
          }
          // Middleware returned a redirect path
          navigate(result, { replace: true });
          return null;
        }
      }
    }
    // Successful render — clear redirect history
    _redirectHistory.length = 0;

    // Build element with loading state support
    let element;

    if (r.loading && isNavigating) {
      element = h(r.loading, {});
    } else {
      element = h(r.component, {
        params,
        query: queryObj,
        route: r,
      });
    }

    // Wrap with per-route error boundary if specified
    if (r.error) {
      element = h(ErrorBoundary, { fallback: r.error }, element);
    }

    // Wrap with nested layouts (innermost to outermost)
    const layouts = buildLayoutChain(r, routes);
    for (const Layout of layouts.reverse()) {
      element = h(Layout, { params, query: queryObj }, element);
    }

    // Global layout wrapper
    if (globalLayout) {
      element = h(globalLayout, {}, element);
    }

    return element;
  }

  // 404
  if (fallback) return h(fallback, {});
  return h('div', { class: 'what-404' },
    h('h1', null, '404'),
    h('p', null, 'Page not found')
  );
}

// --- Link Component ---

export function Link({
  href,
  class: cls,
  className,
  children,
  replace: rep,
  prefetch: shouldPrefetch = true,
  activeClass = 'active',
  exactActiveClass = 'exact-active',
  transition = true,
  ...rest
}) {
  // Sanitize href — reject dangerous protocols
  const safeHref = isSafeUrl(href) ? href : 'about:blank';
  if (!isSafeUrl(href) && typeof console !== 'undefined') {
    console.warn(`[what-router] Link blocked unsafe href: ${href}`);
  }

  const currentPath = route.path;
  // Strip query string and hash from href for path comparison
  const hrefPath = safeHref.split('?')[0].split('#')[0];
  // Segment-boundary matching: '/blog' matches '/blog/123' but not '/blog-archive'
  const isActive = hrefPath === '/'
    ? currentPath === '/'
    : currentPath === hrefPath || currentPath.startsWith(hrefPath + '/');
  const isExactActive = currentPath === hrefPath;

  const classes = [
    cls || className,
    isActive && activeClass,
    isExactActive && exactActiveClass,
  ].filter(Boolean).join(' ') || undefined;

  return h('a', {
    href: safeHref,
    class: classes,
    onclick: (e) => {
      // Only intercept left-clicks without modifiers
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      navigate(safeHref, { replace: rep, transition });
    },
    onmouseenter: shouldPrefetch ? () => prefetch(safeHref) : undefined,
    ...rest,
  }, ...(Array.isArray(children) ? children : [children]));
}

// --- NavLink with active states ---

export function NavLink(props) {
  return Link(props);
}

// --- Define Routes Helper ---
// Creates route config from a flat object for convenience.

export function defineRoutes(config) {
  return Object.entries(config).map(([path, value]) => {
    if (typeof value === 'function') {
      return { path, component: value };
    }
    // Object form with layout, middleware, loading, error, etc.
    return { path, ...value };
  });
}

// --- Nested Route Helper ---

export function nestedRoutes(basePath, children, options = {}) {
  const { layout, loading, error } = options;

  return children.map(child => ({
    ...child,
    path: basePath + child.path,
    layout: child.layout || layout,
    loading: child.loading || loading,
    error: child.error || error,
  }));
}

// --- Route Groups ---
// Group routes without affecting URL structure

export function routeGroup(name, routes, options = {}) {
  const { layout, middleware } = options;

  return routes.map(route => ({
    ...route,
    _group: name,
    layout: route.layout || layout,
    middleware: [...(route.middleware || []), ...(middleware || [])],
  }));
}

// --- Redirect ---

export function Redirect({ to }) {
  navigate(to, { replace: true });
  return null;
}

// --- Route Guards / Middleware ---

export function guard(check, fallback) {
  return (Component) => {
    return function GuardedRoute(props) {
      const result = check(props);

      // Support async guards
      if (result instanceof Promise) {
        // Return loading while checking
        return h('div', { class: 'what-guard-loading' }, 'Loading...');
      }

      if (result) {
        return h(Component, props);
      }

      if (typeof fallback === 'string') {
        navigate(fallback, { replace: true });
        return null;
      }
      return h(fallback, props);
    };
  };
}

// Async guard with suspense
export function asyncGuard(check, options = {}) {
  const { fallback = '/login', loading = null } = options;

  return (Component) => {
    return function AsyncGuardedRoute(props) {
      const status = signal('pending');
      const checkResult = signal(null);
      let cancelled = false;

      effect(() => {
        cancelled = false;
        Promise.resolve(check(props))
          .then(result => {
            if (cancelled) return;
            checkResult.set(result);
            status.set(result ? 'allowed' : 'denied');
          })
          .catch(() => {
            if (!cancelled) status.set('denied');
          });
        return () => { cancelled = true; };
      });

      const currentStatus = status();

      if (currentStatus === 'pending') {
        return loading ? h(loading, {}) : null;
      }

      if (currentStatus === 'allowed') {
        return h(Component, props);
      }

      if (typeof fallback === 'string') {
        navigate(fallback, { replace: true });
        return null;
      }
      return h(fallback, props);
    };
  };
}

// --- Prefetch ---
// Hint the browser to prefetch a route's assets.

const prefetchedUrls = new Set();

export function prefetch(href) {
  if (typeof document === 'undefined') return;
  if (prefetchedUrls.has(href)) return;
  prefetchedUrls.add(href);

  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = href;
  document.head.appendChild(link);
}

// --- Scroll Restoration ---

const scrollPositions = new Map();

export function enableScrollRestoration() {
  if (typeof window === 'undefined') return;

  // Save scroll position before navigation
  window.addEventListener('beforeunload', () => {
    scrollPositions.set(location.pathname, window.scrollY);
  });

  // Restore scroll position after navigation
  effect(() => {
    const path = route.path;
    const savedPosition = scrollPositions.get(path);

    requestAnimationFrame(() => {
      if (savedPosition !== undefined) {
        window.scrollTo(0, savedPosition);
      } else if (route.hash) {
        const el = document.querySelector(route.hash);
        el?.scrollIntoView();
      } else {
        window.scrollTo(0, 0);
      }
    });
  });
}

// --- View Transition Helpers ---

export function viewTransitionName(name) {
  return { style: { viewTransitionName: name } };
}

// Configure view transition types
export function setViewTransition(type) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.transition = type;
}

// --- useRoute Hook ---

export function useRoute() {
  return {
    path: computed(() => route.path),
    params: computed(() => route.params),
    query: computed(() => route.query),
    hash: computed(() => route.hash),
    isNavigating: computed(() => route.isNavigating),
    navigate,
    prefetch,
  };
}

// --- Outlet Component ---
// For nested route rendering

export function Outlet({ children }) {
  // Children passed from parent layout
  return children || null;
}

// --- File-Based Router ---
// Consumes routes generated by what-compiler's file router (virtual:what-routes).
// Usage:
//   import { routes } from 'virtual:what-routes';
//   mount(<FileRouter routes={routes} />, '#app');

export function FileRouter({
  routes,
  layout: globalLayout,
  fallback,
  error: globalError,
}) {
  // Convert file-router route format to Router's expected format
  const routerRoutes = routes.map(r => ({
    path: r.path,
    component: r.component,
    layout: r.layout || undefined,
    // Attach page mode as metadata for build system
    _mode: r.mode || 'client',
  }));

  return Router({
    routes: routerRoutes,
    globalLayout,
    fallback: fallback || Default404,
  });
}

function Default404() {
  return h('div', { style: 'text-align:center;padding:60px 20px' },
    h('h1', { style: 'font-size:48px;margin-bottom:8px' }, '404'),
    h('p', { style: 'color:#64748b' }, 'Page not found'),
  );
}
