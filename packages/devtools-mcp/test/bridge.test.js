/**
 * Integration tests for the WebSocket bridge.
 * Tests actual WS connections using the `ws` package.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createBridge } from '../src/bridge.js';

const TEST_PORT = 9399; // avoid conflicts with default 9229

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
}

function waitForMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data)));
  });
}

/** Connect with the bridge's auth token */
function connectWithToken(bridge, port) {
  return new WebSocket(`ws://127.0.0.1:${port}?token=${bridge.authToken}`);
}

describe('WebSocket Bridge', () => {
  let bridge;
  let client;

  afterEach(async () => {
    if (client?.readyState === WebSocket.OPEN) client.close();
    if (bridge) bridge.close();
    // Small delay for cleanup
    await new Promise(r => setTimeout(r, 100));
  });

  it('accepts browser connections with valid token', async () => {
    bridge = createBridge({ port: TEST_PORT });
    assert.equal(bridge.isConnected(), false);

    client = connectWithToken(bridge, TEST_PORT);
    await waitForOpen(client);
    // Small delay for the server to register
    await new Promise(r => setTimeout(r, 50));
    assert.equal(bridge.isConnected(), true);
  });

  it('rejects connections without a token', async () => {
    bridge = createBridge({ port: TEST_PORT });

    client = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
    await assert.rejects(
      () => waitForOpen(client),
      (err) => {
        // Connection should be rejected (unexpected server response)
        return true;
      }
    );
    await new Promise(r => setTimeout(r, 50));
    assert.equal(bridge.isConnected(), false);
  });

  it('rejects connections with an invalid token', async () => {
    bridge = createBridge({ port: TEST_PORT });

    client = new WebSocket(`ws://127.0.0.1:${TEST_PORT}?token=wrong-token`);
    await assert.rejects(
      () => waitForOpen(client),
      (err) => {
        return true;
      }
    );
    await new Promise(r => setTimeout(r, 50));
    assert.equal(bridge.isConnected(), false);
  });

  it('stores snapshot from browser', async () => {
    bridge = createBridge({ port: TEST_PORT });
    client = connectWithToken(bridge, TEST_PORT);
    await waitForOpen(client);

    const snapshot = { signals: [{ id: 1, name: 'test', value: 42 }], effects: [], components: [] };
    client.send(JSON.stringify({ type: 'snapshot', data: snapshot }));

    await new Promise(r => setTimeout(r, 50));
    const stored = bridge.getSnapshot();
    assert.deepEqual(stored, snapshot);
  });

  it('logs events from browser', async () => {
    bridge = createBridge({ port: TEST_PORT });
    client = connectWithToken(bridge, TEST_PORT);
    await waitForOpen(client);

    client.send(JSON.stringify({
      type: 'event',
      event: 'signal:updated',
      data: { id: 1, value: 99 },
    }));

    await new Promise(r => setTimeout(r, 50));
    const events = bridge.getEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].event, 'signal:updated');
  });

  it('tracks errors separately', async () => {
    bridge = createBridge({ port: TEST_PORT });
    client = connectWithToken(bridge, TEST_PORT);
    await waitForOpen(client);

    client.send(JSON.stringify({
      type: 'event',
      event: 'error:captured',
      data: { message: 'test error', type: 'effect' },
    }));

    await new Promise(r => setTimeout(r, 50));
    const errors = bridge.getErrors();
    assert.equal(errors.length, 1);
    assert.equal(errors[0].message, 'test error');
  });

  it('sendCommand sends and receives response via correlationId', async () => {
    bridge = createBridge({ port: TEST_PORT });
    client = connectWithToken(bridge, TEST_PORT);
    await waitForOpen(client);
    await new Promise(r => setTimeout(r, 50));

    // Listen for commands on the client side
    client.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.command === 'get-snapshot') {
        client.send(JSON.stringify({
          type: 'response',
          correlationId: msg.correlationId,
          data: { signals: [{ id: 1, name: 'x', value: 7 }] },
        }));
      }
    });

    const result = await bridge.sendCommand('get-snapshot');
    assert.deepEqual(result.signals, [{ id: 1, name: 'x', value: 7 }]);
  });

  it('sendCommand times out when no response', async () => {
    bridge = createBridge({ port: TEST_PORT });
    client = connectWithToken(bridge, TEST_PORT);
    await waitForOpen(client);
    await new Promise(r => setTimeout(r, 50));

    // Don't respond to command
    await assert.rejects(
      () => bridge.sendCommand('get-snapshot', {}, 200),
      { message: /timed out/ }
    );
  });

  it('sendCommand rejects when no browser connected', async () => {
    bridge = createBridge({ port: TEST_PORT });
    await assert.rejects(
      () => bridge.sendCommand('get-snapshot'),
      { message: /No browser connected/ }
    );
  });

  it('handles browser disconnection', async () => {
    bridge = createBridge({ port: TEST_PORT });
    client = connectWithToken(bridge, TEST_PORT);
    await waitForOpen(client);
    await new Promise(r => setTimeout(r, 50));
    assert.equal(bridge.isConnected(), true);

    client.close();
    await new Promise(r => setTimeout(r, 100));
    assert.equal(bridge.isConnected(), false);
  });

  it('exposes authToken for client connections', () => {
    bridge = createBridge({ port: TEST_PORT });
    assert.ok(bridge.authToken, 'authToken should be defined');
    assert.equal(typeof bridge.authToken, 'string');
    assert.ok(bridge.authToken.length >= 32, 'authToken should be at least 32 chars');
  });
});
