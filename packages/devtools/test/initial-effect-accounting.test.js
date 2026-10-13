import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.__WHAT_DEV__ = true;
const core = await import('../../core/src/index.js');
const { installDevTools, getSnapshot, subscribe } = await import('../src/index.js');
installDevTools(core);

function findEffect(name) {
  return getSnapshot().effects.find(entry => entry.name === name);
}

test('initial reactive diagnostics count execution without running user callbacks again', async t => {
  for (const stable of [false, true]) {
    await t.test(`${stable ? 'stable' : 'queued'} effects have dependencies before their first write`, () => {
      const source = core.signal(0, `initial-${stable}`);
      let calls = 0;
      function trackedInitialEffect() { source(); calls++; }
      const dispose = core.effect(trackedInitialEffect, { stable });
      try {
        const entry = getSnapshot().effects.find(effect => effect.name === 'trackedInitialEffect');
        const signalId = getSnapshot().signals.find(signal => signal.name === `initial-${stable}`).id;
        assert.equal(calls, 1);
        assert.equal(entry.runCount, 1);
        assert.deepEqual(entry.depSignalIds, [signalId]);
        source.set(1);
        core.flushSync();
        assert.equal(calls, 2);
        assert.equal(findEffect('trackedInitialEffect').runCount, 2);
        assert.deepEqual(findEffect('trackedInitialEffect').depSignalIds, [signalId]);
      } finally {
        dispose();
      }
    });
  }

  await t.test('a throwing initial callback runs once and leaves no registered effect or subscription', () => {
    const source = core.signal(0, 'throwing-setup');
    const events = [];
    const unsubscribe = subscribe(event => events.push(event));
    let calls = 0;
    function throwingInitialEffect() { source(); calls++; throw new Error('setup failure'); }
    try {
      assert.throws(() => core.effect(throwingInitialEffect), /setup failure/);
      assert.equal(calls, 1);
      assert.equal(findEffect('throwingInitialEffect'), undefined);
      assert.ok(events.includes('effect:disposed'));
      source.set(1);
      core.flushSync();
      assert.equal(calls, 1);
    } finally {
      unsubscribe();
    }
  });

  await t.test('lazy computeds stay lazy and count their first evaluation and update only once', () => {
    const source = core.signal(2, 'computed-source');
    let calls = 0;
    // computed() wraps the callback in an anonymous inner effect.
    const before = new Set(getSnapshot().effects.map(entry => entry.id));
    const derived = core.computed(() => { calls++; return source() * 2; });
    const entry = getSnapshot().effects.find(effect => !before.has(effect.id));
    const readEntry = () => getSnapshot().effects.find(effect => effect.id === entry.id);
    const sourceId = getSnapshot().signals.find(signal => signal.name === 'computed-source').id;
    assert.equal(calls, 0);
    assert.equal(readEntry().runCount, 0);
    assert.deepEqual(readEntry().depSignalIds, []);
    assert.equal(derived(), 4);
    assert.equal(calls, 1);
    assert.equal(readEntry().runCount, 1);
    assert.deepEqual(readEntry().depSignalIds, [sourceId]);
    assert.equal(derived(), 4);
    assert.equal(calls, 1);
    source.set(3);
    assert.equal(calls, 1);
    assert.equal(derived(), 6);
    assert.equal(calls, 2);
    assert.equal(readEntry().runCount, 2);
  });
});
