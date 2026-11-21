// Framework-agnostic deploy adapter core. A Web-Fetch handler
// (request) -> Response that powers Node, Vercel and Cloudflare alike:
//   match route -> intercept actions + revalidate webhook -> ISR cache
//   (HIT/STALE/MISS) -> render -> respond with Cache-Control headers.
//
// The cache engine is OPTIONAL and injected (from what-isr) so what-server
// stays standalone. Render is owned here (renderDocument) but overridable.
//
// A cached route and the response API. A render the cache may share sees a
// view of the request whose `signal` is the cache's (a regeneration is shared
// work: it stops only when every request waiting on it has gone) and which
// records the request headers it reads. Reading a header the route's `vary`
// does not name (a cookie, Authorization, Accept-Language) makes the render
// per-visitor, so it is returned as private and never stored. The cache
// engine (what-isr headers.js) decides the rest from the response the render
// set: a Set-Cookie, a private/no-store/no-cache Cache-Control or a Vary makes
// it private too; a redirect or any status but 200 goes to its own requester
// only, with its Location; the page's other headers are stored and replayed.
// A response a shared cache may store never carries a cookie: when the CSRF
// cookie has to be set on one, that response is sent `private, no-store`.

import { matchRoute, parseQuery } from 'what-router/match';
import { renderDocument, renderDocumentStream } from '../index.js';
import { createActionHandler, parseActionBody, readFetchBodyCapped } from '../action-handler.js';
import { setRevalidationHandler } from '../revalidation-registry.js';
import { generateCsrfToken } from '../actions.js';
import { createResponse } from '../response.js';
import { _isDevMode } from '../html.js';

const ACTION_PATH = '/__what_action';
const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' };
const NO_STORE = { 'cache-control': 'private, no-store' };
// Statuses whose response may not carry a body (the Response constructor throws).
const NULL_BODY = new Set([101, 204, 205, 304]);
const REVALIDATE_PATH = '/__what_revalidate';
const CSRF_COOKIE = 'what-csrf';

function headersToObject(headers) {
  const out = {};
  if (headers && typeof headers.forEach === 'function') headers.forEach((v, k) => { out[k.toLowerCase()] = v; });
  return out;
}

// Fold every header source of a response into one Headers. Later sources win
// for ordinary headers; Set-Cookie values are appended, never replaced, so a
// route's cookies and the CSRF cookie all reach the client. A source is a
// Headers or a plain object whose 'set-cookie' may be an array.
function responseHeaders(...sources) {
  const headers = new Headers();
  for (const source of sources) {
    if (!source) continue;
    if (typeof source.getSetCookie === 'function') {
      for (const cookie of source.getSetCookie()) headers.append('set-cookie', cookie);
      source.forEach((value, name) => { if (name !== 'set-cookie') headers.set(name, value); });
      continue;
    }
    for (const [name, value] of Object.entries(source)) {
      if (value == null) continue;
      if (name.toLowerCase() === 'set-cookie') {
        for (const cookie of [].concat(value)) headers.append('set-cookie', String(cookie));
      } else {
        headers.set(name, Array.isArray(value) ? value.join(', ') : String(value));
      }
    }
  }
  return headers;
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

// The page module, loader context and document options for one route request.
function pageRequest(routeMatch, documentOptions) {
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
  const response = createResponse();
  const reqCtx = csrfToken
    ? { params, query, request, signal: request.signal, response, csrfToken }
    : { params, query, request, signal: request.signal, response };
  const opts = csrfToken
    ? { ...documentOptions, csrfToken }
    : documentOptions;
  return { pageModule, reqCtx, opts, response };
}

// The status and headers the loader and the page set, with a redirect as a
// real Location header.
function committedHeaders(response) {
  return response.location ? responseHeaders(response.headers, { location: response.location }) : response.headers;
}

// The request header names a route's declared `vary` covers ('cookie:session'
// covers the Cookie header, 'accept-language' and 'header:x-tenant' name one).
function variedHeaderNames(config) {
  const names = new Set();
  const vary = config && config.vary;
  for (const raw of typeof vary === 'string' ? [vary] : Array.isArray(vary) ? vary : []) {
    const name = String(raw);
    const i = name.indexOf(':');
    const kind = i < 0 ? 'header' : name.slice(0, i).toLowerCase();
    names.add(kind === 'cookie' ? 'cookie' : (i < 0 ? name : name.slice(i + 1)).toLowerCase());
  }
  return names;
}

const ITERATING_METHODS = new Set(['forEach', 'entries', 'keys', 'values', Symbol.iterator]);

// The request a shareable render sees: the cache's signal, and a record of the
// header names read that the cache key does not vary on.
function sharedRenderRequest(request, signal, varied) {
  /** @type {Set<string>} */
  const unvaried = new Set();
  const read = (name) => {
    const lower = String(name).toLowerCase();
    if (!varied.has(lower)) unvaried.add(lower);
  };
  const headers = new Proxy(request.headers, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (property === 'get' || property === 'has') {
        return (name) => {
          read(name);
          return value.call(target, name);
        };
      }
      if (ITERATING_METHODS.has(property)) {
        return (...args) => {
          target.forEach((_value, name) => read(name));
          return value.apply(target, args);
        };
      }
      return value.bind(target);
    },
  });
  const view = new Proxy(request, {
    get(target, property) {
      if (property === 'headers') return headers;
      if (property === 'signal') return signal;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { request: view, unvaried };
}

function defaultRenderRoute(documentOptions) {
  // `cacheCtx` is what the cache engine hands a render it may share; absent on
  // the direct path.
  return async function renderRoute(routeMatch, cacheCtx) {
    const shared = cacheCtx && routeMatch.request
      ? sharedRenderRequest(routeMatch.request, cacheCtx.signal, variedHeaderNames(routeMatch.config))
      : null;
    const match = shared ? { ...routeMatch, request: shared.request } : routeMatch;
    const { pageModule, reqCtx, opts, response } = pageRequest(match, documentOptions);
    const html = await renderDocument(pageModule, reqCtx, opts);
    const unvaried = shared ? [...shared.unvaried] : [];
    if (unvaried.length && _isDevMode) {
      console.warn(
        `[what-server] ${routeMatch.path} is cached, and its render read the request header(s) ${unvaried.join(', ')}, ` +
        'which its cache key does not vary on, so this render was not stored. Declare them in the route\'s `vary` ' +
        '(page: { vary: [\'cookie:session\'] }) or render the page with mode: \'server\'.',
      );
    }
    return {
      html: response.location ? '' : html,
      status: response.status,
      headers: committedHeaders(response),
      tags: (routeMatch.config && routeMatch.config.tags) || [],
      path: routeMatch.path,
      usedRequestHeaders: unvaried.length > 0,
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
 *
 * @param {import('what-server').RequestHandlerOptions} [options]
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
    onError,
  } = options;

  // Auto-provisioning (cookie + meta tag) only applies to the built-in
  // handler; a user-supplied actionHandler owns its own CSRF policy.
  const autoCsrf = csrf !== false && !options.actionHandler;
  const actionHandler = options.actionHandler || createActionHandler(
    autoCsrf
      ? { getCsrfToken: (reqLike) => readCookie(reqLike.headers && reqLike.headers.cookie, CSRF_COOKIE) }
      : { skipCsrf: true }
  );

  // `onError` hears the errors every built-in render contains or fails on,
  // streamed or buffered.
  const renderOptions = onError ? { ...documentOptions, onError } : documentOptions;
  const renderRoute = render || defaultRenderRoute(renderOptions);

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
    const csrfHeaders = csrfSetCookie ? { 'set-cookie': csrfSetCookie } : null;

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
      return new Response(html, { status: 404, headers: responseHeaders(HTML_HEADERS, csrfHeaders) });
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
      routeMatch.signal = request.signal;
      const result = await cache.handle(routeMatch, (match, cacheCtx) => renderRoute(match, cacheCtx));
      const status = result.status || 200;
      const headers = responseHeaders(HTML_HEADERS, result.headers, csrfHeaders);
      if (csrfHeaders && /\bpublic\b/i.test(headers.get('cache-control') || '')) headers.set('cache-control', 'private, no-store');
      return new Response(NULL_BODY.has(status) ? null : result.html, { status, headers });
    }

    // Direct render (server mode, or no cache configured): per-request HTML,
    // safe to embed the CSRF token as a <meta> tag for forms/fetch clients.
    if (csrfToken) routeMatch.csrfToken = csrfToken;

    // A server-mode route streams: the shell (and every <Suspense> fallback)
    // goes out as soon as it is rendered and slow data follows. Cached routes
    // above store whole documents, so they keep the buffered render; so does a
    // route with `page.stream: false` or a custom `render`.
    // The response is committed with the shell: a redirect made by then is a
    // real redirect, and the stream is dropped.
    if (!render && config.mode === 'server' && config.stream !== false) {
      const { pageModule, reqCtx, opts, response } = pageRequest(routeMatch, renderOptions);
      const stream = await renderDocumentStream(pageModule, reqCtx, opts);
      await stream.shellReady;
      if (response.location || NULL_BODY.has(response.status)) {
        stream.abort();
        return new Response(null, { status: response.status, headers: responseHeaders(committedHeaders(response), NO_STORE, csrfHeaders) });
      }
      return new Response(stream.readable, {
        status: response.status,
        headers: responseHeaders(HTML_HEADERS, response.headers, NO_STORE, csrfHeaders),
      });
    }

    const out = await renderRoute(routeMatch);
    // `out.headers` is honoured here exactly as it is on the cache path above.
    // It used to be dropped on this branch only, so a custom `render` could set
    // response headers for a cached route and not for an uncached one — which
    // meant a render returning a 302 produced a redirect with no Location, an
    // empty page with nothing to say why. The CSRF cookie is appended after the
    // render's own cookies, so neither can drop the other.
    const headers = responseHeaders(
      HTML_HEADERS,
      out.headers,
      config.mode === 'server' ? NO_STORE : null,
      csrfHeaders,
    );
    const status = out.status || 200;
    return new Response(NULL_BODY.has(status) ? null : out.html, { status, headers });
  };
}
