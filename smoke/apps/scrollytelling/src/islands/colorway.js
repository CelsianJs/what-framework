// client:load: the finish picker in the hero.
//
// `load` because it is the first thing on screen and the only control above the
// fold: deferring it would mean a visitor can click it before it answers.

import { h, signal } from 'what-framework';
import { colorways } from '../story.js';
import { bindEl } from '../motion.js';

const DEFAULT = colorways[0];

export default function Colorway() {
  const active = signal(DEFAULT.id, 'colorway');

  const pick = (choice) => {
    active(choice.id);
    // The hero's lamp is painted from a custom property, so one write repaints
    // the shade, the pool of light and the accent rule together.
    document.documentElement.style.setProperty('--lamp', choice.tint);
  };

  return h('div', { class: 'colorway', 'data-colorway-root': '' },
    h('p', { class: 'island-tag' }, 'client:load'),
    h('div', { class: 'swatches', role: 'group', 'aria-label': 'Finish' },
      colorways.map((choice) => h('button', {
        type: 'button',
        class: 'swatch',
        'data-colorway': choice.id,
        style: `--swatch: ${choice.tint}`,
        // Static for the server, then re-bound on the client. Both spellings
        // matter: an absent aria-pressed means "not a toggle at all".
        'aria-pressed': choice.id === DEFAULT.id ? 'true' : 'false',
        ref: (el) => bindEl(el, () => {
          el.setAttribute('aria-pressed', String(active() === choice.id));
        }),
        onclick: () => pick(choice),
      }, choice.label)),
    ),
    h('p', { class: 'colorway-name', 'data-colorway-name': '' },
      () => `Finish: ${(colorways.find((c) => c.id === active()) || DEFAULT).label}`),
  );
}
