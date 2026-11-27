// The route table. Every chapter and the editor desk are lazy(): the router
// downloads a page's chunk when a navigation first heads there (or a link to
// it is hovered), keeps the page being left on screen meanwhile, and shows
// the route's error page if the download fails.

import { lazy } from 'what-framework';

import { CHAPTERS, chapterPath } from './chapters.js';
import { ChapterFailed, Home, SignIn } from './pages.jsx';
import { session, stats } from './state.js';

// One loader per chapter file; Vite builds each into its own chunk. Each call
// is counted: a browser may answer an import() without a request.
const modules = import.meta.glob('./chapters/*.jsx');
const loader = (slug) => () => {
  stats.loads[slug] = (stats.loads[slug] ?? 0) + 1;
  return modules[`./chapters/${slug}.jsx`]();
};

const requireEditor = ({ path }) => (session() ? undefined : `/signin?next=${encodeURIComponent(path)}`);

export const routes = [
  { path: '/', component: Home },
  ...CHAPTERS.map((c) => ({
    path: chapterPath(c.slug),
    component: lazy(loader(c.slug)),
    error: ChapterFailed,
  })),
  { path: '/desk', component: lazy(() => import('./desk/Desk.jsx')), middleware: [requireEditor], error: ChapterFailed },
  { path: '/signin', component: SignIn },
];
