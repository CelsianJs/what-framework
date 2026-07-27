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

## Route Patterns

```js
{ path: '/users/:id', component: User }       // Dynamic param
{ path: '/docs/*', component: DocsLayout }     // Catch-all
{ path: '/blog/[slug]', component: Post }      // File-based syntax
{ path: '/[...rest]', component: CatchAll }    // Named catch-all
```

## Navigation

```js
import { navigate, route } from 'what-router';

// Programmatic navigation
navigate('/dashboard');
navigate('/login', { replace: true });
navigate('/page', { transition: false }); // skip View Transition

// Reactive route state
route.path;       // current path
route.params;     // { id: '123' }
route.query;      // { page: '1' }
route.hash;       // '#section'
route.isNavigating;
```

## Link Component

```jsx
<Link href="/about">About</Link>
<Link href="/about" activeClass="active" exactActiveClass="exact-active">About</Link>
<Link href="/about" replace prefetch={false}>About</Link>
```

Links automatically get `active` and `exact-active` CSS classes based on the current route. Hover prefetching is enabled by default.

## Nested Layouts

```js
import { defineRoutes, nestedRoutes, Outlet } from 'what-router';

function DashboardLayout({ children }) {
  return (
    <div>
      <Sidebar />
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
```

## Route Guards & Middleware

```js
import { guard, asyncGuard } from 'what-router';

// Sync guard
const requireAuth = guard(
  () => isLoggedIn(),
  '/login' // redirect on failure
);

const ProtectedPage = requireAuth(Dashboard);

// Async guard
const requireRole = asyncGuard(
  async () => await checkPermission('admin'),
  { fallback: '/unauthorized', loading: Spinner }
);

// Route-level middleware
{
  path: '/admin',
  component: AdminPanel,
  middleware: [authMiddleware, roleMiddleware],
}
```

`redirect()` is a middleware API. It throws a navigation signal, and the
Router's matching pass is the only place that signal can be caught, so it must
be called from middleware (or from anything the Router calls while matching):

```js
{
  path: '/admin',
  component: AdminPanel,
  middleware: [() => isLoggedIn() || redirect('/login')],
}
```

From a component body, an event handler or a promise callback, the Router has
already finished matching and nothing is left to catch the signal. `redirect()`
throws `ERR_REDIRECT_OUTSIDE_ROUTER` there instead of navigating silently. Use
`navigate(to)` or render `<Redirect to="/login" />`:

```js
function Private() {
  if (!isLoggedIn()) return h(Redirect, { to: '/login' });
  return h(Secret, {});
}
```

## View Transitions

Navigation uses the View Transitions API by default when available. Use helpers to customize:

```js
import { viewTransitionName, setViewTransition } from 'what-router';

// Name elements for transitions
<img {...viewTransitionName('hero-image')} src={url} />

// Set transition type
setViewTransition('slide');
```

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
| `route` | Reactive route state object |
| `useRoute()` | Hook returning computed route properties |
| `useParams()` | Current route params |
| `useSearch()` | Parsed query string of the last matched route (stale on a 404, like `route.query`) |
| `useNavigate()` | Returns `navigate` |
| `redirect(to, opts?)` | Abort route matching and navigate, **from route middleware** (throws, never returns) |
| `prefetchRoute(href)` | Prefetch a route's assets |
| `beforeNavigate(fn)` | Guard run before each route navigation (not hash links); return `false` to cancel |
| `afterNavigate(fn)` | Callback run after each committed navigation |
| `defineRoutes(config)` | Create routes from flat object |
| `nestedRoutes(base, children, opts?)` | Nested route helper |
| `routeGroup(name, routes, opts?)` | Group routes without affecting URL |
| `guard(check, fallback)` | Sync route guard |
| `asyncGuard(check, opts?)` | Async route guard |
| `Redirect` | Redirect component |
| `Outlet` | Nested route outlet |
| `FileRouter` | File-based router component |
| `prefetch(href)` | Prefetch a route's assets |
| `enableScrollRestoration()` | Enable scroll position restoration |
| `viewTransitionName(name)` | View Transition name helper |
| `setViewTransition(type)` | Set View Transition type |

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
