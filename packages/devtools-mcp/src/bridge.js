/**
 * Node.js WebSocket server + state bridge.
 * Receives state snapshots and events from the browser client,
 * provides query API for the MCP tools.
 */

import { WebSocketServer } from 'ws';
import { randomBytes } from 'crypto';
import { createServer } from 'http';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const MAX_EVENT_LOG = 1000;
const MAX_ERROR_LOG = 100;

export function createBridge({ port = 9229, host = '127.0.0.1' } = {}) {
  let latestSnapshot = null;
  const eventLog = [];
  const errorLog = [];
  let browserSocket = null;
  let correlationCounter = 0;
  const pendingCommands = new Map();

  // Snapshot dedup cache (100ms)
  let cachedSnapshot = null;
  let cacheTime = 0;
  const SNAPSHOT_CACHE_MS = 100;

  // Baseline snapshot for diff tool
  let baselineSnapshot = null;

  // Use a fixed token from env if provided, otherwise generate a random one.
  // Set WHAT_MCP_TOKEN to share the same token between bridge and Vite plugin.
  const authToken = process.env.WHAT_MCP_TOKEN || randomBytes(24).toString('hex');

  const wss = new WebSocketServer({ host, port, verifyClient: ({ req }) => {
    // Require a valid token query parameter to connect
    try {
      const url = new URL(req.url, `http://${host}:${port}`);
      return url.searchParams.get('token') === authToken;
    } catch {
      return false;
    }
  }});

  // --- Token Discovery ---
  // Two mechanisms so the browser client can find the token automatically:
  //
  // 1. HTTP endpoint: GET http://localhost:{port+1}/__what_mcp_token returns the token
  //    The client fetches this on startup before connecting the WebSocket.
  //
  // 2. File: writes token to node_modules/.cache/what-devtools-mcp/token
  //    The Vite plugin reads this at transform time.

  const discoveryPort = port + 1;
  const httpServer = createServer((req, res) => {
    // CORS headers so the browser can fetch from any origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cache-Control', 'no-store');

    if (req.url === '/__what_mcp_token') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token: authToken, wsPort: port }));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  httpServer.listen(discoveryPort, host, () => {
    console.error(`[what-devtools-mcp] Token discovery on http://${host}:${discoveryPort}/__what_mcp_token`);
  });
  httpServer.on('error', () => {
    // Discovery port unavailable — not critical, file-based fallback still works
    console.error(`[what-devtools-mcp] Token discovery port ${discoveryPort} unavailable (non-fatal)`);
  });

  // Write token to a well-known file path for Vite plugin to read
  try {
    const cacheDir = join(process.cwd(), 'node_modules', '.cache', 'what-devtools-mcp');
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, 'token'), JSON.stringify({ token: authToken, port, discoveryPort }));
  } catch {
    // Non-fatal — HTTP discovery is the primary mechanism
  }

  console.error(`[what-devtools-mcp] Bridge listening on ws://${host}:${port}`);
  console.error(`[what-devtools-mcp] Auth token: ${authToken}`);

  wss.on('connection', (ws) => {
    browserSocket = ws;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.type) {
        case 'snapshot':
          latestSnapshot = msg.data;
          break;
        case 'event':
          eventLog.push({ event: msg.event, data: msg.data, timestamp: Date.now() });
          if (eventLog.length > MAX_EVENT_LOG) eventLog.shift();
          // Track errors separately
          if (msg.event === 'error:captured') {
            errorLog.push({ ...msg.data, timestamp: Date.now() });
            if (errorLog.length > MAX_ERROR_LOG) errorLog.shift();
          }
          break;
        case 'events':
          for (const item of msg.batch || []) {
            eventLog.push({ event: item.event, data: item.data, timestamp: Date.now() });
            if (eventLog.length > MAX_EVENT_LOG) eventLog.shift();
            if (item.event === 'error:captured') {
              errorLog.push({ ...item.data, timestamp: Date.now() });
              if (errorLog.length > MAX_ERROR_LOG) errorLog.shift();
            }
          }
          break;
        case 'response': {
          const pending = pendingCommands.get(msg.correlationId);
          if (pending) {
            pendingCommands.delete(msg.correlationId);
            pending.resolve(msg.data);
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      if (browserSocket === ws) browserSocket = null;
      // Reject all pending commands
      for (const [id, pending] of pendingCommands) {
        pending.reject(new Error('Browser disconnected'));
        pendingCommands.delete(id);
      }
    });
  });

  function isConnected() {
    return browserSocket !== null && browserSocket.readyState === 1; // WebSocket.OPEN
  }

  function sendCommand(command, args = {}, timeout = 5000) {
    return new Promise((resolve, reject) => {
      if (!isConnected()) {
        return reject(new Error('No browser connected'));
      }
      const correlationId = `cmd_${++correlationCounter}`;
      const timer = setTimeout(() => {
        pendingCommands.delete(correlationId);
        reject(new Error(`Command '${command}' timed out after ${timeout}ms`));
      }, timeout);

      pendingCommands.set(correlationId, {
        resolve: (data) => { clearTimeout(timer); resolve(data); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      browserSocket.send(JSON.stringify({ command, correlationId, args }));
    });
  }

  async function refreshSnapshot() {
    const data = await sendCommand('get-snapshot');
    latestSnapshot = data;
    return data;
  }

  async function getOrRefreshSnapshot() {
    const now = Date.now();
    if (cachedSnapshot && now - cacheTime < SNAPSHOT_CACHE_MS) return cachedSnapshot;
    try {
      cachedSnapshot = await refreshSnapshot();
      cacheTime = now;
      return cachedSnapshot;
    } catch {
      return latestSnapshot;
    }
  }

  async function getCacheSnapshot() {
    return sendCommand('get-cache');
  }

  function getSnapshot() {
    return latestSnapshot;
  }

  function saveBaseline() {
    baselineSnapshot = latestSnapshot ? JSON.parse(JSON.stringify(latestSnapshot)) : null;
    if (baselineSnapshot) baselineSnapshot._savedAt = Date.now();
    return !!baselineSnapshot;
  }

  function getBaseline() {
    return baselineSnapshot;
  }

  function getEvents(since) {
    if (since) return eventLog.filter(e => e.timestamp > since);
    return eventLog.slice();
  }

  function getErrors(since) {
    if (since) return errorLog.filter(e => e.timestamp > since);
    return errorLog.slice();
  }

  function close() {
    for (const [id, pending] of pendingCommands) {
      pending.reject(new Error('Bridge closing'));
      pendingCommands.delete(id);
    }
    wss.close();
    httpServer.close();
  }

  return {
    getSnapshot,
    getOrRefreshSnapshot,
    getEvents,
    getErrors,
    isConnected,
    sendCommand,
    refreshSnapshot,
    getCacheSnapshot,
    saveBaseline,
    getBaseline,
    close,
    authToken,
  };
}
