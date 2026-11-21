/**
 * Node side of the devtools bridge: the WebSocket server the page's client
 * connects to, and a small HTTP control port the Vite plugin pairs through.
 *
 * Sessions. Each page load that connects is one session (s1, s2, …) with its
 * own event log, diagnostics, errors, baseline and pending commands. A second
 * tab never changes what another session's answers say, closing one tab never
 * disconnects another, and when more than one is live the tools make the agent
 * name one. A page whose socket drops and comes back keeps its session.
 *
 * Trust. A browser page is admitted only with a credential the bridge issued
 * for that page's exact origin. Credentials come from pairing: the Vite plugin,
 * running inside the dev server of this project, reads the pairing key the
 * bridge wrote under the project's node_modules/.cache and asks for a
 * credential for its own origin. The control port refuses anything a browser
 * sends, so no page can read a key or a credential from it. One dev-server
 * origin is served at a time: while it has a live page (and briefly after, so a
 * reload keeps it), another origin is refused and the refusal is reported.
 * Every inbound message is checked for shape and size, and a response is only
 * accepted on the socket its command was sent on.
 *
 * Time. Every event gets a bridge-wide sequence number `seq`. The page flushes
 * its event buffer before it answers a command, so when a response arrives the
 * session's latest seq is exactly the state the response describes. Actions
 * send a mark first, after flushing, so `since` is the cursor just before the
 * action and (since, seq] is what it did.
 */

import { WebSocketServer } from 'ws';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, relative, isAbsolute, resolve } from 'node:path';

const MAX_EVENT_LOG = 2000;
const MAX_ERROR_LOG = 100;
const MAX_DIAGNOSTICS = 500;
const MAX_PAYLOAD = 8 * 1024 * 1024;
const MAX_BATCH = 2000;
const MAX_CLOSED_SESSIONS = 4;
const MAX_REFUSALS = 10;
const ORIGIN_GRACE_MS = 10_000;
const REFUSAL_TTL_MS = 10 * 60_000;
const PAIR_BODY_LIMIT = 4096;

export const EVENT_NAMES = new Set([
  'signal:created', 'signal:updated', 'signal:disposed',
  'effect:created', 'effect:run', 'effect:disposed',
  'component:mounted', 'component:unmounted',
  'error:captured', 'diagnostic',
  'async:start', 'async:land', 'async:unresolved', 'async:ready', 'async:errored',
  'transition:open', 'transition:commit', 'transition:merged',
  'optimistic:add', 'optimistic:drop',
  'suspense:waiting', 'suspense:revealed', 'suspense:disposed', 'hydration:complete',
]);

// Diagnostics fold by code and subject in the page; the bridge keeps the latest
// copy of each, keyed the same way, so a repeat updates its count in place.
function diagnosticKey(d) {
  const s = d.subject;
  return s && typeof s === 'object' ? `${d.code}|${s.kind}|${s.id ?? s.name}` : `${d.code}|${d.message}`;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isShortString = (v, max) => typeof v === 'string' && v.length <= max;

/** True for an http(s) origin on a loopback host, written exactly as browsers send it. */
export function isLoopbackOrigin(origin) {
  if (typeof origin !== 'string') return false;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || !/^https?:$/.test(url.protocol)) return false;
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  } catch {
    return false;
  }
}

function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** The file the bridge writes for the Vite plugin, relative to the project root. */
export const BRIDGE_FILE = join('node_modules', '.cache', 'what-devtools-mcp', 'bridge.json');

/**
 * @param {object} [options]
 * @param {number} [options.port] WebSocket port; the control port is port+1
 * @param {string} [options.host]
 * @param {string} [options.projectRoot] Directory whose dev servers may pair (default: cwd)
 * @param {(err: any) => void} [options.onError]
 */
export function createBridge({ port = 9229, host = '127.0.0.1', projectRoot = process.cwd(), onError } = {}) {
  const root = resolve(projectRoot);
  // The pairing key: proof that a caller can read this project's files, or
  // was given WHAT_MCP_TOKEN. It is never sent to a browser.
  const pairingKey = process.env.WHAT_MCP_TOKEN || randomBytes(24).toString('hex');

  let seq = 0;
  let sessionCounter = 0;
  let correlationCounter = 0;
  /** @type {Map<string, any>} */
  const sessions = new Map();
  /** @type {Map<string, string>} credential → origin */
  const credentials = new Map();
  let boundOrigin = null;
  let boundOriginReleasedAt = 0;
  const refusals = [];

  function refuse(origin, reason) {
    refusals.push({ origin: origin || null, reason, at: Date.now() });
    if (refusals.length > MAX_REFUSALS) refusals.shift();
  }

  function liveSessions() {
    return [...sessions.values()].filter((s) => s.socket !== null);
  }

  // A page origin may attach when no origin is bound, when it is the bound one,
  // or when the bound one has had no live page for the grace period.
  function originAvailable(origin) {
    if (boundOrigin === null || boundOrigin === origin) return true;
    if (liveSessions().some((s) => s.origin === boundOrigin)) return false;
    return Date.now() - boundOriginReleasedAt > ORIGIN_GRACE_MS;
  }

  function bindOrigin(origin) {
    if (boundOrigin === origin) return;
    for (const [credential, credentialOrigin] of credentials) {
      if (credentialOrigin !== origin) credentials.delete(credential);
    }
    boundOrigin = origin;
  }

  function issueCredential(origin) {
    for (const [credential, credentialOrigin] of credentials) {
      if (credentialOrigin === origin) return credential;
    }
    const credential = randomBytes(24).toString('hex');
    credentials.set(credential, origin);
    return credential;
  }

  // --- WebSocket server ------------------------------------------------------

  const wss = new WebSocketServer({
    host,
    port,
    maxPayload: MAX_PAYLOAD,
    verifyClient: (info, done) => {
      let url;
      try { url = new URL(info.req.url, `http://${host}:${port}`); } catch { return done(false, 400, 'Bad request'); }
      const token = url.searchParams.get('token') || '';
      const origin = info.req.headers.origin;
      if (origin === undefined) {
        // A local process, not a browser: the pairing key is its credential.
        return sameSecret(token, pairingKey) ? done(true) : done(false, 401, 'Unauthorized');
      }
      if (!isLoopbackOrigin(origin)) {
        refuse(origin, 'not a loopback origin');
        return done(false, 403, 'Forbidden origin');
      }
      const credentialOrigin = credentials.get(token);
      const manual = sameSecret(token, pairingKey);
      if (credentialOrigin !== origin && !manual) {
        refuse(origin, credentialOrigin ? `credential issued for ${credentialOrigin}` : 'no credential for this origin');
        return done(false, 401, 'Unauthorized');
      }
      if (!originAvailable(origin)) {
        refuse(origin, `the bridge is serving ${boundOrigin}`);
        return done(false, 409, 'Another dev server is attached');
      }
      bindOrigin(origin);
      done(true);
    },
  });

  // The WebSocketServer binds the port on construction. Without an 'error'
  // listener an EADDRINUSE (9229 is also Node's default --inspect port) is
  // rethrown and crashes the process. The bridge cannot work without its
  // port, so exit cleanly with an actionable message; tests pass onError.
  wss.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      const inspectNote = port === 9229 ? ' (note: 9229 is also Node\'s default --inspect port)' : '';
      console.error(`[what-devtools-mcp] port ${port} in use — set WHAT_MCP_PORT to a free port or stop the process using it${inspectNote}.`);
    } else {
      console.error(`[what-devtools-mcp] bridge WebSocket server error: ${err && err.message ? err.message : err}`);
    }
    if (typeof onError === 'function') {
      onError(err);
    } else {
      process.exit(0);
    }
  });

  function newSession(socket, origin, pageId) {
    const session = {
      id: `s${++sessionCounter}`,
      pageId,
      origin,
      socket,
      url: null,
      title: null,
      connectedAt: Date.now(),
      closedAt: null,
      events: [],
      lostThrough: 0,
      lastSeq: 0,
      diagnostics: new Map(),
      diagnosticsEvicted: 0,
      diagnosticsLostThrough: 0,
      pageDiagnosticsDropped: 0,
      errors: [],
      errorsEvicted: 0,
      rejected: 0,
      names: { signals: new Map(), effects: new Map(), components: new Set() },
      baseline: null,
      pending: new Map(),
    };
    sessions.set(session.id, session);
    return session;
  }

  function record(session, event, data) {
    const entry = { seq: ++seq, event, data, at: Date.now() };
    session.events.push(entry);
    session.lastSeq = entry.seq;
    if (session.events.length > MAX_EVENT_LOG) session.lostThrough = session.events.shift().seq;
    if (!isObject(data)) return;
    if ((event === 'signal:created' || event === 'signal:updated') && typeof data.name === 'string') {
      session.names.signals.set(data.id, data.name);
    } else if ((event === 'effect:created' || event === 'effect:run') && typeof data.name === 'string') {
      session.names.effects.set(data.id, data.name);
    } else if (event === 'component:mounted' && typeof data.name === 'string') {
      session.names.components.add(data.name);
    } else if (event === 'error:captured') {
      // A page that reconnects replays its error backlog; keep one copy.
      if (session.errors.some((e) => e.timestamp === data.timestamp && e.message === data.message && e.type === data.type)) return;
      session.errors.push({ ...data, seq: entry.seq });
      if (session.errors.length > MAX_ERROR_LOG) {
        session.errors.shift();
        session.errorsEvicted++;
      }
    } else if (event === 'diagnostic' && typeof data.code === 'string') {
      const key = diagnosticKey(data);
      session.diagnostics.delete(key);
      session.diagnostics.set(key, { ...data, seq: entry.seq });
      if (session.diagnostics.size > MAX_DIAGNOSTICS) {
        const oldest = session.diagnostics.keys().next().value;
        session.diagnosticsLostThrough = session.diagnostics.get(oldest).seq;
        session.diagnostics.delete(oldest);
        session.diagnosticsEvicted++;
      }
    }
  }

  function validEvent(item) {
    return isObject(item) && EVENT_NAMES.has(item.event) && (item.data === undefined || item.data === null || isObject(item.data));
  }

  function onMessage(session, socket, raw) {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { session.rejected++; return; }
    if (!isObject(msg)) { session.rejected++; return; }
    switch (msg.type) {
      case 'hello':
        if (!isShortString(msg.url, 4096) || !isShortString(msg.title ?? '', 1024)) { session.rejected++; return; }
        session.url = msg.url;
        session.title = msg.title ?? '';
        if (Number.isInteger(msg.diagnosticsDropped) && msg.diagnosticsDropped >= 0) session.pageDiagnosticsDropped = msg.diagnosticsDropped;
        return;
      case 'event':
        if (!validEvent(msg)) { session.rejected++; return; }
        record(session, msg.event, msg.data ?? {});
        return;
      case 'events':
        if (!Array.isArray(msg.batch) || msg.batch.length > MAX_BATCH) { session.rejected++; return; }
        for (const item of msg.batch) {
          if (validEvent(item)) record(session, item.event, item.data ?? {});
          else session.rejected++;
        }
        return;
      case 'mark':
      case 'response': {
        const pending = isShortString(msg.correlationId, 64) ? session.pending.get(msg.correlationId) : undefined;
        if (!pending || pending.socket !== socket) { session.rejected++; return; }
        if (msg.type === 'mark') {
          pending.since = session.lastSeq;
          return;
        }
        session.pending.delete(msg.correlationId);
        pending.settle({ data: msg.data, seq: session.lastSeq, since: pending.since });
        return;
      }
      default:
        session.rejected++;
    }
  }

  wss.on('connection', (socket, req) => {
    const origin = req.headers.origin ?? null;
    /** @type {string | null} */
    let pageId = null;
    try { pageId = new URL(req.url || '/', `http://${host}:${port}`).searchParams.get('page'); } catch { pageId = null; }
    if (pageId !== null && !/^[\w-]{1,64}$/.test(pageId)) pageId = null;

    let session = pageId === null ? null
      : [...sessions.values()].find((s) => s.pageId === pageId && s.origin === origin && s.socket === null) || null;
    if (session) {
      session.socket = socket;
      session.closedAt = null;
      record(session, 'page:reconnected', {});
    } else {
      session = newSession(socket, origin, pageId);
      record(session, 'page:connected', {});
    }
    const current = session;

    socket.on('message', (raw) => onMessage(current, socket, raw));
    // An oversized or malformed frame makes ws emit 'error' and then close the
    // socket; without a listener that error would crash the MCP server.
    socket.on('error', () => { current.rejected++; });
    socket.on('close', () => {
      if (current.socket !== socket) return;
      current.socket = null;
      current.closedAt = Date.now();
      if (current.origin === boundOrigin) boundOriginReleasedAt = current.closedAt;
      record(current, 'page:closed', {});
      for (const [id, pending] of current.pending) {
        pending.fail(new Error('The page disconnected before answering'));
        current.pending.delete(id);
      }
      const closed = [...sessions.values()].filter((s) => s.socket === null).sort((a, b) => a.closedAt - b.closedAt);
      while (closed.length > MAX_CLOSED_SESSIONS) sessions.delete(closed.shift().id);
    });
  });

  // --- Control port -----------------------------------------------------------
  //
  //   GET  /__what_mcp_probe  → { bridge: true, wsPort }   (no secret; lets the
  //        browser client check the bridge is up before it opens a socket)
  //   POST /__what_mcp_pair   → { credential, wsPort }     (Node callers only)

  const controlPort = port + 1;
  const httpServer = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    const path = (req.url || '').split('?')[0];

    if (req.method === 'GET' && path === '/__what_mcp_probe') {
      if (origin !== undefined) {
        if (!isLoopbackOrigin(origin)) { res.writeHead(403); res.end('Forbidden origin'); return; }
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ bridge: true, wsPort: port }));
      return;
    }

    if (req.method === 'POST' && path === '/__what_mcp_pair') {
      // Browsers send Origin on every cross-origin POST and Sec-Fetch-Site on
      // every request; the Vite plugin, a Node process, sends neither.
      if (origin !== undefined || req.headers['sec-fetch-site'] !== undefined) {
        res.writeHead(403); res.end('Pairing is not available to browsers'); return;
      }
      let body = '';
      let tooLarge = false;
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > PAIR_BODY_LIMIT) { tooLarge = true; req.destroy(); }
      });
      req.on('end', () => {
        if (tooLarge) return;
        const reply = (status, payload) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
        };
        let request;
        try { request = JSON.parse(body); } catch { reply(400, { error: 'Body must be JSON' }); return; }
        if (!isObject(request) || !sameSecret(request.key, pairingKey)) { reply(401, { error: 'Wrong pairing key' }); return; }
        if (!isLoopbackOrigin(request.origin)) { reply(400, { error: 'origin must be a loopback http(s) origin' }); return; }
        if (typeof request.root !== 'string' || !isAbsolute(request.root)) { reply(400, { error: 'root must be an absolute path' }); return; }
        const inside = relative(root, resolve(request.root));
        if (inside.startsWith('..') || isAbsolute(inside)) {
          refuse(request.origin, `dev server root ${request.root} is outside ${root}`);
          reply(403, { error: `This bridge serves ${root}` });
          return;
        }
        if (!originAvailable(request.origin)) {
          refuse(request.origin, `the bridge is serving ${boundOrigin}`);
          reply(409, { error: `The bridge is attached to ${boundOrigin}`, boundOrigin });
          return;
        }
        bindOrigin(request.origin);
        reply(200, { credential: issueCredential(request.origin), wsPort: port });
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  // Resolves once both ports listen; rejects with the first bind error.
  const ready = Promise.all([
    new Promise((resolveListen, rejectListen) => {
      wss.once('listening', resolveListen);
      wss.once('error', rejectListen);
    }),
    new Promise((resolveListen, rejectListen) => {
      httpServer.once('listening', resolveListen);
      httpServer.once('error', rejectListen);
    }),
  ]).then(() => undefined);
  ready.catch(() => {});

  httpServer.listen(controlPort, host, () => {
    console.error(`[what-devtools-mcp] Pairing on http://${host}:${controlPort}`);
  });
  httpServer.on('error', () => {
    console.error(`[what-devtools-mcp] Control port ${controlPort} unavailable: dev servers cannot pair until it is free`);
  });

  const bridgeFile = join(root, BRIDGE_FILE);
  try {
    mkdirSync(join(bridgeFile, '..'), { recursive: true });
    writeFileSync(bridgeFile, JSON.stringify({ port, controlPort, key: pairingKey, root, pid: process.pid }), { mode: 0o600 });
  } catch {
    // Without the file a dev server can still pair through WHAT_MCP_TOKEN.
  }

  console.error(`[what-devtools-mcp] Bridge listening on ws://${host}:${port}`);

  // --- Query API ---------------------------------------------------------------

  function describeSession(s) {
    return {
      id: s.id,
      url: s.url,
      title: s.title,
      live: s.socket !== null,
      ...(s.socket === null ? { closedAt: s.closedAt } : {}),
    };
  }

  /**
   * The session a tool call is about. Without an id, the one live session;
   * with several live, the caller must choose. Closed sessions answer only
   * when `allowClosed` (buffered history).
   * @param {string | undefined} id
   * @param {{ allowClosed?: boolean }} [opts]
   */
  function resolveSession(id, { allowClosed = false } = {}) {
    const live = liveSessions();
    if (id) {
      const s = sessions.get(id);
      if (!s) return { problem: 'unknown', sessions: [...sessions.values()].map(describeSession) };
      if (s.socket === null && !allowClosed) return { problem: 'closed', sessions: live.map(describeSession) };
      return { session: s };
    }
    if (live.length === 1) return { session: live[0] };
    if (live.length > 1) return { problem: 'ambiguous', sessions: live.map(describeSession) };
    if (allowClosed && sessions.size) {
      const last = [...sessions.values()].sort((a, b) => b.closedAt - a.closedAt)[0];
      return { session: last };
    }
    return { problem: 'none', sessions: [] };
  }

  /**
   * Send a command to one session's page. Resolves with the page's answer,
   * `seq` (the session's watermark when the answer arrived) and, for actions,
   * `since` (the watermark just before the action ran).
   */
  function request(session, command, args = {}, { timeout = 5000 } = {}) {
    return new Promise((resolvePromise, rejectPromise) => {
      const socket = session.socket;
      if (!socket || socket.readyState !== 1) {
        rejectPromise(new Error('The page is not connected'));
        return;
      }
      const correlationId = `c${++correlationCounter}`;
      const timer = setTimeout(() => {
        session.pending.delete(correlationId);
        rejectPromise(new Error(`Command '${command}' timed out after ${timeout}ms`));
      }, timeout);
      session.pending.set(correlationId, {
        socket,
        since: undefined,
        settle: (answer) => { clearTimeout(timer); resolvePromise(answer); },
        fail: (err) => { clearTimeout(timer); rejectPromise(err); },
      });
      socket.send(JSON.stringify({ command, correlationId, args }));
    });
  }

  /**
   * Events of one session after a cursor, oldest first. `next` is the cursor
   * for the following read: the last returned seq when `more`, else the
   * session watermark, so reading from `next` never repeats or skips.
   * `lostThrough` > after means events at or before it were evicted unread.
   */
  function getEvents(session, { after = 0 } = {}) {
    return {
      events: session.events.filter((e) => e.seq > after),
      watermark: session.lastSeq,
      lostThrough: session.lostThrough > after ? session.lostThrough : 0,
    };
  }

  function getDiagnostics(session, { after = 0 } = {}) {
    return [...session.diagnostics.values()].filter((d) => d.seq > after);
  }

  function getErrors(session, { after = 0 } = {}) {
    return session.errors.filter((e) => e.seq > after);
  }

  function close() {
    for (const s of sessions.values()) {
      for (const [id, pending] of s.pending) {
        pending.fail(new Error('Bridge closing'));
        s.pending.delete(id);
      }
    }
    for (const client of wss.clients) client.terminate();
    wss.close();
    httpServer.close();
    // Remove the pairing file only while it is still this bridge's.
    try {
      if (JSON.parse(readFileSync(bridgeFile, 'utf8')).key === pairingKey) rmSync(bridgeFile, { force: true });
    } catch { /* already gone */ }
  }

  return {
    ready,
    isConnected: () => liveSessions().length > 0,
    listSessions: () => [...sessions.values()].map(describeSession),
    resolveSession,
    request,
    getEvents,
    getDiagnostics,
    getErrors,
    refusals: () => refusals.filter((r) => Date.now() - r.at < REFUSAL_TTL_MS),
    boundOrigin: () => boundOrigin,
    close,
    pairingKey,
    port,
    controlPort,
  };
}
