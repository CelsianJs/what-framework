// what-cache — origin-first ISR engine. TypeScript definitions.

// --- Page caching config (the JSON-safe `page` export) ---
export interface PageCacheConfig {
  mode?: 'static' | 'hybrid' | 'server';
  /** Seconds until a cached entry becomes stale. */
  revalidate?: number;
  /** Extra seconds an entry may be served stale while regenerating (stale-while-revalidate / stale-if-error). */
  swr?: number;
  /** Purge handles for revalidateTag. */
  tags?: string[];
  /** Split the cache by these request signals, e.g. 'cookie:theme'. */
  vary?: string[];
  fallback?: 'blocking' | boolean;
  onMiss?: 'blocking' | string;
  /** Background regeneration interval, in seconds. */
  pollInterval?: number;
}

// --- Stores ---
export interface CacheEntry {
  html: string;
  head?: string;
  state?: unknown;
  status?: number;
  tags?: string[];
  path?: string;
  /** Epoch ms when the entry was created. */
  createdAt: number;
  /** Seconds-to-stale snapshot from the page config. */
  revalidate?: number;
  swr?: number;
}

export interface CacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteByTag(tag: string): Promise<string[]>;
  deleteByPath?(path: string): Promise<string[]>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

export function createMemoryStore(options?: { max?: number }): CacheStore;
export function createFilesystemStore(options: { dir: string; shards?: number }): CacheStore;
export function createRedisStore(options: { client: unknown; prefix?: string }): CacheStore;

export function makeEntry(out: Partial<CacheEntry>, config?: PageCacheConfig, now?: number): CacheEntry;
export function isFresh(entry: CacheEntry, now?: number): boolean;
export function isServableStale(entry: CacheEntry, now?: number): boolean;

// --- Keys ---
export function cacheKey(routeMatch: RouteMatch): string;
export function normalizePath(path: string): string;
export function normalizeQuery(query: Record<string, string> | string): string;
export function hashKey(key: string): string;

// --- CDN adapters (optional) ---
export interface CDNAdapter {
  purge(urls: string[]): Promise<void>;
  purgeTags(tags: string[]): Promise<void>;
}
export function createCloudflareCDN(options: { zoneId: string; apiToken: string }): CDNAdapter;
export function createFastlyCDN(options: { serviceId: string; apiToken: string }): CDNAdapter;
export function createVercelCDN(options: { projectId: string; token: string; teamId?: string }): CDNAdapter;

// --- Headers ---
export interface CacheHeaderOptions {
  cdn?: boolean;
}
export function buildCacheHeaders(entry?: CacheEntry, status?: 'HIT' | 'STALE' | 'MISS', options?: CacheHeaderOptions): Record<string, string>;

// --- Static paths ---
export interface StaticPathEntry {
  params: Record<string, string>;
}
export interface StaticPathsResult {
  paths: StaticPathEntry[];
  fallback: 'blocking' | boolean;
}
export function resolveStaticPaths(getStaticPaths: () => StaticPathsResult | Promise<StaticPathsResult>): Promise<StaticPathsResult>;
export function buildPath(pattern: string, params?: Record<string, string>): string;
export function decideFallback(fallback: 'blocking' | boolean, isKnown: boolean): 'blocking' | 'skeleton' | '404' | 'serve';
export function isKnownParams(staticPaths: StaticPathEntry[], params: Record<string, string>): boolean;

// --- Route match (shape passed into the engine) ---
export interface RouteMatch {
  path: string;
  query?: Record<string, string>;
  config?: PageCacheConfig;
  params?: Record<string, string>;
  route?: unknown;
  request?: Request;
}

export interface RenderResult {
  html: string;
  head?: string;
  state?: unknown;
  status?: number;
  tags?: string[];
}
export type RenderFn = (routeMatch: RouteMatch) => RenderResult | Promise<RenderResult>;

// --- ISR engine ---
export interface ServeResult {
  html: string;
  status: number;
  headers: Record<string, string>;
  cacheStatus: 'HIT' | 'STALE' | 'MISS';
}
export interface RevalidateOptions {
  regenerate?: boolean;
  routeResolver?: (key: string) => RouteMatch | undefined;
}
export interface CacheEngine {
  handle(routeMatch: RouteMatch, renderOverride?: RenderFn): Promise<ServeResult>;
  revalidatePath(path: string, options?: RevalidateOptions): Promise<void>;
  revalidateTag(tag: string, options?: RevalidateOptions): Promise<void>;
  store: CacheStore;
}
export function createCacheEngine(options?: {
  store?: CacheStore;
  render?: RenderFn;
  cdn?: CDNAdapter;
  now?: () => number;
  logger?: Pick<Console, 'error' | 'warn' | 'log'>;
}): CacheEngine;

// --- Revalidation webhook ---
export interface WebhookRequest {
  headers?: Record<string, string>;
  body?: { paths?: string[]; tags?: string[]; secret?: string; regenerate?: boolean };
}
export interface WebhookResponse {
  status: number;
  body: unknown;
}
export function createRevalidateWebhook(
  engine: CacheEngine,
  options: { secret: string }
): (req: WebhookRequest) => Promise<WebhookResponse>;

// --- Poll scheduler ---
export interface Scheduler {
  register(route: RouteMatch, options: { intervalMs: number }): void;
  start(): void;
  stop(): void;
}
export function createScheduler(engine: CacheEngine, options?: { concurrency?: number; jitter?: number }): Scheduler;
