/**
 * Unit tests (no browser) for devtools ↔ what-core wiring:
 *  - what-core reports ERR_MISSING_SIGNAL_READ by itself; once devtools has
 *    registered the signal or computed, the report's subject carries the id
 *    devtools gave it, so a tool can resolve it in the snapshot.
 *  - _suppressDevtools hides registrations from the registries (used by the
 *    DevPanel so it never tracks itself — see DevPanel.jsx docblock).
 *
 * Runs in its own file: installDevTools is a process-wide singleton.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../../core/src/entries/internal.js';
import { signal, computed } from '../../core/src/reactive.js';
import { captureDiagnostics } from '../../core/src/testing.js';
import {
  installDevTools,
  getSnapshot,
  subscribe,
  _suppressDevtools,
} from '../src/index.js';

function fakeSignal(name, value) {
  const fn = () => value;
  fn._debugName = name;
  fn.peek = () => value;
  return fn;
}

test('devtools wiring', async (t) => {
  let hooks = null;
  installDevTools({
    ...core,
    __setDevToolsHooks(h) {
      hooks = h;
      core.__setDevToolsHooks(h);
    },
  });

  await t.test('captures hooks from the provided core module', () => {
    assert.ok(hooks, '__setDevToolsHooks should be called synchronously');
  });

  await t.test('a coerced signal or computed is reported with the id devtools gave it', () => {
    const count = signal(3, 'count');
    const doubled = computed(function doubled() { return count() * 2; });
    const forwarded = [];
    const unsub = subscribe((event, data) => { if (event === 'diagnostic') forwarded.push(data); });
    const cap = captureDiagnostics(() => `${count} ${doubled}`);
    unsub();
    const snap = getSnapshot();
    const countId = snap.signals.find((s) => s.name === 'count').id;
    const doubledId = snap.effects.find((e) => e.name === 'doubled').id;
    assert.deepEqual(cap.events.map((e) => e.subject), [
      { kind: 'signal', id: countId, name: 'count' },
      { kind: 'computed', id: doubledId, name: 'doubled' },
    ]);
    assert.deepEqual(forwarded.map((e) => e.code), ['ERR_MISSING_SIGNAL_READ', 'ERR_MISSING_SIGNAL_READ']);
  });

  await t.test('_suppressDevtools hides registrations', () => {
    const events = [];
    const unsub = subscribe((event) => events.push(event));
    _suppressDevtools(() => {
      hooks.onSignalCreate(fakeSignal('panelInternal', 0));
      hooks.onEffectCreate({ fn: function panelEffect() {} });
    });
    unsub();
    assert.equal(events.length, 0, 'suppressed registrations must not emit events');
    const snap = getSnapshot();
    assert.ok(!snap.signals.some((s) => s.name === 'panelInternal'));
    assert.ok(!snap.effects.some((e) => e.name === 'panelEffect'));
  });

  await t.test('_suppressDevtools is exception-safe and re-entrant', () => {
    assert.throws(() => _suppressDevtools(() => { throw new Error('boom'); }), /boom/);
    // Tracking must resume after the throw
    hooks.onSignalCreate(fakeSignal('afterThrow', 1));
    assert.ok(getSnapshot().signals.some((s) => s.name === 'afterThrow'));
    // Re-entrant nesting
    _suppressDevtools(() => {
      _suppressDevtools(() => hooks.onSignalCreate(fakeSignal('nested', 2)));
      hooks.onSignalCreate(fakeSignal('outerSuppressed', 3));
    });
    const snap = getSnapshot();
    assert.ok(!snap.signals.some((s) => s.name === 'nested'));
    assert.ok(!snap.signals.some((s) => s.name === 'outerSuppressed'));
  });
});
