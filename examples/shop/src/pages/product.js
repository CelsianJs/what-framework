// Product detail — dynamic /product/[id] with a loader, getStaticPaths (known
// products pre-rendered at build; the rest on first hit), ISR, per-product
// <Head>, and an add-to-cart form posting to the addToCart server action.

import { h, Head, useLoaderData } from 'what-framework';
import { getProduct, listProducts } from '../db.js';

export const page = { mode: 'static', revalidate: 60, tags: ['products'] };

export const loader = ({ params }) => ({ product: getProduct(params.id) });

export async function getStaticPaths() {
  return {
    paths: listProducts().map((p) => ({ params: { id: p.id } })),
    fallback: 'blocking',
  };
}

const price = (cents) => `$${(cents / 100).toFixed(2)}`;

export default function Product() {
  const { product } = useLoaderData();
  if (!product) return h('main', { class: 'container' }, h('h1', {}, 'Not found'));
  return h('main', { class: 'container' },
    h(Head, {
      title: `${product.name} — What Shop`,
      meta: [{ property: 'og:title', content: product.name }],
    }),
    h('article', {},
      h('h1', {}, product.name),
      h('p', {}, product.blurb),
      h('p', {}, price(product.price), product.stock === 0 ? ' — sold out' : ` — ${product.stock} in stock`),
      product.stock > 0
        ? h('form', { method: 'post', action: '/__what_action', 'data-action': 'addToCart' },
            h('input', { type: 'hidden', name: 'id', value: product.id }),
            h('button', { type: 'submit' }, 'Add to cart')
          )
        : null
    ),
    h('p', {}, h('a', { href: '/' }, '← Back to shop'))
  );
}
