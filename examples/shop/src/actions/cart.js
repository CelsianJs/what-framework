// Cart server actions. Mutating the cart changes what the (server-rendered)
// dashboard shows, and stock-affecting changes mean the cached storefront +
// product pages should regenerate — so each action revalidates the `products`
// tag (covers the grid and every /product/[id]) plus the home path.

import { action, revalidateTag, revalidatePath } from 'what-framework/server';
import { addToCart, removeFromCart } from '../db.js';

export const addToCartAction = action(
  async ({ id, qty }) => {
    const cart = addToCart(id, Number(qty) || 1);
    return { ok: true, count: cart.count };
  },
  { id: 'addToCart', revalidate: ['/'], revalidateTags: ['products'] }
);

export const removeFromCartAction = action(
  async ({ id }) => {
    const cart = removeFromCart(id);
    return { ok: true, count: cart.count };
  },
  { id: 'removeFromCart', revalidate: ['/'], revalidateTags: ['products'] }
);
