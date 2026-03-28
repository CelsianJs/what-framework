/**
 * Offline MCP Tool Test — what_lint, what_scaffold, what_fix
 *
 * Creates an in-memory MCP server+client, registers agent tools with a
 * dummy bridge (no browser needed), and exercises the offline code-quality
 * tools with intentionally good and bad code samples.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// Dummy bridge — these offline tools don't need a real browser connection
const dummyBridge = {
  isConnected: () => false,
  getSnapshot: () => null,
  getOrRefreshSnapshot: async () => null,
  getEvents: () => [],
  getErrors: () => [],
  sendCommand: async () => ({ error: 'No browser' }),
  saveBaseline: () => false,
  getBaseline: () => null,
};

// --- Setup: MCP server + client in-memory ---
const server = new McpServer({ name: 'test-offline', version: '1.0.0' });

const { registerAgentTools } = await import('../packages/devtools-mcp/src/tools-agent.js');
registerAgentTools(server, dummyBridge);

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);

const client = new Client({ name: 'test-offline-client', version: '1.0.0' });
await client.connect(clientTransport);

// --- Helpers ---
const results = [];
let passed = 0;
let failed = 0;

function parse(result) {
  return JSON.parse(result.content[0].text);
}

function report(name, data, check) {
  const ok = check(data);
  const status = ok ? 'PASS' : 'FAIL';
  if (ok) passed++; else failed++;
  results.push({ name, status, data });
  console.log(`[${status}] ${name}`);
  return data;
}

// =====================================================================
//  TEST 1 — Lint clean code (should find no issues)
// =====================================================================
console.log('\n=== Test 1: Lint clean code ===');
const clean = parse(await client.callTool({ name: 'what_lint', arguments: {
  code: `import { signal, effect } from 'what-framework';
function Counter() {
  const count = signal(0, 'count');
  return <button onclick={() => count(c => c + 1)}>{count()}</button>;
}`
}}));
report('Lint clean code', clean, d => d.issueCount === 0);
console.log('  Summary:', clean.summary);

// =====================================================================
//  TEST 2 — Lint: missing signal read in JSX
// =====================================================================
console.log('\n=== Test 2: Lint buggy code (missing signal read) ===');
const buggy = parse(await client.callTool({ name: 'what_lint', arguments: {
  code: `import { signal } from 'what-framework';
function App() {
  const name = signal('hello', 'name');
  return <span>{name}</span>;
}`
}}));
report('Missing signal read in JSX', buggy,
  d => d.issueCount > 0 && d.issues.some(i => i.code === 'ERR_MISSING_SIGNAL_READ'));
for (const issue of buggy.issues) {
  console.log(`  Line ${issue.line}: [${issue.severity}] ${issue.message}`);
}

// =====================================================================
//  TEST 3 — Lint: effect cycle (reads and writes same signal)
// =====================================================================
console.log('\n=== Test 3: Lint effect cycle ===');
const cycle = parse(await client.callTool({ name: 'what_lint', arguments: {
  code: `import { signal, effect } from 'what-framework';
const count = signal(0);
effect(() => { count(count() + 1); });`
}}));
report('Effect cycle detection', cycle,
  d => d.issues.some(i => i.code === 'ERR_INFINITE_EFFECT'));
for (const issue of cycle.issues) {
  console.log(`  Line ${issue.line}: [${issue.severity}] ${issue.message}`);
}

// =====================================================================
//  TEST 4 — Lint: signal write during render
// =====================================================================
console.log('\n=== Test 4: Lint signal write in render ===');
const renderWrite = parse(await client.callTool({ name: 'what_lint', arguments: {
  code: `import { signal } from 'what-framework';
function BadComponent() {
  const count = signal(0, 'count');
  count(count() + 1);
  return <span>{count()}</span>;
}`
}}));
report('Signal write in render', renderWrite,
  d => d.issues.some(i => i.code === 'ERR_SIGNAL_WRITE_IN_RENDER'));
for (const issue of renderWrite.issues) {
  console.log(`  Line ${issue.line}: [${issue.severity}] ${issue.message}`);
}

// =====================================================================
//  TEST 5 — Lint: missing cleanup in effect
// =====================================================================
console.log('\n=== Test 5: Lint missing cleanup ===');
const noCleanup = parse(await client.callTool({ name: 'what_lint', arguments: {
  code: `import { signal, effect } from 'what-framework';
function Resizer() {
  const width = signal(0, 'width');
  effect(() => { window.addEventListener('resize', () => width(window.innerWidth)); });
  return <span>{width()}</span>;
}`
}}));
report('Missing cleanup in effect', noCleanup,
  d => d.issues.some(i => i.code === 'ERR_MISSING_CLEANUP'));
for (const issue of noCleanup.issues) {
  console.log(`  Line ${issue.line}: [${issue.severity}] ${issue.message}`);
}

// =====================================================================
//  TEST 6 — Lint: innerHTML without __html
// =====================================================================
console.log('\n=== Test 6: Lint innerHTML XSS ===');
const xss = parse(await client.callTool({ name: 'what_lint', arguments: {
  code: `import { signal } from 'what-framework';
function Renderer() {
  const html = signal('<b>hi</b>', 'html');
  return <div innerHTML={html()} />;
}`
}}));
report('innerHTML without __html', xss,
  d => d.issues.some(i => i.code === 'ERR_UNSAFE_INNERHTML'));
for (const issue of xss.issues) {
  console.log(`  Line ${issue.line}: [${issue.severity}] ${issue.message}`);
}

// =====================================================================
//  TEST 7 — Lint: missing key in <For>
// =====================================================================
console.log('\n=== Test 7: Lint missing key in For ===');
const noKey = parse(await client.callTool({ name: 'what_lint', arguments: {
  code: `import { signal } from 'what-framework';
function List() {
  const items = signal([], 'items');
  return <For each={items()}>{item => <li>{item.name}</li>}</For>;
}`
}}));
report('Missing key in <For>', noKey,
  d => d.issues.some(i => i.code === 'ERR_MISSING_KEY'));
for (const issue of noKey.issues) {
  console.log(`  Line ${issue.line}: [${issue.severity}] ${issue.message}`);
}

// =====================================================================
//  TEST 8 — Lint: prefer computed over effect
// =====================================================================
console.log('\n=== Test 8: Lint prefer computed ===');
const preferComputed = parse(await client.callTool({ name: 'what_lint', arguments: {
  code: `import { signal, effect } from 'what-framework';
const count = signal(0, 'count');
const doubled = signal(0, 'doubled');
effect(() => { doubled(count() * 2); });`
}}));
report('Prefer computed over effect', preferComputed,
  d => d.issues.some(i => i.code === 'HINT_PREFER_COMPUTED'));
for (const issue of preferComputed.issues) {
  console.log(`  Line ${issue.line}: [${issue.severity}] ${issue.message}`);
}

// =====================================================================
//  TEST 9 — Lint: rule filter (only run one rule)
// =====================================================================
console.log('\n=== Test 9: Lint with rule filter ===');
const filtered = parse(await client.callTool({ name: 'what_lint', arguments: {
  code: `import { signal } from 'what-framework';
function App() {
  const name = signal('hello', 'name');
  return <span>{name}</span>;
}`,
  rules: ['missing-signal-read'],
}}));
report('Rule filter works', filtered,
  d => d.rulesChecked.length === 1 && d.rulesChecked[0] === 'missing-signal-read' && d.issueCount > 0);
console.log('  Rules checked:', filtered.rulesChecked);

// =====================================================================
//  TEST 10 — Scaffold: component
// =====================================================================
console.log('\n=== Test 10: Scaffold component ===');
const scaffComp = parse(await client.callTool({ name: 'what_scaffold', arguments: {
  type: 'component',
  name: 'UserCard',
  props: ['name', 'email'],
  signals: ['isExpanded'],
}}));
report('Scaffold component', scaffComp,
  d => d.code.includes('function UserCard') && d.code.includes('isExpanded') && d.code.includes('signal('));
console.log('  Summary:', scaffComp.summary);
console.log('  --- Generated code ---');
console.log(scaffComp.code);
console.log('  --- End ---');

// =====================================================================
//  TEST 11 — Scaffold: form
// =====================================================================
console.log('\n=== Test 11: Scaffold form ===');
const scaffForm = parse(await client.callTool({ name: 'what_scaffold', arguments: {
  type: 'form',
  name: 'LoginForm',
  signals: ['email', 'password'],
}}));
report('Scaffold form', scaffForm,
  d => d.code.includes('function LoginForm') && d.code.includes('handleSubmit') && d.code.includes('email'));
console.log('  Summary:', scaffForm.summary);
console.log('  --- Generated code ---');
console.log(scaffForm.code);
console.log('  --- End ---');

// =====================================================================
//  TEST 12 — Scaffold: page
// =====================================================================
console.log('\n=== Test 12: Scaffold page ===');
const scaffPage = parse(await client.callTool({ name: 'what_scaffold', arguments: {
  type: 'page',
  name: 'Dashboard',
  signals: ['data', 'loading'],
}}));
report('Scaffold page', scaffPage,
  d => d.code.includes('function Dashboard') && d.code.includes('onMount'));
console.log('  Summary:', scaffPage.summary);

// =====================================================================
//  TEST 13 — Scaffold: store
// =====================================================================
console.log('\n=== Test 13: Scaffold store ===');
const scaffStore = parse(await client.callTool({ name: 'what_scaffold', arguments: {
  type: 'store',
  name: 'UserStore',
  signals: ['users', 'currentUser'],
}}));
report('Scaffold store', scaffStore,
  d => d.code.includes('createStore') && d.code.includes('users') && d.code.includes('currentUser'));
console.log('  Summary:', scaffStore.summary);

// =====================================================================
//  TEST 14 — Scaffold: island
// =====================================================================
console.log('\n=== Test 14: Scaffold island ===');
const scaffIsland = parse(await client.callTool({ name: 'what_scaffold', arguments: {
  type: 'island',
  name: 'SearchWidget',
  props: ['placeholder'],
  signals: ['query', 'results'],
}}));
report('Scaffold island', scaffIsland,
  d => d.code.includes('function SearchWidget') && d.code.includes('.island = true'));
console.log('  Summary:', scaffIsland.summary);

// =====================================================================
//  TEST 15 — Scaffold: PascalCase enforcement
// =====================================================================
console.log('\n=== Test 15: Scaffold PascalCase check ===');
const badName = parse(await client.callTool({ name: 'what_scaffold', arguments: {
  type: 'component',
  name: 'myWidget',
}}));
report('PascalCase enforcement', badName,
  d => d.error !== undefined);
console.log('  Error:', badName.error || badName.summary);

// =====================================================================
//  TEST 16 — Fix: ERR_INFINITE_EFFECT
// =====================================================================
console.log('\n=== Test 16: Fix ERR_INFINITE_EFFECT ===');
const fix1 = parse(await client.callTool({ name: 'what_fix', arguments: {
  error: 'ERR_INFINITE_EFFECT',
}}));
report('Fix ERR_INFINITE_EFFECT', fix1,
  d => d.found === true && d.diagnosis && d.suggestedFix && d.codeExample);
console.log('  Diagnosis:', fix1.diagnosis);
console.log('  Fix:', fix1.suggestedFix);

// =====================================================================
//  TEST 17 — Fix: ERR_MISSING_SIGNAL_READ
// =====================================================================
console.log('\n=== Test 17: Fix ERR_MISSING_SIGNAL_READ ===');
const fix2 = parse(await client.callTool({ name: 'what_fix', arguments: {
  error: 'ERR_MISSING_SIGNAL_READ',
}}));
report('Fix ERR_MISSING_SIGNAL_READ', fix2,
  d => d.found === true && d.suggestedFix.includes('()'));
console.log('  Diagnosis:', fix2.diagnosis);

// =====================================================================
//  TEST 18 — Fix: ERR_SIGNAL_WRITE_IN_RENDER
// =====================================================================
console.log('\n=== Test 18: Fix ERR_SIGNAL_WRITE_IN_RENDER ===');
const fix3 = parse(await client.callTool({ name: 'what_fix', arguments: {
  error: 'ERR_SIGNAL_WRITE_IN_RENDER',
}}));
report('Fix ERR_SIGNAL_WRITE_IN_RENDER', fix3,
  d => d.found === true);
console.log('  Fix:', fix3.suggestedFix);

// =====================================================================
//  TEST 19 — Fix: ERR_MISSING_CLEANUP
// =====================================================================
console.log('\n=== Test 19: Fix ERR_MISSING_CLEANUP ===');
const fix4 = parse(await client.callTool({ name: 'what_fix', arguments: {
  error: 'ERR_MISSING_CLEANUP',
}}));
report('Fix ERR_MISSING_CLEANUP', fix4,
  d => d.found === true && d.codeExample.includes('return'));
console.log('  Fix:', fix4.suggestedFix);

// =====================================================================
//  TEST 20 — Fix: unknown error code
// =====================================================================
console.log('\n=== Test 20: Fix unknown error code ===');
const fixUnknown = parse(await client.callTool({ name: 'what_fix', arguments: {
  error: 'ERR_TOTALLY_MADE_UP',
}}));
report('Fix unknown error code', fixUnknown,
  d => d.found === false);
console.log('  Response:', fixUnknown.summary || fixUnknown.message);

// =====================================================================
//  TEST 21 — Fix: HINT_PREFER_COMPUTED
// =====================================================================
console.log('\n=== Test 21: Fix HINT_PREFER_COMPUTED ===');
const fix5 = parse(await client.callTool({ name: 'what_fix', arguments: {
  error: 'HINT_PREFER_COMPUTED',
}}));
report('Fix HINT_PREFER_COMPUTED', fix5,
  d => d.found === true && d.codeExample.includes('computed'));
console.log('  Fix:', fix5.suggestedFix);

// =====================================================================
//  SUMMARY
// =====================================================================
console.log('\n' + '='.repeat(60));
console.log(`  RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\nFailed tests:');
  for (const r of results) {
    if (r.status === 'FAIL') {
      console.log(`  - ${r.name}`);
      if (r.data.issues) {
        console.log(`    Issues found: ${r.data.issues.length}`);
        for (const i of r.data.issues) {
          console.log(`      ${i.code}: ${i.message}`);
        }
      }
      if (r.data.error) {
        console.log(`    Error: ${r.data.error}`);
      }
    }
  }
}

console.log('\nAll offline tool tests complete.');
process.exit(failed > 0 ? 1 : 0);
