// Client entry. Hydrates the one page this app has, then gets out of the way.

import { h, hydrate } from 'what-framework';
import StoryPage from './page.js';
import { trackScroll, watchIslandHydration } from './motion.js';

// Sections are only hidden-until-revealed when scripting is on. Without this
// flag a no-JS visitor would get a page of invisible chapters, which is the
// classic way a scroll reveal turns into a blank document.
document.documentElement.dataset.js = 'on';

// Listen before hydrating: the `load` island announces itself in the microtask
// right after hydrate() returns, and chapter 05's log would otherwise miss it.
watchIslandHydration();

hydrate(h(StoryPage, {}), document.body);

// Page-level scroll wiring lives here rather than in an onMount() inside the
// page: onMount() throws during SSR in 0.12.2, so a server-rendered component
// cannot use it. The listener is document-lifetime anyway.
trackScroll();

// A snapshot of which islands were live by the end of the microtask queue that
// follows hydration. `load` schedules with queueMicrotask and every other mode
// waits for a task (idle callback, observer, listener), so this attribute is
// the visible line between "immediately" and "later". Handy in devtools, and it
// is what the smoke suite reads to tell client:load apart from client:idle.
queueMicrotask(() => queueMicrotask(() => {
  document.documentElement.dataset.islandsAtMicrotask = [...document.querySelectorAll('[data-island-hydrated]')]
    .map((el) => el.getAttribute('data-island'))
    .join(',');
}));
