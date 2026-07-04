// what-react — TypeScript declarations for the React compatibility layer.
//
// what-react implements React's public API (hooks that return VALUES,
// re-rendering components, keyed reconciliation) on What's runtime. These
// declarations type the surface that is *actually exported* from src/index.js
// so `import { useState, createElement } from 'what-react'` is type-checked
// instead of resolving to `any`.
//
// Scope: the module's own exports. When you alias `react` → `what-react` to run
// third-party React libraries, those libraries still bring their own
// `@types/react` declarations — these types are for code that imports
// what-react directly.

// ---------------------------------------------------------------------------
// Core element / node types
// ---------------------------------------------------------------------------

export type Key = string | number;

export interface RefObject<T> {
  readonly current: T | null;
}
export interface MutableRefObject<T> {
  current: T;
}
export type RefCallback<T> = (instance: T | null) => void;
export type Ref<T> = RefCallback<T> | RefObject<T> | null;

export interface ReactElement<P = any, T = any> {
  type: T;
  props: P;
  key: Key | null;
}

export type ReactNode =
  | ReactElement
  | string
  | number
  | boolean
  | null
  | undefined
  | Iterable<ReactNode>;

export interface FunctionComponent<P = {}> {
  (props: P & { children?: ReactNode }): ReactElement | null;
  displayName?: string;
}
export type FC<P = {}> = FunctionComponent<P>;

export interface ComponentClass<P = {}, S = {}> {
  new (props: P): Component<P, S>;
  displayName?: string;
}
export type ComponentType<P = {}> = FunctionComponent<P> | ComponentClass<P>;

export interface ExoticComponent<P = {}> {
  (props: P): ReactElement | null;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export type Dispatch<A> = (value: A) => void;
export type SetStateAction<S> = S | ((prev: S) => S);

export function useState<S>(
  initialState: S | (() => S),
): [S, Dispatch<SetStateAction<S>>];
export function useState<S = undefined>(): [
  S | undefined,
  Dispatch<SetStateAction<S | undefined>>,
];

export type Reducer<S, A> = (prevState: S, action: A) => S;
export type ReducerState<R> = R extends Reducer<infer S, any> ? S : never;
export type ReducerAction<R> = R extends Reducer<any, infer A> ? A : never;

export function useReducer<R extends Reducer<any, any>>(
  reducer: R,
  initialState: ReducerState<R>,
): [ReducerState<R>, Dispatch<ReducerAction<R>>];
export function useReducer<R extends Reducer<any, any>, I>(
  reducer: R,
  initialArg: I,
  init: (arg: I) => ReducerState<R>,
): [ReducerState<R>, Dispatch<ReducerAction<R>>];

export type DependencyList = ReadonlyArray<unknown>;
export type EffectCallback = () => void | (() => void);

export function useEffect(effect: EffectCallback, deps?: DependencyList): void;
export function useLayoutEffect(
  effect: EffectCallback,
  deps?: DependencyList,
): void;
export function useInsertionEffect(
  effect: EffectCallback,
  deps?: DependencyList,
): void;

export function useMemo<T>(factory: () => T, deps: DependencyList | undefined): T;
export function useCallback<T extends (...args: any[]) => any>(
  callback: T,
  deps: DependencyList,
): T;

export function useRef<T>(initialValue: T): MutableRefObject<T>;
export function useRef<T>(initialValue: T | null): RefObject<T>;
export function useRef<T = undefined>(): MutableRefObject<T | undefined>;

export function useImperativeHandle<T, R extends T>(
  ref: Ref<T> | undefined,
  create: () => R,
  deps?: DependencyList,
): void;

export interface ProviderProps<T> {
  value: T;
  children?: ReactNode;
}
export interface ConsumerProps<T> {
  children: (value: T) => ReactNode;
}
export type Provider<T> = FunctionComponent<ProviderProps<T>>;
export type Consumer<T> = FunctionComponent<ConsumerProps<T>>;
export interface Context<T> {
  Provider: Provider<T>;
  Consumer: Consumer<T>;
  displayName?: string;
}
export function createContext<T>(defaultValue: T): Context<T>;
export function useContext<T>(context: Context<T>): T;

export function useSyncExternalStore<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T,
  getServerSnapshot?: () => T,
): T;

export function useTransition(): [boolean, (callback: () => void) => void];
export function startTransition(scope: () => void): void;
export function useDeferredValue<T>(value: T): T;
export function useId(): string;
export function useDebugValue<T>(value?: T, format?: (value: T) => any): void;
export function use<T>(usable: Promise<T> | Context<T>): T;

// ---------------------------------------------------------------------------
// Element creation & utilities
// ---------------------------------------------------------------------------

export function createElement(
  type: any,
  props?: any,
  ...children: ReactNode[]
): ReactElement;

export const Fragment: ExoticComponent<{ children?: ReactNode }>;

export interface ForwardRefRenderFunction<T, P = {}> {
  (props: P, ref: Ref<T>): ReactElement | null;
}
export function forwardRef<T, P = {}>(
  render: ForwardRefRenderFunction<T, P>,
): FunctionComponent<P & { ref?: Ref<T> }>;

export function createRef<T = any>(): RefObject<T>;

export function memo<P extends object>(
  Component: FunctionComponent<P>,
  areEqual?: (prev: Readonly<P>, next: Readonly<P>) => boolean,
): FunctionComponent<P>;

export function lazy<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
): T;

export interface SuspenseProps {
  children?: ReactNode;
  fallback?: ReactNode;
}
export function Suspense(props: SuspenseProps): ReactElement | null;

export const Children: {
  map<T>(
    children: ReactNode,
    fn: (child: ReactNode, index: number) => T,
  ): T[];
  forEach(
    children: ReactNode,
    fn: (child: ReactNode, index: number) => void,
  ): void;
  count(children: ReactNode): number;
  only(children: ReactNode): ReactElement;
  toArray(children: ReactNode): ReactNode[];
};

export function cloneElement(
  element: ReactElement,
  props?: any,
  ...children: ReactNode[]
): ReactElement;

export function createFactory(
  type: any,
): (props?: any, ...children: ReactNode[]) => ReactElement;

export function isValidElement(object: unknown): object is ReactElement;

export function StrictMode(props: { children?: ReactNode }): ReactElement | null;

export function act(callback: () => void | Promise<void>): Promise<void>;

// Class components are shimmed but expose the familiar base-class surface.
export class Component<P = {}, S = {}> {
  constructor(props: P);
  props: Readonly<P> & { children?: ReactNode };
  state: Readonly<S>;
  setState(
    state: Partial<S> | ((prev: Readonly<S>, props: Readonly<P>) => Partial<S>),
    callback?: () => void,
  ): void;
  forceUpdate(callback?: () => void): void;
  render(): ReactNode;
}
export class PureComponent<P = {}, S = {}> extends Component<P, S> {}

export function unstable_flushUpdates(): void;

export const version: string;

// ---------------------------------------------------------------------------
// Default export — the React namespace object bundling the above.
// ---------------------------------------------------------------------------

declare const React: {
  createElement: typeof createElement;
  cloneElement: typeof cloneElement;
  createFactory: typeof createFactory;
  createRef: typeof createRef;
  createContext: typeof createContext;
  forwardRef: typeof forwardRef;
  memo: typeof memo;
  lazy: typeof lazy;
  isValidElement: typeof isValidElement;
  Children: typeof Children;
  Fragment: typeof Fragment;
  Suspense: typeof Suspense;
  StrictMode: typeof StrictMode;
  Component: typeof Component;
  PureComponent: typeof PureComponent;
  act: typeof act;
  useState: typeof useState;
  useReducer: typeof useReducer;
  useMemo: typeof useMemo;
  useCallback: typeof useCallback;
  useRef: typeof useRef;
  useEffect: typeof useEffect;
  useLayoutEffect: typeof useLayoutEffect;
  useInsertionEffect: typeof useInsertionEffect;
  useImperativeHandle: typeof useImperativeHandle;
  useContext: typeof useContext;
  useSyncExternalStore: typeof useSyncExternalStore;
  useTransition: typeof useTransition;
  useDeferredValue: typeof useDeferredValue;
  startTransition: typeof startTransition;
  useId: typeof useId;
  useDebugValue: typeof useDebugValue;
  use: typeof use;
  version: string;
};
export default React;
