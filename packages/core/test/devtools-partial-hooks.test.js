// Regression: __setDevToolsHooks() must accept a partial hooks object.
//
// Bug history: the reactive core called its hooks unguarded —
// `if (__DEV__ && __devtools) __devtools.onSignalCreate(sig)`. In practice that
// never crashed, because in dev `__devtools` is seeded with a pre-install
// placeholder that happens to define every hook, and the real devtools define
// every hook too. But __setDevToolsHooks is an exported API, and installing a
// single hook — the obvious way to observe just one kind of event, and exactly
// what trackSignals() builds when no devtools are present — replaced that full
// object with a partial one. The very next signal() threw
// "TypeError: __devtools.onSignalCreate is not a function".
//
// Found by turning checkJs on over packages/*/src: the hooks type says every
// method is optional, and 14 call sites invoked them unconditionally.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { signal, effect, flushSync, __setDevToolsHooks } from '../src/index.js';
// __devtools is a live binding on reactive.js and is not re-exported by the
// public entry; read it from the module that owns it so the original hooks can
// be put back.
import * as reactive from '../src/reactive.js';

const original = reactive.__devtools;
afterEach(() => __setDevToolsHooks(original));

describe('__setDevToolsHooks with a partial hooks object', () => {
  it('does not throw when only onSignalUpdate is installed', () => {
    const written = [];
    __setDevToolsHooks({ onSignalUpdate: (sig) => written.push(sig?._debugName) });

    assert.doesNotThrow(() => {
      const s = signal(1, 'partial-a');   // would call onSignalCreate
      const dispose = effect(() => s());  // would call onEffectCreate/onEffectRun
      flushSync();
      s.set(2);
      dispose();                          // would call onEffectDispose
      flushSync();
    });

    assert.deepEqual(written, ['partial-a']);
  });

  it('does not throw when an empty hooks object is installed', () => {
    __setDevToolsHooks({});
    assert.doesNotThrow(() => {
      const s = signal(0, 'partial-b');
      const dispose = effect(() => s());
      flushSync();
      s.set(1);
      flushSync();
      dispose();
    });
  });

  it('still reports errors thrown inside an effect without an onError hook', () => {
    __setDevToolsHooks({ onSignalCreate() {} });
    const s = signal(0, 'partial-c');
    assert.doesNotThrow(() => {
      effect(() => {
        if (s() > 0) throw new Error('boom');
      });
      flushSync();
      s.set(1);
      flushSync();
    });
  });
});
