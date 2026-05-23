// Regression: createStore action return values must propagate to callers.
// Before the fix, actions were called inside `batch(() => fn.apply(...))` but
// the result of `fn.apply` was discarded — so `const id = store.addBoard()`
// silently produced `undefined`, breaking downstream navigation/etc.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';

describe('createStore action return values', () => {
  it('returns the action function result to the caller', () => {
    const useStore = createStore({
      items: [],
      addItem(text) {
        const id = 'i-' + this.items.length;
        this.items = [...this.items, { id, text }];
        return id;
      },
    });
    const s = useStore();
    const id = s.addItem('hello');
    assert.equal(id, 'i-0');
    const id2 = s.addItem('world');
    assert.equal(id2, 'i-1');
    assert.equal(s.items.length, 2);
  });

  it('returns null/falsy values verbatim (does not coerce)', () => {
    const useStore = createStore({
      n: 0,
      maybeAdd() {
        if (this.n >= 1) return null;
        this.n = this.n + 1;
        return 'added';
      },
    });
    const s = useStore();
    assert.equal(s.maybeAdd(), 'added');
    assert.equal(s.maybeAdd(), null);
  });

  it('returns undefined for void actions (no spurious return)', () => {
    const useStore = createStore({
      count: 0,
      inc() { this.count = this.count + 1; },
    });
    const s = useStore();
    const r = s.inc();
    assert.equal(r, undefined);
    assert.equal(s.count, 1);
  });
});
