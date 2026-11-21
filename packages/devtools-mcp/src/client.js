/**
 * Browser-side client for what-devtools-mcp.
 *
 * Connects to the Node bridge, streams devtools events and answers commands
 * from the MCP server. One page load is one session on the bridge; a dropped
 * socket that reconnects resumes it.
 *
 * Ordering contract with the bridge: events are buffered for a few ms and sent
 * in batches, and the buffer is always flushed before a command is answered,
 * so the bridge has every event up to the state a response describes. For an
 * action the client also sends a mark, after flushing and before acting, so
 * the bridge knows exactly which events the action caused.
 */

import { resolveSafeRead } from './safe-read.js';

// Branded console logger
const BADGE = 'background:#6366f1;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold';
const BADGE_CMD = 'background:#22c55e;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold';
const BADGE_WARN = 'background:#eab308;color:#000;padding:2px 6px;border-radius:3px;font-weight:bold';
const DIM = 'color:#888';

function log(badge, badgeStyle, ...args) {
  try { console.log(`%c${badge}%c`, badgeStyle, '', ...args); } catch { /* logging never breaks a command */ }
}

const ACTIONS = new Set(['set-signal', 'invalidate-cache', 'navigate', 'eval']);
const BATCH_MS = 16;
const MAX_BATCH = 1000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function newPageId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* fall through */ }
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function cut(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}…(+${s.length - max} chars)` : s;
}

// Event payloads go over the socket as JSON-safe, bounded data. Only a write
// carries live values; everything else devtools emits is already plain.
function serializeEvent(devtools, event, data) {
  if (event === 'signal:updated') {
    return { ...data, value: devtools.preview(data.value, 200), prev: devtools.preview(data.prev, 200) };
  }
  if (event === 'error:captured') {
    return { ...data, message: cut(data.message, 2000), stack: data.stack ? cut(data.stack, 4000) : null };
  }
  if (event === 'diagnostic') {
    // The fix text is not sent: the MCP server takes it from its own catalogue,
    // so page code cannot supply instructions under a trusted label.
    return {
      seq: data.seq,
      firstSeq: data.firstSeq,
      code: String(data.code),
      severity: data.severity,
      count: data.count,
      message: cut(data.message, 1000),
      owner: Array.isArray(data.owner) ? data.owner.slice(0, 12).map((o) => cut(o, 120)) : [],
      loc: data.loc ? cut(data.loc, 300) : null,
      subject: isObject(data.subject) ? devtools.preview(data.subject, 300) : null,
      data: devtools.preview(data.data, 1000),
    };
  }
  return data;
}

export function connectDevToolsMCP({ port = 9229, token = '', discoveryUrl = '' } = {}) {
  // Never connect in production
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') {
    return { disconnect() {}, reconnect() {}, isConnected: false, eventCount: 0 };
  }
  try {
    if (import.meta?.env?.PROD) {
      return { disconnect() {}, reconnect() {}, isConnected: false, eventCount: 0 };
    }
  } catch {}

  const pageId = newPageId();
  /** @type {WebSocket | null} */
  let ws = null;
  let connected = false;
  let stopped = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let probeTimer = null;
  // Probe back-off: first retry after 10s, then ×3 each time, capped at 5min.
  const PROBE_DELAY_INITIAL = 10000;
  const PROBE_DELAY_RECONNECT = 2000; // bridge restarts are usually fast
  const PROBE_BACKOFF_FACTOR = 3;
  const PROBE_DELAY_MAX = 300000;
  let probeDelay = PROBE_DELAY_INITIAL;
  let eventCount = 0;
  let hasLoggedMissingBridge = false;
  let hasShownBanner = false;
  /** @type {(() => void) | null} */
  let unsubscribe = null;
  let credential = token;
  let wsPort = port;

  let batch = [];
  /** @type {ReturnType<typeof setTimeout> | null} */
  let batchTimer = null;

  function send(msg) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    let text;
    try {
      text = JSON.stringify(msg);
    } catch (err) {
      if (msg.type !== 'response') return;
      text = JSON.stringify({ type: 'response', correlationId: msg.correlationId, data: { error: `Answer could not be serialized: ${err?.message || err}` } });
    }
    ws.send(text);
  }

  function flush() {
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
    while (batch.length) send({ type: 'events', batch: batch.splice(0, MAX_BATCH) });
  }

  function queue(event, data) {
    batch.push({ event, data });
    if (!batchTimer) batchTimer = setTimeout(flush, BATCH_MS);
  }

  // --- Quiet bridge probe ---
  // A WebSocket is opened only after this HTTP probe succeeds: a failed socket
  // prints an unsuppressible red console error, a failed fetch at most one
  // muted network line.
  //
  // 1. Same-origin discovery (`discoveryUrl`, set by the Vite plugin): the dev
  //    server pairs with the bridge Node-side and hands back a credential bound
  //    to this page's origin. A missing bridge produces no console output.
  // 2. Direct probe (an explicit pre-shared `token`, from WHAT_MCP_TOKEN): only
  //    checks the bridge is up; the token itself is the credential.
  async function probeBridge() {
    if (discoveryUrl) {
      try {
        const res = await fetch(discoveryUrl, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (!data.bridge || !data.credential) return false;
          credential = data.credential;
          wsPort = data.wsPort || port;
          return true;
        }
      } catch {
        // Dev server unreachable (page about to die) — stay quiet.
      }
      return false;
    }
    try {
      const res = await fetch(`http://localhost:${port + 1}/__what_mcp_probe`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        wsPort = data.wsPort || port;
        return true;
      }
    } catch {
      // Bridge not running — stay quiet; back-off handles retries.
    }
    return false;
  }

  async function tryConnect() {
    if (stopped) return;
    const bridgeUp = await probeBridge();
    if (stopped) return;
    if (!bridgeUp) {
      if (!hasLoggedMissingBridge) {
        hasLoggedMissingBridge = true;
        console.info(
          '%c[what]%c devtools bridge not detected — start what-devtools-mcp to enable agent debugging (retrying quietly in background)',
          DIM, DIM
        );
      }
      scheduleProbe();
      return;
    }
    openSocket();
  }

  function scheduleProbe() {
    if (probeTimer || stopped) return;
    probeTimer = setTimeout(() => {
      probeTimer = null;
      probeDelay = Math.min(probeDelay * PROBE_BACKOFF_FACTOR, PROBE_DELAY_MAX);
      tryConnect();
    }, probeDelay);
  }

  function openSocket() {
    try {
      ws = new WebSocket(`ws://localhost:${wsPort}/?token=${encodeURIComponent(credential)}&page=${encodeURIComponent(pageId)}`);
    } catch {
      scheduleProbe();
      return;
    }

    ws.onopen = () => {
      connected = true;
      probeDelay = PROBE_DELAY_RECONNECT;
      hasLoggedMissingBridge = false;
      if (!hasShownBanner) {
        hasShownBanner = true;
        console.log(
          '%c⚡ What DevTools MCP %c connected',
          'background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;padding:4px 10px;border-radius:4px;font-weight:bold;font-size:13px',
          'color:#a855f7;font-weight:bold'
        );
      }
      log('MCP', BADGE, '🟢 Connected to bridge — AI agent can now inspect this app');

      const devtools = window.__WHAT_DEVTOOLS__;
      const backlog = devtools?.getDiagnostics?.() || { events: [], dropped: 0 };
      send({ type: 'hello', url: location.href, title: document.title, diagnosticsDropped: backlog.dropped || 0 });
      if (!devtools) return;

      // What happened before the bridge connected (module scope, first render,
      // a startup effect error) would otherwise never reach the agent.
      for (const d of backlog.events) batch.push({ event: 'diagnostic', data: serializeEvent(devtools, 'diagnostic', d) });
      for (const e of devtools.getErrors?.() || []) batch.push({ event: 'error:captured', data: serializeEvent(devtools, 'error:captured', e) });
      flush();

      unsubscribe?.();
      unsubscribe = devtools.subscribe((event, data) => {
        eventCount++;
        queue(event, serializeEvent(devtools, event, data));
      });
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      handleCommand(msg);
    };

    ws.onclose = () => {
      const wasConnected = connected;
      connected = false;
      unsubscribe?.();
      unsubscribe = null;
      batch = [];
      if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
      if (wasConnected) {
        log('MCP', BADGE_WARN, '🔴 Disconnected from bridge — will reconnect quietly in background');
        probeDelay = PROBE_DELAY_RECONNECT;
      }
      scheduleProbe();
    };

    ws.onerror = () => {
      // Silence — onclose handles reconnection.
    };
  }

  function settleEffects() {
    try { window.__WHAT_CORE__?.flushSync?.(); } catch { /* effect errors are captured by devtools */ }
  }

  async function runCommand(command, args, devtools) {
    switch (command) {
      case 'sync':
        return {};
      case 'state':
        return devtools ? devtools.getState({ budget: Number(args.budget) || 300 }) : { signals: [], effects: [], components: [] };
      case 'signal': {
        const entry = devtools?._registries?.signals?.get(args.id);
        if (!entry) return { error: `Signal ${args.id} not found` };
        return { id: entry.id, name: entry.name, rev: entry.rev, value: devtools.preview(entry.ref.peek(), 4000) };
      }
      case 'read':
        return resolveSafeRead(args.path);
      case 'get-cache': {
        const core = window.__WHAT_CORE__ || {};
        const entries = typeof core.__getCacheSnapshot === 'function' ? core.__getCacheSnapshot() : [];
        return { entries: devtools ? devtools.preview(entries, 8000) : [] };
      }
      case 'set-signal': {
        const entry = devtools?._registries?.signals?.get(args.signalId);
        if (!entry) return { error: `Signal ${args.signalId} not found` };
        const previous = devtools.preview(entry.ref.peek(), 300);
        entry.ref(args.value);
        settleEffects();
        return { previous, current: devtools.preview(entry.ref.peek(), 300), rev: entry.rev };
      }
      case 'invalidate-cache': {
        const core = window.__WHAT_CORE__ || {};
        if (typeof core.invalidateQueries !== 'function') return { error: 'invalidateQueries not available' };
        core.invalidateQueries(args.key);
        settleEffects();
        return { invalidated: args.key };
      }
      default: {
        const { handleExtendedCommand } = await import('./client-commands.js');
        const result = await handleExtendedCommand(command, args, devtools);
        if (ACTIONS.has(command)) settleEffects();
        return result ?? { error: `Unknown command: ${command}` };
      }
    }
  }

  async function handleCommand(msg) {
    if (!isObject(msg) || typeof msg.command !== 'string' || typeof msg.correlationId !== 'string') return;
    const { command, correlationId } = msg;
    const args = isObject(msg.args) ? msg.args : {};
    const devtools = window.__WHAT_DEVTOOLS__;
    flush();
    if (ACTIONS.has(command)) send({ type: 'mark', correlationId });
    let result;
    try {
      result = await runCommand(command, args, devtools);
    } catch (err) {
      result = { error: `${command} failed: ${err?.message || err}` };
    }
    flush();
    send({ type: 'response', correlationId, data: result });
    if (command !== 'sync' && command !== 'state') {
      log('AI →', result?.error ? BADGE_WARN : BADGE_CMD, command, result?.error ? result.error : '');
    }
  }

  function disconnect() {
    stopped = true;
    unsubscribe?.();
    unsubscribe = null;
    if (probeTimer) {
      clearTimeout(probeTimer);
      probeTimer = null;
    }
    if (ws) {
      ws.onclose = null; // prevent reconnect
      ws.close();
      ws = null;
    }
    if (connected) log('MCP', BADGE, 'Disconnected');
    connected = false;
  }

  // Manual retry escape hatch — resets the back-off and probes immediately.
  function reconnect() {
    if (stopped || connected) return;
    if (probeTimer) {
      clearTimeout(probeTimer);
      probeTimer = null;
    }
    probeDelay = PROBE_DELAY_INITIAL;
    tryConnect();
  }
  if (typeof window !== 'undefined') {
    window.__WHAT_MCP_RECONNECT__ = reconnect;
  }

  // Direct cross-origin polling logs net::ERR_CONNECTION_REFUSED from the
  // browser's network layer on every attempt when no bridge runs, which JS
  // cannot suppress. So the client polls only when it can connect at all: with
  // the Vite plugin's same-origin discovery, or with an explicit token. Without
  // either it stays dormant (zero network traffic) until reconnect().
  if (discoveryUrl || token) tryConnect();

  return {
    disconnect,
    reconnect,
    get isConnected() { return connected; },
    get eventCount() { return eventCount; },
  };
}
