// The story page.
//
// Almost all of this is static server HTML. The reactive parts are the scroll
// bar, the section reveals and one tweened counter; everything genuinely
// interactive is an island with its own hydration trigger, placed where its
// trigger is reachable.
//
// Client-safe by construction: the server imports this module to render, and
// the browser imports the same file to hydrate.

import {
  Head,
  Island,
  easings,
  h,
  onIntersect,
  signal,
  tween,
} from 'what-framework';

import {
  BURN_IN_HOURS,
  chapters,
  productionNotes,
} from './story.js';
import {
  bindEl,
  hydrationLog,
  prefersReducedMotion,
  progress,
  revealOnIntersect,
  runTransition,
} from './motion.js';

import Colorway from './islands/colorway.js';
import ChapterNav from './islands/chapter-nav.js';
import LumenMeter from './islands/lumen-meter.js';
import SpecExplorer from './islands/spec-explorer.js';
import WideCompare from './islands/wide-compare.js';

const chapterOf = (id) => chapters.find((c) => c.id === id);

/** A full-height section that reveals itself once, on the way in. */
function Chapter({ id, children }) {
  const meta = chapterOf(id);
  const kids = children == null ? [] : (Array.isArray(children) ? children : [children]);
  return h('section', {
    id,
    class: 'chapter',
    'data-chapter': id,
    'aria-labelledby': `${id}-heading`,
    ref: revealOnIntersect,
  },
    h('p', { class: 'chapter-eyebrow' }, meta.num),
    h('h2', { id: `${id}-heading`, class: 'chapter-heading' }, meta.title),
    ...kids,
  );
}

/**
 * Chapter 01's counter. Not an island: it is three lines of behaviour attached
 * to text that is already on screen, so it rides the page's own hydration and
 * waits for its section instead of a bundle.
 */
function BurnInCounter() {
  const shown = signal(0, 'burnIn');
  let started = false;

  return h('p', {
    class: 'stat',
    'data-tween': '0',
    ref: (el) => {
      if (!el) return;
      bindEl(el, () => el.setAttribute('data-tween', String(Math.round(shown()))));
      let stop = null;
      stop = onIntersect(el, (entry) => {
        if (started || !entry.isIntersecting) return;
        started = true;
        if (stop) stop();
        if (prefersReducedMotion()) shown(BURN_IN_HOURS);
        else tween(0, BURN_IN_HOURS, {
          duration: 1100,
          easing: easings.easeOutCubic,
          onUpdate: (value) => shown(value),
        });
      }, { rootMargin: '0px 0px -20% 0px', threshold: 0 });
    },
  },
    h('span', { class: 'stat-num' }, () => Math.round(shown()).toLocaleString('en-US')),
    h('span', { class: 'stat-unit' }, 'hours on the bench before a unit ships'),
  );
}

/**
 * Chapter 05's notes drawer. The panel is created and destroyed, and
 * `runTransition` drives both halves: enter runs from the ref as the node
 * appears, exit is awaited BEFORE the signal drops it, because a node removed
 * first has nothing left to animate.
 */
function ProductionNotes() {
  const open = signal(false, 'notesOpen');
  let panel = null;
  const duration = () => (prefersReducedMotion() ? 0 : 420);

  const toggle = async () => {
    if (!open()) { open(true); return; }
    if (panel) await runTransition(panel, 'fade', 'exit', duration());
    panel = null;
    open(false);
  };

  return h('div', { class: 'notes-block' },
    h('button', {
      type: 'button',
      class: 'ghost',
      'data-notes-toggle': '',
      'aria-controls': 'production-notes',
      'aria-expanded': 'false',
      onclick: toggle,
      ref: (el) => bindEl(el, () => el.setAttribute('aria-expanded', String(open()))),
    }, () => (open() ? 'Hide production notes' : 'Read the production notes')),

    () => (open()
      ? h('aside', {
        id: 'production-notes',
        class: 'notes',
        'data-notes-panel': '',
        ref: (el) => {
          if (!el) return;
          panel = el;
          runTransition(el, 'fade', 'enter', duration());
        },
      },
        h('h3', {}, 'From the bench'),
        h('ul', {}, productionNotes.map((note) => h('li', {}, note))),
      )
      : null),
  );
}

export default function StoryPage() {
  // Scroll tracking is wired from entry-client.js after hydrate(), not from
  // onMount(): every component-scoped hook throws during SSR in 0.12.2, so a
  // component that calls onMount cannot be server-rendered at all. See the
  // repro in smoke.config.mjs.
  return h('div', { class: 'story' },
    h(Head, {
      title: 'Northline 01 | Northline Works',
      meta: [{
        name: 'description',
        content: 'A desk lamp, told from the inside out: five chapters, five islands, one scroll.',
      }],
    }),

    // --- Fixed chrome ---------------------------------------------------
    h('header', { class: 'story-header' },
      h('a', { class: 'wordmark', href: '#open' }, 'Northline Works'),
      h('p', { class: 'read-out' },
        h('span', { 'data-progress-pct': '' }, () => `${Math.round(progress() * 100)}%`),
        ' read',
      ),
      h('div', { class: 'progress-track', role: 'presentation' },
        h('div', {
          class: 'progress-bar',
          'data-progress': '0.000',
          ref: (el) => bindEl(el, () => {
            const value = progress();
            el.style.transform = `scaleX(${value})`;
            el.setAttribute('data-progress', value.toFixed(3));
          }),
        }),
      ),
    ),

    h(Island, { component: ChapterNav, mode: 'idle' }),

    h('main', { class: 'story-main' },

      // --- 00 -----------------------------------------------------------
      h(Chapter, { id: 'open' },
        h('p', { class: 'lede' },
          'A desk lamp, told from the inside out. Scroll for five chapters: '
          + 'where it starts, what it puts out, what it is made of, what it '
          + 'replaces, and who made it.'),
        h('div', { class: 'lamp', 'aria-hidden': 'true' },
          h('span', { class: 'lamp-shade' }),
          h('span', { class: 'lamp-cone' }),
          h('span', { class: 'lamp-pool' }),
        ),
        h(Island, { component: Colorway, mode: 'load' }),
        h('p', { class: 'scroll-cue' }, 'Keep scrolling'),
      ),

      // --- 01 -----------------------------------------------------------
      h(Chapter, { id: 'origin' },
        h('p', {},
          'Northline 01 began as a complaint about a lamp that buzzed. Two years '
          + 'later the buzzing is gone, and what is left is a shade, an arm and a '
          + 'driver that runs cool enough to touch.'),
        h(BurnInCounter, {}),
        h('p', { class: 'muted' },
          'Every unit runs 4,200 hours on a test bench before it is boxed. Units '
          + 'that drift more than two percent in output are stripped for parts.'),
      ),

      // --- 02 -----------------------------------------------------------
      h(Chapter, { id: 'light' },
        h('p', {},
          'The shade is spun, not pressed, so the inside carries a continuous '
          + 'curve and the pool of light has no seam in it. The meter below fills '
          + 'the moment this chapter reaches you.'),
        h(Island, { component: LumenMeter, mode: 'visible' }),
      ),

      // --- 03 -----------------------------------------------------------
      h(Chapter, { id: 'materials' },
        h('p', {},
          'Nothing here is a composite pretending to be metal. The full bench '
          + 'sheet is below; reach for it and it becomes filterable.'),
        h(Island, { component: SpecExplorer, mode: 'interaction' }),
      ),

      // --- 04 -----------------------------------------------------------
      h(Chapter, { id: 'compare' },
        h('p', {},
          'Against the incandescent it is meant to retire. On a narrow screen '
          + 'these are two plain tables, which is the honest way to read them '
          + 'there.'),
        h(Island, { component: WideCompare, mode: 'media', mediaQuery: '(min-width: 900px)' }),
      ),

      // --- 05 -----------------------------------------------------------
      h(Chapter, { id: 'notes' },
        h('p', {},
          'This page is one server-rendered document. Five islands hydrate on '
          + 'five different triggers, and the list below fills in as each one '
          + 'wakes up.'),
        h(ProductionNotes, {}),
        h('div', { class: 'hydration-log' },
          h('h3', {}, 'Island wake-up order'),
          h('ol', { 'data-hydration-log': '' },
            () => hydrationLog().map((entry) => h('li', { 'data-hydrated-island': entry.name },
              h('code', {}, entry.name),
              h('span', { class: 'log-mode' }, `client:${entry.mode}`),
              h('span', { class: 'log-time' }, `${entry.at} ms`),
            )),
          ),
          h('p', { class: 'muted small' },
            'Empty in the server HTML, and empty here if scripting is off: the '
            + 'page reads the same either way.'),
        ),
      ),
    ),

    h('footer', { class: 'story-footer' },
      h('p', {}, 'Northline Works is fictional. Every figure on this page is invented for the demo.'),
    ),
  );
}
