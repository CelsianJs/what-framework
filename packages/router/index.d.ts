// What Framework Router - TypeScript Definitions

import { VNode, VNodeChild, Component, Signal, Computed } from 'what-core';

// --- Route State ---

/**
 * A parsed query string. A key the URL repeats (`?tag=a&tag=b`) holds every
 * value in order (`['a', 'b']`); a key it has once holds the value.
 */
export type RouteQuery = Record<string, string | string[]>;

/**
 * The route on screen. During a server render, the request being rendered: its
 * URL (with its query and hash), and the params and query its <Router> matched.
 * The URL and path are the app's, without the base (setBase); outside the
 * base both are ''.
 */
export interface RouteState {
  /** Current full URL: path, search and hash, without the base */
  readonly url: string;
  /** Current pathname, without the base */
  readonly path: string;
  /** Route parameters */
  readonly params: Record<string, string>;
  /** Query parameters; a repeated key holds an array of its values */
  readonly query: RouteQuery;
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
  /**
   * History state object. A fragment navigation that replaces the entry
   * (a '#hash' target, `replace`, the URL on screen) keeps the entry's state
   * unless this is given.
   */
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
 * the action (useTransition's isPending shows it). The URL it commits is the
 * one the address bar shows (`/old/../find` commits `/find`). A target that
 * changes only the hash (`#x`, or `/settings#x` on /settings) is a fragment
 * navigation: the page stays mounted, the URL and `route.hash` move and the
 * element scrolls into view, and no guard, middleware or preload runs. A URL
 * of another origin (another site, `mailto:`, `tel:`) is the browser's to
 * load, as a click on a `<Link>` to it is: it calls `location.assign()`
 * (`location.replace()` with `replace: true`) and runs no guard. On a server,
 * where nothing navigates, it redirects the response of the render in
 * progress instead.
 */
export function navigate(to: string, options?: NavigateOptions): Promise<void>;

// --- Base path ---

/**
 * Serve the app below `base`, the path it is deployed at: `'/app'`, `'/app/'`
 * as Vite writes it, or `'app'`, all the same base. A path from the root that
 * the app writes (`'/x'` in a `<Link>`, `navigate()`, `redirect()`, a
 * middleware verdict, the `url` of a `<Router>`) is a URL of the app, which
 * the address bar and a server see below the base (`'/app/x'`); route state
 * (`route.url`, `route.path`, the params, `useRoute()`, active links, what
 * middleware, `preload` and the navigation hooks are given) holds URLs
 * without it. A URL outside the base is not routed: no route shows it, and
 * `navigate()` and `<Link>` leave it to the browser. Without a call, the base
 * is Vite's `base` (`import.meta.env.BASE_URL`) when Vite builds what-router;
 * else, in a render what-server's `createRequestHandler` or `exportStatic`
 * runs, their `basePath`; else none. `''` and `'/'` are no base, nor is one
 * that is not a path (`'./'`, a CDN's URL). Call it before the app renders:
 * in the client when Vite does not build it, and in a custom server that
 * renders with `renderToString`. what-server's actions and `<Form>` use the
 * base it sets too.
 */
export function setBase(base: string): void;

// --- Route Configuration ---

export interface RouteConfig {
  /** URL path pattern */
  path: string;
  /** Page component */
  component: Component<RouteComponentProps>;
  /**
   * The layout around the page, or a list of layouts, outermost first.
   * nestedRoutes and routeGroup put theirs around it. Moving between two
   * routes keeps the layouts their lists share from the outermost down to the
   * first that differs.
   */
  layout?: Component<LayoutProps> | Component<LayoutProps>[];
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
  preload?: (ctx: { params: Record<string, string>; query: RouteQuery; url: string }) => any;
}

/**
 * A route page's props. `TData` types `data`, what the route's `preload`
 * returned: `RouteComponentProps<ReturnType<typeof loadUser>>`. The page is
 * built for its route and its `params`; a change of query alone keeps it
 * mounted, and `query` and `data` are live: JSX that reads `query.page`
 * shows the current URL's, and a read in the body keeps the first value.
 */
export interface RouteComponentProps<TData = any> {
  params: Record<string, string>;
  query: RouteQuery;
  route: RouteConfig;
  /** What the route's `preload` returned, undefined without one. */
  data?: TData;
}

/**
 * A route layout's props. `params` and `query` are live: JSX that reads
 * `params.id` shows the current URL's, while the layout stays mounted.
 */
export interface LayoutProps {
  params: Record<string, string>;
  query: RouteQuery;
  children?: VNodeChild;
}

/**
 * What route middleware is given: the destination's path, params, parsed
 * query and route, and its whole URL (path, search and hash, as the address
 * bar will show it). During a navigation `route` still reads the page being
 * left; this is where the navigation is going.
 */
export interface RouteMiddlewareContext {
  /** The destination's path, without its search or hash. */
  path: string;
  /** The destination's full URL: path + search + hash (`/private?a=1#top`). */
  url: string;
  params: Record<string, string>;
  query: RouteQuery;
  route: RouteConfig;
}

/**
 * Middleware is synchronous: allow with true/void, block with false, or
 * redirect with a path. Use asyncGuard for async checks. It runs before the
 * route's `preload`, which never runs for a route it declines. It runs once
 * for a navigation, whose verdict the page renders by, and again only when a
 * signal it read changes. While a navigation away from its page is in
 * flight, that page keeps its verdict, so writing what a guard reads and then
 * navigating (sign out, then go to sign-in) goes where navigate() asked; the
 * guard's new verdict applies if that navigation does not commit. A fragment navigation (only the hash changes) keeps
 * the page and runs no middleware. On the server, a redirect redirects the
 * render's response.
 */
export type RouteMiddleware = (context: RouteMiddlewareContext) => boolean | string | void;

// --- Router Component ---

export interface RouterProps {
  routes: RouteConfig[];
  fallback?: Component<{}>;
  globalLayout?: Component<{ children?: VNodeChild }>;
  /**
   * The URL a server render shows, a URL of the app (without the base).
   * Without it, a server render shows the URL
   * of the request being rendered (`request` of the render), else "/", or a
   * nested Router its parent's. The client always shows the window's URL. A
   * Router inside another has route state of its own: what it renders reads
   * the params and query it matched.
   */
  url?: string;
}

export function Router(props: RouterProps): VNode;

// --- File-Based Router ---

export interface FileRouteConfig {
  path: string;
  component: Component<RouteComponentProps>;
  /** Every `_layout` of a directory holding the page, outermost first. */
  layout?: Component<LayoutProps> | Component<LayoutProps>[];
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
  /** A path from the root (`'/x'`) is a URL of the app, rendered below the base (setBase); a relative URL or another origin's renders as written. */
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

/**
 * Create nested routes with shared options. `layout` goes around each
 * child's own layout (a nestedRoutes inside this one included); `loading`
 * and `error` apply where a child sets none.
 */
export function nestedRoutes(
  basePath: string,
  children: RouteConfig[],
  options?: { layout?: RouteConfig['layout']; loading?: RouteConfig['loading']; error?: RouteConfig['error'] }
): RouteConfig[];

/** Group routes without affecting URLs. `layout` goes around each route's own layout. */
export function routeGroup(
  name: string,
  routes: RouteConfig[],
  options?: { layout?: RouteConfig['layout']; middleware?: RouteMiddleware[] }
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

/**
 * Prefetch a route's assets: starts downloading the lazy() chunk of the route
 * `href` matches (not one behind middleware), and adds `<link rel="prefetch">`.
 * An href that is no page of the app (another site, a URL outside the base,
 * `javascript:`) is not prefetched, as a `<Link>` to it is not.
 */
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
  query: Computed<RouteQuery>;
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
export function useSearch<T = RouteQuery>(): T;

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
 * `name` is `RouterRedirect`. On the server, thrown from route middleware or
 * from a component body, it redirects the render's response, and thrown from
 * a server action, the response of the action's call (its X-What-Redirect,
 * or a no-JS post's 303), as getResponse().redirect() does.
 */
export function redirect(to: string, options?: NavigateOptions): never;

// --- Navigation Hooks ---

/**
 * Run before every route navigation; return false to cancel. Returns an
 * unsubscribe. Not consulted for a fragment navigation, one that changes only
 * the hash (`navigate('#x')`, `navigate('/settings#x')` on /settings): it
 * scrolls, it does not change the route. Cancelling a back/forward navigation
 * (or a navigation started while one was still preparing) restores the
 * address bar by pushing the URL of the page shown as a new history entry:
 * the entry the browser moved to is not recovered and its `history.state` is
 * not carried over.
 */
export function beforeNavigate(fn: (to: string, from: string) => boolean | Promise<boolean>): () => void;

/** Run after every committed route navigation (not a fragment navigation). Returns an unsubscribe. */
export function afterNavigate(fn: (to: string, from: string) => void): () => void;

// --- Outlet ---

export function Outlet(props: { children?: VNodeChild }): VNode;

// --- Path Matching ---

export interface CompiledPath {
  regex: RegExp;
  paramNames: string[];
  catchAll: string | null;
}

/** Compile a path pattern (`/users/:id`, `/posts/*`, `/docs/*slug`, `/[slug]`, `/[...slug]`) to a matcher. */
export function compilePath(path: string): CompiledPath;

/** Match a pathname against routes, most specific first. A trailing slash is ignored, except on the root. */
export function matchRoute<T extends { path?: string }>(
  path: string,
  routes: T[],
): { route: T; params: Record<string, string> } | null;

/** Parse a query string into a null-prototype object; a repeated key holds an array of its values. */
export function parseQuery(search: string): RouteQuery;

/** Reject javascript:, data:, vbscript: and protocol-relative URLs. */
export function isSafeUrl(url: string): boolean;
