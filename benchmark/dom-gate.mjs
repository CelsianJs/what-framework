#!/usr/bin/env node

// What Framework - DOM benchmark, gate-comparable output.
// Wraps the krausest harness and emits gate-comparable timings so
// check-regressions.js can guard real DOM operations, not just Node micro-ops.
//
// Aggregate: the 25th percentile of every measured sample, pooled across
// rounds. Chromium's frame scheduling contaminates this harness in one
// direction only (a sample can be a frame late, never early), so the low end of
// the distribution is the stable end. Measured across three independent
// 20-round probes, the pooled p25 moved at most 2.4% between probes where the
// median of round medians moved 6.2%, and it is insensitive to the round count
// (identical at 5, 10 and 20 rounds), so a short CI run and a long recording
// run are comparable.
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

function count(name, fallback) {
  const value = Number(flag(name, fallback));
  if (!Number.isInteger(value) || value < 1) {
    console.error(`Invalid ${name} "${flag(name, fallback)}": expected a whole number of at least 1, e.g. ${name} ${fallback}.`);
    process.exit(1);
  }
  return value;
}

const ROUNDS = count('--rounds', 3);
const SAMPLES = count('--samples', 10);

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

function p25(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(0.25 * s.length))];
}

const rounds = [];
for (let i = 0; i < ROUNDS; i++) {
  process.stdout.write(`round ${i + 1}/${ROUNDS}`);
  const round = await runWhat({ samples: SAMPLES });
  rounds.push(round);
  process.stdout.write(` ${OPS.map((op) => `${GATE_NAMES[op.id]}:${p25(round[op.id].samples)}`).join(' ')}\n`);
}

const results = OPS.map((op) => {
  const perRound = rounds.map((r) => p25(r[op.id].samples));
  return {
    name: GATE_NAMES[op.id],
    label: op.label,
    ms: +p25(rounds.flatMap((r) => r[op.id].samples)).toFixed(2),
    // How far the same aggregate moved from round to round, as provenance for
    // whether the machine was quiet enough to record a baseline from.
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
  aggregate: 'p25 of pooled samples',
  lowerIsBetter: true,
  // Deltas below this are inside the harness's own resolution, so the gate does
  // not fail on them however large the percentage looks. The pooled p25 moves
  // by at most about 0.2 ms between runs on the sub-frame ops.
  noiseFloorMs: 0.5,
  results,
};

writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
console.log(`DOM benchmark written to ${outPath}`);
