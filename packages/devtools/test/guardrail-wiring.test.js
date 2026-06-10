/**
 * Unit tests (no browser) for devtools ↔ what-core wiring:
 *  - installDevTools captures core's installSignalReadGuardrail and applies
 *    it to every signal it registers (dev guardrail for `${count}` misuse).
 *  - _suppressDevtools hides registrations from the registries (used by the
 *    DevPanel so it never tracks itself — see DevPanel.jsx docblock).
 *
 * Runs in its own file: installDevTools is a process-wide singleton.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
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
  const guarded = [];
  const fakeCore = {
    __setDevToolsHooks(h) { hooks = h; },
    installSignalReadGuardrail(sig, name) { guarded.push(name); return sig; },
  };
  installDevTools(fakeCore);

  await t.test('captures hooks from the provided core module', () => {
    assert.ok(hooks, '__setDevToolsHooks should be called synchronously');
  });

  await t.test('applies the signal-read guardrail to registered signals', () => {
    hooks.onSignalCreate(fakeSignal('count', 42));
    assert.deepEqual(guarded, ['count']);
    const snap = getSnapshot();
    assert.ok(snap.signals.some((s) => s.name === 'count'));
  });

  await t.test('_suppressDevtools hides registrations and skips the guardrail', () => {
    const events = [];
    const unsub = subscribe((event) => events.push(event));
    _suppressDevtools(() => {
      hooks.onSignalCreate(fakeSignal('panelInternal', 0));
      hooks.onEffectCreate({ fn: function panelEffect() {} });
    });
    unsub();
    assert.equal(guarded.length, 1, 'guardrail must not run for suppressed signals');
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
