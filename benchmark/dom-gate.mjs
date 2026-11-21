#!/usr/bin/env node

// What Framework - DOM benchmark, gate-comparable output.
// Wraps the krausest harness and emits gate-comparable timings so
// check-regressions.js can guard real DOM operations, not just Node micro-ops.
//
// Aggregate the 25th percentile of script-only samples pooled across rounds.
// The harness verifies the DOM when click-triggered microtasks have drained.
// Preserve samples and browser provenance alongside the aggregate.

// Runs `what` only (the competitor implementations exist for the published
// comparison, not for the gate). Numbers are ms, lower is better.
//
// Usage:  node benchmark/dom-gate.mjs --out <file.json> [--rounds N] [--samples N] [--no-build]

import os from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { OPS, runFrameworks } from './krausest/bench.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const krausest = path.join(here, 'krausest');
export const DOM_TIMING = 'click-to-microtasks';

function flag(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

function count(name, fallback) {
  const value = Number(flag(name, fallback));
  if (!Number.isInteger(value) || value < 1) {
    console.error(`Invalid ${name} "${flag(name, fallback)}": expected a whole number of at least 1, e.g. ${name} ${fallback}.`);
    process.exit(1);
  }
  return value;
}

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

function p25(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(0.25 * s.length))];
}

// Pure report generation: tests exercise the gate aggregate without launching
// Chromium. Raw samples retain the script metric's three-decimal precision.
export function createDomReport(runs, provenance = {}) {
  if (!runs.length) throw new Error('DOM report requires at least one round.');
  const rounds = runs.map((run) => run.results.what);
  const results = OPS.map((op) => {
    const samples = rounds.map((round, i) => {
      const values = round[op.id]?.script?.samples;
      if (!Array.isArray(values) || !values.length || values.some((v) => !Number.isFinite(v) || v < 0)) {
        throw new Error(`Invalid ${GATE_NAMES[op.id]} samples in round ${i + 1}.`);
      }
      return [...values];
    });
    const perRound = samples.map(p25);
    return {
      name: GATE_NAMES[op.id],
      label: op.label,
      ms: +p25(samples.flat()).toFixed(3),
      // Range of round p25 values, NOT a standard deviation/confidence interval.
      spread: +(Math.max(...perRound) - Math.min(...perRound)).toFixed(3),
      sampleCount: samples.reduce((sum, values) => sum + values.length, 0),
      sampleCounts: samples.map((values) => values.length),
      samples,
      stoppedByFrame: rounds.map((round) => round[op.id].script.stoppedByFrame),
    };
  });

  return {
    ...provenance,
    generatedAt: new Date().toISOString(),
    node: process.version,
    nodeExecutable: process.execPath,
    platform: os.platform(),
    machine: { release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model ?? null, cores: os.cpus().length },
    rounds: rounds.length,
    // An op map replaces the old scalar, which incorrectly claimed that heavy
    // ops used the ordinary sample count. Null means rounds had unequal sizes;
    // each result's sampleCounts always contains the exact per-round counts.
    samplesPerRound: Object.fromEntries(results.map((row) => [row.name,
      row.sampleCounts.every((n) => n === row.sampleCounts[0]) ? row.sampleCounts[0] : null,
    ])),
    browsers: runs.map((run) => run.browser),
    metric: 'ms',
    timing: DOM_TIMING,
    aggregate: 'p25 of pooled samples',
    lowerIsBetter: true,
    // One tick of Chromium's cross-origin isolated performance clock.
    noiseFloorMs: 0.005,
    results,
  };
}

// The machine's 1, 5 and 15 minute load averages: a baseline recorded on a
// busy machine is not one, so the file says what it was recorded under.
export function loadAverage() {
  return os.loadavg().map((n) => +n.toFixed(2));
}

function readToolchain() {
  const require = createRequire(import.meta.url);
  const buildRequire = createRequire(path.join(krausest, 'build-all.mjs'));
  const corePackage = require.resolve('playwright-core/package.json');
  const manifest = JSON.parse(readFileSync(path.join(path.dirname(corePackage), 'browsers.json'), 'utf8'));
  const browser = manifest.browsers.find((entry) => entry.name === 'chromium-headless-shell');
  function buildVersion(name) {
    try { return buildRequire(`${name}/package.json`).version; }
    catch (err) { if (err.code === 'MODULE_NOT_FOUND') return null; throw err; }
  }
  return {
    playwright: require('playwright/package.json').version,
    playwrightCore: require(corePackage).version,
    // Manifest provenance is the expected bundled artifact, not evidence of
    // the launched executable; browsers[] records actual CDP revisions/args.
    expectedChromiumRevision: browser?.revision ?? null,
    expectedChromiumVersion: browser?.browserVersion ?? null,
    vite: buildVersion('vite'),
    esbuild: buildVersion('esbuild'),
    whatCompiler: JSON.parse(readFileSync(path.join(here, '../packages/compiler/package.json'), 'utf8')).version,
  };
}

async function main() {
  const outPath = flag('--out', null);
  if (!outPath) {
    console.error('Usage: node benchmark/dom-gate.mjs --out <file.json>');
    process.exit(1);
  }
  const ROUNDS = count('--rounds', 3);
  const SAMPLES = count('--samples', 10);
  const buildPerformed = !process.argv.includes('--no-build');
  if (buildPerformed) {
    console.log('Building the what implementation from the working tree...');
    execFileSync(process.execPath, ['build-all.mjs', 'what'], { cwd: krausest, stdio: 'inherit' });
  }
  const toolchain = readToolchain();
  const loadAtStart = loadAverage();
  const runs = [];
  for (let i = 0; i < ROUNDS; i++) {
    process.stdout.write(`round ${i + 1}/${ROUNDS}`);
    const run = await runFrameworks(['what'], { samples: SAMPLES, samplesHeavy: Math.min(5, SAMPLES), provenance: true, scriptMetric: true });
    runs.push(run);
    process.stdout.write(` ${OPS.map((op) => `${GATE_NAMES[op.id]}:${p25(run.results.what[op.id].script.samples)}`).join(' ')}\n`);
  }
  const report = createDomReport(runs, { toolchain, buildPerformed, load: { start: loadAtStart, end: loadAverage() } });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`DOM benchmark written to ${outPath}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
