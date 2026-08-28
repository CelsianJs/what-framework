// What Framework Server - TypeScript Definitions

import { VNode, VNodeChild, Signal } from 'what-core';

// --- SSR ---

// Every entry point below takes `VNode<any>`, not `VNode`. The `any` is
// load-bearing, and RouteDefinition.component further down carries the full
// explanation: `VNode<P>` is effectively invariant in P, so `VNode<{ name: string }>`
// (what `h(Greeting, { name: 'Alice' })` returns) is NOT assignable to bare
// `VNode` = `VNode<Record<string, any>>`. Writing `VNode` here made the docs'
// own first SSR example a TS2345 for every strict consumer. `mount`/`hydrate`
// never had the problem because they take `VNodeChild`.

/** Render VNode tree to HTML string */
export function renderToString(vnode: VNode<any>): string;

/** Render VNode tree as async iterator for streaming */
export function renderToStream(vnode: VNode<any>): AsyncGenerator<string>;

export interface RenderRequestContext {
  params?: Record<string, string>;
  query?: Record<string, string>;
  request?: any;
  /**
   * The visitor's per-request CSRF token, on directly-rendered routes only.
   * Return it from the loader to pass into <Form csrfToken> so the no-JS submit
   * survives the double-submit check. A CACHED route never has one: its HTML is
   * shared, so a form there only submits with the client enhancer active.
   */
  csrfToken?: string;
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
  /** Paths to revalidate after the action succeeds. */
  revalidate?: string[];
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

/** Define a server action */
export function action<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  options?: ActionOptions
): (...args: T) => Promise<R>;

/** Create a form action handler */
export function formAction<R>(
  actionFn: (data: Record<string, any>) => Promise<R>,
  options?: {
    onSuccess?: (result: R, form?: HTMLFormElement) => void;
    onError?: (error: Error, form?: HTMLFormElement) => void;
    resetOnSuccess?: boolean;
  }
): (formDataOrEvent: FormData | Event) => Promise<R>;

// --- useAction Hook ---

export interface UseActionResult<T extends any[], R> {
  trigger: (...args: T) => Promise<R>;
  isPending: () => boolean;
  error: () => Error | null;
  data: () => R | null;
  reset: () => void;
}

export function useAction<T extends any[], R>(
  actionFn: (...args: T) => Promise<R>
): UseActionResult<T, R>;

// --- useFormAction Hook ---

export interface UseFormActionResult<R> extends UseActionResult<[FormData], R> {
  handleSubmit: (e: Event) => Promise<R>;
  formRef: { current: HTMLFormElement | null };
}

export function useFormAction<R>(
  actionFn: (data: Record<string, any>) => Promise<R>,
  options?: { resetOnSuccess?: boolean }
): UseFormActionResult<R>;

// --- Optimistic Updates ---

export interface UseOptimisticResult<T, A> {
  value: () => T;
  isPending: () => boolean;
  addOptimistic: (action: A) => void;
  resolve: (action: A) => void;
  rollback: (action: A, realValue: T) => void;
  set: (value: T) => void;
}

export function useOptimistic<T, A>(
  initialValue: T,
  reducer: (currentValue: T, action: A) => T
): UseOptimisticResult<T, A>;

// --- Mutations ---

export interface UseMutationResult<T extends any[], R> {
  mutate: (...args: T) => Promise<R>;
  isPending: () => boolean;
  error: () => Error | null;
  data: () => R | null;
  reset: () => void;
}

export function useMutation<T extends any[], R>(
  mutationFn: (...args: T) => Promise<R>,
  options?: {
    onSuccess?: (result: R, ...args: T) => void;
    onError?: (error: Error, ...args: T) => void;
    onSettled?: (data: R | null, error: Error | null, ...args: T) => void;
  }
): UseMutationResult<T, R>;

// --- Revalidation ---

export function onRevalidate(path: string, callback: () => void): () => void;
export function invalidatePath(path: string): void;

// --- Server Handler ---

export interface ActionResponse {
  status: number;
  body: any;
}

export function handleActionRequest(
  req: any,
  actionId: string,
  args: any[]
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
 * Render, awaiting any suspended resources so their data is resolved in the
 * output. `resources` is the payload the client reuses so it does not refetch.
 */
export function renderToStringAsync(
  vnode: VNode<any>,
  ctx?: unknown,
): Promise<{ body: string; head: string; resources: Record<string, unknown> }>;

// The five keys wrapHtmlDocument reads. `bodyAttrs`, `scripts` and `styles`
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
  /** A server action (from `action()`) or its id. */
  action: ((...args: any[]) => any) | string;
  /** Per-request CSRF token. Required for SSR; read from the page when omitted. */
  csrfToken?: string | null;
  /** Where to send the browser after a no-JS submit. */
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
  /** Mount path, default '/__what_action'. Read by nodeActionMiddleware. */
  basePath?: string;
}

export function createActionHandler(options?: ActionHandlerOptions): (request: any) => Promise<any>;
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
    [key: string]: any;
  };
  [key: string]: any;
}

/** What the adapter passes to (and expects back from) a render function. */
export interface RouteMatchContext {
  path: string;
  query: Record<string, string>;
  params: Record<string, string>;
  config: Record<string, any>;
  route: RouteDefinition;
  request: Request;
  /** Present only on the direct-render path. Cached HTML is shared, so it never carries a per-visitor token. */
  csrfToken?: string;
  varyHeaders?: Record<string, string>;
}

// What a `render` override hands back. Closed, like the options above, so every
// key has to be one the runtime reads: the adapter reads `html` and `status`,
// and when a cache engine is present what-isr's makeEntry reads the whole object
// (see its own declaration of the makeEntry input, which this mirrors).
export interface RenderRouteResult {
  html: string;
  status?: number;
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
  handle(routeMatch: RouteMatchContext, render?: () => any): Promise<{
    html: string;
    status?: number;
    headers?: Record<string, string>;
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
  /** Replace the built-in route renderer. */
  render?: (routeMatch: RouteMatchContext) => RenderRouteResult | Promise<RenderRouteResult>;
  /** Handler for POST /__what_revalidate, e.g. what-isr's createRevalidateWebhook. */
  revalidateWebhook?: (req: { headers: Record<string, string>; body: any }) => Promise<{ status: number; body: any }>;
  /** Document shell options passed to renderDocument. */
  document?: DocumentOptions;
  /** Body for unmatched paths. */
  notFound?: () => string;
  /** Path prefix stripped before matching. */
  basePath?: string;
  /** Double-submit CSRF, on by default. */
  csrf?: boolean;
  /** Take over /__what_action entirely. A custom handler owns its own CSRF policy, so cookie/meta auto-provisioning is skipped. */
  actionHandler?: (reqLike: any) => Promise<{ status: number; headers: Record<string, string>; body: any }>;
}

// Request in, Response out, and nothing else: the handler takes ONE argument.
// It was declared with (request, env, ctx) like a Workers fetch handler, which
// it is not. It can still BE one (createCloudflareHandler wraps it and puts
// env/ctx on the request), and a one-argument function is assignable where a
// three-argument one is expected, so nothing that worked stops working.
/** Runtime-neutral request handler: Request in, Response out. */
export function createRequestHandler(options?: RequestHandlerOptions): (request: Request) => Promise<Response>;

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
