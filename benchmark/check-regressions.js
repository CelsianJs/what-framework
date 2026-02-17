#!/usr/bin/env node

// What Framework - Benchmark regression gate

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();
const BASELINE_DIR = join(ROOT, 'benchmark', 'baseline');
const CORE_BASELINE = join(BASELINE_DIR, 'core.json');
const DX_BASELINE = join(BASELINE_DIR, 'dx.json');

const coreTolerance = Number(process.env.WHAT_BENCH_TOLERANCE_CORE ?? '0.2');
const dxTolerance = Number(process.env.WHAT_BENCH_TOLERANCE_DX ?? '0.25');

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

if (!existsSync(CORE_BASELINE) || !existsSync(DX_BASELINE)) {
  console.error('Missing benchmark baseline files in benchmark/baseline.');
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), 'what-bench-'));
const coreOut = join(tmp, 'core.json');
const dxOut = join(tmp, 'dx.json');
const coreOutRetry = join(tmp, 'core-retry.json');
const dxOutRetry = join(tmp, 'dx-retry.json');

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function toMap(report) {
  const map = new Map();
  for (const row of report.results || []) map.set(row.name, row);
  return map;
}

function compareSet(name, baselinePath, currentPath, tolerance, guardOps) {
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

    const minAllowed = base.opsPerSec * (1 - tolerance);
    if (now.opsPerSec < minAllowed) {
      const delta = (((now.opsPerSec - base.opsPerSec) / base.opsPerSec) * 100).toFixed(1);
      failures.push(`${name}: ${benchName} regressed ${delta}% (${now.opsPerSec} < ${Math.round(minAllowed)} ops/s threshold)`);
    }
  }

  return failures;
}

function compareRun(corePath, dxPath) {
  return [
    ...compareSet('core', CORE_BASELINE, corePath, coreTolerance, CORE_GUARD_OPS),
    ...compareSet('dx', DX_BASELINE, dxPath, dxTolerance, DX_GUARD_OPS),
  ];
}

try {
  console.log('\nRunning core benchmark...');
  execSync(`node benchmark/run.js --json "${coreOut}"`, { stdio: 'inherit' });

  console.log('Running DX microbenchmark...');
  execSync(`node benchmark/dx-microbench.js --json "${dxOut}"`, { stdio: 'inherit' });

  let failures = compareRun(coreOut, dxOut);

  if (failures.length > 0) {
    console.warn('\nPotential benchmark regression detected. Re-running once to reduce noise...');

    console.log('\nRe-running core benchmark...');
    execSync(`node benchmark/run.js --json "${coreOutRetry}"`, { stdio: 'inherit' });

    console.log('Re-running DX microbenchmark...');
    execSync(`node benchmark/dx-microbench.js --json "${dxOutRetry}"`, { stdio: 'inherit' });

    const retryFailures = compareRun(coreOutRetry, dxOutRetry);
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
