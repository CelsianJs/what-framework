// A scripted page for tool and bridge tests: a real bridge on free ports, a
// real WebSocket, and a page that speaks the client protocol (hello, batched
// events, a mark before each action, events flushed before every response)
// from a plain state object. No browser.

import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBridge } from '../../src/bridge.js';
import { registerTools } from '../../src/tools.js';
import { registerExtendedTools } from '../../src/tools-extended.js';

const ACTIONS = new Set(['set-signal', 'invalidate-cache', 'navigate', 'eval']);

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

/** Two adjacent free ports: the bridge's WebSocket port and its control port. */
export async function freePortPair() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const a = createServer();
    const b = createServer();
    try {
      const first = await listen(a, 0);
      await listen(b, first + 1);
      return first;
    } catch {
      // try another pair
    } finally {
      a.close();
      b.close();
    }
  }
  throw new Error('No free adjacent ports');
}

export function defaultState() {
  return {
    signals: [
      { id: 1, name: 'count', rev: 0, value: 42, componentId: 2 },
      { id: 2, name: 'name', rev: 0, value: 'hello', componentId: null },
      { id: 3, name: 'signal_3', rev: 0, value: {}, componentId: null },
    ],
    effects: [
      { id: 1, name: 'renderCounter', kind: 'effect', runCount: 5, depSignalIds: [1], depComputedIds: [], componentId: 2 },
      { id: 2, name: 'logEffect', kind: 'effect', runCount: 1, depSignalIds: [2], depComputedIds: [], componentId: null },
    ],
    components: [
      { id: 1, name: 'App', parentId: null },
      { id: 2, name: 'Counter', parentId: 1 },
    ],
  };
}

/**
 * Start a bridge in a scratch project directory. Free ports can be taken by a
 * parallel test between the probe and the bind, so a failed bind retries.
 */
export async function startBridge(options = {}) {
  const projectRoot = options.projectRoot || mkdtempSync(join(tmpdir(), 'what-bridge-'));
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await freePortPair();
    const bridge = createBridge({ port, projectRoot, onError: () => {} });
    try {
      await bridge.ready;
    } catch {
      bridge.close();
      continue;
    }
    const close = () => {
      bridge.close();
      if (!options.projectRoot) rmSync(projectRoot, { recursive: true, force: true });
    };
    return { bridge, port, projectRoot, close };
  }
  throw new Error('Could not bind a bridge after 5 attempts');
}

/**
 * Connect a scripted page. `handle(command, args, page)` answers commands the
 * built-in ones do not; it may call page.emit() to produce events for the
 * action. Built in: sync, state, signal, app-info, set-signal.
 */
export function connectPage(bridge, { state = defaultState(), origin, token = bridge.pairingKey, pageId = `page-${Math.random().toString(36).slice(2)}`, url = 'http://localhost:5173/', title = 'Test app', handle } = {}) {
  const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}/?token=${encodeURIComponent(token)}&page=${pageId}`, origin ? { headers: { Origin: origin } } : {});
  const page = {
    socket,
    state,
    pageId,
    received: [],
    pending: [],
    emit(event, data) { page.pending.push({ event, data }); },
    flush() {
      if (!page.pending.length || socket.readyState !== 1) return;
      socket.send(JSON.stringify({ type: 'events', batch: page.pending.splice(0) }));
    },
    push(event, data) { page.emit(event, data); page.flush(); },
    send(msg) { socket.send(JSON.stringify(msg)); },
    close() {
      return new Promise((resolve) => {
        if (socket.readyState === 3) return resolve();
        socket.on('error', () => {});
        socket.once('close', resolve);
        if (socket.readyState === 0) socket.terminate();
        else socket.close();
      });
    },
  };

  function builtIn(command, args) {
    switch (command) {
      case 'sync': return {};
      case 'state': return page.state;
      case 'app-info': return { url, title, route: new URL(url).pathname, viewport: { width: 1280, height: 720 } };
      case 'signal': {
        const s = page.state.signals.find((x) => x.id === args.id);
        return s ? { ...s } : { error: `Signal ${args.id} not found` };
      }
      case 'set-signal': {
        const s = page.state.signals.find((x) => x.id === args.signalId);
        if (!s) return { error: `Signal ${args.signalId} not found` };
        const previous = s.value;
        s.value = args.value;
        s.rev++;
        page.emit('signal:updated', { id: s.id, name: s.name, value: args.value, prev: previous, rev: s.rev, writerEffectId: null });
        for (const e of page.state.effects.filter((x) => x.depSignalIds.includes(s.id))) {
          e.runCount++;
          page.emit('effect:run', { id: e.id, name: e.name, runCount: e.runCount, causeSignalIds: [s.id], causeComputedIds: [] });
        }
        return { previous, current: args.value, rev: s.rev };
      }
      default: return undefined;
    }
  }

  socket.on('message', async (raw) => {
    const msg = JSON.parse(String(raw));
    page.received.push(msg);
    page.flush();
    if (ACTIONS.has(msg.command)) page.send({ type: 'mark', correlationId: msg.correlationId });
    let data = handle ? await handle(msg.command, msg.args, page) : undefined;
    if (data === undefined) data = builtIn(msg.command, msg.args || {});
    if (data === undefined) data = { error: `Unknown command: ${msg.command}` };
    page.flush();
    page.send({ type: 'response', correlationId: msg.correlationId, data });
  });

  page.ready = new Promise((resolve, reject) => {
    socket.once('open', () => {
      page.send({ type: 'hello', url, title, diagnosticsDropped: 0 });
      setTimeout(() => resolve(page), 20);
    });
    socket.once('unexpected-response', (_req, res) => reject(Object.assign(new Error(`refused ${res.statusCode}`), { status: res.statusCode })));
    socket.once('error', reject);
  });
  return page;
}

/** An MCP client wired to the live tools of `bridge`. */
export async function connectTools(bridge) {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerTools(server, bridge);
  registerExtendedTools(server, bridge);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content.find((c) => c.type === 'text')?.text;
    return { ...result, parsed: text ? JSON.parse(text) : null };
  }
  return { client, server, call, close: async () => { await client.close(); await server.close(); } };
}
