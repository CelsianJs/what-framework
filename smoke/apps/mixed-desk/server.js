// Mixed Desk's server. `npm run build`, then `node server.js`; open
// http://localhost:3000. `node server.js --dev` serves both from the source
// through Vite's dev server instead, with no build.
//
// /quote/:symbol is rendered here from the --ssr build (a native page around
// a React island) and hydrated by the client build in dist/ssr-client. Every
// other path is the client-only desk in dist/. With ?hold, the page waits
// for window.__hydrate() before it loads the script that hydrates it, so a
// visitor's typing before hydration can be tested.
//
// In development two Vite servers answer, each with its config and its HMR
// socket on this server's port: the desk's (vite.config.js), and the quote
// page's (vite.ssr.config.js) under /@quote/, which loads the server entry
// (ssrLoadModule) and serves the modules that hydrate the page.

import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SPA = join(ROOT, 'dist');
const SSR_CLIENT = join(ROOT, 'dist/ssr-client');
const DEV = process.argv.includes('--dev');
const QUOTE_BASE = '/@quote/';

const MIME = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8' };

function fileIn(dir, pathname) {
  if (pathname.includes('..')) return null;
  const file = resolve(join(dir, pathname));
  if (!file.startsWith(dir) || file.includes('/.vite/')) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const server = http.createServer();
const port = Number(process.env.PORT) || 3000;

let desk = null;
let quote = null;
let built = null;
if (DEV) {
  const { createServer } = await import('vite');
  const middlewareMode = { middlewareMode: true, hmr: { server, port } };
  desk = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.js'), server: middlewareMode });
  quote = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.ssr.config.js'), base: QUOTE_BASE, server: middlewareMode });
} else {
  const manifest = JSON.parse(readFileSync(join(SSR_CLIENT, '.vite/manifest.json'), 'utf8'));
  built = { entry: manifest['src/ssr/entry-client.jsx'], render: (await import('./dist/server/entry-server.js')).render };
}

async function quotePage(symbol, hold) {
  const render = quote ? (await quote.ssrLoadModule('/src/ssr/entry-server.jsx')).render : built.render;
  const src = quote ? `${QUOTE_BASE}src/ssr/entry-client.jsx` : `/${built.entry.file}`;
  const css = quote
    ? `<script type="module" src="${QUOTE_BASE}@vite/client"></script>`
    : (built.entry.css ?? []).map((href) => `<link rel="stylesheet" href="/${href}">`).join('');
  const load = hold
    ? `<script>window.__hydrate = () => import(${JSON.stringify(src)});</script>`
    : `<script type="module" src="${src}"></script>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Quote · ${escape(symbol)}</title>${css}</head>`
    + `<body><div id="quote" data-symbol="${escape(symbol)}">${render(symbol)}</div>${load}</body></html>`;
}

function serveBuilt(req, res, url) {
  const file = fileIn(SSR_CLIENT, decodeURIComponent(url.pathname)) || fileIn(SPA, decodeURIComponent(url.pathname));
  if (file && url.pathname !== '/') {
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    return createReadStream(file).pipe(res);
  }
  res.writeHead(200, { 'content-type': MIME['.html'] });
  createReadStream(join(SPA, 'index.html')).pipe(res);
}

server.on('request', (req, res) => {
  const fail = (error) => {
    quote?.ssrFixStacktrace(error);
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(error?.stack ?? error));
  };
  const url = new URL(req.url, 'http://localhost');
  const symbol = /^\/quote\/([A-Z]{1,5})$/.exec(url.pathname);
  if (symbol) {
    quotePage(symbol[1], url.searchParams.has('hold')).then((html) => {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(html);
    }, fail);
    return;
  }
  if (!DEV) return serveBuilt(req, res, url);
  // The quote page's modules under /@quote/, the desk (its index.html for
  // every other page) from the desk's server.
  if (url.pathname.startsWith(QUOTE_BASE)) quote.middlewares(req, res, (error) => fail(error ?? new Error(`not found: ${url.pathname}`)));
  else desk.middlewares(req, res, (error) => fail(error ?? new Error(`not found: ${url.pathname}`)));
});

server.listen(port, '127.0.0.1', () => console.log(`Mixed Desk at http://127.0.0.1:${port}${DEV ? ' (development)' : ''}`));
const stop = () => { server.close(); desk?.close(); quote?.close(); };
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
