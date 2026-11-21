// What Framework - TypeScript Definitions
//
// The root entry. Domain kits are declared beside it (a11y.d.ts, ui.d.ts,
// motion.d.ts, dom.d.ts, form.d.ts, data.d.ts), the compiled-JSX runtime in
// render.d.ts, and what sibling packages share in internal.d.ts.

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
  /**
   * Change the value in place: `fn` receives the current value (an array or
   * object to modify), then every reader is notified as a write would notify
   * them, batched the same way, although the reference did not change. A
   * computed that returns the value itself, or anything else equal to its last
   * result, recomputes but does not notify its own readers: derive a new value
   * (a copy, a length, a field) where a computed must see the change.
   */
  mutate(fn: (value: T) => void): void;
  _signal: true;
}

export interface Computed<T> {
  (): T;
  peek(): T;
  _signal: true;
}

/**
 * What computed() returns: a computed that may be async (its function returned
 * a promise or an async iterable).
 */
export interface AsyncComputed<T> extends Computed<T> {
  /**
   * Read the value. For an async computed: in a binding, an effect or a
   * computed, a value that has not landed, or is being fetched again, holds
   * the reader, which keeps what it shows and runs again when the value lands;
   * elsewhere (a handler, a component body) it is the last value that landed,
   * and a read before the first one suspends the component.
   */
  (): T;
  /**
   * The value without subscribing. For an async computed: the last value that
   * landed, or undefined before the first; it never throws or suspends.
   */
  peek(): T;
  /**
   * True while this value, or an async value it is computed from, has a value
   * and is fetching a new one (a changed input, or refresh()). False on first
   * load. Reactive: read it in JSX, `{users.pending() && <Spinner />}`.
   */
  pending(): boolean;
}

/** What a computed's function receives when it takes an argument. */
export interface ComputedRun {
  /** Aborted when a newer run supersedes this one, or the computed is disposed. */
  signal: AbortSignal;
}

/** A value an async computed's function may return. */
export type AsyncResult<T> = PromiseLike<T> | AsyncIterable<T>;

export function signal<T>(initial: T, debugName?: string): Signal<T>;
/**
 * A derived value, recomputed when read after what it reads changed. Its
 * function may return a promise, a thenable or an async iterable: the
 * computed is then an async value. It starts when created (an async function,
 * or one that takes `{ signal }`) or when first read, keeps its last value
 * while a newer run is in flight, supersedes and aborts older runs, and its
 * readers hold until it lands. See docs/ASYNC.md.
 */
export function computed<T>(fn: (run: ComputedRun) => AsyncResult<T>): AsyncComputed<T>;
export function computed<T>(fn: (run: ComputedRun) => T): AsyncComputed<T>;
/**
 * Run an async computed again now, superseding a run in flight. Its readers
 * see it as pending (once it has a value) until the new value lands. Resolves
 * with the value when it lands, rejects with its error.
 */
export function refresh<T>(computed: AsyncComputed<T>): Promise<T>;
/**
 * True while an async value `fn` reads (directly or through computeds) has a
 * value and is fetching a new one; false on first load. Tracked like a read.
 */
export function isPending(fn: () => unknown): boolean;
/**
 * Hold everything the writes inside `fn` reach until the async work they
 * started has landed, then commit it in one flush. Writes outside `fn` commit
 * as usual; writes after an `await` in `fn` are ordinary writes, as in React.
 * Resolves when the transition commits; rejects with an async `fn`'s error.
 * Inside an async action it commits with, it resolves once only the action
 * keeps the commit waiting, so the action can await it.
 */
export function startTransition(fn: () => void | Promise<unknown>): Promise<void>;
/**
 * React's useTransition. `isPending` is an ACCESSOR, not a boolean: call it,
 * `isPending()`, true from the call to `startTransition` until that
 * transition commits. `{isPending() && <Spinner />}` in JSX updates;
 * `{isPending && ...}` is always truthy. A rejected action shows in the
 * <ErrorBoundary> above the component, as in React 19; the returned promise
 * rejects too.
 */
export function useTransition(): [isPending: () => boolean, startTransition: (fn: () => void | Promise<unknown>) => Promise<void>];
/**
 * React 19's useOptimistic. `state` is an accessor (a signal, a computed) or a
 * plain value: pass `likes`, not `likes()`, which is read once. `optimistic` is
 * an ACCESSOR: `optimistic()` is `state` with the overlays added by
 * `addOptimistic(value)` applied through `update` (or replacing it, without
 * `update`). Each overlay lasts as long as the transition it was added in and
 * drops when that commits, in the same flush as the real result. Call
 * `addOptimistic` synchronously inside startTransition.
 */
export function useOptimistic<S>(state: Signal<S> | Computed<S> | (() => S)): [optimistic: () => S, addOptimistic: (value: S) => void];
export function useOptimistic<S, A>(state: Signal<S> | Computed<S> | (() => S), update: (current: S, value: A) => S): [optimistic: () => S, addOptimistic: (value: A) => void];
export function useOptimistic<S>(state: S): [optimistic: () => S, addOptimistic: (value: S) => void];
export function useOptimistic<S, A>(state: S, update: (current: S, value: A) => S): [optimistic: () => S, addOptimistic: (value: A) => void];
/**
 * React 19's useActionState: `[state, dispatch, isPending]`, where `state` and
 * `isPending` are ACCESSORS. `dispatch(payload)` runs
 * `action(previousState, payload)` inside a transition; dispatches queue,
 * each receiving the state the previous one returned. The new state commits
 * with the transition, in the same flush as the data its action revalidated.
 * An action that throws reaches the nearest <ErrorBoundary> and drops the
 * dispatches queued behind it. `permalink` is where a <Form> posts before
 * JavaScript has loaded.
 */
export function useActionState<S, P = FormData>(
  action: (previousState: S, payload: P) => S | Promise<S>,
  initialState: S,
  permalink?: string,
): [state: () => S, dispatch: ((payload: P) => void) & { permalink?: string }, isPending: () => boolean];
/** What useFormStatus() returns: the submission of the <Form> around the component. */
export interface FormStatus {
  /** True from a submit until its transition commits, while any submission is pending. */
  pending: () => boolean;
  /** The FormData of the latest submission still pending, or null. */
  data: () => FormData | null;
  /** The form's method, or null outside a <Form>. */
  method: string | null;
  /** The form's action function, or null: for an action id (as React's is for a URL), and outside a <Form>. */
  action: ((...args: any[]) => any) | null;
}
/** React 19's useFormStatus: the submission of the <Form> (what-server) this component renders in. */
export function useFormStatus(): FormStatus;
/**
 * React 19's use(). A context reads like useContext. A promise returns its
 * value once settled, or suspends the component until it settles: it must be
 * made outside the component. An accessor (an async computed) is read like
 * an untracked read, suspending the component while it has no value.
 */
export function use<T>(value: Context<T> | PromiseLike<T> | (() => T)): T;
/**
 * Resolves once nothing is queued to run, no async computed is fetching, no
 * transition is open and no <Suspense> waits on a promise. For tests and
 * agents: act, `await settled()`, then read the DOM.
 */
export function settled(): Promise<void>;
export interface EffectOptions {
  /** Re-runs skip dependency tracking and keep the first run's dependencies. */
  stable?: boolean;
  /**
   * `'render'` (default) or `'user'`. In a flush, user-phase effects re-run
   * only once no render-phase effect is queued, so they observe settled
   * bindings. The first run is synchronous either way.
   */
  phase?: 'render' | 'user';
}

export function effect(fn: () => void | (() => void), opts?: EffectOptions): () => void;
/**
 * O(1) keyed selection. `isSelected(key)` is `key === source()`, but a reader
 * depends on its key rather than on `source`: when the source moves from a to b,
 * only the readers that asked about a or b re-run. The compiler rewrites
 * `sel() === row.id` inside keyed `.map()` rows to use one automatically.
 */
export function createSelector<T>(source: () => T): (key: T) => boolean;
/**
 * Group signal writes so effects run once, when the outermost batch ends.
 * Returns the callback's value.
 */
export function batch<T>(fn: () => T): T;
export function untrack<T>(fn: () => T): T;
export function flushSync(): void;
export function createRoot<T>(fn: (dispose: () => void) => T): T;

declare const ownerBrand: unique symbol;

/**
 * Opaque ownership scope handle: getOwner() is the only way to obtain one.
 * Pair with runWithOwner() for async work. `disposals` holds what the scope
 * disposes: cleanup functions and internal effect and computed nodes.
 */
export interface Owner {
  readonly [ownerBrand]: true;
  disposals: unknown[];
}

export function getOwner(): Owner | null;
export function runWithOwner<T>(owner: Owner | null, fn: () => T): T;

// --- Virtual DOM ---

export type PrimitiveChild = string | number | boolean | null | undefined;

// `VNode<any>`, not `VNode`. VNode is invariant in P (its `tag` holds a
// `Component<P>`, whose parameter position is contravariant under
// strictFunctionTypes), so `VNode` — which means `VNode<Record<string, any>>` —
// rejects every specifically-typed node. `h('div', {}, h('h1', { style: '' }))`
// did not compile for any TypeScript user before 0.12.5, and neither did
// passing that tree to mount().
export type VNodeChild = PrimitiveChild | VNode<any> | (() => VNodeChild) | VNodeChild[];

/** Components may return renderable children, including reactive thunks and arrays. */
export type Component<P = {}> = ((props: P & { children?: VNodeChild }) => VNodeChild) & {
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

/**
 * An element or component description made by h(), the JSX runtime or a
 * boundary. Renderers recognise one by a private brand only those producers
 * give, so an object of this shape built any other way (from JSON, say)
 * renders as text.
 */
export interface VNode<P = Record<string, any>> {
  tag: string | Component<P>;
  props: P;
  children: VNodeChild[];
  key: string | number | null;
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

/**
 * Adopt server-rendered DOM as the DOM of `vnode`: bindings, events and
 * components attach to the nodes the server wrote. Returns the unmount
 * function, as mount() does. `options.onHydrationError` is called for every
 * mismatch, in production too.
 */
export function hydrate(
  vnode: VNodeChild,
  container: string | Element,
  options?: { onHydrationError?: (mismatch: { kind: string; component: string; ownerPath: string | null; path: string; expected: string; found: string; recovery: string }) => void },
): () => void;

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
/** computed() as a hook: it may be async, like computed(). */
export function useComputed<T>(fn: (run: ComputedRun) => AsyncResult<T>): AsyncComputed<T>;
export function useComputed<T>(fn: (run: ComputedRun) => T): AsyncComputed<T>;
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
 * A promise the callback returns stays a promise, as in React: read it with
 * use(), or make the value an async computed with computed().
 *
 * It was declared as `T`, which inverted both halves: `useMemo(...) * 2`
 * type-checked and produced NaN, while the correct `useMemo(...)()` was the
 * type error.
 */
export function useMemo<T>(fn: () => T, deps?: unknown[]): Computed<T>;
export function useCallback<T extends (...args: any[]) => any>(fn: T, deps?: unknown[]): T;
export function useRef<T>(initial: T): { current: T };

/**
 * A context is its own provider, as in React 19: `<Ctx value={v}>` and
 * `<Ctx.Provider value={v}>` render the same component. `displayName` names it
 * in diagnostics.
 */
export interface Context<T> extends Component<{ value: T; children?: VNodeChild }> {
  _defaultValue: T;
  Provider: Context<T>;
  Consumer: Component<{ children: (value: T) => VNodeChild }>;
  displayName?: string;
}

/**
 * Called with no argument, the value must come from a provider: in development,
 * reading it with none above reports ERR_CONTEXT_NOT_PROVIDED.
 */
export function createContext<T>(defaultValue: T): Context<T>;
export function createContext<T>(): Context<T | undefined>;
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
/**
 * Run `fn` when the current scope goes away: the component being rendered, on
 * unmount, or else the reactive owner around the call (createRoot, a list row,
 * a mount root). With neither, development reports ERR_CLEANUP_WITHOUT_OWNER;
 * an effect's per-run cleanup is the function the effect returns.
 */
export function onCleanup(fn: () => void): void;
/** A string, stable for the component's life: the component runs once. */
export function useId(prefix?: string): string;

/**
 * `data` is an async computed: reading it before its first value lands holds
 * the reader (a <Suspense> above shows its fallback), and in a server render
 * the component suspends until it settles. `loading()` is true while it has
 * no value or is fetching; `error()` is the last run's error or null;
 * `refetch(source)` fetches again (it never rejects); `mutate(value)` sets the
 * value now, superseding a fetch in flight.
 */
export function createResource<T = any, S = any>(
  fetcher: (source: S, ctx: { signal: AbortSignal }) => Promise<T> | T,
  options?: { initialValue?: T; source?: S; key?: string },
): [AsyncComputed<T>, {
  loading: () => boolean;
  error: () => any;
  refetch: (source?: S) => Promise<void>;
  mutate: (value: T | ((current: T | undefined) => T)) => void;
}];

// --- Components ---

export function lazy<P>(
  loader: () => Promise<{ default: Component<P> } | Component<P>>,
): Component<P>;
export function memo<P>(component: Component<P>, areEqual?: (prev: P, next: P) => boolean): Component<P>;

/**
 * Shows `fallback` until its children have first shown: while a binding under
 * it waits for an async value that has not landed (one computed from another
 * async value included), or a component under it has suspended (lazy(),
 * use()). After that an async value never brings the fallback back: a refresh
 * keeps the children mounted, their bindings holding what they show until the
 * new value lands. A component that suspends again (a lazy() chunk,
 * use(promise)) does, and the children stay mounted behind it; a transition
 * does not hold that. onMount and useEffect under it first run when its
 * children first show. A server-rendered one is adopted by hydrate() as it is.
 */
export function Suspense(props: {
  fallback: VNodeChild;
  children?: VNodeChild;
}): VNode;

/**
 * Shows `fallback` when its children throw, while they are built or later
 * (an effect, a binding, an async value that rejected, a useTransition action
 * of a component under it that rejected). `reset()` fetches again the async
 * value runs whose errors it caught and builds the children again.
 */
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

/**
 * A list: `each` is an accessor (a signal, a computed) or an array. With
 * `key`, each row is built once per key and gets its item as an accessor,
 * `item()`, which follows an item replaced under the same key; without it, a
 * row gets the item itself and a new item is a new row. `.map()` with a `key`
 * prop is the usual form in compiled JSX.
 */
export function For<T>(props: {
  each: readonly T[] | (() => readonly T[] | null | undefined);
  key: (item: T) => unknown;
  fallback?: VNodeChild;
  children: (item: () => T, index: number) => VNodeChild;
}): VNode;
export function For<T>(props: {
  each: readonly T[] | (() => readonly T[] | null | undefined);
  key?: undefined;
  fallback?: VNodeChild;
  children: (item: T, index: number) => VNodeChild;
}): VNode;

export function Switch(props: {
  fallback?: VNodeChild;
  children?: VNodeChild;
}): VNode;

export function Match(props: {
  when: boolean | (() => boolean);
  children?: VNodeChild;
}): VNode;

export function Portal(props: { target: string | Element; children?: VNodeChild }): VNode | null;

// --- State ---

/** `_storeComputed` is the marker createStore() actually reads to tell a derived value from an action. */
export type DerivedFn<T> = ((state: any) => T) & { _storeComputed: true };
export function derived<T>(fn: (state: any) => T): DerivedFn<T>;
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

// --- Head ---

/**
 * Set document head tags from any component, on the client and in a server
 * render. `<title>`, `<meta>` and `<link>` children set the same tags as the
 * props: `<Head><title>Docs</title></Head>` is `<Head title="Docs" />`. A meta
 * is keyed by `name`, `property` or `httpEquiv`, a link by `rel` + `href`; the
 * later of two with one key wins, and within one Head a child wins over a prop.
 * Any other child renders in place.
 */
export function Head(props: {
  title?: string;
  meta?: Record<string, string> | Array<Record<string, string>>;
  link?: Record<string, string> | Array<Record<string, string>>;
  children?: VNodeChild;
}): null;

// --- Loader Data ---

export function useLoaderData<T = any>(): T | undefined;
/**
 * Swap streamed boundaries whose content has arrived into place. Call it from
 * the client entry, before hydrating, on a page streamed with `noScripts`.
 * Returns the number of boundaries swapped.
 */
export function applyStreamedBoundaries(): number;

// --- Server response ---


/** The HTTP response of a server render, as components see it. */
export interface ServerResponse {
  /** The status the response will be sent with. */
  readonly status: number;
  /** Where redirect() pointed, or null. */
  readonly location: string | null;
  /** True once the shell has been sent: status and headers are final. */
  readonly committed: boolean;
  /** Set the status code. No effect once committed. */
  setStatus(code: number): void;
  /** Set (or with `append`, add) a header. Set-Cookie always appends. No effect once committed. */
  setHeader(name: string, value: string, options?: { append?: boolean }): void;
  /**
   * Redirect to a same-origin path such as "/login" (302 by default). Before
   * the shell is sent this is a real 3xx; after it, the browser is sent a script
   * that replaces the location. Any other target (an absolute URL, "//host",
   * "/\\host", javascript:) is refused: the response redirects to "/" instead,
   * and development logs ERR_SSR_UNSAFE_REDIRECT. Throws a RangeError for a
   * status that is not a redirect status.
   */
  redirect(location: string, status?: 301 | 302 | 303 | 307 | 308): void;
  /**
   * Redirect off the site, to an absolute http: or https: URL with no
   * credentials. A target that is not one is refused like redirect()'s.
   */
  redirectExternal(url: string, status?: 301 | 302 | 303 | 307 | 308): void;
}

/**
 * The response of the server render in progress. On the client, or outside a
 * render, an inert object whose methods do nothing.
 */
export function getResponse(): ServerResponse;

// The context of one server render (loader data, head sink, resources, the
// response), which what-server's renderToStringAsync takes and returns. It is
// public from here; what-core/internal declares it beside the functions that
// read and set it.
export type { ServerContext } from './internal.js';

// --- Structured Errors ---

export interface ErrorCodeDefinition {
  code: string;
  severity: 'error' | 'warning';
  template: string;
  suggestion: string;
  codeExample?: string;
}


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
  severity: 'error' | 'warning';
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
    /** Defaults to `'error'`: the class does not read the catalogue (see getErrorDefinition). */
    severity?: 'error' | 'warning';
    message: string;
    suggestion?: string;
    file?: string;
    line?: number;
    component?: string;
    signal?: string;
    effect?: string;
  });
  code: string;
  severity: 'error' | 'warning';
  suggestion?: string;
  file?: string;
  line?: number;
  component?: string;
  signal?: string;
  effect?: string;
  toJSON(): WhatErrorJSON;
}

// --- Diagnostics channel ---
// Development checks report coded events here; this is the read side.

export interface DiagnosticSubject {
  kind: string;
  id?: string | number;
  name?: string;
}

export interface DiagnosticEvent {
  /** Monotonic sequence number; a repeat moves the event to a newer seq. */
  seq: number;
  code: string;
  severity: 'error' | 'warning';
  message: string;
  /** The catalogue suggestion for this code. */
  fix: string;
  /** Owner path, root first, e.g. ['<App>', '<TodoRow>', 'effect "sync"']. Empty when unknown. */
  owner: string[];
  /** Source location 'file:line:col' when the compiler supplied one. */
  loc: string | null;
  subject: DiagnosticSubject | null;
  data: Record<string, any>;
  /** Repeats of this code on this subject, folded into one event. */
  count: number;
}


/** Listen to every report, repeats included. Returns an unsubscribe function. */
export function subscribeDiagnostics(listener: (event: DiagnosticEvent) => void): () => void;
/** Events with seq greater than `since`, oldest first; pass the returned seq back as the next `since`. */
export function getDiagnostics(options?: { since?: number }): { events: DiagnosticEvent[]; seq: number; dropped: number };
/** Forget buffered events and console pointers. */
export function clearDiagnostics(): void;

// Only what is exported above is public. Without this, a declaration file
// exports every top-level declaration, `ownerBrand` included, and an Owner
// could be forged.
export {};
