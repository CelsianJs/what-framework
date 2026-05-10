export interface DevToolsSnapshot {
  signals: Array<Record<string, unknown>>;
  effects: Array<Record<string, unknown>>;
  components: Array<Record<string, unknown>>;
  errors: Array<Record<string, unknown>>;
  hydrationMismatches: Array<Record<string, unknown>>;
}

export function installDevTools(core?: Record<string, unknown>): void;
export function safeSerialize(value: unknown, depth?: number, seen?: Set<unknown>): unknown;
export function registerSignal(sig: unknown, name?: string): number | undefined;
export function notifySignalUpdate(sig: unknown): void;
export function unregisterSignal(sig: unknown): void;
export function registerEffect(effect: unknown, name?: string): number | undefined;
export function registerComponent(component: unknown, element?: unknown, parentId?: number): number | undefined;
export function unregisterComponent(idOrComponent: unknown): void;
export function captureError(error: unknown, type?: string, context?: Record<string, unknown>): void;
export function getSnapshot(): DevToolsSnapshot;
export function getErrors(): Array<Record<string, unknown>>;
export function getHydrationMismatches(): Array<Record<string, unknown>>;
export function subscribe(listener: (event: string, data: unknown) => void): () => void;
export function resetDevTools(): void;
