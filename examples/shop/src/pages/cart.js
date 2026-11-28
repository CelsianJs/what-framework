// Cart — mode:'server', rendered per request (it shows this visitor's cart).
// The add-to-cart form on a cached product page lands here (303 See Other).

import { h, Head, useLoaderData } from 'what-framework';
import { getCart } from '../db.js';

export const page = { mode: 'server' };

export const loader = () => ({ cart: getCart() });

const price = (cents) => `$${(cents / 100).toFixed(2)}`;

export default function Cart() {
  const { cart } = useLoaderData();
  return h('main', { class: 'container' },
    h(Head, { title: 'Cart — What Shop' }),
    h('h1', {}, 'Your cart'),
    cart.items.length === 0
      ? h('p', {}, 'Your cart is empty.')
      : h('ul', { class: 'cart' }, cart.items.map((item) =>
        h('li', { key: item.id }, `${item.name} ×${item.qty} — ${price(item.lineTotal)}`))),
    h('p', {}, `${cart.count} item(s), ${price(cart.total)}`),
    h('p', {}, h('a', { href: '/' }, '← Keep shopping'))
  );
}
