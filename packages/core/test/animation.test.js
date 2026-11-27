// Tests for What Framework - Animation Primitives
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Track RAF timeouts for cleanup
const pendingTimeouts = new Set();

// Mock RAF for Node.js environment
global.requestAnimationFrame = (cb) => {
  const id = setTimeout(cb, 16);
  pendingTimeouts.add(id);
  return id;
};
global.cancelAnimationFrame = (id) => {
  pendingTimeouts.delete(id);
  clearTimeout(id);
};

const { spring, tween, easings, createTransitionClasses } = await import('../src/animation.js');
const { flushSync } = await import('../src/reactive.js');

// Cleanup after all tests
afterEach(() => {
  for (const id of pendingTimeouts) {
    clearTimeout(id);
  }
  pendingTimeouts.clear();
});

describe('animation', () => {
  describe('spring', () => {
    it('should create a spring with initial value', () => {
      const s = spring(0);
      assert.equal(s.current(), 0);
    });

    it('subscribe reports the current value now and after each change, until unsubscribed', () => {
      const s = spring(0);
      const seen = [];
      const unsubscribe = s.subscribe((v) => seen.push(v));
      s.snap(100);
      flushSync();
      unsubscribe();
      s.snap(5);
      flushSync();
      assert.deepEqual(seen, [0, 100]);
    });
  });

  describe('tween', () => {
    it('subscribe reports the value, not the progress, from the start to the end', async () => {
      const t = tween(0, 100, { duration: 0 });
      const seen = [];
      const unsubscribe = t.subscribe((v) => seen.push(v));
      await new Promise((resolve) => setTimeout(resolve, 40));
      flushSync();
      unsubscribe();
      assert.deepEqual(seen, [0, 100]);
    });
  });

  describe('easings', () => {
    it('should have linear easing', () => {
      assert.equal(easings.linear(0), 0);
      assert.equal(easings.linear(0.5), 0.5);
      assert.equal(easings.linear(1), 1);
    });

    it('should have easeInQuad', () => {
      assert.equal(easings.easeInQuad(0), 0);
      assert.equal(easings.easeInQuad(1), 1);
      assert.ok(easings.easeInQuad(0.5) < 0.5); // Ease in is slow at start
    });

    it('should have easeOutQuad', () => {
      assert.equal(easings.easeOutQuad(0), 0);
      assert.equal(easings.easeOutQuad(1), 1);
      assert.ok(easings.easeOutQuad(0.5) > 0.5); // Ease out is fast at start
    });

    it('should have easeInOutQuad', () => {
      assert.equal(easings.easeInOutQuad(0), 0);
      assert.equal(easings.easeInOutQuad(1), 1);
      assert.equal(easings.easeInOutQuad(0.5), 0.5); // Middle point
    });

    it('should have core standard easings', () => {
      const expected = [
        'linear', 'easeInQuad', 'easeOutQuad', 'easeInOutQuad',
        'easeInCubic', 'easeOutCubic', 'easeInOutCubic',
        'easeInElastic', 'easeOutElastic', 'easeOutBounce',
      ];

      for (const name of expected) {
        assert.ok(typeof easings[name] === 'function', `Missing easing: ${name}`);
      }
    });
  });

  describe('createTransitionClasses', () => {
    it('should create transition class config', () => {
      const config = createTransitionClasses('fade');

      assert.equal(config.enter, 'fade-enter');
      assert.equal(config.enterActive, 'fade-enter-active');
      assert.equal(config.enterDone, 'fade-enter-done');
      assert.equal(config.exit, 'fade-exit');
      assert.equal(config.exitActive, 'fade-exit-active');
      assert.equal(config.exitDone, 'fade-exit-done');
    });
  });
});
