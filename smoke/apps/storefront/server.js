// Storefront smoke app: full-stack server. `npm run dev` (auto-restart) or `node server.js`
// Serves http://localhost:3000. Wires the Node adapter + origin-first ISR engine +
// on-demand revalidation webhook + poll scheduler. No CDN and no bundler
// required: the client entry and the framework are served as native ES modules
// (see the import map below).

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, statSync, createReadStream, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler, renderDocument, toNodeListener } from 'what-framework/server';
import {
  createCacheEngine,
  createMemoryStore,
  createRevalidateWebhook,
  createScheduler,
} from 'what-isr';
import { routes } from './src/routes.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

// Secret for the on-demand revalidation webhook (POST /__what_revalidate).
// Required in production; auto-generated per run in dev so there is never a
// shared default secret.
let REVALIDATE_SECRET = process.env.WHAT_REVALIDATE_SECRET;
if (!REVALIDATE_SECRET) {
  if (isProd) {
    console.error(
      '[storefront] WHAT_REVALIDATE_SECRET must be set in production.\n' +
      "  Generate one:  node -e \"console.log(require('node:crypto').randomBytes(24).toString('hex'))\""
    );
    process.exit(1);
  }
  REVALIDATE_SECRET = randomBytes(24).toString('hex');
  console.log(`[dev] WHAT_REVALIDATE_SECRET not set, generated for this run: ${REVALIDATE_SECRET}`);
}

// Origin ISR cache. Swap createMemoryStore() for createFilesystemStore({dir})
// to survive restarts, or createRedisStore({client}) for multi-instance.
// `render` powers scheduled regeneration (renderRoute is defined below;
// function declarations hoist, so the reference is valid here).
const cache = createCacheEngine({ store: createMemoryStore(), render: renderRoute });

// Non-200 renders (soft-404s like /blog/nonexistent) must never be ISR-cached.
// A cached "Not found" would shadow a post created later and poison SEO. The
// engine skips storing them; this wrapper also drops any stored non-200 entry
// and forces the response uncacheable (belt and suspenders).
const appCache = {
  ...cache,
  async handle(routeMatch, render) {
    let result = await cache.handle(routeMatch, render);
    if (result && result.status && result.status !== 200) {
      try { await cache.store.delete(cache.keyFor(routeMatch)); } catch { /* best effort */ }
      const headers = { ...(result.headers || {}) };
      delete headers['Cache-Control'];
      delete headers['cache-control'];
      headers['Cache-Control'] = 'private, no-store';
      result = { ...result, headers };
    }
    return result;
  },
};

// Keep the home listing warm every 5 minutes regardless of traffic.
const scheduler = createScheduler(cache);
scheduler.register(
  { path: '/', query: {}, params: {}, config: routes[0].page, route: routes[0] },
  { intervalMs: 5 * 60 * 1000 }
);

// The browser loads /src/entry-client.js as a native ES module; this import
// map resolves its bare imports. Sources are served from node_modules below.
const importMap = {
  imports: {
    'what-framework': '/node_modules/what-framework/src/index.js',
    'what-core': '/node_modules/what-core/src/index.js',
    // The client half of the server package: island hydration and
    // enhanceForms(). It imports nothing from node:*, so it loads in a browser.
    'what-server/islands': '/node_modules/what-server/src/islands.js',
    // Dev only. This template is buildless, so there is no Vite plugin to inject
    // the devtools bridge the way the SPA template gets it. Mapping the two
    // specifiers here (and serving them below) is all it takes for the MCP
    // `what_*` tools to see this app: entry-client.js dynamically imports them
    // behind the __WHAT_DEV__ flag, so production never fetches either module.
    ...(isProd ? {} : {
      'what-devtools': '/node_modules/what-devtools/src/index.js',
      'what-devtools-mcp/client': '/node_modules/what-devtools-mcp/src/client.js',
    }),
  },
};

// The MCP bridge writes its token here when `npx what-devtools-mcp` starts.
// Read per render, not once at boot, so starting the bridge after the server is
// already up only costs a page reload.
//
// The token is passed INLINE rather than via the Vite plugin's same-origin
// discovery endpoint, which this server does not implement. That is deliberate:
// the client only probes for a bridge when it has a token or a discovery URL, so
// an app running without the MCP server makes no requests and logs nothing at
// all. Handing it a discovery URL that 404s would put a red line in every
// developer's console on every page load.
function mcpToken() {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'node_modules', '.cache', 'what-devtools-mcp', 'token'), 'utf8')).token || '';
  } catch {
    return '';
  }
}

function devToolsHead() {
  if (isProd) return '';
  const token = mcpToken();
  if (!token) return '<script>globalThis.__WHAT_DEV__=true</script>';
  return `<script>globalThis.__WHAT_DEV__=true;globalThis.__WHAT_MCP__=${JSON.stringify({ port: 9229, token })}</script>`;
}

export const documentOptions = {
  clientEntry: '/src/entry-client.js',
  // A getter, so devToolsHead() re-reads the token on every render.
  get head() {
    return `<script type="importmap">${JSON.stringify(importMap)}</script>` +
      devToolsHead() +
      '<link rel="stylesheet" href="/src/styles.css">' +
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg">';
  },
};

// Render a matched route. Mirrors the framework default renderer, plus:
//   - passes csrfToken through to loaders (so /new can SSR the no-JS form token)
//   - honors a loader's `notFound: true` with a real 404 status (the appCache
//     wrapper above keeps those responses out of the ISR cache)
async function renderRoute(routeMatch) {
  const { route, params, query, request, csrfToken } = routeMatch;
  const reqCtx = { params, query, request, csrfToken };
  const loaderData = typeof route.loader === 'function' ? await route.loader(reqCtx) : undefined;
  const notFound = !!(loaderData && loaderData.notFound);
  const pageModule = { default: route.component, loader: () => loaderData };
  const opts = csrfToken ? { ...documentOptions, csrfToken } : documentOptions;
  const html = await renderDocument(pageModule, reqCtx, opts);
  return {
    html,
    status: notFound ? 404 : 200,
    tags: (routeMatch.config && routeMatch.config.tags) || [],
    path: routeMatch.path,
  };
}

export function createHandler() {
  return createRequestHandler({
    routes,
    cache: appCache,
    render: renderRoute,
    revalidateWebhook: createRevalidateWebhook(cache, { secret: REVALIDATE_SECRET }),
    document: documentOptions,
  });
}

// --- Static files (client entry, page modules, framework sources, public/) ---

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

// Deny-by-default static serving: ONLY the allowlisted client files below are
// served from the project root. Server-only modules (src/db.js, src/actions/**
// and src/routes.js) are importable by Node but 404 over HTTP, so DB code and
// mutation logic never leak to the browser. When you add new client-side files
// outside these locations, add them here explicitly.
const SERVED_FILES = new Set(['/src/entry-client.js', '/src/styles.css']);
const SERVED_PREFIXES = [
  '/src/pages/',                  // page modules (hydrated by entry-client)
  '/src/components/',             // client-shared UI
  '/src/store/',                  // the global cart store
  '/src/lib/',                    // client-safe helpers (action caller)
  '/node_modules/what-framework/',
  '/node_modules/what-core/',
  '/node_modules/what-server/',
  // Dev only: the devtools bridge entry-client imports when __WHAT_DEV__ is set.
  // Gated on isProd so a production deploy never serves dev tooling.
  ...(isProd ? [] : ['/node_modules/what-devtools/', '/node_modules/what-devtools-mcp/']),
];

function resolveStaticFile(pathname) {
  if (pathname.includes('..') || pathname.includes(' ')) return null;
  const allowed = SERVED_FILES.has(pathname) || SERVED_PREFIXES.some((p) => pathname.startsWith(p));
  const file = allowed
    ? resolve(join(ROOT, pathname))
    : resolve(join(ROOT, 'public', pathname));
  if (!file.startsWith(resolve(ROOT))) return null;
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

// --- Start (node server.js / npm run dev), not when imported by tests ---

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = toNodeListener(createHandler());

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    // --- JSON API ---------------------------------------------------------
    if (url.pathname === '/api/search') {
      const { searchProducts } = await import('./src/db.js');
      const body = JSON.stringify(searchProducts(url.searchParams.get('q') ?? ''));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(body);
    }

    // Session endpoints. A server action cannot set Set-Cookie (the action
    // handler owns its response headers), so sign-in is a real endpoint. It is
    // a plain form POST, so it works with scripting disabled.
    if ((url.pathname === '/api/login' || url.pathname === '/api/logout') && req.method === 'POST') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const { signIn, signOut, SESSION_COOKIE } = await import('./src/auth.js');

      if (url.pathname === '/api/logout') {
        const cookie = req.headers.cookie ?? '';
        const token = (cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`)) || [])[1];
        signOut(token && decodeURIComponent(token));
        res.writeHead(303, {
          location: '/account',
          'set-cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
        });
        return res.end();
      }

      const token = signIn(form.get('email') ?? '', form.get('password') ?? '');
      if (!token) {
        res.writeHead(303, { location: '/account?error=1' });
        return res.end();
      }
      res.writeHead(303, {
        location: '/account',
        'set-cookie': `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
      });
      return res.end();
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      const pathname = decodeURIComponent(url.pathname);
      const file = resolveStaticFile(pathname);
      if (file) {
        res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
        if (req.method === 'HEAD') return res.end();
        return createReadStream(file).pipe(res);
      }
    }
    app(req, res);
  });

  scheduler.start();
  const stop = () => { try { scheduler.stop(); } catch {} server.close(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`storefront ready at http://localhost:${port}`));
}
