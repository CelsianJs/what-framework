// Storefront — an ISR-cached product grid. Static + revalidate so the grid is
// served from the origin cache and regenerated in the background; the `products`
// tag lets a restock webhook or cart action purge just this listing.

import { h, Head, useLoaderData } from 'what-framework';
import { listProducts } from '../db.js';

export const page = { mode: 'static', revalidate: 60, tags: ['products'] };

export const loader = () => ({ products: listProducts() });

const price = (cents) => `$${(cents / 100).toFixed(2)}`;

export default function Storefront() {
  const { products } = useLoaderData();
  return h('main', { class: 'container' },
    h(Head, {
      title: 'What Shop',
      meta: [{ name: 'description', content: 'A full-stack store built with What Framework' }],
    }),
    h('h1', {}, 'What Shop'),
    h('p', {}, 'ISR-cached storefront. Dashboard is server-rendered per request.'),
    h('ul', { class: 'grid' }, products.map((p) =>
      h('li', { key: p.id },
        h('a', { href: `/product/${p.id}` }, p.name),
        h('span', {}, ` — ${price(p.price)}`),
        p.stock === 0 ? h('em', {}, ' (sold out)') : null
      )
    )),
    h('p', {}, h('a', { href: '/dashboard' }, 'Admin dashboard →'))
  );
}
