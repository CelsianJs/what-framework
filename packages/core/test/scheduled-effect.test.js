// useScheduledEffect(readFn, writeFn) reads in a frame's read phase and
// writes in its write phase, and runs again when a signal readFn read
// changes: changes before the frame make one read and one write, and
// disposing it (or its owner) cancels a frame still to come.
//
// Frames are a queue the test runs itself (frames(n)); the scheduler's queues
// are module state, so everything is one suite.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const pendingFrames = new Map();
let lastFrame = 0;
global.requestAnimationFrame = (cb) => {
  pendingFrames.set(++lastFrame, cb);
  return lastFrame;
};
global.cancelAnimationFrame = (id) => {
  pendingFrames.delete(id);
};

const { signal, flushSync, createRoot } = await import('../src/reactive.js');
const { useScheduledEffect, scheduleRead, scheduleWrite, flushScheduler } = await import('../src/scheduler.js');

function frames(n) {
  for (let i = 0; i < n; i++) {
    const due = [...pendingFrames.values()];
    pendingFrames.clear();
    for (const cb of due) cb(performance.now());
  }
}

describe('useScheduledEffect', () => {
  beforeEach(() => {
    pendingFrames.clear();
    flushScheduler();
  });

  it('runs again when what readFn read changes', () => {
    const s = signal(1);
    const log = [];
    const stop = useScheduledEffect(() => s(), (v) => log.push(v));
    frames(2);
    assert.deepEqual(log, [1]);
    s(2);
    flushSync();
    frames(2);
    assert.deepEqual(log, [1, 2]);
    stop();
  });

  it('reads in the read phase and writes in the write phase of a frame', () => {
    const s = signal(1);
    const order = [];
    const stop = useScheduledEffect(() => { order.push(`read ${s()}`); return s(); }, (v) => order.push(`write ${v}`));
    assert.deepEqual(order, [], 'nothing runs before the frame');
    // Another read and write queued for the same frame: every read runs before every write.
    scheduleWrite(() => order.push('other write'));
    scheduleRead(() => order.push('other read'));
    frames(1);
    assert.deepEqual(order, ['read 1', 'other read', 'other write', 'write 1']);
    order.length = 0;
    s(2);
    flushSync();
    assert.deepEqual(order, [], 'a change reads in the next frame, not in the flush');
    frames(1);
    assert.deepEqual(order, ['read 2', 'write 2']);
    stop();
  });

  it('makes one read and one write for changes before the frame', () => {
    const s = signal(1);
    let reads = 0;
    const log = [];
    const stop = useScheduledEffect(() => { reads++; return s(); }, (v) => log.push(v));
    frames(1);
    s(2);
    flushSync();
    s(3);
    flushSync();
    frames(2);
    assert.equal(reads, 2);
    assert.deepEqual(log, [1, 3]);
    stop();
  });

  it('tracks what the latest read read', () => {
    const which = signal('a');
    const a = signal('A');
    const b = signal('B');
    const log = [];
    const stop = useScheduledEffect(() => (which() === 'a' ? a() : b()), (v) => log.push(v));
    frames(1);
    which('b');
    flushSync();
    frames(1);
    a('A2');
    flushSync();
    frames(1);
    b('B2');
    flushSync();
    frames(1);
    assert.deepEqual(log, ['A', 'B', 'B2']);
    stop();
  });

  it('disposing it cancels a frame still to come', () => {
    const s = signal(1);
    const log = [];
    const stop = useScheduledEffect(() => s(), (v) => log.push(v));
    frames(1);
    s(2);
    flushSync();
    stop();
    frames(2);
    s(3);
    flushSync();
    frames(2);
    assert.deepEqual(log, [1]);
  });

  it('is disposed with its owner, before its first frame too', () => {
    const s = signal(1);
    const log = [];
    let dispose;
    createRoot((d) => {
      dispose = d;
      useScheduledEffect(() => s(), (v) => log.push(v));
    });
    dispose();
    frames(2);
    s(2);
    flushSync();
    frames(2);
    assert.deepEqual(log, []);
  });

  it('runs readFn alone when there is no writeFn', () => {
    const s = signal(1);
    const seen = [];
    const stop = useScheduledEffect(() => seen.push(s()));
    frames(1);
    s(2);
    flushSync();
    frames(1);
    assert.deepEqual(seen, [1, 2]);
    stop();
  });
});
