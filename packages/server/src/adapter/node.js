// Node deploy adapter — wraps the framework-agnostic Web-Fetch handler from
// core.js in a Node http.Server / connect-style middleware. Dependency-free
// (Node 18+ ships global Request/Response/Headers).

import http from 'node:http';
import { createRequestHandler } from './core.js';
import { bodyLimitOf, tooLargeResponse } from '../action-handler.js';
import { nodeRequestHost, requestScheme, requestUrl } from '../request-url.js';

// A Request object only exists after the body is read, so the cap the fetch
// path enforces would run too late here. Returned instead of a Request when the
// body is over the limit, so the caller answers 413 without buffering it all.
const TOO_LARGE = Symbol('what.bodyTooLarge');

// Returned instead of a Request for a request target that is not a path, or
// a Host header that is not a host (request-url.js).
const BAD_TARGET = Symbol('what.badTarget');

const BAD_TARGET_RESPONSE = () => new Response('Bad Request', { status: 400, headers: { 'content-type': 'text/plain; charset=utf-8' } });

// The Request's signal aborts when the client goes away before the response is
// finished, so the loader, the render and every server fetcher can stop.
function disconnectSignal(res) {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

async function nodeToWebRequest(req, res, limit) {
  // A path only ('/x?y', '//x' included): an absolute-form or authority-form
  // target names a host of its own, which the request's Host header decides
  // here, and `*` names no resource. The scheme is the one a proxy in front
  // reports (X-Forwarded-Proto), else the one the socket was reached by: a TLS
  // server's requests are https (request-url.js requestScheme).
  const url = requestUrl(requestScheme(req.headers, req.socket && req.socket.encrypted ? 'https' : 'http'), nodeRequestHost(req.headers), req.url);
  if (url === null) return BAD_TARGET;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    // HTTP/2's pseudo-headers (`:path`, `:authority`) are not header fields.
    if (v != null && !k.startsWith(':')) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
  }
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const declared = Number(req.headers['content-length']);
    let tooLarge = Number.isFinite(declared) && declared > limit;
    const chunks = [];
    let size = 0;
    // Once over the cap the remaining chunks are drained and discarded rather
    // than buffered: memory stays bounded, and the socket survives long enough
    // to carry the 413 back. Chunked transfer or a spoofed Content-Length
    // cannot get past the running total.
    for await (const chunk of req) {
      if (tooLarge) continue;
      size += chunk.length;
      if (size > limit) {
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

// Whether the request failed because the client went away: the work stopped
// on purpose (an abort), or the body stopped arriving (a cancelled upload, a
// closed tab: Node's `aborted` error, ECONNRESET), with nobody left to answer.
function clientGone(res, err) {
  return res.destroyed && (isAbort(err) || (!!err && (err.code === 'ECONNRESET' || err.code === 'ERR_STREAM_PREMATURE_CLOSE')));
}

// The handler's response for one Node request: 413 and 400 come from reading
// the request, before the handler, with `limit` (its `bodyLimit`).
async function respond(handler, req, res, limit) {
  const webReq = await nodeToWebRequest(req, res, limit);
  if (webReq === TOO_LARGE) return tooLargeResponse(req.headers, limit);
  if (webReq === BAD_TARGET) return BAD_TARGET_RESPONSE();
  return handler(webReq);
}

// What a failed request gets, unless the client went away and the work
// stopped on purpose (nobody to answer). Once the status line and part of the
// page are out, a second document cannot be appended to the first. Cutting
// the connection is the only honest signal left: the client (and any cache)
// sees a truncated response, not a complete-looking page with a 500 glued to
// its end.
function failed(res, err) {
  if (clientGone(res, err)) return;
  console.error('[what-server] request error:', err);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!DOCTYPE html><html><body><h1>500 — Server Error</h1></body></html>');
}

/**
 * Convert a Web-Fetch handler into a Node (req, res) listener. It reads each
 * request body before the handler, up to `options.bodyLimit`, else the
 * handler's own (`createRequestHandler` sets it on the function it returns),
 * else 1 MB: a handler wrapped in a function of yours (logging, headers) has
 * none, so pass its limit here.
 */
export function toNodeListener(handler, options = {}) {
  const limit = bodyLimitOf(options.bodyLimit !== undefined ? options : { bodyLimit: handler.bodyLimit });
  return async function listener(req, res) {
    try {
      await sendWebResponse(res, await respond(handler, req, res, limit));
    } catch (err) {
      failed(res, err);
    }
  };
}

/**
 * connect/express middleware: handles app routes, calls next() on a 404. It
 * never rejects (connect and Express 4 drop the promise a middleware returns,
 * and Node ends the process on a rejection nobody handles): an error the
 * handler throws goes to next(err).
 */
export function whatMiddleware(options = {}) {
  const handler = createRequestHandler(options);
  return async function middleware(req, res, next) {
    let webRes;
    try {
      webRes = await respond(handler, req, res, handler.bodyLimit);
    } catch (err) {
      if (clientGone(res, err)) return;
      if (typeof next === 'function') return next(err);
      failed(res, err);
      return;
    }
    if (webRes.status === 404 && typeof next === 'function') return next();
    try {
      await sendWebResponse(res, webRes);
    } catch (err) {
      failed(res, err);
    }
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
