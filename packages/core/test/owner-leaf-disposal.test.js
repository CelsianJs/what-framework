// Disposing an owner disposes every child: one with nothing to run (no
// children, no cleanups, as most server component frames are) is only
// marked, and is as disposed as the rest. Work attached to it later runs as
// work attached to any disposed owner does: a cleanup at once, an effect never
// again.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRoot, effect, flushSync, getOwner, onCleanup, runWithOwner, signal } from '../src/reactive.js';

describe('a child owner with nothing to dispose', () => {
  it('is disposed with its parent, beside children that hold cleanups and children', () => {
    const order = [];
    const leaves = [];
    let dispose;
    createRoot((d) => {
      dispose = d;
      createRoot(() => { leaves.push(getOwner()); });
      createRoot(() => {
        onCleanup(() => order.push('cleanup'));
        createRoot(() => { leaves.push(getOwner()); });
      });
      createRoot(() => { leaves.push(getOwner()); });
    });
    dispose();
    assert.deepEqual(order, ['cleanup']);

    const n = signal(0);
    for (const leaf of leaves) {
      let ran = false;
      runWithOwner(leaf, () => onCleanup(() => { ran = true; }));
      assert.equal(ran, true, 'a cleanup attached to a disposed owner runs at once');

      let runs = 0;
      runWithOwner(leaf, () => effect(() => { n(); runs++; }));
      const after = runs;
      n(n() + 1);
      flushSync();
      assert.equal(runs, after, 'an effect attached to a disposed owner does not run again');
    }
  });
});
