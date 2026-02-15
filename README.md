# What

**Build fast websites with islands of interactivity.**

What is a signals-based JavaScript framework with an islands architecture, JSX with superpowers, and a core runtime under 2kB gzipped. Ship static HTML by default. Hydrate interactive pieces on demand.

```jsx
import { signal, mount } from 'what-framework';

function Counter() {
  const count = signal(0);

  return (
    <div>
      <h1>Count: {count}</h1>
      <button onClick={() => count.set(c => c + 1)}>+</button>
      <button onClick={() => count.set(0)}>Reset</button>
    </div>
  );
}

mount(<Counter />, '#app');
```

## Why What?

- **Signals-based reactivity** -- Fine-grained updates that skip the virtual DOM. When a signal changes, only the exact DOM nodes that depend on it update. No tree diffing, no wasted re-renders.

- **Islands architecture** -- Zero JavaScript by default. Hydrate interactive components only when needed -- on scroll, on click, when idle, or when a media query matches. Six hydration modes with priority-based scheduling.

- **Tiny bundle** -- Core runtime is ~2kB gzipped. Add the router, SSR, forms, animations, and data fetching as you need them.

- **JSX with superpowers** -- Event modifiers (`onClick|preventDefault`), two-way binding (`bind:value`), island directives (`client:idle`, `client:visible`). JSX compiles to `h()` calls that flow through the core VNode reconciler -- one unified rendering path.

- **Works without a build step** -- Use `h()` calls or the `html` tagged template literal directly in the browser. No compiler required.

- **React-familiar API** -- `useState`, `useEffect`, `useMemo`, `useRef`, `useContext`, `useReducer` -- backed by signals for better performance.

---

## Quick Start

### Scaffold a new project

```bash
npx create-what my-app
cd my-app
npm install
npm run dev
```

Open `http://localhost:5173`. You're running.

### Manual setup with Vite

```bash
npm install what-framework what-compiler
```

Configure Vite:

```js
// vite.config.js
import { defineConfig } from 'vite';
import whatVitePlugin from 'what-compiler/vite';

export default defineConfig({
  plugins: [whatVitePlugin()],
});
```

Create your entry point:

```jsx
// src/main.jsx
import { signal, mount } from 'what-framework';

function App() {
  const name = signal('World');

  return (
    <div>
      <h1>Hello, {name}!</h1>
      <input
        bind:value={name}
        placeholder="Type your name"
      />
    </div>
  );
}

mount(<App />, '#app');
```

---

## Features at a Glance

| Feature | What You Get |
|---------|-------------|
| **Signals** | Fine-grained reactivity, no virtual DOM diffing |
| **Islands** | Zero JS by default, 6 hydration modes, priority queue |
| **~2kB core** | Tiny runtime; add extras as needed |
| **JSX compiler** | Compiles to h() calls, event modifiers, two-way binding, island directives, SVG |
| **React-like hooks** | `useState`, `useEffect`, `useMemo` -- backed by signals |
| **File-based routing** | Drop files in `pages/`, get routes with nested layouts |
| **SSR / SSG / Hybrid** | Choose per-page: static, server, or client rendering |
| **View transitions** | Native page transitions via the View Transitions API |
| **Forms & validation** | `useForm` with Zod/Yup support and built-in rules |
| **Data fetching** | SWR-like hooks with caching, revalidation, and infinite queries |
| **Animations** | Physics-based springs, tweens, easing functions, gesture handling |
| **Accessibility** | Focus traps, ARIA helpers, roving tab index, screen reader announcements |
| **TypeScript** | Full type definitions included |
| **Testing** | Testing-library-style utilities at `what-framework/testing` |

---

## Examples

### Counter

```jsx
import { signal, mount } from 'what-framework';

function Counter() {
  const count = signal(0);

  return (
    <div class="counter">
      <p>Count: {count}</p>
      <button onClick={() => count.set(c => c + 1)}>Increment</button>
      <button onClick={() => count.set(0)}>Reset</button>
    </div>
  );
}

mount(<Counter />, '#app');
```

### Todo List

```jsx
import { signal, computed, mount } from 'what-framework';

function TodoApp() {
  const todos = signal([]);
  const filter = signal('all');
  const input = signal('');

  const filtered = computed(() => {
    const list = todos();
    if (filter() === 'active') return list.filter(t => !t.done);
    if (filter() === 'done') return list.filter(t => t.done);
    return list;
  });

  const add = () => {
    if (!input().trim()) return;
    todos.set(t => [...t, { id: Date.now(), text: input(), done: false }]);
    input.set('');
  };

  const toggle = (id) => {
    todos.set(t => t.map(item =>
      item.id === id ? { ...item, done: !item.done } : item
    ));
  };

  return (
    <div>
      <input bind:value={input} onKeyDown|preventDefault={e => e.key === 'Enter' && add()} />
      <button onClick={add}>Add</button>
      <ul>
        {() => filtered().map(todo => (
          <li
            key={todo.id}
            style={{ textDecoration: todo.done ? 'line-through' : 'none' }}
            onClick={() => toggle(todo.id)}
          >
            {todo.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

mount(<TodoApp />, '#app');
```

### Islands with Hydration Directives

Islands are the framework's strongest feature. Each interactive component hydrates independently with its own strategy. The rest of the page is static HTML with zero JavaScript.

```jsx
import { island, Island } from 'what-framework/server';

// Register islands with hydration strategies
island('header', () => import('./islands/header.js'), { mode: 'load' });
island('cart',   () => import('./islands/cart.js'),   { mode: 'action' });
island('comments', () => import('./islands/comments.js'), { mode: 'visible' });
island('newsletter', () => import('./islands/newsletter.js'), { mode: 'idle' });
island('sidebar', () => import('./islands/sidebar.js'), { mode: 'media', media: '(min-width: 768px)' });

export default function HomePage() {
  return (
    <div>
      <Island name="header" />            {/* Hydrates immediately */}
      <main>
        <h1>Welcome</h1>                  {/* Static -- no JS */}
        <p>Static content here.</p>        {/* Static -- no JS */}
        <Island name="cart" />             {/* Hydrates on first click/focus/hover */}
      </main>
      <Island name="comments" />           {/* Hydrates when scrolled into view */}
      <Island name="newsletter" />         {/* Hydrates when browser is idle */}
      <Island name="sidebar" />            {/* Hydrates when viewport >= 768px */}
    </div>
  );
}
```

With the JSX compiler, you can also use client directives directly on components:

```jsx
<Cart client:idle />
<Comments client:visible />
<Sidebar client:media="(min-width: 768px)" />
```

**Six hydration modes:**

| Mode | When it hydrates |
|------|-----------------|
| `load` | Immediately on page load |
| `idle` | When the browser is idle (`requestIdleCallback`) |
| `visible` | When scrolled into the viewport (`IntersectionObserver`) |
| `action` | On first user interaction (click, focus, hover, touch) |
| `media` | When a CSS media query matches |
| `static` | Never -- pure HTML, zero JS shipped |

### Form with Validation

```jsx
import { mount, useForm, rules, simpleResolver, Show } from 'what-framework';

function SignupForm() {
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { email: '', password: '' },
    resolver: simpleResolver({
      email: [rules.required(), rules.email()],
      password: [rules.required(), rules.minLength(8)],
    }),
  });

  const onSubmit = async (data) => {
    await fetch('/api/signup', { method: 'POST', body: JSON.stringify(data) });
  };

  return (
    <form onSubmit|preventDefault={handleSubmit(onSubmit)}>
      <input {...register('email')} placeholder="Email" />
      <Show when={() => formState.errors().email}>
        <span class="error">{() => formState.errors().email?.message}</span>
      </Show>

      <input {...register('password')} type="password" placeholder="Password" />
      <Show when={() => formState.errors().password}>
        <span class="error">{() => formState.errors().password?.message}</span>
      </Show>

      <button type="submit" disabled={() => formState.isSubmitting()}>
        {() => formState.isSubmitting() ? 'Signing up...' : 'Sign Up'}
      </button>
    </form>
  );
}

mount(<SignupForm />, '#app');
```

### Data Fetching

```jsx
import { mount, useSWR, Skeleton, Show } from 'what-framework';

function UserProfile({ userId }) {
  const { data, error, isLoading } = useSWR(
    `user-${userId}`,
    () => fetch(`/api/users/${userId}`).then(r => r.json()),
    { revalidateOnFocus: true }
  );

  return (
    <Show when={() => !isLoading()} fallback={<Skeleton width="100%" height={200} />}>
      <Show when={() => !error()} fallback={<p class="error">Failed to load user</p>}>
        <div class="profile">
          <img src={() => data().avatar} />
          <h2>{() => data().name}</h2>
          <p>{() => data().bio}</p>
        </div>
      </Show>
    </Show>
  );
}
```

---

## Authoring Options

### JSX (Recommended)

JSX is the recommended way to write What components. The compiler handles signal auto-unwrapping, event modifiers, two-way binding, island directives, and static content hoisting.

Install the compiler:

```bash
npm install what-compiler
```

**Vite plugin:**

```js
// vite.config.js
import { defineConfig } from 'vite';
import whatVitePlugin from 'what-compiler/vite';

export default defineConfig({
  plugins: [whatVitePlugin()],
});
```

**Babel plugin** (for other build tools):

```js
// babel.config.js
export default {
  plugins: ['what-compiler/babel'],
};
```

**Compiler features:**

| Feature | Syntax | What it does |
|---------|--------|-------------|
| h() output | `<div>` → `h('div', ...)` | All JSX compiles to h() calls through the core reconciler |
| Event modifiers | `onClick\|preventDefault` | Compiles modifier chain into the handler |
| Two-way binding | `bind:value={signal}` | Compiles to `{ value: sig(), onInput: e => sig.set(e.target.value) }` |
| Island directives | `client:idle`, `client:visible` | Compiles to `h(Island, { component, mode })` |
| Control flow | `<Show>`, `<For>`, `<Switch>` | Rendered as normal components through the reconciler |
| SVG support | `<svg>`, `<path>`, etc. | Reconciler detects SVG and uses correct namespace |

### h() Function (No Build Step)

The `h()` function works anywhere JavaScript runs -- no compiler needed.

```js
import { h, signal, mount } from 'what-framework';

function Counter() {
  const count = signal(0);

  return h('div', null,
    h('p', null, 'Count: ', () => count()),
    h('button', { onClick: () => count.set(c => c + 1) }, 'Increment'),
    h('button', { onClick: () => count.set(0) }, 'Reset'),
  );
}

mount(h(Counter), '#app');
```

### html Tagged Template (No Build Step)

For an HTML-like syntax without a build step, use the `html` tagged template:

```js
import { html, signal, mount } from 'what-framework';

function Counter() {
  const count = signal(0);

  return html`
    <div>
      <p>Count: ${() => count()}</p>
      <button onClick=${() => count.set(c => c + 1)}>Increment</button>
      <button onClick=${() => count.set(0)}>Reset</button>
    </div>
  `;
}

mount(html`<${Counter} />`, '#app');
```

---

## CLI Commands

The `what-framework-cli` package provides the `what` command:

```bash
what dev        # Dev server with WebSocket HMR
what build      # Production build with minification and content hashing
what preview    # Preview the production build locally
what generate   # Static site generation (pre-render all pages)
```

---

## Configuration

```js
// what.config.js
export default {
  mode: 'hybrid',        // 'static' | 'server' | 'client' | 'hybrid'
  pagesDir: 'src/pages', // Directory for file-based routing
  outDir: 'dist',        // Build output directory
  islands: true,         // Enable islands architecture
};
```

---

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| **what-framework** | `npm i what-framework` | Core runtime: signals, hooks, components, SSR, islands |
| **what-compiler** | `npm i what-compiler` | JSX compiler (Babel plugin + Vite plugin) |
| **what-framework-cli** | `npm i what-framework-cli` | CLI: dev server, build, preview, generate |
| **create-what** | `npx create-what` | Project scaffolding |

**Subpath exports for `what-framework`:**

| Import | What you get |
|--------|-------------|
| `what-framework` | Signals, hooks, components, forms, data fetching, animations, a11y |
| `what-framework/router` | Router, Link, NavLink, route guards, view transitions |
| `what-framework/server` | `renderToString`, `renderToStream`, islands, SSG helpers, server actions |
| `what-framework/testing` | Testing utilities (render, fire events, query helpers) |

**Subpath exports for `what-compiler`:**

| Import | What you get |
|--------|-------------|
| `what-compiler/vite` | Vite plugin |
| `what-compiler/babel` | Babel plugin |

---

## Documentation

- [Quick Start Guide](docs/QUICKSTART.md)
- [API Reference](docs/API.md)
- [Development Guide](docs/DEVELOPMENT.md)
- [Styling Guide](docs/STYLING.md)

---

## Philosophy

1. **Ship less JavaScript** -- Islands and signals mean the client only runs code where interactivity is needed. Static content stays static.
2. **Vanilla-first** -- Write JavaScript, not framework DSLs. Components are functions. State is signals. The mental model is small.
3. **No magic** -- Explicit is better than implicit. You can see exactly what triggers updates and when code loads.
4. **Progressive enhancement** -- Start with static HTML. Add interactivity where it matters. Every page works before JavaScript loads.
5. **Developer experience** -- Fast dev server, helpful errors, TypeScript definitions, and familiar APIs for anyone coming from React or Solid.

---

## License

MIT
