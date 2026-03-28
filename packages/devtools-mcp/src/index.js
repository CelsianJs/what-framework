#!/usr/bin/env node
/**
 * what-devtools-mcp — MCP server entry point.
 * Creates WS bridge, registers tools + resources, connects MCP stdio transport.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBridge } from './bridge.js';
import { registerTools } from './tools.js';

const port = parseInt(process.env.WHAT_MCP_PORT || '9229', 10);

const bridge = createBridge({ port });

const server = new McpServer({
  name: 'what-devtools-mcp',
  version: '0.2.0',
});

registerTools(server, bridge);

// --- MCP Resources: static docs for agent context ---

server.resource(
  'reactivity-model',
  'what://docs/reactivity-model',
  { description: 'How What Framework reactivity works — signals, effects, computed, batch' },
  async () => ({
    contents: [{
      uri: 'what://docs/reactivity-model',
      mimeType: 'text/markdown',
      text: `# What Framework Reactivity Model

## Signals
A signal is a reactive value. Read with \`sig()\`, write with \`sig(newValue)\` or \`sig(prev => next)\`.
Signals track which effects read them and notify those effects when they change.

\`\`\`js
const count = signal(0, 'count');  // second arg is optional debug name
count()       // read (returns 0)
count(5)      // write (sets to 5, notifies subscribers)
count.peek()  // read without tracking (no effect subscription)
\`\`\`

## Effects
An effect runs a function and auto-tracks which signals it reads. When any tracked signal changes, the effect re-runs.

\`\`\`js
effect(() => {
  console.log('Count is:', count());  // auto-tracks count
});
\`\`\`

Effects flush asynchronously via microtask, NOT synchronously.

## Computed
Derived signal. Lazy — only recomputes when deps change AND it's read.

\`\`\`js
const doubled = computed(() => count() * 2);
\`\`\`

## Batch
Group signal writes; effects run once at the end.

\`\`\`js
batch(() => {
  name('Alice');
  age(30);
  // effects that read name or age run once after batch, not twice
});
\`\`\`

## Common Bugs
- **Signal read in event handler**: Event handlers are wrapped in untrack(). Reading a signal in onclick doesn't create a subscription.
- **Effect writes to signal it reads**: Creates an infinite loop. Use untrack() to read without subscribing.
- **Stale closure**: Effect function captures old value. Read the signal inside the effect, not outside.
`,
    }],
  })
);

server.resource(
  'debugging-guide',
  'what://docs/debugging-guide',
  { description: 'How to debug What Framework apps using the MCP devtools' },
  async () => ({
    contents: [{
      uri: 'what://docs/debugging-guide',
      mimeType: 'text/markdown',
      text: `# Debugging What Framework Apps

## Step 1: Check connection
Call \`what_connection_status\` to verify the app is connected.

## Step 2: Get the lay of the land
Call \`what_diagnose\` for a comprehensive health check, or \`what_snapshot\` for raw data.

## Step 3: Investigate specific issues

### "UI isn't updating"
1. \`what_signals { filter: "relevant_name" }\` — is the signal value what you expect?
2. \`what_watch { duration: 5000 }\` — ask user to trigger the action. Do signal:updated events appear?
3. If no updates: the event handler isn't calling sig(newValue). Check the source code.
4. If updates appear but UI doesn't change: the component isn't reading the signal reactively. Check for stale closures or peek() usage.

### "Infinite re-render / effect loop"
1. \`what_effects { minRunCount: 50 }\` — find effects with high run counts
2. \`what_dependency_graph { effectId: N }\` — see what signals this effect reads and writes
3. If an effect reads and writes the same signal: use untrack() for the read

### "Slow performance"
1. \`what_diagnose { focus: "performance" }\` — identify hot effects
2. \`what_effects { minRunCount: 20 }\` — find frequently-running effects
3. Consider using batch() to group signal writes

### "Component shows wrong data"
1. \`what_component_tree\` — verify component hierarchy
2. \`what_dom_inspect { componentId: N }\` — see actual rendered output
3. \`what_signals\` — check if signal values are correct

### "Route not working"
1. \`what_route\` — check current path, params, matched pattern
2. \`what_navigate { path: "/expected" }\` — test navigation programmatically
`,
    }],
  })
);

server.resource(
  'api-reference',
  'what://docs/api-reference',
  { description: 'Complete API reference for What Framework core, hooks, components, data, stores, forms, and utilities' },
  async () => ({
    contents: [{
      uri: 'what://docs/api-reference',
      mimeType: 'text/markdown',
      text: `# What Framework API Reference

> **Signal style note:** WhatFW signals support both \`sig(newValue)\` and \`sig.set(newValue)\`. The idiomatic pattern is the function-call style: \`sig(newValue)\` to write, \`sig()\` to read.

## Reactive Primitives
- \`signal(initial, debugName?)\` — create reactive value. Read: \`sig()\`. Write: \`sig(newVal)\` or \`sig(prev => next)\`.
- \`computed(fn)\` — derived value (lazy, only recomputes when deps change AND it's read)
- \`memo(fn)\` — derived value (eager, deduped — only propagates when value actually changes)
- \`effect(fn)\` — side effect, auto-tracks deps. Returns dispose function. Flushes async via microtask.
- \`batch(fn)\` — group writes, effects run once after
- \`untrack(fn)\` — read signals without subscribing
- \`flushSync()\` — force pending effects to run synchronously
- \`createRoot(fn)\` — isolated reactive scope with ownership tree
- \`getOwner()\` — get current ownership context
- \`runWithOwner(owner, fn)\` — run within a specific owner context
- \`onCleanup(fn)\` — register cleanup with current root (alias: onRootCleanup)

## Component Hooks
- \`useState(initial)\` — React-compatible state hook (returns [getter, setter])
- \`useSignal(initial)\` — signal scoped to component
- \`useComputed(fn)\` — computed scoped to component
- \`useEffect(fn, deps?)\` — effect with optional dep array
- \`useRef(initial)\` — mutable ref that persists across renders
- \`useMemo(fn, deps)\` — memoized value
- \`useCallback(fn, deps)\` — memoized callback
- \`useContext(Context)\` — read context value
- \`useReducer(reducer, initial)\` — reducer pattern
- \`createContext(defaultValue)\` — create a context
- \`onMount(fn)\` — run once after component mounts (client-only)
- \`onCleanup(fn)\` — run when component unmounts
- \`createResource(fetcher)\` — async resource with loading/error states

## Built-in Components
- \`<Show when={signal()} fallback={...}>\` — conditional rendering
- \`<For each={items()}>{item => ...}</For>\` — list rendering (keyed)
- \`<Switch><Match when={...}>...</Match></Switch>\` — multi-branch conditional
- \`<Suspense fallback={...}>\` — async loading boundary
- \`<ErrorBoundary fallback={...}>\` — error catching boundary
- \`<Island>\` — client-hydrated island
- \`lazy(() => import(...))\` — code-split component
- \`memo(Component)\` — memoized component (no-op in run-once model)

## Data Fetching
- \`useSWR(key, fetcher)\` — returns \`{ data(), isLoading(), error() }\` as signal getters
- \`useQuery(key, fetcher, opts?)\` — query with caching and revalidation
- \`useFetch(url, opts?)\` — simple fetch wrapper
- \`useInfiniteQuery(key, fetcher)\` — paginated data
- \`invalidateQueries(key)\` — force refetch
- \`prefetchQuery(key, fetcher)\` — prefetch data
- \`setQueryData(key, data)\` / \`getQueryData(key)\` — manual cache manipulation
- \`clearCache()\` — clear all cached queries

## DOM
- \`mount(vnode, selector)\` — mount app to DOM
- \`h(tag, props, ...children)\` — create virtual node (internal — use JSX)
- \`html\\\`...\\\`\` — tagged template literal for HTML
- \`Fragment\` — fragment component
- Event handlers: lowercase in h() (\`onclick\`), camelCase in JSX (\`onClick\`)

## Stores
- \`createStore(initialState)\` — reactive store with \`{ state, set, derived }\`
- \`derived(fn)\` — derive from store state
- \`storeComputed(fn)\` — computed from store
- \`atom(initial)\` — lightweight single-value store

## Forms
- \`useForm({ fields, onSubmit })\` — form management with validation
- \`useField(name, rules)\` — individual field management
- \`rules.required(msg)\` / \`rules.email(msg)\` / \`rules.minLength(n, msg)\` etc.
- \`zodResolver(schema)\` / \`yupResolver(schema)\` — schema validation adapters
- \`<Input />\` / \`<Textarea />\` / \`<Select />\` / \`<Checkbox />\` / \`<Radio />\` — form components

## Head Management
- \`<Head><title>...</title></Head>\` — manage document head
- \`clearHead()\` — reset head tags

## Animation
- \`spring(target, config?)\` — spring-based animation
- \`tween(from, to, config?)\` — tween animation
- \`useTransition(signal, config?)\` — transition between values
- \`useGesture(element, handlers)\` — gesture recognition
- \`cssTransition(classes)\` — CSS-based transitions

## Accessibility
- \`useFocus()\` / \`useFocusTrap()\` / \`useFocusRestore()\` — focus management
- \`useRovingTabIndex()\` — keyboard navigation
- \`announce(msg)\` / \`announceAssertive(msg)\` — screen reader announcements
- \`<SkipLink />\` / \`<VisuallyHidden />\` / \`<LiveRegion />\` — a11y components
- \`useAriaExpanded()\` / \`useAriaSelected()\` / \`useAriaChecked()\` — ARIA state
- \`Keys\` / \`onKey()\` / \`onKeys()\` — keyboard event helpers
- \`useId()\` / \`useIds()\` — unique ID generation

## Scheduler
- \`scheduleRead(fn)\` / \`scheduleWrite(fn)\` — prevent layout thrashing
- \`measure(fn)\` / \`mutate(fn)\` — batch DOM reads and writes
- \`nextFrame(fn)\` / \`raf(fn)\` — animation frame scheduling
- \`onResize(el, fn)\` / \`onIntersect(el, fn)\` — observer utilities

## Utilities
- \`cls(...args)\` — conditional class names
- \`style(obj)\` — reactive style object
- \`debounce(fn, ms)\` / \`throttle(fn, ms)\` — rate limiting
- \`useMediaQuery(query)\` — reactive media query
- \`useLocalStorage(key, initial)\` — persistent signal
- \`useClickOutside(ref, fn)\` — detect outside clicks
- \`<Portal target={selector}>\` — render into a different DOM node

## Error System (Agent-First)
- \`WhatError\` — structured error class with code, suggestion, context
- \`ERROR_CODES\` — all error code definitions
- \`createWhatError(code, context)\` — create a structured error
- \`classifyError(err, context)\` — classify a raw Error into WhatError
- \`getCollectedErrors(since?)\` — retrieve accumulated errors (dev mode)

## Agent Guardrails
- \`configureGuardrails(overrides)\` — enable/disable specific guardrails
- \`validateImports(names)\` — check that import names are valid exports
- \`checkComponentName(name)\` — verify PascalCase naming

## Agent Context
- \`installAgentContext()\` — expose \`window.__WHAT_AGENT__\` for AI agents
- \`getHealth()\` — health check: cycle risk, orphan effects, signal leaks, memory pressure
`,
    }],
  })
);

// --- Agent Guide Resource ---
server.resource(
  'agent-guide',
  'what://docs/agent-guide',
  { description: 'Complete guide for AI coding agents working with What Framework' },
  async () => ({
    contents: [{
      uri: 'what://docs/agent-guide',
      mimeType: 'text/markdown',
      text: `# What Framework Agent Guide

## Overview
What Framework is the first framework built for AI agents. It uses fine-grained reactivity (signals + effects) instead of virtual DOM diffing. Components run ONCE — signals handle all updates directly.

## Key Mental Model
1. **Components run once.** The function body executes a single time. There is no "re-render."
2. **Signals are the state.** Read with \`sig()\`, write with \`sig(newVal)\`. Signals auto-track which effects read them.
3. **Effects handle side-effects.** They auto-track signal reads and re-run when those signals change.
4. **DOM updates are fine-grained.** When a signal changes, only the specific DOM node that reads it updates — no diffing, no reconciliation.

## The #1 Mistake: Missing Signal Calls
Signals are functions. You MUST call them to read the value:
\`\`\`js
// WRONG — renders "[Function]"
<span>{count}</span>

// CORRECT — renders the actual value
<span>{count()}</span>
\`\`\`

## Creating Components
\`\`\`js
import { signal, effect, onMount } from 'what-framework';

function Counter() {
  const count = signal(0, 'count');

  return (
    <div>
      <span>{count()}</span>
      <button onclick={() => count(c => c + 1)}>+1</button>
    </div>
  );
}
\`\`\`

## MCP Devtools Workflow
1. \`what_connection_status\` — verify app is connected
2. \`what_diagnose\` — comprehensive health check
3. \`what_lint { code: "..." }\` — static analysis on code you write
4. \`what_scaffold { type: "component", name: "MyComponent" }\` — generate boilerplate
5. \`what_snapshot { diff: true }\` — see what changed after an action
6. \`what_fix { error: "ERR_INFINITE_EFFECT" }\` — get fix for any error code
7. \`what_perf\` — performance snapshot with hot effects and memory estimate

## Common Patterns

### Conditional rendering
\`\`\`js
<Show when={isLoggedIn()} fallback={<LoginForm />}>
  <Dashboard />
</Show>
\`\`\`

### List rendering
\`\`\`js
<For each={items()}>{(item) =>
  <li key={item.id}>{item.name}</li>
}</For>
\`\`\`

### Data fetching
\`\`\`js
const { data, isLoading, error } = useSWR('/api/users', fetchJSON);
// data(), isLoading(), error() are signals — call them!
\`\`\`

### Derived values
\`\`\`js
const total = computed(() => items().reduce((sum, i) => sum + i.price, 0));
\`\`\`

### Event handlers
\`\`\`js
// JSX uses camelCase — compiler transforms to lowercase
<button onClick={() => count(c => c + 1)}>Add</button>

// In h() calls, use lowercase
h('button', { onclick: () => count(c => c + 1) }, 'Add')
\`\`\`

## Error Codes Quick Reference
| Code | What it means | Fix |
|------|---------------|-----|
| ERR_INFINITE_EFFECT | Effect reads and writes same signal | Use untrack() for the read |
| ERR_MISSING_SIGNAL_READ | Signal used without () | Add () to read: count() |
| ERR_HYDRATION_MISMATCH | Server/client HTML differ | Use onMount() for client-only code |
| ERR_ORPHAN_EFFECT | Effect outside reactive root | Wrap in createRoot() |
| ERR_SIGNAL_WRITE_IN_RENDER | Signal written in component body | Move write to event handler |
| ERR_MISSING_CLEANUP | Effect has no cleanup return | Return cleanup function |
| ERR_UNSAFE_INNERHTML | innerHTML without __html marker | Use { __html: content } |
| ERR_MISSING_KEY | List without key prop | Add key={item.id} |
`,
    }],
  })
);

// --- Error Codes Resource ---
server.resource(
  'error-codes',
  'what://docs/error-codes',
  { description: 'All What Framework error codes with explanations, fixes, and code examples' },
  async () => ({
    contents: [{
      uri: 'what://docs/error-codes',
      mimeType: 'text/markdown',
      text: `# What Framework Error Codes

## ERR_INFINITE_EFFECT
**Severity:** error
**Cause:** An effect reads and writes the same signal, creating a cycle. Each write triggers a re-run, which reads again, which writes again...
**Fix:** Use \`untrack()\` to read the signal without subscribing:
\`\`\`js
// Before (broken):
effect(() => { count(count() + 1); });

// After (fixed):
effect(() => { count(untrack(count) + 1); });
\`\`\`

## ERR_MISSING_SIGNAL_READ
**Severity:** warning
**Cause:** A signal function reference is used where its VALUE was intended. Signals are functions that must be called.
**Fix:** Add \`()\` after the signal name:
\`\`\`js
// Before (broken — renders "[Function]"):
<span>{count}</span>

// After (fixed):
<span>{count()}</span>
\`\`\`

## ERR_HYDRATION_MISMATCH
**Severity:** error
**Cause:** Server-rendered HTML differs from what the client expects. Usually caused by reading browser APIs during initial render.
**Fix:** Use \`onMount()\` for client-only logic:
\`\`\`js
// Before (broken):
function App() { return <p>{window.innerWidth}</p>; }

// After (fixed):
function App() {
  const width = signal(0);
  onMount(() => width(window.innerWidth));
  return <p>{width()}</p>;
}
\`\`\`

## ERR_ORPHAN_EFFECT
**Severity:** warning
**Cause:** An effect created outside any reactive root or component function. It will never be cleaned up.
**Fix:** Create effects inside components or wrap in \`createRoot()\`.

## ERR_SIGNAL_WRITE_IN_RENDER
**Severity:** error
**Cause:** A signal is written during the component function body (render phase), causing immediate re-execution.
**Fix:** Move writes to event handlers, effects, or \`onMount()\`.

## ERR_MISSING_CLEANUP
**Severity:** warning
**Cause:** An effect sets up a resource (listener, timer, subscription) but returns no cleanup.
**Fix:** Return a cleanup function:
\`\`\`js
effect(() => {
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
});
\`\`\`

## ERR_UNSAFE_INNERHTML
**Severity:** warning
**Cause:** innerHTML set without the __html safety marker. XSS risk.
**Fix:** Use \`{ __html: content }\` or the \`html\` tagged template.

## ERR_MISSING_KEY
**Severity:** warning
**Cause:** List items rendered without unique key props, causing incorrect reordering.
**Fix:** Add \`key={item.id}\` using a stable identifier.
`,
    }],
  })
);

// --- Patterns Resource ---
server.resource(
  'patterns',
  'what://docs/patterns',
  { description: 'Common What Framework patterns: component, form, store, list, island' },
  async () => ({
    contents: [{
      uri: 'what://docs/patterns',
      mimeType: 'text/markdown',
      text: `# What Framework Common Patterns

## Component Pattern
\`\`\`js
import { signal, onMount } from 'what-framework';

function MyComponent({ title }) {
  const isActive = signal(false, 'isActive');

  onMount(() => {
    // Client-only initialization
  });

  return (
    <div class={cls({ active: isActive() })}>
      <h2>{title}</h2>
      <button onclick={() => isActive(v => !v)}>Toggle</button>
    </div>
  );
}
\`\`\`

## Form Pattern
\`\`\`js
import { useForm, Input, ErrorMessage, rules } from 'what-framework';

function LoginForm() {
  const { fields, handleSubmit, isSubmitting } = useForm({
    fields: {
      email: { initial: '', rules: [rules.required(), rules.email()] },
      password: { initial: '', rules: [rules.required(), rules.minLength(8)] },
    },
    onSubmit: async (values) => {
      await login(values.email, values.password);
    },
  });

  return (
    <form onsubmit={handleSubmit}>
      <Input field={fields.email} type="email" placeholder="Email" />
      <ErrorMessage field={fields.email} />
      <Input field={fields.password} type="password" placeholder="Password" />
      <ErrorMessage field={fields.password} />
      <button type="submit" disabled={isSubmitting()}>
        {isSubmitting() ? 'Logging in...' : 'Login'}
      </button>
    </form>
  );
}
\`\`\`

## Store Pattern
\`\`\`js
import { createStore, derived } from 'what-framework';

const store = createStore({
  items: [],
  filter: 'all',
});

const filteredItems = derived(state =>
  state.filter === 'all' ? state.items : state.items.filter(i => i.status === state.filter)
);

export function addItem(item) {
  store.set(s => ({ ...s, items: [...s.items, item] }));
}

export function setFilter(filter) {
  store.set(s => ({ ...s, filter }));
}

export { store, filteredItems };
\`\`\`

## List Pattern
\`\`\`js
import { signal, For } from 'what-framework';

function TodoList() {
  const todos = signal([], 'todos');
  const input = signal('', 'input');

  const addTodo = () => {
    if (input().trim()) {
      todos(t => [...t, { id: Date.now(), text: input(), done: false }]);
      input('');
    }
  };

  return (
    <div>
      <input
        value={input()}
        oninput={e => input(e.target.value)}
        onkeydown={e => e.key === 'Enter' && addTodo()}
      />
      <For each={todos()}>
        {todo => <li key={todo.id}>{todo.text}</li>}
      </For>
    </div>
  );
}
\`\`\`

## Island Pattern
\`\`\`js
// islands/InteractiveWidget.jsx
import { signal, onMount } from 'what-framework';

function InteractiveWidget({ initialData }) {
  const data = signal(initialData, 'data');

  onMount(() => {
    // Hydrate with fresh data from API
    fetch('/api/widget').then(r => r.json()).then(data);
  });

  return (
    <div data-island="interactive-widget">
      <span>{data()?.title}</span>
    </div>
  );
}

InteractiveWidget.island = true;
export default InteractiveWidget;
\`\`\`

## Data Fetching Pattern
\`\`\`js
import { useSWR, Show } from 'what-framework';

function UserProfile({ userId }) {
  const { data, isLoading, error } = useSWR(
    \`/api/users/\${userId}\`,
    (url) => fetch(url).then(r => r.json())
  );

  return (
    <Show when={!isLoading()} fallback={<Spinner />}>
      <Show when={!error()} fallback={<p>Error: {error()?.message}</p>}>
        <h1>{data()?.name}</h1>
        <p>{data()?.email}</p>
      </Show>
    </Show>
  );
}
\`\`\`
`,
    }],
  })
);

// --- Routing Resource (ported from mcp-server) ---
server.resource(
  'routing-guide',
  'what://docs/routing',
  { description: 'File-based and programmatic routing in What Framework: routes, params, nested layouts, navigation' },
  async () => ({
    contents: [{
      uri: 'what://docs/routing',
      mimeType: 'text/markdown',
      text: `# What Framework Routing

## Declaring Routes

\`\`\`js
import { Router, Link, navigate, route } from 'what-framework/router';

h(Router, {
  routes: [
    { path: '/', component: Home },
    { path: '/about', component: About },
    { path: '/users/:id', component: User },
    { path: '/blog/*', component: BlogLayout },
  ],
  fallback: h(NotFound),
});
\`\`\`

## Navigation

\`\`\`js
// Declarative link
h(Link, { href: '/about' }, 'About');

// Programmatic navigation
navigate('/dashboard');
navigate('/login', { replace: true });
\`\`\`

## Reactive Route State

\`\`\`js
route.path();    // current path (signal — call to read)
route.params();  // { id: '123' }
route.query();   // { page: '1' }
\`\`\`

## Nested Layouts

\`\`\`js
{
  path: '/dashboard',
  component: DashboardLayout,
  children: [
    { path: '', component: DashboardHome },
    { path: 'settings', component: Settings },
  ],
}
\`\`\`

## File-Based Routing

Drop files in \`src/pages/\` and routes are generated automatically:

| File | Route |
|------|-------|
| \`src/pages/index.jsx\` | \`/\` |
| \`src/pages/about.jsx\` | \`/about\` |
| \`src/pages/users/[id].jsx\` | \`/users/:id\` |
| \`src/pages/blog/[...slug].jsx\` | \`/blog/*\` |

## Route Guards

\`\`\`js
{
  path: '/admin',
  component: AdminPanel,
  beforeEnter: (to, from) => {
    if (!isAuthenticated()) return '/login';
  },
}
\`\`\`
`,
    }],
  })
);

// --- SSR/SSG Resource (ported from mcp-server) ---
server.resource(
  'ssr-ssg-guide',
  'what://docs/ssr-ssg',
  { description: 'Server-side rendering, static site generation, and hybrid rendering in What Framework' },
  async () => ({
    contents: [{
      uri: 'what://docs/ssr-ssg',
      mimeType: 'text/markdown',
      text: `# What Framework SSR / SSG

## Render Modes

| Mode | Description |
|------|-------------|
| \`'static'\` | Pre-rendered at build time (SSG) |
| \`'server'\` | Rendered on each request (SSR) |
| \`'client'\` | Client-only rendering (SPA) |
| \`'hybrid'\` | Static shell + client hydration |

## Render to String (SSR)

\`\`\`js
import { renderToString } from 'what-framework/server';

const html = await renderToString(h(App));
\`\`\`

## Stream Rendering

\`\`\`js
import { renderToStream } from 'what-framework/server';

for await (const chunk of renderToStream(h(App))) {
  response.write(chunk);
}
\`\`\`

## Per-Page Configuration

\`\`\`js
import { definePage } from 'what-framework/server';

export const page = definePage({
  mode: 'static',  // 'static' | 'server' | 'client' | 'hybrid'
});
\`\`\`

## Server-Only Components

\`\`\`js
import { server } from 'what-framework/server';

const Header = server(({ title }) => h('header', null, title));
// This component never ships JS to the client
\`\`\`

## Islands + SSR

Combine SSR with islands for zero-JS-by-default pages that hydrate interactive parts on demand:

\`\`\`js
import { island, Island } from 'what-framework/server';

island('cart', () => import('./islands/cart.js'), {
  mode: 'action',  // Hydrate on first interaction
});

function Page() {
  return h('div', null,
    h('nav', null, 'Static nav — no JS'),
    h(Island, { name: 'cart' }),
    h('footer', null, 'Static footer — no JS'),
  );
}
\`\`\`

### Hydration Modes
- \`'idle'\`: Hydrate when browser is idle
- \`'visible'\`: Hydrate when visible (IntersectionObserver)
- \`'action'\`: Hydrate on first click/focus
- \`'media'\`: Hydrate when media query matches
- \`'load'\`: Hydrate immediately
- \`'static'\`: Never hydrate (server only)
`,
    }],
  })
);

// --- CLI Resource (ported from mcp-server) ---
server.resource(
  'cli-guide',
  'what://docs/cli',
  { description: 'What Framework CLI commands and project configuration' },
  async () => ({
    contents: [{
      uri: 'what://docs/cli',
      mimeType: 'text/markdown',
      text: `# What Framework CLI

## Commands

\`\`\`bash
what dev        # Dev server with HMR
what build      # Production build
what preview    # Preview production build
what generate   # Static site generation
\`\`\`

## Configuration

\`\`\`js
// what.config.js
export default {
  mode: 'hybrid',       // 'static' | 'server' | 'client' | 'hybrid'
  pagesDir: 'src/pages',
  outDir: 'dist',
  islands: true,
  port: 3000,
};
\`\`\`

## Environment Variables

- \`WHAT_MCP_PORT\` — Port for the devtools MCP bridge (default: 9229)
- \`NODE_ENV\` — \`'development'\` enables devtools instrumentation and error collection
`,
    }],
  })
);

// --- Testing Resource ---
server.resource(
  'testing-guide',
  'what://docs/testing',
  { description: 'How to test What Framework components, signals, and effects' },
  async () => ({
    contents: [{
      uri: 'what://docs/testing',
      mimeType: 'text/markdown',
      text: `# Testing What Framework Apps

## Unit Testing Signals

\`\`\`js
import { signal, computed, effect, flushSync } from 'what-framework';
import { describe, it, assert } from 'node:test';

describe('Counter signal', () => {
  it('increments', () => {
    const count = signal(0);
    count(1);
    assert.strictEqual(count(), 1);
  });

  it('computed derives correctly', () => {
    const count = signal(2);
    const doubled = computed(() => count() * 2);
    assert.strictEqual(doubled(), 4);
    count(5);
    assert.strictEqual(doubled(), 10);
  });
});
\`\`\`

## Testing Effects

Effects flush asynchronously via microtask. Use \`flushSync()\` to force synchronous execution in tests:

\`\`\`js
import { signal, effect, flushSync } from 'what-framework';

it('effect tracks signal changes', () => {
  const name = signal('Alice');
  let captured = '';
  effect(() => { captured = name(); });
  flushSync();
  assert.strictEqual(captured, 'Alice');

  name('Bob');
  flushSync();
  assert.strictEqual(captured, 'Bob');
});
\`\`\`

## Testing Components

\`\`\`js
import { mount } from 'what-framework';

it('renders component', () => {
  const container = document.createElement('div');
  mount(<Counter />, container);
  assert.ok(container.querySelector('button'));
  assert.strictEqual(container.textContent.includes('0'), true);
});
\`\`\`

## Testing with MCP Devtools

Use the MCP tools for integration-level debugging:
1. \`what_lint { code: "..." }\` — static analysis on code before running
2. \`what_validate { code: "..." }\` — compile check + lint in one call
3. \`what_snapshot { diff: true }\` — verify state changes after an action
`,
    }],
  })
);

// --- Project Structure Resource ---
server.resource(
  'project-structure',
  'what://docs/project-structure',
  { description: 'Recommended project structure and file conventions for What Framework apps' },
  async () => ({
    contents: [{
      uri: 'what://docs/project-structure',
      mimeType: 'text/markdown',
      text: `# What Framework Project Structure

## Recommended Layout

\`\`\`
my-app/
  what.config.js          # Framework configuration
  src/
    pages/                # File-based routes (auto-discovered)
      index.jsx           # /
      about.jsx           # /about
      users/
        [id].jsx          # /users/:id
        index.jsx         # /users
    components/           # Shared components
      Header.jsx
      Footer.jsx
    islands/              # Interactive islands (hydrated on demand)
      Cart.jsx
      SearchBar.jsx
    stores/               # Global stores and shared state
      auth.js
      cart.js
    lib/                  # Utilities, API clients, helpers
      api.js
      format.js
    styles/               # Global styles
      global.css
  public/                 # Static assets (copied as-is)
    favicon.ico
  dist/                   # Build output (generated)
\`\`\`

## Naming Conventions

- **Components**: PascalCase (\`MyComponent.jsx\`)
- **Pages**: lowercase or kebab-case (\`about.jsx\`, \`blog-post.jsx\`)
- **Islands**: PascalCase, in \`islands/\` directory, export \`.island = true\`
- **Stores**: camelCase (\`authStore.js\`)
- **Signals**: camelCase variable names with optional debug name: \`signal(0, 'count')\`

## Import Conventions

Always import from \`'what-framework'\`, not \`'what'\`:

\`\`\`js
import { signal, effect, computed, onMount } from 'what-framework';
import { Router, Link, navigate } from 'what-framework/router';
import { renderToString, definePage } from 'what-framework/server';
\`\`\`
`,
    }],
  })
);

// --- Tool Pipeline Guide Resource ---
server.resource(
  'tool-pipelines',
  'what://docs/tool-pipelines',
  { description: 'How to call MCP tools efficiently: recommended pipelines, token costs, anti-patterns, cascade rules' },
  async () => {
    // Load from the markdown file at build time
    let text;
    try {
      const { readFileSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const path = fileURLToPath(new URL('../TOOL-PIPELINES.md', import.meta.url));
      text = readFileSync(path, 'utf-8');
    } catch {
      text = '# Tool Pipeline Guide\n\nFailed to load TOOL-PIPELINES.md. Check the package installation.';
    }
    return {
      contents: [{
        uri: 'what://docs/tool-pipelines',
        mimeType: 'text/markdown',
        text,
      }],
    };
  }
);

// Import and register extended tools if available
try {
  const { registerExtendedTools } = await import('./tools-extended.js');
  registerExtendedTools(server, bridge);
} catch {
  // Extended tools not yet available — that's fine
}

// Import and register agent-first tools
try {
  const { registerAgentTools } = await import('./tools-agent.js');
  registerAgentTools(server, bridge);
} catch {
  // Agent tools not yet available — that's fine
}

// --- MCP Prompts: agent guidance ---

server.prompt(
  'what-devtools-guide',
  'How to use WhatFW MCP DevTools effectively. Read this first.',
  {},
  async () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `# WhatFW MCP DevTools — Quick Reference

You have access to 28 MCP tools for inspecting and debugging a live What Framework app running in the browser.

## Connection Check
Always start with: \`what_connection_status\` — confirms the browser is connected and shows signal/effect/component counts.

## Top 5 Tools (use these most)

1. **what_diagnose** — One-call health check. Finds errors, performance issues, and reactivity problems.
2. **what_explain** {componentId} — Everything about one component: its signals, effects, DOM, and errors.
3. **what_look** {componentId} — Visual inspection WITHOUT a screenshot: computed styles, dimensions, layout classification, child elements, accessibility.
4. **what_signals** — List all reactive signals with current values. Filter by name.
5. **what_lint** {code} — Static analysis before saving code. Catches 7 common mistakes.

## Visual Tools (cheapest first)
- \`what_look\` — Text description of styles/layout (~400 tokens). Use FIRST.
- \`what_page_map\` — Full page skeleton with landmarks, buttons, headings (~800 tokens).
- \`what_screenshot\` {componentId} — Cropped image of ONE component (5-20KB). Use only if text isn't enough.

## State Debugging
- \`what_signals\` — See all signal values
- \`what_signal_trace\` {signalId} — "Why did this signal change?" Shows which effects wrote to it.
- \`what_dependency_graph\` {signalId} — Full reactive graph: signal → effects → downstream.
- \`what_watch\` — Observe reactive events over a time window.

## Actions
- \`what_set_signal\` {signalId, value} — Directly change a signal value in the live app.
- \`what_navigate\` {path} — Navigate to a different route.

## Code Quality
- \`what_lint\` — Check code for signal-read-without-(), effect cycles, missing cleanup, etc.
- \`what_scaffold\` {type, name} — Generate idiomatic component/page/form/store boilerplate.
- \`what_fix\` {errorCode} — Get diagnosis + fix + code example for any WhatFW error.

## Anti-Patterns
- DON'T screenshot first — use what_look (10x cheaper)
- DON'T call what_signals + what_effects + what_dom_inspect separately — use what_explain
- DON'T use what_eval for state inspection — use the structured tools

## What Framework Basics
- Components run ONCE (not on every render like React)
- \`signal(value, 'name')\` for state — read with \`sig()\`, write with \`sig(newValue)\`
- \`effect(() => { ... })\` for side effects — auto-tracks signal reads
- \`computed(() => ...)\` for derived values — lazy, cached
- Import from \`'what-framework'\`
`,
      },
    }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
