// Atlas, server-rendered. `npm run build`, then `node server.js`; open
// http://localhost:3000.
//
// createRequestHandler renders every page from the --ssr build and streams
// it; the client build is served from dist/client and hydrates it.

import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler, toNodeListener } from 'what-framework/server';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const CLIENT = join(ROOT, 'dist/client');
const { routes, db } = await import('./dist/server/entry-server.js');

const manifest = JSON.parse(readFileSync(join(CLIENT, '.vite/manifest.json'), 'utf8'));
const entry = manifest['src/entry-client.jsx'];
const documentOptions = {
  clientEntry: `/${entry.file}`,
  head: (entry.css ?? []).map((href) => `<link rel="stylesheet" href="/${href}">`).join('')
    + '<link rel="icon" type="image/svg+xml" href="/favicon.svg">',
};

const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function clientFile(pathname) {
  if (pathname.includes('..')) return null;
  const file = resolve(join(CLIENT, pathname));
  if (!file.startsWith(CLIENT) || file.includes('/.vite/')) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

const app = toNodeListener(createRequestHandler({ routes, document: documentOptions }));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/projects' && req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let draft = {};
    try { draft = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* an empty draft */ }
    res.writeHead(201, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify(db.create(draft)));
  }
  if (req.method === 'GET' && url.pathname !== '/') {
    const file = clientFile(decodeURIComponent(url.pathname));
    if (file) {
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      return createReadStream(file).pipe(res);
    }
  }
  app(req, res);
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => console.log(`Atlas at http://localhost:${port}`));
process.once('SIGTERM', () => server.close());
process.once('SIGINT', () => server.close());
