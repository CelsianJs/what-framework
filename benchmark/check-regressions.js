#!/usr/bin/env node

// What Framework - Benchmark regression gate

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const BASELINE_DIR = join(ROOT, 'benchmark', 'baseline');
const CORE_BASELINE = join(BASELINE_DIR, 'core.json');
const DX_BASELINE = join(BASELINE_DIR, 'dx.json');
const DOM_BASELINE = process.env.WHAT_BENCH_DOM_BASELINE || join(BASELINE_DIR, 'dom.json');

// A gate that cannot read its own configuration must never report success.
function envNumber(name, fallback, { integer = false, min = 0 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  const ok = Number.isFinite(value) && value >= min && (!integer || Number.isInteger(value));
  if (!ok) {
    console.error(`Invalid ${name}="${raw}".`);
    console.error(`  Fix: set it to ${integer ? 'a whole number' : 'a number'} of at least ${min}, or unset it to use the default (${fallback}).`);
    console.error(`  Example: ${name}=${fallback} npm run bench:gate`);
    process.exit(1);
  }
  return value;
}

const coreTolerance = envNumber('WHAT_BENCH_TOLERANCE_CORE', 0.1);
const dxTolerance = envNumber('WHAT_BENCH_TOLERANCE_DX', 0.15);
const domTolerance = envNumber('WHAT_BENCH_TOLERANCE_DOM', 0.1);

// The DOM aggregate is insensitive to the round count, so this trades runtime
// for sample count only. 21 rounds is about 4 minutes.
const domRounds = envNumber('WHAT_BENCH_DOM_ROUNDS', 21, { integer: true, min: 1 });

// Core noise is one-sided: a descheduled process can only report fewer ops per
// second, never more, so the best of N runs is the estimator, not the last one.
const CORE_RUNS = 3;

// The DOM stage needs a Chromium and the krausest workspace's own install.
// CI's bench-gate job provisions both; a job that does not can set this.
// release:verify never sets it.
const skipDom = process.env.WHAT_BENCH_SKIP_DOM === '1';

// Guard only stable, release-critical operations.
// Extremely fast micro-ops can vary significantly between runs.
const CORE_GUARD_OPS = new Set([
  'signal() write (1 subscriber)',
  'signal() write (10 subscribers)',
  'batch() 100 writes, 1 effect',
  'batch() 10 signals, 10 writes each',
  'h() list of 100 items',
  'renderToString() list of 100',
]);

const DX_GUARD_OPS = new Set([
  'event prop normalize (onClick)',
  'event prop normalize (onclick)',
  'innerHTML patch path',
  'dangerouslySetInnerHTML patch path',
  'formState.errors getter read',
]);

const DOM_GUARD_OPS = new Set([
  'create1k',
  'replace1k',
  'partialUpdate',
  'selectRow',
  'swapRows',
  'removeRow',
  'create10k',
  'append1k',
  'clear1k',
]);

if (!existsSync(CORE_BASELINE) || !existsSync(DX_BASELINE) || (!skipDom && !existsSync(DOM_BASELINE))) {
  console.error('Missing benchmark baseline files in benchmark/baseline.');
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'what-bench-'));
const coreOut = join(tmp, 'core.json');
const dxOut = join(tmp, 'dx.json');
const domOut = join(tmp, 'dom.json');
const coreOutRetry = join(tmp, 'core-retry.json');
const dxOutRetry = join(tmp, 'dx-retry.json');
const domOutRetry = join(tmp, 'dom-retry.json');

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function toMap(report) {
  const map = new Map();
  for (const row of report.results || []) map.set(row.name, row);
  return map;
}

// The double-rAF timing floor makes a small absolute delta indistinguishable
// from browser noise, so a DOM op is only failed on absolute movement as well
// as percentage. The baseline records the floor it was measured with.
const domNoiseFloorMs = skipDom ? 0 : Number(loadJson(DOM_BASELINE).noiseFloorMs);
if (!Number.isFinite(domNoiseFloorMs)) {
  console.error(`Invalid noiseFloorMs in ${DOM_BASELINE}: ${JSON.stringify(loadJson(DOM_BASELINE).noiseFloorMs)}.`);
  console.error('  Fix: re-record the baseline so it carries the floor it was measured with.');
  console.error('  Example: npm run bench:dom');
  process.exit(1);
}

function compareSet(name, baselinePath, currentPath, tolerance, guardOps, metric = 'opsPerSec') {
  const baseline = toMap(loadJson(baselinePath));
  const current = toMap(loadJson(currentPath));
  const failures = [];

  for (const [benchName, base] of baseline.entries()) {
    if (guardOps && !guardOps.has(benchName)) continue;

    const now = current.get(benchName);
    if (!now) {
      failures.push(`${name}: missing benchmark "${benchName}" in current run`);
      continue;
    }

    if (metric === 'ms') {
      if (!Number.isFinite(now.ms)) {
        failures.push(`${name}: ${benchName} produced no measurement (${JSON.stringify(now.ms)} ms)`);
        continue;
      }
      const maxAllowed = base.ms * (1 + tolerance);
      if (now.ms > maxAllowed && now.ms - base.ms > domNoiseFloorMs) {
        const delta = (((now.ms - base.ms) / base.ms) * 100).toFixed(1);
        failures.push(`${name}: ${benchName} regressed +${delta}% (${now.ms} ms > ${maxAllowed.toFixed(2)} ms threshold)`);
      }
      continue;
    }

    const minAllowed = base.opsPerSec * (1 - tolerance);
    if (now.opsPerSec < minAllowed) {
      const delta = (((now.opsPerSec - base.opsPerSec) / base.opsPerSec) * 100).toFixed(1);
      failures.push(`${name}: ${benchName} regressed ${delta}% (${now.opsPerSec} < ${Math.round(minAllowed)} ops/s threshold)`);
    }
  }

  return failures;
}

// Run the core suite CORE_RUNS times and keep each op's best result.
function runCoreBestOf(outPath) {
  const runs = [];
  for (let i = 0; i < CORE_RUNS; i++) {
    const partPath = `${outPath}.${i}`;
    execFileSync('node', ['benchmark/run.js', '--json', partPath], { stdio: 'inherit' });
    runs.push(loadJson(partPath));
  }

  const best = runs[0];
  const rest = runs.slice(1).map(toMap);
  for (const row of best.results || []) {
    for (const other of rest) {
      const alt = other.get(row.name);
      if (alt && alt.opsPerSec > row.opsPerSec) row.opsPerSec = alt.opsPerSec;
    }
  }

  writeFileSync(outPath, JSON.stringify(best, null, 2) + '\n');
}

function compareRun(corePath, dxPath, domPath) {
  return [
    ...compareSet('core', CORE_BASELINE, corePath, coreTolerance, CORE_GUARD_OPS),
    ...compareSet('dx', DX_BASELINE, dxPath, dxTolerance, DX_GUARD_OPS),
    ...(skipDom ? [] : compareSet('dom', DOM_BASELINE, domPath, domTolerance, DOM_GUARD_OPS, 'ms')),
  ];
}

try {
  console.log(`\nRunning core benchmark (best of ${CORE_RUNS})...`);
  runCoreBestOf(coreOut);

  console.log('Running DX microbenchmark...');
  execFileSync('node', ['benchmark/dx-microbench.js', '--json', dxOut], { stdio: 'inherit' });

  if (skipDom) {
    console.log('Skipping DOM benchmark (WHAT_BENCH_SKIP_DOM=1).');
  } else {
    console.log('Running DOM benchmark...');
    execFileSync('node', ['benchmark/dom-gate.mjs', '--out', domOut, '--rounds', String(domRounds)], { stdio: 'inherit' });
  }

  let failures = compareRun(coreOut, dxOut, domOut);

  if (failures.length > 0) {
    console.warn('\nPotential benchmark regression detected. Re-running once to reduce noise...');

    console.log(`\nRe-running core benchmark (best of ${CORE_RUNS})...`);
    runCoreBestOf(coreOutRetry);

    console.log('Re-running DX microbenchmark...');
    execFileSync('node', ['benchmark/dx-microbench.js', '--json', dxOutRetry], { stdio: 'inherit' });

    if (!skipDom) {
      console.log('Re-running DOM benchmark...');
      execFileSync('node', ['benchmark/dom-gate.mjs', '--out', domOutRetry, '--rounds', String(domRounds), '--no-build'], { stdio: 'inherit' });
    }

    const retryFailures = compareRun(coreOutRetry, dxOutRetry, domOutRetry);
    if (retryFailures.length > 0) {
      console.error('\nBenchmark regression check failed:');
      for (const failure of retryFailures) console.error(`  - ${failure}`);
      process.exit(1);
    }

    console.log('\nBenchmark regression check passed on retry (initial run was likely noisy).');
    process.exit(0);
  }

  console.log('\nBenchmark regression check passed.');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
