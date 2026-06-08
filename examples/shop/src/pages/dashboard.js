// Admin dashboard — mode:'server' so it's rendered fresh on every request and
// never cached (it shows live, per-user state). The adapter sends
// `Cache-Control: private, no-store` for server-mode routes automatically.
//
// Auth is simulated here with a header check; a real app would validate a
// session cookie in the loader and redirect on failure.

import { h, Head, useLoaderData } from 'what-framework';
import { listOrders, getCart } from '../db.js';

export const page = { mode: 'server' };

export const loader = ({ request }) => {
  const authed = !request || request.headers?.get?.('x-demo-admin') === '1';
  if (!authed) return { authed: false };
  return { authed: true, orders: listOrders(), cart: getCart() };
};

const price = (cents) => `$${(cents / 100).toFixed(2)}`;

export default function Dashboard() {
  const data = useLoaderData();
  if (!data.authed) {
    return h('main', { class: 'container' },
      h(Head, { title: 'Sign in — What Shop' }),
      h('h1', {}, 'Admin'),
      h('p', {}, 'Not authorized. (Demo: send header x-demo-admin: 1.)')
    );
  }
  return h('main', { class: 'container' },
    h(Head, { title: 'Dashboard — What Shop' }),
    h('h1', {}, 'Dashboard'),
    h('p', {}, `Cart total: ${price(data.cart.total)} (${data.cart.count} items)`),
    h('h2', {}, 'Open orders'),
    data.orders.length
      ? h('ul', {}, data.orders.map((o) =>
          h('li', { key: o.id }, `${o.name} ×${o.qty} — ${price(o.lineTotal)}`)
        ))
      : h('p', {}, 'No orders yet.'),
    h('p', {}, h('a', { href: '/' }, '← Back to shop'))
  );
}
