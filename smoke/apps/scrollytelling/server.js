// Scrollytelling smoke app: one server-rendered page. `npm run dev` (auto-restart)
// or `node server.js`, then open http://localhost:3000.
//
// There is one route and no data layer, so there is no adapter and no ISR
// engine here: renderDocument() is the whole server. Buildless, like the
// storefront: the browser loads /src/entry-client.js as a native ES module and
// the import map below resolves its bare specifiers.

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDocument } from 'what-framework/server';

import StoryPage from './src/page.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

const importMap = {
  imports: {
    'what-framework': '/node_modules/what-framework/src/index.js',
    'what-core': '/node_modules/what-core/src/index.js',
  },
};

export const documentOptions = {
  clientEntry: '/src/entry-client.js',
  head:
    `<script type="importmap">${JSON.stringify(importMap)}</script>`
    + '<link rel="stylesheet" href="/src/styles.css">'
    + '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
};

export function renderStory() {
  return renderDocument({ default: StoryPage }, {}, documentOptions);
}

// --- Static files -----------------------------------------------------------

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

// Deny by default: only the client half of the app and the framework sources
// are reachable over HTTP. server.js itself is never served.
const SERVED_PREFIXES = [
  '/src/',
  '/node_modules/what-framework/',
  '/node_modules/what-core/',
];

function resolveStaticFile(pathname) {
  if (pathname.includes('..') || pathname.includes(' ')) return null;
  const allowed = SERVED_PREFIXES.some((p) => pathname.startsWith(p));
  const file = allowed ? resolve(join(ROOT, pathname)) : resolve(join(ROOT, 'public', pathname));
  if (!file.startsWith(resolve(ROOT))) return null;
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (req.method === 'GET' || req.method === 'HEAD') {
      const file = resolveStaticFile(pathname);
      if (file) {
        res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
        if (req.method === 'HEAD') return res.end();
        return createReadStream(file).pipe(res);
      }
      if (pathname === '/') {
        const html = await renderStory();
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        return res.end(html);
      }
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`Northline 01 ready at http://localhost:${port}`));
}
