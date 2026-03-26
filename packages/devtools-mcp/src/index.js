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

const transport = new StdioServerTransport();
await server.connect(transport);
