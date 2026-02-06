# What Framework — Quick Start Guide

> The closest framework to vanilla JS.

## Create a Project

```bash
npx create-what my-app
cd my-app
npm install
npm run dev
```

Open `http://localhost:3000`. You're running.

## Project Structure

```
my-app/
├── src/
│   ├── app.js           # Entry point
│   ├── index.html        # HTML shell
│   ├── pages/            # File-based routes
│   │   ├── index.js      # /
│   │   ├── about.js      # /about
│   │   └── users/
│   │       └── [id].js   # /users/:id (dynamic)
│   ├── components/       # Shared components
│   ├── layouts/          # Page layouts
│   └── islands/          # Interactive islands
├── public/               # Static assets (copied as-is)
├── what.config.js        # Configuration (optional)
└── package.json
```

## Your First Component

```js
import { h, mount, useState } from 'what';

function Counter() {
  const [count, setCount] = useState(0);

  return h('div', null,
    h('p', null, 'Count: ', count),
    h('button', { onClick: () => setCount(c => c + 1) }, '+'),
    h('button', { onClick: () => setCount(c => c - 1) }, '-'),
  );
}

mount(h(Counter), '#app');
```

## Signals (The Core Primitive)

Signals are reactive values. When a signal changes, only the code that reads it re-runs.

```js
import { signal, computed, effect } from 'what';

// Create
const name = signal('World');

// Read
console.log(name());  // 'World'

// Write
name.set('What');
name.set(prev => prev + '!');  // updater function

// Peek (read without tracking)
name.peek();

// Computed (derived, lazy)
const greeting = computed(() => `Hello, ${name()}!`);

// Effect (side effect, auto-tracks deps)
const dispose = effect(() => {
  document.title = greeting();
});

// Stop the effect
dispose();
```

## Components

Components are functions. They receive props and return VNodes.

```js
function Greeting({ name, children }) {
  return h('div', null,
    h('h1', null, 'Hello, ', name),
    children,
  );
}

// Use it
h(Greeting, { name: 'World' },
  h('p', null, 'This is a child'),
);
```

## Hooks

React-familiar hooks, backed by signals:

```js
import {
  useState,       // [value, setter]
  useSignal,      // raw signal (more efficient)
  useEffect,      // side effects with cleanup
  useMemo,        // memoized computation
  useCallback,    // stable function reference
  useRef,         // mutable ref, no re-render
  useReducer,     // state + reducer
  useContext,      // context value
} from 'what';

function Timer() {
  const [seconds, setSeconds] = useState(0);
  const ref = useRef(null);

  useEffect(() => {
    ref.current = setInterval(() => {
      setSeconds(s => s + 1);
    }, 1000);
    return () => clearInterval(ref.current);
  }, []);

  const formatted = useMemo(() => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }, [seconds]);

  return h('p', null, formatted);
}
```

## Routing

### File-based (automatic)

```
src/pages/index.js         → /
src/pages/about.js         → /about
src/pages/blog/[slug].js   → /blog/:slug
src/pages/docs/[...path].js → /docs/* (catch-all)
```

### Programmatic

```js
import { Router, Link, navigate, defineRoutes } from 'what/router';

const routes = defineRoutes({
  '/':           Home,
  '/about':      { component: About, layout: MainLayout },
  '/users/:id':  UserProfile,
});

function App() {
  return h(Router, { routes, fallback: NotFound });
}

// Navigation
h(Link, { href: '/about' }, 'About')   // declarative
navigate('/users/42');                   // imperative
navigate('/login', { replace: true });   // replace history
```

## Islands Architecture

Ship zero JS by default. Hydrate interactive parts independently.

```js
import { island, Island } from 'what/server';

// Register islands with hydration strategy
island('search', () => import('./islands/search.js'), { mode: 'idle' });
island('cart', () => import('./islands/cart.js'), { mode: 'action' });

// In your page:
function Page() {
  return h('div', null,
    h(Nav),                        // Static — zero JS
    h(Island, { name: 'search' }), // Hydrates on idle
    h(StaticContent),              // Static — zero JS
    h(Island, { name: 'cart' }),   // Hydrates on click
    h(Footer),                     // Static — zero JS
  );
}
```

### Hydration Modes

| Mode      | When it hydrates                      | Use for                    |
|-----------|---------------------------------------|----------------------------|
| `load`    | Immediately on page load              | Critical interactive UI    |
| `idle`    | When browser is idle                  | Most islands (default)     |
| `visible` | When scrolled into viewport           | Below-the-fold content     |
| `action`  | On first click/focus/hover            | Rarely-used widgets        |
| `media`   | When media query matches              | Mobile/desktop-only UI     |
| `static`  | Never (pure HTML)                     | Non-interactive content    |

## Rendering Modes

Each page can choose its rendering mode:

```js
import { definePage } from 'what/server';

// Static: pre-rendered at build time
export default definePage({
  mode: 'static',
  component: HomePage,
});

// Server: rendered on each request
export default definePage({
  mode: 'server',
  component: DashboardPage,
});

// Client: SPA, rendered in browser
export default definePage({
  mode: 'client',
  component: AppPage,
});

// Hybrid: static shell + interactive islands
export default definePage({
  mode: 'hybrid',
  component: ProductPage,
  islands: ['search', 'cart'],
});
```

## Global State (Store)

```js
import { createStore } from 'what';

const useAuth = createStore({
  user: null,
  isLoggedIn: (state) => state.user !== null,  // computed
  login(userData) { this.user = userData; },     // action
  logout() { this.user = null; },
});

function Profile() {
  const { user, isLoggedIn, logout } = useAuth();

  return isLoggedIn
    ? h('div', null, 'Welcome, ', user.name, h('button', { onClick: logout }, 'Logout'))
    : h('p', null, 'Please log in');
}
```

## Utilities

```js
import { show, each, cls, Head } from 'what';

// Conditional rendering
show(isLoggedIn, h(Dashboard), h(LoginPage))

// List rendering
each(items, (item) => h('li', { key: item.id }, item.name))

// Conditional classes
cls('btn', isActive && 'btn-active', { disabled: isDisabled })

// Head management (from any component)
h(Head, { title: 'My Page', meta: [{ name: 'description', content: '...' }] })
```

## Configuration

```js
// what.config.js
export default {
  mode: 'hybrid',        // default rendering mode
  pagesDir: 'src/pages', // file-based routing directory
  outDir: 'dist',        // build output
  islands: true,         // enable islands architecture
  port: 3000,            // dev server port
};
```

## CLI Commands

```bash
what dev        # Start dev server with HMR
what build      # Production build
what preview    # Preview production build
what generate   # Static site generation (SSG)
```

## Deployment

```bash
# Static hosting (Netlify, Vercel, Cloudflare Pages)
what generate
# Deploy the dist/ folder

# Node server
what build
node dist/server.js
```

No Docker. No complex configuration. Just build and deploy.

## Bundle Size

| Module          | Size (gzip) |
|-----------------|-------------|
| Core (signals)  | ~1.5 kB     |
| Hooks           | ~0.8 kB     |
| Router          | ~1.0 kB     |
| Islands client  | ~0.5 kB     |
| **Total**       | **~3.8 kB** |

## Comparison

| Feature              | What   | React  | Solid  | Svelte | Astro  |
|----------------------|--------|--------|--------|--------|--------|
| Signals              | ✓      |        | ✓      | ✓      |        |
| No virtual DOM       |        |        | ✓      | ✓      |        |
| Islands              | ✓      |        |        |        | ✓      |
| SSR + SSG            | ✓      | ✓      | ✓      | ✓      | ✓      |
| File routing         | ✓      |        |        |        | ✓      |
| Zero config          | ✓      |        |        |        |        |
| No compiler needed   | ✓      |        |        |        |        |
| React hooks API      | ✓      | ✓      |        |        |        |
| Bundle size          | ~4 kB  | ~40 kB | ~7 kB  | ~2 kB  | 0 kB*  |

*Astro ships zero JS by default but requires framework JS for islands.
