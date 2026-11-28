// The tool catalogue is derived from registration, and the registered set is
// pinned here: docs, scaffold templates and the MCP prompt all name tools, so
// a rename or removal has to show up as a test change, never as silent drift.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  instrumentServer,
  getRegisteredTools,
  describeToolAvailability,
  __resetToolRegistry,
} from '../src/tool-registry.js';
import { TOOL_CHANGES } from '../tool-changes.js';

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

// Pin the full tool surface, including what_why.
const TOOLS = [
  'what_connection_status', 'what_signals', 'what_effects', 'what_components', 'what_snapshot',
  'what_errors', 'what_events', 'what_cache', 'what_set_signal', 'what_invalidate_cache',
  'what_dependency_graph', 'what_eval', 'what_dom_inspect', 'what_route', 'what_diagnose',
  'what_navigate', 'what_explain', 'what_why', 'what_signal_trace', 'what_look', 'what_page_map', 'what_screenshot',
  'what_lint', 'what_scaffold', 'what_fix',
];

// Removed in the consolidation: component_tree -> what_components {tree},
// diff_snapshot -> what_snapshot {mode}, watch and record_window -> what_events,
// validate -> what_lint {compile}, perf -> what_diagnose.
const REMOVED = TOOL_CHANGES.removed.flatMap((change) => change.names);

describe('the real server registers exactly the documented tool set', () => {
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
    assert.deepEqual([...names].sort(), [...TOOLS].sort());
    assert.equal(new Set(names).size, names.length, 'tool names must be unique');

    for (const removed of REMOVED) {
      assert.ok(!names.includes(removed), `${removed} was removed with no alias`);
    }

    const { available } = describeToolAvailability(false);
    assert.deepEqual(available.map((t) => t.name).sort(), ['what_connection_status', 'what_fix', 'what_lint', 'what_scaffold']);
    const { requiresBrowser } = describeToolAvailability(false);
    assert.ok(requiresBrowser.length > 0, 'most tools genuinely need a live page');
  });
});
