# what-router

Client-side router for [What Framework](https://whatfw.com). Supports dynamic routes, nested layouts, route groups, middleware, View Transitions API, scroll restoration, and prefetching.

## Install

An app made with `npm create what@latest` already has it: import it from the
main package, which depends on it.

```js
import { Router, Link, navigate } from 'what-framework/router';
```

On its own: `npm install what-router what-core`, and import from `what-router`.
The examples below import from `what-router`; in an app on `what-framework`,
write `what-framework/router`.

A route's data is its `preload` ([Route data](#route-data-preload)), on the
client and in a server render. A page's server `loader` (what
`useLoaderData()` reads) belongs to what-server's full-stack pages, not to
this router.

## Quick Start

```jsx
import { mount } from 'what-framework';
import { Router, Link, navigate } from 'what-router';

function Home() {
  return <h1>Home</h1>;
}

function User({ params }) {
  return <h1>User {params.id}</h1>;
}

function App() {
  return (
    <div>
      <nav>
        <Link href="/">Home</Link>
        <Link href="/users/1">User 1</Link>
      </nav>
      <Router
        routes={[
          { path: '/', component: Home },
          { path: '/users/:id', component: User },
        ]}
      />
    </div>
  );
}

mount(<App />, '#app');
```

A route component receives `{ params, query, route }`. Destructuring them is
fine: when the URL changes, the Router renders the matched route again with the
new values.

## Route Patterns

```js
const routes = [
  { path: '/users/:id', component: User },        // dynamic param: params.id
  { path: '/docs/*', component: DocsPage },       // catch-all: params.rest
  { path: '/blog/[slug]', component: Post },      // file-based syntax: params.slug
  { path: '/files/[...path]', component: Files }, // named catch-all: params.path
];
```

When several routes match a URL, the most specific wins, whatever order they
are listed in: a static segment before a param, fewer params before more, a
catch-all last, and of two catch-alls the one below more static segments
(`/docs/*` before `*`).

A route object can also carry `layout`, `loading` (shown instead of the page
being left while a navigation to it is in flight; without one, the old page
stays), `error` (an error boundary fallback), `middleware` and `preload`
(below).
`<Router>` takes `routes`, `fallback` (the 404 page, and what a middleware that
returns `false` shows) and `globalLayout` (rendered once around every page).

## Navigation

A navigation is a transition. `navigate()` and `<Link>` run the
`beforeNavigate` guards, then prepare the destination while the old page
stays on screen: they load a `lazy()` route's chunk and run its `preload`,
and wait for both. A route its `middleware` declines is not prepared, so its
`preload` never runs for a page that does not show. Then the URL commits inside `startTransition`, so
everything the new URL reaches (the page, and a layout's data keyed on the
params) commits in one flush. A newer navigation supersedes one still
preparing. Back/forward and redirects take the same path.

```js
import { navigate, route } from 'what-router';

// Programmatic navigation: resolves once the new page is on screen and the
// data it reads first has landed
navigate('/dashboard');
navigate('/login', { replace: true });
navigate('/page', { transition: false }); // skip View Transition
navigate('/page', { flushSync: true });   // commit at once, without holding for async values
navigate('/settings#teams');              // on /settings: a fragment navigation (below)
navigate('https://example.com/docs');     // another origin: the browser loads it (below)

// Route state: getters on the global `route` object. Read inside a binding,
// an effect or a computed, they subscribe, so the reader updates on navigation.
// During a server render they answer for the request being rendered.
route.path;         // current path
route.params;       // { id: '123' }
route.query;        // { page: '1' }; a repeated key is an array: ?tag=a&tag=b -> { tag: ['a', 'b'] }
route.hash;         // '#section'
route.url;          // path + search + hash
route.isNavigating; // true from navigate() until the new page's first data has landed
route.error;
```

A navigation that changes only the hash (`navigate('#teams')`, or
`navigate('/settings#teams')` while on `/settings`, a `<Link>` to either, the
browser moving the hash with back/forward or `location.hash`) is a fragment
navigation, as in the browser: the page stays mounted with its state, the URL
and `route.hash` move, and the element with that id scrolls into view. No
guard, middleware or `preload` runs, and `afterNavigate` is not called. A
`'#hash'` target replaces the history entry; a path with a hash adds one
unless `replace: true`. A replaced entry keeps its `history.state` unless you
pass `state`, so `navigate()` to the URL on screen changes nothing.

A URL of another origin (another site, `mailto:`, `tel:`) is the browser's to
load, as a click on a `<Link>` to it is: `navigate()` calls
`location.assign()`, or `location.replace()` with `replace: true`, and runs no
guard. A middleware or `redirect()` that sends a navigation to another origin
replaces the entry the same way.

## Base path

An app deployed below a path (`/app/` on GitHub Pages or behind a reverse
proxy) routes below it. With Vite, its `base` is the router's: set
`base: '/app/'` in `vite.config.js` and nothing else.

```js
// Without Vite's base (another bundler, or a server build that keeps
// what-router external): once, before the app renders, in code the client
// and the server both run
import { setBase } from 'what-router';
setBase('/app'); // or setBase(import.meta.env.BASE_URL)
```

Below the base, a path from the root is a URL of the app: `<Link href="/x">`
renders and goes to `/app/x`, `navigate('/x')`, `redirect('/x')` and a
middleware returning `'/x'` go to `/app/x`, and route paths are written as
without a base (`{ path: '/x' }`). Route state holds the URL without the base:
`route.url`, `route.path`, the params, `useRoute()`, active links, and what
middleware, `preload` and the navigation hooks are given. A relative href
(`'8'`, `'?page=2'`, `'#top'`) resolves against the address bar as the browser
resolves it. A URL outside the base is not the app's: no route shows it (a
catch-all included: the Router shows its `fallback`, and `route.url` and
`route.path` are `''`), and `navigate()` and `<Link>` leave it to the browser.
A server render of a request below the base renders the same page, and its
redirects go below the base. A base that is not a path from the root (Vite's
`./`, a CDN's URL) is no base. what-server's `createRequestHandler({ basePath })`
is the server's own: set it to the same path.

## Route data: `preload`

```jsx
import { query } from 'what-framework/data';

const user = (id) => query(['user', id], (key, { signal }) => fetch(`/api/users/${key[1]}`, { signal }).then((r) => r.json()), { staleTime: 30_000 });

export const routes = [
  {
    path: '/users/:id',
    preload: ({ params }) => user(params.id),
    component: ({ data }) => <h1>{data().name}</h1>,
  },
];
```

`preload({ params, query, url })` runs when a navigation prepares the route
(and on its first render). The navigation waits for what it returns: a
`query()`, an async value, a promise, or an array or object of them. The
page receives it as its `data` prop, and a `query()` the page makes on the
same key is answered from the cache. The queries a preload makes are read
on the route's path, so `invalidatePath('/users/7')` (a server action's
`revalidate`) refetches them. `route.isNavigating`, or `useTransition`'s
`isPending` around a `navigate()` call, shows the progress.

Data the page reads that `preload` does not return is fetched after the URL
commits: the page shows it pending, and the navigation (`route.isNavigating`,
the promise `navigate()` returns) goes on until it has landed. Only `preload`
data keeps the old page on screen. A `preload` that throws renders the
route's `error` component (or the nearest `<ErrorBoundary>`) with what it
threw; a promise it returns that rejects is the page's to show when it reads
`data`.

On the server, `<Router>` renders the URL of the request being rendered (the
`request` a render is given: `renderToStream(vnode, { request })`,
`renderDocument(page, { request })`, the request handler), or its `url` prop,
and runs that route's `preload` for the render, once its middleware has
admitted it. The page server-renders with its data, and the client hydrates
it and adopts the data instead of fetching it again. See
[DATA.md](https://github.com/CelsianJs/what-framework/blob/main/docs/DATA.md).

Route state on the server is the render's own: `route.url`, `route.path`,
`route.hash`, `route.query`, `route.params`, `useParams()`, `useSearch()` and
`useRoute()` read the request being rendered (the URL with its query and
hash, and the params and query its `<Router>` matched), so overlapping
requests never see each other's. Without an async context provider
(AsyncLocalStorage; what-server installs one where the host has it), a read
after an `await` in a component sees no route state at all (the root URL,
empty params and query), never another request's. A middleware redirect (a
path, or `redirect()`), `<Redirect>` and a `guard()` path fallback redirect
the render's response (`getResponse().redirect(to)`, a same-origin path) on
the server, and so do `redirect()` thrown from a component body and
`navigate()`: a server never navigates, and nothing a render does reaches the
route state of another one. A `beforeNavigate` or `afterNavigate` subscribed
on a server (while it renders, or after an `await` with no async context) is
not kept. A `<Router>` inside another one has route state of its own: its
`url` (on the server) and the params and query it matched are read by what it
renders, and never change what its parent's subtree reads. The URL is split as
`URL` splits it: a second `?` belongs to a value (`?q=a?b` is `{ q: 'a?b' }`),
`??a=1` is the key `?a`, and a navigation to `/old/../find` commits `/find`,
as the address bar does.

## Link Component

```jsx
import { Link } from 'what-router';

function Nav() {
  return (
    <nav>
      <Link href="/about">About</Link>
      <Link href="/about" activeClass="active" exactActiveClass="exact-active">About</Link>
      <Link href="/about" replace prefetch={false} transition={false}>About</Link>
    </nav>
  );
}
```

Links automatically get `active` and `exact-active` CSS classes based on the current route. Hover prefetching is enabled by default. An unsafe `href` (`javascript:`, `data:`, a protocol-relative URL) renders as `about:blank`.

## Nested Layouts

```jsx
import { Router, Link, nestedRoutes } from 'what-router';

function DashboardHome() {
  return <h1>Dashboard</h1>;
}

function Settings() {
  return <h1>Settings</h1>;
}

function DashboardLayout({ children }) {
  return (
    <div>
      <nav>
        <Link href="/dashboard">Home</Link>
        <Link href="/dashboard/settings">Settings</Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}

const routes = [
  ...nestedRoutes('/dashboard', [
    { path: '/', component: DashboardHome },
    { path: '/settings', component: Settings },
  ], { layout: DashboardLayout }),
];

export default function App() {
  return <Router routes={routes} />;
}
```

`nestedRoutes(base, children, { layout, loading, error })` prefixes each child's
path and gives it the options it does not set itself. A layout receives
`{ params, query, children }`. It stays mounted, with its state, its DOM and
what the visitor typed into it, while the visitor moves between routes that
share it: only the page in `children` changes. A change of params
(`/projects/1` to `/projects/2`) or of the query string (`?tab=2`, a search box
that writes `?q=`) keeps it too. The layout is built again only when the chain
of layouts changes.

`params` and `query` are live props: JSX in the layout that reads
`params.id` or `query.tab` shows the current URL's. A read in the layout's
body, outside JSX, is a read once, as in any component, and keeps the first
value (the compiler does not report this shape):

```jsx
function ProjectLayout({ params, query, children }) {
  const firstId = params.id;               // read once: stays the id the layout was built with
  return (
    <section>
      <h1>Project {params.id}</h1>         {/* follows /projects/:id */}
      <p>Tab: {query.tab ?? 'overview'}</p>{/* follows ?tab= */}
      <input placeholder="Notes" />        {/* keeps what was typed when the URL changes */}
      {children}
    </section>
  );
}
```

To act on a change, read the param where it runs: an effect with no
dependency array, `useEffect(() => load(params.id))`, runs again when the id
changes, and so does a `computed(() => params.id)` read in JSX. A page is
built again whenever its URL changes, so a page's `params.id` is always its
URL's.

## Route Guards & Middleware

```jsx
import { signal } from 'what-framework';
import { guard, asyncGuard } from 'what-router';

const user = signal(null, 'user');
const isLoggedIn = () => user() !== null;

function Dashboard() {
  return <h1>Dashboard</h1>;
}

function AdminPanel() {
  return <h1>Admin</h1>;
}

function Spinner() {
  return <p>Checking…</p>;
}

// Sync guard: renders the component when check(props) is truthy; otherwise
// navigates to the path (or renders the component) given as the fallback
const ProtectedDashboard = guard(isLoggedIn, '/login')(Dashboard);

// Async guard: renders `loading` until the promise settles
const AdminOnly = asyncGuard(
  async () => (await fetch('/api/me/admin')).ok,
  { fallback: '/unauthorized', loading: Spinner },
)(AdminPanel);

const routes = [
  { path: '/dashboard', component: ProtectedDashboard },
  // Route-level middleware: called with { path, url, params, query, route },
  // where `url` is the whole destination (path + search + hash)
  { path: '/admin', component: AdminOnly, middleware: [() => isLoggedIn() || '/login'] },
];
```

Route middleware is **synchronous**: return `true` or nothing to continue,
`false` to show the Router fallback (403 by default), or a path string to
redirect. Returning a promise or thenable throws `ERR_ASYNC_MIDDLEWARE` before
the protected component mounts. The Router observes rejections but does not
await or use async middleware results. Middleware runs before the route's
`preload`, on the client and on the server, and a route it declines is never
prepared. It runs once for a navigation: the page renders by the verdict the
navigation reached (a redirect it returned, a decline, an error it threw), and
it runs again only when a signal it read changes (a logout re-checks the page
on screen). A middleware that starts another navigation supersedes its own:
the route it was asked about is not prepared.

For async authorization, wrap the route component instead:

```js
import { asyncGuard } from 'what-router';

const routes = [
  {
    path: '/admin',
    component: asyncGuard(check, {
      fallback: '/unauthorized',
      loading: Spinner,
    })(AdminPanel),
  },
  // Without custom options (fallback '/login', no loading view):
  // component: asyncGuard(check)(AdminPanel)
];
```

Client-side guards control rendering and navigation; enforce authorization
separately on the server.

`redirect()` throws a navigation signal. Two places catch it: route middleware,
and a component body.

```jsx
import { redirect } from 'what-router';

const routes = [
  {
    path: '/admin',
    component: AdminPanel,
    middleware: [() => isLoggedIn() || redirect('/login')],
  },
];

function Private() {
  if (!isLoggedIn()) redirect('/login');
  return <Secret />;
}
```

From an event handler, a promise callback or a timer, nothing catches the
signal and it surfaces as an uncaught error carrying `ERR_REDIRECT_NOT_CAUGHT`.
Call `navigate(to)` there instead. A `try/catch` around a `redirect()` call
also swallows the signal, so rethrow anything whose `name` is `RouterRedirect`.

## View Transitions

Navigation uses the View Transitions API by default when available. Use helpers to customize:

```jsx
import { viewTransitionName, setViewTransition } from 'what-router';

// Name an element so the browser animates it from one page to the next
function Hero(props) {
  return <img {...viewTransitionName('hero-image')} src={props.src} alt="" />;
}

// Set data-transition="slide" on <html>, for your transition CSS to select on
setViewTransition('slide');
```

`navigate(to, { transition: false })` and `<Link transition={false}>` skip the
View Transition for one navigation. The browser's update callback is the
commit: the new state is captured once the new page is on screen, after the
destination was prepared.

## Scroll Restoration

```js
import { enableScrollRestoration } from 'what-router';

enableScrollRestoration(); // call once at app entry
```

Back and forward restore the position saved for the entry they land on,
with or without `enableScrollRestoration()`, as the browser restores one: a
URL with a hash lands at its saved position, not at its element first. With
it, a forward navigation goes to the hash's element, else to the position
saved for that URL, else to the top.

## API

| Export | Description |
|---|---|
| `Router` | Route matching component |
| `Link` / `NavLink` | Navigation link with active states |
| `navigate(to, opts?)` | Navigate as a transition: prepare the destination (lazy chunk, `preload`), then commit; `{ replace, state, transition, flushSync }` |
| `setBase(base)` | Serve the app below `base` ([Base path](#base-path)); without a call, Vite's `base` |
| `route` | Route state: `url`, `path`, `params`, `query`, `hash`, `isNavigating` and `error` are getters that subscribe when read in a binding, effect or computed |
| `useRoute()` | `{ path, params, query, hash, isNavigating }` as computeds (call them: `path()`), plus `navigate` and `prefetch` |
| `useParams()` | The current params, read when called (call it inside a binding or effect to track changes) |
| `useSearch()` | Parsed query string of the last matched route, read when called (stale on a 404, like `route.query`); typed `RouteQuery`, `Record<string, string \| string[]>` |
| `useNavigate()` | Returns `navigate` |
| `redirect(to, opts?)` | Abort route matching and navigate, **from route middleware or a component body** (throws, never returns) |
| `prefetchRoute(href)` | Prefetch a route's assets |
| `beforeNavigate(fn)` | Guard run before each route navigation (not a fragment navigation); return `false` to cancel |
| `afterNavigate(fn)` | Callback run after each committed route navigation (not a fragment navigation) |
| `defineRoutes(config)` | Create routes from flat object |
| `nestedRoutes(base, children, opts?)` | Nested route helper |
| `routeGroup(name, routes, opts?)` | Group routes without affecting URL |
| `guard(check, fallback)` | Sync route guard: `guard(check, fallback)(Component)` |
| `asyncGuard(check, opts?)` | Async route guard: `asyncGuard(check, { fallback, loading })(Component)` |
| `Redirect` | `<Redirect to="/path" />` navigates there (replacing the entry) when it renders |
| `Outlet` | Renders its `children` |
| `FileRouter` | Router for the routes what-compiler's file router generates (`import { routes } from 'virtual:what-routes'`); takes `routes`, `layout`, `fallback` and `error` |
| `prefetch(href)` | Prefetch a route's assets (adds `<link rel="prefetch">`) |
| `matchRoute`, `compilePath`, `parseQuery` | The route matcher, without DOM access; also at `what-router/match` for servers |
| `isSafeUrl(url)` | The check `navigate`, `Link` and `redirect` apply to a target |
| `enableScrollRestoration()` | Enable scroll position restoration |
| `viewTransitionName(name)` | View Transition name helper |
| `setViewTransition(type)` | Set View Transition type |

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
