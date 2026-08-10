// Server actions. Importing this module registers them so /__what_action can
// dispatch. Server-only: never served to the browser.

import { action } from 'what-framework/server';
import { revalidateTag } from 'what-framework/server';

/**
 * Post a review, then bust every page tagged 'products'.
 *
 * The revalidation is the interesting half: the product page is `mode:'static'`
 * and the home page is `mode:'hybrid'`, so without this the new review would be
 * invisible behind the cache. The suite asserts the cached page reflects it.
 */
export const addReviewAction = action(
  async (form) => {
    const { addReview } = await import('../db.js');
    const slug = String(form?.slug ?? '');
    const body = String(form?.body ?? '');
    const reviews = addReview(slug, body);
    await revalidateTag('products');
    return { ok: true, count: reviews.length };
  },
  { id: 'addReview' },
);

/** Server-side cart validation: proves an action can reject bad input. */
export const checkoutAction = action(
  async (form) => {
    const lines = Array.isArray(form?.lines) ? form.lines : [];
    if (lines.length === 0) throw new Error('cart is empty');
    const { getProduct } = await import('../db.js');
    let total = 0;
    for (const line of lines) {
      const product = getProduct(String(line.slug));
      if (!product) throw new Error(`unknown product: ${line.slug}`);
      total += product.price * Math.max(1, Number(line.qty) || 1);
    }
    return { ok: true, orderId: `SMK-${String(total).padStart(6, '0')}`, total };
  },
  { id: 'checkout' },
);
