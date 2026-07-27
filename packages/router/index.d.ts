// What Framework Router - TypeScript Definitions

import { VNode, VNodeChild, Component, Signal, Computed } from 'what-core';

// --- Route State ---

export interface RouteState {
  /** Current full URL */
  readonly url: string;
  /** Current pathname */
  readonly path: string;
  /** Route parameters */
  readonly params: Record<string, string>;
  /** Query parameters */
  readonly query: Record<string, string>;
  /** URL hash */
  readonly hash: string;
  /** Navigation in progress */
  readonly isNavigating: boolean;
  /** Navigation error if any */
  readonly error: Error | null;
}

export const route: RouteState;

// --- Navigation ---

export interface NavigateOptions {
  /** Replace current history entry */
  replace?: boolean;
  /** History state object */
  state?: any;
  /** Use View Transitions API */
  transition?: boolean;
}

/** Navigate to a new URL */
export function navigate(to: string, options?: NavigateOptions): Promise<void>;

// --- Route Configuration ---

export interface RouteConfig {
  /** URL path pattern */
  path: string;
  /** Page component */
  component: Component<RouteComponentProps>;
  /** Layout wrapper */
  layout?: Component<LayoutProps>;
  /** Loading component */
  loading?: Component<{}>;
  /** Error component */
  error?: Component<{ error: Error }>;
  /** Route middleware */
  middleware?: RouteMiddleware[];
}

export interface RouteComponentProps {
  params: Record<string, string>;
  query: Record<string, string>;
  route: RouteConfig;
}

export interface LayoutProps {
  params: Record<string, string>;
  query: Record<string, string>;
  children?: VNodeChild;
}

export type RouteMiddleware = (props: RouteComponentProps) => boolean | Promise<boolean>;

// --- Router Component ---

export interface RouterProps {
  routes: RouteConfig[];
  fallback?: Component<{}>;
  globalLayout?: Component<{ children?: VNodeChild }>;
}

export function Router(props: RouterProps): VNode;

// --- File-Based Router ---

export interface FileRouteConfig {
  path: string;
  component: Component<RouteComponentProps>;
  layout?: Component<LayoutProps>;
  mode?: 'static' | 'server' | 'client' | 'hybrid';
}

export interface FileRouterProps {
  routes: FileRouteConfig[];
  layout?: Component<{ children?: VNodeChild }>;
  fallback?: Component<{}>;
  error?: Component<{ error: Error }>;
}

/** Router driven by what-compiler's generated route manifest (virtual:what-routes). */
export function FileRouter(props: FileRouterProps): VNode;

// --- Link Component ---

export interface LinkProps {
  href: string;
  class?: string;
  className?: string;
  replace?: boolean;
  prefetch?: boolean;
  activeClass?: string;
  exactActiveClass?: string;
  transition?: boolean;
  children?: VNodeChild;
  [key: string]: any;
}

export function Link(props: LinkProps): VNode;
export function NavLink(props: LinkProps): VNode;

// --- Route Helpers ---

/** Define routes from object config */
export function defineRoutes(config: Record<string, Component | Partial<RouteConfig>>): RouteConfig[];

/** Create nested routes with shared options */
export function nestedRoutes(
  basePath: string,
  children: RouteConfig[],
  options?: { layout?: Component; loading?: Component; error?: Component }
): RouteConfig[];

/** Group routes without affecting URLs */
export function routeGroup(
  name: string,
  routes: RouteConfig[],
  options?: { layout?: Component; middleware?: RouteMiddleware[] }
): RouteConfig[];

// --- Redirect ---

export function Redirect(props: { to: string }): null;

// --- Guards ---

/** Create a route guard */
export function guard(
  check: (props: RouteComponentProps) => boolean,
  fallback: string | Component
): <P>(component: Component<P>) => Component<P>;

/** Create an async route guard */
export function asyncGuard(
  check: (props: RouteComponentProps) => Promise<boolean>,
  options?: { fallback?: string | Component; loading?: Component }
): <P>(component: Component<P>) => Component<P>;

// --- Prefetch ---

export function prefetch(href: string): void;

// --- Scroll Restoration ---

export function enableScrollRestoration(): void;

// --- View Transitions ---

export function viewTransitionName(name: string): { style: { viewTransitionName: string } };
export function setViewTransition(type: string): void;

// --- useRoute Hook ---

export interface UseRouteResult {
  path: Computed<string>;
  params: Computed<Record<string, string>>;
  query: Computed<Record<string, string>>;
  hash: Computed<string>;
  isNavigating: Computed<boolean>;
  navigate: typeof navigate;
  prefetch: typeof prefetch;
}

export function useRoute(): UseRouteResult;

// --- Route Accessors ---

/** Current route params. Subscribes when read inside a tracking scope. */
export function useParams<T = Record<string, string>>(): T;

/**
 * Query string of the last successfully matched route, parsed. Subscribes when
 * read inside a tracking scope. Only the Router's match branch writes it, so on
 * an unmatched (404) route this is the previous route's query, not the current
 * URL's. Same value and same caveat as `route.query`.
 */
export function useSearch<T = Record<string, string>>(): T;

/** The navigate function, for symmetry with useParams/useSearch. */
export function useNavigate(): typeof navigate;

/** Prefetch a route's assets. */
export function prefetchRoute(href: string): void;

// --- Redirect Signal ---

/**
 * Abort route matching and navigate, from inside route middleware.
 *
 * This is a middleware API. It throws a navigation signal, and the Router's
 * matching pass is the only place that signal can be caught: `h()` is lazy, so
 * a route component is instantiated after matching has returned, and the only
 * catch above it is `ErrorBoundary`, which renders error UI rather than
 * navigating. Called anywhere outside matching (a component body, an event
 * handler, a promise callback) it throws `ERR_REDIRECT_OUTSIDE_ROUTER` instead;
 * use `navigate(to)` or render `<Redirect to={...} />` there.
 */
export function redirect(to: string, options?: NavigateOptions): never;

// --- Navigation Hooks ---

/**
 * Run before every route navigation; return false to cancel. Returns an
 * unsubscribe. Not consulted for same-page hash navigation (`navigate('#x')`
 * scrolls, it does not change the route). Cancelling a back/forward navigation
 * restores the address bar by pushing the previous URL as a new history entry:
 * the entry the browser moved to is not recovered and its `history.state` is
 * not carried over.
 */
export function beforeNavigate(fn: (to: string, from: string) => boolean | Promise<boolean>): () => void;

/** Run after every committed navigation. Returns an unsubscribe. */
export function afterNavigate(fn: (to: string, from: string) => void): () => void;

// --- Outlet ---

export function Outlet(props: { children?: VNodeChild }): VNode;

// --- Path Matching ---

export interface CompiledPath {
  regex: RegExp;
  paramNames: string[];
  catchAll: string | null;
}

/** Compile a path pattern (`/users/:id`, `/posts/*`, `/[slug]`) to a matcher. */
export function compilePath(path: string): CompiledPath;

/** Match a pathname against routes, most specific first. */
export function matchRoute<T extends { path?: string }>(
  path: string,
  routes: T[],
): { route: T; params: Record<string, string> } | null;

/** Parse a query string into a null-prototype object. */
export function parseQuery(search: string): Record<string, string>;

/** Reject javascript:, data:, vbscript: and protocol-relative URLs. */
export function isSafeUrl(url: string): boolean;
