// what-server/node — declarations for the package's `node` export condition
// (src/node.js). These entry points import node:http and node:fs, so they exist
// only under Node. Declaring them in index.d.ts instead would promise every
// browser and edge consumer six functions their runtime does not have.

export * from './index.js';
import type { RequestHandlerOptions, RenderRequestContext, DocumentOptions } from './index.js';


/** Convert a Web-Fetch handler into a Node (req, res) listener. */
export function toNodeListener(
  handler: (request: Request) => Promise<Response> | Response,
): (req: any, res: any) => Promise<void>;

/** connect/express middleware. Calls next() on a 404 so other routes can answer. */
export function whatMiddleware(options?: RequestHandlerOptions): (req: any, res: any, next?: () => void) => Promise<void>;

/** A ready-to-listen node:http server. Starts `scheduler` and stops it on SIGTERM/SIGINT. */
// Structural, not `import('node:http').Server`. Referencing a Node builtin here
// would make @types/node a hard requirement for every consumer of what-server,
// including the browser and edge ones that never touch this entry point. The
// runtime value IS an http.Server; this types what callers actually do with it.
export interface NodeHttpServer {
  listen(...args: any[]): NodeHttpServer;
  close(callback?: (err?: Error) => void): NodeHttpServer;
  address(): string | { address: string; family: string; port: number } | null;
  on(event: string, listener: (...args: any[]) => void): NodeHttpServer;
}

export function createServer(options?: RequestHandlerOptions & { scheduler?: { start(): void; stop(): void } }): NodeHttpServer;

/** Vercel Functions entry: a Web-Fetch handler. */
export function createVercelHandler(options?: RequestHandlerOptions): (request: Request) => Promise<Response>;

export interface VercelOutputOptions {
  outDir?: string;
  functionName?: string;
  runtime?: string;
  files?: Record<string, string> | null;
  handler?: string;
  staticDir?: string | null;
}

/** Write a Vercel Build Output API v3 directory. */
export function buildVercelOutput(options?: VercelOutputOptions): Promise<{ outDir: string; written: string[] }>;

/** A Vura Function module: what `export default` of the Function entry must be. */
export interface VuraFunction {
  fetch(request: Request, env?: Readonly<Record<string, string | undefined>>): Promise<Response>;
}

/**
 * Vura Function entry. Takes createRequestHandler options or an existing
 * Web-Fetch handler, and rebuilds request.url from x-forwarded-host/proto so
 * the app sees the public origin.
 */
export function createVuraHandler(
  optionsOrHandler?: RequestHandlerOptions | ((request: Request) => Response | Promise<Response>),
): VuraFunction;

/** A file or directory to publish under dist/static: 'src/pages' or { from: 'public', to: '/' }. */
export type VuraStaticFile = string | { from: string; to: string };

export interface VuraOutputOptions {
  /** Default process.cwd(). Every other path is relative to it. */
  projectRoot?: string;
  /** Default 'dist'. Deleted and rewritten on every build; must be inside projectRoot. */
  outDir?: string;
  /** The Function module, bundled into functions/_/index.js. */
  entry: string;
  staticFiles?: VuraStaticFile[];
  /** Function memory. Default '1gb'. */
  memory?: '1gb' | '4gb' | '6gb' | '8gb' | '12gb';
}

export interface VuraApiRoute {
  filePath: string;
  urlPattern: string;
  methods: string[];
  kind: 'serverless';
  hasWebsocket: false;
  config: { kind: 'serverless'; compute: { class: 'function'; memory: string } };
}

export interface VuraManifest {
  schemaVersion: 1;
  requiredFeatures: string[];
  api: VuraApiRoute[];
  pages: unknown[];
  layouts: unknown[];
  /** Always true: the edge serves files in dist/static before the catch-all Function. */
  filesystemFirst: true;
  timestamp: string;
}

export interface VuraOutputResult {
  outDir: string;
  staticDir: string;
  functionFile: string;
  manifest: VuraManifest;
  copied: Array<{ from: string; to: string }>;
  /** staticFiles sources that did not exist. */
  skipped: string[];
}

/** Write a Vura deploy directory: manifest.json, static/**, functions/_/index.js. Needs esbuild in the project. */
export function buildVuraOutput(options: VuraOutputOptions): Promise<VuraOutputResult>;

export interface ExportStaticOptions {
  routes?: any[];
  outDir: string;
  render?: (pageModule: any, reqCtx: RenderRequestContext) => Promise<string> | string;
  documentOptions?: DocumentOptions;
}

/** Pre-render every `static` and `hybrid` route to files under `outDir`. */
export function exportStatic(options?: ExportStaticOptions): Promise<string[]>;
