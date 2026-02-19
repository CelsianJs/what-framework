# React Compatibility Layer — `what-react`

> Make React packages work inside What Framework.
> Not adapters. Not ports. The actual npm packages, unmodified.

## The Precedent

Preact already proved this is possible. Preact is a 3KB alternative to React that ships `preact/compat` — a module that implements React's entire public API using Preact's internals. You alias `react` → `preact/compat` in your bundler, and most React libraries just work. Radix, Framer Motion, React Query, React Hook Form — all functional in Preact via this shim.

We can do the same thing, but potentially better. Preact reimplements React's virtual DOM with a slightly different VDOM. We'd reimplement React's API with **signals underneath** — which means React libraries running inside What would get fine-grained reactivity for free, without the library authors knowing.

## How It Works (High Level)

```
User installs: npm install framer-motion
                         ↓
Bundler alias:  "react" → "what-react"
                "react-dom" → "what-react/dom"
                         ↓
what-react:     Implements useState, useEffect, createElement, etc.
                using What signals + reconciler internally
                         ↓
Result:         Framer Motion runs, thinks it's talking to React,
                but it's powered by What's reactivity engine
```

One config line in `vite.config.js`:

```js
import what from 'what-compiler/vite';
export default defineConfig({
  plugins: [what({ react: true })],  // enables compat aliases
});
```

## What React's API Actually Is

React's public surface is smaller than people think. Here's everything a library can import:

### From `react` (the big one)

**Hooks** — the core of modern React:
- `useState(initial)` → returns `[value, setter]`
- `useEffect(fn, deps)` → side effect with cleanup
- `useRef(initial)` → persistent mutable box `{ current }`
- `useMemo(fn, deps)` → memoized computation
- `useCallback(fn, deps)` → stable function reference
- `useContext(Context)` → read a context value
- `useReducer(reducer, initial)` → state machine
- `useLayoutEffect(fn, deps)` → synchronous effect (before paint)
- `useImperativeHandle(ref, factory, deps)` → expose methods via ref
- `useId()` → stable unique ID for SSR
- `useSyncExternalStore(subscribe, getSnapshot)` → external store bridge
- `useTransition()` → concurrent scheduling (React 18)
- `useDeferredValue(value)` → concurrent scheduling (React 18)
- `useDebugValue(value)` → DevTools label

**Component utilities:**
- `createElement(type, props, ...children)` → create VDOM node
- `createContext(defaultValue)` → context provider/consumer
- `forwardRef(Component)` → ref forwarding
- `memo(Component, areEqual)` → skip re-render on same props
- `lazy(importFn)` → code splitting
- `Fragment` → group without wrapper DOM
- `Suspense` → loading boundaries
- `Children` — utilities for iterating `props.children`
- `cloneElement(element, props)` → clone with modified props
- `isValidElement(thing)` → type check
- `createRef()` → create ref object

**Class component support** (legacy but some libs use it):
- `Component` / `PureComponent` base classes
- `setState`, lifecycle methods (`componentDidMount`, etc.)

### From `react-dom`

- `createPortal(children, container)` → render into different DOM node
- `flushSync(fn)` → force synchronous state update
- `render(element, container)` → mount app (legacy)
- `createRoot(container).render(element)` → mount app (React 18)
- `hydrateRoot()` → SSR hydration

## The Implementation: Two Layers

### Layer 1: Runtime Shim (`what-react`)

A package that exports everything React exports, implemented with What primitives.

**The hook ordering problem:**
React hooks are **positional** — they're tracked by call order within each render. `useState` #1 always maps to the same state slot, `useState` #2 to the next, etc. What's signals don't work this way — they're named values.

Solution: during a component's render, maintain a **cursor** that increments with each hook call. Map cursor positions to persistent signal instances stored on the component's internal fiber-like object. This is exactly what Preact does — it's a solved problem.

```
Component render call:
  cursor = 0
  useState(0)     → cursor 0 → signal_0 (created on first render, reused after)
  useState('')    → cursor 1 → signal_1
  useEffect(fn)   → cursor 2 → effect_2
  useMemo(fn)     → cursor 3 → computed_3
  cursor reset on next render
```

**The mapping:**

| React API | What Implementation |
|-----------|-------------------|
| `useState(init)` | Create `signal(init)` at cursor position. Return `[sig(), (v) => sig(v)]` |
| `useEffect(fn, deps)` | Track deps array. When deps change (shallow compare), dispose old effect, create new one. No deps = run every render. `[]` = run once. |
| `useLayoutEffect(fn, deps)` | Same as useEffect but flush synchronously (before paint) |
| `useMemo(fn, deps)` | Cache result, recompute when deps change (shallow compare) |
| `useCallback(fn, deps)` | `useMemo(() => fn, deps)` |
| `useRef(init)` | Return persistent `{ current: init }` object (not reactive) |
| `useReducer(reducer, init)` | `useState` + dispatch function that applies reducer |
| `useContext(Ctx)` | Walk up the component tree looking for nearest `Ctx.Provider`, return its value signal |
| `useId()` | Generate stable ID per component instance |
| `useSyncExternalStore(sub, snap)` | Subscribe to external store, wrap snapshot in signal |
| `useTransition()` | Return `[isPending, startTransition]` — can use `batch()` for grouping, signal for isPending |
| `useDeferredValue(val)` | Return signal that updates on next microtask |
| `createElement(type, props, ...ch)` | Map to `h(type, props, ...ch)` |
| `createContext(default)` | Map to What's `createContext()` |
| `forwardRef(Comp)` | Unwrap ref from props, pass as second argument |
| `memo(Comp, eq)` | Map to What's `memo()` |
| `lazy(importFn)` | Map to What's `lazy()` |
| `Fragment` | Map to What's `Fragment` |
| `Suspense` | Map to What's `Suspense` |
| `Children.map/forEach/etc` | Utility functions over arrays (trivial) |
| `cloneElement(el, props)` | Create new vnode with merged props |
| `Component` class | Wrap: constructor creates signals for state, render() called in effect |
| `createPortal(ch, el)` | Map to What's `Portal` |
| `flushSync(fn)` | Map to What's `flushSync()` |

**Event system:**
React normalizes events and uses synthetic events with event delegation. Most libraries don't depend on synthetic event specifics — they just use `onClick`, `onChange`, etc. The compat layer normalizes these to lowercase DOM events, which the What compiler already handles. For the rare library that inspects `event.nativeEvent` or React-specific event properties, we can add shims on the event objects.

**Refs:**
React's ref system is used heavily by UI libraries (Radix, Floating UI). The compat layer needs:
- `createRef()` → `{ current: null }`
- `forwardRef(Component)` → extract `ref` from props, pass to component
- Callback refs → call the function with the DOM element after mount
- `useImperativeHandle(ref, factory)` → set `ref.current` to factory result

This is straightforward — refs are just mutable boxes that get assigned DOM nodes.

### Layer 2: Build-Time Optimization (optional, future)

The runtime shim works but leaves performance on the table. A Vite/Babel plugin could analyze React library code at build time and optimize hot paths:

**Transform 1: Static `useState` → direct signal**
When the plugin sees `const [value, setValue] = useState(0)` and can prove `value` is only read (not passed to callbacks that might read it asynchronously), it can compile to a direct signal instead of the cursor-based hook tracking. This eliminates the hook ordering overhead.

**Transform 2: Deps array elimination**
`useEffect(fn, [a, b])` in React needs shallow comparison every render. The plugin could detect when `a` and `b` are derived from signals and instead create a What `effect` that auto-tracks — no deps comparison needed, and it's more granular.

**Transform 3: `useMemo` → `computed`**
`useMemo(() => expensive(a, b), [a, b])` could become `computed(() => expensive(a(), b()))` when `a` and `b` are signals. This makes it truly lazy (only recomputes when read AND deps changed) vs React's eager recomputation.

These transforms are optional — the runtime shim is the baseline, transforms are a performance bonus.

## Compatibility Tiers

Not every React library will work perfectly. Be honest about what works:

### Tier A — Works perfectly (vast majority)
Libraries that use standard hooks, refs, context, and basic lifecycle. This covers:
- **Framer Motion** — hooks + refs + context, no deep React internals
- **TanStack Query** — hooks + context
- **React Hook Form** — hooks + refs
- **Floating UI React** — hooks + refs
- **Radix UI** — hooks + refs + context + `forwardRef` (Radix is very well-behaved)
- **Headless UI** — hooks + context
- **React DnD** — hooks + context
- **Zustand** — `useSyncExternalStore` (one of the simplest)
- **Jotai** — hooks + context
- **cmdk** — hooks + context + refs
- **React Hot Toast / Sonner** — hooks + context + portal

### Tier B — Works with minor quirks
Libraries that use some React-specific scheduling or class components:
- **Slate** (rich text) — uses class components internally, needs the class shim
- **React Select** — emotion CSS-in-JS dependency adds complexity
- **React Spring** — relies on React's commit phase timing for animation scheduling

### Tier C — Unlikely to work
Libraries deeply coupled to React internals:
- **React Three Fiber** — implements a custom React reconciler (`react-reconciler`). This is essentially building a new rendering target. Would need us to implement the reconciler protocol.
- **React Native Web** — same reconciler coupling
- **React PDF** — custom reconciler
- **Anything using `react-reconciler`** — this is React's internal fiber protocol. Very few libraries do this.
- **Libraries depending on React DevTools protocol** — internal fiber tree inspection

### Key Insight
The vast majority of the React ecosystem (Tier A) uses only the public API: hooks, context, refs, createElement. The compat layer covers this. Only libraries that implement custom reconcilers (Tier C) are truly incompatible — and there are very few of those.

## The Synthetic Event Question

React wraps DOM events in SyntheticEvent objects. Do we need to do this?

**Probably not fully.** Most libraries just call `e.preventDefault()`, `e.stopPropagation()`, `e.target.value` — all of which exist on native DOM events. The few React-specific properties:
- `e.nativeEvent` → point to the real event (just `e.nativeEvent = e`)
- `e.persist()` → no-op (React 17+ doesn't pool events anyway)
- `e.isDefaultPrevented()` → check a flag

A thin wrapper on native events that adds these three properties covers ~99% of library usage.

## Class Component Support

Some popular libraries (Slate, some older versions of React DnD) use class components. The shim needs:

```
class Component:
  - constructor(props) → store props, initialize state as signal
  - setState(update) → merge into state signal, trigger re-render
  - forceUpdate() → trigger re-render
  - render() → called inside effect, returns vnodes
  - componentDidMount → onMount hook
  - componentWillUnmount → onCleanup hook
  - componentDidUpdate → effect after render
  - shouldComponentUpdate → memo comparison
  - static getDerivedStateFromProps → compute before render
  - getSnapshotBeforeUpdate → capture before DOM update
  - componentDidCatch / getDerivedStateFromError → ErrorBoundary
```

This is ~200 lines of code. Preact's class component support is 150 lines and handles the full lifecycle.

## Risks and Hard Problems

### 1. Hook ordering across conditional branches
React enforces that hooks can't be called conditionally. Most libraries respect this. But if a library violates it (and React's dev mode would warn), our cursor-based system would break in the same way. This is actually fine — it's a known constraint.

### 2. Concurrent mode features
`useTransition`, `useDeferredValue`, `startTransition` — these are React 18 concurrent features. Very few libraries use them directly. We can implement basic versions:
- `useTransition` → batch the callback, use a signal for `isPending`
- `useDeferredValue` → debounce the value by one microtask
These won't have React's lane-based priority scheduling, but they'll satisfy the API contract.

### 3. `react-dom/server` (SSR)
Libraries that import from `react-dom/server` for SSR (`renderToString`, `renderToStaticMarkup`) would need a server-side compat layer too. This is an extension of the same approach — implement React Server's API using What Server's renderer.

### 4. Strict Mode double-rendering
React's StrictMode intentionally double-invokes render functions and effects to catch bugs. Some libraries account for this. Our compat layer doesn't need to emulate this — it's a development tool, not an API contract.

### 5. Fiber access
A very small number of libraries reach into React's `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` (yes, that's the actual export name). These are unhelpable. But libraries that do this are vanishingly rare and already break across React versions.

## The Package Structure

```
what-react/                    # npm: what-react
├── src/
│   ├── index.js               # React API exports (hooks, createElement, etc.)
│   ├── dom.js                 # ReactDOM API exports (createPortal, render, etc.)
│   ├── jsx-runtime.js         # JSX automatic runtime
│   ├── jsx-dev-runtime.js     # JSX dev runtime
│   ├── hooks.js               # Hook implementations (cursor-based)
│   ├── component.js           # Class Component/PureComponent
│   ├── context.js             # createContext + Provider + useContext
│   ├── events.js              # Synthetic event shimming
│   ├── refs.js                # Ref system (createRef, forwardRef, callback refs)
│   ├── children.js            # Children utilities
│   └── compat.js              # Edge case shims (cloneElement, isValidElement, etc.)
├── package.json
│   exports:
│     "."          → "./src/index.js"       (aliased as "react")
│     "./dom"      → "./src/dom.js"         (aliased as "react-dom")
│     "./jsx-runtime" → "./src/jsx-runtime.js"
└── test/
    ├── hooks.test.js
    ├── compat-framer.test.js   # Integration test with actual Framer Motion
    ├── compat-radix.test.js    # Integration test with actual Radix
    └── compat-tanstack.test.js # Integration test with actual TanStack Query
```

Bundler configuration (handled automatically by our Vite plugin):
```js
resolve: {
  alias: {
    'react': 'what-react',
    'react-dom': 'what-react/dom',
    'react/jsx-runtime': 'what-react/jsx-runtime',
    'react/jsx-dev-runtime': 'what-react/jsx-dev-runtime',
  }
}
```

## What Makes This Different From Preact/compat

Preact's compat reimplements React's VDOM diffing with a slightly different VDOM. It's still a VDOM framework.

What's compat would be the first **signals-based React compatibility layer**. React libraries would unknowingly get fine-grained reactivity. A `useState` inside a React library becomes a signal — meaning only the specific DOM nodes that read that state update, not the entire component subtree. React libraries would actually perform *better* inside What than inside React.

This is the pitch: "Use any React library, but faster."

## Validation Strategy

Before building the full compat layer, validate with three libraries that represent different complexity levels:

1. **Zustand** (simplest) — just `useSyncExternalStore`. If this works, basic hook compat is solid.
2. **Framer Motion** (medium) — hooks + refs + context + event handling + animation scheduling. If this works, most UI libraries will too.
3. **Radix UI Popover** (complex) — hooks + refs + context + portal + focus management + `forwardRef` + composed refs. If this works, the entire Radix suite works.

If all three run correctly, the compat layer covers ~90% of the React ecosystem.

## Effort Estimate

| Component | Complexity | Size |
|-----------|-----------|------|
| Hook system (cursor-based) | Hard (core of the whole thing) | ~400 LOC |
| createElement / reconciliation | Medium (map to h() + diffing) | ~300 LOC |
| Context system | Medium | ~150 LOC |
| Class components | Medium | ~200 LOC |
| Ref system | Easy-Medium | ~100 LOC |
| Event shims | Easy | ~80 LOC |
| Children utilities | Easy | ~60 LOC |
| ReactDOM (portal, flushSync, render) | Easy | ~100 LOC |
| JSX runtime | Easy | ~40 LOC |
| Edge cases (cloneElement, etc.) | Easy | ~80 LOC |
| **Total** | | **~1,500 LOC** |

For context, `preact/compat` is ~1,800 lines. This is in the same ballpark. It's one focused package, not an ecosystem of adapters.

## Open Questions

1. **Should this live inside what-fw or as a separate repo?** Separate repo might be cleaner — it has different release cadence and its own test matrix (testing against specific React library versions).

2. **Do we vendor React's TypeScript types?** React libraries import `@types/react`. We'd need to either re-export compatible types or tell users to install `@types/react` alongside `what-react`.

3. **How do we handle React library updates?** When Framer Motion ships a new version using a new React API, we need to support it. A comprehensive test suite against pinned library versions is essential.

4. **Marketing angle**: "what-react" or "What React Compat" or something catchier? The idea of "run React libraries on signals" is genuinely novel and worth a blog post.

---

*This is a plan document. No code has been written.*
*Last updated: February 18, 2026*
