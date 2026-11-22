// What Framework - Served Server Actions
//
// actions.js defines actions and `handleActionRequest`, but nothing wires the
// `/__what_action` HTTP route the client posts to. This module provides that
// missing piece: a framework-agnostic core handler plus thin Node-middleware
// and Web-Fetch adapters. CSRF + dispatch + error masking are reused from
// actions.js (handleActionRequest) — no security logic is duplicated here.

import { handleActionRequest } from './actions.js';
import { addField } from './fields.js';
import { runInActionContext } from './context.js';

const DEFAULT_BASE_PATH = '/__what_action';
export const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

function lowerHeaders(headers) {
  if (!headers) return {};
  // Headers (fetch) -> object
  if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
    const out = {};
    headers.forEach((v, k) => { out[k.toLowerCase()] = v; });
    return out;
  }
  const out = {};
  for (const k in headers) out[k.toLowerCase()] = headers[k];
  return out;
}

function jsonResponse(status, bodyObj) {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(bodyObj),
  };
}

function htmlResponse(status, message) {
  return {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html><html><body><h1>${status}</h1><p>${String(message)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p></body></html>`,
  };
}

// Resolve a safe local redirect target for the form (POST/redirect/GET) path.
// `_redirect` must be a same-origin local path ("/x"); protocol-relative
// ("//evil"), backslash-smuggled ("/\evil", "/\\evil") and absolute
// ("https://evil") targets are rejected. The Referer header (an absolute URL)
// is reduced to its path + query. Falls back to '/'.
//
// Backslashes matter: browsers and `new URL()` treat "\" like "/", so
// "/\evil.com" canonicalizes to http://evil.com (an open redirect). We reject
// anything starting with two slash-or-backslash chars or containing a
// backslash, then canonicalize via URL and require the localhost origin. The
// canonical path is checked again: removing dot segments and tabs makes
// "/.//evil", "/x/..//evil" and "/%2e//evil" into "//evil", a protocol-relative
// target once it is a Location header.
//
// Sibling predicate: isSafeUrl in packages/router/src/index.js. That one gates
// a client navigation target and legitimately allows absolute http(s), mailto:
// and tel:. This one gates a server-issued `Location:` header, an
// attacker-controllable open-redirect primitive, so it must stay strictly
// narrower: same-origin local paths only. Harden one, re-read the other; do not
// unify them. packages/server/test/redirect-predicate-parity.test.js gates the
// ordering. Exported for that test only, not part of the package surface.
//
// what-isr carries this function character for character
// (packages/cache/src/local-path.js gates a CDN purge path), because the
// engine never imports what-server; the parity test fails when they differ.
export function safeLocalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  // Reject protocol-relative / backslash-smuggled targets up front.
  if (/^[/\\]{2}/.test(value) || value.includes('\\')) return null;
  try {
    const u = new URL(value, 'http://localhost');
    if (u.origin !== 'http://localhost' || u.pathname.startsWith('//')) return null;
    return u.pathname + u.search;
  } catch {
    return null;
  }
}

function safeRedirectTarget(form, headers) {
  const explicit = safeLocalPath(form && form._redirect);
  if (explicit) return explicit;
  const referer = headers.referer || headers.referrer;
  if (referer) {
    try {
      const u = new URL(referer, 'http://localhost');
      const path = safeLocalPath(u.pathname + u.search);
      if (path) return path;
    } catch { /* fall through */ }
  }
  return '/';
}

// --- Where a request comes from ---
//
// CSRF is a browser sending a request the visitor did not mean to send, from
// another site's page. Browsers say where a request comes from: every current
// one sends Sec-Fetch-Site (Fetch Metadata) on a POST, and Origin before that.
// A post they mark same-origin cannot have come from another site, token or
// no token, which is how a form on a cached page (whose shared HTML can never
// carry a visitor's token) posts. This is the scheme of Go's
// CrossOriginProtection and OWASP's "verifying origin with standard headers".
// A request that carries neither header (an old browser, or not a browser)
// falls back to the double-submit token.
//
// Returns 'same', 'cross', or 'unknown' (neither header).
export function requestSite(headers, url, trustedOrigins) {
  const origin = headers.origin;
  const trusted = typeof origin === 'string' && trustedOrigins.has(origin);
  const site = headers['sec-fetch-site'];
  if (site !== undefined) {
    if (site === 'same-origin' || site === 'none') return 'same';
    return trusted ? 'same' : 'cross';
  }
  if (origin === undefined || origin === null) return 'unknown';
  if (trusted) return 'same';
  // "null" is an opaque origin: a sandboxed frame, a data: URL, a privacy
  // redirect. None of them is this site.
  if (origin === 'null') return 'cross';
  const target = targetOrigin(headers, url);
  try {
    return target !== null && new URL(origin).origin === target ? 'same' : 'cross';
  } catch {
    return 'cross';
  }
}

// The origin a request was sent to, scheme included: an https page posting to
// an http host is another origin. The host is the Host header's, else the
// URL's. The scheme is the one a proxy in front reports in X-Forwarded-Proto,
// else the request URL's, which the adapter builds from what it knows of the
// connection (a TLS socket, the platform's own URL); a bare path says http.
// X-Forwarded-Proto is believed without configuration: a page on another site
// cannot set it on a visitor's request (a form cannot set headers, and a
// fetch that sets one is preflighted), so only the proxy or the sender itself
// can, and neither is a cross-site request. Behind a TLS proxy that does not
// send it, the server sees http: have the proxy send it, or list the https
// origin in `trustedOrigins`. Null when no host is named.
function targetOrigin(headers, url) {
  /** @type {URL | null} */
  let parsed = null;
  try {
    parsed = new URL(String(url));
  } catch { /* a path: no scheme or host of its own */ }
  const host = headers.host || (parsed && parsed.host);
  if (!host) return null;
  const forwarded = String(headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const scheme = forwarded === 'https' || forwarded === 'http' ? forwarded : parsed && parsed.protocol === 'https:' ? 'https' : 'http';
  try {
    return new URL(`${scheme}://${host}`).origin;
  } catch {
    return null;
  }
}

// Reserved form fields consumed by the framework (not passed to the action).
// `what-csrf-token` is an alias for `_csrf` matching the <meta name="what-csrf-token">
// tag SSR pages embed, so templates can reuse one name for both surfaces.
const RESERVED_FORM_FIELDS = new Set(['_action', 'data-action', '_csrf', 'what-csrf-token', '_redirect']);

/**
 * Framework-agnostic action dispatcher.
 *
 * options:
 *   - getCsrfToken(reqLike) -> sessionToken (sync or async). Omit + skipCsrf for none.
 *   - skipCsrf: bool — opt out of CSRF (e.g. token-authed APIs).
 *   - trustedOrigins: string[] — other origins whose pages may post here
 *     (another domain of the same app, behind the same login).
 *   - basePath: string — defaults to '/__what_action' (used by the adapters).
 *
 * CSRF: a request the browser marks cross-site (Sec-Fetch-Site, or an Origin
 * that is not this host and not trusted) is refused with 403. One it marks
 * same-origin passes without a token; a token it carries anyway must match.
 * A request with neither header must carry the double-submit token.
 *
 * Returns: async (reqLike) -> { status, headers, body:string }
 *   reqLike: { method, headers, body, query?, url? }
 *
 * Two request shapes are accepted:
 *
 * 1. JSON + header (fetch clients — what the `action()` client wrapper sends):
 *    POST with `X-What-Action: <id>` header, JSON body `{ args: [...] }`,
 *    CSRF token in the `X-CSRF-Token` header. Responds with JSON.
 *
 * 2. Plain HTML form post (progressive enhancement — works without JS):
 *    POST with `Content-Type: application/x-www-form-urlencoded` and NO
 *    X-What-Action header. `body` is the parsed form fields object.
 *    - action id:   `_action` (or `data-action`) hidden field, or `?action=`
 *                   query param (reqLike.query.action)
 *    - CSRF token:  `_csrf` (or `what-csrf-token`) hidden field; an
 *                   `x-csrf-token` HEADER wins when both are present
 *    - redirect:    `_redirect` hidden field (local path), else Referer, else '/'
 *    The action receives ONE argument: the form fields object (reserved
 *    fields stripped). Success responds 303 See Other (POST/redirect/GET);
 *    failures respond with an HTML error page and the matching status.
 */
// The request an action call answers: the Web Request a fetch endpoint got,
// else one made from the request-like object. A path is this host's (its Host
// header's), so `//other.test/x` is a path here, never another authority.
function requestOf(reqLike, method) {
  if (typeof Request === 'undefined') return null;
  if (reqLike.request instanceof Request) return reqLike.request;
  const headers = lowerHeaders(reqLike.headers);
  const target = typeof reqLike.url === 'string' && reqLike.url ? reqLike.url : '/';
  let url;
  try {
    url = new URL(target.startsWith('/') ? `http://${headers.host || 'localhost'}${target}` : target);
  } catch {
    url = new URL('http://localhost/');
  }
  const init = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value != null) init.set(name, Array.isArray(value) ? value.join(', ') : String(value));
  }
  return new Request(url, { method, headers: init });
}

export function createActionHandler(options = {}) {
  const { getCsrfToken, skipCsrf = false } = options;
  const trustedOrigins = new Set(options.trustedOrigins || []);

  return async function handle(reqLike) {
    const method = (reqLike.method || 'POST').toUpperCase();
    // The action runs with its request (getRequest()), the caller's cookies
    // and headers: an action is a public endpoint, and checks its caller.
    const call = (id, args, callOptions, callHeaders) => runInActionContext(requestOf(reqLike, method),
      () => handleActionRequest({ headers: callHeaders }, id, args, callOptions));
    if (method !== 'POST') {
      return jsonResponse(405, { message: 'Method Not Allowed' });
    }

    const headers = lowerHeaders(reqLike.headers);
    const headerActionId = headers['x-what-action'];
    const contentType = headers['content-type'] || '';
    const isFormPost = !headerActionId && contentType.includes('application/x-www-form-urlencoded');

    const site = skipCsrf ? 'same' : requestSite(headers, reqLike.url, trustedOrigins);
    if (site === 'cross') {
      return isFormPost ? htmlResponse(403, 'Cross-site request refused') : jsonResponse(403, { message: 'Cross-site request refused' });
    }

    const sessionCsrfToken = skipCsrf
      ? undefined
      : (getCsrfToken ? await getCsrfToken(reqLike) : undefined);

    // --- Plain HTML form post (progressive enhancement) ---
    if (isFormPost) {
      const form = reqLike.body || {};
      const actionId = form._action || form['data-action'] || (reqLike.query && reqLike.query.action);
      if (!actionId) {
        return htmlResponse(400, 'Missing action name (add a hidden "_action" field or ?action= query param)');
      }

      // CSRF token travels in the `_csrf` (or `what-csrf-token`) form field
      // for plain forms; map it to the header slot handleActionRequest
      // validates against. The header wins when both are present.
      const formHeaders = { ...headers };
      const bodyToken = form._csrf ?? form['what-csrf-token'];
      if (bodyToken && !formHeaders['x-csrf-token']) formHeaders['x-csrf-token'] = String(bodyToken);
      // A same-origin post with no token is a form on a cached page.
      const byOrigin = site === 'same' && !formHeaders['x-csrf-token'];

      if (!skipCsrf && !byOrigin && getCsrfToken && !sessionCsrfToken) {
        // CSRF is configured but this client has no token (e.g. no cookie yet).
        return htmlResponse(403, 'Missing CSRF token');
      }

      // Copied as own fields (addField), as parseActionBody wrote them: an
      // assignment to a field named `__proto__` would set data's prototype.
      const data = {};
      for (const [k, v] of Object.entries(form)) {
        if (!RESERVED_FORM_FIELDS.has(k)) addField(data, k, v);
      }

      const result = await call(actionId, [data], { csrfToken: sessionCsrfToken, skipCsrf: skipCsrf || byOrigin }, formHeaders);

      if (result.status === 200) {
        return {
          status: 303,
          headers: { location: safeRedirectTarget(form, headers) },
          body: '',
        };
      }
      return htmlResponse(result.status, (result.body && result.body.message) || 'Action failed');
    }

    // --- JSON + X-What-Action header (fetch clients) ---
    if (!headerActionId) {
      return jsonResponse(400, { message: 'Missing X-What-Action header' });
    }

    const byOrigin = site === 'same' && !headers['x-csrf-token'];
    if (!skipCsrf && !byOrigin && getCsrfToken && !sessionCsrfToken) {
      // CSRF configured, but the client presented no session token (no cookie).
      return jsonResponse(403, { message: 'Missing CSRF token' });
    }

    const body = reqLike.body || {};
    const args = body.args;

    const result = await call(headerActionId, args, { csrfToken: sessionCsrfToken, skipCsrf: skipCsrf || byOrigin }, headers);

    return jsonResponse(result.status, result.body);
  };
}

// --- Node connect/express middleware ---
// Mount before your routes: app.use(nodeActionMiddleware({ getCsrfToken }))
//
// The endpoint is the request target's raw path, compared exactly before
// anything parses it: `//other.test/__what_action`, `/x/../__what_action` and
// an absolute-form target are other paths, and go to next(). The middleware
// never rejects: connect and Express 4 drop the promise a middleware returns,
// and Node ends the process on a rejection nobody handles.

export function nodeActionMiddleware(options = {}) {
  const basePath = options.basePath || DEFAULT_BASE_PATH;
  const handle = createActionHandler(options);

  return async function middleware(req, res, next) {
    const target = typeof req.url === 'string' ? req.url : '/';
    const queryAt = target.indexOf('?');
    const path = queryAt < 0 ? target : target.slice(0, queryAt);
    if (path !== basePath || String(req.method || '').toUpperCase() !== 'POST') {
      return next ? next() : undefined;
    }
    try {
      await answerAction(req, res, handle, target.slice(path.length));
    } catch (err) {
      console.error('[what] Action request failed:', err);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Action failed' }));
    }
  };
}

// One action request the middleware matched, `search` its raw query. The
// Request the action sees (getRequest()) is this connection's: its scheme
// (TLS or not), its Host header, and the endpoint's path.
async function answerAction(req, res, handle, search) {
  let body;
  try {
    const raw = await readRawBody(req);
    body = parseActionBody(raw, req.headers['content-type'] || '');
  } catch (err) {
    res.writeHead(err.code === 'BODY_TOO_LARGE' ? 413 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: err.code === 'BODY_TOO_LARGE' ? 'Payload too large' : 'Invalid request body' }));
    return;
  }
  const query = Object.fromEntries(new URLSearchParams(search));
  const scheme = req.socket && req.socket.encrypted ? 'https' : 'http';
  const url = `${scheme}://${req.headers.host || 'localhost'}${req.url}`;
  const out = await handle({ method: req.method, headers: req.headers, body, query, url });
  res.writeHead(out.status, out.headers);
  res.end(out.body);
}

/** Parse an action request body by content type: form-urlencoded -> fields object, else JSON. */
export function parseActionBody(raw, contentType) {
  if ((contentType || '').includes('application/x-www-form-urlencoded')) {
    const fields = {};
    for (const [k, v] of new URLSearchParams(String(raw))) addField(fields, k, v);
    return fields;
  }
  if (raw == null || raw === '') return {};
  return JSON.parse(String(raw));
}

/**
 * Read a Web Fetch `Request` body as text with the same MAX_BODY_BYTES cap the
 * Node middleware enforces. Used by the adapter/edge entry points (Vercel /
 * Cloudflare / Node-adapter) so all three share one DoS guard.
 *
 * Returns { raw } on success or { tooLarge: true } when the cap is exceeded —
 * checked first via Content-Length, then enforced while streaming (chunked /
 * spoofed Content-Length can't bypass it).
 *
 * @param {Request} request
 * @param {number} [limit=MAX_BODY_BYTES]
 */
export async function readFetchBodyCapped(request, limit = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    return { tooLarge: true };
  }
  const body = request.body;
  // No stream available (or env without ReadableStream): fall back to text()
  // but still re-check the resulting size against the cap.
  if (!body || typeof body.getReader !== 'function') {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > limit) return { tooLarge: true };
    return { raw };
  }
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      size += value.byteLength;
      if (size > limit) {
        try { await reader.cancel(); } catch { /* ignore */ }
        return { tooLarge: true };
      }
      chunks.push(value);
    }
  }
  return { raw: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8') };
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        /** @type {Error & { code?: string }} */
        const e = new Error('Body too large');
        e.code = 'BODY_TOO_LARGE';
        reject(e);
        req.destroy?.();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve('');
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

// --- Web Fetch handler (edge / Deno / Bun / Cloudflare) ---
// const handler = fetchActionHandler({ getCsrfToken }); addEventListener('fetch', e => e.respondWith(handler(e.request)))

export function fetchActionHandler(options = {}) {
  const handle = createActionHandler(options);
  return async function (request) {
    let body = {};
    try {
      const read = await readFetchBodyCapped(request);
      if (read.tooLarge) {
        return new Response(JSON.stringify({ message: 'Payload too large' }), {
          status: 413,
          headers: { 'content-type': 'application/json' },
        });
      }
      body = parseActionBody(read.raw, request.headers.get('content-type') || '');
    } catch {
      body = {};
    }
    let query = {};
    try {
      query = Object.fromEntries(new URL(request.url, 'http://localhost').searchParams);
    } catch { /* no query */ }
    const out = await handle({ method: request.method, headers: request.headers, body, query, url: request.url, request });
    return new Response(out.body, { status: out.status, headers: out.headers });
  };
}
