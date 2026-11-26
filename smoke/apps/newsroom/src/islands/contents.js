// client:media. The contents rail, shown only on wide screens; hydrated only
// where the media query matches, so a phone never pays for it.

import { h, signal } from 'what-framework';

export default function Contents({ sections }) {
  const open = signal(true, 'open');
  return h('nav', { class: 'contents', 'aria-label': 'Contents', 'data-contents': '' },
    h('button', {
      type: 'button',
      'data-contents-toggle': '',
      'aria-expanded': () => String(open()),
      onclick: () => open.set((o) => !o),
    }, 'Contents'),
    h('ol', { hidden: () => !open(), 'data-contents-list': '' },
      sections.map((s) => h('li', {}, h('a', { href: `#${s.id}` }, s.text)))),
  );
}
