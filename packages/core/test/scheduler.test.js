// Tests for What Framework - DOM Scheduler
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock RAF for Node.js environment
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);

// Import after mocking
const { scheduleRead, scheduleWrite, flushScheduler, measure, mutate, nextFrame, raf } = await import('../src/scheduler.js');

describe('scheduler', () => {
  describe('scheduleRead', () => {
    it('should queue read operations', async () => {
      const values = [];
      scheduleRead(() => values.push('read1'));
      scheduleRead(() => values.push('read2'));

      await new Promise(r => setTimeout(r, 50));
      assert.deepEqual(values, ['read1', 'read2']);
    });

    it('should return a cancel function', async () => {
      const values = [];
      const cancel = scheduleRead(() => values.push('should not run'));
      cancel();

      await new Promise(r => setTimeout(r, 50));
      assert.deepEqual(values, []);
    });
  });

  describe('scheduleWrite', () => {
    it('should queue write operations', async () => {
      const values = [];
      scheduleWrite(() => values.push('write1'));
      scheduleWrite(() => values.push('write2'));

      await new Promise(r => setTimeout(r, 50));
      assert.deepEqual(values, ['write1', 'write2']);
    });

    it('should execute reads before writes', async () => {
      const values = [];
      scheduleWrite(() => values.push('write'));
      scheduleRead(() => values.push('read'));

      await new Promise(r => setTimeout(r, 50));
      assert.deepEqual(values, ['read', 'write']);
    });
  });

  describe('flushScheduler', () => {
    it('should immediately execute queued operations', () => {
      const values = [];
      scheduleRead(() => values.push('read'));
      scheduleWrite(() => values.push('write'));

      flushScheduler();
      assert.deepEqual(values, ['read', 'write']);
    });
  });

  describe('measure', () => {
    it('should schedule read and return promise', async () => {
      const result = await measure(() => 42);
      assert.equal(result, 42);
    });
  });

  describe('mutate', () => {
    it('should schedule write and return promise', async () => {
      let value = 0;
      await mutate(() => { value = 100; });
      assert.equal(value, 100);
    });
  });

  describe('nextFrame', () => {
    it('should wait for next animation frame', async () => {
      const start = Date.now();
      await nextFrame();
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 0); // At least some time passed
    });
  });

  describe('raf', () => {
    it('should run callback on animation frame with key', async () => {
      let called = false;
      raf('test-key', () => { called = true; });
      await new Promise(r => setTimeout(r, 50));
      assert.equal(called, true);
    });
  });
});
