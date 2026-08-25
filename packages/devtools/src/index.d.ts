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
  componentId: number | null;
}

/** A tracked effect, as returned by {@link getSnapshot}. */
export interface DevToolsEffect {
  id: number;
  name: string;
  depSignalIds: number[];
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
  /** Where it came from, e.g. 'effect' or 'unknown'. */
  type: string;
  effectId: number | null;
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
  | 'error:captured';

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
 * Convert a value to something structured-cloneable and depth-limited, for
 * sending over the MCP bridge.
 */
export function safeSerialize(value: unknown, depth?: number, seen?: WeakSet<object>): unknown;

export function registerSignal(sig: TrackedSignal, name?: string): number;
export function notifySignalUpdate(sig: TrackedSignal): void;
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
 * Install devtools. Call once at app startup. Wires into what-core's `__DEV__`
 * hooks and exposes `window.__WHAT_DEVTOOLS__`. Idempotent.
 *
 * @param core Optional what-core module. Dynamically imported when omitted.
 */
export function installDevTools(core?: object): void;

export const signals: Map<number, { name: string; ref: TrackedSignal; createdAt: number; internal?: boolean }>;
export const effects: Map<number, { name: string; createdAt: number; depSignalIds: number[]; runCount: number; lastRunAt: number | null }>;
export const components: Map<number, { name: string; element: Node | null; mountedAt: number; parentId: number | null }>;
export const errors: DevToolsError[];
