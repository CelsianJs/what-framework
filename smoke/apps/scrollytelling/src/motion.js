// Scroll and motion plumbing shared by the page shell and the islands.
//
// Client-safe: nothing here touches `window` at module scope, so the server can
// import it while rendering and simply never call the browser halves.

import { cssTransition, effect, flushScheduler, onIntersect, raf, signal } from 'what-framework';
import { chapters } from './story.js';

/** 0..1 for the whole document. Drives the bar under the header. */
export const progress = signal(0, 'scrollProgress');

/** Id of the chapter currently owning the viewport. Drives the chapter nav. */
export const activeChapter = signal(chapters[0].id, 'activeChapter');

/** Appended to as islands wake up; chapter 05 renders it as a live list. */
export const hydrationLog = signal([], 'hydrationLog');

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Bind an element's attributes/styles to signals.
 *
 * What has no SSR-safe reactive attribute: a function passed as a prop is
 * wrapped in an effect on the client, but `renderAttrs` in what-server does not
 * call it and serializes the function's SOURCE TEXT into the HTML instead
 * (see this app's smoke.config.mjs, which pins that). Refs are skipped during
 * SSR, so driving attributes from a ref keeps the server HTML clean and the
 * client fully reactive.
 */
export function bindEl(el, apply) {
  if (!el) return () => {};
  return effect(() => apply(el));
}

/**
 * cssTransition() with the scheduler pumped underneath it.
 *
 * cssTransition queues a scheduleRead from inside a scheduleWrite callback, and
 * the scheduler drops that request: flushScheduler() clears its `scheduled`
 * flag only after BOTH queues have drained, so the re-entrant schedule() sees
 * `scheduled === true` and never asks for another frame. The transition then
 * hangs after the first class is applied until some unrelated code touches the
 * scheduler. Draining a frame at a time while a transition is in flight is the
 * smallest honest fix an app can apply from the outside. See smoke.config.mjs
 * for the two-line repro.
 */
export function runTransition(el, name, type, duration) {
  let settled = false;
  const pump = () => {
    if (settled) return;
    flushScheduler();
    requestAnimationFrame(pump);
  };
  requestAnimationFrame(pump);
  return cssTransition(el, name, type, duration).finally(() => { settled = true; });
}

/**
 * Reveal a section the first time it crosses 80% of the viewport height.
 * The negative bottom margin is what makes this fire on the way in rather than
 * the instant a tall section's top edge appears.
 */
export function revealOnIntersect(el) {
  if (!el) return;
  let stop = null;
  let done = false;
  stop = onIntersect(el, (entry) => {
    if (done || !entry.isIntersecting) return;
    done = true;
    el.setAttribute('data-revealed', '');
    if (stop) stop();
  }, { rootMargin: '0px 0px -20% 0px', threshold: 0 });
}

/**
 * Drive `progress` and `activeChapter` from the window scroll position.
 * `raf()` collapses a burst of scroll events into one read per frame, which is
 * the difference between a smooth bar and a layout thrash on every wheel tick.
 */
export function trackScroll() {
  if (typeof window === 'undefined') return () => {};

  const update = () => raf('story-scroll', () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress(max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0);

    const line = window.innerHeight * 0.4;
    let current = chapters[0].id;
    for (const chapter of chapters) {
      const el = document.getElementById(chapter.id);
      if (el && el.getBoundingClientRect().top <= line) current = chapter.id;
    }
    activeChapter(current);
  });

  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
  return () => {
    window.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
  };
}

/**
 * Islands announce themselves with a bubbling `island:hydrated` event. Listening
 * at the document is how chapter 05 can show the wake-up order without any
 * island knowing the log exists.
 */
export function watchIslandHydration() {
  if (typeof document === 'undefined') return;
  document.addEventListener('island:hydrated', (event) => {
    const { name, mode } = event.detail || {};
    hydrationLog([...hydrationLog.peek(), { name, mode, at: Math.round(performance.now()) }]);
  });
}
