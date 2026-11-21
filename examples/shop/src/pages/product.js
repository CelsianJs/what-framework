// Product detail — dynamic /product/[id] with a loader, getStaticPaths (known
// products pre-rendered at build; the rest on first hit), ISR, per-product
// <Head>, and an add-to-cart <Form> posting to the addToCart server action.
//
// The page is cached, so its HTML is shared by every visitor and carries no
// one's CSRF token. The form still posts: the action endpoint accepts a post
// the browser marks same-origin (Sec-Fetch-Site / Origin) and refuses a
// cross-site one.

import { h, Head, useLoaderData } from 'what-framework';
import { Form } from 'what-framework/server';
import { addToCartAction } from '../actions/cart.js';
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
        ? h(Form, { action: addToCartAction, redirect: '/cart' },
            h('input', { type: 'hidden', name: 'id', value: product.id }),
            h('button', { type: 'submit' }, 'Add to cart')
          )
        : null
    ),
    h('p', {}, h('a', { href: '/' }, '← Back to shop'))
  );
}
