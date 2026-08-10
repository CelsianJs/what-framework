// Shared page chrome. Client-safe (no server imports) so it can be served to
// the browser and reused by every hydrated page.

import { h } from 'what-framework';
import { count, subtotal, formatPrice } from '../store/cart.js';

/**
 * Site header. The cart badge reads the GLOBAL store, so an add performed on a
 * product page is visible here on every other page without any prop threading.
 * `aria-live` on the badge means the count change is announced, and
 * `aria-current` is an enumerated ARIA value, not an HTML boolean: it must
 * serialize as the string "page", never as an empty attribute.
 */
export function Header({ current = '' }) {
  const link = (href, label, id) =>
    h('a', {
      href,
      'data-nav': id,
      class: current === id ? 'nav-link is-active' : 'nav-link',
      ...(current === id ? { 'aria-current': 'page' } : {}),
    }, label);

  return h('header', { class: 'site-header' },
    h('a', { href: '/', class: 'brand' }, 'Smoke Supply Co.'),
    h('nav', { 'aria-label': 'Primary' },
      link('/', 'Shop', 'home'),
      link('/search', 'Search', 'search'),
      link('/cart', 'Cart', 'cart'),
      link('/account', 'Account', 'account'),
    ),
    h('a', { href: '/cart', class: 'cart-badge', 'data-cart-badge': '' },
      h('span', { 'data-cart-count': '' }, () => String(count())),
      h('span', { class: 'cart-sub', 'data-cart-subtotal': '' }, () => formatPrice(subtotal())),
    ),
  );
}

export function Footer() {
  return h('footer', { class: 'site-footer' },
    h('p', {}, 'Smoke Supply Co., a What Framework smoke app.'),
  );
}
