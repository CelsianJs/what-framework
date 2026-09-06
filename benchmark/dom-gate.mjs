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
// Those initial probes do not establish equivalence across browser/toolchain
// versions or machine conditions; retain provenance and samples to check it.
//
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
// Chromium. Raw samples retain the harness's existing two-decimal precision.
export function createDomReport(runs, provenance = {}) {
  if (!runs.length) throw new Error('DOM report requires at least one round.');
  const rounds = runs.map((run) => run.results.what);
  const results = OPS.map((op) => {
    const samples = rounds.map((round, i) => {
      const values = round[op.id]?.samples;
      if (!Array.isArray(values) || !values.length || values.some((v) => !Number.isFinite(v) || v < 0)) {
        throw new Error(`Invalid ${GATE_NAMES[op.id]} samples in round ${i + 1}.`);
      }
      return [...values];
    });
    const perRound = samples.map(p25);
    return {
      name: GATE_NAMES[op.id],
      label: op.label,
      ms: +p25(samples.flat()).toFixed(2),
      // Range of round p25 values, NOT a standard deviation/confidence interval.
      spread: +(Math.max(...perRound) - Math.min(...perRound)).toFixed(2),
      sampleCount: samples.reduce((sum, values) => sum + values.length, 0),
      sampleCounts: samples.map((values) => values.length),
      samples,
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
    aggregate: 'p25 of pooled samples',
    lowerIsBetter: true,
    // Keep the recorded floor and the gate's comparison unchanged.
    noiseFloorMs: 0.5,
    results,
  };
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
  const runs = [];
  for (let i = 0; i < ROUNDS; i++) {
    process.stdout.write(`round ${i + 1}/${ROUNDS}`);
    const run = await runFrameworks(['what'], { samples: SAMPLES, provenance: true });
    runs.push(run);
    process.stdout.write(` ${OPS.map((op) => `${GATE_NAMES[op.id]}:${p25(run.results.what[op.id].samples)}`).join(' ')}\n`);
  }
  const report = createDomReport(runs, { toolchain, buildPerformed });
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`DOM benchmark written to ${outPath}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
