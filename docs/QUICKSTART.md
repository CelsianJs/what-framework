# Quick Start Guide

> The closest framework to vanilla JS. Signals, JSX, islands, SSR -- under 4 kB.

---

## Create a Project

The fastest way to get started:

```bash
npx create-what my-app
cd my-app
npm install
npm run dev
```

Open `http://localhost:5173`. You are running.

### Manual Setup with Vite

If you prefer to wire things up yourself:

```bash
mkdir my-app && cd my-app
npm init -y
npm install what-framework
npm install -D what-compiler vite
```

Create `vite.config.js`:

```js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

export default defineConfig({
  plugins: [what()],
});
```

Create `index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My App</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/app.jsx"></script>
</body>
</html>
```

Create `src/app.jsx`:

```jsx
import { mount, useSignal } from 'what-framework';

function App() {
  const count = useSignal(0);

  return (
    <div>
      <h1>Hello, What!</h1>
      <button onClick={() => count.set(c => c + 1)}>
        Clicked {count()} times
      </button>
    </div>
  );
}

mount(<App />, '#app');
```

Run `npx vite` and open `http://localhost:5173`.

---

## Project Structure

```
my-app/
├── src/
│   ├── app.jsx            # Entry point
│   ├── pages/             # File-based routes
│   │   ├── index.jsx      # /
│   │   ├── about.jsx      # /about
│   │   └── users/
│   │       └── [id].jsx   # /users/:id (dynamic)
│   ├── components/        # Shared components
│   ├── layouts/           # Page layouts
│   └── islands/           # Interactive islands
├── public/                # Static assets (copied as-is)
├── vite.config.js         # Vite + What compiler config
├── what.config.js         # Framework configuration (optional)
└── package.json
```

---

## Setting Up JSX (Recommended)

The `what-compiler` package provides a Vite plugin and a Babel plugin. All JSX is compiled to `h()` calls that flow through the core VNode reconciler -- one unified rendering path. The compiler handles:

- **h() output**: All JSX elements compile to `h(tag, props, ...children)` calls. Components, elements, and fragments all go through the same reconciler.
- **Event modifiers**: `onClick|preventDefault={handler}` compiles to an event handler that calls `e.preventDefault()` before your handler.
- **Two-way binding**: `<input bind:value={name} />` compiles to `{ value: name(), onInput: (e) => name.set(e.target.value) }`.
- **Island directives**: `<Search client:idle />` compiles to `h(Island, { component: Search, mode: 'idle' })`.
- **Control flow**: `<Show>`, `<For>`, `<Switch>`, `<Match>` are rendered as normal components through the reconciler.

### Vite Plugin

```js
// vite.config.js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

export default defineConfig({
  plugins: [what()],
});
```

### Babel Plugin (standalone)

For non-Vite toolchains:

```js
// babel.config.json
{
  "plugins": ["what-compiler/babel"]
}
```

---

## Your First Component

Components are plain functions that return JSX.

```jsx
import { mount, useSignal } from 'what-framework';

function Counter() {
  const count = useSignal(0);

  return (
    <div>
      <p>Count: {count()}</p>
      <button onClick={() => count.set(c => c + 1)}>+</button>
      <button onClick={() => count.set(c => c - 1)}>-</button>
    </div>
  );
}

mount(<Counter />, '#app');
```

`useSignal` creates reactive state scoped to the component. When `count` changes, only the text node containing `{count()}` updates. No diffing, no re-render of the entire component.

---

## Signals -- The Core Primitive

Signals are reactive values. When a signal changes, only the code that reads it re-runs. They work both inside and outside components.

```jsx
import { signal, computed, effect } from 'what-framework';

// Create a signal
const name = signal('World');

// Read
name();          // 'World'

// Write
name.set('What');
name.set(prev => prev + '!');   // updater function

// Peek (read without subscribing)
name.peek();

// Derived value (lazy, cached)
const greeting = computed(() => `Hello, ${name()}!`);

// Side effect (auto-tracks which signals it reads)
const dispose = effect(() => {
  document.title = greeting();
});

// Stop the effect
dispose();
```

### signal vs useSignal

| | `signal(initial)` | `useSignal(initial)` |
|---|---|---|
| **Where** | Anywhere -- module scope, stores, shared state | Inside components only |
| **Lifetime** | Lives until you discard the reference | Cleaned up when the component unmounts |
| **Use for** | Global state, cross-component data, module-level | Local component state |

```jsx
// Module-level state (shared across components)
const theme = signal('light');

function ThemeToggle() {
  // Component-local state
  const isOpen = useSignal(false);

  return (
    <div>
      <button onClick={() => isOpen.set(v => !v)}>
        {isOpen() ? 'Close' : 'Open'} menu
      </button>
      <button onClick={() => theme.set(t => t === 'light' ? 'dark' : 'light')}>
        Theme: {theme()}
      </button>
    </div>
  );
}
```

### You Don't Need Arrow Wrappers

Signal reads are tracked automatically — the component re-renders when signals change. Just call the signal directly:

```jsx
// JSX — signals work directly
function Counter() {
  const count = useSignal(0);
  return <p>Count: {count()}</p>;
}
```

```js
// h() — same thing, pass the value directly
function Counter() {
  const count = useSignal(0);
  return h('p', null, 'Count: ', count());
}
```

You do **not** need to wrap signal reads in arrow functions like `() => count()`. The framework wraps each component in a reactive effect, so any signal read inside the component body is automatically tracked and triggers a re-render when the signal changes.

> **Warning:** Do not pass functions as children to `h()`. `h()` stringifies non-vnode children, so `() => count()` renders as the literal text `"() => count()"`. Pass the value directly: `count()`.

### Batching Updates

Group multiple signal writes so effects only run once:

```jsx
import { batch } from 'what-framework';

batch(() => {
  firstName.set('Jane');
  lastName.set('Doe');
  // Effects that read firstName or lastName run once here, not twice
});
```

---

## Components

Components are functions. They receive props and return JSX.

```jsx
function Greeting({ name, children }) {
  return (
    <div>
      <h1>Hello, {name}</h1>
      {children}
    </div>
  );
}

// Usage
<Greeting name="World">
  <p>This is a child element.</p>
</Greeting>
```

### Conditional Rendering

```jsx
import { Show } from 'what-framework';

function Dashboard({ user }) {
  return (
    <Show when={user()} fallback={<p>Please log in.</p>}>
      <h1>Welcome, {user().name}</h1>
    </Show>
  );
}
```

Or use the `show` helper:

```jsx
import { show } from 'what-framework';

{show(isLoggedIn(), <Dashboard />, <LoginPage />)}
```

### List Rendering

```jsx
import { For } from 'what-framework';

function TodoList({ items }) {
  return (
    <ul>
      <For each={items()}>
        {(item) => <li key={item.id}>{item.text}</li>}
      </For>
    </ul>
  );
}
```

Or use the `each` helper:

```jsx
import { each } from 'what-framework';

{each(items(), (item) => <li key={item.id}>{item.text}</li>)}
```

### Lazy Loading and Error Boundaries

```jsx
import { lazy, Suspense, ErrorBoundary } from 'what-framework';

const HeavyChart = lazy(() => import('./components/Chart.jsx'));

function App() {
  return (
    <ErrorBoundary fallback={({ error }) => <p>Error: {error.message}</p>}>
      <Suspense fallback={<p>Loading chart...</p>}>
        <HeavyChart />
      </Suspense>
    </ErrorBoundary>
  );
}
```

---

## Hooks

React-familiar hooks, backed by signals under the hood.

### useSignal

The recommended hook for component state. Returns a signal directly.

```jsx
import { useSignal } from 'what-framework';

function Toggle() {
  const isOn = useSignal(false);

  return (
    <button onClick={() => isOn.set(v => !v)}>
      {isOn() ? 'ON' : 'OFF'}
    </button>
  );
}
```

### useEffect

Run side effects. Return a cleanup function.

```jsx
import { useSignal, useEffect } from 'what-framework';

function Timer() {
  const seconds = useSignal(0);

  useEffect(() => {
    const id = setInterval(() => seconds.set(s => s + 1), 1000);
    return () => clearInterval(id);   // cleanup
  }, []);

  return <p>Elapsed: {seconds()}s</p>;
}
```

### useRef

Get a stable reference to a DOM element.

```jsx
import { useRef, useEffect } from 'what-framework';

function AutoFocusInput() {
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current.focus();
  }, []);

  return <input ref={inputRef} placeholder="I focus on mount" />;
}
```

### useState (React Compatibility)

If you prefer the `[value, setter]` tuple pattern:

```jsx
import { useState } from 'what-framework';

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <button onClick={() => setCount(c => c + 1)}>
      Count: {count}
    </button>
  );
}
```

`useSignal` is preferred because it avoids the array allocation and gives you direct access to `.set()`, `.peek()`, and `.subscribe()`.

### Other Hooks

```jsx
import {
  useMemo,        // memoized derived value
  useCallback,    // stable function reference
  useReducer,     // state + reducer pattern
  useContext,      // read from context
  createContext,   // create a context
} from 'what-framework';
```

---

## Routing

### File-Based Routing

Drop files into `src/pages/` and routes are generated automatically:

```
src/pages/index.jsx         -> /
src/pages/about.jsx         -> /about
src/pages/blog/[slug].jsx   -> /blog/:slug
src/pages/docs/[...path].jsx -> /docs/* (catch-all)
```

### Programmatic Routing

```jsx
import { Router, Link, navigate, defineRoutes } from 'what-framework/router';

const routes = defineRoutes({
  '/':          Home,
  '/about':     { component: About, layout: MainLayout },
  '/users/:id': UserProfile,
});

function App() {
  return <Router routes={routes} fallback={NotFound} />;
}

// Declarative navigation
<Link href="/about">About</Link>

// Imperative navigation
navigate('/users/42');
navigate('/login', { replace: true });
```

### Route State

Access the current route reactively from any component:

```jsx
import { route } from 'what-framework/router';

function Breadcrumb() {
  return (
    <nav>
      <span>Current path: {route.path}</span>
      <span>Params: {JSON.stringify(route.params)}</span>
      <span>Query: {JSON.stringify(route.query)}</span>
    </nav>
  );
}
```

### Nested Layouts

```jsx
const routes = defineRoutes({
  '/dashboard': {
    component: DashboardLayout,
    children: [
      { path: '',         component: DashboardHome },
      { path: 'settings', component: Settings },
      { path: 'profile',  component: Profile },
    ],
  },
});
```

### Route Guards

```jsx
import { guard } from 'what-framework/router';

const requireAuth = guard(
  () => isAuthenticated(),
  '/login'   // redirect target
);

const ProtectedDashboard = requireAuth(Dashboard);
```

### View Transitions

Navigation uses the View Transitions API automatically when the browser supports it:

```jsx
navigate('/new-page', { transition: true });   // enabled by default
navigate('/new-page', { transition: false });  // opt out
```

---

## Islands Architecture

Ship zero JS by default. Hydrate interactive components independently. The rest of the page remains static HTML.

### With JSX Directives (Compiler)

When using `what-compiler`, add a `client:` directive to mark interactive components:

```jsx
import Search from './islands/Search.jsx';
import Cart from './islands/Cart.jsx';

function ProductPage() {
  return (
    <div>
      <Nav />                          {/* Static -- zero JS */}
      <Search client:idle />           {/* Hydrates when browser is idle */}
      <ProductDescription />           {/* Static -- zero JS */}
      <Cart client:visible />          {/* Hydrates when scrolled into view */}
      <Footer />                       {/* Static -- zero JS */}
    </div>
  );
}
```

### Without a Compiler

```jsx
import { island, Island } from 'what-framework/server';

// Register islands with hydration strategy
island('search', () => import('./islands/Search.js'), { mode: 'idle' });
island('cart',   () => import('./islands/Cart.js'),   { mode: 'visible' });

function ProductPage() {
  return (
    <div>
      <Nav />
      <Island name="search" />
      <ProductDescription />
      <Island name="cart" props={{ items: [] }} />
      <Footer />
    </div>
  );
}
```

### Hydration Modes

| Mode      | When it hydrates                      | Use for                    |
|-----------|---------------------------------------|----------------------------|
| `load`    | Immediately on page load              | Critical interactive UI    |
| `idle`    | When the browser is idle              | Most islands (default)     |
| `visible` | When scrolled into the viewport       | Below-the-fold content     |
| `action`  | On first click, focus, or hover       | Rarely-used widgets        |
| `media`   | When a media query matches            | Mobile-only or desktop-only UI |
| `static`  | Never (stays as HTML)                 | Non-interactive content    |

### Shared State Across Islands

Islands can share reactive state through island stores:

```jsx
import { createIslandStore } from 'what-framework/server';

const cartStore = createIslandStore('cart', { items: [], total: 0 });

// Both islands read from and write to the same store
// AddToCartButton island
function AddToCartButton({ product }) {
  return (
    <button onClick={() => {
      cartStore.items = [...cartStore.items, product];
    }}>
      Add to Cart
    </button>
  );
}

// CartSummary island
function CartSummary() {
  return <span>Items in cart: {cartStore.items.length}</span>;
}
```

---

## Forms

React Hook Form-style API with built-in validation and two-way binding.

```jsx
import { useForm, rules, simpleResolver, show } from 'what-framework';

function SignupForm() {
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { email: '', password: '' },
    resolver: simpleResolver({
      email:    [rules.required(), rules.email()],
      password: [rules.required(), rules.minLength(8)],
    }),
  });

  const onSubmit = async (data) => {
    await fetch('/api/signup', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('email')} placeholder="Email" />
      {show(formState.errors().email,
        <span class="error">{formState.errors().email?.message}</span>
      )}
      <input {...register('password')} type="password" placeholder="Password" />
      {show(formState.errors().password,
        <span class="error">{formState.errors().password?.message}</span>
      )}
      <button type="submit">Sign Up</button>
    </form>
  );
}
```

### Two-Way Binding (Compiler)

With `what-compiler`, bind a signal directly to an input:

```jsx
function SearchBox() {
  const query = useSignal('');

  return (
    <div>
      <input bind:value={query} placeholder="Search..." />
      <p>You typed: {query()}</p>
    </div>
  );
}
```

### Built-In Validation Rules

`required`, `email`, `url`, `minLength`, `maxLength`, `min`, `max`, `pattern`, `match`, `custom`.

Zod and Yup resolvers are also available:

```jsx
import { zodResolver } from 'what-framework';
import { z } from 'zod';

const { register, handleSubmit } = useForm({
  resolver: zodResolver(z.object({
    email: z.string().email(),
    password: z.string().min(8),
  })),
});
```

---

## Data Fetching

SWR-style data fetching with automatic caching and revalidation.

```jsx
import { useSWR } from 'what-framework';

function UserProfile({ userId }) {
  const { data, error, isLoading, mutate } = useSWR(
    `user-${userId}`,
    // The fetcher receives (key, { signal }) — pass signal to fetch for abort support
    (key, { signal }) => fetch(`/api/users/${userId}`, { signal }).then(r => r.json()),
    { revalidateOnFocus: true }
  );

  if (isLoading()) return <p>Loading...</p>;
  if (error()) return <p>Error loading user.</p>;

  return (
    <div>
      <h2>{data().name}</h2>
      <p>{data().email}</p>
      <button onClick={() => mutate()}>Refresh</button>
    </div>
  );
}
```

### useQuery (TanStack Query-style)

```jsx
import { useQuery } from 'what-framework';

const { data, isLoading, isError, refetch } = useQuery({
  queryKey: ['todos', userId],
  queryFn: () => fetch(`/api/todos?user=${userId}`).then(r => r.json()),
  staleTime: 60000,
  retry: 3,
});
```

### Infinite Scrolling

```jsx
import { useInfiniteQuery } from 'what-framework';

const { data, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
  queryKey: ['posts'],
  queryFn: ({ pageParam }) => fetchPosts(pageParam),
  getNextPageParam: (lastPage) => lastPage.nextCursor,
  initialPageParam: 0,
});
```

---

## Animation

Physics-based springs and easing-based tweens.

```jsx
import { spring, useGesture } from 'what-framework';

function DraggableCard() {
  const x = spring(0, { stiffness: 200, damping: 20 });
  const scale = spring(1);
  const ref = { current: null };

  useGesture(ref, {
    onDragStart: () => scale.set(1.05),
    onDrag: ({ deltaX }) => x.set(deltaX),
    onDragEnd: () => { x.set(0); scale.set(1); },
  });

  return (
    <div
      ref={ref}
      style={() => ({
        transform: `translateX(${x.current()}px) scale(${scale.current()})`,
      })}
    >
      Drag me
    </div>
  );
}
```

### Tween

```jsx
import { tween, easings } from 'what-framework';

const opacity = tween(0, 1, {
  duration: 300,
  easing: easings.easeOutCubic,
  onComplete: () => console.log('done'),
});
```

---

## Global State

`createStore` gives you a reactive store with computed properties and actions.

```jsx
import { createStore, derived } from 'what-framework';

const useAuth = createStore({
  user: null,                                             // state
  isLoggedIn: derived(state => state.user !== null),      // computed
  login(userData) { this.user = userData; },              // action (uses `this`)
  logout() { this.user = null; },                         // action
});

function Profile() {
  const { user, isLoggedIn, logout } = useAuth();

  return isLoggedIn ? (
    <div>
      Welcome, {user.name}
      <button onClick={logout}>Logout</button>
    </div>
  ) : (
    <p>Please log in.</p>
  );
}
```

For simple global values, use `signal` at module scope:

```jsx
// stores/theme.js
import { signal } from 'what-framework';

export const theme = signal('light');
export const toggleTheme = () => theme.set(t => t === 'light' ? 'dark' : 'light');
```

---

## Authoring Without a Build Step

You do not need JSX or a compiler. What provides two build-free alternatives.

### h() Function

```js
import { h, mount, useSignal } from 'what-framework';

function Counter() {
  const count = useSignal(0);

  return h('div', null,
    h('p', null, 'Count: ', count()),
    h('button', { onClick: () => count.set(c => c + 1) }, '+'),
    h('button', { onClick: () => count.set(c => c - 1) }, '-'),
  );
}

mount(h(Counter), '#app');
```

Signal reads like `count()` are called directly — the component re-renders when signals change (same as JSX). Do **not** wrap them in arrow functions — `h()` stringifies function children, so `() => count()` renders as literal text. The JSX compiler produces the same `h()` calls but also handles `bind:`, event modifiers, and island directives.

### html Tagged Template

```js
import { html, mount, signal } from 'what-framework';

const count = signal(0);

const view = html`
  <div>
    <p>Count: ${() => count()}</p>
    <button onclick=${() => count.set(c => c + 1)}>+</button>
  </div>
`;

mount(view, '#app');
```

---

## Configuration

```js
// what.config.js
export default {
  mode: 'hybrid',           // 'static' | 'server' | 'client' | 'hybrid'
  pagesDir: 'src/pages',    // file-based routing directory
  outDir: 'dist',           // build output directory
  islands: true,             // enable islands architecture
};
```

### Rendering Modes

Each page can override the global mode:

```jsx
import { definePage } from 'what-framework/server';

// Static: pre-rendered at build time (fastest, zero JS)
export default definePage({ mode: 'static',  component: HomePage });

// Server: rendered on each request
export default definePage({ mode: 'server',  component: DashboardPage });

// Client: SPA, rendered entirely in the browser
export default definePage({ mode: 'client',  component: AppPage });

// Hybrid: static HTML shell with interactive islands
export default definePage({ mode: 'hybrid',  component: ProductPage });
```

---

## CLI Commands

Install the CLI globally or use `npx`:

```bash
npm install -g what-framework-cli
```

| Command         | Description                          |
|-----------------|--------------------------------------|
| `what dev`      | Start dev server with HMR            |
| `what build`    | Production build with minification   |
| `what preview`  | Preview the production build locally |
| `what generate` | Static site generation (SSG)         |
| `what init`     | Scaffold a new project               |

```bash
what dev              # http://localhost:5173
what dev --port 8080  # custom port
what build            # outputs to dist/
what preview          # serves dist/ on port 4000
what generate         # pre-renders all pages to static HTML
```

---

## Bundle Size

| Module          | Size (gzip) |
|-----------------|-------------|
| Core (signals)  | ~1.5 kB     |
| Hooks           | ~0.8 kB     |
| Router          | ~1.0 kB     |
| Islands client  | ~0.5 kB     |
| **Total**       | **~3.8 kB** |

The compiler (`what-compiler`) is a dev dependency and adds zero bytes to your production bundle.

---

## Comparison

| Feature              | What       | React  | Solid  | Svelte | Astro  |
|----------------------|------------|--------|--------|--------|--------|
| Signals              | Yes        |        | Yes    | Yes    |        |
| Islands architecture | Yes        |        |        |        | Yes    |
| SSR + SSG            | Yes        | Yes    | Yes    | Yes    | Yes    |
| File-based routing   | Yes        |        |        |        | Yes    |
| No compiler required | Yes*       |        |        |        |        |
| React-style hooks    | Yes        | Yes    |        |        |        |
| Bundle size (gzip)   | ~4 kB      | ~40 kB | ~7 kB  | ~2 kB  | 0 kB** |

*What works without a compiler using `h()` or `` html` ` ``. The compiler is optional and recommended for the best authoring experience.

**Astro ships zero framework JS by default but requires a UI framework (React, Solid, etc.) for interactive islands.

---

## Package Reference

| Package | npm Name | Purpose |
|---------|----------|---------|
| Core framework | `what-framework` | Signals, components, hooks, utilities |
| Router | `what-framework/router` | Client-side routing |
| Server | `what-framework/server` | SSR, SSG, islands |
| Testing | `what-framework/testing` | Test utilities, render, fireEvent |
| Compiler | `what-compiler` | Vite plugin (`what-compiler/vite`), Babel plugin (`what-compiler/babel`) |
| CLI | `what-framework-cli` | Dev server, build, generate |
| Scaffolder | `create-what` | `npx create-what my-app` |

---

## Next Steps

- [API Reference](./API.md) -- Complete API documentation for every export.
- [Styling Guide](./STYLING.md) -- CSS patterns, conditional classes, and dynamic styles.
- [Development Guide](./DEVELOPMENT.md) -- Contributing, testing, and project structure.
