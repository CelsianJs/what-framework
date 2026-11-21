// Randomized lifecycle test of the reactive engine against a brute-force
// oracle: the graph changes shape while it runs. Seeded and deterministic; a
// failure message names the seed and step.
//
// reactive-engine-differential.test.js checks a fixed graph. This one adds
// what that one cannot generate:
//   - effects that create child roots (with child effects and cleanups) when
//     a gate opens and dispose them from their cleanup when it closes;
//   - disposal from the test in the middle of a batch, and from inside a
//     computed's evaluation (a "killer" computed disposes a chosen child,
//     possibly the very effect that is reading it);
//   - computeds that throw, effects whose re-runs throw, cleanups that throw;
//   - effects that call batch(), flushSync() and untrack(flushSync) during
//     their run;
//   - writes from inside effects (a writer keeps one signal derived from
//     another) and from inside a computed (a tap copies its value into a
//     signal that one effect reads);
//   - nested batches, a batch that throws, flushSync, microtask flushes.
// Checked:
//   values      every read in a computed or an effect and every imperative read
//               equals the oracle for the signal values at that moment;
//   settled     after each step, every live effect has seen the oracle's value;
//   no strays   an effect re-runs only if a signal it can depend on changed in
//               the step, a disposed effect never runs, and without writes
//               from effects or computeds each effect runs at most once a step;
//   errors      every error thrown by an effect re-run or cleanup is reported
//               once, to the root's _onError while the root is alive;
//   disposal    each child root's cleanup runs exactly once, and once
//               everything is disposed (and the release checkpoint passed) no
//               signal has a subscriber left and no write runs anything.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  signal, computed, effect, batch, flushSync, untrack, createRoot, getOwner, onCleanup,
  __DEV__, __subsOf,
} from '../src/reactive.js';

const GRAPHS = 200;
const STEPS = 30;
const MOD = 6;
const ERR = Symbol('error');

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

// A formula reads node indexes below `below` and returns a small integer. Its
// `deps` lists every node it may read, on either branch.
function makeFormula(rand, below) {
  const dep = () => rand.int(below);
  if (below > 1 && rand.next() < 0.35) {
    const test = dep(), a = dep(), b = dep();
    return { deps: [test, a, b], run: (read) => ((read(test) & 1) ? read(a) : read(b)) };
  }
  const deps = Array.from({ length: 1 + rand.int(3) }, dep);
  const k = rand.int(MOD);
  return {
    deps,
    run: (read) => {
      let sum = k;
      for (const d of deps) sum += read(d);
      return sum % MOD;
    },
  };
}

function describeGraph(seed) {
  const rand = prng(seed);
  const signals = 3 + rand.int(4);
  const computeds = Array.from({ length: 3 + rand.int(9) }, (_, i) => {
    const f = makeFormula(rand, signals + i);
    if (rand.next() < 0.2) f.throwsAt = rand.int(MOD);
    return f;
  });
  const nodes = signals + computeds.length;
  const killer = signals + rand.int(computeds.length);
  const tap = rand.next() < 0.5 ? signals + rand.int(computeds.length) : -1;
  const readers = Array.from({ length: 1 + rand.int(4) }, () => ({
    ...makeFormula(rand, nodes),
    user: rand.next() < 0.3,
    reenter: rand.int(4),                         // 0 none, 1 batch, 2 flushSync, 3 untrack(flushSync)
    failsAt: rand.next() < 0.3 ? rand.int(MOD) : -1,
    cleanupThrows: rand.next() < 0.2,
  }));
  const parents = Array.from({ length: rand.int(3) }, () => ({
    gate: rand.int(nodes),
    child: makeFormula(rand, nodes),
    nested: rand.next() < 0.4 ? makeFormula(rand, nodes) : null,
  }));
  const x = rand.int(signals - 1);
  const writer = rand.next() < 0.5
    ? { x, y: x + 1 + rand.int(signals - 1 - x), k: rand.int(MOD), batched: rand.next() < 0.5 }
    : null;
  const initial = Array.from({ length: signals + 1 }, () => rand.int(MOD));
  return { rand, signals, computeds, killer, tap, readers, parents, writer, initial };
}

function oracle(graph, values) {
  const out = values.slice(0, graph.signals);
  const read = (i) => { if (out[i] === ERR) throw ERR; return out[i]; };
  for (const f of graph.computeds) {
    try {
      const v = f.run(read);
      out.push(f.throwsAt === v ? ERR : v);
    } catch {
      out.push(ERR);
    }
  }
  return out;
}

// Every signal a node (or a formula) may depend on.
function signalDeps(graph, deps, memo = new Map()) {
  const out = new Set();
  const visit = (i) => {
    if (i < graph.signals) { out.add(i); return; }
    if (!memo.has(i)) {
      memo.set(i, new Set());
      const inner = new Set();
      for (const d of graph.computeds[i - graph.signals].deps) {
        for (const s of signalDeps(graph, [d], memo)) inner.add(s);
      }
      memo.set(i, inner);
    }
    for (const s of memo.get(i)) out.add(s);
  };
  for (const d of deps) visit(d);
  return out;
}

async function runGraph(seed) {
  const graph = describeGraph(seed);
  const { rand, signals } = graph;
  const TAP_SIGNAL = signals;                     // index of the tap's signal in `values`
  const failures = [];
  const fail = (what) => { if (failures.length < 5) failures.push(what); };

  const values = graph.initial.slice();
  let version = 0;
  let expected = null;
  let expectedFor = -1;
  const current = () => {
    if (expectedFor !== version) { expected = oracle(graph, values); expectedFor = version; }
    return expected;
  };
  const same = (a, b) => a === b;

  const sigs = values.map((v) => signal(v));
  const nodes = sigs.slice(0, signals);
  let step = -1;
  let changed = new Set();
  let effectWrites = 0;
  const write = (i, v, fromCode) => {
    if (values[i] !== v) { changed.add(i); values[i] = v; version++; if (fromCode) effectWrites++; }
    sigs[i](v);
  };

  // Reads a node through the engine and checks it against the oracle.
  const reader = (where) => (i) => {
    let v;
    try { v = nodes[i](); } catch { v = ERR; }
    if (!same(v, current()[i])) fail(`step ${step}: ${where} read node ${i} = ${String(v)}, oracle ${String(current()[i])}`);
    if (v === ERR) throw ERR;
    return v;
  };
  const evaluate = (formula, read) => {
    try {
      const v = formula.run(read);
      return formula.throwsAt === v ? ERR : v;
    } catch {
      return ERR;
    }
  };

  const readFrom = (vals) => (i) => { if (vals[i] === ERR) throw ERR; return vals[i]; };

  // Every tracked effect: what it should have seen once a step settles (from
  // the oracle's values), what it last saw, the signals it can depend on.
  const tracked = [];
  const track = (name, want, deps) => {
    const t = { name, want, deps: deps instanceof Set ? deps : signalDeps(graph, deps), runs: 0, stepRuns: 0, seen: undefined, alive: true, created: step, dispose: null };
    tracked.push(t);
    return t;
  };
  const ran = (t) => {
    if (!t.alive) fail(`step ${step}: ${t.name} ran after it was disposed`);
    t.runs++;
    t.stepRuns++;
  };

  let killerTarget = null;
  let thrown = 0;
  let thrownWhileDisposing = 0;
  let rootAlive = true;
  const received = [];
  const children = [];

  graph.computeds.forEach((f, c) => {
    const index = signals + c;
    const read = reader(`computed ${index}`);
    nodes.push(computed(() => {
      const v = evaluate(f, read);
      if (index === graph.killer && killerTarget !== null) {
        const victim = killerTarget;
        killerTarget = null;
        victim.dispose();
      }
      if (index === graph.tap && v !== ERR) write(TAP_SIGNAL, v, true);
      if (v === ERR) throw new Error('computed');
      return v;
    }));
  });

  const makeChild = (p, n) => {
    const record = { cleanups: 0, alive: true, dispose: null, effects: [] };
    record.dispose = createRoot((d) => {
      onCleanup(() => { record.cleanups++; });
      for (const [k, f] of [['child', p.child], ['nested', p.nested]]) {
        if (f === null) continue;
        const t = track(`parent ${n} ${k}`, (vals) => evaluate(f, readFrom(vals)), f.deps);
        record.effects.push(t);
        const read = reader(t.name);
        effect(() => { ran(t); t.seen = evaluate(f, read); });
      }
      return () => {
        if (!record.alive) return;
        record.alive = false;
        for (const t of record.effects) t.alive = false;
        d();
        if (record.cleanups !== 1) fail(`step ${step}: a child root's cleanup ran ${record.cleanups} times`);
      };
    });
    children.push(record);
    return record;
  };

  const silence = ['warn', 'error'].map((m) => [m, console[m]]);
  const consoleErrors = [];
  console.warn = () => {};
  console.error = (...args) => { consoleErrors.push(args); };
  let disposeRoot;
  try {
    createRoot((dispose) => {
      disposeRoot = dispose;
      getOwner()._onError = (err) => received.push(err);

      graph.readers.forEach((f, r) => {
        const t = track(`reader ${r}`, (vals) => evaluate(f, readFrom(vals)), f.deps);
        const read = reader(t.name);
        let first = true;
        t.dispose = effect(() => {
          ran(t);
          t.seen = evaluate(f, read);
          if (f.reenter === 1) batch(() => {});
          else if (f.reenter === 2) flushSync();
          else if (f.reenter === 3) untrack(flushSync);
          const throws = !first && f.failsAt === t.seen;
          first = false;
          if (throws) { thrown++; throw new Error('effect'); }
          if (f.cleanupThrows) {
            return () => {
              if (rootAlive) thrown++; else thrownWhileDisposing++;
              throw new Error('cleanup');
            };
          }
        }, f.user ? { phase: 'user' } : undefined);
      });

      graph.parents.forEach((p, n) => {
        const t = track(`parent ${n}`, (vals) => (vals[p.gate] === ERR ? 0 : vals[p.gate] & 1), [p.gate]);
        const read = reader(t.name);
        effect(() => {
          ran(t);
          let open;
          try { open = (read(p.gate) & 1) === 1; } catch { open = false; }
          t.seen = open ? 1 : 0;
          if (!open) return;
          const child = makeChild(p, n);
          return () => child.dispose();
        });
      });

      if (graph.writer !== null) {
        const { x, y, k, batched } = graph.writer;
        const t = track('writer', (vals) => vals[x], [x]);
        const read = reader('writer');
        effect(() => {
          ran(t);
          t.seen = read(x);
          const next = (t.seen + k) % MOD;
          if (batched) batch(() => write(y, next, true)); else write(y, next, true);
        });
      }

      if (graph.tap !== -1) {
        const t = track('tap reader', () => values[TAP_SIGNAL], new Set([TAP_SIGNAL, ...signalDeps(graph, [graph.tap])]));
        const tapRead = reader('tap reader');
        effect(() => {
          ran(t);
          t.seen = sigs[TAP_SIGNAL]();
          try { tapRead(graph.tap); } catch { /* checked by the reader */ }
        });
      }
    });

    flushSync();                                  // what setup's own writes queued

    for (step = 0; step < STEPS && failures.length === 0; step++) {
      changed = new Set();
      effectWrites = 0;
      for (const t of tracked) t.stepRuns = 0;
      const live = () => children.filter((c) => c.alive);
      if (rand.next() < 0.3 && live().length) killerTarget = rand.pick(live());

      const writes = () => {
        for (let n = 1 + rand.int(3); n > 0; n--) {
          const i = rand.int(signals);
          if (rand.next() < 0.15) {                   // A -> B -> A
            const original = values[i];
            write(i, (original + 1 + rand.int(MOD - 1)) % MOD, false);
            write(i, original, false);
          } else {
            write(i, rand.int(MOD), false);
          }
        }
      };
      const disposeSome = () => {
        if (rand.next() < 0.2 && live().length) rand.pick(live()).dispose();
        if (rand.next() < 0.05) {
          const reader = rand.pick(tracked.filter((t) => t.dispose && t.alive));
          if (reader) { reader.alive = false; reader.dispose(); }
        }
      };
      const imperative = () => {
        if (rand.next() < 0.5) {
          const i = signals + rand.int(graph.computeds.length);
          try { reader('imperative')(i); } catch { /* checked by the reader */ }
        }
      };

      const mode = rand.pick(['batch', 'nested', 'throwing', 'flushSync', 'microtask']);
      if (mode === 'batch') {
        batch(() => { writes(); disposeSome(); imperative(); });
      } else if (mode === 'nested') {
        batch(() => { writes(); batch(() => { imperative(); writes(); }); disposeSome(); });
      } else if (mode === 'throwing') {
        try { batch(() => { writes(); imperative(); throw new Error('rolled forward'); }); } catch { /* expected */ }
      } else {
        writes();
        disposeSome();
        imperative();
        if (mode === 'flushSync') flushSync();
        else await Promise.resolve();
      }
      // A read after the settle can evaluate the tap, whose write queues work.
      imperative();
      flushSync();

      const finalValues = current();
      for (const t of tracked) {
        if (!t.alive) continue;
        const want = t.want(finalValues);
        if (!same(t.seen, want)) fail(`step ${step} (${mode}): ${t.name} last saw ${String(t.seen)}, oracle ${String(want)}`);
        if (t.created === step) continue;           // its first run is not a re-run
        if (t.stepRuns > 0 && ![...t.deps].some((i) => changed.has(i))) {
          fail(`step ${step} (${mode}): ${t.name} ran with no input changed`);
        }
        if (effectWrites === 0 && t.stepRuns > 1) fail(`step ${step} (${mode}): ${t.name} ran ${t.stepRuns} times`);
      }
    }

    const routed = received.length;
    rootAlive = false;
    disposeRoot();
    for (const c of children) {
      if (c.alive) c.dispose();
      else if (c.cleanups !== 1) fail(`a disposed child root's cleanup ran ${c.cleanups} times`);
    }
    if (routed !== thrown) fail(`${thrown} effect and cleanup errors thrown, ${routed} reached _onError`);
    if (received.length !== routed) fail('an error reached the handler of a root being disposed');
    const reported = consoleErrors.filter(([, err]) => err?.message === 'cleanup').length;
    if (reported !== thrownWhileDisposing) fail(`${thrownWhileDisposing} cleanups threw during teardown, ${reported} reported`);

    await new Promise((resolve) => setTimeout(resolve, 0));
    if (__DEV__) {
      sigs.forEach((s, i) => { if (__subsOf(s).length !== 0) fail(`signal ${i} keeps ${__subsOf(s).length} subscribers after disposal`); });
    }
    const runsBefore = tracked.reduce((n, t) => n + t.runs, 0);
    for (const t of tracked) t.alive = false;
    batch(() => { for (let i = 0; i < sigs.length; i++) sigs[i]((values[i] + 1) % MOD); });
    flushSync();
    if (tracked.reduce((n, t) => n + t.runs, 0) !== runsBefore) fail('a write ran an effect after everything was disposed');
  } finally {
    for (const [m, fn] of silence) console[m] = fn;
  }
  return failures;
}

describe('engine lifecycle vs brute-force oracle', () => {
  it(`${GRAPHS} random graphs x ${STEPS} steps with children, disposal, errors, re-entrant flushes and writes from code`, async () => {
    for (let g = 0; g < GRAPHS; g++) {
      const seed = 0x11fe + g * 104729;
      const failures = await runGraph(seed);
      assert.deepEqual(failures, [], `graph seed ${seed}`);
    }
  });
});
