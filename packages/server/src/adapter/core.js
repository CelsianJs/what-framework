// Framework-agnostic deploy adapter core. A Web-Fetch handler
// (request) -> Response that powers Node, Vercel and Cloudflare alike:
//   match route -> intercept actions + revalidate webhook -> ISR cache
//   (HIT/STALE/MISS) -> render -> respond with Cache-Control headers.
//
// The cache engine is OPTIONAL and injected (from what-isr) so what-server
// stays standalone. Render is owned here (renderDocument) but overridable.
//
// A cached route and the response API. A render the cache may share sees a
// copy of the request whose `signal` is the cache's (a regeneration is shared
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
import { createActionHandler, createFormPostHandler, parseActionBody, readFetchBodyCapped } from '../action-handler.js';
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
  if (!match) return null;
  // A malformed value (`%E0%A4`, set by a sibling subdomain) is no value: the
  // request gets a fresh one instead of a 500 on every page.
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
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
  // What the action of a form posted to this page without JavaScript
  // returned, for that form (action-handler.js createFormPostHandler).
  if (routeMatch.actionState) reqCtx.actionState = routeMatch.actionState;
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

// What a route's declared `vary` covers: request header names
// ('accept-language', 'header:x-tenant', 'cookie' for the whole Cookie header)
// and cookie names ('cookie:session' names one cookie).
function variedHeaderNames(config) {
  const headers = new Set();
  const cookies = new Set();
  const vary = config && config.vary;
  for (const raw of typeof vary === 'string' ? [vary] : Array.isArray(vary) ? vary : []) {
    const name = String(raw);
    const i = name.indexOf(':');
    const kind = i < 0 ? 'header' : name.slice(0, i).toLowerCase();
    if (kind === 'cookie') cookies.add(name.slice(i + 1));
    else headers.add((i < 0 ? name : name.slice(i + 1)).toLowerCase());
  }
  return { headers, cookies };
}

const ITERATING_METHODS = new Set(['forEach', 'entries', 'keys', 'values', Symbol.iterator]);
const WRITING_METHODS = new Set(['set', 'append', 'delete']);

// The names of the cookies a Cookie header carries.
function cookieNames(header) {
  const names = [];
  for (const part of String(header || '').split(';')) {
    const name = part.split('=')[0].trim();
    if (name) names.push(name);
  }
  return names;
}

// The headers a cache key covers: those the route's `vary` names and, of the
// Cookie header, the cookies it names (the first of a repeated name, as the
// key reads it).
function keyedHeaders(headers, varied) {
  const keyed = new Headers();
  headers.forEach((value, name) => {
    if (varied.headers.has(name)) {
      keyed.append(name, value);
    } else if (name === 'cookie') {
      const kept = new Map();
      for (const part of value.split(';')) {
        const cookie = part.trim();
        const cookieName = cookie.split('=')[0].trim();
        if (varied.cookies.has(cookieName) && !kept.has(cookieName)) kept.set(cookieName, cookie);
      }
      if (kept.size) keyed.set('cookie', [...kept.values()].join('; '));
    }
  });
  return keyed;
}

// `all` (every header the request carried), watched: a read records each
// header name the key does not vary on. A write goes to `own` too, the
// request's own list, so a copy of the request carries what the render set.
function watchedHeaders(all, own, read) {
  return new Proxy(all, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      if (property === 'get' || property === 'has') {
        return (name) => {
          read(target, name);
          return value.call(target, name);
        };
      }
      if (ITERATING_METHODS.has(property)) {
        return (...args) => {
          target.forEach((_value, name) => read(target, name));
          return value.apply(target, args);
        };
      }
      if (typeof property === 'string' && WRITING_METHODS.has(property)) {
        return (...args) => {
          value.apply(target, args);
          own[property](...args);
        };
      }
      return value.bind(target);
    },
  });
}

// A real Request, because native code (`new Request(request)`, `fetch(request)`)
// reads a Request's internal state, which no wrapper can watch. That state is
// made of what the cache key is made of: the URL, the method and the keyed
// headers. Every other read goes through `headers`, which is watched.
class SharedRenderRequest extends Request {
  #all;
  #read;
  #headers;

  constructor(input, init, all, read) {
    super(input, init);
    this.#all = all;
    this.#read = read;
    this.#headers = watchedHeaders(all, super.headers, read);
  }

  get headers() {
    return this.#headers;
  }

  clone() {
    return new SharedRenderRequest(super.clone(), undefined, new Headers(this.#all), this.#read);
  }
}

// The request a shareable render sees, with the cache's signal, and a record
// of what it read that the cache key does not vary on. The Cookie header holds
// every cookie, so reading it counts as reading each cookie the request
// carries: one the route's `vary` does not name makes the render private. A
// copy (`clone()`) is watched the same way. The request used whole
// (`new Request(request)`, `fetch(request)`) carries only the keyed headers, so
// it cannot carry anything the key does not vary on into a shared render.
function sharedRenderRequest(request, signal, varied) {
  /** @type {Set<string>} */
  const unvaried = new Set();
  const read = (target, name) => {
    const lower = String(name).toLowerCase();
    if (lower === 'cookie' && !varied.headers.has('cookie')) {
      for (const cookie of cookieNames(target.get('cookie'))) {
        if (!varied.cookies.has(cookie)) unvaried.add(`cookie:${cookie}`);
      }
    } else if (!varied.headers.has(lower)) {
      unvaried.add(lower);
    }
  };
  const init = { headers: keyedHeaders(request.headers, varied), signal };
  return { request: new SharedRenderRequest(request, init, request.headers, read), unvaried };
}

/**
 * The built-in route renderer createRequestHandler uses: the route's loader
 * and page rendered as a document with `documentOptions`, answering with the
 * status, headers and redirect the loader and the page set on `response`.
 * An ISR engine's `render` (scheduled regeneration) takes it too, so a
 * regenerated page is rendered exactly as a requested one: the engine hands a
 * regeneration with no request of its own a GET request for the path, at the
 * origin of each entry it refreshes (what-isr isr.js).
 */
export function createRouteRenderer(documentOptions = {}) {
  // `cacheCtx` is what the cache engine hands a render it may share; absent on
  // the direct path.
  return async function renderRoute(match0, cacheCtx) {
    // A match with no request (a regeneration a caller started itself) renders
    // as a GET of its path; the ISR engine hands every regeneration one.
    const routeMatch = match0.request ? match0 : { ...match0, request: new Request(new URL(match0.path || '/', 'http://localhost')) };
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
 * CSRF is ON BY DEFAULT:
 *   - POST /__what_action refuses a request the browser marks cross-site
 *     (Sec-Fetch-Site, or an Origin that is not this host) with 403, and
 *     accepts one it marks same-origin. That is how a form on a cached or
 *     streamed page posts: its shared HTML carries no visitor's token.
 *   - A request with neither header (an old browser, a script) must carry the
 *     double-submit token: every HTML response ensures a `what-csrf` cookie
 *     (SameSite=Lax, NOT HttpOnly so the fetch client can echo it in the
 *     X-CSRF-Token header), uncached renders also embed
 *     <meta name="what-csrf-token"> and hand the token to the loader for
 *     hidden form fields, and the endpoint checks the token (X-CSRF-Token
 *     header, or `_csrf` / `what-csrf-token` form field) against the cookie.
 *     A token sent with a same-origin request is checked too.
 *   - `csrf: { trustedOrigins: ['https://other.example'] }` lets another
 *     origin of the same app post.
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
 * A form posted to a page (the <Form> of a useActionState(serverAction)
 * dispatch, without JavaScript) carries `_action`: its action runs under the
 * same rules (createFormPostHandler, with the `csrf` option's checks whatever
 * `actionHandler` is), and the page renders with what it returned for that
 * form, outside the cache (`private, no-store`), or the response is the 303 the
 * action redirected to. A POST to a page without `_action` is answered as
 * before.
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
  const csrfOptions = csrf === false
    ? { skipCsrf: true }
    : {
      getCsrfToken: (reqLike) => readCookie(reqLike.headers && reqLike.headers.cookie, CSRF_COOKIE),
      trustedOrigins: (typeof csrf === 'object' && csrf !== null && csrf.trustedOrigins) || [],
    };
  const actionHandler = options.actionHandler || createActionHandler(autoCsrf ? csrfOptions : { skipCsrf: true });
  const formPostHandler = createFormPostHandler(csrfOptions);

  // `onError` hears the errors every built-in render contains or fails on,
  // streamed or buffered.
  const renderOptions = onError ? { ...documentOptions, onError } : documentOptions;
  const renderRoute = render || createRouteRenderer(renderOptions);

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
        url: request.url,
        request,
      });
      return new Response(out.body, { status: out.status, headers: responseHeaders(out.headers) });
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

    // A form posted to this page without JavaScript: its action runs, and the
    // page renders with what it returned for that form. This render is the
    // visitor's own, never stored or served from the cache. The body is read
    // from a copy, so a POST that is not one (no `_action`) reaches the page
    // with its body unread.
    /** @type {any} */
    let posted = null;
    if (request.method === 'POST' && (request.headers.get('content-type') || '').includes('application/x-www-form-urlencoded')) {
      const read = await readFetchBodyCapped(request.clone());
      if (read.tooLarge) {
        return new Response(JSON.stringify({ message: 'Payload too large' }), {
          status: 413,
          headers: { 'content-type': 'application/json' },
        });
      }
      posted = await formPostHandler({
        method: 'POST',
        headers: headersToObject(request.headers),
        body: parseActionBody(read.raw ?? '', 'application/x-www-form-urlencoded'),
        url: request.url,
        request,
      });
      if (posted !== null && posted.response) {
        const { status, headers, body } = posted.response;
        return new Response(status === 303 ? null : body, { status, headers: responseHeaders(headers, NO_STORE, csrfHeaders) });
      }
      if (posted !== null) routeMatch.actionState = posted.actionState;
    }
    // The action's headers (a cookie it set) go under the page's own; the
    // response is the visitor's own.
    const actionHeaders = posted !== null ? posted.headers : null;

    // ISR cache path (static/hybrid with a cache engine). Server-mode bypasses.
    // NOTE: cached HTML is shared across users, so the per-user CSRF token is
    // NOT embedded in the page here — clients read it from the cookie instead.
    if (cache && config.mode !== 'server' && !posted) {
      // The cache key's path has no trailing slash (what-isr normalizePath):
      // the render a key stores sees the params of that path, not the slash
      // one visitor sent.
      const keyPath = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
      const keyed = keyPath === pathname ? null : matchRoute(keyPath, routes);
      if (keyed && keyed.route === route) {
        routeMatch.path = keyPath;
        routeMatch.params = keyed.params;
      }
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
        return new Response(null, { status: response.status, headers: responseHeaders(actionHeaders, committedHeaders(response), NO_STORE, csrfHeaders) });
      }
      return new Response(stream.readable, {
        status: response.status,
        headers: responseHeaders(HTML_HEADERS, actionHeaders, response.headers, NO_STORE, csrfHeaders),
      });
    }

    const out = await renderRoute(routeMatch);
    // `out.headers` is honoured here exactly as it is on the cache path above.
    // Dropping them on this branch alone would let a custom `render` set
    // response headers for a cached route and not for an uncached one, so a
    // render returning a 302 would produce a redirect with no Location. The CSRF cookie is appended after the
    // render's own cookies, so neither can drop the other.
    const headers = responseHeaders(
      HTML_HEADERS,
      actionHeaders,
      out.headers,
      config.mode === 'server' || posted !== null ? NO_STORE : null,
      csrfHeaders,
    );
    const status = out.status || 200;
    return new Response(NULL_BODY.has(status) ? null : out.html, { status, headers });
  };
}
