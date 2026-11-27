// client:visible: the output meter in chapter 02.
//
// `visible` because the whole point of the meter is the fill: hydrating it at
// load would spend the animation two screens above where anyone can see it.
// The island wakes when the chapter arrives, and the spring starts from rest,
// so the arrival IS the animation.

import { h, onMount } from 'what-framework';
import { spring } from 'what-framework/motion';
import { RATED_LUMENS } from '../story.js';
import { bindEl, prefersReducedMotion } from '../motion.js';

export default function LumenMeter() {
  // Server-rendered at rest (0), so the client hydrates onto identical text and
  // then animates. Printing the rated figure in the caption keeps the static
  // HTML informative without pretending the meter has moved.
  // Slightly overdamped: a meter that overshoots its rated figure and settles
  // back reads as a measurement error rather than an animation.
  const lumens = spring(0, { stiffness: 120, damping: 24 });

  // onMount, which runs on the client once the island has hydrated onto the
  // server's meter at rest: snapping it (reduced motion) while hydrating would
  // write a figure the server's HTML does not have.
  onMount(() => {
    if (prefersReducedMotion()) lumens.snap(RATED_LUMENS);
    else lumens.set(RATED_LUMENS);
  });

  return h('figure', { class: 'meter', 'data-lumen-meter': '' },
    h('p', { class: 'island-tag' }, 'client:visible'),
    h('figcaption', {},
      'Integrating-sphere output at full draw. Rated ',
      h('strong', {}, `${RATED_LUMENS.toLocaleString('en-US')} lm`),
      '.',
    ),
    h('div', { class: 'meter-track' },
      h('div', {
        class: 'meter-fill',
        'data-spring': '0.0',
        ref: (el) => bindEl(el, () => {
          const value = lumens.current();
          el.style.width = `${Math.max(0, Math.min(100, (value / RATED_LUMENS) * 100)).toFixed(2)}%`;
          el.setAttribute('data-spring', value.toFixed(1));
        }),
      }),
    ),
    h('output', { class: 'meter-readout', 'data-lumen': '' },
      () => `${Math.round(lumens.current()).toLocaleString('en-US')} lm`),
    h('ul', { class: 'meter-scale', 'aria-hidden': 'true' },
      [0, 400, 800, 1200].map((tick) => h('li', {}, String(tick))),
    ),
  );
}
