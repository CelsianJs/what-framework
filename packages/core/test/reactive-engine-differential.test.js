// Randomized differential test of the reactive engine against a brute-force
// oracle. Seeded and deterministic: a failure message names the graph and step
// to replay.
//
// Each graph has signals, computeds over earlier nodes (sums with a small
// modulus, so many recomputes land on the same value, and conditionals, so
// dependencies change between runs) and effects. Each step writes signals
// (sometimes the same value, sometimes A -> B -> A), optionally reads computeds
// imperatively before any flush, then settles through batch(), flushSync() or
// the microtask. Checked against the oracle, which recomputes every node from
// the signal values alone:
//   values      every read inside a computed or an effect, and every
//               imperative read, equals the oracle for the current signals, so
//               no observer ever sees an inconsistent combination (a glitch);
//   once        between the end of a step's writes and the end of its flush,
//               each computed evaluates at most once and each effect runs at
//               most once;
//   run counts  an effect runs exactly when a signal it read last time
//               changed during the step, or a computed it read last time ends
//               the step with a different value.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, effect, batch, flushSync, createRoot, __DEV__, __subsOf } from '../src/reactive.js';

const GRAPHS = 300;
const STEPS = 40;
const MOD = 5;

function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  return { next, int, pick: (list) => list[int(list.length)] };
}

// A formula reads nodes through `read` and returns a small integer.
function makeFormula(rand, below) {
  const dep = () => rand.int(below);
  if (below > 1 && rand.next() < 0.35) {
    const test = dep(), a = dep(), b = dep();
    return (read) => ((read(test) & 1) ? read(a) : read(b));
  }
  const deps = Array.from({ length: 1 + rand.int(3) }, dep);
  const k = rand.int(MOD);
  return (read) => {
    let sum = k;
    for (const d of deps) sum += read(d);
    return sum % MOD;
  };
}

function describeGraph(seed) {
  const rand = prng(seed);
  const signals = 2 + rand.int(5);
  const computeds = Array.from({ length: 3 + rand.int(12) }, (_, i) => makeFormula(rand, signals + i));
  const nodes = signals + computeds.length;
  const effects = Array.from({ length: 1 + rand.int(6) }, () => makeFormula(rand, nodes));
  const initial = Array.from({ length: signals }, () => rand.int(MOD));
  return { rand, signals, computeds, effects, initial };
}

function oracle(graph, values) {
  const out = values.slice();
  for (const formula of graph.computeds) out.push(formula((i) => out[i]));
  return out;
}

async function runGraph(seed) {
  const graph = describeGraph(seed);
  const { rand, signals } = graph;
  const failures = [];
  const fail = (what) => { if (failures.length < 5) failures.push(what); };

  const values = graph.initial.slice();
  let expected = oracle(graph, values);
  let expectedFor = 0;
  let version = 0;
  const current = () => {
    if (expectedFor !== version) { expected = oracle(graph, values); expectedFor = version; }
    return expected;
  };

  const nodes = [];
  const evals = new Array(graph.computeds.length).fill(0);
  const runs = new Array(graph.effects.length).fill(0);
  const lastReads = graph.effects.map(() => []);
  let observer = null;                               // effect index whose reads are recorded
  const read = (where) => (i) => {
    const v = nodes[i]();
    if (observer !== null) lastReads[observer].push(i);
    if (v !== current()[i]) fail(`${where} read node ${i} = ${v}, oracle ${current()[i]}`);
    return v;
  };

  let disposeRoot;
  createRoot((dispose) => {
    disposeRoot = dispose;
    for (let i = 0; i < signals; i++) nodes.push(signal(values[i]));
    graph.computeds.forEach((formula, c) => {
      const reader = read(`computed ${signals + c}`);
      nodes.push(computed(() => {
        evals[c]++;
        const prev = observer;
        observer = null;
        try { return formula(reader); } finally { observer = prev; }
      }));
    });
    graph.effects.forEach((formula, e) => {
      const reader = read(`effect ${e}`);
      effect(() => {
        runs[e]++;
        const prev = observer;
        observer = e;
        lastReads[e] = [];
        try { formula(reader); } finally { observer = prev; }
      });
    });
  });

  for (let step = 0; step < STEPS && failures.length === 0; step++) {
    const before = current().slice();
    const readsBefore = lastReads.map((r) => r.slice());
    const changed = new Set();
    const write = (i, v) => {
      if (values[i] !== v) { changed.add(i); values[i] = v; version++; }
      nodes[i](v);
    };
    const writes = () => {
      for (let n = 1 + rand.int(3); n > 0; n--) {
        const i = rand.int(signals);
        if (rand.next() < 0.15) {                     // A -> B -> A
          const original = values[i];
          write(i, (original + 1 + rand.int(MOD - 1)) % MOD);
          write(i, original);
        } else {
          write(i, rand.int(MOD));
        }
      }
    };
    const evalsStart = [];
    const runsStart = [];
    const markAfterWrites = () => { evalsStart.push(...evals); runsStart.push(...runs); };
    const imperativeReads = () => {
      if (rand.next() < 0.4) {
        const i = signals + rand.int(graph.computeds.length);
        const v = nodes[i]();
        if (v !== current()[i]) fail(`imperative read of node ${i} = ${v}, oracle ${current()[i]}`);
      }
    };

    const mode = rand.pick(['batch', 'flushSync', 'microtask']);
    if (mode === 'batch') {
      batch(() => { writes(); markAfterWrites(); imperativeReads(); });
    } else {
      writes();
      markAfterWrites();
      imperativeReads();
      if (mode === 'flushSync') flushSync();
      else await Promise.resolve();
    }

    const after = current();
    evals.forEach((n, c) => {
      if (n - evalsStart[c] > 1) fail(`step ${step} (${mode}): computed ${signals + c} evaluated ${n - evalsStart[c]} times`);
    });
    runs.forEach((n, e) => {
      const ran = n - runsStart[e];
      const due = readsBefore[e].some((i) => (i < signals ? changed.has(i) : before[i] !== after[i]));
      if (ran > 1) fail(`step ${step} (${mode}): effect ${e} ran ${ran} times`);
      else if (ran !== (due ? 1 : 0)) fail(`step ${step} (${mode}): effect ${e} ran ${ran} times, expected ${due ? 1 : 0}`);
    });
  }

  disposeRoot();
  if (__DEV__) {
    for (let i = 0; i < signals; i++) {
      if (__subsOf(nodes[i]).length !== 0) fail(`signal ${i} still has subscribers after disposal`);
    }
  }
  return failures;
}

describe('engine vs brute-force oracle', () => {
  it(`${GRAPHS} random graphs x ${STEPS} steps: values, glitch-freedom, at-most-once, run counts`, async () => {
    for (let g = 0; g < GRAPHS; g++) {
      const seed = 0x5eed + g * 7919;
      const failures = await runGraph(seed);
      assert.deepEqual(failures, [], `graph seed ${seed}`);
    }
  });
});
