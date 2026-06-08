// What Framework - Render-scoped server context (SSR keystone).
//
// Holds per-render SSR state that must NOT leak across concurrent requests:
// the head sink, the current page's loader data, and the resource cache.
//
// Concurrency model:
//   - renderToString() is SYNCHRONOUS. A module-global set at the start of the
//     render and cleared in a `finally` lives within one uninterrupted tick, so
//     no other request's render can observe it (same reasoning React's
//     server dispatcher uses). Use runWithServerContext() for that path.
//   - ASYNC paths (renderToStream, async loaders, async createResource) must
//     thread the ctx object explicitly through the call stack and NEVER read
//     this module global across an `await` — two requests can interleave there.
//
// getServerContext() returns null on the client and outside of any render, so
// `typeof document === 'undefined'` guards keep behaving correctly.

let _current = null;

/** @returns the active render context, or null on the client / outside a render. */
export function getServerContext() {
  return _current;
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
  const prev = _current;
  _current = ctx;
  try {
    return fn();
  } finally {
    _current = prev;
  }
}
