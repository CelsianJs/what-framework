// What Framework - DOM Scheduler
// Batches DOM reads and writes to prevent layout thrashing.
// Inspired by fastdom but integrated with our reactive system.

// Queue phases: reads run first, then writes
const readQueue = [];
const writeQueue = [];
let scheduled = false;

// --- Schedule a DOM read operation ---
// Reads should be batched together and run before writes
// to avoid forced synchronous layouts.
//
// Example:
//   scheduleRead(() => {
//     const height = element.offsetHeight; // Read
//     scheduleWrite(() => {
//       element.style.height = height + 'px'; // Write
//     });
//   });

export function scheduleRead(fn) {
  readQueue.push(fn);
  schedule();
  return () => {
    const idx = readQueue.indexOf(fn);
    if (idx !== -1) readQueue.splice(idx, 1);
  };
}

// --- Schedule a DOM write operation ---
// Writes are batched and run after all reads complete.

export function scheduleWrite(fn) {
  writeQueue.push(fn);
  schedule();
  return () => {
    const idx = writeQueue.indexOf(fn);
    if (idx !== -1) writeQueue.splice(idx, 1);
  };
}

// --- Flush all queued operations immediately ---
// Useful when you need synchronous DOM access.

export function flushScheduler() {
  // Run all reads first
  while (readQueue.length > 0) {
    const fn = readQueue.shift();
    try { fn(); } catch (e) { console.error('[what] Scheduler read error:', e); }
  }

  // Then all writes
  while (writeQueue.length > 0) {
    const fn = writeQueue.shift();
    try { fn(); } catch (e) { console.error('[what] Scheduler write error:', e); }
  }

  scheduled = false;
}

// --- Internal scheduling ---

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(flushScheduler);
}

// --- Measure helper ---
// Read a layout property without causing thrashing.
// Returns a promise that resolves with the value.

export function measure(fn) {
  return new Promise(resolve => {
    scheduleRead(() => {
      resolve(fn());
    });
  });
}

// --- Mutate helper ---
// Write to DOM without causing thrashing.
// Returns a promise that resolves when the write is done.

export function mutate(fn) {
  return new Promise(resolve => {
    scheduleWrite(() => {
      fn();
      resolve();
    });
  });
}

// --- useScheduledEffect ---
// Effect that automatically batches DOM operations.

import { effect } from './reactive.js';

export function useScheduledEffect(readFn, writeFn) {
  const effectKey = Symbol('scheduledEffect');
  return effect(() => {
    // Use raf() to debounce: only the latest callback runs per frame,
    // avoiding creating new closures on every signal change.
    raf(effectKey, () => {
      scheduleRead(() => {
        const data = readFn();
        if (writeFn) {
          scheduleWrite(() => writeFn(data));
        }
      });
    });
  });
}

// --- Animation frame helper ---
// Like requestAnimationFrame but returns a cancellable promise.

export function nextFrame() {
  let cancel;
  const promise = new Promise((resolve, reject) => {
    const id = requestAnimationFrame(resolve);
    cancel = () => {
      cancelAnimationFrame(id);
      reject(new Error('Cancelled'));
    };
  });
  promise.cancel = cancel;
  return promise;
}

// --- Debounced RAF ---
// Only runs the latest callback once per frame.

const debouncedCallbacks = new Map();

export function raf(key, fn) {
  if (debouncedCallbacks.has(key)) {
    // Replace callback, don't schedule new frame
    debouncedCallbacks.set(key, fn);
  } else {
    debouncedCallbacks.set(key, fn);
    requestAnimationFrame(() => {
      const callback = debouncedCallbacks.get(key);
      debouncedCallbacks.delete(key);
      if (callback) callback();
    });
  }
}

// --- Resize Observer helper ---
// Batched resize observations.

const resizeObservers = new WeakMap();
let sharedResizeObserver = null;

export function onResize(element, callback) {
  if (typeof ResizeObserver === 'undefined') {
    // Fallback: just call once
    callback(element.getBoundingClientRect());
    return () => {};
  }

  if (!sharedResizeObserver) {
    sharedResizeObserver = new ResizeObserver(entries => {
      scheduleRead(() => {
        for (const entry of entries) {
          const cb = resizeObservers.get(entry.target);
          if (cb) {
            cb(entry.contentRect);
          }
        }
      });
    });
  }

  resizeObservers.set(element, callback);
  sharedResizeObserver.observe(element);

  return () => {
    resizeObservers.delete(element);
    sharedResizeObserver.unobserve(element);
  };
}

// --- Intersection Observer helper ---
// Batched intersection observations.

export function onIntersect(element, callback, options = {}) {
  if (typeof IntersectionObserver === 'undefined') {
    // Fallback: assume visible
    callback({ isIntersecting: true, intersectionRatio: 1 });
    return () => {};
  }

  const observer = new IntersectionObserver(entries => {
    scheduleRead(() => {
      for (const entry of entries) {
        callback(entry);
      }
    });
  }, options);

  observer.observe(element);

  return () => observer.disconnect();
}

// --- Smooth scrolling with scheduler ---

export function smoothScrollTo(element, options = {}) {
  const { duration = 300, easing = t => t * (2 - t) } = options;

  return new Promise(resolve => {
    let startY;
    let targetY;
    let startTime;

    scheduleRead(() => {
      startY = window.scrollY;
      const rect = element.getBoundingClientRect();
      targetY = startY + rect.top;
      startTime = performance.now();
      tick();
    });

    function tick() {
      scheduleRead(() => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = easing(progress);
        const currentY = startY + (targetY - startY) * easedProgress;

        scheduleWrite(() => {
          window.scrollTo(0, currentY);

          if (progress < 1) {
            requestAnimationFrame(tick);
          } else {
            resolve();
          }
        });
      });
    }
  });
}
