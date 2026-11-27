// What Framework - Server Actions
// Call server-side functions from client code. On the client an action is a
// transition (what-core's startTransition): what it changes, the queries and
// route data it revalidates and the optimistic overlays added in it reach the
// screen in one commit.
//
// Usage:
//   // Define on server
//   const saveUser = action(async (data) => {
//     const user = await db.users.create(data);
//     return { success: true, id: user.id };
//   }, { revalidate: ['/users'], invalidates: [['users']] });
//
//   // Call from client (or pass it to <Form action={saveUser}>)
//   const result = await saveUser({ name: 'John' });

import { startTransition } from 'what-core';
import { _actionKeySalt, _actionStateKey, _devAction, _installRowKeys, _renderSalt, __DEV__, __readHydrationData, getServerContext, _thrownMessage } from 'what-core/internal';
import { invalidatePath, invalidateQueries } from 'what-core/data';
import { revalidatePath as serverRevalidatePath, revalidateTag as serverRevalidateTag } from './revalidation-registry.js';
import { RESERVED_FIELDS } from './fields.js';

// Registry of server actions, kept once for every tier of what-server the
// process loaded (dist/*.js, dist/*.min.js and the source each hold a copy of
// this module): an action registered through one is found by the handler of
// another. Keyed by Symbol.for, so one realm has one; made on first use, so
// importing the module writes no global. The key names the shape of what it
// holds (`.v1`), as the vnode and HTML brands do: a copy that holds another
// shape uses another key, so copies of two protocols keep two registries.
// Action ids are the realm's: one realm serves one app's actions, and an id
// registered twice warns in development (ERR_DUPLICATE_ACTION_ID); the later
// registration is the one called.
const REGISTRY = Symbol.for('what.actions.v1');
/** @type {Map<string, any> | null} */
let registry = null;
function actionRegistry() {
  return registry ??= /** @type {any} */ (globalThis)[REGISTRY] ??= new Map();
}

// --- Base ---
// The path the app is served below ('/app'), or '' at the root of its origin,
// as what-router has it: what its setBase() set (shared under this key), else
// Vite's `base` (import.meta.env.BASE_URL) when Vite builds this module. One
// that is not a path from the root ('./') is no base. The action endpoint is
// below it, and a path from the root that an action redirects to, or a <Form>
// names, is a URL of the app, below it too.
const SHARED_BASE = Symbol.for('what.base.v1');

/** @internal */
export function _base() {
  const set = /** @type {any} */ (globalThis)[SHARED_BASE];
  const base = typeof set === 'string' ? set : import.meta.env && import.meta.env.BASE_URL;
  return /^\/(?!\/)/.test(base) ? base.replace(/\/+$/, '') : '';
}

/** @internal A URL of the app as the browser sees it: a path from the root goes below the base. */
export function _belowBase(url, base = _base()) {
  return typeof url === 'string' && /^\/(?![/\\])/.test(url) ? base + url : url;
}

// --- CSRF Protection ---
// The action endpoint checks that a request comes from this site: the
// browser's Fetch Metadata (Sec-Fetch-Site) or Origin header, or, when a
// browser sends neither, the double-submit token (the what-csrf cookie, echoed
// in X-CSRF-Token or a form field). See action-handler.js.

// Client: read the CSRF token from the page meta tag or cookie
// Re-reads on every call to handle token rotation
function getCsrfToken() {
  if (typeof document !== 'undefined') {
    // Try meta tag first
    const meta = document.querySelector('meta[name="what-csrf-token"]');
    if (meta) {
      return meta.getAttribute('content');
    }
    // Try cookie
    const match = document.cookie.match(/(?:^|;\s*)what-csrf=([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

// Server: generate a CSRF token (call this per session/request)
export function generateCsrfToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID — use crypto.getRandomValues
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }
  // Last resort — should not be reached in modern environments
  // ERROR_CODES.NO_SECURE_RANDOM
  const text = 'No secure random source available for CSRF token generation.';
  throw Object.assign(
    new Error(__DEV__ ? _thrownMessage('ERR_NO_SECURE_RANDOM', text) : `[what] ${text}`),
    { code: 'ERR_NO_SECURE_RANDOM' },
  );
}

// Server: validate CSRF token from request header against session token
export function validateCsrfToken(requestToken, sessionToken) {
  if (!requestToken || !sessionToken) return false;
  // Constant-time comparison to prevent timing attacks
  if (requestToken.length !== sessionToken.length) return false;
  let result = 0;
  for (let i = 0; i < requestToken.length; i++) {
    result |= requestToken.charCodeAt(i) ^ sessionToken.charCodeAt(i);
  }
  return result === 0;
}

// Server: middleware helper to inject CSRF meta tag into HTML
export function csrfMetaTag(token) {
  // HTML-escape the token to prevent XSS if a non-standard value is used
  const escaped = String(token).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<meta name="what-csrf-token" content="${escaped}">`;
}

// --- Define a server action ---

let _actionCounter = 0;
let _fallbackWarningShown = false;

function generateActionId() {
  if (
    !_fallbackWarningShown
    && typeof process !== 'undefined'
    && process.env?.NODE_ENV !== 'production'
  ) {
    _fallbackWarningShown = true;
    console.warn(
      '[what-server] action() is using a runtime-generated ID because compiler metadata is missing. ' +
      'Build with what-compiler/vite-plugin-what or pass an explicit { id } so client and server bundles agree.'
    );
  }
  // Compatibility fallback for direct, uncompiled script users. Normal builds
  // receive a deterministic compiler ID derived from source path + binding.
  // Never use Math.random here; crypto avoids predictable collisions, and the
  // monotonic fallback keeps older runtimes functional.
  const rand = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('')
    : `c${(++_actionCounter).toString(36)}_${Date.now().toString(36)}`;
  return `a_${rand}`;
}

export function action(fn, options = {}) {
  const id = options.id || generateActionId();
  // Its useActionState keys follow keyed rows while hydrating too.
  _installRowKeys();

  // Server-side: register the action
  if (typeof window === 'undefined') {
    if (__DEV__ && actionRegistry().has(id)) console.warn(`Duplicate server action ID "${id}".`, '(ERR_DUPLICATE_ACTION_ID)');
    actionRegistry().set(id, { fn, options });
  }

  function callAction(...args) {
    // Server-side: call directly
    if (typeof window === 'undefined') return fn(...args);
    if (__DEV__) return /** @type {any} */ (_callAction)(id, args, options, fn.name || id);
    return _callAction(id, args, options);
  }

  callAction._actionId = id;
  callAction._isAction = true;
  callAction._formState = () => formState(id);

  return callAction;
}

// A useActionState(action) being made: its key (_actionStateKey: the same on
// the server and while hydrating, posted by its form as `_actionKey`) and,
// when this render answers that form posted without JavaScript, the state
// the action returned for it. The request handler hands the render that
// result as `actionState` ({ action, key, state }, action-handler.js
// createFormPostHandler); the render hands it to its hydration in the data
// channel, under the key, and the hydration starts from it too. Every other
// useActionState of the same action, on this page, keeps its initial state.
// A key with keyed rows in it is written under the render's salt, which the
// render puts in the data channel too, for its hydration's keys; the posted
// one is compared under the salt it was made under. As { key } or
// { key, state }.
const POSTED = 'what:action-state:';
const SALT = 'what:action-salt';
function formState(id) {
  const identity = _actionStateKey();
  if (identity === null) return { key: null };
  const ctx = getServerContext();
  if (ctx !== null) {
    const salt = _renderSalt();
    const key = identity(salt);
    if (identity.salted && ctx.resources && !ctx.resources.has(SALT)) ctx.resources.set(SALT, { status: 'ready', value: salt });
    const posted = ctx.actionState;
    if (posted == null || posted.action !== id || posted.key !== identity(_actionKeySalt(posted.key))) return { key };
    ctx.resources?.set(POSTED + key, { status: 'ready', value: posted.state });
    return { key, state: posted.state };
  }
  const resources = __readHydrationData()?.resources;
  const key = identity(resources && Object.hasOwn(resources, SALT) ? resources[SALT] : null);
  return resources && Object.hasOwn(resources, POSTED + key) ? { key, state: resources[POSTED + key] } : { key };
}

/**
 * @internal Call the server action `id` from the client, as a transition: the
 * RPC, then the revalidation the action declares (`revalidate` paths through
 * invalidatePath, `invalidates` query keys through invalidateQueries), whose
 * refetches join the transition. Called inside another transition (the
 * caller's startTransition, a <Form> submission, useActionState), it joins
 * that one. Resolves with the action's result once the refetches have
 * landed; rejects with its error.
 */
export function _callAction(id, args, options = {}) {
  const name = __DEV__ ? arguments[3] || id : '';
  return new Promise((resolve, reject) => {
    startTransition(async () => {
      /** @type {{ name: string, invalidated: Set<string>, revalidated: string[] } | null} */
      const observation = __DEV__ ? { name, invalidated: new Set(), revalidated: [] } : null;
      try {
        const [result, to] = await post(id, args, options);
        if (options.onSuccess) options.onSuccess(result);
        const waits = [];
        for (const path of options.revalidate || []) {
          waits.push(invalidatePath(path));
          if (__DEV__) observation?.revalidated.push(path);
        }
        for (const key of options.invalidates || []) {
          const wait = __DEV__ && observation
            ? /** @type {any} */ (invalidateQueries)(key, undefined, observation.invalidated)
            : invalidateQueries(key);
          waits.push(wait);
        }
        await Promise.all(waits);
        if (__DEV__ && observation) _devAction({ ...observation, invalidated: [...observation.invalidated], outcome: 'ok' });
        resolve(result);
        if (to !== null) follow(to);
      } catch (error) {
        if (__DEV__ && observation) _devAction({ ...observation, invalidated: [...observation.invalidated], outcome: 'error' });
        if (options.onError) options.onError(error);
        reject(error);
      }
    });
  });
}

// Where an action's redirect (getResponse().redirect() in the action) takes
// the browser, once what it revalidates has landed: a path through the
// mounted <Router> (what-router registers its navigate()), anything else, or
// a page with no Router, by loading it. A path is a URL of the app, below the
// base.
const NAVIGATOR = Symbol.for('what.router.navigate.v1');
function follow(to) {
  const navigate = /** @type {any} */ (globalThis)[NAVIGATOR];
  if (typeof navigate === 'function' && to.startsWith('/')) navigate(to);
  else location.assign(_belowBase(to));
}

// The action's result, and the redirect it made (or null).
async function post(id, args, options) {
  const timeout = options.timeout || 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const csrfToken = getCsrfToken();
    const form = formBody(args);
    /** @type {Record<string, string>} */
    const headers = { 'X-What-Action': id };
    // A FormData body sets its own multipart type, with its boundary.
    if (form === null) headers['Content-Type'] = 'application/json';
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const response = await fetch(_base() + '/__what_action', {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      signal: controller.signal,
      body: form ?? JSON.stringify({ args }),
    });

    if (!response.ok) {
      // Whatever the refusal holds (the framework's JSON, a proxy's page,
      // null), the call rejects with a coded error.
      const parsed = await response.json().catch(() => null);
      const body = parsed !== null && typeof parsed === 'object' ? parsed : {};
      // ERROR_CODES.PAYLOAD_TOO_LARGE for a body over the server's bodyLimit
      // (`limit`, its bytes), else ERROR_CODES.ACTION_FAILED; `status` is the
      // response's.
      if (response.status === 413) {
        const limit = typeof body.limit === 'number' ? body.limit : undefined;
        throw Object.assign(new Error(`Payload too large: the server accepts ${limit === undefined ? 'less' : `at most ${limit} bytes`} in one request`), {
          code: 'ERR_PAYLOAD_TOO_LARGE', status: 413, limit,
        });
      }
      throw Object.assign(new Error(typeof body.message === 'string' && body.message !== '' ? body.message : 'Action failed'), { code: 'ERR_ACTION_FAILED', status: response.status });
    }
    return [await response.json(), response.headers.get('x-what-redirect')];
  } catch (error) {
    if (error.name === 'AbortError') {
      /** @type {Error & { code?: string }} */
      const timeoutError = new Error(`Action "${id}" timed out after ${timeout}ms`);
      timeoutError.code = 'TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// A call of a form's fields that hold a file, `(fields)` or `(state, fields)`
// (a <Form> with a file input, its useActionState's state first): sent as
// that form, multipart, the state as `_state`, which the endpoint reads into
// the same arguments, a file as the File it is (action-handler.js
// formArguments). JSON has no form for a file's bytes. Every other call is
// sent as JSON, null here.
function formBody(args) {
  const fields = args[args.length - 1];
  if (args.length > 2 || !holdsFile(fields)) return null;
  const body = new FormData();
  if (args.length === 2) body.append('_state', JSON.stringify(args[0]) ?? 'null');
  for (const [name, value] of Object.entries(fields)) {
    for (const v of Array.isArray(value) ? value : [value]) body.append(name, v);
  }
  return body;
}

// Whether `fields` is a form's fields (a plain object of strings and files,
// an array of them for a repeated name, no name the endpoint reads itself)
// with a file among them.
function holdsFile(fields) {
  if (fields === null || typeof fields !== 'object' || Object.getPrototypeOf(fields) !== Object.prototype) return false;
  let file = false;
  for (const [name, value] of Object.entries(fields)) {
    if (RESERVED_FIELDS.has(name)) return false;
    for (const v of Array.isArray(value) ? value : [value]) {
      if (v instanceof Blob) file = true;
      else if (typeof v !== 'string') return false;
    }
  }
  return file;
}

// --- Optimistic updates ---
// One implementation: what-core's, React 19's shape. An overlay added inside
// startTransition (a server action called from it, say) lasts until that
// transition commits, and drops with the real result in the same flush.

export { useOptimistic } from 'what-core';

// --- Path revalidation ---
// One implementation: what-core/data's. invalidatePath(path) refetches the
// queries and route data read on that path and runs the onRevalidate
// callbacks for it.

export { onRevalidate, invalidatePath } from 'what-core/data';

// --- Server-side action handler ---
// Add this to your server middleware.

export function handleActionRequest(req, actionId, args, options = {}) {
  const { csrfToken: sessionCsrfToken, skipCsrf = false } = options;

  // Validate CSRF token unless explicitly skipped
  if (!skipCsrf) {
    if (!sessionCsrfToken) {
      // Fail closed: no CSRF token configured means the developer forgot to set it up.
      // This prevents silent security vulnerabilities in production.
      return Promise.resolve({
        status: 500,
        body: {
          message: '[what] CSRF token not configured. ' +
            'Pass { csrfToken: sessionToken } to handleActionRequest, ' +
            'or { skipCsrf: true } to explicitly opt out.'
        }
      });
    }
    const requestCsrfToken = req?.headers?.['x-csrf-token'] || req?.headers?.['X-CSRF-Token'];
    if (!validateCsrfToken(requestCsrfToken, sessionCsrfToken)) {
      return Promise.resolve({ status: 403, body: { message: 'Invalid CSRF token' } });
    }
  }

  const action = actionRegistry().get(actionId);
  if (!action) {
    return Promise.resolve({ status: 404, body: { message: 'Action not found' } });
  }

  // Validate args is an array to prevent prototype pollution
  if (!Array.isArray(args)) {
    return Promise.resolve({ status: 400, body: { message: 'Invalid action arguments' } });
  }

  // Called now, inside the caller's context, so the action's synchronous part
  // sees getRequest() even with no AsyncLocalStorage to carry the context past
  // its first `await`. A plain function's throw or return value goes the way a
  // promise's would: a throw is the 500 below, never an exception here.
  let run;
  try {
    run = Promise.resolve(action.fn(...args));
  } catch (error) {
    run = Promise.reject(error);
  }
  return run
    .then(async result => {
      // Server-side cache revalidation: if the action declared revalidate paths
      // or tags, purge them through the bound cache engine (no-op if unbound).
      const opts = action.options || {};
      if (Array.isArray(opts.revalidate)) {
        for (const p of opts.revalidate) await serverRevalidatePath(p);
      }
      if (Array.isArray(opts.revalidateTags)) {
        for (const t of opts.revalidateTags) await serverRevalidateTag(t);
      }
      return { status: 200, body: withoutFiles(result) };
    })
    .catch(error => {
      // Log the full error server-side, return generic message to client
      console.error(`[what] Action "${actionId}" error:`, error);
      return {
        status: 500,
        body: { message: 'Action failed' },
      };
    });
}

// What an action returned, as its caller gets it: a file in it (a Blob, a
// File: the fields echoed back) is null. With JavaScript the result travels
// as JSON, which has no form for its bytes, and without, it is the page's
// state, which the page carries as JSON too, and the state the next post
// sends back (`_state`): either way the same value, without the file. Plain
// objects and arrays are copied only where a file is in them.
function withoutFiles(value) {
  if (typeof Blob !== 'undefined' && value instanceof Blob) return null;
  if (value === null || typeof value !== 'object') return value;
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
  /** @type {any} */
  let out = null;
  for (const key of Object.keys(value)) {
    const was = value[key];
    const now = withoutFiles(was);
    if (now === was) continue;
    out ??= array ? value.slice() : { ...value };
    out[key] = now;
  }
  return out ?? value;
}

// --- Get all registered actions (for SSR/build) ---

export function getRegisteredActions() {
  return [...actionRegistry().keys()];
}
