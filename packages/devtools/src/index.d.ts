// Hand-written to match src/index.js. `what-devtools` is imported
// programmatically (`installDevTools`, `getSnapshot`) and by the MCP bridge,
// so TypeScript consumers need these; the package shipped without any types
// until 0.13.1.

/** A tracked signal, as returned by {@link getSnapshot}. */
export interface DevToolsSignal {
  id: number;
  name: string;
  /** Read with `peek()`, so taking a snapshot never creates a subscription. */
  value: unknown;
  /** Writes since registration: two snapshots differ exactly when this does. */
  rev: number;
  componentId: number | null;
}

/** A tracked effect or computed, as returned by {@link getSnapshot}. */
export interface DevToolsEffect {
  id: number;
  name: string;
  kind: 'effect' | 'computed';
  /** Signals it read in its latest run. */
  depSignalIds: number[];
  /** Computeds (by their effect id) it read in its latest run. */
  depComputedIds: number[];
  runCount: number;
  /** `Date.now()` of the last run, or null if it has not run yet. */
  lastRunAt: number | null;
  componentId: number | null;
}

/** A mounted component, as returned by {@link getSnapshot}. */
export interface DevToolsComponent {
  id: number;
  name: string;
  parentId: number | null;
}

/** A captured error. The buffer holds the most recent 100. */
export interface DevToolsError {
  message: string;
  stack: string | null;
  /** Where it came from: 'effect', 'effect-cleanup', 'cleanup' (an onCleanup callback), 'uncaught' or 'unhandled-rejection'. */
  type: string;
  effectId: number | null;
  /** The ERR_* code the thrown error carried, when it had one. */
  code?: string;
  timestamp: number;
}

export interface DevToolsSnapshot {
  signals: DevToolsSignal[];
  effects: DevToolsEffect[];
  components: DevToolsComponent[];
  errors: DevToolsError[];
}

export type DevToolsEvent =
  | 'signal:created'
  | 'signal:updated'
  | 'signal:disposed'
  | 'effect:created'
  | 'effect:run'
  | 'effect:disposed'
  | 'component:mounted'
  | 'component:unmounted'
  | 'error:captured'
  /** A coded what-core diagnostic; the payload is a what-core DiagnosticEvent. */
  | 'diagnostic';

/** Minimal shape of a what-core signal accessor, as devtools sees it. */
export interface TrackedSignal<T = unknown> {
  (): T;
  peek(): T;
}

/**
 * Run `fn` with devtools registration suppressed, so framework-internal
 * signals and effects created inside it are not reported to the panel.
 */
export function _suppressDevtools<T>(fn: () => T): T;

/**
 * A JSON-safe preview of any value, about `budget` characters of JSON at most
 * (default 300). Long strings, collections and objects end with an explicit
 * marker; circular references, DOM nodes, functions and throwing getters
 * become descriptive strings. Never throws.
 */
export function preview(value: unknown, budget?: number): unknown;

/** A larger-budget {@link preview} (default 2000), for sending over the MCP bridge. */
export function safeSerialize(value: unknown, budget?: number): unknown;

/** The registry as the MCP bridge reads it: every entry, with only signal values previewed. */
export interface DevToolsState {
  signals: Array<{ id: number; name: string; rev: number; value: unknown; componentId: number | null }>;
  effects: Array<{
    id: number;
    name: string;
    kind: 'effect' | 'computed';
    runCount: number;
    depSignalIds: number[];
    depComputedIds: number[];
    /** The dependencies whose change caused the latest re-run (absent after a first run). */
    causeSignalIds?: number[];
    causeComputedIds?: number[];
    componentId: number | null;
  }>;
  components: DevToolsComponent[];
}

/** The whole registry, JSON-safe, with each signal value previewed within `budget`. */
export function getState(opts?: { budget?: number }): DevToolsState;

export function registerSignal(sig: TrackedSignal, name?: string): number;
/** Called by the engine after a write, with the new and the previous value. */
export function notifySignalUpdate(sig: TrackedSignal, next?: unknown, prev?: unknown): void;
export function unregisterSignal(sig: TrackedSignal): void;

export function registerEffect(e: object, name?: string): number;
export function unregisterEffect(e: object): void;

export function registerComponent(
  name: string,
  element: Node | null,
  parentDevId?: number | null,
): number;
export function unregisterComponent(id: number): void;

/** Subscribe to devtools events. Returns an unsubscribe function. */
export function subscribe(
  fn: (event: DevToolsEvent, payload: unknown) => void,
): () => void;

export function getSnapshot(opts?: { includeInternal?: boolean }): DevToolsSnapshot;

/** Captured errors, optionally only those after a `Date.now()` timestamp. */
export function getErrors(opts?: { since?: number }): DevToolsError[];

/**
 * Coded diagnostics what-core reported after `since`, oldest first. Pass the
 * returned `seq` back as the next `since`. Empty until installDevTools has
 * wired a what-core that has the diagnostics channel.
 */
export function getDiagnostics(opts?: { since?: number }): {
  events: import('what-core').DiagnosticEvent[];
  seq: number;
  dropped: number;
};

/**
 * Install devtools. Call once at app startup. Wires into what-core's `__DEV__`
 * hooks and exposes `window.__WHAT_DEVTOOLS__`. Idempotent.
 *
 * @param core Optional what-core module. Dynamically imported when omitted.
 */
export function installDevTools(core?: object): void;

export const signals: Map<number, { name: string; ref: TrackedSignal; rev: number; createdAt: number; internal?: boolean }>;
export const effects: Map<number, { name: string; kind: 'effect' | 'computed'; createdAt: number; depSignalIds: number[]; depComputedIds: number[]; runCount: number; lastRunAt: number | null }>;
export const components: Map<number, { name: string; element: Node | null; mountedAt: number; parentId: number | null }>;
export const errors: DevToolsError[];
