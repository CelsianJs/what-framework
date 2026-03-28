#!/usr/bin/env node
/**
 * MCP Tool Test Runner
 *
 * Starts the MCP server, connects as a client, calls tools, and reports results.
 * This bypasses Claude Code's MCP plumbing entirely — we connect directly.
 *
 * Usage:
 *   node comparison-test/run-mcp-test.js [--scenario orientation|visual|state|feature]
 *
 * Prerequisites:
 *   - Demo app running: WHAT_MCP_TOKEN=dev123 npx vite --config packages/devtools-mcp/test/demo-app/vite.config.js
 *   - Browser open at http://localhost:3456
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBridge } from '../packages/devtools-mcp/src/bridge.js';
import { registerTools } from '../packages/devtools-mcp/src/tools.js';

const scenario = process.argv.find(a => a.startsWith('--scenario='))?.split('=')[1] ||
                 process.argv[process.argv.indexOf('--scenario') + 1] || 'orientation';

console.log(`\n🧪 MCP Tool Test: ${scenario}\n${'='.repeat(50)}\n`);

// --- Setup: create bridge + MCP server + client ---

const bridgePort = parseInt(process.env.WHAT_MCP_PORT || '9229', 10);
const bridge = createBridge({ port: bridgePort, host: '127.0.0.1' });

const server = new McpServer({ name: 'what-devtools-mcp', version: '0.6.0' });
registerTools(server, bridge);

// Import extended + agent tools
try {
  const { registerExtendedTools } = await import('../packages/devtools-mcp/src/tools-extended.js');
  registerExtendedTools(server, bridge);
} catch (e) { console.warn('Extended tools not loaded:', e.message); }

try {
  const { registerAgentTools } = await import('../packages/devtools-mcp/src/tools-agent.js');
  registerAgentTools(server, bridge);
} catch (e) { console.warn('Agent tools not loaded:', e.message); }

// Connect client to server via in-memory transport
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);

const client = new Client({ name: 'test-runner', version: '1.0.0' });
await client.connect(clientTransport);

// --- Tool call tracking ---

const callLog = [];
let totalTokenEstimate = 0;

async function callTool(name, args = {}) {
  const start = Date.now();
  try {
    const result = await client.callTool({ name, arguments: args });
    const elapsed = Date.now() - start;
    const text = result.content?.map(c => c.text || `[${c.type}]`).join('') || '';
    const tokens = Math.ceil(text.length / 4); // rough estimate
    totalTokenEstimate += tokens;

    callLog.push({ name, args, elapsed, tokens, success: true });
    console.log(`  ✅ ${name}(${JSON.stringify(args)}) — ${elapsed}ms, ~${tokens} tokens`);

    // Parse JSON if possible
    try { return JSON.parse(text); } catch { return text; }
  } catch (e) {
    callLog.push({ name, args, success: false, error: e.message });
    console.log(`  ❌ ${name}(${JSON.stringify(args)}) — ERROR: ${e.message}`);
    return { error: e.message };
  }
}

// --- Wait for browser connection ---

console.log('Waiting for browser connection (5s)...');
await new Promise(r => setTimeout(r, 5000));

// --- Run scenario ---

async function runOrientation() {
  console.log('\n📋 Scenario: Orientation\n');

  const status = await callTool('what_connection_status');
  console.log(`   Connected: ${status.connected}`);
  console.log(`   App: ${status.app?.title || 'unknown'} at ${status.app?.url || 'unknown'}`);

  if (!status.connected) {
    console.log('\n⚠️  Browser not connected. Make sure the demo app is open at http://localhost:3456');
    return;
  }

  const components = await callTool('what_components');
  console.log(`   Components: ${components.count}`);

  const signals = await callTool('what_signals', { named_only: true, limit: 10 });
  console.log(`   Named signals: ${signals.count}`);

  const diagnose = await callTool('what_diagnose');
  console.log(`   Health: ${diagnose.severity}`);
}

async function runVisual() {
  console.log('\n📋 Scenario: Visual Debugging (Stats)\n');

  await callTool('what_connection_status');

  const components = await callTool('what_components', { filter: 'Stats' });
  const statsComp = components.components?.[0];
  if (!statsComp) {
    console.log('   ⚠️  Stats component not found');
    return;
  }
  console.log(`   Stats component ID: ${statsComp.id}`);

  const explain = await callTool('what_explain', { componentId: statsComp.id });
  console.log(`   Signals: ${explain.counts?.signals}, Effects: ${explain.counts?.effects}`);

  const look = await callTool('what_look', { componentId: statsComp.id });
  console.log(`   Layout: ${look.layout}`);
  console.log(`   Dimensions: ${look.boundingRect?.width}x${look.boundingRect?.height}`);

  const signals = await callTool('what_signals', { filter: 'stats' });
  console.log(`   Stats values: ${signals.signals?.[0]?.value ? JSON.stringify(signals.signals[0].value) : 'not found'}`);
}

async function runState() {
  console.log('\n📋 Scenario: State Debugging (Filtering)\n');

  await callTool('what_connection_status');

  // Check current filter state
  const filterSig = await callTool('what_signals', { filter: 'filterStatus' });
  console.log(`   Current filter: ${filterSig.signals?.[0]?.value}`);
  const filterSignalId = filterSig.signals?.[0]?.id;

  // Check dependency graph
  if (filterSignalId) {
    const graph = await callTool('what_dependency_graph', { signalId: filterSignalId, direction: 'downstream' });
    console.log(`   Downstream: ${graph.nodes?.length} nodes, ${graph.edges?.length} edges`);
  }

  // Save baseline
  await callTool('what_diff_snapshot', { action: 'save' });

  // Change filter to 'active'
  if (filterSignalId) {
    await callTool('what_set_signal', { signalId: filterSignalId, value: 'active' });
    console.log('   Set filter to "active"');
  }

  // Check diff
  const diff = await callTool('what_diff_snapshot', { action: 'diff' });
  console.log(`   Changes after filter: ${diff.totalChanges}`);

  // Check filtered tasks
  const filteredSig = await callTool('what_signals', { filter: 'filteredTasks' });
  const filteredCount = Array.isArray(filteredSig.signals?.[0]?.value) ? filteredSig.signals[0].value.length : '?';
  console.log(`   Filtered tasks count: ${filteredCount}`);

  // Reset filter
  if (filterSignalId) {
    await callTool('what_set_signal', { signalId: filterSignalId, value: 'all' });
    console.log('   Reset filter to "all"');
  }
}

async function runPerformance() {
  console.log('\n📋 Scenario: Performance Check\n');

  await callTool('what_connection_status');
  const perf = await callTool('what_perf');
  console.log(`   Memory: ${perf.memoryEstimate}`);
  console.log(`   Hot effects: ${perf.hotEffects?.length || 0}`);
  console.log(`   Event rate: ${perf.eventRate}/sec`);

  const diagnose = await callTool('what_diagnose', { focus: 'performance' });
  console.log(`   Issues: ${diagnose.issues?.length || 0}`);
}

async function runOffline() {
  console.log('\n📋 Scenario: Offline Tools (no browser needed)\n');

  // what_lint — validate good code
  const lintGood = await callTool('what_lint', {
    code: `import { signal, effect, h } from 'what-framework';\nconst count = signal(0, 'count');\neffect(() => console.log(count()));`,
  });
  console.log(`   Lint (good code): ${lintGood.issues?.length || 0} issues`);

  // what_lint — catch bad code
  const lintBad = await callTool('what_lint', {
    code: `import { signal } from 'what-framework';\nfunction Bad() {\n  const x = signal(0);\n  x(5); // write in render\n  return h('div', {}, x());\n}`,
  });
  console.log(`   Lint (bad code): ${lintBad.issues?.length || 0} issues`);

  // what_fix — error code diagnosis
  const fix = await callTool('what_fix', { error: 'ERR_INFINITE_EFFECT' });
  console.log(`   Fix ERR_INFINITE_EFFECT: ${fix.diagnosis ? 'OK' : 'FAILED'}`);

  // what_scaffold — generate component
  const scaffold = await callTool('what_scaffold', { type: 'component', name: 'TestWidget' });
  console.log(`   Scaffold component: ${scaffold.code ? 'OK' : 'FAILED'}`);
}

async function runClaudemdValidation() {
  console.log('\n📋 Scenario: CLAUDE.md Workflow Validation\n');

  // Quick Start workflow: connection -> diagnose -> page_map -> components -> explain -> signals
  const status = await callTool('what_connection_status');
  if (!status.connected) {
    console.log('   ⚠️  Browser not connected — skipping live tool tests');
    console.log('   Running offline validation only...');
    await runOffline();
    return;
  }

  const diagnose = await callTool('what_diagnose');
  console.log(`   Quick Start Step 2 (diagnose): ${diagnose.severity || 'ok'}`);

  const pageMap = await callTool('what_page_map');
  console.log(`   Quick Start Step 3 (page_map): ${pageMap.landmarks?.length || 0} landmarks, ${pageMap.interactives?.length || 0} interactives`);

  const components = await callTool('what_components');
  console.log(`   Quick Start Step 4a (components): ${components.count} mounted`);

  // Find a leaf component (not App)
  const leaf = components.components?.find(c => c.name !== 'App') || components.components?.[0];
  if (leaf) {
    const explain = await callTool('what_explain', { componentId: leaf.id });
    console.log(`   Quick Start Step 4b (explain ${leaf.name}): signals=${explain.counts?.signals}, effects=${explain.counts?.effects}`);
  }

  const signals = await callTool('what_signals', { filter: 'task|theme', named_only: true });
  console.log(`   Quick Start Step 5 (signals): ${signals.count} named signals`);

  // Code Review workflow: diagnose + page_map + signals + perf + dependency_graph
  const perf = await callTool('what_perf');
  console.log(`   Code Review (perf): memory=${perf.memoryEstimate}, hot=${perf.hotEffects?.length || 0}`);

  // Find the main signal and trace it
  const mainSignal = signals.signals?.find(s => s.name === 'tasks');
  if (mainSignal) {
    const graph = await callTool('what_dependency_graph', { signalId: mainSignal.id, direction: 'downstream' });
    console.log(`   Code Review (dep graph): ${graph.nodes?.length} nodes, ${graph.edges?.length} edges`);
  }

  // Before/after workflow
  await callTool('what_diff_snapshot', { action: 'save' });
  console.log(`   Before/after (save): OK`);
}

// Run the selected scenario
switch (scenario) {
  case 'orientation': await runOrientation(); break;
  case 'visual': await runVisual(); break;
  case 'state': await runState(); break;
  case 'performance': await runPerformance(); break;
  case 'offline': await runOffline(); break;
  case 'claudemd': await runClaudemdValidation(); break;
  case 'all':
    await runOrientation();
    await runVisual();
    await runState();
    await runPerformance();
    await runOffline();
    break;
  default:
    console.log(`Unknown scenario: ${scenario}. Use: orientation, visual, state, performance, offline, claudemd, all`);
}

// --- Report ---

console.log(`\n${'='.repeat(50)}`);
console.log('📊 RESULTS\n');
console.log(`Tool calls: ${callLog.length}`);
console.log(`Successful: ${callLog.filter(c => c.success).length}`);
console.log(`Failed: ${callLog.filter(c => !c.success).length}`);
console.log(`Total time: ${callLog.reduce((s, c) => s + (c.elapsed || 0), 0)}ms`);
console.log(`Token estimate: ~${totalTokenEstimate} tokens`);
console.log(`\nCall log:`);
for (const c of callLog) {
  const status = c.success ? '✅' : '❌';
  console.log(`  ${status} ${c.name}(${JSON.stringify(c.args)}) — ${c.elapsed || 0}ms, ~${c.tokens || 0} tok`);
}

// Cleanup
bridge.close();
process.exit(0);
