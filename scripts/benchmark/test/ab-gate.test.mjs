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

// Reports with the median and 95th-percentile call: `tail` multiplies the
// 95th percentile alone, as a change that slows one call in twenty does.
function timed(pairs, tail, noise, seed) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  return Array.from({ length: pairs }, () => GUARD.map((name) => {
    const p50 = 0.0013 * (1 + noise * rand());
    return { name, opsPerSec: 1000 / p50, p50, p95: 0.0025 * tail * (1 + 2 * noise * rand()) };
  }));
}

test('a change that slows one call in twenty fails on its 95th-percentile call; the tail noise of an unchanged build passes', () => {
  for (let seed = 1; seed < 20; seed++) {
    const same = compareInterleaved('core', timed(9, 1, 0.1, seed), timed(9, 1, 0.1, seed + 100), 0.05, GUARD);
    assert.deepEqual(same.failures, [], `seed ${seed}`);
    const stalled = compareInterleaved('core', timed(9, 1, 0.05, seed), timed(9, 200, 0.05, seed + 100), 0.05, GUARD);
    assert.equal(stalled.failures.length, 2, `seed ${seed}`);
    assert.match(stalled.failures[0], /: 95th-percentile call at \d+\.\d% of the reference .*the floor is 75\.0%\)/);
    assert.ok(stalled.rows[0].measures[0].median > 0.95, 'the trimmed throughput does not see it');
  }
});

// Reports with every percentile: `far` multiplies the 99th percentile alone,
// as a change that slows one call in fifty does (round 6, COR-09).
function farTail(pairs, far, noise, seed) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  return Array.from({ length: pairs }, () => GUARD.map((name) => {
    const p50 = 0.04 * (1 + noise * rand());
    return { name, opsPerSec: 1000 / p50, p50, p95: 0.05 * (1 + noise * rand()), p99: 0.07 * far * (1 + 3 * noise * rand()) };
  }));
}

test('a change that slows one call in fifty 25 times fails on its 99th-percentile call; its noise passes', () => {
  for (let seed = 1; seed < 20; seed++) {
    const same = compareInterleaved('core', farTail(9, 1, 0.15, seed), farTail(9, 1, 0.15, seed + 100), 0.05, GUARD);
    assert.deepEqual(same.failures, [], `seed ${seed}`);
    const slowed = compareInterleaved('core', farTail(9, 1, 0.05, seed), farTail(9, 25, 0.05, seed + 100), 0.05, GUARD);
    assert.equal(slowed.failures.length, 2, `seed ${seed}`);
    assert.match(slowed.failures[0], /: 99th-percentile call at \d+\.\d% of the reference .*the floor is 40\.0%\)/);
    assert.ok(slowed.rows[0].measures[2].median > 0.75, 'the 95th percentile does not see it');
  }
});

// The retry fails the gate only for an operation that failed both attempts: a
// real regression slows the same operation each time, session noise wanders.
test('the gate fails only operations that fail both attempts', async () => {
  const { failureKey, persistentFailures } = await import('../../../benchmark/ab.mjs');
  const first = [
    'core: batch() 100 writes, 1 effect: throughput at 93.6% of the reference (median of 9 pairs, range 77.9% to 105.8%; the floor is 95.0%)',
    'dom: partialUpdate regressed +32.5% (0.265 ms > 0.240 ms threshold)',
  ];
  assert.equal(failureKey(first[0]), 'core: batch() 100 writes, 1 effect');
  assert.equal(failureKey(first[1]), 'dom: partialUpdate');
  assert.equal(failureKey('dom: missing benchmark "x" in current run'), 'dom: missing benchmark "x" in current run');
  // Noise: a different operation misses on the retry.
  assert.deepEqual(persistentFailures(first, ['core: batch() 10 signals, 10 writes each: throughput at 93.8% of the reference (median of 9 pairs, range 80.0% to 104.0%; the floor is 95.0%)']), []);
  // A regression: the same operation misses again, by another measure.
  const again = ['core: batch() 100 writes, 1 effect: median call at 92.0% of the reference (median of 9 pairs, range 70.0% to 101.0%; the floor is 95.0%)'];
  assert.deepEqual(persistentFailures(first, again), again);
  assert.deepEqual(persistentFailures(first, ['dom: partialUpdate regressed +40.0% (0.280 ms > 0.240 ms threshold)']).length, 1);
});
