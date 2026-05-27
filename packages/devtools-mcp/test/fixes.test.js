/**
 * Unit tests for the devtools-mcp audit fixes:
 *   - P0-2: what_set_signal JSON coercion (no double-stringify)
 *   - P1-7: what_errors stack parsing (file/line/component extracted)
 *   - P1-8: what_page_map per-category budgets
 *   - P2-3: what_perf hides noisy largestSubscribers when max == 1
 *   - P2-8: what_lint destructured-props + module-scope-signal-missing-name
 *
 * Uses the InMemoryTransport pattern from tools.test.js so the server's
 * registered tools are exercised end-to-end without a real WebSocket.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../src/tools.js';
import { registerExtendedTools } from '../src/tools-extended.js';
import { registerAgentTools } from '../src/tools-agent.js';

function makeBridge(opts = {}) {
  const snapshot = opts.snapshot || {
    signals: [{ id: 85, name: 'items', value: [] }],
    effects: [],
    components: [{ id: 1, name: 'TaskList' }],
    errors: [],
  };
  const errorLog = opts.errors || [];
  return {
    isConnected: () => opts.connected !== false,
    getSnapshot: () => snapshot,
    refreshSnapshot: async () => snapshot,
    getOrRefreshSnapshot: async () => snapshot,
    getCacheSnapshot: async () => [],
    getEvents: () => [],
    getErrors: () => errorLog,
    saveBaseline: () => true,
    getBaseline: () => snapshot,
    sendCommand: opts.sendCommand || (async (cmd, args) => ({ error: `unhandled: ${cmd}` })),
    close: () => {},
  };
}

async function setup(bridgeOpts) {
  const bridge = makeBridge(bridgeOpts);
  const server = new McpServer({ name: 't', version: '0.0.1' });
  registerTools(server, bridge);
  registerExtendedTools(server, bridge);
  registerAgentTools(server, bridge);
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0.0.1' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return { client, server, bridge };
}

async function call(client, name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0]?.text;
  return text ? JSON.parse(text) : null;
}

describe('audit fixes', () => {
  let client, server;
  afterEach(async () => {
    try { await client?.close(); } catch {}
    try { await server?.close(); } catch {}
  });

  describe('P0-2 — what_set_signal JSON coercion', () => {
    it('parses stringified array payloads into native arrays', async () => {
      let received = null;
      ({ client, server } = await setup({
        sendCommand: async (cmd, args) => {
          if (cmd === 'set-signal') { received = args; return { previous: [], current: args.value }; }
          return { error: 'nope' };
        },
      }));
      // Agent passes a JSON-encoded string (the broken case).
      await call(client, 'what_set_signal', {
        signalId: 85,
        value: '[{"id":1,"name":"X"},{"id":2,"name":"Y"}]',
      });
      assert.ok(received, 'set-signal command was forwarded');
      assert.ok(Array.isArray(received.value), `expected array, got ${typeof received.value}`);
      assert.equal(received.value.length, 2);
      assert.equal(received.value[0].id, 1);
    });

    it('parses stringified number into native number', async () => {
      let received = null;
      ({ client, server } = await setup({
        sendCommand: async (cmd, args) => {
          if (cmd === 'set-signal') { received = args; return { previous: 0, current: args.value }; }
        },
      }));
      await call(client, 'what_set_signal', { signalId: 85, value: '42' });
      assert.equal(typeof received.value, 'number');
      assert.equal(received.value, 42);
    });

    it('leaves plain user strings alone', async () => {
      let received = null;
      ({ client, server } = await setup({
        sendCommand: async (cmd, args) => {
          if (cmd === 'set-signal') { received = args; return { previous: '', current: args.value }; }
        },
      }));
      await call(client, 'what_set_signal', { signalId: 85, value: 'hello world' });
      assert.equal(received.value, 'hello world');
    });

    it('passes native arrays through untouched', async () => {
      let received = null;
      ({ client, server } = await setup({
        sendCommand: async (cmd, args) => {
          if (cmd === 'set-signal') { received = args; return { previous: [], current: args.value }; }
        },
      }));
      await call(client, 'what_set_signal', { signalId: 85, value: [{ id: 1 }] });
      assert.ok(Array.isArray(received.value));
      assert.equal(received.value[0].id, 1);
    });
  });

  describe('P1-7 — what_errors stack parsing', () => {
    it('extracts file/line and component from a typical V8 stack', async () => {
      const stack = [
        'Error: count is not defined',
        '    at TaskList (http://localhost:5173/src/components/TaskList.jsx:42:13)',
        '    at runComponent (http://localhost:5173/node_modules/.vite/deps/what-core.js:200:5)',
      ].join('\n');
      ({ client, server } = await setup({
        snapshot: { signals: [], effects: [], components: [{ id: 7, name: 'TaskList' }], errors: [] },
        errors: [{ message: 'count is not defined', stack, timestamp: Date.now() }],
      }));
      const out = await call(client, 'what_errors');
      assert.equal(out.count, 1);
      const err = out.errors[0];
      assert.ok(err.file?.includes('TaskList.jsx'), `file: ${err.file}`);
      assert.equal(err.line, 42);
      assert.equal(err.column, 13);
      assert.equal(err.component, 'TaskList');
      // A suggestion of some kind is attached (specific pattern matchers in
      // tools.js may override the generic inferSuggestion; we just confirm
      // the field is populated and isn't the bare default).
      assert.ok(err.suggestion && err.suggestion.length > 10, err.suggestion);
    });

    it('skips framework internal frames when picking file/line', async () => {
      const stack = [
        'TypeError: x.foo is not a function',
        '    at notify (http://localhost:5173/node_modules/what-core/src/reactive.js:10:1)',
        '    at MyComp (http://localhost:5173/src/MyComp.jsx:8:3)',
      ].join('\n');
      ({ client, server } = await setup({
        snapshot: { signals: [], effects: [], components: [], errors: [] },
        errors: [{ message: 'x.foo is not a function', stack, timestamp: Date.now() }],
      }));
      const out = await call(client, 'what_errors');
      assert.ok(out.errors[0].file?.endsWith('MyComp.jsx'), out.errors[0].file);
      assert.equal(out.errors[0].line, 8);
    });
  });

  describe('P1-8 — what_page_map per-category budgets', () => {
    it('returns headings/components even when there are many landmarks', async () => {
      ({ client, server } = await setup({
        sendCommand: async (cmd) => {
          if (cmd === 'page-map') {
            // Server now returns its own budgeted slices; in the real client
            // implementation the budget is per-category. We exercise the
            // server-side serialization path with a representative payload.
            return {
              viewport: { width: 1280, height: 720 },
              landmarks: Array.from({ length: 250 }, (_, i) => ({ tag: 'section', text: `l${i}`, rect: {} })),
              interactives: [],
              headings: Array.from({ length: 12 }, (_, i) => ({ level: 2, text: `h${i}` })),
              components: Array.from({ length: 5 }, (_, i) => ({ id: i, name: `C${i}` })),
              totalElements: 267,
            };
          }
        },
      }));
      const out = await call(client, 'what_page_map');
      assert.ok(out.headings.length >= 1, 'headings should not be empty');
      assert.ok(out.components.length >= 1, 'components should not be empty');
    });
  });

  describe('P2-3 — what_perf suppresses noisy largestSubscribers', () => {
    it('omits largestSubscribers when max subscriberCount is 1', async () => {
      ({ client, server } = await setup({
        snapshot: {
          signals: [{ id: 1, name: 'a', value: 0 }, { id: 2, name: 'b', value: 0 }],
          effects: [
            { id: 1, name: 'e1', depSignalIds: [1], runCount: 1 },
            { id: 2, name: 'e2', depSignalIds: [2], runCount: 1 },
          ],
          components: [],
          errors: [],
        },
      }));
      const out = await call(client, 'what_perf');
      assert.equal(out.largestSubscribers, undefined,
        'largestSubscribers should be omitted when max is 1');
    });

    it('includes largestSubscribers when a signal has 2+ subscribers', async () => {
      ({ client, server } = await setup({
        snapshot: {
          signals: [{ id: 1, name: 'a', value: 0 }],
          effects: [
            { id: 1, name: 'e1', depSignalIds: [1], runCount: 1 },
            { id: 2, name: 'e2', depSignalIds: [1], runCount: 1 },
          ],
          components: [],
          errors: [],
        },
      }));
      const out = await call(client, 'what_perf');
      assert.ok(Array.isArray(out.largestSubscribers));
      assert.equal(out.largestSubscribers[0].subscriberCount, 2);
    });
  });

  // =========================================================================
  // URL validation in what_navigate
  // =========================================================================
  describe('what_navigate URL validation', () => {
    it('rejects javascript: URL', async () => {
      ({ client, server } = await setup({
        sendCommand: async () => ({ navigatedTo: '/', currentPath: '/' }),
      }));
      const out = await call(client, 'what_navigate', { path: 'javascript:alert(1)' });
      assert.ok(out.error, 'should be an error');
      assert.ok(out.error.includes('Blocked') || out.error.includes('unsafe'));
    });

    it('rejects mixed-case JaVaScRiPt: URL', async () => {
      ({ client, server } = await setup({
        sendCommand: async () => ({ navigatedTo: '/', currentPath: '/' }),
      }));
      const out = await call(client, 'what_navigate', { path: 'JaVaScRiPt:alert(1)' });
      assert.ok(out.error, 'mixed-case should be rejected');
    });

    it('rejects data: URL', async () => {
      ({ client, server } = await setup({
        sendCommand: async () => ({ navigatedTo: '/', currentPath: '/' }),
      }));
      const out = await call(client, 'what_navigate', { path: 'data:text/html,<script>' });
      assert.ok(out.error, 'data: should be rejected');
    });

    it('rejects vbscript: URL', async () => {
      ({ client, server } = await setup({
        sendCommand: async () => ({ navigatedTo: '/', currentPath: '/' }),
      }));
      const out = await call(client, 'what_navigate', { path: 'vbscript:msgbox' });
      assert.ok(out.error, 'vbscript: should be rejected');
    });

    it('rejects newline-prefixed javascript: URL', async () => {
      ({ client, server } = await setup({
        sendCommand: async () => ({ navigatedTo: '/', currentPath: '/' }),
      }));
      const out = await call(client, 'what_navigate', { path: '\njavascript:alert(1)' });
      assert.ok(out.error, 'newline-prefixed should be rejected');
    });

    it('allows /dashboard', async () => {
      let navigated = false;
      ({ client, server } = await setup({
        sendCommand: async (cmd) => {
          if (cmd === 'navigate') { navigated = true; return { navigatedTo: '/dashboard', currentPath: '/dashboard', success: true }; }
          return { error: 'nope' };
        },
      }));
      const out = await call(client, 'what_navigate', { path: '/dashboard' });
      assert.ok(!out.error, `unexpected error: ${out.error}`);
      assert.ok(navigated, 'navigate command should have been sent');
    });

    it('allows ./relative', async () => {
      let navigated = false;
      ({ client, server } = await setup({
        sendCommand: async (cmd) => {
          if (cmd === 'navigate') { navigated = true; return { navigatedTo: './relative', currentPath: '/', success: true }; }
          return { error: 'nope' };
        },
      }));
      const out = await call(client, 'what_navigate', { path: './relative' });
      assert.ok(!out.error);
      assert.ok(navigated);
    });

    it('allows #hash', async () => {
      let navigated = false;
      ({ client, server } = await setup({
        sendCommand: async (cmd) => {
          if (cmd === 'navigate') { navigated = true; return { navigatedTo: '#hash', currentPath: '/', success: true }; }
          return { error: 'nope' };
        },
      }));
      const out = await call(client, 'what_navigate', { path: '#hash' });
      assert.ok(!out.error);
      assert.ok(navigated);
    });

    it('allows ?query=1', async () => {
      let navigated = false;
      ({ client, server } = await setup({
        sendCommand: async (cmd) => {
          if (cmd === 'navigate') { navigated = true; return { navigatedTo: '?query=1', currentPath: '/', success: true }; }
          return { error: 'nope' };
        },
      }));
      const out = await call(client, 'what_navigate', { path: '?query=1' });
      assert.ok(!out.error);
      assert.ok(navigated);
    });

    it('allows https://example.com', async () => {
      let navigated = false;
      ({ client, server } = await setup({
        sendCommand: async (cmd) => {
          if (cmd === 'navigate') { navigated = true; return { navigatedTo: 'https://example.com', currentPath: '/', success: true }; }
          return { error: 'nope' };
        },
      }));
      const out = await call(client, 'what_navigate', { path: 'https://example.com' });
      assert.ok(!out.error, `unexpected error: ${out.error}`);
      assert.ok(navigated);
    });
  });

  // =========================================================================
  // isSafeRead denylist via what_eval
  // =========================================================================
  describe('isSafeRead denylist (what_eval without unsafe flag)', () => {
    // what_eval allows safe read-only expressions without --unsafe-eval.
    // We test the boundary by calling what_eval with known safe/unsafe expressions.
    // The tool returns an error for unsafe expressions.

    it('allows window.location.href (safe dotted read)', async () => {
      ({ client, server } = await setup({
        sendCommand: async (cmd, args) => {
          if (cmd === 'eval') return { result: 'http://localhost', type: 'string', executionTime: 0 };
          return { error: 'nope' };
        },
      }));
      const out = await call(client, 'what_eval', { code: 'window.location.href' });
      // Should NOT be an error — safe read
      assert.ok(!out.error, `should be allowed: ${out.error}`);
    });

    it('allows document.title', async () => {
      ({ client, server } = await setup({
        sendCommand: async () => ({ result: 'My App', type: 'string', executionTime: 0 }),
      }));
      const out = await call(client, 'what_eval', { code: 'document.title' });
      assert.ok(!out.error, `should be allowed: ${out.error}`);
    });

    it('allows navigator.userAgent', async () => {
      ({ client, server } = await setup({
        sendCommand: async () => ({ result: 'Mozilla/5.0', type: 'string', executionTime: 0 }),
      }));
      const out = await call(client, 'what_eval', { code: 'navigator.userAgent' });
      assert.ok(!out.error);
    });

    it('rejects window.constructor (proto denylist)', async () => {
      ({ client, server } = await setup());
      const out = await call(client, 'what_eval', { code: 'window.constructor' });
      assert.ok(out.error, 'constructor should be rejected');
    });

    it('rejects window.constructor.constructor', async () => {
      ({ client, server } = await setup());
      const out = await call(client, 'what_eval', { code: 'window.constructor.constructor' });
      assert.ok(out.error);
    });

    it('rejects document.__proto__', async () => {
      ({ client, server } = await setup());
      const out = await call(client, 'what_eval', { code: 'document.__proto__' });
      assert.ok(out.error);
    });

    it('rejects Object.prototype (not a safe global)', async () => {
      ({ client, server } = await setup());
      const out = await call(client, 'what_eval', { code: 'Object.prototype' });
      assert.ok(out.error, 'Object is not in safe globals');
    });

    it('rejects bracket notation (window["eval"])', async () => {
      ({ client, server } = await setup());
      const out = await call(client, 'what_eval', { code: 'window["eval"]' });
      assert.ok(out.error, 'brackets should fail simple ident check');
    });

    it('rejects empty string', async () => {
      ({ client, server } = await setup());
      const out = await call(client, 'what_eval', { code: '' });
      assert.ok(out.error, 'empty string should be rejected');
    });

    it('rejects single-segment expression (just "document")', async () => {
      ({ client, server } = await setup());
      const out = await call(client, 'what_eval', { code: 'document' });
      assert.ok(out.error, 'single segment needs >= 2 segments');
    });
  });

  describe('P2-8 — new lint rules', () => {
    it('flags destructured props inside a component body', async () => {
      ({ client, server } = await setup());
      const code = `
function TodoItem(props) {
  const { title, done } = props;
  return <li>{title}</li>;
}`;
      const out = await call(client, 'what_lint', { code, rules: ['destructured-props-lose-reactivity'] });
      assert.ok(out.issues.length >= 1, `expected at least one issue, got ${JSON.stringify(out.issues)}`);
      assert.equal(out.issues[0].code, 'ERR_DESTRUCTURED_PROPS');
    });

    it('flags module-scope signals missing a debug name', async () => {
      ({ client, server } = await setup());
      const code = `
import { signal } from 'what-framework';
export const todos = signal([]);
export const count = signal(0, 'count');
`;
      const out = await call(client, 'what_lint', { code, rules: ['module-scope-signal-missing-name'] });
      // Should flag `todos` but NOT `count`.
      const messages = out.issues.map(i => i.message).join('\n');
      assert.ok(/todos/.test(messages), `expected todos warning, got: ${messages}`);
      assert.ok(!/'count'/.test(messages), `count should not be flagged: ${messages}`);
    });
  });
});
