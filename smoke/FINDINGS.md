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
