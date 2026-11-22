// The core and DX benchmark gate measures the code against a reference build
// in the same session (benchmark/ab.mjs): interleaved pairs, judged by the
// median of the per-pair ratios. A 10% regression fails it, the noise of an
// unchanged build does not, and the order alternates so a trend in machine
// state falls on both sides.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { compareInterleaved, median, referenceTree, runInterleaved } = await import('../../../benchmark/ab.mjs');

// Reports for `pairs` runs: each op's ops/s times a factor, with noise.
function reports(pairs, factor, noise, seed = 1) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  return Array.from({ length: pairs }, () => [
    { name: 'signal() write (1 subscriber)', opsPerSec: 760000 * factor * (1 + noise * rand()) },
    { name: 'batch() 100 writes, 1 effect', opsPerSec: 620000 * factor * (1 + noise * rand()) },
  ]);
}
const GUARD = ['signal() write (1 subscriber)', 'batch() 100 writes, 1 effect'];

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('an unchanged build within the noise passes; a 10% regression fails', () => {
  for (let seed = 1; seed < 20; seed++) {
    const same = compareInterleaved('core', reports(9, 1, 0.15, seed), reports(9, 1, 0.15, seed + 100), 0.05, GUARD);
    assert.deepEqual(same.failures, [], `seed ${seed}`);
    const slower = compareInterleaved('core', reports(9, 1, 0.08, seed), reports(9, 0.9, 0.08, seed + 100), 0.05, GUARD);
    assert.equal(slower.failures.length, 2, `seed ${seed}`);
    assert.match(slower.failures[0], /at \d+\.\d% of the reference \(median of 9 pairs, range .*; the floor is 95\.0%\)/);
  }
});

test('an op the reference lacks is reported, one the current run lacks fails', () => {
  const current = reports(3, 1, 0);
  const reference = reports(3, 1, 0).map((rows) => rows.slice(1));
  const result = compareInterleaved('core', reference, current, 0.05, GUARD);
  assert.deepEqual(result.failures, []);
  assert.equal(result.rows[0].note, 'not in the reference build: not compared');
  assert.match(compareInterleaved('core', current, reference, 0.05, GUARD).failures[0], /missing benchmark "signal\(\) write \(1 subscriber\)" in current run/);
});

test('the two sides alternate which runs first', () => {
  const order = [];
  runInterleaved({ script: 's.js', pairs: 4, referenceDir: 'ref', currentDir: 'cur', outDir: '/tmp', run: (dir) => { order.push(dir); return []; } });
  assert.deepEqual(order, ['ref', 'cur', 'cur', 'ref', 'ref', 'cur', 'cur', 'ref']);
});

test('the reference must be a commit hash', () => {
  assert.throws(() => referenceTree('/nowhere', 'main; rm -rf /', []), /is not a commit hash/);
});
