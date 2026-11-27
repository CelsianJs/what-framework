// The capability contract.
//
// "Full coverage" is worthless as a claim and useful as a check. This file is
// the list of framework capabilities the app suite is responsible for, and the
// runner FAILS when a capability has no app covering it, or when an app claims
// a capability whose checks did not actually run.
//
// Adding a capability here without covering it turns the suite red. That is the
// point: it is how a gap becomes visible on the day it appears rather than in
// the next audit.

/**
 * capability id -> { area, what it proves }
 * An app declares `covers: [...ids]` and must emit a passing check per id.
 */
export const CAPABILITIES = {
  // --- Render modes -------------------------------------------------------
  'render:static': { area: 'render', desc: 'a static (SSG) page is prerendered to HTML at build time' },
  'render:server': { area: 'render', desc: 'a server page renders per request with fresh data' },
  'render:hybrid-isr': { area: 'render', desc: 'a hybrid page is cached and served as an ISR HIT on the second request' },
  'render:client-spa': { area: 'render', desc: 'a client-only route renders without server HTML' },
  'render:hydration': { area: 'render', desc: 'server HTML hydrates and becomes interactive with zero page errors' },
  'render:no-hydration-mismatch': { area: 'render', desc: 'hydration reuses server DOM without mismatch warnings' },

  // --- Routing ------------------------------------------------------------
  'route:table': { area: 'routing', desc: 'multi-page routing via a route table' },
  'route:params': { area: 'routing', desc: 'dynamic route params resolve (/product/:slug)' },
  'route:nested-layout': { area: 'routing', desc: 'a nested layout wraps its child routes' },
  'route:guard': { area: 'routing', desc: 'an auth guard redirects an unauthenticated visitor' },
  'route:loading': { area: 'routing', desc: "a route's loading component shows while navigating TO it" },
  'route:error': { area: 'routing', desc: "a route's error component catches a throw from the page" },
  'route:404': { area: 'routing', desc: 'an unknown path renders the not-found fallback' },
  'route:link-active': { area: 'routing', desc: 'Link/NavLink applies active classes for the current route' },
  'route:programmatic': { area: 'routing', desc: 'navigate() moves between routes from code' },
  'route:server-redirect': { area: 'routing', desc: 'a route middleware redirect rendered on the server is a real 3xx with its Location' },
  'route:layout-hydrates': { area: 'routing', desc: "a server-rendered layout chain hydrates onto the server's DOM and stays through client navigation" },
  'route:history': { area: 'routing', desc: 'browser back/forward walk a session of routes, each showing the state it had' },

  // --- State --------------------------------------------------------------
  'state:signal': { area: 'state', desc: 'local signal state updates the DOM' },
  'state:computed': { area: 'state', desc: 'computed derives from signals and stays in sync' },
  'state:global-store': { area: 'state', desc: 'a module-scoped store is shared across routes/components' },
  'state:persisted': { area: 'state', desc: 'state survives a full page reload (localStorage)' },
  'state:context': { area: 'state', desc: 'context provides a value to a deep child' },
  'state:batch': { area: 'state', desc: 'batched writes settle to one consistent render' },

  // --- Data ---------------------------------------------------------------
  'data:loader': { area: 'data', desc: 'a route loader supplies data to SSR via useLoaderData' },
  'data:loader-request': { area: 'data', desc: 'a loader reads the incoming request (cookies) and branches what it renders' },
  'data:query': { area: 'data', desc: 'useQuery fetches, caches and exposes loading/success' },
  'data:invalidate': { area: 'data', desc: 'invalidateQueries with an array prefix refetches matching keys' },
  'data:infinite': { area: 'data', desc: 'useInfiniteQuery appends the next page' },
  'data:optimistic': { area: 'data', desc: 'an optimistic update applies immediately and reconciles' },
  'data:optimistic-rollback': { area: 'data', desc: 'an optimistic edit the server refuses rolls back to the committed value' },
  'data:resource-suspense': { area: 'data', desc: 'createResource suspends and resolves under Suspense' },

  // --- Server -------------------------------------------------------------
  'server:action-js': { area: 'server', desc: 'a server action runs from the client and updates the page' },
  'server:action-nojs': { area: 'server', desc: 'a <Form> action works with JavaScript disabled' },
  'server:csrf': { area: 'server', desc: 'an action without a valid CSRF token is rejected' },
  'server:revalidate': { area: 'server', desc: 'an action revalidates a cached page so the change is visible' },
  'server:action-error': { area: 'server', desc: 'a throwing action returns a generic failure and leaves the server serving' },

  // --- Islands ------------------------------------------------------------
  'island:load': { area: 'islands', desc: 'client:load hydrates immediately' },
  'island:idle': { area: 'islands', desc: 'client:idle hydrates when the browser goes idle' },
  'island:visible': { area: 'islands', desc: 'client:visible hydrates when scrolled into view, not before' },
  'island:interaction': { area: 'islands', desc: 'client:interaction hydrates on first user interaction, not before' },
  'island:media': { area: 'islands', desc: 'client:media hydrates only when the media query matches' },
  'island:ssr-content': { area: 'islands', desc: 'an island ships real server HTML, not an empty placeholder' },

  // --- Components ---------------------------------------------------------
  'cmp:control-flow': { area: 'components', desc: 'Show/For/Switch render and update reactively' },
  // NOTE: only the COMPILED path implements this. The runtime h()/automatic-JSX
  // path in dom.js never reads vnode.key and rebuilds every row on each change,
  // so this capability must be claimed by an app that runs what-compiler.
  'cmp:keyed-list': { area: 'components', desc: 'a keyed list reorders without recreating rows (compiled path)' },
  'cmp:error-boundary': { area: 'components', desc: 'ErrorBoundary catches a throw AFTER a state change, not just first paint' },
  'cmp:suspense-lazy': { area: 'components', desc: 'a lazy component shows its boundary\'s fallback where nothing is revealed yet; a navigation to one keeps the revealed content until it resolves' },
  'cmp:portal': { area: 'components', desc: 'Portal renders a modal outside its parent DOM position' },
  'cmp:head': { area: 'components', desc: 'Head sets document title and meta tags, server-rendered' },
  'cmp:inline-edit': { area: 'components', desc: 'a double-clicked cell edits in place: Enter commits, Escape cancels, derived values follow' },
  'cmp:svg': { area: 'components', desc: 'SVG elements created by compiled JSX are in the SVG namespace and follow their data' },

  // --- Animation ----------------------------------------------------------
  'anim:scroll-progress': { area: 'animation', desc: 'scroll position drives an animated value' },
  'anim:intersect': { area: 'animation', desc: 'onIntersect reveals elements as they enter the viewport' },
  'anim:spring-tween': { area: 'animation', desc: 'spring/tween animate a value over time' },
  'anim:transition': { area: 'animation', desc: 'an enter/leave transition runs on a mount/unmount' },

  // --- Forms & a11y -------------------------------------------------------
  'form:validation': { area: 'forms', desc: 'useForm rejects invalid input and surfaces field errors' },
  'form:submit': { area: 'forms', desc: 'a valid form submits and produces the expected result' },
  'form:wizard': { area: 'forms', desc: 'a multi-step form validates per step and keeps its answers across back/forward and a reload' },
  'a11y:ids': { area: 'a11y', desc: 'useId pairs a label with its input, stable across SSR and hydration' },
  'a11y:focus-trap': { area: 'a11y', desc: 'focus stays inside an open dialog' },
  'a11y:live-region': { area: 'a11y', desc: 'an announcement reaches a live region' },
  // --- Load: data volume, update rate, lifetime -------------------------
  'list:large': { area: 'load', desc: 'a summary derived over 10,000 rows is exact and follows sorts, filters and edits' },
  'list:virtual-scroll': { area: 'load', desc: 'scrolling 10,000 virtualized rows keeps the DOM bounded and shows the slice for the position' },
  'perf:budget': { area: 'load', desc: 'sort, filter keystroke, select-all, a 1,000-row bulk update and a scroll step over 10,000 rows each settle within a stated budget' },
  'stream:update-rate': { area: 'load', desc: 'the page takes 50 to 200 updates a second into signals and a store' },
  'stream:no-loss': { area: 'load', desc: 'every streamed update reaches the store, the derived views and a keyed list exactly once' },
  'lifecycle:unmount-cleanup': { area: 'load', desc: 'components unmounted while updates arrive release their subscriptions, timers, effects and bindings' },
  'perf:memory': { area: 'load', desc: 'the heap after a forced GC stays level over a long run of streaming and mount churn' },
  'perf:long-tasks': { area: 'load', desc: 'no main-thread task exceeds a stated bound while 200 updates a second arrive' },

  // --- Server under load: streaming, hydration of long pages, concurrency --
  'stream:ttfb': { area: 'server-load', desc: "a streamed page's first byte (the shell, with its fallbacks) arrives before its slowest query resolves" },
  'stream:out-of-order': { area: 'server-load', desc: 'a later Suspense boundary whose data is ready first streams first, and every boundary lands in its own place' },
  'route:query-pagination': { area: 'server-load', desc: 'the query string drives a paginated list on the server; a page out of range is a 404' },
  'render:hydration-adopts-long-page': { area: 'server-load', desc: 'a page of several thousand words hydrates with no node created, added or rewritten' },
  'island:input-before-hydration': { area: 'server-load', desc: "text typed into an island's form before hydration survives it" },
  'server:request-isolation': { area: 'server-load', desc: 'concurrent renders of different pages (cached and streamed) each carry only their own content' },
  'server:memory': { area: 'server-load', desc: "the server's heap after a full GC stays level across 2,000 requests" },

  'a11y:aria-enumerated': { area: 'a11y', desc: 'aria-* booleans serialize as "true"/"false", never empty or absent' },

  // --- Load: depth and size ---------------------------------------------
  'cmp:recursive': { area: 'load', desc: 'one recursive component renders a 10,000-entry tree nested 60+ levels deep; expand all, collapse all and a filter show exactly the entries they should, within a budget' },
  'lifecycle:dispose-at-scale': { area: 'load', desc: 'collapsing a 10,000-component subtree disposes every component, effect and binding it built, and the heap returns to its level' },
  'form:large': { area: 'forms', desc: 'a 300-field form validated as the user types runs only the edited field\'s rules and re-renders only that field, and a summary over every field follows' },
  'stream:reconnect': { area: 'load', desc: 'a stream from the app\'s own server, dropped cleanly, mid-event and all at once throughout the run, resumes from the last event id with no message lost or repeated' },
  'list:capped-log': { area: 'load', desc: 'an append-only keyed log of thousands of messages keeps its last N rows in order, follows the bottom (an effect after an append sees the new row), holds still while the reader is scrolled up, and an optimistic row keeps its element when the server confirms it' },
  'list:cross-parent-move': { area: 'load', desc: 'cards dragged with pointer events within and between keyed lists of 1,000 land exactly where the model puts them, one element per key; a move within a list keeps the element, undo and redo restore the exact order, and an untouched list keeps its elements' },
  'form:input-under-load': { area: 'forms', desc: 'typing into a controlled field while bursts of updates re-render the page around it loses no character and keeps the caret' },
  'form:async-validation': { area: 'forms', desc: 'answers of an async field check that arrive out of order never leave a stale error, and the form reports validating until the last one lands' },
};

/** Every app's declared coverage, checked against CAPABILITIES at run time. */
export function validateCoverage(apps) {
  const problems = [];
  const covered = new Map(); // capability -> [app names]

  for (const app of apps) {
    for (const id of app.covers) {
      if (!CAPABILITIES[id]) problems.push(`${app.name} declares unknown capability "${id}"`);
      if (!covered.has(id)) covered.set(id, []);
      covered.get(id).push(app.name);
    }
  }

  const uncovered = Object.keys(CAPABILITIES).filter((id) => !covered.has(id));
  for (const id of uncovered) {
    problems.push(`capability "${id}" (${CAPABILITIES[id].desc}) is not covered by any app`);
  }

  return { problems, covered, uncovered };
}

/**
 * A declared capability with no passing check is the failure mode this whole
 * file exists to prevent: a suite that reports coverage it never exercised.
 */
export function auditResults(apps, results) {
  const problems = [];
  const passedIds = new Set();
  const skippedIds = new Set();
  for (const r of results) {
    if (!r.passed || !r.capability) continue;
    (r.skipped ? skippedIds : passedIds).add(r.capability);
  }

  for (const app of apps) {
    for (const id of app.covers) {
      // A capability the browser cannot exercise is skipped with a reason
      // (reported with the run), not failed and not claimed as covered.
      if (!passedIds.has(id) && !skippedIds.has(id)) {
        problems.push(`${app.name} declares "${id}" but no passing check reported it`);
      }
    }
  }
  return problems;
}

export function coverageReport(covered) {
  const byArea = {};
  for (const [id, def] of Object.entries(CAPABILITIES)) {
    byArea[def.area] ??= { total: 0, covered: 0 };
    byArea[def.area].total++;
    if (covered.has(id)) byArea[def.area].covered++;
  }
  return byArea;
}
