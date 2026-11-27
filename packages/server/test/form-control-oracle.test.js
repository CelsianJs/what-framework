// Form-control conformance, by differential oracle (fixtures/form-oracle.js
// has the space, the reference model and its sources). Every field shape is
// rendered by every server renderer and compared with the browser's parse of
// the equivalent static HTML, then mounted and hydrated by every client path
// (each hydration also after a user edit made before it runs) and compared
// with the model after each step of its script. The run must end
// with no finding; a finding names the shape, the path and the step, which
// reproduce it.
//
// Widen or reseed nothing here: the space is enumerated, not sampled.
// form-control-oracle-chromium.test.js runs part of it in a real browser.
//
// The shapes are dealt round-robin to worker threads (fixtures/
// form-oracle-shard.js has the cases), each with its own JSDOM and its own
// compile of its shapes, and the findings are merged back into the order one
// thread would have found them in. Each case renders, mounts and hydrates its
// own form in a host of its own, so which other cases ran before it in the
// same document does not enter the result.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { shapes } from './fixtures/form-oracle.js';

const SHAPES = shapes();
const SHARDS = Math.max(1, Math.min(4, availableParallelism() - 1, SHAPES.length));

function runShard(ids) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./fixtures/form-oracle-shard.js', import.meta.url), { workerData: { ids } });
    let result = null;
    worker.once('message', (message) => { result = JSON.parse(message); });
    worker.once('error', reject);
    worker.once('exit', (code) => (result ? resolve(result) : reject(new Error(`oracle shard exited (${code}) without a result`))));
  });
}

// The findings of every shard, in the order of SHAPES (a shape's own findings
// keep the order its cases ran in).
function merge(results, part) {
  const position = new Map(SHAPES.map((shape, i) => [shape.id, i]));
  const findings = results.flatMap((r) => r[part].findings);
  findings.sort((a, b) => position.get(a.shape.id) - position.get(b.shape.id));
  return { cases: results.reduce((n, r) => n + r[part].cases, 0), findings };
}

function report(findings, total) {
  const lines = findings.slice(0, 12).map((f) => JSON.stringify(f));
  return `${findings.length} of ${total} cases diverge:\n${lines.join('\n')}`;
}

let results;

before(async () => {
  const shards = Array.from({ length: SHARDS }, (_, k) => SHAPES.filter((_, i) => i % SHARDS === k).map((shape) => shape.id));
  results = await Promise.all(shards.map(runShard));
});

describe('form-control oracle', () => {
  it('every server renderer shows each field as its equivalent static HTML before hydration', () => {
    const { cases, findings } = merge(results, 'server');
    console.log(`form oracle: ${cases} server cases, ${findings.length} findings`);
    assert.equal(findings.length, 0, report(findings, cases));
  });

  it('every client path follows the reference model through mount, hydration, writes, edits, resets and release', () => {
    const { cases, findings } = merge(results, 'client');
    console.log(`form oracle: ${cases} client cases, ${findings.length} findings`);
    assert.equal(findings.length, 0, report(findings, cases));
  });
});
