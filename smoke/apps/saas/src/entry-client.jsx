// Client entry: hydrates the page the server rendered, then restores the
// scroll position on back and forward.

import './styles.css';
import { hydrate } from 'what-framework';
import { enableScrollRestoration } from 'what-router';
import App from './App.jsx';

// Hydration probes, read by the smoke suite: every mismatch report, the
// elements and text hydrate() added or removed (it should adopt the server's,
// changing none; the comments that mark a keyed list's rows are consumed),
// and when it finished.
const probe = { mismatches: [], added: 0, removed: 0, hydrated: false, hydratedAt: 0 };
window.__ns = probe;

const observer = new MutationObserver(() => {});
observer.observe(document.body, { childList: true, subtree: true });
hydrate(<App />, document.body, {
  onHydrationError: (m) => probe.mismatches.push({ kind: m.kind, component: m.component, path: m.path }),
});
const counted = (nodes) => [...nodes].filter((n) => n.nodeType !== Node.COMMENT_NODE).length;
for (const record of observer.takeRecords()) {
  probe.added += counted(record.addedNodes);
  probe.removed += counted(record.removedNodes);
}
observer.disconnect();
enableScrollRestoration();
probe.hydratedAt = performance.now();
probe.hydrated = true;
