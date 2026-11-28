// onCleanup inside an effect belongs to that run of the effect: it runs before
// the next run, with the values of the run that registered it, and when the
// effect is disposed. docs/UPGRADING.md and docs/API.md describe this.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRoot, effect, signal, flushSync, onCleanup } from '../src/index.js';
import { capture } from '../src/diagnostics.js';

describe('onCleanup inside an effect', () => {
  it('runs before the next run and on dispose, with the values of its own run', () => {
    const log = [];
    const s = signal(0);
    const cap = capture({ quiet: true });
    try {
      const dispose = createRoot((d) => {
        effect(() => {
          const v = s();
          onCleanup(() => log.push(`cleanup ${v}`));
          log.push(`run ${v}`);
        });
        return d;
      });
      flushSync();
      s(1);
      flushSync();
      s(2);
      flushSync();
      log.push('dispose');
      dispose();
    } finally {
      cap.stop();
    }
    assert.deepEqual(log, ['run 0', 'cleanup 0', 'run 1', 'cleanup 1', 'run 2', 'dispose', 'cleanup 2']);
    assert.deepEqual(cap.events.map((e) => e.code), [], 'an effect is an owner: no ERR_CLEANUP_WITHOUT_OWNER');
  });

  it('runs the cleanups of a run newest first, as an owner disposes its registrations, then the returned cleanup', () => {
    const log = [];
    const s = signal(0);
    const dispose = createRoot((d) => {
      effect(() => {
        s();
        onCleanup(() => log.push('first'));
        onCleanup(() => log.push('second'));
        return () => log.push('returned');
      });
      return d;
    });
    flushSync();
    s(1);
    flushSync();
    assert.deepEqual(log, ['second', 'first', 'returned']);
    dispose();
  });

  it('an effect created outside any root still owns the cleanups of its runs', () => {
    const log = [];
    const s = signal('a');
    const cap = capture({ quiet: true });
    let stop;
    try {
      stop = effect(() => {
        const v = s();
        onCleanup(() => log.push(v));
      });
      flushSync();
      s('b');
      flushSync();
      stop();
    } finally {
      cap.stop();
    }
    assert.deepEqual(log, ['a', 'b']);
    assert.deepEqual(cap.events.map((e) => e.code), []);
  });
});
