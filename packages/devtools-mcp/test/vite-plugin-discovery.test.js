/**
 * Same-origin bridge discovery served by the Vite plugin (T3-04).
 *
 * The plugin registers a dev-server middleware at /__what_mcp_discovery that
 * probes the bridge Node-side and answers same-origin — so the browser client
 * can poll for the bridge without ever producing a network-layer
 * ERR_CONNECTION_REFUSED console line when no bridge is running.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import whatDevToolsMCP, { DISCOVERY_PATH } from '../src/vite-plugin.js';

const RESOLVED_BOOTSTRAP_ID = '\0virtual:what-devtools-mcp/bootstrap';

function getMiddleware(plugin) {
  const routes = new Map();
  plugin.configureServer({
    middlewares: { use: (route, handler) => routes.set(route, handler) },
  });
  return routes.get(DISCOVERY_PATH);
}

function invoke(handler) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      setHeader: (k, v) => { headers[k] = v; },
      end: (body) => resolve({ headers, body: JSON.parse(body) }),
    };
    Promise.resolve(handler({ url: DISCOVERY_PATH }, res)).catch(reject);
  });
}

describe('vite-plugin same-origin discovery middleware', () => {
  it('registers a middleware at the discovery path', () => {
    const handler = getMiddleware(whatDevToolsMCP({ port: 4750 }));
    assert.equal(typeof handler, 'function');
  });

  it('answers { bridge: false } when no bridge is running (no throw, no hang)', async () => {
    // Nothing listens on 4751 (= 4750 + 1)
    const handler = getMiddleware(whatDevToolsMCP({ port: 4750 }));
    const { headers, body } = await invoke(handler);
    assert.deepEqual(body, { bridge: false });
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(headers['Cache-Control'], 'no-store');
  });

  it('proxies token + wsPort when the bridge IS running', async () => {
    // Fake bridge discovery endpoint on 4761 (= 4760 + 1)
    const bridge = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token: 't0k-discovery', wsPort: 4760 }));
    });
    await new Promise((r) => bridge.listen(4761, '127.0.0.1', r));
    try {
      const handler = getMiddleware(whatDevToolsMCP({ port: 4760 }));
      const { body } = await invoke(handler);
      assert.deepEqual(body, { bridge: true, token: 't0k-discovery', wsPort: 4760 });
    } finally {
      await new Promise((r) => bridge.close(r));
    }
  });

  it('answers { bridge: false } on a non-OK bridge response (e.g. 403 forbidden origin)', async () => {
    const bridge = createServer((req, res) => {
      res.writeHead(403);
      res.end('Forbidden origin');
    });
    await new Promise((r) => bridge.listen(4771, '127.0.0.1', r));
    try {
      const handler = getMiddleware(whatDevToolsMCP({ port: 4770 }));
      const { body } = await invoke(handler);
      assert.deepEqual(body, { bridge: false });
    } finally {
      await new Promise((r) => bridge.close(r));
    }
  });
});

describe('bootstrap virtual module', () => {
  it('passes the discoveryUrl to connectDevToolsMCP', () => {
    const plugin = whatDevToolsMCP({ port: 4750 });
    const code = plugin.load(RESOLVED_BOOTSTRAP_ID);
    assert.match(code, /connectDevToolsMCP\(\{ port: 4750, token: "[^"]*", discoveryUrl: "\/__what_mcp_discovery" \}\)/);
  });
});
