// client:interaction: the spec table in chapter 03.
//
// `interaction` because the table is complete in the server HTML. Filtering is
// a convenience on top of something that already reads fine, so the JS cost is
// only paid by a visitor who reaches for it. The marker listens for click,
// focus, mouseenter and touchstart, so a pointer arriving at the table hydrates
// it before the click lands.

import { h, signal } from 'what-framework';
import { specGroups, specs } from '../story.js';
import { bindEl } from '../motion.js';

export default function SpecExplorer() {
  const group = signal('all', 'specGroup');
  const shown = (row) => group() === 'all' || group() === row.group;

  return h('div', {
    class: 'spec-explorer',
    'data-spec-root': '',
    'data-spec-group': 'all',
    ref: (el) => bindEl(el, () => el.setAttribute('data-spec-group', group())),
  },
    h('p', { class: 'island-tag' }, 'client:interaction'),
    h('div', { class: 'spec-filters', role: 'group', 'aria-label': 'Filter specifications' },
      specGroups.map((entry) => h('button', {
        type: 'button',
        class: 'chip',
        'data-spec-filter': entry.id,
        'aria-pressed': entry.id === 'all' ? 'true' : 'false',
        onclick: () => group(entry.id),
        ref: (el) => bindEl(el, () => {
          const on = group() === entry.id;
          el.setAttribute('aria-pressed', String(on));
          el.classList.toggle('is-on', on);
        }),
      }, entry.label)),
    ),
    h('table', { class: 'spec-table' },
      h('caption', {}, 'Northline 01, as measured on the bench'),
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, 'Measure'),
        h('th', { scope: 'col' }, 'Value'),
      )),
      h('tbody', {},
        specs.map((row) => h('tr', {
          'data-spec-row': row.group,
          ref: (el) => bindEl(el, () => { el.hidden = !shown(row); }),
        },
          h('th', { scope: 'row' }, row.label),
          h('td', {}, row.value),
        )),
      ),
    ),
  );
}
