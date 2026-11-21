// Engine mechanisms beyond the old contract: the user effect phase, owner
// error routing, cached computed errors, release of unwatched computeds, the
// owner sibling list, and the development-only API for tools (this suite runs
// in the development tier, as plain Node does).

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  signal, computed, effect, memo, batch, flushSync, createRoot,
  getOwner, runWithOwner, onCleanup, _createItemScope,
  __DEV__, __devtools, __setDevToolsHooks, __depsOf, __subsOf, __currentEffect,
} from '../src/reactive.js';

function captureConsole(method, fn) {
  const original = console[method];
  const calls = [];
  console[method] = (...args) => calls.push(args);
  try { fn(); } finally { console[method] = original; }
  return calls;
}

describe('user-phase effects', () => {
  it('re-run after every render-phase effect of the same flush', () => {
    createRoot((dispose) => {
      const s = signal(0);
      const log = [];
      effect(() => { log.push('user:' + s()); }, { phase: 'user' });
      effect(() => { log.push('render-a:' + s()); });
      effect(() => { log.push('render-b:' + s()); });
      log.length = 0;
      s(1);
      flushSync();
      assert.deepEqual(log, ['render-a:1', 'render-b:1', 'user:1']);
      dispose();
    });
  });

  it('run their first run synchronously, like every effect', () => {
    const log = [];
    const dispose = effect(() => { log.push('ran'); }, { phase: 'user' });
    assert.deepEqual(log, ['ran']);
    dispose();
  });

  it('see the bindings their write settled; a binding a user effect dirties renders after that user round', () => {
    createRoot((dispose) => {
      const s = signal(0);
      const derived = signal(0);
      const dom = { text: '0', derivedText: '0' };
      const log = [];
      effect(() => { dom.text = String(s()); });
      effect(() => { dom.derivedText = String(derived()); });
      effect(() => { log.push(`first sees ${dom.text}`); derived(s() * 10); }, { phase: 'user' });
      effect(() => { log.push(`second sees ${dom.text}/${s()}, derived ${dom.derivedText}`); }, { phase: 'user' });
      log.length = 0;
      s(2);
      flushSync();
      // Both user effects see the text binding updated. The binding the first
      // one dirtied renders once the user round is over, as React re-renders
      // after all effects of a commit have run.
      assert.deepEqual(log, ['first sees 2', 'second sees 2/2, derived 0']);
      assert.equal(dom.derivedText, '20');
      dispose();
    });
  });

  it('queues a user effect after render effects even when it was notified first', () => {
    createRoot((dispose) => {
      const s = signal(0);
      const order = [];
      effect(() => { s(); order.push('user'); }, { phase: 'user' });
      effect(() => { s(); order.push('render'); });
      order.length = 0;
      batch(() => s(1));
      assert.deepEqual(order, ['render', 'user']);
      dispose();
    });
  });
});

describe('owner error routing', () => {
  it('sends an effect re-run error to the nearest owner _onError, not to the console', () => {
    const s = signal(0);
    const received = [];
    const errors = captureConsole('error', () => {
      createRoot((dispose) => {
        getOwner()._onError = (err) => received.push(['outer', err.message]);
        createRoot(() => {
          getOwner()._onError = (err) => received.push(['inner', err.message]);
          effect(() => { if (s() === 1) throw new Error('boom'); });
        });
        s(1);
        flushSync();
        dispose();
      });
    });
    assert.deepEqual(received, [['inner', 'boom']]);
    assert.deepEqual(errors, []);
  });

  it('passes a handler failure further up, then to the console', () => {
    const s = signal(0);
    const received = [];
    const errors = captureConsole('error', () => {
      createRoot((dispose) => {
        getOwner()._onError = (err) => { received.push(err.message); throw new Error('outer failed too'); };
        createRoot(() => {
          getOwner()._onError = (err) => { received.push(err.message); throw new Error('inner failed'); };
          effect(() => { if (s() === 1) throw new Error('boom'); });
        });
        s(1);
        flushSync();
        dispose();
      });
    });
    assert.deepEqual(received, ['boom', 'inner failed']);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][1].message, 'outer failed too');
  });

  it('reaches the parent handler from an item scope, which is not linked into the parent', () => {
    const s = signal(0);
    const received = [];
    createRoot((dispose) => {
      getOwner()._onError = (err) => received.push(err.message);
      const disposeItem = _createItemScope((d) => {
        effect(() => { if (s() === 1) throw new Error('row failed'); });
        return d;
      });
      assert.equal(getOwner().firstChild, null);
      s(1);
      flushSync();
      disposeItem();
      dispose();
    });
    assert.deepEqual(received, ['row failed']);
  });

  it('keeps the flush going: sibling effects still run', () => {
    const s = signal(0);
    const seen = [];
    createRoot((dispose) => {
      getOwner()._onError = () => {};
      effect(() => { if (s() === 1) throw new Error('boom'); });
      effect(() => { seen.push(s()); });
      s(1);
      flushSync();
      dispose();
    });
    assert.deepEqual(seen, [0, 1]);
  });
});

describe('cached computed errors', () => {
  it('rethrows the same error object to every reader until an input changes', () => {
    const s = signal(1);
    let runs = 0;
    const c = computed(() => { runs++; if (s() > 0) throw new Error('positive'); return s(); });
    let first, second;
    try { c(); } catch (err) { first = err; }
    try { c.peek(); } catch (err) { second = err; }
    assert.ok(first instanceof Error);
    assert.equal(second, first);
    assert.equal(runs, 1);
    s(-1);
    assert.equal(c(), -1);
    assert.equal(runs, 2);
  });

  it('notifies subscribers when the error goes away, and only then', () => {
    createRoot((dispose) => {
      const s = signal(1);
      const error = new Error('same');
      const c = computed(() => { if (s() > 0) throw error; return s(); });
      const seen = [];
      effect(() => { try { seen.push(c()); } catch (err) { seen.push(err.message); } });
      s(2);                                      // the same error object again: no change
      flushSync();
      assert.deepEqual(seen, ['same']);
      s(-5);
      flushSync();
      assert.deepEqual(seen, ['same', -5]);
      dispose();
    });
  });

  it('keeps a disposed computed\'s cached error', () => {
    let read;
    const dispose = createRoot((d) => {
      read = computed(() => { throw new Error('gone wrong'); });
      assert.throws(() => read(), /gone wrong/);
      return d;
    });
    dispose();
    assert.throws(() => read(), /gone wrong/);
  });
});

describe('unwatched computeds release their dependencies', () => {
  it('a computed over a long-lived signal is dropped by it once its last subscriber goes', () => {
    const shared = signal(1);
    let runs = 0;
    const doubled = computed(() => { runs++; return shared() * 2; });
    const dispose = createRoot((d) => { effect(() => { doubled(); }); return d; });
    assert.equal(__subsOf(shared).length, 1);
    dispose();
    assert.deepEqual(__subsOf(shared), []);
    // It recomputes on the next read, and is fresh.
    shared(5);
    assert.equal(doubled(), 10);
    assert.equal(runs, 2);
  });

  it('a computed whose own run disposes its owner keeps no subscription', () => {
    const s = signal(1);
    let read, disposeRoot;
    createRoot((d) => {
      disposeRoot = d;
      read = computed(() => { if (s.peek() === 2) disposeRoot(); return s() * 10; });
    });
    assert.equal(read(), 10);
    s(2);
    read();
    assert.deepEqual(__subsOf(s), []);
  });

  it('releases a whole chain iteratively', () => {
    const s = signal(0);
    let cur = s;
    for (let i = 0; i < 20000; i++) { const p = cur; cur = computed(() => p() + 1); }
    const tail = cur;
    const dispose = createRoot((d) => { effect(() => { tail(); }); return d; });
    assert.equal(__subsOf(s).length, 1);
    dispose();
    assert.deepEqual(__subsOf(s), []);
  });
});

describe('memo', () => {
  it('evaluates at creation, then only when read after a change', () => {
    createRoot((dispose) => {
      const s = signal(1);
      let runs = 0;
      const m = memo(() => { runs++; return s() * 2; });
      assert.equal(runs, 1);
      s(2);
      s(3);
      assert.equal(runs, 1);
      assert.equal(m(), 6);
      assert.equal(runs, 2);
      dispose();
    });
  });

  it('re-runs subscribers only when its value changes', () => {
    createRoot((dispose) => {
      const s = signal(1);
      const parity = memo(() => s() % 2);
      const seen = [];
      effect(() => { seen.push(parity()); });
      s(3);
      flushSync();
      s(4);
      flushSync();
      assert.deepEqual(seen, [1, 0]);
      dispose();
    });
  });
});

describe('batch', () => {
  it('returns the callback value, including from nested batches', () => {
    const s = signal(0);
    const result = batch(() => { s(1); return batch(() => s() + 1); });
    assert.equal(result, 2);
  });

  it('flushes once, at the end of the outermost batch, even when the callback throws', () => {
    createRoot((dispose) => {
      const s = signal(0);
      const seen = [];
      effect(() => { seen.push(s()); });
      assert.throws(() => batch(() => { s(1); batch(() => s(2)); assert.deepEqual(seen, [0]); throw new Error('stop'); }), /stop/);
      assert.deepEqual(seen, [0, 2]);
      dispose();
    });
  });
});

describe('sig.mutate', () => {
  it('changes the value in place and notifies readers although the reference is the same', () => {
    const items = signal([1, 2]);
    const before = items();
    const seen = [];
    const dispose = effect(() => { seen.push(items().join(',')); });
    items.mutate((list) => { list.push(3); });
    assert.equal(items(), before);
    flushSync();
    assert.deepEqual(seen, ['1,2', '1,2,3']);
    dispose();
  });

  it('is batched like a write: a batch re-runs readers once, at its end', () => {
    const state = signal({ count: 0 });
    let runs = 0;
    const dispose = effect(() => { state(); runs++; });
    batch(() => {
      state.mutate((s) => { s.count++; });
      state.mutate((s) => { s.count++; });
      assert.equal(runs, 1);
    });
    assert.equal(runs, 2);
    assert.equal(state().count, 2);
    dispose();
  });

  it('re-runs on the microtask outside a batch', async () => {
    const state = signal({ count: 0 });
    let runs = 0;
    const dispose = effect(() => { state(); runs++; });
    state.mutate((s) => { s.count = 5; });
    assert.equal(runs, 1);
    await Promise.resolve();
    assert.equal(runs, 2);
    dispose();
  });

  it('reaches a computed that derives a new value, not past one that returns the same reference', () => {
    const items = signal([1]);
    const same = computed(() => items());
    const length = computed(() => items().length);
    const log = [];
    const stopSame = effect(() => { log.push(`same ${same().length}`); });
    const stopLength = effect(() => { log.push(`length ${length()}`); });
    items.mutate((list) => { list.push(2); });
    flushSync();
    assert.deepEqual(log, ['same 1', 'length 1', 'length 2']);
    stopSame();
    stopLength();
  });

  it('does not notify when fn throws, like a write whose updater throws', () => {
    const state = signal({ count: 0 });
    let runs = 0;
    const dispose = effect(() => { state(); runs++; });
    assert.throws(() => state.mutate(() => { throw new Error('nope'); }), /nope/);
    flushSync();
    assert.equal(runs, 1);
    dispose();
  });

  it('is detachable like the other signal methods', () => {
    const items = signal([]);
    const { mutate } = items;
    mutate((list) => { list.push('a'); });
    assert.deepEqual(items(), ['a']);
  });
});

describe('owner sibling list', () => {
  it('removes a child root in O(1), in any order', () => {
    createRoot((dispose) => {
      const owner = getOwner();
      const disposers = [];
      for (let i = 0; i < 20000; i++) createRoot((d) => { disposers.push(d); });
      // Interleave removals from both ends and the middle.
      const order = [];
      for (let lo = 0, hi = disposers.length - 1; lo <= hi; lo++, hi--) { order.push(hi); if (lo !== hi) order.push(lo); }
      const start = performance.now();
      for (const i of order) disposers[i]();
      const elapsed = performance.now() - start;
      assert.equal(owner.firstChild, null);
      assert.equal(owner.lastChild, null);
      assert.ok(elapsed < 1000, `removing 20000 children took ${elapsed} ms`);
      dispose();
    });
  });

  it('disposes children newest first, and survives a cleanup that disposes a sibling', () => {
    const log = [];
    createRoot((dispose) => {
      let disposeB;
      createRoot(() => { onCleanup(() => log.push('a')); });
      createRoot((d) => { disposeB = d; onCleanup(() => log.push('b')); });
      createRoot(() => { onCleanup(() => { log.push('c'); disposeB(); }); });
      createRoot(() => { onCleanup(() => log.push('d')); });
      dispose();
    });
    assert.deepEqual(log, ['d', 'c', 'b', 'a']);
  });

  it('runWithOwner registers a later root with the captured owner', () => {
    const log = [];
    let owner;
    const dispose = createRoot((d) => { owner = getOwner(); return d; });
    runWithOwner(owner, () => createRoot(() => onCleanup(() => log.push('late'))));
    assert.ok(owner.firstChild !== null);
    dispose();
    assert.deepEqual(log, ['late']);
  });
});

describe('the stack bound is invisible to effects', () => {
  it('an effect reading a never-evaluated 50000-deep chain gets its value', () => {
    createRoot((dispose) => {
      const s = signal(0);
      let cur = s;
      for (let i = 0; i < 50000; i++) { const p = cur; cur = computed(() => p() + 1); }
      const tail = cur;
      const seen = [];
      effect(() => { seen.push(tail()); });
      s(1);
      flushSync();
      assert.deepEqual(seen, [50000, 50001]);
      dispose();
    });
  });

  it('an effect whose update reaches a never-evaluated deep chain re-runs with its value', () => {
    createRoot((dispose) => {
      const s = signal(0);
      const gate = signal(false);
      let cur = s;
      for (let i = 0; i < 5000; i++) { const p = cur; cur = computed(() => p() + 1); }
      const tail = cur;
      const switched = computed(() => (gate() ? tail() : -1));
      const seen = [];
      effect(() => { seen.push(switched()); });
      gate(true);
      flushSync();
      assert.deepEqual(seen, [-1, 5000]);
      dispose();
    });
  });
});

describe('development API', { skip: !__DEV__ }, () => {
  const previous = __devtools;
  afterEach(() => __setDevToolsHooks(previous));

  it('lists dependencies as the hooks hand them out, and subscribers as nodes', () => {
    createRoot((dispose) => {
      const a = signal(1, 'a');
      const b = signal(2, 'b');
      const sum = computed(() => a() + b());
      let effectNode;
      __setDevToolsHooks({ onEffectCreate(node) { if (node.fn.name === 'reader') effectNode = node; } });
      effect(function reader() { sum(); a(); });
      __setDevToolsHooks(previous);
      const sumNode = __subsOf(a).find((n) => n !== effectNode);
      assert.deepEqual(__depsOf(effectNode), [sumNode, a]);
      assert.deepEqual(__depsOf(sum), [a, b]);
      assert.deepEqual(__depsOf(a), []);
      assert.deepEqual(__subsOf(sum), [effectNode]);
      assert.deepEqual(__subsOf(b), [sumNode]);
      dispose();
      assert.deepEqual(__subsOf(a), []);
    });
  });

  it('names the writing effect and passes the previous value on update', () => {
    const updates = [];
    createRoot((dispose) => {
      const source = signal(1, 'source');
      const mirror = signal(0, 'mirror');
      __setDevToolsHooks({
        onSignalUpdate(sig, next, prev) {
          updates.push({ name: sig._debugName, next, prev, writer: __currentEffect()?.fn.name ?? null });
        },
      });
      effect(function syncMirror() { mirror(source() * 10); });
      source(2);
      flushSync();
      dispose();
    });
    assert.deepEqual(updates, [
      { name: 'mirror', next: 10, prev: 0, writer: 'syncMirror' },
      { name: 'source', next: 2, prev: 1, writer: null },
      { name: 'mirror', next: 20, prev: 10, writer: 'syncMirror' },
    ]);
    assert.equal(__currentEffect(), null);
  });

  it('reports why an effect or a computed re-ran', () => {
    const runs = [];
    createRoot((dispose) => {
      __setDevToolsHooks({
        onEffectRun(node, info) {
          if (info) runs.push([node.fn.name || 'anonymous', info.causes.map((c) => c._debugName ?? c.fn.name)]);
        },
      });
      const first = signal('Ada', 'first');
      const last = signal('L', 'last');
      const unrelated = signal(0, 'unrelated');
      const full = computed(function full() { return `${first()} ${last()}`; });
      effect(function show() { full(); unrelated(); });
      first('Grace');
      flushSync();
      unrelated(1);
      flushSync();
      dispose();
    });
    assert.deepEqual(runs, [
      ['full', []],                    // first evaluation: no causes
      ['full', ['first']],
      ['show', ['full']],
      ['show', ['unrelated']],
    ]);
  });

  it('hands a mutate to onSignalUpdate with the value as both next and prev', () => {
    const updates = [];
    __setDevToolsHooks({ onSignalUpdate(sig, next, prev) { updates.push([sig._debugName, next, prev]); } });
    const items = signal([1], 'items');
    items.mutate((list) => { list.push(2); });
    assert.equal(updates.length, 1);
    assert.equal(updates[0][0], 'items');
    assert.equal(updates[0][1], items());
    assert.equal(updates[0][2], items());
  });

  it('names a write an effect made to its own dependency as the cause of the re-run it triggers', () => {
    const runs = [];
    createRoot((dispose) => {
      __setDevToolsHooks({
        onEffectRun(node, info) {
          if (node.fn.name === 'clamp') runs.push(info ? info.causes.map((c) => c._debugName) : 'first');
        },
      });
      const value = signal(50, 'value');
      effect(function clamp() { if (value() > 10) value(10); });
      flushSync();
      value(40);
      flushSync();
      dispose();
    });
    assert.deepEqual(runs, ['first', ['value'], ['value'], ['value']]);
  });

  it('hands a throw in an effect\'s first run and a throwing cleanup to the onError hook', () => {
    const seen = [];
    __setDevToolsHooks({
      onError(err, context) { seen.push([err.message, context.type, context.effect?.fn.name ?? null]); },
    });
    assert.throws(() => effect(function setup() { throw new Error('first run'); }), /first run/);
    const disposeRoot = createRoot((dispose) => {
      onCleanup(() => { throw new Error('owner cleanup'); });
      return dispose;
    });
    assert.throws(disposeRoot, /owner cleanup/);
    const s = signal(0);
    const stop = effect(function withCleanup() { s(); return () => { throw new Error('effect cleanup'); }; });
    captureConsole('error', () => {
      s(1);
      flushSync();
      stop();
    });
    assert.deepEqual(seen, [
      ['first run', 'effect', 'setup'],
      ['owner cleanup', 'cleanup', null],
      ['effect cleanup', 'effect-cleanup', 'withCleanup'],
      ['effect cleanup', 'effect-cleanup', 'withCleanup'],
    ]);
  });

  it('reports the graph only through __subsOf and __depsOf', () => {
    createRoot((dispose) => {
      const s = signal(0, 's');
      const c = computed(() => s() + 1);
      let node;
      __setDevToolsHooks({ onEffectCreate(n) { if (n.fn.name === 'watcher') node = n; } });
      effect(function watcher() { c(); s(); });
      __setDevToolsHooks(previous);
      const subs = __subsOf(s);
      assert.equal(subs.length, 2);
      assert.ok(subs.includes(node));
      const computedNode = subs.find((n) => n !== node);
      assert.deepEqual(__depsOf(node), [computedNode, s]);
      assert.deepEqual(__depsOf(c), [s]);
      assert.equal('_subs' in s, false);
      assert.equal('deps' in node, false);
      assert.equal('deps' in computedNode, false);
      dispose();
      assert.deepEqual(__subsOf(s), []);
    });
  });
});
