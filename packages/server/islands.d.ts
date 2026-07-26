// What Framework Server Islands - TypeScript Definitions

import { VNode, VNodeChild, Signal } from 'what-core';

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

/** Snapshot every shared store for the current render context */
export function getIslandStoresSnapshot(context?: any): Record<string, any>;

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
