// Framework-agnostic deploy adapter core. A Web-Fetch handler
// (request) -> Response that powers Node, Vercel and Cloudflare alike:
//   match route -> intercept actions + revalidate webhook -> ISR cache
//   (HIT/STALE/MISS) -> render -> respond with Cache-Control headers.
//
// The cache engine is OPTIONAL and injected (from what-isr) so what-server
// stays standalone. Render is owned here (renderDocument) but overridable.

import { matchRoute, parseQuery } from 'what-router/match';
import { renderDocument } from '../index.js';
import { createActionHandler, parseActionBody, readFetchBodyCapped } from '../action-handler.js';
import { setRevalidationHandler } from '../revalidation-registry.js';
import { generateCsrfToken } from '../actions.js';

const ACTION_PATH = '/__what_action';
const REVALIDATE_PATH = '/__what_revalidate';
const CSRF_COOKIE = 'what-csrf';

function headersToObject(headers) {
  const out = {};
  if (headers && typeof headers.forEach === 'function') headers.forEach((v, k) => { out[k.toLowerCase()] = v; });
  return out;
}

function readCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const match = String(cookieHeader).match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Read + parse the action body with the shared MAX_BODY_BYTES cap. Returns
// { tooLarge: true } when over the limit so the caller can respond 413 (DoS
// guard parity with the Node connect/express middleware).
async function readActionBody(request) {
  try {
    const read = await readFetchBodyCapped(request);
    if (read.tooLarge) return { tooLarge: true };
    return parseActionBody(read.raw, request.headers.get('content-type') || '');
  } catch { return {}; }
}

// Same cap for the revalidate webhook: the secret is only checked once the body
// is parsed, so an unauthenticated client must never be able to make the origin
// buffer an unbounded payload before its 401.
async function readJsonBody(request) {
  let read;
  try { read = await readFetchBodyCapped(request); } catch { return { json: {} }; }
  if (read.tooLarge) return { tooLarge: true };
  // `raw` is absent on the tooLarge branch, which returned above; `?? ''` keeps
  // the parse throwing into the same catch it always did.
  try { return { json: JSON.parse(read.raw ?? '') }; } catch { return { json: {} }; }
}

function defaultRenderRoute(documentOptions) {
  return async function renderRoute(routeMatch) {
    const { route, params, query, request, csrfToken } = routeMatch;
    const pageModule = { default: route.component, loader: route.loader };
    // The token goes to the LOADER as well as the document. A server-rendered
    // <Form> has to put the per-visitor token in a hidden field, and the loader
    // is the only per-request hook a page has before its component runs, so
    // without this the token exists (as a cookie and a <meta> tag) and is still
    // unreachable from the markup: the form ships an empty field and the no-JS
    // submit dies on the double-submit check with a silent 403. The create-what
    // scaffold already hand-rolled its own renderRoute to do exactly this.
    //
    // Only the direct-render branch below sets routeMatch.csrfToken, so a
    // CACHED route's loader still sees no token. That is deliberate, not an
    // omission: cached HTML is shared between visitors and must never carry one
    // visitor's token.
    const reqCtx = csrfToken ? { params, query, request, csrfToken } : { params, query, request };
    const opts = csrfToken
      ? { ...documentOptions, csrfToken }
      : documentOptions;
    const html = await renderDocument(pageModule, reqCtx, opts);
    return {
      html,
      status: 200,
      tags: (routeMatch.config && routeMatch.config.tags) || [],
      path: routeMatch.path,
    };
  };
}

/**
 * Create the framework request handler: (Request) -> Response.
 *
 * CSRF is ON BY DEFAULT (double-submit cookie):
 *   - Every HTML response ensures a `what-csrf` cookie (SameSite=Lax, NOT
 *     HttpOnly so the fetch client can echo it in the X-CSRF-Token header).
 *   - Uncached HTML renders also embed <meta name="what-csrf-token"> plus the
 *     token for hidden form fields (cached/ISR pages rely on the cookie only,
 *     so a per-user token is never baked into shared cache entries).
 *   - POST /__what_action validates the client token (X-CSRF-Token header for
 *     fetch clients, `_csrf` or `what-csrf-token` form field for plain HTML
 *     forms — the header wins when both are present) against the cookie.
 *
 * Opt out with `csrf: false` (e.g. token-authed APIs behind another gateway),
 * or take full control by passing your own `actionHandler` — a custom handler
 * owns its CSRF policy and the cookie/meta auto-provisioning is skipped.
 *
 * Plain HTML form posts (progressive enhancement, no JS) are accepted on
 * /__what_action as application/x-www-form-urlencoded — see createActionHandler
 * in action-handler.js for the field contract (_action, _csrf/what-csrf-token,
 * _redirect).
 */
export function createRequestHandler(options = {}) {
  const {
    routes = [],
    cache,
    render,
    revalidateWebhook,
    document: documentOptions = {},
    notFound,
    basePath = '',
    csrf = true,
  } = options;

  // Auto-provisioning (cookie + meta tag) only applies to the built-in
  // handler; a user-supplied actionHandler owns its own CSRF policy.
  const autoCsrf = csrf !== false && !options.actionHandler;
  const actionHandler = options.actionHandler || createActionHandler(
    autoCsrf
      ? { getCsrfToken: (reqLike) => readCookie(reqLike.headers && reqLike.headers.cookie, CSRF_COOKIE) }
      : { skipCsrf: true }
  );

  const renderRoute = render || defaultRenderRoute(documentOptions);

  // Bind the cache engine so server actions' revalidatePath/revalidateTag (and
  // any app code calling them from what-framework/server) purge this engine.
  if (cache && (cache.revalidatePath || cache.revalidateTag)) {
    setRevalidationHandler({
      revalidatePath: cache.revalidatePath,
      revalidateTag: cache.revalidateTag,
    });
  }

  return async function handle(request) {
    const url = new URL(request.url, 'http://localhost');
    let pathname = url.pathname;
    if (basePath && pathname.startsWith(basePath)) pathname = pathname.slice(basePath.length) || '/';

    // Server actions (JSON fetch path AND plain form-post fallback)
    if (request.method === 'POST' && pathname === ACTION_PATH) {
      const body = await readActionBody(request);
      if (body && body.tooLarge) {
        return new Response(JSON.stringify({ message: 'Payload too large' }), {
          status: 413,
          headers: { 'content-type': 'application/json' },
        });
      }
      const out = await actionHandler({
        method: 'POST',
        headers: headersToObject(request.headers),
        body,
        query: Object.fromEntries(url.searchParams),
      });
      return new Response(out.body, { status: out.status, headers: out.headers });
    }

    // CSRF provisioning for HTML responses (double-submit cookie). If the
    // visitor has no token cookie yet, mint one and Set-Cookie it below.
    /** @type {string | null} */
    let csrfToken = null;
    /** @type {string | null} */
    let csrfSetCookie = null;
    if (autoCsrf) {
      csrfToken = readCookie(headersToObject(request.headers).cookie, CSRF_COOKIE);
      if (!csrfToken) {
        csrfToken = generateCsrfToken();
        // NOT HttpOnly: the client action() wrapper reads it to send X-CSRF-Token.
        // Secure when the request is HTTPS (direct or via a proxy's
        // x-forwarded-proto) or in production; OFF for plain-http localhost dev
        // so the cookie still sets and CSRF keeps working locally.
        const reqHeaders = headersToObject(request.headers);
        const isHttps = reqHeaders['x-forwarded-proto'] === 'https'
          || url.protocol === 'https:'
          || process.env.NODE_ENV === 'production';
        csrfSetCookie = `${CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Lax`
          + (isHttps ? '; Secure' : '');
      }
    }
    const withCsrfCookie = (headers) => {
      if (csrfSetCookie) headers['set-cookie'] = csrfSetCookie;
      return headers;
    };

    // On-demand revalidation webhook
    if (request.method === 'POST' && pathname === REVALIDATE_PATH && revalidateWebhook) {
      const read = await readJsonBody(request);
      if (read.tooLarge) {
        return new Response(JSON.stringify({ message: 'Payload too large' }), {
          status: 413,
          headers: { 'content-type': 'application/json' },
        });
      }
      const out = await revalidateWebhook({ headers: headersToObject(request.headers), body: read.json });
      return new Response(JSON.stringify(out.body), {
        status: out.status,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Route match
    const matched = matchRoute(pathname, routes);
    if (!matched) {
      const html = notFound ? notFound() : '<!DOCTYPE html><html><body><h1>404 — Not Found</h1></body></html>';
      return new Response(html, { status: 404, headers: withCsrfCookie({ 'content-type': 'text/html; charset=utf-8' }) });
    }

    const { route, params } = matched;
    const config = route.page || { mode: route.mode || 'client' };
    const routeMatch = { path: pathname, query: parseQuery(url.search), config, route, params, request };

    // ISR cache path (static/hybrid with a cache engine). Server-mode bypasses.
    // NOTE: cached HTML is shared across users, so the per-user CSRF token is
    // NOT embedded in the page here — clients read it from the cookie instead.
    if (cache && config.mode !== 'server') {
      // The cache engine resolves the route's declared `vary` names against
      // these. Without them it fails closed: warns and bypasses on every
      // request, which is how the vary control shipped never executing.
      routeMatch.varyHeaders = headersToObject(request.headers);
      const result = await cache.handle(routeMatch, () => renderRoute(routeMatch));
      return new Response(result.html, {
        status: result.status || 200,
        headers: withCsrfCookie({ 'content-type': 'text/html; charset=utf-8', ...(result.headers || {}) }),
      });
    }

    // Direct render (server mode, or no cache configured): per-request HTML,
    // safe to embed the CSRF token as a <meta> tag for forms/fetch clients.
    if (csrfToken) routeMatch.csrfToken = csrfToken;
    const out = await renderRoute(routeMatch);
    // `out.headers` is honoured here exactly as it is on the cache path above.
    // It used to be dropped on this branch only, so a custom `render` could set
    // response headers for a cached route and not for an uncached one — which
    // meant a render returning a 302 produced a redirect with no Location, an
    // empty page with nothing to say why. Spread before the CSRF cookie so a
    // render cannot drop it.
    const headers = withCsrfCookie({
      'content-type': 'text/html; charset=utf-8',
      ...(out.headers || {}),
    });
    if (config.mode === 'server') headers['Cache-Control'] = 'private, no-store';
    return new Response(out.html, { status: out.status || 200, headers });
  };
}
