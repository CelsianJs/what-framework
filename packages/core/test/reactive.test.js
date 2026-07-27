// Tests for What Framework - Reactive System
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, effect, batch, untrack, flushSync } from '../src/reactive.js';

// Helper: flush microtask queue
async function flush() {
  await new Promise(r => queueMicrotask(r));
  await new Promise(r => queueMicrotask(r));
}

describe('signal', () => {
  it('should hold and return a value', () => {
    const s = signal(42);
    assert.equal(s(), 42);
  });

  it('should update value with set()', () => {
    const s = signal(1);
    s.set(2);
    assert.equal(s(), 2);
  });

  it('should accept updater function', () => {
    const s = signal(5);
    s.set(v => v * 2);
    assert.equal(s(), 10);
  });

  it('should not notify if value is same (Object.is)', () => {
    const s = signal(1);
    let runs = 0;
    const dispose = effect(() => { s(); runs++; });
    assert.equal(runs, 1);
    s.set(1);
    assert.equal(runs, 1);
    dispose();
  });

  it('should notify when writing -0 over +0 (Object.is, not ===)', () => {
    const s = signal(0);
    const seen = [];
    const dispose = effect(() => { seen.push(s()); });
    s.set(-0);
    flushSync();
    assert.equal(seen.length, 2);
    assert.ok(Object.is(seen[1], -0));
    dispose();
  });

  it('should agree with computed() on -0 vs +0', () => {
    const s = signal(0);
    const c = computed(() => s());
    let runs = 0;
    const dispose = effect(() => { c(); runs++; });
    assert.equal(runs, 1);
    s.set(-0);
    flushSync();
    assert.equal(runs, 2);
    assert.ok(Object.is(c(), -0));
    dispose();
  });

  it('should not notify when writing NaN over NaN', () => {
    const s = signal(NaN);
    let runs = 0;
    const dispose = effect(() => { s(); runs++; });
    assert.equal(runs, 1);
    s.set(NaN);
    assert.equal(runs, 1);
    dispose();
  });

  it('should skip notifying exactly when Object.is says the value is unchanged', () => {
    const obj = {};
    const arr = [];
    const pairs = [
      [1, 1], [1, 2], [0, 0], [0, -0], [-0, 0], [-0, -0],
      [NaN, NaN], [NaN, 1], [1, NaN], [0, NaN], [NaN, 0],
      ['a', 'a'], ['a', 'b'], ['', ''], ['', 0], [0, ''],
      [true, true], [true, false], [false, 0], [0, false],
      [null, null], [undefined, undefined], [null, undefined], [undefined, null],
      [obj, obj], [obj, {}], [arr, arr], [arr, []], [obj, arr],
      [Infinity, Infinity], [Infinity, -Infinity], [0, Infinity],
    ];
    for (const [from, to] of pairs) {
      const s = signal(from);
      let runs = 0;
      const dispose = effect(() => { s(); runs++; });
      s.set(() => to);
      flushSync();
      const notified = runs > 1;
      assert.equal(
        notified, !Object.is(from, to),
        `writing ${String(to)} over ${String(from)}: expected notified=${!Object.is(from, to)}`
      );
      assert.ok(Object.is(s(), to), `writing ${String(to)} over ${String(from)}: value not stored`);
      dispose();
    }
  });

  it('should support peek() without tracking', () => {
    const s = signal(10);
    let runs = 0;
    const dispose = effect(() => {
      s.peek();
      runs++;
    });
    assert.equal(runs, 1);
    s.set(20);
    assert.equal(runs, 1);
    dispose();
  });

  it('should support subscribe()', async () => {
    const s = signal(0);
    const values = [];
    const unsub = s.subscribe(v => values.push(v));
    assert.deepEqual(values, [0], 'initial value');
    s.set(1);
    await flush();
    s.set(2);
    await flush();
    unsub();
    s.set(3);
    await flush();
    assert.deepEqual(values, [0, 1, 2]);
  });
});

describe('computed', () => {
  it('should derive a value', () => {
    const a = signal(2);
    const b = signal(3);
    const sum = computed(() => a() + b());
    assert.equal(sum(), 5);
  });

  it('should update when deps change', () => {
    const a = signal(1);
    const doubled = computed(() => a() * 2);
    assert.equal(doubled(), 2);
    a.set(5);
    assert.equal(doubled(), 10);
  });

  it('should be lazy — not compute until read', () => {
    let runs = 0;
    const a = signal(1);
    const c = computed(() => { runs++; return a() * 2; });
    assert.equal(runs, 0);
    c();
    assert.equal(runs, 1);
  });
});

describe('effect', () => {
  it('should run immediately', () => {
    let ran = false;
    const dispose = effect(() => { ran = true; });
    assert.equal(ran, true);
    dispose();
  });

  it('should re-run when signal changes', async () => {
    const s = signal(0);
    const values = [];
    const dispose = effect(() => values.push(s()));
    s.set(1);
    await flush();
    s.set(2);
    await flush();
    assert.deepEqual(values, [0, 1, 2]);
    dispose();
  });

  it('should stop when disposed', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => { s(); runs++; });
    assert.equal(runs, 1);
    dispose();
    s.set(1);
    assert.equal(runs, 1);
  });

  it('should track dynamic deps', async () => {
    const cond = signal(true);
    const a = signal('A');
    const b = signal('B');
    const values = [];

    const dispose = effect(() => {
      values.push(cond() ? a() : b());
    });

    assert.deepEqual(values, ['A']);
    a.set('A2');
    await flush();
    assert.deepEqual(values, ['A', 'A2']);

    cond.set(false);
    await flush();
    assert.deepEqual(values, ['A', 'A2', 'B']);

    a.set('A3');
    await flush();
    assert.deepEqual(values, ['A', 'A2', 'B'], 'a no longer tracked');

    b.set('B2');
    await flush();
    assert.deepEqual(values, ['A', 'A2', 'B', 'B2']);
    dispose();
  });
});

describe('batch', () => {
  it('should batch multiple writes', () => {
    const a = signal(0);
    const b = signal(0);
    let runs = 0;

    const dispose = effect(() => { a(); b(); runs++; });
    assert.equal(runs, 1);

    batch(() => {
      a.set(1);
      b.set(1);
    });
    assert.equal(runs, 2);
    dispose();
  });

  it('should support nested batches', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => { s(); runs++; });

    batch(() => {
      s.set(1);
      batch(() => {
        s.set(2);
      });
      assert.equal(runs, 1);
    });
    assert.equal(runs, 2);
    dispose();
  });
});

describe('untrack', () => {
  it('should read without subscribing', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      untrack(() => s());
      runs++;
    });
    assert.equal(runs, 1);
    s.set(1);
    assert.equal(runs, 1);
    dispose();
  });
});
