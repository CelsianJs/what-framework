# Things Missing From What After Looking At React

Observations from building the React compatibility layer. These are NOT "we need to copy React" items — they're gaps that showed up when real React libraries ran against our reconciler and reactive system.

## Bugs Fixed During Compat Work

### 1. Capture Phase Events (FIXED)
**Impact: High — broke all headless UI libraries**

`onFocusCapture` was registered as `addEventListener('focuscapture', ...)` — a non-existent event. React's convention: `onXxxCapture` means "listen to `xxx` in the capture phase". We now strip the `Capture` suffix and pass `true` as the third arg to `addEventListener`.

This wasn't just a compat issue — What's own event handling was missing capture phase support entirely.

### 2. Portal Routing Dead Code (FIXED)
**Impact: High — What's own `Portal` helper was broken**

The `Portal` component from `helpers.js` returns `{ tag: '__portal' }`, but `createDOM` only routed function-tagged vnodes to `createComponent`, where the `__portal` check lived. String-tagged portals fell through to `document.createElement('__portal')` — creating a fake HTML element instead of rendering into the target container.

Fixed by adding `__portal` check directly in `createDOM` before the function-tag check.

### 3. componentStack Pop Timing (FIXED)
**Impact: High — broke context propagation for all nested components**

`componentStack.pop()` happened before children were created, so child components' `_parentCtx` was null. Context providers in parent components were invisible to children. Essential for any library using React.createContext (which is all of them).

### 4. Children Unwrapping (FIXED)
**Impact: Medium — broke React's children semantics**

What's `h()` always wraps children in arrays. React passes: 0 children → `undefined`, 1 child → single element, N children → array. Libraries like Radix call `isValidElement(children)` and get `false` because they receive `[element]` instead of `element`.

## Gaps Still Present

### 5. No `useLayoutEffect` (Semantic Gap)
What maps `useLayoutEffect` → `useEffect` (both async via microtask). React's `useLayoutEffect` runs synchronously after DOM mutations but before paint. Libraries that measure DOM (tooltips, popovers, floating UI) or that need to prevent visual flicker depend on synchronous post-mutation timing.

**What to build:** A synchronous effect that runs immediately after reconciliation, before yielding to the microtask queue. Could use `requestAnimationFrame` as a middle ground.

### 6. No `flushSync` That Actually Flushes Renders
What's `flushSync` flushes pending signal effects but doesn't force a synchronous re-render from within an event handler. React's `flushSync` forces the render pipeline to run synchronously. Some libraries (react-beautiful-dnd, react-virtualized) depend on this for correct measurements.

### 7. No Concurrent Features
React 18's `useTransition`, `useDeferredValue`, `Suspense` for data fetching, and selective hydration are missing or stubbed. The compat layer provides basic implementations but they don't have the priority-based scheduling that makes React's concurrent mode useful.

### 8. No Event Delegation
React uses a single event listener on the root for most events (delegation). What attaches listeners directly to DOM elements. This affects:
- Event ordering in deeply nested trees
- Memory usage for large lists with handlers on every item
- Synthetic event pooling (not needed in modern browsers, but some libraries check for it)

### 9. No `ref` Cleanup Functions (React 19)
React 19 added cleanup functions from ref callbacks: `ref={(el) => { setup(el); return () => cleanup(el); }}`. What doesn't support this pattern.

### 10. No `act()` Testing Utility
React's `act()` ensures all effects, state updates, and re-renders complete before assertions. What has no equivalent. Testing reactive components requires manual microtask flushing (`await new Promise(r => queueMicrotask(r))`).

### 11. No Strict Mode Double-Rendering
React's `StrictMode` double-invokes render functions and effects in development to catch impure renders and missing cleanup. What has no equivalent — bugs from impure renders are silent.

### 12. No Error Recovery in Error Boundaries
What's `ErrorBoundary` catches errors but doesn't support React's `getDerivedStateFromError` or `componentDidCatch` lifecycle. The compat layer stubs these, but recovery patterns (retry, fallback-then-retry) don't work.

### 13. Portal Context Inheritance
React portals inherit the React context tree even though they render in a different DOM location. What's portal handler creates a `portalCtx` with `_parentCtx` set to the current component, which preserves context. However, event bubbling from portals does NOT bubble through the component tree — it follows the DOM tree. React's synthetic event system makes portal events bubble through the React tree.

## Architectural Observations

### Signal-Based vs Re-Render Model
React's model: state change → schedule re-render → diff → commit. What's model: signal change → effect re-runs → reconcile. The key difference is that React re-renders an entire subtree and relies on memoization (`React.memo`, `useMemo`) to skip work. What only re-runs the specific effect that depends on the changed signal.

This is fundamentally better for performance but creates subtle incompatibilities with React libraries that assume:
- Components re-render when parent re-renders (even without prop changes)
- `useMemo` is the only way to avoid expensive recomputation
- Render functions are called multiple times with the same props

### Hook Identity Stability
React guarantees that `useState`'s setter is identity-stable (same reference every render). What's `useState` returns `s.set` which IS stable. But `useCallback` and `useMemo` with deps create new references when deps change — same as React. No gap here.

### Event Handler Freshness
React always calls the latest closure for event handlers (via synthetic event system). What attaches handlers directly to DOM elements. When a component re-renders and the handler function reference changes, `setProp` detects the change and re-attaches. This means handlers are always fresh. No gap here.
