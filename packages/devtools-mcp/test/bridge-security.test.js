/**
 * Who may attach to the bridge (security review #11).
 *
 * A credential is issued only to a dev server of this project, through the
 * Node-only pairing endpoint, and only works from the origin it was issued
 * for. One dev-server origin is served at a time; another origin is refused
 * and the refusal is reported. No browser can read a key or a credential.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startBridge, connectPage } from './helpers/fake-page.js';

let started;
const pages = [];
afterEach(async () => {
  for (const p of pages.splice(0)) await p.close();
  started?.close();
  started = null;
});

function pair(bridge, body, headers = {}) {
  return fetch(`http://127.0.0.1:${bridge.controlPort}/__what_mcp_pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('pairing', () => {
  it('issues a credential to a dev server inside the project', async () => {
    started = await startBridge();
    const res = await pair(started.bridge, { key: started.bridge.pairingKey, origin: 'http://localhost:5173', root: started.projectRoot });
    assert.equal(res.status, 200);
    const { credential, wsPort } = await res.json();
    assert.equal(wsPort, started.port);
    assert.notEqual(credential, started.bridge.pairingKey);
  });

  it('refuses a wrong key, a non-loopback origin and a root outside the project', async () => {
    started = await startBridge();
    const key = started.bridge.pairingKey;
    assert.equal((await pair(started.bridge, { key: 'nope', origin: 'http://localhost:5173', root: started.projectRoot })).status, 401);
    assert.equal((await pair(started.bridge, { key, origin: 'http://evil.example', root: started.projectRoot })).status, 400);
    assert.equal((await pair(started.bridge, { key, origin: 'http://localhost:5173', root: '/' })).status, 403);
  });

  it('refuses anything a browser sends', async () => {
    started = await startBridge();
    const body = { key: started.bridge.pairingKey, origin: 'http://localhost:5173', root: started.projectRoot };
    assert.equal((await pair(started.bridge, body, { Origin: 'http://localhost:5173' })).status, 403);
    assert.equal((await pair(started.bridge, body, { 'Sec-Fetch-Site': 'same-site' })).status, 403);
  });

  it('the probe says the bridge is up and carries no secret', async () => {
    started = await startBridge();
    const res = await fetch(`http://127.0.0.1:${started.bridge.controlPort}/__what_mcp_probe`, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const text = await res.text();
    assert.ok(!text.includes(started.bridge.pairingKey));
    const evil = await fetch(`http://127.0.0.1:${started.bridge.controlPort}/__what_mcp_probe`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
  });

  it('the old token endpoint is gone', async () => {
    started = await startBridge();
    const res = await fetch(`http://127.0.0.1:${started.bridge.controlPort}/__what_mcp_token`, { headers: { Origin: 'http://localhost:4000' } });
    assert.equal(res.status, 404);
  });
});

describe('page sockets', () => {
  async function credentialFor(origin) {
    const res = await pair(started.bridge, { key: started.bridge.pairingKey, origin, root: started.projectRoot });
    return (await res.json()).credential;
  }

  it('a credential works from its own origin only', async () => {
    started = await startBridge();
    const credential = await credentialFor('http://localhost:5173');
    await assert.rejects(connectPage(started.bridge, { token: credential, origin: 'http://localhost:4000' }).ready, (err) => err.status === 401);
    const page = await connectPage(started.bridge, { token: credential, origin: 'http://localhost:5173' }).ready;
    pages.push(page);
    assert.equal(started.bridge.isConnected(), true);
  });

  it('refuses a non-loopback origin even with the pairing key', async () => {
    started = await startBridge();
    await assert.rejects(connectPage(started.bridge, { origin: 'https://evil.example' }).ready, (err) => err.status === 403);
  });

  it('a second origin is refused while the first is attached, and the refusal is reported', async () => {
    started = await startBridge();
    const first = await connectPage(started.bridge, { token: await credentialFor('http://localhost:5173'), origin: 'http://localhost:5173' }).ready;
    pages.push(first);
    const pairing = await pair(started.bridge, { key: started.bridge.pairingKey, origin: 'http://localhost:4000', root: started.projectRoot });
    assert.equal(pairing.status, 409);
    await assert.rejects(connectPage(started.bridge, { origin: 'http://localhost:4000' }).ready, (err) => err.status === 409);
    assert.ok(started.bridge.refusals().some((r) => r.origin === 'http://localhost:4000' && /serving http:\/\/localhost:5173/.test(r.reason)));
    // A second tab of the attached app is just another session.
    const tab = await connectPage(started.bridge, { token: await credentialFor('http://localhost:5173'), origin: 'http://localhost:5173' }).ready;
    pages.push(tab);
    assert.deepEqual(started.bridge.listSessions().map((s) => s.id), ['s1', 's2']);
  });
});
