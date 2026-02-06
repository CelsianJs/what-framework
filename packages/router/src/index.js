// What Framework - Router
// File-based routing (like Next.js/Astro) + programmatic API.
// Supports nested layouts, dynamic params, catch-all routes, and middleware.

import { signal, effect, h, computed } from '../../core/src/index.js';

// --- Route State (global singleton) ---

const _url = signal(typeof location !== 'undefined' ? location.pathname + location.search + location.hash : '/');
const _params = signal({});
const _query = signal({});

export const route = {
  get url() { return _url(); },
  get path() { return _url().split('?')[0].split('#')[0]; },
  get params() { return _params(); },
  get query() { return _query(); },
  get hash() {
    const h = _url().split('#')[1];
    return h ? '#' + h : '';
  },
};

// --- Navigation ---

export function navigate(to, opts = {}) {
  const { replace = false, state = null } = opts;
  if (replace) {
    history.replaceState(state, '', to);
  } else {
    history.pushState(state, '', to);
  }
  _url.set(to);
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

  // Normalize file-based [param] to :param, preserve catch-all names
  const catchAllNames = {};
  let normalized = path.replace(/\[\.\.\.(\w+)\]/g, (_, name) => {
    catchAllNames['*'] = name;
    return '*';
  }).replace(/\[(\w+)\]/g, ':$1');

  const paramNames = [];
  let catchAll = null;

  const regexStr = normalized
    .split('/')
    .map(segment => {
      if (segment === '*') {
        const name = catchAllNames['*'] || 'rest';
        catchAll = name;
        paramNames.push(name);
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
  for (const route of routes) {
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

// --- Router Component ---

export function Router({ routes, fallback }) {
  // Reactive: re-renders when URL changes
  const currentUrl = _url();
  const path = currentUrl.split('?')[0].split('#')[0];
  const search = currentUrl.split('?')[1]?.split('#')[0] || '';

  const matched = matchRoute(path, routes);

  if (matched) {
    _params.set(matched.params);
    _query.set(parseQuery(search));

    const { route: r, params } = matched;

    // Build layout chain
    let element = h(r.component, { params, query: parseQuery(search) });

    if (r.layout) {
      element = h(r.layout, {}, element);
    }

    return element;
  }

  // 404
  if (fallback) return h(fallback, {});
  return h('div', { class: 'what-404' }, '404 - Page not found');
}

// --- Link Component ---

export function Link({ href, class: cls, className, children, replace: rep, ...rest }) {
  return h('a', {
    href,
    class: cls || className,
    onClick: (e) => {
      // Only intercept left-clicks without modifiers
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      navigate(href, { replace: rep });
    },
    ...rest,
  }, ...(Array.isArray(children) ? children : [children]));
}

// --- Define Routes Helper ---
// Creates route config from a flat object for convenience.

export function defineRoutes(config) {
  return Object.entries(config).map(([path, component]) => {
    if (typeof component === 'function') {
      return { path, component };
    }
    // Object form with layout, middleware, etc.
    return { path, ...component };
  });
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
      if (check(props)) {
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

export function prefetch(href) {
  if (typeof document === 'undefined') return;
  const existing = document.querySelector(`link[href="${href}"]`);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = href;
  document.head.appendChild(link);
}
