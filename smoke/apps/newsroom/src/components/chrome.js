// Masthead and footer, shared by every page.

import { h } from 'what-framework';
import { SECTIONS, formatDate } from '../data/news.js';

const EDITION_DATE = Date.UTC(2026, 10, 26);

export function Masthead() {
  return h('header', { class: 'masthead', 'data-masthead': '' },
    h('div', { class: 'masthead-inner' },
      h('a', { class: 'brand', href: '/' }, 'The Morning Ledger'),
      h('p', { class: 'edition' }, `${formatDate(EDITION_DATE)} · City edition`),
    ),
    h('nav', { class: 'sections', 'aria-label': 'Sections' },
      SECTIONS.map((s) => h('a', { href: '/', 'data-section': s }, s)),
    ),
  );
}

export function Footer() {
  return h('footer', { class: 'footer' },
    h('p', {}, 'The Morning Ledger is a demonstration newsroom. Every story is generated.'),
  );
}
