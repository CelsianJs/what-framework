/**
 * Unit tests for agent-first MCP tools (what_lint, what_scaffold, what_validate, what_perf, what_fix).
 * Uses InMemoryTransport + MCP Client — no WebSocket needed.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerAgentTools } from '../src/tools-agent.js';

function createMockBridge(opts = {}) {
  const snapshot = opts.snapshot || {
    signals: [
      { id: 1, name: 'count', value: 42 },
      { id: 2, name: 'name', value: 'hello' },
    ],
    effects: [
      { id: 1, name: 'renderCounter', depSignalIds: [1], runCount: 5 },
      { id: 2, name: 'logEffect', depSignalIds: [2], runCount: 1 },
      { id: 3, name: 'hotEffect', depSignalIds: [1, 2], runCount: 200 },
    ],
    components: [
      { id: 1, name: 'App' },
      { id: 2, name: 'Counter' },
    ],
  };

  const events = opts.events || [];
  const errors = opts.errorLog || [];
  let connected = opts.connected !== false;

  return {
    isConnected: () => connected,
    getSnapshot: () => snapshot,
    refreshSnapshot: async () => snapshot,
    getOrRefreshSnapshot: async () => snapshot,
    getEvents: (since) => since ? events.filter(e => e.timestamp > since) : events,
    getErrors: (since) => since ? errors.filter(e => e.timestamp > since) : errors,
    sendCommand: async (command, args) => {
      if (command === 'validate-code') {
        return { output: 'compiled output', warnings: [] };
      }
      return { error: `Unknown command: ${command}` };
    },
    close: () => {},
  };
}

async function setupMcp(bridgeOpts) {
  const bridge = createMockBridge(bridgeOpts);
  const server = new McpServer({ name: 'test-agent', version: '0.1.0' });
  registerAgentTools(server, bridge);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.1.0' });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return { client, server, bridge };
}

async function callTool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content[0]?.text;
  return { ...result, parsed: text ? JSON.parse(text) : null };
}

describe('what-devtools-mcp agent tools', () => {
  let client, server, bridge;

  afterEach(async () => {
    try { await client?.close(); } catch {}
    try { await server?.close(); } catch {}
  });

  // -----------------------------------------------------------------------
  // what_lint
  // -----------------------------------------------------------------------

  describe('what_lint', () => {
    it('detects missing signal read in JSX', async () => {
      ({ client, server, bridge } = await setupMcp());
      const code = `
import { signal } from 'what-framework';
function App() {
  const count = signal(0);
  return <span>{count}</span>;
}`;
      const { parsed } = await callTool(client, 'what_lint', { code });
      assert.ok(parsed.issueCount > 0, 'Should find at least one issue');
      assert.ok(parsed.issues.some(i => i.code === 'ERR_MISSING_SIGNAL_READ'));
    });

    it('detects effect read-write cycle', async () => {
      ({ client, server, bridge } = await setupMcp());
      const code = `
import { signal, effect } from 'what-framework';
const count = signal(0);
effect(() => { count(count() + 1); });`;
      const { parsed } = await callTool(client, 'what_lint', { code });
      assert.ok(parsed.issues.some(i => i.code === 'ERR_INFINITE_EFFECT'));
    });

    it('detects missing cleanup in effect', async () => {
      ({ client, server, bridge } = await setupMcp());
      const code = `
import { effect } from 'what-framework';
effect(() => { window.addEventListener('resize', handler); });`;
      const { parsed } = await callTool(client, 'what_lint', { code });
      assert.ok(parsed.issues.some(i => i.code === 'ERR_MISSING_CLEANUP'));
    });

    it('detects unsafe innerHTML', async () => {
      ({ client, server, bridge } = await setupMcp());
      const code = `<div innerHTML={userInput} />`;
      const { parsed } = await callTool(client, 'what_lint', { code });
      assert.ok(parsed.issues.some(i => i.code === 'ERR_UNSAFE_INNERHTML'));
    });

    it('returns clean for valid code', async () => {
      ({ client, server, bridge } = await setupMcp());
      const code = `
import { signal } from 'what-framework';
function App() {
  const count = signal(0);
  return <span>{count()}</span>;
}`;
      const { parsed } = await callTool(client, 'what_lint', { code });
      assert.equal(parsed.issueCount, 0);
    });

    it('filters by specific rules', async () => {
      ({ client, server, bridge } = await setupMcp());
      const code = `
import { signal, effect } from 'what-framework';
const count = signal(0);
effect(() => { count(count() + 1); });
<div innerHTML={userInput} />`;
      const { parsed } = await callTool(client, 'what_lint', {
        code,
        rules: ['innerhtml-without-html'],
      });
      // Should only find innerHTML issue, not the effect cycle
      assert.ok(parsed.issues.every(i => i.code === 'ERR_UNSAFE_INNERHTML'));
    });
  });

  // -----------------------------------------------------------------------
  // what_scaffold
  // -----------------------------------------------------------------------

  describe('what_scaffold', () => {
    it('generates a component', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_scaffold', {
        type: 'component',
        name: 'UserCard',
        props: ['name', 'email'],
        signals: ['isEditing'],
      });
      assert.ok(parsed.code.includes('function UserCard'));
      assert.ok(parsed.code.includes('name, email'));
      assert.ok(parsed.code.includes("signal("));
      assert.equal(parsed.type, 'component');
    });

    it('generates a page', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_scaffold', {
        type: 'page',
        name: 'Dashboard',
      });
      assert.ok(parsed.code.includes('function Dashboard'));
      assert.ok(parsed.code.includes('Head'));
      assert.ok(parsed.code.includes('onMount'));
    });

    it('generates a form', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_scaffold', {
        type: 'form',
        name: 'LoginForm',
        signals: ['email', 'password'],
      });
      assert.ok(parsed.code.includes('function LoginForm'));
      assert.ok(parsed.code.includes('useForm'));
      assert.ok(parsed.code.includes('handleSubmit'));
    });

    it('generates a store', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_scaffold', {
        type: 'store',
        name: 'AppStore',
        signals: ['users', 'loading'],
      });
      assert.ok(parsed.code.includes('createStore'));
      assert.ok(parsed.code.includes('users'));
    });

    it('generates an island', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_scaffold', {
        type: 'island',
        name: 'LiveChat',
      });
      assert.ok(parsed.code.includes('function LiveChat'));
      assert.ok(parsed.code.includes('.island = true'));
      assert.ok(parsed.code.includes('data-island'));
    });

    it('rejects non-PascalCase names for components', async () => {
      ({ client, server, bridge } = await setupMcp());
      const result = await callTool(client, 'what_scaffold', {
        type: 'component',
        name: 'myComponent',
      });
      assert.ok(result.parsed.error);
      assert.ok(result.parsed.error.includes('PascalCase'));
    });
  });

  // -----------------------------------------------------------------------
  // what_validate
  // -----------------------------------------------------------------------

  describe('what_validate', () => {
    it('validates code through browser compiler', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_validate', {
        code: 'function App() { return <div>Hello</div>; }',
      });
      assert.equal(parsed.valid, true);
    });

    it('returns errors when not connected (falls back to static analysis)', async () => {
      ({ client, server, bridge } = await setupMcp({ connected: false }));
      const result = await callTool(client, 'what_validate', {
        code: 'function App() { return <div>Hello</div>; }',
      });
      assert.ok(result.parsed.error || result.parsed.valid !== undefined);
    });
  });

  // -----------------------------------------------------------------------
  // what_perf
  // -----------------------------------------------------------------------

  describe('what_perf', () => {
    it('returns performance snapshot', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_perf', { threshold: 10 });
      assert.ok(parsed.counts);
      assert.equal(parsed.counts.signals, 2);
      assert.equal(parsed.counts.effects, 3);
      assert.equal(parsed.counts.components, 2);
      assert.ok(parsed.hotEffects.length > 0, 'Should detect hot effect with runCount 200');
      assert.ok(parsed.memoryEstimate);
    });

    it('flags hot effects by threshold', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_perf', { threshold: 100 });
      assert.equal(parsed.hotEffects.length, 1);
      assert.equal(parsed.hotEffects[0].name, 'hotEffect');
    });

    it('returns error when not connected', async () => {
      ({ client, server, bridge } = await setupMcp({ connected: false }));
      const result = await callTool(client, 'what_perf');
      assert.ok(result.parsed.error);
    });
  });

  // -----------------------------------------------------------------------
  // what_fix
  // -----------------------------------------------------------------------

  describe('what_fix', () => {
    it('finds fix by exact error code', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fix', {
        error: 'ERR_INFINITE_EFFECT',
      });
      assert.equal(parsed.found, true);
      assert.equal(parsed.error, 'ERR_INFINITE_EFFECT');
      assert.ok(parsed.diagnosis);
      assert.ok(parsed.suggestedFix);
      assert.ok(parsed.codeExample);
    });

    it('finds fix by keyword', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fix', {
        error: 'infinite loop',
      });
      assert.equal(parsed.found, true);
      assert.equal(parsed.error, 'ERR_INFINITE_EFFECT');
    });

    it('finds fix for hydration', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fix', {
        error: 'hydration mismatch',
      });
      assert.equal(parsed.found, true);
      assert.equal(parsed.error, 'ERR_HYDRATION_MISMATCH');
    });

    it('finds fix for missing signal read', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fix', {
        error: 'ERR_MISSING_SIGNAL_READ',
      });
      assert.equal(parsed.found, true);
      assert.ok(parsed.suggestedFix.includes('()'));
    });

    it('returns available codes for unknown errors', async () => {
      ({ client, server, bridge } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fix', {
        error: 'totally_unknown_error_xyz',
      });
      assert.equal(parsed.found, false);
      assert.ok(parsed.availableCodes.length > 0);
    });

    it('finds all error codes', async () => {
      ({ client, server, bridge } = await setupMcp());
      const codes = [
        'ERR_INFINITE_EFFECT',
        'ERR_MISSING_SIGNAL_READ',
        'ERR_HYDRATION_MISMATCH',
        'ERR_ORPHAN_EFFECT',
        'ERR_SIGNAL_WRITE_IN_RENDER',
        'ERR_MISSING_CLEANUP',
        'ERR_UNSAFE_INNERHTML',
        'ERR_MISSING_KEY',
      ];
      for (const code of codes) {
        const { parsed } = await callTool(client, 'what_fix', { error: code });
        assert.equal(parsed.found, true, `Should find fix for ${code}`);
        assert.ok(parsed.diagnosis, `${code} should have diagnosis`);
        assert.ok(parsed.codeExample, `${code} should have code example`);
      }
    });
  });
});
