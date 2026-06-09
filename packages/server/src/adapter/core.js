// Framework-agnostic deploy adapter core. A Web-Fetch handler
// (request) -> Response that powers Node, Vercel and Cloudflare alike:
//   match route -> intercept actions + revalidate webhook -> ISR cache
//   (HIT/STALE/MISS) -> render -> respond with Cache-Control headers.
//
// The cache engine is OPTIONAL and injected (from what-isr) so what-server
// stays standalone. Render is owned here (renderDocument) but overridable.

import { matchRoute, parseQuery } from 'what-router/match';
import { renderDocument } from '../index.js';
import { createActionHandler } from '../action-handler.js';
import { setRevalidationHandler } from '../revalidation-registry.js';

const ACTION_PATH = '/__what_action';
const REVALIDATE_PATH = '/__what_revalidate';

function headersToObject(headers) {
  const out = {};
  if (headers && typeof headers.forEach === 'function') headers.forEach((v, k) => { out[k.toLowerCase()] = v; });
  return out;
}

async function readJsonBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function defaultRenderRoute(documentOptions) {
  return async function renderRoute(routeMatch) {
    const { route, params, query, request } = routeMatch;
    const pageModule = { default: route.component, loader: route.loader };
    const html = await renderDocument(pageModule, { params, query, request }, documentOptions);
    return {
      html,
      status: 200,
      tags: (routeMatch.config && routeMatch.config.tags) || [],
      path: routeMatch.path,
    };
  };
}

export function createRequestHandler(options = {}) {
  const {
    routes = [],
    cache,
    render,
    actionHandler = createActionHandler({ skipCsrf: true }),
    revalidateWebhook,
    document: documentOptions = {},
    notFound,
    basePath = '',
  } = options;

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

    // Server actions
    if (request.method === 'POST' && pathname === ACTION_PATH) {
      const body = await readJsonBody(request);
      const out = await actionHandler({ method: 'POST', headers: headersToObject(request.headers), body });
      return new Response(out.body, { status: out.status, headers: out.headers });
    }

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
      return new Response(html, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }

    const { route, params } = matched;
    const config = route.page || { mode: route.mode || 'client' };
    const routeMatch = { path: pathname, query: parseQuery(url.search), config, route, params, request };

    // ISR cache path (static/hybrid with a cache engine). Server-mode bypasses.
    if (cache && config.mode !== 'server') {
      const result = await cache.handle(routeMatch, () => renderRoute(routeMatch));
      return new Response(result.html, {
        status: result.status || 200,
        headers: { 'content-type': 'text/html; charset=utf-8', ...(result.headers || {}) },
      });
    }

    // Direct render (server mode, or no cache configured)
    const out = await renderRoute(routeMatch);
    const headers = { 'content-type': 'text/html; charset=utf-8' };
    if (config.mode === 'server') headers['Cache-Control'] = 'private, no-store';
    return new Response(out.html, { status: out.status || 200, headers });
  };
}
