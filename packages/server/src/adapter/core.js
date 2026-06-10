// Framework-agnostic deploy adapter core. A Web-Fetch handler
// (request) -> Response that powers Node, Vercel and Cloudflare alike:
//   match route -> intercept actions + revalidate webhook -> ISR cache
//   (HIT/STALE/MISS) -> render -> respond with Cache-Control headers.
//
// The cache engine is OPTIONAL and injected (from what-isr) so what-server
// stays standalone. Render is owned here (renderDocument) but overridable.

import { matchRoute, parseQuery } from 'what-router/match';
import { renderDocument } from '../index.js';
import { createActionHandler, parseActionBody } from '../action-handler.js';
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

async function readActionBody(request) {
  try {
    const raw = await request.text();
    return parseActionBody(raw, request.headers.get('content-type') || '');
  } catch { return {}; }
}

async function readJsonBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function defaultRenderRoute(documentOptions) {
  return async function renderRoute(routeMatch) {
    const { route, params, query, request } = routeMatch;
    const pageModule = { default: route.component, loader: route.loader };
    const opts = routeMatch.csrfToken
      ? { ...documentOptions, csrfToken: routeMatch.csrfToken }
      : documentOptions;
    const html = await renderDocument(pageModule, { params, query, request }, opts);
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
 *     fetch clients, `_csrf` form field for plain HTML forms) against the cookie.
 *
 * Opt out with `csrf: false` (e.g. token-authed APIs behind another gateway),
 * or take full control by passing your own `actionHandler` — a custom handler
 * owns its CSRF policy and the cookie/meta auto-provisioning is skipped.
 *
 * Plain HTML form posts (progressive enhancement, no JS) are accepted on
 * /__what_action as application/x-www-form-urlencoded — see createActionHandler
 * in action-handler.js for the field contract (_action, _csrf, _redirect).
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
    let csrfToken = null;
    let csrfSetCookie = null;
    if (autoCsrf) {
      csrfToken = readCookie(headersToObject(request.headers).cookie, CSRF_COOKIE);
      if (!csrfToken) {
        csrfToken = generateCsrfToken();
        // NOT HttpOnly: the client action() wrapper reads it to send X-CSRF-Token.
        csrfSetCookie = `${CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Lax`;
      }
    }
    const withCsrfCookie = (headers) => {
      if (csrfSetCookie) headers['set-cookie'] = csrfSetCookie;
      return headers;
    };

    // On-demand revalidation webhook
    if (request.method === 'POST' && pathname === REVALIDATE_PATH && revalidateWebhook) {
      const body = await readJsonBody(request);
      const out = await revalidateWebhook({ headers: headersToObject(request.headers), body });
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
    const headers = withCsrfCookie({ 'content-type': 'text/html; charset=utf-8' });
    if (config.mode === 'server') headers['Cache-Control'] = 'private, no-store';
    return new Response(out.html, { status: out.status || 200, headers });
  };
}
