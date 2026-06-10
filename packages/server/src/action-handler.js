// What Framework - Served Server Actions
//
// actions.js defines actions and `handleActionRequest`, but nothing wires the
// `/__what_action` HTTP route the client posts to. This module provides that
// missing piece: a framework-agnostic core handler plus thin Node-middleware
// and Web-Fetch adapters. CSRF + dispatch + error masking are reused from
// actions.js (handleActionRequest) — no security logic is duplicated here.

import { handleActionRequest } from './actions.js';

const DEFAULT_BASE_PATH = '/__what_action';
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

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
// backslash, then canonicalize via URL and require the localhost origin.
function safeLocalPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return null;
  // Reject protocol-relative / backslash-smuggled targets up front.
  if (/^[/\\]{2}/.test(value) || value.includes('\\')) return null;
  try {
    const u = new URL(value, 'http://localhost');
    if (u.origin !== 'http://localhost') return null;
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
 *   - basePath: string — defaults to '/__what_action' (used by the adapters).
 *
 * Returns: async (reqLike) -> { status, headers, body:string }
 *   reqLike: { method, headers, body, query? }
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
export function createActionHandler(options = {}) {
  const { getCsrfToken, skipCsrf = false } = options;

  return async function handle(reqLike) {
    const method = (reqLike.method || 'POST').toUpperCase();
    if (method !== 'POST') {
      return jsonResponse(405, { message: 'Method Not Allowed' });
    }

    const headers = lowerHeaders(reqLike.headers);
    const headerActionId = headers['x-what-action'];
    const contentType = headers['content-type'] || '';
    const isFormPost = !headerActionId && contentType.includes('application/x-www-form-urlencoded');

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

      if (!skipCsrf && getCsrfToken && !sessionCsrfToken) {
        // CSRF is configured but this client has no token (e.g. no cookie yet).
        return htmlResponse(403, 'Missing CSRF token');
      }

      const data = {};
      for (const [k, v] of Object.entries(form)) {
        if (!RESERVED_FORM_FIELDS.has(k)) data[k] = v;
      }

      const result = await handleActionRequest(
        { headers: formHeaders },
        actionId,
        [data],
        { csrfToken: sessionCsrfToken, skipCsrf }
      );

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

    if (!skipCsrf && getCsrfToken && !sessionCsrfToken) {
      // CSRF configured, but the client presented no session token (no cookie).
      return jsonResponse(403, { message: 'Missing CSRF token' });
    }

    const body = reqLike.body || {};
    const args = body.args;

    const result = await handleActionRequest(
      { headers },
      headerActionId,
      args,
      { csrfToken: sessionCsrfToken, skipCsrf }
    );

    return jsonResponse(result.status, result.body);
  };
}

// --- Node connect/express middleware ---
// Mount before your routes: app.use(nodeActionMiddleware({ getCsrfToken }))

export function nodeActionMiddleware(options = {}) {
  const basePath = options.basePath || DEFAULT_BASE_PATH;
  const handle = createActionHandler(options);

  return async function middleware(req, res, next) {
    const [url, search] = (req.url || '').split('?');
    if (url !== basePath || (req.method || '').toUpperCase() !== 'POST') {
      return next ? next() : undefined;
    }

    let body;
    try {
      const raw = await readRawBody(req);
      body = parseActionBody(raw, req.headers['content-type'] || '');
    } catch (err) {
      res.writeHead(err.code === 'BODY_TOO_LARGE' ? 413 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: err.code === 'BODY_TOO_LARGE' ? 'Payload too large' : 'Invalid request body' }));
      return;
    }

    const query = Object.fromEntries(new URLSearchParams(search || ''));
    const out = await handle({ method: req.method, headers: req.headers, body, query });
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  };
}

/** Parse an action request body by content type: form-urlencoded -> fields object, else JSON. */
export function parseActionBody(raw, contentType) {
  if ((contentType || '').includes('application/x-www-form-urlencoded')) {
    const fields = {};
    for (const [k, v] of new URLSearchParams(String(raw))) {
      if (fields[k] === undefined) fields[k] = v;
      else if (Array.isArray(fields[k])) fields[k].push(v);
      else fields[k] = [fields[k], v];
    }
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
    const out = await handle({ method: request.method, headers: request.headers, body, query });
    return new Response(out.body, { status: out.status, headers: out.headers });
  };
}
