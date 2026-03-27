# What Framework -- Agent Coding Guide

The definitive reference for AI agents writing What Framework code. WhatFW is the first framework built for AI agents: small API surface, structured errors, MCP DevTools for live debugging, and guardrails that catch common mistakes at dev time.

## Why WhatFW for Agents

1. **Small API.** ~30 core exports. Agents memorize fewer APIs and make fewer hallucination errors.
2. **MCP DevTools.** 18 MCP tools let agents inspect live signals, effects, components, DOM, and cache without browser access.
3. **Structured errors.** Runtime errors include error codes, affected signal/effect IDs, and suggested fixes.
4. **Guardrails.** The compiler and ESLint plugin catch signal misuse, missing reactive wrappers, and stale closures before runtime.
5. **Components run once.** No re-render mental model to track. Signal reads drive DOM updates directly.
6. **No virtual DOM.** Agents never need to reason about reconciliation, keys-for-performance, or shouldComponentUpdate.

---

## Quick Start -- Minimum Viable Component

```bash
npm create what@latest my-app
cd my-app
npm install
npm run dev
```

```jsx
// src/main.jsx
import { mount, useSignal } from 'what-framework';

function Hello() {
  const name = useSignal('World');
  return (
    <div>
      <h1>Hello, {name()}</h1>
      <input value={name()} onInput={e => name.set(e.target.value)} />
    </div>
  );
}

mount(<Hello />, '#app');
```

The compiler is required. It transforms JSX into optimized `template()` + `insert()` + `effect()` calls. `create-what` wires up Vite + the compiler automatically.

---

## Core Concepts

### Signals

Reactive values. Read with `()`, write with `.set()`.

```jsx
import { useSignal } from 'what-framework';

const count = useSignal(0);
count();                    // read: 0
count.set(5);               // write: 5
count.set(c => c + 1);      // updater: 6
count.peek();               // read without tracking
```

### Computed

Lazy derived values. Auto-track dependencies.

```jsx
import { useComputed } from 'what-framework';

const doubled = useComputed(() => count() * 2);
doubled();  // reads count, returns derived value
```

### Effects

Side effects that re-run when tracked signals change. Flushed via microtask (not synchronous).

```jsx
import { useEffect } from 'what-framework';

useEffect(() => {
  console.log('Count changed to:', count());
  return () => console.log('cleanup');
});
```

### Components

Functions that execute **once**. They return real DOM nodes. Dynamic expressions become individual effects bound to specific DOM nodes.

```jsx
function Counter() {
  const count = useSignal(0);
  // This function body runs exactly once
  return (
    <div>
      <p>{count()}</p>
      <button onClick={() => count.set(c => c + 1)}>+</button>
    </div>
  );
}
```

### Stores

Global state shared across components.

```jsx
import { createStore, derived } from 'what-framework';

const useAuth = createStore({
  user: null,
  token: null,
  isLoggedIn: derived(state => state.user() !== null),
});
```

---

## 10 Copy-Paste Patterns

### 1. Counter

```jsx
import { mount, useSignal } from 'what-framework';

function Counter() {
  const count = useSignal(0);
  return (
    <div>
      <p>Count: {count()}</p>
      <button onClick={() => count.set(c => c + 1)}>+</button>
      <button onClick={() => count.set(c => c - 1)}>-</button>
      <button onClick={() => count.set(0)}>Reset</button>
    </div>
  );
}

mount(<Counter />, '#app');
```

### 2. Todo List

```jsx
import { mount, useSignal } from 'what-framework';

function TodoApp() {
  const todos = useSignal([]);
  const input = useSignal('');

  const addTodo = () => {
    if (!input().trim()) return;
    todos.set(prev => [...prev, { id: Date.now(), text: input(), done: false }]);
    input.set('');
  };

  const toggle = (id) => {
    todos.set(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  return (
    <div>
      <input value={input()} onInput={e => input.set(e.target.value)} />
      <button onClick={addTodo}>Add</button>
      <ul>
        {todos().map(todo => (
          <li key={todo.id} onClick={() => toggle(todo.id)}
              style={{ textDecoration: todo.done ? 'line-through' : 'none' }}>
            {todo.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

mount(<TodoApp />, '#app');
```

### 3. Form with Validation

```jsx
import { mount, useForm, ErrorMessage, rules, simpleResolver } from 'what-framework';

function LoginForm() {
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { email: '', password: '' },
    resolver: simpleResolver({
      email: [rules.required(), rules.email()],
      password: [rules.required(), rules.minLength(8)],
    }),
  });

  return (
    <form onSubmit={handleSubmit(async (values) => console.log(values))}>
      <input {...register('email')} placeholder="Email" />
      <ErrorMessage name="email" formState={formState} />

      <input {...register('password')} type="password" placeholder="Password" />
      {formState.errors.password && <span>{formState.errors.password.message}</span>}

      <button type="submit">Log In</button>
    </form>
  );
}

mount(<LoginForm />, '#app');
```

### 4. Data Fetching

```jsx
import { mount, useSWR, Spinner } from 'what-framework';

function UserProfile({ userId }) {
  const { data, error, isLoading } = useSWR(
    `user-${userId}`,
    () => fetch(`/api/users/${userId}`).then(r => r.json())
  );

  if (isLoading()) return <Spinner />;
  if (error()) return <p>Error: {error().message}</p>;

  return (
    <div>
      <h2>{data().name}</h2>
      <p>{data().email}</p>
    </div>
  );
}

mount(<UserProfile userId="1" />, '#app');
```

### 5. Conditional Rendering

```jsx
import { mount, useSignal, Show } from 'what-framework';

function Toggle() {
  const visible = useSignal(false);

  return (
    <div>
      <button onClick={() => visible.set(v => !v)}>Toggle</button>

      {/* Ternary style */}
      {visible() ? <p>Visible via ternary</p> : null}

      {/* Show component style */}
      <Show when={visible()} fallback={<p>Hidden</p>}>
        <p>Visible via Show</p>
      </Show>
    </div>
  );
}

mount(<Toggle />, '#app');
```

### 6. List with For

```jsx
import { mount, useSignal, For } from 'what-framework';

function ItemList() {
  const items = useSignal([
    { id: 1, name: 'Apple' },
    { id: 2, name: 'Banana' },
    { id: 3, name: 'Cherry' },
  ]);

  return (
    <ul>
      <For each={items} key={item => item.id}>
        {(item, index) => <li>{() => item().name}</li>}
      </For>
    </ul>
  );
}

mount(<ItemList />, '#app');
```

### 7. Dialog with Focus Management

```jsx
import { mount, useSignal, useFocusRestore, FocusTrap } from 'what-framework';

function DialogExample() {
  const open = useSignal(false);
  const focusRestore = useFocusRestore();

  const onOpen = (e) => {
    focusRestore.capture(e.currentTarget);
    open.set(true);
  };

  const onClose = () => {
    open.set(false);
    focusRestore.restore();
  };

  return (
    <>
      <button onClick={onOpen}>Open Dialog</button>
      {open() ? (
        <FocusTrap>
          <div role="dialog" aria-modal="true">
            <h2>Dialog Title</h2>
            <p>Dialog content here.</p>
            <button onClick={onClose}>Close</button>
          </div>
        </FocusTrap>
      ) : null}
    </>
  );
}

mount(<DialogExample />, '#app');
```

### 8. Context (Theme)

```jsx
import { mount, createContext, useContext, useSignal } from 'what-framework';

const ThemeContext = createContext('light');

function ThemeToggle() {
  const theme = useContext(ThemeContext);
  return <p>Current theme: {theme}</p>;
}

function App() {
  const theme = useSignal('light');
  return (
    <ThemeContext.Provider value={theme()}>
      <button onClick={() => theme.set(t => t === 'light' ? 'dark' : 'light')}>
        Toggle Theme
      </button>
      <ThemeToggle />
    </ThemeContext.Provider>
  );
}

mount(<App />, '#app');
```

### 9. Client-Side Routing

```jsx
import { mount } from 'what-framework';
import { Router, Link } from 'what-framework/router';

function Home() { return <h1>Home</h1>; }
function About() { return <h1>About</h1>; }
function NotFound() { return <h1>404</h1>; }

function App() {
  return (
    <div>
      <nav>
        <Link href="/">Home</Link>
        <Link href="/about">About</Link>
      </nav>
      <Router
        routes={[
          { path: '/', component: Home },
          { path: '/about', component: About },
        ]}
        fallback={<NotFound />}
      />
    </div>
  );
}

mount(<App />, '#app');
```

### 10. Island (Partial Hydration)

```jsx
// pages/index.jsx -- mostly static, one interactive island
import { Island } from 'what-framework';

function HomePage() {
  return (
    <div>
      <header>Static header -- zero JS</header>
      <main>
        <p>Static content -- zero JS</p>
        <Island name="search" mode="action">
          {/* Hydrates only on first user interaction */}
          <SearchWidget />
        </Island>
      </main>
      <footer>Static footer -- zero JS</footer>
    </div>
  );
}
```

Island modes: `load` (immediate), `idle` (requestIdleCallback), `visible` (IntersectionObserver), `action` (click/focus/hover), `media` (media query), `static` (never hydrate).

---

## MCP Tools Reference

WhatFW ships two MCP servers:

- **`what-mcp`** -- Static documentation server (13 tools). Provides API docs, examples, and search.
- **`what-devtools-mcp`** -- Live debugging bridge (18 tools). Connects to a running app via WebSocket.

### Setup

Add to your MCP client config (Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "what-framework": {
      "command": "npx",
      "args": ["what-mcp"]
    },
    "what-devtools": {
      "command": "npx",
      "args": ["what-devtools-mcp"]
    }
  }
}
```

For live debugging, add the Vite plugin:

```js
// vite.config.js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';
import whatDevToolsMCP from 'what-devtools-mcp/vite-plugin';

export default defineConfig({
  plugins: [what(), whatDevToolsMCP({ port: 9229 })],
});
```

### DevTools MCP Tools (18 total)

#### Read Tools (9)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `what_connection_status` | Check if a browser app is connected | -- |
| `what_signals` | List signals with current values | `filter` (regex), `id` (number) |
| `what_effects` | List effects with deps and run counts | `minRunCount`, `filter`, `depSignalId` |
| `what_components` | List mounted components | `filter` (regex) |
| `what_snapshot` | Full state snapshot | `maxSignals`, `maxEffects` |
| `what_errors` | Captured runtime errors | `since` (timestamp) |
| `what_cache` | SWR/useQuery cache entries | `key` (substring) |
| `what_component_tree` | Component hierarchy with signal/effect counts | `rootId`, `depth`, `filter` |
| `what_dependency_graph` | Signal-to-effect dependency graph | `signalId`, `effectId`, `direction` |

#### Write Tools (2)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `what_set_signal` | Set a signal value in the running app | `signalId`, `value` |
| `what_invalidate_cache` | Force-refresh a cache key | `key` |

#### Observe Tools (1)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `what_watch` | Collect reactive events over a time window | `duration` (ms), `filter` (regex) |

#### Inspection Tools (3)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `what_eval` | Execute JS in the browser context | `code`, `timeout` |
| `what_dom_inspect` | Get rendered DOM of a component | `componentId`, `depth` |
| `what_diagnose` | Comprehensive health check | `focus` (errors/performance/reactivity/all) |

#### Navigation Tools (2)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `what_route` | Get current route info | -- |
| `what_navigate` | Navigate to a path | `path`, `replace` |

#### Diff Tool (1)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `what_diff_snapshot` | Compare state between two points | `action` (save/diff) |

### Example MCP Workflow

```
Agent: what_connection_status
  -> "Connected. App has 12 signals, 8 effects, 5 components."

Agent: what_diagnose { focus: "all" }
  -> "2 issues found (warning). 1 effect with runCount > 50..."

Agent: what_effects { minRunCount: 50 }
  -> "effect_3 (runCount: 247, deps: [count, filter])"

Agent: what_dependency_graph { effectId: 3 }
  -> "signal count -> effect_3, signal filter -> effect_3"

Agent: what_diff_snapshot { action: "save" }
  -> "Baseline saved."
  ... user interacts ...
Agent: what_diff_snapshot { action: "diff" }
  -> "3 signals changed, 2 effects re-ran."
```

### Documentation MCP Tools (13)

| Tool | Description |
|------|-------------|
| `what_overview` | Framework overview |
| `what_signals` | Signals documentation |
| `what_components` | Components and h() |
| `what_hooks` | React-compatible hooks |
| `what_islands` | Islands architecture |
| `what_routing` | Routing documentation |
| `what_forms` | Form utilities |
| `what_data_fetching` | SWR and query hooks |
| `what_animation` | Springs, tweens, gestures |
| `what_accessibility` | A11y utilities |
| `what_skeleton` | Skeleton loaders |
| `what_ssr` | SSR/SSG/hybrid rendering |
| `what_cli` | CLI commands and config |
| `what_search` | Search all docs by query |

---

## Error Code Reference

Error codes follow the pattern `ERR_*`. When an error is thrown, it includes the code, the affected signal/effect/component ID (when applicable), and a suggested fix.

| Code | Severity | Message | Fix |
|------|----------|---------|-----|
| `ERR_INFINITE_EFFECT` | error | Effect exceeded 25 flush iterations — likely an infinite loop | Use `untrack()` to read a signal without subscribing, or split the read and write into separate effects |
| `ERR_MISSING_SIGNAL_READ` | warning | Signal used without calling `()` — renders as `[Function]` | Call signals to read: `count()` not `count`. In JSX: `{count()}` not `{count}` |
| `ERR_HYDRATION_MISMATCH` | error | Server HTML and client render do not match | Ensure identical initial HTML; avoid browser-only APIs during render; use `onMount()` for client-only logic |
| `ERR_ORPHAN_EFFECT` | warning | Effect created outside a reactive root — will never be cleaned up | Wrap in `createRoot()` or create effects inside component functions |
| `ERR_SIGNAL_WRITE_IN_RENDER` | error | Signal written during component render, triggering re-execution | Move signal writes into event handlers, effects, or `onMount()` |
| `ERR_MISSING_CLEANUP` | warning | Effect sets up a resource but returns no cleanup function | Return a cleanup function from effects that add listeners, timers, or connections |
| `ERR_UNSAFE_INNERHTML` | warning | `innerHTML` set without the `{ __html }` safety marker | Use `{ __html: content }` or the `html` tagged template literal |
| `ERR_MISSING_KEY` | warning | List rendered without a `key` prop — items may re-order incorrectly | Add a unique, stable `key` prop (use an ID, not the array index) |

Use `what_errors` via MCP to retrieve structured error data from a running app.

---

## Top 10 Agent Mistakes

### 1. Forgetting `()` to Read a Signal

```jsx
// WRONG -- passes function reference, renders "[Function: sig]"
<p>{count}</p>

// CORRECT
<p>{count()}</p>
```

### 2. Mutating Signal Values In Place

```jsx
// WRONG -- same reference, no update triggered
items().push(newItem);
items.set(items());

// CORRECT -- new array reference
items.set(prev => [...prev, newItem]);
```

### 3. Using `formState.errors()` Instead of `formState.errors.field`

```jsx
// WRONG
formState.errors().email

// CORRECT -- formState.errors is a getter object
formState.errors.email?.message
```

### 4. Expecting Component Body to Re-Run

```jsx
// WRONG -- this log runs once, not on every update
function Greeter({ name }) {
  console.log('rendering', name());
  return <h1>{name()}</h1>;
}

// CORRECT -- put reactive logic in an effect
function Greeter({ name }) {
  useEffect(() => console.log('name changed:', name()));
  return <h1>{name()}</h1>;
}
```

### 5. Reading Signal Outside Reactive Context

```jsx
// WRONG -- reads once, val is a static number
function Child({ count }) {
  const val = count();
  return <p>{val}</p>;
}

// CORRECT -- read inside JSX or effect for reactivity
function Child({ count }) {
  return <p>{count()}</p>;
}
```

### 6. Using `show()` (Removed API)

```jsx
// WRONG
show(isOpen(), <Modal />, null)

// CORRECT
{isOpen() ? <Modal /> : null}
// or
<Show when={isOpen()}><Modal /></Show>
```

### 7. Raw innerHTML with Plain String (Security)

```jsx
// WRONG -- plain string innerHTML is rejected for security
<div innerHTML="<b>Hello</b>" />

// CORRECT -- use the __html wrapper
<div innerHTML={{ __html: '<b>Hello</b>' }} />
<div dangerouslySetInnerHTML={{ __html: '<b>Hello</b>' }} />
```

### 8. Effect That Reads and Writes the Same Signal

```jsx
// WRONG -- infinite loop
effect(() => {
  count.set(count() + 1);
});

// CORRECT -- use untrack for the read
effect(() => {
  const current = untrack(() => count());
  count.set(current + 1);
});
```

### 9. Using `useMemo` for Signal-Derived Values

```jsx
// WRONG -- useMemo doesn't auto-track signals
const doubled = useMemo(() => count() * 2, []);

// CORRECT -- useComputed auto-tracks signal dependencies
const doubled = useComputed(() => count() * 2);
```

### 10. Using `derived()` Outside a Store

```jsx
// WRONG -- derived is for store definitions only
const doubled = derived(() => count() * 2);

// CORRECT inside a store
const useCounter = createStore({
  count: 0,
  doubled: derived(state => state.count() * 2),
});

// CORRECT in a component
const doubled = useComputed(() => count() * 2);
```

---

## Decision Matrix

### Signal vs Store

| Use Case | Choose | Why |
|----------|--------|-----|
| Local component state | `useSignal` | Scoped to component lifecycle |
| Shared across components | `createStore` | Global singleton, any component can read |
| Standalone global value | `atom` | Simpler than a full store for one value |

### Effect vs Computed

| Use Case | Choose | Why |
|----------|--------|-----|
| Derive a value from signals | `useComputed` | Lazy, cached, returns a readable signal |
| Derive inside a store | `derived` | Store-level computed field |
| Side effect (DOM, network, log) | `useEffect` | Runs function, doesn't return a value |
| Non-signal dependency memo | `useMemo` | Uses dependency array, not auto-tracking |

### Island vs Client Component

| Use Case | Choose | Why |
|----------|--------|-----|
| Static content (nav, footer) | No island | Zero JS shipped |
| Interactive widget on static page | `Island` with `action`/`idle` | Hydrates only when needed |
| Always-interactive SPA section | `Island` with `load` or client component | Immediate hydration |
| Server-only content | `Island` with `static` | Never hydrates |

### SSR vs Static

| Use Case | Choose | Why |
|----------|--------|-----|
| Content changes per request | `mode: 'server'` | Fresh HTML each request |
| Content rarely changes | `mode: 'static'` | Pre-built at build time |
| Mix of both | `mode: 'hybrid'` | Per-page choice |
| Client-only SPA | `mode: 'client'` | No server rendering |

---

## Canonical Defaults

1. Import from `what-framework`.
2. Use compiler-first JSX.
3. Use `onClick` event casing in code.
4. Use `.set(...)` for signal writes.
5. Use ternaries or `<Show>` for conditions.
6. `formState.errors` is a getter object.
7. Prefer CSS-first styling over JS hover handlers.
8. The compiler auto-wraps `{count()}` into `() => count()` for reactivity.
