// Mixed Desk's server. `npm run build`, then `node server.js`; open
// http://localhost:3000.
//
// /quote/:symbol is rendered here from the --ssr build (a native page around
// a React island) and hydrated by the client build in dist/ssr-client. Every
// other path is the client-only desk in dist/. With ?hold, the page waits
// for window.__hydrate() before it loads the script that hydrates it, so a
// visitor's typing before hydration can be tested.

import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SPA = join(ROOT, 'dist');
const SSR_CLIENT = join(ROOT, 'dist/ssr-client');
const { render } = await import('./dist/server/entry-server.js');
const manifest = JSON.parse(readFileSync(join(SSR_CLIENT, '.vite/manifest.json'), 'utf8'));
const entry = manifest['src/ssr/entry-client.jsx'];

const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8' };

function fileIn(dir, pathname) {
  if (pathname.includes('..')) return null;
  const file = resolve(join(dir, pathname));
  if (!file.startsWith(dir) || file.includes('/.vite/')) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function quotePage(symbol, hold) {
  const src = `/${entry.file}`;
  const css = (entry.css ?? []).map((href) => `<link rel="stylesheet" href="/${href}">`).join('');
  const load = hold
    ? `<script>window.__hydrate = () => import(${JSON.stringify(src)});</script>`
    : `<script type="module" src="${src}"></script>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Quote · ${escape(symbol)}</title>${css}</head>`
    + `<body><div id="quote" data-symbol="${escape(symbol)}">${render(symbol)}</div>${load}</body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const quote = /^\/quote\/([A-Z]{1,5})$/.exec(url.pathname);
  if (quote) {
    res.writeHead(200, { 'content-type': MIME['.html'] });
    return res.end(quotePage(quote[1], url.searchParams.has('hold')));
  }
  const file = fileIn(SSR_CLIENT, decodeURIComponent(url.pathname)) || fileIn(SPA, decodeURIComponent(url.pathname));
  if (file && url.pathname !== '/') {
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    return createReadStream(file).pipe(res);
  }
  res.writeHead(200, { 'content-type': MIME['.html'] });
  createReadStream(join(SPA, 'index.html')).pipe(res);
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, '127.0.0.1', () => console.log(`Mixed Desk at http://127.0.0.1:${port}`));
process.once('SIGTERM', () => server.close());
process.once('SIGINT', () => server.close());
