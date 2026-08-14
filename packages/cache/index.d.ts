// what-isr — origin-first ISR engine. TypeScript definitions.

// --- Page caching config (the JSON-safe `page` export) ---
export interface PageCacheConfig {
  mode?: 'static' | 'hybrid' | 'server';
  /** Seconds until a cached entry becomes stale. */
  revalidate?: number;
  /** Extra seconds an entry may be served stale while regenerating (stale-while-revalidate / stale-if-error). */
  swr?: number;
  /** Purge handles for revalidateTag. */
  tags?: string[];
  /**
   * Split the cache by these request signals, e.g. 'cookie:theme' or
   * 'header:accept-language' ('x' alone means the 'x' header). The adapter must
   * supply the matching request headers as `RouteMatch.varyHeaders`; without
   * them the route is served uncached rather than shared between users.
   *
   * A bare string is accepted as shorthand for a one-element list. Any other
   * shape is refused and the route is served uncached.
   */
  vary?: string[] | string;
  fallback?: 'blocking' | boolean;
  /** 'stale-if-error' serves an expired entry rather than failing when a cold render throws. */
  onMiss?: 'stale-if-error' | 'blocking' | string;
}
// `pollInterval` was declared on the config above and read by nothing, here or
// in what-server: setting it produced no error and no regeneration. Poll
// regeneration itself is real, but it is driven explicitly, because it only
// means anything in a long-lived process. Build a scheduler, register the routes
// worth keeping warm, and hand it to the Node adapter, which starts and stops
// it with the server:
//
//   const scheduler = createScheduler(engine);
//   scheduler.register({ path: '/', query: {}, params: {}, config: page, route }, { intervalMs: 300_000 });
//   createServer({ routes, cache: engine, scheduler });
//
// Declaring the key again is only honest once something resolves it into that
// register() call for every route that sets it.

// --- Stores ---
// The time fields are the ones makeEntry() writes and isFresh() /
// isServableStale() / the Redis TTL read. They were declared as
// `createdAt` + `revalidate` + `swr`, none of which exist on a real entry: a
// hand-built entry following that shape has no `expiresAt`, so isFresh()
// compares against undefined, every read is a miss, and the cache silently
// never serves. Build entries with makeEntry() rather than by hand.
export interface CacheEntry {
  html: string;
  head?: string;
  state?: unknown;
  status?: number;
  tags?: string[];
  path?: string;
  /** A partial render (skeleton/streamed shell). */
  partial?: boolean;
  /** Per-user render: never stored, never served from a shared cache. */
  private?: boolean;
  /** Epoch ms when the entry was rendered. */
  renderedAt: number;
  /** Seconds until stale. 0 means "always revalidate" when `revalidate: 0` was declared. */
  maxAge: number;
  /** Extra seconds the entry may be served stale while it regenerates. */
  swrWindow: number;
  /** Epoch ms the entry goes stale, or Infinity for a durable static entry. */
  expiresAt: number;
}

export interface CacheStore {
  get(key: string): Promise<CacheEntry | undefined>;
  set(key: string, entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<boolean>;
  /** Both delete-by helpers return the keys they removed. */
  deleteByTag(tag: string): Promise<string[]>;
  /** Not optional: revalidatePath() calls this unconditionally, so a store without it throws on the first purge. */
  deleteByPath(path: string): Promise<string[]>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
}

export function createMemoryStore(options?: { max?: number }): CacheStore;
export function createFilesystemStore(options: { dir: string; shards?: number }): CacheStore;
export function createRedisStore(options: { client: unknown; prefix?: string }): CacheStore;

/** Fill an entry's time fields from a render result plus the route config. */
export function makeEntry(
  out: Partial<RenderResult> & {
    path?: string;
    partial?: boolean;
    private?: boolean;
    /** A render that read request headers is per-user, so it stores as `private`. */
    usedRequestHeaders?: boolean;
  },
  config?: PageCacheConfig,
  now?: number,
): CacheEntry;
export function isFresh(entry: CacheEntry, now?: number): boolean;
export function isServableStale(entry: CacheEntry, now?: number): boolean;

// --- Keys ---
export function cacheKey(input: {
  path: string;
  query?: Record<string, string> | string;
  vary?: string[] | string | Record<string, string>;
  headers?: Record<string, string>;
}): string;
export function normalizePath(path: string): string;
export function normalizeQuery(query: Record<string, string> | string): string;
export function hashKey(key: string): string;
/** Resolve a declared vary list against request headers; null if unresolvable. */
export function resolveVary(
  vary: string[] | string | Record<string, string> | undefined,
  headers?: Record<string, string>
): Record<string, string> | null;
/**
 * Coerce a `vary` declaration to canonical `string[]`, or null if the shape
 * cannot be resolved. The cache key and the Cache-Control builder both read
 * this, so they can never disagree about whether a route is per-user.
 */
export function normalizeVaryDeclaration(
  vary: string[] | string | undefined | null
): string[] | null;

// --- CDN adapters (optional) ---
export interface CDNAdapter {
  purge(urls: string[]): Promise<void>;
  purgeTags(tags: string[]): Promise<void>;
}
export function createCloudflareCDN(options: { zoneId: string; apiToken: string }): CDNAdapter;
/** `baseUrl` is required for URL purge: only local paths resolved against it are purged. */
export function createFastlyCDN(options: { serviceId: string; apiToken: string; baseUrl?: string }): CDNAdapter;
export function createVercelCDN(options: { projectId: string; token: string; teamId?: string }): CDNAdapter;

// --- Headers ---
export type CacheStatus = 'HIT' | 'STALE' | 'MISS' | 'BYPASS';
/**
 * Build the Cache-Control / X-What-Cache / Cache-Tag headers for a response.
 * The second argument is the ROUTE CONFIG, not the cache status: the previous
 * declaration ((entry, status, { cdn })) described a function that does not
 * exist, so a caller who followed it passed the status where the config goes.
 */
export function buildCacheHeaders(
  entry?: Partial<CacheEntry>,
  config?: PageCacheConfig,
  cacheStatus?: CacheStatus,
  /** The declared vary the cache key used. Falls back to `config.vary`. */
  vary?: string[],
): Record<string, string>;

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
  /** Request headers the route's `vary` names resolve against. */
  varyHeaders?: Record<string, string>;
}

export interface RenderResult {
  html: string;
  head?: string;
  state?: unknown;
  status?: number;
  tags?: string[];
}
/** The engine calls render(routeMatch, ctx); `ctx` is reserved and currently `{}`. */
export type RenderFn = (routeMatch: RouteMatch, ctx?: Record<string, unknown>) => RenderResult | Promise<RenderResult>;

// --- ISR engine ---
export interface ServeResult {
  html: string;
  head?: string;
  state?: unknown;
  status: number;
  headers: Record<string, string>;
  cacheStatus: CacheStatus;
}
export interface RevalidateOptions {
  regenerate?: boolean;
  routeResolver?: (key: string) => RouteMatch | undefined;
}
export interface CacheEngine {
  handle(routeMatch: RouteMatch, renderOverride?: RenderFn): Promise<ServeResult>;
  /** Render and re-store one route now. What the poll scheduler calls per tick. */
  regenerate(routeMatch: RouteMatch): Promise<CacheEntry>;
  /** Both purges resolve to the cache keys they deleted, not to void. */
  revalidatePath(path: string, options?: RevalidateOptions): Promise<string[]>;
  revalidateTag(tag: string, options?: RevalidateOptions): Promise<string[]>;
  /** The cache key for a route match. Throws when the route declares `vary` and no headers were supplied. */
  keyFor(routeMatch: RouteMatch): string;
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
  body?: { paths?: string[]; tags?: string[]; secret?: string };
}
export interface WebhookResponse {
  status: number;
  body: unknown;
}
export function createRevalidateWebhook(
  engine: CacheEngine,
  options: { secret: string; header?: string; regenerate?: boolean; maxBatch?: number }
): (req: WebhookRequest) => Promise<WebhookResponse>;

// --- Poll scheduler ---
// Register the routes to keep warm, then start it (or hand it to what-server's
// createServer, which starts it and stops it on SIGTERM/SIGINT). Every method
// returns the scheduler so registration can chain.
export interface Scheduler {
  register(route: RouteMatch, options: { intervalMs: number }): Scheduler;
  start(): Scheduler;
  stop(): Scheduler;
}
// The runtime reads maxConcurrent/random/setTimer/clearTimer/logger. The
// `concurrency` and `jitter` declared before were read by nothing, so a caller
// capping concurrency got the default 4 and no warning.
export interface SchedulerOptions {
  /** Regenerations allowed in flight at once. Default 4. */
  maxConcurrent?: number;
  /** Jitter source (0..1), injectable for deterministic tests. Intervals are spread by up to +10%. */
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => any;
  clearTimer?: (timer: any) => void;
  logger?: Pick<Console, 'error' | 'warn' | 'log'>;
}
export function createScheduler(engine: CacheEngine, options?: SchedulerOptions): Scheduler;
