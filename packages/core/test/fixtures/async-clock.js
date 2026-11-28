// A virtual clock for async programs: fetches settle at virtual times, and the
// DOM is sampled the way a browser could paint it.
//
//   const clock = asyncClock(t);           // mocks setTimeout and Date
//   const api = clock.api({ users: [100, () => [...]] });
//   api.users()                             // resolves 100 virtual ms later
//   await clock.to(150);                    // run timers up to 150, settle everything
//   clock.frames                            // [{ at, text }] of every frame shown
//
// A frame is what the page shows when the microtask queue is empty, the only
// moment a browser paints. `flushes` additionally keeps the page after every
// flush of effects, a stricter sample: a commit that took two flushes would
// show up there even when no paint could fall between them.

import { _onQuiet } from '../../src/reactive.js';

const drain = () => new Promise((resolve) => setImmediate(resolve));

export function asyncClock(t, read) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  let now = 0;
  /** @type {Array<{ at: number, text: string }>} */
  const frames = [];
  /** @type {Array<{ at: number, text: string }>} */
  const flushes = [];
  /** @type {Array<{ at: number, name: string }>} */
  const starts = [];
  const record = (list) => {
    const text = read();
    if (list.length === 0 || list[list.length - 1].text !== text) list.push({ at: now, text });
  };
  const stop = _onQuiet(() => record(flushes));
  return {
    frames,
    flushes,
    starts,
    get now() { return now; },
    /** An API whose calls resolve (or reject) `ms` virtual milliseconds after they start. */
    api(table) {
      const out = {};
      for (const [name, [ms, answer]] of Object.entries(table)) {
        out[name] = (...args) => {
          starts.push({ at: now, name });
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              try {
                resolve(answer(...args));
              } catch (error) {
                reject(error);
              }
            }, ms);
          });
        };
      }
      return out;
    },
    /** Paint the first frame. */
    async start() {
      await drain();
      record(frames);
      record(flushes);
    },
    /** Advance to virtual time `at`, one millisecond at a time, sampling each frame. */
    async to(at) {
      while (now < at) {
        now++;
        t.mock.timers.tick(1);
        await drain();
        await drain();
        record(frames);
      }
    },
    /** Sample the frame after an action taken at the current time. */
    async act(fn) {
      fn();
      await drain();
      await drain();
      record(frames);
    },
    stop,
  };
}
