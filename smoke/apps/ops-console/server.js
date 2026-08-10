// Ops console server. `npm run dev` (auto-restart) or `node server.js`.
// Serves http://localhost:3000.
//
// Buildless: the browser loads /src/entry-client.js as a native ES module and
// the import map below resolves its bare specifiers to sources under
// node_modules. No bundler, no CDN.
//
// There is no ISR cache here and no server actions. Both are the storefront
// app's territory; this one is about the async and accessibility surfaces, so
// its server is deliberately the smallest thing that can render a document and
// answer a JSON API.

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderDocument } from 'what-framework/server';

import { matchPath } from './src/routes.js';
import {
  acknowledge,
  createIncident,
  getIncident,
  listAcks,
  listEvents,
  listServices,
  listSeverities,
} from './src/data/incidents.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

// A round trip an operator would actually feel. It is also what makes the
// optimistic acknowledge worth having: without latency there is nothing to
// paper over.
const ACK_LATENCY_MS = 140;

const importMap = {
  imports: {
    'what-framework': '/node_modules/what-framework/src/index.js',
    'what-core': '/node_modules/what-core/src/index.js',
    'what-router': '/node_modules/what-router/src/index.js',
    // The client-safe half of the server package: useOptimistic lives in
    // actions.js, which imports nothing from node:*.
    'what-server/actions': '/node_modules/what-server/src/actions.js',
  },
};

const sharedHead =
  '<link rel="stylesheet" href="/src/styles.css">' +
  '<link rel="icon" type="image/svg+xml" href="/favicon.svg">';

const hydratedDocument = {
  clientEntry: '/src/entry-client.js',
  head: `<script type="importmap">${JSON.stringify(importMap)}</script>${sharedHead}`,
};

// No client entry and no import map: a page that ships zero JavaScript should
// not ship the machinery for JavaScript either.
const staticDocument = { head: sharedHead };

// --- Static files ----------------------------------------------------------

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Deny by default. src/data/** (the incident store), src/routes.js and
// src/pages/health.js are importable by Node and 404 over HTTP, so seed data,
// mutation logic and the diagnostics renderer never reach a browser. Add new
// client-side files here explicitly.
const SERVED_FILES = new Set([
  '/src/entry-client.js',
  '/src/styles.css',
  '/src/pane-routes.js',
  '/src/pages/console.js',
]);

const SERVED_PREFIXES = [
  '/src/components/',
  '/src/lib/',
  '/src/panels/',
  '/node_modules/what-framework/',
  '/node_modules/what-core/',
  '/node_modules/what-router/',
  '/node_modules/what-server/',
];

function resolveStaticFile(pathname) {
  if (pathname.includes('..') || pathname.includes(' ')) return null;
  const allowed = SERVED_FILES.has(pathname) || SERVED_PREFIXES.some((p) => pathname.startsWith(p));
  const file = allowed
    ? resolve(join(ROOT, pathname))
    : resolve(join(ROOT, 'public', pathname));
  if (!file.startsWith(resolve(ROOT))) return null;
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

// --- JSON API --------------------------------------------------------------

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const ACK_PATH = /^\/api\/incidents\/([^/]+)\/ack$/;
const INCIDENT_PATH = /^\/api\/incidents\/([^/]+)$/;

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;

  if (req.method === 'GET' && pathname === '/api/events') {
    return sendJson(res, 200, listEvents(searchParams.get('cursor'), searchParams.get('limit')));
  }

  if (req.method === 'GET' && pathname === '/api/acks') {
    return sendJson(res, 200, listAcks());
  }

  if (req.method === 'POST' && pathname === '/api/incidents') {
    const body = await readJsonBody(req);
    const title = String(body.title ?? '').trim();
    // The client validates first; the server refuses anyway, because a client
    // that can be bypassed is not a validator.
    if (title.length < 10) return sendJson(res, 422, { message: 'title too short' });
    if (!listServices().includes(body.service)) return sendJson(res, 422, { message: 'unknown service' });
    if (!listSeverities().includes(body.severity)) return sendJson(res, 422, { message: 'unknown severity' });
    return sendJson(res, 201, {
      incident: createIncident({ title, service: body.service, severity: body.severity }),
    });
  }

  const ack = ACK_PATH.exec(pathname);
  if (req.method === 'POST' && ack) {
    await new Promise((r) => setTimeout(r, ACK_LATENCY_MS));
    const acks = acknowledge(decodeURIComponent(ack[1]));
    if (!acks) return sendJson(res, 404, { message: 'no such incident' });
    return sendJson(res, 200, { acks });
  }

  const detail = INCIDENT_PATH.exec(pathname);
  if (req.method === 'GET' && detail) {
    const incident = getIncident(decodeURIComponent(detail[1]));
    if (!incident) return sendJson(res, 404, { message: 'no such incident' });
    return sendJson(res, 200, incident);
  }

  return sendJson(res, 404, { message: 'no such endpoint' });
}

// --- Document rendering ----------------------------------------------------

async function renderRoute(match, url) {
  const reqCtx = {
    params: match.params,
    query: Object.fromEntries(url.searchParams),
  };
  const pageModule = { default: match.route.component, loader: match.route.loader };
  return renderDocument(pageModule, reqCtx, match.route.hydrate ? hydratedDocument : staticDocument);
}

const NOT_FOUND = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
  `<title>Unknown view | Northwind Ops</title>` +
  `<link rel="stylesheet" href="/src/styles.css"></head>` +
  `<body><div class="app"><main class="container"><h1>Unknown view</h1>` +
  `<p class="lede">No console route answers that path.</p>` +
  `<p><a href="/">Back to the event feed</a></p></main></div></body></html>`;

// --- Start (node server.js / npm run dev), not when imported ----------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

      if (req.method === 'GET' || req.method === 'HEAD') {
        const file = resolveStaticFile(decodeURIComponent(url.pathname));
        if (file) {
          res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
          if (req.method === 'HEAD') return res.end();
          return createReadStream(file).pipe(res);
        }

        const match = matchPath(url.pathname);
        if (!match) {
          res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
          return res.end(NOT_FOUND);
        }
        const html = await renderRoute(match, url);
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        });
        return res.end(html);
      }

      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('method not allowed');
    } catch (err) {
      console.error('[ops-console]', err);
      if (res.headersSent) return res.end();
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('internal error');
    }
  });

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`ops console ready at http://localhost:${port}`));
}
