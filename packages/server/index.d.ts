// What Framework Server - TypeScript Definitions

import { VNode, VNodeChild, Signal, ServerResponse, ServerContext } from 'what-core';

// --- SSR ---

// Every entry point below takes `VNode<any>`, not `VNode`. The `any` is
// load-bearing, and RouteDefinition.component further down carries the full
// explanation: `VNode<P>` is effectively invariant in P, so `VNode<{ name: string }>`
// (what `h(Greeting, { name: 'Alice' })` returns) is NOT assignable to bare
// `VNode` = `VNode<Record<string, any>>`. Writing `VNode` here made the docs'
// own first SSR example a TS2345 for every strict consumer. `mount`/`hydrate`
// never had the problem because they take `VNodeChild`.

/** Render VNode tree to HTML string */
/**
 * Render a tree to HTML, synchronously. `options.response` is what
 * getResponse() returns to its components: read the status, headers and
 * redirect they set from it afterwards.
 */
export function renderToString(vnode: VNode<any>, options?: { response?: RenderResponse }): string;

export interface StreamErrorInfo {
  /**
   * 'render': a component failed and was replaced by an error comment.
   * 'boundary': an <ErrorBoundary> rendered its fallback, or a streamed
   *   <Suspense> could not finish and keeps its fallback for the client.
   * 'shell': the page could not render; the stream fails.
   * 'stream': a fatal error after the shell went out; the stream fails.
   */
  phase: 'render' | 'boundary' | 'shell' | 'stream';
  /** The streamed boundary the error belongs to, when there is one. */
  boundaryId?: string;
}

export interface StreamOptions {
  /** What useLoaderData() returns during this render. */
  loaderData?: unknown;
  /** Handed to server resource fetchers as `{ request }`. */
  request?: Request;
  /** What getResponse() returns during this render (a createResponse()); also `stream.response`. */
  response?: RenderResponse;
  /** Aborting it stops the render, its fetchers' signals, and ends the stream. */
  signal?: AbortSignal;
  /** Set on every <script> the stream writes, for a nonce-based CSP. */
  nonce?: string;
  /**
   * Write no inline scripts. Streamed boundaries still arrive as templates; the
   * client entry calls what-core's applyStreamedBoundaries() to show them.
   */
  noScripts?: boolean;
  /** Called for every error the render contains or fails on. Default: console.error. Never silent. */
  onError?: (error: unknown, info: StreamErrorInfo) => void;
  /**
   * Prefix for streamed boundary ids (default 'wb'): a letter, then letters,
   * digits, '_' or '-'; anything else throws ERR_SSR_INVALID_ID_PREFIX. Every
   * stream adds a random part after it, so page markup cannot name a boundary.
   */
  idPrefix?: string;
}

/**
 * A streaming render. Consume it exactly once: `pipe` it into a Node writable,
 * read `readable` (a WHATWG stream of UTF-8 bytes), or iterate it for string
 * chunks. It is deliberately not a promise: awaiting it would buffer the whole
 * page; use renderDocument or renderToStringAsync for a settled string.
 */
export interface RenderStream extends AsyncIterable<string> {
  /** Resolves when the shell has been rendered (status and headers are final); rejects if it could not render or the render was aborted first. */
  readonly shellReady: Promise<void>;
  /** Resolves when the last streamed boundary has been sent; rejects with the reason when the render fails or is aborted before then. */
  readonly allReady: Promise<void>;
  /** The response the render's components set through getResponse(): status, headers, redirect. Final once `shellReady` resolves. */
  readonly response: RenderResponse;
  /** Write to a Node writable, honouring backpressure. Ends it when done; destroying it aborts the render. */
  pipe<W extends { write(chunk: string): boolean; end(): void; on(event: string, fn: (...args: any[]) => void): any; off(event: string, fn: (...args: any[]) => void): any; destroy(error?: Error): void; destroyed?: boolean }>(writable: W): W;
  /** A pull-based ReadableStream for Fetch-style hosts. Cancelling it aborts the render. */
  readonly readable: ReadableStream<Uint8Array>;
  /**
   * Stop rendering and end the stream. The render's signal (its loader's and
   * fetchers') aborts too. After the shell, the document's closing tags are
   * written and boundaries still pending keep their fallbacks.
   */
  abort(reason?: unknown): void;
}

/**
 * Render a vnode tree as HTML, shell first: everything outside a waiting
 * <Suspense> goes out at once with the fallbacks in place, and each boundary
 * follows as a <template> plus a swap script when its data is ready.
 */
export function renderToStream(vnode: VNode<any>, options?: StreamOptions): RenderStream;

/**
 * renderDocument, streamed: runs the loader, then streams the whole document
 * shell-first. Resolves once the loader has run.
 */
export function renderDocumentStream(
  pageModule: { default: (props: any) => VNode<any>; loader?: (ctx: RenderRequestContext) => any } | ((props: any) => VNode<any>),
  reqCtx?: RenderRequestContext,
  options?: DocumentOptions & Omit<StreamOptions, 'loaderData' | 'request' | 'signal'>,
): Promise<RenderStream>;

/**
 * Install the async context provider (AsyncLocalStorage) when the host has
 * one. Every render entry point calls it; call it yourself only from a custom
 * renderer built on what-core's server context.
 */
export function ensureServerRuntime(): void;

/** The response a server render answers with. Loaders receive one; components use what-core's getResponse(). */
export type RenderResponse = ServerResponse & { readonly headers: Headers };

/**
 * A fresh response object, for a custom server that calls renderDocument,
 * renderPage or renderDocumentStream itself: pass it as `reqCtx.response` and
 * read its status, headers and redirect afterwards (after `shellReady` when
 * streaming).
 */
export function createResponse(): RenderResponse;

export interface RenderRequestContext {
  params?: Record<string, string>;
  query?: Record<string, string>;
  request?: any;
  /** Aborts when the client goes away. The deploy adapters pass the request's signal. */
  signal?: AbortSignal;
  /**
   * The response this render answers with: status, headers, redirect. Loaders
   * always receive one; pass your own to renderDocument/renderPage to read it
   * back afterwards. Components reach the same object with getResponse().
   */
  response?: RenderResponse;
  /**
   * The visitor's per-request CSRF token, on directly-rendered routes only.
   * Return it from the loader to pass into <Form csrfToken> so the no-JS submit
   * survives the double-submit check. A CACHED route never has one: its HTML is
   * shared, so a form there only submits with the client enhancer active.
   */
  csrfToken?: string;
  /**
   * What the action of a form posted to this page without JavaScript returned,
   * for that form: `useActionState(action)` whose key is `key` starts from
   * `state`, here and in the hydration; every other one keeps its initial
   * state. createRequestHandler sets it; a custom server passes what
   * createFormPostHandler resolved to. The state is the action's answer to the
   * visitor's own fields: show it, trust it for nothing. The loader does not
   * receive it.
   */
  actionState?: FormActionState;
  [key: string]: any;
}

/** Run a page module's loader, then render it. Returns the body, head and loader data. */
export function renderPage(
  pageModule: { default: (props: any) => VNode<any>; loader?: (ctx: RenderRequestContext) => any } | ((props: any) => VNode<any>),
  reqCtx?: RenderRequestContext,
): Promise<{ body: string; head: string; loaderData: any }>;

// --- Page Configuration ---

export interface PageConfig {
  /** Rendering mode */
  mode?: 'static' | 'server' | 'client' | 'hybrid';
  /** Page title */
  title?: string;
  /** Meta tags */
  meta?: Record<string, string>;
  /** Page component */
  component: (data?: any) => VNode<any>;
  /** Islands to hydrate */
  islands?: string[];
  /** Scripts to load */
  scripts?: string[];
  /** Stylesheets to load */
  styles?: string[];
}

export function definePage(config: Partial<PageConfig>): PageConfig;

/** Generate static HTML for a page */
export function generateStaticPage(page: PageConfig, data?: any): string;

/** Mark component as server-only (no client JS) */
export function server<P>(component: (props: P) => VNode<any>): (props: P) => VNode<any>;

// --- Islands ---
//
// The island runtime (island, Island, hydrateIslands, createIslandStore, …)
// is exported from the `what-server/islands` subpath, not from this entry.
// See ./islands.d.ts. The shapes are re-exported here because they describe
// values that cross the SSR boundary and are referenced by root-entry consumers.

// One definition each, owned by ./islands. Re-exporting rather than
// redeclaring is what keeps `export * from 'what-server'` and
// `export * from 'what-server/islands'` in the same file from colliding, which
// is exactly the ambiguity what-framework/server hits.
export type { IslandOptions, IslandStore, IslandStatus } from './islands.js';

// --- Server Actions ---

export interface ActionOptions {
  /** Stable id shared by the client and server bundles. The compiler emits one; pass it by hand only for uncompiled builds. */
  id?: string;
  onError?: (error: Error) => void;
  onSuccess?: (result: any) => void;
  /**
   * Paths to revalidate after the action succeeds: on the server their cached
   * pages are purged; on the client invalidatePath(path) refetches the
   * queries and route data read on them, inside the action's transition.
   */
  revalidate?: string[];
  /** Query keys to invalidate on the client after the action succeeds (prefixes, as invalidateQueries reads them), inside its transition. */
  invalidates?: ReadonlyArray<string | readonly unknown[]>;
  /**
   * Cache tags to purge after the action succeeds (handleActionRequest reads
   * these off the registered action). The only way to purge by tag from an
   * action declaration, so leaving it undeclared made the documented call a
   * compile error.
   */
  revalidateTags?: string[];
  /** Client-side fetch timeout in ms. Default 30000. */
  timeout?: number;
}

/**
 * Define a server action: an async function or a plain one, whose value or
 * throw the endpoint answers with either way. On the server it is the
 * function itself (await its result: a plain function's comes back as is);
 * on the client, calling it posts to the action endpoint as a transition (it
 * joins one already running) and revalidates what the options name inside it.
 * Resolves with the action's result once the refetches have landed.
 */
export function action<T extends any[], R>(
  fn: (...args: T) => R | Promise<R>,
  options?: ActionOptions
): ((...args: T) => Promise<R>) & { _actionId: string; _isAction: true };

// --- Optimistic Updates ---

/** what-core's useOptimistic (React 19's shape), re-exported for server-action code. */
export { useOptimistic } from 'what-core';

// --- Revalidation ---

/** what-core/data's: call `callback` whenever invalidatePath(path) runs. */
export { onRevalidate, invalidatePath } from 'what-core/data';

// --- Server Handler ---

export interface ActionResponse {
  status: number;
  body: any;
}

/**
 * Run the registered action `actionId` with `args`. It fails closed: without
 * `csrfToken` (the session's token, compared with the request's
 * `x-csrf-token` header) it answers 500, unless `skipCsrf` opts out.
 */
export function handleActionRequest(
  req: any,
  actionId: string,
  args: any[],
  options?: { csrfToken?: string; skipCsrf?: boolean }
): Promise<ActionResponse>;

export function getRegisteredActions(): string[];

// --- Additional SSR entry points ---

/**
 * Render with hydration markers (data-hk attributes and comment boundaries) so
 * the client can adopt the server DOM instead of recreating it.
 */
export function renderToHydratableString(vnode: VNode<any>): string;

/** Render, and return the <head> tags collected during that render alongside the body. */
export function renderToStringWithHead(vnode: VNode<any>): { body: string; head: string };

/**
 * The request being answered: inside a server render, a page's loader, or a
 * server action the built-in endpoints run (createRequestHandler,
 * nodeActionMiddleware, fetchActionHandler, createActionHandler). Null anywhere
 * else. A server action is a public endpoint: read its caller's cookies and
 * headers here to decide whether it may run.
 */
export function getRequest(): Request | null;

/** What renderToStringAsync renders with. Any other field, or a value of the wrong kind, rejects with a TypeError. */
export interface RenderInit {
  /** The page's loader data, which useLoaderData() reads. */
  loaderData?: unknown;
  /** Aborts the render. */
  signal?: AbortSignal;
  /** The request being answered: its signal aborts the render too. */
  request?: Request;
  /** The response the components set status, headers and a redirect on (createResponse()). */
  response?: RenderResponse;
}

/**
 * Render, awaiting any suspended resources so their data is resolved in the
 * output. `resources` (keyed resources) and `owned` (keyless ones, by owner
 * key) are the payload the client reuses so it does not refetch.
 */
export function renderToStringAsync(
  vnode: VNode<any>,
  init?: RenderInit | null,
  options?: { onError?: (error: unknown, info: StreamErrorInfo) => void },
): Promise<{
  body: string;
  head: string;
  loaderData: unknown;
  resources: Record<string, unknown>;
  owned: Record<string, unknown>;
  ctx: ServerContext;
  /** The status, headers and redirect the components set (getResponse()). */
  response: RenderResponse;
}>;

// The six keys wrapHtmlDocument reads. `bodyAttrs`, `scripts` and `styles`
// were declared here and read by nothing: `styles: ['/app.css']` typechecked,
// shipped, and produced a page with no stylesheet and no error. (PageConfig's
// scripts/styles are real; these were not.)
export interface DocumentOptions {
  /** <html lang>, default 'en'. */
  lang?: string;
  /** Raw markup appended to <head>. */
  head?: string;
  /** class attribute for <body>. */
  bodyClass?: string;
  /** Module script src for the hydration entry. */
  clientEntry?: string;
  /** Per-request CSRF token, inlined as <meta name="what-csrf-token">. The deploy adapter supplies this. */
  csrfToken?: string;
  /** Set on the document's scripts, for a nonce-based CSP. */
  nonce?: string;
  /** Called for every error the render contains or fails on. Default: console.error. */
  onError?: (error: unknown, info: StreamErrorInfo) => void;
}

/**
 * Render a page module to a complete HTML document: runs its loader, renders the
 * component, collects head tags, and inlines the hydration payload.
 */
export function renderDocument(
  pageModule: { default: (props: any) => VNode<any>; loader?: (ctx: RenderRequestContext) => any } | ((props: any) => VNode<any>),
  reqCtx?: RenderRequestContext,
  options?: DocumentOptions,
): Promise<string>;

// --- <Form> ---
// A real <form method="post"> that posts to the action endpoint, so it submits
// with JavaScript disabled and is enhanced to a fetch when JS is present.

export interface FormProps {
  /**
   * A server action (from `action()`) or its id, or a client function such as
   * useActionState's dispatch. Without JavaScript a server action's form posts
   * to the action endpoint; a dispatch's posts to its `permalink`, by default
   * the page it is on, where useActionState(serverAction) gets the result back
   * for this form alone. A client function's dispatch receives the FormData.
   */
  action: ((...args: any[]) => any) | string;
  /**
   * The visitor's CSRF token, when the page knows it (an uncached route's
   * loader gets `ctx.csrfToken`). Optional: the endpoint accepts a post the
   * browser marks same-origin, which is how a form on a cached page posts.
   */
  csrfToken?: string | null;
  /**
   * A server action's form: where the endpoint sends the browser after a no-JS
   * submit (303), by default back to the page the form is on. A mounted form
   * stays put. A useActionState dispatch's form does not read it: its page
   * renders the result, and the action redirects with getResponse().redirect().
   */
  redirect?: string;
  method?: string;
  /** Set false to leave a plain HTML form the client enhancer ignores. */
  enhance?: boolean;
  children?: VNodeChild;
  [attr: string]: any;
}

export function Form(props: FormProps): VNode;

/** The endpoint server actions post to. */
export const ACTION_ENDPOINT: string;

// --- CSRF ---

/** Generate a CSRF token. Call once per session/request. */
export function generateCsrfToken(): string;

/** Constant-time comparison of a request token against the session token. */
export function validateCsrfToken(requestToken: string | null | undefined, sessionToken: string | null | undefined): boolean;

/** The `<meta name="what-csrf-token">` tag to inline into the document head. */
export function csrfMetaTag(token: string): string;

// --- Action handlers ---
// Runtime-neutral core, plus the two host bindings.

// The three options createActionHandler reads, and only those. `csrfSecret` and
// `onError` were declared here and read by nothing: an `onError` handler that
// is never called is worse than no handler, so the open index signature that
// hid the mismatch is gone too.
export interface ActionHandlerOptions {
  /** Resolve the session's CSRF token for a request (sync or async). Omit together with `skipCsrf: true`. */
  getCsrfToken?: (reqLike: any) => string | null | undefined | Promise<string | null | undefined>;
  /** Opt out of CSRF validation (e.g. a token-authed API behind another gateway). */
  skipCsrf?: boolean;
  /** Other origins whose pages may post here ("https://app.example"); the browser's Origin must be one of them or this host. */
  trustedOrigins?: string[];
  /** Mount path, default '/__what_action'. Read by nodeActionMiddleware. */
  basePath?: string;
  /** The most bytes a request body may hold, default 1048576 (1 MB): a larger one is answered 413 (an HTML page for a browser's form post, JSON for an action call or anything else). Read by nodeActionMiddleware, fetchActionHandler and createFormPostHandler (when it reads `request` itself); a server that reads the body itself sets its own limit. A multipart/form-data body's fields and files are all within it. */
  bodyLimit?: number;
}

export function createActionHandler(options?: ActionHandlerOptions): (request: any) => Promise<any>;

/** What a form posted to a page returned, for the useActionState that rendered it. */
export interface FormActionState {
  /** The server action's id. */
  action: string;
  /** The key of the useActionState whose form was posted (its `_actionKey` field), or null when it carried none. */
  key: string | null;
  /** What the action returned. */
  state: unknown;
}

/** What createFormPostHandler resolves to for a post it runs. */
export type FormPostOutcome =
  /** A refusal (403, 400), the action's failure (404, 500), or its redirect (303): send it as it is. */
  | { response: { status: number; headers: Record<string, string | string[]>; body: string } }
  /** Render the page with `actionState` in its request context, and these headers (the action's) on the response, `cache-control: private, no-store`. */
  | { actionState: FormActionState; headers: Record<string, string | string[]> };

/**
 * Run a form posted to a page without JavaScript (the <Form> of a
 * useActionState(serverAction) dispatch posts to its page), by the action
 * endpoint's rules: the same options and checks. `request.body` is the posted
 * fields as an object (a name posted more than once as an array, a file as a
 * Web `File`), `url` the absolute URL. Leave `body` out and pass `request` (the
 * Web Request) to have the handler read an urlencoded or multipart/form-data
 * body itself, from a copy, up to `bodyLimit`. Resolves to null for a post with
 * no `_action`, which the page answers as before. createRequestHandler does
 * this itself; a custom server calls it before rendering the page.
 */
export function createFormPostHandler(options?: ActionHandlerOptions): (request: { method?: string; headers: any; body?: Record<string, any>; url: string; request?: Request }) => Promise<FormPostOutcome | null>;
export function nodeActionMiddleware(options?: ActionHandlerOptions): (req: any, res: any, next?: () => void) => void;
export function fetchActionHandler(options?: ActionHandlerOptions): (request: Request) => Promise<Response>;

// --- Deploy adapters ---

/**
 * A route the adapter can match and render. Open on purpose: routes carry
 * app-specific metadata (titles, guards, nested children) the adapter ignores.
 */
export interface RouteDefinition {
  path: string;
  /**
   * The page component. The `any` in `VNode<any>` is load-bearing, NOT laziness:
   * `VNode<P>` carries P through `tag: string | Component<P>`, and `Component<P>`
   * is contravariant in its props under strictFunctionTypes, so `VNode<P>` is
   * effectively invariant. `h('div', { class: 'x' })` returns
   * `VNode<{ class: string }>`, which is therefore NOT assignable to bare
   * `VNode` (= `VNode<Record<string, any>>`). Writing `VNode` here made every
   * route component built with h() and any props at all a TS2322, including the
   * `h(Form, { csrfToken: loaderData.token })` page the csrfToken plumbing above
   * exists to make writable. Only `() => null` and `h('div', {})` survived it.
   */
  component: (props: any) => VNode<any> | null;
  /** Runs per request before the component. Receives `csrfToken` on directly-rendered (uncached) routes. */
  loader?: (ctx: RenderRequestContext) => any;
  mode?: 'static' | 'server' | 'client' | 'hybrid';
  /** The route's cache config. Mirrors what-isr's PageCacheConfig structurally so what-server keeps working without what-isr installed. */
  page?: {
    mode?: 'static' | 'server' | 'client' | 'hybrid';
    revalidate?: number;
    swr?: number;
    tags?: string[];
    vary?: string[] | string;
    /** A server-mode route streams its document shell-first unless this is false. */
    stream?: boolean;
    [key: string]: any;
  };
  [key: string]: any;
}

/** What the adapter passes to (and expects back from) a render function. */
export interface RouteMatchContext {
  path: string;
  query: Record<string, string | string[]>;
  params: Record<string, string>;
  config: Record<string, any>;
  route: RouteDefinition;
  request: Request;
  /** Present only on the direct-render path. Cached HTML is shared, so it never carries a per-visitor token. */
  csrfToken?: string;
  varyHeaders?: Record<string, string>;
  /** On the cache path: the request's signal, which the cache engine watches while the request waits. */
  signal?: AbortSignal;
}

/** What the cache engine hands a render it may share between visitors. */
export interface CacheRenderContext {
  /** Aborts only when every request waiting on this render has gone; never for a background refresh. */
  signal?: AbortSignal;
}

// What a `render` override hands back. Closed, like the options above, so every
// key has to be one the runtime reads: the adapter reads `html` and `status`,
// and when a cache engine is present what-isr's makeEntry reads the whole object
// (see its own declaration of the makeEntry input, which this mirrors).
export interface RenderRouteResult {
  html: string;
  status?: number;
  /**
   * The response headers (Location for a redirect, cookies, the page's own).
   * On the cache path a Set-Cookie, a private/no-store/no-cache Cache-Control
   * or a Vary keeps the render out of the cache; the rest are stored with it.
   */
  headers?: Headers | Record<string, string | string[]>;
  tags?: string[];
  path?: string;
  head?: string;
  state?: unknown;
  /**
   * Keep this render out of the shared cache. what-isr stores an entry only when
   * `status === 200 && !private`, and buildCacheHeaders strips the public
   * directives from it. Leaving it off this interface made the one switch that
   * stops a per-visitor page being served to every visitor a compile error,
   * which is the same shape of hazard as baking a per-visitor CSRF token into
   * cached HTML.
   */
  private?: boolean;
  /** The render read request headers, so it is per-user: makeEntry folds this into `private`. */
  usedRequestHeaders?: boolean;
  /** A partial render (skeleton or streamed shell). buildCacheHeaders forces its s-maxage to 0. */
  partial?: boolean;
}

/**
 * The subset of what-isr's CacheEngine the adapter touches. Structural so
 * what-server never has to import what-isr (an optional peer).
 */
export interface CacheEngineLike {
  handle(routeMatch: RouteMatchContext, render?: (routeMatch: any, ctx?: CacheRenderContext) => any): Promise<{
    html: string;
    status?: number;
    /** `set-cookie` may be an array: a render made for this request keeps its cookies. */
    headers?: Record<string, string | string[]>;
  }>;
  revalidatePath?: (path: string, options?: any) => any;
  revalidateTag?: (tag: string, options?: any) => any;
}

// Every key here is destructured by createRequestHandler. There is no index
// signature: an option the adapter does not read is dead config, and
// `documentOptions` (declared here, never read, the real key is `document`)
// silently rendered every page without the caller's document options.
export interface RequestHandlerOptions {
  routes?: RouteDefinition[];
  /** ISR engine. Omit for no caching. */
  cache?: CacheEngineLike;
  /** Replace the built-in route renderer. On the cache path it also receives the cache's context. */
  render?: (routeMatch: RouteMatchContext, cacheCtx?: CacheRenderContext) => RenderRouteResult | Promise<RenderRouteResult>;
  /** Handler for POST /__what_revalidate, e.g. what-isr's createRevalidateWebhook. */
  revalidateWebhook?: (req: { headers: Record<string, string>; body: any }) => Promise<{ status: number; body: any }>;
  /** Document shell options passed to renderDocument. */
  document?: DocumentOptions;
  /** Body for unmatched paths. */
  notFound?: () => string;
  /** Path prefix stripped before matching. */
  basePath?: string;
  /**
   * CSRF protection, on by default: a post the browser marks cross-site
   * (Sec-Fetch-Site / Origin) is refused, one it marks same-origin accepted
   * (forms on cached pages), and one with neither header needs the
   * double-submit token. `false` turns it off; `trustedOrigins` lets other
   * origins of the app post.
   */
  csrf?: boolean | { trustedOrigins?: string[] };
  /** Take over /__what_action entirely. A custom handler owns its own CSRF policy, so cookie/meta auto-provisioning is skipped. */
  actionHandler?: (reqLike: any) => Promise<{ status: number; headers: Record<string, string>; body: any }>;
  /** Hears every error a built-in route render (streamed or buffered) contains or fails on. Default: console.error. */
  onError?: (error: unknown, info: StreamErrorInfo) => void;
  /** The most bytes a request body may hold (an action call, a form posted to a page, the revalidate webhook), default 1048576 (1 MB), the Node adapter's read included: a larger one is answered 413, an HTML page for a browser's form post (urlencoded or multipart, or a request that accepts HTML), JSON otherwise. A multipart/form-data body's fields and files are all within it. */
  bodyLimit?: number;
}

// Request in, Response out, and nothing else: the handler takes ONE argument.
// It was declared with (request, env, ctx) like a Workers fetch handler, which
// it is not. It can still BE one (createCloudflareHandler wraps it and puts
// env/ctx on the request), and a one-argument function is assignable where a
// three-argument one is expected, so nothing that worked stops working.
/** Runtime-neutral request handler: Request in, Response out. */
export function createRequestHandler(options?: RequestHandlerOptions): (request: Request) => Promise<Response>;

/**
 * The built-in route renderer createRequestHandler uses: the route's loader and page rendered
 * as a document, answering with the status, headers and redirect they set on `response`. Hand it
 * to an ISR engine's `render` so scheduled regeneration renders a page as a request does.
 */
export function createRouteRenderer(documentOptions?: DocumentOptions): (routeMatch: RouteMatchContext, cacheCtx?: CacheRenderContext) => Promise<RenderRouteResult>;

/** Cloudflare Workers entry wrapping createRequestHandler. */
export function createCloudflareHandler(options?: RequestHandlerOptions): { fetch: (request: Request, env?: any, ctx?: any) => Promise<Response> };

// --- Revalidation registry ---
// App code calls revalidatePath/revalidateTag; the deploy adapter binds a
// what-isr engine through setRevalidationHandler.

export interface RevalidationHandler {
  revalidatePath?: (path: string, options?: any) => any;
  revalidateTag?: (tag: string, options?: any) => any;
}

export function setRevalidationHandler(handler: RevalidationHandler | null): void;
export function getRevalidationHandler(): RevalidationHandler | null;
export function revalidatePath(path: string, options?: any): Promise<any>;
export function revalidateTag(tag: string, options?: any): Promise<any>;

// --- Serialization ---

/** Serialize a value for safe inlining into a <script> tag (escapes `</script`). */
export function serializeState(value: unknown): string;
