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

/**
 * Framework-agnostic action dispatcher.
 *
 * options:
 *   - getCsrfToken(reqLike) -> sessionToken (sync or async). Omit + skipCsrf for none.
 *   - skipCsrf: bool — opt out of CSRF (e.g. token-authed APIs).
 *   - basePath: string — defaults to '/__what_action' (used by the adapters).
 *
 * Returns: async (reqLike) -> { status, headers, body:string }
 *   reqLike: { method, headers, body }  where body is the parsed JSON ({ args }).
 */
export function createActionHandler(options = {}) {
  const { getCsrfToken, skipCsrf = false } = options;

  return async function handle(reqLike) {
    const method = (reqLike.method || 'POST').toUpperCase();
    if (method !== 'POST') {
      return jsonResponse(405, { message: 'Method Not Allowed' });
    }

    const headers = lowerHeaders(reqLike.headers);
    const actionId = headers['x-what-action'];
    if (!actionId) {
      return jsonResponse(400, { message: 'Missing X-What-Action header' });
    }

    const body = reqLike.body || {};
    const args = body.args;

    const sessionCsrfToken = skipCsrf
      ? undefined
      : (getCsrfToken ? await getCsrfToken(reqLike) : undefined);

    const result = await handleActionRequest(
      { headers },
      actionId,
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
    const url = (req.url || '').split('?')[0];
    if (url !== basePath || (req.method || '').toUpperCase() !== 'POST') {
      return next ? next() : undefined;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      res.writeHead(err.code === 'BODY_TOO_LARGE' ? 413 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: err.code === 'BODY_TOO_LARGE' ? 'Payload too large' : 'Invalid JSON body' }));
      return;
    }

    const out = await handle({ method: req.method, headers: req.headers, body });
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  };
}

function readJsonBody(req) {
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
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
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
      body = await request.json();
    } catch {
      body = {};
    }
    const out = await handle({ method: request.method, headers: request.headers, body });
    return new Response(out.body, { status: out.status, headers: out.headers });
  };
}
