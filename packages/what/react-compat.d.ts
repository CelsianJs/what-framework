// What Framework - React Compatibility Layer Type Definitions

import { Signal, VNode } from './index.js';

export const useState: <T>(initial: T | (() => T)) => [Signal<T>, (value: T | ((prev: T) => T)) => void];
export const useEffect: (fn: () => void | (() => void), deps?: any[]) => void;
export const useMemo: <T>(fn: () => T, deps?: any[]) => T;
export const useCallback: <T extends (...args: any[]) => any>(fn: T, deps?: any[]) => T;
export const useRef: <T>(initial?: T) => { current: T };
export const useContext: <T>(context: { _defaultValue: T }) => T;
export const useReducer: <S, A>(reducer: (state: S, action: A) => S, initialState: S, init?: (s: S) => S) => [Signal<S>, (action: A) => void];
export const createContext: <T>(defaultValue?: T) => { _defaultValue: T; Provider: (props: { value: T; children: any }) => any };
export const Fragment: (props: { children?: any }) => any;
export const Suspense: (props: { fallback?: any; children?: any }) => any;
export const memo: <T extends (...args: any[]) => any>(component: T) => T;
export const lazy: <T>(loader: () => Promise<{ default: T }>) => T;

export function createElement(type: any, props?: any, ...children: any[]): VNode;
export function forwardRef<T>(render: (props: any, ref: { current: T }) => any): (props: any) => any;
export function createRef<T>(): { current: T | null };
export function cloneElement(element: VNode, props?: any, ...children: any[]): VNode;
export function isValidElement(object: any): boolean;

export function useLayoutEffect(fn: () => void | (() => void), deps?: any[]): void;
export function useImperativeHandle<T>(ref: { current: T }, createHandle: () => T, deps?: any[]): void;
export function useId(): string;
export function useDebugValue(...args: any[]): void;
export function useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, getSnapshot: () => T, getServerSnapshot?: () => T): T;
export function useTransition(): [boolean, (fn: () => void) => void];
export function useDeferredValue<T>(value: T): T;
export function startTransition(fn: () => void): void;
export function StrictMode(props: { children?: any }): any;

export const version: string;

declare const React: {
  useState: typeof useState;
  useEffect: typeof useEffect;
  useMemo: typeof useMemo;
  useCallback: typeof useCallback;
  useRef: typeof useRef;
  useContext: typeof useContext;
  useReducer: typeof useReducer;
  createContext: typeof createContext;
  createElement: typeof createElement;
  Fragment: typeof Fragment;
  memo: typeof memo;
  lazy: typeof lazy;
  forwardRef: typeof forwardRef;
  createRef: typeof createRef;
  isValidElement: typeof isValidElement;
  version: typeof version;
};
export default React;
