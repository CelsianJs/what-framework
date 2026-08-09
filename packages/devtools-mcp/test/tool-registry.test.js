// Regression for the catalogue drift found in the 2026-08-09 parity audit:
// what_connection_status is the tool agents are told to call FIRST, and it
// answered with a hand-maintained array of 17 entries while 29 tools were
// registered. The catalogue is now derived from registration itself.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  instrumentServer,
  getRegisteredTools,
  describeToolAvailability,
  __resetToolRegistry,
} from '../src/tool-registry.js';

// Minimal stand-in for the MCP server surface the registry wraps.
function fakeServer() {
  const calls = [];
  return { calls, tool: (name, desc, schema, handler) => calls.push({ name, desc, schema, handler }) };
}

describe('the tool catalogue is derived from registration, not hand-maintained', () => {
  beforeEach(() => __resetToolRegistry());

  it('records every registration and still registers it downstream', () => {
    const server = instrumentServer(fakeServer());
    server.tool('what_alpha', 'first', {}, () => {});
    server.tool('what_beta', 'second', {}, () => {});

    assert.deepEqual(getRegisteredTools().map((t) => t.name), ['what_alpha', 'what_beta']);
    assert.equal(server.calls.length, 2, 'the real server.tool must still receive the call');
    assert.equal(typeof server.calls[0].handler, 'function', 'trailing args must pass through');
  });

  it('is idempotent, so double instrumentation cannot double-count', () => {
    const server = instrumentServer(fakeServer());
    instrumentServer(server);
    server.tool('what_alpha', 'first', {}, () => {});
    assert.equal(getRegisteredTools().length, 1);
  });

  it('splits the catalogue by what can answer without a browser', () => {
    const server = instrumentServer(fakeServer());
    server.tool('what_lint', 'offline', {}, () => {});
    server.tool('what_signals', 'needs a page', {}, () => {});

    const offline = describeToolAvailability(false);
    assert.equal(offline.total, 2);
    assert.deepEqual(offline.available.map((t) => t.name), ['what_lint']);
    assert.deepEqual(offline.requiresBrowser.map((t) => t.name), ['what_signals']);

    const connected = describeToolAvailability(true);
    assert.equal(connected.available.length, 2, 'everything answers once a browser is attached');
    assert.deepEqual(connected.requiresBrowser, []);
  });
});

describe('the real server reports its real tool count', () => {
  // The literal this replaced said 17. If someone adds a tool and the reported
  // count does not move, the catalogue has been hand-maintained again.
  it('registers every tool through the instrumented surface', async () => {
    __resetToolRegistry();
    const server = instrumentServer(fakeServer());
    const bridge = { send: async () => ({}), isConnected: () => false };
    const { registerTools } = await import('../src/tools.js');
    const { registerExtendedTools } = await import('../src/tools-extended.js');
    const { registerAgentTools } = await import('../src/tools-agent.js');
    registerTools(server, bridge);
    registerExtendedTools(server, bridge);
    registerAgentTools(server, bridge);

    const names = getRegisteredTools().map((t) => t.name);
    assert.ok(names.length >= 29, `expected at least 29 registered tools, got ${names.length}`);
    assert.equal(new Set(names).size, names.length, 'tool names must be unique');
    assert.ok(names.every((n) => n.startsWith('what_')), 'every tool is namespaced what_*');

    // The four documented offline tools must genuinely be registered, since
    // CLAUDE.md promises they work with no browser attached.
    for (const n of ['what_lint', 'what_scaffold', 'what_fix', 'what_validate']) {
      assert.ok(names.includes(n), `${n} is documented as offline-capable but is not registered`);
    }

    const { requiresBrowser } = describeToolAvailability(false);
    assert.ok(requiresBrowser.length > 0, 'most tools genuinely need a live page');
  });
});
