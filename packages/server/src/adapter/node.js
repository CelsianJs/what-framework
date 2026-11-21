// Node deploy adapter — wraps the framework-agnostic Web-Fetch handler from
// core.js in a Node http.Server / connect-style middleware. Dependency-free
// (Node 18+ ships global Request/Response/Headers).

import http from 'node:http';
import { createRequestHandler } from './core.js';
import { MAX_BODY_BYTES } from '../action-handler.js';

// A Request object only exists after the body is read, so the cap the fetch
// path enforces would run too late here. Returned instead of a Request when the
// body is over the limit, so the caller answers 413 without buffering it all.
const TOO_LARGE = Symbol('what.bodyTooLarge');

const TOO_LARGE_RESPONSE = () => new Response(
  JSON.stringify({ message: 'Payload too large' }),
  { status: 413, headers: { 'content-type': 'application/json' } },
);

// The Request's signal aborts when the client goes away before the response is
// finished, so the loader, the render and every server fetcher can stop.
function disconnectSignal(res) {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

async function nodeToWebRequest(req, res) {
  const host = req.headers.host || 'localhost';
  // The scheme the socket was reached by: a TLS server's requests are https.
  const url = `${req.socket && req.socket.encrypted ? 'https' : 'http'}://${host}${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  }
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const declared = Number(req.headers['content-length']);
    let tooLarge = Number.isFinite(declared) && declared > MAX_BODY_BYTES;
    const chunks = [];
    let size = 0;
    // Once over the cap the remaining chunks are drained and discarded rather
    // than buffered: memory stays bounded, and the socket survives long enough
    // to carry the 413 back. Chunked transfer or a spoofed Content-Length
    // cannot get past the running total.
    for await (const chunk of req) {
      if (tooLarge) continue;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        continue;
      }
      chunks.push(chunk);
    }
    if (tooLarge) return TOO_LARGE;
    if (chunks.length) body = Buffer.concat(chunks);
  }
  return new Request(url, { method: req.method, headers, body, signal: disconnectSignal(res) });
}

/** @returns {Promise<void>} */
function drained(res) {
  return new Promise((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.on('drain', done);
    res.on('close', done);
  });
}

// Streams the body as it is produced. A streamed page reaches the client
// shell-first instead of being buffered whole, and write() reporting a full
// socket pauses reading until it drains.
async function sendWebResponse(res, webRes) {
  res.statusCode = webRes.status;
  // setHeader replaces, and a Headers object yields each Set-Cookie on its own,
  // so copying them one by one kept only the last cookie.
  webRes.headers.forEach((value, key) => {
    if (key !== 'set-cookie') res.setHeader(key, value);
  });
  const cookies = webRes.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie', cookies);
  if (!webRes.body) {
    res.end();
    return;
  }
  const reader = webRes.body.getReader();
  // A client that goes away cancels the body, which ends a pending read and
  // lets a streaming renderer stop.
  const onClose = () => {
    if (!res.writableFinished) reader.cancel().catch(() => {});
  };
  res.on('close', onClose);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || res.destroyed) break;
      if (!res.write(value)) await drained(res);
    }
    if (!res.destroyed) res.end();
  } finally {
    res.off('close', onClose);
  }
}

function isAbort(err) {
  return !!err && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

/** Convert a Web-Fetch handler into a Node (req, res) listener. */
export function toNodeListener(handler) {
  return async function listener(req, res) {
    try {
      const webReq = await nodeToWebRequest(req, res);
      if (webReq === TOO_LARGE) return await sendWebResponse(res, TOO_LARGE_RESPONSE());
      const webRes = await handler(webReq);
      await sendWebResponse(res, webRes);
    } catch (err) {
      // The client went away and the work stopped on purpose: nobody to answer.
      if (res.destroyed && isAbort(err)) return;
      // eslint-disable-next-line no-console
      console.error('[what-server] request error:', err);
      // Once the status line and part of the page are out, a second document
      // cannot be appended to the first. Cutting the connection is the only
      // honest signal left: the client (and any cache) sees a truncated
      // response, not a complete-looking page with a 500 glued to its end.
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><body><h1>500 — Server Error</h1></body></html>');
    }
  };
}

/** connect/express middleware: handles app routes, calls next() on a 404. */
export function whatMiddleware(options = {}) {
  const handler = createRequestHandler(options);
  return async function middleware(req, res, next) {
    const webReq = await nodeToWebRequest(req, res);
    if (webReq === TOO_LARGE) return await sendWebResponse(res, TOO_LARGE_RESPONSE());
    let webRes;
    try {
      webRes = await handler(webReq);
    } catch (err) {
      if (res.destroyed && isAbort(err)) return;
      throw err;
    }
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
