// What Framework - Render-scoped server context (SSR keystone).
//
// Holds per-render SSR state that must NOT leak across concurrent requests:
// the head sink, the current page's loader data, and the resource cache.
//
// Concurrency model:
//   - Browser and synchronous-only consumers use the module-global fallback.
//   - what-server installs an AsyncLocalStorage-compatible provider in Node so
//     async components retain their request context across `await` without
//     exposing it to concurrent renders.
//
// getServerContext() returns null on the client and outside of any render, so
// `typeof document === 'undefined'` guards keep behaving correctly.

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
  if (!_asyncContextStorage) _asyncContextStorage = storage;
}

/** @returns the active render context, or null on the client / outside a render. */
export function getServerContext() {
  return _asyncContextStorage?.getStore() ?? _current;
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
  const prev = _current;
  _current = ctx;
  return prev;
}

/**
 * Run `fn` with `ctx` as the active context, restoring the previous context
 * afterwards (even if `fn` throws). Returns whatever `fn` returns. Safe for the
 * synchronous render path; do not rely on it across `await` boundaries.
 */
export function runWithServerContext(ctx, fn) {
  if (_asyncContextStorage) {
    return _asyncContextStorage.run(ctx, fn);
  }

  const prev = _current;
  _current = ctx;
  try {
    return fn();
  } finally {
    _current = prev;
  }
}
