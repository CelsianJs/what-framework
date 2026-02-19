# what-react: React Compatibility Layer -- Engineering Findings

**Date:** February 18, 2026
**Package:** `what-react` (v0.1.0)
**Location:** `packages/react-compat/`
**Status:** All three test libraries fully working -- Zustand, Framer Motion, AND Radix UI

---

## 1. Executive Summary

`what-react` is a React compatibility layer for the What Framework. It implements React's public API surface using What's signals-based reactivity and reconciler, allowing unmodified React ecosystem libraries (Zustand, Framer Motion, Radix UI, etc.) to run on What's runtime. The approach mirrors Preact's `preact/compat` strategy: alias `react` and `react-dom` imports to our shim at the bundler level, so third-party code calls into What's engine without knowing the difference.

Three high-value libraries are fully operational: **Zustand v5** (external store), **Framer Motion v11** (animation), and **Radix UI Popover** (headless UI with portals, context, forwardRef, and composed events). Five core framework bugs were identified and fixed during this work, including broken portal routing and missing capture-phase event support. The path to broad React ecosystem compatibility is proven.

---

## 2. Architecture

### 2.1 Module Layout

```
packages/react-compat/
  src/
    index.js          # React API (hooks, createElement, forwardRef, Children, etc.)
    dom.js            # ReactDOM API (createRoot, render, createPortal, etc.)
    jsx-runtime.js    # Automatic JSX runtime (jsx, jsxs, Fragment)
    jsx-dev-runtime.js # Development JSX runtime (re-exports jsx-runtime)
  test/
    app/              # Vite test app with Zustand, Framer Motion, Radix UI tests
  package.json
```

### 2.2 Design Principles

1. **Thin shim, not a reimplementation.** What's core already has positional hook tracking (`hookIndex`/`hooks[]` arrays on the component stack), so `useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `useContext`, and `useReducer` are direct re-exports from `what-core`. No wrapper logic needed.

2. **React's JSX pipeline, not What's compiler.** React compat apps use esbuild's automatic JSX transform with `jsxImportSource: 'react'`, which is then aliased to `what-react/jsx-runtime`. The What compiler (`what-compiler`) is explicitly excluded because it injects `import { h } from 'what-framework'`, which creates conflicting module resolution paths. This is a hard architectural boundary.

3. **Bundler-level aliasing.** All `react` and `react-dom` imports from third-party libraries are redirected to `what-react` via Vite's `resolve.alias`. The libraries never know they are running on What.

4. **Absolute path resolution.** All aliases point to absolute file paths (via `path.resolve`), not package names. This eliminates ambiguity in module resolution and prevents Vite from creating duplicate instances.

### 2.3 Hook Implementation Summary

| React Hook | what-react Implementation | Notes |
|---|---|---|
| `useState` | Direct re-export from `what-core` | What's useState already has positional tracking |
| `useEffect` | Direct re-export from `what-core` | |
| `useLayoutEffect` | Maps to `whatUseEffect` | What has no multi-phase commit; single effect queue |
| `useInsertionEffect` | Maps to `whatUseEffect` | React 18 hook for CSS-in-JS; same mapping |
| `useMemo` | Direct re-export from `what-core` | |
| `useCallback` | Direct re-export from `what-core` | |
| `useRef` | Direct re-export from `what-core` | |
| `useContext` | Direct re-export from `what-core` | |
| `useReducer` | Direct re-export from `what-core` | |
| `useSyncExternalStore` | Custom: `whatUseState` + `whatUseEffect` + subscribe | Most complex implementation |
| `useImperativeHandle` | Custom: layout effect + ref assignment | Supports function refs and object refs |
| `useId` | Custom: counter-based `:w{n}:` format | Monotonic, deterministic within a session |
| `useTransition` | Custom: `isPending` state + `queueMicrotask` + `batch` | |
| `useDeferredValue` | Custom: state mirroring via `useEffect` | |
| `useDebugValue` | No-op | DevTools only; no runtime effect |

### 2.4 createElement Bridge

`what-react`'s `createElement` normalizes React conventions to What's `h()` hyperscript:

- Converts `className` to `class` for HTML elements
- Converts `htmlFor` to `for` for HTML elements
- Keeps `ref` in props (What's `setProp` handles ref assignment for DOM elements, and `forwardRef` components extract it)
- Aliases `vnode.type = vnode.tag` so React libraries can access `element.type`
- Delegates to `h(type, props, ...children)` for vnode construction

What's reconciler already handles camelCase event props (`onClick` -> `click`), `style` objects, and `dangerouslySetInnerHTML`, so no additional normalization is needed for those.

### 2.5 ReactDOM Bridge

`what-react/dom.js` maps React 18's `createRoot` API to What's `mount()`:

- `createRoot(container)` returns `{ render(element), unmount() }`
- `hydrateRoot` mounts fresh (true hydration would require DOM reuse logic)
- Legacy `render(element, container)` wraps `createRoot`
- `createPortal` returns a portal vnode (placeholder; needs real implementation)
- `flushSync` delegates to `whatFlushSync`

---

## 3. Validated Libraries

### 3.1 Zustand v5 -- FULLY WORKING

**What it tests:** `useSyncExternalStore` (Zustand's internal mechanism), external state subscriptions, selective state access via selectors, re-rendering on state change.

**Test setup:** A counter store with `increment`, `decrement`, `reset` actions. The component selects individual values via `useCountStore(state => state.count)`.

**Why this matters:** `useSyncExternalStore` is the most complex custom hook in the compat layer. It uses `whatUseState` for triggering re-renders and `whatUseEffect` for subscribing to external stores. The subscribe callback compares snapshots via `Object.is` to avoid unnecessary updates. Zustand v5's successful operation validates:

- External store subscription lifecycle (subscribe on mount, unsubscribe on cleanup)
- Snapshot comparison and selective re-rendering
- State setter triggering What's reactivity pipeline
- Multiple selector hooks in a single component (4 `useCountStore` calls)

### 3.2 Framer Motion v11 -- FULLY WORKING

**What it tests:** Hooks, refs, context, animation scheduling, `AnimatePresence` with enter/exit animations, `motion.div` higher-order component wrapping.

**Test setup:** A toggleable animated box using `motion.div` with `initial`, `animate`, and `exit` props inside `AnimatePresence`.

**Why this matters:** Framer Motion is among the most hook-intensive libraries in the React ecosystem. It uses `useRef`, `useContext`, `useEffect`, `useLayoutEffect`, `useMemo`, `forwardRef`, and internal scheduling. Its successful operation validates:

- Complex hook call ordering across multiple nested components
- Context propagation through the component tree
- Ref assignment and lifecycle
- `forwardRef` wrapper functioning correctly
- `useLayoutEffect` mapping to `whatUseEffect`
- Animation frame scheduling interoperating with What's microtask-based effect flushing

### 3.3 Radix UI Popover -- FULLY WORKING

**What it tests:** `createContext`/`useContext` (extensive), `forwardRef` (all primitives), portals (`createPortal`), callback refs, composed event handlers, `asChild` slot pattern, DismissableLayer (outside-click detection with capture-phase events).

**Test setup:** A controlled Popover with `open`/`onOpenChange`, `Popover.Trigger` with `asChild` wrapping a `<button>`, `Popover.Portal` for portal rendering, `Popover.Content` with close button, and `Popover.Arrow`.

**Why this matters:** Radix UI is the hardest compat test in the React ecosystem. It exercises:

- **Deep context chains:** 8+ nested context providers for scope isolation
- **forwardRef everywhere:** Every Radix primitive uses `forwardRef`
- **`Children.only` + `isValidElement` + `cloneElement`:** The `asChild`/Slot pattern merges trigger props onto child elements
- **Capture-phase events:** `onPointerDownCapture` and `onFocusCapture` detect whether pointer/focus events are inside the component tree
- **DismissableLayer:** Document-level event listeners for outside-click and focus-outside detection
- **Portals:** `ReactDOM.createPortal` for rendering content into `document.body`
- **Composed event handlers:** `composeEventHandlers` chains multiple handlers per event

**Bugs discovered and fixed:**

1. **Capture-phase events broken** — `onFocusCapture` registered as `focuscapture` (non-existent event). Fixed by stripping `Capture` suffix and using `addEventListener(event, handler, true)`.
2. **Portal routing dead code** — `__portal` string-tagged vnodes never reached the portal handler. Fixed by adding routing in `createDOM`.
3. **componentStack pop timing** — Children's `_parentCtx` was null because pop happened before child creation. Fixed by moving pop after reconciliation.
4. **Children unwrapping** — Single-child arrays weren't unwrapped to match React semantics. Fixed in `createComponent` and `patchNode`.

---

## 4. The Critical Bug: Dual Module Instances

### 4.1 Symptoms

After Vite successfully compiled the test app (384 modules), the runtime threw:

```
Error: Hooks must be called inside a component function
```

This error originated from `what-core`'s hook system, which checks that `componentStack` is non-empty before allowing hook calls. The stack was empty from the perspective of the code calling hooks.

### 4.2 Root Cause

**Vite's dependency pre-bundling** (`optimizeDeps`) uses esbuild to bundle `node_modules` dependencies into `.vite/deps/` chunks. This created two separate instances of `what-core` in the running application:

| Instance | Location | Used By |
|---|---|---|
| Pre-bundled | `node_modules/.vite/deps/chunk-XXXX.js` | Zustand, Framer Motion (bundled by Vite's optimizer) |
| Source | `/@fs/.../packages/core/src/dom.js` | App code (served as ESM source) |

Each instance had its own module-level `componentStack` array (defined in `what-core/src/dom.js`). When a component rendered:

1. The **source instance's** `createComponent` pushed to its `componentStack`
2. Zustand/Framer called hooks that resolved to the **pre-bundled instance's** hook functions
3. The pre-bundled instance checked its own `componentStack` -- which was empty
4. Hook validation failed with the error

This is the same class of bug that affects React itself when two copies of React are loaded (the "Invalid Hook Call Warning" scenario).

### 4.3 Resolution Journey

| Attempt | Strategy | Result |
|---|---|---|
| 1 | Build and run | Missing `useInsertionEffect` export -- added it |
| 2 | Run with all exports | 384 modules compiled, runtime hooks error |
| 3 | `resolve.dedupe` + absolute paths | Still failed -- Vite pre-bundling still created a separate instance |
| 4 | Remove What compiler + esbuild automatic JSX + `optimizeDeps.exclude` | SUCCESS |

### 4.4 The Three-Part Fix

**1. Remove the What compiler plugin.**

The What compiler transforms JSX into `h()` calls and injects `import { h } from 'what-framework'`. In a React compat scenario, this creates a second import path to what-core internals that conflicts with the aliased React JSX pipeline. The fix: use zero plugins and let esbuild handle JSX via the automatic runtime.

```js
// vite.config.js
plugins: [],  // NO what compiler
esbuild: {
  jsx: 'automatic',
  jsxImportSource: 'react',  // aliased to what-react
},
```

**2. Absolute path aliases.**

All alias targets are resolved to absolute filesystem paths, removing any ambiguity in Vite's module graph:

```js
const corePath = path.resolve(import.meta.dirname, '../../../../packages/core/src/index.js');
const compatPath = path.resolve(import.meta.dirname, '../../src');

resolve: {
  alias: {
    'react/jsx-runtime': path.join(compatPath, 'jsx-runtime.js'),
    'react/jsx-dev-runtime': path.join(compatPath, 'jsx-dev-runtime.js'),
    'react-dom/client': path.join(compatPath, 'dom.js'),
    'react-dom': path.join(compatPath, 'dom.js'),
    'react': path.join(compatPath, 'index.js'),
    'what-core': corePath,
  },
}
```

**3. Exclude what-core from optimizeDeps.**

This is the linchpin. By excluding `what-core` and `what-react` from Vite's pre-bundling, all code -- including Zustand and Framer Motion -- resolves `what-core` imports to the same source files served via Vite's dev server. No duplicate module instances.

```js
optimizeDeps: {
  exclude: ['what-core', 'what-react'],
},
```

---

## 5. Vite Configuration Reference

The canonical Vite config for a what-react project:

```js
import { defineConfig } from 'vite';
import path from 'path';

const corePath = path.resolve(import.meta.dirname, '/path/to/what-core/src/index.js');
const compatPath = path.resolve(import.meta.dirname, '/path/to/what-react/src');

export default defineConfig({
  // NO what compiler plugin -- React compat uses React's JSX pipeline
  plugins: [],
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react', // aliased to what-react below
  },
  resolve: {
    alias: {
      // React aliases (longer paths first to avoid prefix matching issues)
      'react/jsx-runtime': path.join(compatPath, 'jsx-runtime.js'),
      'react/jsx-dev-runtime': path.join(compatPath, 'jsx-dev-runtime.js'),
      'react-dom/client': path.join(compatPath, 'dom.js'),
      'react-dom': path.join(compatPath, 'dom.js'),
      'react': path.join(compatPath, 'index.js'),
      // Force single what-core instance
      'what-core': corePath,
    },
    dedupe: ['what-core'],
  },
  optimizeDeps: {
    exclude: ['what-core', 'what-react'],
  },
});
```

---

## 6. API Coverage Matrix

### 6.1 React (react)

| API | Status | Notes |
|---|---|---|
| `useState` | Implemented | Re-export from what-core |
| `useEffect` | Implemented | Re-export from what-core |
| `useLayoutEffect` | Implemented | Maps to useEffect (single effect phase) |
| `useInsertionEffect` | Implemented | Maps to useEffect |
| `useMemo` | Implemented | Re-export from what-core |
| `useCallback` | Implemented | Re-export from what-core |
| `useRef` | Implemented | Re-export from what-core |
| `useContext` | Implemented | Re-export from what-core |
| `useReducer` | Implemented | Re-export from what-core |
| `useSyncExternalStore` | Implemented | Custom: state + effect + subscribe |
| `useImperativeHandle` | Implemented | Custom |
| `useId` | Implemented | Counter-based |
| `useDebugValue` | Implemented | No-op |
| `useTransition` | Implemented | Microtask + batch |
| `useDeferredValue` | Implemented | State mirror |
| `createElement` | Implemented | Prop normalization + h() |
| `createContext` | Implemented | Re-export from what-core |
| `createRef` | Implemented | `{ current: null }` |
| `forwardRef` | Implemented | Unwraps ref prop, passes to render |
| `cloneElement` | Implemented | Merges props, preserves refs |
| `isValidElement` | Implemented | Checks `_vnode` or `$$typeof` |
| `memo` | Implemented | Re-export from what-core |
| `lazy` | Implemented | Re-export from what-core |
| `Fragment` | Implemented | Re-export from what-core |
| `Suspense` | Implemented | Re-export from what-core |
| `StrictMode` | Implemented | Passthrough (renders children) |
| `Component` | Implemented | Class with setState, forceUpdate |
| `PureComponent` | Implemented | Class with shallowEqual SCU |
| `Children` | Implemented | map, forEach, count, toArray, only |
| `startTransition` | Implemented | Module-level, microtask + batch |
| `version` | Implemented | Reports `18.3.1` |
| `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` | Implemented | ReactCurrentOwner + ReactCurrentDispatcher stubs |

### 6.2 ReactDOM (react-dom)

| API | Status | Notes |
|---|---|---|
| `createRoot` | Implemented | Wraps what-core mount() |
| `hydrateRoot` | Implemented | Mounts fresh (no real hydration) |
| `render` (legacy) | Implemented | Wraps createRoot |
| `unmountComponentAtNode` | Implemented | Clears container innerHTML |
| `createPortal` | Implemented | Routes through core's `__portal` handler; renders into target container |
| `flushSync` | Implemented | Delegates to whatFlushSync |
| `findDOMNode` | Stub | Deprecated; logs warning, returns null |
| `unstable_batchedUpdates` | Implemented | Passthrough (What batches by default) |

### 6.3 JSX Runtime (react/jsx-runtime)

| API | Status | Notes |
|---|---|---|
| `jsx` | Implemented | Delegates to createElement |
| `jsxs` | Implemented | Alias of jsx (static children optimization not needed) |
| `jsxDEV` | Implemented | Alias of jsx |
| `Fragment` | Implemented | Re-export from what-core |

---

## 7. Known Gaps and TODO

### 7.1 High Priority

| Item | Description | Blocking |
|---|---|---|
| React Router testing | Validate `react-router-dom` v6. Uses context, `useSyncExternalStore`, `useLayoutEffect`. | Routing story |
| React Router testing | Validate `react-router-dom` v6. Uses context, `useSyncExternalStore`, `useLayoutEffect`. | Routing story |
| TanStack Query testing | Validate `@tanstack/react-query`. Uses `useSyncExternalStore`, context, `Suspense`. | Data fetching story |

### 7.2 Medium Priority

| Item | Description |
|---|---|
| Class component rendering | `Component`/`PureComponent` are defined but not tested through the reconciler. The `_forceUpdate` mechanism needs to be wired into What's reactive update cycle. |
| `React.lazy` / `Suspense` integration | Both are re-exported from what-core but not tested with dynamic `import()` in a React compat context. |
| `hydrateRoot` with real hydration | Currently mounts fresh. True hydration requires reusing existing server-rendered DOM nodes. |
| Error boundaries | `WhatErrorBoundary` is imported but not re-exported. React's `componentDidCatch` / `getDerivedStateFromError` pattern needs a bridge. |
| `useLayoutEffect` vs `useEffect` timing | Both currently map to the same effect queue. Libraries that depend on layout effects running synchronously before paint may see visual glitches. |

### 7.3 Low Priority

| Item | Description |
|---|---|
| `findDOMNode` | Deprecated in React; stub returning null is likely sufficient. |
| `unstable_batchedUpdates` | Passthrough is correct since What batches by default. |
| React DevTools integration | Would require emitting fiber-compatible debug data. |
| npm publish | Package as `what-react` on npm with proper peer dependency on `what-core`. |
| User-facing documentation | Migration guide, Vite config template, supported libraries list. |

---

## 8. Lessons Learned

### 8.1 Bundler Module Identity is the Hardest Problem

The dual-module-instance bug consumed the majority of debugging time. The build succeeding with 384 modules gave false confidence -- the issue only manifested at runtime. Key takeaway: any compatibility layer that relies on module-level state (like a component stack) must guarantee singleton resolution across all consumers. Vite's `optimizeDeps.exclude` is the primary lever for this.

### 8.2 The What Compiler and React's JSX Pipeline are Mutually Exclusive

The What compiler and React's automatic JSX runtime serve the same purpose (transforming JSX to function calls) but produce different output:

- **What compiler:** `import { h } from 'what-framework'; h('div', ...)`
- **React automatic runtime:** `import { jsx } from 'react/jsx-runtime'; jsx('div', ...)`

Using both creates two parallel import trees that resolve to different module instances. React compat apps must use the React pipeline exclusively.

### 8.3 What's Hook Model is Remarkably React-Compatible

What's positional hook tracking (`hookIndex` incremented per hook call, `hooks[]` array per component instance) mirrors React's own implementation closely enough that most hooks are zero-cost re-exports. The only hooks requiring custom implementation are those that have no What equivalent (`useSyncExternalStore`, `useImperativeHandle`, `useId`, `useTransition`, `useDeferredValue`).

### 8.4 The Compat Surface Area is Manageable

React's public API is large but bounded. The full implementation in `what-react/src/index.js` is under 400 lines. The DOM bridge is under 110 lines. The JSX runtime is under 40 lines. Total compat layer: approximately 550 lines of code. This is comparable to Preact's compat layer in scope, though Preact's has more edge-case handling from years of ecosystem testing.

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `useLayoutEffect` timing differences cause visual bugs | Medium | Medium | Consider adding a synchronous effect queue to what-core |
| Libraries checking `React.version` for feature gating | Low | Low | Already report `18.3.1`; monitor for version checks |
| Libraries accessing React fiber internals | Low | High | Not solvable without a fiber tree; document as unsupported |
| Class component rendering edge cases | Medium | Medium | Wire `_forceUpdate` into What's reactive cycle; test with legacy libraries |

---

## 10. Conclusion

The what-react compatibility layer has proven its core thesis: What's signals-based reactivity engine can run unmodified React ecosystem libraries through a thin API shim and bundler aliasing. The three hardest integration tests -- external store subscriptions (Zustand), animation scheduling (Framer Motion), and headless UI with portals + composed events (Radix UI) -- all pass cleanly.

The work uncovered five bugs in What's core (`dom.js`), all fixed:
1. **Capture-phase events** — `onFocusCapture` registered as non-existent `focuscapture` event
2. **Portal routing** — `__portal` string-tagged vnodes never reached the portal handler
3. **componentStack pop timing** — Children's `_parentCtx` was null, breaking context propagation
4. **Children unwrapping** — Single-child arrays weren't unwrapped to match React semantics
5. **patchNode children re-wrapping** — Props update re-wrapped already-unwrapped children

These bugs existed independently of the compat layer and affected What's own `Portal` helper and any deeply nested component trees using context. Fixing them improved both the compat layer and the core framework.

Next steps: test React Router and TanStack Query, benchmark React vs What+compat performance, then publish to npm.
