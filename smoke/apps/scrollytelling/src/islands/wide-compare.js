// client:media, (min-width: 900px): the comparison in chapter 04.
//
// The wipe control needs two columns side by side to mean anything. On a phone
// the same markup stacks and reads as two plain tables, which is the better
// answer there, so the island simply never hydrates and never downloads a
// behaviour nobody can use.

import { h, signal } from 'what-framework';
import { comparison } from '../story.js';
import { bindEl } from '../motion.js';

const panel = (side, data) => h('div', { class: `compare-panel compare-${side}`, 'data-compare-panel': side },
  h('h3', {}, data.name),
  h('dl', {},
    data.rows.flatMap((row) => [
      h('dt', {}, row.label),
      h('dd', {},
        h('span', { class: 'compare-value' }, row.value),
        h('span', { class: 'compare-bar', style: `--fill: ${row.fill}%` }),
      ),
    ]),
  ),
);

export default function WideCompare() {
  const wipe = signal(50, 'compareWipe');

  return h('div', {
    class: 'compare',
    'data-compare-root': '',
    'data-wipe': '50',
    ref: (el) => bindEl(el, () => {
      el.style.setProperty('--wipe', `${wipe()}%`);
      el.setAttribute('data-wipe', String(wipe()));
    }),
  },
    h('p', { class: 'island-tag' }, 'client:media (min-width: 900px)'),
    h('div', { class: 'compare-grid' },
      panel('left', comparison.left),
      panel('right', comparison.right),
    ),
    h('label', { class: 'wipe-control' },
      h('span', {}, 'Wipe'),
      h('input', {
        type: 'range',
        min: '0',
        max: '100',
        value: '50',
        'data-wipe-input': '',
        oninput: (event) => wipe(Number(event.target.value)),
      }),
    ),
  );
}
