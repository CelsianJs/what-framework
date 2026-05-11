// What Framework - Hooks Type Definitions

import { Signal, Computed, Updater, VNodeChild } from './index.js';

export function useState<T>(initial: T | (() => T)): [Signal<T>, (value: Updater<T>) => void];
export function useSignal<T>(initial: T | (() => T)): Signal<T>;
export function useComputed<T>(fn: () => T): Computed<T>;
export function useEffect(fn: () => void | (() => void), deps?: any[]): void;
export function useMemo<T>(fn: () => T, deps?: any[]): Computed<T>;
export function useCallback<T extends (...args: any[]) => any>(fn: T, deps?: any[]): T;
export function useRef<T>(initial?: T): { current: T | undefined };
export function useContext<T>(context: { _defaultValue: T }): T;
export function createContext<T>(defaultValue?: T): { _defaultValue: T; Provider: (props: { value: T; children?: VNodeChild }) => VNodeChild; Consumer: (props: { children: (value: T) => VNodeChild }) => VNodeChild };
export function useReducer<S, A>(reducer: (state: S, action: A) => S, initialState: S, init?: (s: S) => S): [Signal<S>, (action: A) => void];
export function onMount(fn: () => void | (() => void)): void;
export function onCleanup(fn: () => void): void;

export function createResource<T = any, S = any>(
  fetcher: (source?: S, ctx?: { signal: AbortSignal }) => Promise<T> | T,
  options?: { initialValue?: T; source?: S },
): [Signal<T | null>, {
  loading: Signal<boolean>;
  error: Signal<any>;
  refetch: (source?: S) => Promise<any>;
  mutate: (value: Updater<T | null>) => void;
}];
