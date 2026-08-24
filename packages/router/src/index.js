// What Framework - Router
// Production-grade file-based routing with nested layouts, loading states,
// route groups, view transitions, and middleware.

import { signal, effect, computed, batch, h, ErrorBoundary } from 'what-core';
import { matchRoute, parseQuery } from './match.js';

// --- URL Sanitization ---
// Rejects javascript:, data:, vbscript: protocols (case-insensitive, trimmed),
// any scheme outside the allowlist (blob:, about:, filesystem: ...), and
// protocol-relative / backslash-smuggled paths that resolve to a foreign
// origin. Browsers treat "\" like "/", so "/\evil.com" is an open redirect.
//
// Sibling predicate: safeLocalPath / safeRedirectTarget in
// packages/server/src/action-handler.js. That one gates a server-issued
// `Location:` header and must stay strictly narrower (same-origin local paths
// only), because a form POST target is attacker-controllable in a way a client
// navigation target is not. This one deliberately allows absolute http(s),
// mailto: and tel:. Harden one, re-read the other; do not unify them.
// packages/server/test/redirect-predicate-parity.test.js gates that ordering.

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function isSafeUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  // Check for dangerous protocols (case-insensitive, ignoring whitespace/control chars)
  const normalized = trimmed.replace(/[\s\x00-\x1f]/g, '').toLowerCase();
  if (normalized.startsWith('javascript:')) return false;
  if (normalized.startsWith('data:')) return false;
  if (normalized.startsWith('vbscript:')) return false;
  if (/^[/\\]{2}/.test(normalized)) return false;
  const scheme = normalized.match(/^([a-z][a-z0-9+.-]*:)/);
  if (scheme) return SAFE_PROTOCOLS.has(scheme[1]);
  // Scheme-less only: browsers normalize a backslash to a forward slash, so
  // `\evil.com` resolves off-origin exactly as `/\evil.com` does. Absolute
  // URLs already passed the protocol allowlist above.
  if (normalized.includes('\\')) return false;
  return true;
}

// --- Route State (global singleton) ---

const _url = signal(typeof location !== 'undefined' ? location.pathname + location.search + location.hash : '/');
const _params = signal({});
const _query = signal({});
const _isNavigating = signal(false);
// The URL a navigation is heading TO, live for the duration of the navigation.
// _url only commits at the very end, so during an awaited guard the router still
// matches the route being LEFT. Without this, a destination route's `loading:`
// component could never be shown: the only `loading:` in scope belonged to the
// page the user was leaving.
const _pendingUrl = signal(null);
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

// --- Navigation Hooks ---
// Subscriber lists consulted by navigate(). Guards run before the URL changes
// and can cancel by returning false; afterNavigate runs once the URL committed.
// Module singletons on purpose: this module is browser-only (it listens for
// popstate and mutates history), so its scope is one tab, not one request. The
// server adapters import what-router/match, never this file, so there is no
// shared-process path here of the kind b066671 fixed for server actions.

const _beforeHooks = [];
const _afterHooks = [];

function subscribe(list, fn) {
  list.push(fn);
  return () => {
    const i = list.indexOf(fn);
    if (i !== -1) list.splice(i, 1);
  };
}

export function beforeNavigate(fn) {
  return subscribe(_beforeHooks, fn);
}

export function afterNavigate(fn) {
  return subscribe(_afterHooks, fn);
}

// --- Navigation with View Transitions ---

export async function navigate(to, opts = {}) {
  const { replace = false, state = null, transition = true, _fromPopstate = false, _redirectChain = false } = opts;

  // A navigation the user asked for starts a fresh redirect chain; a hop
  // queued by handleRedirect continues the current one.
  if (!_redirectChain) _redirectHistory.length = 0;

  // Reject unsafe URLs
  if (!isSafeUrl(to)) {
    if (typeof console !== 'undefined') {
      // isSafeUrl() rejects non-strings, so the value reaching this warning is
      // exactly the kind that can throw on template-literal coercion (Symbol,
      // null-prototype object). Log it as a separate argument.
      console.warn('[what-router] Blocked navigation to unsafe URL:', to);
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

  // Prevent concurrent navigations: wait for the current one to finish. The
  // flag is claimed in the same tick as the check, because an awaited
  // beforeNavigate hook otherwise leaves a gap two navigations both get through.
  if (_isNavigating.peek()) return;
  _isNavigating.set(true);
  _pendingUrl.set(to);

  const from = _url();

  // A popstate has already moved the browser URL, so cancelling one means
  // pushing the previous entry back to keep the address bar in sync. That entry
  // is a new one: the forward entry is not recoverable and its history.state is
  // not carried over. Documented on beforeNavigate in index.d.ts.
  if (_beforeHooks.length) {
    let cancelled = false;
    try {
      for (const fn of _beforeHooks.slice()) {
        if ((await fn(to, from)) === false) { cancelled = true; break; }
      }
    } catch (e) {
      // A throwing guard must not leave the router permanently wedged.
      _isNavigating.set(false);
      _pendingUrl.set(null);
      throw e;
    }
    if (cancelled) {
      _isNavigating.set(false);
      _pendingUrl.set(null);
      if (_fromPopstate && typeof history !== 'undefined') history.pushState(null, '', from);
      return;
    }
  }

  _navigationError.set(null);

  const doNavigation = () => {
    // Skip history manipulation on popstate (browser already updated the URL)
    if (!_fromPopstate) {
      // Save scroll position for current URL before navigating away.
      // Full URL as the key, { x, y } as the value: see scrollPositions below,
      // every writer and the reader must agree on both.
      if (typeof window !== 'undefined') {
        scrollPositions.set(_url(), { x: window.scrollX, y: window.scrollY });
      }
      if (replace) {
        history.replaceState(state, '', to);
      } else {
        history.pushState(state, '', to);
      }
    }
    _url.set(to);
    _isNavigating.set(false);
    _pendingUrl.set(null);
  };

  // Use View Transitions API if available and enabled
  if (transition && typeof document !== 'undefined' && document.startViewTransition) {
    try {
      const viewTransition = document.startViewTransition(doNavigation);
      // `.ready` rejects when the transition is skipped, which two navigations
      // in quick succession do routinely. Awaiting only `.finished` left that
      // rejection unhandled, so it surfaced as an uncaught page error
      // ("Transition was skipped") and landed in whatever error reporter the
      // app had installed, for a navigation that actually succeeded.
      if (viewTransition.ready && typeof viewTransition.ready.catch === 'function') {
        viewTransition.ready.catch(() => {});
      }
      await viewTransition.finished;
    } catch {
      // Transition failed, navigation still happened
    }
  } else {
    doNavigation();
  }

  if (_afterHooks.length) {
    for (const fn of _afterHooks.slice()) fn(to, from);
  }
}

// --- redirect() ---
// Throws a navigation signal. Two places catch it:
//
//   - Route middleware, caught by the Router's own matching pass below.
//   - A component body, caught by core's createComponent, which invokes the
//     handler the signal carries under Symbol.for('what.navigation.signal')
//     rather than reporting the throw to an ErrorBoundary. h() is lazy, so a
//     route component is instantiated after the matching pass has returned;
//     that is why the second catch has to live in core.
//
// Anywhere else (an event handler, a promise callback, a timer) nothing catches
// it and the signal surfaces as an uncaught error. It carries a code, a fix and
// an example for exactly that case, because that is the only case a human reads
// it in.

const REDIRECT = Symbol.for('what.router.redirect');
const NAV_SIGNAL = Symbol.for('what.navigation.signal');

export function redirect(to, options = {}) {
  if (!isSafeUrl(to)) {
    const target = typeof to === 'string' ? to : Object.prototype.toString.call(to);
    const err = new Error(`[what-router] redirect() refused an unsafe target: ${target}`);
    err.code = 'ERR_UNSAFE_REDIRECT';
    err.suggestion = 'redirect() accepts same-origin paths and http:, https:, mailto: or tel: URLs only. Protocol-relative ("//host"), backslash-smuggled and javascript:/data: targets are open-redirect vectors. Check a user-supplied target against an allowlist first.';
    err.codeExample = `// Bad - a user-controlled target can leave your origin:
redirect(query.next);

// Good - allowlist the target first:
redirect(ALLOWED.has(query.next) ? query.next : '/');`;
    throw err;
  }

  const sig = new Error(`[what-router] redirect to ${to}`);
  sig.name = 'RouterRedirect';
  sig.code = 'ERR_REDIRECT_NOT_CAUGHT';
  sig.suggestion = 'Seeing this signal in your console means nothing caught it. redirect() works from route middleware and from a component body, where the Router catches it. From an event handler, a promise callback or a timer, call navigate(to) instead. A try/catch around the redirect() call also swallows it.';
  sig.codeExample = `// Bad - an event handler runs long after the render the Router caught:
<button onclick={() => redirect('/login')}>Sign in</button>

// Good - navigate() from a handler:
<button onclick={() => navigate('/login')}>Sign in</button>

// Good - redirect() from a component body, which the Router catches:
function Private() {
  if (!user()) redirect('/login');
  return <Secret />;
}`;
  sig[REDIRECT] = true;
  sig[NAV_SIGNAL] = () => { handleRedirect(to, options); };
  sig.to = to;
  sig.options = options;
  throw sig;
}

// Back/forward support — route through navigate() so middleware runs
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    // Save scroll position for the URL we're leaving
    scrollPositions.set(_url(), { x: window.scrollX, y: window.scrollY });

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
// compilePath / matchRoute / parseQuery live in ./match.js (isomorphic, no DOM)
// and are imported above so the server adapter can reuse them.

// Re-export the matcher so `what-router` consumers (and the server adapter via
// `what-router/match`) can import it from the package root too.
export { compilePath, matchRoute, parseQuery } from './match.js';

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

function loopScreen(message) {
  return h('div', { class: 'what-redirect-loop' },
    h('h1', null, 'Redirect Loop'),
    h('p', null, message)
  );
}

// Shared by the middleware string form and by a thrown redirect() signal.
// Returns null once the navigation is queued, or the loop screen if the
// redirect chain is cycling.
//
// The chain is scoped to one user navigation: navigate() clears the history
// unless it is being called from here. Clearing it on a successful match
// instead would never catch a cycle between two route components, because each
// hop matches successfully before its component throws the next redirect.
function handleRedirect(target, options) {
  // A navigation to this exact target is already in flight, so this is a
  // re-match of the same hop, not a second one.
  //
  // It happens on every re-match that occurs before the URL commits. With the
  // View Transitions API, navigate() defers the `_url` write into the
  // transition callback while `_isNavigating` flips immediately, and
  // renderMatch reads `_isNavigating`, so the match re-runs against the
  // still-old URL, the same middleware returns the same target, and the hop was
  // counted twice. One guarded deep link produced 25 false "Redirect cycle
  // detected" errors and a flash of the redirect-loop screen, and the detector
  // then cleared `_isNavigating` / `_pendingUrl` while the real navigation was
  // still in flight, corrupting router state mid-navigation.
  //
  // Chromium-only, because without View Transitions doNavigation() runs
  // synchronously and the URL and the flag change together.
  if (_pendingUrl.peek() === target) return null;

  _redirectHistory.push(target);

  if (_redirectHistory.length > MAX_REDIRECTS) {
    const cycle = _redirectHistory.slice(-5).join(' → ');
    _redirectHistory.length = 0;
    console.error(`[what-router] Redirect loop detected: ${cycle}`);
    _isNavigating.set(false);
    _pendingUrl.set(null);
    return loopScreen('Too many redirects. Check your middleware configuration.');
  }

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
    _pendingUrl.set(null);
    return loopScreen('Circular redirect detected. Check your middleware configuration.');
  }

  navigate(target, { replace: true, ...options, _redirectChain: true });
  return null;
}

// --- Router Component ---

// The `loading:` component of the route a navigation is heading to, or null when
// there is no pending destination, it does not match, it declares no loading
// component, or it is the route already being rendered.
function destinationLoading(pendingUrl, routes, currentRoute) {
  if (!pendingUrl) return null;
  const destPath = pendingUrl.split('?')[0].split('#')[0];
  const dest = matchRoute(destPath, routes);
  if (!dest || dest.route === currentRoute) return null;
  return dest.route.loading || null;
}

export function Router({ routes, fallback, globalLayout }) {
  // The Router component runs ONCE. `content` is a reactive function child that
  // re-evaluates whenever _url changes; the fine-grained runtime reconciles only
  // the matched page in place. The globalLayout is rendered ONCE around it (below)
  // so the app shell persists across navigations instead of re-instantiating.
  const renderMatch = () => {
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
            return handleRedirect(result);
          }
        }
      }

      // Build element with loading state support
      let element;

      // While a navigation is in flight, a `loading:` declared by the
      // DESTINATION wins. _url has not committed yet, so `r` is still the route
      // being left: without this, declaring `loading:` on the page you are
      // navigating TO could never show it. Falling back to the departing route's
      // `loading:` preserves the existing behaviour for the case where only the
      // page being left declares one.
      const pendingLoading = isNavigating ? destinationLoading(_pendingUrl(), routes, r) : null;

      if (pendingLoading) {
        element = h(pendingLoading, {});
      } else if (r.loading && isNavigating) {
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

      return element;
    }

    // 404
    if (fallback) return h(fallback, {});
    return h('div', { class: 'what-404' },
      h('h1', null, '404'),
      h('p', null, 'Page not found')
    );
  };

  // Catches a redirect() thrown by route middleware. A redirect() thrown by a
  // route component is caught by core instead, because h() is lazy and the
  // component runs after renderMatch has returned. Anything unbranded
  // propagates to the app's ErrorBoundary unchanged.
  const content = () => {
    let sig = null;
    try {
      return renderMatch();
    } catch (e) {
      if (!e || !e[REDIRECT]) throw e;
      sig = e;
    }
    return handleRedirect(sig.to, sig.options);
  };

  // Render the global layout ONCE so it — and everything it mounts (sidebars,
  // toasters, command palettes, global key listeners) — PERSISTS across
  // navigations; the reactive `content` child swaps the matched page in place.
  // A function child is a reactive region (see render.insert), so on navigation
  // only the page subtree reconciles, never the shell. 404/403/redirect screens
  // now render inside the shell too (the natural meaning of a "global" layout).
  // Without a globalLayout, `content` itself is the reactive root — Router still
  // returns a reactive function child (back-compat).
  return globalLayout ? h(globalLayout, {}, content) : content;
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
    console.warn('[what-router] Link blocked unsafe href:', href);
  }

  // Strip query string and hash from href for path comparison
  const hrefPath = safeHref.split('?')[0].split('#')[0];

  // Use a reactive function for class so active states update on navigation.
  // In the run-once model, reading route.path directly would snapshot it.
  const reactiveClass = () => {
    const currentPath = route.path;
    const isActive = hrefPath === '/'
      ? currentPath === '/'
      : currentPath === hrefPath || currentPath.startsWith(hrefPath + '/');
    const isExactActive = currentPath === hrefPath;

    return [
      cls || className,
      isActive && activeClass,
      isExactActive && exactActiveClass,
    ].filter(Boolean).join(' ') || undefined;
  };

  return h('a', {
    href: safeHref,
    class: reactiveClass,
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

// Join a base path with a child path. Naive concatenation turned the index
// child of `nestedRoutes('/dashboard', [{ path: '/' }, ...])` — the form the
// README documents — into '/dashboard/', which '/dashboard' does not match, so
// the documented example 404s on its own index route.
function joinRoutePath(basePath, childPath) {
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const child = !childPath || childPath === '/' ? '/' : (childPath.startsWith('/') ? childPath : `/${childPath}`);
  if (child === '/') return base || '/';
  return base + child;
}

export function nestedRoutes(basePath, children, options = {}) {
  const { layout, loading, error } = options;

  return children.map(child => ({
    ...child,
    path: joinRoutePath(basePath, child.path),
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

      // Return a reactive function child so status changes update the DOM.
      // Components run once, so reading status() outside a reactive wrapper
      // would snapshot the value and never update.
      return () => {
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

// Saved viewport offsets. ONE key (the full URL: path + search + hash) and ONE
// shape ({ x, y }) shared by every writer and by the reader below.
//
// They used to disagree on both. navigate() and the popstate handler wrote
// { x, y } keyed by the full URL, while enableScrollRestoration()'s own
// beforeunload handler wrote a bare NUMBER keyed by location.pathname, and the
// restore effect looked the entry up by route.path (the pattern-stripped path,
// never the query or the hash) and handed it straight to
// `window.scrollTo(0, savedPosition)`. A hit on a { x, y } record therefore
// produced `scrollTo(0, NaN)`, which browsers normalize to 0 and which jumps
// the page to the TOP; a URL carrying a query string or a hash missed the
// lookup entirely and got the same jump. Restoration could not work at all.
// If you add a writer, key it by the full URL and store { x, y }.
const scrollPositions = new Map();

export function enableScrollRestoration() {
  if (typeof window === 'undefined') return;

  // There is deliberately no beforeunload writer. scrollPositions is an
  // in-memory Map that dies with the document, so anything written while the
  // page is unloading can never be read back. The only case where the write
  // survived is the one where the document does NOT go away (the user cancels
  // the "leave site?" prompt), and there it poisoned the map with an entry of
  // the wrong shape under the wrong key. Restoring scroll across a RELOAD is
  // the browser's job (history.scrollRestoration), and the first-run guard
  // below is what keeps this effect out of its way.

  // The effect's first run is the URL the document loaded with, not a
  // navigation this router performed: the browser has already positioned the
  // document (top for a fresh load, the previous offset for a reload or a
  // document-recreating back). Scrolling to the top there would undo exactly
  // the restoration the comment above defers to. Nothing else is affected,
  // because scrollPositions is necessarily empty on the first run, so the
  // guard can only ever suppress the scroll-to-top branch.
  let firstRun = true;

  // Restore the saved position after each committed navigation. Reading
  // route.url subscribes to the URL signal, so this re-runs for query-only and
  // hash-only changes too, which is the granularity the map is keyed at.
  effect(() => {
    const url = route.url;
    const saved = scrollPositions.get(url);
    // Read inside the effect, not inside the frame callback: by the time the
    // frame runs another navigation may already have moved the URL on. Same
    // reason the first-run latch is consumed here rather than in the frame.
    const hash = route.hash;
    const isFirstRun = firstRun;
    firstRun = false;

    requestAnimationFrame(() => {
      // Hash BEFORE saved, and the order is load-bearing. A URL carrying a
      // hash is a request for a specific ELEMENT, and it outranks any offset
      // saved under that same URL: clicking a "/guide#api" link a second time
      // has to land on #api, not on wherever the user happened to be standing
      // the last time they left /guide#api. Because navigate() keys the map by
      // the full URL (hash included), checking `saved` first made this branch
      // unreachable for every hash URL the user had already visited, and it
      // also fought navigate()'s own same-page hash handling: that path
      // scrollIntoViews the anchor synchronously, and a `saved` hit here
      // clobbered it one frame later.
      if (hash) {
        // Deferred to the frame because an SSR-less deep link renders the
        // target element after the URL commits, so it does not exist yet here.
        const el = queryFragment(hash);
        // No fallback when the anchor is missing: it may simply not have
        // rendered yet, and yanking the page to the top (or to some unrelated
        // saved offset) is the worse answer to "I asked for #api".
        el?.scrollIntoView();
      } else if (saved) {
        window.scrollTo(saved.x, saved.y);
      } else if (!isFirstRun) {
        window.scrollTo(0, 0);
      }
    });
  });
}

// Resolve a URL fragment to its element. A fragment is an id, and an id is not
// necessarily a valid CSS selector: "#1" is legal HTML that browsers navigate
// to happily, while querySelector('#1') THROWS "Invalid selector". The throw
// happened inside a requestAnimationFrame callback, where nothing could catch
// it, so a single numeric anchor took out the frame as an uncaught error.
function queryFragment(hash) {
  try {
    return document.querySelector(hash);
  } catch {
    // Not selector-parseable, so ask the way the browser itself does.
    return document.getElementById(hash.slice(1));
  }
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

// --- Route Accessors ---
// Read the singleton route state directly. Called inside a tracking scope
// (a reactive text binding, computed or effect) they subscribe to it.

export function useParams() {
  return route.params;
}

// Same singleton `_query` signal as route.query: only the Router's match branch
// writes it, so on an unmatched (404) route this is the last matched route's
// query, not the current URL's. Documented on both declarations.
export function useSearch() {
  return route.query;
}

export function useNavigate() {
  return navigate;
}

export function prefetchRoute(href) {
  prefetch(href);
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
  // Convert file-router route format to Router's expected format.
  // loading/error used to be dropped here, so a route could declare either and
  // never see it rendered, and the `error` prop was destructured and then never
  // read: a documented public prop that silently did nothing.
  const routerRoutes = routes.map(r => ({
    path: r.path,
    component: r.component,
    layout: r.layout || undefined,
    loading: r.loading || undefined,
    error: r.error || globalError || undefined,
    // Attach page mode as metadata for build system
    _mode: r.mode || 'client',
  }));

  // Router already returns a reactive function child — just delegate
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
