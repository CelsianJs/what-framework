// Atlas, server-rendered. `npm run build`, then `node server.js`; open
// http://localhost:3000. `npm run dev` (`node server.js --dev`) renders from
// the source through Vite's dev server instead, with no build.
//
// createRequestHandler renders every page from the --ssr build and streams
// it; the client build is served from dist/client and hydrates it. In
// development Vite loads the server entry (ssrLoadModule) and serves the
// client's modules, the page loading /src/entry-client.jsx itself.

import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler, toNodeListener } from 'what-framework/server';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = join(ROOT, 'dist/client');
const DEV = process.argv.includes('--dev');
const ICON = '<link rel="icon" type="image/svg+xml" href="/favicon.svg">';

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
  documentOptions = { clientEntry: '/src/entry-client.jsx', head: `<script type="module" src="/@vite/client"></script>${ICON}` };
} else {
  entry = await import('./dist/server/entry-server.js');
  const manifest = JSON.parse(readFileSync(join(CLIENT, '.vite/manifest.json'), 'utf8'));
  const client = manifest['src/entry-client.jsx'];
  documentOptions = {
    clientEntry: `/${client.file}`,
    head: (client.css ?? []).map((href) => `<link rel="stylesheet" href="/${href}">`).join('') + ICON,
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
    app = toNodeListener(createRequestHandler({ routes: mod.routes, document: documentOptions }));
  }
  return { app, db: mod.db };
}

async function handle(req, res) {
  const { app: render, db } = await current();
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/projects' && req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let draft = {};
    try { draft = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* an empty draft */ }
    res.writeHead(201, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(db.create(draft)));
  }
  if (!vite && req.method === 'GET' && url.pathname !== '/') {
    const file = clientFile(decodeURIComponent(url.pathname));
    if (file) {
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      return createReadStream(file).pipe(res);
    }
  }
  render(req, res);
}

server.on('request', (req, res) => {
  const fail = (error) => {
    vite?.ssrFixStacktrace(error);
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(error?.stack ?? error));
  };
  // Vite answers for the client's modules and the public files; a page is
  // left to the handler.
  if (vite) vite.middlewares(req, res, (error) => (error ? fail(error) : handle(req, res).catch(fail)));
  else handle(req, res).catch(fail);
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`Atlas at http://localhost:${port}${DEV ? ' (development)' : ''}`));
const stop = () => { server.close(); vite?.close(); };
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
