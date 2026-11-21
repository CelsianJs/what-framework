// Regression tests for the defects of the previous signal engine (level-sorted
// notify plus a throw-based evaluation trampoline), one per reproduction, and
// for the two scheduler-ordering bugs found by the conformance port. Each test
// failed on that engine.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  signal, computed, effect, memo, batch, flushSync, createRoot,
  __DEV__, __devtools, __setDevToolsHooks,
} from '../src/reactive.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function captureConsole(method, fn) {
  const original = console[method];
  const calls = [];
  console[method] = (...args) => calls.push(args);
  try { fn(); } finally { console[method] = original; }
  return calls;
}

// `depth` stacked diamonds: each level is left/right computeds over the
// previous tail and a join. Returns the tail and an evaluation counter.
function stackedDiamonds(head, depth) {
  const counter = { evaluations: 0 };
  let tail = head;
  for (let i = 0; i < depth; i++) {
    const input = tail;
    const left = computed(() => { counter.evaluations++; return input() + 1; });
    const right = computed(() => { counter.evaluations++; return input() + 1; });
    tail = computed(() => { counter.evaluations++; return left() + right(); });
  }
  return { tail, counter };
}

describe('D1: notification is linear in the graph, not in its paths', () => {
  for (const depth of [22, 200]) {
    it(`a write through ${depth} stacked diamonds evaluates each computed once`, () => {
      createRoot((dispose) => {
        const head = signal(0);
        const { tail, counter } = stackedDiamonds(head, depth);
        const seen = [];
        effect(() => { seen.push(tail()); });
        assert.equal(counter.evaluations, 3 * depth);
        counter.evaluations = 0;
        batch(() => head(1));
        assert.equal(counter.evaluations, 3 * depth);
        // tail(head) = 2^depth * head + 2^(depth+1) - 2, exact below 2^53.
        if (depth === 22) assert.deepEqual(seen, [2 ** 23 - 2, 3 * 2 ** 22 - 2]);
        else assert.equal(seen.length, 2);
        dispose();
      });
    });
  }
});

describe('D2: a computed that recomputes to the same value stops propagation', () => {
  it('leaves downstream computeds and effects alone', () => {
    createRoot((dispose) => {
      const n = signal(0);
      const parity = computed(() => n() % 2);
      let leafRuns = 0;
      const label = computed(() => { leafRuns++; return parity() ? 'odd' : 'even'; });
      const observed = [];
      effect(() => { observed.push(label()); });
      leafRuns = 0;
      batch(() => n(2));
      assert.equal(leafRuns, 0);
      assert.deepEqual(observed, ['even']);
      dispose();
    });
  });
});

describe('D3: evaluation has no restarts, no stale branches and no visible sentinel', () => {
  it('a first read of a never-evaluated upstream runs each callback once', () => {
    const input = signal(1);
    const calls = [];
    const upstream = computed(() => { calls.push('upstream'); return input() + 1; });
    const leaf = computed(() => { calls.push('leaf'); return upstream() * 2; });
    assert.equal(leaf(), 4);
    assert.deepEqual(calls, ['leaf', 'upstream']);
  });

  it('a branch the reader no longer selects is not evaluated', () => {
    const chooseFirst = signal(true);
    const first = signal(1);
    let firstCalls = 0;
    const staleBranch = computed(() => { firstCalls++; return first(); });
    const selected = computed(() => (chooseFirst() ? staleBranch() : 42));
    selected();
    chooseFirst(false);
    first(2);
    firstCalls = 0;
    assert.equal(selected(), 42);
    assert.equal(firstCalls, 0);
  });

  it('the guard pattern does not evaluate the guarded branch after the guard closes', () => {
    const user = signal({ name: 'ada' });
    const name = computed(() => user().name.toUpperCase());
    const label = computed(() => (user() ? name() : 'guest'));
    const seen = [];
    const errors = captureConsole('error', () => {
      createRoot((dispose) => {
        effect(() => { seen.push(label()); });
        user(null);
        flushSync();
        dispose();
      });
    });
    assert.deepEqual(seen, ['ADA', 'guest']);
    assert.equal(label(), 'guest');
    assert.deepEqual(errors, []);
  });

  it('a try/catch around a computed read sees its value, not a sentinel', () => {
    const s = signal(2);
    const parsed = computed(() => { if (s() < 0) throw new Error('negative'); return s() * 10; });
    const safe = computed(() => { try { return parsed(); } catch { return 'fallback'; } });
    assert.equal(safe(), 20);
    s(3);
    assert.equal(safe(), 30);
    s(-1);
    assert.equal(safe(), 'fallback');
  });

  it('a try/catch cannot swallow the deferral of a chain deeper than the stack bound', () => {
    const s = signal(0);
    let cur = s;
    for (let i = 0; i < 3000; i++) { const p = cur; cur = computed(() => p() + 1); }
    const deep = cur;
    const safe = computed(() => { try { return deep(); } catch { return 'fallback'; } });
    assert.equal(safe(), 3000);
    s(1);
    assert.equal(safe(), 3001);
  });
});

describe('D4: stable effects run in the flush', () => {
  it('observes a signal and its computed consistently, once, on a microtask', async () => {
    const s = signal(1);
    const seen = [];
    let dispose;
    createRoot((d) => {
      dispose = d;
      const c = computed(() => s() * 10);
      effect(() => { seen.push([s(), c()]); }, { stable: true });
    });
    s(2);
    assert.deepEqual(seen, [[1, 10]]);
    await tick();
    assert.deepEqual(seen, [[1, 10], [2, 20]]);
    dispose();
  });
});

describe('D5: memo is fresh right after a write', () => {
  it('reads the new value before any flush', () => {
    createRoot((dispose) => {
      const s = signal(1);
      const m = memo(() => s() * 2);
      s(5);
      assert.equal(m(), 10);
      dispose();
    });
  });
});

describe('D6: long effect cascades complete', () => {
  it('a 30-step effect-to-effect cascade reaches its end', () => {
    createRoot((dispose) => {
      const sigs = Array.from({ length: 31 }, () => signal(0));
      let last = -1;
      for (let i = 0; i < 30; i++) effect(() => { const v = sigs[i](); if (v) sigs[i + 1](v); });
      effect(() => { last = sigs[30](); });
      sigs[0](7);
      flushSync();
      assert.equal(last, 7);
      dispose();
    });
  });
});

describe('D7: a parent effect runs before the children it would dispose', () => {
  it('a child region never runs against data its parent guards', () => {
    const user = signal({ name: 'ada' });
    const loggedIn = computed(() => user() !== null);
    const log = [];
    const errors = captureConsole('error', () => {
      createRoot((dispose) => {
        let disposeChild = null;
        effect(() => {
          disposeChild?.();
          disposeChild = null;
          if (loggedIn()) createRoot((d) => { disposeChild = d; effect(() => log.push(user().name)); });
          else log.push('guest');
        });
        batch(() => user(null));
        dispose();
      });
    });
    assert.deepEqual(log, ['ada', 'guest']);
    assert.deepEqual(errors, []);
  });
});

describe('D8: computed errors are cached; effect errors are reported once', () => {
  it('rethrows the cached error without re-running the computed', () => {
    const s = signal(0);
    let calls = 0;
    const c = computed(() => { calls++; if (s() === 1) throw new Error('x'); return s(); });
    c();
    s(1);
    assert.throws(() => c(), /x/);
    assert.throws(() => c(), /x/);
    assert.equal(calls, 2);
  });

  it('reports a throwing effect re-run once, to the devtools and to console.error', { skip: !__DEV__ }, () => {
    const s = signal(0);
    const reported = [];
    const previous = __devtools;
    __setDevToolsHooks({ onError: (err, context) => reported.push([err.message, context.type]) });
    let errors;
    try {
      errors = captureConsole('error', () => {
        createRoot((dispose) => {
          effect(() => { if (s() === 1) throw new Error('boom'); });
          s(1);
          flushSync();
          dispose();
        });
      });
    } finally {
      __setDevToolsHooks(previous);
    }
    assert.deepEqual(reported, [['boom', 'effect']]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][1].message, 'boom');
  });
});

describe('batch returns its callback value', () => {
  it('instead of undefined', () => {
    assert.equal(batch(() => 42), 42);
  });
});

describe('previously correct behaviour, kept', () => {
  it('a diamond effect runs once with consistent values', () => {
    createRoot((dispose) => {
      const a = signal(1);
      const seen = [];
      const b = computed(() => a() + 1);
      const c = computed(() => a() * 2);
      effect(() => seen.push(b() + c()));
      a(2);
      flushSync();
      assert.deepEqual(seen, [4, 7]);
      dispose();
    });
  });

  it('a self-incrementing effect converges', () => {
    createRoot((dispose) => {
      const s = signal(0);
      let runs = 0;
      effect(() => { runs++; if (s() < 3) s(s() + 1); });
      flushSync();
      assert.deepEqual({ s: s(), runs }, { s: 3, runs: 4 });
      dispose();
    });
  });

  it('a computed is fresh right after a write', () => {
    const s = signal(1);
    const c = computed(() => s() + 1);
    c();
    s(10);
    assert.equal(c(), 11);
  });

  for (const n of [1000, 10000, 100000]) {
    it(`a ${n}-deep chain evaluates without stack overflow, and updates once per node`, () => {
      const s = signal(0);
      let cur = s;
      let runs = 0;
      for (let i = 0; i < n; i++) { const p = cur; cur = computed(() => { runs++; return p() + 1; }); }
      assert.equal(cur(), n);
      // Past the stack bound, voided frames re-run once: at most 2n first runs.
      assert.ok(runs <= 2 * n, `${runs} first-evaluation runs`);
      runs = 0;
      s(1);
      assert.equal(cur(), n + 1);
      assert.equal(runs, n);
    });
  }
});

// Scheduler conformance: an effect over a memo diamond with a direct source
// edge, and an effect whose new branch reaches a memo it was queued before.
// The previous engine showed each of them a torn snapshot under every flush
// entry point.
describe('scheduler ordering under each flush entry point', () => {
  const flushes = {
    flushSync: (write) => { write(); flushSync(); },
    batch: (write) => { batch(write); },
    microtask: async (write) => { write(); await Promise.resolve(); },
  };

  for (const [name, settle] of Object.entries(flushes)) {
    it(`jagged eager diamond with a direct source edge is coherent (${name})`, async () => {
      let dispose;
      const ctx = createRoot((d) => {
        dispose = d;
        const source = signal(0);
        const a = memo(() => source() * 2);
        const b = memo(() => a() * 3);
        const seen = [];
        effect(() => { seen.push([source(), a(), b()]); });
        return { source, seen };
      });
      await settle(() => ctx.source(1));
      assert.deepEqual(ctx.seen, [[0, 0, 0], [1, 2, 6]]);
      dispose();
    });

    it(`a same-count dependency switch keeps the next write ordered (${name})`, async () => {
      let dispose;
      const ctx = createRoot((d) => {
        dispose = d;
        const pickDeep = signal(false);
        const trigger = signal(0);
        const shallow = signal(0);
        const source = signal(0);
        const deep = memo(() => source() * 10);
        const seen = [];
        effect(() => { seen.push([pickDeep() ? deep() : shallow(), trigger()]); });
        return { pickDeep, trigger, source, seen };
      });
      ctx.pickDeep(true);
      flushSync();
      // Queue the observer before the newly observed upstream memo.
      await settle(() => { ctx.trigger(1); ctx.source(1); });
      assert.deepEqual(ctx.seen, [[0, 0], [0, 0], [10, 1]]);
      dispose();
    });
  }
});
