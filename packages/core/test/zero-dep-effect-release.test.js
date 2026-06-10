// SPRINT v0.11 C4 — zero-dependency effect auto-release.
// An effect that tracked zero signals on its first run can never be notified
// again (re-tracking only happens during a re-run, and a re-run requires a
// notification). If it also registered no cleanup, effect() releases it
// immediately: no dispose closure retained, no owner registration.
//
// MUST-KEEP semantics verified here:
//  - effects that RETURN a cleanup fn stay registered (cleanup runs on dispose)
//  - onCleanup() callbacks register with the root directly — unaffected
//  - untrack()/peek() reads produce zero deps by design — released, and the
//    (already impossible) re-fire stays impossible
//  - effects WITH deps behave exactly as before

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { signal, effect, untrack, createRoot, getOwner, onCleanup, flushSync } =
  await import('../src/reactive.js');

describe('zero-dep effect auto-release (C4)', () => {
  it('zero-dep effect is NOT registered with the owning root', () => {
    createRoot((dispose) => {
      effect(() => { /* reads nothing */ });
      assert.equal(getOwner().disposals.length, 0,
        'zero-dep effect must not be retained by the root');

      const s = signal(0);
      effect(() => { s(); });
      assert.equal(getOwner().disposals.length, 1,
        'tracked effect must still register with the root');
      dispose();
    });
  });

  it('returns a callable (noop) dispose function', () => {
    const d = effect(() => {});
    assert.equal(typeof d, 'function');
    assert.doesNotThrow(() => { d(); d(); });
  });

  it('effect with a returned cleanup fn is retained and cleaned up on root dispose', () => {
    let cleaned = 0;
    createRoot((dispose) => {
      effect(() => () => { cleaned++; });
      assert.equal(getOwner().disposals.length, 1,
        'cleanup-returning effect must stay registered');
      dispose();
    });
    assert.equal(cleaned, 1, 'cleanup must run on root disposal');
  });

  it('onCleanup() inside a zero-dep effect still runs on root disposal', () => {
    let ran = 0;
    createRoot((dispose) => {
      effect(() => { onCleanup(() => { ran++; }); });
      dispose();
    });
    assert.equal(ran, 1);
  });

  it('untrack() reads → released; signal writes never re-run it (unchanged semantics)', () => {
    const s = signal(0);
    let runs = 0;
    createRoot((dispose) => {
      effect(() => { runs++; untrack(() => s()); });
      assert.equal(getOwner().disposals.length, 0, 'untrack-only effect released');
      s(42);
      flushSync();
      assert.equal(runs, 1, 'untracked effect must not re-fire');
      dispose();
    });
  });

  it('peek() reads → released; never re-fires', () => {
    const s = signal(1);
    let runs = 0;
    effect(() => { runs++; s.peek(); });
    s(2);
    flushSync();
    assert.equal(runs, 1);
  });

  it('effects WITH deps still re-fire and dispose normally', () => {
    const s = signal(0);
    let runs = 0;
    const d = effect(() => { runs++; s(); });
    s(1);
    flushSync();
    assert.equal(runs, 2);
    d();
    s(2);
    flushSync();
    assert.equal(runs, 2, 'disposed effect must not re-fire');
  });

  it('zero-dep effect that performed a side effect still ran exactly once', () => {
    let sideEffects = 0;
    effect(() => { sideEffects++; });
    assert.equal(sideEffects, 1);
  });
});
