// What Framework Server - TypeScript Definitions

import { VNode, VNodeChild, Signal } from './index';

// --- SSR ---

/** Render VNode tree to HTML string */
export function renderToString(vnode: VNode): string;

/** Render VNode tree as async iterator for streaming */
export function renderToStream(vnode: VNode): AsyncGenerator<string>;

/** Render a full page with document wrapper */
export function renderPage(vnode: VNode, options?: {
  title?: string;
  meta?: Record<string, string>;
  scripts?: string[];
  styles?: string[];
  mode?: 'static' | 'server' | 'client' | 'hybrid';
}): string;

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

// --- Islands ---

export type IslandMode = 'static' | 'idle' | 'visible' | 'load' | 'media' | 'action';

export const IslandModes: {
  STATIC: 'static';
  IDLE: 'idle';
  VISIBLE: 'visible';
  LOAD: 'load';
  MEDIA: 'media';
  ACTION: 'action';
};

export interface IslandOptions {
  /** Hydration mode */
  mode?: IslandMode;
  /** Media query for 'media' mode */
  media?: string;
  /** Priority (higher = hydrate first) */
  priority?: number;
  /** Shared stores this island uses */
  stores?: string[];
}

/** Register an island component */
export function island(
  name: string,
  loader: () => Promise<any>,
  options?: IslandOptions
): void;

/** Island component wrapper for SSR */
export function Island(props: {
  name: string;
  props?: Record<string, any>;
  mode?: IslandMode;
  priority?: number;
  stores?: string[];
  children?: VNodeChild;
}): VNode;

/** Hydrate all islands on the page */
export function hydrateIslands(): void;

// --- Server Actions ---

export interface ActionOptions {
  id?: string;
  onError?: (error: Error) => void;
  onSuccess?: (result: any) => void;
  revalidate?: string[];
}

/** Create a server action */
export function createAction<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  options?: ActionOptions
): (...args: T) => Promise<R>;

/** Hook for using server actions */
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
