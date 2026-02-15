// What Framework Server - TypeScript Definitions

import { VNode, VNodeChild, Signal } from '../core';

// --- SSR ---

/** Render VNode tree to HTML string */
export function renderToString(vnode: VNode): string;

/** Render VNode tree as async iterator for streaming */
export function renderToStream(vnode: VNode): AsyncGenerator<string>;

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
  mode?: IslandOptions['mode'];
  priority?: number;
  stores?: string[];
  children?: VNodeChild;
}): VNode;

/** Hydrate all islands on the page */
export function hydrateIslands(): void;

/** Auto-discover and register islands */
export function autoIslands(registry: Record<string, {
  loader: () => Promise<any>;
  mode?: IslandOptions['mode'];
  media?: string;
  priority?: number;
  stores?: string[];
} | (() => Promise<any>)>): void;

/** Boost hydration priority for an island */
export function boostIslandPriority(name: string, newPriority?: number): void;

// --- Shared Island State ---

export interface IslandStore<T extends Record<string, any>> {
  _signals: Record<keyof T, Signal<any>>;
  _subscribe: (key: keyof T, fn: (value: any) => void) => () => void;
  _batch: (fn: () => void) => void;
  _getSnapshot: () => T;
  _hydrate: (data: Partial<T>) => void;
}

/** Create a shared store for islands */
export function createIslandStore<T extends Record<string, any>>(
  name: string,
  initialState: T
): T & IslandStore<T>;

/** Get or create a shared store */
export function useIslandStore<T extends Record<string, any>>(
  name: string,
  fallbackInitial?: T
): T & IslandStore<T>;

/** Serialize all shared stores for SSR */
export function serializeIslandStores(): string;

/** Hydrate shared stores from SSR data */
export function hydrateIslandStores(serialized: string | Record<string, any>): void;

// --- Progressive Enhancement ---

/** Enhance elements matching selector */
export function enhance(selector: string, handler: (el: Element) => void): void;

/** Enhance forms for AJAX submission */
export function enhanceForms(selector?: string): void;

// --- Debugging ---

export interface IslandStatus {
  registered: string[];
  hydrated: number;
  pending: number;
  queue: { name: string; priority: number }[];
  stores: string[];
}

export function getIslandStatus(): IslandStatus;

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
