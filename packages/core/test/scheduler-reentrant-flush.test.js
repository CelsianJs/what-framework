// Regression tests for work queued DURING a scheduler flush (backlog #55).
//
// The scheduler drains reads, then writes, and only then clears its "a frame is
// armed" flag. A callback that scheduled more work while the flush was running
// therefore landed in an already-drained queue with no frame left to drain it,
// and that work stayed there until some unrelated code happened to poke the
// scheduler again.
//
// cssTransition() is the caller that made this visible: it asks for a reflow
// READ from inside a WRITE (write start class -> read offsetHeight -> write
// active class), so its promise never resolved and the element stayed stuck on
// the start class.
//
// Everything lives in ONE suite on purpose. Node runs top-level suites
// concurrently, and the queues are module state: a sibling suite scheduling
// anything arms a frame that drains this suite's "dropped" work and hides the
// very defect these tests exist to catch.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

// Set up DOM globals before importing framework modules (animation.js pulls in
// dom.js). rAF is modelled as a 16ms timer, the same shim the other core tests use.
installDOM('<!DOCTYPE html><html><body></body></html>');

const pendingFrames = new Set();
global.requestAnimationFrame = (cb) => {
  const id = setTimeout(() => { pendingFrames.delete(id); cb(performance.now()); }, 16);
  pendingFrames.add(id);
  return id;
};
global.cancelAnimationFrame = (id) => {
  pendingFrames.delete(id);
  clearTimeout(id);
};

const { scheduleRead, scheduleWrite, flushScheduler } = await import('../src/scheduler.js');
const { cssTransition } = await import('../src/animation.js');

// Wait for `n` mocked animation frames to elapse, with slack for timer jitter.
const frames = (n) => new Promise((r) => setTimeout(r, n * 16 + 20));

describe('scheduler: work queued during a flush', () => {
  beforeEach(() => {
    // Start every test from an empty scheduler. Cancel frames first so a stray
    // one cannot fire mid-test and drain queues the test is watching, then
    // flush repeatedly: on the unfixed scheduler a single pass cannot drain
    // work that was queued during that same pass.
    for (const id of [...pendingFrames]) global.cancelAnimationFrame(id);
    flushScheduler();
    flushScheduler();
    flushScheduler();
  });

  it('runs a read queued from inside a write (the cssTransition reflow pattern)', async () => {
    const order = [];

    scheduleWrite(() => {
      order.push('write');
      scheduleRead(() => order.push('read-from-write'));
    });

    await frames(3);
    assert.deepEqual(order, ['write', 'read-from-write']);
  });

  it('runs a write queued from inside a write', async () => {
    const order = [];

    scheduleWrite(() => {
      order.push('write');
      scheduleWrite(() => order.push('write-from-write'));
    });

    await frames(3);
    assert.deepEqual(order, ['write', 'write-from-write']);
  });

  it('still runs a write queued from a read in the SAME flush', () => {
    // Pins existing behaviour that smoothScrollTo and useScheduledEffect rely
    // on: the write phase starts after the read phase, so a write requested by
    // a read must not be pushed out to another frame.
    const order = [];

    scheduleRead(() => {
      order.push('read');
      scheduleWrite(() => order.push('write-from-read'));
    });

    flushScheduler();
    assert.deepEqual(order, ['read', 'write-from-read']);
  });

  it('defers cross-phase leftovers by a frame instead of looping inside the flush', async () => {
    // A callback that re-schedules itself must cost one iteration per frame,
    // not spin the main thread inside a single flush, so flushScheduler() has
    // to return with the leftovers still queued.
    const order = [];

    scheduleWrite(() => {
      order.push('write');
      scheduleRead(() => order.push('read-from-write'));
    });

    flushScheduler();
    assert.deepEqual(order, ['write'], 'nested read must not run inside the same flush');

    await frames(3);
    assert.deepEqual(order, ['write', 'read-from-write'], 'nested read must run on a later frame');
  });

  it('arms at most one frame for leftovers', async () => {
    // Guard against a frame storm: several callbacks each queueing more work
    // during one flush must share a single follow-up frame.
    let frameCount = 0;
    const realRaf = global.requestAnimationFrame;
    global.requestAnimationFrame = (cb) => { frameCount++; return realRaf(cb); };

    try {
      scheduleWrite(() => {
        scheduleRead(() => {});
        scheduleRead(() => {});
        scheduleWrite(() => {});
      });
      frameCount = 0; // count only the frames armed from inside the flush
      flushScheduler();
      assert.equal(frameCount, 1);
    } finally {
      global.requestAnimationFrame = realRaf;
    }

    await frames(3);
  });

  it('cssTransition settles and leaves the element on the done class', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const outcome = await Promise.race([
      cssTransition(el, 'fade', 'enter', 10).then(() => 'settled'),
      new Promise((r) => setTimeout(() => r('timeout'), 500)),
    ]);

    assert.equal(outcome, 'settled', 'cssTransition() promise never resolved');
    assert.equal(el.classList.contains('fade-enter'), false, 'start class must be removed');
    assert.equal(el.classList.contains('fade-enter-active'), false, 'active class must be removed');
    assert.equal(el.classList.contains('fade-enter-done'), true, 'done class must be applied');
  });

  it('cssTransition applies the active class while the transition is running', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const done = cssTransition(el, 'slide', 'exit', 150);

    // A few frames in: start class applied (write), reflow read done, active
    // class applied (write). The done class only lands after the 150ms timer.
    await frames(4);
    assert.equal(el.classList.contains('slide-exit'), true, 'start class must still be applied');
    assert.equal(el.classList.contains('slide-exit-active'), true, 'active class must be applied');
    assert.equal(el.classList.contains('slide-exit-done'), false, 'done class must not be applied yet');

    await done;
    assert.equal(el.classList.contains('slide-exit-done'), true);
  });
});
