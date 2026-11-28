// Randomized lifecycle property of effect-scoped ownership, seeded and
// deterministic: a failure names the mode, the seed and the step.
//
// Each seed builds a root holding three effects over random computeds that
// may throw: a gate effect that, while its gate is open, creates a child root
// (with an effect and a cleanup) on every run; a capture effect; and an effect
// whose re-runs throw. Random writes then arrive (plain, batched, nested
// batches that throw, flushed now or on the microtask), and the root is
// disposed at a random step. Checked against a model:
//
//   - every effect and computed read sees the oracle's value;
//   - each child root's cleanup runs exactly once;
//   - no child runs after the root is disposed;
//   - effect re-run errors reach the root's `_onError` exactly when the model
//     says they should;
//   - after the root is disposed no input keeps an effect subscribed.
//
// Two modes. 'explicit-child-disposal': the gate effect's cleanup disposes
// the child it created. 'owner-child-disposal': the cleanup does that only
// while the root lives, so after the root is disposed only ownership can stop
// the children: the root owns the gate effect, which owns each run's child.
//
// Adapted from the w1 engine review's property.mjs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { signal, computed, effect, batch, flushSync, createRoot, getOwner, onCleanup, __subsOf } =
  await import('../src/reactive.js');
const { __DEV__ } = await import('../src/env.js');

const SEEDS = Number(process.env.WHAT_PROPERTY_SEEDS ?? 1000);
const STEPS = 40;
const MODES = ['explicit-child-disposal', 'owner-child-disposal'];

async function runSeed(mode, seed, findings) {
  let state = seed;
  const r = (n) => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) % n; };
  const raw = Array.from({ length: 5 }, () => r(8));
  const inputs = raw.map((v) => signal(v));
  const failError = new Error('model expected value error');
  const batchError = new Error('expected batch rollback-free throw');
  const formulas = Array.from({ length: 10 }, (_, i) => {
    const limit = i + inputs.length;
    return { ifKey: r(limit), left: r(limit), right: r(limit), offset: r(5), throws: r(5) === 0 };
  });
  const listen = r(5) + inputs.length;
  const evalFormula = ({ ifKey, left, right, offset, throws }, read) => {
    const condition = read(ifKey);
    const leaf = read(condition % 2 === 0 ? left : right);
    if (throws && (leaf + offset) % 4 === 1) throw failError;
    return (leaf + condition + offset) % 9;
  };
  const checked = (read) => { try { return read(); } catch (e) { return e === failError ? 'error' : String(e); } };
  const graph = [...inputs];
  formulas.forEach((f) => graph.push(computed(() => evalFormula(f, (i) => graph[i]()))));
  const oracle = (i) => (i < inputs.length ? raw[i] : evalFormula(formulas[i - inputs.length], oracle));

  let step = 0;
  let alive = true;
  let stopRoot;
  let stopChild;
  const children = [];
  const routed = [];
  const checks = [];
  const initialErrorInput = raw[1];
  let expectedErrors = 0;
  const record = (type, detail) => { findings.push({ mode, seed, step, type, detail }); };
  const capture = (id) => { checks.push([step, id, checked(() => graph[listen]()), checked(() => oracle(listen))]); };

  createRoot((dispose) => {
    stopRoot = dispose;
    getOwner()._onError = (e) => routed.push(e.message);
    effect(() => {
      const open = Boolean(inputs[0]() & 1);
      if (!open) return;
      const child = { runs: 0, cleanups: 0 };
      children.push(child);
      stopChild = createRoot((stop) => {
        onCleanup(() => { child.cleanups++; });
        effect(() => { child.runs++; capture('child'); });
        return stop;
      });
      return () => { if (mode === MODES[0] || alive) stopChild(); };
    });
    effect(() => { capture('effect'); });
    effect(() => { if (inputs[1]() === 7 && initialErrorInput !== 7) throw failError; });
  });

  const disposeRoot = () => {
    alive = false;
    stopRoot();
    for (const child of children) if (child.cleanups !== 1) record('child cleanup count', child);
  };

  for (step = 0; step < STEPS; step++) {
    if (step > 3 && alive && r(10) === 0) disposeRoot();
    let changedErrorInput = false;
    const runningBefore = children.reduce((sum, c) => sum + c.runs, 0);
    const write = () => {
      const key = r(inputs.length);
      const next = r(8);
      if (key === 1 && raw[key] !== next) changedErrorInput = true;
      raw[key] = next;
      inputs[key](next);
    };
    const v = r(3);
    if (v === 0) {
      try {
        batch(() => { write(); batch(write); if (r(4) === 0) throw batchError; write(); });
      } catch (e) {
        assert.equal(e, batchError);
      }
    } else {
      write();
      if (r(2)) write();
      if (v === 1) flushSync(); else await Promise.resolve();
    }
    if (alive && changedErrorInput && raw[1] === 7 && initialErrorInput !== 7) expectedErrors++;
    capture('imperative');
    if (!alive) {
      const runningAfter = children.reduce((sum, c) => sum + c.runs, 0);
      if (runningAfter !== runningBefore) record('child executed after disposal', { runningBefore, runningAfter });
    }
  }
  if (alive) disposeRoot();
  if (routed.length !== expectedErrors) record('effect errors misrouted', { actual: routed.length, expected: expectedErrors });
  for (const [at, id, actual, expected] of checks) {
    if (actual !== expected) findings.push({ mode, seed, step: at, type: 'wrong value', detail: { id, actual, expected } });
  }
  if (__DEV__ && inputs.some((s) => __subsOf(s).some((e) => e.flags & 2))) {
    record('effect subscriptions survived final disposal', inputs.map((s) => __subsOf(s).length));
  }
}

describe('owner lifecycle property', () => {
  for (const mode of MODES) {
    it(`${mode}: ${SEEDS} seeds of ${STEPS} steps match the model`, async () => {
      const findings = [];
      for (let seed = 1; seed <= SEEDS; seed++) await runSeed(mode, seed, findings);
      assert.deepEqual(findings.slice(0, 5), [], `${findings.length} findings; the first five are shown`);
    });
  }
});
