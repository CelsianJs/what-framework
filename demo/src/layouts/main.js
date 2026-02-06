import { h } from '@what/core';
import { Link } from '@what/router';

export function Layout({ children }) {
  return h('div', { class: 'layout' },
    h('nav', { class: 'nav' },
      h(Link, { href: '/', class: 'nav-logo' }, 'What'),
      h('div', { class: 'nav-links' },
        h(Link, { href: '/' }, 'Home'),
        h(Link, { href: '/demos' }, 'Demos'),
        h(Link, { href: '/islands' }, 'Islands'),
        h(Link, { href: '/bench' }, 'Bench'),
        h(Link, { href: '/docs' }, 'Docs'),
      ),
    ),
    h('main', { class: 'content' }, children),
    h('footer', { class: 'footer' },
      h('p', null, 'What Framework v0.1.0 — The closest framework to vanilla JS'),
    ),
  );
}
