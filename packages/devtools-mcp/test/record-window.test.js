// what_record_window — Round 5 addition.
// Profiles effect re-runs during a sampling window so agents can answer
// "which effects fired for this single action?" without combing through
// raw event logs.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../src/tools.js';
import { registerExtendedTools } from '../src/tools-extended.js';
import { registerAgentTools } from '../src/tools-agent.js';

// Build a bridge whose snapshot can flip between two states (baseline / after)
// so the test simulates an action firing during the window.
function makeFlipBridge({ baseline, after }) {
  let snap = baseline;
  return {
    isConnected: () => true,
    getSnapshot: () => snap,
    refreshSnapshot: async () => snap,
    getOrRefreshSnapshot: async () => snap,
    getCacheSnapshot: async () => [],
    getEvents: () => [],
    getErrors: () => [],
    saveBaseline: () => true,
    getBaseline: () => snap,
    sendCommand: async () => ({ error: 'unhandled' }),
    close: () => {},
    // test helper:
    _flipToAfter() { snap = after; },
  };
}

async function setup(bridge) {
  const server = new McpServer({ name: 't', version: '0.0.1' });
  registerTools(server, bridge);
  registerExtendedTools(server, bridge);
  registerAgentTools(server, bridge);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.1' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, server };
}

async function call(client, name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0]?.text;
  return text ? JSON.parse(text) : null;
}

describe('what_record_window', () => {
  let client, server;
  afterEach(async () => {
    try { await client?.close(); } catch {}
    try { await server?.close(); } catch {}
  });

  it('returns idle summary when nothing re-ran', async () => {
    const baseline = {
      signals: [],
      effects: [
        { id: 1, name: 'idle', runCount: 5, depSignalIds: [10] },
      ],
      components: [],
    };
    const bridge = makeFlipBridge({ baseline, after: baseline });
    ({ client, server } = await setup(bridge));
    const out = await call(client, 'what_record_window', { duration: 50 });
    assert.equal(out.totalRuns, 0);
    assert.equal(out.distinctEffects, 0);
    assert.match(out.summary, /idle|No effects re-ran/);
  });

  it('ranks effects by runs delta during the window', async () => {
    const baseline = {
      signals: [],
      effects: [
        { id: 1, name: 'hot',   runCount: 100, depSignalIds: [10] },
        { id: 2, name: 'warm',  runCount: 10,  depSignalIds: [11] },
        { id: 3, name: 'cold',  runCount: 1,   depSignalIds: [12] },
      ],
      components: [],
    };
    const after = {
      signals: [],
      effects: [
        { id: 1, name: 'hot',  runCount: 120, depSignalIds: [10] }, // +20
        { id: 2, name: 'warm', runCount: 13,  depSignalIds: [11] }, // +3
        { id: 3, name: 'cold', runCount: 1,   depSignalIds: [12] }, // 0
      ],
      components: [],
    };
    const bridge = makeFlipBridge({ baseline, after });
    ({ client, server } = await setup(bridge));

    // Flip state mid-window so the post snapshot sees the new counts.
    setTimeout(() => bridge._flipToAfter(), 30);

    const out = await call(client, 'what_record_window', { duration: 100 });
    assert.equal(out.totalRuns, 23);
    assert.equal(out.distinctEffects, 2);
    // Ranked by runs descending: hot (+20) before warm (+3).
    assert.equal(out.topEffects[0].name, 'hot');
    assert.equal(out.topEffects[0].runs, 20);
    assert.equal(out.topEffects[1].name, 'warm');
    assert.equal(out.topEffects[1].runs, 3);
    // cold (+0) should NOT appear unless includeZero is true.
    assert.ok(!out.topEffects.some(e => e.name === 'cold'));
  });

  it('honors includeZero flag', async () => {
    const baseline = {
      signals: [],
      effects: [
        { id: 1, name: 'silent', runCount: 5, depSignalIds: [10] },
      ],
      components: [],
    };
    const bridge = makeFlipBridge({ baseline, after: baseline });
    ({ client, server } = await setup(bridge));
    const out = await call(client, 'what_record_window', { duration: 50, includeZero: true });
    assert.equal(out.topEffects.length, 1);
    assert.equal(out.topEffects[0].runs, 0);
  });

  it('reports newly-created and disposed effects during the window', async () => {
    const baseline = {
      signals: [],
      effects: [
        { id: 1, name: 'will-be-disposed', runCount: 2, depSignalIds: [10] },
        { id: 2, name: 'stays',            runCount: 3, depSignalIds: [11] },
      ],
      components: [],
    };
    const after = {
      signals: [],
      effects: [
        { id: 2, name: 'stays',  runCount: 5, depSignalIds: [11] }, // +2
        { id: 3, name: 'newborn', runCount: 1, depSignalIds: [12] },
      ],
      components: [],
    };
    const bridge = makeFlipBridge({ baseline, after });
    ({ client, server } = await setup(bridge));
    setTimeout(() => bridge._flipToAfter(), 20);

    const out = await call(client, 'what_record_window', { duration: 80 });
    assert.equal(out.newEffectsCount, 1);
    assert.equal(out.newEffects[0].name, 'newborn');
    assert.equal(out.disposedCount, 1);
  });

  it('clamps duration below the minimum to 50ms', async () => {
    const snap = { signals: [], effects: [], components: [] };
    const bridge = makeFlipBridge({ baseline: snap, after: snap });
    ({ client, server } = await setup(bridge));
    const tinyOut = await call(client, 'what_record_window', { duration: 1 });
    assert.equal(tinyOut.windowMs, 50);
  });

  // Note: the upper clamp (30s) is asserted by code review — we don't run
  // a real 30-second sleep in CI. The Math.min(duration, 30000) is the
  // single line that enforces it; if it ever regresses, the tool would
  // wait far longer than 30s and time-budget tests would catch it.
});
