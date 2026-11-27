# App smoke suite: findings

Three waves, in this order.

- **1 to 5** were found by building a real application and driving it in a
  browser.
- **6 to 11** came from adversarially reviewing the fixes for 1 to 5. Several
  are the same bug class one layer deeper, and one (9) is a regression the first
  round of fixes introduced.
- **12 to 17** came from a second adversarial round plus a differential fuzz.
  Two of them (16, 17) are regressions the *second* round introduced.
- **18 to 22** came from building the other three apps. The storefront is
  hand-written and uncompiled; the admin dashboard is a compiled Vite SPA, and
  putting the compiler in the loop exposed a whole second set. Three of these
  five exist only on the compiled path, which is the recommended one.
- **23** came from the load apps (data-grid, live-feed, workspace).
- **24 to 27** came from running every app in WebKit and from the two
  server-rendered load apps, `newsroom` and `workspace-ssr`. One (24) exists
  only in Safari, and one (26) only showed because a hydrated page compared
  the two compile targets.
- **30 to 34** came from three apps with loads the suite lacked: `explorer`
  (a 10,000-entry recursive tree beside a 300-field form), `chat` (a capped
  keyed log fed by a server stream that drops) and `board` (cards dragged
  between keyed lists). Four are in `useForm`, which no app had used at more
  than a handful of fields; one is the cost of every update to a capped log.
- **35** came from `handbook`, an app of code-split routes whose chunks the
  check delays, fails and overtakes, and from running every app in Firefox.

Each entry says what broke, why nothing caught it, and where the regression test
now lives.

The pattern is worth naming, because it decided the design of this suite. The
app-found bugs each needed **two features combined**: SSR *and* hydration *and* a
toggle; a query key *and* a signal *and* an invalidation. The unit suite covers
each of those alone and was fully green through all of them.

The review-found ones say something less comfortable: **a fix written from one
reproduction closes that reproduction, not the defect.** Three consecutive rounds
of hand-written adversarial cases each closed the shape in front of them and left
the class open, and two of those rounds shipped a new bug while doing it.

What finally closed the class was not a better reviewer but a different kind of
test: `hydration-parity-fuzz.test.js` generates 400 random trees, server-renders
each with one set of values, hydrates it with a different set, and asserts the
result is identical to a client-only render of the same tree. It knows nothing
about markers or cursors, so it cannot be satisfied by a narrow fix. Scored
against the same 400 trees:

| | divergent |
|---|---|
| 0.12.2 as published, under browser conditions | 186 / 400 |
| 0.12.2 with the dev-only correction forced on | 32 / 400 |
| after finding 5, before the second review round | 35 / 400 |
| this release | **0 / 400** |

The middle row is the one to keep in mind. The second round of hand-written fixes
made the aggregate slightly *worse* while every hand-written test stayed green.

---

## Fixed in this pass

### 1. Hydration discarded the client's value in every browser
`packages/core/src/render.js`

Correcting a text mismatch lived inside the dev-only warning branch, and dev mode
was decided by reading `process.env.NODE_ENV`. No browser has `process`, so the
check was false in the only environment where hydration runs, and the correction
never happened. The server's text stayed on screen until some later write
happened to touch that node.

Anything the server cannot know rendered stale: a cart restored from
localStorage showed 0 items, a saved theme showed the default, a relative
timestamp showed the build time. It self-heals on the next write, so it reads
like a broken store rather than a hydration bug.

Every test runs under Node, where `process` exists, so the whole suite took the
corrected path and saw nothing.

- Correction is now unconditional; only the warning is dev-gated.
- `isDevMode()` now returns `__DEV__`, which resolves correctly in browsers.
- Test: `packages/core/test/hydration-client-value.test.js` (deletes
  `globalThis.process` to reproduce the browser condition).

### 2. A hydrated `<Show>` broke position on the first toggle and died on the second
`packages/core/src/render.js`

The client render path wraps every reactive function child in `<!--fn-->` /
`<!--/fn-->` markers. The hydration path created none, which cost two things:

- `reconcileInsert` got a null marker, so it had no insertion point and appended
  to the END of the parent. A `<Show>` flipping arms teleported to the bottom of
  its container. (A component realizes to a `DocumentFragment`, and fragments
  deliberately skip the replace-in-place fast path, so this hit every
  component-valued region.)
- the effect's disposer was attached to the CONTENT node, so removing that
  content disposed the effect and the region stopped updating for good.

Client-only rendering was always correct, which is why nothing caught it: the
bug needs SSR **and** hydration **and** a toggle, and the suite covered each
separately. Symptom in the app: the cart's empty state never came back after
removing the last item.

- Hydration now inserts the same markers, keeps the cursor aligned, and hands
  the end marker to `reconcileInsert`. The disposer is idempotent because it is
  now reachable from three teardown routes.
- Test: `packages/core/test/hydration-reactive-region.test.js`.

### 3. `enhanceForms()` could not talk to its own endpoint
`packages/server/src/islands.js`

`<Form>` emits `data-enhance`, and `enhanceForms()` posted a `FormData` object,
which is multipart. `/__what_action` parses url-encoded or JSON and nothing else,
so the body failed to parse, the `_action` field went missing, and every enhanced
form answered 400. The no-JS path kept working, so the feature looked fine
wherever anyone tested it without scripting.

Also fixed alongside it: the CSRF guard blocked submission whenever the page had
no `<meta>` token. Cached pages (`static` / `hybrid`) deliberately carry no
per-visitor token, so a `<Form>` inside one could never submit.

- Enhanced posts now use the same encoding as the plain submit they replace.
- Token lookup falls back meta -> form field -> cookie.
- A followed 303 now navigates, cancellable via `form:response`.
- Test: `packages/server/test/enhance-forms.test.js`.

### 4. A query went permanently deaf to `invalidateQueries()` after its first refetch
`packages/core/src/data.js`

`useQuery` and `useSWR` subscribed to their key once, OUTSIDE the effect that
fetches, while that effect's cleanup unsubscribed. The effect re-runs whenever
the query function reads a changed signal, which is the entire point of a
reactive query key. So the first reactive refetch dropped the subscription and
never restored it.

The first invalidation, before any refetch, works. So a test that mounts a query
and immediately invalidates it passes, and only a query that has actually been
used goes deaf.

- The subscription now lives inside the effect and is re-established per run.
- Test: `packages/core/test/query-invalidation-lifecycle.test.js`.

### 5. Every fetch pinned the Node event loop for five minutes
`packages/core/src/data.js`

The cache-cleanup `setTimeout` was not unref'd, so any process that ran one query
stayed alive for a full `cacheTime` after finishing. Found because the new test
file passed and then hung.

- The timer is unref'd. It is opportunistic housekeeping, never work worth
  keeping a process alive for.

### 6. Empty reactive text destroyed its next sibling
`packages/core/src/render.js`

HTML cannot serialize an empty text node, so a reactive child rendering `''` on
the server emits nothing. The client claimed the next node anyway, found an
element where it wanted text, and REPLACED that element with an empty text node.
The server's real markup was discarded and every following sibling shifted,
cascading a warn-and-recreate through the rest of the parent. An `<input>` the
visitor had typed into before hydration was replaced and lost its value.

The first version of this fix only suppressed the WARNING, and only in the case
where nothing was left to claim. That was both too narrow and the wrong layer:
the adversarial review demonstrated that the destructive path was reached
whenever the empty region had any following sibling, which is most of the time.

- An empty string now claims a text node if one is there, and claims nothing
  otherwise, so it can never consume a non-text sibling. The bogus warning goes
  with it. What it declines to claim is then cleaned up after the walk (see 13).
- Test: `hydration-reactive-region.test.js` (the no-sibling case, the
  sibling-after case, and the server-rendered-value case).
- Deeper cause, still NOT fixed: `renderToString` emits no markers for a
  reactive region, so hydration has to *infer* the boundary of anything that
  serialized to nothing rather than being told it. Findings 6, 8, 13 and 16 are
  all consequences of that one absence. The inference is now exact enough to
  score 0/400 on the fuzz, but the durable fix is for SSR to emit the same
  `<!--fn-->` markers the client path uses. Tracked for 0.13.0; deliberately not
  done here because it changes every server-rendered byte.

### 7. Nested reactive regions interleaved instead of nesting
`packages/core/src/render.js`

Hydration claims the inner content first, so an inner region's markers went in
first, and anchoring the outer markers to the first CONTENT node put the outer
start marker INSIDE the inner pair. Switching the outer arm removed the visible
content but neither the inner markers nor the inner effect. The orphaned effect
kept rendering into a region that was switched off, and its output came back
doubled when the outer arm returned.

`<Show>` wrapping `<Show>` or `<For>` is the canonical shape, not an exotic one.
Found by the adversarial review of fix 2, not by the app.

- A region now opens its start marker BEFORE hydrating its value, so anything a
  nested region inserts lands inside it, and it owns everything between its
  markers rather than only the nodes its own value produced.
- Test: `hydration-reactive-region.test.js`, asserting PARITY with a client-only
  render of the same tree.

### 8. A region that rendered nothing lost its position permanently
`packages/core/src/render.js`

`<Show>` with no fallback, or `{cond && <X/>}`, claims no node, so both markers
were appended to the END of the parent. When the condition later flipped, the
content appeared below every following sibling, forever, with no warning. The
regression test written for fix 2 could not catch this, because a `<Show>` with a
fallback always produces a node.

- Markers now go in at the cursor position whether or not anything was claimed.
- Test: `hydration-reactive-region.test.js`.

### 9. `enhanceForms()` diverged from a native submit in six ways
`packages/server/src/islands.js`

Fixing the multipart-encoding bug (fix 3) overcorrected into urlencoded-always,
which silently dropped file uploads from forms that correctly declared
`enctype="multipart/form-data"`. That was a regression introduced by this work and
caught by the adversarial review before it shipped. Reviewing the rest of the
contract turned up five more divergences, all pre-existing:

- the CSRF token was sent to a cross-origin form action, handing this visitor's
  double-submit secret to a third party, and our token policy blocked cross-origin
  forms that were never ours to block
- a GET form serialized its fields and then discarded them, fetching a bare URL
- a field named `method` or `action` shadowed `form.method` / `form.action` with
  the input element (`HTMLFormElement` is `[LegacyOverrideBuiltIns]`), throwing
  after `preventDefault()` so the submit did nothing at all: no request, no
  `form:error`, no native fallback
- the submitter button's `name`/`value` was never sent, so a multi-button form
  could not tell the server which button was pressed
- newlines were sent as LF where a native urlencoded submit sends CRLF

Encoding now follows the form's own `enctype`, and the rest matches a native
submit. Redirect navigation is same-origin only.

- Test: `packages/server/test/enhance-forms.test.js`, 17 cases pinning the wire
  format against the real parser and handler.

### 10. `invalidateQueries()` was answered from the freshness window
`packages/core/src/data.js`

A query with a `staleTime`, or a `useSWR` inside its default 2s
`dedupingInterval`, returned cached data instead of refetching. Fix 4 restored the
subscription, but the subscriber it now reliably called still no-opped. The normal
sequence (mutate, then invalidate) sits well inside 2s, so this was the common
case, not the edge case.

- Invalidation now forces past the dedupe windows. Ordinary reactive refetches
  still dedupe.

### 11. Polling and retry timers kept Node processes alive
`packages/core/src/data.js`

Fix 5 unref'd the cache-cleanup timer; the sweep found the same class in three
more places. `refetchInterval` and `refreshInterval` arm intervals that are never
cleared outside a component lifecycle, so an SSR render leaked one per render and
kept calling the query function after the HTML had been sent. The retry-backoff
timer held the process for the full ladder. And every successful fetch armed a new
cleanup timer without clearing the last, accumulating pending timers at roughly
(fetch rate x cacheTime).

- All timers unref'd; the cleanup timer is replaced rather than accumulated.

### 12. No component using a hook could be server-rendered at all
`packages/server/src/index.js`

`renderToString` called `vnode.tag(props)` directly, with nothing on the
component stack. Every hook that needs a context resolves it through
`getCurrentComponent()`, so **all ten of them threw**, plus `Context.Provider`:

```
[what] useState() can only be called inside a component function.
```

`useState`, `useSignal`, `useComputed`, `useEffect`, `useMemo`, `useCallback`,
`useRef`, `useReducer`, `onMount`, `onCleanup`. One of them anywhere in the tree
and the page could not be server-rendered: not a hydration warning, not a
degraded render, `renderToString` threw. All three server render paths had their
own copy of the bare call, so `renderToHydratableString` and `renderToStream`
were broken the same way.

This is the largest gap the suite found and the one that had been there longest.
Nothing caught it because SSR tests render plain element trees and hook tests
mount on the client: the two features are only broken *together*, which is the
shape every bug in this class has had. It was found while trying to write a
regression test for finding 15, when `onCleanup` in a server-rendered component
threw instead of the test failing the way it was supposed to.

- Components now run under a real context (`_beginComponentSSR` /
  `_endComponentSSR`), on all three paths. The frame stays open while the
  subtree renders, because `useContext` resolves by walking parent contexts, and
  is closed in a `finally` so a throwing component cannot strand it.
- The context is marked disposed on the way out, so the deferred work every hook
  queues (`useEffect` in all three of its dep shapes) sees `ctx.disposed` and
  never runs. An SSR render leaves no live effects behind.
- Test: `packages/server/test/ssr-component-context.test.js`, 21 cases: one per
  hook, one per render path, context resolution and nesting, effect and onMount
  suppression, and frame unwinding after a throw.

### 13. An empty region left the server's content stranded on screen
`packages/core/src/render.js`

The other half of finding 6. An empty region correctly refuses to claim a
non-text node, which means whatever the server rendered in its place is left
behind: no effect owns it, no update can reach it, it simply stays visible. The
server's signed-in header stayed on screen for a signed-out visitor, underneath
the region that was supposed to have replaced it.

Fix 6 traded this in to stop the region destroying its siblings. Both are
avoidable, because they are questions asked at different times: the walk cannot
know whether a node belongs to this region or the next sibling, but once the
walk has *finished*, any node it never claimed is unreferenced by definition.

- Hydration now removes unclaimed nodes after the walk, per element and at the
  root. Never during it.
- Two exclusions, both because the walk does not own the subtree: an element
  whose client tree declares no children (an island renders a bare host and
  fills it in later, from that same server HTML, and a `mode: 'static'` island
  never hydrates at all), and `dangerouslySetInnerHTML`. `<body>` and `<html>`
  are excluded at the root, because scripts and the hydration payload live there
  and are never claimed by anyone.
- Test: `packages/core/test/hydration-server-leftovers.test.js`.

### 14. Every inline SVG went blank on hydration
`packages/core/src/render.js`

`nodeName` is uppercased for HTML elements but case-preserved for everything
else, so an `<svg>`'s `nodeName` is `svg` and could never equal
`tag.toUpperCase()`. Every inline SVG on a server-rendered page failed to match,
warned `expected <svg>, got svg`, and was destroyed. The rebuild then used
`document.createElement`, which lands in the XHTML namespace and does not render
as SVG at all, so icons, logos and charts disappeared on hydration.

The warning text is the tell: nobody had read it, because the correction it
belongs to was unreachable in browsers until finding 1 was fixed.

- The comparison is case-insensitive, so a matching SVG is reused.
- The mismatch fallback now goes through `createDOM`, the same path a
  client-only render uses, so a rebuild is namespace-correct and sets attributes
  rather than properties. "Falling back to a client render" now means the client
  render rather than an approximation of it.
- Test: `hydration-server-leftovers.test.js`.

### 15. A component disposed itself the first time its own root updated
`packages/core/src/render.js`

Hydration has no comment markers for a component, so its context is anchored to
a DOM node in order to be reachable for disposal. It was anchored to the first
node the component produced, and if the component's root is a reactive region
that node is the region's current *content*, which the region replaces on its
first update. `disposeTree` then ran over it and took the whole component
context with it: every effect, cleanup and `onCleanup` died while the component
was still mounted.

A hydrated component that polls, subscribes, or holds a query went silent the
first time its own root re-rendered. This is the same create-outside,
dispose-inside-an-effect shape that finding 2 removed, four lines below the code
that fixed it.

- A region root anchors to the parent element instead. That disposes later than
  ideal, when the parent goes rather than when the component does, and disposing
  late is strictly better than disposing while mounted.
- Test: `hydration-reactive-region.test.js`.

### 16. A region could never remove content it created itself
`packages/core/src/render.js`

Introduced by the fixes for 7 and 8, caught by the review of them. When the
server rendered nothing for a region and the client renders something, the
content is created rather than claimed. The mismatch fallback appended it to the
end of the parent while leaving the cursor pointing at it, so the region's end
marker was then inserted *before* its own content. The region owned nothing and
could never take the content back: switching the condition off left it on screen
permanently, with no warning.

The finding-8 test could not catch this, because it has a trailing sibling for
the content to displace, which lands it inside the markers by accident. The bug
needs the region to be the last thing in its parent.

- All three mismatch fallbacks insert at the cursor and advance it, instead of
  appending past it.
- Test: `hydration-reactive-region.test.js`.

### 17. `invalidateQueries()` fanned out into one request per subscriber
`packages/core/src/data.js`

Introduced by the fix for 10, caught by the review of it. Forcing past the
"dedupe window" forced past two different mechanisms that share a name and a
map. Bypassing the freshness window is correct. Bypassing request *coalescing*
is not: every component reading a key subscribes separately, so one
`invalidateQueries()` call arrives at N subscribers, and the in-flight map is
what collapses those into one request. Four components on one key issued four
concurrent fetches whose responses then raced to write the cache.

Sequencing the two on `Date.now()` was not enough either. It has 1ms resolution,
so a refetch and an unrelated invalidation issued microseconds apart share a
timestamp and the invalidation was answered by the request that predated the
mutation. That surfaced as a 1-in-6 test flake before it surfaced as a bug.

- Invalidation bumps a per-key epoch before waking anyone. A forced revalidate
  joins an in-flight request only if that request started in the current epoch,
  so siblings coalesce and a pre-invalidation request never answers. A counter
  has no ties.
- Test: `query-invalidation-lifecycle.test.js` (fan-out, ordering, and that
  ordinary refetches still dedupe).

### 18. A compiled keyed list rendered empty on the server and crashed on hydration
`packages/core/src/render.js`, `packages/server/src/index.js`

`.map()` with a `key` prop, and `<For>`, lower to a mapArray **inserter**: a
function taking `(parent, marker)`, not a thunk returning a value. Neither
hydration nor SSR had a branch for it, so both fell through to the generic
reactive-child branch and called it with no arguments.

- On the server, `parent.insertBefore` threw on `undefined`, SSR swallowed the
  error, and the container rendered **empty**. A compiled app served HTML with
  no list rows in it: nothing for a crawler, nothing painted before the bundle
  arrived.
- On the client the same throw escaped `hydrate()`. Not one list: **the whole
  page stopped hydrating and stayed inert.**

This is the ordinary shape for a compiled app. The server renders through
runtime `h()` (plain arrays), the client bundle is compiled (mapArray
inserters), and they meet at hydration. Nothing covered it because the compiled
path is tested by mounting and never by hydrating, and the SSR tests never see
compiled output.

- Hydration builds the list's rows and lets the walk's trim (13) remove the
  server's. That is a missed reuse, not a correctness problem, and reusing them
  needs the list's boundary markers in the server HTML, which is the same thing
  regions need (tracked for 0.13.0).
- SSR renders the rows from the inserter's inputs, honoring the same item
  protocol the client uses (keyed non-raw hands the mapFn an accessor,
  everything else the raw item), and stays fail-soft so one bad row cannot blank
  the response.
- Test: `packages/core/test/hydration-keyed-list.test.js`.

### 19. A reactive region lost its owning component on every re-run
`packages/core/src/render.js`

The effect behind `{() => ...}` re-runs long after the synchronous render that
created it, with the component stack unwound, so everything it built on a re-run
got `parentCtx = null`. That severs the chain two separate lookups walk:

- `useContext` fell through to the context **default** for anything rendered
  after a state change, so a themed or session-scoped value silently reverted on
  every route change.
- the ErrorBoundary and Suspense lookup found nothing, so a throw from a
  component created by an inner region escaped the boundary wrapping it.

Both are correct on first paint and only break once the app is interactive,
which is the worst timing to notice: the page looks right, then a click makes
context quietly wrong.

`dom.js` was given this fix, with a comment naming these exact casualties.
`render.js`'s `insert()`, which is the path the **compiler** emits for every
reactive expression, was not. So it was broken for precisely the users on the
recommended build setup.

- Both region effects (`insert` and the hydration branch) capture the owner at
  creation and re-push it for the duration of each re-run.
- Test: `packages/core/test/region-owner-chain.test.js`, asserting both
  consequences on both paths.

### 20. The compiler called every destructured prop as a signal
`packages/compiler/src/babel-plugin.js`

`collectSignalNamesFromScope` classifies every destructured prop name as a
signal. That is right for deciding an effect is needed and wrong for deciding to
**call** it. `_$createComponent` passes plain values, so

```jsx
function Badge({ label }) { return <span data-label={label}>{label}</span>; }
```

compiled to `setAttr(el, 'data-label', label())` and threw `label is not a
function` on any ordinary string prop, rendering **nothing at all** for the
component and everything under it. The same identifier as a *child* compiled to
`() => label`, uncalled, so the two positions disagreed inside a single element:
the text worked and the attribute killed the component.

Found by a `<Stat>` card that blanked an entire dashboard page.

- Prop-derived names are tracked separately and passed through uncalled. The
  runtime setters (`setAttr`, `setClass`, `setValue`) already resolve a function
  value reactively, so this is correct whether the parent passed a plain value
  or an accessor. Names from a real `signal()` still auto-invoke.
- Test: `packages/compiler/test/compiled-output-runtime.test.js`, covering the
  plain-value case, the accessor case (fixing this by *never* calling would be
  equally wrong), the real-signal case, and the keyed-list shape that found it.

### 21. Every guarded route logged a false redirect cycle in Chromium
`packages/router/src/index.js`

One guarded deep link produced 25 `[what-router] Redirect cycle detected`
errors and a flash of the redirect-loop screen. `navigate()` sets
`_isNavigating` immediately but defers the `_url` write into
`document.startViewTransition`, and `renderMatch` reads `_isNavigating`. So the
flag flip re-ran the match against the still-old URL, the same middleware
returned the same target, and the hop was counted twice. The detector then
cleared `_isNavigating` and `_pendingUrl` while the real navigation was still in
flight, corrupting router state mid-navigation.

Chromium-only: without the View Transitions API, `doNavigation()` runs
synchronously and the URL and the flag change together. Deleting
`Document.prototype.startViewTransition` in the same app dropped it to zero
errors with an identical final URL.

- A redirect to a target that is already `_pendingUrl` is a re-match of the same
  hop, not a second one, and no longer counts toward the chain.

### 22. An interrupted view transition surfaced as an uncaught page error
`packages/router/src/index.js`

`navigate()` awaited only the transition's `.finished`. Its `.ready` rejects
whenever the transition is skipped, which two navigations in quick succession do
routinely, and with no handler that became an unhandled rejection: `pageerror:
Transition was skipped`, landing in whatever error reporter the app installed,
for a navigation that actually succeeded.

- `.ready` now has a no-op catch. The navigation still awaits `.finished`.

---

### 23. A route layout was built again on every navigation
`packages/router/src/index.js`, `Router` (`renderMatch`)

Found by the `workspace` app. The wizard's three steps share one layout through
`nestedRoutes('/new', [...], { layout: WizardLayout })`. Moving from one step to
the next disposed the layout and built a new one: its state (a tips panel the
visitor closed) was back to its default, its DOM nodes were new, and anything
typed into it was gone. The router README's own nested-layout example did the same:

```jsx
function DashboardLayout({ children }) {
  const [clicks, setClicks] = useState(0);
  return <div><button onClick={() => setClicks((c) => c + 1)}>clicks {clicks()}</button><main>{children}</main></div>;
}
const routes = nestedRoutes('/dashboard', [
  { path: '/', component: Home },
  { path: '/settings', component: Settings },
], { layout: DashboardLayout });
// click twice, then follow the Settings link: the button says "clicks 0" again
```

React Router's `<Outlet>` layouts and Next.js layouts stay mounted while the
child route changes, so code ported from either loses state here. The
`globalLayout` persisted by design; route layouts were wrapped around the page
inside the reactive `content` region, so they rebuilt whenever the page did.

Development made it harder to see: it reported `ERR_REBUILT_COMPONENT` against
the code that renders the region, which was the router's internal `content` or
the app's own `<main>{children}</main>` in its `globalLayout`, neither of which
the developer could change to fix it.

- The Router builds the layout chain in a region of its own, which builds
  again only when the chain of layouts, the params or the query change; the
  page is the innermost layout's reactive child. A route with no layout, a
  404 and a page its middleware declines render as before.
- The route a URL matches is made once per URL, so the route state written
  from it is the same objects on both reads and runs no middleware twice.
- Test: `packages/router/test/nested-layout-persists.test.js`; the
  `workspace` check "the wizard layout stays mounted, with its state, while the
  steps change under it".

### 24. FocusTrap let Tab carry focus out of the dialog in Safari
`packages/core/src/a11y.js`

The first WebKit run failed both focus-trap checks: ops-console
`escaped=2`, workspace `inside=0010011`. The trap stepped in only at its
first and last element and left every other Tab to the browser. Safari's
default Tab reaches form fields only, not buttons or links, so from the last
field the browser's next stop was outside the dialog. Chromium tabs through
buttons, which is why every earlier run was green.

- The trap now makes every Tab and Shift+Tab move itself, through its own
  list in document order, wrapping at both ends.
- Test: `packages/core/test/a11y.test.js`, "useFocusTrap makes every Tab move
  itself…".

### 25. A form post's `_redirect` dropped its fragment
`packages/server/src/action-handler.js`

newsroom's comment form posts without JavaScript with
`_redirect=/article/<slug>#comments`, and the visitor landed at the top of the
article. The README says `redirect()` keeps the fragment by the same rule as
`_redirect`; `redirect()` kept it and `_redirect` did not. The fragment is now
kept after the same safety check (it never reaches a server, so it cannot
leave the origin).

- Test: `packages/server/test/csrf-form-actions.test.js`, "keeps the fragment
  of _redirect…".

### 26. A valueless `aria-*` or `data-*` attribute differed between the two compile targets
`packages/compiler/src/babel/dom.js`

workspace-ssr's `<span data-user>` arrived from the server as
`data-user="true"` and was `data-user=""` after hydration. The DOM target's
template wrote a valueless attribute as empty; the SSR target and both runtimes
write `aria-*` and `data-*` `true` as `"true"`, as React does. The serious
half is `aria-hidden`: `aria-hidden=""` is no value in ARIA, so a compiled
client render of `<span aria-hidden>` stayed visible to assistive technology.
Hydration took the client's value without a report (G below), which is why
nothing caught it.

- The DOM template writes a valueless `aria-*`/`data-*` attribute as `"true"`.
  A client-only app that compared `dataset.x === ''` now sees `'true'`;
  `[data-x]` selectors match as before.
- Test: `packages/compiler/test/valueless-enumerated-attr.test.js`.

### 27. Following the README's ISR wiring turned streaming off
`packages/server/README.md`

The example passed `createRouteRenderer(document)` to `createRequestHandler`
as well as to the ISR engine. A handler given any `render` renders
`mode: 'server'` routes buffered: newsroom's first byte went from 26 ms to
1,204 ms, the time of its slow query. The example now gives the renderer to
the engine only and says why.

### 28. A guard's re-check redirect replaced a navigation the app started after it
`packages/router/src/index.js` (`prepare`)

A route's middleware runs again when a signal it read changes. An app that
wrote that signal and then navigated away in the same tick (reset the draft,
then go to the created project; sign out, then go to sign-in) lost its
navigation: the re-check of the page being left redirected, and the redirect
superseded it. workspace-ssr's wizard landed on step one instead of the new
project. The page being left now keeps its verdict while a navigation to
another page is in flight, and decides again when that navigation ends, so a
navigation that never commits still gets the guard's redirect.
- Test: `packages/router/test/guard-recheck-supersedes-navigate.test.js`.

### 29. Hydration took the client's attribute without a report
`packages/core/src/render.js` (`watchAttrs`, `checkAttrs`)

Where the server's attribute differed from the client's, hydration kept the
client's, as SECURITY.md says, and nothing said so: 26 went unseen because
of it. Development now reports each one as an `ERR_HYDRATION_MISMATCH` of
kind `attribute` once the walk is done (onHydrationError hears the same
records as before, in every build). Run over the five server-rendered apps
in development, 18 pages: none.
- Test: `packages/core/test/hydration-attribute-mismatch.test.js`.

### 30. A summary above a form's fields never followed them
`packages/core/src/form.js` (`fieldCount`)

`formState.values`, `watch()`, `dirtyFields` and `formState.touched` read the
field signals that existed when they ran. A summary rendered above its fields
runs before any field is registered, so it subscribed to none of them and
showed the defaults: explorer's total budget stayed at 5,285 KB through every
edit, until the scope field (registered above it) changed. `touched` read
before the first blur never updated at all. A field or touched signal that
register, setValue or a blur makes now bumps a count those readers read.
- Test: `packages/core/test/form-whole-form-readers.test.js` (5 of 6 fail
  before).

### 31. `rules.min` and `rules.max` never fired on a number field
`packages/core/src/form.js` (`rules`)

A registered `<input type="number">` hands the form a string, and both rules
checked `typeof value === 'number'`. A budget of `"0"` against `rules.min(1)`
passed. A numeric string is now compared as the number it spells; a blank or
non-numeric one is still left to `required` and `pattern`.
- Test: `packages/core/test/form-number-rules.test.js`.

### 32. An async check's slow answer replaced the answer for what the field held
`packages/core/src/form.js` (`validate`)

`useForm` applied each resolver answer as it landed. Typing `core-ui` past
`core` (taken, and slower to look up) showed "@core is taken" on `core-ui`,
and the first answer to land cleared `isValidating` while three lookups were
still out. Runs are numbered now: an answer lands only when no later run of
its field, or of the whole form, started before it, and `isValidating` holds
until the last one lands.
- Test: `packages/core/test/form-async-validation-order.test.js` (4 of 5 fail
  before).

### 33. A keystroke ran every field's rules
`packages/core/src/form.js` (`validate`, `simpleResolver`)

In `mode: 'onChange'` each keystroke handed the resolver every value and kept
one field's answer: explorer counted the rules of all 301 fields per
keystroke, and the slow registry check on the scope delayed every field's
error (54 ms for a version typo, against 1 ms after). A field's own
validation now passes `{ names: [field] }`, React Hook Form's resolver
option, and `simpleResolver` runs only those fields' rules.
- Test: `packages/core/test/form-field-validation-scope.test.js`.

### 34. Every update to a capped log rebuilt the reconciler's map of keys
`packages/core/src/render.js` (`slideRows`)

A log capped at N rows drops a row at the start as each message arrives at
the end; a newest-first feed does the mirror. Both took the general path on
every update: a single-move probe that scanned every key, a map of the old
keys and a walk of every row. chat's bursts of 400 messages into 1,000 rows
made a 73 ms task each (Chromium, profiled; reconcile 115 µs a message). A
capped log that slid now has its dropped rows removed and its added items
built, by item identity, inside the only-removals path, which declines
whenever the general path would claim rows differently; the mirror keeps
the general path, which costs it no rows. After: about 45 µs a message, no
task over 50 ms, for 144 B gzip.
- Test: `packages/core/test/reconcile-slide.test.js` (the key-read count fails
  before: 3,020 reads for a slide of one row of 1,000).

### 35. Hovering a link did not download its lazy route's chunk
`packages/router/src/index.js` (`prefetch`)

`<Link>` prefetches on hover by default, and `prefetch(href)` is documented
as prefetching "a route's assets". It added `<link rel="prefetch" href>`
for the URL, which in a client-routed app fetches the HTML page again, not
the route's code, so the click still waited for the `lazy()` chunk.
handbook hovered a chapter's link for a second, then clicked: 818 to 841 ms
to the page, for a chunk the network took 800 ms to serve. prefetch now
also starts the chunk of the route the outermost Router matches; a route
behind middleware is left to the navigation, which downloads it only once
admitted, so a guest hovering a guarded link downloads nothing. After: the
chunk is requested on hover and the click shows the page in 5 to 23 ms
(Chromium, WebKit, Firefox).
- Test: `packages/router/test/lazy-route-prefetch.test.js` (3 of 4 fail
  before).

## Reported, not fixed

### A. The runtime path has no keyed reconciliation at all
`packages/core/src/dom.js`

`dom.js` never reads `vnode.key`. The reactive function-child branch disposes and
rebuilds every node on every list change. Keys only work on the COMPILED path,
where the plugin lowers `.map()` / `<For>` to `mapArray`.

Consequences for a buildless app, which is exactly what `create-what --template
fullstack` generates:

- every list row is recreated on any change: focus is lost, an open `<details>`
  closes, CSS transitions restart, and the cost is O(n) DOM churn per update
- `For`'s auto-key logic in `components.js` (`item.id` / `item.key`) is dead code
  on this path
- `<For each={...} key={fn}>` silently ignores `key`: the runtime `For` does not
  even destructure the prop

I prototyped honoring `key` in the runtime `For` and reverted it: setting
`vnode.key` changes nothing while `dom.js` ignores it, and shipping an inert prop
is worse than an absent one. The real fix is keyed reconciliation in the
`dom.js` function-child branch. It cannot import `render.js`'s reconciler
(`render.js` already imports `dom.js`), so this is a deliberate piece of work,
not a patch.

Until then `cmp:keyed-list` is claimed only by a compiled app.

### B. `<For>` hands over different things on the two paths
`packages/core/src/components.js` vs `packages/core/src/render.js`

- compiled: `<For key={...}>` lowers to `mapArray`, which passes a **signal
  accessor** (`item()`).
- runtime: `For` passes the **raw item** (`item`).

So the same JSX behaves differently depending on whether the compiler ran, and
`CLAUDE.md` documents only the compiled behavior. Code written against one path
throws on the other. Picking one is an API decision, so it needs your call.

### C. Server actions cannot set response headers

`action-handler.js` owns its response headers, so an action cannot issue a
`Set-Cookie`. Sign-in therefore cannot be an action, and the storefront uses a
plain `/api/login` endpoint for it. That is a defensible design, but it is
undocumented and the first thing anyone hits when wiring auth.

### D. A `<Form>` on a cached page cannot work without JavaScript

Cached HTML (`static` / `hybrid`) is shared between visitors, so the adapter
deliberately does not embed a per-visitor CSRF token in it. A `<Form>` there has
no token to submit and the double-submit check rejects the post when scripting is
off. The design is right; the trap is that nothing says so. `<Form>` warns on the
SERVER console at render time, which is not where the developer is looking.

The storefront works around it by putting the review form on `/review`, a
`mode: 'server'` page. Worth either documenting loudly or having `<Form>` detect
a cached render and say so.

### F. ISR tags are per route

`page.tags` is static and the built-in renderer stores it as is, so a loader
cannot tag one entry (`article:<slug>`): a comment on one article revalidates
every article. A per-entry tag needs a custom `render`, which turns off
streaming for the handler's server routes (27).

### G. A keyed component row whose body reads its item is rebuilt on every replacement

Fixed. A row component is handed its item as a getter over the row's item
cell with no field named (`get item() { return _$item(cell); }`), so a read
in the component's body (`const id = item.id`, beside a hook or a cleanup)
recorded the whole item, and any replacement of the item under its key
rebuilt the row with its state. chat found it (a pending message replaced by
the server's echo lost its element); in board, a column written `const id =
column.id; onCleanup(...)` rebuilt both columns and all 400 of their cards on
one move between them. A member read of a prop in a component's run
(`props.item.id` or a destructured `item.id` in the body or in a function of
it, `<Title text={item.title} />` handed to a child) now compiles to
`_$propField(props, "item", "id")`, which records the field `id` when the
getter returns the row's item itself, and the whole item when it returns
something made from it. A read of the whole item (a method call, handing it
to a function, destructuring it) still rebuilds the row on any replacement,
as API.md says. `packages/compiler/test/row-component-item-reads.test.js`
pins the cases.

### H. Recursion depth: a recursive component overflows the stack near 300 levels in Chromium

Each level of a recursive component holds its frames while the levels below
it are built. A keyed file tree (a component that renders a keyed list of
itself behind a condition) held 21 frames a level and overflowed near 210
levels in Chromium; it now holds 17 (counted with `new Error().stack` in the
production build): `insert()` starts a reactive child's effect itself, a
row's callback runs straight from its item scope, and the row of an empty
list stands on a small reconcileKeyed frame, the general path, with its
dozens of locals, being a function of its own. Deepest tree that builds:
Chromium 210 -> 302 levels, WebKit 1,801 -> 2,135, Firefox 350 -> 454. The
branch that overflows renders nothing and logs `RangeError: Maximum call
stack size exceeded`; the rest of the page keeps working. File trees and
comment threads stay far below; a JSON viewer of a deeply nested document
may not. What is left is a frame per function boundary that does work (the
component's owner and run, the region's and the list's effects, the row's
scope, the compiled callbacks). `packages/core/test/recursion-depth.test.js`
counts frames per level, and explorer pins 101 levels.

### I. A `lazy()` component whose download failed can never load again in that page

`lazy()` keeps the error of a failed download and throws it on every later
render, as React's `lazy` does. So a route's error page cannot recover in
place: its `reset` ("Try again") builds the page again and gets the same
error, and so does a later visit, until the page is loaded again. The
browsers do not require that: after a failed `import()`, a second `import()`
of the same URL in the same page downloads it again in Chromium, WebKit and
Firefox (measured with page routing aborting the first request). A chunk
lost to a network blip, or replaced by a deploy, is the common case of a
failed download. handbook's error page reloads the page to try again.
- Failing test, not in the tree: `lazy-retry.test.js` in the round 5
  Firefox lane's `keep/` (3 of 4 fail): a reset downloads again and shows
  the page, a retry that fails again downloads nothing more on its own, a
  component rendered again later downloads again.
- Why not fixed: whether to differ from React here, and how a navigation
  that meets a failed chunk should retry (keep the old page while it
  downloads again, as a first visit does), is a design decision.

## The load apps: what they measured

`data-grid`, `live-feed` and `workspace` were added to find what only shows
under volume and rate. Apart from 23, the framework met every bound they set, in
headless Chromium on an M-series Mac:

| measure | bound | measured (median) |
|---|---|---|
| sort 10,000 rows (virtualized) | 100 ms | 4 ms |
| filter keystroke over 10,000 rows | 50 ms | 1 ms |
| select-all / deselect-all, 10,000 rows | 100 ms | 1.4 ms |
| bulk update of 1,000 rows | 100 ms | 2 to 3 ms |
| scroll step | 50 ms | 2.5 ms |
| longest main-thread task at 200 updates/s | 100 ms | none over 50 ms |
| heap after GC over 15 s of streaming and mount churn | +1 MiB | +68 KB |

Two things that looked like defects and were not:

- **Sorting 10,000 fully rendered keyed rows takes 300 ms or more.** Measured
  without virtualization in a separate probe. The reconciler makes 9,784
  `insertBefore` calls (10,000 minus the longest increasing subsequence) taking
  38 ms in total; the rest is Chromium restyling and laying out a 10,000-row
  table, and a hand-written DOM permutation of the same table costs the same.
  It is the reason to virtualize, not a framework cost.
- **A store field read bare (`value={grid.query}`, `{f.n}`) stays live**,
  though API.md says the compiler cannot tell a store field is reactive and a
  bare read is evaluated once. what-compiler reads the imported module, sees
  `createStore`, and wraps the read; only when it cannot see the module (a
  store from a package it does not analyse) is the read once. The thunk form
  the docs recommend works in both cases, so code written either way is right.

### The server-rendered load apps

`newsroom` and `workspace-ssr` (Chromium and WebKit, same results):

| measure | bound | measured |
|---|---|---|
| first byte of the streamed front page | before the 1,200 ms query | 23–30 ms |
| fast boundary (later in the page) vs slow boundary | fast first | 144 ms vs 1,223 ms |
| 3,282-word article hydration | 0 nodes created, added or rewritten; 0 reports | 0 / 0 / 0; 0 |
| the article and its five islands, woken and used | 0 nodes created | 0 |
| 50 cold ISR articles + 50 streamed front pages at once | each only its own content | 100 / 100 |
| 40 workspace visitors at once, own cookies | each only their own user, draft, step | 40 / 40 |
| server heap after GC over 2,000 requests | under 4 MiB growth, not rising every sample | +320 KB (18.02 → 18.33 MB) |

### Depth, size, streams and drags

`explorer`, `chat` and `board` (Chromium / WebKit, M-series Mac):

| measure | bound | measured |
|---|---|---|
| expand all: 10,000 components, 101 levels deep | 4,000 ms | 150 / 160 ms |
| collapse all: dispose them | 2,000 ms | 22 / 33 ms |
| filter keystroke over 10,000 entries | 1,500 ms | 3 / 3 ms (first: 27–75 ms) |
| heap after GC over three expand/collapse cycles | +2 MiB | +63 to +108 KB |
| an edit in a 300-field form (error and summary shown) | 50 ms | 0–1 ms |
| messages received exactly once across ~12 dropped streams | exact | 11,000–20,000 / all |
| 99th-percentile frame at 600 messages/s plus bursts of 400 | 400 ms | 33 / 98 ms |
| heap after GC while 5,000 more messages pass the 1,000-row log | +1 MiB | +12 to +18 KB |
| a drop (pointer release to the card in place) | 100 ms | 16 / 1 ms |
| an undo or redo (key to the card in place) | 100 ms | 13 / 12 ms |

### Code-split routes

`handbook` (Chromium / WebKit / Firefox, M-series Mac), timed in the page
from the click event to the mutation that shows the page:

| measure | bound | measured |
|---|---|---|
| first visit, chunk delayed 700 ms: the page being left stays, marked busy | no empty or fallback frame | 729 / 713 / 699 ms, none |
| revisit, chunk already here | 150 ms, no request | 14 / 15 / 4 ms |
| hovered for a second, then clicked, chunk delayed 800 ms | 250 ms | 22 / 17 / 5 ms (818–841 ms before 35) |
| a navigation overtaken by a newer one, 1,500 ms chunk | never shown; one history entry | 0 builds; +1 |
| a chunk that fails: the route's error page, then the next link | no uncaught error | 32 / 17 / 11 ms; 52 / 15 / 17 ms |
| back three, forward three through loaded chapters | 150 ms each, no request | 1–8 ms, 0 requests |
| 24 navigations between loaded chapters | 150 ms (95th percentile) | 20 / 18 / 11 ms |

## Browsers

`WHAT_SMOKE_BROWSER=webkit npm run smoke:apps` runs every app in WebKit. The
heap check is Chromium's alone (it forces a GC through the devtools
protocol) and is skipped elsewhere with that reason; the long-task check uses
the Long Tasks API in Chromium and a timer's lateness elsewhere. Two real
browser differences an app has to allow for showed up:

- Safari's default Tab reaches form fields only, not buttons or links (24).
- Safari does not focus a button when it is clicked, so a keydown handler on
  a menu's container never hears Escape after a click. newsroom's share menu
  listens on the document while it is open.

### Firefox

Every app passes in Firefox (`WHAT_SMOKE_BROWSER=firefox`), with the heap
checks skipped as in WebKit: Firefox has no devtools protocol in Playwright
to force a GC. Three things in the checks held only in Chromium and WebKit,
and none is a framework defect:

- Firefox waits at least 500 ms before reopening an `EventSource`, whatever
  `retry:` the server sends (measured: `retry: 150` reopens after 150 to
  165 ms in Chromium and WebKit, 504 to 539 ms in Firefox). chat's 12 s run
  reconnected 8 times instead of the 10 it asks for; the run now goes on
  until ten reconnects, up to 30 s.
- A `Secure` cookie set by a plain-http page is refused by every browser;
  Firefox also logs it as a console error. The workspace examples run in
  production, whose CSRF cookie is `Secure`, and were served at
  `http://workspace.test`: the cookie was silently dropped in Chromium and
  WebKit, and failed three examples on the console error in Firefox. They
  are served at `https://workspace.test` now, where it sets in all three.
- With JavaScript off, opening an article again in the context that has just
  posted a comment to it makes Firefox load it twice (the second request a
  revalidation), and Playwright waits for the second load to commit until it
  times out, in about half the runs. newsroom's refused post starts from a
  fresh context.

And one in WebKit, seen under Playwright's request routing only: a chunk
whose download failed is not requested again after a reload, so the
reloaded page fails the import with no request. handbook skips its reload
retry in WebKit with that reason.

