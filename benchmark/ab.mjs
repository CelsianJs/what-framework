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

/**
 * Each guarded operation of `current` against `reference`, two lists of
 * reports measured in pairs: the ratio of its ops/s in each pair, their
 * median and range, and a failure when the median is below 1 - tolerance.
 * An operation the reference does not measure is reported, not judged.
 */
export function compareInterleaved(name, reference, current, tolerance, guardOps) {
  const failures = [];
  const rows = [];
  for (const op of guardOps) {
    const ratios = [];
    let missing = null;
    for (let i = 0; i < current.length; i++) {
      const now = current[i].find((row) => row.name === op);
      const then = reference[i].find((row) => row.name === op);
      if (!now || !Number.isFinite(now.opsPerSec)) missing = 'current';
      else if (!then || !Number.isFinite(then.opsPerSec)) missing ??= 'reference';
      else ratios.push(now.opsPerSec / then.opsPerSec);
    }
    if (missing === 'current') {
      failures.push(`${name}: missing benchmark "${op}" in current run`);
      continue;
    }
    if (missing === 'reference') {
      rows.push({ op, note: 'not in the reference build: not compared' });
      continue;
    }
    const mid = median(ratios);
    const row = { op, median: mid, low: Math.min(...ratios), high: Math.max(...ratios), pairs: ratios.length };
    rows.push(row);
    if (mid < 1 - tolerance) {
      failures.push(`${name}: ${op} at ${pct(mid)} of the reference (median of ${ratios.length} pairs, range ${pct(row.low)} to ${pct(row.high)}; the floor is ${pct(1 - tolerance)})`);
    }
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
