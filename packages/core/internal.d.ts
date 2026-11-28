// what-core/internal: what what-core shares with its sibling packages and tools
// (what-server, what-devtools, what-devtools-mcp). Not for applications, and
// not covered by semver.
import type { DiagnosticEvent, DiagnosticSubject, ErrorCodeDefinition, ServerResponse, VNode, WhatError } from './index.js';
export { getDiagnostics, subscribeDiagnostics } from './index.js';

// --- Devtools ---

/** @internal Installs the devtools hooks the reactive engine calls in development. */
export function __setDevToolsHooks(hooks: Record<string, unknown> | null): void;
/** @internal Hands devtools what was created before they installed, then clears it. */
export function __drainPreinstallBuffer(): { signals: unknown[]; effects: unknown[]; components: unknown[]; dropped?: Record<string, number> };
/** @internal Emits a development action event. */
export function _devAction(data: { name: string; outcome: "ok" | "error"; invalidated: string[]; revalidated: string[] }): void;
/** @internal The sources a computation reads (development only; empty in production). */
export function __depsOf(node: unknown): unknown[];
/** @internal The computations that read a source (development only; empty in production). */
export function __subsOf(node: unknown): unknown[];
/** @internal The effect running now, or null (development only). */
export function __currentEffect(): unknown;
/**
 * @internal The owner of an effect or computed node (or computed function), of
 * an owner, or of a DOM node: the component whose output holds it (development
 * only; null in production).
 */
export function __ownerOf(node: unknown): unknown;
/**
 * @internal The scopes holding `node`, root first: `'<App>'`, `'<TodoRow>'`,
 * `'effect "sync"'`. `loc` is the innermost source location the compiler
 * supplied, else null (development only; empty in production).
 */
export function __ownerPath(node: unknown): string[] & { loc: string | null };
/** @internal The query cache, for what-devtools-mcp's what_cache. */
export function __getCacheSnapshot(): Array<{
  key: string;
  kind: 'query' | 'infinite';
  status: 'idle' | 'loading' | 'refreshing' | 'success' | 'error';
  data: unknown;
  error: string | null;
  isValidating: boolean;
  observers: number;
  updatedAt: number | null;
  fetches: number;
  lastFetch: { at: number; ms: number; ok: boolean } | null;
  version: number;
  paths: string[];
}>;
/** @internal what_invalidate_cache: invalidate the entries under `key` (every entry when omitted); returns the keys matched. */
export function __invalidateFromDevtools(key?: string | readonly unknown[]): string[];
/** @internal what-server: the keys (`query:KEY`) of the landed entries render context `ctx`'s loader filled; that render's hooks show them. */
export function _loadedQueries(ctx: object): string[];
/** @internal what-router: run `fn`, tagging the entries its queries read with `path` for invalidatePath(path). */
export function _tagQueries<T>(path: string, fn: () => T): T;
/** @internal what-router: run `fn` outside the running transition, so what it writes shows at once. */
export function _urgent(fn: () => void): void;
/** @internal what-router: the transition whose function is running, or null. */
export function _currentTransition(): object | null;
/** @internal what-router: run `fn` inside transition `t`'s commit. */
export function _onCommit(t: object, fn: () => void): void;
/** @internal what-router: resolves once no query read on `path` is fetching its first value. */
export function _pathLoaded(path: string): Promise<void>;
/** @internal what-router: the context map of the nearest owner above the current one that provides `key` (with _provide), or null. */
export function _contextOf(key: unknown): Map<unknown, unknown> | null;
/** @internal what-router: provide `value` under `key` on the current owner, for what it owns to find with _contextOf. */
export function _provide(key: unknown, value: unknown): void;
/** @internal Whether this is a development build: false in a production bundle, where the branches it guards fold away. */
export const __DEV__: boolean;
/** @internal what-server's <Form>: the context its status is provided in. */
export function _formStatusContext(): any;
/** @internal what-server's <Form>: a form's status, with `submit(formData, run, reset)` running one submission as a transition, and `reset()` at its commit if the submission succeeded. */
export function _formStatus(method: string | null, action: unknown): import('./index.js').FormStatus & {
  submit(formData: FormData, run: (formData: FormData) => unknown, reset: () => void): Promise<void>;
};

export interface DiagnosticDetail {
  data?: Record<string, any>;
  subject?: DiagnosticSubject | null;
  owner?: string[];
  loc?: string | null;
}

/** Report a diagnostic by its ERR_* code. Call it only behind a development check. */
export function reportDiagnostic(code: string, detail?: DiagnosticDetail): DiagnosticEvent;
/**
 * Development: the message of an error thrown with a catalogue code, in the
 * shape the console prints a reported one: `[what] <code> <message>`, then the
 * line naming its fix.
 */
export function _thrownMessage(code: string, message: string): string;

// --- Guardrails ---

export interface GuardrailConfig {
  importValidation: boolean;
}

export function configureGuardrails(overrides: Partial<GuardrailConfig>): void;
export function getGuardrailConfig(): GuardrailConfig;

export interface InvalidImport {
  name: string;
  message: string;
  suggestion: string;
}

/** Report import names that are not valid exports of what-framework. Dev-mode only. */
export function validateImports(importNames: readonly string[]): InvalidImport[];

// --- Error catalogue ---

export const ERROR_CODES: Record<string, ErrorCodeDefinition>;

export function createWhatError(
  errorCode: string | ErrorCodeDefinition,
  context?: Record<string, any>,
): WhatError;
export function classifyError(err: unknown, context?: Record<string, any>): WhatError;

// --- Import changes ---

/** Where a name the root entry dropped in 0.15 went. `to` is null when it was removed. */
export interface ImportChange {
  name: string;
  to: string | null;
  as?: string;
  note: string;
  /** What an import of `name` from the root entry is told: the note, then the import to write. */
  answer: string;
  /** A name the root entry exports again with React's meaning: only an import of `as` from it is answered. */
  onRoot?: true;
  /** An internal interface new in 0.15 that the root entry never exported. */
  neverOnRoot?: true;
}
export const IMPORT_CHANGES: readonly ImportChange[];
/** Where each name a subpath exports, and the root entry never did, lives (`Router` in what-framework/router). */
export const SUBPATH_ONLY: readonly ImportChange[];

// --- Server context ---

/** Per-render head accumulator used by the SSR renderer. */
export interface HeadSink {
  title: string | null;
  metas: Map<string, Record<string, string>>;
  links: Map<string, Record<string, string>>;
}

export function beginHeadCollection(): HeadSink;
export function endHeadCollection(sink: HeadSink | null): string;

/** A resource's state in a render context: pending, settled with a value, or failed. */
export type ServerResourceEntry =
  | { status: 'pending'; promise: Promise<void>; owner?: string }
  | { status: 'ready'; value: unknown; owner?: string }
  | { status: 'error'; error: unknown; owner?: string };

export interface ServerContext {
  loaderData?: any;
  head?: HeadSink;
  /** Resources created with a `key`, by key. */
  resources?: Map<string, ServerResourceEntry>;
  /** Keyless resources, by owner key; `owner` names the component that made each. */
  owned?: Map<string, ServerResourceEntry>;
  /** Island stores of this render, by name. */
  islandStores?: Map<string, any>;
  /** Aborts when the render stops: the client went away or the stream's consumer stopped reading. */
  signal?: AbortSignal;
  request?: any;
  response?: ServerResponse;
  /** The path the render's app is served below ('/app'), or '': what-router renders below it when the app set no base of its own. */
  base?: string;
  /** The reactive root that owns every effect and computed this render's components create. */
  owner?: unknown;
  [key: string]: any;
}

/** The active render context, or null on the client / outside a render. */
export function getServerContext(): ServerContext | null;
/** Set the active context and return the previous one so callers can restore it. */
export function setServerContext(ctx: ServerContext | null): ServerContext | null;
export function runWithServerContext<T>(ctx: ServerContext, fn: () => T): T;

// --- Server rendering ---
// Underscore-prefixed names are declared even though `hygiene:types` skips them
// in its reverse direction, because what-server imports them across the package
// boundary, and an undeclared cross-package import is exactly the rename that
// ships broken.

/** @internal Used by what-server. True for `role` and `aria-*` attribute names. */
export function _isAriaAttr(name: string): boolean;
/** @internal Used by what-server. Makes an SSR component frame (an owner) current and returns it. */
export function _beginComponentSSR(...args: unknown[]): { _parentCtx: unknown; [key: string]: unknown };
/** @internal Used by what-server. Restores the owner that was current before `_beginComponentSSR`. */
export function _endComponentSSR(...args: unknown[]): unknown;
/** @internal Used by what-server. Runs one synchronous call with an SSR component frame as the owner. */
export function _runInComponentSSR(...args: unknown[]): unknown;
/** @internal Used by what-server. Escapes `& < > " '` for HTML text and attribute values. */
export function _escapeHtml(str: string): string;
/** @internal Used by what-server. Gives an SSR component frame its owner path (hydration keys); false for a built-in the compiler lowers away, which takes no step and no key. */
export function _assignOwnerPath(...args: unknown[]): boolean;
/** @internal Used by what-server. The object that counts a frame's child components and keyless resources (its parent's for a lowered built-in). */
export function _ownerCounter(frame: unknown, root: unknown): { _ownerChildren?: number; _ownerResources?: number; [key: string]: unknown };
/** @internal Used by what-server. The owner path of the component frame running now, or undefined. */
export function _currentOwnerPath(): string | undefined;
/** @internal Used by what-server. The identity of the server action's useActionState being made now, written under a salt: the keys of the keyed rows around it (as digests) and its place below the innermost, or its owner path and its place in the component when no keyed row is around it. The same on the server and while hydrating; null elsewhere. */
export function _actionStateKey(): (((salt: string | null) => string) & { salted: boolean }) | null;
/** @internal Used by what-server. The salt an action-state key was made under, or null. */
export function _actionKeySalt(key: unknown): string | null;
/** @internal Used by what-server's <Island>. The keyed rows around the component rendering now and its steps below them, under `salt`, or null. */
export function _currentRowPath(salt: string): string | null;
/** @internal Used by what-server's renderers. A keyed row begins in the output of `frame` (undefined: the current component; null: the root `root`), or with a null `list` and a number `key` the slot of that member of the children being walked; returns what _leaveRow puts back. */
export function _enterRow(frame: object | null | undefined, root: object, list: object | null, key: unknown, index?: number): unknown;
/** @internal Used by what-server's renderers. Whether keyed rows are installed: the renderers enter slots only then. */
export function _tracksRows(): boolean;
/** @internal Used by what-server's action(). Hydration enters keyed rows from now on, for useActionState keys. */
export function _installRowKeys(): void;
/** @internal Used by what-server's renderers. The row or slot _enterRow entered is done. */
export function _leaveRow(frame: object | null | undefined, root: object, saved: unknown): void;
/** @internal Used by what-server. The salt the render running now writes its keyed rows' digests under. */
export function _renderSalt(): string;
/** @internal Used by what-server. The hydration data merged from the page's data elements, or null. */
export function __readHydrationData(): Record<string, any> | null;
/** Whether a hydrate() walk is claiming the server's DOM now (what-framework/render's isHydrating). */
export function isHydrating(): boolean;
/** While hydrating: the server's region at the cursor, taken whole for another renderer ([open, close] markers), or null. */
export function _claimRegion(): [Comment, Comment] | null;
/** Run `fn` once the hydration walking now is done; false when none is. */
export function _afterWalk(fn: () => void): boolean;
/** Development: the component running now holds state outside What's signals (what-react's islands), for ERR_REBUILT_COMPONENT. */
export function _devHoldsState(): void;
/** Development: the region running now shows something else than its last run did (what-router's next route), for ERR_REBUILT_COMPONENT. */
export function _devNewContent(): void;
/**
 * Whether `value` is a vnode made by h(), the JSX runtime or a boundary: the
 * private brand those producers give it, which JSON, structuredClone and
 * proxies cannot carry. Every renderer decides "element or text" by this.
 */
export function isVNode(value: unknown): value is VNode<any>;
/** @internal Development: a Symbol given as a child, which renders nothing (ERR_SYMBOL_CHILD), dropped on `path`. */
export function _symbolChild(value: symbol, path: 'client' | 'server' | 'hydration'): void;
/** @internal Used by what-server. The keyed-array mapping `<For>` compiles down to. */
export function _mapArrayToArray(...args: unknown[]): unknown;
/** @internal Used by what-server. A keyed list row key's digest under a render's salt, as the server writes it and hydrate() compares it; null for a key that is not a string or a finite number. */
export function _rowKeyDigest(key: unknown, salt: string): string | null;
/** @internal Used by what-server's <Form>. Resets a form as React 19 does after a successful action: uncontrolled fields to their defaults, controlled ones to what their props hold. */
export function _resetForm(form: HTMLFormElement, onError: (error: unknown) => void): void;
/** @internal Used by what-server. A form's member read from its prototype (a method bound to the form), so a control named after the member cannot stand in for it. */
export function _formMember<K extends keyof HTMLFormElement>(form: HTMLFormElement, name: K): HTMLFormElement[K];
/** @internal Used by what-react. The client renderer a '__portal' vnode carries as its `mount` prop: builds the vnode's children into `props.container` and returns the placeholder comment. */
export function _mountPortal(vnode: VNode<any>, parent?: Node): Comment;
/** @internal Used by what-server. Installs the AsyncLocalStorage backends: one carries a render's context past an `await`, the other an async component's frame. */
export function __installServerContextStorage(storage: unknown, frames?: unknown): void;
/** @internal Used by what-server. Calls a server component's function in its frame, so that its code after an `await` keeps the frame as its owner. */
export function _runComponentAsync<T>(frame: unknown, fn: () => T): T;
/** @internal Used by what-server. Calls a server component's function in its frame, synchronously (renderToString). */
export function _runComponentSync<A, T>(frame: unknown, fn: (arg: A) => T, arg: A): T;
/** @internal Used by what-server. Marks a process that renders on the server with no document: outside a render, the query cache shares nothing. */
export function __markServerProcess(): void;
/** @internal Used by what-router. Whether code outside a render runs on a server: a process what-server marked, unless it had a document then and has AsyncLocalStorage. */
export function _isServerProcess(): boolean;
/** @internal Used by what-server. Runs waiting effect re-runs with no render context visible. */
export function __flushOutsideServerContext(): void;
/** @internal Used by what-server. Runs `fn` with no render context visible and no reactive owner. */
export function __outsideServerContext<T>(fn: () => T): T;
/** @internal Used by what-server. This copy of what-core's engine: a render context's `rootFor(engine)` returns the render's root for the copy that made it, and a root of its own, disposed with the render, for any other copy. */
export const _engine: { root(): unknown; dispose(root: unknown): void };
/** @internal Used by what-server's tests. Drops the cached hydration payload. */
export function __resetHydrationData(): void;
