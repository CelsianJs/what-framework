// Client entry: hydrates the page the server rendered.

import './styles.css';
import { hydrate } from 'what-framework';
import App from './App.jsx';

// Hydration probes, read by the smoke suite: every mismatch report, and the
// nodes the hydrate() call added (it should adopt the server's, adding none).
const probe = { mismatches: [], added: 0, hydrated: false };
window.__atlas = probe;

const observer = new MutationObserver(() => {});
observer.observe(document.body, { childList: true, subtree: true });
hydrate(<App />, document.body, {
  onHydrationError: (m) => probe.mismatches.push({ kind: m.kind, component: m.component, path: m.path }),
});
for (const record of observer.takeRecords()) probe.added += record.addedNodes.length;
observer.disconnect();
probe.hydrated = true;
