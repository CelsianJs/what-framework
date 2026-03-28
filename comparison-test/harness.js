#!/usr/bin/env node
/**
 * WhatFW AI Agent Comparison Test Harness
 *
 * Usage:
 *   node harness.js --scenario counter --agent whatfw-mcp
 *   node harness.js --scenario todo --agent react-baseline
 *   node harness.js --scenario dashboard --agent whatfw-mcp --runs 3
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { runs: 1 };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace('--', '');
    opts[key] = args[i + 1];
  }
  if (opts.runs) opts.runs = parseInt(opts.runs, 10);
  return opts;
}

// Load scenario
function loadScenario(name) {
  const path = join(__dirname, 'scenarios', `${name}.json`);
  if (!existsSync(path)) throw new Error(`Scenario not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// Load agent config
function loadAgent(name) {
  const path = join(__dirname, 'agents', `${name}.json`);
  if (!existsSync(path)) throw new Error(`Agent config not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// Provider interface for LLM API calls
class TokenTracker {
  constructor() {
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.calls = 0;
  }

  track(input, output) {
    this.inputTokens += input;
    this.outputTokens += output;
    this.calls++;
  }

  get total() { return this.inputTokens + this.outputTokens; }
  get summary() {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      totalTokens: this.total,
      apiCalls: this.calls,
    };
  }
}

// Result structure
function createResult(scenario, agent, timing, tokens, scores, iterations, meta = {}) {
  return {
    timestamp: new Date().toISOString(),
    scenario: scenario.name,
    difficulty: scenario.difficulty,
    model: agent.model,
    framework: agent.framework,
    mcpEnabled: agent.mcpEnabled,
    timing,
    tokens: tokens.summary,
    scores,
    totalScore: Object.values(scores).reduce((a, b) => a + b, 0),
    iterations,
    ...meta,
  };
}

// Save results
function saveResults(results, scenarioName, agentName) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = join(__dirname, 'results', timestamp);
  mkdirSync(dir, { recursive: true });

  const filename = `${scenarioName}-${agentName}.json`;
  writeFileSync(join(dir, filename), JSON.stringify(results, null, 2));
  console.log(`Results saved to ${join(dir, filename)}`);
  return dir;
}

// Print comparison table
function printComparison(results) {
  console.log('\n' + '='.repeat(80));
  console.log('COMPARISON RESULTS');
  console.log('='.repeat(80));

  const headers = ['Metric', ...results.map(r => `${r.model}\n${r.framework}${r.mcpEnabled ? '+MCP' : ''}`)];

  console.log('\n| ' + headers.join(' | ') + ' |');
  console.log('|' + headers.map(() => '---').join('|') + '|');

  const metrics = [
    ['Score', r => `${r.totalScore}/16`],
    ['Builds', r => r.scores.builds ? 'Yes' : 'No'],
    ['Runs', r => r.scores.runs ? 'Yes' : 'No'],
    ['Correct', r => `${r.scores.correct}/5`],
    ['Idiomatic', r => `${r.scores.idiomatic}/3`],
    ['Performance', r => `${r.scores.performance}/3`],
    ['Recovery', r => `${r.scores.errorRecovery}/3`],
    ['Time (s)', r => `${Math.round(r.timing.totalMs / 1000)}`],
    ['Tokens', r => r.tokens.totalTokens.toLocaleString()],
    ['API Calls', r => r.tokens.apiCalls],
    ['Iterations', r => r.iterations],
  ];

  for (const [name, fn] of metrics) {
    console.log(`| ${name} | ${results.map(fn).join(' | ')} |`);
  }
  console.log('');
}

// Main
async function main() {
  const opts = parseArgs();

  if (!opts.scenario) {
    console.error('Usage: node harness.js --scenario <name> --agent <config>');
    console.error('Scenarios: counter, todo, dashboard');
    console.error('Agents: whatfw-mcp, react-baseline');
    process.exit(1);
  }

  const scenario = loadScenario(opts.scenario);
  const agent = loadAgent(opts.agent);

  console.log(`\nScenario: ${scenario.name} (difficulty: ${scenario.difficulty})`);
  console.log(`Agent: ${agent.model} + ${agent.framework}${agent.mcpEnabled ? ' + MCP' : ''}`);
  console.log(`Runs: ${opts.runs}\n`);

  const allResults = [];

  for (let run = 1; run <= opts.runs; run++) {
    console.log(`--- Run ${run}/${opts.runs} ---`);
    const startTime = Date.now();
    const tokens = new TokenTracker();

    // TODO: Implement actual LLM agent loop here
    // This is the integration point where we:
    // 1. Spawn the LLM with scenario.prompt + agent.systemPrompt
    // 2. If agent.mcpEnabled, connect MCP tools
    // 3. Let the agent iterate (read files, write code, use MCP tools)
    // 4. Track tokens via provider API response headers
    // 5. Run acceptance tests from scenario.tests
    // 6. Score the result

    const timing = {
      totalMs: Date.now() - startTime,
      firstWorkingMs: null, // Set when first successful build
    };

    // Placeholder scores — replace with actual measurement
    const scores = {
      builds: 0,
      runs: 0,
      correct: 0,
      idiomatic: 0,
      performance: 0,
      errorRecovery: 0,
    };

    const result = createResult(scenario, agent, timing, tokens, scores, 0);
    allResults.push(result);
  }

  // Save and display
  const dir = saveResults(allResults, opts.scenario, opts.agent);

  if (allResults.length > 1) {
    // Report median
    const sorted = [...allResults].sort((a, b) => b.totalScore - a.totalScore);
    console.log(`\nMedian result: ${sorted[Math.floor(sorted.length / 2)].totalScore}/16`);
  }

  printComparison(allResults);
}

main().catch(console.error);
