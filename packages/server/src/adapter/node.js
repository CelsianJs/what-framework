// Node deploy adapter — wraps the framework-agnostic Web-Fetch handler from
// core.js in a Node http.Server / connect-style middleware. Dependency-free
// (Node 18+ ships global Request/Response/Headers).

import http from 'node:http';
import { createRequestHandler } from './core.js';

async function nodeToWebRequest(req) {
  const host = req.headers.host || 'localhost';
  const url = `http://${host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  }
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length) body = Buffer.concat(chunks);
  }
  return new Request(url, { method: req.method, headers, body });
}

async function sendWebResponse(res, webRes) {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => res.setHeader(key, value));
  const text = await webRes.text();
  res.end(text);
}

/** Convert a Web-Fetch handler into a Node (req, res) listener. */
export function toNodeListener(handler) {
  return async function listener(req, res) {
    try {
      const webReq = await nodeToWebRequest(req);
      const webRes = await handler(webReq);
      await sendWebResponse(res, webRes);
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><body><h1>500 — Server Error</h1></body></html>');
      // eslint-disable-next-line no-console
      console.error('[what-server] request error:', err);
    }
  };
}

/** connect/express middleware: handles app routes, calls next() on a 404. */
export function whatMiddleware(options = {}) {
  const handler = createRequestHandler(options);
  return async function middleware(req, res, next) {
    const webReq = await nodeToWebRequest(req);
    const webRes = await handler(webReq);
    if (webRes.status === 404 && typeof next === 'function') return next();
    await sendWebResponse(res, webRes);
  };
}

/**
 * Create a ready-to-listen Node server. Starts the poll scheduler (if provided)
 * and stops it on SIGTERM/SIGINT.
 *   const server = createServer({ routes, cache, scheduler });
 *   server.listen(3000);
 */
export function createServer(options = {}) {
  const handler = createRequestHandler(options);
  const server = http.createServer(toNodeListener(handler));

  const { scheduler } = options;
  if (scheduler) {
    scheduler.start();
    const stop = () => { try { scheduler.stop(); } catch {} server.close(); };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  }

  return server;
}
