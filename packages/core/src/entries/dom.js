// what-framework/dom (what-core/dom): the DOM read/write scheduler and DOM
// utilities.

// Scheduler: batch reads before writes so a frame never thrashes layout.
export {
  scheduleRead,
  scheduleWrite,
  flushScheduler,
  measure,
  mutate,
  useScheduledEffect,
  nextFrame,
  raf,
  onResize,
  onIntersect,
  smoothScrollTo,
} from '../scheduler.js';

// Utilities
export {
  cls,
  style,
  debounce,
  throttle,
  useMediaQuery,
  useLocalStorage,
  useClickOutside,
} from '../helpers.js';
export { clearHead } from '../head.js';
