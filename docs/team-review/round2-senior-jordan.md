# Round 2 Senior Developer Review: What Framework
**Reviewer:** Jordan (Senior Developer, 10+ years React/Vue/Svelte/SolidJS/Angular)
**Date:** 2026-02-13
**Scope:** Verification of Phase 1 fixes + deep-dive into data.js, form.js, animation.js, a11y.js, scheduler.js, actions.js
**Previous:** [Round 1 Review](./senior-developer-jordan.md)

---

## Executive Summary

Phase 1 addressed the three most critical bugs I identified in Round 1 (diamond glitch, DocumentFragment, ErrorBoundary stack) along with six other important fixes. The implementations are generally correct and the code quality has improved. However, several of the fixes introduce new edge cases or have subtle issues that need attention. Additionally, my deep-dive into the modules not covered in Round 1 reveals significant concerns in the data fetching layer, form system, and server actions that must be addressed before production use.

**Overall assessment post-Phase 1:** Improved from 6.5/10 to 7.5/10 for production readiness. The core reactivity and reconciliation correctness issues are resolved. The remaining gaps are in the newer modules (data, forms, actions) and in hardening the fixes that were applied.

---

## Part 1: Fix Verification

### Fix 1: Microtask-Deferred Effects (Diamond Dependency Glitch)
**Status: VERIFIED -- Correct with one concern**

The fix in `packages/core/src/reactive.js` lines 145-168:

```js
function notify(subs) {
  const snapshot = [...subs];
  for (const e of snapshot) {
    if (e.disposed) continue;
    if (e._onNotify) {
      e._onNotify();
    }
    // Always defer — batch and non-batch both collect into pendingEffects
    pendingEffects.add(e);
  }
  // If not in explicit batch, schedule a microtask flush
  if (batchDepth === 0) scheduleMicrotask();
}

let microtaskScheduled = false;
function scheduleMicrotask() {
  if (!microtaskScheduled) {
    microtaskScheduled = true;
    queueMicrotask(() => {
      microtaskScheduled = false;
      flush();
    });
  }
}
```

**Analysis:**

This is the correct fix. All effects now collect into `pendingEffects` regardless of whether we are inside `batch()` or not. Outside of batch, a microtask is scheduled to flush them. Inside batch, the `batch()` function's `finally` block calls `flush()` synchronously. The `microtaskScheduled` flag deduplicates multiple microtask schedules within the same tick. This solves the diamond dependency problem because all effects in the same microtask see consistent state.

**Concern -- timing gap for imperative code:**

Consider this pattern:
```js
const count = signal(0);
count.set(1);
console.log(someEl.textContent); // Still shows "0" -- DOM hasn't updated yet
```

Before the fix, the DOM would have updated synchronously. Now it updates asynchronously. This is the correct behavior (it matches React's `setState` semantics), but any code that relied on synchronous DOM updates after signal writes will break silently. The `flushSync()` export mitigates this, but existing code that was written against the old synchronous behavior will need to be audited.

**Edge case -- `effect()` initial run:**

The `effect()` function (line 78-82) still runs the initial effect synchronously via `_runEffect(e)`. This is correct -- the initial execution of an effect should be synchronous so that the component tree builds up deterministically during mount. Only subsequent re-executions (triggered by signal changes) are deferred. This is the right split.

**Verdict: Fix is sound. No regressions. Minor documentation concern about migration from synchronous behavior.**

---

### Fix 2: Marker Comments for Array VNodes in patchNode
**Status: VERIFIED -- Correct with one edge case**

The fix in `packages/core/src/dom.js` lines 546-558:

```js
if (Array.isArray(vnode)) {
  const startMarker = document.createComment('[');
  const endMarker = document.createComment(']');
  disposeTree(domNode);
  parent.replaceChild(endMarker, domNode);
  parent.insertBefore(startMarker, endMarker);
  for (const v of vnode) {
    const node = createDOM(v, parent);
    if (node) parent.insertBefore(node, endMarker);
  }
  startMarker._arrayEnd = endMarker;
  return startMarker;
}
```

**Analysis:**

This replaces the broken `DocumentFragment` approach with marker comments. The `startMarker` and `endMarker` bracket the array's content, and `startMarker._arrayEnd` provides a reference to find the end. The function returns `startMarker`, which is a stable DOM node that persists after insertion. This correctly solves the empty-fragment-after-append problem from Round 1.

**Edge case -- subsequent patches to the array node:**

When `patchNode` is called again on the `startMarker` (which is a comment node with `nodeType === 8`), the null/false/true check on line 520-529 will match:

```js
if (vnode == null || vnode === false || vnode === true) {
  if (domNode && domNode.nodeType === 8 && !domNode._componentCtx) {
    return domNode; // already a placeholder comment
  }
  ...
}
```

If the new vnode is `null`, this will return the `startMarker` as a placeholder, but the content between `startMarker` and `endMarker` will NOT be cleaned up. The children inserted between the markers will persist as orphans. The check needs to also handle the case where `domNode._arrayEnd` exists:

```js
if (vnode == null || vnode === false || vnode === true) {
  if (domNode && domNode.nodeType === 8 && domNode._arrayEnd) {
    // Clean up array content between markers
    let node = domNode.nextSibling;
    while (node && node !== domNode._arrayEnd) {
      const next = node.nextSibling;
      disposeTree(node);
      parent.removeChild(node);
      node = next;
    }
    parent.removeChild(domNode._arrayEnd);
    // Replace start marker with plain placeholder
    const placeholder = document.createComment('');
    parent.replaceChild(placeholder, domNode);
    return placeholder;
  }
  if (domNode && domNode.nodeType === 8 && !domNode._componentCtx) {
    return domNode;
  }
  ...
}
```

Similarly, if `patchNode` is called on `startMarker` with a non-array vnode (e.g., a string or element), the marker comments and their content need to be cleaned up before replacement.

**NEW BUG: Array-to-array patching is not handled.** If `patchNode` receives a `startMarker` (from a previous array render) and a new array vnode, it will hit the array branch again and create new markers, but the old markers and content between them will leak. The code should detect `domNode._arrayEnd` and reconcile the content between the markers rather than creating new ones.

**Verdict: Fix solves the original bug. Introduces a new edge case with array-to-non-array and array-to-array transitions. Severity: Medium -- this will only manifest when a component switches between returning an array and a non-array, or when arrays are nested.**

---

### Fix 3: ErrorBoundary Tree-Based Resolution via _parentCtx
**Status: VERIFIED -- Correct implementation**

In `packages/core/src/dom.js` lines 166-183 (createComponent):

```js
const ctx = {
  hooks: [],
  hookIndex: 0,
  effects: [],
  cleanups: [],
  mounted: false,
  disposed: false,
  Component,
  _parentCtx: componentStack[componentStack.length - 1] || null,
  _errorBoundary: (() => {
    let p = componentStack[componentStack.length - 1];
    while (p) {
      if (p._errorBoundary) return p._errorBoundary;
      p = p._parentCtx;
    }
    return null;
  })()
};
```

And in `packages/core/src/components.js` lines 142-153 (reportError):

```js
export function reportError(error, startCtx) {
  let ctx = startCtx || _getCurrentComponent?.();
  while (ctx) {
    if (ctx._errorBoundary) {
      ctx._errorBoundary(error);
      return true;
    }
    ctx = ctx._parentCtx;
  }
  return false;
}
```

And in `packages/core/src/dom.js` lines 257-301 (createErrorBoundary):

```js
const boundaryCtx = {
  hooks: [], hookIndex: 0, effects: [], cleanups: [],
  mounted: false, disposed: false,
  _parentCtx: componentStack[componentStack.length - 1] || null,
  _errorBoundary: handleError,
};
wrapper._componentCtx = boundaryCtx;
```

**Analysis:**

This is exactly the fix I recommended in Round 1. Each component context now stores `_parentCtx` pointing to its parent component context, and `_errorBoundary` is resolved eagerly at creation time by walking up the `_parentCtx` chain. The `createErrorBoundary` function creates a boundary context with `_errorBoundary: handleError`, which child components will find during their own `_errorBoundary` resolution.

The `reportError` function now walks the `_parentCtx` chain from the starting context, which works for both synchronous and asynchronous errors because the chain is a persistent data structure, not a runtime stack.

**Potential issue -- stale _errorBoundary after boundary disposal:**

If an error boundary component is disposed (e.g., it is removed from the tree by a parent re-render), child components that cached its `_errorBoundary` handler still hold a reference to the disposed boundary's handler. Calling this handler would invoke `errorState.set(error)` on a potentially stale signal. However, this is a minor issue because:
1. Child components under a disposed boundary would themselves be disposed.
2. Signal writes on disposed component signals are harmless (they trigger effects that check `ctx.disposed`).

**Observation -- `errorBoundaryStack` still exported:**

`components.js` line 8 still exports `errorBoundaryStack`:
```js
export const errorBoundaryStack = [];
```

This is dead code now. It should be removed to avoid confusion. It is exported from `components.js` but no longer used by `dom.js`.

**Verdict: Fix is correct and well-implemented. Minor cleanup needed (remove dead `errorBoundaryStack`). No regressions.**

---

### Fix 4: flush() Loops Until pendingEffects is Empty
**Status: VERIFIED -- Correct**

In `packages/core/src/reactive.js` lines 171-184:

```js
function flush() {
  let iterations = 0;
  while (pendingEffects.size > 0 && iterations < 100) {
    const effects = [...pendingEffects];
    pendingEffects.clear();
    for (const e of effects) {
      if (!e.disposed && !e._onNotify) _runEffect(e);
    }
    iterations++;
  }
  if (iterations >= 100) {
    console.warn('[what] Possible infinite effect loop detected');
  }
}
```

**Analysis:**

This fixes the "effects that write to signals during flush are dropped" bug from Round 1. Now `flush()` loops until `pendingEffects` is empty, with a safety limit of 100 iterations. If an effect writes to a signal during execution, the signal's `notify()` call adds new effects to `pendingEffects`, and the `while` loop picks them up in the next iteration.

The 100-iteration guard is reasonable. React uses a similar limit (50 nested setState calls). SolidJS has no explicit limit but relies on its push-pull model to converge naturally.

**One subtlety:** Inside the loop, effects with `_onNotify` are skipped: `if (!e.disposed && !e._onNotify) _runEffect(e)`. This means computed signals (which have `_onNotify`) are never directly run by `flush()`. They are instead marked dirty via `_onNotify` and lazily re-evaluated when read. This is correct -- computeds should not be eagerly evaluated during flush because they might not be read by anyone.

**Verdict: Fix is correct, no regressions.**

---

### Fix 5: Memory Leak Cleanup for useMediaQuery and useLocalStorage
**Status: VERIFIED -- Correct**

In `packages/core/src/helpers.js` lines 85-100 (useMediaQuery):

```js
export function useMediaQuery(query) {
  if (typeof window === 'undefined') return signal(false);
  const mq = window.matchMedia(query);
  const s = signal(mq.matches);
  const handler = (e) => s.set(e.matches);
  mq.addEventListener('change', handler);

  const ctx = _getCurrentComponentRef?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(() => mq.removeEventListener('change', handler));
  }

  return s;
}
```

And lines 104-144 (useLocalStorage):

```js
const ctx = _getCurrentComponentRef?.();
if (ctx) {
  ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
  ctx._cleanupCallbacks.push(() => {
    dispose();
    if (storageHandler) window.removeEventListener('storage', storageHandler);
  });
}
```

**Analysis:**

Both hooks now check for a component context and register cleanup callbacks. When the component unmounts, `disposeComponent` in `dom.js` (lines 37-61) runs `ctx._cleanupCallbacks`, which removes the event listeners.

**Remaining concern -- usage outside components:**

If `useMediaQuery` or `useLocalStorage` is called outside a component context (e.g., at module scope), `_getCurrentComponentRef?.()` returns `null`, and no cleanup is registered. The event listener persists forever. This is technically correct behavior (module-scope state should persist) but should be documented as a known characteristic. Alternatively, both functions could return a dispose function alongside the signal.

**Verdict: Fix is correct. Memory leak is resolved for component-scoped usage. Module-scope usage still leaks by design.**

---

### Fix 6: Router Link '/' Exact Match for Active State
**Status: VERIFIED -- Correct**

In `packages/router/src/index.js` line 265:

```js
const isActive = href === '/' ? currentPath === '/' : currentPath.startsWith(href);
```

**Analysis:**

This is the exact fix I would have written. The home link (`/`) now only gets the `active` class when the current path is exactly `/`. All other links continue to use `startsWith` for prefix matching (e.g., `/users` is active when on `/users/123`).

**Minor edge case:** Links to paths that are prefixes of other paths but are not `/` will still incorrectly show as active. For example, a link to `/blog` will show as active when on `/blog-archive`. The `startsWith` check does not verify a path boundary. A more robust check would be:

```js
const isActive = href === '/'
  ? currentPath === '/'
  : currentPath === href || currentPath.startsWith(href + '/');
```

This ensures `/blog` is active for `/blog/123` but not for `/blog-archive`. This is how React Router and Vue Router handle it.

**Verdict: Fix resolves the reported bug. Minor improvement opportunity for non-root prefix matching.**

---

### Fix 7: Style Diffing with _prevStyle
**Status: VERIFIED -- Correct**

In `packages/core/src/dom.js` lines 687-703:

```js
if (key === 'style') {
  if (typeof value === 'string') {
    el.style.cssText = value;
    el._prevStyle = null;
  } else if (typeof value === 'object') {
    const oldStyle = el._prevStyle || {};
    for (const prop in oldStyle) {
      if (!(prop in value)) el.style[prop] = '';
    }
    for (const prop in value) {
      el.style[prop] = value[prop] ?? '';
    }
    el._prevStyle = { ...value };
  }
}
```

**Analysis:**

This correctly tracks the previous style object on `el._prevStyle` and removes stale properties by setting them to `''`. When the style is a string (cssText), `_prevStyle` is cleared. This handles the style-string-to-style-object transition correctly.

**Edge case -- `null` or `undefined` in style values:**

`value[prop] ?? ''` correctly handles `null` and `undefined` values in the style object by setting the property to `''` (which removes it from inline styles). This is the right behavior.

**Edge case -- switching from style object to no style:**

If a component renders with `style={{ color: 'red' }}` and then renders without a `style` prop, the `removeProp` function (line 757-760) handles this by setting `el.style.cssText = ''`, which clears all inline styles. This is correct. However, `el._prevStyle` is not cleared in `removeProp`. On the next render that adds a style object, `_prevStyle` will contain stale data from the earlier render. This is not a functional bug because `_prevStyle` is only used to diff against the new style, and the stale properties would be correctly identified as absent from the new style. But it is a minor memory retention issue.

**Verdict: Fix is correct and handles edge cases properly. Minor memory concern with stale _prevStyle after style removal, but functionally sound.**

---

### Fix 8: `<what-c>` Registered as Custom Element
**Status: VERIFIED -- Correct**

In `packages/core/src/dom.js` lines 11-18:

```js
if (typeof customElements !== 'undefined' && !customElements.get('what-c')) {
  customElements.define('what-c', class extends HTMLElement {
    constructor() {
      super();
      this.style.display = 'contents';
    }
  });
}
```

**Analysis:**

This registers `<what-c>` as a proper custom element with `display: contents` set in the constructor. This eliminates the flash of incorrect layout that I flagged in Round 1, because the element has its display mode set as soon as it is created, before it is appended to the DOM.

The `typeof customElements !== 'undefined'` guard handles SSR environments where `customElements` does not exist. The `!customElements.get('what-c')` guard prevents double-registration if the module is loaded multiple times.

**Observation:** The `createComponent` function (line 192) also sets `wrapper.style.display = 'contents'` redundantly after creating the element. Since the custom element's constructor already sets this, the line is unnecessary but harmless. It could be removed for cleanliness.

**Verdict: Fix is correct. No regressions.**

---

### Fix 9: flushSync() Export
**Status: VERIFIED -- Correct**

In `packages/core/src/reactive.js` lines 188-191:

```js
export function flushSync() {
  microtaskScheduled = false;
  flush();
}
```

And exported in `packages/core/src/index.js` line 5:

```js
export { signal, computed, effect, batch, untrack, flushSync } from './reactive.js';
```

**Analysis:**

`flushSync()` sets `microtaskScheduled = false` (cancelling the pending microtask flush) and then calls `flush()` synchronously. This is the escape hatch for code that needs synchronous effect execution after signal writes.

**Concern -- ordering guarantee:**

Setting `microtaskScheduled = false` means that if any effects during the `flush()` call trigger new signal writes, those writes will schedule a NEW microtask (because `microtaskScheduled` is now `false`). This could cause effects to run twice: once in the synchronous `flush()` and once in the subsequently-scheduled microtask. However, looking at the `flush()` implementation, it loops until `pendingEffects` is empty, so all effects triggered during the synchronous flush will be processed. The microtask will find `pendingEffects` empty and be a no-op. This is correct.

Actually, wait -- there is a subtle issue. After `flushSync()` calls `flush()`, which processes all pending effects, if any of those effects trigger new signal writes, `notify()` is called, which adds to `pendingEffects` AND calls `scheduleMicrotask()`. But we are inside `flush()`, which loops while `pendingEffects.size > 0`. So the new effects ARE processed in the same `flush()` call. The microtask scheduled by `scheduleMicrotask()` will fire later and find `pendingEffects` empty. This is correct but wasteful (an unnecessary microtask is scheduled). Not a bug, just minor inefficiency.

**Verdict: Fix is correct. Provides the needed escape hatch for synchronous updates.**

---

## Part 2: Deep Dive -- Data Fetching (data.js)

### Comparison to Real SWR (vercel/swr)

The `useSWR` implementation in `packages/core/src/data.js` covers the core SWR pattern but has significant gaps compared to the production `swr` library:

**What is implemented:**
- Stale-while-revalidate cache pattern
- Revalidation on focus and reconnect
- Polling (refreshInterval)
- Request deduplication (dedupingInterval)
- Optimistic mutations via `mutate()`

**What is missing compared to vercel/swr:**
1. **Global configuration** -- vercel/swr has `SWRConfig` provider for default settings. What has no global config.
2. **Dependent fetching** -- vercel/swr supports `useSWR(user ? `/api/users/${user.id}` : null, fetcher)` where a `null` key skips fetching. What's `useSWR` always fetches.
3. **Conditional fetching** -- No way to disable/enable fetching based on a signal.
4. **Error retry** -- vercel/swr retries failed requests with exponential backoff. What's `useSWR` has no retry logic (though `useQuery` does).
5. **Middleware** -- vercel/swr supports middleware for logging, persistence, etc.
6. **Subscription** -- vercel/swr supports `useSWRSubscription` for WebSocket-like data sources.
7. **Immutable mode** -- vercel/swr has `useSWRImmutable` for data that never changes.

### Cache Invalidation Correctness

**BUG: Global cache is shared but not reactive.**

The `cache` Map (line 8) stores raw values. When `useSWR` sets `data.set(result)` and `cache.set(key, result)` (lines 116-118), the cache is updated. But if two components use `useSWR` with the same key, they each create their OWN `data` signal. Mutating the cache via `cache.set(key, newValue)` does NOT update the other component's signal. They are completely disconnected.

In vercel/swr, the cache is a reactive store. When one component calls `mutate(key, newData)`, ALL components using that key re-render with the new data. What's implementation only updates the local signal. The `invalidateQueries` function (lines 415-425) deletes from the cache Map but does not notify any active subscribers.

This is a fundamental design flaw. The cache should use reactive signals internally, or there should be a subscription mechanism so that all `useSWR` instances for the same key share the same signal.

```js
// Current: each useSWR creates its own signal
const data = signal(cache.get(key) || fallbackData || null);

// Should be: shared signal per key
const data = getOrCreateCacheSignal(key, fallbackData);
```

### Race Conditions in Concurrent Fetches

**BUG: Deduplication uses timestamp, not promise identity.**

Lines 100-106:
```js
if (inFlightRequests.has(key)) {
  const existingPromise = inFlightRequests.get(key);
  const now = Date.now();
  if (now - existingPromise.timestamp < dedupingInterval) {
    return existingPromise.promise;
  }
}
```

If two revalidation calls happen within the same millisecond (very possible with microtask-deferred effects), `Date.now()` returns the same value. The second call sees `now - existingPromise.timestamp === 0`, which is less than `dedupingInterval`, so it correctly returns the existing promise. This specific case works.

However, there is a more subtle race: if a revalidation completes (line 128: `inFlightRequests.delete(key)`) and a new revalidation starts within the `dedupingInterval` window, the deduplication check will NOT find an in-flight request (it was deleted) and will start a new fetch. This defeats the purpose of `dedupingInterval`. vercel/swr handles this by tracking the timestamp of the LAST successful fetch, not the current in-flight request.

**No AbortController usage.**

Neither `useSWR` nor `useFetch` creates an AbortController. When a component unmounts while a fetch is in flight, the fetch continues and resolves into void. The signal write (`data.set(result)`) fires but the signal's subscribers (the component's effect) are disposed, so no DOM update occurs. This is not a functional bug, but the HTTP request wastes bandwidth and server resources.

### Memory Management of the Cache

**BUG: Unbounded cache growth.**

The `cache` Map grows indefinitely. `useSWR` adds to the cache on every successful fetch (line 118: `cache.set(key, result)`) but never removes entries. The `clearCache()` function (line 442) exists but must be called manually.

`useQuery` has a `cacheTime` parameter with a cleanup timeout (lines 251-255):
```js
setTimeout(() => {
  if (Date.now() - lastFetchTime >= cacheTime) {
    cache.delete(key);
  }
}, cacheTime);
```

But this timeout fires even if the component has unmounted, potentially accessing stale `lastFetchTime`. The cleanup should be tied to component lifecycle via `scopedEffect`.

**The `inFlightRequests` Map has a minor leak.** If a fetch throws an error, line 128 (`inFlightRequests.delete(key)`) runs in the `finally` block, so it IS cleaned up. But if the `fetcher(key)` call itself throws synchronously (not returning a promise), the `inFlightRequests.set(key, ...)` on line 111 has already run, but the `finally` block might not catch the synchronous throw depending on the error path. Actually, since `revalidate` is `async`, any synchronous throw from `fetcher(key)` on line 110 would be caught by the `try/catch` wrapping the `await promise`. So this is fine. No leak.

---

## Part 3: Deep Dive -- Form System (form.js)

### Comparison to React Hook Form

The `useForm` API closely mirrors React Hook Form's (RHF) API surface. The `register`, `handleSubmit`, `setValue`, `watch`, and `formState` patterns are all present. However, there are critical performance and correctness differences.

**Performance: Entire form re-renders on every field change.**

RHF uses uncontrolled inputs by default. When a user types in a field, the DOM input holds the value, and RHF's internal state is updated without triggering React re-renders. Only validation state changes cause re-renders, and those are isolated to the relevant field.

What's `useForm` uses a single `values` signal (line 19: `const values = signal({ ...defaultValues })`). Every call to `setValue` (line 94: `values.set({ ...values.peek(), [name]: value })`) triggers every component that reads `values()` to re-render. The `register` function (line 68: `value: values()[name]`) reads the entire `values` signal in the component's render context, subscribing the component to ALL field changes.

For a form with 20 fields, every keystroke in any field causes the entire form component to re-render and all 20 fields to be reconciled. RHF avoids this entirely.

**Fix recommendation:** Use per-field signals instead of a single values signal:

```js
const fieldSignals = {};
function getFieldSignal(name) {
  if (!fieldSignals[name]) {
    fieldSignals[name] = signal(defaultValues[name] ?? '');
  }
  return fieldSignals[name];
}

function register(name) {
  const fieldSig = getFieldSignal(name);
  return {
    name,
    value: fieldSig(),  // Only subscribes to THIS field's signal
    onInput: (e) => {
      fieldSig.set(e.target.value);
      // ...
    },
  };
}
```

### Validation Flow Correctness

The `validate` function (lines 41-62) calls the resolver with the entire `values()` object. This is correct -- validation rules often need to access multiple fields (e.g., "password confirmation must match password"). However:

**Issue: Full-form validation on single-field change.**

When `mode === 'onChange'`, every keystroke triggers `validate(name)` (line 73-75). The resolver receives ALL values and returns errors for ALL fields. This means that even though only one field changed, the resolver runs validation for every field. For simple validators this is fast, but for Zod or Yup schemas with async validators (e.g., checking email uniqueness), this could be expensive.

RHF solves this with per-field validation. The resolver is only called for the specific field that changed in onChange mode, unless `criteriaMode: 'all'` is set.

**Issue: Validation is async but UI updates are not batched.**

`validate()` is `async` (line 41). The `errors.set()` call inside happens after an `await`, which means it fires outside the component's synchronous render cycle. This triggers a microtask-deferred effect, which is correct post-Phase 1, but it means the error state update is always one microtask behind the value change. In practice, this means a brief flash where the value has updated but the error message has not.

### Missing Features vs RHF

1. **Field arrays** -- RHF has `useFieldArray` for dynamic lists of fields. What has no equivalent.
2. **Uncontrolled mode** -- RHF defaults to uncontrolled inputs for performance. What only supports controlled.
3. **Focus management on error** -- RHF can auto-focus the first field with an error on submit. What does not.
4. **DevTools** -- RHF has a DevTools extension for inspecting form state. What has none.
5. **Form context** -- RHF has `FormProvider` + `useFormContext` for deeply nested form components. What does not propagate form state through context.

---

## Part 4: Deep Dive -- Animation System (animation.js)

### Spring Physics Correctness

The spring implementation (lines 19-115) uses the Euler integration method:

```js
const displacement = currentVal - targetVal;
const springForce = -stiffness * displacement;
const dampingForce = -damping * vel;
const acceleration = (springForce + dampingForce) / mass;
const newVelocity = vel + acceleration * dt;
const newValue = currentVal + newVelocity * dt;
```

**This is first-order Euler integration, not Verlet or RK4.** Euler integration is the simplest but least stable numerical integration method. For stiff springs (high stiffness, low damping), Euler integration can become numerically unstable -- the spring "explodes" with values oscillating to infinity.

The `dt` cap at 0.064 seconds (line 42) helps prevent this by ensuring the time step never gets too large (e.g., when the tab is backgrounded and then focused). This is a good mitigation.

**Comparison to Framer Motion / react-spring:**

- **Framer Motion** uses a more sophisticated integration with adaptive time-stepping. It also defaults to different spring parameters (stiffness: 100, damping: 10 produces relatively oscillatory motion compared to Framer's defaults).
- **react-spring** uses a similar approach to What but with Verlet integration, which is more numerically stable for the same computational cost.
- **GSAP** uses easing curves rather than physics simulation, so it is not directly comparable. GSAP's springs are more of a visual approximation.

**Missing: multi-value springs.**

What's `spring()` only supports a single scalar value. For UI animations, you typically need to animate multiple properties simultaneously (e.g., `{ x, y, scale, opacity }`). Framer Motion and react-spring both support object-valued springs:

```js
// Framer Motion style
const x = spring(0);
const y = spring(0);
// vs. what most developers want:
const pos = spring({ x: 0, y: 0, scale: 1 });
```

### Integration with Reactive System

The spring creates signals for `current`, `target`, `velocity`, and `isAnimating`. The `tick` function uses `requestAnimationFrame` and writes to signals via `batch()`:

```js
batch(() => {
  velocity.set(newVelocity);
  current.set(newValue);
});
```

**This is correct.** The `batch()` ensures both signal writes trigger a single effect flush. Since effects are now microtask-deferred (Fix 1), the DOM update happens after the RAF callback completes, which means the spring's position and velocity are consistent when the DOM updates.

**Concern -- signal reads inside RAF:**

`current.peek()`, `target.peek()`, and `velocity.peek()` are used inside `tick()` to avoid subscribing the RAF loop to the signals. This is correct -- using `.peek()` instead of calling the signal as a function prevents the RAF from being treated as a reactive subscriber.

**Missing: cleanup on component unmount.**

The `spring()` function stores `rafId` (line 32) but does not register cleanup with any component context. If a spring is created inside a component and the component unmounts while the spring is animating, the RAF loop continues running, reading from and writing to signals that no longer affect any DOM. The writes are harmless (signals accept writes from anywhere), but the RAF loop wastes CPU.

The `scopedEffect` pattern used in `animation.js` line 9-14 should be used to clean up springs:

```js
// If inside a component, register stop() as cleanup
const ctx = getCurrentComponent?.();
if (ctx) {
  ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
  ctx._cleanupCallbacks.push(stop);
}
```

### Gesture System

The `useGesture` function (lines 237-438) attaches `mousemove`, `touchmove`, `mouseup`, and `touchend` listeners to `window`. This is correct for drag handling (you need to track the mouse even when it moves outside the element). The listeners are cleaned up when the scoped effect disposes.

**Issue: Passive touch listeners.**

Line 418: `el.addEventListener('touchstart', handleStart, { passive: true })`. This is correct for performance (passive touch listeners do not block scrolling). However, `handleMove` (attached to `window`) does NOT prevent default, which means the page will scroll while dragging. If a developer wants to prevent scrolling during a drag gesture, they need to add `{ passive: false }` and call `e.preventDefault()` in `handleMove`. The gesture system should expose a `preventDefault` option.

---

## Part 5: Deep Dive -- Server Actions (actions.js)

### Comparison to Next.js Server Actions

What's server actions are architecturally similar to Next.js Server Actions but with significant security gaps.

**Similarities:**
- Functions are defined server-side and called client-side via RPC
- The transport is HTTP POST with JSON serialization
- Action IDs are used to route requests to the correct handler

**Differences from Next.js:**
1. **No encryption of action IDs.** Next.js encrypts server action IDs so clients cannot enumerate or call arbitrary server functions. What uses plain incremental IDs (`action_1`, `action_2`, etc.) which are trivially predictable.
2. **No closure binding.** Next.js Server Actions can close over server-side variables. What's actions only receive client-provided arguments.
3. **No built-in form integration.** Next.js Server Actions can be used as form `action` attributes. What requires explicit `formAction()` wrapper.

### Security Concerns

**CRITICAL: No CSRF protection.**

The `callAction` function (lines 34-71) sends a POST request to `/__what_action` with a JSON body. There is no CSRF token. Any malicious website can submit a form or send a fetch request to this endpoint, potentially executing server-side actions with the user's session.

Next.js Server Actions include a CSRF token automatically. What needs:

```js
// Server: set CSRF token cookie
// Client: include token in request header
headers: {
  'Content-Type': 'application/json',
  'X-What-Action': id,
  'X-CSRF-Token': getCsrfToken(), // MISSING
},
```

**CRITICAL: No input validation on server handler.**

`handleActionRequest` (lines 244-256) passes client-provided `args` directly to the action function:

```js
return action.fn(...args)
```

There is no validation, sanitization, or type checking of the arguments. A malicious client can send arbitrary JSON as arguments. Combined with the predictable action IDs, an attacker could call any registered action with any arguments.

**Issue: No rate limiting or authentication checks.**

The `handleActionRequest` function has no middleware hooks for authentication or rate limiting. Any client that can reach `/__what_action` can execute any registered action.

**Issue: Error messages leak server details.**

Line 252-254:
```js
.catch(error => ({
  status: 500,
  body: { message: error.message || 'Action failed' },
}));
```

`error.message` could contain database error messages, file paths, or other sensitive server information. Production error responses should return generic messages and log the details server-side.

### Error Handling

The `useAction` hook (lines 127-158) correctly tracks `isPending`, `error`, and `data` states. The `trigger` function uses `try/catch/finally` with proper signal updates.

**Issue: No timeout.**

If the server action never responds (e.g., server is down), the `fetch()` call will hang indefinitely (until the browser's default timeout, which is typically 300 seconds). There should be an `AbortController` with a configurable timeout.

### Optimistic Updates

The `useOptimistic` hook (lines 184-215) is a reasonable implementation. The `addOptimistic` function applies the reducer immediately (optimistic update), and `resolve`/`rollback` handle the server response. However:

**Issue: No automatic rollback on error.**

The developer must manually call `rollback()` when a server action fails. In Next.js, optimistic updates are automatically rolled back when the server action throws. What should integrate `useOptimistic` with `useAction` to provide automatic rollback.

---

## Part 6: Deep Dive -- Scheduler (scheduler.js)

### Comparison to React's Scheduler

React's scheduler (`scheduler` package) implements a priority-based task scheduling system with five priority levels (Immediate, UserBlocking, Normal, Low, Idle), time-slicing, and cooperative multitasking. It uses `MessageChannel` for scheduling because `requestAnimationFrame` does not fire when the tab is backgrounded.

What's scheduler is fundamentally different -- it is a layout-thrashing prevention tool (like `fastdom`), not a task scheduler. It batches DOM reads before writes within a single `requestAnimationFrame` callback.

**This is a design choice, not a bug.** What does not need React's scheduler because it does not do time-slicing or interruptible rendering. The layout-thrashing prevention is a valuable utility for direct DOM access patterns.

### Interaction with Microtask-Deferred Effects

**Potential ordering issue:**

1. Signal write triggers microtask-scheduled `flush()`.
2. `flush()` runs effects, which may call `scheduleRead()` or `scheduleWrite()`.
3. The scheduler batches reads/writes in a `requestAnimationFrame` callback.

The ordering is: signal write -> microtask -> effect runs -> schedules DOM operations -> RAF -> DOM operations execute.

This means there is at least one frame of delay between a signal change and a scheduled DOM operation. For most UI updates, this is fine. But for animations (which use `requestAnimationFrame` directly), there could be a one-frame visual glitch where the signal has updated but the DOM has not.

The `useScheduledEffect` (lines 100-109) wraps an effect around a `scheduleRead`:

```js
export function useScheduledEffect(readFn, writeFn) {
  return effect(() => {
    scheduleRead(() => {
      const data = readFn();
      if (writeFn) {
        scheduleWrite(() => writeFn(data));
      }
    });
  });
}
```

**Issue: The effect creates a new `scheduleRead` closure on every run.** Since effects are now microtask-deferred, the `scheduleRead` call happens inside a microtask. The RAF for the read will fire in the next frame. If the signal changes rapidly (e.g., during a drag), each change creates a new read/write pair, but only the last RAF callback matters. The `raf()` debounce helper (lines 132-144) exists for this exact purpose but is not used by `useScheduledEffect`.

### The `debouncedCallbacks` Map Leak

Lines 130-144:
```js
const debouncedCallbacks = new Map();
export function raf(key, fn) {
  if (debouncedCallbacks.has(key)) {
    debouncedCallbacks.set(key, fn);
  } else {
    debouncedCallbacks.set(key, fn);
    requestAnimationFrame(() => {
      const callback = debouncedCallbacks.get(key);
      debouncedCallbacks.delete(key);
      if (callback) callback();
    });
  }
}
```

The `debouncedCallbacks` Map is cleaned up after each RAF callback fires. However, if `raf()` is called with a key and then the component unmounts before the RAF fires, the callback closure retains references to the component's scope. The RAF will fire, execute the callback (which may access disposed signals), and then clean up the entry. The callback executing on a disposed component is harmless (signal writes to disposed components are no-ops), but the closure retains memory until the RAF fires.

This is a very minor issue. The maximum retention time is one frame (~16ms).

---

## Part 7: Deep Dive -- Accessibility (a11y.js)

### Overall Assessment

The a11y module is comprehensive for a framework-included package. Focus trapping, screen reader announcements, ARIA helpers, roving tab index, and keyboard navigation are all present. This is more than React, Solid, or Svelte ship out of the box.

### Issues Found

**Issue 1: `FocusTrap` component creates unscoped effect.**

Lines 108-116:
```js
export function FocusTrap({ children, active = true }) {
  const containerRef = { current: null };
  const trap = useFocusTrap(containerRef);

  effect(() => {
    if (active) {
      const cleanup = trap.activate();
      return () => {
        cleanup?.();
        trap.deactivate();
      };
    }
  });
  return h('div', { ref: containerRef }, children);
}
```

The `effect()` call creates a standalone reactive effect, not a component-scoped one. When the `FocusTrap` component unmounts, this effect is NOT automatically disposed because it is not registered on the component context. It should use `onCleanup` from hooks.js or the `scopedEffect` pattern.

**Issue 2: `useRovingTabIndex` takes static `itemCount`.**

As flagged in Round 1, `useRovingTabIndex(itemCount)` captures `itemCount` at call time. If the list is dynamic, the modular arithmetic wraps incorrectly:

```js
focusIndex.set((focusIndex.peek() + 1) % itemCount);
```

If `itemCount` was 5 when the hook was created but the list now has 3 items, pressing ArrowDown from index 2 would set `focusIndex` to 3, which is out of bounds. This should accept a signal or getter:

```js
export function useRovingTabIndex(itemCountOrSignal) {
  const getCount = typeof itemCountOrSignal === 'function'
    ? itemCountOrSignal
    : () => itemCountOrSignal;
  // ...
  focusIndex.set((focusIndex.peek() + 1) % getCount());
}
```

**Issue 3: `useId` creates a new signal unnecessarily.**

Lines 345-348:
```js
export function useId(prefix = 'what') {
  const id = signal(`${prefix}-${++idCounter}`);
  return () => id();
}
```

The ID never changes. Wrapping it in a signal adds unnecessary overhead. It should just return a string:

```js
export function useId(prefix = 'what') {
  return `${prefix}-${++idCounter}`;
}
```

Or if it needs to be a function for consistency: `return () => id;` without the signal.

---

## Part 8: New Bugs and Issues in Updated Code

### NEW BUG 1: Effect Initial Run Inside Component Is Synchronous But Component Expects Microtask

In `createComponent` (dom.js line 206-250):
```js
const dispose = effect(() => {
  if (ctx.disposed) return;
  ctx.hookIndex = 0;
  componentStack.push(ctx);
  let result;
  try {
    result = Component(propsSignal());
  } catch (error) { ... }
  componentStack.pop();
  ...
});
```

The `effect()` function runs its callback synchronously on first call (reactive.js line 78-81). This is correct for initial mount. But when `propsSignal.set(...)` is called by a parent component during reconciliation (dom.js line 566), the signal write goes through `notify()`, which defers the effect to a microtask.

This means **parent-to-child prop updates are asynchronous**. A parent component that re-renders and passes new props to a child will NOT see the child update within the same frame. The child's update is deferred to a microtask.

In most cases this is fine (React also batches updates). But if the parent reads DOM state that depends on the child's content (e.g., measuring the height of a container after updating a child), the measurement will be stale.

### NEW BUG 2: `componentStack` Integrity Under Microtask Deferral

The `componentStack` (dom.js line 140) is a module-level mutable array used during synchronous component rendering. When effects were synchronous, the stack was always consistent: push before render, pop after.

With microtask deferral, multiple component effects can be batched and run sequentially within a single `flush()` call. Each effect pushes/pops the `componentStack` correctly within its own execution. But if a component's effect throws an error (dom.js line 216-221):

```js
try {
  result = Component(propsSignal());
} catch (error) {
  componentStack.pop();
  if (!reportError(error, ctx)) { ... }
  return;
}
componentStack.pop();
```

The pop happens in both the catch and the normal path. This is correct. But what if the error is thrown by a CHILD component's synchronous initialization during the parent's initial mount? The child's `createComponent` pushes its own ctx onto the stack. If the child throws, the child pops its own ctx. But the parent's try/catch catches the re-thrown error and pops the parent's ctx too. This is correct because the child has already popped.

Actually, looking more carefully: child components are created during `createDOM(v, wrapper, isSvg)` (line 243), which happens inside the parent's effect. If `createComponent` (called from `createDOM`) pushes the child ctx, runs the child's effect (which pushes the child ctx again), and the child's component function throws, the child's catch block pops, and then the child's `createComponent` does NOT pop (there is no pop in `createComponent`). Wait -- the push/pop happens inside the effect, not in `createComponent`. Each effect manages its own push/pop. The child's initial effect runs synchronously, pushes, potentially throws, and pops in its own catch. The parent's call to `createDOM` returns normally (the child's error was caught by the child's try/catch). So the parent's stack is not corrupted. This is fine.

### NEW BUG 3: `useContext` Uses `componentStack` Which Is Only Valid During Synchronous Render

`hooks.js` lines 133-143:
```js
export function useContext(context) {
  const stack = _getComponentStack();
  for (let i = stack.length - 1; i >= 0; i--) {
    const ctx = stack[i];
    if (ctx._contextValues && ctx._contextValues.has(context)) {
      return ctx._contextValues.get(context);
    }
  }
  return context._defaultValue;
}
```

`useContext` walks the `componentStack` to find the nearest context provider. But `componentStack` is a runtime stack that is only populated during component rendering. When microtask-deferred effects re-run a component, the `componentStack` contains only that component's ctx (pushed on line 210, popped on line 224). Parent components are NOT on the stack because they are not currently rendering.

This means **useContext cannot find context values from parent components during re-renders.** It only works on initial mount (when the parent is still on the stack from its own initial render, executing `createDOM` which calls `createComponent` which calls the child's component function).

This is a significant bug. After the initial mount, any re-render of a component that uses `useContext` will fall back to `context._defaultValue` instead of finding the parent provider's value.

**Fix:** `useContext` should walk the `_parentCtx` chain (just like `reportError` does) instead of the runtime `componentStack`:

```js
export function useContext(context) {
  let ctx = getCurrentComponent();
  while (ctx) {
    if (ctx._contextValues && ctx._contextValues.has(context)) {
      return ctx._contextValues.get(context);
    }
    ctx = ctx._parentCtx;
  }
  return context._defaultValue;
}
```

This is the same pattern that was applied to `reportError` in Fix 3.

### NEW BUG 4: `Suspense` Boundary Does Not Dispose Effects

In `createSuspenseBoundary` (dom.js lines 304-327):
```js
function createSuspenseBoundary(vnode, parent) {
  const { boundary, fallback, loading } = vnode.props;
  const children = vnode.children;
  const wrapper = document.createElement('what-c');
  wrapper.style.display = 'contents';
  const dispose = effect(() => {
    const isLoading = loading();
    // ...
  });
  return wrapper;
}
```

The `dispose` function returned by `effect()` is captured but never stored anywhere. It is not added to any component context's `effects` array. When the Suspense boundary is removed from the DOM, the effect continues to run, tracking the `loading()` signal. This is a memory leak.

Compare with `createErrorBoundary` (line 299: `boundaryCtx.effects.push(dispose)`) which correctly stores the dispose function.

---

## Part 9: Updated Architecture Assessment

### Performance Profile Post-Phase 1

The microtask deferral (Fix 1) significantly improves the performance profile:

**Before Fix 1:**
- A component reading N signals would re-render N times per batch of updates (outside of `batch()`)
- Each re-render triggered a full VNode generation + reconciliation cycle
- Total work: O(N * VNodeCount) per update batch

**After Fix 1:**
- All signal writes within the same microtask are batched automatically
- A component reading N signals that all change within the same microtask re-renders ONCE
- Total work: O(VNodeCount) per update batch

This is a 5-10x improvement for typical components that read multiple signals. It brings What closer to React's batched update model (React 18 batches all updates by default, including those in promises, timeouts, and event handlers).

### Updated Comparison

| Feature | What (Post-Phase 1) | React 18 | SolidJS 1.8 | Svelte 5 |
|---------|---------------------|----------|-------------|----------|
| **Update batching** | Microtask-auto-batch | Auto-batch all | Push-pull (no batching needed) | Compiler-optimized |
| **Glitch-free** | Yes (microtask) | Yes (fiber scheduler) | Yes (topological) | Yes (compiled) |
| **Error boundaries** | Tree-based (_parentCtx) | Fiber-based | createRoot | try/catch |
| **Style diffing** | _prevStyle tracking | Retained VDOM diff | Direct binding | Compiled |
| **Memory cleanup** | Component lifecycle | Fiber cleanup | Ownership tree | Compiled |
| **Context** | BROKEN (componentStack) | Fiber tree | Owner chain | Compiler |

The context bug (NEW BUG 3 above) is the most significant remaining gap. Everything else is at parity or close to parity with competing frameworks for the use cases What targets.

---

## Part 10: Updated Top 10 Recommendations

### What Was Fixed (Round 1 Top 10)

1. ~~Fix the glitch problem~~ -- DONE (Fix 1)
2. ~~Fix the `patchNode` DocumentFragment bug~~ -- DONE (Fix 2, with edge case)
3. ~~Make `ErrorBoundary` tree-aware~~ -- DONE (Fix 3)
4. ~~Add cleanup to `useMediaQuery` and `useLocalStorage`~~ -- DONE (Fix 5)
5. Make `For` component item-reactive -- NOT DONE (deferred to Phase 2)
6. ~~Fix style diffing~~ -- DONE (Fix 7)
7. Add TypeScript declarations -- NOT DONE (deferred to Phase 3)
8. ~~Handle re-entrant flush~~ -- DONE (Fix 4)
9. Add AbortController to data fetching -- NOT DONE
10. Implement context reactivity -- NOT DONE

### New Top 10 (Post-Phase 1)

**P0 (must fix before any production use):**

1. **Fix `useContext` to use `_parentCtx` chain instead of `componentStack`.** (NEW BUG 3). Context is completely broken on re-renders. This is a one-line fix that follows the same pattern as the `reportError` fix. Walk `_parentCtx` instead of `componentStack`.

2. **Add CSRF protection to server actions.** (actions.js). Without CSRF tokens, any website can execute server-side actions on behalf of authenticated users. This is a security vulnerability, not a convenience issue.

3. **Fix the shared SWR cache to be reactive.** (data.js). The cache is a plain Map that does not notify subscribers. Multiple components using `useSWR` with the same key operate on independent signals. Cache mutations and invalidations do not propagate.

**P1 (must fix before production):**

4. **Fix array-to-non-array patching in `patchNode`.** (dom.js, NEW BUG from Fix 2 verification). When a component switches from returning an array to a non-array (or vice versa), the marker comments and their content leak. Add `_arrayEnd` detection to all `patchNode` branches.

5. **Fix `createSuspenseBoundary` to store the effect's dispose function.** (dom.js, NEW BUG 4). The effect leaks when the Suspense boundary is removed.

6. **Add AbortController to `useSWR`, `useQuery`, and `useFetch`.** Orphaned HTTP requests waste bandwidth and can cause state inconsistencies if they resolve after a newer request.

7. **Fix form performance -- use per-field signals in `useForm`.** (form.js). The current single-signal-for-all-values approach causes entire-form re-renders on every keystroke. This is a performance cliff for any non-trivial form.

**P2 (should fix soon):**

8. **Add input validation and sanitization to `handleActionRequest`.** (actions.js). Client-provided arguments are passed directly to server functions with no validation.

9. **Remove dead `errorBoundaryStack` export.** (components.js line 8). Confusing dead code.

10. **Add spring cleanup on component unmount.** (animation.js). Springs created inside components should stop their RAF loops when the component unmounts.

### Deferred from Round 1 (still important but lower priority post-Phase 1):

- TypeScript declarations (critical for adoption, not for correctness)
- `For` component item-level reactivity (performance optimization)
- Context reactivity (context values wrapped in signals)
- DevTools extension
- AbortController for `createResource` in hooks.js
- `useRovingTabIndex` dynamic item count

---

## Part 11: Detailed Module Assessments

### data.js -- Grade: C+

**Strengths:** Comprehensive API surface covering SWR, TanStack Query, and infinite scroll patterns. The `scopedEffect` pattern for automatic cleanup is well-designed. Retry logic in `useQuery` with exponential backoff is correct.

**Weaknesses:** Non-reactive global cache is fundamentally broken for multi-component use. No AbortController. No dependent fetching (`null` key). `useSWR` suspense option is declared but not implemented. `useQuery` cache cleanup uses `setTimeout` instead of component lifecycle.

**Production readiness:** Not ready. The cache sharing bug means two components using the same SWR key will show different data after a mutation.

### form.js -- Grade: B-

**Strengths:** API closely mirrors React Hook Form. Zod and Yup resolver adapters are a nice touch. Built-in validation rules cover common cases. The `useField` hook provides field-level isolation when used standalone.

**Weaknesses:** Single-signal form state causes full-form re-renders. Controlled-only inputs (no uncontrolled mode). No field arrays. No form context for nested components.

**Production readiness:** Usable for simple forms (5-10 fields). Will become a performance bottleneck for complex forms (20+ fields with validation).

### animation.js -- Grade: B

**Strengths:** Spring physics implementation is correct for common use cases. Easing function library is comprehensive. Gesture handler covers drag, pinch, swipe, tap, and long-press. Integration with reactive system via signals is clean.

**Weaknesses:** Euler integration (not Verlet/RK4) limits stability for stiff springs. No multi-value springs. No cleanup on component unmount. No AnimatePresence-style enter/exit animations.

**Production readiness:** Usable for basic animations. Would not use for gesture-heavy apps (lacks the robustness of use-gesture or Framer Motion).

### a11y.js -- Grade: B+

**Strengths:** Most comprehensive built-in a11y package of any UI framework. Focus trapping, screen reader announcements, ARIA patterns, roving tab index, skip links all present.

**Weaknesses:** `FocusTrap` component has unscoped effect. `useRovingTabIndex` takes static count. `useId` wraps a constant in an unnecessary signal.

**Production readiness:** Usable with the noted fixes. The core patterns (focus trap, announcements) are correct.

### scheduler.js -- Grade: B+

**Strengths:** Clean read/write separation prevents layout thrashing. Shared ResizeObserver is a good optimization. `smoothScrollTo` with scheduler integration is a nice utility.

**Weaknesses:** The `debouncedCallbacks` Map has a minor closure retention issue. `useScheduledEffect` creates new closures on every effect run. No priority system.

**Production readiness:** Ready. The layout-thrashing prevention is valuable and correctly implemented.

### actions.js -- Grade: C-

**Strengths:** Clean API design. `useAction` and `useOptimistic` provide good DX. The separation of server-side registration and client-side RPC is architecturally sound.

**Weaknesses:** No CSRF protection (security hole). No input validation. Predictable action IDs. Error messages leak server details. No timeout. No automatic optimistic rollback.

**Production readiness:** NOT SAFE for production. The security issues must be addressed first.

---

## Part 12: Code Quality Observations

### Positive Changes Since Round 1

1. The `_parentCtx` chain is a clean, correct solution to the error boundary problem. It follows the same architectural pattern as React's fiber parent chain.
2. The microtask deferral is minimal and well-implemented. The code remains under 200 lines.
3. Style diffing with `_prevStyle` is a clean solution that does not add significant complexity.
4. The `<what-c>` custom element registration is a one-time, zero-cost fix.

### Remaining Code Quality Concerns

1. **Error swallowing is still present.** `reactive.js` line 114: `try { e._cleanup(); } catch (err) { /* cleanup error */ }`. Morgan's Phase 1 plan mentioned adding `__DEV__` mode warnings, but this was not implemented.

2. **Inconsistent use of `_` prefix.** `_parentCtx`, `_errorBoundary`, `_arrayEnd`, `_prevStyle`, `_propsSignal`, `_componentCtx` are all internal properties on DOM nodes or component contexts. But `hooks`, `effects`, `cleanups`, `mounted`, `disposed` on the component context are also internal and lack the prefix. This inconsistency makes it unclear what the public API boundary is.

3. **The `componentStack` is used for two purposes:** (a) establishing `_parentCtx` during initial mount, and (b) providing context values via `useContext`. After Fix 3, the error boundary no longer uses it. If `useContext` is also fixed to use `_parentCtx`, the `componentStack` could potentially be simplified or removed -- but it is still needed during initial mount to build the `_parentCtx` chain.

4. **No test coverage for the fixes.** The source files contain no unit tests for the new microtask deferral behavior, marker comment patching, or `_parentCtx` chain traversal. Regression risk is high without tests.

---

## Part 13: Summary

Phase 1 addressed the three most critical correctness bugs and six important improvements. The core reactive system and reconciler are now fundamentally correct. The framework has moved from "solid prototype" to "approaching production-ready core."

The remaining work falls into three categories:

1. **Correctness fixes** (P0): `useContext` broken on re-renders, CSRF in server actions, SWR cache not reactive.
2. **Hardening** (P1): Array patching edge cases, Suspense effect leak, AbortController, form performance.
3. **Maturity** (P2+): TypeScript, DevTools, input validation, animation cleanup.

The framework's competitive position has improved. With microtask deferral, it now has React-like update batching with Solid-like granular subscriptions. The islands architecture remains best-in-class. The remaining gaps are in the newer modules (data, forms, actions) that have not had the same level of scrutiny as the core.

**Updated Rating:** 7.5/10 for production readiness (up from 6.5), 8.5/10 for architecture and vision (up from 8). The `useContext` bug and server action security concerns prevent a higher rating. Fix those two issues and the rating moves to 8.5/10 for production readiness.

---

*This review references source files in `packages/core/src/reactive.js`, `packages/core/src/dom.js`, `packages/core/src/components.js`, `packages/core/src/hooks.js`, `packages/core/src/helpers.js`, `packages/core/src/store.js`, `packages/core/src/data.js`, `packages/core/src/form.js`, `packages/core/src/animation.js`, `packages/core/src/a11y.js`, `packages/core/src/scheduler.js`, `packages/router/src/index.js`, `packages/server/src/index.js`, `packages/server/src/islands.js`, and `packages/server/src/actions.js`. All line numbers reference the current state of the codebase as of 2026-02-13.*
