# What Framework -- Architecture

## Overview

WhatFW is a fine-grained reactive framework built for AI agents and developers who want the closest thing to vanilla JS with a React-familiar authoring experience.

Components run once. Signals drive individual DOM updates. There is no virtual DOM, no tree diffing, and no reconciler for static content.

**Agent-first design principles:**
- Small, predictable API surface (agents make fewer errors)
- MCP DevTools bridge for live debugging without browser access
- Structured error codes with signal/effect context
- Compiler guardrails that catch mistakes before runtime

### Core Mental Model

Your component function executes a single time and returns real DOM nodes. Every dynamic expression (text content, attribute value, class name, style) becomes an individual `effect()` bound to the exact DOM node it updates. When a signal changes, only the effects that read that signal re-run, and each effect updates only the one DOM node it owns.

```
+-----------------------------------------------------+
|                   Your App                           |
|  Components . Pages . Layouts . Islands              |
+-----------------------------------------------------+
|                                                      |
|  +---------+  +--------+  +----------------------+   |
|  |  Hooks   |  | Router |  |  Store / Context      |  |
|  | useState |  | routes |  |  createStore()        |  |
|  | useEffect|  | Link   |  |  atom()               |  |
|  +----+-----+  +---+----+  +--------+-------------+  |
|       |            |                |                 |
|  +----+------------+----------------+---------------+ |
|  |           Reactive Core (Signals)                | |
|  |  signal() . computed() . effect() . batch()      | |
|  +----------------------+---------------------------+ |
|                         |                             |
|  +----------------------+---------------------------+ |
|  |      Fine-Grained Rendering Pipeline             | |
|  |  template() -> cloneNode -> insert() + effect()  | |
|  |  mapArray() -> LIS-based keyed reconciliation    | |
|  +--------------------------------------------------+ |
|                                                      |
|  +--------------------------------------------------+ |
|  |           Islands Architecture                   | |
|  |  Static HTML + selective hydration               | |
|  |  load . idle . visible . action . media          | |
|  +--------------------------------------------------+ |
|                                                      |
|  +--------------------------------------------------+ |
|  |           MCP DevTools Bridge                    | |
|  |  18 tools: signals, effects, components, DOM,    | |
|  |  cache, errors, dependency graph, diagnostics    | |
|  +--------------------------------------------------+ |
|                                                      |
+------------------------------------------------------+
|  CLI: dev . build . preview . generate               |
+------------------------------------------------------+
```

## Rendering Pipeline

### How JSX Becomes DOM

```
JSX source code
      |
  Babel compiler (babel-plugin.js)
      |
      +--- Static HTML -> template() calls (module-level constants)
      |         |
      |    cloneNode(true) -- zero-cost DOM duplication
      |
      +--- Dynamic expressions -> insert() + effect() calls
      |         |
      |    Each expression gets its own effect bound to one DOM node
      |
      +--- Dynamic props -> spread() / setProp() + effect() calls
                |
           Each reactive prop gets its own micro-effect
```

### Compiler Output Example

Given this JSX:

```jsx
function Counter() {
  const count = useSignal(0);
  return (
    <div class="counter">
      <h1>Counter</h1>
      <p>{count()}</p>
      <button onClick={() => count.set(c => c + 1)}>+1</button>
    </div>
  );
}
```

The compiler produces:

```js
import { template, insert } from 'what-core';

// Static HTML extracted to module scope -- created once, cloned per instance
const _tmpl$1 = template('<div class="counter"><h1>Counter</h1><p></p><button>+1</button></div>');

function Counter() {
  const count = useSignal(0);
  const _el$ = _tmpl$1();                              // cloneNode -- instant
  insert(_el$.childNodes[1], () => count());            // effect on <p> text
  _el$.childNodes[2].$$click = () => count.set(c => c + 1);  // delegated event
  return _el$;                                          // real DOM node, not a vnode
}
```

Key points:

- **Template extraction.** The compiler identifies static HTML subtrees and hoists them into `template()` calls at module scope. Each call creates a `<template>` element and parses the HTML once. Every component instance calls `cloneNode(true)` to get its DOM -- no createElement chains, no string parsing at runtime.

- **Per-binding effects.** Dynamic expressions (`{count()}`) become `insert()` calls. The compiler auto-wraps signal reads into `() => count()`, creating a subscription to exactly that signal. When `count` changes, only this one text node updates.

- **No virtual DOM, no diffing.** The compiler output returns real DOM nodes. There is no VNode creation, no tree diff, no patch phase. Static content has zero runtime overhead after the initial clone.

- **Event delegation.** Event handlers are stored as `el.$$eventName` properties. A single document-level listener per event type dispatches to the correct handler by walking up from `e.target`.

### List Reconciliation (mapArray)

Lists are the one place where reconciliation is needed. `mapArray` provides keyed list rendering with LIS (Longest Increasing Subsequence) optimization:

```jsx
const items = useSignal([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);

<For each={items} key={item => item.id}>
  {(item, index) => <li>{() => item().name}</li>}
</For>
```

The reconciler:
1. Skips common prefix/suffix (items that haven't moved)
2. Builds a key map for the middle section
3. Computes the LIS of old indices to find the maximum set of items that don't need to move
4. Only moves items not in the LIS; creates/destroys items as needed
5. Each list item gets its own `createRoot` scope for automatic cleanup on removal

This runs in O(n log n) time for the general case, with O(n) fast paths for append, prepend, clear, and identity (no change).

## Signal System

### Primitives

```
signal(initialValue)
  +-- Read:  sig() -- returns value, auto-tracks in current effect
  +-- Write: sig.set(value) or sig.set(prev => next)
  +-- Peek:  sig.peek() -- read without tracking
  +-- Subscribe: sig.subscribe(fn) -- shorthand for effect(() => fn(sig()))

computed(fn)
  +-- Lazy: only recomputes when read AND a dependency has changed
  +-- Auto-tracks: fn() is run inside an internal effect
  +-- Propagates: marks downstream dependents dirty when deps change
  +-- Read:  c() -- returns cached value or recomputes if dirty

effect(fn)
  +-- Runs immediately on creation
  +-- Auto-tracks: records which signals are read during fn()
  +-- Re-runs: when any tracked signal changes (via microtask flush)
  +-- Cleanup: if fn() returns a function, it runs before each re-execution
  +-- Dispose: returns a function that unsubscribes and runs final cleanup
```

### Topological Ordering

Effects and computeds are assigned topological levels:
- Source signals: level 0
- Computed/effect depending on signals: level 1
- Computed/effect depending on level-1 computeds: level 2
- And so on

During flush, pending effects are sorted by level (lowest first). This guarantees that in a diamond dependency pattern (A depends on B and C, both depend on D), B and C execute before A. Without this ordering, A could see an inconsistent state where one dependency is updated but the other isn't.

```
signal D (level 0)
  +-- computed B (level 1)
  +-- computed C (level 1)
       +-- effect A (level 2) -- reads B() and C()

When D changes:
  1. B and C marked dirty (level 1)
  2. A scheduled (level 2)
  3. Flush: B recomputes, C recomputes, then A runs -- sees consistent state
```

### Iterative Computed Evaluation

Long chains of computeds (C1 depends on C2 depends on C3 ... depends on CN) are evaluated iteratively using a throw/catch trampoline. When a computed's function reads another dirty computed, it throws a `NEEDS_UPSTREAM` sentinel. The outermost evaluation loop catches it, pushes the upstream computed onto a stack, and processes from the bottom up. This handles chains of 10,000+ computeds without stack overflow.

## Ownership and Disposal

### createRoot Scopes

Every reactive scope has an owner. Effects created inside a `createRoot` callback are registered with that root and automatically disposed when the root is disposed:

```js
const dispose = createRoot(dispose => {
  const count = signal(0);
  effect(() => console.log(count()));  // auto-registered with this root
  return dispose;
});

// Later:
dispose();  // cleans up the effect and all nested roots
```

### Component Lifecycle

Components maintain a context object with:
- `hooks[]` -- persisted hook state (signals, refs, etc.)
- `effects[]` -- effect dispose functions for cleanup
- `cleanups[]` -- explicit cleanup callbacks from `onCleanup`
- `disposed` -- flag to prevent double-disposal

When a component's DOM is removed (via `disposeTree`), the framework walks the subtree and disposes every component context and reactive effect attached to each node.

## SSR and Hydration

### Server Rendering

`renderToString` and `renderToHydratableString` produce HTML on the server:

```js
import { renderToHydratableString } from 'what-server';

const html = renderToHydratableString(<App />);
// Produces HTML with hydration markers:
// <!--$-->dynamic content<!--/$-->  (reactive expressions)
// <!--[]-->list items<!--/[]-->     (arrays)
// data-hk="h0"                      (component boundaries)
```

### Client Hydration

`hydrate()` reuses the server-rendered DOM instead of destroying and recreating it:

```js
import { hydrate } from 'what-core';

hydrate(<App />, document.getElementById('root'));
// Claims existing DOM nodes via a cursor
// Attaches signal effects to the existing nodes
// No flash of empty content
```

The hydration cursor walks the server-rendered DOM tree, claiming nodes as components mount. Dynamic expressions get their effects attached to the existing text nodes/elements rather than creating new ones.

### Islands Architecture

Pages are divided into static HTML and interactive islands:

```html
<body>
  <!-- Static: zero JS -->
  <nav>...</nav>

  <!-- Island: hydrates on idle -->
  <div data-island="search" data-island-mode="idle">
    <!-- Server-rendered HTML -->
  </div>

  <!-- Static: zero JS -->
  <main>...</main>

  <!-- Island: hydrates on first interaction -->
  <div data-island="cart" data-island-mode="action">
    <!-- Server-rendered HTML -->
  </div>
</body>
```

Six hydration modes control when each island activates:

| Mode | Triggers when |
|------|---------------|
| `load` | Page loads (immediate) |
| `idle` | Browser is idle (`requestIdleCallback`) |
| `visible` | Island enters viewport (`IntersectionObserver`) |
| `action` | User interacts (click, focus, hover) |
| `media` | Media query matches |
| `static` | Never hydrates (server-only) |

## MCP DevTools Bridge

The `what-devtools-mcp` package provides a WebSocket bridge between a running WhatFW app and AI agents via the Model Context Protocol. This is the agent-first debugging architecture:

```
+------------------+      WebSocket       +------------------+      stdio/MCP      +------------------+
|  Browser App     | <------------------> |  Bridge Server   | <------------------> |  AI Agent        |
|  (client.js)     |      port 9229       |  (Node.js)       |                     |  (Claude, etc.)  |
+------------------+                      +------------------+                      +------------------+
```

The bridge:
1. Receives state snapshots (signals, effects, components) from the browser client
2. Stores an event log and error log
3. Forwards commands from the agent to the browser (eval, navigate, set-signal, etc.)
4. Exposes 18 MCP tools for agents to query and manipulate app state

See `/docs/MCP-DEVTOOLS.md` for the complete tool reference.

## File Structure

```
packages/
+-- core/               Reactive system, rendering, hooks, components
|   +-- src/
|       +-- reactive.js     Signals, computed, effects, batch, ownership
|       +-- render.js       Fine-grained rendering: template, insert, mapArray, spread
|       +-- dom.js          DOM mounting, component creation, disposeTree
|       +-- h.js            JSX factory (h, Fragment, html tagged template)
|       +-- hooks.js        React-compatible hooks backed by signals
|       +-- components.js   memo, lazy, Suspense, ErrorBoundary, Show, For
|       +-- store.js        Global state management (createStore, atom)
|       +-- data.js         Data fetching (useSWR, useQuery, useFetch)
|       +-- form.js         Form utilities (useForm, validation)
|       +-- animation.js    spring, tween, transitions
|       +-- a11y.js         Accessibility utilities
|       +-- scheduler.js    DOM read/write batching, resize/intersection observers
|       +-- head.js         Document head management
|       +-- helpers.js      Utilities (cls, Portal, transition)
|       +-- index.js        Public API re-exports
+-- compiler/           Babel plugin: JSX -> template() + insert() + effect()
+-- router/             Client-side routing (Router, Link, navigate, guards)
+-- server/             SSR, SSG, islands hydration, server actions
+-- react-compat/       React compatibility layer (49 packages confirmed working)
+-- devtools/           Browser DevTools extension
+-- devtools-mcp/       MCP-based AI debugging bridge (18 tools)
+-- eslint-plugin/      Lint rules for What Framework patterns
+-- mcp-server/         MCP documentation server (13 tools)
+-- cli/                Development tools (dev, build, preview, generate)
+-- create-what/        Project scaffolding (npx create-what my-app)
```

## Performance Characteristics

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Signal read | O(1) | Direct value access + set.add for tracking |
| Signal write | O(k) | k = number of subscribers |
| Effect subscribe | O(1) | Set.add |
| Effect cleanup | O(d) | d = number of dependencies |
| Batch flush | O(e log e) | Sort by level, then execute e effects |
| Template clone | O(n) | n = DOM nodes in template (browser-optimized) |
| insert() | O(1) | Single text node or element update |
| mapArray reconcile | O(n log n) | LIS-based; O(n) for common cases |
| SSR render | O(n) | n = total nodes |
