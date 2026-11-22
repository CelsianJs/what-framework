// Interleaved A/B measurement for the core and DX benchmark gates.
//
// An absolute ops/s threshold recorded on one day measures the machine as much
// as the code: the same commit missed and cleared the same thresholds at the
// same load (round 4: 2f76ba44 and 5c64f0d5 both missed four core thresholds at
// load 3.98, where a run hours earlier passed). So the gate measures the code
// against a reference build of a recorded commit in the same session instead:
// the reference's packages run the current benchmark scripts, the two sides
// alternate (A B, then B A, so a trend in machine state falls on both), and
// each guarded operation is judged by the median of its per-pair ratios. A
// machine that is slow now is slow for both sides.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COMMIT = /^[0-9a-f]{7,40}$/;

/** The median of `values` (sorted copy). */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// What each pair compares, as current against reference (above 1: faster):
// the throughput of the central 80% of calls (opsPerSec, from the trimmed
// mean), the median call, the 95th-percentile call and the 99th. The trimmed
// mean leaves out the slowest tenth of calls, so a change that slows one call
// in twenty passed it at full speed (round 5, B1); the 95th percentile is that
// call. One slowed in fifty passed the 95th too (round 6, COR-09: 1 ms on every
// 50th call of an SSR render, its 99th percentile 25 times the reference's);
// the 99th percentile is that call. The further out in the tail, the noisier
// a measure is, so each tail has a floor of its own, the 99th's wide: it
// catches a call that became several times slower, not a few percent.
const MEASURES = [
  ['throughput', (now, then) => now.opsPerSec / then.opsPerSec, 'opsPerSec'],
  ['median call', (now, then) => then.p50 / now.p50, 'p50'],
  ['95th-percentile call', (now, then) => then.p95 / now.p95, 'p95'],
  ['99th-percentile call', (now, then) => then.p99 / now.p99, 'p99'],
];

/**
 * Each guarded operation of `current` against `reference`, two lists of
 * reports measured in pairs: for each measure (MEASURES) the ratio in each
 * pair, their median and range, and a failure when the median is below its
 * floor: 1 - tolerance for throughput and the median call, 1 - tailTolerance
 * for the 95th-percentile call, 1 - farTolerance for the 99th. An operation
 * the reference does not measure is reported, not judged.
 */
export function compareInterleaved(name, reference, current, tolerance, guardOps, tailTolerance = 0.25, farTolerance = 0.6) {
  const failures = [];
  const rows = [];
  for (const op of guardOps) {
    const ratios = MEASURES.map(() => []);
    let missing = null;
    for (let i = 0; i < current.length; i++) {
      const now = current[i].find((row) => row.name === op);
      const then = reference[i].find((row) => row.name === op);
      if (!now || !Number.isFinite(now.opsPerSec)) {
        missing = 'current';
        continue;
      }
      if (!then || !Number.isFinite(then.opsPerSec)) {
        missing ??= 'reference';
        continue;
      }
      MEASURES.forEach(([, ratio, field], m) => {
        if (Number.isFinite(now[field]) && Number.isFinite(then[field]) && now[field] > 0 && then[field] > 0) ratios[m].push(ratio(now, then));
      });
    }
    if (missing === 'current') {
      failures.push(`${name}: missing benchmark "${op}" in current run`);
      continue;
    }
    if (missing === 'reference') {
      rows.push({ op, note: 'not in the reference build: not compared' });
      continue;
    }
    const measured = MEASURES.map(([measure], m) => ratios[m].length === 0 ? null
      : { measure, median: median(ratios[m]), low: Math.min(...ratios[m]), high: Math.max(...ratios[m]), pairs: ratios[m].length });
    const [throughput] = measured;
    rows.push({ op, ...throughput, measures: measured.filter(Boolean) });
    measured.forEach((row, m) => {
      if (row === null) return;
      const floor = 1 - (m === 3 ? farTolerance : m === 2 ? tailTolerance : tolerance);
      if (row.median < floor) {
        failures.push(`${name}: ${op}: ${row.measure} at ${pct(row.median)} of the reference (median of ${row.pairs} pairs, range ${pct(row.low)} to ${pct(row.high)}; the floor is ${pct(floor)})`);
      }
    });
  }
  return { failures, rows };
}

function pct(ratio) {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * A directory that holds `commit`'s packages and the current benchmark
 * scripts, with node_modules linked to the repository's (the workspace
 * packages to the reference's own). Removed by the caller.
 */
export function referenceTree(root, commit, scripts) {
  if (!COMMIT.test(commit)) throw new Error(`[bench] the reference "${commit}" is not a commit hash (benchmark/reference.json)`);
  const dir = mkdtempSync(join(tmpdir(), 'what-bench-ref-'));
  let archive;
  try {
    archive = execFileSync('git', ['archive', '--format=tar', commit, '--', 'packages'], { cwd: root, maxBuffer: 1 << 30 });
  } catch (error) {
    throw new Error(`[bench] cannot read the reference commit ${commit} (a shallow clone needs fetch-depth: 0)`, { cause: error });
  }
  execFileSync('tar', ['-x', '-C', dir], { input: archive });
  mkdirSync(join(dir, 'benchmark'));
  for (const script of scripts) copyFileSync(join(root, script), join(dir, script));
  const modules = join(root, 'node_modules');
  mkdirSync(join(dir, 'node_modules'));
  for (const entry of readdirSync(modules)) {
    const from = join(modules, entry);
    const workspace = lstatSync(from).isSymbolicLink() && /^\.\.\/packages\//.test(readlinkSync(from));
    const target = workspace ? join(dir, readlinkSync(from).slice(3)) : from;
    if (existsSync(target)) symlinkSync(target, join(dir, 'node_modules', entry));
  }
  return dir;
}

/**
 * `pairs` runs of `script` in each tree, alternating which runs first.
 * Returns the reports' results: { reference: rows[][], current: rows[][] }.
 */
export function runInterleaved({ script, pairs, referenceDir, currentDir, outDir, run = runScript }) {
  const reference = [];
  const current = [];
  for (let i = 0; i < pairs; i++) {
    const order = i % 2 === 0 ? ['reference', 'current'] : ['current', 'reference'];
    for (const side of order) {
      const rows = run(side === 'reference' ? referenceDir : currentDir, script, join(outDir, `${side}-${i}.json`));
      (side === 'reference' ? reference : current).push(rows);
    }
  }
  return { reference, current };
}

function runScript(dir, script, out) {
  execFileSync(process.execPath, [join(dir, script), '--json', out], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  return JSON.parse(readFileSync(out, 'utf8')).results || [];
}
