import type { Component as WhatComponent, Context as WhatContext, VNode, VNodeChild } from 'what-core';

export type ReactNode = any;
export interface ReactElement<P = any, T = any> { type?: T; tag?: any; props: P; children?: ReactNode[]; key?: string | number | null; _vnode?: true; }
export type FC<P = {}> = FunctionComponent<P>;
export type FunctionComponent<P = {}> = (props: P & { children?: ReactNode }) => ReactNode;
export type ComponentType<P = {}> = FunctionComponent<P> | ComponentClass<P>;
export type ElementType<P = any> = string | ComponentType<P>;
export type RefObject<T> = { current: T | null };
export type MutableRefObject<T> = { current: T };
export type RefCallback<T> = (instance: T | null) => void;
export type Ref<T> = RefCallback<T> | RefObject<T> | null;
export type ForwardedRef<T> = Ref<T>;
export type DependencyList = readonly unknown[];
export type Dispatch<A> = (value: A) => void;
export type SetStateAction<S> = S | ((prevState: S) => S);
export type Reducer<S, A> = (prevState: S, action: A) => S;
export type ReducerState<R extends Reducer<any, any>> = R extends Reducer<infer S, any> ? S : never;
export type ReducerAction<R extends Reducer<any, any>> = R extends Reducer<any, infer A> ? A : never;
export type Context<T> = WhatContext<T>;

export const Fragment: typeof import('what-core').Fragment;
export const Suspense: typeof import('what-core').Suspense;
export const memo: typeof import('what-core').memo;
export const lazy: typeof import('what-core').lazy;

export function createElement<P = any>(type: ElementType<P>, props?: (P & { children?: ReactNode; key?: string | number; ref?: any }) | null, ...children: ReactNode[]): ReactElement<P>;
export function cloneElement<P = any>(element: ReactElement<P>, props?: Partial<P> | null, ...children: ReactNode[]): ReactElement<P>;
export function createFactory<P = any>(type: ElementType<P>): ((props?: P | null, ...children: ReactNode[]) => ReactElement<P>) & { type: ElementType<P> };
export function isValidElement(object: unknown): object is ReactElement;
export function createRef<T = any>(): RefObject<T>;
export function forwardRef<T, P = {}>(render: (props: P, ref: ForwardedRef<T>) => ReactNode): FunctionComponent<P & { ref?: Ref<T> }> & { displayName?: string };

export const Children: {
  map<T = ReactNode, R = any>(children: ReactNode, fn: (child: T, index: number) => R): R[];
  forEach<T = ReactNode>(children: ReactNode, fn: (child: T, index: number) => void): void;
  count(children: ReactNode): number;
  toArray(children: ReactNode): ReactNode[];
  only<T = ReactNode>(children: T): T;
};

export function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
export function useEffect(effect: () => void | (() => void), deps?: DependencyList): void;
export function useMemo<T>(factory: () => T, deps?: DependencyList): T;
export function useCallback<T extends (...args: any[]) => any>(callback: T, deps?: DependencyList): T;
export function useRef<T>(initialValue: T): MutableRefObject<T>;
export function useRef<T = undefined>(): MutableRefObject<T | undefined>;
export function useContext<T>(context: Context<T>): T;
export function useReducer<R extends Reducer<any, any>>(reducer: R, initialState: ReducerState<R>, init?: (initial: ReducerState<R>) => ReducerState<R>): [ReducerState<R>, Dispatch<ReducerAction<R>>];
export function createContext<T>(defaultValue: T): Context<T>;
export function useLayoutEffect(effect: () => void | (() => void), deps?: DependencyList): void;
export function useInsertionEffect(effect: () => void | (() => void), deps?: DependencyList): void;
export function useImperativeHandle<T, R extends T>(ref: Ref<T> | undefined, createHandle: () => R, deps?: DependencyList): void;
export function useId(): string;
export function useDebugValue<T>(value?: T, format?: (value: T) => any): void;
export function useSyncExternalStore<T>(subscribe: (onStoreChange: () => void) => () => void, getSnapshot: () => T, getServerSnapshot?: () => T): T;
export function useTransition(): [boolean, (callback: () => void) => void];
export function useDeferredValue<T>(value: T): T;
export function startTransition(callback: () => void): void;

export function StrictMode(props: { children?: ReactNode }): ReactNode;

export interface ComponentClass<P = {}, S = any> {
  new (props: P): Component<P, S>;
  displayName?: string;
  defaultProps?: Partial<P>;
  contextType?: Context<any>;
  getDerivedStateFromProps?: (props: P, state: S) => Partial<S> | null;
}

export class Component<P = {}, S = {}> {
  constructor(props: P);
  props: P;
  state: S;
  context?: any;
  setState(update: Partial<S> | ((state: S, props: P) => Partial<S>), callback?: () => void): void;
  forceUpdate(callback?: () => void): void;
  render(): ReactNode;
  componentDidMount?(): void;
  componentWillUnmount?(): void;
  componentDidUpdate?(prevProps: P, prevState: S, snapshot?: any): void;
  getSnapshotBeforeUpdate?(prevProps: P, prevState: S): any;
  static displayName?: string;
  static defaultProps?: Record<string, any>;
  static contextType?: Context<any>;
  static getDerivedStateFromProps?: (props: any, state: any) => any;
}

export class PureComponent<P = {}, S = {}> extends Component<P, S> {}

export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: Record<string, any>;

declare const React: {
  createElement: typeof createElement;
  cloneElement: typeof cloneElement;
  createFactory: typeof createFactory;
  isValidElement: typeof isValidElement;
  createRef: typeof createRef;
  forwardRef: typeof forwardRef;
  Children: typeof Children;
  Fragment: typeof Fragment;
  Suspense: typeof Suspense;
  StrictMode: typeof StrictMode;
  Component: typeof Component;
  PureComponent: typeof PureComponent;
  memo: typeof memo;
  lazy: typeof lazy;
  useState: typeof useState;
  useEffect: typeof useEffect;
  useMemo: typeof useMemo;
  useCallback: typeof useCallback;
  useRef: typeof useRef;
  useContext: typeof useContext;
  useReducer: typeof useReducer;
  createContext: typeof createContext;
  useLayoutEffect: typeof useLayoutEffect;
  useInsertionEffect: typeof useInsertionEffect;
  useImperativeHandle: typeof useImperativeHandle;
  useId: typeof useId;
  useDebugValue: typeof useDebugValue;
  useSyncExternalStore: typeof useSyncExternalStore;
  useTransition: typeof useTransition;
  useDeferredValue: typeof useDeferredValue;
  startTransition: typeof startTransition;
};

export default React;
