// The route table. Every chapter and the editor desk are lazy(): the router
// downloads a page's chunk when a navigation first heads there (or a link to
// it is hovered), keeps the page being left on screen meanwhile, and shows
// the route's error page if the download fails.

import { lazy } from 'what-framework';

import { CHAPTERS, chapterPath } from './chapters.js';
import { ChapterFailed, Home, SignIn } from './pages.jsx';
import { session } from './state.js';

// One loader per chapter file; Vite builds each into its own chunk.
const modules = import.meta.glob('./chapters/*.jsx');

const requireEditor = ({ path }) => (session() ? undefined : `/signin?next=${encodeURIComponent(path)}`);

export const routes = [
  { path: '/', component: Home },
  ...CHAPTERS.map((c) => ({
    path: chapterPath(c.slug),
    component: lazy(modules[`./chapters/${c.slug}.jsx`]),
    error: ChapterFailed,
  })),
  { path: '/desk', component: lazy(() => import('./desk/Desk.jsx')), middleware: [requireEditor], error: ChapterFailed },
  { path: '/signin', component: SignIn },
];
