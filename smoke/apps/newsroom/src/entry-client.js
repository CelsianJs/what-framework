// Client entry: hydrates whichever page the server sent.
//
// Page modules are imported directly, never ./routes.js, which pulls in the
// server actions and the database.

import { h, hydrate } from 'what-framework';
import FrontPage from './pages/front.js';
import ArticlePage from './pages/article.js';

const pathname = location.pathname;
const Page = pathname === '/' ? FrontPage : /^\/article\/[^/]+\/?$/.test(pathname) ? ArticlePage : null;

// Hydration probes, read by the smoke suite and handy in devtools:
// `mismatches` collects every report, `added` counts nodes the hydrate()
// call put into the document (it should adopt the server's, adding none).
const probe = { mismatches: [], added: 0, textChanged: 0, hydrated: false };
window.__newsroom = probe;

if (Page) {
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  const created = window.__nodesCreated?.() ?? null;
  hydrate(h(Page, {}), document.body, {
    onHydrationError: (mismatch) => probe.mismatches.push({ kind: mismatch.kind, component: mismatch.component, path: mismatch.path }),
  });
  for (const record of observer.takeRecords()) {
    if (record.type === 'childList') probe.added += record.addedNodes.length;
    else probe.textChanged += 1;
  }
  observer.disconnect();
  if (created !== null) probe.created = window.__nodesCreated() - created;
  probe.hydrated = true;
  document.documentElement.dataset.hydrated = 'true';
}
