// what-server/node — declarations for the package's `node` export condition
// (src/node.js). These entry points import node:http and node:fs, so they exist
// only under Node. Declaring them in index.d.ts instead would promise every
// browser and edge consumer six functions their runtime does not have.

export * from './index';
import type { RequestHandlerOptions, RenderRequestContext, DocumentOptions } from './index';


/** Convert a Web-Fetch handler into a Node (req, res) listener. */
export function toNodeListener(
  handler: (request: Request) => Promise<Response> | Response,
): (req: any, res: any) => Promise<void>;

/** connect/express middleware. Calls next() on a 404 so other routes can answer. */
export function whatMiddleware(options?: RequestHandlerOptions): (req: any, res: any, next?: () => void) => Promise<void>;

/** A ready-to-listen node:http server. Starts `scheduler` and stops it on SIGTERM/SIGINT. */
export function createServer(options?: RequestHandlerOptions & { scheduler?: { start(): void; stop(): void } }): import('node:http').Server;

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

export interface ExportStaticOptions {
  routes?: any[];
  outDir: string;
  render?: (pageModule: any, reqCtx: RenderRequestContext) => Promise<string> | string;
  documentOptions?: DocumentOptions;
}

/** Pre-render every `static` and `hybrid` route to files under `outDir`. */
export function exportStatic(options?: ExportStaticOptions): Promise<string[]>;
