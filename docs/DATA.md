# Data: the query cache, actions and route data

The data layer sits on [async values](ASYNC.md). Every key the app reads is
one cache entry, and every entry is one async value in the reactive graph.
So what reads it waits for it like any async value: a `<Suspense>` shows its
fallback on first load, a transition holds what a refetch reaches, `settled()`
waits for the fetch, and a server render sends the value to the client, which
adopts it without fetching. On top of the entries sit:

- **`query(key, fetcher)`**, the signal-native read. The key may be a function
  of signals.
- **The React-ecosystem hooks**, `useQuery` (TanStack Query), `useSWR` (SWR),
  `useInfiniteQuery` and `useFetch`. They are views over the same entries that
  never suspend.
- **Actions**: React 19's `useActionState` and `useFormStatus`, and
  what-server's `action()` and `<Form>`. They run as transitions, and their
  revalidation refetches inside them.
- **Route data**: a route's `preload`. Navigations are transitions that wait for
  it.

```jsx
import { Suspense } from 'what-framework';
import { query } from 'what-framework/data';

const fetchUser = (key, { signal }) => fetch(`/api/users/${key[1]}`, { signal }).then((r) => r.json());

export function Profile(props) {
  const user = query(() => ['user', props.id], fetchUser);
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <h1 class={user.pending() ? 'stale' : ''}>{user().name}</h1>
    </Suspense>
  );
}
```

The cache and the hooks come from `what-framework/data`. `useActionState` and
`useFormStatus` are on the root entry, with React's meaning. `action`, `<Form>`
and the response API come from `what-framework/server`. Each guarantee below
names the tests that pin it, in `packages/core/test/` unless the path says
otherwise.

`query` lives on `what-framework/data`, beside the cache it reads, and not on
the root entry. The root entry holds React's names and What's signals. The
cache is a domain kit with its own lifetime rules (staleness, garbage
collection, keys), like the SWR and TanStack libraries it replaces in a React
app, and an app that never reads one pays nothing for it.

## `query(key, fetcher, options?)`

| | |
|---|---|
| `key` | A string, an array, or a function of signals that returns one. `null`, `false` or `undefined` means no key, and the value is `undefined`. Array keys are joined into one normalized string (`['todos', 1]` is `"todos:1"`), so `query('todos')`, `useSWR('todos')` and `useQuery({ queryKey: ['todos'] })` share one entry. |
| `fetcher(key, { signal })` | Gets the key as written, and the AbortSignal of the request. |
| `options` | `staleTime` (ms a landed value stays fresh, default 0), `gcTime` (ms an entry nothing reads is kept, default 5 minutes), `retry` (total attempts, default 1), `retryDelay`, `initialData`. |

It returns an async value (`AsyncComputed`), so everything in
[ASYNC.md](ASYNC.md) applies to it.

- **Every reader of a key shares one request and one value.** Readers that
  mount while a request is in flight join it. (`query.test.js`, "suspends
  under <Suspense>, shows the value, and one fetch answers every reader")
- **A reactive key moves the value to the new key's entry.** The old value
  stays meanwhile, and `pending()` is true. A key that is cached and fresher
  than `staleTime` shows at once, with no request. (`query.test.js`, "follows a
  reactive key")
- **A key that nothing reads any more is aborted.** Its request's
  AbortSignal fires and its result is dropped. Nothing is delivered after a
  reader is disposed, and a remount after a dispose fetches again.
  (`query.test.js`, "aborts the old key's request when nothing reads it any
  more"; `async-source-schedule.test.js`, the `query()` schedules in four modes)
- **`refresh(q)` fetches the entry again.** It shows as pending, and its promise
  resolves with the new value. (`query.test.js`, "refresh(q) fetches the entry
  again")
- **Transitions.** A key change inside `startTransition` holds what it
  reaches, and commits it with the new key's value. (`query.test.js`, "a key
  change inside a transition commits with the rest of it")
- **Errors** reach the nearest `<ErrorBoundary>`, and `reset()` fetches the
  entry again. (`query.test.js`, "a failed fetch reaches the <ErrorBoundary>")
- **Garbage collection.** An entry nothing reads is kept for `gcTime`, and a
  reader that attaches within it is answered from the cache. After `gcTime` the
  entry is dropped. (`query.test.js`, "drops an entry nothing reads after its
  gcTime")
- **The fetcher's synchronous signal reads are tracked**, as in any computed:
  a change refetches the entry under the same key. Prefer putting such inputs
  in the key, `() => ['search', term()]`, so that each value has its own entry.
  (`query-invalidation-lifecycle.test.js`)

## The hooks

They read the same entries, never suspend, and keep the shapes React code
expects. Their accessors are functions: `q.data()`, `q.isLoading()`.

| Hook | Shape |
|---|---|
| `useQuery({ queryKey, queryFn, ... })` | TanStack Query: `data`, `error`, `status` (`'idle'`, `'loading'`, `'success'`, `'error'`), `fetchStatus`, `isLoading`, `isFetching`, `isError`, `isSuccess`, `isIdle`, `isPlaceholderData`, `isEnabled`, `dataUpdatedAt`, `refetch()`. Options: `enabled` (a boolean, signal or thunk), `staleTime`, `gcTime`/`cacheTime`, `refetchOnWindowFocus`, `refetchOnReconnect`, `refetchInterval`, `retry` (total attempts, default 3), `retryDelay`, `select`, `placeholderData` (a value, or a function of the previous key's data), `keepPreviousData`, `initialData`, `onSuccess`/`onError`/`onSettled`. `queryFn` gets `{ queryKey, signal }`. |
| `useSWR(key, fetcher, options?)` | SWR: `data` (the value, `fallbackData`, or `null`), `error`, `isLoading` (no data yet, and fetching), `isValidating`, `mutate(data?, revalidate = true)`, `revalidate()`. Options: `dedupingInterval` (2000), `revalidateOnFocus`, `revalidateOnReconnect`, `refreshInterval`, `fallbackData`, `keepPreviousData`, `onSuccess`, `onError`. A `null`, `false` or throwing key pauses it. |
| `useInfiniteQuery(options)` | TanStack Query: `data()` is `{ pages, pageParams }`; `fetchNextPage`, `fetchPreviousPage`, `hasNextPage`, `hasPreviousPage`, `isFetchingNextPage`, `isFetchingPreviousPage`, `refetch` (page one, replacing the list). |
| `useFetch(url, options?)` | One URL's JSON: `data`, `error`, `isLoading`, `refetch`, `mutate`. `url` may be a function. |

- **One request for every hook and `query()` on a key.** (`query.test.js`,
  "useQuery and useSWR on one key are one request and one value")
- **`queryKey` may be a function**, and the query follows it to the new key's
  entry. With `keepPreviousData` (or `placeholderData: (prev) => prev`) the
  previous key's data shows meanwhile. A static array key is read once.
  (`query.test.js`, "a function queryKey follows its signals";
  `data-enabled-clearcache-infinite.test.js`, "a static queryKey is read
  once")
- **`enabled` gates automatic fetching only.** Fetching on mount, focus,
  polling and invalidation waits for it. `refetch()` is a direct request and is
  never gated, and never answered from the freshness window.
  (`data-enabled-clearcache-infinite.test.js`)
- **The schedule oracle** checks every hook: no fetch is lost on
  dispose-then-remount, no fetch is duplicated, no refetch follows a
  supersede, and nothing is delivered after disposal. Callbacks fire once per
  landing, for the reader that asked for it. (`async-source-schedule.test.js`)
- **A hook renders its first state on the server and in the hydration walk**:
  its loading state, or its own `initialData`/`fallbackData`. It does not
  fetch on the server, and it does not show what a `query()` of the same key
  fetched there, because that depends on the order the server rendered the
  two in, which the hydrating client cannot know. Right after the walk it shows
  what the cache holds, with no request for a value the page carried. Use
  `query()` to render data on the server. (`packages/server/test/query-roundtrip.test.js`,
  "hooks on the key outside the query's boundary hydrate without a mismatch")

## The cache

| Function | |
|---|---|
| `invalidateQueries(keyOrPredicate, { exact?, hard? })` | Marks the matching entries stale, and fetches again the ones something shows. An array key is a prefix unless `exact`; a predicate gets each normalized key. `hard` empties them first, and a request already in flight still refills them. Inside a transition, the refetch joins it. Returns a promise that resolves when the refetches have landed. |
| `invalidatePath(path)` | Invalidates the entries read on `path` (a route's `preload` data, and every query read while the page was at `path`), then runs the `onRevalidate(path)` callbacks. A server action's `revalidate: [path]` calls it. |
| `prefetchQuery(key, fetcher, { staleTime? })` | Fills the entry unless it holds a fresh value, and resolves with the value. |
| `setQueryData(key, valueOrUpdater)` | Lands a value in the entry now, for every reader. A request in flight for it is dropped. |
| `getQueryData(key)` | The cached value: `undefined` when nothing is cached, `null` after a hard invalidation. |
| `clearCache()` | Logout. What is in flight is dropped, so no response requested before the clear lands after it. Entries something shows stay attached to their readers, empty, and a mounted `query()` fetches again. The page's server data is not adopted again. |

(`data.test.js`, `query-keys.test.js`, `query-invalidation-lifecycle.test.js`,
`data-enabled-clearcache-infinite.test.js`, `query.test.js`)

## Server rendering and the data channel

A server render keeps a cache of its own: one request's data never answers
another. A page's loader runs in its request's render, so what it prefetches
(`prefetchQuery`, `setQueryData`) is that request's, and the page reads it
without fetching again. Code on the server outside every render, loader and
action (module scope, a timer, code after an `await` on a runtime without
AsyncLocalStorage) gets an empty cache of its own on each call, never one
every request shares (`ERR_QUERY_OUTSIDE_RENDER` in development). On an edge
runtime, enable AsyncLocalStorage (Cloudflare Workers: `nodejs_compat`), or
data a component reads after an `await` is not in the page's data channel.
(`packages/server/test/query-isolation.test.js`) `query()` starts fetching when it is created, so sibling queries
fetch side by side. A read before the value lands suspends its `<Suspense>`.
The settled value goes into the hydration payload as `resources["query:KEY"]`,
and the hydrating client adopts it under the same key with no request and no
fallback. Hooks on the same key show the adopted value right after the walk.
An adopted value counts as fresh for the readers that attach while the page
hydrates.
(`packages/server/test/query-roundtrip.test.js`)

## Actions

### `useActionState(action, initialState, permalink?)` and `useFormStatus()`

```jsx
import { useActionState, useFormStatus } from 'what-framework';
import { Form } from 'what-framework/server';
import { invalidateQueries } from 'what-framework/data';

function Save() {
  const status = useFormStatus();
  return <button disabled={status.pending()}>{status.pending() ? 'Saving…' : 'Save'}</button>;
}

export function Rename() {
  const [message, rename] = useActionState(async (previous, form) => {
    const response = await fetch('/api/name', { method: 'POST', body: form });
    if (!response.ok) return 'Could not save';
    await invalidateQueries(['user']);
    return 'Saved';
  }, '');
  return (
    <Form action={rename}>
      <input name="name" />
      <Save />
      <p>{message()}</p>
    </Form>
  );
}
```

- `[state, dispatch, isPending]`, React 19's shape, with accessors for `state`
  and `isPending`. `dispatch(payload)` runs `action(previousState, payload)`
  inside a transition. Dispatches queue, and each receives the state the
  previous one returned. (`action-state.test.js`)
- The new state commits with the transition: in the same flush as the data its
  action revalidated, and the optimistic overlays added in it drop there too.
  With nothing queued, the action starts at once inside the transition, so an
  `addOptimistic()` before its first `await` belongs to it.
  (`action-state.test.js`, "commits its state in the same flush as the data its
  action revalidated" and "drops an optimistic overlay")
- An action that throws reaches the nearest `<ErrorBoundary>`, and the
  dispatches queued behind it are dropped, as in React. (`action-state.test.js`)
- `useFormStatus()` returns the submission of the `<Form>` around the
  component: `pending()`, `data()` (its FormData), `method`, and `action`, the
  form's action function (null for an action id, as React's is for a URL).
  Outside a form, `pending()` is false and the rest is null.
  (`action-state.test.js`, "useFormStatus")

### Server actions

```js
import { action } from 'what-framework/server';

export const addTodo = action(async ({ title }) => db.todos.add(title), {
  id: 'addTodo',
  revalidate: ['/todos'],     // purge the cached page; refetch what was read on /todos
  invalidates: [['todos']],   // refetch these query keys on the client
});
```

On the server, `addTodo` is the function itself. On the client, calling it
posts to `/__what_action` as a transition, or joins the transition it is
called in (`startTransition`, a `<Form>` submission, `useActionState`). Then
it revalidates inside that transition: `invalidatePath` for each `revalidate`
path and `invalidateQueries` for each `invalidates` key. It resolves with the
result once those refetches have landed, and rejects with the action's
error, which rolls back its optimistic overlay. The screen goes from the old
data to the new in one commit. (`packages/server/test/actions-transition.test.js`)

An action is a public endpoint: its id is in the page, so any client can call
it with any arguments (CSRF protection stops other sites, not the client).
Check the caller and the arguments in the action: the built-in endpoints run
each call in a context of its own, where `getRequest()` (what-framework/server)
is the request, with its cookies and headers. (`packages/server/test/actions.test.js`,
"an action call knows its request")

### `<Form action>`

`<Form>` renders a real `<form method="post">`, so it submits without
JavaScript, posting to the action endpoint (for a server action) or to the
dispatch's `permalink`. The endpoint answers 303 to `redirect`. On a mounted
page the form runs its own submit instead: it calls the action with the form's
data as a transition, `useFormStatus()` inside it shows the submission, and,
as React 19 does for an uncontrolled form, the form is reset when that
transition commits, only if the action succeeded: what the user typed stays
while the action is pending, and after it fails (a server action that
rejects, a `useActionState` action that throws). A server action receives the
fields as an object; a client action (`useActionState`'s dispatch) receives
the FormData. (`packages/server/test/actions-transition.test.js`, "<Form> on a
mounted page"; `packages/server/test/form.test.js`)

### Call an action from a buildless page

The full-stack starter serves page modules as native JavaScript. Put the
action declaration in a file the browser may import, such as
`src/components/post-actions.js`. Import the database inside the callback,
which runs on the server, and use the same explicit ID on both sides.

```js
import { action } from 'what-framework/server';

export const addPost = action(async function addPost({ title, body }) {
  const { createPost } = await import('../db.js');
  return createPost({ title, body });
}, { id: 'addPost', revalidate: ['/'] });
```

In the page, import that action and pass it to `Form`. The loader supplies the
per-request CSRF token for a normal form POST when JavaScript is disabled.

```js
import { h, useLoaderData } from 'what-framework';
import { Form } from 'what-framework/server';
import { addPost } from '../components/post-actions.js';

export const page = { mode: 'server' };
export async function loader({ csrfToken }) {
  return { csrfToken };
}

export default function AddPost() {
  const { csrfToken } = useLoaderData();
  return h(Form, { action: addPost, csrfToken, redirect: '/' },
    h('input', { name: 'title', required: true }),
    h('textarea', { name: 'body', required: true }),
    h('button', { type: 'submit' }, 'Publish'),
  );
}
```

Register the page in `src/routes.js` and add its component to the match in
`src/entry-client.js`.

### CSRF, on cached and streamed pages too

The action endpoint refuses a request the browser marks cross-site
(`Sec-Fetch-Site`, or an `Origin` that is not this host), and accepts one it
marks same-origin. That is the scheme of Go's `CrossOriginProtection` and
OWASP's "verify origin with standard headers". It is how a form on a cached
page posts: the page's shared HTML can never carry a visitor's token. A
request with neither header (an old browser, a script) must carry the
double-submit token, as before. That token is the `what-csrf` cookie echoed in
`X-CSRF-Token` or in the `_csrf`/`what-csrf-token` field, and uncached pages
still embed it. A token sent with a same-origin request is checked too. Pass
`csrf: { trustedOrigins: ['https://app.example'] }` to `createRequestHandler`
to let other origins of the same app post. (`examples/shop/test/shop.e2e.test.js`;
the shop's "Add to cart" in Chromium, `smoke/workspace-apps.mjs`)

## Route data and navigations

```jsx
import { Router } from 'what-framework/router';
import { query } from 'what-framework/data';

const user = (id) => query(['user', id], (key, { signal }) => fetch(`/api/users/${key[1]}`, { signal }).then((r) => r.json()), { staleTime: 30_000 });

const routes = [
  {
    path: '/users/:id',
    preload: ({ params }) => user(params.id),
    component: ({ data }) => <h1>{data().name}</h1>,
  },
];

export const App = () => <Router routes={routes} />;
```

- **`navigate()` and `<Link>` run as transitions.** The guards run first. Then
  the destination is prepared while the old page stays: its `lazy()` chunk
  loads, and its `preload({ params, query, url })` runs. Then the URL commits
  inside `startTransition`, so everything it reaches (a layout's data keyed on
  the params) commits in one flush. (`packages/router/test/navigation-transition.test.js`)
- **The navigation waits for what `preload` returns**: a query, an async value,
  a promise, or an array or object of them. The page gets it as its `data`
  prop, and a `query()` the page makes on the same key is answered from the
  cache. (`navigation-transition.test.js`, "keeps the old page until the
  preloaded data has landed")
- **A lazy route keeps the old page** until its chunk has loaded, with no
  fallback. On first load, the boundary's fallback shows as before. The rule
  is the transitions' own: they keep revealed content, and a boundary with
  nothing revealed yet shows its fallback (ASYNC.md, Transitions).
  (`packages/router/test/lazy-route-navigation.test.js`)
- **A `preload` that throws** renders the route's `error` component (or the
  nearest `<ErrorBoundary>`) with what it threw, and the navigation ends there;
  a promise it returns that rejects is the page's to show when it reads `data`.
  (`navigation-transition.test.js`, "a preload that throws")
- **On the server**, `<Router>` renders the URL of the request being rendered
  (`renderToStream(vnode, { request })`, `renderDocument(page, { request })`,
  the request handler), or its `url` prop, and runs that route's `preload` for
  the render alone. The page server-renders with its data; the client hydrates
  it and adopts the preloaded queries instead of fetching them.
  (`packages/router/test/server-render.test.js`)
- **Data the page reads that `preload` does not return** is fetched after the
  commit: the page shows it pending (its bindings hold, or its `<Suspense>`
  shows its fallback). The navigation goes on until that first data has
  landed: `route.isNavigating` stays true and `navigate()` resolves then. The
  page being left stays only while the destination prepares, because keeping it
  past the commit would take a second, off-screen build of the new page, which
  components that run once do not have (the reason in ASYNC.md, Limits). Return
  what the page needs at once from `preload`. (`navigation-transition.test.js`,
  "data the page reads beyond preload")
- A newer navigation supersedes one that is still preparing. `route.isNavigating`
  shows at once, also for a navigation started inside a transition, and is true
  until the destination's first data has landed. `useTransition`'s `isPending`
  around `navigate()` is true until the commit, and `await navigate()` inside the
  action resolves before it, since the navigation commits with the action. A
  route that declares `loading:` shows it instead of the old page while it
  prepares. (`navigation-transition.test.js`; `destination-loading.test.js`)
- **Back/forward and redirects** go through the same path.
  **View Transitions**: the browser's update callback is the commit, so the new
  state is captured once it is on screen. `navigate(to, { flushSync: true })`
  commits at once. (`navigation-transition.test.js`, "runs its commit inside a
  View Transition"; `popstate-lazy.test.js`; `navigation-api.test.js`)
- **Revalidation**: the queries a `preload` makes are tagged with the route's
  path, so `invalidatePath(path)` (a server action's `revalidate`) refetches
  the route data, inside the action's transition. (`navigation-transition.test.js`,
  "invalidatePath(path) refetches the route data")

## Response status, headers and redirects from the render tree

A loader receives `response`, and a component reaches the same object with
`getResponse()` (from `what-framework`): `setStatus(code)`,
`setHeader(name, value)`, `redirect(path, status)` and
`redirectExternal(url, status)`.

```jsx
import { getResponse } from 'what-framework';

function Post(props) {
  const post = props.post();
  if (post === null) {
    getResponse().setStatus(404);
    return <p>Not found</p>;
  }
  return <h1>{post.title}</h1>;
}
```

**The rule:** the response is committed with the first byte.

- A buffered render sends nothing before it has finished, so whatever a
  component sets counts. The buffered renders are `renderToString(vnode, { response })`,
  `renderToStringAsync`, `renderDocument`, and a route with `page.stream: false`.
- A streamed render sends its shell first. What the shell's components set
  counts, including a status decided by data read outside any `<Suspense>`:
  the shell waits for that data.
- What a boundary streamed after the shell sets does not count.
  `setStatus` and `setHeader` are ignored, with a development warning, and a
  redirect is sent as a script.

The Node adapter and the edge adapters (Cloudflare, Vercel) all send the
status line and headers the tree set. (`packages/server/test/response-render-tree.test.js`,
`packages/server/test/response-status-redirect.test.js`)

## Devtools

`what_cache` lists the cache: each key with its status (`loading`,
`refreshing`, `success`, `error`, `idle`), a value preview, its readers, how
long ago it landed, its last fetch, the paths it was read on, and `seq`.
`what_invalidate_cache { key }` invalidates a key (or a JSON array prefix, or
every entry). It returns the keys it matched and `since`, and
`what_events({ after: since })` shows the refetch as it lands.
(`packages/devtools-mcp/test/cache-page-side.test.js`, `tools.test.js`)

## Migrating from 0.14

- **`useQuery`'s `queryKey` may be a function.** A static array is still read
  once. A signal read inside `queryFn`/`fetcher` still refetches the entry,
  but the entry stays under the same key. Move such inputs into a function key.
- **`invalidateQueries` returns a promise** of the refetches. Code that ignored
  its return value is unchanged.
- **Callbacks fire once per landing**, for the reader that started the fetch.
  An invalidation's fetch belongs to the entry's first reader. Two readers of
  one key no longer both run `onSuccess` for one response.
- **A reader that unmounts while its key's only fetch is in flight cancels
  it**, and a remount fetches again. Before, a late response could land after
  the unmount.
- **`setQueryData` drops a fetch in flight for the key**, so a late response
  cannot overwrite the value just set.
- **what-server's `useAction`, `useFormAction`, `useMutation` and `formAction`
  are removed.** Use `useActionState` (`const [result, run, isPending] =
  useActionState((prev, args) => save(args), null)`), call the action inside
  `startTransition`, or pass it to `<Form action>`. To show an error, return it
  from the action (`return { error: e.message }`), or let it reach an
  `<ErrorBoundary>`.
- **`onRevalidate` and `invalidatePath` come from `what-framework/data`.**
  what-server re-exports them unchanged, and `invalidatePath(path)` now also
  refetches the queries read on `path`.
- **`<Form>` accepts a client function** (`useActionState`'s dispatch). It no
  longer warns about a missing CSRF token, because same-origin posts pass
  without one. It renders the token field only when it has a token.
- **The action endpoint refuses cross-site posts** (`Sec-Fetch-Site:
  cross-site`/`same-site`, or a foreign `Origin`) with 403, even when they carry a
  token. Another origin of the app posts through `csrf: { trustedOrigins }`.
- **A navigation waits for its destination's lazy chunk and `preload`** before
  it commits, so the old page stays where a boundary's fallback used to show.
  A navigation started while another is preparing supersedes it; before, it was
  dropped.
- **`renderToString(vnode, { response })`** takes a response to read back, and
  `renderToStringAsync` returns it as `response`.
