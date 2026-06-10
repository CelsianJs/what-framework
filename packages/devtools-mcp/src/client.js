/**
 * Browser-side WebSocket client for what-devtools-mcp.
 * Connects to the Node.js bridge server, streams devtools state and events,
 * and handles commands from the MCP server (set-signal, get-snapshot, etc.).
 */

// Branded console logger
const BADGE = 'background:#6366f1;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold';
const BADGE_CMD = 'background:#22c55e;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold';
const BADGE_EVENT = 'background:#f97316;color:#fff;padding:2px 6px;border-radius:3px;font-weight:bold';
const BADGE_WARN = 'background:#eab308;color:#000;padding:2px 6px;border-radius:3px;font-weight:bold';
const DIM = 'color:#888';

function log(badge, badgeStyle, ...args) {
  console.log(`%c${badge}%c`, badgeStyle, '', ...args);
}

function logGrouped(badge, badgeStyle, title, data) {
  console.groupCollapsed(`%c${badge}%c ${title}`, badgeStyle, 'color:inherit');
  if (data !== undefined) console.log(data);
  console.groupEnd();
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

  let ws = null;
  let connected = false;
  let stopped = false;
  let probeTimer = null;
  // Probe back-off: first retry after 10s, then ×3 each time, capped at 5min.
  // With no bridge running this yields probes at ~0s / 10s / 40s / 130s / 430s…
  // — at most 3-4 quiet fetch attempts in the first two minutes, then near-silence.
  const PROBE_DELAY_INITIAL = 10000;
  const PROBE_DELAY_RECONNECT = 2000; // bridge restarts are usually fast
  const PROBE_BACKOFF_FACTOR = 3;
  const PROBE_DELAY_MAX = 300000;
  let probeDelay = PROBE_DELAY_INITIAL;
  let eventCount = 0;
  let hasLoggedMissingBridge = false;
  let hasShownBanner = false;
  let unsubscribeFn = null;
  let flushEventBatch = null; // Hoisted — set during subscription, called by set-signal
  let discoveredToken = token;
  let discoveredPort = port;

  // --- Quiet bridge probe (also discovers the token) ---
  // We NEVER open a WebSocket until this HTTP probe succeeds. A failed
  // WebSocket connection always prints an unsuppressible red error in the
  // browser console; a failed fetch wrapped in catch() prints at most a single
  // muted "Failed to load resource" network line — the quietest probe the
  // platform allows.
  //
  // Two probe modes:
  //
  // 1. Same-origin discovery (preferred — `discoveryUrl`, set by the Vite
  //    plugin): the dev server proxies the bridge probe Node-side, so a
  //    missing bridge produces ZERO console output — the dev server itself is
  //    up, so there is no network-layer ERR_CONNECTION_REFUSED line either.
  //
  // 2. Direct probe of GET http://localhost:{port+1}/__what_mcp_token
  //    (loopback-origin gated; a 200 means the bridge is up AND returns the
  //    token + actual WS port in one round-trip). Even wrapped in catch(),
  //    the browser's network layer logs net::ERR_CONNECTION_REFUSED for every
  //    failed attempt — unsuppressible from JS — so this mode only runs when
  //    a bridge is actually expected (explicit token, or the
  //    window.__WHAT_DEVTOOLS_DEBUG__ flag). See `pollEnabled` below.
  //
  // Trade-off (direct mode): if the discovery HTTP port (port+1) is occupied
  // by another process while the WS port is free, we won't connect even with
  // an explicit token. That edge case is rarer and cheaper than spamming
  // every fresh app (the default state: no bridge running) with red WS errors.
  async function probeBridge() {
    if (discoveryUrl) {
      try {
        const res = await fetch(discoveryUrl, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (!data.bridge) return false;
          if (data.token) discoveredToken = data.token;
          discoveredPort = data.wsPort || port;
          return true;
        }
      } catch {
        // Dev server unreachable (page about to die) — stay quiet.
      }
      return false;
    }
    try {
      const res = await fetch(`http://localhost:${port + 1}/__what_mcp_token`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.token) discoveredToken = data.token;
        discoveredPort = data.wsPort || port;
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
        // Single muted line — the ONLY console-API message a fresh app sees.
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
      const tokenParam = discoveredToken ? `?token=${encodeURIComponent(discoveredToken)}` : '';
      ws = new WebSocket(`ws://localhost:${discoveredPort}${tokenParam}`);
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
        // Banner only once we KNOW the bridge exists — silent otherwise.
        console.log(
          '%c⚡ What DevTools MCP %c Client v0.2.0',
          'background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;padding:4px 10px;border-radius:4px;font-weight:bold;font-size:13px',
          'color:#a855f7;font-weight:bold'
        );
      }
      log('MCP', BADGE, '🟢 Connected to bridge — AI agent can now inspect this app');

      // Send initial snapshot
      const devtools = window.__WHAT_DEVTOOLS__;
      if (devtools) {
        const snapshot = devtools.getSnapshot();
        send({ type: 'snapshot', data: devtools.safeSerialize(snapshot) });
        const s = snapshot.signals?.length || 0;
        const e = snapshot.effects?.length || 0;
        const c = snapshot.components?.length || 0;
        log('MCP', BADGE, `Sent initial snapshot — ${s} signals, ${e} effects, ${c} components`);
      }

      // Subscribe to devtools events and stream them
      // Clean up previous subscription to prevent leak on reconnect
      if (unsubscribeFn) {
        unsubscribeFn();
        unsubscribeFn = null;
      }
      if (devtools) {
        let eventBatch = [];
        let batchTimer = null;

        // Hoisted so set-signal can call it to flush after programmatic writes
        flushEventBatch = function() {
          if (eventBatch.length === 0) return;
          if (eventBatch.length === 1) {
            const item = eventBatch[0];
            send({ type: 'event', event: item.event, data: item.data });
          } else {
            send({ type: 'events', batch: eventBatch });
          }
          eventBatch = [];
          if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
        };

        unsubscribeFn = devtools.subscribe((event, data) => {
          eventCount++;
          eventBatch.push({ event, data: devtools.safeSerialize(data) });
          if (!batchTimer) {
            batchTimer = setTimeout(flushEventBatch, 16);
          }
        });
        log('MCP', BADGE, 'Subscribed to reactive events — streaming to bridge (batched)');
      }
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      handleCommand(msg);
    };

    ws.onclose = () => {
      const wasConnected = connected;
      connected = false;
      if (wasConnected) {
        log('MCP', BADGE_WARN, '🔴 Disconnected from bridge — will reconnect quietly in background');
        // Bridge restarts are usually quick — retry fast, then back off.
        probeDelay = PROBE_DELAY_RECONNECT;
      }
      scheduleProbe();
    };

    ws.onerror = () => {
      // Silence — onclose handles reconnection.
      // Without this, every failed reconnect attempt logs a loud red error.
    };
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  async function handleCommand(msg) {
    const { command, correlationId, args } = msg;
    const devtools = window.__WHAT_DEVTOOLS__;
    let result;

    const cmdNames = {
      'get-snapshot': '📸 Snapshot requested',
      'get-cache': '💾 Cache query',
      'set-signal': '✏️  Signal write',
      'invalidate-cache': '🗑️  Cache invalidation',
    };

    const label = cmdNames[command] || `❓ ${command}`;

    switch (command) {
      case 'get-snapshot': {
        const snapshot = devtools?.getSnapshot() || { signals: [], effects: [], components: [], errors: [] };
        result = devtools?.safeSerialize(snapshot) || snapshot;
        const s = snapshot.signals?.length || 0;
        const e = snapshot.effects?.length || 0;
        const c = snapshot.components?.length || 0;
        logGrouped('AI →', BADGE_CMD, `${label} — returning ${s} signals, ${e} effects, ${c} components`, result);
        break;
      }
      case 'get-cache': {
        let cacheData = [];
        try {
          const core = window.__WHAT_CORE__ || {};
          if (core.__getCacheSnapshot) {
            cacheData = core.__getCacheSnapshot();
          }
        } catch {}
        result = devtools?.safeSerialize(cacheData) || cacheData;
        logGrouped('AI →', BADGE_CMD, `${label} — ${cacheData.length} entries`, result);
        break;
      }
      case 'set-signal': {
        const { signalId, value: rawValue } = args || {};
        // Defense-in-depth: also coerce stringified-JSON here in case an
        // older MCP server forwards the raw string. See tools.js coerceJsonValue.
        let value = rawValue;
        if (typeof rawValue === 'string') {
          const t = rawValue.trim();
          const first = t[0];
          if (t.length > 0 && (
            first === '{' || first === '[' ||
            first === 't' || first === 'f' || first === 'n' ||
            first === '-' || (first >= '0' && first <= '9')
          )) {
            try {
              const parsed = JSON.parse(t);
              if (typeof parsed !== 'string') value = parsed;
            } catch {}
          }
        }
        const registries = devtools?._registries;
        if (registries?.signals) {
          const entry = registries.signals.get(signalId);
          if (entry) {
            const prev = entry.ref.peek();
            entry.ref(value);
            // Flush event batch immediately so what_watch captures programmatic writes
            if (flushEventBatch) setTimeout(flushEventBatch, 0);
            result = { previous: devtools.safeSerialize(prev), current: devtools.safeSerialize(value) };
            log('AI →', BADGE_CMD, `${label} — signal #${signalId} "${entry.name}": ${JSON.stringify(prev)} → ${JSON.stringify(value)}`);
          } else {
            result = { error: `Signal ${signalId} not found` };
            log('AI →', BADGE_WARN, `${label} — signal #${signalId} not found`);
          }
        } else {
          result = { error: 'DevTools not available' };
          log('AI →', BADGE_WARN, `${label} — devtools not available`);
        }
        break;
      }
      case 'invalidate-cache': {
        const { key } = args || {};
        try {
          const core = window.__WHAT_CORE__ || {};
          if (core.invalidateQueries) {
            core.invalidateQueries(key);
            result = { success: true, key };
            log('AI →', BADGE_CMD, `${label} — key "${key}" invalidated`);
          } else {
            result = { error: 'invalidateQueries not available' };
            log('AI →', BADGE_WARN, `${label} — invalidateQueries not available`);
          }
        } catch (e) {
          result = { error: e.message };
          log('AI →', BADGE_WARN, `${label} — error: ${e.message}`);
        }
        break;
      }
      default: {
        // Try extended command handlers
        let extResult = null;
        try {
          const { handleExtendedCommand, initEventTracking } = await import('./client-commands.js');
          // Auto-initialize event tracking on first extended command so
          // what_signal_trace always has write history (not just after what_watch)
          initEventTracking(devtools);
          extResult = await handleExtendedCommand(command, args, devtools);
        } catch (importErr) {
          // Don't silently swallow — report the real error so it's not
          // misdiagnosed as "Unknown command"
          extResult = { error: `Command handler failed: ${importErr.message}` };
          log('AI →', BADGE_WARN, `Extended command "${command}" threw:`, importErr);
        }

        if (extResult !== null) {
          result = extResult;
          logGrouped('AI →', BADGE_CMD, `🔧 ${command}`, result);
        } else {
          result = { error: `Unknown command: ${command}` };
          log('AI →', BADGE_WARN, `Unknown command: ${command}`);
        }
      }
    }

    if (correlationId) {
      send({ type: 'response', correlationId, data: result });
    }
  }

  function disconnect() {
    stopped = true;
    if (unsubscribeFn) {
      unsubscribeFn();
      unsubscribeFn = null;
    }
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
  // Useful when the dev just started the bridge and doesn't want to wait
  // out the back-off (or reload the page). Also the opt-in for clients that
  // start dormant (see pollEnabled below).
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
  // browser's network layer on every attempt when no bridge runs — JS cannot
  // suppress it, and a fresh scaffold (no bridge) saw that on every load.
  // So without a same-origin discoveryUrl, only poll when a bridge is
  // actually expected: an explicit token was provided, or the developer set
  // window.__WHAT_DEVTOOLS_DEBUG__ = true. Otherwise stay dormant — zero
  // network traffic, zero console output — until reconnect() opts in
  // (window.__WHAT_MCP_RECONNECT__() from the console works too).
  const pollEnabled = Boolean(
    discoveryUrl
    || token
    || (typeof window !== 'undefined' && window.__WHAT_DEVTOOLS_DEBUG__)
  );

  // Initial attempt — quiet probe first; WebSocket only if the bridge answers.
  if (pollEnabled) tryConnect();

  return {
    disconnect,
    reconnect,
    get isConnected() { return connected; },
    get eventCount() { return eventCount; },
  };
}
