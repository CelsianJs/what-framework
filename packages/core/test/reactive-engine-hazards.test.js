// Regression tests for the engine's hazards under re-entrancy, disposal at
// every point of a node's life, error paths and aborted flushes: one test per
// reproduction from the adversarial review of the push-pull engine. Each test
// failed on that engine.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  signal, computed, effect, memo, batch, flushSync, untrack, createRoot,
  getOwner, runWithOwner, onCleanup, _createItemScope,
  __DEV__, __devtools, __setDevToolsHooks, __subsOf, __drainPreinstallBuffer,
} from '../src/reactive.js';
import { createSelector } from '../src/selector.js';
import { capture } from '../src/diagnostics.js';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function captureConsole(method, fn) {
  const original = console[method];
  const calls = [];
  console[method] = (...args) => calls.push(args);
  try { fn(); } finally { console[method] = original; }
  return calls;
}

const subscribers = (x) => __subsOf(x).length;

describe('a node unlinked while the engine walks it', () => {
  it('a computed whose run disposes the effect reading it does not break the flush', async () => {
    const s = signal(0);
    const t = signal(0);
    const log = [];
    let stop;
    const c = computed(() => { if (s()) stop(); return s(); });
    stop = effect(() => { log.push(c()); });
    const stopSibling = effect(() => { log.push(`sibling ${t()}`); });
    batch(() => { s(1); t(1); });
    t(2);
    flushSync();
    assert.deepEqual(log, [0, 'sibling 0', 'sibling 1', 'sibling 2']);
    stopSibling();
    await tick();
    if (__DEV__) assert.equal(subscribers(s), 0);
  });

  it('a computed on the dependency walk disposed by a deeper one stops the walk', () => {
    const s = signal(0);
    const seen = [];
    let disposeMiddle;
    const inner = computed(() => { if (s() === 1) disposeMiddle(); return s(); });
    const middle = createRoot((d) => { disposeMiddle = d; return computed(() => inner() + 1); });
    createRoot(() => effect(() => { seen.push(middle()); }));
    s(1);
    flushSync();
    // The middle computed is disposed and keeps its last value; the effect
    // that read it re-ran once and stays consistent with it.
    assert.deepEqual(seen, [1, 1]);
    s(2);
    flushSync();
    assert.deepEqual(seen, [1, 1]);
  });

  it('a computed that changes while disposing its walker still notifies its other reader', () => {
    const s = signal(0);
    let disposeWalker;
    const k = computed(() => { const v = s(); if (v === 1) disposeWalker(); return v; });
    // The walker reads k directly and is notified first; m is k's other reader.
    disposeWalker = createRoot((d) => { effect(() => { k(); }); return d; });
    const m = computed(() => k() * 10);
    const seen = [];
    const stop = effect(() => { seen.push(m()); });
    s(1);
    flushSync();
    assert.deepEqual(seen, [0, 10]);
    stop();
  });

  it('a node recomputed after its walker was disposed still notifies its other readers', () => {
    const s = signal(0);
    let disposeWalker;
    const k = computed(() => { const v = s(); if (v === 1) disposeWalker(); return v; });
    const m = computed(() => k() + 1);
    disposeWalker = createRoot((d) => { effect(() => { m(); }); return d; });
    const seen = [];
    const stop = effect(() => { seen.push(m()); });
    s(1);
    flushSync();
    assert.deepEqual(seen, [1, 2]);
    stop();
  });

  it('a computed whose own run drops its last reader releases its dependencies after that run', { skip: !__DEV__ }, async () => {
    const s = signal(0);
    let stop;
    let runs = 0;
    const c = computed(() => { runs++; if (s()) stop(); return s(); });
    stop = effect(() => { c(); });
    s(1);
    assert.equal(c(), 1);
    await tick();
    assert.equal(subscribers(s), 0);
    assert.equal(runs, 2);
  });

  it('a disposed computed drops the edges its readers still hold', { skip: !__DEV__ }, async () => {
    const s = signal(0);
    const gate = signal(false);
    let drop;
    let c;
    createRoot((d) => { drop = d; c = computed(() => { if (gate()) drop(); return s(); }); });
    const stop = effect(() => { c(); });
    gate(true);
    c();
    s(1);
    flushSync();
    await tick();
    assert.equal(subscribers(c), 0);
    assert.equal(subscribers(s), 0);
    stop();
  });
});

describe('the loop cap', () => {
  it('leaves the graph so later writes reach the effects it dropped', () => {
    const s = signal(0);
    const a = signal(0);
    const c = computed(() => s());
    const seen = [];
    const stopReader = effect(function reader() { seen.push(c()); });
    let stop;
    const reports = capture({ quiet: true });
    const warnings = captureConsole('warn', () => {
      stop = effect(function looping() { const n = a(); if (n) { s(n); a(n + 1); } });
      a(1);
      flushSync();
    });
    reports.stop();
    stop();
    if (__DEV__) {
      // The effect that keeps writing is the loop; the reader re-ran every
      // round too, but only because of what the loop wrote.
      const loops = reports.events.filter((e) => e.code === 'ERR_INFINITE_EFFECT');
      assert.deepEqual(loops.map((e) => [e.data.effectName, e.data.rounds, e.subject.kind]), [['looping', 100, 'effect']]);
    } else {
      assert.ok(warnings.some(([message]) => String(message).includes('infinite effect loop')));
    }
    s(500);
    flushSync();
    assert.equal(seen.at(-1), 500);
    stopReader();
  });
});

describe('devtools hooks cannot corrupt the scheduler', { skip: !__DEV__ }, () => {
  const previous = __devtools;
  afterEach(() => __setDevToolsHooks(previous));

  it('a throwing onError hook does not stop the flush or later flushes', () => {
    const s = signal(0);
    const t = signal(0);
    const log = [];
    __setDevToolsHooks({ onError() { throw new Error('hook'); } });
    const errors = captureConsole('error', () => {
      const stopA = effect(() => { if (s()) throw new Error('effect'); });
      const stopB = effect(() => { log.push(t()); });
      batch(() => { s(1); t(1); });
      t(2);
      flushSync();
      stopA();
      stopB();
    });
    assert.deepEqual(log, [0, 1, 2]);
    assert.ok(errors.some(([message]) => String(message).includes('devtools hook onError threw')));
  });

  it('throwing run, update and dispose hooks leave values and subscriptions intact', () => {
    const s = signal(0);
    const seen = [];
    const thrower = () => { throw new Error('hook'); };
    __setDevToolsHooks({ onEffectRun: thrower, onSignalUpdate: thrower, onEffectDispose: thrower, onEffectCreate: thrower });
    captureConsole('error', () => {
      const c = computed(() => s() * 2);
      const stop = effect(() => { seen.push(c()); });
      s(1);
      flushSync();
      stop();
    });
    assert.deepEqual(seen, [0, 2]);
    assert.equal(subscribers(s), 0);
  });
});

describe('disposal during a node\'s own run is complete', () => {
  it('an effect whose first run disposes its owner is disposed at once', () => {
    const s = signal(0);
    let runs = 0;
    let cleaned = 0;
    let owner;
    createRoot((stop) => {
      owner = getOwner();
      effect(() => { runs++; s(); stop(); return () => { cleaned++; }; });
    });
    s(1);
    flushSync();
    assert.deepEqual({ runs, cleaned, retained: owner.disposals.length }, { runs: 1, cleaned: 1, retained: 0 });
    if (__DEV__) assert.equal(subscribers(s), 0);
  });

  it('the cleanup returned by a run that disposed its own effect runs', () => {
    const s = signal(0);
    let cleaned = 0;
    let stop;
    stop = effect(() => { if (s()) stop(); return () => { cleaned++; }; });
    s(1);
    flushSync();
    assert.equal(cleaned, 2);
  });

  it('a memo whose creation disposes its owner is not retained by it', async () => {
    const s = signal(0);
    let read;
    let owner;
    createRoot((d) => { owner = getOwner(); read = memo(() => { d(); return s(); }); });
    s(1);
    assert.equal(read(), 1);
    assert.equal(owner.disposals.length, 0);
    await tick();
    if (__DEV__) assert.equal(subscribers(s), 0);
  });

  it('a root whose function throws is disposed before the error propagates', () => {
    const s = signal(0);
    let runs = 0;
    let cleaned = 0;
    assert.throws(() => createRoot(() => {
      effect(() => { s(); runs++; });
      onCleanup(() => { cleaned++; });
      throw new Error('setup');
    }), /setup/);
    s(1);
    flushSync();
    assert.deepEqual({ runs, cleaned }, { runs: 1, cleaned: 1 });
  });

  it('an item scope whose function throws is disposed too', () => {
    let cleaned = 0;
    assert.throws(() => _createItemScope(() => {
      onCleanup(() => { cleaned++; });
      throw new Error('row');
    }), /row/);
    assert.equal(cleaned, 1);
  });
});

describe('unobserved computeds', () => {
  it('a computed read with no observer lets go of its dependencies at the next microtask', { skip: !__DEV__ }, async () => {
    const s = signal(1);
    let runs = 0;
    const c = computed(() => { runs++; return s() + 1; });
    assert.equal(c(), 2);
    assert.equal(c(), 2);
    assert.equal(runs, 1, 'repeated reads in one task are cached');
    await tick();
    assert.equal(subscribers(s), 0);
    s(5);
    assert.equal(c(), 6);
  });

  it('a memo nothing reads lets go of its dependencies; one a binding reads does not', { skip: !__DEV__ }, async () => {
    const s = signal(1);
    const unread = memo(() => s() * 2);
    const read = memo(() => s() * 3);
    const stop = effect(() => { read(); });
    await tick();
    assert.deepEqual(__subsOf(s).map((n) => n.sig), [read]);
    assert.equal(unread(), 2);
    stop();
  });

  it('the release waits for a flush already scheduled, whose effects read the computed', async () => {
    const s = signal(0);
    const gate = signal(false);
    let runs = 0;
    const c = computed(() => { runs++; return s() * 2; });
    const seen = [];
    const stop = effect(() => { if (gate()) seen.push(c()); });
    c();                                   // schedules the release checkpoint
    gate(true);                            // schedules the flush after it
    await tick();
    assert.deepEqual(seen, [0]);
    assert.equal(runs, 1);
    stop();
  });
});

describe('owners', () => {
  it('effects disposed one by one keep a long-lived owner\'s list bounded', () => {
    const s = signal(0);
    createRoot((dispose) => {
      const owner = getOwner();
      for (let i = 0; i < 10000; i++) effect(() => { s(); })();
      assert.ok(owner.disposals.length < 64, `${owner.disposals.length} entries retained`);
      dispose();
    });
  });

  it('keeps the disposal order of the entries that remain', () => {
    const log = [];
    createRoot((dispose) => {
      const s = signal(0);
      onCleanup(() => log.push('first'));
      for (let i = 0; i < 100; i++) effect(() => { s(); })();
      effect(() => { s(); return () => log.push('effect'); });
      onCleanup(() => log.push('last'));
      dispose();
    });
    assert.deepEqual(log, ['last', 'effect', 'first']);
  });

  it('what is created under a disposed owner is disposed at once', () => {
    const s = signal(0);
    let owner;
    const dispose = createRoot((d) => { owner = getOwner(); return d; });
    dispose();
    let runs = 0;
    const log = [];
    runWithOwner(owner, () => {
      effect(() => { s(); runs++; return () => log.push('effect cleanup'); });
      onCleanup(() => log.push('cleanup'));
      createRoot(() => { onCleanup(() => log.push('child root')); });
    });
    s(1);
    flushSync();
    assert.equal(runs, 1);
    assert.deepEqual(log, ['effect cleanup', 'cleanup', 'child root']);
    assert.equal(owner.disposals.length, 0);
    if (__DEV__) assert.equal(subscribers(s), 0);
  });

  it('a computed created under a disposed owner still computes', () => {
    let owner;
    createRoot((d) => { owner = getOwner(); d(); });
    const s = signal(2);
    const c = runWithOwner(owner, () => computed(() => s() * 10));
    assert.equal(c(), 20);
    s(3);
    assert.equal(c(), 30);
  });

  it('a flush started inside a root does not give it the effects re-runs create', () => {
    const s = signal(0);
    const t = signal(0);
    let nestedRuns = 0;
    const stop = effect(() => { if (s()) effect(() => { t(); nestedRuns++; }); });
    s(1);
    let unrelated;
    const disposeUnrelated = createRoot((d) => { unrelated = getOwner(); flushSync(); return d; });
    assert.equal(unrelated.disposals.length, 0);
    disposeUnrelated();
    t(1);
    flushSync();
    assert.equal(nestedRuns, 2);
    stop();
  });
});

describe('cleanups', () => {
  it('a cleanup run by another effect\'s dispose is not tracked by that effect', () => {
    const s = signal(0);
    const gate = signal(false);
    const log = [];
    const dispose = effect(() => () => { s(); });
    const stop = effect(() => { log.push(gate()); if (gate()) dispose(); });
    gate(true);
    flushSync();
    s(1);
    flushSync();
    assert.deepEqual(log, [false, true]);
    stop();
  });

  it('a cleanup error goes to the owner\'s _onError, on re-run and on dispose', () => {
    const s = signal(0);
    const errors = [];
    const warnings = captureConsole('warn', () => {
      const disposeRoot = createRoot((dispose) => {
        getOwner()._onError = (err) => errors.push(err.message);
        const stop = effect(() => { s(); return () => { throw new Error('cleanup'); }; });
        s(1);
        flushSync();
        stop();
        return dispose;
      });
      disposeRoot();
    });
    assert.deepEqual(errors, ['cleanup', 'cleanup']);
    assert.deepEqual(warnings, []);
  });

  it('an owner being disposed does not handle the errors of its own teardown', () => {
    const received = [];
    const errors = captureConsole('error', () => {
      createRoot((outer) => {
        getOwner()._onError = (err) => received.push(['outer', err.message]);
        createRoot(() => {
          getOwner()._onError = (err) => received.push(['inner', err.message]);
          const s = signal(0);
          effect(() => { s(); return () => { throw new Error('teardown'); }; });
        });
        outer();
      });
    });
    assert.deepEqual(received, []);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][1].message, 'teardown');
  });
});

describe('cycles', () => {
  it('a computed that reads itself throws a coded error naming it', () => {
    const a = computed(function total() { return a() + 1; });
    let caught;
    try { a(); } catch (err) { caught = err; }
    assert.equal(caught?.code, 'ERR_COMPUTED_CYCLE');
    if (__DEV__) assert.match(caught.message, /"total"/);
    assert.throws(() => a(), (err) => err === caught, 'the error is cached like any computed error');
  });

  it('a cycle through two computeds throws instead of returning garbage', () => {
    const s = signal(1);
    const a = computed(() => s() + b());
    const b = computed(() => a() * 2);
    assert.throws(() => a(), { code: 'ERR_COMPUTED_CYCLE' });
  });

  it('a cycle longer than the evaluation stack bound terminates with the cycle error', () => {
    const n = 1400;
    const nodes = Array.from({ length: n }, (_, i) => computed(() => nodes[(i + 1) % n]() + 1));
    assert.throws(() => nodes[0](), { code: 'ERR_COMPUTED_CYCLE' });
  });
});

describe('the stack bound', () => {
  it('a catch block sees the deferral at most once, and only in a run that is discarded', () => {
    let c = computed(() => 1);
    for (let i = 0; i < 1500; i++) { const next = c; c = computed(() => next() + 1); }
    let catches = 0;
    const deep = c;
    const total = computed(() => { try { return deep(); } catch { catches++; return -1; } });
    assert.equal(total(), 1501);
    assert.ok(catches <= 1);
  });
});

describe('phases', () => {
  it('a render-phase effect created by a user-phase effect never runs before it', () => {
    const s = signal(0);
    const log = [];
    createRoot((dispose) => {
      let child;
      effect(() => {
        if (s()) { log.push('parent'); child(); }
        else child = effect(() => { if (s()) log.push('child'); });
      }, { phase: 'user' });
      s(1);
      flushSync();
      dispose();
    });
    assert.deepEqual(log, ['parent']);
  });
});

describe('flushes never re-enter a running effect or computed', () => {
  it('flushSync inside untrack in an effect is a no-op', () => {
    const s = signal(0);
    const log = [];
    const reports = capture({ quiet: true });
    try {
      const stopSibling = effect(() => { log.push(`sibling ${s()}`); });
      const stop = effect(function setup() {
        log.push('setup before');
        s(1);
        untrack(flushSync);
        log.push('setup after');
      });
      flushSync();
      stopSibling();
      stop();
    } finally {
      reports.stop();
    }
    assert.deepEqual(log, ['sibling 0', 'setup before', 'setup after', 'sibling 1']);
    const nested = reports.events.filter((e) => e.code === 'ERR_NESTED_FLUSH_SYNC');
    if (__DEV__) {
      assert.equal(nested.length, 1);
      assert.equal(nested[0].data.context, 'effect "setup"');
      assert.match(nested[0].message, /flushSync\(\) was called while effect "setup" was running, so it did nothing/);
    } else {
      assert.deepEqual(nested, []);
    }
  });

  it('a batch ending in an effect\'s first run does not re-run that effect inside its run', () => {
    const a = signal(0);
    let depth = 0;
    let maxDepth = 0;
    const stop = effect(() => {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
      if (a() < 3) batch(() => a(a.peek() + 1));
      depth--;
    });
    flushSync();
    assert.equal(a(), 3);
    assert.equal(maxDepth, 1);
    stop();
  });

  it('a batch ending inside a computed does not run effects in the middle of it', async () => {
    const s = signal(0);
    const order = [];
    const stop = effect(() => { order.push(`effect ${s()}`); });
    const c = computed(() => { batch(() => s(1)); order.push('computed done'); return 1; });
    captureConsole('warn', () => c());
    await tick();
    assert.deepEqual(order, ['effect 0', 'computed done', 'effect 1']);
    stop();
  });
});

describe('createSelector', () => {
  it('a computed over isSelected is fresh right after a write', () => {
    const s = signal('a');
    let ca;
    let cb;
    createRoot(() => {
      const selected = createSelector(s);
      ca = computed(() => selected('a'));
      cb = computed(() => selected('b'));
      ca();
      cb();
    });
    s('b');
    assert.deepEqual([ca(), cb()], [false, true]);
  });

  it('a key first read while a write is pending is notified when the source goes back', () => {
    const sel = signal('a');
    const isSel = createSelector(sel);
    const seen = [];
    sel('b');
    const stop = createRoot((d) => { effect(() => { seen.push(isSel('b')); }); return d; });
    sel('a');
    flushSync();
    assert.deepEqual(seen, [true, false]);
    assert.equal(isSel('b'), false);
    stop();
  });

  it('notifies only the keys a change leaves and enters, for any number of readers', () => {
    const sel = signal(0);
    const isSel = createSelector(sel);
    const runs = new Array(1000).fill(0);
    const stop = createRoot((d) => {
      for (let i = 0; i < 1000; i++) effect(() => { isSel(i); runs[i]++; });
      return d;
    });
    sel(500);
    flushSync();
    assert.deepEqual(runs.flatMap((n, i) => (n > 1 ? [i] : [])), [0, 500]);
    stop();
  });

  it('a source that throws reaches every reader, and recovery reaches them again', () => {
    const sel = signal(1);
    const isSel = createSelector(() => { if (sel() < 0) throw new Error('bad'); return sel(); });
    const seen = [];
    const stop = createRoot((d) => {
      for (const key of [1, 2]) effect(() => { try { seen.push([key, isSel(key)]); } catch (err) { seen.push([key, err.message]); } });
      return d;
    });
    seen.length = 0;
    sel(-1);
    flushSync();
    assert.deepEqual(seen, [[1, 'bad'], [2, 'bad']]);
    seen.length = 0;
    sel(2);
    flushSync();
    assert.deepEqual(seen, [[1, false], [2, true]]);
    stop();
  });

  it('a selector whose keys are all gone stops listening to its source', { skip: !__DEV__ }, async () => {
    const sel = signal(0);
    const isSel = createSelector(sel);
    const stop = effect(() => { isSel(1); });
    assert.equal(subscribers(sel), 1);
    stop();
    await tick();
    assert.equal(subscribers(sel), 0);
    sel(1);
    assert.equal(isSel(1), true);
  });
});

describe('the devtools pre-install buffer', { skip: !__DEV__ || !__devtools?.__isPreinstallBuffer }, () => {
  it('keeps no unmounted component and empties on drain', () => {
    const buffer = __devtools.__buffer;
    const ctx = { name: 'Gone' };
    __devtools.onComponentMount(ctx);
    __devtools.onComponentUnmount(ctx);
    const live = { name: 'Live' };
    __devtools.onComponentMount(live);
    const drained = __drainPreinstallBuffer();
    assert.ok(!drained.components.includes(ctx));
    assert.ok(drained.components.includes(live));
    assert.equal(buffer.components.size + buffer.signals.size + buffer.effects.size, 0);
    assert.deepEqual(__drainPreinstallBuffer(), { signals: [], effects: [], components: [] });
  });
});

describe('the public Owner type', () => {
  it('cannot be constructed; getOwner() is the only way to obtain one', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const diagnostics = tscDiagnose({
      files: {
        'owner-ok.ts': `import { getOwner, runWithOwner, createRoot } from 'what-framework';
          const owner = getOwner();
          runWithOwner(owner, () => createRoot(() => undefined));
          runWithOwner(null, () => undefined);`,
        'owner-forged.ts': `import { runWithOwner, createRoot, type Owner } from 'what-framework';
          const owner: Owner = { disposals: [] };
          runWithOwner(owner, () => createRoot(() => undefined));`,
      },
      writeRoot: here,
      compilerOptions: { skipLibCheck: false },
    });
    const byFile = (name) => diagnostics.filter((d) => d.file.endsWith(name));
    assert.deepEqual(byFile('owner-ok.ts'), []);
    assert.ok(byFile('owner-forged.ts').length > 0, 'a forged Owner must not typecheck');
  });
});
