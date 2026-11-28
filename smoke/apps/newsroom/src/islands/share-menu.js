// client:interaction. The share menu: hydrated on the first click, focus or
// hover, and that first click opens it.

import { effect, h, signal } from 'what-framework';

export default function ShareMenu({ slug, headline }) {
  const open = signal(false, 'open');
  const note = signal('', 'note');
  const url = () => (typeof location === 'undefined' ? `/article/${slug}` : `${location.origin}/article/${slug}`);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url());
      note.set('Link copied');
    } catch {
      note.set('Copy the address bar to share');
    }
  }

  // Escape closes the open menu wherever focus is. Safari does not focus a
  // button on click, so after a click the key goes to <body>, not the menu.
  effect(() => {
    if (!open() || typeof document === 'undefined') return;
    const onKey = (e) => { if (e.key === 'Escape') open.set(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return h('div', { class: 'share' },
    h('button', {
      type: 'button',
      'data-share': '',
      'aria-haspopup': 'true',
      'aria-expanded': () => String(open()),
      onclick: () => open.set((o) => !o),
    }, 'Share'),
    h('ul', { class: 'share-menu', role: 'menu', hidden: () => !open(), 'data-share-menu': '' },
      h('li', { role: 'none' }, h('button', { type: 'button', role: 'menuitem', 'data-share-copy': '', onclick: copy }, 'Copy link')),
      h('li', { role: 'none' }, h('a', {
        role: 'menuitem',
        href: `mailto:?subject=${encodeURIComponent(headline)}&body=${encodeURIComponent(`/article/${slug}`)}`,
      }, 'Email')),
    ),
    h('p', { class: 'share-note', 'data-share-note': '' }, () => note()),
  );
}
