// Server route table. Importing this pulls in the incident store, so it is
// never served to the browser.

import Console, { loader as consoleLoader } from './pages/console.js';
import Health, { loader as healthLoader } from './pages/health.js';

// `hydrate: false` means the page ships no client entry at all. /health is
// static diagnostics with no interactive state, so sending it a bundle that
// would then try to hydrate the CONSOLE component is worse than useless: it
// throws on the loader data of a different page.
export const routes = [
  { path: '/', component: Console, loader: consoleLoader, hydrate: true },
  // A deep link to an incident renders the same shell: the pane is client-routed,
  // so the server's job is to ship the console and let the router resolve the id.
  { path: '/incidents/:id', component: Console, loader: consoleLoader, hydrate: true },
  { path: '/health', component: Health, loader: healthLoader, hydrate: false },
];

/** Tiny matcher: one optional `:param` segment is all this app's paths need. */
export function matchPath(pathname) {
  for (const route of routes) {
    const routeParts = route.path.split('/');
    const urlParts = pathname.split('/');
    if (routeParts.length !== urlParts.length) continue;

    const params = {};
    let matched = true;
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        if (!urlParts[i]) { matched = false; break; }
        params[routeParts[i].slice(1)] = decodeURIComponent(urlParts[i]);
      } else if (routeParts[i] !== urlParts[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return { route, params };
  }
  return null;
}
