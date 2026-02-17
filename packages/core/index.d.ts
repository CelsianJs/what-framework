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

export function signal<T>(initial: T): Signal<T>;
export function computed<T>(fn: () => T): Computed<T>;
export function effect(fn: () => void | (() => void), opts?: { stable?: boolean }): () => void;
export function signalMemo<T>(fn: () => T): Computed<T>;
export function batch<T>(fn: () => T): T;
export function untrack<T>(fn: () => T): T;
export function flushSync(): void;
export function createRoot<T>(fn: (dispose: () => void) => T): T;

// --- Virtual DOM ---

export type PrimitiveChild = string | number | boolean | null | undefined;
export type VNodeChild = PrimitiveChild | VNode | (() => VNodeChild) | VNodeChild[];

export type Component<P = {}> = (props: P & { children?: VNodeChild }) => VNodeChild;

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

export function Fragment(props: { children?: VNodeChild }): VNodeChild;
export function html(strings: TemplateStringsArray, ...values: any[]): VNode | VNode[];

// --- DOM ---

export function mount(vnode: VNodeChild, container: string | Element): () => void;

// Fine-grained rendering primitives
export function template(html: string): () => Element;
export function insert(parent: Node, child: any, marker?: Node | null): any;
export function mapArray<T>(
  source: () => T[],
  mapFn: (item: T | Signal<T>, index: number) => Node,
  options?: { key?: (item: T) => string | number; raw?: boolean },
): (parent: Node, marker?: Node | null) => Node;
export function spread(el: Element, props: Record<string, any>): void;
export function delegateEvents(eventNames: string[]): void;
export function on(el: Element, event: string, handler: (e: Event) => void): () => void;
export function classList(el: Element, classes: Record<string, boolean | (() => boolean)>): void;

// --- Hooks ---

export function useState<T>(initial: T | (() => T)): [T, (value: Updater<T>) => void];
export function useSignal<T>(initial: T | (() => T)): Signal<T>;
export function useComputed<T>(fn: () => T): Computed<T>;
export function useEffect(fn: () => void | (() => void), deps?: unknown[]): void;
export function useMemo<T>(fn: () => T, deps?: unknown[]): T;
export function useCallback<T extends (...args: any[]) => any>(fn: T, deps?: unknown[]): T;
export function useRef<T>(initial: T): { current: T };

export interface Context<T> {
  _defaultValue: T;
  Provider: Component<{ value: T; children?: VNodeChild }>;
}

export function createContext<T>(defaultValue: T): Context<T>;
export function useContext<T>(context: Context<T>): T;
export function useReducer<S, A>(
  reducer: (state: S, action: A) => S,
  initialState: S,
  init?: (initial: S) => S,
): [S, (action: A) => void];
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
}): VNodeChild;

export function For<T>(props: {
  each: T[] | (() => T[]);
  fallback?: VNodeChild;
  children: ((item: T, index: number) => VNodeChild) | VNodeChild;
}): VNodeChild;

export function Switch(props: {
  fallback?: VNodeChild;
  children?: VNodeChild;
}): VNodeChild;

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

export type DerivedFn<T> = ((state: any) => T) & { _isDerived: true };
export function derived<T>(fn: (state: any) => T): DerivedFn<T>;
export function storeComputed<T>(fn: (state: any) => T): DerivedFn<T>;
export type StoreDefinition = Record<string, any>;
export type Store<T extends StoreDefinition> = T;
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

export interface SpringValue {
  current(): number;
  set(value: number): void;
  stop(): void;
  reset(): void;
}

export function spring(initialValue?: number, config?: Record<string, any>): SpringValue;
export function tween(initialValue?: number, config?: Record<string, any>): SpringValue;
export const easings: Record<string, (t: number) => number>;
export function useTransition(options?: Record<string, any>): {
  mounted: Signal<boolean>;
  styles: Computed<Record<string, any>>;
  show: () => void;
  hide: () => void;
};
export function useGesture(ref: { current?: Element | null } | Element, handlers?: Record<string, (payload: any) => void>): void;
export function useAnimatedValue(initialValue?: number): {
  value: Signal<number>;
  animateTo: (target: number, config?: Record<string, any>) => Promise<void>;
  stop: () => void;
};
export function createTransitionClasses(name: string): string;
export function cssTransition(config: Record<string, any>): Record<string, any>;

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

export function useRovingTabIndex(itemCountOrSignal: number | (() => number)): {
  focusIndex: () => number;
  setFocusIndex: (index: number) => void;
  getItemProps: (index: number) => Record<string, any>;
  containerProps: () => Record<string, any>;
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

export function Skeleton(props?: Record<string, any>): VNodeChild;
export function SkeletonText(props?: Record<string, any>): VNode;
export function SkeletonAvatar(props?: Record<string, any>): VNodeChild;
export function SkeletonCard(props?: Record<string, any>): VNode;
export function SkeletonTable(props?: Record<string, any>): VNode;
export function IslandSkeleton(props?: Record<string, any>): VNodeChild;
export function useSkeleton<T>(asyncFn: () => Promise<T> | T, deps?: unknown[]): {
  isLoading: () => boolean;
  data: () => T | null;
  error: () => any;
  Skeleton: (props?: Record<string, any>) => VNodeChild;
};
export function Placeholder(props?: Record<string, any>): VNode;
export function LoadingDots(props?: Record<string, any>): VNode;
export function Spinner(props?: Record<string, any>): VNode;

// --- Data Fetching ---

export function useFetch<T = any>(url: string, options?: Record<string, any>): {
  data: () => T;
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

export function useQuery<T = any>(options: Record<string, any>): {
  data: () => T | null;
  error: () => any;
  status: () => string;
  isLoading: () => boolean;
  isFetching: () => boolean;
  isError: () => boolean;
  isSuccess: () => boolean;
  refetch: () => Promise<T | void>;
};

export function useInfiniteQuery<T = any>(options: Record<string, any>): {
  data: () => T[];
  error: () => any;
  status: () => string;
  isLoading: () => boolean;
  isFetchingNextPage: () => boolean;
  hasNextPage: () => boolean;
  fetchNextPage: () => Promise<void>;
  refetch: () => Promise<void>;
};

export function invalidateQueries(
  keyOrPredicate: string | ((key: string) => boolean),
  options?: { exact?: boolean },
): Promise<void>;

export function prefetchQuery<T = any>(key: string, fetcher: (key: string) => Promise<T>): Promise<T>;
export function setQueryData<T = any>(key: string, updater: T | ((prev: T | null) => T)): void;
export function getQueryData<T = any>(key: string): T | null;
export function clearCache(): void;

// --- Forms ---

export interface FieldError {
  type?: string;
  message?: string;
  [key: string]: any;
}

export interface RegisterProps {
  name: string;
  value: any;
  onInput: (e: any) => void;
  onBlur: () => void;
  onFocus: () => void;
  ref?: any;
}

export interface FormState {
  readonly values: Record<string, any>;
  readonly errors: Record<string, FieldError>;
  readonly touched: Record<string, boolean>;
  isDirty: () => boolean;
  isValid: Computed<boolean>;
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
}): VNodeChild;
