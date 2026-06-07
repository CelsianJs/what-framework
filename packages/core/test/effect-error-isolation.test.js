// Regression: a single throwing effect must not abort the whole flush batch.
// Before AUDIT-2026-06-06 H8, _runEffect rethrew real errors during flush, so
// effects queued after the thrower never ran and the error escaped out of the
// signal write (e.g. an event handler) instead of being contained.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const { signal, effect, flushSync } = await import('../src/reactive.js');

let errors;
const origError = console.error;
beforeEach(() => { errors = []; console.error = (...a) => errors.push(a.join(' ')); });
afterEach(() => { console.error = origError; });

describe('effect error isolation in flush (AUDIT H8)', () => {
  it('a throwing effect does not prevent sibling effects from running', () => {
    const s = signal(0);
    const ran = [];
    effect(() => { if (s() === 1) throw new Error('boom'); ran.push('a:' + s()); });
    effect(() => { ran.push('b:' + s()); });
    flushSync();
    ran.length = 0;

    // The write must not throw out of flush, and the second effect must still run.
    assert.doesNotThrow(() => { s(1); flushSync(); });
    assert.ok(ran.includes('b:1'), `sibling effect should have run on update; ran=[${ran}]`);
    assert.ok(errors.some((e) => /boom/.test(e)), 'the error should be surfaced via console.error');
  });

  it('the graph keeps working after an effect throws', () => {
    const s = signal(0);
    const seen = [];
    effect(() => { if (s() === 2) throw new Error('boom'); seen.push(s()); });
    flushSync();
    s(2); flushSync(); // throws internally, contained
    s(3); flushSync(); // graph must still be live
    assert.ok(seen.includes(3), `effect should recover and run for later updates; seen=[${seen}]`);
  });
});
