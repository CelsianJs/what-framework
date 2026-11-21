// What Framework Router - TypeScript Definitions

import { VNode, VNodeChild, Component, Signal, Computed } from 'what-core';

// --- Route State ---

/**
 * The route on screen. During a server render, the request being rendered: its
 * URL (with its query and hash), and the params and query its <Router> matched.
 */
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
  /** Use the View Transitions API when the browser has it. Default true. */
  transition?: boolean;
  /**
   * Commit at once instead of as a transition: what the new URL reaches (a
   * layout's data for the new params) shows as it lands rather than in one
   * commit.
   */
  flushSync?: boolean;
}

/**
 * Navigate to a new URL. A navigation is a transition: the beforeNavigate
 * guards run, then the destination is prepared (its lazy() chunk loaded, its
 * `preload` data fetched) while the old page stays, then the URL commits in
 * startTransition, so everything it reaches commits in one flush. A newer
 * navigation supersedes one still preparing. Resolves once the new page is
 * on screen and the data it reads first (beyond `preload`, which it shows
 * pending) has landed; `route.isNavigating` is true until then. Inside a
 * transition's async action it resolves before the commit, which happens with
 * the action (useTransition's isPending shows it).
 */
export function navigate(to: string, options?: NavigateOptions): Promise<void>;

// --- Route Configuration ---

export interface RouteConfig {
  /** URL path pattern */
  path: string;
  /** Page component */
  component: Component<RouteComponentProps>;
  /** Layout wrapper */
  layout?: Component<LayoutProps>;
  /** Shown instead of the page being left while a navigation to this route prepares. Without one, the old page stays. */
  loading?: Component<{}>;
  /** Error component */
  error?: Component<{ error: Error; reset: () => void }>;
  /** Route middleware */
  middleware?: RouteMiddleware[];
  /**
   * The route's data: runs when a navigation prepares the route (and on its
   * first render), and the navigation waits for what it returns (a query(),
   * an async value, a promise, or an array or object of them) before it
   * commits. The page receives it as its `data` prop. Queries it makes are
   * tagged with the route's path, so invalidatePath(path) refetches them. A
   * preload that throws renders the route's `error` (or the nearest error
   * boundary) with what it threw. On the server it runs for the render.
   */
  preload?: (ctx: { params: Record<string, string>; query: Record<string, string>; url: string }) => any;
}

export interface RouteComponentProps {
  params: Record<string, string>;
  query: Record<string, string>;
  route: RouteConfig;
  /** What the route's `preload` returned, undefined without one. */
  data?: any;
}

export interface LayoutProps {
  params: Record<string, string>;
  query: Record<string, string>;
  children?: VNodeChild;
}

/**
 * Middleware is synchronous: allow with true/void, block with false, or
 * redirect with a path. Use asyncGuard for async checks. It runs before the
 * route's `preload`, which never runs for a route it declines, and may run more
 * than once for one navigation. On the server, a redirect redirects the
 * render's response.
 */
export type RouteMiddleware = (props: RouteComponentProps & { path: string }) => boolean | string | void;

// --- Router Component ---

export interface RouterProps {
  routes: RouteConfig[];
  fallback?: Component<{}>;
  globalLayout?: Component<{ children?: VNodeChild }>;
  /**
   * The URL a server render shows. Without it, a server render shows the URL
   * of the request being rendered (`request` of the render), else "/". The
   * client always shows the window's URL.
   */
  url?: string;
}

export function Router(props: RouterProps): VNode;

// --- File-Based Router ---

export interface FileRouteConfig {
  path: string;
  component: Component<RouteComponentProps>;
  layout?: Component<LayoutProps>;
  mode?: 'static' | 'server' | 'client' | 'hybrid';
  preload?: RouteConfig['preload'];
}

export interface FileRouterProps {
  routes: FileRouteConfig[];
  layout?: Component<{ children?: VNodeChild }>;
  fallback?: Component<{}>;
  error?: Component<{ error: Error; reset: () => void }>;
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

/** Current route params. Subscribes when read inside a tracking scope. During a server render, the params the render's own <Router> matched. */
export function useParams<T = Record<string, string>>(): T;

/**
 * Query string of the last successfully matched route, parsed. Subscribes when
 * read inside a tracking scope. Only the Router's match branch writes it, so on
 * an unmatched (404) route this is the previous route's query, not the current
 * URL's. Same value and same caveat as `route.query`. During a server render,
 * the query the render's own <Router> matched.
 */
export function useSearch<T = Record<string, string>>(): T;

/** The navigate function, for symmetry with useParams/useSearch. */
export function useNavigate(): typeof navigate;

/** Prefetch a route's assets. */
export function prefetchRoute(href: string): void;

// --- Redirect Signal ---

/**
 * Abort the current render and navigate.
 *
 * Throws a navigation signal. Two places catch it: route middleware, caught by
 * the Router's matching pass, and a component body, caught by the runtime where
 * it instantiates components. Anywhere else (an event handler, a promise
 * callback, a timer, or a reactive thunk such as `{() => cond() && redirect(to)}`)
 * nothing catches it and the signal surfaces as an uncaught error carrying
 * `ERR_REDIRECT_NOT_CAUGHT`; call `navigate(to)` there instead. In a thunk the
 * first render reports the error, but on a later re-run the navigation simply
 * does not happen and the stale DOM stays, so prefer `navigate(to)` there.
 * A `try/catch` around the call also swallows it, so rethrow anything whose
 * `name` is `RouterRedirect`. On the server, thrown from route middleware it
 * redirects the render's response (getResponse().redirect); from a component
 * body it escapes `renderToString` to its caller: read `.to` and emit a 302.
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
