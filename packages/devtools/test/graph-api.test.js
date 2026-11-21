/**
 * Unit tests (no browser) for what devtools reads from what-core's development
 * API: the writer of each signal update, why an effect ran, revisions, exact
 * registry state with bounded previews, and the loop report.
 *
 * Runs in its own file: installDevTools is a process-wide singleton.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.__WHAT_DEV__ = true;
const core = await import('../../core/src/index.js');
const internal = await import('../../core/src/entries/internal.js');
const { installDevTools, subscribe, getState, getSnapshot, preview } = await import('../src/index.js');
installDevTools(internal);

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 5));
const quiet = async (run) => {
  const original = { warn: console.warn, error: console.error };
  console.warn = () => {};
  console.error = () => {};
  try { return await run(); } finally {
    console.warn = original.warn;
    console.error = original.error;
  }
};

test('devtools on the engine development API', async (t) => {
  const events = [];
  subscribe((event, data) => events.push([event, data]));

  await t.test('names the effect that wrote a signal, and no writer for a plain write', () => {
    let total;
    let label;
    core.createRoot(() => {
      total = core.signal(0, 'total');
      label = core.signal('', 'label');
      core.effect(function logger() { label(); });
      core.effect(function syncTotal() { total(label().length); });
    });
    core.flushSync();
    const start = events.length;
    label('hello');
    core.flushSync();
    total(99);
    const writes = events.slice(start)
      .filter(([event, data]) => event === 'signal:updated' && data.name === 'total')
      .map(([, data]) => data);
    const effectsById = new Map(getSnapshot().effects.map((e) => [e.id, e.name]));
    assert.deepEqual(writes.map((w) => [w.value, w.prev, effectsById.get(w.writerEffectId) ?? null]), [
      [5, 0, 'syncTotal'],
      [99, 5, null],
    ]);
  });

  await t.test('says which dependency caused a re-run', () => {
    const a = core.signal(1, 'causeA');
    const b = core.signal(1, 'causeB');
    const dispose = core.effect(function readsBoth() { a(); b(); });
    try {
      const start = events.length;
      b(2);
      core.flushSync();
      const run = events.slice(start).find(([event, data]) => event === 'effect:run' && getSnapshot().effects.find((e) => e.id === data.id)?.name === 'readsBoth')[1];
      const ids = new Map(getSnapshot().signals.map((s) => [s.name, s.id]));
      assert.deepEqual(run.causeSignalIds, [ids.get('causeB')]);
      assert.deepEqual(run.depSignalIds, [ids.get('causeA'), ids.get('causeB')]);
    } finally {
      dispose();
    }
  });

  await t.test('lists an effect\'s computed dependencies by id', () => {
    const base = core.signal(2, 'base');
    const doubled = core.computed(function doubledValue() { return base() * 2; });
    const dispose = core.effect(function readsComputed() { doubled(); });
    try {
      const state = getState();
      const reader = state.effects.find((e) => e.name === 'readsComputed');
      const computedEntry = state.effects.find((e) => e.name === 'doubledValue');
      assert.equal(computedEntry.kind, 'computed');
      assert.deepEqual(reader.depComputedIds, [computedEntry.id]);
      assert.deepEqual(computedEntry.depSignalIds, [state.signals.find((s) => s.name === 'base').id]);
    } finally {
      dispose();
    }
  });

  await t.test('state keeps every registry entry, counts writes in rev, and bounds only the value preview', () => {
    const big = core.signal(Array.from({ length: 105 }, (_, i) => i), 'big');
    for (let i = 0; i < 130; i++) core.signal(i, `many${i}`);
    const before = getState().signals.find((s) => s.name === 'big').rev;
    big(Array.from({ length: 105 }, (_, i) => (i === 104 ? 999 : i)));
    const state = getState({ budget: 120 });
    assert.ok(state.signals.some((s) => s.name === 'many129'), 'the 130th extra signal is listed');
    const entry = state.signals.find((s) => s.name === 'big');
    assert.equal(entry.rev, before + 1, 'a change in the last element is a new revision');
    assert.ok(JSON.stringify(entry.value).length < 200, JSON.stringify(entry.value));
    assert.match(String(entry.value.at(-1)), /^…\(\+\d+ items\)$/);
  });

  await t.test('previews circular values, throwing getters and long strings without throwing', () => {
    const circular = {}; circular.self = circular;
    assert.deepEqual(preview(circular), { self: '[Circular]' });
    const hostile = { get boom() { throw new Error('nope'); } };
    assert.deepEqual(preview(hostile), { boom: '[getter threw: nope]' });
    assert.match(preview('x'.repeat(1000), 50), /…\(\+\d+ chars\)$/);
  });

  await t.test('reports an effect the engine stopped at its loop cap, with the rounds it ran', async () => {
    core.clearDiagnostics();
    events.length = 0;
    const start = core.signal(false, 'startLoop');
    const tick = core.signal(0, 'tick');
    let runs = 0;
    const dispose = core.effect(function selfWritingEffect() {
      runs++;
      if (start()) tick(tick() + 1);
    });
    try {
      await quiet(async () => {
        start(true);
        await nextTask();
      });
      const loops = core.getDiagnostics().events.filter((e) => e.code === 'ERR_INFINITE_EFFECT');
      assert.equal(loops.length, 1, JSON.stringify(loops));
      assert.equal(loops[0].data.effectName, 'selfWritingEffect');
      assert.equal(loops[0].data.rounds, runs - 1, 'every run after the initial one belongs to the stopped flush');
      assert.ok(loops[0].message.includes(`after ${runs - 1} re-runs`), loops[0].message);
      const registered = getSnapshot().effects.find((e) => e.name === 'selfWritingEffect');
      assert.deepEqual(loops[0].subject, { kind: 'effect', id: registered.id, name: 'selfWritingEffect' });
      assert.equal(events.filter(([event, data]) => event === 'diagnostic' && data.code === 'ERR_INFINITE_EFFECT').length, 1,
        'devtools passes the engine\'s report on once and adds none of its own');
    } finally {
      dispose();
    }
  });

  await t.test('captures an error thrown by an effect\'s first run and by an onCleanup callback', () => {
    const start = events.length;
    assert.throws(() => core.effect(function brokenSetup() { throw new Error('setup failed'); }), /setup failed/);
    const dispose = core.createRoot((d) => {
      core.onCleanup(() => { throw new Error('cleanup failed'); });
      return d;
    });
    assert.throws(dispose, /cleanup failed/);
    const captured = events.slice(start).filter(([event]) => event === 'error:captured').map(([, data]) => [data.message, data.type]);
    assert.deepEqual(captured, [['setup failed', 'effect'], ['cleanup failed', 'cleanup']]);
  });

  await t.test('stays quiet for an effect that writes what it reads and converges', async () => {
    core.clearDiagnostics();
    const value = core.signal(0, 'clamped');
    const dispose = core.effect(function clamp() {
      if (value() > 10) value(10);
    });
    try {
      value(50);
      await nextTask();
      assert.equal(value(), 10);
      assert.deepEqual(core.getDiagnostics().events.filter((e) => e.code === 'ERR_INFINITE_EFFECT'), []);
    } finally {
      dispose();
    }
  });
});
