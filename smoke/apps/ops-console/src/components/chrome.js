// Shared page chrome. Client-safe (no server-only imports) so the hydrated
// console and the zero-JS /health page can both use it.
//
// The nav uses plain <a> rather than the router's <Link>: these are full
// document loads between two server-rendered pages, and <Link> is for the
// client-routed detail pane inside the console.

import { h } from 'what-framework';

export function TopBar({ current = '' }) {
  const link = (href, label, id) =>
    h('a', {
      href,
      class: current === id ? 'nav-link is-active' : 'nav-link',
      'data-nav': id,
      ...(current === id ? { 'aria-current': 'page' } : {}),
    }, label);

  return h('header', { class: 'topbar' },
    h('a', { href: '/', class: 'brand' },
      h('span', { class: 'brand-dot', 'aria-hidden': 'true' }),
      'Northwind Ops',
    ),
    h('nav', { 'aria-label': 'Primary' },
      link('/', 'Console', 'console'),
      link('/health', 'Health', 'health'),
    ),
  );
}

export function SeverityTag({ severity }) {
  return h('span', { class: `sev sev-${severity}`, 'data-severity': severity }, severity);
}

export function Footer() {
  return h('footer', { class: 'site-footer' },
    h('p', {}, 'Northwind Ops Console, a What Framework smoke app. In-memory data, resets on restart.'),
  );
}
