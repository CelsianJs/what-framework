// What Framework - Hooks Type Definitions

import { Signal } from './index.js';

export function useState<T>(initial: T | (() => T)): [Signal<T>, (value: T | ((prev: T) => T)) => void];
export function useSignal<T>(initial: T): Signal<T>;
export function useComputed<T>(fn: () => T): Signal<T>;
export function useEffect(fn: () => void | (() => void), deps?: any[]): void;
export function useMemo<T>(fn: () => T, deps?: any[]): T;
export function useCallback<T extends (...args: any[]) => any>(fn: T, deps?: any[]): T;
export function useRef<T>(initial?: T): { current: T };
export function useContext<T>(context: { _defaultValue: T }): T;
export function createContext<T>(defaultValue?: T): { _defaultValue: T; Provider: (props: { value: T; children: any }) => any };
export function useReducer<S, A>(reducer: (state: S, action: A) => S, initialState: S, init?: (s: S) => S): [Signal<S>, (action: A) => void];
export function onMount(fn: () => void | (() => void)): void;
export function onCleanup(fn: () => void): void;

export interface Resource<T> {
  (): T | undefined;
  loading: Signal<boolean>;
  error: Signal<Error | null>;
  refetch: () => void;
  mutate: (value: T) => void;
}
export function createResource<T>(fetcher: () => Promise<T>, options?: { initialValue?: T }): Resource<T>;
