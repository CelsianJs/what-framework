# What Framework — Architecture

## Design Philosophy

1. **Vanilla JS first.** No compiler, no transpiler, no build step required. Everything works with plain `.js` files and native ES modules.

2. **Ship less.** Zero JS by default for static content. Islands opt-in to client JS. Only the signals that change trigger updates — no tree diffing.

3. **Familiar.** React-like hooks API so developers can be productive immediately. But signals underneath so performance is better by default.

4. **Simple.** One way to do each thing. Small API surface. Clear mental model. If you know vanilla JS, you know What.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                   Your App                       │
│  Components · Pages · Layouts · Islands          │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌─────────┐  ┌────────┐  ┌──────────────────┐ │
│  │  Hooks   │  │ Router │  │  Store / Context  │ │
│  │ useState │  │ routes │  │  createStore()   │ │
│  │ useEffect│  │ Link   │  │  atom()          │ │
│  └────┬─────┘  └───┬────┘  └────────┬─────────┘ │
│       │            │                │            │
│  ┌────┴────────────┴────────────────┴──────────┐ │
│  │           Reactive Core (Signals)            │ │
│  │  signal() · computed() · effect() · batch()  │ │
│  └────────────────────┬────────────────────────┘ │
│                       │                          │
│  ┌────────────────────┴────────────────────────┐ │
│  │            Rendering Layer                   │ │
│  │  h() → VNode → DOM Reconciler (client)       │ │
│  │  h() → VNode → renderToString (server)       │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │           Islands Architecture               │ │
│  │  Static HTML + selective hydration            │ │
│  │  load · idle · visible · action · media      │ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
├─────────────────────────────────────────────────┤
│  CLI: dev · build · preview · generate           │
└─────────────────────────────────────────────────┘
```

## Reactive Core

The reactive system is the foundation. Everything builds on three primitives:

### Signal
A reactive value container. O(1) read, O(subscribers) write.

```
signal(0)
  ├── read()     → returns value, tracks current effect
  ├── set(v)     → updates value, notifies subscribers
  ├── peek()     → returns value without tracking
  └── subscribe  → shorthand for creating an effect
```

### Computed
A derived signal. Lazy evaluation — only computes when read after deps change.

```
computed(() => a() + b())
  ├── Uses an internal effect to track deps
  ├── Marked dirty when deps change (not recomputed)
  └── Recomputed on next read
```

### Effect
A function that re-runs when its signal dependencies change.

```
effect(() => console.log(count()))
  ├── Runs immediately
  ├── Tracks which signals were read
  ├── Re-runs when those signals change
  ├── Cleans up old subscriptions on re-run (dynamic deps)
  └── Returns a dispose function
```

### Why Signals > Virtual DOM Diffing

| Virtual DOM (React)                  | Signals (What)                        |
|--------------------------------------|---------------------------------------|
| Re-render entire component tree      | Update only affected DOM nodes        |
| Diff old vs new tree (O(n))          | Direct subscriber notification (O(1)) |
| Need memo/useMemo to optimize        | Fine-grained by default               |
| Closures capture stale state         | Always read latest value              |

## Rendering Pipeline

### Client (Browser)

```
h('div', props, children)     Create VNode (plain object)
         │
    mount(vnode, '#app')      Initial render
         │
    createDOM(vnode)          VNode → real DOM element
         │
    effect(() => Component()) Auto-track signal reads
         │
    signal.set(newValue)      State change
         │
    notify(subscribers)       Only affected effects re-run
         │
    reconcile(old, new)       Minimal DOM patches
```

### Server (SSR)

```
h('div', props, children)     Create VNode
         │
    renderToString(vnode)     VNode → HTML string
         │
    <div>...</div>            Pure HTML, no JS
         │
    hydrateIslands()          Client: hydrate only islands
```

## Islands Architecture

The page is divided into static HTML and interactive islands:

```html
<body>
  <!-- Static: zero JS -->
  <nav>...</nav>

  <!-- Island: hydrates on idle -->
  <div data-island="search" data-island-mode="idle">
    <!-- Server-rendered HTML here -->
  </div>

  <!-- Static: zero JS -->
  <main>...</main>

  <!-- Island: hydrates on first interaction -->
  <div data-island="cart" data-island-mode="action">
    <!-- Server-rendered HTML here -->
  </div>

  <!-- Static: zero JS -->
  <footer>...</footer>
</body>
```

Each island:
1. Loads its own JS module independently
2. Hydrates at the right time (idle, visible, action, etc.)
3. Manages its own state
4. Has no effect on other islands or static content

## File Structure

```
packages/
├── core/           Reactive system, hooks, VDom, helpers
│   └── src/
│       ├── reactive.js    Signals, computed, effects, batch
│       ├── h.js           VNode creation (h, Fragment, html)
│       ├── dom.js         DOM mounting and reconciliation
│       ├── hooks.js       React-compatible hooks
│       ├── components.js  memo, lazy, Suspense, ErrorBoundary
│       ├── store.js       Global state management
│       ├── head.js        Document head management
│       ├── helpers.js     Utilities (cls, each, etc.)
│       └── index.js       Public API
├── router/         Client-side routing
│   └── src/
│       └── index.js       Router, Link, navigate, guards
├── server/         SSR, SSG, islands
│   └── src/
│       ├── index.js       renderToString, renderToStream, SSG
│       └── islands.js     Island registration and hydration
├── cli/            Development tools
│   └── src/
│       └── cli.js         dev, build, preview, generate
└── create-what/    Project scaffolding
    └── index.js           npx create-what my-app
```

## Performance Characteristics

| Operation                  | Complexity | Notes                          |
|----------------------------|------------|--------------------------------|
| Signal read                | O(1)       | Direct value access            |
| Signal write               | O(k)       | k = number of subscribers      |
| Effect subscribe           | O(1)       | Set.add                        |
| Effect cleanup             | O(d)       | d = number of dependencies     |
| Batch flush                | O(e)       | e = unique effects to run      |
| VNode creation             | O(c)       | c = children count             |
| Props diff                 | O(p)       | p = prop count                 |
| SSR render                 | O(n)       | n = total nodes                |
