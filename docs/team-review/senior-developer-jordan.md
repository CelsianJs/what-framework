# Senior Developer Review: What Framework
**Reviewer:** Jordan (10+ years, React/Vue/Svelte/SolidJS/Angular)
**Date:** 2026-02-13
**Scope:** Full source audit of packages/core, packages/router, packages/server, packages/compiler, demo app

---

## Executive Summary

What Framework is an ambitious attempt to build a signals-based UI framework that occupies the design space between React and SolidJS. It combines React-style hooks with SolidJS-style signals, wraps components in custom elements (`<what-c>`) for reconciliation boundaries, and diffs VNodes against the live DOM rather than a retained virtual DOM. The architecture is coherent and surprisingly complete for an early-stage framework, but there are several significant correctness issues, performance cliffs, and design decisions that need to be addressed before this can be considered production-ready.

**Overall assessment:** Promising foundation with genuine innovations in its island architecture and hybrid reactivity model, but the implementation has structural issues around glitch-free evaluation, context propagation, component lifecycle management, and memory safety. Roughly at the quality level of a solid prototype -- not yet production-grade.

---

## 1. Architecture Deep Dive

### 1.1 Reactivity System (`packages/core/src/reactive.js`)

The signal implementation is ~180 lines and follows the well-established observer pattern. Let me break down the design decisions and compare them.

**Signal structure:**
```js
// Line 12-39: reactive.js
export function signal(initial) {
  let value = initial;
  const subs = new Set();
  function read() {
    if (currentEffect) {
      subs.add(currentEffect);
      currentEffect.deps.add(subs);
    }
    return value;
  }
  read.set = (next) => { ... };
  read.peek = () => value;
  read._signal = true;
  return read;
}
```

**Comparison to SolidJS `createSignal`:** SolidJS returns a `[getter, setter]` tuple. What returns a single function with `.set()` and `.peek()` attached -- closer to Preact Signals' `.value` pattern but using function calls. This is a reasonable ergonomic choice: `count()` to read, `count.set(5)` to write. The `_signal` brand is a duck-typing marker rather than a Symbol, which means any function with `._signal = true` would be treated as a signal -- a minor type-safety concern.

**Dependency tracking:** The bidirectional tracking (`subs.add(currentEffect)` and `currentEffect.deps.add(subs)`) is the standard approach used by SolidJS, Vue 3, and Preact Signals. The cleanup mechanism (line 140-143) correctly removes the effect from all subscriber sets before re-running, preventing stale subscriptions. This is good.

**Critical Issue -- Diamond Dependency / Glitch Problem:**

The `computed` implementation (line 44-72) has a glitch vulnerability. Consider:

```
A (signal)
|   \
B    C  (both computed from A)
 \  /
  D     (computed from B and C)
```

When A changes, the `notify` function (line 145-161) iterates subscribers synchronously. If B's effect runs before C's, and D depends on both B and C, D could observe an inconsistent state where B has the new value but C still has the old value. This is the classic "glitch" problem.

SolidJS solves this with a topological sort. Preact Signals uses a versioning approach. Vue 3 uses a scheduler that defers computed re-evaluation. What Framework's approach of setting `dirty = true` via `_onNotify` (line 63) is a step in the right direction -- computed values are lazily re-evaluated. However, the problem manifests when an effect depends on multiple computeds:

```js
// Line 148-159: notify()
const snapshot = [...subs];
for (const e of snapshot) {
  if (e.disposed) continue;
  if (e._onNotify) {
    e._onNotify();   // marks computed as dirty
    if (batchDepth > 0) pendingEffects.add(e);
    continue;
  }
  if (batchDepth > 0) {
    pendingEffects.add(e);
  } else {
    _runEffect(e);  // runs synchronously!
  }
}
```

Outside of `batch()`, effects run synchronously during notification. If an effect reads two computeds that both depend on the same signal, the first read will trigger lazy re-evaluation (correct), but the effect itself runs before the notification loop completes. This can cause the effect to run multiple times -- once per signal-level subscriber notification.

**Recommendation:** Effects outside of batch should be deferred to a microtask, similar to how SolidJS handles it, or a push-pull propagation model should be adopted.

**Batch implementation:**

```js
// Line 87-95: batch()
export function batch(fn) {
  batchDepth++;
  try { fn(); }
  finally {
    batchDepth--;
    if (batchDepth === 0) flush();
  }
}
```

This is correct and handles nesting properly via `batchDepth`. The `flush()` function (line 163-169) runs pending effects after all writes complete. However, there is a subtle issue: `flush()` takes a snapshot of `pendingEffects` and clears it, but if effects in the flush queue themselves write to signals, those new pending effects are lost because `pendingEffects` was already cleared. The effects would eventually settle on the next signal write, but intermediate states could be missed.

**Memory management:** The cleanup mechanism is sound -- `cleanup(e)` removes the effect from all subscriber sets and clears its deps. However, there is no ownership tree. In SolidJS, effects can own child effects (via `createRoot`), and disposing a parent automatically disposes children. What Framework handles this at the component level (via `ctx.effects`), but standalone effects created outside components have no parent and must be manually disposed. This is a leak vector.

### 1.2 Reconciler Design (`packages/core/src/dom.js`)

The reconciler is the most distinctive architectural decision. Rather than maintaining a retained virtual DOM tree (React) or compiling away the need for one (Svelte/Solid), What diffs new VNodes against the live DOM.

**How it works:**

1. Components render into `<what-c>` custom elements with `display: contents`
2. On re-render, `reconcileChildren()` (line 554-587) compares `Array.from(parent.childNodes)` against new VNodes
3. `patchNode()` (line 482-552) determines if an existing DOM node can be reused

**Comparison to React Fiber:** React maintains a fiber tree in memory and diffs old fibers against new elements. This allows for interruptible rendering (time-slicing), priority-based scheduling, and Suspense. What Framework has none of these capabilities because it diffs synchronously against the live DOM. For small-to-medium apps, this is actually faster because there is no fiber tree overhead. For large apps with complex update patterns, the inability to time-slice becomes a liability.

**Comparison to SolidJS:** Solid has no reconciler at all -- its compiler produces direct DOM operations. Signals update exactly the DOM nodes that read them. What Framework is in a middle ground: it has a reconciler, but it is driven by signals. When a signal used inside a component changes, the component's effect re-runs, producing new VNodes, which are reconciled against the wrapper's children. This is fundamentally different from both React (where the parent decides when to re-render children) and Solid (where there is no re-rendering at all, just reactive updates to existing DOM nodes).

**Keyed reconciliation (LIS):**

The LIS implementation (line 437-472) is algorithmically correct and follows the standard O(n log n) approach. However, the `reconcileKeyed` function (line 349-433) has a bug in how it maps LIS results back to new indices:

```js
// Line 387-396
const lis = longestIncreasingSubsequence(sources.filter(s => s !== -1));
const lisSet = new Set(lis.map((_, i) => {
  let count = 0;
  for (let j = 0; j < sources.length; j++) {
    if (sources[j] !== -1) {
      if (count === lis[i]) return j;
      count++;
    }
  }
  return -1;
}));
```

This remapping is O(n*m) where it should be O(n). The LIS returns indices into the filtered array, and this code walks the full `sources` array for each LIS element to find the corresponding index in the unfiltered array. This is correct but inefficient. A single pass with a mapping array would be O(n).

**The `patchNode` function -- Array handling bug:**

```js
// Line 510-519
if (Array.isArray(vnode)) {
  const frag = document.createDocumentFragment();
  for (const v of vnode) {
    const node = createDOM(v, parent);
    if (node) frag.appendChild(node);
  }
  disposeTree(domNode);
  parent.replaceChild(frag, domNode);
  return frag;  // BUG: frag is empty after appendToDOM
}
```

`DocumentFragment` becomes empty after being appended to the DOM. The return value `frag` will be an empty fragment, which breaks subsequent reconciliation because the returned node reference is invalid. This is a real bug.

### 1.3 Component Model

Components run inside reactive effects:

```js
// Line 181-225: createComponent
const dispose = effect(() => {
  if (ctx.disposed) return;
  ctx.hookIndex = 0;
  componentStack.push(ctx);
  let result;
  try {
    result = Component(propsSignal());
  } catch (error) { ... }
  componentStack.pop();
  const vnodes = Array.isArray(result) ? result : [result];
  if (!ctx.mounted) {
    // Initial mount
    ...
  } else {
    // Update: reconcile children inside wrapper
    reconcileChildren(wrapper, vnodes);
  }
});
```

This is a hybrid React/Solid model. Like React, the component function re-runs on updates. Like Solid, the re-run is driven by signal subscriptions rather than parent re-rendering. The `propsSignal` (line 177) means component updates are either self-triggered (internal signal changed) or parent-triggered (parent's effect writes new props to the child's `propsSignal`).

**Tradeoff analysis:**

- **Pro:** Familiar mental model for React developers (component re-runs produce new VNode trees)
- **Pro:** Fine-grained updates within a component (only the component that reads a changed signal re-renders, not its parent tree)
- **Con:** Every component re-run produces a full VNode tree that must be reconciled, even if only a single text node changed. Solid avoids this entirely.
- **Con:** Hook ordering constraints (React's rules of hooks apply here because `ctx.hookIndex` is reset to 0 on each render)
- **Con:** Components that read multiple signals re-run once per signal change outside of batch, potentially causing multiple reconciliations per frame

**Critical observation:** The `useState` hook (in hooks.js, line 21-32) returns `[s(), s.set]`, which means reading `count` in the render function invokes `s()`, subscribing the component's effect to the signal. But `count` is a plain value, not a signal accessor. This means updating `count` requires calling `setCount`, which writes to the signal, which triggers the component's effect to re-run, which calls `Component(propsSignal())`, which calls `useState` again, which returns the new value. This is correct but means every state change triggers a full component re-render + reconciliation. SolidJS avoids this by keeping signals as accessors -- only the specific DOM operation that reads the signal updates.

### 1.4 `<what-c>` Wrapper Elements

Every component is wrapped in a custom element:

```js
// Line 162-168
let wrapper;
if (isSvg) {
  wrapper = document.createElementNS(SVG_NS, 'g');
} else {
  wrapper = document.createElement('what-c');
  wrapper.style.display = 'contents';
}
```

**CSS implications:**

- `display: contents` makes the element invisible to layout, so it should not affect flexbox/grid children. However, some CSS selectors will be affected: `:first-child`, `:nth-child()`, `>` (direct child) selectors will match `<what-c>` elements rather than the actual content. This can break existing CSS patterns.
- In Firefox (pre-99), `display: contents` had accessibility issues where it removed the element from the accessibility tree. This has been fixed in modern browsers.
- `<what-c>` is an unregistered custom element. Without a `customElements.define()` call, it behaves as an HTMLUnknownElement, which is fine for rendering but means it inherits default inline display before the `display: contents` style is applied. This can cause a flash of incorrect layout.

**SVG implications:** Using `<g>` as the wrapper in SVG context is correct. However, `<g>` is not invisible to layout -- it creates a group that can affect transforms and event targets. This is a worse tradeoff than `<what-c>` with `display: contents`.

**Performance implications:** Each component adds one DOM node to the tree. For deeply nested component hierarchies (e.g., a design system with `Button > Ripple > Icon`), this adds extra DOM depth. The impact is marginal for most apps but measurable in benchmarks like js-framework-benchmark.

**a11y implications:** `display: contents` elements are ignored by screen readers for layout purposes, but their attributes (including ARIA attributes) are accessible. The framework does not set any ARIA attributes on `<what-c>`, which is correct.

---

## 2. Implementation Quality

### 2.1 Code Quality

The code is well-organized, clearly commented, and follows consistent patterns. Function names are descriptive (`createDOM`, `reconcileKeyed`, `patchNode`). The module boundaries are clean -- `reactive.js` has no DOM dependencies, `hooks.js` depends on `reactive.js` and `dom.js`, etc.

**Anti-patterns observed:**

1. **Mutable module-level state:** `currentEffect` (reactive.js:4), `componentStack` (dom.js:129), `errorBoundaryStack` (components.js:8) are all module-level mutable state. This is the standard approach for reactivity systems, but it makes the code inherently non-concurrent. React's introduction of fibers was specifically to solve this problem. Two concurrent renders would corrupt each other's state.

2. **Error swallowing:** Multiple places catch errors and do nothing:
   ```js
   // reactive.js line 114
   try { e._cleanup(); } catch (err) { /* cleanup error */ }
   ```
   In production, silently swallowed errors are debugging nightmares. At minimum, these should log to a configurable error handler.

3. **`_` prefix convention inconsistency:** Some internal properties use `_` prefix (`_signal`, `_vnode`, `_componentCtx`), others do not (`deps`, `lazy`, `disposed`). This makes it unclear which properties are part of the public API.

### 2.2 Edge Cases

**Race conditions:**

1. **`createResource` in hooks.js (line 207-246):** The `currentFetch` guard correctly handles race conditions for sequential fetches. However, there is no AbortController usage, so the actual HTTP request continues running even after a newer request supersedes it.

2. **`useSWR` in data.js (line 80-183):** The deduplication logic uses `Date.now()` timestamps to avoid concurrent requests within `dedupingInterval`. But if two effects trigger `revalidate()` in the same microtask, they share the same timestamp and may both proceed. The `inFlightRequests` map check should use the promise itself as the deduplication key.

3. **`useEffect` in hooks.js (line 67-86):** Effects are scheduled via `queueMicrotask`. If the component unmounts before the microtask fires, the `if (ctx.disposed) return` guard prevents execution. But the cleanup function from the previous effect run is not called if the component unmounts between renders. The `disposeComponent` function in dom.js handles this via `hook.cleanup` iteration, but the timing is fragile -- if `queueMicrotask` fires after `disposeComponent`, the disposed check prevents the new effect from running but the old cleanup was already called by `disposeComponent`.

**Memory leaks:**

1. **`useMediaQuery` in helpers.js (line 81-87):** The `matchMedia` event listener is never removed. If the component calling `useMediaQuery` unmounts, the listener persists, holding a reference to the signal, which holds references to its subscribers. This is a genuine memory leak.

2. **`useLocalStorage` in helpers.js (line 91-118):** Same issue -- the `storage` event listener is never cleaned up.

3. **Global caches in data.js:** The `cache` Map (line 8) and `inFlightRequests` Map (line 9) grow indefinitely. The `cacheTime` cleanup in `useQuery` (line 251-254) uses `setTimeout`, but if the query component unmounts, the timeout still fires and accesses stale data. The cache should use a WeakRef or a manual eviction strategy.

4. **`focusedElement` signal in a11y.js (line 10):** The `focusin` listener on `document` (line 12-15) is registered at module load time and never removed. This is intentional (it is a global singleton) but means the signal and all its subscribers are never garbage collected.

### 2.3 Error Handling

The `ErrorBoundary` component (components.js:114-138) uses a signal to track error state, which is reactive-aware. The `reportError` function (components.js:146-153) walks the `errorBoundaryStack` to find the nearest boundary. However, the `errorBoundaryStack` is managed in `createErrorBoundary` (dom.js:232-265):

```js
// dom.js line 242-251
const dispose = effect(() => {
  const error = errorState();
  errorBoundaryStack.push({ handleError });
  // ... render children or fallback ...
  errorBoundaryStack.pop();
});
```

The problem is that `errorBoundaryStack.push()` happens inside an effect. If the error boundary re-runs (because `errorState` changed), the stack is correct during that synchronous execution. But for errors that occur asynchronously (e.g., in a `useEffect`), the `errorBoundaryStack` will be empty because the push/pop happened during a previous synchronous render. The `reportError` function will find no boundary and return `false`.

This is a fundamental architectural issue. React solves it by associating error boundaries with fibers in the tree. What Framework would need to associate boundaries with component contexts and walk the component tree rather than relying on a runtime stack.

### 2.4 Performance Characteristics

**Where What will be fast:**

- Initial mount: No fiber tree allocation, direct DOM creation from VNodes. Competitive with Solid.
- Simple updates: Signal writes trigger only the subscribed component's effect. No parent-to-child re-render cascade like React without `memo()`.
- Small component trees: The per-component `<what-c>` wrapper adds minimal overhead for reasonable tree depths.
- Static pages with islands: Zero JS for static content is a genuine performance win.

**Where What will be slow:**

- Large lists without keys: Unkeyed reconciliation (line 310-346) is O(n) per update but does full `patchNode` on every index, which is expensive.
- Components reading many signals: Each signal write outside of batch triggers a full component re-render. A component reading 10 signals will re-render 10 times per batch of updates if `batch()` is not used.
- Deep component trees: Each component adds a `<what-c>` wrapper and a reactive effect. A tree of 1000 components means 1000 active effects and 1000 extra DOM nodes.
- Computed chains: The lazy evaluation strategy means reading a computed that depends on another computed triggers synchronous cascading re-evaluation. In a deep computed chain, this is O(depth) per read.

---

## 3. Comparison Matrix

| Feature | What Framework | React 18 | SolidJS 1.8 | Svelte 5 | Vue 3.4 |
|---------|---------------|----------|-------------|----------|---------|
| **Bundle size (core)** | ~4kB gzip (claimed) | ~44kB gzip | ~7kB gzip | ~2kB gzip (compiled) | ~33kB gzip |
| **Reactivity model** | Signals (auto-track) | setState + reconciler | Signals (auto-track) | Runes ($state/$derived) | Proxy-based refs |
| **Component model** | Functions re-run in effects | Functions re-run on setState | Functions run once | Components compiled | Options or Composition API |
| **VDOM** | VNodes diffed vs live DOM | Fiber tree (retained VDOM) | No VDOM | No VDOM (compiled) | Retained VDOM with patches |
| **SSR** | renderToString + streaming | renderToPipeableStream | renderToString + streaming | Full SSR | renderToString + streaming |
| **Islands** | Built-in (core + server) | Third-party (Astro) | Not built-in | Not built-in | Not built-in |
| **Concurrent rendering** | No | Yes (Fiber) | No | No | No (experimental) |
| **TypeScript** | No types (`.d.ts` stubs) | Full TS support | Full TS support | Full TS support | Full TS support |
| **Ecosystem** | None | Massive | Growing | Growing | Large |
| **DevTools** | None | React DevTools | Solid DevTools | Svelte DevTools | Vue DevTools |
| **Testing** | Built-in basic utilities | Testing Library/Jest | Testing Library | Testing Library | Testing Library/Vitest |
| **State management** | Built-in store + atoms | Redux/Zustand/Jotai | Stores built-in | $state built-in | Pinia |
| **Compiler** | Babel plugin (JSX) | Babel/SWC (JSX) | Babel plugin (JSX) | Custom compiler | SFC compiler |
| **Hydration modes** | 6 modes (load/idle/visible/action/media/static) | Full hydration | Full hydration | Full hydration | Full hydration |

---

## 4. API Design Review

### 4.1 Reactive Primitives (`signal`, `computed`, `effect`, `batch`)

- **Intuitive:** Yes. The API surface matches Preact Signals almost exactly. Developers familiar with any signals-based system will feel at home.
- **Deviation:** `signal()` returns a callable function rather than an object with `.value`. This is the SolidJS pattern rather than the Preact pattern. Justified by slightly less syntactic noise (`count()` vs `count.value`).
- **Missing:** `createRoot` (ownership scope), `on` (explicit signal dependency tracking), `createMemo` with explicit dependencies. These are available in SolidJS and are necessary for advanced patterns like selective dependency tracking.

### 4.2 Hooks (`useState`, `useEffect`, `useRef`, etc.)

- **Intuitive:** Yes. These are direct React API clones. Any React developer can use them immediately.
- **Deviation:** `useSignal` is a hook that does not exist in React. It returns a raw signal, which is more powerful but breaks the "value, setter" convention. This is a good addition.
- **Missing:** `useTransition` (React's concurrent mode transition), `useDeferredValue`, `useId` (React has it; the a11y module has a different `useId`). The `useContext` implementation (line 133-143) walks the component stack at render time, which means context values are not reactive -- changing a context value does not re-render consumers.

### 4.3 Components (`Show`, `For`, `Switch/Match`, `Suspense`, `ErrorBoundary`)

- **Intuitive:** Yes. These follow SolidJS naming conventions directly.
- **Deviation:** `Show` (components.js:158-162) evaluates `when` eagerly: `const condition = typeof when === 'function' ? when() : when;`. This means `Show` itself re-reads the signal, subscribing the parent component's effect to the condition. In SolidJS, `Show` creates its own reactive scope. The What Framework approach means the entire parent component re-renders when the condition changes.
- **Bug in For:** `For` (components.js:167-179) evaluates `each` eagerly and returns a mapped array. This means the list is always fully re-created on every parent render, defeating the purpose of keyed reconciliation. SolidJS's `For` creates a reactive scope per item. What Framework's `For` is essentially just `list.map()` with extra steps.

### 4.4 Store (`createStore`, `atom`)

- **Intuitive:** Mostly. The `storeComputed` wrapper (store.js:18-21) is an awkward API choice. It exists because the framework cannot distinguish between actions and computeds by examining functions alone.
- **Deviation:** Actions use a Proxy (store.js:77-88) with `peek()` for reads and `set()` for writes. This means `this.count` in an action reads the current value (untracked), and `this.count = 5` writes via the proxy setter. This is clever but fragile -- developers must remember that actions read stale values unless they explicitly call the signal. Also, `this.items.push(item)` will not work because arrays are stored as plain values, not reactive proxies. Only `this.items = [...this.items, item]` would trigger a signal update.
- **Missing:** Middleware support, persistence, time-travel debugging (Redux DevTools integration).

### 4.5 Router

- **Intuitive:** Yes. The API is a blend of React Router and SolidJS Router patterns.
- **Issue:** `route` (router/src/index.js:15-26) uses getters that read signals. Reading `route.path` inside a component subscribes the component to `_url`. But `route` is a plain object with getters -- it is not a signal itself. This means `route.path` used in a conditional will subscribe the entire component effect to URL changes, causing full re-renders on every navigation. This is correct but coarse-grained.
- **Bug:** The `Router` component (line 175-247) calls `batch()` inside a render function (line 184-187). Since the Router component itself runs inside an effect, calling `batch` here triggers a `_params.set()` and `_query.set()` synchronously. These writes will not trigger new effects during the batch, but the batch `flush()` will run before the current effect completes, potentially causing re-entrancy issues.

### 4.6 Server / SSR

- **Solid implementation:** `renderToString` (server/src/index.js:10-39) and `renderToStream` (line 44-77) are straightforward and correct.
- **Missing:** Selective hydration (only hydrating parts of the page that changed), streaming Suspense boundaries (React 18's key innovation), head management during SSR (the `Head` component only works on the client).

### 4.7 Animation System

- **Spring physics:** The spring implementation (animation.js:19-115) is correct and uses the standard damped harmonic oscillator model. The `dt` cap at 0.064 (line 42) prevents explosion on long frames. Well done.
- **Missing:** Multi-dimensional springs (x, y, z), spring interpolation for objects, transition groups (AnimatePresence from Framer Motion).

### 4.8 Accessibility

- **Comprehensive:** The a11y module covers focus management, ARIA patterns, screen reader announcements, keyboard navigation, and skip links. This is more than most frameworks ship out of the box.
- **Issue:** `useFocusTrap` (a11y.js:29-84) does not handle dynamic content inside the trap. If new focusable elements are added to the container after the trap is activated, the tab order will not include them because `getFocusableElements` is called on each `Tab` keypress (line 51), which actually does handle dynamic content. Good.
- **Issue:** `useRovingTabIndex` (a11y.js:272-310) takes a static `itemCount` parameter. If the list is dynamic, the count will be stale. This should accept a signal or getter.

### 4.9 Data Fetching

- **Comprehensive:** `useFetch`, `useSWR`, `useQuery`, `useInfiniteQuery` cover most data fetching patterns.
- **Issue:** `scopedEffect` (data.js:13-18) checks `getCurrentComponent?.()` at call time. But many of these hooks create effects during component render. If a hook is called outside a component (e.g., in a module-level setup), `ctx` will be null, and the effect will never be disposed. The effect will run forever.
- **Missing:** Suspense integration. `useSWR` has a `suspense` option (line 89) but it is never implemented -- the option is declared but does nothing.

### 4.10 Form Handling

- **Good API design:** `useForm` closely follows React Hook Form's API, which is well-established and developer-friendly.
- **Issue:** `register` (form.js:65-87) returns a props object with `value`, `onInput`, `onBlur`, and `onFocus`. But `value` is read from `values()[name]`, which reads the signal in the parent component's render context. This means any field change re-renders the entire form component. React Hook Form avoids this with uncontrolled inputs. What Framework should either use refs for form state or provide field-level signal isolation.

### 4.11 Testing Utilities

- **Solid basics:** `render`, `fireEvent`, `waitFor`, `screen` -- the testing-library-inspired API is intuitive.
- **Issue:** `act` (testing.js:233-240) waits for one microtask and one setTimeout(0). This is not sufficient for effects that schedule via `requestAnimationFrame` (springs, scheduler) or `requestIdleCallback` (islands). A more robust flush mechanism is needed.
- **Missing:** `renderHook` utility, `within` scoped queries, `userEvent` simulation (as opposed to `fireEvent`).

---

## 5. Red Flags

### 5.1 Potential Bugs

1. **`patchNode` returns empty `DocumentFragment`** (dom.js:510-519): As described above, this breaks subsequent reconciliation for array vnodes.

2. **`createErrorBoundary` pushes/pops boundary during effect execution** (dom.js:242-251): Async errors cannot find their boundary.

3. **`computed` re-notification loop** (reactive.js:50-51): When a computed re-evaluates, it calls `notify(subs)`. If a subscriber of the computed is also a subscriber of the computed's dependency, it can run twice in the same cycle.

4. **`memo` stores `prevProps` in closure** (components.js:14-29): `memo` creates a closure over `prevProps` and `prevResult`. Since components run inside effects and can re-run reactively, the memo check happens on every effect run. But `prevResult` holds VNodes from the previous render, which may reference disposed DOM nodes. The stale VNode tree is returned to the reconciler, which may try to patch against nodes that no longer exist.

5. **`flush` in reactive.js does not handle re-entrant effects** (line 163-169): If an effect in the flush queue writes to a signal, the new pending effect is added to `pendingEffects` after it was cleared. This effect will not run until the next signal write.

### 5.2 Race Conditions

1. **`useSWR` revalidation on focus/reconnect** (data.js:138-157): Multiple revalidation triggers can fire simultaneously. The deduplication check uses timestamp comparison, but `Date.now()` can return the same value for calls within the same millisecond.

2. **`useEffect` cleanup timing** (hooks.js:67-86): Cleanup is scheduled via `queueMicrotask`, but the component can unmount (synchronously) before the microtask runs. The `ctx.disposed` check prevents the new effect from running, but the old cleanup has already been called by `disposeComponent`. If the effect was meant to set up a new resource and clean up the old one, the new resource is never set up.

3. **Island hydration** (islands.js:164-178): `processQueue` is not re-entrant safe. If `task.hydrate()` resolves synchronously (unlikely but possible with cached modules), `processQueue` could be called recursively via `queueMicrotask(processQueue)` before `isProcessingQueue` is set to `false` on line 176.

### 5.3 Memory Leak Patterns

1. **`useMediaQuery`** and **`useLocalStorage`**: Global listeners without cleanup (see section 2.2).
2. **`data.js` global cache**: Unbounded growth with no eviction.
3. **`debouncedCallbacks` in scheduler.js** (line 130): This is a module-level `Map` that could grow if keys are generated dynamically.
4. **`prefetchedUrls` in router** (line 407): Never cleared. Minor, but accumulates over the session.
5. **`scrollPositions` in router** (line 422): Same issue -- a `Map` that grows with every visited path.

### 5.4 Performance Cliffs

1. **`reconcileChildren` calls `Array.from(parent.childNodes)`** (dom.js:555): This creates a new array from a live NodeList on every reconciliation. For a component with 1000 children, this is 1000 array allocations per update.

2. **`For` component creates a full new array on every render** (components.js:167-179): No item-level reactivity. Changing one item in a 1000-item list re-creates all 1000 VNodes and reconciles all of them.

3. **`applyProps` checks `newProps[key] !== oldProps[key]`** (dom.js:607-609): This is identity comparison, which is correct for primitives but fails for objects (style objects, callback functions). Every render creates new inline objects and functions, causing unnecessary DOM writes for style and event handler props.

4. **`style` objects in `setProp`** (dom.js:649-658): When `style` is an object, the code iterates all style properties and sets them individually. But it does not remove style properties that were in the old style object but not in the new one. This can cause stale styles to persist.

---

## 6. What's Genuinely Good

### 6.1 Islands Architecture

The islands implementation is the framework's strongest differentiator. Having six hydration modes (load, idle, visible, action, media, static) with a priority queue (islands.js:147-178) and shared state across islands (islands.js:29-106) is more sophisticated than Astro's islands. The `boostIslandPriority` function (islands.js:181-190) that promotes island priority when a user interacts with a pending island is a clever UX optimization.

The compiler's `client:` directive syntax (babel-plugin.js:355-408) integrates seamlessly with JSX, making islands feel first-class rather than bolted on.

### 6.2 Unified Rendering Path

The decision to have a single rendering path -- JSX to babel plugin to `h()` to VNode to reconciler to DOM -- is architecturally clean. There are no parallel code paths (as exists in some frameworks with separate CSR and SSR renderers), which reduces bugs and maintenance burden.

### 6.3 Compiler Design

The Babel plugin (babel-plugin.js) is well-designed:

- **Two-way binding:** `bind:value={sig}` compiles to `{ value: sig(), onInput: e => sig.set(e.target.value) }` (line 252-274). This is syntactic sugar that compiles to standard props, meaning the runtime does not need special binding logic.
- **Event modifiers:** `onClick|preventDefault|once` compiles to a wrapped handler with `_eventOpts` attached (line 198-244). The IIFE pattern for attaching `_eventOpts` is clever but adds bundle overhead.
- **Auto-import:** The plugin automatically injects `import { h } from 'what-framework'` (line 490-544) when JSX is detected.

### 6.4 API Surface Breadth

For a ~4kB core, the framework ships an impressive amount of functionality: signals, hooks, reconciler, router, SSR, islands, animations (spring/tween), accessibility utilities, form handling, data fetching (SWR/Query), and testing utilities. This is more than most frameworks provide out of the box.

### 6.5 The `html` Tagged Template

The `html` tagged template (h.js:51-203) is a genuinely useful escape hatch for build-step-free development. The parser handles elements, attributes, spread, children, and interpolation. For prototyping or small projects, this eliminates the need for a build step entirely.

### 6.6 Scheduler Design

The read/write separation in the scheduler (scheduler.js) is based on the same principle as `fastdom` -- batch reads before writes to prevent layout thrashing. The integration with the reactive system via `useScheduledEffect` (line 100-109) is elegant.

---

## 7. Recommendations

### Top 10 Changes for Production-Readiness

1. **Fix the glitch problem in the reactivity system.** Implement either push-pull propagation (like Preact Signals v2) or topological sorting (like SolidJS). Effects outside of batch should be deferred to a microtask to prevent redundant executions. This is the single most important change.

2. **Fix the `patchNode` DocumentFragment bug** (dom.js:510-519). When an array VNode replaces a DOM node, track the inserted children individually rather than returning the empty fragment.

3. **Make `ErrorBoundary` tree-aware.** Replace the `errorBoundaryStack` runtime stack with a component-tree-based boundary lookup. Each component context should hold a reference to its nearest error boundary. This allows async errors to find their boundary.

4. **Add cleanup to `useMediaQuery` and `useLocalStorage`.** Return disposers from these hooks, or integrate with the component lifecycle via `onCleanup`. Without this, every component that uses these hooks leaks memory.

5. **Make `For` component item-reactive.** Instead of re-creating the entire list on every render, `For` should maintain a mapping of key to DOM node and only update items that changed. This is the approach used by SolidJS's `For` and is critical for list performance.

6. **Fix style diffing in `setProp`.** When applying style objects, track the old style properties and remove any that are absent from the new style. Currently, stale styles persist across updates.

7. **Add TypeScript declarations.** The framework has `.d.ts` stub files but no real type definitions. For a framework that wants to compete with React, full TypeScript support is table stakes. At minimum, generate types from JSDoc comments.

8. **Handle re-entrant flush in batch.** When effects in the flush queue write to signals, the new pending effects should be collected and flushed in a follow-up pass. Add a loop in `flush()` that continues until `pendingEffects` is empty.

9. **Add AbortController support to data fetching hooks.** `useFetch`, `useSWR`, and `useQuery` should create an AbortController per request and abort the previous request when a new one starts. This prevents memory leaks and race conditions.

10. **Implement context reactivity.** Currently, `useContext` reads the context value at render time (hooks.js:133-143). Changing a context value does not re-render consumers. Wrap context values in signals so that consumers automatically re-render when the value changes.

### Architecture Changes Worth Considering

- **Ownership tree for effects:** Implement `createRoot` (SolidJS-style) to create ownership scopes. Child effects should be automatically disposed when their parent scope is disposed. This eliminates the manual effect disposal pattern.

- **Compiled reactivity (Svelte 5 Runes-style):** Instead of diffing VNodes against the live DOM, consider a compile-time approach where the Babel plugin generates direct DOM operations for static structures and signal subscriptions for dynamic parts. This would eliminate the reconciler overhead for static content.

- **Concurrent rendering consideration:** The module-level `currentEffect` variable makes concurrent rendering impossible. If this is a non-goal, document it explicitly. If it is a future goal, consider a context-based approach (like React's fiber current pointer).

### Features to Add vs Remove

**Add:**
- `createRoot` / ownership scopes
- DevTools extension (signal inspection, component tree, performance profiling)
- `useTransition` for concurrent-mode-like deferred updates
- CSS scoping (CSS modules or styled components pattern)
- Error overlay for development mode
- Hot module replacement support in the Vite plugin
- `Suspense` integration with `useQuery`/`useSWR`

**Remove or Simplify:**
- `storeComputed` marker (find a better API -- perhaps use `get` keyword or a `derived()` wrapper inside the store definition)
- `NavLink` component (it is literally just `Link` re-exported -- line 289-291 in router)
- The `show()` helper function (it is just `condition ? a : b` -- the `Show` component is more useful)

### Developer Experience Improvements

1. **Development-mode warnings:** Warn when hooks are called conditionally, when signals are read outside reactive contexts, when components are mounted without a root.

2. **Hot module replacement:** The Vite plugin (vite-plugin.js) only transforms JSX. It should also handle HMR by preserving component state across module updates.

3. **Error messages:** Include component names in error messages. The `Component.name || 'Anonymous'` pattern (dom.js:193) is a start but should be extended to all error paths.

4. **Documentation:** The demo app serves as documentation, but a proper docs site with searchable API reference, migration guides (from React/Solid/Vue), and performance guides would significantly improve adoption.

---

## 8. Conclusion

What Framework has a coherent vision and an impressive breadth of features for its size. The "closest framework to vanilla JS" tagline is earned -- the code is readable, the abstractions are thin, and the rendering model is straightforward. The islands architecture is genuinely best-in-class, and the hybrid React/Solid reactivity model is an interesting design choice that lowers the barrier to entry for React developers.

However, the framework has correctness issues (glitch problem, DocumentFragment bug, ErrorBoundary stack), memory safety issues (leaked event listeners, unbounded caches), and missing capabilities (TypeScript, concurrent rendering, proper context reactivity) that prevent it from being production-ready. The reconciler, while simpler than React's Fiber, gives up important capabilities (interruptible rendering, priority-based scheduling) without the compile-time optimizations that Svelte and Solid use to compensate.

The path to production-readiness is achievable. The top 10 recommendations above address the most critical issues. The framework's small size means these changes can be made without the massive refactoring that larger frameworks would require. If the team addresses the reactivity correctness issues and adds proper TypeScript support, What Framework could find a real niche in the multi-page app / islands architecture space where its zero-JS-by-default approach is a genuine advantage over React, Solid, and Svelte.

**Rating:** 6.5/10 for production readiness, 8/10 for architecture and vision.
