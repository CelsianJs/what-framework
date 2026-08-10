// Route table. Each entry carries the page component plus its live
// loader/getStaticPaths/page bindings.
//
// Server-only: importing this pulls in the actions, which pull in the database.

import Home, { loader as homeLoader, page as homePage } from './pages/home.js';
import Product, { loader as productLoader, getStaticPaths as productPaths, page as productPage } from './pages/product.js';
import Cart, { loader as cartLoader, page as cartPage } from './pages/cart.js';
import Search, { loader as searchLoader, page as searchPage } from './pages/search.js';
import Account, { loader as accountLoader, page as accountPage } from './pages/account.js';
import Review, { loader as reviewLoader, page as reviewPage } from './pages/review.js';

// Importing the actions registers them so /__what_action can dispatch.
import './actions/shop.js';

export const routes = [
  { path: '/', component: Home, loader: homeLoader, page: homePage, mode: homePage.mode },
  { path: '/product/:slug', component: Product, loader: productLoader, getStaticPaths: productPaths, page: productPage, mode: productPage.mode },
  { path: '/cart', component: Cart, loader: cartLoader, page: cartPage, mode: cartPage.mode },
  { path: '/search', component: Search, loader: searchLoader, page: searchPage, mode: searchPage.mode },
  { path: '/account', component: Account, loader: accountLoader, page: accountPage, mode: accountPage.mode },
  { path: '/review', component: Review, loader: reviewLoader, page: reviewPage, mode: reviewPage.mode },
];
