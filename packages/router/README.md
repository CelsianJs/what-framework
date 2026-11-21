# what-router

Client-side router for [What Framework](https://whatfw.com). Supports dynamic routes, nested layouts, route groups, middleware, View Transitions API, scroll restoration, and prefetching.

## Install

```bash
npm install what-router what-core
```

Or use via the main package:

```js
import { Router, Link, navigate } from 'what-framework/router';
```

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

A route object can also carry `layout`, `loading` (shown while a navigation to
it is in flight), `error` (an error boundary fallback) and `middleware`.
`<Router>` takes `routes`, `fallback` (the 404 page, and what a middleware that
returns `false` shows) and `globalLayout` (rendered once around every page).

## Navigation

```js
import { navigate, route } from 'what-router';

// Programmatic navigation
navigate('/dashboard');
navigate('/login', { replace: true });
navigate('/page', { transition: false }); // skip View Transition

// Route state: getters on the global `route` object. Read inside a binding,
// an effect or a computed, they subscribe, so the reader updates on navigation.
route.path;         // current path
route.params;       // { id: '123' }
route.query;        // { page: '1' }
route.hash;         // '#section'
route.url;          // path + search + hash
route.isNavigating; // true while a navigation is in flight
route.error;
```

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
`{ params, query, children }`.

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
  // Route-level middleware: called with { path, params, query, route }
  { path: '/admin', component: AdminOnly, middleware: [() => isLoggedIn() || '/login'] },
];
```

Route middleware is **synchronous**: return `true` or nothing to continue,
`false` to show the Router fallback (403 by default), or a path string to
redirect. Returning a promise or thenable throws `ERR_ASYNC_MIDDLEWARE` before
the protected component mounts. The Router observes rejections but does not
await or use async middleware results.

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
transition for one navigation.

## Scroll Restoration

```js
import { enableScrollRestoration } from 'what-router';

enableScrollRestoration(); // call once at app entry
```

## API

| Export | Description |
|---|---|
| `Router` | Route matching component |
| `Link` / `NavLink` | Navigation link with active states |
| `navigate(to, opts?)` | Programmatic navigation |
| `route` | Route state: `url`, `path`, `params`, `query`, `hash`, `isNavigating` and `error` are getters that subscribe when read in a binding, effect or computed |
| `useRoute()` | `{ path, params, query, hash, isNavigating }` as computeds (call them: `path()`), plus `navigate` and `prefetch` |
| `useParams()` | The current params, read when called (call it inside a binding or effect to track changes) |
| `useSearch()` | Parsed query string of the last matched route, read when called (stale on a 404, like `route.query`) |
| `useNavigate()` | Returns `navigate` |
| `redirect(to, opts?)` | Abort route matching and navigate, **from route middleware or a component body** (throws, never returns) |
| `prefetchRoute(href)` | Prefetch a route's assets |
| `beforeNavigate(fn)` | Guard run before each route navigation (not hash links); return `false` to cancel |
| `afterNavigate(fn)` | Callback run after each committed navigation |
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
