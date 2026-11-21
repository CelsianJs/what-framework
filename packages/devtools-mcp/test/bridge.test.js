/**
 * The WebSocket bridge: sessions, the event log, folding, commands, cursors.
 * Real sockets, scripted pages (test/helpers/fake-page.js).
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createBridge, BRIDGE_FILE } from '../src/bridge.js';
import { startBridge, connectPage } from './helpers/fake-page.js';

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

let started;
const pages = [];
afterEach(async () => {
  for (const p of pages.splice(0)) await p.close();
  started?.close();
  started = null;
});

async function bridgeWithPage(options) {
  started = await startBridge();
  const page = await connectPage(started.bridge, options).ready;
  pages.push(page);
  return { bridge: started.bridge, page };
}

describe('WebSocket bridge', () => {
  it('admits a local process holding the pairing key, and nothing else without a credential', async () => {
    started = await startBridge();
    const { bridge } = started;
    assert.equal(bridge.isConnected(), false);
    const page = await connectPage(bridge).ready;
    pages.push(page);
    assert.equal(bridge.isConnected(), true);
    for (const token of ['', 'wrong']) {
      await assert.rejects(connectPage(bridge, { token }).ready, (err) => err.status === 401);
    }
  });

  it('writes the pairing file into the project and removes it on close', async () => {
    started = await startBridge();
    const file = join(started.projectRoot, BRIDGE_FILE);
    const data = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(data.key, started.bridge.pairingKey);
    assert.equal(data.port, started.port);
    started.close();
    assert.equal(existsSync(file), false);
    started = null;
  });

  it('logs events per session with a bridge-wide seq, and remembers the hello', async () => {
    const { bridge, page } = await bridgeWithPage({ url: 'http://localhost:5173/todos', title: 'Todos' });
    page.push('signal:updated', { id: 1, name: 'count', value: 5 });
    await settle();
    const { session } = bridge.resolveSession();
    assert.deepEqual([session.url, session.title], ['http://localhost:5173/todos', 'Todos']);
    const { events } = bridge.getEvents(session);
    assert.deepEqual(events.map((e) => e.event), ['page:connected', 'signal:updated']);
    assert.ok(events[1].seq > events[0].seq);
  });

  it('reads after a cursor; the bounded log says how far it lost events', async () => {
    const { bridge, page } = await bridgeWithPage();
    for (let i = 0; i < 2010; i++) {
      page.emit('effect:run', { id: 1, runCount: i });
      if (i % 1000 === 999) page.flush();
    }
    page.flush();
    await settle(60);
    const { session } = bridge.resolveSession();
    const all = bridge.getEvents(session);
    assert.equal(all.events.length, 2000);
    assert.ok(all.lostThrough > 0);
    const recent = bridge.getEvents(session, { after: all.events.at(-3).seq });
    assert.equal(recent.events.length, 2);
    assert.equal(recent.lostThrough, 0, 'nothing after this cursor was lost');
  });

  it('folds diagnostics by code and subject, keeping the newest copy', async () => {
    const { bridge, page } = await bridgeWithPage();
    const d = { code: 'ERR_MISSING_SIGNAL_READ', severity: 'warning', message: 'm', subject: { kind: 'signal', id: 1 } };
    page.push('diagnostic', { ...d, count: 1 });
    page.push('diagnostic', { ...d, subject: { kind: 'signal', id: 2 }, count: 1 });
    page.push('diagnostic', { ...d, count: 2 });
    await settle();
    const { session } = bridge.resolveSession();
    assert.deepEqual(bridge.getDiagnostics(session).map((x) => [x.subject.id, x.count]), [[2, 1], [1, 2]]);
  });

  it('keeps errors separately', async () => {
    const { bridge, page } = await bridgeWithPage();
    page.push('error:captured', { message: 'boom', type: 'effect' });
    await settle();
    const { session } = bridge.resolveSession();
    assert.deepEqual(bridge.getErrors(session).map((e) => e.message), ['boom']);
  });

  it('answers a command with the page data and the cursor it describes', async () => {
    const { bridge, page } = await bridgeWithPage();
    const { session } = bridge.resolveSession();
    const answer = await bridge.request(session, 'state');
    assert.equal(answer.data.signals.length, 3);
    assert.equal(answer.seq, session.lastSeq);
    page.state.signals[0].value = 1;
  });

  it('an action reports the cursor before it ran and after: (since, seq] is what it did', async () => {
    const { bridge, page } = await bridgeWithPage();
    page.push('signal:updated', { id: 2, name: 'name', value: 'before' });
    await settle();
    const { session } = bridge.resolveSession();
    const answer = await bridge.request(session, 'set-signal', { signalId: 1, value: 3 });
    const caused = bridge.getEvents(session, { after: answer.since }).events.filter((e) => e.seq <= answer.seq);
    assert.deepEqual(caused.map((e) => e.event), ['signal:updated', 'effect:run']);
    assert.equal(caused[0].data.value, 3);
  });

  it('times out a command the page never answers', async () => {
    const { bridge } = await bridgeWithPage({ handle: () => new Promise(() => {}) });
    const { session } = bridge.resolveSession();
    await assert.rejects(bridge.request(session, 'state', {}, { timeout: 50 }), /timed out/);
  });

  it('rejects pending commands when the page disconnects, and keeps the session as closed', async () => {
    const { bridge, page } = await bridgeWithPage({ handle: () => new Promise(() => {}) });
    const { session } = bridge.resolveSession();
    const pending = assert.rejects(bridge.request(session, 'state'), /disconnected/);
    await page.close();
    await pending;
    assert.equal(bridge.isConnected(), false);
    assert.equal(bridge.listSessions()[0].live, false);
    assert.equal(bridge.resolveSession('s1').problem, 'closed');
    assert.equal(bridge.resolveSession('s1', { allowClosed: true }).session.id, 's1');
  });

  it('a page that reconnects with its page id resumes its session', async () => {
    started = await startBridge();
    const error = { message: 'before the drop', type: 'effect', timestamp: 1 };
    const first = await connectPage(started.bridge, { pageId: 'same-page' }).ready;
    first.push('error:captured', error);
    await settle();
    await first.close();
    const again = await connectPage(started.bridge, { pageId: 'same-page' }).ready;
    pages.push(again);
    again.push('error:captured', error); // the client replays its backlog on reconnect
    await settle();
    const { session } = started.bridge.resolveSession();
    assert.equal(session.id, 's1');
    assert.deepEqual(started.bridge.getErrors(session).map((e) => e.message), ['before the drop']);
    assert.ok(started.bridge.getEvents(session).events.some((e) => e.event === 'page:reconnected'));
  });

  it('two pages are two sessions: a target is required, and closing one leaves the other', async () => {
    started = await startBridge();
    const a = await connectPage(started.bridge).ready;
    const b = await connectPage(started.bridge).ready;
    pages.push(a, b);
    a.push('error:captured', { message: 'in a', type: 'effect' });
    await settle();
    assert.equal(started.bridge.resolveSession().problem, 'ambiguous');
    const sa = started.bridge.resolveSession('s1').session;
    const sb = started.bridge.resolveSession('s2').session;
    assert.equal(started.bridge.getErrors(sa).length, 1);
    assert.equal(started.bridge.getErrors(sb).length, 0);
    await b.close();
    await settle();
    assert.equal(started.bridge.isConnected(), true);
    assert.equal(started.bridge.resolveSession().session.id, 's1');
  });

  it('does not crash the process when the WS port is already in use (EADDRINUSE)', async () => {
    started = await startBridge();
    const err = await new Promise((resolve) => {
      const second = createBridge({ port: started.port, projectRoot: started.projectRoot, onError: resolve });
      setTimeout(() => second.close(), 200);
    });
    assert.equal(err.code, 'EADDRINUSE');
    const page = await connectPage(started.bridge).ready;
    pages.push(page);
    assert.equal(started.bridge.isConnected(), true, 'the original bridge still serves');
  });
});

describe('inbound messages are checked (security #11)', () => {
  it('drops malformed messages and unknown event names without crashing', async () => {
    const { bridge, page } = await bridgeWithPage();
    for (const raw of ['not json', '[]', '{"type":"bogus"}', '{"type":"event","event":"eval","data":{}}', '{"type":"events","batch":"x"}', '{"type":"hello","url":5}']) page.socket.send(raw);
    page.send({ type: 'events', batch: Array.from({ length: 2001 }, () => ({ event: 'effect:run', data: {} })) });
    await settle();
    const { session } = bridge.resolveSession();
    assert.equal(session.rejected, 7);
    assert.deepEqual(bridge.getEvents(session).events.map((e) => e.event), ['page:connected']);
    assert.equal(bridge.isConnected(), true);
  });

  it('accepts a response only on the socket its command went to', async () => {
    started = await startBridge();
    const target = connectPage(started.bridge, { handle: () => new Promise(() => {}) });
    const other = connectPage(started.bridge);
    pages.push(await target.ready, await other.ready);
    const session = started.bridge.resolveSession('s1').session;
    const pending = started.bridge.request(session, 'state', {}, { timeout: 300 });
    await settle();
    const { correlationId } = target.received.at(-1);
    other.send({ type: 'response', correlationId, data: { forged: true } });
    await assert.rejects(pending, /timed out/);
    assert.equal(started.bridge.resolveSession('s2').session.rejected, 1);
  });

  it('closes a socket that sends more than the payload limit', async () => {
    const { bridge, page } = await bridgeWithPage();
    page.socket.on('error', () => {});
    const closed = new Promise((resolve) => page.socket.once('close', resolve));
    page.socket.send('x'.repeat(9 * 1024 * 1024));
    await closed;
    await settle();
    assert.equal(bridge.isConnected(), false);
  });
});

describe('port handling', () => {
  it('uses the next port for pairing', async () => {
    started = await startBridge();
    const res = await fetch(`http://127.0.0.1:${started.port + 1}/__what_mcp_probe`);
    assert.deepEqual(await res.json(), { bridge: true, wsPort: started.port });
    assert.equal(started.bridge.controlPort, started.port + 1);
  });

  it('a socket without a token is refused', async () => {
    started = await startBridge();
    const ws = new WebSocket(`ws://127.0.0.1:${started.port}`);
    const status = await new Promise((resolve) => ws.once('unexpected-response', (_req, res) => resolve(res.statusCode)));
    assert.equal(status, 401);
  });
});
