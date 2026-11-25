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
// Another copy of what-core in the process (a component bundled with its own
// framework, another export tier) cannot hold work in the render's root, which
// is the renderer's copy's: what it creates goes to a root of its own for that
// render, which the render's release disposes too (renderOwner below).

import { runWithOwner, flushSync, _detached, _engine, _setOwnerFallback, _isDisposed, _serverStoreKey as STORE, __DEV__ } from './reactive.js';
import { _installServerSeeding } from './hydration-data.js';

// The process's render context, its async context provider and whether it is
// a server, kept once for every tier of what-core the process loaded: the
// development and production builds (dist/*.js, dist/*.min.js) and the source
// each hold a copy of this module, and a component bundled from one tier that
// a server of another renders still reads that render's context (its
// response, its loader data). Keyed by Symbol.for, so one realm has one; the
// key names the store's shape (`.v1`), so a copy that keeps another shape
// keeps another store (STORE, reactive.js _serverStoreKey).
/** @typedef {{ getStore: () => any, run: (store: any, fn: () => any) => any }} AsyncStorage */
/** @type {{ current: any, storage: AsyncStorage | null, frames: AsyncStorage | null, server: boolean, withDocument: boolean, adopt?: typeof adopt, refuse?: typeof refuse } | null} */
let shared = null;
// Made on first use, so importing the module writes no global. On first use
// this copy's engine also starts asking the active render for the root that
// holds what it creates with no owner current (renderOwner).
function store() {
  if (shared === null) _setOwnerFallback(renderOwner);
  return shared ??= /** @type {any} */ (globalThis)[STORE] ??= { current: null, storage: null, frames: null, server: false, withDocument: false };
}

// What only a server render needs, installed by what can start one
// (__installServerContextStorage, setServerContext, runWithServerContext), so
// a browser bundle carries none of it: the server store seeding
// (hydration-data.js), and on the store what another copy of the engine
// takes from a render it never joined (adopt, refuse). Returns the store.
function serving() {
  _installServerSeeding();
  const state = store();
  state.adopt = adopt;
  state.refuse = refuse;
  return state;
}

// What a copy of the engine that never joined the render throws when it
// makes an async value in one (hydration-data.js _seedFor): that copy never
// reaches the render's resources, so the value would start over on every
// retry of the render and never reach the client. Said, not guessed.
function refuse() {
  if (getServerContext() != null) {
    // ERROR_CODES.FOREIGN_ENGINE_IN_SSR
    throw Object.assign(new Error('[what] An async value was made by a second copy of what-core during a server render. Bundle one copy of what-framework.'), { code: 'ERR_FOREIGN_ENGINE_IN_SSR' });
  }
}

// What a copy of the engine that never reached this module takes as its owner
// lookup (reactive.js ownerNow), from the store of a render that started: the
// active render's root for that copy.
function adopt(setFallback, engine) {
  setFallback(() => {
    const ctx = getServerContext();
    return ctx != null && typeof ctx.rootFor === 'function' ? ctx.rootFor(engine) : null;
  });
}

// The owner of work this copy of the engine creates with no owner current, in
// a server render: the frame of the component whose code it is (code an async
// component runs after an `await`, which _runComponentAsync made findable), so
// what it reads by context (a Router's state, useContext) and what it creates
// are its component's; else the render's root, the render's own or one of
// this copy's for it.
function renderOwner() {
  const frames = /** @type {any} */ (shared).frames;
  const resumed = frames !== null ? frames.getStore() : undefined;
  if (resumed != null && resumed.engine === _engine && !_isDisposed(resumed.frame)) return resumed.frame;
  const ctx = getServerContext();
  return ctx != null && typeof ctx.rootFor === 'function' ? ctx.rootFor(_engine) : null;
}
// Whether this copy of the module has wired the provider into its tier.
let installed = false;

/**
 * Install the async context providers used by the server renderer: `storage`
 * carries a render's context past an `await`, `frames` an async component's
 * frame (_runComponentAsync).
 *
 * This intentionally accepts the small AsyncLocalStorage surface instead of
 * importing `node:async_hooks` from what-core: the core bundle remains browser
 * compatible, while what-server owns its Node runtime dependency.
 *
 * @internal
 */
export function __installServerContextStorage(storage, frames) {
  if (installed) return;
  installed = true;
  const state = serving();
  if (state.storage === null) {
    state.storage = storage;
    state.frames = frames ?? null;
  }
}

// Development: a server component's frame knows while its function runs
// (`_inBody`). The server renders the component's bindings once, in that
// frame, after the function has returned: a pending() read there is the read
// the client's binding makes, tracked (reactive.js devUntrackedPending).
function inBody(frame, fn) {
  frame._inBody = true;
  try {
    return fn();
  } finally {
    frame._inBody = false;
  }
}

/**
 * Call a server component's function `fn` in its `frame` so that the code it
 * runs after an `await` still has the frame as its owner (renderOwner).
 *
 * @internal
 */
export function _runComponentAsync(frame, fn) {
  const frames = store().frames;
  const run = __DEV__ ? () => inBody(frame, fn) : fn;
  return frames === null ? run() : frames.run({ engine: _engine, frame }, run);
}

/**
 * Call a server component's function `fn`, in its `frame`, synchronously
 * (renderToString).
 *
 * @internal
 */
export function _runComponentSync(frame, fn) {
  return __DEV__ ? inBody(frame, fn) : fn();
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
/** @internal what-server: this process renders on the server. */
export function __markServerProcess() {
  const state = store();
  state.server = true;
  state.withDocument = typeof document !== 'undefined';
}

/** @internal Whether code outside a render runs on a server (see above). */
export function _isServerProcess() {
  const state = shared ?? /** @type {any} */ (globalThis)[STORE];
  return state != null && state.server && (!state.withDocument || state.storage === null);
}

/** @returns the active render context, or null on the client / outside a render. */
// Read without making the store (see isServerRender below): a browser that no
// render touched has none, and no context.
export function getServerContext() {
  const state = shared ?? /** @type {any} */ (globalThis)[STORE];
  if (state == null) return null;
  if (state.current != null) return state.current;
  return state.storage ? state.storage.getStore() ?? null : null;
}

/**
 * True while a server render is in progress.
 *
 * Prefer this over a bare `typeof document === 'undefined'` check. That test asks
 * "is there a DOM?" when the question is "am I rendering to a string?", and the
 * two answers diverge under every DOM shim (jsdom, happy-dom, a Workers
 * polyfill) and in any test that renders both ways in one process.
 */
// With a document, it reads the store as getServerContext() does, which does
// not make it: a page that no server render ever touched has none, and is
// not rendering. So a browser bundle whose hooks ask (useEffect, onMount),
// or whose router reads the render (getServerContext, _isServerProcess),
// does not carry the store and the owner lookup it installs (store(),
// renderOwner); a copy of the engine that a render reaches later still finds
// its root through the store's `adopt` (reactive.js ownerNow), and the copy
// that renders installs its own when it starts (serving()).
export function isServerRender() {
  return typeof document === 'undefined' || getServerContext() != null;
}

/**
 * Set the active context. Returns the PREVIOUS context so callers can restore it
 * manually (runWithServerContext does this for you).
 */
export function setServerContext(ctx) {
  const state = serving();
  const prev = state.current;
  state.current = ctx;
  return prev;
}

/**
 * Run `fn` with `ctx` as the active context, restoring the previous context
 * afterwards (even if `fn` throws). Returns whatever `fn` returns. Work `fn`
 * starts that resumes after an `await` keeps `ctx` only when an async context
 * provider is installed.
 */
export function runWithServerContext(ctx, fn) {
  const state = serving();
  const prev = state.current;
  state.current = ctx;
  const run = ctx && ctx.owner ? () => runWithOwner(ctx.owner, fn) : fn;
  try {
    return state.storage ? state.storage.run(ctx, run) : run();
  } finally {
    state.current = prev;
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
  const state = store();
  const prev = state.current;
  const storage = state.storage;
  const frames = state.frames;
  state.current = null;
  const outside = frames ? () => frames.run(null, fn) : fn;
  try {
    return _detached(storage ? () => storage.run(null, outside) : outside);
  } finally {
    state.current = prev;
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
