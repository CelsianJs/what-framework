// What Framework - Server: the render-scoped context every server renderer
// installs (see what-core's server-context.js). One per request; never shared.

import { createRoot, getOwner } from 'what-core';
import { beginHeadCollection, ERROR_CODES, __installServerContextStorage, __outsideServerContext } from 'what-core/internal';
import { _exposesErrorDetails } from './html.js';
import { createResponse } from './response.js';

// `resources` holds resources created with a `key`, `owned` keyless ones under
// their owner key (what-core hydration-data.js). Entries are
// { status: 'pending', promise } | { status: 'ready', value } | { status: 'error', error },
// and keyless ones also carry `owner`, the name of the component that made
// them. `request` is what createResource hands its fetcher on the server;
// `response` is what getResponse() returns (response.js).
//
// Every render owns two things that must not outlive it:
//
// `signal` comes from the render's own AbortController. It follows the caller's
// signal (or the request's), and the render aborts it itself when its consumer
// stops reading, so the loader and every fetcher stop with the render. The
// listener on the caller's signal is removed when the render is released: a
// signal that outlives the request (a shutdown signal, a keep-alive
// connection's) must not collect one listener per render.
//
// `owner` is a reactive root, independent of any render that started this one.
// what-core's runWithServerContext makes it the owner of every synchronous
// slice of the render, and of code resuming after an `await` in it (when an
// async context provider is installed), so every component frame, effect() and
// computed() the render creates belongs to it, and releasing the render
// disposes them: a finished render leaves nothing subscribed to module-scope
// signals, and nothing it created can run later.
/**
 * @param {unknown} loaderData
 * @param {{ signal?: AbortSignal | null, request?: any, response?: any }} [options]
 */
export function createRenderContext(loaderData, { signal, request, response } = {}) {
  const controller = new AbortController();
  const external = signal || (request && request.signal) || null;
  /** @type {(() => void) | null} */
  let unlink = null;
  if (external) {
    if (external.aborted) {
      controller.abort(external.reason);
    } else {
      const follow = () => controller.abort(external.reason);
      external.addEventListener('abort', follow, { once: true });
      unlink = () => external.removeEventListener('abort', follow);
    }
  }
  /** @type {any} */
  let owner = null;
  /** @type {() => void} */
  let disposeOwner = () => {};
  __outsideServerContext(() => createRoot((dispose) => {
    owner = getOwner();
    disposeOwner = dispose;
  }));
  let released = false;
  return {
    head: beginHeadCollection(),
    loaderData,
    resources: new Map(),
    owned: new Map(),
    islandStores: new Map(),
    signal: controller.signal,
    request,
    response: response || createResponse(),
    owner,
    /** @param {unknown} [reason] */
    abort(reason) {
      controller.abort(reason ?? abortError('The render was aborted.'));
    },
    release() {
      if (released) return;
      released = true;
      if (unlink) unlink();
      disposeOwner();
    },
  };
}

function abortError(message) {
  return Object.assign(new Error(message), { name: 'AbortError' });
}

/** Throw the abort reason when the client has gone away. */
export function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw signal.reason ?? abortError('The request was aborted.');
  }
}

const GENERIC_ERROR = 'An error occurred while rendering on the server.';

// Built on first use, so a bundle that never renders (a client build of the
// server actions) does not carry the catalogue.
/** @type {Set<string> | null} */
let frameworkCodes = null;

/** True for an error code from what-core's catalogue, the only codes that may reach a page. */
export function isFrameworkErrorCode(code) {
  if (typeof code !== 'string') return false;
  frameworkCodes ??= new Set(Object.values(ERROR_CODES).map((entry) => entry.code));
  return frameworkCodes.has(code);
}

/**
 * What an error looks like on the wire. Unless development mode is positively
 * established (see _exposesErrorDetails), the message is generic, so server
 * internals (queries, hostnames, credentials in a driver message) never reach
 * the page. `code` travels only when it is one of the framework's ERR_* codes:
 * a library's code (a Postgres SQLSTATE, a socket errno) describes the
 * server's internals as surely as its message does.
 */
export function errorRecord(error) {
  const record = { message: _exposesErrorDetails() ? String((error && error.message) || error) : GENERIC_ERROR };
  if (error && isFrameworkErrorCode(error.code)) record.code = error.code;
  return record;
}

/**
 * The settled resources of a render as hydration-channel maps (see what-core
 * hydration-data.js). With `sent`, only entries not in it are included and
 * they are added to it, so a stream sends each value once. `owners` names the
 * component behind each owner path that has a keyless value, which the client
 * checks before it adopts one.
 */
export function resourcePayload(ctx, sent) {
  const out = {};
  collect(ctx.resources, 'resources', 'errors', out, sent, false);
  collect(ctx.owned, 'owned', 'ownedErrors', out, sent, true);
  return out;
}

function collect(map, valuesName, errorsName, out, sent, owned) {
  for (const [key, entry] of map) {
    if (entry.status === 'pending' || (sent && sent.has(entry))) continue;
    if (sent) sent.add(entry);
    if (entry.status === 'ready') (out[valuesName] ||= {})[key] = entry.value;
    else (out[errorsName] ||= {})[key] = errorRecord(entry.error);
    if (owned) (out.owners ||= {})[key.slice(0, key.lastIndexOf(':'))] = entry.owner;
  }
}

let _runtimeReady = false;

/**
 * Install the async context provider that lets code resuming after an `await`
 * (async components, resources) find its own request's render context.
 *
 * Every render entry point calls this, so the install is reachable from the
 * code a bundler keeps: an import whose only job is a side effect can be
 * dropped (a `"sideEffects": false` package re-exporting this one did exactly
 * that under esbuild), a called function cannot. The provider is found at run
 * time, not imported, so this module still loads in browsers and edge
 * runtimes: Vercel's edge runtime exposes AsyncLocalStorage as a global, Node
 * (20.16+, 22.3+), Bun, Deno and Workers with nodejs_compat through
 * process.getBuiltinModule. Older Node 20 releases are covered by what-server's
 * Node entry, which installs it at import. Without a provider, the render
 * context is still correct for every synchronous slice; only code after an
 * `await` loses it.
 */
export function ensureServerRuntime() {
  if (_runtimeReady) return;
  _runtimeReady = true;
  const g = /** @type {any} */ (globalThis);
  const AsyncLocalStorage = g.AsyncLocalStorage
    ?? (typeof g.process?.getBuiltinModule === 'function'
      ? g.process.getBuiltinModule('node:async_hooks')?.AsyncLocalStorage
      : undefined);
  if (AsyncLocalStorage) __installServerContextStorage(new AsyncLocalStorage());
}
