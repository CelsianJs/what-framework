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
