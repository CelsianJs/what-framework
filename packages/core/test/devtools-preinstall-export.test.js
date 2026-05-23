// Regression: __drainPreinstallBuffer must be exported from the public
// what-core entry point.
//
// Bug history: the P1-9 fix added a pre-install buffer in reactive.js so that
// module-scope signals created BEFORE the devtools entry point runs can still
// register. The fix wires installDevTools() to call `mod.__drainPreinstallBuffer()`.
// But the public `packages/core/src/index.js` did NOT re-export the function —
// it was only exported from `reactive.js`. So `installDevTools(import * as core
// from 'what-core')` saw `typeof mod.__drainPreinstallBuffer === 'undefined'`
// and silently skipped the drain.
//
// Symptom: dx-testbed in the browser showed 0 signals/effects/components in
// devtools, despite the app having 200+ of them. The "fix" had no effect in
// production because the function wasn't reachable from the public surface.
//
// This test imports the public root entry (not reactive.js directly) and
// proves the symbol is exported. It also exercises the late-install flow:
// create signals/effects FIRST, then install hooks, then call drain, and
// verify the buffered primitives are returned for registration.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import via the public root entry — this is what `installDevTools(core)`
// sees when the bootstrap does `import * as core from 'what-core'`.
const core = await import('../src/index.js');

describe('what-core public exports: devtools preinstall surface', () => {
  it('exports __setDevToolsHooks', () => {
    assert.equal(typeof core.__setDevToolsHooks, 'function',
      '__setDevToolsHooks must be on the public surface for installDevTools()');
  });

  it('exports __drainPreinstallBuffer', () => {
    // The P1-9 fix is dead code without this export. Production browsers
    // import the package root, not reactive.js — if the symbol is missing,
    // module-scope signals created before installDevTools() vanish from
    // devtools and `what_signals` returns an empty registry.
    assert.equal(typeof core.__drainPreinstallBuffer, 'function',
      '__drainPreinstallBuffer must be exported from packages/core/src/index.js — ' +
      'this is the public symbol installDevTools() reaches for');
  });

  it('late-install flow: signals created before hooks install are recovered via drain', () => {
    // Step 1: create a named signal BEFORE installing devtools hooks.
    // In production this is the module-scope `signal(initial, 'name')` pattern.
    const earlySignal = core.signal({ todos: [] }, '__test_early_module_signal__');
    const earlyEffect = core.effect(() => earlySignal());

    // Step 2: install real devtools hooks AFTER signals already exist.
    const captured = { signals: [], effects: [], components: [] };
    core.__setDevToolsHooks({
      onSignalCreate: (s) => captured.signals.push(s),
      onSignalUpdate: () => {},
      onEffectCreate: (e) => captured.effects.push(e),
      onEffectRun: () => {},
      onEffectDispose: () => {},
      onError: () => {},
      onComponentMount: (c) => captured.components.push(c),
      onComponentUnmount: () => {},
    });

    // Step 3: drain the preinstall buffer — the function must exist and
    // return the early signal so devtools can register it.
    const drained = core.__drainPreinstallBuffer();
    assert.ok(drained, 'drain returns a result object');
    assert.ok(Array.isArray(drained.signals), 'drain returns signals array');
    assert.ok(Array.isArray(drained.effects), 'drain returns effects array');
    assert.ok(Array.isArray(drained.components), 'drain returns components array');

    // The early signal must be discoverable via drain (WeakRef live).
    // The framework stores the debug name on `_debugName` (set on the signal
    // accessor function during creation in reactive.js).
    const found = drained.signals.find(s => s?._debugName === '__test_early_module_signal__');
    assert.ok(found, 'early-created named signal is recovered from preinstall buffer');

    // The early effect must also be present.
    assert.ok(drained.effects.length >= 1, 'early effect is recovered from preinstall buffer');

    // Keep refs alive across the test (prevent GC of the WeakRef).
    earlyEffect; earlySignal;
  });
});
