// What Framework - Router
// Production-grade file-based routing with nested layouts, loading states,
// route groups, view transitions, and middleware.
//
// A navigation is a transition. navigate() first prepares the destination: it
// loads a lazy() route's chunk and runs the route's `preload`, whose queries
// fetch into the query cache, and waits for both. Then it commits the new URL
// inside startTransition, which holds what the URL change reaches (the outlet,
// a layout's data keyed on the params) until the async work it starts has
// landed, so the old page stays on screen until the new one can show at once.
// A newer navigation supersedes one still preparing.

import { signal, effect, computed, batch, untrack, flushSync, startTransition, createRoot, runWithOwner, getOwner, onCleanup, h, ErrorBoundary, getResponse } from 'what-core';
import { _tagQueries, _pathLoaded, _urgent, _currentTransition, _onCommit, _contextOf, _provide, _isServerProcess, __DEV__, getServerContext, reportDiagnostic } from 'what-core/internal';
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

function parses(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

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
  // An absolute URL the URL parser rejects (`http://[`, `https://%zz.example`)
  // is no destination: a link to it goes nowhere, and resolving it throws.
  if (scheme) return SAFE_PROTOCOLS.has(scheme[1]) && parses(trimmed);
  // Scheme-less only: browsers normalize a backslash to a forward slash, so
  // `\evil.com` resolves off-origin exactly as `/\evil.com` does. Absolute
  // URLs already passed the protocol allowlist above.
  if (normalized.includes('\\')) return false;
  return true;
}

// --- Route State ---
// A route state is what one <Router> shows: its URL, and the params and query
// it matched. `route` and the hooks read the state of the nearest <Router>
// above the reader. An outermost <Router> shows the tab's state (in the
// browser) or its request's (on a server); a nested one has a state of its
// own, so it never writes its parent's. Outside every Router a reader sees
// the tab's or the request's.
//
// The tab's state is module signals: one tab, one URL. The 'what-router:*'
// debug names let devtools report it (what_route, what_navigate) separately
// from the address bar. Nothing a server render reaches reads or writes the
// module: a server never navigates (navigate() redirects the response), and
// it has route state of its own, so overlapping requests cannot see each
// other's URL, params or query.

const _url = signal(typeof location !== 'undefined' ? location.pathname + location.search + location.hash : '/', 'what-router:url');
const _params = signal({}, 'what-router:params');
const _query = signal({}, 'what-router:query');
// A navigation runs from navigate() until the data its new page reads first
// has landed (route.isNavigating, and what_navigate's "settled"); it prepares
// until it commits, and while it prepares the destination's `loading:` shows.
const _navigating = signal(false, 'what-router:navigating');
const _preparing = signal(false, 'what-router:preparing');
// The URL a navigation is heading TO, live for the duration of the navigation.
// _url only commits at the very end, so during an awaited guard the router still
// matches the route being LEFT. Without this, a destination route's `loading:`
// component could never be shown: the only `loading:` in scope belonged to the
// page the user was leaving.
const _pendingUrl = signal(null, 'what-router:pendingUrl');
const _navigationError = signal(null, 'what-router:error');
// The route pattern the outermost <Router> matched last ('/users/:id'), or null.
const _pattern = signal(null, 'what-router:pattern');

/** The tab's route state. */
const tab = { url: readUrl, params: _params, query: _query };

// What a <Router> provides its state under (see here()).
const SCOPE = Symbol('what-router');

// Whether this runs on a server: in a server render, or anywhere in a server
// process (core's rule for code outside every render, such as code after an
// await without AsyncLocalStorage). A server never navigates.
function onServer() {
  return getServerContext() !== null || _isServerProcess();
}

/** The route state a reader sees: its nearest <Router>'s, else the tab's or the request's. */
function here() {
  const scope = _contextOf(SCOPE);
  if (scope !== null) return scope.get(SCOPE);
  if (!onServer()) return tab;
  const ctx = getServerContext();
  return ctx === null ? NO_ROUTE : requestState(ctx);
}

export const route = {
  get url() { return here().url(); },
  get path() { return splitUrl(here().url()).path; },
  get params() { return here().params(); },
  get query() { return here().query(); },
  get hash() { return splitUrl(here().url()).hash; },
  // Navigation state: a server never navigates, so there these stay false
  // and null.
  get isNavigating() { return !onServer() && _navigating(); },
  get error() { return onServer() ? null : _navigationError(); },
};

// A state of its own: a server render's, a nested <Router>'s. `url` reads
// the URL it shows.
function ownState(url) {
  return { url, params: signal({}), query: signal(Object.create(null)) };
}

// The route state of each server render, by its render context: the URL of
// its request, and the params and query its outermost <Router> matched. A
// WeakMap, so it goes with the render.
const _serverRoutes = new WeakMap();

function requestState(ctx) {
  let state = _serverRoutes.get(ctx);
  if (state === undefined) {
    const shown = signal(requestUrl(ctx));
    state = ownState(shown);
    _serverRoutes.set(ctx, state);
  }
  return state;
}

// What a server reader sees with no render to read: the root URL and no
// params or query, never another request's (code after an await without
// AsyncLocalStorage).
const NO_ROUTE = Object.freeze({ url: () => '/', params: () => ({}), query: () => Object.create(null) });

// The URL of the request a server render answers (path, search and hash), or
// the root without one.
function requestUrl(ctx) {
  const request = ctx.request;
  if (request == null || typeof request.url !== 'string') return '/';
  const parsed = parseLocal(request.url);
  return parsed === null ? '/' : parsed.pathname + parsed.search + parsed.hash;
}

// What a relative URL resolves against where there is no page.
const NO_PAGE = 'http://what.invalid';
// A relative reference: no scheme, and not a path from the root or another
// host ('/x', '//x', '\\x').
const RELATIVE = /^(?![a-z][a-z0-9+.-]*:)(?![/\\])/i;

// A URL as the router holds one, parsed: a path (with its search and hash) is
// read as the address bar holds it, so `//other.test/x` is the path
// `//other.test/x`, never another host's `/x`; anything else resolves against
// the root. Null for what the URL parser rejects (`http://[`), so that no
// value a request or a prop carries makes a render throw.
function parseLocal(url) {
  const text = String(url);
  try {
    return text.startsWith('/') ? new URL(NO_PAGE + text) : new URL(text, NO_PAGE + '/');
  } catch {
    return null;
  }
}

// A URL's path, search (with its '?') and hash (with its '#'), as the URL
// parser splits them: the search runs from the first '?' to the first '#', so
// a second '?' belongs to a query value, and the hash is all after the first
// '#'. Dot segments are resolved, as the address bar resolves them. A URL the
// parser rejects is the root.
function splitUrl(url) {
  const parsed = parseLocal(url);
  return parsed === null
    ? { path: '/', search: '', hash: '' }
    : { path: parsed.pathname, search: parsed.search, hash: parsed.hash };
}

// The URL the browser commits for a navigation to `to` (a path, a relative
// URL, a '#hash', a URL of this origin): its path, search and hash, resolved
// against the page as history.pushState resolves it, dot segments and
// percent-encoding included. On a server the page is the URL the render shows
// (its nearest <Router>'s), so a relative link resolves there as it does in
// the browser. Null for another origin's URL (mailto:, an external site),
// which no route shows, and for one the URL parser rejects.
function resolveHref(to) {
  const page = onServer() || typeof location === 'undefined' ? NO_PAGE + here().url() : location.href;
  try {
    const parsed = new URL(to, page);
    return parsed.origin === new URL(page).origin ? parsed.pathname + parsed.search + parsed.hash : null;
  } catch {
    return null;
  }
}

// --- Navigation Hooks ---
// Subscriber lists consulted by navigate(). Guards run before the URL changes
// and can cancel by returning false; afterNavigate runs once the URL committed.
// Module lists, because navigation is the browser tab's. A server never
// navigates, so a hook subscribed on a server (in a render, or after one of
// its awaits with no async context) is not kept: one request's closures must
// not accumulate in the process.

const _beforeHooks = [];
const _afterHooks = [];

function subscribe(list, fn) {
  if (onServer()) return () => {};
  listenToHistory();
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

// --- Preparing a route ---
// What a route needs before it can show at once: its lazy() chunk, and the
// data its `preload({ params, query, url })` returns (queries, async values,
// promises, or an array or object of them). The page component receives that
// as its `data` prop. The queries preload makes are read on the route's path,
// so invalidatePath(path) (a server action's revalidation) refetches them.

/** The routes of the outermost <Router>: what navigate() prepares against. @type {any[] | null} */
let _routes = null;
/** The preparation of the URL on screen, and of the one a navigation is heading to. @type {any} */
let _shown = null;
/** @type {any} */
let _incoming = null;

function pathOf(url) {
  return splitUrl(url).path;
}

function noop() {}

// A lazy() component's chunk, loading: calling the wrapper starts the load and
// throws its promise until it has settled.
function chunkOf(component) {
  if (!component || !component._lazy) return null;
  try {
    component({});
    return null;
  } catch (pending) {
    return pending && typeof pending.then === 'function' ? pending : null;
  }
}

// What a navigation waits for in what preload returned: a promise, an async
// value that has not landed (reading it untracked throws the thenable it
// waits on), or an array or object of them. A failure is the page's to show,
// not a reason to stay on the old one.
function waitsOf(data, out) {
  if (data == null) return out;
  if (typeof data.then === 'function') {
    out.push(Promise.resolve(data).catch(() => {}));
  } else if (typeof data === 'function') {
    try {
      untrack(data);
    } catch (pending) {
      if (pending && typeof pending.then === 'function') out.push(Promise.resolve(pending).catch(() => {}));
    }
  } else if (Array.isArray(data)) {
    for (const item of data) waitsOf(item, out);
  } else if (typeof data === 'object' && Object.getPrototypeOf(data) === Object.prototype) {
    for (const key in data) waitsOf(data[key], out);
  }
  return out;
}

// The preparation of `url` against `routes`: the route it matches, its
// middleware's verdict, and once that admits it, its chunk and its preload
// data. The verdict is decided once, here, and the render shows the route by
// it: true shows it, false declines it, a path redirects, and `{ error }`
// rethrows what the middleware threw (a redirect() signal, ERR_ASYNC_MIDDLEWARE).
// It is decided again only when a signal the middleware read changes, and the
// route is loaded when a verdict first admits it. `current()`, when given, is
// asked before the first load: a navigation the middleware superseded (it
// called navigate()) loads nothing. `state`, when given, is the route state
// of the Router preparing it, which `route` reads in its middleware and
// preload: the preparation is owned by nothing, so it would otherwise see
// the state of no Router.
function prepare(url, routes, current, state = null) {
  const { path, search } = splitUrl(url);
  const matched = routes ? matchRoute(path, routes) : null;
  /** @type {any} */
  const prep = { url, route: matched ? matched.route : null, verdict: () => true, data: undefined, failed: false, error: undefined, dispose: noop, ready: Promise.resolve() };
  if (!matched) return prep;
  const r = matched.route;
  const query = parseQuery(search);
  if (!r.middleware && typeof r.preload !== 'function') {
    load(prep, r, matched.params, path, query);
    return prep;
  }
  // Owned by nothing but this preparation: it lives while the route is shown
  // (or being prepared), whatever called navigate().
  runWithOwner(null, () => createRoot((dispose) => {
    prep.dispose = dispose;
    if (state !== null) _provide(SCOPE, state);
    const owner = getOwner();
    let loaded = false;
    const admit = () => {
      loaded = true;
      runWithOwner(owner, () => load(prep, r, matched.params, path, query));
    };
    if (!r.middleware) {
      admit();
      return;
    }
    prep.verdict = signal(/** @type {any} */ (true));
    const context = { path, params: matched.params, query, route: r };
    let first = true;
    effect(() => {
      const decided = decide(r, context);
      untrack(() => {
        if (decided === true && !loaded && !(first && current !== undefined && !current())) admit();
        prep.verdict.set(decided);
      });
      first = false;
    });
  }));
  return prep;
}

// The route's middleware verdict, with what it threw as `{ error }`.
function decide(r, context) {
  try {
    return middlewareVerdict(r, context);
  } catch (error) {
    return { error };
  }
}

// An admitted route's chunk and preload data, and what a navigation waits for.
function load(prep, r, params, path, query) {
  const waits = [];
  const chunk = chunkOf(r.component);
  if (chunk !== null) waits.push(chunk.then(noop, noop));
  if (typeof r.preload === 'function') {
    // A preload that throws has no data to give the page: the page shows
    // the error instead (see PreloadFailed). One that returns a promise
    // that rejects gives the page that promise, to show when it reads it.
    try {
      prep.data = _tagQueries(path, () => r.preload({ params, query, url: prep.url }));
    } catch (err) {
      prep.failed = true;
      prep.error = err;
    }
    waitsOf(prep.data, waits);
  }
  prep.ready = Promise.all(waits).then(noop);
}

// The preparation the outermost Router shows route `r` at `url` with: the one
// a navigation made, or one made now (the first render, a URL the router did
// not navigate to).
function shownFor(url, r) {
  if (_shown !== null && _shown.url === url && _shown.route === r) return _shown;
  if (_incoming !== null && _incoming.url === url && _incoming.route === r) {
    const prep = _incoming;
    show(prep);
    return prep;
  }
  const prep = prepare(url, _routes);
  show(prep);
  return prep;
}

function show(prep) {
  const old = _shown;
  _shown = prep;
  if (_incoming === prep) _incoming = null;
  // The page leaving still reads its route data until the commit's flush is
  // over.
  if (old !== null && old !== prep) queueMicrotask(() => old.dispose());
}

// How the navigation in flight stops waiting, which the next one calls: a
// guard's or a preload's promise that never settles then keeps nothing of a
// navigation that no longer matters (its route, its preparation).
let _leave = noop;

// What `value` settles to, as a promise the next navigation can settle at
// once (to undefined). The callbacks `value` holds reach only `wait`, which
// leaving empties. Only the navigation in flight, `nav`, sets how it leaves:
// a guard that started another navigation returns after that one began
// waiting, and must not replace the newer one's way out.
function waitFor(value, nav) {
  /** @type {{ resolve: (value?: any) => void, reject: (error?: any) => void }} */
  const wait = { resolve: noop, reject: noop };
  const settled = new Promise((resolve, reject) => {
    wait.resolve = resolve;
    wait.reject = reject;
  });
  Promise.resolve(value).then((v) => wait.resolve(v), (err) => wait.reject(err));
  if (nav !== _navigation) return settled;
  _leave = () => {
    const resolve = wait.resolve;
    wait.resolve = wait.reject = noop;
    resolve(undefined);
  };
  return settled;
}

// --- Navigation ---

let _navigation = 0;

/**
 * Navigate to `to`. Runs the beforeNavigate guards, prepares the destination
 * (its middleware's verdict, then its lazy chunk and preload data), then
 * commits the URL as a transition, in a View Transition when the browser has
 * them and `transition` is not false. `flushSync: true` commits at once,
 * without holding the screen for async values the URL change starts.
 * Resolves once the new page is on screen; a newer navigation supersedes this
 * one while it prepares, and it stops at once. On a server, where nothing
 * navigates, it redirects the response of the render in progress instead.
 */
export async function navigate(to, opts = {}) {
  const { replace = false, state = null, transition = true, flushSync: sync = false, _fromPopstate = false, _redirectChain = false } = opts;

  // The response refuses a target that is not a same-origin path, and
  // redirects to '/' instead. A relative one ('next', '../up', '?page=2')
  // resolves against the URL the render shows, as the browser resolves it
  // against the address bar.
  if (onServer()) {
    if (typeof to !== 'string') getResponse().redirect(to);
    else if (!to.startsWith('#')) getResponse().redirect(RELATIVE.test(to) ? resolveHref(to) ?? to : to);
    return;
  }

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

  // A navigation the user asked for starts a fresh redirect chain; a hop
  // queued by handleRedirect continues the current one.
  if (!_redirectChain) _redirectHistory.length = 0;

  // The URL the address bar will show, which is what the router commits.
  const href = resolveHref(to) ?? to;

  // Handle same-page hash links — use replaceState and scroll directly
  if (typeof window !== 'undefined' && to.startsWith('#')) {
    history.replaceState(state, '', href);
    _url.set(href);
    const el = document.querySelector(to);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    return;
  }

  // Don't navigate if already on the same URL
  if (href === readUrl() && !_preparing.peek()) return;

  // The newest navigation wins: one that is still running its guards or
  // preparing its route when another starts never commits, and stops
  // waiting for them now.
  const nav = ++_navigation;
  _leave();
  _leave = noop;
  if (_incoming !== null) {
    _incoming.dispose();
    _incoming = null;
  }
  // Progress shows at once, also for a navigation started inside a
  // transition (useTransition around navigate()), which would hold it.
  _urgent(() => batch(() => {
    _navigating.set(true);
    _preparing.set(true);
    _pendingUrl.set(href);
  }));

  const from = readUrl();
  /** The new page's first data, landing: set at the commit. @type {Promise<void> | null} */
  let landed = null;
  let committing = false;
  let committed = false;
  try {
    // A popstate has already moved the browser URL, so cancelling one means
    // pushing the previous entry back to keep the address bar in sync. That
    // entry is a new one: the forward entry is not recoverable and its
    // history.state is not carried over. Documented on beforeNavigate in
    // index.d.ts.
    for (const fn of _beforeHooks.slice()) {
      const allowed = await waitFor(fn(href, from), nav);
      if (nav !== _navigation) return;
      if (allowed === false) {
        if (_fromPopstate && typeof history !== 'undefined') history.pushState(null, '', from);
        return;
      }
    }

    _navigationError.set(null);

    // Prepare the destination while the old page stays: its middleware
    // decides, then a route it admits loads. Middleware and preload are app
    // code, which may navigate again.
    const prep = prepare(href, _routes, () => nav === _navigation);
    if (nav !== _navigation) {
      prep.dispose();
      return;
    }
    _incoming = prep;
    await waitFor(prep.ready, nav);
    if (nav !== _navigation) {
      if (_incoming === prep) _incoming = null;
      prep.dispose();
      return;
    }
    _leave = noop;

    const doNavigation = () => {
      // Skip history manipulation on popstate (browser already updated the URL)
      if (!_fromPopstate) {
        // Save scroll position for current URL before navigating away.
        // Full URL as the key, { x, y } as the value: see scrollPositions below,
        // every writer and the reader must agree on both.
        if (typeof window !== 'undefined') {
          scrollPositions.set(readUrl(), { x: window.scrollX, y: window.scrollY });
        }
        if (replace) {
          history.replaceState(state, '', href);
        } else {
          history.pushState(state, '', href);
        }
      }
      committed = true;
      batch(() => {
        // What the address bar shows now: router state agrees with history.
        _url.set(typeof location !== 'undefined' ? location.pathname + location.search + location.hash : href);
        _preparing.set(false);
        _pendingUrl.set(null);
      });
      // The navigation goes on until the data the new page reads first, beyond
      // what preload returned, has landed: the page shows it pending meanwhile.
      const t = _currentTransition();
      if (t !== null) {
        committing = true;
        _onCommit(t, () => queueMicrotask(() => {
          landed = _pathLoaded(pathOf(href)).then(() => {
            if (nav === _navigation) _navigating.set(false);
          });
        }));
      }
    };
    // The commit: a transition, so what the new URL reaches commits in one
    // flush once the async values it starts (a layout's data for the new
    // params) have landed; with flushSync, at once.
    const commit = () => {
      // The browser calls a View Transition's update later: a navigation that
      // started meanwhile supersedes this one, which then never commits.
      if (nav !== _navigation) return undefined;
      if (sync) {
        doNavigation();
        flushSync();
        _navigating.set(false);
        return undefined;
      }
      return startTransition(doNavigation);
    };

    // Use View Transitions API if available and enabled
    if (transition && typeof document !== 'undefined' && document.startViewTransition) {
      try {
        // The update callback returns the commit: the browser captures the new
        // state once the transition has committed.
        const viewTransition = document.startViewTransition(commit);
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
      try {
        await waitFor(commit(), nav);
      } catch {
        // A commit's async work failed; the URL has changed and its page shows
        // the error.
      }
    }

    if (!committed) return;
    if (_afterHooks.length) {
      for (const fn of _afterHooks.slice()) fn(href, from);
    }
    if (landed !== null) await waitFor(landed, nav);
    // Inside a transition an action holds, the commit (and the end) is still to come.
    else if (!committing && nav === _navigation) _navigating.set(false);
  } finally {
    // A navigation that stops before its URL commits (a guard declined it, a
    // guard or the history write threw) leaves the router as it found it. A
    // newer navigation owns the progress flags.
    if (!committed && nav === _navigation) end();
  }
}

// The page of a route whose preload threw: the route's `error` boundary, or
// the nearest one above the router, shows the error.
/** @returns {never} */
function PreloadFailed({ error }) {
  throw error;
}

// A navigation that is not going to commit stops.
function end() {
  batch(() => {
    _navigating.set(false);
    _preparing.set(false);
    _pendingUrl.set(null);
  });
}

// --- redirect() ---
// Throws a navigation signal. Two places catch it:
//
//   - Route middleware, caught by the Router's own matching pass below.
//   - A component body, caught by core's createComponent, which invokes the
//     handler the signal carries under Symbol.for('what.navigation.signal.v1')
//     rather than reporting the throw to an ErrorBoundary. h() is lazy, so a
//     route component is instantiated after the matching pass has returned;
//     that is why the second catch has to live in core.
//
// Anywhere else (an event handler, a promise callback, a timer) nothing catches
// it and the signal surfaces as an uncaught error. It carries a code, a fix and
// an example for exactly that case, because that is the only case a human reads
// it in.

const REDIRECT = Symbol.for('what.router.redirect.v1');
const NAV_SIGNAL = Symbol.for('what.navigation.signal.v1');

export function redirect(to, options = {}) {
  if (!isSafeUrl(to)) {
    const target = typeof to === 'string' ? to : Object.prototype.toString.call(to);
    /** @type {Error & { code?: string, suggestion?: string, codeExample?: string }} */
    const err = new Error(`[what-router] redirect() refused an unsafe target: ${target}`);
    err.code = 'ERR_UNSAFE_REDIRECT';
    // The fix and the example are for the developer reading the console: a
    // production build carries the code alone.
    if (__DEV__) {
      err.suggestion = 'redirect() accepts same-origin paths and http:, https:, mailto: or tel: URLs only. Protocol-relative ("//host"), backslash-smuggled and javascript:/data: targets are open-redirect vectors. Check a user-supplied target against an allowlist first.';
    err.codeExample = `// Bad - a user-controlled target can leave your origin:
redirect(query.next);

// Good - allowlist the target first:
redirect(ALLOWED.has(query.next) ? query.next : '/');`;
    }
    throw err;
  }

  /** @type {Error & { code?: string, suggestion?: string, codeExample?: string, to?: any, options?: any }} */
  const sig = new Error(`[what-router] redirect to ${to}`);
  sig.name = 'RouterRedirect';
  sig.code = 'ERR_REDIRECT_NOT_CAUGHT';
  if (__DEV__) {
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
  }
  sig[REDIRECT] = true;
  sig[NAV_SIGNAL] = () => { handleRedirect(to, options); };
  sig.to = to;
  sig.options = options;
  throw sig;
}

// Back/forward support — route through navigate() so middleware runs.
//
// The listener is added when the router is first used, not at import: the
// package declares `sideEffects: false`, so a bundler may drop the import of a
// module whose only effect is this listener, and importing it must do nothing.
// Everything that uses the router reads the URL through readUrl() or
// subscribes a navigation hook, and both start listening.
let _listening = false;

function listenToHistory() {
  if (_listening || typeof window === 'undefined') return;
  _listening = true;
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

function readUrl() {
  listenToHistory();
  return _url();
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
// A redirect loop, reported with the URLs it went through and the routes whose
// guards sent it on (development: ERR_REDIRECT_CYCLE, a coded diagnostic).
function redirectLoop(hops, kind) {
  _redirectHistory.length = 0;
  const cycle = [hops[0].from, ...hops.map((hop) => hop.to)].join(' → ');
  const guards = [...new Set(hops.map((hop) => hop.from))].join(', ');
  // ERROR_CODES.REDIRECT_CYCLE
  if (__DEV__) reportDiagnostic('ERR_REDIRECT_CYCLE', { data: { kind, cycle, guards } });
  else console.error(`[what-router] Redirect loop (${kind}): ${cycle}`);
}

function handleRedirect(target, options) {
  // A server render answers with a redirect: it has no history to push, and
  // the navigation state below is the browser tab's.
  if (onServer()) {
    getResponse().redirect(target);
    return null;
  }

  // A navigation to this exact target is already in flight, so this is a
  // re-match of the same hop, not a second one.
  //
  // It happens on every re-match that occurs before the URL commits. With the
  // View Transitions API, navigate() defers the `_url` write into the
  // transition callback while `_preparing` flips immediately, and
  // renderMatch reads `_preparing`, so the match re-runs against the
  // still-old URL, the same middleware returns the same target, and the hop was
  // counted twice. One guarded deep link produced 25 false "Redirect cycle
  // detected" errors and a flash of the redirect-loop screen, and the detector
  // then cleared `_preparing` / `_pendingUrl` while the real navigation was
  // still in flight, corrupting router state mid-navigation.
  //
  // Chromium-only, because without View Transitions doNavigation() runs
  // synchronously and the URL and the flag change together.
  if (_pendingUrl.peek() === target) return null;

  // Each hop: where the navigation was going when that route's guard sent it on.
  _redirectHistory.push({ from: _pendingUrl.peek() ?? readUrl(), to: target });

  if (_redirectHistory.length > MAX_REDIRECTS) {
    redirectLoop(_redirectHistory.slice(-5), 'too many redirects');
    end();
    return loopScreen('Too many redirects. Check your middleware configuration.');
  }

  const seen = new Set();
  let hasCycle = false;
  for (const { to } of _redirectHistory) {
    if (seen.has(to)) { hasCycle = true; break; }
    seen.add(to);
  }
  if (hasCycle) {
    redirectLoop(_redirectHistory.slice(), 'a cycle');
    end();
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
  const dest = matchRoute(pathOf(pendingUrl), routes);
  if (!dest || dest.route === currentRoute) return null;
  return dest.route.loading || null;
}

// The verdict of a route's middleware chain: true to show the route, false to
// decline it (the Router fallback), or a path to redirect to. A redirect() it
// throws propagates, and so does ERR_ASYNC_MIDDLEWARE.
function middlewareVerdict(r, context) {
  if (!r.middleware) return true;
  for (const mw of r.middleware) {
    const result = mw(context);
    if (result != null && (typeof result === 'object' || typeof result === 'function')) {
      // Read once: a then getter can throw or change on its next access.
      // Getter failures propagate unchanged and cannot grant access.
      const then = result.then;
      if (typeof then === 'function') {
        // Observe rejection without awaiting or assimilating fulfillment
        // values (a thenable could resolve itself). Call the captured
        // method once with its receiver, including cross-realm promises.
        Promise.resolve().then(() => {
          const ignore = () => {};
          const returned = Reflect.apply(then, result, [ignore, ignore]);
          // An async then method can itself return a rejected promise.
          // The intrinsic brand-check handles native/cross-realm promises
          // without reading returned.then or assimilating its fulfillment.
          try {
            Reflect.apply(Promise.prototype.then, returned, [ignore, ignore]);
          } catch { /* Non-promise return values need no observation. */ }
        }).catch(() => {});
        throw Object.assign(new Error('[what-router] Route middleware must be synchronous; received a promise or thenable.'), __DEV__ ? {
          code: 'ERR_ASYNC_MIDDLEWARE',
          suggestion: 'Return true, void, false or a redirect path synchronously. For async authorization, wrap the route component with asyncGuard(check)(Component); promises returned by middleware are not awaited.',
          codeExample: `// Async authorization belongs on the component, not in middleware:
{ path: '/private', component: asyncGuard(check)(Component) }`,
        } : { code: 'ERR_ASYNC_MIDDLEWARE' });
      }
    }
    if (result === false || typeof result === 'string') return result;
  }
  return true;
}

export function Router({ routes, fallback, globalLayout, url = null }) {
  // This Router's route state, which it provides to what it renders. The
  // outermost one shows the tab's (in the browser) or its request's (on a
  // server: the URL of the request, or `url`); a nested one has its own, at
  // its parent's URL or its own `url` on a server. The client always shows
  // the window's URL.
  const scope = _contextOf(SCOPE);
  const parent = scope === null ? null : /** @type {any} */ (scope.get(SCOPE));
  const server = onServer();
  /** @type {any} */
  let state;
  if (parent !== null) {
    state = ownState(server && typeof url === 'string' ? () => url : parent.url);
  } else if (server) {
    // The request's state, unless this Router shows a URL of its own: then
    // its own, so a sibling Router (or a reader outside both) never reads it.
    const ctx = getServerContext();
    state = ctx === null || typeof url === 'string' ? ownState(() => (typeof url === 'string' ? url : '/')) : requestState(ctx);
  } else {
    state = tab;
    _routes = routes;
    // An unmounted Router's navigation and pages go with it.
    onCleanup(() => {
      if (_routes !== routes) return;
      _routes = null;
      if (_preparing.peek()) {
        _navigation++;
        _leave();
        _leave = noop;
        end();
      }
      for (const prep of [_incoming, _shown]) if (prep !== null) prep.dispose();
      _incoming = _shown = null;
    });
  }
  _provide(SCOPE, state);
  // The preparation this Router shows, when it is not the outermost one in
  // the browser (that one shows the navigation's: shownFor).
  /** @type {any} */
  let local = null;
  const prepFor = state === tab ? shownFor : (/** @type {string} */ at, /** @type {any} */ r) => {
    if (local !== null && local.url === at && local.route === r) return local;
    const old = local;
    local = prepare(at, routes, undefined, state);
    if (old !== null) queueMicrotask(() => old.dispose());
    return local;
  };
  onCleanup(() => { if (local !== null) local.dispose(); });
  // The `loading:` component a navigation in flight shows instead of the page:
  // the destination's, or the departing route's when only it declares one.
  // A computed, so the page re-renders only when there is one to show, not
  // whenever a navigation starts or ends. A server does not navigate.
  const pendingView = server ? null : computed(() => {
    if (!_preparing()) return null;
    const matched = matchRoute(pathOf(state.url()), routes);
    const current = matched ? matched.route : null;
    return destinationLoading(_pendingUrl(), routes, current) || (current && current.loading) || null;
  });
  // The Router component runs ONCE. `content` is a reactive function child that
  // re-evaluates whenever its URL changes; the fine-grained runtime reconciles
  // only the matched page in place. The globalLayout is rendered ONCE around it
  // (below) so the app shell persists across navigations instead of
  // re-instantiating.
  const renderMatch = () => {
    const currentUrl = state.url();
    const { path, search } = splitUrl(currentUrl);
    const loadingView = pendingView === null ? null : pendingView();

    const matched = matchRoute(path, routes);

    if (matched) {
      const { route: r, params } = matched;
      const queryObj = parseQuery(search);
      batch(() => {
        state.params.set(params);
        state.query.set(queryObj);
        if (state === tab) _pattern.set(r.path);
      });

      // The verdict the route's preparation decided (a navigation's, or this
      // render's), which this render follows. Middleware is synchronous:
      // async authorization belongs in a component wrapper,
      // asyncGuard(check)(Component).
      const prep = untrack(() => prepFor(currentUrl, r));
      const verdict = prep.verdict();
      if (verdict !== null && typeof verdict === 'object') throw verdict.error;
      if (verdict === false) {
        // Middleware rejected — show fallback
        if (fallback) return h(fallback, {});
        return h('div', { class: 'what-403' }, h('h1', null, '403'), h('p', null, 'Access denied'));
      }
      if (typeof verdict === 'string') {
        // Middleware returned a redirect path
        return handleRedirect(verdict);
      }

      // Build element with loading state support
      let element;

      // While a navigation is in flight, a `loading:` declared by the
      // DESTINATION wins. The URL has not committed yet, so `r` is still the
      // route being left: without this, declaring `loading:` on the page you
      // are navigating TO could never show it. Falling back to the departing
      // route's `loading:` preserves the existing behaviour for the case where
      // only the page being left declares one. Without either, the page being
      // left stays until the new one can show.
      if (loadingView) {
        element = h(loadingView, {});
      } else if (prep.failed) {
        element = h(PreloadFailed, { error: prep.error });
      } else {
        element = h(r.component, {
          params,
          query: queryObj,
          route: r,
          data: prep.data,
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
    if (state === tab) _pattern.set(null);
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
    /** @type {any} */
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

  // The path the link goes to, as the address bar will show it; none for
  // another origin's URL, which is never active.
  const target = resolveHref(safeHref);
  const hrefPath = target === null ? null : pathOf(target);

  // Use a reactive function for class so active states update on navigation.
  // In the run-once model, reading route.path directly would snapshot it. A
  // class passed as an accessor is read here too, so it stays live.
  const baseClass = cls || className;
  const reactiveClass = () => {
    const currentPath = route.path;
    const isActive = hrefPath === null ? false : hrefPath === '/'
      ? currentPath === '/'
      : currentPath === hrefPath || currentPath.startsWith(hrefPath + '/');
    const isExactActive = currentPath === hrefPath;

    return [
      typeof baseClass === 'function' ? baseClass() : baseClass,
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
  replaceWith(to);
  return null;
}

// Go to `to` in place of the current page: on the server, the response of the
// render redirects; in the browser, a navigation replaces the history entry.
function replaceWith(to) {
  navigate(to, { replace: true });
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
        replaceWith(fallback);
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
          replaceWith(fallback);
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
// A writer that disagrees on either breaks restoration. The reader calls
// `window.scrollTo(saved.x, saved.y)`, so an entry of another shape (a bare
// number) scrolls to non-finite offsets, which browsers normalize to 0: the
// page jumps to the TOP. An entry keyed by route.path (the pattern-stripped
// path, never the query or the hash) misses every URL that carries a query
// string or a hash. If you add a writer, key it by the full URL and store
// { x, y }.
const scrollPositions = new Map();

export function enableScrollRestoration() {
  if (typeof window === 'undefined') return;

  // There is deliberately no beforeunload writer. scrollPositions is an
  // in-memory Map that dies with the document, so anything written while the
  // page is unloading can never be read back. The only case where such a write
  // would survive is the one where the document does NOT go away (the user
  // cancels the "leave site?" prompt). Restoring scroll across a RELOAD is
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
  // Each route keeps its loading and error components; the `error` prop is
  // the error component of a route that declares none.
  const routerRoutes = routes.map(r => ({
    path: r.path,
    component: r.component,
    layout: r.layout || undefined,
    loading: r.loading || undefined,
    error: r.error || globalError || undefined,
    preload: r.preload || undefined,
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
