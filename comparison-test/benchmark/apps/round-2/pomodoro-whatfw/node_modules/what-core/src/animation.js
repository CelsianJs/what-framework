// What Framework - Animation Primitives
// Springs, tweens, gestures, and transition helpers

import { signal, effect, untrack, batch } from './reactive.js';
import { getCurrentComponent } from './dom.js';
import { scheduleRead, scheduleWrite } from './scheduler.js';

// Create an effect scoped to the current component's lifecycle
function scopedEffect(fn) {
  const ctx = getCurrentComponent?.();
  const dispose = effect(fn);
  if (ctx) ctx.effects.push(dispose);
  return dispose;
}

// --- Spring Animation ---
// Physics-based animation with natural feel

export function spring(initialValue, options = {}) {
  const {
    stiffness = 100,
    damping = 10,
    mass = 1,
    precision = 0.01,
  } = options;

  const current = signal(initialValue);
  const target = signal(initialValue);
  const velocity = signal(0);
  const isAnimating = signal(false);

  let rafId = null;
  let lastTime = null;

  function tick(time) {
    if (lastTime === null) {
      lastTime = time;
      rafId = requestAnimationFrame(tick);
      return;
    }

    const dt = Math.min((time - lastTime) / 1000, 0.064); // Cap at ~15fps minimum
    lastTime = time;

    const currentVal = current.peek();
    const targetVal = target.peek();
    const vel = velocity.peek();

    // Spring physics
    const displacement = currentVal - targetVal;
    const springForce = -stiffness * displacement;
    const dampingForce = -damping * vel;
    const acceleration = (springForce + dampingForce) / mass;

    const newVelocity = vel + acceleration * dt;
    const newValue = currentVal + newVelocity * dt;

    batch(() => {
      velocity.set(newVelocity);
      current.set(newValue);
    });

    // Check if settled
    if (Math.abs(newVelocity) < precision && Math.abs(displacement) < precision) {
      batch(() => {
        current.set(targetVal);
        velocity.set(0);
        isAnimating.set(false);
      });
      rafId = null;
      lastTime = null;
      return;
    }

    rafId = requestAnimationFrame(tick);
  }

  function set(newTarget) {
    target.set(newTarget);
    // Use rafId check instead of isAnimating signal — signal may not have flushed
    // after a synchronous stop() call, causing duplicate animation frames
    if (rafId === null) {
      isAnimating.set(true);
      lastTime = null;
      rafId = requestAnimationFrame(tick);
    }
  }

  function stop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    isAnimating.set(false);
    lastTime = null;
  }

  function snap(value) {
    stop();
    batch(() => {
      current.set(value);
      target.set(value);
      velocity.set(0);
    });
  }

  // Register stop() as cleanup if inside a component
  const ctx = getCurrentComponent?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(stop);
  }

  return {
    current: () => current(),
    target: () => target(),
    velocity: () => velocity(),
    isAnimating: () => isAnimating(),
    set,
    stop,
    snap,
    subscribe: current.subscribe,
  };
}

// --- Tween Animation ---
// Easing-based animation

export function tween(from, to, options = {}) {
  const {
    duration = 300,
    easing = (t) => t * (2 - t), // easeOutQuad
    onUpdate,
    onComplete,
  } = options;

  const progress = signal(0);
  const value = signal(from);
  const isAnimating = signal(true);

  let startTime = null;
  let rafId = null;

  function tick(time) {
    if (startTime === null) startTime = time;

    const elapsed = time - startTime;
    const t = Math.min(elapsed / duration, 1);
    const easedT = easing(t);
    const currentValue = from + (to - from) * easedT;

    batch(() => {
      progress.set(t);
      value.set(currentValue);
    });

    if (onUpdate) onUpdate(currentValue, t);

    if (t < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      isAnimating.set(false);
      if (onComplete) onComplete();
    }
  }

  rafId = requestAnimationFrame(tick);

  return {
    progress: () => progress(),
    value: () => value(),
    isAnimating: () => isAnimating(),
    cancel: () => {
      if (rafId) cancelAnimationFrame(rafId);
      isAnimating.set(false);
    },
    subscribe: value.subscribe,
  };
}

// --- Easing Functions ---

export const easings = {
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => t * (2 - t),
  easeInOutQuad: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => (--t) * t * t + 1,
  easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,
  easeInElastic: (t) => t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * ((2 * Math.PI) / 3)),
  easeOutElastic: (t) => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
  easeOutBounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

// --- useTransition Hook ---
// Animate between states

export function useTransition(options = {}) {
  const { duration = 300, easing = easings.easeOutQuad } = options;

  const isTransitioning = signal(false);
  const progress = signal(0);

  async function start(callback) {
    isTransitioning.set(true);
    progress.set(0);

    return new Promise((resolve) => {
      const startTime = performance.now();

      function tick(time) {
        const elapsed = time - startTime;
        const t = Math.min(elapsed / duration, 1);
        progress.set(easing(t));

        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          isTransitioning.set(false);
          if (callback) callback();
          resolve();
        }
      }

      requestAnimationFrame(tick);
    });
  }

  return {
    isTransitioning: () => isTransitioning(),
    progress: () => progress(),
    start,
  };
}

// --- Gesture Handlers ---

export function useGesture(element, handlers = {}) {
  const {
    onDrag,
    onDragStart,
    onDragEnd,
    onPinch,
    onSwipe,
    onTap,
    onLongPress,
    preventDefault = false, // Set to true to allow e.preventDefault() in touch handlers
  } = handlers;

  const state = {
    isDragging: signal(false),
    startX: 0,
    startY: 0,
    currentX: signal(0),
    currentY: signal(0),
    deltaX: signal(0),
    deltaY: signal(0),
    velocity: signal({ x: 0, y: 0 }),
  };

  let lastTime = 0;
  let lastX = 0;
  let lastY = 0;
  let longPressTimer = null;

  function handleStart(e) {
    const touch = e.touches ? e.touches[0] : e;
    state.startX = touch.clientX;
    state.startY = touch.clientY;
    lastX = touch.clientX;
    lastY = touch.clientY;
    lastTime = performance.now();

    state.isDragging.set(true);
    if (onDragStart) onDragStart({ x: state.startX, y: state.startY });

    // Long press detection
    if (onLongPress) {
      longPressTimer = setTimeout(() => {
        if (state.isDragging.peek()) {
          onLongPress({ x: lastX, y: lastY });
        }
      }, 500);
    }
  }

  function handleMove(e) {
    if (!state.isDragging.peek()) return;

    const touch = e.touches ? e.touches[0] : e;
    const x = touch.clientX;
    const y = touch.clientY;
    const now = performance.now();
    const dt = now - lastTime;

    batch(() => {
      state.currentX.set(x);
      state.currentY.set(y);
      state.deltaX.set(x - state.startX);
      state.deltaY.set(y - state.startY);

      if (dt > 0) {
        state.velocity.set({
          x: (x - lastX) / dt * 1000,
          y: (y - lastY) / dt * 1000,
        });
      }
    });

    lastX = x;
    lastY = y;
    lastTime = now;

    if (longPressTimer) {
      // Cancel long press if moved too much
      const distance = Math.sqrt(state.deltaX.peek() ** 2 + state.deltaY.peek() ** 2);
      if (distance > 10) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }

    if (onDrag) {
      onDrag({
        x,
        y,
        deltaX: state.deltaX.peek(),
        deltaY: state.deltaY.peek(),
        velocity: state.velocity.peek(),
      });
    }
  }

  function handleEnd(e) {
    if (!state.isDragging.peek()) return;

    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    const deltaX = state.deltaX.peek();
    const deltaY = state.deltaY.peek();
    const velocity = state.velocity.peek();
    const distance = Math.sqrt(deltaX ** 2 + deltaY ** 2);

    // Tap detection
    if (distance < 10 && onTap) {
      onTap({ x: state.startX, y: state.startY });
    }

    // Swipe detection
    if (onSwipe && (Math.abs(velocity.x) > 500 || Math.abs(velocity.y) > 500)) {
      const direction = Math.abs(velocity.x) > Math.abs(velocity.y)
        ? (velocity.x > 0 ? 'right' : 'left')
        : (velocity.y > 0 ? 'down' : 'up');
      onSwipe({ direction, velocity });
    }

    if (onDragEnd) {
      onDragEnd({
        deltaX,
        deltaY,
        velocity,
      });
    }

    state.isDragging.set(false);
  }

  // Pinch handling (touch only)
  let initialPinchDistance = null;

  function handlePinchMove(e) {
    if (!onPinch || e.touches.length !== 2) return;

    const touch1 = e.touches[0];
    const touch2 = e.touches[1];
    const distance = Math.sqrt(
      (touch2.clientX - touch1.clientX) ** 2 +
      (touch2.clientY - touch1.clientY) ** 2
    );

    if (initialPinchDistance === null) {
      initialPinchDistance = distance;
    }

    const scale = distance / initialPinchDistance;
    const centerX = (touch1.clientX + touch2.clientX) / 2;
    const centerY = (touch1.clientY + touch2.clientY) / 2;

    onPinch({ scale, centerX, centerY });
  }

  function handlePinchEnd() {
    initialPinchDistance = null;
  }

  // Attach listeners
  if (typeof element === 'function') {
    // Ref function
    scopedEffect(() => {
      const el = untrack(element);
      if (!el) return;
      return attachListeners(el);
    });
  } else if (element?.current !== undefined) {
    // Ref object
    scopedEffect(() => {
      const el = element.current;
      if (!el) return;
      return attachListeners(el);
    });
  } else if (element) {
    attachListeners(element);
  }

  function attachListeners(el) {
    el.addEventListener('mousedown', handleStart);
    el.addEventListener('touchstart', handleStart, { passive: !preventDefault });
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('touchmove', handlePinchMove);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchend', handleEnd);
    window.addEventListener('touchend', handlePinchEnd);

    return () => {
      el.removeEventListener('mousedown', handleStart);
      el.removeEventListener('touchstart', handleStart);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('touchmove', handlePinchMove);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchend', handleEnd);
      window.removeEventListener('touchend', handlePinchEnd);
    };
  }

  return state;
}

// --- useAnimatedValue Hook ---
// Like React Native's Animated.Value

export function useAnimatedValue(initialValue) {
  const value = signal(initialValue);
  const animations = [];

  return {
    value: () => value(),
    setValue: (v) => value.set(v),

    // Spring to target
    spring(toValue, config = {}) {
      const s = spring(value.peek(), config);
      s.set(toValue);

      const dispose = effect(() => {
        value.set(s.current());
      });

      return {
        stop: () => { s.stop(); dispose(); },
      };
    },

    // Tween to target
    timing(toValue, config = {}) {
      const t = tween(value.peek(), toValue, {
        ...config,
        onUpdate: (v) => value.set(v),
      });

      return {
        stop: () => t.cancel(),
      };
    },

    // Interpolate value
    interpolate(inputRange, outputRange) {
      return () => {
        const v = value();
        // Find segment
        for (let i = 0; i < inputRange.length - 1; i++) {
          if (v >= inputRange[i] && v <= inputRange[i + 1]) {
            const t = (v - inputRange[i]) / (inputRange[i + 1] - inputRange[i]);
            return outputRange[i] + (outputRange[i + 1] - outputRange[i]) * t;
          }
        }
        // Clamp
        if (v <= inputRange[0]) return outputRange[0];
        return outputRange[outputRange.length - 1];
      };
    },

    subscribe: value.subscribe,
  };
}

// --- CSS Transition Classes ---

export function createTransitionClasses(name) {
  return {
    enter: `${name}-enter`,
    enterActive: `${name}-enter-active`,
    enterDone: `${name}-enter-done`,
    exit: `${name}-exit`,
    exitActive: `${name}-exit-active`,
    exitDone: `${name}-exit-done`,
  };
}

// Apply CSS transition
export async function cssTransition(element, name, type = 'enter', duration = 300) {
  const classes = createTransitionClasses(name);

  return new Promise((resolve) => {
    scheduleWrite(() => {
      // Initial state
      element.classList.add(classes[type]);

      // Force reflow
      scheduleRead(() => {
        element.offsetHeight;

        scheduleWrite(() => {
          // Active state
          element.classList.add(classes[`${type}Active`]);

          setTimeout(() => {
            scheduleWrite(() => {
              element.classList.remove(classes[type], classes[`${type}Active`]);
              element.classList.add(classes[`${type}Done`]);
              resolve();
            });
          }, duration);
        });
      });
    });
  });
}
