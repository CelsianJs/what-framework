// Client hydration entry.
//
// Import page modules directly, never ./routes.js: the route table also imports
// the server actions, which pull in the database.

import { h, hydrate, effect } from 'what-framework';
import { enhanceForms } from 'what-server/islands';
import { count, subtotal, formatPrice } from './store/cart.js';
import Home from './pages/home.js';
import Product from './pages/product.js';
import Cart from './pages/cart.js';
import Search from './pages/search.js';
import Account from './pages/account.js';

// /review is deliberately absent. It is a server-rendered form with no client
// state, and its component imports <Form> from what-framework/server, which is
// server code: hydrating it would mean shipping the action handler, the CSRF
// generator and the adapters to the browser to render a <form> that already
// exists in the HTML. enhanceForms() below gives it the JS path without any of
// that, which is the whole point of progressive enhancement.
function matchPage(pathname) {
  if (pathname === '/') return h(Home, {});
  if (pathname === '/cart') return h(Cart, {});
  if (pathname === '/search') return h(Search, {});
  if (pathname === '/account') return h(Account, {});
  const product = pathname.match(/^\/product\/([^/]+)\/?$/);
  if (product) return h(Product, { slug: decodeURIComponent(product[1]) });
  return null;
}

const vnode = matchPage(location.pathname);

if (vnode) {
  hydrate(vnode, document.body);
} else {
  // A page with no client component still has the shared header, and the cart
  // it renders came from the server, where localStorage does not exist. Bind
  // the badge to the store so it agrees with every other page.
  const countEl = document.querySelector('[data-cart-count]');
  const subtotalEl = document.querySelector('[data-cart-subtotal]');
  if (countEl && subtotalEl) {
    effect(() => { countEl.textContent = String(count()); });
    effect(() => { subtotalEl.textContent = formatPrice(subtotal()); });
  }
}

// Progressive enhancement for <Form>: posts to /__what_action without a page
// reload, then follows the action's redirect. With scripting disabled the same
// form submits natively, which is the path <Form> is designed around.
enhanceForms();

// Dev-only devtools bridge (see server.js). Dynamic imports behind the flag, so
// a production page never fetches either module.
if (globalThis.__WHAT_DEV__) {
  Promise.all([import('what-core'), import('what-devtools')])
    .then(([core, devtools]) => {
      devtools.installDevTools?.(core);
    })
    .catch(() => { /* devtools are optional */ });
}
