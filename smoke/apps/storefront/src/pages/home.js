// Home: HYBRID (ISR).
//
// mode:'hybrid' means: serve from the ISR cache, regenerate in the background
// after `revalidate` seconds, and let an action bust it by tag. The suite proves
// all three: a first request MISSes, a second HITs, and a review posted through
// a server action makes the tagged page reflect new data.

import { h, Head, useLoaderData } from 'what-framework';
import { Header, Footer } from '../components/chrome.js';
import { formatPrice } from '../store/cart.js';

export const page = { mode: 'hybrid', revalidate: 60, tags: ['products'] };

export const loader = async () => {
  const { listProducts } = await import('../db.js'); // server-only
  return { products: listProducts(), renderedAt: Date.now() };
};

export default function Home() {
  const { products } = useLoaderData();

  return h('div', { class: 'page' },
    h(Head, {
      title: 'Smoke Supply Co.',
      meta: [{ name: 'description', content: 'Desk goods for people who test things.' }],
    }),
    h(Header, { current: 'home' }),
    h('main', { class: 'container' },
      h('h1', {}, 'Everything for the desk'),
      h('p', { class: 'lede' }, 'Server-rendered, ISR-cached, hydrated on the client.'),

      // A keyed list. `key` lets the compiler lower this to keyed reconciliation
      // so rows are moved rather than recreated.
      h('ul', { class: 'product-grid', 'data-products': '' }, products.map((p) =>
        h('li', { key: p.slug, class: 'product-card', 'data-product': p.slug },
          h('a', { href: `/product/${p.slug}` },
            h('h2', {}, p.title),
            h('p', { class: 'blurb' }, p.blurb),
            h('p', { class: 'price' }, formatPrice(p.price)),
          ),
          // Enumerated ARIA, not an HTML boolean: must render the STRING
          // "true"/"false", never an empty attribute and never absent.
          h('span', {
            class: 'stock',
            'data-stock': p.slug,
            'aria-disabled': p.stock === 0 ? 'true' : 'false',
          }, p.stock === 0 ? 'Out of stock' : `${p.stock} in stock`),
        ),
      )),
    ),
    h(Footer, {}),
  );
}
