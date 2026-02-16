// @thenjs/build — ThenJS Vite plugin
// Wraps what-compiler/vite and adds ThenJS-specific virtual modules

import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import type { ThenConfig } from '@thenjs/server';
import { scanPages, scanAPI, scanRPC } from './scanner.js';

const VIRTUAL_ROUTES = 'virtual:then-routes';
const VIRTUAL_MANIFEST = 'virtual:then-manifest';
const VIRTUAL_RPC_CLIENT = 'virtual:then-rpc-client';
const RESOLVED_PREFIX = '\0';

export interface ThenVitePluginOptions {
  config?: ThenConfig;
  /** Root directory of the user's project */
  root?: string;
}

export function thenVitePlugin(options: ThenVitePluginOptions = {}): Plugin[] {
  const config = options.config ?? {};
  let resolvedConfig: ResolvedConfig;
  let devServer: ViteDevServer | undefined;

  const mainPlugin: Plugin = {
    name: 'thenjs',
    enforce: 'pre',

    configResolved(resolved) {
      resolvedConfig = resolved;
    },

    configureServer(server) {
      devServer = server;

      // Add SSR middleware for page routes
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '/';

        // Skip Vite's internal paths and static assets
        if (url.startsWith('/@') || url.startsWith('/__') || url.includes('.')) {
          return next();
        }

        // Skip API routes (handled separately)
        if (url.startsWith('/api/') || url.startsWith('/_rpc/')) {
          return next();
        }

        try {
          // Load the SSR entry module
          const ssrEntry = await server.ssrLoadModule('/src/entry-server.tsx');

          if (typeof ssrEntry.render === 'function') {
            const html = await ssrEntry.render(url);

            // Apply Vite HTML transforms (inject HMR client, etc.)
            const transformedHtml = await server.transformIndexHtml(url, html);

            res.setHeader('content-type', 'text/html');
            res.end(transformedHtml);
          } else {
            next();
          }
        } catch (e) {
          server.ssrFixStacktrace(e as Error);
          next(e);
        }
      });

      // API route middleware
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '/';

        if (!url.startsWith('/api/')) {
          return next();
        }

        try {
          // Load the API route handler
          const apiModule = await server.ssrLoadModule(`/src${url}.ts`).catch(() =>
            server.ssrLoadModule(`/src${url}.js`),
          );

          const method = req.method?.toUpperCase() ?? 'GET';
          const handler = apiModule[method] ?? apiModule.default;

          if (typeof handler === 'function') {
            // Convert Node req to Web Standard Request
            const webRequest = toWebRequest(req);
            const response: Response = await handler(webRequest);

            // Write response back to Node res
            res.statusCode = response.status;
            for (const [key, value] of response.headers.entries()) {
              res.setHeader(key, value);
            }
            const body = await response.text();
            res.end(body);
          } else {
            next();
          }
        } catch (e) {
          server.ssrFixStacktrace(e as Error);
          next(e);
        }
      });

      // RPC middleware
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '/';

        if (!url.startsWith('/_rpc/')) {
          return next();
        }

        try {
          // Load all RPC routers from src/rpc/
          const rpcModule = await server.ssrLoadModule('/src/rpc/index.ts').catch(() => null);

          if (rpcModule) {
            const { RPCHandler } = await import('@thenjs/rpc');
            const handler = new RPCHandler(rpcModule.default ?? rpcModule);
            const webRequest = toWebRequest(req);
            const response = await handler.handle(webRequest);

            res.statusCode = response.status;
            for (const [key, value] of response.headers.entries()) {
              res.setHeader(key, value);
            }
            const body = await response.text();
            res.end(body);
          } else {
            next();
          }
        } catch (e) {
          server.ssrFixStacktrace(e as Error);
          next(e);
        }
      });
    },

    resolveId(id) {
      if (id === VIRTUAL_ROUTES) return RESOLVED_PREFIX + VIRTUAL_ROUTES;
      if (id === VIRTUAL_MANIFEST) return RESOLVED_PREFIX + VIRTUAL_MANIFEST;
      if (id === VIRTUAL_RPC_CLIENT) return RESOLVED_PREFIX + VIRTUAL_RPC_CLIENT;
      return null;
    },

    async load(id) {
      const defaultMode = config.server?.defaultPageMode ?? 'hybrid';
      if (id === RESOLVED_PREFIX + VIRTUAL_ROUTES) {
        return await generateRoutesVirtualModule(resolvedConfig?.root ?? process.cwd(), defaultMode);
      }

      if (id === RESOLVED_PREFIX + VIRTUAL_MANIFEST) {
        return await generateManifestVirtualModule(resolvedConfig?.root ?? process.cwd(), defaultMode);
      }

      if (id === RESOLVED_PREFIX + VIRTUAL_RPC_CLIENT) {
        return generateRPCClientVirtualModule();
      }

      return null;
    },
  };

  return [mainPlugin];
}

// ─── Virtual Module Generators ───

async function generateRoutesVirtualModule(root: string, defaultMode: string = 'hybrid'): Promise<string> {
  const pages = await scanPages(root, { defaultMode: defaultMode as any });
  const apiRoutes = await scanAPI(root);

  // Generate import statements and route arrays
  const pageImports: string[] = [];
  const pageRoutes: string[] = [];

  const actualPages = pages.filter(p => !p.isLayout && !p.isError && !p.isLoading);

  for (let i = 0; i < actualPages.length; i++) {
    const page = actualPages[i]!;
    const importName = `Page${i}`;
    pageImports.push(`const ${importName} = () => import('/${page.relative}');`);
    pageRoutes.push(`  { path: ${JSON.stringify(page.path)}, component: ${importName}, mode: ${JSON.stringify(page.mode)} }`);
  }

  // Layouts
  const layouts = pages.filter(p => p.isLayout);
  const layoutImports: string[] = [];
  for (let i = 0; i < layouts.length; i++) {
    const layout = layouts[i]!;
    layoutImports.push(`const Layout${i} = () => import('/${layout.relative}');`);
  }

  // Error pages
  const errorPages = pages.filter(p => p.isError);
  const errorImports: string[] = [];
  for (let i = 0; i < errorPages.length; i++) {
    const error = errorPages[i]!;
    errorImports.push(`const ErrorPage${i} = () => import('/${error.relative}');`);
  }

  // API routes
  const apiImports: string[] = [];
  const apiRouteEntries: string[] = [];
  for (let i = 0; i < apiRoutes.length; i++) {
    const api = apiRoutes[i]!;
    const importName = `API${i}`;
    apiImports.push(`const ${importName} = () => import('/${api.relative}');`);
    apiRouteEntries.push(`  { path: ${JSON.stringify(api.path)}, handler: ${importName}, methods: ${JSON.stringify(api.methods)} }`);
  }

  // Page mode map
  const pageModes: Record<string, string> = {};
  for (const page of actualPages) {
    pageModes[page.path] = page.mode;
  }

  return `
// Auto-generated by @thenjs/build — DO NOT EDIT
${pageImports.join('\n')}
${layoutImports.join('\n')}
${errorImports.join('\n')}
${apiImports.join('\n')}

export const routes = [
${pageRoutes.join(',\n')}
];

export const apiRoutes = [
${apiRouteEntries.join(',\n')}
];

export const pageModes = ${JSON.stringify(pageModes, null, 2)};

export const errorPages = {};
export const loadingPages = {};
`;
}

async function generateManifestVirtualModule(root: string, defaultMode: string = 'hybrid'): Promise<string> {
  const pages = await scanPages(root, { defaultMode: defaultMode as any });
  const apiRoutes = await scanAPI(root);
  const rpc = await scanRPC(root);

  const actualPages = pages.filter(p => !p.isLayout && !p.isError && !p.isLoading);

  const manifest = {
    routes: actualPages.map(p => ({
      path: p.path,
      mode: p.mode,
      component: p.relative,
    })),
    apiRoutes: apiRoutes.map(a => ({
      path: a.path,
      methods: a.methods,
      handler: a.relative,
    })),
    rpcProcedures: rpc ? [{ file: rpc.file }] : [],
    tasks: [],
  };

  return `
// Auto-generated by @thenjs/build — DO NOT EDIT
export const manifest = ${JSON.stringify(manifest, null, 2)};
`;
}

function generateRPCClientVirtualModule(): string {
  return `
// Auto-generated by @thenjs/build
import { createRPCClient } from '@thenjs/rpc';
export const rpc = createRPCClient({ baseUrl: '/_rpc' });
`;
}

// ─── Helpers ───

function toWebRequest(nodeReq: any): Request {
  const protocol = nodeReq.headers['x-forwarded-proto'] ?? 'http';
  const host = nodeReq.headers.host ?? 'localhost';
  const url = new URL(nodeReq.url ?? '/', `${protocol}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeReq.headers)) {
    if (typeof value === 'string') {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    }
  }

  const method = nodeReq.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';

  return new Request(url.toString(), {
    method,
    headers,
    body: hasBody ? nodeReq : undefined,
    // @ts-expect-error Node.js specific
    duplex: hasBody ? 'half' : undefined,
  });
}
