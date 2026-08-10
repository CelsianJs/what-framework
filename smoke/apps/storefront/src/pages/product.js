// Product: STATIC (SSG) with a dynamic param.
//
// getStaticPaths enumerates the pages to prerender at build time; the route
// param resolves per page. The add-to-cart button writes to the global store.
//
// The review FORM is deliberately not here. A cached page (static or hybrid) is
// shared across visitors, so the adapter does not embed a per-user CSRF token in
// it. A <Form> rendered here would post an empty token and be rejected with
// scripting disabled. The form lives on /review, which is mode:'server'. What
// this page proves instead is the other half: a review posted there busts the
// 'products' tag, so this cached page shows it on the next request.

import { h, Head, signal, useLoaderData } from 'what-framework';
import { Header, Footer } from '../components/chrome.js';
import { addItem, formatPrice } from '../store/cart.js';

export const page = { mode: 'static', revalidate: 300, tags: ['products'] };

export const getStaticPaths = async () => {
  const { productSlugs } = await import('../db.js');
  return {
    paths: productSlugs().map((slug) => ({ params: { slug } })),
    // An unlisted slug renders on first request; the loader's notFound turns it
    // into a real 404 that the server refuses to cache.
    fallback: 'blocking',
  };
};

export const loader = async ({ params }) => {
  const { getProduct } = await import('../db.js');
  const product = getProduct(params.slug);
  if (!product) return { notFound: true, product: null };
  return { product };
};

export default function Product() {
  const { product, notFound } = useLoaderData();

  if (notFound || !product) {
    return h('div', { class: 'page' },
      h(Head, { title: 'Not found' }),
      h(Header, {}),
      h('main', { class: 'container' },
        h('h1', { 'data-not-found': '' }, 'Product not found'),
        h('p', {}, h('a', { href: '/' }, 'Back to the shop')),
      ),
      h(Footer, {}),
    );
  }

  const added = signal(false, 'added');
  const inStock = product.stock > 0;

  return h('div', { class: 'page' },
    h(Head, {
      title: `${product.title} | Smoke Supply Co.`,
      meta: [{ name: 'description', content: product.blurb }],
    }),
    h(Header, {}),
    h('main', { class: 'container product-detail' },
      h('h1', { 'data-title': '' }, product.title),
      h('p', { class: 'price', 'data-price': '' }, formatPrice(product.price)),
      h('p', { class: 'blurb' }, product.blurb),

      h('button', {
        'data-add': '',
        class: 'primary',
        disabled: !inStock,
        'aria-disabled': inStock ? 'false' : 'true',
        onclick: () => { addItem(product); added(true); },
      }, inStock ? 'Add to cart' : 'Out of stock'),

      // Reactive thunk child: shows only after the click, proving hydration
      // attached the handler to server-rendered DOM.
      h('p', { class: 'added-note', 'data-added': '' }, () => (added() ? 'Added to cart' : '')),

      h('section', { class: 'reviews' },
        h('h2', {}, 'Reviews'),
        h('ul', { 'data-reviews': '' },
          product.reviews.length === 0
            ? h('li', { class: 'muted', 'data-no-reviews': '' }, 'No reviews yet.')
            : product.reviews.map((r) => h('li', { key: r.id }, r.body)),
        ),
        h('p', {}, h('a', { href: `/review?slug=${product.slug}`, 'data-write-review': '' }, 'Write a review')),
      ),
    ),
    h(Footer, {}),
  );
}
