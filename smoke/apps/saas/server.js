// Northstar, server-rendered below /console. `npm run build`, then
// `node server.js`; open http://localhost:6970/console/. `npm run dev`
// (`node server.js --dev`) renders from the source through Vite's dev server
// instead, with no build.
//
// createRequestHandler({ basePath: '/console' }) renders every page from the
// --ssr build and streams it, and the client build (served from dist/client
// below /console/assets) hydrates it. The router is given no base here: it
// takes the request handler's. The JSON API is below the base too.

import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler, toNodeListener } from 'what-framework/server';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = join(ROOT, 'dist/client');
const DEV = process.argv.includes('--dev');
const BASE = '/console';
const ICON = `<link rel="icon" type="image/svg+xml" href="${BASE}/favicon.svg">`;

const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function clientFile(pathname) {
  if (pathname.includes('..')) return null;
  const file = resolve(join(CLIENT, pathname));
  if (!file.startsWith(CLIENT) || file.includes('/.vite/')) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

const server = http.createServer();

// The server entry, the document around each page, and what serves the
// client's files: the builds, or in development Vite (its HMR socket on this
// server's port).
let vite = null;
let entry;
let documentOptions;
if (DEV) {
  const { createServer } = await import('vite');
  vite = await createServer({ root: ROOT, appType: 'custom', server: { middlewareMode: true, hmr: { server } } });
  documentOptions = { clientEntry: `${BASE}/src/entry-client.jsx`, head: `<title>Northstar</title><script type="module" src="${BASE}/@vite/client"></script>${ICON}` };
} else {
  entry = await import('./dist/server/entry-server.js');
  const manifest = JSON.parse(readFileSync(join(CLIENT, '.vite/manifest.json'), 'utf8'));
  const client = manifest['src/entry-client.jsx'];
  documentOptions = {
    clientEntry: `${BASE}/${client.file}`,
    head: '<title>Northstar</title>' + (client.css ?? []).map((href) => `<link rel="stylesheet" href="${BASE}/${href}">`).join('') + ICON,
  };
}

// One handler per load of the server entry: in development a saved edit
// loads it again.
let handlerFor = null;
let app = null;
async function current() {
  const mod = vite ? await vite.ssrLoadModule('/src/entry-server.jsx') : entry;
  if (mod !== handlerFor) {
    handlerFor = mod;
    const pages = createRequestHandler({ routes: mod.routes, basePath: BASE, document: documentOptions });
    app = toNodeListener((request) => (new URL(request.url).pathname.startsWith(`${BASE}/api/`) ? mod.api(request, BASE) : pages(request)));
  }
  return app;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === BASE) {
    res.writeHead(302, { location: `${BASE}/` });
    return res.end();
  }
  if (!vite && req.method === 'GET' && url.pathname.startsWith(`${BASE}/`)) {
    const file = clientFile(decodeURIComponent(url.pathname.slice(BASE.length)));
    if (file) {
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable' });
      return createReadStream(file).pipe(res);
    }
  }
  (await current())(req, res);
}

server.on('request', (req, res) => {
  const fail = (error) => {
    vite?.ssrFixStacktrace(error);
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(error?.stack ?? error));
  };
  // Vite answers for the client's modules and the public files; a page is
  // left to the handler, with the URL the browser asked for (Vite's
  // middlewares take the base off req.url, and keep it in req.originalUrl).
  if (vite) {
    vite.middlewares(req, res, (error) => {
      if (error) return fail(error);
      req.url = req.originalUrl ?? req.url;
      handle(req, res).catch(fail);
    });
  }
  else handle(req, res).catch(fail);
});

const port = Number(process.env.PORT) || 6970;
server.listen(port, '127.0.0.1', () => console.log(`Northstar at http://127.0.0.1:${port}${BASE}/${DEV ? ' (development)' : ''}`));
const stop = () => { server.close(); vite?.close(); };
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
