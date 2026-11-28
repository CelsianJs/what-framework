#!/usr/bin/env node

// What Framework - Benchmark regression gate

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DOM_TIMING, domThreshold, loadAverage } from './dom-gate.mjs';
import { compareInterleaved, persistentFailures, referenceTree, runInterleaved } from './ab.mjs';

const ROOT = process.cwd();
const BASELINE_DIR = join(ROOT, 'benchmark', 'baseline');
const CORE_BASELINE = join(BASELINE_DIR, 'core.json');
const DX_BASELINE = join(BASELINE_DIR, 'dx.json');
const DOM_BASELINE = process.env.WHAT_BENCH_DOM_BASELINE || join(BASELINE_DIR, 'dom.json');
// The commit the core and DX suites are measured against (benchmark/ab.mjs).
const REFERENCE_FILE = join(ROOT, 'benchmark', 'reference.json');
const AB_SCRIPTS = ['benchmark/run.js', 'benchmark/dx-microbench.js'];

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

// Core and DX: how far below the reference build, as the median of the
// paired ratios, an operation may land. Interleaving takes the machine's
// drift out of the ratio, so a real 10% regression lands near 90% and these
// floors stand clear of the paired noise (measured: W5-FIX7's report).
const coreTolerance = envNumber('WHAT_BENCH_TOLERANCE_CORE', 0.05);
const dxTolerance = envNumber('WHAT_BENCH_TOLERANCE_DX', 0.05);
// The 95th-percentile call's floor (ab.mjs MEASURES): the tail of a
// microsecond operation moves more between runs than its middle does.
const tailTolerance = envNumber('WHAT_BENCH_TOLERANCE_TAIL', 0.25);
// The 99th-percentile call's floor: wide, for a call several times slower.
const farTolerance = envNumber('WHAT_BENCH_TOLERANCE_P99', 0.6);
const domTolerance = envNumber('WHAT_BENCH_TOLERANCE_DOM', 0.1);
// Reference/current pairs per suite.
const PAIRS = envNumber('WHAT_BENCH_PAIRS', 9, { integer: true, min: 3 });

// More rounds give the pooled script percentile more samples at the cost of runtime.
const domRounds = envNumber('WHAT_BENCH_DOM_ROUNDS', 21, { integer: true, min: 1 });

// Core noise is one-sided: a descheduled process can only report fewer ops per
// second, never more, so the best of N runs is the estimator, not the last one.
//
// N=3 was too few to estimate that maximum. Sampling `batch() 100 writes,
// 1 effect` 16 times on an idle M3 Max (2026-08-25) produced 510k-769k ops/s
// for byte-identical code — a one-sided band of about ±13% around the median,
// with its 678k threshold sitting in the upper third of it. Best-of-3 therefore
// cleared the threshold on some invocations and missed it on others, and a gate
// decided by scheduling luck is not measuring the code. Raising N tightens the
// estimator; it does not lower the bar, which is still the recorded baseline.
const CORE_RUNS = envNumber('WHAT_BENCH_CORE_RUNS', 6, { integer: true, min: 1 });

// The DX suite has the same one-sided noise and was previously measured once
// per attempt, so a single descheduled run failed the gate on its own.
const DX_RUNS = envNumber('WHAT_BENCH_DX_RUNS', 6, { integer: true, min: 1 });

// The DOM stage needs a Chromium and the krausest workspace's own install.
// CI's bench-gate job provisions both; a job that does not can set this.
// release:verify never sets it.
const skipDom = process.env.WHAT_BENCH_SKIP_DOM === '1';

// Re-record the core and DX baselines instead of checking against them.
const RECORD = process.argv.includes('--record');

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

if (!RECORD && ((!skipDom && !existsSync(DOM_BASELINE)) || !existsSync(REFERENCE_FILE))) {
  console.error('Missing benchmark/baseline/dom.json or benchmark/reference.json.');
  console.error('  Fix: restore them from git (npm run bench:dom re-records the DOM baseline).');
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'what-bench-'));
const coreOut = join(tmp, 'core.json');
const dxOut = join(tmp, 'dx.json');
const domOut = join(tmp, 'dom.json');
const domOutRetry = join(tmp, 'dom-retry.json');

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function toMap(report) {
  const map = new Map();
  for (const row of report.results || []) map.set(row.name, row);
  return map;
}

const domBaseline = (skipDom || RECORD) ? null : loadJson(DOM_BASELINE);
const domNoiseFloorMs = domBaseline?.noiseFloorMs ?? 0;
if (domBaseline && (
  domBaseline.timing !== DOM_TIMING
  || !Number.isFinite(domBaseline.noiseFloorMs) || domBaseline.noiseFloorMs < 0
  || !Array.isArray(domBaseline.results)
  || [...DOM_GUARD_OPS].some((op) => !domBaseline.results.some((row) =>
    row.name === op && Number.isFinite(row.ms) && row.ms > 0))
)) {
  console.error(`Invalid script-only DOM baseline in ${DOM_BASELINE}. Re-record with npm run bench:dom.`);
  rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
}

// The DOM suite against its recorded baseline (script ms, lower is better).
function compareDomSet(currentPath) {
  const baseline = toMap(domBaseline);
  const report = loadJson(currentPath);
  if (report.timing !== domBaseline.timing) {
    return [`dom: timing metric ${report.timing} does not match baseline ${domBaseline.timing}`];
  }
  const current = toMap(report);
  const failures = [];
  for (const [benchName, base] of baseline.entries()) {
    if (!DOM_GUARD_OPS.has(benchName)) continue;
    const now = current.get(benchName);
    if (!now) {
      failures.push(`dom: missing benchmark "${benchName}" in current run`);
      continue;
    }
    if (!Number.isFinite(now.ms)) {
      failures.push(`dom: ${benchName} produced no measurement (${JSON.stringify(now.ms)} ms)`);
      continue;
    }
    const maxAllowed = domThreshold(base, domTolerance, domNoiseFloorMs);
    if (now.ms > maxAllowed) {
      const delta = (((now.ms - base.ms) / base.ms) * 100).toFixed(1);
      failures.push(`dom: ${benchName} regressed +${delta}% (${now.ms} ms > ${maxAllowed.toFixed(3)} ms threshold)`);
    }
  }
  return failures;
}

// Run an ops/sec suite `runs` times and keep each op's best result.
//
// Both the gate and `--record` go through this, which is the point: a baseline
// recorded as a single draw from a one-sided noisy distribution and then
// compared against a best-of-N draw is not comparing like with like. Whichever
// estimator is used, both sides must use the same one, or the tolerance means
// something different from what it says.
function runBestOf(script, outPath, runs) {
  const reports = [];
  for (let i = 0; i < runs; i++) {
    const partPath = `${outPath}.${i}`;
    execFileSync('node', [script, '--json', partPath], { stdio: 'inherit' });
    reports.push(loadJson(partPath));
  }

  const best = reports[0];
  const rest = reports.slice(1).map(toMap);
  for (const row of best.results || []) {
    for (const other of rest) {
      const alt = other.get(row.name);
      if (alt && alt.opsPerSec > row.opsPerSec) row.opsPerSec = alt.opsPerSec;
    }
  }

  writeFileSync(outPath, JSON.stringify(best, null, 2) + '\n');
}

const runCoreBestOf = (outPath) => runBestOf('benchmark/run.js', outPath, CORE_RUNS);
const runDxBestOf = (outPath) => runBestOf('benchmark/dx-microbench.js', outPath, DX_RUNS);

// The core and DX suites against the reference build, `PAIRS` interleaved
// pairs each; prints each guarded operation's median ratio and range.
function runAB(referenceDir, tag) {
  const failures = [];
  for (const [name, script, tolerance, guard] of [
    ['core', 'benchmark/run.js', coreTolerance, CORE_GUARD_OPS],
    ['dx', 'benchmark/dx-microbench.js', dxTolerance, DX_GUARD_OPS],
  ]) {
    console.log(`Running ${name} benchmark: ${PAIRS} pairs against the reference build...`);
    const outDir = join(tmp, `${name}-${tag}`);
    mkdirSync(outDir);
    const { reference, current } = runInterleaved({ script, pairs: PAIRS, referenceDir, currentDir: ROOT, outDir });
    const result = compareInterleaved(name, reference, current, tolerance, guard, tailTolerance, farTolerance);
    for (const row of result.rows) {
      console.log(row.note
        ? `  ${name}: ${row.op}: ${row.note}`
        : `  ${name}: ${row.op}: ${row.measures.map((m) => `${m.measure} ${(m.median * 100).toFixed(1)}% (${(m.low * 100).toFixed(1)}-${(m.high * 100).toFixed(1)}%)`).join(', ')} of the reference`);
    }
    failures.push(...result.failures);
  }
  return failures;
}

function compareDom(domPath) {
  return skipDom ? [] : compareDomSet(domPath);
}

// `--record` regenerates the core and DX baselines with the gate's own
// estimator. Recording and gating share runBestOf by construction, so a
// baseline can no longer be a lucky single draw that silently eats the whole
// tolerance. Only run it on a quiet machine, and only when you have separately
// established there is no regression to enshrine.
//
// The DOM baseline is not recorded here: it is a `ms` metric produced by
// dom-gate.mjs with its own round count and noise floor.
if (RECORD) {
  try {
    // The reference build the gate measures core and DX against moves to
    // this commit: record only when the change in performance is intended.
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const reference = loadJson(REFERENCE_FILE);
    console.log(`Reference build: ${reference.commit} -> ${head}`);
    writeFileSync(REFERENCE_FILE, JSON.stringify({ ...reference, commit: head }, null, 2) + '\n');
    const loadAtStart = loadAverage();
    console.log(`\nRecording core baseline (best of ${CORE_RUNS})...`);
    runCoreBestOf(coreOut);
    console.log(`Recording DX baseline (best of ${DX_RUNS})...`);
    runDxBestOf(dxOut);

    const load = { start: loadAtStart, end: loadAverage() };
    for (const [from, to, label, guard] of [
      [coreOut, CORE_BASELINE, 'core', CORE_GUARD_OPS],
      [dxOut, DX_BASELINE, 'dx', DX_GUARD_OPS],
    ]) {
      const report = loadJson(from);
      report.recordedWith = { estimator: 'best-of-N', runs: label === 'core' ? CORE_RUNS : DX_RUNS, load };

      // Print every guarded threshold's movement before overwriting. A recorder
      // that silently replaces the numbers a gate depends on is a way to make a
      // regression disappear without anyone reading a diff.
      const previous = existsSync(to) ? toMap(loadJson(to)) : new Map();
      console.log(`\n  ${label} guarded ops:`);
      for (const row of report.results || []) {
        if (!guard.has(row.name)) continue;
        const was = previous.get(row.name);
        const delta = was ? ((row.opsPerSec - was.opsPerSec) / was.opsPerSec) * 100 : null;
        const arrow = delta === null ? '(new)' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%`;
        console.log(`    ${row.name}: ${was ? Math.round(was.opsPerSec) : '—'} -> ${Math.round(row.opsPerSec)} ops/s  ${arrow}`);
      }

      writeFileSync(to, JSON.stringify(report, null, 2) + '\n');
      console.log(`  wrote ${to}`);
    }
    console.log('\nBaselines recorded. Commit them with the measurement that justified re-recording.');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(0);
}

let referenceDir = null;
try {
  const reference = process.env.WHAT_BENCH_REFERENCE || loadJson(REFERENCE_FILE).commit;
  console.log(`\nReference build: ${reference} (load ${loadAverage()})`);
  referenceDir = referenceTree(ROOT, reference, AB_SCRIPTS);

  const abFailures = runAB(referenceDir, 'first');

  if (skipDom) {
    console.log('Skipping DOM benchmark (WHAT_BENCH_SKIP_DOM=1).');
  } else {
    console.log('Running DOM benchmark...');
    execFileSync('node', ['benchmark/dom-gate.mjs', '--out', domOut, '--rounds', String(domRounds)], { stdio: 'inherit' });
  }

  const failures = [...abFailures, ...compareDom(domOut)];

  if (failures.length === 0) {
    console.log('\nBenchmark regression check passed.');
  } else {
    console.warn('\nPotential benchmark regression detected. Re-running once to reduce noise...');
    for (const failure of failures) console.warn(`  - ${failure}`);
    const retryAB = runAB(referenceDir, 'retry');

    if (!skipDom) {
      console.log('Re-running DOM benchmark...');
      execFileSync('node', ['benchmark/dom-gate.mjs', '--out', domOutRetry, '--rounds', String(domRounds), '--no-build'], { stdio: 'inherit' });
    }

    // An operation fails the gate only when it fails both attempts: a real
    // regression slows the same operation each time, noise does not.
    const retryFailures = [...retryAB, ...compareDom(domOutRetry)];
    const persistent = persistentFailures(failures, retryFailures);
    if (persistent.length > 0) {
      console.error('\nBenchmark regression check failed (these operations failed both attempts):');
      for (const failure of persistent) console.error(`  - ${failure}`);
      process.exitCode = 1;
    } else {
      if (retryFailures.length > 0) {
        console.warn('\nOn the retry, other operations missed their floor once (noise; each passed the first attempt):');
        for (const failure of retryFailures) console.warn(`  - ${failure}`);
      }
      console.log('\nBenchmark regression check passed on retry: no operation failed both attempts.');
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
  if (referenceDir) rmSync(referenceDir, { recursive: true, force: true });
}
