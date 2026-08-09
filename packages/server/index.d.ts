// What Framework Server - TypeScript Definitions

import { VNode, VNodeChild, Signal } from 'what-core';

// --- SSR ---

/** Render VNode tree to HTML string */
export function renderToString(vnode: VNode): string;

/** Render VNode tree as async iterator for streaming */
export function renderToStream(vnode: VNode): AsyncGenerator<string>;

export interface RenderRequestContext {
  params?: Record<string, string>;
  query?: Record<string, string>;
  request?: any;
  [key: string]: any;
}

/** Run a page module's loader, then render it. Returns the body, head and loader data. */
export function renderPage(
  pageModule: { default: (props: any) => VNode; loader?: (ctx: RenderRequestContext) => any } | ((props: any) => VNode),
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
  component: (data?: any) => VNode;
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
export function server<P>(component: (props: P) => VNode): (props: P) => VNode;

// --- Islands ---
//
// The island runtime (island, Island, hydrateIslands, createIslandStore, …)
// is exported from the `what-server/islands` subpath, not from this entry.
// See ./islands.d.ts. The shapes below stay here because they describe values
// that cross the SSR boundary and are referenced by root-entry consumers.

export interface IslandOptions {
  /** Hydration mode */
  mode?: 'static' | 'idle' | 'visible' | 'load' | 'media' | 'action';
  /** Media query for 'media' mode */
  media?: string;
  /** Priority (higher = hydrate first) */
  priority?: number;
  /** Shared stores this island uses */
  stores?: string[];
}

export interface IslandStore<T extends Record<string, any>> {
  _signals: Record<keyof T, Signal<any>>;
  _subscribe: (key: keyof T, fn: (value: any) => void) => () => void;
  _batch: (fn: () => void) => void;
  _getSnapshot: () => T;
  _hydrate: (data: Partial<T>) => void;
}

export interface IslandStatus {
  registered: string[];
  hydrated: number;
  pending: number;
  queue: { name: string; priority: number }[];
  stores: string[];
}

// --- Server Actions ---

export interface ActionOptions {
  id?: string;
  onError?: (error: Error) => void;
  onSuccess?: (result: any) => void;
  revalidate?: string[];
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
export function renderToHydratableString(vnode: VNode): string;

/** Render, and return the <head> tags collected during that render alongside the body. */
export function renderToStringWithHead(vnode: VNode): { body: string; head: string };

/**
 * Render, awaiting any suspended resources so their data is resolved in the
 * output. `resources` is the payload the client reuses so it does not refetch.
 */
export function renderToStringAsync(
  vnode: VNode,
  ctx?: unknown,
): Promise<{ body: string; head: string; resources: Record<string, unknown> }>;

export interface DocumentOptions {
  lang?: string;
  head?: string;
  bodyAttrs?: string;
  scripts?: string[];
  styles?: string[];
  [key: string]: any;
}

/**
 * Render a page module to a complete HTML document: runs its loader, renders the
 * component, collects head tags, and inlines the hydration payload.
 */
export function renderDocument(
  pageModule: { default: (props: any) => VNode; loader?: (ctx: RenderRequestContext) => any } | ((props: any) => VNode),
  reqCtx?: RenderRequestContext,
  options?: DocumentOptions,
): Promise<string>;

/** Render a PageConfig to a complete static HTML document. */
export function generateStaticPage(page: PageConfig, data?: any): string;

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

export interface ActionHandlerOptions {
  csrfSecret?: string;
  onError?: (error: unknown) => void;
  [key: string]: any;
}

export function createActionHandler(options?: ActionHandlerOptions): (request: any) => Promise<any>;
export function nodeActionMiddleware(options?: ActionHandlerOptions): (req: any, res: any, next?: () => void) => void;
export function fetchActionHandler(options?: ActionHandlerOptions): (request: Request) => Promise<Response>;

// --- Deploy adapters ---

export interface RequestHandlerOptions {
  routes?: any[];
  documentOptions?: DocumentOptions;
  [key: string]: any;
}

/** Runtime-neutral request handler: Request in, Response out. */
export function createRequestHandler(options?: RequestHandlerOptions): (request: Request, env?: any, ctx?: any) => Promise<Response>;

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
