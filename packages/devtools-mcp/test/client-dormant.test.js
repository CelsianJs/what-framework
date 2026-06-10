/**
 * Dormant-by-default gating in the browser client (T3-04).
 *
 * The audit finding: every fresh scaffold logged
 * `net::ERR_CONNECTION_REFUSED @ localhost:9230/__what_mcp_token` on load,
 * because the client probed the bridge's cross-origin discovery port even
 * when no bridge was configured — and the browser's network layer logs that
 * failure unsuppressibly.
 *
 * Contract pinned here:
 *  - default (no token, no discoveryUrl, no debug flag): DORMANT — zero
 *    fetches, zero WebSockets;
 *  - explicit `token`: direct probe of localhost:{port+1} (a bridge is
 *    expected, noise is acceptable);
 *  - `discoveryUrl` (set by the Vite plugin): same-origin polling — probes
 *    the dev server, never the bridge port directly; opens the WebSocket
 *    only when discovery reports the bridge up;
 *  - `window.__WHAT_DEVTOOLS_DEBUG__ = true`: opts in to direct probing;
 *  - `reconnect()` (window.__WHAT_MCP_RECONNECT__) wakes a dormant client.
 *
 * Runs in Node with stubbed window/fetch/WebSocket globals.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectDevToolsMCP } from '../src/client.js';

const PORT = 4741; // direct probe goes to PORT+1 = 4742

let fetchCalls;
let wsInstances;
let savedFetch;
let savedWebSocket;
let savedWindow;
let savedNodeEnv;

class StubWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    wsInstances.push(this);
  }
  send() {}
  close() {}
}

function stubFetch(responder) {
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url: String(url), opts });
    return responder(String(url));
  };
}

const jsonResponse = (body) => ({ ok: true, json: async () => body });
const refused = () => { throw new TypeError('fetch failed'); };

const settle = (ms = 25) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  fetchCalls = [];
  wsInstances = [];
  savedFetch = globalThis.fetch;
  savedWebSocket = globalThis.WebSocket;
  savedWindow = globalThis.window;
  savedNodeEnv = process.env.NODE_ENV;
  // client.js bails entirely under NODE_ENV=production — force dev
  process.env.NODE_ENV = 'development';
  globalThis.window = {};
  globalThis.WebSocket = StubWebSocket;
  stubFetch(refused);
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  globalThis.WebSocket = savedWebSocket;
  globalThis.window = savedWindow;
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

describe('dormant by default (the audit fix)', () => {
  it('no token, no discoveryUrl, no debug flag → zero network activity', async () => {
    const client = connectDevToolsMCP({ port: PORT });
    await settle();
    assert.equal(fetchCalls.length, 0, `expected zero fetches, got: ${fetchCalls.map(c => c.url)}`);
    assert.equal(wsInstances.length, 0, 'no WebSocket may be opened');
    assert.equal(client.isConnected, false);
    client.disconnect();
  });

  it('reconnect() wakes a dormant client (manual opt-in)', async () => {
    const client = connectDevToolsMCP({ port: PORT });
    await settle();
    assert.equal(fetchCalls.length, 0);
    client.reconnect();
    await settle();
    assert.equal(fetchCalls.length, 1, 'reconnect() must trigger exactly one probe');
    assert.equal(fetchCalls[0].url, `http://localhost:${PORT + 1}/__what_mcp_token`);
    client.disconnect();
  });

  it('window.__WHAT_MCP_RECONNECT__ is installed even while dormant', async () => {
    const client = connectDevToolsMCP({ port: PORT });
    assert.equal(typeof globalThis.window.__WHAT_MCP_RECONNECT__, 'function');
    client.disconnect();
  });
});

describe('explicit token → direct probing stays enabled', () => {
  it('probes localhost:{port+1} when a token is provided', async () => {
    const client = connectDevToolsMCP({ port: PORT, token: 'tok-123' });
    await settle();
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, `http://localhost:${PORT + 1}/__what_mcp_token`);
    client.disconnect();
  });

  it('connects the WebSocket when the bridge answers the direct probe', async () => {
    stubFetch(() => jsonResponse({ token: 'tok-456', wsPort: PORT }));
    const client = connectDevToolsMCP({ port: PORT, token: 'tok-456' });
    await settle();
    assert.equal(wsInstances.length, 1);
    assert.equal(wsInstances[0].url, `ws://localhost:${PORT}?token=tok-456`);
    client.disconnect();
  });
});

describe('window.__WHAT_DEVTOOLS_DEBUG__ opt-in', () => {
  it('debug flag enables direct probing without a token', async () => {
    globalThis.window.__WHAT_DEVTOOLS_DEBUG__ = true;
    const client = connectDevToolsMCP({ port: PORT });
    await settle();
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, `http://localhost:${PORT + 1}/__what_mcp_token`);
    client.disconnect();
  });
});

describe('same-origin discoveryUrl (Vite plugin mode)', () => {
  it('polls the discoveryUrl, NEVER the bridge port directly', async () => {
    stubFetch(() => jsonResponse({ bridge: false }));
    const client = connectDevToolsMCP({ port: PORT, discoveryUrl: '/__what_mcp_discovery' });
    await settle();
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, '/__what_mcp_discovery');
    assert.equal(wsInstances.length, 0, 'bridge:false must not open a WebSocket');
    assert.equal(client.isConnected, false);
    client.disconnect();
  });

  it('opens the WebSocket with discovered token+wsPort when bridge is up', async () => {
    stubFetch(() => jsonResponse({ bridge: true, token: 'disc-tok', wsPort: 4743 }));
    const client = connectDevToolsMCP({ port: PORT, discoveryUrl: '/__what_mcp_discovery' });
    await settle();
    assert.equal(wsInstances.length, 1);
    assert.equal(wsInstances[0].url, 'ws://localhost:4743?token=disc-tok');
    client.disconnect();
  });

  it('stays quiet when even the dev server is unreachable', async () => {
    stubFetch(refused);
    const client = connectDevToolsMCP({ port: PORT, discoveryUrl: '/__what_mcp_discovery' });
    await settle();
    assert.equal(fetchCalls.length, 1, 'one quiet attempt, then back-off');
    assert.equal(wsInstances.length, 0);
    client.disconnect();
  });
});
