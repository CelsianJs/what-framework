// What Framework - Render-scoped server context (SSR keystone).
//
// Holds per-render SSR state that must NOT leak across concurrent requests:
// the head sink, the current page's loader data, and the resource cache.
//
// Concurrency model:
//   - A renderer runs each synchronous slice of a render inside
//     runWithServerContext, which sets a module variable for exactly that
//     slice. JavaScript does not interleave inside a synchronous call, so no
//     other request can observe it, and the hot path is a variable read.
//   - Code that resumes after an `await` (an async component, a loader) runs
//     outside any slice. When an AsyncLocalStorage-compatible provider is
//     installed (what-server does so on hosts that have one), runWithServerContext
//     also enters it, so that code still finds its own request's context.
//
// getServerContext() returns null on the client and outside of any render, so
// `typeof document === 'undefined'` guards keep behaving correctly.
//
// Reactive ownership: a render context may carry `owner`, a reactive root the
// renderer created for that render. runWithServerContext makes it the current
// owner for the slice, so an effect() or computed() a component body creates
// belongs to the render and is disposed when the renderer releases it, instead
// of staying subscribed to module-scope signals and re-running inside a later
// request's render. Code that resumes after an `await` (an async component)
// runs with no owner current; with an async context provider installed, what
// it creates still goes to its own render's root, so nothing a finished
// request created can run later (a root already released disposes it at once).

import { runWithOwner, flushSync, _setOwnerFallback, _detached } from './reactive.js';
import { _installSeeding } from './hydration-data.js';

/** @type {any} */
let _current = null;
/** @type {{ getStore: () => any, run: (store: any, fn: () => any) => any } | null} */
let _asyncContextStorage = null;

/**
 * Install the async context provider used by the server renderer.
 *
 * This intentionally accepts the small AsyncLocalStorage surface instead of
 * importing `node:async_hooks` from what-core: the core bundle remains browser
 * compatible, while what-server owns its Node runtime dependency.
 *
 * @internal
 */
export function __installServerContextStorage(storage) {
  if (_asyncContextStorage) return;
  _asyncContextStorage = storage;
  _installSeeding();
  _setOwnerFallback(renderOwner);
}

// The root of the render whose async context is active, for work created with
// no owner current.
function renderOwner() {
  const ctx = _asyncContextStorage ? _asyncContextStorage.getStore() : null;
  return ctx != null && ctx.owner != null ? ctx.owner : null;
}

// Whether code outside every render runs on a server, where a query cache
// it shared could hand one request's data to another. what-server's
// ensureServerRuntime marks the process. It is a server unless it had a
// document when marked (a test that renders both ways in one process) AND
// has AsyncLocalStorage: only then does everything a request runs keep its
// render context past an `await`, so code outside every context is no
// request's. Without AsyncLocalStorage a render's code after an `await` runs
// outside its context, and a DOM shim (jsdom, happy-dom, a Workers polyfill)
// must not make that code share one cache.
let _serverProcess = false;
let _markedWithDocument = false;

/** @internal what-server: this process renders on the server. */
export function __markServerProcess() {
  _serverProcess = true;
  _markedWithDocument = typeof document !== 'undefined';
}

/** @internal Whether code outside a render runs on a server (see above). */
export function _isServerProcess() {
  return _serverProcess && (!_markedWithDocument || _asyncContextStorage === null);
}

/** @returns the active render context, or null on the client / outside a render. */
export function getServerContext() {
  if (_current != null) return _current;
  return _asyncContextStorage ? _asyncContextStorage.getStore() ?? null : null;
}

/**
 * True while a server render is in progress.
 *
 * Prefer this over a bare `typeof document === 'undefined'` check. That test asks
 * "is there a DOM?" when the question is "am I rendering to a string?", and the
 * two answers diverge under every DOM shim (jsdom, happy-dom, a Workers
 * polyfill) and in any test that renders both ways in one process.
 */
export function isServerRender() {
  return typeof document === 'undefined' || getServerContext() != null;
}

/**
 * Set the active context. Returns the PREVIOUS context so callers can restore it
 * manually (runWithServerContext does this for you).
 */
export function setServerContext(ctx) {
  _installSeeding();
  const prev = _current;
  _current = ctx;
  return prev;
}

/**
 * Run `fn` with `ctx` as the active context, restoring the previous context
 * afterwards (even if `fn` throws). Returns whatever `fn` returns. Work `fn`
 * starts that resumes after an `await` keeps `ctx` only when an async context
 * provider is installed.
 */
export function runWithServerContext(ctx, fn) {
  _installSeeding();
  const prev = _current;
  _current = ctx;
  const run = ctx && ctx.owner ? () => runWithOwner(ctx.owner, fn) : fn;
  try {
    return _asyncContextStorage ? _asyncContextStorage.run(ctx, run) : run();
  } finally {
    _current = prev;
  }
}

/**
 * Run the effect re-runs that are waiting, outside every render context.
 *
 * A write one render makes to a module-scope signal queues the re-runs of the
 * effects other renders still in flight created under it. Left to the reactive
 * flush, they run in a microtask that inherits the writing render's async
 * context, and an effect from one request would read the other request's
 * response and loader data. A renderer calls this after each synchronous slice,
 * so they run with no request visible to them.
 *
 * @internal
 */
export function __flushOutsideServerContext() {
  __outsideServerContext(flushSync);
}

/**
 * Run `fn` outside every render: no render context visible and no owner
 * current, not even the one an active async context would supply. A renderer
 * makes each render's own root this way, so it is independent of any render
 * that started it.
 *
 * @internal
 */
export function __outsideServerContext(fn) {
  const prev = _current;
  const storage = _asyncContextStorage;
  _current = null;
  try {
    return _detached(storage ? () => storage.run(null, fn) : fn);
  } finally {
    _current = prev;
  }
}

// What getResponse() hands out where there is no server render (the client, a
// test): every call is accepted and does nothing, so a component can set its
// status without checking where it runs.
const NO_RESPONSE = /* @__PURE__ */ Object.freeze({
  status: 200,
  location: null,
  committed: false,
  setStatus() {},
  setHeader() {},
  redirect() {},
  redirectExternal() {},
});

/**
 * The response of the server render in progress: `setStatus(code)`,
 * `setHeader(name, value, { append })`, `redirect(path, status)` (same-origin
 * paths only) and `redirectExternal(url, status)`. They take effect until the
 * shell is sent; a redirect after that is sent to the browser as a script. On
 * the client it returns an inert object.
 */
export function getResponse() {
  const ctx = getServerContext();
  return (ctx && ctx.response) || NO_RESPONSE;
}
