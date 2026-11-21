// The detail pane: a client-routed region mounted into the <aside> the server
// shipped empty.
//
// The Suspense boundary sits ABOVE the Router on purpose. A lazy component
// suspends by throwing its load promise, and the boundary has to be an ancestor
// of whatever the router builds for the current URL, or the throw escapes as an
// uncaught error and the route renders permanently blank.
//
// The detail module is a real dynamic import. On a cold cache the fallback
// below shows while the chunk is in flight on a first load; a navigation loads
// the chunk before it commits, so the pane being left stays meanwhile.

import { Suspense, h, lazy } from 'what-framework';
import { Router, route } from 'what-router';

const IncidentDetail = lazy(() => import('./panels/incident-detail.js'));

function EmptyPane() {
  return h('div', { class: 'pane-empty', 'data-pane-empty': '' },
    h('p', {}, 'Select an incident'),
    h('p', { class: 'muted' }, 'The detail panel loads on demand.'),
  );
}

function PaneSkeleton() {
  return h('div', { class: 'pane-skeleton', 'data-pane-skeleton': '' },
    h('p', { class: 'muted' }, 'Loading detail panel...'),
    h('div', { class: 'skeleton-bar' }),
    h('div', { class: 'skeleton-bar short' }),
    h('div', { class: 'skeleton-bar' }),
  );
}

// aria-busy follows the navigation: while one loads the next route's chunk,
// the pane being left stays and says it is busy.
export function DetailPane() {
  return h('div', { class: 'pane-route', 'aria-busy': () => (route.isNavigating ? 'true' : 'false') },
    h(Suspense, { fallback: h(PaneSkeleton, {}) },
      h(Router, {
        routes: [
          { path: '/', component: EmptyPane },
          { path: '/incidents/:id', component: IncidentDetail },
        ],
        fallback: EmptyPane,
      }),
    ),
  );
}
