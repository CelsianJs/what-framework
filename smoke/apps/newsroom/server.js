// Newsroom smoke app: `npm run dev` (auto-restart) or `node server.js`, then
// open http://localhost:3000.
//
// createRequestHandler serves the routes: the front page (mode 'server') is
// streamed, the article pages (mode 'hybrid') go through an in-memory ISR
// engine, and /__what_action runs the comment action. Buildless, like the
// storefront: the browser loads /src/entry-client.js as a native ES module
// and the import map below resolves its bare specifiers.
//
// NEWSROOM_DIAGNOSTICS=1 with `node --expose-gc` adds GET /__diag/heap (the
// heap after a full GC), which the smoke suite reads. Never set it in
// production.

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler, createRouteRenderer, toNodeListener } from 'what-framework/server';
import { createCacheEngine, createMemoryStore } from 'what-isr';

import { routes } from './src/routes.js';
import { installSource } from './src/lib/source.js';
import { pingReader, queryMarkets, queryMostRead } from './src/db.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

// The front page's queries read the services directly on the server.
installSource({ mostRead: queryMostRead, markets: queryMarkets });

const importMap = {
  imports: {
    'what-framework': '/node_modules/what-framework/src/index.js',
    'what-core': '/node_modules/what-core/src/index.js',
    ...Object.fromEntries(['a11y', 'ui', 'motion', 'dom', 'form', 'data'].flatMap((kit) => [
      [`what-framework/${kit}`, `/node_modules/what-framework/src/${kit}.js`],
      [`what-core/${kit}`, `/node_modules/what-core/src/entries/${kit}.js`],
    ])),
    // The island component the article page places its islands with.
    'what-framework/render': '/node_modules/what-framework/src/render.js',
    'what-core/render': '/node_modules/what-core/src/render.js',
    'what-core/internal': '/node_modules/what-core/src/entries/internal.js',
  },
  scopes: {
    '/node_modules/what-core/': { '#env': '/node_modules/what-core/src/env.js' },
  },
};

// A buildless page has no bundler to pick the framework's development build,
// so outside production the page sets its development flag before the
// framework loads, as create-what's full-stack template does: the
// development diagnostics (hydration mismatches among them) reach the
// browser console. NODE_ENV=production serves the production tier.
const devFlagScript = process.env.NODE_ENV === 'production' ? '' : '<script>globalThis.__WHAT_DEV__=true</script>';

export const documentOptions = {
  clientEntry: '/src/entry-client.js',
  head:
    `<script type="importmap">${JSON.stringify(importMap)}</script>${devFlagScript}`
    + '<link rel="stylesheet" href="/src/styles.css">'
    + '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
};

// The engine's own render is for regenerations it starts itself; requests are
// rendered by the handler's built-in renderer, which streams server routes.
const cache = createCacheEngine({ store: createMemoryStore(), render: createRouteRenderer(documentOptions) });

export function createHandler() {
  return createRequestHandler({ routes, cache, document: documentOptions });
}

// --- Static files and the JSON API -----------------------------------------

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// Deny by default: the client half of the app and the framework sources.
// src/db.js, src/actions/ and src/routes.js are server-only and 404 here.
const SERVED_FILES = new Set(['/src/entry-client.js', '/src/styles.css']);
const SERVED_PREFIXES = [
  '/src/pages/',
  '/src/components/',
  '/src/islands/',
  '/src/lib/',
  '/src/data/',
  '/node_modules/what-framework/',
  '/node_modules/what-core/',
];

function resolveStaticFile(pathname) {
  if (pathname.includes('..') || pathname.includes(' ')) return null;
  const allowed = SERVED_FILES.has(pathname) || SERVED_PREFIXES.some((p) => pathname.startsWith(p));
  const file = allowed ? resolve(join(ROOT, pathname)) : resolve(join(ROOT, 'public', pathname));
  if (!file.startsWith(resolve(ROOT))) return null;
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = toNodeListener(createHandler());

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (pathname === '/api/most-read') return json(res, 200, await queryMostRead(Number(url.searchParams.get('page')) || 1));
      if (pathname === '/api/markets') return json(res, 200, await queryMarkets(Number(url.searchParams.get('page')) || 1));
      if (pathname === '/api/reading-now') {
        return json(res, 200, { count: pingReader(url.searchParams.get('slug') ?? '', url.searchParams.get('reader') ?? '') });
      }
      if (pathname === '/__diag/heap' && process.env.NEWSROOM_DIAGNOSTICS === '1' && typeof globalThis.gc === 'function') {
        globalThis.gc();
        globalThis.gc();
        const { heapUsed, rss } = process.memoryUsage();
        return json(res, 200, { heapUsed, rss });
      }
      const file = resolveStaticFile(pathname);
      if (file) {
        res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
        if (req.method === 'HEAD') return res.end();
        return createReadStream(file).pipe(res);
      }
    }
    app(req, res);
  });

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`The Morning Ledger at http://localhost:${port}`));
  const stop = () => server.close();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
