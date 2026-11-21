/**
 * Same-origin bridge discovery served by the Vite plugin (T3-04, security #11).
 *
 * The page asks its own dev server; the dev server pairs with the bridge
 * Node-side, using the pairing key the bridge wrote under the project, and
 * returns a credential bound to the page's origin. No bridge running is the
 * normal state of a fresh scaffold and must answer quietly. A request from
 * another origin gets nothing.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import whatDevToolsMCP, { DISCOVERY_PATH } from '../src/vite-plugin.js';
import { startBridge, connectPage, freePortPair } from './helpers/fake-page.js';

const RESOLVED_BOOTSTRAP_ID = '\0virtual:what-devtools-mcp/bootstrap';

function middleware(plugin, root) {
  const routes = new Map();
  plugin.configResolved({ command: 'serve', root, server: {} });
  plugin.configureServer({ middlewares: { use: (route, handler) => routes.set(route, handler) } });
  return routes.get(DISCOVERY_PATH);
}

function invoke(handler, headers = {}) {
  return new Promise((resolve, reject) => {
    const out = { headers: {}, status: 200 };
    const res = {
      setHeader: (k, v) => { out.headers[k] = v; },
      set statusCode(code) { out.status = code; },
      end: (body) => resolve({ ...out, body: JSON.parse(body) }),
    };
    Promise.resolve(handler({ url: DISCOVERY_PATH, headers: { host: 'localhost:5173', ...headers } }, res)).catch(reject);
  });
}

let started;
const pages = [];
afterEach(async () => {
  for (const p of pages.splice(0)) await p.close();
  started?.close();
  started = null;
});

describe('vite-plugin same-origin discovery', () => {
  it('answers { bridge: false } when no bridge is running (no throw, no hang)', async () => {
    const port = await freePortPair();
    const root = mkdtempSync(join(tmpdir(), 'what-discovery-'));
    const { status, headers, body } = await invoke(middleware(whatDevToolsMCP({ port }), root));
    rmSync(root, { recursive: true, force: true });
    assert.equal(status, 200);
    assert.deepEqual(body, { bridge: false });
    assert.equal(headers['Cache-Control'], 'no-store');
  });

  it('pairs through the bridge file in the project and returns a credential for the page origin', async () => {
    started = await startBridge();
    const appRoot = join(started.projectRoot, 'apps', 'web');
    mkdirSync(appRoot, { recursive: true });
    const { body } = await invoke(middleware(whatDevToolsMCP(), appRoot), { 'sec-fetch-site': 'same-origin' });
    assert.equal(body.bridge, true);
    assert.equal(body.wsPort, started.port);
    assert.notEqual(body.credential, started.bridge.pairingKey, 'the pairing key never reaches the page');
    const page = await connectPage(started.bridge, { token: body.credential, origin: 'http://localhost:5173' }).ready;
    pages.push(page);
    assert.equal(started.bridge.isConnected(), true);
  });

  it('gives nothing to a request from another origin', async () => {
    started = await startBridge();
    const handler = middleware(whatDevToolsMCP(), started.projectRoot);
    for (const headers of [{ origin: 'http://localhost:4000' }, { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'cross-site' }]) {
      const { status, body } = await invoke(handler, headers);
      assert.equal(status, 403, JSON.stringify(headers));
      assert.equal(body.bridge, false);
      assert.equal(body.credential, undefined);
    }
  });

  it('a dev server outside the bridge project cannot pair', async () => {
    started = await startBridge();
    const outside = mkdtempSync(join(tmpdir(), 'what-discovery-'));
    const { body } = await invoke(middleware(whatDevToolsMCP({ port: started.port, token: started.bridge.pairingKey }), outside));
    rmSync(outside, { recursive: true, force: true });
    assert.deepEqual(body, { bridge: false });
  });
});

describe('bootstrap virtual module', () => {
  it('passes the discoveryUrl to connectDevToolsMCP and bakes in no secret', () => {
    const plugin = whatDevToolsMCP({ port: 4750 });
    const code = plugin.load(RESOLVED_BOOTSTRAP_ID);
    assert.match(code, /connectDevToolsMCP\(\{ port: 4750, discoveryUrl: "\/__what_mcp_discovery" \}\)/);
    assert.doesNotMatch(code, /token/);
  });

  it('is injected first in <head>, so devtools are installed before app code runs', () => {
    const plugin = whatDevToolsMCP({ port: 4750 });
    const [tag] = plugin.transformIndexHtml();
    assert.equal(tag.injectTo, 'head-prepend');
  });
});
