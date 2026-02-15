// What Framework - TypeScript Definitions

// --- Reactive Primitives ---

/** A reactive value container */
export interface Signal<T> {
  /** Read the current value (tracks dependency if inside effect) */
  (): T;
  /** Update the value */
  set(value: T | ((prev: T) => T)): void;
  /** Read without tracking */
  peek(): T;
  /** Subscribe to changes */
  subscribe(fn: (value: T) => void): () => void;
  /** Internal marker */
  _signal: true;
}

/** Create a reactive signal */
export function signal<T>(initial: T): Signal<T>;

/** A derived reactive value (lazy evaluation) */
export interface Computed<T> {
  (): T;
  peek(): T;
  _signal: true;
}

/** Create a computed signal */
export function computed<T>(fn: () => T): Computed<T>;

/** Create a side effect that re-runs when dependencies change */
export function effect(fn: () => void | (() => void)): () => void;

/** Batch multiple signal updates into one flush */
export function batch<T>(fn: () => T): T;

/** Read signals without subscribing */
export function untrack<T>(fn: () => T): T;

// --- Virtual DOM ---

export interface VNode<P = any> {
  tag: string | Component<P>;
  props: P;
  children: VNodeChild[];
  key: string | number | null;
  _vnode: true;
}

export type VNodeChild = VNode | string | number | boolean | null | undefined | VNodeChild[];

export type Component<P = {}> = (props: P & { children?: VNodeChild }) => VNode | VNodeChild;

/** Create a virtual DOM node */
export function h<P extends {}>(
  tag: string | Component<P>,
  props?: P | null,
  ...children: VNodeChild[]
): VNode<P>;

/** Fragment component */
export function Fragment(props: { children?: VNodeChild }): VNodeChild;

/** Tagged template for JSX-like syntax without build step */
export function html(strings: TemplateStringsArray, ...values: any[]): VNode | VNode[];

// --- DOM Mounting ---

/** Mount a VNode tree into a container */
export function mount(vnode: VNode, container: string | Element): () => void;

// --- Hooks ---

/** State hook - returns [value, setter] */
export function useState<T>(initial: T | (() => T)): [T, (value: T | ((prev: T) => T)) => void];

/** Signal hook - returns raw signal */
export function useSignal<T>(initial: T | (() => T)): Signal<T>;

/** Computed hook */
export function useComputed<T>(fn: () => T): Computed<T>;

/** Effect hook with optional dependencies */
export function useEffect(fn: () => void | (() => void), deps?: any[]): void;

/** Memoized value hook */
export function useMemo<T>(fn: () => T, deps: any[]): T;

/** Memoized callback hook */
export function useCallback<T extends (...args: any[]) => any>(fn: T, deps: any[]): T;

/** Ref hook */
export function useRef<T>(initial: T): { current: T };

/** Context hook */
export function useContext<T>(context: Context<T>): T;

/** Reducer hook */
export function useReducer<S, A>(
  reducer: (state: S, action: A) => S,
  initialState: S,
  init?: (initial: S) => S
): [S, (action: A) => void];

/** Create a context */
export interface Context<T> {
  _value: T;
  Provider: Component<{ value: T; children?: VNodeChild }>;
}

export function createContext<T>(defaultValue: T): Context<T>;

// --- Component Utilities ---

/** Skip re-render if props are equal */
export function memo<P>(
  component: Component<P>,
  areEqual?: (prev: P, next: P) => boolean
): Component<P>;

/** Lazy-load a component */
export function lazy<P>(
  loader: () => Promise<{ default: Component<P> } | Component<P>>
): Component<P>;

/** Suspense boundary for lazy components */
export function Suspense(props: {
  fallback: VNodeChild;
  children?: VNodeChild;
}): VNode;

/** Error boundary for catching component errors */
export function ErrorBoundary(props: {
  fallback: VNodeChild | ((props: { error: Error; reset: () => void }) => VNodeChild);
  onError?: (error: Error) => void;
  children?: VNodeChild;
}): VNode;

// --- Store ---

export interface StoreDefinition {
  [key: string]: any;
}

export type Store<T extends StoreDefinition> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? T[K] : T[K];
};

/** Mark a function as a computed property in a store definition */
export function storeComputed<T>(fn: (state: any) => T): (state: any) => T;

/** Create a global reactive store */
export function createStore<T extends StoreDefinition>(definition: T): () => Store<T>;

/** Create a simple global atom */
export function atom<T>(initial: T): Signal<T>;

// --- Island ---

export interface IslandProps {
  component: Component<any>;
  mode: 'load' | 'idle' | 'visible' | 'interaction' | 'media';
  mediaQuery?: string;
  [key: string]: any;
}

/** Island component for deferred hydration */
export function Island(props: IslandProps): VNode;

// --- Utilities ---

/** Conditional rendering helper */
export function show<T extends VNodeChild>(condition: boolean, vnode: T, fallback?: VNodeChild): T | VNodeChild;

/** List rendering helper with optional key function */
export function each<T>(
  list: T[],
  fn: (item: T, index: number) => VNode,
  keyFn?: (item: T, index: number) => string | number
): VNode[];

/** Conditional class names */
export function cls(...args: (string | false | null | undefined | Record<string, boolean>)[]): string;

/** Convert style object to string */
export function style(obj: string | Record<string, string | number | null | undefined>): string;

/** Debounce a function */
export function debounce<T extends (...args: any[]) => any>(fn: T, ms: number): T;

/** Throttle a function */
export function throttle<T extends (...args: any[]) => any>(fn: T, ms: number): T;

/** Reactive media query */
export function useMediaQuery(query: string): Signal<boolean>;

/** Signal synced with localStorage */
export function useLocalStorage<T>(key: string, initial: T): Signal<T>;

/** Render children in a different DOM container */
export function Portal(props: { target: string | Element; children?: VNodeChild }): VNode | null;

/** CSS transition helper */
export function transition(name: string, active: boolean): { class: string };

// --- Head Management ---

/** Manage document head */
export function Head(props: {
  title?: string;
  meta?: Record<string, string>[];
  link?: Record<string, string>[];
  script?: Record<string, string>[];
  children?: VNodeChild;
}): null;

/** Clear managed head elements */
export function clearHead(): void;

// --- DOM Scheduler ---

/** Schedule a DOM read operation */
export function scheduleRead(fn: () => void): () => void;

/** Schedule a DOM write operation */
export function scheduleWrite(fn: () => void): () => void;

/** Flush all pending scheduler operations */
export function flushScheduler(): void;

/** Measure DOM (returns promise) */
export function measure<T>(fn: () => T): Promise<T>;

/** Mutate DOM (returns promise) */
export function mutate(fn: () => void): Promise<void>;

/** Effect that batches DOM operations */
export function useScheduledEffect(
  readFn: () => any,
  writeFn?: (data: any) => void
): () => void;

/** Returns promise that resolves on next animation frame */
export function nextFrame(): Promise<void> & { cancel: () => void };

/** Debounced requestAnimationFrame */
export function raf(key: string, fn: () => void): void;

/** Observe element resize */
export function onResize(
  element: Element,
  callback: (rect: DOMRectReadOnly) => void
): () => void;

/** Observe element intersection */
export function onIntersect(
  element: Element,
  callback: (entry: IntersectionObserverEntry) => void,
  options?: IntersectionObserverInit
): () => void;

/** Smooth scroll to element */
export function smoothScrollTo(
  element: Element,
  options?: { duration?: number; easing?: (t: number) => number }
): Promise<void>;
