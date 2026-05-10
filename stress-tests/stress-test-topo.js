// Stress Test: Topological ordering with complex diamond graphs
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, effect, batch, flushSync, createRoot } from '../packages/core/src/reactive.js';

// Helper: flush microtask queue
async function flush() {
  await new Promise(r => queueMicrotask(r));
  await new Promise(r => queueMicrotask(r));
}

describe('STRESS: Topological ordering - diamond graphs', () => {

  it('simple diamond: A -> B,C -> D should compute D exactly once', async () => {
    const a = signal(1);
    const b = computed(() => a() * 2);
    const c = computed(() => a() * 3);
    const d = computed(() => b() + c());

    assert.equal(d(), 5); // 2 + 3

    let runs = 0;
    const dispose = effect(() => { d(); runs++; });
    assert.equal(runs, 1);

    a.set(2);
    await flush();
    assert.equal(d(), 10); // 4 + 6
    assert.equal(runs, 2, 'effect should run exactly once for diamond update');
    dispose();
  });

  it('wide diamond: A -> B1..B10 -> C should see consistent state', async () => {
    const a = signal(1);
    const branches = [];
    for (let i = 0; i < 10; i++) {
      branches.push(computed(() => a() + i));
    }
    const c = computed(() => branches.reduce((sum, b) => sum + b(), 0));

    // Expected: sum(1+0, 1+1, ..., 1+9) = 10 + 45 = 55
    assert.equal(c(), 55);

    let lastSeen;
    let runs = 0;
    const dispose = effect(() => { lastSeen = c(); runs++; });
    assert.equal(runs, 1);

    a.set(10);
    await flush();
    // Expected: sum(10+0, 10+1, ..., 10+9) = 100 + 45 = 145
    assert.equal(c(), 145);
    assert.equal(lastSeen, 145, 'effect should see final consistent value');
    assert.equal(runs, 2, 'effect should run exactly once');
    dispose();
  });

  it('nested diamond: A -> B -> D, A -> C -> D, D -> E -> G, D -> F -> G', async () => {
    const a = signal(1);
    const b = computed(() => a() * 2);
    const c = computed(() => a() * 3);
    const d = computed(() => b() + c());
    const e = computed(() => d() * 10);
    const f = computed(() => d() + 1);
    const g = computed(() => e() + f());

    assert.equal(g(), 56); // (5*10) + (5+1) = 50 + 6 = 56

    let lastG;
    let runs = 0;
    const dispose = effect(() => { lastG = g(); runs++; });

    a.set(2);
    await flush();
    assert.equal(g(), 111); // d=10, e=100, f=11, g=111
    assert.equal(lastG, 111);
    assert.equal(runs, 2, 'effect should run exactly once for nested diamond');
    dispose();
  });

  it('deep chain: 100 chained computeds should not stack overflow', () => {
    const a = signal(0);
    let prev = a;
    for (let i = 0; i < 100; i++) {
      const dep = prev;
      prev = computed(() => dep() + 1);
    }
    assert.equal(prev(), 100);

    a.set(1);
    assert.equal(prev(), 101);
  });

  it('very deep chain: 1000 chained computeds (iterative eval)', () => {
    const a = signal(0);
    let prev = a;
    for (let i = 0; i < 1000; i++) {
      const dep = prev;
      prev = computed(() => dep() + 1);
    }
    assert.equal(prev(), 1000);

    a.set(5);
    assert.equal(prev(), 1005, 'Should handle 1000-deep chain without stack overflow');
  });

  it('extremely deep chain: 5000 chained computeds', () => {
    const a = signal(0);
    let prev = a;
    for (let i = 0; i < 5000; i++) {
      const dep = prev;
      prev = computed(() => dep() + 1);
    }
    assert.equal(prev(), 5000);

    a.set(10);
    assert.equal(prev(), 5010, 'Should handle 5000-deep chain');
  });

  it('multi-source diamond: two signals converge through computeds', async () => {
    const x = signal(1);
    const y = signal(10);
    const cx = computed(() => x() * 2);
    const cy = computed(() => y() * 3);
    const merged = computed(() => cx() + cy());

    assert.equal(merged(), 32); // 2 + 30

    let runs = 0;
    let lastVal;
    const dispose = effect(() => { lastVal = merged(); runs++; });

    // Update both signals in a batch
    batch(() => {
      x.set(5);
      y.set(20);
    });
    await flush();

    assert.equal(merged(), 70); // 10 + 60
    assert.equal(lastVal, 70);
    assert.equal(runs, 2, 'single effect run for batched update');
    dispose();
  });

  it('diamond with conditional branch: computed skips when condition is false', () => {
    const toggle = signal(true);
    const a = signal(1);
    const b = computed(() => toggle() ? a() * 2 : 0);
    const c = computed(() => a() * 3);
    const d = computed(() => b() + c());

    assert.equal(d(), 5); // 2 + 3

    toggle.set(false);
    assert.equal(d(), 3); // 0 + 3

    a.set(10);
    assert.equal(d(), 30); // 0 + 30
  });

  it('topological levels are correct after diamond resolution', async () => {
    // A (signal, level 0) -> B (computed, level 1) -> D (computed, level 2)
    // A (signal, level 0) -> C (computed, level 1) -> D (computed, level 2)
    // D -> effect (level 3)
    const a = signal(1);
    const b = computed(() => a() + 1);
    const c = computed(() => a() + 2);
    const d = computed(() => b() + c());

    let effectRuns = 0;
    const dispose = effect(() => {
      d();
      effectRuns++;
    });

    a.set(2);
    await flush();
    assert.equal(d(), 7); // 3 + 4
    assert.equal(effectRuns, 2);
    dispose();
  });
});

describe('STRESS: Batch consistency under complex graphs', () => {
  it('batch of 1000 writes to single signal should trigger effect once', async () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => { s(); runs++; });
    assert.equal(runs, 1);

    batch(() => {
      for (let i = 0; i < 1000; i++) {
        s.set(i);
      }
    });
    await flush();
    assert.equal(s(), 999);
    assert.equal(runs, 2, 'effect should run exactly once after batch');
    dispose();
  });

  it('batch updating 100 independent signals with one aggregator effect', async () => {
    const signals = Array.from({ length: 100 }, (_, i) => signal(i));
    let sum = 0;
    let runs = 0;
    const dispose = effect(() => {
      sum = signals.reduce((acc, s) => acc + s(), 0);
      runs++;
    });
    assert.equal(runs, 1);
    assert.equal(sum, 4950); // sum(0..99)

    batch(() => {
      for (const s of signals) s.set(s.peek() + 1);
    });
    await flush();
    assert.equal(sum, 5050); // sum(1..100)
    assert.equal(runs, 2, 'aggregator should run once');
    dispose();
  });
});
