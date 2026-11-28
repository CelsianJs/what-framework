// client:idle. Reader-chosen text size for the article body.

import { effect, h, signal } from 'what-framework';

const SIZES = ['small', 'regular', 'large'];

export default function TextSize() {
  const size = signal(1, 'size');
  effect(() => {
    if (typeof document === 'undefined') return;
    document.querySelector('[data-article-body]')?.setAttribute('data-text-size', SIZES[size()]);
  });
  return h('div', { class: 'text-size', role: 'group', 'aria-label': 'Text size' },
    h('button', { type: 'button', 'data-text-smaller': '', disabled: () => size() === 0, onclick: () => size.set((s) => s - 1) }, 'A−'),
    h('output', { 'data-text-size-label': '' }, () => SIZES[size()]),
    h('button', { type: 'button', 'data-text-larger': '', disabled: () => size() === 2, onclick: () => size.set((s) => s + 1) }, 'A+'),
  );
}
