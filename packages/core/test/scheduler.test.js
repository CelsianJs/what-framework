// Tests for What Framework - DOM Scheduler (what-framework/dom).
// Frames are run by hand: requestAnimationFrame queues its callback and
// runFrames() runs what is queued, so no test waits on a timer.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let frames = [];
let nextId = 1;
global.requestAnimationFrame = (cb) => { const id = nextId++; frames.push({ id, cb }); return id; };
global.cancelAnimationFrame = (id) => { frames = frames.filter(f => f.id !== id); };

// Runs one frame: every callback queued before it started.
function runFrame(time = 0) {
  const due = frames;
  frames = [];
  for (const f of due) f.cb(time);
}
async function runFrames(limit = 50) {
  for (let i = 0; i < limit && frames.length; i++) {
    runFrame();
    await Promise.resolve();
  }
}

const {
  scheduleRead, scheduleWrite, flushScheduler, measure, mutate, nextFrame, raf,
  useScheduledEffect, onResize, onIntersect, smoothScrollTo,
} = await import('../src/scheduler.js');
const { flushSync } = await import('../src/reactive.js');

beforeEach(() => {
  flushScheduler();
  frames = [];
});

describe('scheduler', () => {
  describe('scheduleRead', () => {
    it('queues reads for the next frame', () => {
      const values = [];
      scheduleRead(() => values.push('read1'));
      scheduleRead(() => values.push('read2'));
      assert.deepEqual(values, []);
      assert.equal(frames.length, 1, 'one frame for both');
      runFrame();
      assert.deepEqual(values, ['read1', 'read2']);
    });

    it('returns a cancel function', () => {
      const values = [];
      const cancel = scheduleRead(() => values.push('should not run'));
      cancel();
      runFrame();
      assert.deepEqual(values, []);
    });
  });

  describe('scheduleWrite', () => {
    it('queues writes for the next frame', () => {
      const values = [];
      scheduleWrite(() => values.push('write1'));
      scheduleWrite(() => values.push('write2'));
      runFrame();
      assert.deepEqual(values, ['write1', 'write2']);
    });

    it('runs reads before writes', () => {
      const values = [];
      scheduleWrite(() => values.push('write'));
      scheduleRead(() => values.push('read'));
      runFrame();
      assert.deepEqual(values, ['read', 'write']);
    });

    it('a read queued by a write runs in the next frame', () => {
      const values = [];
      scheduleWrite(() => { values.push('write'); scheduleRead(() => values.push('late read')); });
      runFrame();
      assert.deepEqual(values, ['write']);
      assert.equal(frames.length, 1, 'a frame is armed for the leftover read');
      runFrame();
      assert.deepEqual(values, ['write', 'late read']);
    });

    it('an error in one callback does not stop the others', () => {
      const original = console.error;
      const errors = [];
      console.error = (...args) => errors.push(args);
      try {
        const values = [];
        scheduleRead(() => { throw new Error('boom'); });
        scheduleWrite(() => values.push('write'));
        runFrame();
        assert.deepEqual(values, ['write']);
        assert.equal(errors.length, 1);
      } finally {
        console.error = original;
      }
    });
  });

  describe('flushScheduler', () => {
    it('runs queued operations at once', () => {
      const values = [];
      scheduleRead(() => values.push('read'));
      scheduleWrite(() => values.push('write'));
      flushScheduler();
      assert.deepEqual(values, ['read', 'write']);
    });
  });

  describe('measure and mutate', () => {
    it('measure resolves with the read', async () => {
      const result = measure(() => 42);
      runFrame();
      assert.equal(await result, 42);
    });

    it('mutate resolves after the write', async () => {
      let value = 0;
      const done = mutate(() => { value = 100; });
      assert.equal(value, 0);
      runFrame();
      await done;
      assert.equal(value, 100);
    });
  });

  describe('nextFrame', () => {
    it('waits for the next animation frame', async () => {
      let resolved = false;
      const done = nextFrame().then(() => { resolved = true; });
      await Promise.resolve();
      assert.equal(frames.length, 1, 'requests one frame');
      assert.equal(resolved, false, 'does not resolve before the frame');
      runFrame();
      await done;
      assert.equal(resolved, true);
    });

    it('cancel() drops the frame and rejects', async () => {
      const frame = nextFrame();
      assert.equal(frames.length, 1);
      frame.cancel();
      assert.equal(frames.length, 0);
      await assert.rejects(frame, /Cancelled/);
    });
  });

  describe('raf', () => {
    it('runs the latest callback for a key once per frame', () => {
      const calls = [];
      raf('key', () => calls.push('first'));
      raf('key', () => calls.push('second'));
      raf('other', () => calls.push('other'));
      assert.equal(frames.length, 2, 'one frame per key');
      runFrame();
      assert.deepEqual(calls, ['second', 'other']);
      raf('key', () => calls.push('third'));
      runFrame();
      assert.deepEqual(calls, ['second', 'other', 'third']);
    });
  });

  describe('useScheduledEffect', () => {
    it('reads in the read phase and hands the result to the write', async () => {
      const log = [];
      scheduleWrite(() => log.push('other write'));
      const dispose = useScheduledEffect(() => { log.push('read'); return 7; }, (n) => log.push('write ' + n));
      flushSync();
      await runFrames();
      // One frame: its reads, then its writes.
      assert.deepEqual(log, ['read', 'other write', 'write 7']);
      dispose();
    });

    it('takes no write function', async () => {
      let reads = 0;
      const dispose = useScheduledEffect(() => { reads++; });
      flushSync();
      await runFrames();
      assert.equal(reads, 1);
      dispose();
    });
  });

  describe('onResize', () => {
    // onResize shares one observer across elements, made on first use.
    const observers = [];
    const observing = (el) => observers.find(o => o.targets.has(el));
    global.ResizeObserver = class {
      constructor(cb) { this.cb = cb; this.targets = new Set(); observers.push(this); }
      observe(el) { this.targets.add(el); }
      unobserve(el) { this.targets.delete(el); }
      fire(el, contentRect) { this.cb([{ target: el, contentRect }]); }
    };

    it('calls back in the read phase with the content rect', async () => {
      const el = {};
      const rects = [];
      const stop = onResize(el, (r) => rects.push(r));
      const observer = observing(el);
      assert.ok(observer);
      observer.fire(el, { width: 10 });
      assert.deepEqual(rects, [], 'not before the frame');
      runFrame();
      assert.deepEqual(rects, [{ width: 10 }]);
      stop();
      assert.equal(observer.targets.has(el), false);
    });

    it('keeps every callback registered for the same element', () => {
      const el = {};
      const a = [];
      const b = [];
      const stopA = onResize(el, (r) => a.push(r.width));
      const stopB = onResize(el, (r) => b.push(r.width));
      const observer = observing(el);
      observer.fire(el, { width: 1 });
      runFrame();
      assert.deepEqual([a, b], [[1], [1]]);
      stopA();
      assert.ok(observer.targets.has(el), 'still observed for the other callback');
      observer.fire(el, { width: 2 });
      runFrame();
      assert.deepEqual([a, b], [[1], [1, 2]]);
      stopB();
      assert.equal(observer.targets.has(el), false);
    });
  });

  describe('onResize and onIntersect without the observers', () => {
    it('call back once with the element as it is', () => {
      const saved = [global.ResizeObserver, global.IntersectionObserver];
      delete global.ResizeObserver;
      delete global.IntersectionObserver;
      try {
        const seen = [];
        onResize({ getBoundingClientRect: () => ({ width: 5 }) }, (r) => seen.push(r.width));
        onIntersect({}, (e) => seen.push(e.isIntersecting));
        assert.deepEqual(seen, [5, true]);
      } finally {
        [global.ResizeObserver, global.IntersectionObserver] = saved;
      }
    });
  });

  describe('onIntersect', () => {
    it('passes the options and calls back in the read phase; the stop function disconnects', () => {
      let made;
      global.IntersectionObserver = class {
        constructor(cb, options) { this.cb = cb; this.options = options; this.disconnected = false; made = this; }
        observe(el) { this.el = el; }
        disconnect() { this.disconnected = true; }
      };
      try {
        const el = {};
        const seen = [];
        const stop = onIntersect(el, (e) => seen.push(e.isIntersecting), { threshold: 0.5 });
        assert.deepEqual(made.options, { threshold: 0.5 });
        assert.equal(made.el, el);
        made.cb([{ isIntersecting: true }, { isIntersecting: false }]);
        assert.deepEqual(seen, []);
        runFrame();
        assert.deepEqual(seen, [true, false]);
        stop();
        assert.equal(made.disconnected, true);
      } finally {
        delete global.IntersectionObserver;
      }
    });
  });

  describe('smoothScrollTo', () => {
    it('scrolls from the current position to the element over the duration, then resolves', async () => {
      let now = 1000;
      const scrolls = [];
      const savedNow = performance.now;
      global.window = { scrollY: 100, scrollTo: (x, y) => { scrolls.push(y); } };
      performance.now = () => now;
      try {
        let done = false;
        const p = smoothScrollTo({ getBoundingClientRect: () => ({ top: 400 }) }, { duration: 100, easing: (t) => t })
          .then(() => { done = true; });
        for (let i = 0; i < 20 && !done; i++) {
          runFrame();
          await Promise.resolve();
          now += 25;
        }
        await p;
        assert.equal(scrolls[0], 100, 'starts where the page is');
        assert.equal(scrolls.at(-1), 500, 'ends at the element');
        for (let i = 1; i < scrolls.length; i++) assert.ok(scrolls[i] >= scrolls[i - 1], 'moves one way');
        assert.ok(scrolls.length >= 3, 'in steps, not one jump');
      } finally {
        performance.now = savedNow;
        delete global.window;
      }
    });
  });
});
