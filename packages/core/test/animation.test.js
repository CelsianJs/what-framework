// Tests for What Framework - Animation Primitives
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
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

    it('should support immediate snap', () => {
      const s = spring(0);
      s.snap(100);
      assert.equal(s.current(), 100);
    });

    it('should set target when calling set', () => {
      const s = spring(0);
      s.set(50);
      assert.equal(s.target(), 50);
    });

    it('should be stoppable', () => {
      const s = spring(0);
      s.set(100);
      s.stop();
      assert.equal(s.isAnimating(), false);
    });

    it('should have subscribe method', () => {
      const s = spring(0);
      assert.ok(typeof s.subscribe === 'function');
    });
  });

  describe('tween', () => {
    it('should create a tween with from/to values', () => {
      const t = tween(0, 100, { duration: 50 });
      // Initially starts at 0 or close to it
      assert.ok(t.value() <= 100);
    });

    it('should have progress and value getters', () => {
      const t = tween(0, 100, { duration: 100 });
      assert.ok(typeof t.progress === 'function');
      assert.ok(typeof t.value === 'function');
    });

    it('should have isAnimating getter', () => {
      const t = tween(0, 100, { duration: 100 });
      assert.ok(typeof t.isAnimating === 'function');
    });

    it('should be cancellable', () => {
      const t = tween(0, 100, { duration: 200 });
      t.cancel();
      assert.equal(t.isAnimating(), false);
    });

    it('should have subscribe method', () => {
      const t = tween(0, 100, { duration: 100 });
      assert.ok(typeof t.subscribe === 'function');
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
