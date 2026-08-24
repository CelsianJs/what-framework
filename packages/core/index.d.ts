// What Framework - TypeScript Definitions

export type Updater<T> = T | ((prev: T) => T);

// --- Reactive Primitives ---

export interface Signal<T> {
  /** Read current value */
  (): T;
  /** Callable setter compatibility: sig(next) */
  (value: Updater<T>): void;
  /** Setter method compatibility: sig.set(next) */
  set(value: Updater<T>): void;
  /** Read without dependency tracking */
  peek(): T;
  /** Subscribe to value changes */
  subscribe(fn: (value: T) => void): () => void;
  _signal: true;
}

export interface Computed<T> {
  (): T;
  peek(): T;
  _signal: true;
}

export function signal<T>(initial: T, debugName?: string): Signal<T>;
export function computed<T>(fn: () => T): Computed<T>;
export function effect(fn: () => void | (() => void), opts?: { stable?: boolean }): () => void;
export function signalMemo<T>(fn: () => T): Computed<T>;
/**
 * Group signal writes so effects run once at the end. The callback's return
 * value is DISCARDED: batch() returns undefined. It was declared as `<T>(fn: ()
 * => T) => T`, so `const rows = batch(() => compute())` typechecked and handed
 * back undefined at runtime.
 */
export function batch(fn: () => unknown): void;
export function untrack<T>(fn: () => T): T;
export function flushSync(): void;
export function createRoot<T>(fn: (dispose: () => void) => T): T;

/** Opaque ownership scope handle. Pair with runWithOwner() for async work. */
export interface Owner {
  disposals: Array<() => void>;
}

export function getOwner(): Owner | null;
export function runWithOwner<T>(owner: Owner | null, fn: () => T): T;
/** Register a cleanup with the current owner/root (root-level onCleanup). */
export function onRootCleanup(fn: () => void): void;

// --- Virtual DOM ---

export type PrimitiveChild = string | number | boolean | null | undefined;

// `VNode<any>`, not `VNode`. VNode is invariant in P (its `tag` holds a
// `Component<P>`, whose parameter position is contravariant under
// strictFunctionTypes), so `VNode` — which means `VNode<Record<string, any>>` —
// rejects every specifically-typed node. `h('div', {}, h('h1', { style: '' }))`
// did not compile for any TypeScript user before 0.12.5, and neither did
// passing that tree to mount().
export type VNodeChild = PrimitiveChild | VNode<any> | (() => VNodeChild) | VNodeChild[];

/** A component may legitimately render nothing, so `null` is part of the contract. */
export type Component<P = {}> = ((props: P & { children?: VNodeChild }) => VNode<any> | null) & {
  /**
   * Opt out of realizing compiled children before the component runs.
   *
   * A component that establishes a scope its children depend on (a context
   * provider, an error or suspense boundary) receives `props.children` as a
   * zero-argument factory instead of built nodes, and the runtime realizes it
   * once that scope exists. `ErrorBoundary`, `Suspense` and `Context.Provider`
   * set this themselves, and the compiler keeps a component that only forwards
   * its children lazy, so this is only needed by a component that both
   * inspects its children and forwards them into a boundary or a provider.
   */
  _deferChildren?: boolean;
};

export interface VNode<P = Record<string, any>> {
  tag: string | Component<P>;
  props: P;
  children: VNodeChild[];
  key: string | number | null;
  _vnode: true;
}

export function h<P extends Record<string, any>>(
  tag: string | Component<P>,
  props?: P | null,
  ...children: VNodeChild[]
): VNode<P>;

export function Fragment(props: { children?: VNodeChild }): VNode;
export function html(strings: TemplateStringsArray, ...values: any[]): VNode | VNode[];

// --- DOM ---

export function mount(vnode: VNodeChild, container: string | Element | DocumentFragment): () => void;

/** Attach reactive bindings to server-rendered DOM instead of creating it. */
export function hydrate(vnode: VNodeChild, container: Element): Node | null;
export function isHydrating(): boolean;

// Fine-grained rendering primitives
export function template(html: string): () => Element;
export function svgTemplate(html: string): () => Element;
export function insert(parent: Node, child: any, marker?: Node | null): any;
export function mapArray<T>(
  source: () => T[],
  mapFn: (item: T | Signal<T>, index: number) => Node,
  options?: { key?: (item: T) => string | number; raw?: boolean },
): (parent: Node, marker?: Node | null) => Node;
export function spread(el: Element, props: Record<string, any>): void;
export function setProp(el: Element, key: string, value: any): void;
export function delegateEvents(eventNames: string[]): void;
export function on(el: Element, event: string, handler: (e: Event) => void): () => void;
export function classList(el: Element, classes: Record<string, boolean | (() => boolean)>): void;

// --- Hooks ---

/**
 * Returns [signal, setter]. The first element is the SIGNAL ITSELF, not a
 * snapshot value: components run once, so there is no re-render to hand a new
 * `T` to. Read it by calling it (`count()`), or pass it straight into JSX where
 * insert() binds it reactively.
 *
 * It was declared as `[T, setter]`, which made the correct code (`count()`) a
 * type error and the wrong code (`count + 1`) type-check.
 */
export function useState<T>(initial: T | (() => T)): [Signal<T>, (value: Updater<T>) => void];
export function useSignal<T>(initial: T | (() => T)): Signal<T>;
export function useComputed<T>(fn: () => T): Computed<T>;
export function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
/**
 * Returns a COMPUTED ACCESSOR, not the value. Same reason as useState: the
 * component body runs once, so nothing would ever hand back a refreshed `T`.
 * Read it by calling it (`total()`), or pass the accessor straight into JSX
 * where insert() tracks it.
 *
 * `deps` is accepted for React familiarity and ignored at runtime: computed()
 * tracks whatever signals the callback actually reads.
 *
 * It was declared as `T`, which inverted both halves: `useMemo(...) * 2`
 * type-checked and produced NaN, while the correct `useMemo(...)()` was the
 * type error.
 */
export function useMemo<T>(fn: () => T, deps?: unknown[]): Computed<T>;
export function useCallback<T extends (...args: any[]) => any>(fn: T, deps?: unknown[]): T;
export function useRef<T>(initial: T): { current: T };

export interface Context<T> {
  _defaultValue: T;
  Provider: Component<{ value: T; children?: VNodeChild }>;
}

export function createContext<T>(defaultValue: T): Context<T>;
export function useContext<T>(context: Context<T>): T;
/**
 * Returns [signal, dispatch]. The first element is the SIGNAL ITSELF, exactly
 * as useState returns it and for the same run-once reason. Read it with
 * `state()`.
 *
 * It was declared as `[S, dispatch]`, so `state.items` type-checked (and read
 * `undefined` off a function object) while `state()` did not.
 */
export function useReducer<S, A>(
  reducer: (state: S, action: A) => S,
  initialState: S,
  init?: (initial: S) => S,
): [Signal<S>, (action: A) => void];
export function onMount(fn: () => void): void;
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

// --- Components ---

export function lazy<P>(
  loader: () => Promise<{ default: Component<P> } | Component<P>>,
): Component<P>;
export function memo<P>(component: Component<P>, areEqual?: (prev: P, next: P) => boolean): Component<P>;

export function Suspense(props: {
  fallback: VNodeChild;
  children?: VNodeChild;
}): VNode;

export function ErrorBoundary(props: {
  fallback: VNodeChild | ((args: { error: Error; reset: () => void }) => VNodeChild);
  onError?: (error: Error) => void;
  children?: VNodeChild;
}): VNode;

export function Show(props: {
  when: boolean | (() => boolean);
  fallback?: VNodeChild;
  children?: VNodeChild;
}): VNode;

export function For<T>(props: {
  each: T[] | (() => T[]);
  fallback?: VNodeChild;
  children: ((item: T, index: number) => VNodeChild) | VNodeChild;
}): VNode;

export function Switch(props: {
  fallback?: VNodeChild;
  children?: VNodeChild;
}): VNode;

export function Match(props: {
  when: boolean | (() => boolean);
  children?: VNodeChild;
}): VNode;

export interface IslandProps {
  component: Component<any>;
  mode: 'load' | 'idle' | 'visible' | 'interaction' | 'media';
  mediaQuery?: string;
  [key: string]: any;
}

export function Island(props: IslandProps): VNode;

// --- State ---

/** `_storeComputed` is the marker createStore() actually reads to tell a derived value from an action. */
export type DerivedFn<T> = ((state: any) => T) & { _storeComputed: true };
export function derived<T>(fn: (state: any) => T): DerivedFn<T>;
/** @deprecated Use derived(). Warns once at runtime. */
export function storeComputed<T>(fn: (state: any) => T): DerivedFn<T>;
export type StoreDefinition = Record<string, any>;
/**
 * The store hook resolves every derived key to its VALUE. State and derived
 * keys are both getters on the returned object, only actions stay callable.
 * `Store<T> = T` left a derived key typed as the DerivedFn you wrote in the
 * definition, so `store.total` looked callable and `store.total * 2` was the
 * type error, which is backwards from the runtime.
 */
export type Store<T extends StoreDefinition> = {
  [K in keyof T]: T[K] extends DerivedFn<infer U> ? U : T[K];
};
export function createStore<T extends StoreDefinition>(definition: T): () => Store<T>;
export function atom<T>(initial: T): Signal<T>;

// --- Helpers / Utilities ---

export function each<T>(
  list: T[],
  fn: (item: T, index: number) => VNodeChild,
  keyFn?: (item: T, index: number) => string | number,
): VNodeChild[];

export function cls(...args: Array<string | false | null | undefined | Record<string, boolean>>): string;
export function style(obj: string | Record<string, string | number | null | undefined>): string;
export function debounce<T extends (...args: any[]) => any>(fn: T, ms: number): T;
export function throttle<T extends (...args: any[]) => any>(fn: T, ms: number): T;
export function useMediaQuery(query: string): Signal<boolean>;
export function useLocalStorage<T>(key: string, initial: T): Signal<T>;
export function useClickOutside(ref: { current?: Element | null } | Element, handler: (e: Event) => void): void;
export function Portal(props: { target: string | Element; children?: VNodeChild }): VNode | null;
export function transition(name: string, active: boolean): { class: string };

// --- Head ---

export function Head(props: {
  title?: string;
  meta?: Array<Record<string, string>>;
  link?: Array<Record<string, string>>;
  script?: Array<Record<string, string>>;
  children?: VNodeChild;
}): null;
export function clearHead(): void;

/** Per-render head accumulator used by the SSR renderer. */
export interface HeadSink {
  title: string | null;
  metas: Map<string, Record<string, string>>;
  links: Map<string, Record<string, string>>;
}

export function beginHeadCollection(): HeadSink;
export function endHeadCollection(sink: HeadSink | null): string;

// --- Loader Data ---

export function useLoaderData<T = any>(): T | undefined;
export function getLoaderData<T = any>(): T | undefined;
export function getResource<T = any>(key: string): T | undefined;

// --- Server Context ---

export interface ServerContext {
  loaderData?: any;
  head?: HeadSink;
  resources?: Record<string, any>;
  [key: string]: any;
}

/** The active render context, or null on the client / outside a render. */
export function getServerContext(): ServerContext | null;
/** Set the active context and return the previous one so callers can restore it. */
export function setServerContext(ctx: ServerContext | null): ServerContext | null;
export function runWithServerContext<T>(ctx: ServerContext, fn: () => T): T;

// --- Scheduler ---

export function scheduleRead(fn: () => void): () => void;
export function scheduleWrite(fn: () => void): () => void;
export function flushScheduler(): void;
export function measure<T>(fn: () => T): Promise<T>;
export function mutate(fn: () => void): Promise<void>;
export function useScheduledEffect(readFn: () => any, writeFn?: (data: any) => void): () => void;
export function nextFrame(): Promise<void> & { cancel: () => void };
export function raf(key: string, fn: () => void): void;
export function onResize(element: Element, callback: (rect: DOMRectReadOnly) => void): () => void;
export function onIntersect(
  element: Element,
  callback: (entry: IntersectionObserverEntry) => void,
  options?: IntersectionObserverInit,
): () => void;
export function smoothScrollTo(
  element: Element,
  options?: { duration?: number; easing?: (t: number) => number },
): Promise<void>;

// --- Animation ---
//
// Every accessor below is a plain getter function, NOT a Signal: the objects
// these factories return expose reads through closures and offer writes as
// named methods (set/snap/setValue), so nothing here carries .set/.peek. The
// declarations used to promise Signal<number> and a single shared SpringValue
// shape for both spring() and tween(), which are two different objects.

export interface SpringConfig {
  stiffness?: number;
  damping?: number;
  mass?: number;
  precision?: number;
}

/** Physics-based value. `set()` retargets and animates; `snap()` jumps without animating. */
export interface SpringValue {
  current(): number;
  target(): number;
  velocity(): number;
  isAnimating(): boolean;
  set(target: number): void;
  stop(): void;
  snap(value: number): void;
  subscribe(fn: (value: number) => void): () => void;
}

export interface TweenConfig {
  duration?: number;
  easing?: (t: number) => number;
  onUpdate?: (value: number, progress: number) => void;
  onComplete?: () => void;
}

/**
 * Easing-based interpolation from `from` to `to`. Starts immediately on
 * creation and runs to completion, so it exposes `cancel()` rather than the
 * spring's retargeting `set()`/`stop()`.
 */
export interface TweenValue {
  progress(): number;
  value(): number;
  isAnimating(): boolean;
  cancel(): void;
  subscribe(fn: (value: number) => void): () => void;
}

export function spring(initialValue: number, config?: SpringConfig): SpringValue;
/**
 * Both endpoints are required and positional. This was declared as
 * `tween(initialValue?, config?)` returning a SpringValue, so the documented
 * call `tween(0, 100, { duration: 300 })` was a type error, while
 * `tween(0).current()` type-checked and threw (`current` does not exist, and a
 * missing `to` interpolates toward undefined).
 */
export function tween(from: number, to: number, config?: TweenConfig): TweenValue;
export const easings: Record<string, (t: number) => number>;
/**
 * Drives a 0..1 progress value over `duration`. This is NOT React's
 * useTransition, and it never had the mounted/styles/show/hide members that
 * were declared here, and all four were undefined at runtime.
 */
export function useTransition(options?: { duration?: number; easing?: (t: number) => number }): {
  isTransitioning: () => boolean;
  progress: () => number;
  start: (callback?: () => void) => Promise<void>;
};

/** Live gesture state. `startX`/`startY` are plain numbers rewritten in place at gesture start. */
export interface GestureState {
  isDragging: Signal<boolean>;
  startX: number;
  startY: number;
  currentX: Signal<number>;
  currentY: Signal<number>;
  deltaX: Signal<number>;
  deltaY: Signal<number>;
  velocity: Signal<GestureVelocity>;
}

export interface GestureVelocity {
  x: number;
  y: number;
}

/**
 * `preventDefault` is why this cannot be a `Record<string, (payload) => void>`:
 * it sits in the same object as the callbacks and is a boolean.
 */
export interface GestureHandlers {
  onDragStart?: (payload: { x: number; y: number }) => void;
  onDrag?: (payload: {
    x: number; y: number; deltaX: number; deltaY: number; velocity: GestureVelocity;
  }) => void;
  onDragEnd?: (payload: { deltaX: number; deltaY: number; velocity: GestureVelocity }) => void;
  onPinch?: (payload: { scale: number; centerX: number; centerY: number }) => void;
  onSwipe?: (payload: { direction: 'up' | 'down' | 'left' | 'right'; velocity: GestureVelocity }) => void;
  onTap?: (payload: { x: number; y: number }) => void;
  onLongPress?: (payload: { x: number; y: number }) => void;
  /** Opt in to e.preventDefault() in the touch handlers (listeners become non-passive). */
  preventDefault?: boolean;
}

/** Returns the gesture state. It was declared `void`, so the state was unreachable from TypeScript. */
export function useGesture(
  ref: { current?: Element | null } | Element | (() => Element | null),
  handlers?: GestureHandlers,
): GestureState;

/** Handle for one running animation started by useAnimatedValue. */
export interface AnimationHandle {
  stop: () => void;
}

/**
 * `animateTo` and `stop` were declared here and have never existed. Animations
 * are started with spring()/timing(), each returning its own handle to stop.
 */
export function useAnimatedValue(initialValue: number): {
  value: () => number;
  setValue: (value: number) => void;
  spring: (toValue: number, config?: SpringConfig) => AnimationHandle;
  timing: (toValue: number, config?: TweenConfig) => AnimationHandle;
  interpolate: (inputRange: number[], outputRange: number[]) => () => number;
  subscribe: (fn: (value: number) => void) => () => void;
};

export interface TransitionClasses {
  enter: string;
  enterActive: string;
  enterDone: string;
  exit: string;
  exitActive: string;
  exitDone: string;
}

/** Returns the six class NAMES for `name`, not a single string. */
export function createTransitionClasses(name: string): TransitionClasses;
/**
 * Applies the enter/exit class sequence to an element and resolves when the
 * transition is done. It was declared as a synchronous `(config) => object`.
 */
export function cssTransition(
  element: Element,
  name: string,
  type?: 'enter' | 'exit',
  duration?: number,
): Promise<void>;

// --- Accessibility ---

export function useFocus(): {
  current: () => Element | null;
  focus: (element?: Element | null) => void;
  blur: () => void;
};

export function useFocusRestore(): {
  capture: (target?: Element | null) => void;
  restore: (fallbackTarget?: Element | null) => void;
  previous: () => Element | null;
};

export function useFocusTrap(containerRef: { current?: Element | null } | Element): {
  activate: () => void | (() => void);
  deactivate: () => void;
};

export function FocusTrap(props: { children?: VNodeChild; active?: boolean }): VNode;
export function announce(message: string, options?: { priority?: 'polite' | 'assertive'; timeout?: number }): void;
export function announceAssertive(message: string): void;
export function SkipLink(props: { href?: string; children?: VNodeChild }): VNode;

export function useAriaExpanded(initialExpanded?: boolean): {
  expanded: () => boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  buttonProps: () => Record<string, any>;
  panelProps: () => Record<string, any>;
};

export function useAriaSelected<T = any>(initialSelected?: T): {
  selected: () => T;
  select: (value: T) => void;
  isSelected: (value: T) => boolean;
  itemProps: (value: T) => Record<string, any>;
};

export function useAriaChecked(initialChecked?: boolean): {
  checked: () => boolean;
  toggle: () => void;
  set: (value: boolean) => void;
  checkboxProps: () => Record<string, any>;
};

export interface RovingTabIndexOptions {
  /**
   * Container role, emitted by containerProps(). The hook emits NO role by
   * default: roving tabindex is the shared keyboard mechanic of toolbars,
   * menus, trees, grids, tablists, radiogroups and listboxes, and a default
   * spread last would silently overwrite the role the caller wrote beside it.
   */
  role?: string;
}

/**
 * Props for one roving item. `ref` is the item's REGISTRATION (the hook holds
 * the node through it and cannot move focus without it), so a `ref` passed via
 * `overrides` is chained rather than replaced. `tabIndex` is an accessor, not a
 * number: exactly one item is tabbable at a time and which one changes as focus
 * roves, so a resolved value could not survive the spread.
 */
export interface RovingItemProps {
  ref: { current: Element | null };
  tabIndex: () => number;
  onKeyDown: (e: KeyboardEvent) => void;
  onFocus: (e: Event) => void;
  [prop: string]: any;
}

export function useRovingTabIndex(
  itemCountOrSignal: number | (() => number),
  options?: RovingTabIndexOptions,
): {
  /** Active index, clamped to the current count so the group is never untabbable. */
  focusIndex: () => number;
  /**
   * Set the active index. Out-of-range indexes are REFUSED, not clamped. Moves
   * real focus only when the group already owns it, so syncing from application
   * state cannot steal focus from elsewhere on the page.
   */
  setFocusIndex: (index: number) => void;
  /**
   * Explicitly move focus to an item (a menu focusing its first item on open).
   * Returns the element it focused, or null when the index is out of range or
   * the item is not in the DOM.
   */
  focusItem: (index: number) => Element | null;
  getItemProps: (index: number, overrides?: Record<string, any>) => RovingItemProps;
  containerProps: (overrides?: Record<string, any>) => Record<string, any>;
};

export function VisuallyHidden(props: { children?: VNodeChild; as?: string }): VNode;
export function LiveRegion(props: { children?: VNodeChild; priority?: 'polite' | 'assertive'; atomic?: boolean }): VNode;
export function useId(prefix?: string): () => string;
export function useIds(count: number, prefix?: string): string[];
export function useDescribedBy(description: VNodeChild): {
  descriptionId: () => string;
  descriptionProps: () => Record<string, any>;
  describedByProps: () => Record<string, any>;
  Description: () => VNode;
};
export function useLabelledBy(label: VNodeChild): {
  labelId: () => string;
  labelProps: () => Record<string, any>;
  labelledByProps: () => Record<string, any>;
};

export const Keys: {
  Enter: 'Enter';
  Space: ' ';
  Escape: 'Escape';
  ArrowUp: 'ArrowUp';
  ArrowDown: 'ArrowDown';
  ArrowLeft: 'ArrowLeft';
  ArrowRight: 'ArrowRight';
  Home: 'Home';
  End: 'End';
  Tab: 'Tab';
};

export function onKey(key: string, handler: (e: KeyboardEvent) => void): (e: KeyboardEvent) => void;
export function onKeys(keys: string[], handler: (e: KeyboardEvent) => void): (e: KeyboardEvent) => void;

// --- Skeleton ---

export function Skeleton(props?: Record<string, any>): VNode;
export function SkeletonText(props?: Record<string, any>): VNode;
export function SkeletonAvatar(props?: Record<string, any>): VNode;
export function SkeletonCard(props?: Record<string, any>): VNode;
export function SkeletonTable(props?: Record<string, any>): VNode;
export function IslandSkeleton(props?: Record<string, any>): VNode;
export function useSkeleton<T>(asyncFn: () => Promise<T> | T, deps?: unknown[]): {
  isLoading: () => boolean;
  data: () => T | null;
  error: () => any;
  Skeleton: (props?: Record<string, any>) => VNode;
};
export function Placeholder(props?: Record<string, any>): VNode;
export function LoadingDots(props?: Record<string, any>): VNode;
export function Spinner(props?: Record<string, any>): VNode;

// --- Data Fetching ---

export function useFetch<T = any>(url: string, options?: Record<string, any>): {
  /** null until the first response lands. It was declared as bare `T`, so strict-mode callers skipped the check they need. */
  data: () => T | null;
  error: () => any;
  isLoading: () => boolean;
  refetch: () => Promise<void>;
  mutate: (newData: T) => void;
};

export function useSWR<T = any>(key: string | null | false, fetcher: (key: string, ctx?: { signal: AbortSignal }) => Promise<T>, options?: Record<string, any>): {
  data: () => T | null;
  error: () => any;
  isLoading: () => boolean;
  isValidating: () => boolean;
  mutate: (newData: T | ((prev: T | null) => T), shouldRevalidate?: boolean) => void;
  revalidate: () => Promise<T | void>;
};

/**
 * 'idle' is a real state, not a placeholder: a query with `enabled: false` and
 * nothing cached is idle, and reporting it as loading is what renders a spinner
 * that never comes down.
 */
export type QueryStatus = 'idle' | 'loading' | 'success' | 'error';
/** Whether a request is on the wire, independent of whether data exists. */
export type FetchStatus = 'idle' | 'fetching';

/**
 * Any array key is joined into a single normalized string, so an array and its
 * normalization address the same cache entry everywhere a key is accepted.
 */
export type QueryKey = string | readonly unknown[];

export function useQuery<T = any>(options: Record<string, any>): {
  data: () => T | null;
  error: () => any;
  status: () => QueryStatus;
  fetchStatus: () => FetchStatus;
  isLoading: () => boolean;
  isFetching: () => boolean;
  isError: () => boolean;
  isSuccess: () => boolean;
  isIdle: () => boolean;
  /** Whether the `enabled` gate is currently open. */
  isEnabled: () => boolean;
  refetch: () => Promise<T | void>;
};

/**
 * Pages, plus the param each was fetched with. `pageParams[i]` names `pages[i]`.
 */
export interface InfiniteData<T> {
  pages: T[];
  pageParams: unknown[];
}

/**
 * `data()` hands back the page CONTAINER, not a flat array. It was declared as
 * `T[]`, so `data().map(...)` type-checked and threw. The rows are in
 * `data().pages`. A `select` option replaces the container wholesale, and that
 * transformation is not expressible here.
 */
export function useInfiniteQuery<T = any>(options: Record<string, any>): {
  data: () => InfiniteData<T>;
  error: () => any;
  status: () => QueryStatus;
  isLoading: () => boolean;
  isError: () => boolean;
  isSuccess: () => boolean;
  isIdle: () => boolean;
  isFetching: () => boolean;
  isEnabled: () => boolean;
  hasNextPage: () => boolean;
  hasPreviousPage: () => boolean;
  isFetchingNextPage: () => boolean;
  isFetchingPreviousPage: () => boolean;
  fetchNextPage: () => Promise<void>;
  fetchPreviousPage: () => Promise<void>;
  refetch: () => Promise<void>;
};

/**
 * Synchronous. It was declared as returning Promise<void>, so `await
 * invalidateQueries(...)` awaited undefined and read as "the refetches are
 * done" when they had only been kicked off. The subscribers it wakes fetch on
 * their own.
 *
 * An array key is a PREFIX unless `exact` is set: invalidateQueries(['todos'])
 * also invalidates ['todos', 1]. `hard` clears the cached value immediately
 * (loading state); the default keeps stale data on screen while it refetches.
 */
export function invalidateQueries(
  keyOrPredicate: QueryKey | ((key: string) => boolean),
  options?: { exact?: boolean; hard?: boolean },
): void;

export function prefetchQuery<T = any>(key: QueryKey, fetcher: (key: string) => Promise<T>): Promise<T>;
export function setQueryData<T = any>(key: QueryKey, updater: T | ((prev: T | null) => T)): void;
/** `undefined` for a key the cache has never held; `null` for one that was emptied. */
export function getQueryData<T = any>(key: QueryKey): T | null | undefined;
export function clearCache(): void;

// --- Forms ---

export interface FieldError {
  type?: string;
  message?: string;
  [key: string]: any;
}

/**
 * What register() actually hands back, which varies by control type. The event
 * handlers are LOWERCASE (`oninput`, `onchange`), because that is the key the
 * DOM binding and the merge in <Input>/<Radio> look for; `onInput` was declared
 * here and register() has never defined it, so `register('email').onInput(e)`
 * type-checked and threw at the first keystroke.
 *
 * `value` and `checked` are reactive rather than snapshots: `value` and the
 * checkbox `checked` are getters, and the radio `checked` is a thunk, so that a
 * spread (`{...register('email')}`) binds instead of freezing the value at
 * mount.
 *
 * A closed type alias rather than an interface: the key set really is closed
 * (this is the whole object register() builds), and closing it is what makes
 * the phantom `onInput` an error again instead of an `any` off an index
 * signature. It must stay a `type`, not an `interface`, because only a type
 * alias gets the implicit index signature that `h('input', register(name))`
 * needs to be assignable to Record<string, any>.
 */
export type RegisterProps = {
  name: string;
  onBlur: () => void;
  onFocus: () => void;
  ref?: any;
  /** text/select/textarea, and the option's own value on a radio. */
  value?: any;
  /** checkbox/radio only. */
  checked?: boolean | (() => boolean);
  /** text/select/textarea only. */
  oninput?: (e: any) => void;
  /** checkbox/radio only. */
  onchange?: (e: any) => void;
};

export interface FormState {
  readonly values: Record<string, any>;
  readonly errors: Record<string, FieldError>;
  error: (name: string) => FieldError | null;
  readonly touched: Record<string, boolean>;
  isDirty: () => boolean;
  isValid: Computed<boolean>;
  /** True while the resolver is running. Present since resolvers went async; never declared. */
  isValidating: () => boolean;
  isSubmitting: () => boolean;
  isSubmitted: () => boolean;
  submitCount: () => number;
  dirtyFields: Computed<Record<string, boolean>>;
}

export interface UseFormReturn {
  register: (name: string, options?: Record<string, any>) => RegisterProps;
  handleSubmit: (
    onValid: (values: Record<string, any>) => void | Promise<void>,
    onInvalid?: (errors: Record<string, FieldError>) => void,
  ) => (e?: Event) => Promise<void>;
  setValue: (name: string, value: any, options?: Record<string, any>) => void;
  getValue: (name: string) => any;
  setError: (name: string, error: FieldError | null) => void;
  clearError: (name: string) => void;
  clearErrors: () => void;
  reset: (newValues?: Record<string, any>) => void;
  watch: (name?: string) => Computed<any>;
  validate: (fieldName?: string) => Promise<boolean>;
  formState: FormState;
}

export function useForm(options?: {
  defaultValues?: Record<string, any>;
  mode?: 'onSubmit' | 'onChange' | 'onBlur';
  reValidateMode?: 'onChange' | 'onBlur';
  resolver?: (values: Record<string, any>) => Promise<{ values: Record<string, any>; errors: Record<string, FieldError> }>;
}): UseFormReturn;

export function useField(name: string, options?: {
  validate?: (value: any) => string | null | Promise<string | null>;
  defaultValue?: any;
}): {
  name: string;
  value: () => any;
  error: () => string | null;
  isTouched: () => boolean;
  isDirty: () => boolean;
  setValue: (value: any) => void;
  setError: (error: string | null) => void;
  validate: () => Promise<boolean>;
  reset: () => void;
  inputProps: () => Record<string, any>;
};

export const rules: {
  required: (message?: string) => (value: any) => string | void;
  minLength: (min: number, message?: string) => (value: any) => string | void;
  maxLength: (max: number, message?: string) => (value: any) => string | void;
  min: (min: number, message?: string) => (value: any) => string | void;
  max: (max: number, message?: string) => (value: any) => string | void;
  pattern: (regex: RegExp, message?: string) => (value: any) => string | void;
  email: (message?: string) => (value: any) => string | void;
  url: (message?: string) => (value: any) => string | void;
  match: (field: string, message?: string) => (value: any, values: Record<string, any>) => string | void;
  custom: <T extends (...args: any[]) => any>(validator: T) => T;
};

export function simpleResolver(ruleMap: Record<string, Array<(value: any, values: Record<string, any>) => string | void>>):
  (values: Record<string, any>) => Promise<{ values: Record<string, any>; errors: Record<string, FieldError> }>;

export function zodResolver(schema: { parseAsync: (values: any) => Promise<any> }):
  (values: Record<string, any>) => Promise<{ values: Record<string, any>; errors: Record<string, FieldError> }>;

export function yupResolver(schema: { validate: (values: any, options?: any) => Promise<any> }):
  (values: Record<string, any>) => Promise<{ values: Record<string, any>; errors: Record<string, FieldError> }>;

export function Input(props: Record<string, any>): VNode;
export function Textarea(props: Record<string, any>): VNode;
export function Select(props: Record<string, any>): VNode;
export function Checkbox(props: Record<string, any>): VNode;
export function Radio(props: Record<string, any>): VNode;

export function ErrorMessage(props: {
  name: string;
  formState?: FormState;
  errors?: Record<string, FieldError> | (() => Record<string, FieldError>);
  render?: (args: { message?: string; type?: string }) => VNodeChild;
}): VNode;

// --- Structured Errors ---

export interface ErrorCodeDefinition {
  code: string;
  severity: 'error' | 'warning';
  template: string;
  suggestion: string;
  codeExample?: string;
}

export const ERROR_CODES: Record<string, ErrorCodeDefinition>;

/**
 * Look up a catalogue entry by its `ERR_*` code.
 *
 * Errors thrown outside what-core carry only their code — the suggestion and
 * the worked example live once, in the catalogue, so that the client bundle
 * does not have to ship the prose. This is how they are recovered.
 */
export function getErrorDefinition(code: string): ErrorCodeDefinition | undefined;

export interface WhatErrorJSON {
  code: string;
  message: string;
  suggestion?: string;
  file?: string;
  line?: number;
  component?: string;
  signal?: string;
  effect?: string;
}

export class WhatError extends Error {
  constructor(init: {
    code: string;
    message: string;
    suggestion?: string;
    file?: string;
    line?: number;
    component?: string;
    signal?: string;
    effect?: string;
  });
  code: string;
  suggestion?: string;
  file?: string;
  line?: number;
  component?: string;
  signal?: string;
  effect?: string;
  toJSON(): WhatErrorJSON;
}

export function createWhatError(
  errorCode: string | ErrorCodeDefinition,
  context?: Record<string, any>,
): WhatError;
export function classifyError(err: unknown, context?: Record<string, any>): WhatError;
export function collectError(error: WhatError): void;
export function getCollectedErrors(since?: number): Array<WhatErrorJSON & { timestamp: number }>;
export function clearCollectedErrors(): void;

// --- Guardrails ---

export interface GuardrailConfig {
  signalReadDetection: boolean;
  componentNaming: boolean;
  importValidation: boolean;
}

export function configureGuardrails(overrides: Partial<GuardrailConfig>): void;
export function getGuardrailConfig(): GuardrailConfig;
export function installSignalReadGuardrail<T>(signalFn: T, debugName?: string): T;

// --- Agent Context ---

export interface HealthReport {
  effectCycleRisk: boolean;
  orphanEffects: number;
  signalLeaks: number;
  memoryPressure: 'low' | 'medium' | 'high';
  recentErrorCount: number;
  totalSignals: number;
  totalComponents: number;
}

export function getHealth(): HealthReport;
/** Expose globalThis.__WHAT_AGENT__ for agent tooling (dev mode only). */
export function installAgentContext(): void;

/** Warn when a component function is not PascalCase. Dev-mode only; returns null in production. */
export function checkComponentName(name: string): GuardrailWarning | null;

export interface GuardrailWarning {
  code: string;
  name: string;
  suggestion: string;
}

export interface InvalidImport {
  name: string;
  message: string;
  suggestion: string;
}

/** Report import names that are not valid exports of what-framework. Dev-mode only. */
export function validateImports(importNames: readonly string[]): InvalidImport[];

// --- Agent registries ---
// The devtools bridge and MCP server read these to enumerate the live graph.
// Registration is a no-op in production builds; the getters always return a copy.

export function registerComponent(component: unknown): void;
export function unregisterComponent(component: unknown): void;
export function getMountedComponents(): unknown[];

export function registerSignal(sig: unknown): void;
export function unregisterSignal(sig: unknown): void;
export function getActiveSignals(): unknown[];

// --- Internal cross-package exports ---
// Underscore-prefixed names are not public API and carry no compatibility
// promise. They are declared here because sibling packages in this repo import
// them across the package boundary (what-server, what-text), and an
// undeclared cross-package import is exactly the rename that ships broken:
// `hygiene:types` skips `_`-prefixed names in its reverse direction, so
// nothing else would have caught it. Application code should not use these.

/** @internal Used by what-server. True for `aria-*` and `data-*` attribute names. */
export function _isAriaAttr(name: string): boolean;
/** @internal Used by what-server. Opens an SSR component scope. */
export function _beginComponentSSR(...args: unknown[]): unknown;
/** @internal Used by what-server. Closes the scope opened by `_beginComponentSSR`. */
export function _endComponentSSR(...args: unknown[]): unknown;
/** @internal Used by what-server. The keyed-array mapping `<For>` compiles down to. */
export function _mapArrayToArray(...args: unknown[]): unknown;
/** @internal Used by what-server/node. Installs the Node AsyncLocalStorage backend. */
export function __installServerContextStorage(storage: unknown): void;
/** @internal Used by what-text. Lets the text engine intercept text-node insertion. */
export function _setTextInsertHook(hook: unknown): void;
