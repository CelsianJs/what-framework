import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal, computed, effect, memo, batch, flushSync, untrack, createRoot, getOwner, runWithOwner, onCleanup } from '../src/reactive.js';

function inRoot(t, fn) {
  return createRoot(dispose => {
    t.after(dispose);
    return fn(dispose);
  });
}

function observe(read) {
  const seen = [];
  effect(() => { seen.push(read()); });
  return seen;
}

test('plain writes are immediately visible while effect reruns wait for microtask', async t => {
  const count = signal(0);
  const seen = inRoot(t, () => observe(count));
  count(1);
  count(v => v + 1);
  assert.equal(count(), 2);
  assert.deepEqual(seen, [0]);
  await Promise.resolve();
  assert.deepEqual(seen, [0, 2]);
});

test('memo diamond converges once', t => inRoot(t, () => {
  const source = signal(0);
  const a = memo(() => source() * 2);
  const b = memo(() => source() * 3);
  const seen = observe(() => [a(), b()]);
  source(1);
  flushSync();
  assert.deepEqual(seen, [[0, 0], [2, 3]]);
}));

test('diamond with a lazy join and eager tail converges once', t => inRoot(t, () => {
  const source = signal(0);
  const a = computed(() => source() * 2);
  const b = computed(() => source() * 3);
  const join = computed(() => a() + b());
  const tail = memo(() => join() * 2);
  const seen = observe(tail);
  source(2);
  flushSync();
  assert.deepEqual(seen, [0, 20]);
}));

test('jagged eager diamond with a direct source edge exposes coherent snapshots', t => inRoot(t, () => {
  const source = signal(0);
  const a = memo(() => source() * 2);
  const b = memo(() => a() * 3);
  const seen = observe(() => [source(), a(), b()]);
  source(1);
  flushSync();
  assert.deepEqual(seen, [[0, 0, 0], [1, 2, 6]]);
}));

test('unchanged eager memo suppresses downstream effect', t => inRoot(t, () => {
  const value = signal(1);
  const parity = memo(() => value() % 2);
  const seen = observe(parity);
  value(3);
  flushSync();
  assert.deepEqual(seen, [1]);
}));

test('unchanged sibling memos do not suppress a changed sibling', t => inRoot(t, () => {
  const value = signal(1);
  const a = memo(() => value() % 2);
  const b = memo(() => value() > 0);
  const c = memo(() => value() * 10);
  const seen = observe(() => [a(), b(), c()]);
  value(3);
  flushSync();
  assert.deepEqual(seen, [[1, true, 10], [1, true, 30]]);
}));

test('dynamic same-count edge switch retains correct ordering on the next write', t => inRoot(t, () => {
  const pickDeep = signal(false);
  const trigger = signal(0);
  const shallow = signal(0);
  const source = signal(0);
  const deep = memo(() => source() * 10);
  const seen = observe(() => [pickDeep() ? deep() : shallow(), trigger()]);
  pickDeep(true);
  flushSync();
  trigger(1); // Queue the observer before the newly observed upstream memo.
  source(1);
  flushSync();
  assert.deepEqual(seen, [[0, 0], [0, 0], [10, 1]]);
}));

test('shared linear convergence observes only the settled value', t => inRoot(t, () => {
  const source = signal(0);
  const a = computed(() => source() + 1);
  const b = computed(() => a() * 2);
  const c = computed(() => a() + b());
  const seen = observe(c);
  source(4);
  flushSync();
  assert.deepEqual(seen, [3, 15]);
}));

test('branch changes remove the old dependency', t => inRoot(t, () => {
  const chooseA = signal(true);
  const a = signal('a');
  const b = signal('b');
  const seen = observe(() => chooseA() ? a() : b());
  chooseA(false);
  flushSync();
  a('unused');
  flushSync();
  b('new');
  flushSync();
  assert.deepEqual(seen, ['a', 'b', 'new']);
}));

test('lazy computation caches and retracks a conditional dependency', t => inRoot(t, () => {
  const chooseA = signal(true);
  const a = signal(1);
  const b = signal(2);
  const snapshots = [];
  const read = computed(() => {
    const value = chooseA() ? a() : b();
    snapshots.push(value);
    return value;
  });
  observe(read);
  assert.equal(read(), 1);
  chooseA(false);
  assert.equal(read(), 2);
  a(15);
  assert.equal(read(), 2);
  assert.deepEqual(snapshots, [1, 2]);
}));

test('writes from effects drain within the same outer flush', t => inRoot(t, () => {
  const source = signal(0);
  const sink = signal(0);
  effect(() => { sink(source() * 2); });
  const seen = observe(sink);
  batch(() => {
    source(2);
    batch(() => source(3));
    assert.deepEqual(seen, [0]);
  });
  assert.deepEqual(seen, [0, 6]);
}));

test('returned cleanup runs before rerun and once after teardown', t => inRoot(t, dispose => {
  const source = signal(0);
  const seen = [];
  effect(() => {
    const value = source();
    seen.push('run ' + value);
    return () => seen.push('clean ' + value);
  });
  source(1);
  flushSync();
  dispose();
  dispose();
  assert.deepEqual(seen, ['run 0', 'clean 0', 'run 1', 'clean 1']);
}));

test('disposing a parent removes queued child effects and prevents reactivation', t => inRoot(t, dispose => {
  const source = signal(0);
  const seen = createRoot(() => observe(source));
  source(1);
  dispose();
  flushSync();
  source(2);
  flushSync();
  assert.deepEqual(seen, [0]);
}));

test('throwing root cleanup still runs siblings and is only reported once', t => inRoot(t, dispose => {
  const trace = [];
  const error = new Error('cleanup');
  onCleanup(() => trace.push('earlier'));
  onCleanup(() => { trace.push('throw'); throw error; });
  onCleanup(() => trace.push('later'));
  assert.throws(dispose, failure => failure === error);
  assert.doesNotThrow(dispose);
  assert.deepEqual(trace, ['later', 'throw', 'earlier']);
}));

test('throwing effect leaves siblings current and the scheduler usable', t => inRoot(t, () => {
  const original = console.error;
  const reported = [];
  console.error = (...args) => reported.push(args);
  t.after(() => { console.error = original; });
  const source = signal(0);
  const error = new Error('update');
  effect(() => { if (source() === 1) throw error; });
  const seen = observe(source);
  source(1);
  flushSync();
  source(2);
  flushSync();
  assert.deepEqual(seen, [0, 1, 2]);
  assert.ok(reported.some(args => args.includes(error)));
}));

test('untracked read inside a tracked scope does not gain a subscription', t => inRoot(t, () => {
  const tracked = signal(0);
  const aside = signal(0);
  const seen = observe(() => [tracked(), untrack(aside)]);
  aside(1);
  flushSync();
  assert.deepEqual(seen, [[0, 0]]);
  tracked(1);
  flushSync();
  assert.deepEqual(seen, [[0, 0], [1, 1]]);
}));

test('explicit owner capture across an async callback isolates teardown', async t => {
  const source = signal(0);
  const a = inRoot(t, dispose => ({ dispose, owner: getOwner() }));
  const b = inRoot(t, () => observe(source));
  await Promise.resolve();
  const seen = runWithOwner(a.owner, () => observe(source));
  a.dispose();
  source(1);
  flushSync();
  assert.deepEqual(seen, [0]);
  assert.deepEqual(b, [0, 1]);
});

test('a parent can dispose a queued child before it reruns', t => inRoot(t, () => {
  const source = signal(0);
  const parentDispose = getOwner();
  let disposeChild;
  effect(() => {
    if (source() === 1) disposeChild();
  });
  const seen = runWithOwner(parentDispose, () => createRoot(dispose => {
    disposeChild = dispose;
    return observe(source);
  }));
  source(1);
  flushSync();
  assert.deepEqual(seen, [0]);
}));


test('independent effects run in notification order across graph depths', t => inRoot(t, () => {
  const deepSource = signal(0);
  const shallowSource = signal(0);
  const middle = computed(() => deepSource() * 2);
  const deep = computed(() => middle() * 2);
  const seen = [];
  effect(() => { seen.push(['deep', deep()]); });
  effect(() => { seen.push(['shallow', shallowSource()]); });

  deepSource(1);
  shallowSource(1);
  flushSync();
  assert.deepEqual(seen.slice(2), [['deep', 4], ['shallow', 1]]);
}));

test('a queued ancestor cleans up a child that was notified first', t => inRoot(t, () => {
  const ancestorSource = signal(0);
  const childSource = signal(0);
  const seen = [];
  effect(() => {
    const value = ancestorSource();
    seen.push(['ancestor', value]);
    if (value === 0) return effect(() => { seen.push(['child', childSource()]); });
  });

  childSource(1);
  ancestorSource(1);
  flushSync();
  assert.deepEqual(seen.slice(2), [['ancestor', 1]]);
}));

test('stable effects wait for the microtask and see both writes', async t => {
  const a = signal(0);
  const b = signal(0);
  const seen = [];
  inRoot(t, () => effect(() => { seen.push([a(), b()]); }, { stable: true }));
  a(1);
  b(2);
  assert.deepEqual(seen, [[0, 0]]);
  await Promise.resolve();
  assert.deepEqual(seen, [[0, 0], [1, 2]]);
});

test('memo computes at creation and returns a fresh value before flushing', t => inRoot(t, () => {
  const source = signal(2);
  const values = [];
  const read = memo(() => {
    const value = source() * 2;
    values.push(value);
    return value;
  });
  assert.deepEqual(values, [4]);
  source(3);
  assert.equal(read(), 6);
}));

test('nested batches return their callback values and preserve immediate reads', t => inRoot(t, () => {
  const source = signal(0);
  const seen = observe(source);
  const result = batch(() => {
    const inner = batch(() => {
      source(7);
      return source();
    });
    assert.deepEqual(seen, [0]);
    return { inner };
  });
  assert.deepEqual(seen, [0, 7]);
  assert.deepEqual(result, { inner: 7 });
}));

test('flushSync caps a feedback cascade at 100 rounds', t => inRoot(t, () => {
  t.mock.method(console, 'warn', () => {});
  const step = signal(0);
  effect(() => {
    const value = step();
    if (value > 0 && value < 200) step(value + 1);
  });
  step(1);
  flushSync();
  assert.equal(step(), 101);
}));

test('a computed caches its error across reads and peek until its input changes', t => inRoot(t, () => {
  const source = signal(0);
  let calls = 0;
  const read = computed(() => {
    calls++;
    const value = source();
    if (value === 1) throw new Error('invalid input');
    return value * 2;
  });
  const seen = observe(() => {
    try { return read(); }
    catch (error) { return error; }
  });

  source(1);
  flushSync();
  const error = seen.at(-1);
  assert.match(error.message, /invalid input/);
  assert.throws(read, failure => failure === error);
  assert.throws(() => read.peek(), failure => failure === error);
  assert.equal(calls, 2);
  source(2);
  flushSync();
  assert.deepEqual(seen, [0, error, 4]);
}));

test('after its final observer is disposed a computed recomputes on the next read', t => inRoot(t, () => {
  const source = signal(1);
  let calls = 0;
  const read = computed(() => { calls++; return source(); });
  const stop = effect(() => { read(); });
  assert.equal(calls, 1);
  stop();
  assert.equal(read(), 1);
  assert.equal(calls, 2);
}));

test('deep fan-out converges once per write at a wide join', t => inRoot(t, () => {
  const source = signal(0);
  let tail = source;
  for (let i = 0; i < 128; i++) {
    const parent = tail;
    tail = computed(() => parent() + 1);
  }
  const branches = Array.from({ length: 256 }, (_, i) => computed(() => tail() + i));
  const sum = () => branches.reduce((total, read) => total + read(), 0);
  const seen = observe(() => [source(), sum()]);
  source(1);
  flushSync();
  assert.deepEqual(seen, [[0, 65408], [1, 65664]]);
}));
