// Route table. Server-only: importing it registers the actions, which reach
// the database.

import FrontPage, { loader as frontLoader, page as frontPage } from './pages/front.js';
import ArticlePage, { loader as articleLoader, page as articlePage } from './pages/article.js';
import './actions/comments.js';

export const routes = [
  { path: '/', component: FrontPage, loader: frontLoader, page: frontPage, mode: frontPage.mode },
  { path: '/article/:slug', component: ArticlePage, loader: articleLoader, page: articlePage, mode: articlePage.mode },
];
