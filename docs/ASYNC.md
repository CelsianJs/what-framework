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

## The surface

| Name | What it does |
|---|---|
| `computed(fn)` | A computed whose function may return a promise, a thenable or an async iterable. A function that declares a parameter gets `{ signal }`, the AbortSignal of its run. |
| `c.pending()` | True while `c` has a value and is fetching a newer one. Tracked. |
| `c.peek()` | The last value that landed (undefined before the first). Never throws, never waits. |
| `refresh(c)` | Fetch again now. Resolves with the value when it lands, rejects with its error. |
| `isPending(fn)` | Whether an async value that `fn` reads, directly or through computeds, is fetching a newer value. Tracked. |
| `startTransition(fn)` | Holds what `fn`'s writes reach on screen until the async work they started has landed, then commits it in one flush. Returns a promise of the commit. |
| `useTransition()` | `[isPending, startTransition]`. `isPending` is an accessor: call it. |
| `useOptimistic(state, update?)` | `[optimistic, addOptimistic]`, React 19's shape. `optimistic` is an accessor. |
| `use(x)` | Reads a promise, a context, or an accessor. A component suspends on a promise that has not settled. |
| `settled()` | Resolves once nothing is queued, fetching or open. |
| `<Suspense fallback>` | Shows `fallback` until its content has first shown, and again while a component waits for a `lazy()` chunk or `use(promise)`. |
| `<ErrorBoundary fallback>` | Catches a rejection like any other error. `reset()` fetches again. |
| `createResource(fetcher, options)` | The resource API, unchanged, with an async value as its `data`. |

`what-server`'s `useOptimistic` is the same function.

## Starting and running

- An `async` function, an async generator, or a function that takes
  `{ signal }` starts when the computed is created. Values made side by side
  fetch in parallel, with no waterfall. A plain function that returns a promise
  starts when it is first read, like any computed, because nothing says it is
  async before it runs. So one reader that reads two of those in turn starts
  the second only after the first lands: a waterfall. Write `async () => …` or
  `({ signal }) => …` for values meant to load together.
  (`async-computed.test.js`, "starting")
- Each evaluation is a run. A newer run supersedes the one in flight: the older
  run's AbortSignal is aborted and its result is dropped, so a stale value never
  overwrites a newer one. (`async-computed.test.js`, "supersedes and aborts an
  older run")
- An async iterable lands each value it yields. It is closed (`return()`) when a
  newer run supersedes it or the computed is disposed. (`async-computed.test.js`,
  "an async iterable")
- Disposing the computed (its component unmounting) aborts the run in flight and
  drops its result. A pending `refresh()` resolves with the last value. Nothing is
  delivered after disposal. (`async-computed.test.js`, "disposal aborts the run
  in flight")
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
  waits for lands. This includes `useMemo` and a store's derived values.
  (`async-computed.test.js`, "a computed over an async value keeps its last
  value")
- **Plain signals and settled values are never held.** A read right after a write
  sees the write, and `c.pending()` is true right after a write that makes `c`
  fetch again. (`async-computed.test.js`, "keeps the last value while a newer run
  is in flight; reads stay fresh and pending() is true at once")

**An untracked read** (an event handler, `peek()`) returns the last value that
landed. In a component body, a value that has never landed suspends the component
(see `<Suspense>`). Reading one that the same body made is an error
(`ERR_ASYNC_READ_IN_BODY`). Running the component again would make the value
again and fetch again, forever. Read it in JSX, or make it outside the component.

`c.pending()` and `isPending(fn)` are false on the first load, before any value
has landed. That case is `<Suspense>`'s. (`async-computed.test.js`, "isPending(fn)
answers for what fn reads")

## `<Suspense>`

- Shows the fallback until every binding under it has its value, then reveals all
  of it at once. (`suspense-async.test.js`, "shows the fallback until every
  binding under it has its value")
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
  shows, on attached DOM. If the boundary is disposed before it reveals, they never
  run. (`suspense-async.test.js`, "onMount and useEffect under it first run when
  its content first shows" and "a boundary disposed before it reveals")
- A component that suspends with no boundary above it renders once its promise
  settles. In development it reports `ERR_ASYNC_WITHOUT_SUSPENSE`.
  (`suspense-async.test.js`, "a component that suspends with no boundary")

## `<ErrorBoundary>`

A rejection reaches the nearest error boundary, like any error thrown during
rendering. `reset()` fetches again the async values whose errors the boundary
caught, and shows the content again. (`async-computed.test.js`, "a rejection
reaches the nearest ErrorBoundary; reset() fetches again")

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
- **A value that lands while the transition is open lands inside it.** A value
  that it makes fetch again (a team that depends on a user) joins the
  transition, so the transition commits once that value has landed too.
  (`transitions.test.js`, "commits a dependent async value with the rest";
  `async-programs.test.js`, P3)
- **A newer transition for the same state supersedes the older one**, whose state
  never shows: two transitions that share a run in flight merge and commit
  together. (`transitions.test.js`, "a newer transition for the same state
  supersedes the older")
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
- An async function keeps the transition open until it settles. A run started
  while it is running (a `refresh()` after an `await`) belongs to the transition.
  A component whose `useTransition` unmounts stops waiting for the async part.
  (`transitions.test.js`, "a component that unmounts stops waiting")
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
- A failed action rolls back only its own overlay. (`transitions.test.js`, "rolls
  back only the overlay of a failed action"; `async-programs.test.js`, P2, "two
  concurrent toggles, one failing")
- Outside a transition, an overlay shows and drops when the current flush is
  over, as in React. In development this reports `ERR_OPTIMISTIC_OUTSIDE_TRANSITION`.
  After an `await` the transition's function is outside it, so add the overlay
  before the first `await`. (`transitions.test.js`, "outside a transition the
  overlay drops at once")
- `state` may be a value or an accessor. Direct reads of async values inside the
  view return their last value while a new one is fetched, so the overlay shows
  on top of what was there.

## `use()` and `settled()`

- `use(context)` reads like `useContext`. `use(promise)` returns the value of a
  settled promise, throws its rejection, or suspends the component until it
  settles. `use(accessor)` reads untracked, which suspends the component while the
  value has never landed. (`async-computed.test.js`, "use()")
- The promise must outlive the component: make it outside, or pass it in. A
  component that suspends on a new promise every time it runs would never finish.
  The third such suspension in a row is `ERR_USE_UNCACHED_PROMISE`, an error in
  every build. (`async-diagnostics.test.js`, "ERR_USE_UNCACHED_PROMISE")
- `settled()` resolves once no effect is queued or flushing, no async value has a
  run in flight, no transition is open and no `<Suspense>` waits on a promise. On
  the next line, the DOM shows every value that has landed. It does not wait for a
  computed that no one has read (it has not started), and work started after it
  resolves is not covered. Tests and server code await it.
  (`async-computed.test.js`, "settled()"; `async-random.test.js`)

## `createResource`

`createResource(fetcher, { source, key, initialValue })` returns
`[data, { loading, error, refetch, mutate }]` as before. `data` is an async value:
reading it before the first value lands holds the reader, and a `<Suspense>`
above it shows its fallback. The fetcher runs untracked: on creation and on
`refetch(source)`, not when a signal it reads changes. `refetch` never rejects:
a failure shows in `error()`. (`async-source-schedule.test.js`)

## Server rendering and hydration

- A not-ready read on the server suspends its `<Suspense>`.
  `renderToString` cannot wait: it renders the fallback, or throws an error
  saying a value was read before it settled when no boundary is there.
  `renderDocument` and `renderToStream` wait for the values, and stream the
  boundary when it is ready.
- Settled values travel in the hydration data channel: under their `key` (a
  resource's), or under the owner key of the component that made them. When
  hydrating, the client takes each value from the channel and does not fetch. The
  fallback never shows, and the server's DOM is kept. A value the server failed
  to get is adopted as failed: the error boundary shows and nothing refetches.
  (`packages/server/test/async-roundtrip.test.js`)
- An adopted computed still refetches when what it read changes. To learn what
  it reads, its function runs once while hydrating, with a signal that is already
  aborted. Pass the signal to `fetch` and nothing is sent.
- A keyless value is adopted by its owner key: the owner path of the component
  that made it (`0`, `00`, …, the path `data-hk` carries) and its place among
  that component's keyless values. In development the client's component at
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
  chunk has not loaded on the client) shows the fallback, and its boundary's
  children are built on the client once nothing waits.
  (`hydration-suspense.test.js`)

## Diagnostics

| Code | When |
|---|---|
| `ERR_ASYNC_EFFECT` | An async function passed to `effect()` or `useEffect()`: its promise is not a cleanup, and its runs can finish out of order. Use an async computed. |
| `ERR_PENDING_READ_UNTRACKED` | `pending()` or `isPending()` read once in a component body, where it never updates. |
| `ERR_WRITE_AFTER_AWAIT` | An async transition writes, after an `await`, a signal it wrote before. That write is no longer part of the transition. |
| `ERR_ASYNC_WITHOUT_SUSPENSE` | A component suspended with no `<Suspense>` above it. |
| `ERR_ASYNC_READ_IN_BODY` | A component body read, before it landed, an async value it made itself. An error in every build. |
| `ERR_USE_UNCACHED_PROMISE` | A component suspends on a new promise every time it runs. An error in every build. |
| `ERR_OPTIMISTIC_OUTSIDE_TRANSITION` | `addOptimistic` called outside a transition. |

Each fires only when the behaviour is certain, never for the patterns next to it
(`async-diagnostics.test.js` has a "stays silent" case for each). The fixes are
in [ERRORS.md](ERRORS.md).

## Devtools

The devtools hooks see an async computed without any change to `what-devtools`.
`onEffectCreate` hands out its node. `onEffectRun` reports each run with the
inputs that caused it. `node.devAsync` holds its status (`'unresolved'`,
`'pending'`, `'ready'`, `'errored'`). A rejection reaches `onError` with
`{ type: 'async' }`. (`async-devtools.test.js`)

## Limits

These are decisions. Each one is pinned by a test, so the difference stays
visible (`async-model-limits.test.js`).

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
  `lazy()` route, or a component that calls `use(promise)`, reached inside
  `startTransition` still shows its boundary's fallback while it waits. React
  keeps the old page, which is why React's tabs pattern (panels that `use()` a
  cached promise) loses the old tab here: make the tab's data an async computed
  of the tab signal instead, which a transition does hold.
- **A rejected transition does not reach an `<ErrorBoundary>`.** The promise
  `startTransition` returns rejects; catch it (React 19 sends it to the nearest
  boundary).
- **A value computed from another async value is not counted once that value
  lands.** A `<Suspense>` over `orders`, an async computed that reads `user`,
  can reveal when `user` lands and before `orders` has started its own run. Make
  the dependent fetch one async computed (`await` the first value inside it) so
  the boundary waits for both.
- **A pending indicator is never held**, so it can show a transition's pending
  state while the transition holds everything else.
- **`refresh()` always shows as pending.** There is no quiet refresh.
- **Cost.** An app that calls `computed()` carries the async core, about 2 KB
  gzip, even if every function it passes is synchronous: a function shows it is
  async only when it runs. Transitions are installed by the first
  `startTransition`, and the server data channel by the first server render or
  `hydrate()`. An app that uses neither does not carry them
  (`.size-budgets.json`, `computed-counter`). Each run of a computed made by
  `computed()` also checks what its function returned. On graphs of trivial
  computeds (one addition each), that measured about 10% slower than the
  engine's own computed, which `useMemo` and stores use.
