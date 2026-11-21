// createSelector(source): isSelected(key) is `key === source()`, but a reader
// re-runs only when its own key gains or loses the selection (T2-2).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

const { signal, computed, effect, flushSync, createRoot, _createItemScope } = await import('../src/reactive.js');
const { createSelector } = await import('../src/index.js');

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc');

// One reader per key, each in its own scope (as list rows are), counting runs.
function readers(isSelected, keys) {
  const runs = new Map(keys.map(k => [k, 0]));
  const values = new Map();
  const disposers = keys.map(key => _createItemScope((dispose) => {
    effect(() => {
      values.set(key, isSelected(key));
      runs.set(key, runs.get(key) + 1);
    });
    return dispose;
  }));
  return { runs, values, disposers };
}

describe('createSelector', () => {
  it('answers key === source()', () => {
    const selected = signal(2);
    const isSelected = createSelector(selected);
    assert.equal(isSelected(2), true);
    assert.equal(isSelected(3), false);
    assert.equal(isSelected('2'), false, 'strict equality, as the comparison it replaces');
  });

  it('re-runs only the readers of the keys a change leaves and enters', () => {
    const selected = signal(1);
    const isSelected = createSelector(selected);
    const keys = Array.from({ length: 100 }, (_, i) => i);
    const { runs, values } = readers(isSelected, keys);
    for (const k of keys) runs.set(k, 0);

    selected(42);
    flushSync();
    const reran = keys.filter(k => runs.get(k) > 0);
    assert.deepEqual(reran, [1, 42]);
    assert.equal(values.get(1), false);
    assert.equal(values.get(42), true);

    selected(-1); // a key nobody reads: only the old one re-runs
    flushSync();
    assert.equal(runs.get(42), 2);
    assert.equal(keys.reduce((n, k) => n + runs.get(k), 0), 3);
  });

  it('returns the new answer right after a write, before effects run', () => {
    const selected = signal('a');
    const isSelected = createSelector(selected);
    selected('b');
    assert.equal(isSelected('b'), true);
    assert.equal(isSelected('a'), false);
  });

  it('accepts a computed source', () => {
    const raw = signal(3);
    const isSelected = createSelector(computed(() => raw() * 2));
    const { values } = readers(isSelected, [6, 8]);
    assert.equal(values.get(6), true);
    raw(4);
    flushSync();
    assert.equal(values.get(6), false);
    assert.equal(values.get(8), true);
  });

  it('tracks the source itself for a reader with no owner', () => {
    const selected = signal(1);
    const isSelected = createSelector(selected);
    const seen = [];
    effect(() => { seen.push(isSelected(5)); });
    selected(5);
    flushSync();
    assert.deepEqual(seen, [false, true]);
  });

  it('keeps nothing for keys whose readers are gone', async () => {
    const selected = signal(null);
    const isSelected = createSelector(selected);
    let refs = [];
    // Object keys, so retention is observable through WeakRef.
    (() => {
      const keys = Array.from({ length: 50 }, (_, i) => ({ i }));
      refs = keys.map(k => new WeakRef(k));
      const { disposers } = readers(isSelected, keys);
      for (const dispose of disposers) dispose();
    })();
    await new Promise(r => setTimeout(r, 0));
    gc();
    await new Promise(r => setTimeout(r, 0));
    gc();
    assert.equal(refs.filter(r => r.deref() !== undefined).length, 0, 'no key is retained by the selector');
  });

  it('keeps a key alive while any reader of it remains', () => {
    const selected = signal(0);
    const isSelected = createSelector(selected);
    const a = readers(isSelected, [7]);
    const b = readers(isSelected, [7]);
    a.disposers[0]();
    selected(7);
    flushSync();
    assert.equal(b.values.get(7), true, 'the remaining reader is still notified');
  });

  it('stops notifying once its owner is disposed', () => {
    const selected = signal(0);
    let runs = 0;
    const dispose = createRoot((d) => {
      const isSelected = createSelector(selected);
      _createItemScope(() => { effect(() => { isSelected(1); runs++; }); });
      return d;
    });
    dispose();
    selected(1);
    flushSync();
    assert.equal(runs, 1);
  });

  it('rejects a source that is not a function', () => {
    assert.throws(() => createSelector(5), TypeError);
  });
});
