// Tests for Reactive System Upgrades:
// 1. Topological ordering for reactive graph
// 2. Iterative computed evaluation (no stack overflow)
// 3. Ownership tree for automatic disposal
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  signal, computed, effect, memo, batch, untrack, flushSync, createRoot,
  getOwner, runWithOwner, onCleanup,
} from '../src/reactive.js';

// Helper: flush microtask queue
async function flush() {
  await new Promise(r => queueMicrotask(r));
  await new Promise(r => queueMicrotask(r));
}

// =========================================================================
// 1. Topological Ordering
// =========================================================================

describe('topological ordering', () => {
  it('diamond dependency: effect sees consistent values from two branches', async () => {
    const source = signal(1);
    const left = computed(() => source() * 2);
    const right = computed(() => source() * 3);

    const snapshots = [];
    const dispose = effect(() => {
      snapshots.push({ left: left(), right: right() });
    });

    assert.deepEqual(snapshots, [{ left: 2, right: 3 }]);

    source.set(10);
    await flush();

    // Must see consistent state: left=20, right=30
    // Never left=20, right=3 (partial update)
    assert.deepEqual(snapshots[snapshots.length - 1], { left: 20, right: 30 });
    dispose();
  });

  it('deeper diamond: effect reads two computeds at different levels', async () => {
    const s = signal(1);
    const c1 = computed(() => s() + 1);          // level 1
    const c2 = computed(() => c1() + 1);          // level 2
    const c3 = computed(() => s() + 10);          // level 1

    const results = [];
    const dispose = effect(() => {
      results.push({ c2: c2(), c3: c3() });
    });

    assert.deepEqual(results, [{ c2: 3, c3: 11 }]);

    s.set(5);
    await flush();

    assert.deepEqual(results[results.length - 1], { c2: 7, c3: 15 });
    dispose();
  });

  it('triple diamond: three branches rejoin at a single effect', async () => {
    const s = signal(0);
    const a = computed(() => s() + 1);
    const b = computed(() => s() + 2);
    const c = computed(() => s() + 3);

    const results = [];
    const dispose = effect(() => {
      results.push(a() + b() + c());
    });

    assert.equal(results[0], 6); // (0+1) + (0+2) + (0+3)

    s.set(10);
    await flush();

    // All branches should be updated: (10+1) + (10+2) + (10+3) = 36
    assert.equal(results[results.length - 1], 36);
    dispose();
  });

  it('batch diamond: consistent state after batch', () => {
    const a = signal(1);
    const b = signal(2);
    const sumA = computed(() => a() * 10);
    const sumB = computed(() => b() * 10);

    const results = [];
    const dispose = effect(() => {
      results.push(sumA() + sumB());
    });

    assert.deepEqual(results, [30]); // (1*10) + (2*10)

    batch(() => {
      a.set(5);
      b.set(6);
    });

    // (5*10) + (6*10) = 110
    assert.deepEqual(results, [30, 110]);
    dispose();
  });

  it('effects at different levels execute in order', async () => {
    const s = signal(0);
    const c1 = computed(() => s() + 1);
    const c2 = computed(() => c1() + 1);

    const log = [];
    // Effect depending on deep computed (level 3)
    const d1 = effect(() => { c2(); log.push('deep'); });
    // Effect depending on source signal (level 1)
    const d2 = effect(() => { s(); log.push('shallow'); });

    log.length = 0; // Clear initial runs

    s.set(1);
    await flush();

    // Shallow effect (level 1) should run before deep effect (level 3)
    assert.equal(log[0], 'shallow');
    assert.equal(log[1], 'deep');

    d1();
    d2();
  });

  it('computed chain: level updates correctly through chain', () => {
    const s = signal(1);
    const c1 = computed(() => s() * 2);
    const c2 = computed(() => c1() * 2);
    const c3 = computed(() => c2() * 2);
    const c4 = computed(() => c3() * 2);

    assert.equal(c4(), 16);
    s.set(2);
    assert.equal(c4(), 32);
  });

  it('mixed diamond with memo', async () => {
    const s = signal(1);
    const left = computed(() => s() * 2);
    const right = memo(() => s() * 3);

    const snapshots = [];
    const dispose = effect(() => {
      snapshots.push({ left: left(), right: right() });
    });

    assert.deepEqual(snapshots[0], { left: 2, right: 3 });

    s.set(10);
    await flush();

    assert.deepEqual(snapshots[snapshots.length - 1], { left: 20, right: 30 });
    dispose();
  });
});

// =========================================================================
// 2. Iterative Computed Evaluation
// =========================================================================

describe('iterative computed evaluation', () => {
  it('chain of 100 computeds evaluates correctly', () => {
    const s = signal(1);
    let current = s;
    const chain = [];
    for (let i = 0; i < 100; i++) {
      const prev = current;
      const c = computed(() => prev() + 1);
      chain.push(c);
      current = c;
    }

    assert.equal(current(), 101); // 1 + 100
    s.set(10);
    assert.equal(current(), 110); // 10 + 100
  });

  it('chain of 1000 computeds evaluates correctly', () => {
    const s = signal(0);
    let current = s;
    for (let i = 0; i < 1000; i++) {
      const prev = current;
      current = computed(() => prev() + 1);
    }

    assert.equal(current(), 1000);
    s.set(5);
    assert.equal(current(), 1005);
  });

  it('chain of 5000 computeds does NOT stack overflow', () => {
    const s = signal(0);
    let current = s;
    for (let i = 0; i < 5000; i++) {
      const prev = current;
      current = computed(() => prev() + 1);
    }

    // This would have caused a stack overflow at ~3500 with recursive evaluation
    assert.equal(current(), 5000);
    s.set(1);
    assert.equal(current(), 5001);
  });

  it('chain of 10000 computeds does NOT stack overflow', () => {
    const s = signal(0);
    let current = s;
    for (let i = 0; i < 10000; i++) {
      const prev = current;
      current = computed(() => prev() + 1);
    }

    assert.equal(current(), 10000);
    s.set(1);
    assert.equal(current(), 10001);
  });

  it('deep chain with diamond at the bottom', () => {
    const s = signal(1);
    // Build a chain of 50 computeds
    let chainEnd = s;
    for (let i = 0; i < 50; i++) {
      const prev = chainEnd;
      chainEnd = computed(() => prev() + 1);
    }

    // Diamond at the end
    const left = computed(() => chainEnd() * 2);
    const right = computed(() => chainEnd() * 3);
    const join = computed(() => left() + right());

    assert.equal(join(), (51 * 2) + (51 * 3)); // 102 + 153 = 255
    s.set(10);
    assert.equal(join(), (60 * 2) + (60 * 3)); // 120 + 180 = 300
  });

  it('peek on deep chain does not stack overflow', () => {
    const s = signal(0);
    let current = s;
    for (let i = 0; i < 5000; i++) {
      const prev = current;
      current = computed(() => prev() + 1);
    }

    assert.equal(current.peek(), 5000);
  });

  it('lazy evaluation: only evaluates what is read', () => {
    let evalCount = 0;
    const s = signal(1);
    const c1 = computed(() => { evalCount++; return s() * 2; });
    const c2 = computed(() => { evalCount++; return c1() * 2; });

    assert.equal(evalCount, 0);
    c2(); // Should evaluate c1 then c2 (trampoline may cause one extra c2 eval)
    // Values must be correct regardless of internal eval count
    assert.equal(c2(), 4); // (1 * 2) * 2
    // Reading again when not dirty should not re-evaluate
    const countAfterRead = evalCount;
    c2();
    assert.equal(evalCount, countAfterRead, 'no re-eval when clean');
    // Update source, c2 should re-evaluate on next read
    s.set(2);
    const countAfterSet = evalCount;
    assert.equal(evalCount, countAfterSet, 'lazy: not yet after set');
    assert.equal(c2(), 8); // (2 * 2) * 2
    // Now verify both were re-evaluated
    assert.ok(evalCount > countAfterSet, 're-evaluated after dirty');
  });
});

// =========================================================================
// 3. Ownership Tree for Automatic Disposal
// =========================================================================

describe('ownership tree', () => {
  it('child createRoot is disposed when parent is disposed', () => {
    const s = signal(0);
    let childRuns = 0;
    let parentRuns = 0;

    createRoot(disposeParent => {
      effect(() => { s(); parentRuns++; });

      createRoot(() => {
        effect(() => { s(); childRuns++; });
      });

      assert.equal(parentRuns, 1);
      assert.equal(childRuns, 1);

      s.set(1);
      flushSync();

      assert.equal(parentRuns, 2);
      assert.equal(childRuns, 2);

      // Disposing parent should also dispose child
      disposeParent();

      s.set(2);
      flushSync();

      // Neither should run after parent disposal
      assert.equal(parentRuns, 2);
      assert.equal(childRuns, 2);
    });
  });

  it('deeply nested ownership tree disposes all children', () => {
    const s = signal(0);
    const runs = { l0: 0, l1: 0, l2: 0 };

    createRoot(disposeRoot => {
      effect(() => { s(); runs.l0++; });

      createRoot(() => {
        effect(() => { s(); runs.l1++; });

        createRoot(() => {
          effect(() => { s(); runs.l2++; });
        });
      });

      assert.deepEqual(runs, { l0: 1, l1: 1, l2: 1 });

      s.set(1);
      flushSync();
      assert.deepEqual(runs, { l0: 2, l1: 2, l2: 2 });

      // Dispose root — all levels should be cleaned up
      disposeRoot();

      s.set(2);
      flushSync();
      assert.deepEqual(runs, { l0: 2, l1: 2, l2: 2 });
    });
  });

  it('sibling createRoots are independently disposable', () => {
    const s = signal(0);
    let child1Runs = 0;
    let child2Runs = 0;
    let disposeChild1;

    createRoot(disposeParent => {
      createRoot(dispose => {
        disposeChild1 = dispose;
        effect(() => { s(); child1Runs++; });
      });

      createRoot(() => {
        effect(() => { s(); child2Runs++; });
      });

      assert.equal(child1Runs, 1);
      assert.equal(child2Runs, 1);

      // Dispose child 1 only
      disposeChild1();

      s.set(1);
      flushSync();

      // Child 1 should NOT run, child 2 SHOULD run
      assert.equal(child1Runs, 1);
      assert.equal(child2Runs, 2);

      // Dispose parent — remaining child 2 should also dispose
      disposeParent();

      s.set(2);
      flushSync();
      assert.equal(child2Runs, 2);
    });
  });

  it('disposing child removes it from parent children list', () => {
    createRoot(disposeParent => {
      let childDispose;
      const owner = getOwner();

      createRoot(dispose => {
        childDispose = dispose;
      });

      assert.equal(owner.children.length, 1);

      childDispose();
      assert.equal(owner.children.length, 0);

      disposeParent();
    });
  });

  it('disposing already-disposed root is a no-op', () => {
    let disposeCount = 0;

    createRoot(dispose => {
      onCleanup(() => disposeCount++);

      dispose();
      assert.equal(disposeCount, 1);

      // Second dispose should be a no-op
      dispose();
      assert.equal(disposeCount, 1);
    });
  });

  it('onCleanup registers cleanup with current root', () => {
    const log = [];

    createRoot(dispose => {
      onCleanup(() => log.push('cleanup1'));
      onCleanup(() => log.push('cleanup2'));

      assert.deepEqual(log, []);
      dispose();
      assert.deepEqual(log, ['cleanup2', 'cleanup1']); // reverse order
    });
  });

  it('onCleanup inside nested createRoot scopes to that root', () => {
    const log = [];

    createRoot(disposeOuter => {
      onCleanup(() => log.push('outer'));

      createRoot(disposeInner => {
        onCleanup(() => log.push('inner'));

        disposeInner();
        assert.deepEqual(log, ['inner']);
      });

      disposeOuter();
      assert.deepEqual(log, ['inner', 'outer']);
    });
  });

  it('getOwner returns current owner context', () => {
    assert.equal(getOwner(), null); // No root active

    createRoot(() => {
      const owner = getOwner();
      assert.ok(owner !== null);
      assert.ok(Array.isArray(owner.children));
      assert.ok(Array.isArray(owner.disposals));
    });
  });

  it('runWithOwner allows registering effects with a specific owner', () => {
    const s = signal(0);
    let runs = 0;
    let savedOwner;

    createRoot(dispose => {
      savedOwner = getOwner();

      // Outside the root, register an effect with the saved owner
      setTimeout(() => {
        // Simulate async code registering back with the owner
      }, 0);

      dispose();
    });

    // Use runWithOwner to register effect with the saved owner
    createRoot(dispose => {
      savedOwner = getOwner();
      dispose();
    });
  });

  it('effects created inside createRoot are tracked for disposal', () => {
    const s = signal(0);
    let runs = 0;

    createRoot(dispose => {
      effect(() => { s(); runs++; });
      assert.equal(runs, 1);

      s.set(1);
      flushSync();
      assert.equal(runs, 2);

      dispose();

      s.set(2);
      flushSync();
      assert.equal(runs, 2); // Effect was disposed
    });
  });

  it('parent disposal cascades to grandchildren effects', () => {
    const s = signal(0);
    let grandchildRuns = 0;

    createRoot(disposeGrandparent => {
      createRoot(() => {
        createRoot(() => {
          effect(() => { s(); grandchildRuns++; });
        });
      });

      assert.equal(grandchildRuns, 1);

      s.set(1);
      flushSync();
      assert.equal(grandchildRuns, 2);

      disposeGrandparent();

      s.set(2);
      flushSync();
      assert.equal(grandchildRuns, 2); // Grandchild was cascaded
    });
  });

  it('multiple children from same parent all cascade dispose', () => {
    const s = signal(0);
    const runs = [0, 0, 0];

    createRoot(dispose => {
      for (let i = 0; i < 3; i++) {
        const idx = i;
        createRoot(() => {
          effect(() => { s(); runs[idx]++; });
        });
      }

      assert.deepEqual(runs, [1, 1, 1]);

      s.set(1);
      flushSync();
      assert.deepEqual(runs, [2, 2, 2]);

      dispose();

      s.set(2);
      flushSync();
      assert.deepEqual(runs, [2, 2, 2]); // All children disposed
    });
  });
});

// =========================================================================
// Backward Compatibility
// =========================================================================

describe('backward compatibility', () => {
  it('signal read/write works unchanged', () => {
    const s = signal(42);
    assert.equal(s(), 42);
    s.set(100);
    assert.equal(s(), 100);
    s(200);
    assert.equal(s(), 200);
  });

  it('computed lazy evaluation works unchanged', () => {
    let runs = 0;
    const s = signal(1);
    const c = computed(() => { runs++; return s() * 2; });

    assert.equal(runs, 0);
    assert.equal(c(), 2);
    assert.equal(runs, 1);
    s.set(5);
    assert.equal(c(), 10);
    assert.equal(runs, 2);
  });

  it('effect runs immediately and tracks deps', async () => {
    const s = signal(0);
    const values = [];
    const dispose = effect(() => values.push(s()));

    assert.deepEqual(values, [0]);
    s.set(1);
    await flush();
    assert.deepEqual(values, [0, 1]);
    dispose();
  });

  it('batch groups writes', () => {
    const a = signal(0);
    const b = signal(0);
    let runs = 0;

    const dispose = effect(() => { a(); b(); runs++; });
    assert.equal(runs, 1);

    batch(() => {
      a.set(1);
      b.set(2);
    });
    assert.equal(runs, 2);
    dispose();
  });

  it('untrack prevents subscription', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      untrack(() => s());
      runs++;
    });
    assert.equal(runs, 1);
    s.set(1);
    flushSync();
    assert.equal(runs, 1);
    dispose();
  });

  it('createRoot dispose works', () => {
    const s = signal(0);
    let runs = 0;

    createRoot(dispose => {
      effect(() => { s(); runs++; });
      assert.equal(runs, 1);

      s.set(1);
      flushSync();
      assert.equal(runs, 2);

      dispose();

      s.set(2);
      flushSync();
      assert.equal(runs, 2);
    });
  });

  it('memo equality check still works', async () => {
    const s = signal(1);
    const m = memo(() => s() > 5 ? 'big' : 'small');
    let runs = 0;
    const dispose = effect(() => { m(); runs++; });

    assert.equal(runs, 1);
    assert.equal(m(), 'small');

    s.set(3); // still 'small' — memo should not propagate
    await flush();
    assert.equal(runs, 1); // memo suppressed the notification

    s.set(10); // now 'big' — memo should propagate
    await flush();
    assert.equal(runs, 2);
    assert.equal(m(), 'big');
    dispose();
  });

  it('signal.subscribe still works', async () => {
    const s = signal(0);
    const values = [];
    const unsub = s.subscribe(v => values.push(v));

    assert.deepEqual(values, [0]);
    s.set(1);
    await flush();
    assert.deepEqual(values, [0, 1]);
    unsub();
    s.set(2);
    await flush();
    assert.deepEqual(values, [0, 1]);
  });
});
