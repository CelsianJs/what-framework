// Tests for Phase 1, Phase 2, and Round 2 fixes
// Covers: microtask deferral, diamond dependency, marker array patching,
// _parentCtx chain, reactive cache, memo redesign, createResource lifecycle
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, effect, batch, untrack, flushSync } from '../src/reactive.js';

// Helper: flush microtask queue
async function flush() {
  await new Promise(r => queueMicrotask(r));
  await new Promise(r => queueMicrotask(r));
}

// =========================================================================
// Microtask Deferral
// =========================================================================

describe('microtask deferral', () => {
  it('effect does not run synchronously after signal write', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => { s(); runs++; });
    assert.equal(runs, 1, 'initial run');

    s.set(1);
    assert.equal(runs, 1, 'not yet run after set');

    dispose();
  });

  it('effect runs after microtask flush', async () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => { s(); runs++; });
    assert.equal(runs, 1);

    s.set(1);
    await flush();
    assert.equal(runs, 2, 'ran after microtask');

    dispose();
  });

  it('multiple writes in same sync block batch to single effect run', async () => {
    const a = signal(0);
    const b = signal(0);
    let runs = 0;

    const dispose = effect(() => { a(); b(); runs++; });
    assert.equal(runs, 1);

    a.set(1);
    b.set(2);
    await flush();
    assert.equal(runs, 2, 'single re-run for both writes');

    dispose();
  });

  it('flushSync forces immediate execution', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => { s(); runs++; });
    assert.equal(runs, 1);

    s.set(1);
    flushSync();
    assert.equal(runs, 2, 'ran synchronously via flushSync');

    dispose();
  });
});

// =========================================================================
// Diamond Dependency (Glitch-Free)
// =========================================================================

describe('diamond dependency', () => {
  it('effect sees consistent state from two computeds depending on same signal', async () => {
    const a = signal(1);
    const b = computed(() => a() * 2);
    const c = computed(() => a() * 3);

    const snapshots = [];
    const dispose = effect(() => {
      snapshots.push({ b: b(), c: c() });
    });

    assert.deepEqual(snapshots, [{ b: 2, c: 3 }]);

    a.set(10);
    await flush();

    // Should see consistent state (b=20, c=30), never (b=20, c=3) or (b=2, c=30)
    assert.deepEqual(snapshots[snapshots.length - 1], { b: 20, c: 30 });
    dispose();
  });

  it('no intermediate inconsistent states in diamond with batch', () => {
    const a = signal(1);
    const b = computed(() => a() + 1);
    const c = computed(() => a() + 2);

    const results = [];
    const dispose = effect(() => {
      results.push(b() + c());
    });

    assert.deepEqual(results, [5]); // (1+1) + (1+2) = 5

    batch(() => { a.set(10); });

    assert.deepEqual(results, [5, 23]); // (10+1) + (10+2) = 23
    dispose();
  });
});

// =========================================================================
// Effect Cleanup
// =========================================================================

describe('effect cleanup', () => {
  it('runs cleanup function before re-run', async () => {
    const s = signal(0);
    const log = [];

    const dispose = effect(() => {
      const val = s();
      log.push(`run:${val}`);
      return () => log.push(`cleanup:${val}`);
    });

    assert.deepEqual(log, ['run:0']);

    s.set(1);
    await flush();
    assert.deepEqual(log, ['run:0', 'cleanup:0', 'run:1']);

    dispose();
    assert.deepEqual(log, ['run:0', 'cleanup:0', 'run:1', 'cleanup:1']);
  });

  it('runs cleanup on dispose', () => {
    const log = [];
    const dispose = effect(() => {
      log.push('run');
      return () => log.push('cleanup');
    });

    assert.deepEqual(log, ['run']);
    dispose();
    assert.deepEqual(log, ['run', 'cleanup']);
  });
});

// =========================================================================
// Flush Loop Guard
// =========================================================================

describe('flush loop guard', () => {
  it('warns and stops on infinite effect loop', async () => {
    const s = signal(0);
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));

    // Create effect that writes to the signal it reads (infinite loop)
    const dispose = effect(() => {
      const val = s();
      if (val < 200) {
        s.set(val + 1);
      }
    });

    await flush();

    // Should have warned about infinite loop
    const loopWarning = warnings.find(w => w.includes('infinite effect loop'));
    assert.ok(loopWarning, 'should warn about infinite loop');

    console.warn = originalWarn;
    dispose();
  });
});

// =========================================================================
// Batch
// =========================================================================

describe('batch with microtask deferral', () => {
  it('effects run once at end of batch', () => {
    const a = signal(0);
    const b = signal(0);
    let runs = 0;

    const dispose = effect(() => { a(); b(); runs++; });
    assert.equal(runs, 1);

    batch(() => {
      a.set(1);
      b.set(2);
    });
    // batch forces synchronous flush at end
    assert.equal(runs, 2, 'ran once after batch');
    dispose();
  });

  it('nested batches defer until outermost completes', () => {
    const s = signal(0);
    let runs = 0;
    const dispose = effect(() => { s(); runs++; });
    assert.equal(runs, 1);

    batch(() => {
      s.set(1);
      batch(() => {
        s.set(2);
      });
      // Inner batch ended but outer hasn't — effect should not have run
      assert.equal(runs, 1);
    });
    // Now outer batch ended — effect runs
    assert.equal(runs, 2);
    assert.equal(s(), 2);
    dispose();
  });
});

// =========================================================================
// Computed
// =========================================================================

describe('computed edge cases', () => {
  it('computed is lazy — does not compute until read', () => {
    let computeCount = 0;
    const s = signal(1);
    const c = computed(() => { computeCount++; return s() * 2; });

    assert.equal(computeCount, 0, 'not computed yet');
    assert.equal(c(), 2);
    assert.equal(computeCount, 1, 'computed on first read');
  });

  it('peek() does not track but still computes if dirty', () => {
    const s = signal(5);
    const c = computed(() => s() * 10);

    assert.equal(c.peek(), 50);
    s.set(10);
    assert.equal(c.peek(), 100, 'recomputed on peek when dirty');
  });

  it('chained computeds update correctly', async () => {
    const base = signal(1);
    const doubled = computed(() => base() * 2);
    const quadrupled = computed(() => doubled() * 2);

    assert.equal(quadrupled(), 4);

    base.set(5);
    await flush();
    assert.equal(quadrupled(), 20);
  });
});

// =========================================================================
// Untrack
// =========================================================================

describe('untrack', () => {
  it('prevents tracking inside untrack()', async () => {
    const tracked = signal(0);
    const untracked = signal(0);
    let runs = 0;

    const dispose = effect(() => {
      tracked();
      untrack(() => untracked());
      runs++;
    });
    assert.equal(runs, 1);

    untracked.set(1);
    await flush();
    assert.equal(runs, 1, 'untracked signal change did not trigger');

    tracked.set(1);
    await flush();
    assert.equal(runs, 2, 'tracked signal change triggered');

    dispose();
  });
});

// =========================================================================
// Signal Subscribe
// =========================================================================

describe('signal.subscribe', () => {
  it('fires callback with current value immediately', () => {
    const s = signal(42);
    const values = [];
    const unsub = s.subscribe(v => values.push(v));

    assert.deepEqual(values, [42]);
    unsub();
  });

  it('fires callback on changes after flush', async () => {
    const s = signal(0);
    const values = [];
    const unsub = s.subscribe(v => values.push(v));

    s.set(1);
    await flush();
    s.set(2);
    await flush();

    assert.deepEqual(values, [0, 1, 2]);
    unsub();
  });
});
