// What Framework Router - TypeScript Definitions

import { VNode, VNodeChild, Component, Signal, Computed } from './index';

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

/** Redirect (throws to navigate) */
export function redirect(to: string, options?: NavigateOptions): never;

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

// --- Prefetch ---

export function prefetchRoute(href: string): void;

// --- Navigation Hooks ---

export function beforeNavigate(fn: (to: string, from: string) => boolean | Promise<boolean>): () => void;
export function afterNavigate(fn: (to: string, from: string) => void): () => void;

// --- useRoute Hooks ---

export function useRoute(): {
  path: Computed<string>;
  params: Computed<Record<string, string>>;
  query: Computed<Record<string, string>>;
  hash: Computed<string>;
  isNavigating: Computed<boolean>;
};

export function useParams<T extends Record<string, string> = Record<string, string>>(): T;
export function useSearch<T extends Record<string, string> = Record<string, string>>(): T;
export function useNavigate(): typeof navigate;
