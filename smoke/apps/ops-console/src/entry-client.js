// Client entry.
//
// Two mounts, on purpose:
//
//   hydrate() claims the server's DOM for the console shell, the filter form
//   and the feed.
//
//   mount() then starts the detail pane inside the <aside> the server shipped
//   empty. Keeping the client router OUT of the hydrated tree means the server
//   never has to render a route it cannot resolve, and a direct hit on
//   /incidents/INC-1042 still gets the full console shell in the first byte.
//
// Page modules are imported directly rather than through src/routes.js: the
// route table also pulls in the incident store, which is server-only.

import { h, hydrate, mount } from 'what-framework';
import Console from './pages/console.js';
import { DetailPane } from './pane-routes.js';

// The server only ships this entry on console routes, but check anyway: an
// entry that hydrates one page's component against another page's DOM (and
// another page's loader data) fails in a way that reads as a framework bug.
const isConsoleRoute = location.pathname === '/' || location.pathname.startsWith('/incidents/');

if (isConsoleRoute) {
  hydrate(h(Console, {}), document.body);
  mount(h(DetailPane, {}), '#detail-pane');
}
