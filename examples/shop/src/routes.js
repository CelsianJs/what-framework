// Route table. In a JSX app the vite plugin generates this from src/pages/**;
// here it's hand-written so the example runs with plain `node` and no build step.

import Storefront, { loader as homeLoader, page as homePage } from './pages/home.js';
import Product, { loader as productLoader, getStaticPaths as productPaths, page as productPage } from './pages/product.js';
import Dashboard, { loader as dashLoader, page as dashPage } from './pages/dashboard.js';

// Importing the actions registers them so /__what_action can dispatch them.
import './actions/cart.js';

export const routes = [
  { path: '/', component: Storefront, loader: homeLoader, page: homePage, mode: homePage.mode },
  { path: '/product/:id', component: Product, loader: productLoader, getStaticPaths: productPaths, page: productPage, mode: productPage.mode },
  { path: '/dashboard', component: Dashboard, loader: dashLoader, page: dashPage, mode: dashPage.mode },
];
