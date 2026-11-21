# Async values

An async value is a node of the reactive graph, like a signal or a computed.
`computed(fn)` takes a function that may return a promise, a thenable or an
async iterable. What reads it waits for it the way it would wait for any other
input. `<Suspense>`, `<ErrorBoundary>`, transitions and optimistic updates are
built on that. The names are React's (`startTransition`, `useTransition`,
`useOptimistic`, `use`). Most of the semantics are Solid 2.0's. Where they
differ from Solid's, it is because What keeps a read right after a write fresh
(see [Limits](#limits)).

```jsx
import { signal, computed, refresh, Suspense, ErrorBoundary } from 'what-framework';

const userId = signal(1);
const user = computed(({ signal }) =>
  fetch(`/api/users/${userId()}`, { signal }).then((r) => r.json()));

function Profile() {
  return (
    <ErrorBoundary fallback={({ error, reset }) => <button onClick={reset}>{error.message}: retry</button>}>
      <Suspense fallback={<p>Loading…</p>}>
        <h1 class={user.pending() ? 'stale' : ''}>{user().name}</h1>
        <button onClick={() => refresh(user)}>Reload</button>
      </Suspense>
    </ErrorBoundary>
  );
}
```

Each guarantee below names the tests that pin it. They are in
`packages/core/test/` unless the path says otherwise.

The data layer is built on these values: one query cache whose entries are
async values (`query(key, fetcher)` and the `useQuery`/`useSWR` hooks), React
19's `useActionState`/`useFormStatus`, server actions that revalidate inside
their transition, and router navigations that are transitions. It is
described in [DATA.md](DATA.md).

## The surface

| Name | What it does |
|---|---|
| `computed(fn)` | A computed whose function may return a promise, a thenable or an async iterable. A function that declares a parameter gets `{ signal }`, the AbortSignal of its run. |
| `c.pending()` | True while `c` has a value and is fetching a newer one. Tracked. |
| `c.peek()` | The last value that landed (undefined before the first). Never throws, never waits. |
| `refresh(c)` | Fetch again now. Resolves with the value of that run, rejects with its error. |
| `isPending(fn)` | Whether an async value that `fn` reads, directly or through computeds, is fetching a newer value. Tracked. |
| `startTransition(fn)` | Holds what `fn`'s writes reach on screen until the async work they started has landed, then commits it in one flush. Returns a promise of the commit. |
| `useTransition()` | `[isPending, startTransition]`. `isPending` is an accessor: call it. A rejected action shows in the `<ErrorBoundary>` above the component. |
| `useOptimistic(state, update?)` | `[optimistic, addOptimistic]`, React 19's shape. `state` is an accessor (a signal, a computed) or a plain value; `optimistic` is an accessor. |
| `use(x)` | Reads a promise, a context, or an accessor. A component suspends on a promise that has not settled. |
| `settled()` | Resolves once nothing is queued, fetching, being streamed or open. |
| `<Suspense fallback>` | Shows `fallback` until every binding under it has its value (one computed from another async value included), and again while a component waits for a `lazy()` chunk or `use(promise)`. |
| `<ErrorBoundary fallback>` | Catches a rejection like any other error. `reset()` fetches again the run that failed. |
| `createResource(fetcher, options)` | The resource API, unchanged, with an async value as its `data`. |

`what-server`'s `useOptimistic` is the same function.

## Starting and running

- An `async` function, an async generator, or a function that takes
  `{ signal }` starts when the computed is created. Values made side by side
  fetch in parallel, with no waterfall. A plain function that returns a promise
  starts when it is first read, like any computed, because nothing says it is
  async before it runs. So one reader that reads two of those in turn starts
  the second only after the first lands: a waterfall. Write `async () => …` or
  `({ signal }) => …` for values meant to load together; eslint-plugin-what's
  `prefer-async-computed` reports a plain function whose source returns a
  promise (`fetch(…)`, `.then(…)`). (`async-computed.test.js`, "starting")
- Each evaluation is a run. A newer run supersedes the one in flight: the older
  run's AbortSignal is aborted and its result is dropped, so a stale value never
  overwrites a newer one. (`async-computed.test.js`, "supersedes and aborts an
  older run")
- **A run ends one way, and what waits for it hears of it**: its promise
  settles; its async iterable yields, ends or fails; or an answer already known
  replaces it, because the function returned a plain value or threw this time,
  or `createResource`'s `mutate()` set the value (which also aborts the request
  in flight). `refresh()` promises resolve or reject with that outcome, a
  component suspended on the value renders it, held readers run, and a
  transition waiting for the run stops waiting. (`async-outcomes.test.js`, "a run
  replaced by an answer known at once"; `async-random.test.js`)
- An async iterable lands each value it yields. It is closed (`return()`) when a
  newer run supersedes it or the computed is disposed. A `next()` that throws,
  first or later, is the computed's error, like a rejection.
  (`async-computed.test.js`, "an async iterable"; `async-outcomes.test.js`,
  "async iterables")
- Disposing the computed (its component unmounting) aborts the run in flight and
  drops its result. A pending `refresh()` resolves with the last value. Nothing is
  delivered after disposal, and the run's promise callbacks let go of the
  computed, so a promise that never settles retains nothing of it.
  (`async-computed.test.js`, "disposal aborts the run in flight";
  `async-retention.gc.test.js`)
- A computed fetches again when an input changes, even if nothing reads it.
  (`async-computed.test.js`, "fetches again when an input changes, with no
  reader")
- A rejection, or a synchronous throw from a computed that has gone async, is
  the computed's error. (`async-computed.test.js`, "errors")

## Reading

**A tracked read** (an effect, a binding, another computed) of a value that has
not landed, or that is being fetched again, is not ready.

- **A binding or an effect is held.** It keeps what it showed, stays subscribed,
  and runs again when the value lands. An effect that reads two async values runs
  once, when both have landed. With no `<Suspense>` above it, a binding shows
  nothing until the first value lands, and nothing is logged.
  (`async-computed.test.js`, "holds a binding until the value lands" and "an
  effect that reads two async values runs once")
- **A computed keeps its last value.** Its readers keep theirs until the value it
  waits for lands. This includes `useMemo` and a store's derived values. A
  computed that has never had a value stays without one: reading it is not a
  landed `undefined`. (`async-computed.test.js`, "a computed over an async value
  keeps its last value"; `async-reads.test.js`, "a value with nothing landed yet,
  read through a derived value")
- **Plain signals and settled values are never held.** A read right after a write
  sees the write, and `c.pending()` is true right after a write that makes `c`
  fetch again. (`async-computed.test.js`, "keeps the last value while a newer run
  is in flight; reads stay fresh and pending() is true at once")

**An untracked read** (an event handler, `peek()`) returns the last value that
landed. In a component body, a value that has never landed suspends the component
(see `<Suspense>`). Reading one that the same body made, directly or through a
computed or `useMemo` over it, is an error (`ERR_ASYNC_READ_IN_BODY`). Running
the component again would make the value again and fetch again, forever. Read it
in JSX, or make it outside the component. (`async-diagnostics.test.js`,
"ERR_ASYNC_READ_IN_BODY"; `async-reads.test.js`)

`c.pending()` and `isPending(fn)` are false on the first load, before any value
has landed. That case is `<Suspense>`'s. A tracked `isPending(fn)` follows what
`fn` reads: when a branch switches onto a value being fetched again, it turns
true, and false when that lands. (`async-computed.test.js`, "isPending(fn)
answers for what fn reads"; `async-reads.test.js`, "isPending()")

## `<Suspense>`

- **Shows the fallback until every binding under it has its value, then reveals
  all of it at once.** A binding counts until a run of it completes, so a value
  computed from another async value (orders fetched with the user's id) keeps
  the fallback up through its own fetch, and a nested boundary shows its own
  fallback meanwhile. (`suspense-async.test.js`, "shows the fallback until every
  binding under it has its value"; `suspense-waits.test.js`, "<Suspense> with
  values computed from other async values", frame by frame, compiled and `h()`)
- **It waits only for what still blocks it.** A binding whose branch moved away
  from a value that has not landed, a suspended component whose place was
  removed, and everything under a boundary that is unmounted stop counting.
  (`suspense-waits.test.js`, "<Suspense> stops waiting for what no longer blocks
  it")
- **An async value shows the fallback only on first load.** After the reveal, a
  refresh, a new input, or a row added later whose value has not landed leaves
  the content mounted, with its DOM state (focus, input values, scroll), and each
  binding waits in place. A component whose body reads such a value renders in
  place when it lands. (`suspense-async.test.js`, "after the reveal a refresh
  keeps the children mounted", "catches waiting bindings in rows created later";
  `async-programs.test.js`, P1)
- **A component that suspends on any other promise brings the fallback back**, as
  in React: a `lazy()` chunk not loaded yet, or `use(promise)`. The children stay
  mounted, out of the document, while the fallback shows. They come back with
  their DOM state once everything the boundary waits for has settled, and the
  `onMount` and `useEffect` of what was created meanwhile run then, on attached
  DOM. A hydrated boundary does the same with the children it adopted.
  (`suspense-async.test.js`, "after the reveal, a component that suspends on a
  chunk brings the fallback back"; `hydration-suspense.test.js`, "a lazy() chunk
  after the reveal shows the fallback and keeps the children mounted";
  `reactive-owner-chain.test.js`; `hydrate-boundary-tags.test.js`;
  `packages/router/test/lazy-route-navigation.test.js`)
- Nested boundaries reveal independently. The outer one does not wait for the
  inner one. (`suspense-async.test.js`, "nested boundaries reveal on their own")
- `onMount` and `useEffect` under a boundary first run when its content first
  shows, on attached DOM, and `settled()` resolves after they have run. If the
  boundary is disposed before it reveals, they never run.
  (`suspense-async.test.js`, "onMount and useEffect under it first run when its
  content first shows" and "a boundary disposed before it reveals";
  `suspense-waits.test.js`, "settled() resolves after the onMount and useEffect
  the reveal releases have run")
- A component that suspends with no boundary above it renders once its promise
  settles. In development it reports `ERR_ASYNC_WITHOUT_SUSPENSE`.
  (`suspense-async.test.js`, "a component that suspends with no boundary")

## `<ErrorBoundary>`

A rejection reaches the nearest error boundary, like any error thrown during
rendering. `reset()` fetches again the async computed run whose error the
boundary caught, and shows the content again. The boundary knows which run that
was, so it works whatever the rejection was (a string included), through a
derived value that read it, and it does not fetch again another value that
rejected with the same object. (`async-computed.test.js`, "a rejection reaches
the nearest ErrorBoundary; reset() fetches again"; `async-reads.test.js`,
"ErrorBoundary reset() fetches again the run whose error it caught")

## Transitions

```jsx
const [isPending, start] = useTransition();
<button disabled={isPending()} onClick={() => start(() => page(page() + 1))}>Next</button>
```

- **Everything a transition's writes reach on screen is held** until the async
  work those writes started has landed. Then all of it commits together, in one
  flush, so no frame shows the new page with the old data. A write outside the
  transition, in the same tick, commits at once. (`transitions.test.js`, "holds
  everything its writes reach")
- **Transitions keep revealed content; new boundaries show their fallback.** A
  `<Suspense>` that has revealed keeps its content through a transition: what
  the transition's writes reach is held until the async values they started
  have landed, and a navigation loads a `lazy()` route's chunk and its `preload`
  data before it commits, so the page being left stays. A boundary that has
  revealed nothing yet (a first load, or a boundary the commit creates) shows
  its fallback until its children can show, as in React. The exception is a
  component that suspends on a promise while the commit builds it, which brings
  its boundary's fallback back (see Limits). (`lazy-route-navigation.test.js`;
  `smoke/apps/ops-console`, `cmp:suspense-lazy`)
- **A held region stays held.** A write outside the transition to a binding
  inside a region the transition holds updates that binding; the region shows
  its old state until the commit. (`transitions-holds.test.js`, "an urgent write
  to a child binding does not release the region a transition holds")
- **A value that lands while the transition is open lands inside it.** A value
  that it makes fetch again (a team that depends on a user) joins the
  transition, so the transition commits once that value has landed too. So does
  a computed that answered synchronously until now and starts its first run at
  the commit, and a run in flight that a held binding reads (one a pending
  indicator started). (`transitions.test.js`, "commits a dependent async value
  with the rest"; `async-programs.test.js`, P3; `transitions-holds.test.js`, "a
  computed that answered synchronously until the transition and starts a run at
  its commit belongs to it"; `async-random.test.js`)
- **A newer transition for the same state supersedes the older one**, whose state
  never shows: two transitions that share a run in flight merge and commit
  together. (`transitions.test.js`, "a newer transition for the same state
  supersedes the older")
- **Two transitions that reach one binding commit together**: when one holds a
  binding that reads what the other wrote, neither shows without the other, and
  the first one's promise resolves at the shared commit.
  (`transitions-holds.test.js`, "two transitions that reach one binding commit
  together")
- An effect the transition holds that an outside write also reaches commits with
  the transition. (`transitions.test.js`, "an effect it holds that an outside
  write also reaches")
- A pending indicator is never held: an effect that reads `pending()`,
  `isPending()` or `useTransition`'s `isPending` shows its answer at once.
  (`transitions.test.js`, "never holds a pending indicator")
- `startTransition` returns a promise that resolves when the transition commits.
  It rejects, after the commit, with what an async function rejected with. A
  synchronous throw is rethrown. (`transitions.test.js`, "resolves when it
  commits")
- **A transition an async action awaits resolves before the commit.** One
  started inside an action's synchronous part joins the action's transition,
  and one started later can be entangled with it; either commits with the
  action. Its promise resolves once nothing but the action keeps the commit
  waiting, so `await startTransition(...)` (or `await navigate(...)`) inside an
  action goes on instead of waiting for a commit that waits for the action.
  (`transitions-holds.test.js`, "a transition an async action awaits")
- **`useTransition`'s rejection shows in the `<ErrorBoundary>` above the
  component**, as in React 19, after the commit. The promise `start` returns
  rejects too; once a boundary took the error, it is not reported as an
  unhandled rejection. With no boundary above, the promise is all there is.
  (`transitions-holds.test.js`, "a rejected action shows in the ErrorBoundary
  above the component")
- An async function keeps the transition open until it settles. A run started
  while it is running (a `refresh()` after an `await`) belongs to the transition.
  A component whose `useTransition` unmounts stops waiting for the async part,
  also when it unmounts during the action's synchronous part.
  (`transitions.test.js`, "a component that unmounts stops waiting";
  `transitions-holds.test.js`, "a component that unmounts in the synchronous
  part of its action")
- `useTransition()`'s `isPending()` is true from the call until the commit, and
  turns false in the commit's flush. (`transitions.test.js`, "useTransition")

## `useOptimistic`

```jsx
const [todos, addTodo] = useOptimistic(serverTodos, (list, todo) => [...list, todo]);
const save = (text) => startTransition(async () => {
  addTodo({ text, saving: true });
  await api.add(text);
  await refresh(serverTodos);
});
```

The refresh after the `await` joins the transition, so the overlay and the
refetched list commit together. A plain write after an `await` is an ordinary
write (see Limits): with a local count, wrap it so it commits with the overlay's
removal, `await save(); startTransition(() => likes((n) => n + 1));`. Written
plain, the overlay is applied once more to the new count until the action
finishes (`Likes 2`, then `Likes 1`, within one task).

- An overlay added inside a transition shows at once. It drops when that
  transition commits, in the same flush as the real value, so there is no frame
  with neither. (`transitions.test.js`, "shows an overlay at once and drops it";
  `async-programs.test.js`, P2)
- **Overlays add to what is committed.** While a value that landed inside a
  transition waits for that transition's commit, the optimistic view reads the
  value from before, so an overlay added by another action shows at once on top
  of it, and each real value replaces its own overlay in its own commit.
  (`transitions-holds.test.js`, "a second overlay shows at once")
- A failed action rolls back only its own overlay. (`transitions.test.js`, "rolls
  back only the overlay of a failed action"; `async-programs.test.js`, P2, "two
  concurrent toggles, one failing")
- Outside a transition, an overlay shows and drops when the current flush is
  over, as in React: nothing paints it. In development this reports
  `ERR_OPTIMISTIC_OUTSIDE_TRANSITION`. After an `await` the transition's
  function is outside it, so add the overlay before the first `await`.
  (`transitions.test.js`, "outside a transition the overlay drops at once")
- `state` is an accessor (a signal, a computed, a function) or a plain value.
  Pass the accessor, `useOptimistic(likes)`, not a value read once,
  `useOptimistic(likes())`, which never changes (eslint-plugin-what's
  `no-optimistic-snapshot`). Direct reads of async values inside the view return
  their last value while a new one is fetched, so the overlay shows on top of
  what was there.

## `use()` and `settled()`

- `use(context)` reads like `useContext`. `use(promise)` returns the value of a
  settled promise, throws its rejection, or suspends the component until it
  settles. `use(accessor)` reads untracked, which suspends the component while the
  value has never landed. (`async-computed.test.js`, "use()")
- The promise must outlive the component: make it outside, or pass it in. A
  component that suspends on a new promise every time it runs would never finish.
  The third such suspension in a row of one instance is `ERR_USE_UNCACHED_PROMISE`,
  an error in every build. Instances count apart, so rows that each read a cached
  promise are never taken for one. (`async-diagnostics.test.js`,
  "ERR_USE_UNCACHED_PROMISE"; `async-reads.test.js`, "use()")
- `settled()` resolves once no effect is queued or flushing, no async value has a
  run in flight, no async iterable is still being pulled, no transition is open
  and no `<Suspense>` waits (on a promise, or to reveal and run the effects it
  releases). On the next line, the DOM shows every value that has landed. It
  does not wait for a computed that no one has read (it has not started), work
  started after it resolves is not covered, and it never resolves while
  something keeps fetching or streaming. Tests and server code await it.
  (`async-computed.test.js`, "settled()"; `async-random.test.js`;
  `async-outcomes.test.js`)

## `createResource`

`createResource(fetcher, { source, key, initialValue })` returns
`[data, { loading, error, refetch, mutate }]` as before. `data` is an async value:
reading it before the first value lands holds the reader, and a `<Suspense>`
above it shows its fallback. The fetcher runs untracked: on creation and on
`refetch(source)`, not when a signal it reads changes. `refetch` never rejects:
a failure shows in `error()`. `mutate(value)` sets the value now, superseding
and aborting a fetch in flight, whose `refetch()` resolves.
(`async-source-schedule.test.js`; `async-outcomes.test.js`)

## Server rendering and hydration

- A not-ready read on the server suspends its `<Suspense>`.
  `renderToString` cannot wait: it renders the fallback, or throws an error
  saying a value was read before it settled when no boundary is there.
  `renderDocument` and `renderToStream` wait for the values, and stream the
  boundary when it is ready.
- Settled values travel in the hydration data channel: under their `key` (a
  resource's), or under the owner key of the component that made them. So does
  a value answered at once, with no promise, by a function that takes
  `{ signal }` (every resource's fetcher runs in one); a plain synchronous
  computed is computed again on the client instead.
  (`packages/server/test/async-sync-channel.test.js`) When
  hydrating, the client takes each value from the channel and does not fetch. The
  fallback never shows, and the server's DOM is kept. A value the server failed
  to get is adopted as failed: the error boundary shows and nothing refetches.
  (`packages/server/test/async-roundtrip.test.js`)
- An adopted computed still refetches when what it read changes. To learn what
  it reads, its function runs once while hydrating, with a signal that is already
  aborted; an async generator is pulled once for that, so the reads before its
  first `await` count. Pass the signal to `fetch` and nothing is sent.
  (`async-reads.test.js`, "an async generator adopted while hydrating")
- A keyless value is adopted by its owner key: the owner path of the component
  that made it (`0`, `00`, …, the path `data-hk` carries) and its place among
  that component's keyless values. A component takes its path from the
  `data-hk` where its output starts, so a branch only one side renders, or a
  boundary's fallback, never hands it another instance's value; where the walk
  can no longer tell, the value fetches. In development the client's component at
  that path must also have the server's component's name, or the value fetches
  again and `ERR_HYDRATION_OWNER_MISMATCH` names both; a production build (whose
  bundle renames every function) adopts by the path alone, with no request.
  (`scripts/qualification/production-runtime.test.mjs`, "a minified production
  client adopts keyless values") A resource with a `key` is adopted by that key
  everywhere.
- A server-rendered `<Suspense>` is adopted, never rebuilt: its content where the
  server rendered it (buffered or streamed, `noScripts` or not), the server's
  fallback where the server could not wait, and a streamed boundary's content
  when it arrives, with the values streamed with it. From then on it is the
  boundary described above. A component that suspends while it hydrates (its
  chunk has not loaded on the client) leaves the server's content up, and the
  boundary adopts it once nothing waits: no fallback frame, no rebuild.
  (`hydration-suspense.test.js`, `hydration-identity.test.js`)

## Diagnostics

| Code | When |
|---|---|
| `ERR_ASYNC_EFFECT` | An effect or `useEffect` callback returned a promise, on its first run or a later one: its promise is not a cleanup, and its runs can finish out of order. Use an async computed. |
| `ERR_PENDING_READ_UNTRACKED` | `pending()` or `isPending()` read once in a component body, where it never updates. |
| `ERR_WRITE_AFTER_AWAIT` | A signal an async transition wrote was written again outside it while its function still runs, from neither an effect nor an event handler: almost always the function after an `await`, whose writes are no longer part of the transition. |
| `ERR_ASYNC_WITHOUT_SUSPENSE` | A component suspended with no `<Suspense>` above it. |
| `ERR_ASYNC_READ_IN_BODY` | A component body read, before it landed, an async value it made itself (or a value derived from one). An error in every build. |
| `ERR_USE_UNCACHED_PROMISE` | A component suspends on a new promise every time it runs. An error in every build. |
| `ERR_OPTIMISTIC_OUTSIDE_TRANSITION` | `addOptimistic` called outside a transition. |
| `ERR_ASYNC_COMPONENT` | A component returned a promise (an `async function` component). It renders the promise's text. |
| `ERR_ASYNC_MEMO` | `useMemo` returned a promise, which it keeps as its value. Use `computed()`. |
| `ERR_SUSPEND_IN_TRANSITION` | A component suspended on `use(promise)` or a `lazy()` chunk while a transition committed, so its `<Suspense>` shows the fallback (see Limits). |

Each has a firing test and a "stays silent" case for the pattern next to it
(`async-diagnostics.test.js`, `transitions-holds.test.js`). They fire only when
the behaviour is certain, except `ERR_WRITE_AFTER_AWAIT`: without an async
context the engine cannot tell which code made a write, so a timer writing a
signal the transition wrote looks the same as the function after its `await`. It
is a heuristic, and says so. The fixes are in [ERRORS.md](ERRORS.md).
eslint-plugin-what reports the same mistakes in source where it can tell:
`no-async-component`, `no-promise-in-usememo`, `no-optimistic-snapshot`,
`prefer-async-computed`, and `no-uncalled-signals` for `useTransition`'s and
`useOptimistic`'s accessors (`packages/eslint-plugin/test/async-rules.test.js`).

## Devtools

The devtools hooks see an async computed without any change to `what-devtools`.
`onEffectCreate` hands out its node. `onEffectRun` reports each run with the
inputs that caused it. `node.devAsync` holds its status (`'unresolved'`,
`'pending'`, `'ready'`, `'errored'`). A rejection reaches `onError` with
`{ type: 'async' }`. (`async-devtools.test.js`)

## Limits

These are decisions. Each one is pinned by a test, so the difference stays
visible (`async-model-limits.test.js`, `transitions-holds.test.js`).

- **An imperative read can be ahead of the screen.** While a transition holds the
  screen, a handler, a test or devtools reading the signal it wrote sees the new
  value. Solid serves the committed value. What keeps a read right after a write
  fresh.
- **Atomicity is opt-in.** Outside a transition, a binding of the written signal
  shows the write at once, and a binding of the async value it changes waits for
  the fetch. For one frame, use `startTransition`. Solid holds both.
  (`async-programs.test.js`, P3, "without a transition")
- **A write after an `await` inside `startTransition` is an ordinary write.** It
  shows before the commit. Wrap it in its own `startTransition`. Development
  reports `ERR_WRITE_AFTER_AWAIT` when it writes a signal the transition wrote
  before. Solid keeps it in the action.
- **A transition holds what its own writes queue.** It is started after what
  earlier writes queued has been flushed, when a flush can start there. Inside a
  `batch()`, an effect or a `flushSync()`, it cannot: an effect that an earlier
  write already queued is not held. Solid stages every write.
- **A transition does not hold a component that suspends on a promise.** A
  `lazy()` component, or a component that calls `use(promise)`, reached inside
  `startTransition` still shows its boundary's fallback while it waits, and
  development reports `ERR_SUSPEND_IN_TRANSITION`. React keeps the old content:
  it renders the new tree off screen and throws it away. What's transitions hold
  effects, not render output: by the time the component suspends, the region
  that builds it has already run at the commit and replaced the old content, so
  there is nothing left to keep. React's tabs pattern (panels that `use()` a
  cached promise) therefore loses the old tab here: make the tab's data an async
  computed of the tab signal instead, read in JSX, which a transition does hold.
  The router does this for routes: a navigation loads a `lazy()` route's chunk
  and its `preload` data before it commits, so the old page stays
  ([DATA.md](DATA.md)).
- **A rejection reaches an `<ErrorBoundary>` only from `useTransition`.** The
  module-level `startTransition` has no component to find a boundary from: its
  promise rejects, so catch it.
- **An optimistic overlay added while a transition holds its view runs the
  view's readers at once.** A binding that reads both the optimistic value and a
  signal that transition wrote then shows that signal's new value early. Keep
  the optimistic value in a binding of its own.
- **A pending indicator is never held**, so it can show a transition's pending
  state while the transition holds everything else.
- **`refresh()` always shows as pending.** There is no quiet refresh.
- **Cost.** An app that calls `computed()` carries the async core, about 2.7 KB
  gzip, even if every function it passes is synchronous: a function shows it is
  async only when it runs. Transitions are installed by the first
  `startTransition`, and the server data channel by the first server render or
  `hydrate()`. An app that uses neither does not carry them
  (`.size-budgets.json`, `computed-counter`). Each run of a computed made by
  `computed()` goes through one more call that checks what its function
  returned. Against the engine's own computed, which `useMemo` and stores use,
  that measured 0-2% slower on a wide graph of trivial computeds and 4-10%
  slower along a chain of 1000.
