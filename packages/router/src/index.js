// What Framework - Router
// Production-grade file-based routing with nested layouts, loading states,
// route groups, view transitions, and middleware.

import { signal, effect, computed, batch, h, ErrorBoundary } from 'what-core';

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
  const { replace = false, state = null, transition = true } = opts;

  // Don't navigate if already on the same URL
  if (to === _url()) return;

  _isNavigating.set(true);
  _navigationError.set(null);

  const doNavigation = () => {
    if (replace) {
      history.replaceState(state, '', to);
    } else {
      history.pushState(state, '', to);
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

// Back/forward support
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    _url.set(location.pathname + location.search + location.hash);
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
    if (key) params[decodeURIComponent(key)] = val ? decodeURIComponent(val) : '';
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
          // Middleware returned a redirect path
          navigate(result, { replace: true });
          return null;
        }
      }
    }

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
  const currentPath = route.path;
  // Segment-boundary matching: '/blog' matches '/blog/123' but not '/blog-archive'
  const isActive = href === '/'
    ? currentPath === '/'
    : currentPath === href || currentPath.startsWith(href + '/');
  const isExactActive = currentPath === href;

  const classes = [
    cls || className,
    isActive && activeClass,
    isExactActive && exactActiveClass,
  ].filter(Boolean).join(' ') || undefined;

  return h('a', {
    href,
    class: classes,
    onclick: (e) => {
      // Only intercept left-clicks without modifiers
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      navigate(href, { replace: rep, transition });
    },
    onmouseenter: shouldPrefetch ? () => prefetch(href) : undefined,
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

      effect(() => {
        Promise.resolve(check(props))
          .then(result => {
            checkResult.set(result);
            status.set(result ? 'allowed' : 'denied');
          })
          .catch(() => status.set('denied'));
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
