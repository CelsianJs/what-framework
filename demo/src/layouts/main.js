import { h } from 'what-framework';
import { Link } from 'what-framework/router';

export function Layout({ children }) {
  return h('div', { class: 'layout' },
    // Navigation
    h('nav', { class: 'nav' },
      h('div', { class: 'nav-inner' },
        h(Link, { href: '/', class: 'nav-logo' }, 'What'),
        h('div', { class: 'nav-links' },
          h(Link, { href: '/', class: 'nav-link' }, 'Home'),
          h(Link, { href: '/demos', class: 'nav-link' }, 'Demos'),
          h(Link, { href: '/islands', class: 'nav-link' }, 'Islands'),
          h(Link, { href: '/bench', class: 'nav-link' }, 'Benchmarks'),
          h(Link, { href: '/docs', class: 'nav-link' }, 'Docs'),
          h('a', {
            href: 'https://github.com/aspect/what-fw',
            class: 'nav-cta',
            target: '_blank',
            rel: 'noopener',
          }, 'GitHub'),
        ),
      ),
    ),

    // Main content
    h('main', { class: 'content' },
      h('div', { class: 'container' }, children),
    ),

    // Footer
    h('footer', { class: 'footer-simple' },
      h('p', null, 'What Framework v0.1.0 — Unified VNode architecture, the closest to vanilla JS'),
    ),
  );
}
