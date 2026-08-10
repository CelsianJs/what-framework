// Write a review: SERVER mode, and the no-JS server-action path.
//
// This page is mode:'server' for a specific reason. Cached HTML is shared
// between visitors, so the adapter never embeds a per-visitor CSRF token in it,
// which means a <Form> on a static or hybrid page has no token to submit and the
// double-submit check rejects the post when JavaScript is off. A server-rendered
// page gets `csrfToken` handed to its loader, so the form works with scripting
// fully disabled. That is the case this page exists to hold down.

import { h, Head, useLoaderData } from 'what-framework';
import { Form } from 'what-framework/server';
import { Header, Footer } from '../components/chrome.js';
import { addReviewAction } from '../actions/shop.js';

export const page = { mode: 'server' };

export const loader = async ({ query, csrfToken }) => {
  const { listProducts } = await import('../db.js');
  return {
    products: listProducts(),
    selected: String(query?.slug ?? ''),
    posted: String(query?.posted ?? '') === '1',
    csrfToken: csrfToken ?? '',
  };
};

export default function Review() {
  const { products, selected, posted, csrfToken } = useLoaderData();

  return h('div', { class: 'page' },
    h(Head, { title: 'Write a review | Smoke Supply Co.' }),
    h(Header, {}),
    h('main', { class: 'container' },
      h('h1', {}, 'Write a review'),

      posted
        ? h('p', { class: 'status', 'data-review-posted': '' }, 'Thanks, your review is live.')
        : null,

      // One form, both paths. With scripting on, enhanceForms() intercepts the
      // submit and posts to the same endpoint with the same encoding. With
      // scripting off, the browser submits it natively. The suite drives both,
      // and proving the no-JS path needs a context that genuinely has no JS, not
      // a form that opts out of enhancement.
      h(Form, {
        action: addReviewAction,
        csrfToken,
        redirect: '/review?posted=1',
        class: 'review-form',
      },
        h('label', { for: 'review-slug' }, 'Product'),
        h('select', { id: 'review-slug', name: 'slug' },
          products.map((p) =>
            h('option', {
              key: p.slug,
              value: p.slug,
              ...(p.slug === selected ? { selected: true } : {}),
            }, p.title),
          ),
        ),
        h('label', { for: 'review-body' }, 'Your review'),
        h('textarea', { id: 'review-body', name: 'body', required: true, placeholder: 'How was it?' }),
        h('button', { type: 'submit', 'data-review-submit': '' }, 'Post review'),
      ),
    ),
    h(Footer, {}),
  );
}
