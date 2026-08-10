// Cart: SERVER mode (never cached).
//
// The page shell is rendered per request; the cart itself is CLIENT state, read
// from the global store after hydration. That split is the point: a cached cart
// would show one shopper another shopper's basket.

import { h, Head, signal, Show, For } from 'what-framework';
import { Header, Footer } from '../components/chrome.js';
import { lines, subtotal, setQty, clear, formatPrice, count } from '../store/cart.js';
import { callAction } from '../lib/actions-client.js';

export const page = { mode: 'server' };

export const loader = async ({ csrfToken }) => ({ csrfToken: csrfToken ?? '' });

export default function Cart() {
  const status = signal('', 'checkout:status');
  const busy = signal(false, 'checkout:busy');

  async function checkout() {
    if (count() === 0) return;
    busy(true);
    status('');
    try {
      // Addressed by id over the served-action protocol. The action module
      // itself imports the database and is never sent to the browser.
      const res = await callAction('checkout', { lines: lines() });
      status(`Order ${res.orderId} placed`);
      clear();
    } catch (err) {
      status(`Checkout failed: ${err.message}`);
    } finally {
      busy(false);
    }
  }

  return h('div', { class: 'page' },
    h(Head, { title: 'Your cart | Smoke Supply Co.' }),
    h(Header, { current: 'cart' }),
    h('main', { class: 'container' },
      h('h1', {}, 'Your cart'),

      // <Show> with a reactive `when`: the empty state and the table swap
      // without a page load as lines change.
      h(Show, {
        when: () => count() > 0,
        fallback: h('p', { class: 'muted', 'data-cart-empty': '' }, 'Your cart is empty.'),
      },
        h('div', { 'data-cart-table': '' },
          h('ul', { class: 'cart-lines' },
            // Raw items, not signal accessors. This app is buildless, so <For>
            // runs through the runtime component in what-core, which hands the
            // render function the item value itself. The compiled path lowers
            // <For key={...}> to mapArray and hands over a signal accessor
            // instead. That divergence is a framework issue, not an app choice:
            // see smoke/FINDINGS.md. Written against the path that actually
            // executes here.
            h(For, { each: lines }, (line) =>
              h('li', { class: 'cart-line', 'data-line': line.slug },
                h('span', { class: 'cart-line-title' }, line.title),
                h('span', { class: 'cart-line-qty' },
                  h('button', {
                    'data-dec': line.slug,
                    'aria-label': `Decrease ${line.title}`,
                    onclick: () => setQty(line.slug, line.qty - 1),
                  }, 'Less'),
                  h('output', { 'data-qty': line.slug }, String(line.qty)),
                  h('button', {
                    'data-inc': line.slug,
                    'aria-label': `Increase ${line.title}`,
                    onclick: () => setQty(line.slug, line.qty + 1),
                  }, 'More'),
                ),
                h('span', { class: 'cart-line-price' }, formatPrice(line.qty * line.price)),
              ),
            ),
          ),
          h('p', { class: 'cart-total' }, 'Subtotal: ',
            h('strong', { 'data-subtotal': '' }, () => formatPrice(subtotal()))),
          h('button', {
            class: 'primary',
            'data-checkout': '',
            'aria-busy': () => (busy() ? 'true' : 'false'),
            onclick: checkout,
          }, 'Checkout'),
        ),
      ),

      h('p', { class: 'status', 'data-checkout-status': '' }, () => status()),
    ),
    h(Footer, {}),
  );
}
