/**
 * Security regression: the devtools bridge must not be drivable cross-origin.
 * Before AUDIT-2026-06-06 C6, the token endpoint set `Access-Control-Allow-Origin: *`
 * and the WS handshake checked only the token (not Origin), so any website open
 * in the same browser as `what dev` could steal the token and drive
 * set-signal/navigate/eval against the live app (confused-deputy takeover).
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createBridge } from '../src/bridge.js';

const TEST_PORT = 9521; // avoid conflicts

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
}

describe('Bridge security: cross-origin lockdown (AUDIT C6)', () => {
  let bridge, client;
  afterEach(async () => {
    if (client?.readyState === WebSocket.OPEN) client.close();
    if (bridge) bridge.close();
    await new Promise((r) => setTimeout(r, 100));
  });

  it('rejects a WS connection from a non-loopback Origin even with a valid token', async () => {
    bridge = createBridge({ port: TEST_PORT });
    client = new WebSocket(`ws://127.0.0.1:${TEST_PORT}?token=${bridge.authToken}`, {
      headers: { Origin: 'https://evil.com' },
    });
    await assert.rejects(() => waitForOpen(client));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(bridge.isConnected(), false, 'evil.com must not connect even with the token');
  });

  it('accepts a WS connection from a loopback Origin with a valid token', async () => {
    bridge = createBridge({ port: TEST_PORT });
    client = new WebSocket(`ws://127.0.0.1:${TEST_PORT}?token=${bridge.authToken}`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    await waitForOpen(client);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(bridge.isConnected(), true);
  });

  it('token discovery endpoint returns 403 for a non-loopback Origin (no token leak)', async () => {
    bridge = createBridge({ port: TEST_PORT });
    const res = await fetch(`http://127.0.0.1:${TEST_PORT + 1}/__what_mcp_token`, {
      headers: { Origin: 'https://evil.com' },
    });
    assert.equal(res.status, 403, 'token endpoint must refuse cross-origin reads');
    assert.notEqual(res.headers.get('access-control-allow-origin'), '*', 'must never send wildcard ACAO');
  });

  it('token discovery endpoint serves loopback origins with an echoed (non-wildcard) ACAO', async () => {
    bridge = createBridge({ port: TEST_PORT });
    const res = await fetch(`http://127.0.0.1:${TEST_PORT + 1}/__what_mcp_token`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const body = await res.json();
    assert.equal(body.token, bridge.authToken);
  });
});
