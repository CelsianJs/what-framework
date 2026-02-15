# Round 2 Framework Designer Decisions: What Framework
**Author:** Morgan (Framework Designer & Architect)
**Date:** 2026-02-13
**Input:** Round 2 Feedback Synthesis (Sam), Round 2 Junior Review (Alex), Round 2 Senior Review (Jordan)

---

## Preamble

Round 1 exposed the structural cracks. Round 2 is showing me the shape of the building.

The Phase 1 fixes are verified correct by both reviewers. The concurrent fixes -- useContext, Portal, Suspense leak, array patching, Link active state, store action proxy, FocusTrap, useId, spring cleanup, dead errorBoundaryStack -- are all confirmed working. That is ten distinct fixes applied and verified in a single cycle. The core is now solid.

What remains falls into three categories: security holes that block production use, design flaws that will bite users at scale, and polish items that separate a prototype from a product. I am going to be ruthless about which category each issue falls into, because we cannot afford to treat everything as equally urgent.

I have read every line of the current source for `data.js`, `form.js`, `actions.js`, `animation.js`, `components.js`, `reactive.js`, `hooks.js`, `a11y.js`, `scheduler.js`, and `testing.js`. My decisions below reference the actual code, not abstractions of it.

---

## Table of Contents

1. [Decision Summary Table](#decision-summary-table)
2. [P0 Decisions: Security and Correctness](#p0-decisions-security-and-correctness)
3. [P1 Decisions: Production Readiness](#p1-decisions-production-readiness)
4. [P2 Decisions: Quality and Polish](#p2-decisions-quality-and-polish)
5. [Key Design Questions Answered](#key-design-questions-answered)
6. [Implementation Roadmap](#implementation-roadmap)
7. [What We Will Not Do](#what-we-will-not-do)

---

## Decision Summary Table

| # | Issue | Decision | Rationale |
|---|-------|----------|-----------|
| 1 | CSRF protection for server actions | **Fix now** | Security P0. Already partially implemented -- needs hardening. |
| 2 | SWR cache not reactive across components | **Fix now** | Design flaw that breaks shared-key scenarios. |
| 3 | Server action input validation | **Fix now** | Security P0. Array check exists but is insufficient. |
| 4 | Form performance: single signal for all values | **Already fixed** | The current `form.js` already uses per-field signals. |
| 5 | No AbortController in data fetching | **Partially fixed; fix remaining** | `useSWR` and `createResource` have it. `useQuery` and `useFetch` do not. |
| 6 | createResource lifecycle integration | **Fix now** | Straightforward -- add component lifecycle cleanup. |
| 7 | Server action error message leaks | **Already fixed** | `handleActionRequest` already returns generic "Action failed" message. |
| 8 | Server action timeout | **Fix now** | Simple AbortController with configurable timeout. |
| 9 | No automatic optimistic rollback | **Fix later** | Nice-to-have. Manual rollback is explicit and correct. |
| 10 | Unbounded cache growth | **Fix now** | Add LRU eviction with configurable max size. |
| 11 | SWR deduplication timing | **Fix now** | Part of the cache reactivity rewrite. |
| 12 | `memo` conflicts with signals | **Fix now (redesign)** | See detailed analysis below. |
| 13 | `For` fine-grained reactivity | **Fix later (document now)** | See detailed analysis below. |
| 14 | `Show` fine-grained reactivity | **Won't fix** | See detailed analysis below. |
| 15 | `useSWR` inconsistent signal types | **Fix now** | Part of the cache reactivity rewrite. |
| 16 | Silent error swallowing in reactive.js | **Fix now** | Already partially addressed -- finish the remaining empty catches. |
| 17 | AnimatePresence / exit animations | **Fix later** | See detailed analysis below. |
| 18 | Effect timing model undocumented | **Fix now (docs)** | Critical for correct usage. No code change needed. |
| 19 | Computed infinite loop vague error | **Fix now** | Small effort, high DX impact. |
| 20 | useRovingTabIndex static itemCount | **Already fixed** | Current code accepts signal or getter. |
| 21 | SSR hydration mismatch detection | **Fix later** | Important but requires reconciler changes. |
| 22 | No error recovery/retry in data fetching | **Fix later** | `useQuery` has retry. Integration with ErrorBoundary is a design question. |
| 23 | useForm register stale value | **Fix now** | The `value` in register props is read once -- needs to be reactive. |
| 24 | useFieldArray | **Fix later** | Real need but not blocking. |
| 25 | useClickOutside | **Fix now** | 15 lines, high usage frequency. |
| 26 | Euler integration in spring | **Won't fix** | Adequate for UI animations. See rationale. |
| 27 | Multi-value springs | **Fix later** | Real need, moderate effort. |
| 28 | Passive touch listeners | **Fix now** | One-line fix with option. |
| 29 | useScheduledEffect closure retention | **Fix now** | Use the existing `raf()` helper. |
| 30 | Predictable server action IDs | **Fix now** | Part of security hardening. |
| 31 | useEffect cleanup timing differs from React | **Won't fix (document)** | Intentional. Our effects run on microtask. Document the difference. |
| 32 | Route-level data loading | **Fix later** | Requires router architecture change. |
| 33 | Type safety in routing | **Fix later** | TypeScript effort, not runtime. |
| 34 | Virtualization | **Fix later** | Separate module. Not blocking v1. |
| 35 | formState.errors() verbose | **Already fixed** | Current code uses getters: `formState.errors` not `formState.errors()`. |
| 36 | Full-form validation on single-field onChange | **Already fixed** | Current `validate(fieldName)` validates single field when called with a name. |
| 37 | No SWR global config | **Fix later** | Context-based config provider. Moderate effort. |
| 38 | Conditional/dependent fetching in useSWR | **Already fixed** | `useSWR` now handles `null`/`undefined`/`false` keys. |
| 39 | Redundant wrapper.style.display | **Fix now** | One-line removal. |
| 40 | _prevStyle not cleared in removeProp | **Fix now** | One-line fix. |
| 41 | Inconsistent _ prefix convention | **Fix later** | API surface audit for v1. |
| 42 | No test coverage for Phase 1 fixes | **Fix now** | Regression risk is unacceptable. |
| 43 | No form context for nested components | **Fix later** | FormProvider pattern. Moderate effort. |

---

## P0 Decisions: Security and Correctness

### Issue 1: CSRF Protection for Server Actions

**Decision: Fix now -- harden the existing implementation.**

I read `actions.js` carefully. The good news is that CSRF infrastructure is already present: `generateCsrfToken()`, `validateCsrfToken()` with constant-time comparison, `csrfMetaTag()`, and the client-side `getCsrfToken()` that reads from meta tag or cookie. The `callAction` function sends `X-CSRF-Token` when available. The `handleActionRequest` function validates it when a `sessionCsrfToken` is provided.

The problem is that this is opt-in. If a developer does not pass `csrfToken` to `handleActionRequest`, the check is silently skipped. The `skipCsrf` flag makes it even easier to bypass. This is the wrong default.

**Implementation guidance:**

1. **Make CSRF validation mandatory by default.** Remove the `skipCsrf` option entirely. If a developer is building an internal tool that genuinely does not need CSRF, they can validate the token themselves before calling `handleActionRequest`.

2. **Fail closed, not open.** If `sessionCsrfToken` is not provided to `handleActionRequest`, return a 500 error with a clear message: `"CSRF token not configured. Pass csrfToken to handleActionRequest options."` Do not silently skip validation.

3. **Auto-generate and inject the CSRF token in SSR.** When `renderToString` or the server handler creates the initial HTML, it should automatically include `csrfMetaTag(token)` in the `<head>`. This makes CSRF protection the default path, not something developers must remember to add.

4. **Add SameSite cookie support.** The meta tag approach works but the cookie approach is more robust for SPAs. Add a `setCsrfCookie(res, token)` helper that sets `SameSite=Strict; HttpOnly=false; Secure` (needs to be readable by JS, so not HttpOnly, but SameSite=Strict provides defense in depth).

**Files to modify:**
- `packages/server/src/actions.js`: lines 301-332, remove `skipCsrf`, fail if no `sessionCsrfToken`
- `packages/server/src/index.js`: auto-inject CSRF meta tag during SSR

**Effort:** Small (20-30 lines changed).

---

### Issue 2: SWR Cache Reactivity Across Components

**Decision: Fix now -- shared signal per cache key.**

This is the most important design change in this round. The current `data.js` uses a plain `Map()` for the cache. When two components call `useSWR('users', fetcher)`, each creates its own `data` signal initialized from `cache.get('users')`. When component A revalidates and calls `cache.set('users', newData)`, component B's `data` signal is never updated. The cache is a write-only store from B's perspective.

Jordan is correct: this is a fundamental design flaw. SWR's entire value proposition is that components sharing a cache key see the same data. Without reactive sharing, `useSWR` is just `useFetch` with a stale initial value.

**Design: Replace the raw value cache with a signal cache.**

```js
// Instead of: const cache = new Map();  // stores raw values
// Use:        const cache = new Map();  // stores signals

function getCacheSignal(key, initialValue) {
  if (!cache.has(key)) {
    cache.set(key, signal(initialValue ?? null));
  }
  return cache.get(key);
}
```

When `useSWR` is called:
1. Get or create the shared signal for this cache key via `getCacheSignal(key, fallbackData)`.
2. The returned `data` accessor reads from this shared signal: `data: () => getCacheSignal(key)()`.
3. When revalidation succeeds, write to the shared signal: `getCacheSignal(key).set(result)`.
4. All components reading the same key automatically update because they are all reading the same signal.

When `mutate(key, newData)` is called externally:
1. Write to the shared signal: `getCacheSignal(key).set(newData)`.
2. All subscribers update immediately.

When `invalidateQueries(key)` is called:
1. Set the cache signal to `null` (or keep stale data based on configuration).
2. Trigger revalidation for all active subscribers of that key.

**Active subscriber tracking:** We need to know which `useSWR` instances are currently mounted so that `invalidateQueries` can trigger their revalidation. Add a `subscribers` Map that maps cache keys to Sets of revalidation functions:

```js
const subscribers = new Map();

function subscribe(key, revalidateFn) {
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  subscribers.get(key).add(revalidateFn);
  return () => subscribers.get(key)?.delete(revalidateFn);
}
```

Each `useSWR` instance registers its `revalidate` function on mount and unregisters on unmount (via the component lifecycle cleanup).

**Cache eviction:** While we are rewriting the cache, add an LRU bound. Default `maxCacheSize = 100`. When inserting a new key that would exceed the limit, evict the least recently accessed entry. This addresses issue 10 (unbounded cache growth) as part of the same change.

**Deduplication fix:** Store the in-flight promise AND its resolution timestamp on the cache entry. The dedup check becomes: "is there an in-flight request for this key, AND was it started within `dedupingInterval` ms ago?" This addresses issue 11 (dedup timing).

**Signal type consistency:** All returned values from `useSWR` should be accessor functions for consistency. `isLoading` is currently a raw `computed` -- wrap it in an accessor like the others. This addresses issue 15.

**Files to modify:**
- `packages/core/src/data.js`: rewrite cache layer (~80 lines), modify `useSWR` (~30 lines), modify `invalidateQueries`/`setQueryData` (~10 lines)

**Effort:** Medium-large (120 lines changed). This is the single highest-value change in this round.

---

### Issue 3: Server Action Input Validation

**Decision: Fix now.**

The current `handleActionRequest` checks `Array.isArray(args)` which prevents the most basic prototype pollution attack, but does not validate the content of the arguments. Jordan is right that predictable action IDs (`action_1`, `action_2`) combined with no argument validation is a security risk.

**Implementation guidance:**

1. **Action-level validation hooks.** Allow `action(fn, { validate: (args) => { ... } })`. If `validate` throws or returns an error, the action is not executed. This gives developers control without the framework needing to understand their data model.

2. **Randomized action IDs.** Replace `action_${++actionIdCounter}` with `action_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`. This addresses issue 30 (predictable IDs) as part of the same change.

3. **Rate limiting hook.** Expose an `onBeforeAction` middleware hook in `handleActionRequest` options: `{ onBeforeAction: (actionId, args, req) => { /* rate limit check */ } }`. Return `false` or throw to reject.

4. **Argument size limit.** Add a configurable `maxArgSize` (default 1MB). Check `JSON.stringify(args).length` before passing to the action function. This prevents memory exhaustion attacks.

**Files to modify:**
- `packages/server/src/actions.js`: lines 76-78 (action ID generation), lines 301-332 (validation hooks in handler)

**Effort:** Small-medium (40 lines changed).

---

### Issue 6: createResource Lifecycle Integration

**Decision: Fix now.**

The current `createResource` in `hooks.js` (lines 225-267) already has an `AbortController` -- the concurrent fix added it. But it does not register cleanup with the component lifecycle. If the component unmounts while a fetch is in flight, the abort controller is never triggered.

**Implementation guidance:**

```js
export function createResource(fetcher, options = {}) {
  // ... existing signal setup ...

  let controller = null;

  // Register abort on component unmount
  const ctx = getCurrentComponent?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(() => {
      if (controller) controller.abort();
    });
  }

  // ... rest of implementation ...
}
```

**Files to modify:**
- `packages/core/src/hooks.js`: lines 225-267, add lifecycle cleanup (~5 lines)

**Effort:** Tiny.

---

### Issue 8: Server Action Timeout

**Decision: Fix now.**

**Implementation guidance:**

In `callAction` within `actions.js`, wrap the fetch with an AbortController and a configurable timeout:

```js
async function callAction(...args) {
  if (typeof window === 'undefined') return fn(...args);

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeout || 30000  // Default 30s
  );

  try {
    const response = await fetch('/__what_action', {
      method: 'POST',
      headers: { /* ... existing headers ... */ },
      credentials: 'same-origin',
      body: JSON.stringify({ args }),
      signal: controller.signal,
    });
    // ... rest of handler ...
  } finally {
    clearTimeout(timeoutId);
  }
}
```

**Files to modify:**
- `packages/server/src/actions.js`: lines 86-128

**Effort:** Tiny (10 lines).

---

## P1 Decisions: Production Readiness

### Issue 4: Form Performance -- Single Signal for All Values

**Decision: Already fixed.**

I read the current `form.js` carefully. It already uses per-field signals:

```js
const fieldSignals = {};
const errorSignals = {};
const touchedSignals = {};

function getFieldSignal(name) {
  if (!fieldSignals[name]) {
    fieldSignals[name] = signal(defaultValues[name] ?? '');
  }
  return fieldSignals[name];
}
```

`setValue` writes to the individual field signal. `validate(fieldName)` validates and updates only that field's error signal. The `register` function returns props wired to the specific field signal. This is exactly the per-field signal architecture Jordan recommended.

Jordan's review may have been based on an earlier version of the code. **No action needed.**

---

### Issue 5: AbortController in Data Fetching

**Decision: Fix the remaining gaps.**

`useSWR` already has an AbortController (lines 113-128 in the current `data.js`). `createResource` also has one (lines 230-255 in `hooks.js`).

The gaps are:
- `useFetch`: No AbortController. Since `useFetch` is deprecated per Round 1 decisions, I will add a minimal AbortController for correctness but not invest heavily.
- `useQuery`: No AbortController. This needs one because `useQuery` is a supported advanced API.

**Implementation for `useQuery`:**

Add an AbortController that aborts previous requests and is cleaned up on component unmount:

```js
export function useQuery(options) {
  // ... existing setup ...
  let controller = null;

  // Cleanup on unmount
  const ctx = getCurrentComponent?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(() => { if (controller) controller.abort(); });
  }

  async function fetch() {
    if (!enabled) return;
    if (controller) controller.abort();
    controller = new AbortController();

    // Pass signal to queryFn
    const result = await queryFn({
      queryKey: Array.isArray(queryKey) ? queryKey : [queryKey],
      signal: controller.signal,
    });
    // ... rest unchanged ...
  }
  // ...
}
```

**Files to modify:**
- `packages/core/src/data.js`: `useQuery` function (~15 lines), `useFetch` function (~10 lines)

**Effort:** Small.

---

### Issue 12: `memo` Conflicts with Signal-Based Reactivity

**Decision: Fix now -- redesign `memo` to work at the effect level, and add prominent warnings.**

This is a critical design question that Sam correctly identified as needing resolution. Here is my analysis.

**The core problem:** The current `memo` in `components.js` caches `_memoResult` (the vnode tree returned by `Component(props)`). If the component reads global signals internally, those signal values are baked into the cached vnodes. When the global signal changes, `memo` sees that props have not changed, returns the cached vnodes, and the user sees stale UI.

**Why this is fundamentally at odds with our identity:** We chose signals-first. We chose component re-running. These two decisions mean components routinely read signals that are not in their props. A `memo` that only checks props is a landmine for any component that reads a theme signal, a user signal, a route signal, or any other non-prop reactive state.

**My decision: Redesign `memo` to be effect-aware.**

The new `memo` should:
1. Check props with the comparator (same as now).
2. If props are unchanged AND no signals read by the component have changed, skip the re-render.
3. If any signal read by the component has changed (even if props are the same), re-render.

The way to achieve this is: `memo` should not cache vnodes. Instead, `memo` should prevent the component's render effect from being triggered when the only change is a parent re-render with identical props. If a signal the component reads changes, the component's own effect is triggered regardless of `memo`.

**Implementation:**

```js
export function memo(Component, areEqual) {
  const compare = areEqual || shallowEqual;

  function MemoWrapper(props) {
    const ctx = _getCurrentComponent?.();

    // First render: always run
    if (!ctx || !ctx._memoProps) {
      if (ctx) ctx._memoProps = { ...props };
      return Component(props);
    }

    // Re-render triggered by parent: check if props changed
    if (ctx._memoTriggeredBySelf) {
      // This re-render was triggered by a signal the component reads.
      // Always re-render regardless of props.
      ctx._memoTriggeredBySelf = false;
      ctx._memoProps = { ...props };
      return Component(props);
    }

    if (compare(ctx._memoProps, props)) {
      // Props unchanged AND this was a parent-triggered re-render.
      // Return SKIP sentinel -- the reconciler keeps existing DOM.
      return ctx._memoResult;
    }

    ctx._memoProps = { ...props };
    const result = Component(props);
    ctx._memoResult = result;
    return result;
  }

  MemoWrapper.displayName = `Memo(${Component.name || 'Anonymous'})`;
  MemoWrapper._memo = true;
  return MemoWrapper;
}
```

In `dom.js`'s `createComponent`, when a signal change triggers the component's render effect and the component is wrapped in `memo`, set `ctx._memoTriggeredBySelf = true` before calling the component function.

**The key insight:** The distinction is between "parent re-rendered and passed me the same props" (memo can skip) and "a signal I read changed" (memo must not skip). The render effect mechanism already knows which case it is -- a parent re-render triggers the component via the reconciler calling the component function with new props, while a signal change triggers the component's own effect directly.

**Additionally:** Add a dev-mode warning when `memo` is used on a component that reads non-prop signals:

```js
if (__DEV__ && ctx._readsExternalSignals) {
  console.warn(
    `[what] memo(${Component.name}): This component reads signals not in its props. ` +
    `memo will still re-render when those signals change, but consider whether memo ` +
    `is providing value here.`
  );
}
```

**Files to modify:**
- `packages/core/src/components.js`: rewrite `memo` (~30 lines)
- `packages/core/src/dom.js`: add `_memoTriggeredBySelf` flag in render effect (~5 lines)

**Effort:** Medium (35 lines changed).

---

### Issue 13: `For` Fine-Grained Reactivity

**Decision: Fix later. Document the current behavior now.**

Both reviewers are correct that `For` does not provide SolidJS-level item-level reactivity. The current `For` evaluates `each`, maps it with the render function, and returns an array of vnodes. The parent's reactive effect is the boundary. When the list signal changes, the entire parent component re-renders, `For` re-maps the full list, and the reconciler diffs the output.

**Why I am not fixing this now:**

True fine-grained list reactivity (Solid's `mapArray`) requires:
1. Maintaining a persistent mapping of (key -> DOM nodes + reactive scope) across renders.
2. When the list signal changes, diffing the old list against the new list at the data level (not the DOM level).
3. Creating new reactive scopes for added items, disposing scopes for removed items, and moving existing DOM nodes for reordered items.

This is a significant architectural change (~150-200 lines) that touches both `components.js` and `dom.js`. It interacts with the reconciler, with component lifecycle cleanup, and with the `<what-c>` wrapper strategy. Getting it wrong causes memory leaks or stale DOM.

**What I will do now:**

1. **Document clearly** that `For` is syntactic sugar for `.map()` with automatic key detection, not a fine-grained reactive boundary.
2. **Ensure key detection works well** so the reconciler's keyed diffing handles the common case efficiently. The current code auto-detects `item.id`, `item.key`, and primitive values as keys -- this is good.
3. **Add a performance note** in the docs: "For lists with more than 100 items that update frequently, consider virtualization (coming in a future release)."

**When this gets fixed:** After v1.0 launch, when we have real-world usage data showing that list performance is a bottleneck for actual users. I do not want to build Solid's `mapArray` on speculation.

---

### Issue 14: `Show` Fine-Grained Reactivity

**Decision: Won't fix.**

`Show` evaluates `when` and returns either `children` or `fallback`. Alex is correct that this is equivalent to a ternary. But unlike `For`, there is no meaningful performance optimization available here.

A "fine-grained" `Show` would need to:
1. Create its own reactive scope.
2. Track the `when` condition as a signal dependency.
3. When `when` changes, swap `children`/`fallback` without the parent re-rendering.

The problem is: this only saves one component re-render (the parent). In our architecture, component re-renders are cheap because the reconciler only touches changed DOM. The overhead of adding a reactive scope to every `Show` is not justified by the savings.

**What `Show` provides that a ternary does not:**
- Named intent (`Show when={x}` reads better than `x ? a : b`).
- `fallback` prop pattern (cleaner than nested ternaries for null/loading states).
- A hook point for future exit animations (see AnimatePresence section).

`Show` stays as-is. I will document that it is syntactic sugar with no performance advantage over ternaries.

---

### Issue 23: useForm Register Returns Stale Value

**Decision: Fix now.**

The current `register` function returns `value: fieldSig()` -- a snapshot read at call time. If a developer does `const emailProps = register('email')` at the top of a component and uses `emailProps.value` in JSX, the value is stale after the first keystroke because `register` was called once per render and returns a new snapshot each time the component re-renders. But in our re-run model, this actually works because `register` is called on every render. The staleness only manifests if someone caches the result across renders.

However, the cleaner fix is to make `value` a getter:

```js
function register(name, options = {}) {
  const fieldSig = getFieldSignal(name);
  return {
    name,
    get value() { return fieldSig(); },
    onInput: (e) => { /* ... */ },
    onBlur: () => { /* ... */ },
    onFocus: () => {},
    ref: options.ref,
  };
}
```

This makes `register` return props that are always current, regardless of when they are read. The `get value()` reads the signal each time, so it works correctly even if cached.

**Files to modify:**
- `packages/core/src/form.js`: `register` function, line 123

**Effort:** Tiny (1 line changed).

---

## P2 Decisions: Quality and Polish

### Issue 16: Silent Error Swallowing

**Decision: Fix now.**

The Phase 1 fixes addressed empty catches in `dom.js`. The `reactive.js` catches (lines 117-118, 140-141) now correctly log in dev mode. But Sam's synthesis says `helpers.js` still has empty catches for localStorage operations.

**Implementation:** Grep for empty catch blocks across the entire codebase and add `if (__DEV__) console.warn(...)` to each. Estimated 3-5 locations remaining.

**Effort:** Tiny.

---

### Issue 17: AnimatePresence / Exit Animations

**Decision: Fix later -- design now, implement in v0.3.**

Exit animations are the most requested missing feature from both reviewers. Every modal, toast, dropdown, and page transition needs the ability to delay DOM removal until an animation completes. I take this seriously.

**Why not now:** Exit animations require a fundamental change to how the reconciler removes DOM nodes. Today, when a component's condition becomes false (via `Show`, `For` removal, or direct conditional rendering), the reconciler calls `disposeTree` and `removeChild` synchronously. There is no hook to say "wait, animate this out first."

**The design I am committing to:**

A `<Transition>` component that wraps children and manages enter/exit lifecycle:

```jsx
<Transition
  enter={{ from: { opacity: 0 }, to: { opacity: 1 }, duration: 300 }}
  exit={{ from: { opacity: 1 }, to: { opacity: 0 }, duration: 300 }}
>
  <Show when={visible()}>
    <Modal />
  </Show>
</Transition>
```

Under the hood:
1. `Transition` intercepts child removal by registering a `_beforeRemove` hook on the child's DOM wrapper.
2. When the reconciler would remove the child, it checks for `_beforeRemove`. If present, it calls the hook instead of immediate removal.
3. `_beforeRemove` applies the exit animation (CSS classes or inline styles via `spring`/`tween`).
4. When the animation completes, `_beforeRemove` calls the provided callback, which triggers the actual `disposeTree` + `removeChild`.

This requires adding a `_beforeRemove` check in `patchNode` where it handles null/false transitions. Approximately 20 lines in `dom.js` and 60 lines for the `Transition` component in `animation.js`.

**Timeline:** Design document this week. Implementation in the v0.3 cycle (Weeks 5-6 from Round 1 roadmap).

---

### Issue 18: Effect Timing Model Documentation

**Decision: Fix now -- write the documentation.**

This is a documentation-only task with no code changes, but it is critical for correct usage. Developers need to understand:

1. **Effects are microtask-deferred.** When you write `count.set(5)`, the effects that depend on `count` do not run immediately. They are collected into `pendingEffects` and flushed on the next microtask.

2. **`batch()` groups writes.** Inside a `batch()` call, effects are deferred until the batch ends. Outside of batch, each write schedules a microtask flush. Multiple writes in the same synchronous block are naturally batched because they all resolve to the same microtask.

3. **`flushSync()` forces immediate execution.** Call `flushSync()` after a signal write to immediately run all pending effects. Use this when you need to read DOM state that depends on the signal change (e.g., measuring element dimensions after a state update).

4. **`useEffect` fires on microtask (before paint).** Unlike React's `useEffect` which fires after paint (via `requestAnimationFrame` or a similar mechanism), our `useEffect` fires on the next microtask. This means your effect runs before the browser paints. For most code, this is invisible. For animations or measurements that need the paint to have happened, use `requestAnimationFrame` inside the effect.

5. **Effect ordering within a flush.** Effects run in the order they were notified. There is no dependency-based ordering within a single flush pass. If effect A writes to a signal that effect B depends on, B will run in the next iteration of the flush loop (the `while (pendingEffects.size > 0)` in `flush()`).

**Files to create:**
- `docs/EFFECT-TIMING.md`: comprehensive guide (~200 lines)
- Add a "Timing Model" section to `docs/API.md`

**Effort:** Documentation only, ~2 hours of writing.

---

### Issue 19: Computed Infinite Loop Error Message

**Decision: Fix now.**

The current message is `[what] Possible infinite effect loop detected`. This gives no clue about which effect or signal is involved.

**Implementation:**

In `flush()`, track the effects that ran in the current iteration. If we hit 100 iterations, log the effects that are still pending:

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
    const looping = [...pendingEffects];
    const names = looping.map(e =>
      e.fn?.name || e._componentName || '(anonymous effect)'
    ).join(', ');
    console.warn(
      `[what] Possible infinite effect loop detected after 100 iterations. ` +
      `Effects still pending: [${names}]. ` +
      `This usually means an effect writes to a signal it also reads. ` +
      `Use untrack() to read a signal without subscribing.`
    );
  }
}
```

Additionally, when creating effects inside components, stamp the component name on the effect:

```js
// In _createEffect or in dom.js when creating component effects
e._componentName = Component.name || Component.displayName || null;
```

**Files to modify:**
- `packages/core/src/reactive.js`: `flush()` function (~10 lines)

**Effort:** Small.

---

### Issue 25: useClickOutside Hook

**Decision: Fix now.**

This is a utility hook that every app with dropdowns, popovers, or modals needs. It is 15 lines of code and should be framework-provided.

**Implementation:**

```js
export function useClickOutside(ref, handler) {
  const ctx = getCurrentComponent?.();

  function handleClick(e) {
    const el = ref.current || ref;
    if (el && !el.contains(e.target)) {
      handler(e);
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick, { passive: true });

    const cleanup = () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick);
    };

    if (ctx) {
      ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
      ctx._cleanupCallbacks.push(cleanup);
    }

    return cleanup;
  }
}
```

**Files to modify:**
- `packages/core/src/helpers.js`: add `useClickOutside` (~15 lines)
- `packages/core/src/index.js`: add export

**Effort:** Tiny.

---

### Issue 28: Passive Touch Listeners

**Decision: Fix now.**

In `animation.js` line 425, `touchstart` is registered with `{ passive: true }`. This prevents `e.preventDefault()` in drag handlers, which is needed to prevent scrolling during drag operations.

**Implementation:** Add a `preventDefault` option to `useGesture`:

```js
export function useGesture(element, handlers = {}, options = {}) {
  const { preventDefault = false } = options;
  // ...
  el.addEventListener('touchstart', handleStart, { passive: !preventDefault });
  // ...
}
```

**Files to modify:**
- `packages/core/src/animation.js`: `useGesture` function and `attachListeners`

**Effort:** Tiny (3 lines).

---

### Issue 29: useScheduledEffect Closure Retention

**Decision: Fix now.**

The current `useScheduledEffect` creates a new `scheduleRead` closure on every effect run. The `raf()` debounce helper in `scheduler.js` already exists and is designed for this exact purpose.

**Implementation:**

```js
export function useScheduledEffect(readFn, writeFn) {
  let effectKey = Symbol('scheduledEffect');
  return effect(() => {
    raf(effectKey, () => {
      scheduleRead(() => {
        const data = readFn();
        if (writeFn) {
          scheduleWrite(() => writeFn(data));
        }
      });
    });
  });
}
```

**Files to modify:**
- `packages/core/src/scheduler.js`: `useScheduledEffect` function (~5 lines)

**Effort:** Tiny.

---

### Issue 39: Redundant wrapper.style.display

**Decision: Fix now.**

In `dom.js`, `createComponent` sets `wrapper.style.display = 'contents'` even though the `<what-c>` custom element constructor already sets it. Remove the redundant assignment.

**Effort:** One line removed.

---

### Issue 40: _prevStyle Not Cleared in removeProp

**Decision: Fix now.**

When the style prop is removed entirely, `removeProp` clears `el.style.cssText` but does not clear `el._prevStyle`. Add `delete el._prevStyle` after clearing cssText.

**Effort:** One line added.

---

### Issue 42: Test Coverage for Phase 1 and Concurrent Fixes

**Decision: Fix now. This is the highest-priority P2 item.**

We have a `testing.js` module with a solid API (`render`, `fireEvent`, `act`, `waitFor`, `createTestSignal`). We have zero tests for the fixes that define this framework's correctness guarantees. That is unacceptable.

**Tests to write:**

1. **Microtask deferral:** Signal write outside batch does not trigger effect synchronously. Effect runs after `await act()`. Multiple writes in same synchronous block result in single effect execution.

2. **Diamond dependency:** Signal A feeds computed B and computed C. Effect reads both B and C. After writing to A, effect sees consistent state (both B and C updated).

3. **Marker comment array patching:** Component returns array. Patch to different array. Patch to single element. Patch to null. Verify no leaked DOM nodes at each step.

4. **`_parentCtx` chain:** ErrorBoundary catches error from deeply nested child. ErrorBoundary catches async error (thrown in setTimeout). `useContext` reads value from grandparent provider. Context works in event handlers.

5. **Portal rendering:** Portal renders children into target container. Portal children can read context from the component tree (not the DOM tree).

6. **Array-to-array and array-to-non-array transitions:** Component switches between returning `[a, b, c]` and `'hello'`. Verify cleanup of old markers and content.

7. **Store action proxy:** Actions can call `this.otherAction()`. Computed values accessible via `this.computedProp`.

8. **Spring cleanup on unmount:** Mount a component with a spring. Unmount it. Verify the RAF loop stops (no more calls to `requestAnimationFrame`).

**Testing approach:** Use the existing `testing.js` module with jsdom. Write tests in `packages/core/test/` using Node's built-in test runner. Each test file covers one fix area.

**Files to create:**
- `packages/core/test/reactivity.test.js`: microtask deferral, diamond dependency, flush loop
- `packages/core/test/reconciler.test.js`: array patching, marker comments, portal rendering
- `packages/core/test/context.test.js`: `_parentCtx` chain, error boundaries, context in effects
- `packages/core/test/lifecycle.test.js`: spring cleanup, FocusTrap cleanup, effect disposal

**Effort:** Medium-large (~300 lines of tests). But this is non-negotiable. The framework's correctness claims are currently backed by reviewer attestation, not by automated tests.

---

## Key Design Questions Answered

### Q1: SWR Cache Reactivity -- How Should This Work?

**Answer:** Shared signal per cache key, as detailed in Issue 2 above.

The cache becomes `Map<string, Signal<T>>` instead of `Map<string, T>`. All `useSWR` instances with the same key read from the same signal. Mutations write to the shared signal. `invalidateQueries` nullifies the signal and triggers revalidation on all active subscribers.

This is the design used by SWR (via `useSyncExternalStore` and a shared cache with mutation subscribers), TanStack Query (via `QueryObserver` subscription model), and Solid's `createResource` (via reactive owner scoping). We are choosing the simplest version: a signal per key. No observer pattern, no subscription manager. Just signals -- because signals are what we do.

### Q2: Does `memo` Still Make Sense with Signals?

**Answer:** Yes, but only for preventing parent-triggered re-renders with unchanged props.**

`memo` must not block signal-triggered re-renders. The redesigned `memo` (Issue 12) distinguishes between "parent re-rendered me with the same props" (skip) and "a signal I read changed" (do not skip). This makes `memo` safe for all components, including those that read global signals.

The use case for `memo` in our framework is narrower than in React. In React, `React.memo` prevents re-renders caused by parent state changes. In What, signals already provide this granularity -- a parent writing to a signal that a child does not read will not trigger the child. `memo` in What is useful only when a parent re-renders (because it reads a signal) and passes the same props to a child. In that case, `memo` prevents the child's render function from running and the reconciler from diffing the child's output.

I will add documentation explaining when `memo` is useful in What Framework (it is a smaller set of cases than in React) and when it is unnecessary (which is most of the time).

### Q3: Should `For`/`Show` Track Signals Internally?

**Answer:** Not now.

`Show` provides no performance benefit from internal signal tracking (see Issue 14 rationale). `For` could benefit from fine-grained item tracking but the implementation cost is high and the benefit is speculative without real-world usage data (see Issue 13 rationale).

Both components will be documented as syntactic sugar. The keyed reconciler handles list diffing efficiently for lists under ~100 items. For larger lists, virtualization (Issue 34, planned for later) is the correct answer.

### Q4: Is AnimatePresence / Exit Animation Support Important for v1?

**Answer:** Yes, it is important. No, it is not blocking this round.

Exit animations are a requirement for polished UIs. But the implementation touches the reconciler's removal path, which is one of the most sensitive parts of the codebase. I want to design this carefully, not rush it in. The `Transition` component design is committed (see Issue 17). Implementation targets v0.3.

For v1.0, exit animations must work. For the current round, I am prioritizing the security and correctness fixes that are more immediately dangerous.

### Q5: Effect Timing Model -- Document or Change Behavior?

**Answer:** Document. Do not change.**

Our effect timing (microtask deferral) is correct and intentional. It differs from React (after paint) and from Solid (synchronous within computed graph, async for side effects). The difference is a feature, not a bug: microtask timing means effects run before the browser paints, which eliminates visual flicker for synchronous state transitions.

The documentation (Issue 18) will explain this clearly, including the practical implications for animation code and DOM measurement code.

### Q6: What Testing Strategy Should We Recommend?

**Answer:** Framework-provided testing utilities with jsdom, following the Testing Library philosophy.

Our `testing.js` module already provides `render`, `fireEvent`, `act`, `waitFor`, `screen`, and assertion helpers. This mirrors `@testing-library/react`'s API closely enough that React developers will feel at home.

**The recommended stack:**
- **Test runner:** Node.js built-in test runner (`node --test`) or Vitest
- **DOM environment:** jsdom (via Vitest's `environment: 'jsdom'` or `--experimental-vm-modules` in Node)
- **Assertions:** The framework's built-in `expect` helpers, or bring your own (Chai, Node assert)
- **Rendering:** `import { render, fireEvent, act } from 'what-fw/testing'`

**The key guidance for developers:**
1. Use `act()` to wrap any code that triggers state changes and wait for effects to flush.
2. Query by text, role, or test ID (not by CSS class or element type).
3. Test behavior, not implementation. Click buttons, assert text content. Do not assert signal values directly.
4. For signal-level unit tests, use `createTestSignal` which tracks value history.

I will write a `docs/TESTING.md` guide as part of the documentation work (Issue 18 umbrella).

---

## Implementation Roadmap

### This Week (Round 2, Phase A)

**Security hardening:**
1. CSRF protection hardening (Issue 1)
2. Server action input validation + randomized IDs (Issues 3, 30)
3. Server action timeout (Issue 8)

**Cache rewrite:**
4. SWR reactive cache with shared signals (Issue 2)
5. Cache eviction with LRU bound (Issue 10)
6. Deduplication timing fix (Issue 11)
7. Consistent signal types in `useSWR` return (Issue 15)

**Quick wins:**
8. createResource lifecycle cleanup (Issue 6)
9. AbortController for `useQuery` and `useFetch` (Issue 5)
10. Register returns reactive value getter (Issue 23)
11. Remaining empty catch blocks (Issue 16)
12. Redundant wrapper.style.display (Issue 39)
13. _prevStyle cleanup (Issue 40)
14. Passive touch listener option (Issue 28)
15. useScheduledEffect closure fix (Issue 29)
16. useClickOutside hook (Issue 25)

### Next Week (Round 2, Phase B)

**Design work:**
17. `memo` redesign and implementation (Issue 12)
18. Infinite loop error message improvement (Issue 19)

**Documentation:**
19. Effect timing model guide (Issue 18)
20. `For`/`Show` behavior documentation (Issues 13, 14)
21. Testing guide

**Tests:**
22. Test suite for Phase 1 and concurrent fixes (Issue 42)

### Deferred to v0.3

- AnimatePresence / `Transition` component (Issue 17)
- Fine-grained `For` with `mapArray` (Issue 13)
- SSR hydration mismatch detection (Issue 21)
- Multi-value springs (Issue 27)
- Route-level data loading (Issue 32)
- Virtualization module (Issue 34)
- FormProvider context (Issue 43)
- useFieldArray (Issue 24)
- SWR global configuration (Issue 37)
- Type safety in routing (Issue 33)
- Inconsistent _ prefix convention audit (Issue 41)

---

## What We Will Not Do

### 1. Euler to Verlet/RK4 in Spring Physics (Issue 26)

**Won't fix.** Jordan's concern about numerical instability is theoretically valid but practically irrelevant for UI animations. The stiffness/damping combinations that cause Euler instability (stiffness > 500, damping < 5) produce animations that no designer would ship. Our `dt` cap at 64ms (line 42 in animation.js: `Math.min((time - lastTime) / 1000, 0.064)`) provides additional stability. Framer Motion uses Euler integration. React Spring used to use RK4 but simplified. We are in good company.

If a user reports actual instability in a production scenario, I will revisit. Until then, the added complexity of Verlet or RK4 is not justified in a framework that values simplicity.

### 2. Automatic Optimistic Rollback (Issue 9)

**Won't fix (for now).** Next.js's automatic rollback is possible because server actions in Next.js are tightly integrated with the React state tree -- the framework knows exactly what state to roll back to. Our `useOptimistic` is a standalone utility. The manual `rollback(action, realValue)` pattern is explicit and gives developers full control. Automatic rollback would require either: (a) deep integration with `useSWR` cache (which we are rewriting), or (b) a snapshot/restore mechanism for arbitrary signals.

Option (a) becomes feasible after the cache rewrite. I will revisit this when the reactive cache is stable.

### 3. useEffect Cleanup Timing Change (Issue 31)

**Won't fix.** Our `useEffect` fires on microtask (before paint). React's fires after paint. This is an intentional difference, not a bug. Changing it to match React would require `requestAnimationFrame` + `requestIdleCallback` scheduling, which adds complexity and latency. Our timing is correct for our model: effects that run before paint can update DOM without causing flicker.

I will document the difference prominently in the "Coming from React" guide and in the Effect Timing documentation.

### 4. Error Recovery/Retry UI in Data Fetching (Issue 22)

**Fix later.** `useQuery` already has a `retry` option with exponential backoff. The missing piece is integration with `ErrorBoundary` -- making data fetching errors propagate to the nearest boundary. This requires a design decision about whether data fetching errors should be treated as render errors (caught by ErrorBoundary) or data errors (handled by the `error` signal). I lean toward keeping them as data errors with an opt-in `throwOnError` option, similar to TanStack Query. But this needs more thought and is not blocking.

---

## Closing Assessment

After this round of fixes, the framework reaches a new level of production readiness:

- **Core (reactive, dom, hooks, components): 9/10.** All known correctness bugs fixed. Test coverage being added. `memo` redesigned to be safe with signals.
- **Data fetching (data.js): 8/10.** Reactive cache, AbortController, cache eviction, consistent API. Still missing SWR global config and ErrorBoundary integration.
- **Server actions (actions.js): 7.5/10.** CSRF mandatory, input validation hooks, randomized IDs, timeout. Still missing rate limiting and automatic optimistic rollback.
- **Forms (form.js): 8/10.** Per-field signals already in place. Reactive register values. Still missing field arrays and form context.
- **Animation (animation.js): 7.5/10.** Spring cleanup working. Passive listener fix. Still missing AnimatePresence and multi-value springs.
- **Accessibility (a11y.js): 9/10.** Best-in-class. All lifecycle issues fixed. Dynamic itemCount supported.
- **Testing (testing.js): 8/10.** Solid API surface. Actual test suite being written.

**Overall: 8.5/10 production readiness after this round.** The path to 9.0 requires AnimatePresence, FormProvider, and route-level data loading -- all planned for v0.3.

The framework is approaching the point where I would recommend it for content-heavy sites with islands of interactivity. Not yet for complex SPAs with hundreds of interactive components -- that needs DevTools, more battle-testing, and the fine-grained `For`. But for the target use case -- the marketing site, the docs site, the e-commerce product page -- we are getting close to being the best option available.

-- Morgan, Framework Designer

---

*This document references source files in `packages/core/src/reactive.js`, `packages/core/src/dom.js`, `packages/core/src/hooks.js`, `packages/core/src/components.js`, `packages/core/src/data.js`, `packages/core/src/form.js`, `packages/core/src/animation.js`, `packages/core/src/a11y.js`, `packages/core/src/scheduler.js`, `packages/core/src/testing.js`, and `packages/server/src/actions.js`. All assessments are based on the current state of the codebase as of 2026-02-13.*
