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

  // Clear the flag BEFORE checking for leftovers so schedule() can arm a frame.
  scheduled = false;

  // A callback may queue work whose phase has already run in this flush. The
  // canonical case is cssTransition(): it asks for a reflow READ from inside a
  // WRITE, and the read queue was drained before the write phase started.
  // schedule() short-circuits while `scheduled` is true, so that request used
  // to land in a drained queue with no frame armed and sat there until some
  // unrelated code happened to poke the scheduler again (cssTransition's
  // promise never settled and the element stayed on its start class).
  //
  // Arm another frame for whatever is left instead of dropping it. We defer by
  // a frame rather than looping here on purpose: a callback that re-schedules
  // itself unconditionally then costs one iteration per frame, the same bound
  // as a plain requestAnimationFrame loop, instead of spinning the main thread
  // forever inside a single flush. One frame is armed no matter how many
  // leftovers there are, because schedule() is idempotent.
  if (readQueue.length > 0 || writeQueue.length > 0) schedule();
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
  return /** @type {Promise<void>} */ (new Promise(resolve => {
    scheduleRead(() => {
      resolve(fn());
    });
  }));
}

// --- Mutate helper ---
// Write to DOM without causing thrashing.
// Returns a promise that resolves when the write is done.

export function mutate(fn) {
  return /** @type {Promise<void>} */ (new Promise(resolve => {
    scheduleWrite(() => {
      fn();
      resolve();
    });
  }));
}

// --- useScheduledEffect ---
// An effect split across a frame: `readFn` runs in the read phase and
// `writeFn(data)` with what it returned in the write phase. It runs again
// when a signal `readFn` read changes: in the next frame's read phase, once
// however many changes came before it. Disposed with its owner, or by the
// function it returns; a frame still to come then does nothing.

import { effect, getOwner, runWithOwner, onCleanup } from './reactive.js';

export function useScheduledEffect(readFn, writeFn) {
  const owner = getOwner();
  let disposed = false;
  /** @type {(() => void) | null} */
  let cancel = null;
  /** @type {() => void} */
  let tracking = noop;
  const schedule = () => {
    if (cancel === null && !disposed) cancel = scheduleRead(read);
  };
  // The read is the first run of an effect made for it, which tracks what
  // readFn reads; that effect's next run is a change, and only schedules.
  const read = () => {
    cancel = null;
    tracking();
    let first = true;
    let data;
    tracking = runWithOwner(owner, () => effect(() => {
      if (!first) {
        schedule();
        return;
      }
      first = false;
      data = readFn();
    }));
    if (writeFn) scheduleWrite(() => { if (!disposed) writeFn(data); });
  };
  const dispose = () => {
    disposed = true;
    if (cancel !== null) cancel();
    cancel = null;
    tracking();
    tracking = noop;
  };
  if (owner !== null) onCleanup(dispose);
  schedule();
  return dispose;
}

function noop() {}

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
  /** @type {any} */ (promise).cancel = cancel;
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
/** @type {ResizeObserver | null} */
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
          const callbacks = resizeObservers.get(entry.target);
          if (callbacks) for (const cb of [...callbacks]) cb(entry.contentRect);
        }
      });
    });
  }

  // Every callback registered for an element is called; the element stays
  // observed until the last one is removed.
  const observer = sharedResizeObserver;
  let callbacks = resizeObservers.get(element);
  if (!callbacks) {
    resizeObservers.set(element, callbacks = new Set());
    observer.observe(element);
  }
  const entry = (rect) => callback(rect);
  callbacks.add(entry);

  return () => {
    if (!callbacks.delete(entry) || callbacks.size) return;
    resizeObservers.delete(element);
    observer.unobserve(element);
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

  return /** @type {Promise<void>} */ (new Promise(resolve => {
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
  }));
}
