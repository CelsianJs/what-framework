/**
 * Unit tests for the offline agent tools (what_lint, what_scaffold, what_fix).
 * Uses InMemoryTransport + MCP Client — no WebSocket needed.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ERROR_CODES, IMPORT_CHANGES } from 'what-core/internal';
import { registerAgentTools } from '../src/tools-agent.js';

// The offline tools never touch the bridge.
async function setupMcp(root = tmpdir()) {
  const bridge = null;
  const server = new McpServer({ name: 'test-agent', version: '0.1.0' });
  registerAgentTools(server, bridge, { root });

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
  let client, server;

  afterEach(async () => {
    try { await client?.close(); } catch {}
    try { await server?.close(); } catch {}
  });

  // -----------------------------------------------------------------------
  // what_lint
  // -----------------------------------------------------------------------

  describe('what_lint', () => {
    it('detects missing signal read in JSX', async () => {
      ({ client, server } = await setupMcp());
      const code = `
import { signal } from 'what-framework';
function App() {
  const count = signal(0);
  return <span>{count + 1}</span>;
}`;
      const { parsed } = await callTool(client, 'what_lint', { code });
      assert.ok(parsed.issues.length > 0, 'Should find at least one issue');
      assert.ok(parsed.issues.some(i => i.code === 'ERR_MISSING_SIGNAL_READ'));
    });

    it('detects state stored or sent as data without its value', async () => {
      ({ client, server } = await setupMcp());
      const code = `
import { useState } from 'what-framework';
function Signup() {
  const [name] = useState('');
  const [submitted, setSubmitted] = useState(null);
  const save = () => { setSubmitted({ name }); fetch('/api', { body: JSON.stringify(submitted) }); };
  return <button onClick={save}>Save</button>;
}`;
      const { parsed } = await callTool(client, 'what_lint', { code });
      const found = parsed.issues.filter((i) => i.rule === 'no-uncalled-signals').map((i) => i.message);
      assert.equal(found.length, 2, JSON.stringify(parsed.issues));
      assert.match(found[0], /"name" is What state, a function: the object written to setSubmitted\(\) holds the function/);
      assert.match(found[1], /"submitted" is What state, a function: JSON\.stringify\(\) is given the function/);
      assert.ok(parsed.issues.filter((i) => i.rule === 'no-uncalled-signals').every((i) => i.code === 'ERR_MISSING_SIGNAL_READ'));
    });

    it('detects effect read-write cycle', async () => {
      ({ client, server } = await setupMcp());
      const code = `
import { signal, effect } from 'what-framework';
const count = signal(0);
effect(() => { count(count() + 1); });`;
      const { parsed } = await callTool(client, 'what_lint', { code });
      assert.ok(parsed.issues.some(i => i.code === 'ERR_INFINITE_EFFECT'));
    });

    it('detects missing cleanup in effect', async () => {
      ({ client, server } = await setupMcp());
      const code = `
import { effect } from 'what-framework';
effect(() => { window.addEventListener('resize', handler); });`;
      const { parsed } = await callTool(client, 'what_lint', { code });
      assert.ok(parsed.issues.some(i => i.code === 'ERR_MISSING_CLEANUP'));
    });

    it('detects unsafe innerHTML', async () => {
      ({ client, server } = await setupMcp());
      const code = `<div innerHTML={userInput} />`;
      const { parsed } = await callTool(client, 'what_lint', { code });
      assert.ok(parsed.issues.some(i => i.code === 'ERR_UNSAFE_INNERHTML'));
    });

    it('reports a name that left the root entry with its answer, from the preset', async () => {
      ({ client, server } = await setupMcp());
      const code = "import { signal, useForm, getCollectedErrors } from 'what-framework';\nexport const n = signal(0);\n";
      const { parsed } = await callTool(client, 'what_lint', { code });
      const moved = parsed.issues.filter((i) => i.code === 'ERR_MOVED_IMPORT');
      assert.deepEqual(moved.map((i) => [i.rule, i.severity, i.line]), [['no-moved-imports', 'error', 1], ['no-moved-imports', 'error', 1]]);
      const answers = Object.fromEntries(IMPORT_CHANGES.map((c) => [c.name, c.answer]));
      assert.equal(moved[0].message, `"useForm" is not exported by what-framework. ${answers.useForm}`);
      assert.equal(moved[1].message, `"getCollectedErrors" is not exported by what-framework. ${answers.getCollectedErrors}`);
    });

    it('returns clean for valid code', async () => {
      ({ client, server } = await setupMcp());
      const code = `
import { signal } from 'what-framework';
function App() {
  const count = signal(0);
  return <span>{count()}</span>;
}`;
      const { parsed } = await callTool(client, 'what_lint', { code });
      assert.deepEqual(parsed.issues, []);
      assert.equal(parsed.compiled, true, 'the snippet went through the real compiler');
    });

    it('works with no browser connected', async () => {
      ({ client, server } = await setupMcp());
      const { parsed, isError } = await callTool(client, 'what_lint', { code: 'function App() { return <div>Hi</div>; }' });
      assert.ok(!isError);
      assert.equal(parsed.compiled, true);
    });

    it('uses the project flat config for the requested path', async (t) => {
      const dir = mkdtempSync(join(tmpdir(), 'what-lint-'));
      t.after(() => rmSync(dir, { recursive: true, force: true }));
      writeFileSync(join(dir, 'eslint.config.mjs'), "export default [{ files: ['src/**/*.js'], rules: { 'no-alert': 'error' } }];");
      ({ client, server } = await setupMcp(dir));
      const code = 'alert("test");';
      const inSrc = await callTool(client, 'what_lint', { code, filePath: 'src/example.js' });
      assert.equal(inSrc.parsed.issues[0].rule, 'no-alert');
      const outsideSrc = await callTool(client, 'what_lint', { code, filePath: 'example.js' });
      assert.deepEqual(outsideSrc.parsed.issues, []);
    });

    for (const [code, input] of [
      ['ERR_DUPLICATE_ACTION_ID', "import { action } from 'what-framework/server'; export const a = action(fn, { id: 'save' }); export const b = action(fn, { id: 'save' });"],
      ['ERR_INVALID_HTML_NESTING', 'export const App = () => <p><div>Block</div></p>;'],
      ['ERR_JSX_ISLAND_PROP', 'export const page = <Chart client:idle icon={<b />} />;'],
      ['ERR_UNSAFE_STATIC_MARKUP', 'export const page = <a href="javascript:void(0)">Link</a>;'],
    ]) {
      it(`preserves compiler code ${code}`, async () => {
        ({ client, server } = await setupMcp());
        const { parsed } = await callTool(client, 'what_lint', { code: input });
        assert.equal(parsed.compiled, false);
        assert.ok(parsed.issues.some((i) => i.rule === 'compiler' && i.code === code));
        assert.ok(!parsed.issues.some((i) => i.code === 'PARSE_ERROR'));
      });
    }

    it('reports a parse error from the compiler with its line', async () => {
      ({ client, server } = await setupMcp());
      const { parsed } = await callTool(client, 'what_lint', { code: 'function App() {\n  return <div>;\n}' });
      assert.equal(parsed.compiled, false);
      const parse = parsed.issues.find((i) => i.code === 'PARSE_ERROR');
      assert.ok(parse, JSON.stringify(parsed.issues));
      assert.equal(parse.severity, 'error');
      assert.equal(parse.line, 2);
    });

    it('surfaces the compiler\'s build-time ERR_MISSING_KEY', async () => {
      ({ client, server } = await setupMcp());
      const code = 'function L(props) {\n  return <ul>{props.items.map((i) => <li>{i}</li>)}</ul>;\n}';
      const { parsed } = await callTool(client, 'what_lint', { code, rules: ['no-unsafe-innerhtml'] });
      const missing = parsed.issues.find((i) => i.code === 'ERR_MISSING_KEY' && i.rule === 'compiler');
      assert.ok(missing, JSON.stringify(parsed.issues));
      assert.equal(missing.line, 2);
    });

    it('compile:false runs the lint rules only', async () => {
      ({ client, server } = await setupMcp());
      const { parsed } = await callTool(client, 'what_lint', { code: 'function App( {', compile: false });
      assert.ok(!('compiled' in parsed));
      assert.ok(!parsed.issues.some((i) => i.code === 'PARSE_ERROR'));
    });

    it('filters by specific rules', async () => {
      ({ client, server } = await setupMcp());
      const code = `
import { signal, effect } from 'what-framework';
const count = signal(0);
effect(() => { count(count() + 1); });
<div innerHTML={userInput} />`;
      const { parsed } = await callTool(client, 'what_lint', {
        code,
        rules: ['no-unsafe-innerhtml'],
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
      ({ client, server } = await setupMcp());
      const { parsed } = await callTool(client, 'what_scaffold', {
        type: 'component',
        name: 'UserCard',
        props: ['name', 'email'],
        signals: ['isEditing'],
      });
      assert.ok(parsed.code.includes('export default function UserCard('));
      assert.ok(parsed.code.includes('props.name()') && parsed.code.includes('props.email()'), 'an accessor prop is called where it renders');
      assert.ok(parsed.code.includes("signal(false, 'isEditing')"));
      assert.equal(parsed.type, 'component');
    });

    it('generates a page', async () => {
      ({ client, server } = await setupMcp());
      const { parsed } = await callTool(client, 'what_scaffold', {
        type: 'page',
        name: 'Dashboard',
      });
      assert.ok(parsed.code.includes('function Dashboard'));
      assert.ok(parsed.code.includes('<Head title="Dashboard" />'), 'the documented prop form');
      assert.match(parsed.code, /computed\(async/);
      assert.match(parsed.code, /<Suspense/);
    });

    it('generates a form', async () => {
      ({ client, server } = await setupMcp());
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
      ({ client, server } = await setupMcp());
      const { parsed } = await callTool(client, 'what_scaffold', {
        type: 'store',
        name: 'AppStore',
        signals: ['users', 'loading'],
      });
      assert.ok(parsed.code.includes('createStore'));
      assert.ok(parsed.code.includes('users'));
    });

    it('generates an island', async () => {
      ({ client, server } = await setupMcp());
      const { parsed } = await callTool(client, 'what_scaffold', {
        type: 'island',
        name: 'LiveChat',
      });
      assert.ok(parsed.code.includes('function LiveChat(props)'));
      assert.ok(!parsed.code.includes('.island = true'), 'no marker the framework never reads');
      assert.ok(parsed.code.includes("island('liveChat'"), 'says how to register the island loader');
      assert.ok(parsed.code.includes('data-island'));
    });

    it('rejects non-PascalCase names for components', async () => {
      ({ client, server } = await setupMcp());
      const result = await callTool(client, 'what_scaffold', {
        type: 'component',
        name: 'myComponent',
      });
      assert.ok(result.parsed.error);
      assert.ok(result.parsed.error.includes('PascalCase'));
    });
  });

  // -----------------------------------------------------------------------
  // what_fix
  // -----------------------------------------------------------------------

  describe('what_fix', () => {
    it('finds fix by exact error code, from the shared catalogue', async () => {
      ({ client, server } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fix', { error: 'ERR_INFINITE_EFFECT' });
      assert.equal(parsed.found, true);
      assert.equal(parsed.code, 'ERR_INFINITE_EFFECT');
      assert.equal(parsed.fix, ERROR_CODES.INFINITE_EFFECT.suggestion);
      assert.equal(parsed.example, ERROR_CODES.INFINITE_EFFECT.codeExample);
    });

    it('accepts the code without its ERR_ prefix, in any case', async () => {
      ({ client, server } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fix', { error: 'missing_signal_read' });
      assert.equal(parsed.code, 'ERR_MISSING_SIGNAL_READ');
    });

    it('resolves a pasted message that contains a code', async () => {
      ({ client, server } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fix', {
        error: "[what-compiler] ERR_MISSING_KEY: .map() returning JSX without a `key` prop at src/App.jsx:4:9.",
      });
      assert.equal(parsed.code, 'ERR_MISSING_KEY');
    });

    it('gives the fix for a hydration mismatch of kind attribute', async () => {
      ({ client, server } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fix', { error: 'ERR_HYDRATION_MISMATCH', kind: 'attribute' });
      assert.equal(parsed.found, true);
      assert.equal(parsed.kind, 'attribute');
      assert.match(parsed.fix, /same value on both sides/);
    });

    it('resolves a pasted message by its catalogue template', async () => {
      ({ client, server } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fix', {
        error: '[what-react] useState() called outside of a component render.',
      });
      assert.equal(parsed.found, true);
      assert.equal(parsed.code, 'ERR_HOOK_OUTSIDE_RENDER');
      assert.equal(parsed.matchedBy, 'message');
    });

    it('never routes free text to a guessed code: "render" is not ERR_SIGNAL_WRITE_IN_RENDER', async () => {
      ({ client, server } = await setupMcp());
      for (const text of ['hook called outside render', 'store outside render']) {
        const { parsed } = await callTool(client, 'what_fix', { error: text });
        assert.equal(parsed.found, false, text);
        assert.ok(parsed.closest.length > 0 && parsed.closest.length <= 3, text);
      }
    });

    it('offers the closest codes for free text', async () => {
      ({ client, server } = await setupMcp());
      assert.equal((await callTool(client, 'what_fix', { error: 'infinite loop' })).parsed.closest[0], 'ERR_INFINITE_EFFECT');
      assert.equal((await callTool(client, 'what_fix', { error: 'hydration mismatch' })).parsed.closest[0], 'ERR_HYDRATION_MISMATCH');
    });

    it('returns found:false with no closest codes for unrelated text', async () => {
      ({ client, server } = await setupMcp());
      const { parsed } = await callTool(client, 'what_fix', { error: 'qwerty zxcv' });
      assert.equal(parsed.found, false);
      assert.deepEqual(parsed.closest, []);
    });

    it('covers every catalogue code', async () => {
      ({ client, server } = await setupMcp());
      for (const def of Object.values(ERROR_CODES)) {
        const { parsed } = await callTool(client, 'what_fix', { error: def.code });
        assert.equal(parsed.found, true, `Should find fix for ${def.code}`);
        assert.equal(parsed.code, def.code);
        assert.ok(parsed.fix, `${def.code} should have a fix`);
        assert.ok(parsed.example, `${def.code} should have a worked example`);
      }
    });

    it('has no errorCode alias parameter', async () => {
      ({ client, server } = await setupMcp());
      const result = await client.callTool({ name: 'what_fix', arguments: { errorCode: 'ERR_MISSING_KEY' } });
      assert.equal(result.isError, true);
    });
  });
});
