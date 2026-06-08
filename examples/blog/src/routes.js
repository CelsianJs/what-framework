// Route table. In a JSX app the vite plugin generates this from src/pages/** via
// `virtual:what-routes/server`; here it's written by hand so the example runs
// with plain `node` and no build step. Each entry carries the page's default
// component plus its live loader/getStaticPaths/page bindings.

import Home, { loader as homeLoader, page as homePage } from './pages/home.js';
import Post, { loader as postLoader, getStaticPaths as postPaths, page as postPage } from './pages/post.js';
import NewPost, { page as newPage } from './pages/new.js';

// Importing the action registers it server-side so /__what_action can dispatch it.
import './actions/posts.js';

export const routes = [
  { path: '/', component: Home, loader: homeLoader, page: homePage, mode: homePage.mode },
  { path: '/blog/:slug', component: Post, loader: postLoader, getStaticPaths: postPaths, page: postPage, mode: postPage.mode },
  { path: '/new', component: NewPost, page: newPage, mode: newPage.mode },
];
