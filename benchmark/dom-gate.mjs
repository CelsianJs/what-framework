#!/usr/bin/env node

// What Framework - DOM benchmark, gate-comparable output.
// Wraps the krausest harness and emits median-of-rounds timings so
// check-regressions.js can guard real DOM operations, not just Node micro-ops.
//
// Runs `what` only (the competitor implementations exist for the published
// comparison, not for the gate). Numbers are ms, lower is better.
//
// Usage:  node benchmark/dom-gate.mjs --out <file.json> [--rounds N] [--samples N] [--no-build]

import os from 'node:os';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const krausest = path.join(here, 'krausest');

function flag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

const outPath = flag('--out', null);
if (!outPath) {
  console.error('Usage: node benchmark/dom-gate.mjs --out <file.json>');
  process.exit(1);
}

const ROUNDS = Number(flag('--rounds', 3));
const SAMPLES = Number(flag('--samples', 10));

// bench.mjs op ids -> the names the regression gate guards.
const GATE_NAMES = {
  create1k: 'create1k',
  replace1k: 'replace1k',
  update10th: 'partialUpdate',
  select: 'selectRow',
  swap: 'swapRows',
  remove: 'removeRow',
  create10k: 'create10k',
  append1k: 'append1k',
  clear1k: 'clear1k',
};

if (!process.argv.includes('--no-build')) {
  console.log('Building the what implementation from the working tree...');
  execFileSync('node', ['build-all.mjs', 'what'], { cwd: krausest, stdio: 'inherit' });
}

const { runWhat, OPS } = await import(path.join(krausest, 'bench.mjs'));

const rounds = [];
for (let i = 0; i < ROUNDS; i++) {
  process.stdout.write(`round ${i + 1}/${ROUNDS}`);
  const round = await runWhat({ samples: SAMPLES });
  rounds.push(round);
  process.stdout.write(` ${OPS.map((op) => `${GATE_NAMES[op.id]}:${round[op.id].median}`).join(' ')}\n`);
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const results = OPS.map((op) => {
  const perRound = rounds.map((r) => r[op.id].median);
  return {
    name: GATE_NAMES[op.id],
    label: op.label,
    ms: +median(perRound).toFixed(2),
    rounds: perRound,
    spread: +(Math.max(...perRound) - Math.min(...perRound)).toFixed(2),
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: os.platform(),
  rounds: ROUNDS,
  samplesPerRound: SAMPLES,
  metric: 'ms',
  lowerIsBetter: true,
  noiseFloorMs: 2,
  results,
};

writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(`DOM benchmark written to ${outPath}`);
