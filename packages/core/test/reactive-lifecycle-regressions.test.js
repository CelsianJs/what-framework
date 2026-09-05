import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const production = process.env.WHAT_TEST_PRODUCTION === '1';
const reactive = await import(production ? '../dist/index.min.js' : '../src/reactive.js');
const { signal, computed, effect, flushSync, createRoot, getOwner } = reactive;
const memo = production ? reactive.signalMemo : reactive.memo;
const onCleanup = production ? reactive.onRootCleanup : reactive.onCleanup;

describe('late reactive dependencies', () => {
  it('settles ordinary writes on microtasks even after repeated one-dependency runs', async () => {
    const value = signal(0);
    let runs = 0;
    const dispose = effect(() => { value(); runs++; });
    try {
      value(1); await Promise.resolve();
      value(2); await Promise.resolve();
      const before = runs;
      value(3); value(4);
      assert.equal(runs, before);
      await Promise.resolve();
      assert.equal(runs, before + 1);
    } finally { dispose(); }
  });

  for (const kind of ['effect', 'computed', 'memo']) {
    it(`${kind} tracks a branch revealed after repeated single-dependency runs`, () => {
      const gate = signal(0);
      const detail = signal('initial');
      let seen;
      const dispose = createRoot(dispose => {
        const read = () => gate() >= 2 ? detail() : 'closed';
        const derive = kind === 'computed' ? computed(read) : kind === 'memo' ? memo(read) : read;
        effect(() => { seen = derive(); });
        return dispose;
      });
      try {
        gate(1); flushSync();
        gate(2); flushSync();
        detail('updated'); flushSync();
        assert.equal(seen, 'updated');
        gate(0); flushSync();
        detail('hidden'); flushSync();
        assert.equal(seen, 'closed');
        gate(2); flushSync();
        assert.equal(seen, 'hidden');
      } finally { dispose(); }
    });
  }

  it('retains the explicitly stable compiler effect path', () => {
    const value = signal(0);
    let seen;
    const dispose = effect(() => { seen = value(); }, { stable: true });
    value(1);
    assert.equal(seen, 1, 'explicitly stable effects still run inline');
    dispose();
    value(2);
    assert.equal(seen, 1);
  });

  it('updates a real text binding after a late branch opens', async () => {
    installDOM();
    const { h, mount } = await import(production ? '../dist/index.min.js' : '../src/index.js');
    const gate = signal(0);
    const detail = signal('initial');
    const container = document.createElement('div');
    const unmount = mount(h('p', {}, () => gate() >= 2 ? detail() : 'closed'), container);
    try {
      gate(1); flushSync();
      gate(2); flushSync();
      detail('updated'); flushSync();
      assert.equal(container.textContent, 'updated');
    } finally { unmount(); }
  });
});

describe('owned computed lifetime', () => {
  it('releases each inner effect when its root is disposed', () => {
    const shared = signal(0);
    const derivedValues = [];
    for (let i = 0; i < 100; i++) {
      const dispose = createRoot(dispose => {
        const derived = computed(() => shared() + i);
        derivedValues.push(derived);
        effect(() => derived());
        return dispose;
      });
      dispose();
    }
    if (!production) assert.equal(shared._subs.size, 0);
    shared(1);
    assert.deepEqual(derivedValues.map(read => read()), Array.from({ length: 100 }, (_, i) => i));
  });

  it('reads the last cached value after disposal without re-subscribing', () => {
    const value = signal(1);
    let derived, evaluations = 0;
    const dispose = createRoot(dispose => {
      derived = computed(() => { evaluations++; return value(); });
      assert.equal(derived(), 1);
      return dispose;
    });
    value(2); // Leave the computed dirty at disposal.
    dispose();
    assert.equal(derived(), 1);
    assert.equal(derived.peek(), 1);
    value(3);
    assert.equal(evaluations, 1);
    if (!production) assert.equal(value._subs.size, 0);
  });

  it('does not evaluate an unread computed after its owner is disposed', () => {
    let derived, evaluations = 0;
    const dispose = createRoot(dispose => {
      derived = computed(() => ++evaluations);
      return dispose;
    });
    dispose();
    assert.equal(derived(), undefined);
    assert.equal(evaluations, 0);
  });
});

describe('failure-safe ownership disposal', () => {
  it('allows a child cleanup to dispose a sibling while its parent is disposing', () => {
    const cleaned = [];
    const dispose = createRoot(dispose => {
      const disposeSibling = createRoot(dispose => {
        onCleanup(() => cleaned.push('sibling'));
        return dispose;
      });
      createRoot(() => { onCleanup(() => disposeSibling()); });
      return dispose;
    });
    assert.doesNotThrow(dispose);
    assert.deepEqual(cleaned, ['sibling']);
  });

  for (const kind of ['root', 'child', 'item']) {
    it(`finishes ${kind} cleanup and unlinks ownership after a callback throws`, { skip: production && kind === 'item' }, () => {
      const value = signal(0);
      const error = new Error('cleanup failed');
      let runs = 0, owner;
      const cleaned = [];
      const setup = () => {
        effect(() => { value(); runs++; });
        onCleanup(() => cleaned.push('earlier'));
        onCleanup(() => { cleaned.push('throwing'); throw error; });
      };
      const scope = kind === 'item' ? reactive._createItemScope : createRoot;
      const dispose = scope(dispose => {
        owner = getOwner();
        if (kind === 'child') {
          createRoot(() => { setup(); });
          createRoot(() => { onCleanup(() => cleaned.push('sibling')); });
        } else setup();
        return dispose;
      });
      assert.throws(dispose, err => err === error);
      value(1); flushSync();
      assert.equal(runs, 1);
      assert.ok(cleaned.includes('earlier'));
      if (kind === 'child') assert.ok(cleaned.includes('sibling'));
      assert.equal(owner.children.length, 0);
      assert.equal(owner.disposals.length, 0);
      assert.doesNotThrow(dispose);
    });
  }

  for (const kind of ['effect', 'memo']) {
    it(`rolls back subscriptions when initial ${kind} execution throws`, () => {
      const value = signal(0);
      const error = new Error('initial failed');
      let runs = 0;
      assert.throws(() => (kind === 'effect' ? effect : memo)(() => {
        value();
        runs++;
        throw error;
      }), err => err === error);
      if (!production) assert.equal(value._subs.size, 0);
      value(1); flushSync();
      assert.equal(runs, 1);
    });
  }
});
