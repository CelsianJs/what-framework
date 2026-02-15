# Round 3 Senior Developer Review: What Framework
**Reviewer:** Jordan (Senior Developer, 10+ years React/Vue/Svelte/SolidJS/Angular)
**Date:** 2026-02-13
**Scope:** Verification of Phase 2 fixes + regression analysis + updated production readiness assessment
**Previous:** [Round 2 Review](./round2-senior-jordan.md) | [Round 1 Review](./senior-developer-jordan.md)

---

## Executive Summary

Phase 2 addressed all three P0 issues and most P1 issues I identified in Round 2. The reactive SWR cache, memo redesign, server action hardening, AbortController integration, and form per-field signals represent substantial engineering effort. Most implementations are correct. However, several of the fixes have subtle edge cases, and two new issues have emerged from the fixes themselves. The framework has crossed the threshold from "approaching production-ready" to "production-usable with caveats."

**Overall assessment post-Phase 2:** Improved from 7.5/10 to 8.5/10 for production readiness. The three P0 blockers are resolved. The remaining issues are edge cases and hardening, not fundamental design flaws.

---

## Part 1: Fix Verification

### Fix 1: SWR Cache Is Now Reactive
**Status: VERIFIED -- Correct with two edge cases**

The fix in `packages/core/src/data.js` lines 7-53:

```js
const cacheSignals = new Map();  // key -> signal(value)
const cacheTimestamps = new Map(); // key -> last access time (for LRU)
const MAX_CACHE_SIZE = 200;

function getCacheSignal(key) {
  cacheTimestamps.set(key, Date.now());
  if (!cacheSignals.has(key)) {
    cacheSignals.set(key, signal(null));
    if (cacheSignals.size > MAX_CACHE_SIZE) {
      evictOldest();
    }
  }
  return cacheSignals.get(key);
}
```

And in `useSWR` lines 170-178:

```js
const cacheS = getCacheSignal(key);
const error = signal(null);
const isValidating = signal(false);
const data = computed(() => cacheS() ?? fallbackData ?? null);
const isLoading = computed(() => cacheS() == null && isValidating());
```

**Analysis:**

This is the correct fix. Each cache key now maps to a shared `signal(value)`. All `useSWR` instances with the same key read from the same signal via the `computed` wrapper `data`. When any instance calls `cacheS.set(result)` (line 213), all instances see the update because they all subscribe to the same underlying signal. The `invalidateQueries` function (line 551) now calls `cacheSignals.get(key).set(null)`, which triggers all subscribers to see the null and re-fetch. This is architecturally correct.

**Edge Case 1 -- LRU eviction of actively-subscribed keys:**

The `evictOldest()` function (lines 26-37) correctly skips keys with active revalidation subscribers:

```js
if (revalidationSubscribers.has(key) && revalidationSubscribers.get(key).size > 0) continue;
```

However, a component could be reading a cache signal via `computed(() => cacheS())` without having registered a revalidation subscriber. This happens if the component called `useSWR` but the `subscribeToKey` call (line 232) has not yet executed (e.g., during initial render before the `scopedEffect` fires). In this narrow window, the cache signal could be evicted, and the component would hold a reference to a signal that is no longer in the `cacheSignals` Map. Subsequent calls to `getCacheSignal` with the same key would create a NEW signal, disconnecting the component from future updates.

In practice this is unlikely -- the `scopedEffect` fires on the same microtask as the component render, and LRU eviction only triggers when the 201st unique key is created. But it is a correctness gap for high-cardinality cache key scenarios.

**Suggested fix:** Eviction should check whether the signal has active reactive subscribers (i.e., the signal's internal `subs` set is non-empty), not just whether there are revalidation subscribers. Since signals do not expose their subscriber count, the eviction function could use a WeakRef-based approach, or simply increase the cache size for production use.

**Edge Case 2 -- `invalidateQueries` with predicate iterates over `cacheSignals` while potentially modifying it:**

```js
export function invalidateQueries(keyOrPredicate) {
  const keysToInvalidate = [];
  if (typeof keyOrPredicate === 'function') {
    for (const [key] of cacheSignals) {
      if (keyOrPredicate(key)) keysToInvalidate.push(key);
    }
  }
  // ...
}
```

This correctly collects keys into an array first, then iterates the array to set values. The iteration over `cacheSignals` is read-only, so there is no concurrent modification issue. Good.

**Edge Case 3 -- `useQuery` cache cleanup setTimeout (line 366-371):**

```js
setTimeout(() => {
  if (Date.now() - lastFetchTime >= cacheTime) {
    cacheSignals.delete(key);
    cacheTimestamps.delete(key);
  }
}, cacheTime);
```

This `setTimeout` fires regardless of whether the component has unmounted. If the component unmounts and the timeout fires, it deletes the cache signal. Any other component still using that key would hold a stale reference to the deleted signal. When they next call `getCacheSignal(key)`, a new signal is created, but their existing `computed` still references the old one.

This is the same class of issue as Edge Case 1, but more likely to trigger because `cacheTime` defaults to 5 minutes, and it is common for components to unmount and remount within that window.

**Recommended fix:** The cache cleanup setTimeout should be cancelled on component unmount (add it to the `scopedEffect` cleanup), or it should only delete the signal if no other subscribers exist.

**Verdict: The fundamental design is correct. Multi-component cache sharing now works. The two edge cases are real but low-probability in typical usage. Grade improvement: C+ to B+.**

---

### Fix 2: memo Redesign (Signal-Safe)
**Status: VERIFIED -- Correct and well-reasoned**

The fix in `packages/core/src/components.js` lines 21-47:

```js
export function memo(Component, areEqual) {
  const compare = areEqual || shallowEqual;

  function MemoWrapper(props) {
    const ctx = _getCurrentComponent?.();
    if (ctx && ctx._memoResult !== undefined) {
      if (props === ctx._memoPropsRef) {
        // Same reference -> signal-triggered re-render -> must re-run
      } else if (compare(ctx._memoProps, props)) {
        // New reference but structurally equal -> parent-triggered, safe to skip
        ctx._memoPropsRef = props;
        return ctx._memoResult;
      }
    }
    if (ctx) {
      ctx._memoPropsRef = props;
      ctx._memoProps = { ...props };
    }
    const result = Component(props);
    if (ctx) ctx._memoResult = result;
    return result;
  }

  MemoWrapper.displayName = `Memo(${Component.name || 'Anonymous'})`;
  return MemoWrapper;
}
```

**Analysis:**

The key insight is that when a parent re-renders, it calls `propsSignal.set({ ...vnode.props, children: vnode.children })` (dom.js line 683), which creates a NEW object. The component's effect re-runs, calling `Component(propsSignal())`, which passes a new props reference. When a signal internal to the component changes, the component's effect re-runs, but `propsSignal()` returns the SAME object reference (the signal value has not changed).

So:
- `props === ctx._memoPropsRef` (same reference) => signal-triggered => must re-run to pick up signal changes => falls through to full render
- `props !== ctx._memoPropsRef` (new reference) AND `compare(ctx._memoProps, props)` => parent-triggered with equal props => safe to skip

This is a clean and correct heuristic. Let me trace through edge cases:

**Edge case A -- Parent passes a signal as a prop:**

```js
const count = signal(0);
const MemoChild = memo(({ count }) => h('div', null, count()));
// Parent: h(MemoChild, { count })
```

When `count.set(1)` fires, the parent's effect re-runs (if the parent reads `count` somewhere). The parent creates a new props object `{ count: countSignal }`. The `count` property is the same signal reference, so `shallowEqual` returns `true`. Memo skips. But the child reads `count()` inside its own render, which means the child's component effect is directly subscribed to the count signal. The child will re-render via its own signal subscription, not through the parent. The props reference check detects this as a signal-triggered re-render (same reference) and falls through. Correct.

But wait -- there is a subtlety. If the parent does NOT read `count()` itself, the parent does NOT re-render. The child's effect re-runs because it subscribed to `count` during its own render. In this case, `propsSignal()` returns the same reference, memo detects `props === ctx._memoPropsRef`, and falls through to a full render. The child picks up the new `count()` value. Correct.

**Edge case B -- Parent passes new object props that are structurally equal:**

```js
// Parent re-renders and creates: h(MemoChild, { label: 'hello', style: { color: 'red' } })
```

The `shallowEqual` check compares `Object.is(a[key], b[key])` for each key. The `style` object is a new reference each render, so `Object.is(oldStyle, newStyle)` is `false`. Memo does NOT skip. This is correct -- if a parent passes a new style object on every render, the child should re-render because the style content might have changed.

This matches React.memo behavior: shallow comparison uses `Object.is`, so new object/array references always fail the comparison. Developers who want to avoid this must either memoize the object or provide a custom `areEqual` function.

**Edge case C -- Component returns a function or signal (not a VNode):**

If `Component(props)` returns a function or signal, `ctx._memoResult` stores that return value. On a skipped render, the old return value is used. If the returned function closed over stale state, it could produce stale UI. However, this is the same semantic as React.memo -- if you skip the render, you get the old output. This is expected behavior.

**Edge case D -- No component context available (`_getCurrentComponent` returns null):**

If `memo` is used outside a component context (which should not happen in normal usage), `ctx` is `null`, and memo falls through to a full render every time. This is a safe fallback -- no crash, just no optimization.

**One concern -- `ctx._memoProps = { ...props }` performs a shallow copy:**

Line 38: `ctx._memoProps = { ...props }`. This copies the props object so that the comparison on the next render is against the ORIGINAL values, not the same reference. If the parent mutates the props object between renders (which would be a very bad practice), the comparison would correctly detect the change. This is good defensive coding.

**Verdict: The memo redesign is correct, well-reasoned, and handles edge cases properly. It follows the same semantic model as React.memo. No issues found.**

---

### Fix 3: Server Actions Hardened
**Status: VERIFIED -- Substantially improved, with remaining concerns**

The changes span several areas in `packages/server/src/actions.js`:

**3a. Randomized Action IDs (lines 76-82):**

```js
function generateActionId() {
  const rand = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('')
    : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return `a_${rand}`;
}
```

**Analysis:** 6 bytes of cryptographic randomness yields 48 bits of entropy. This produces IDs like `a_3f8a2c1d9e0b`. There are 2^48 (approximately 281 trillion) possible IDs, making brute-force enumeration infeasible. The `Math.random` fallback is weaker (pseudo-random, predictable with seed knowledge), but it is a reasonable degradation for environments without crypto support.

**Concern:** The `Math.random` fallback appends `Date.now().toString(36)`, which adds approximately 6-7 characters of time-based entropy. Together with the `Math.random` prefix, this is about 10-11 characters of alphanumeric randomness. An attacker who knows the approximate time an action was registered could reduce the search space significantly. However, since `crypto.getRandomValues` is available in all modern browsers and Node.js 16+, the fallback is only relevant for extremely old environments.

The IDs are also per-process. If the server restarts, new IDs are generated. An attacker cannot reuse action IDs from a previous process. This is good.

**3b. CSRF Protection (lines 24-72):**

```js
function getCsrfToken() {
  if (_csrfToken) return _csrfToken;
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="what-csrf-token"]');
    if (meta) {
      _csrfToken = meta.getAttribute('content');
      return _csrfToken;
    }
    const match = document.cookie.match(/(?:^|;\s*)what-csrf=([^;]+)/);
    if (match) {
      _csrfToken = decodeURIComponent(match[1]);
      return _csrfToken;
    }
  }
  return null;
}
```

**Analysis:** The CSRF implementation follows the standard double-submit pattern: the token is embedded in the page (via meta tag or cookie) and sent with every request as a custom header (`X-CSRF-Token`). The server validates the header against the session token using constant-time comparison (`validateCsrfToken`, lines 58-67).

**Concern 1 -- Token caching on client:**

`_csrfToken` is cached at module scope (line 26). If the token rotates (e.g., on session renewal), the cached value becomes stale. Subsequent action calls will send the old token and fail validation. The cache should be invalidated when the token changes, or the token should be read fresh on each request. Since meta tag/cookie reads are cheap DOM operations, removing the cache would be the simplest fix:

```js
function getCsrfToken() {
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="what-csrf-token"]');
    if (meta) return meta.getAttribute('content');
    const match = document.cookie.match(/(?:^|;\s*)what-csrf=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}
```

**Concern 2 -- `csrfMetaTag` XSS vector (line 71):**

```js
export function csrfMetaTag(token) {
  return `<meta name="what-csrf-token" content="${token}">`;
}
```

If the `token` contains HTML characters (e.g., `"><script>alert(1)</script>`), this becomes an XSS injection point. The token should be HTML-escaped. Since tokens from `generateCsrfToken()` use `crypto.randomUUID()` (which only produces hex and dashes), this is not exploitable with framework-generated tokens. But if a developer passes a user-controlled string as the token (a misuse, but possible), it becomes exploitable.

**Recommended fix:**

```js
export function csrfMetaTag(token) {
  const escaped = String(token).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
  return `<meta name="what-csrf-token" content="${escaped}">`;
}
```

**Concern 3 -- `handleActionRequest` CSRF validation is opt-in (lines 356-365):**

```js
export function handleActionRequest(req, actionId, args, options = {}) {
  const { csrfToken: sessionCsrfToken, skipCsrf = false } = options;
  if (!skipCsrf && sessionCsrfToken) {
    const requestCsrfToken = req?.headers?.['x-csrf-token'] || req?.headers?.['X-CSRF-Token'];
    if (!validateCsrfToken(requestCsrfToken, sessionCsrfToken)) {
      return Promise.resolve({ status: 403, body: { message: 'Invalid CSRF token' } });
    }
  }
```

The condition `!skipCsrf && sessionCsrfToken` means CSRF validation ONLY happens if the caller explicitly provides a `csrfToken` in options. If the server middleware does not pass the session token, CSRF is silently disabled. This is a dangerous default -- CSRF should be enabled by default and require explicit opt-out.

**Recommended fix:** Flip the default. If `sessionCsrfToken` is not provided and `skipCsrf` is not `true`, log a warning:

```js
if (!skipCsrf) {
  if (!sessionCsrfToken) {
    console.warn('[what] handleActionRequest called without CSRF token. Set skipCsrf: true to explicitly disable CSRF protection.');
  } else {
    // validate as current
  }
}
```

**3c. Configurable Timeout (lines 100-148):**

```js
const timeout = options.timeout || 30000;
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), timeout);
try {
  // ...fetch with controller.signal...
} catch (error) {
  if (error.name === 'AbortError') {
    const timeoutError = new Error(`Action "${id}" timed out after ${timeout}ms`);
    timeoutError.code = 'TIMEOUT';
    // ...
  }
} finally {
  clearTimeout(timeoutId);
}
```

**Analysis:** This is a correct implementation of fetch timeout using AbortController. The timeout is cleared in the `finally` block to prevent the abort from firing after a successful response. The `AbortError` is caught and converted to a descriptive timeout error with a `code` property for programmatic detection.

**One subtlety:** If the user manually aborts the action (e.g., via a cancel button calling `controller.abort()`), it would also be caught as `AbortError`. The code does not distinguish between timeout-induced and user-induced aborts. Since the AbortController is internal to `callAction` and not exposed, this is not currently an issue. But if abort-from-outside support is added in the future, the error handling would need to differentiate.

**3d. Optimistic updates with auto-rollback (lines 306-316):**

```js
async function withOptimistic(action, asyncFn) {
  addOptimistic(action);
  try {
    const result = await asyncFn();
    resolve(action, result);
    return result;
  } catch (e) {
    rollback(action);
    throw e;
  }
}
```

**Analysis:** This is a clean wrapper that handles the optimistic-then-confirm/rollback pattern. The `resolve` function (line 275-288) recomputes the optimistic state from the new server base value plus all remaining pending actions. This is correct -- it handles the case where multiple optimistic actions are in flight and one resolves out of order.

The `rollback` function (line 290-303) similarly recomputes from the base value. One concern: `rollback` uses `baseValue.peek()` as the fallback when no `realValue` is provided. If two optimistic actions are in flight and the first rolls back without a real value, `baseValue` still holds the original pre-optimistic value, which is correct. Good.

**3e. Error message sanitization (lines 377-386):**

```js
.catch(error => {
  console.error(`[what] Action "${actionId}" error:`, error);
  return {
    status: 500,
    body: { message: 'Action failed' },
  };
});
```

The full error is logged server-side, and only a generic `'Action failed'` message is sent to the client. This is the correct pattern. Round 2 flagged that `error.message` was being sent to the client, and this has been fixed.

**Verdict: Substantial improvement. CSRF protection is present but has a dangerous opt-in default. Token caching and XSS in csrfMetaTag are minor issues. The core security posture is dramatically better than Round 2. Grade improvement: C- to B.**

---

### Fix 4: Data Fetching AbortController
**Status: VERIFIED -- Correct**

All three data fetching hooks now create and manage AbortControllers:

**useFetch (lines 82-128):**
```js
let abortController = null;
async function fetchData() {
  if (abortController) abortController.abort();
  abortController = new AbortController();
  const { signal: abortSignal } = abortController;
  // ...
  try {
    const response = await fetch(url, { signal: abortSignal });
    if (!abortSignal.aborted) { data.set(transform(json)); }
  } catch (e) {
    if (!abortSignal.aborted) { error.set(e); }
  } finally {
    if (!abortSignal.aborted) { isLoading.set(false); }
  }
}
scopedEffect(() => {
  fetchData();
  return () => { if (abortController) abortController.abort(); };
});
```

**useSWR (lines 198-228):**
Same pattern with abort on unmount via `scopedEffect` cleanup (line 239).

**useQuery (lines 336-410):**
Same pattern. Also passes `signal: abortSignal` to `queryFn` (line 351), allowing the user's fetcher to observe the abort.

**Analysis:**

All three implementations follow the correct pattern:
1. Abort previous request before starting a new one (prevents stale responses from overwriting fresh data).
2. Check `abortSignal.aborted` before updating state (prevents writes from cancelled requests).
3. Abort on component unmount via `scopedEffect` cleanup.

The `!abortSignal.aborted` check after `await` is essential because the abort might happen between the `await fetch()` and the state update. This is correct.

**Verdict: Correct implementation across all three hooks. No issues found.**

---

### Fix 5: createResource Lifecycle
**Status: VERIFIED -- Correct**

In `packages/core/src/hooks.js` lines 265-272:

```js
const ctx = getCurrentComponent?.();
if (ctx) {
  ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
  ctx._cleanupCallbacks.push(() => {
    if (controller) controller.abort();
  });
}
```

**Analysis:** When the component unmounts, `disposeComponent` in dom.js runs `ctx._cleanupCallbacks`, which aborts the in-flight request. The `refetch` function (line 232-259) aborts the previous controller before creating a new one, preventing stale responses.

**Verdict: Correct. No issues found.**

---

### Fix 6: SWR Deduplication Against Completed Fetches
**Status: VERIFIED -- Correct**

In `packages/core/src/data.js` lines 193-197:

```js
const lastFetch = lastFetchTimestamps.get(key);
if (lastFetch && now - lastFetch < dedupingInterval && cacheS.peek() != null) {
  return cacheS.peek();
}
```

**Analysis:** This correctly prevents a re-fetch if a successful fetch completed recently (within the deduplication interval). The `cacheS.peek() != null` check ensures that only successful fetches (which populated the cache) count for deduplication -- failed fetches that left the cache null will not be deduplicated, allowing retries.

The `lastFetchTimestamps` Map is updated on line 217 after a successful fetch: `lastFetchTimestamps.set(key, Date.now())`.

**Minor concern:** The `lastFetchTimestamps` Map is never cleaned up. Over time, it accumulates timestamps for every key that was ever fetched. This is a slow memory leak, but practically insignificant (each entry is a string key + a number timestamp, totaling ~100 bytes per key). For completeness, cleanup could happen during `evictOldest()`.

**Verdict: Correct implementation. Minor memory concern with `lastFetchTimestamps` never being pruned.**

---

### Fix 7: Flush Loop Improved
**Status: VERIFIED -- Good improvement**

In `packages/core/src/reactive.js` lines 188-201:

```js
if (iterations >= 100) {
  if (__DEV__) {
    const remaining = [...pendingEffects].slice(0, 3);
    const effectNames = remaining.map(e => e.fn?.name || e.fn?.toString().slice(0, 60) || '(anonymous)');
    console.warn(
      `[what] Possible infinite effect loop detected (100 iterations). ` +
      `Likely cause: an effect writes to a signal it also reads, creating a cycle. ` +
      `Looping effects: ${effectNames.join(', ')}`
    );
  } else {
    console.warn('[what] Possible infinite effect loop detected');
  }
  pendingEffects.clear();
}
```

**Analysis:** The warning now includes the names (or first 60 chars of source) of the looping effects, which is much more useful for debugging than the previous generic message. The `pendingEffects.clear()` at the end prevents infinite warn spam (which I flagged in Round 2). The `__DEV__` guard ensures the extra diagnostic work does not happen in production.

**Suggestion for further improvement:** The warning could also suggest `untrack()` as a common fix for effects that read-and-write the same signal:

```js
`Likely cause: an effect writes to a signal it also reads, creating a cycle. ` +
`Use untrack() to read signals without subscribing. ` +
```

But this is a documentation/DX improvement, not a correctness issue.

**Verdict: Good improvement. No issues.**

---

### Fix 8: useScheduledEffect with raf() Debouncing
**Status: VERIFIED -- Correct**

In `packages/core/src/scheduler.js` lines 100-114:

```js
export function useScheduledEffect(readFn, writeFn) {
  const effectKey = Symbol('scheduledEffect');
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

**Analysis:** In Round 2, I flagged that `useScheduledEffect` created a new `scheduleRead` closure on every effect run, accumulating callbacks during rapid signal changes. The fix uses `raf()` with a unique `Symbol` key to debounce: when the signal changes rapidly, only the latest callback is kept. The `Symbol` ensures each `useScheduledEffect` instance has its own debounce key, preventing interference between different scheduled effects.

The `raf()` function (lines 137-149) replaces the callback in the `debouncedCallbacks` Map without scheduling a new RAF if one is already pending for that key. This means only the latest readFn/writeFn pair executes per animation frame.

**No closure retention:** The previous closure is overwritten in the Map, so it can be garbage collected. This resolves the closure retention concern from Round 2.

**Verdict: Correct fix. The Symbol-key approach is clean and idiomatic.**

---

### Fix 9: Form register() Getter
**Status: VERIFIED -- Correct**

In `packages/core/src/form.js` lines 120-143, the `register` function now uses per-field signals and a getter:

```js
function register(name, options = {}) {
  const fieldSig = getFieldSignal(name);
  return {
    name,
    get value() { return fieldSig(); },
    onInput: (e) => {
      const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      setValue(name, value);
      // ...
    },
    // ...
  };
}
```

**Analysis:** The `get value()` accessor ensures the value is always read fresh from the field signal, even if the `register()` result object is cached by the consumer. In Round 2, I flagged that the old approach returned a snapshot (`value: values()[name]`) that would become stale. The getter solves this because each read evaluates `fieldSig()`, which reads the current signal value and establishes a subscription in the current reactive context.

The per-field signal architecture (`fieldSignals` Map on line 19, `getFieldSignal` on lines 23-28) ensures that typing in one field only re-renders components subscribed to that specific field's signal, not the entire form. This resolves the performance cliff I flagged in Round 2.

**Verdict: Correct. The performance model is now comparable to React Hook Form's uncontrolled approach in terms of re-render scope.**

---

### Fix 10: Passive Touch Option in useGesture
**Status: VERIFIED -- Correct**

In `packages/core/src/animation.js` line 426:

```js
el.addEventListener('touchstart', handleStart, { passive: !preventDefault });
```

**Analysis:** When `preventDefault` is `true`, `passive` is set to `false`, which allows `e.preventDefault()` in the handler. When `preventDefault` is `false` (default), `passive` is `true`, which enables scroll optimization.

**Verdict: Correct one-line fix. No issues.**

---

### Fix 11: _prevStyle Cleared in removeProp
**Status: VERIFIED -- Correct**

In `packages/core/src/dom.js` lines 874-877:

```js
if (key === 'style') {
  el.style.cssText = '';
  el._prevStyle = null;
  return;
}
```

**Analysis:** When a style prop is removed entirely, `el._prevStyle` is now cleared. This resolves the minor memory retention issue I flagged in Round 2 where stale `_prevStyle` data persisted after the style prop was removed.

**Verdict: Correct. No issues.**

---

### Fix 12: Effect Timing Documentation
**Status: VERIFIED -- Comprehensive and accurate**

The `EFFECT-TIMING.md` document covers:
- Core rule (microtask deferral)
- Rationale (no glitches, no flicker, predictable ordering)
- `batch()` semantics
- `flushSync()` semantics and appropriate usage
- `useEffect` timing comparison table vs React/Solid/Svelte
- Effect ordering within a flush pass
- `computed()` laziness
- `untrack()` semantics
- Signal subscriptions and component re-renders

**Analysis:** The document is technically accurate. The timing comparison table is particularly valuable -- it clearly communicates how What differs from other frameworks. The effect ordering section correctly explains the multi-pass flush behavior.

**One minor inaccuracy:** The doc says "Effects run in the order they were notified." This is mostly true because `pendingEffects` is a `Set` and JavaScript Sets maintain insertion order. However, if the same effect is notified multiple times (e.g., it reads two signals that both change), the Set deduplicates it, so it runs once. This is correct behavior but the doc could mention the deduplication for completeness.

**Verdict: High-quality documentation. Would recommend to any new contributor to read this first.**

---

## Part 2: Items Fixed from Round 2 Top 10

### Checklist

| # | Round 2 Issue | Status | Notes |
|---|---------------|--------|-------|
| P0-1 | `useContext` uses `_parentCtx` chain | **VERIFIED** (hooks.js line 142) | Now walks `_parentCtx` instead of `componentStack` |
| P0-2 | CSRF protection in server actions | **VERIFIED** with caveats | Token present, but opt-in default is dangerous |
| P0-3 | SWR cache reactive | **VERIFIED** | Shared signal per key |
| P1-4 | Array-to-non-array patching | **VERIFIED** (dom.js lines 593-628) | `cleanupArrayMarkers` helper handles transitions |
| P1-5 | Suspense boundary effect disposal | **VERIFIED** (dom.js line 338) | `boundaryCtx.effects.push(dispose)` now present |
| P1-6 | AbortController in data hooks | **VERIFIED** | All three hooks + `createResource` |
| P1-7 | Form per-field signals | **VERIFIED** | `fieldSignals` Map with per-field `signal()` |
| P2-8 | Input validation in `handleActionRequest` | **PARTIALLY FIXED** | Array check on args (line 373), but no deep validation |
| P2-9 | Dead `errorBoundaryStack` export | **FIXED** | Removed (line 8 now has a comment noting removal) |
| P2-10 | Spring cleanup on unmount | **FIXED** (animation.js lines 106-110) | `stop()` registered as cleanup callback |

**10 out of 10 addressed.** 8 fully verified, 1 partially fixed, 1 has caveats. This is excellent follow-through.

---

## Part 3: Remaining Issues and New Findings

### ISSUE 1 (P1): `useQuery` Calls `fetch()` Instead of `fetchQuery()` in Event Handlers

In `packages/core/src/data.js` lines 413-422:

```js
// Refetch on focus
if (refetchOnWindowFocus && typeof window !== 'undefined') {
  scopedEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        fetch().catch(() => {});  // <-- BUG: should be fetchQuery()
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  });
}

// Polling
if (refetchInterval) {
  scopedEffect(() => {
    const interval = setInterval(() => {
      fetch().catch(() => {});  // <-- BUG: should be fetchQuery()
    }, refetchInterval);
    return () => clearInterval(interval);
  });
}
```

Lines 419 and 429 call `fetch()` (the global window.fetch API) instead of `fetchQuery()` (the local refetch function). This means:
- `refetchOnWindowFocus` will call `window.fetch()` with no arguments, making a GET request to the current page URL and silently discarding the result.
- `refetchInterval` will do the same on every interval tick.

Neither will actually refetch the query data.

Compare with `useSWR` (lines 247-249) which correctly calls `revalidate()`:
```js
const handler = () => {
  if (document.visibilityState === 'visible') {
    revalidate().catch(() => {});  // Correct
  }
};
```

**Severity: P1.** `refetchOnWindowFocus` and `refetchInterval` are silently broken in `useQuery`. They appear to work (no errors) but do nothing useful. Any developer relying on these features will have stale data.

**Fix:** Replace `fetch()` with `fetchQuery()` on lines 419 and 429.

---

### ISSUE 2 (P1): `useQuery` Retry Delay Does Not Respect AbortController

In `packages/core/src/data.js` lines 374-379:

```js
attempts++;
if (attempts < retry) {
  await new Promise(r => setTimeout(r, retryDelay(attempts)));
  return attemptFetch();
}
```

If the component unmounts during the retry delay (`setTimeout`), the abort signal fires, but the `Promise` created by `setTimeout` is not cancelled. The function waits for the full delay, then calls `attemptFetch()` again. The next `queryFn` call will receive an already-aborted signal and fail immediately, but the delay itself is wasted.

More importantly, the `await new Promise(r => setTimeout(r, retryDelay(attempts)))` holds a reference to the `attemptFetch` closure (via the subsequent recursive call), preventing garbage collection of the entire query context during the delay.

**Severity: P2.** Not a correctness bug (the aborted signal will prevent stale state updates), but it is a resource waste and potential memory retention for long retry delays (up to 30 seconds with the default exponential backoff).

**Fix:** Use an AbortSignal-aware delay:
```js
await new Promise((resolve, reject) => {
  const id = setTimeout(resolve, retryDelay(attempts));
  abortSignal.addEventListener('abort', () => {
    clearTimeout(id);
    reject(new DOMException('Aborted', 'AbortError'));
  }, { once: true });
});
```

---

### ISSUE 3 (P2): `useSWR` Local `error` Signal Not Shared Across Instances

In `packages/core/src/data.js` lines 175-176:

```js
const error = signal(null);
const isValidating = signal(false);
```

The `data` signal is correctly shared via `getCacheSignal(key)`, but `error` and `isValidating` are local to each `useSWR` instance. This means if two components use `useSWR('/api/data', fetcher)` and the fetch fails, only the component that initiated the fetch sees the error. The other component continues to show the stale cached data with no error indication.

In vercel/swr, error state is also shared across instances of the same key via the cache. This is important for error boundaries and loading states to be consistent across the app.

**Severity: P2.** This is a correctness gap rather than a bug -- the API works, but the behavior diverges from SWR's documented semantics. Developers familiar with vercel/swr might expect error state to be shared.

**Potential fix:** Store `error` and `isValidating` signals in the cache alongside the data signal, or use a per-key error signal similar to `cacheSignals`.

---

### ISSUE 4 (P2): `useInfiniteQuery` Has No AbortController

In `packages/core/src/data.js` lines 451-535, the `useInfiniteQuery` hook does not create an AbortController. Neither `fetchPage` nor the initial `scopedEffect` abort in-flight requests on unmount. The `queryFn` is called without a signal parameter.

Compare with `useSWR` and `useQuery` which both have abort support post-Phase 2.

**Severity: P2.** `useInfiniteQuery` is likely used less frequently than `useSWR`/`useQuery`, but the inconsistency is a maintenance hazard. The fix is straightforward: follow the same AbortController pattern.

---

### ISSUE 5 (P2): `computed` in `useSWR` Creates Orphaned Effects

In `packages/core/src/data.js` lines 177-178:

```js
const data = computed(() => cacheS() ?? fallbackData ?? null);
const isLoading = computed(() => cacheS() == null && isValidating());
```

`computed()` in `reactive.js` (lines 47-75) creates an internal effect via `_createEffect`. This effect is never registered with the component context. When the component unmounts, the component's `scopedEffect` cleanup disposes the main effect and unsubscribes from the key, but the computed's internal effect is NOT disposed. It remains subscribed to `cacheS` and `isValidating`.

In practice, the computed's internal effect is a `{ lazy: true }` effect that only marks itself dirty via `_onNotify`. It does not run any user code or cause DOM updates. The `flush` loop skips it because of the `!e._onNotify` check (reactive.js line 184). So the impact is limited to a small memory retention (the computed's closure and its subscriber entries in `cacheS`'s and `isValidating`'s subscriber sets).

**Severity: P3 (low).** The memory impact is small, and the orphaned computed does not cause any visible behavior. But it is a leak proportional to the number of unmounted components that used `useSWR`. Over time in a long-running SPA with many route transitions, this could accumulate.

**Fix:** Register the computed's disposal with the component context, or switch from `computed` to a manual approach that does not create an internal effect.

---

### ISSUE 6 (P3): Keyed Reconciliation LIS Mapping Has a Bug

In `packages/core/src/dom.js` lines 477-487:

```js
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

The LIS is computed on the filtered `sources` array (only entries with `sources[j] !== -1`). The result `lis` is an array of indices into the filtered array. The code then maps these back to indices in the original `sources` array using the nested loop.

**The issue:** `lis` contains indices into the filtered array. `lis[i]` is an index, not a value. The inner loop searches for the `count`-th non-negative entry in `sources`, where `count` matches `lis[i]`. This mapping is correct -- it converts filtered-array indices back to original-array indices.

However, the `longestIncreasingSubsequence` function (lines 528-563) returns indices of the filtered array elements that form the LIS, not the values themselves. The `_` parameter in the map callback is unused, and `i` is the iteration index. So `lis[i]` is the i-th element of the LIS result, which is an index into the filtered array.

Actually, tracing through more carefully: `longestIncreasingSubsequence([3, 1, 5])` should return `[0, 2]` (indices 0 and 2 of the input, representing values 3 and 5). The code then maps index 0 in the filtered array back to the original `sources` index where the 0th non-negative entry lives, and index 2 to the 2nd non-negative entry.

Wait -- there is a subtle problem. The LIS function returns indices that form an increasing subsequence of VALUES. But what matters for DOM reconciliation is which new-array indices map to old-array indices that are already in order. The `lisSet` should contain new-array indices (indices into `newVNodes`), not filtered-array indices.

Let me trace through an example:
- `sources = [-1, 2, -1, 0, 3]` (5 new vnodes, 3 reused from old positions 2, 0, 3)
- Filtered: `[2, 0, 3]` (values, corresponding to new indices 1, 3, 4)
- LIS of `[2, 0, 3]`: The longest increasing subsequence is `[0, 3]` (indices 1, 2 in filtered array, values 0 and 3)
- Mapping back: filtered index 1 = new index 3, filtered index 2 = new index 4
- `lisSet = {3, 4}`

So new-index 1 (old-index 2) is NOT in the LIS and needs to be moved. New-indices 3 and 4 (old-indices 0 and 3) ARE in the LIS and stay in place. This is correct -- old indices 0 and 3 are already in increasing order, so those nodes do not need to be moved.

After more careful analysis, the mapping logic is correct but unnecessarily complex. A cleaner approach would be to compute the LIS directly on `sources` (including -1 entries, which are filtered out), but the current implementation works.

**Severity: P3.** The code is correct but hard to reason about. If a refactor introduces an off-by-one error, it would cause incorrect DOM ordering. Consider adding a comment explaining the index mapping, or simplifying the approach.

---

## Part 4: Architecture Assessment -- Data Layer

The data layer has matured significantly since Round 2. Here is an updated assessment:

### What Works Well

1. **Reactive cache sharing.** The `cacheSignals` Map with shared signals is the right architecture. It correctly implements the "shared state keyed by query key" pattern that vercel/swr and TanStack Query use.

2. **Deduplication model.** The combination of in-flight request deduplication and completed-fetch deduplication covers both concurrent and rapid-sequential fetches.

3. **`scopedEffect` pattern.** Tying fetch lifecycle (abort, unsubscribe) to component lifecycle via `scopedEffect` is clean and prevents the most common class of data-fetching bugs (stale updates, zombie fetches).

4. **API surface.** The framework offers three levels of abstraction (`useFetch` for simple cases, `useSWR` for caching, `useQuery` for advanced features), which is good API design.

### What Needs Work

1. **Error and loading state are not shared** (Issue 3 above). The data layer is half-reactive: data is shared, but error/loading states are local.

2. **`useInfiniteQuery` is under-featured.** No abort support, no error handling, no retry, no cache integration. It is essentially a stateful pagination helper, not a proper infinite query implementation.

3. **No global configuration.** vercel/swr has `SWRConfig` for setting default fetcher, deduplication interval, etc. TanStack Query has `QueryClient`. What has no equivalent. Each `useSWR` call must pass all options individually.

4. **Cache cleanup is inconsistent.** `useSWR` relies on LRU eviction. `useQuery` uses `setTimeout`. `useInfiniteQuery` has no cleanup. A unified cache management strategy would be better.

### Verdict: Solid for a v1.0 data layer. Not yet competitive with vercel/swr or TanStack Query for complex applications, but adequate for the "batteries-included" positioning of the framework.

---

## Part 5: Architecture Assessment -- Server Actions

### What Works Well

1. **CSRF protection with constant-time comparison.** The `validateCsrfToken` function using XOR comparison prevents timing attacks. This is textbook correct.

2. **Randomized action IDs.** The 48-bit entropy IDs make brute-force enumeration infeasible.

3. **Timeout with AbortController.** Clean implementation that converts timeout to a descriptive error.

4. **Error message sanitization.** Server-side logging with generic client-facing messages.

5. **`withOptimistic` auto-rollback.** Clean async wrapper that handles the happy and error paths.

### What Needs Work

1. **CSRF is opt-in** (see Fix 3 analysis above). This is the most concerning remaining issue. A secure-by-default approach would be safer.

2. **No rate limiting hooks.** The framework does not provide middleware patterns for rate limiting, authentication, or authorization. Developers must implement these themselves.

3. **No argument schema validation.** The `Array.isArray(args)` check (line 373) prevents prototype pollution from non-array arguments, but there is no schema validation of the array contents. A developer must validate inside each action function.

4. **No action grouping or namespacing.** All actions share a global registry. In a large application with many actions, naming conflicts could occur (though randomized IDs mitigate this).

---

## Part 6: Updated Module Scores

| Module | Round 2 Grade | Round 3 Grade | Change | Notes |
|--------|--------------|--------------|--------|-------|
| **reactive.js** | A- | A- | -- | Core is solid. Flush loop improved. |
| **dom.js** | B+ | A- | +1 | Array patching fixed, Suspense leak fixed, portal cleanup correct |
| **components.js** | B | A- | +1 | memo redesign is clean and correct |
| **hooks.js** | B+ | A- | +0.5 | `useContext` fixed, `createResource` lifecycle added |
| **data.js** | C+ | B+ | +1.5 | Reactive cache, abort, dedup. `useQuery` focus/poll bug drops it. |
| **form.js** | B- | B+ | +1 | Per-field signals solve the performance cliff |
| **animation.js** | B | B+ | +0.5 | Spring cleanup on unmount added |
| **a11y.js** | B+ | B+ | -- | No changes (round 2 issues were lower priority) |
| **scheduler.js** | B+ | A- | +0.5 | `useScheduledEffect` fixed with raf debouncing |
| **actions.js** | C- | B | +1.5 | CSRF, randomized IDs, timeout, error sanitization |

**Overall Framework Grade: B+ (8.5/10)**

---

## Part 7: Updated Recommendations

### Resolved from Round 2 Top 10

All 10 items addressed. 8 fully resolved, 2 with remaining notes (CSRF default, input validation depth).

### New Top 10 (Post-Phase 2)

**P1 (should fix before production):**

1. **Fix `useQuery` `refetchOnWindowFocus` and `refetchInterval` to call `fetchQuery()` instead of `fetch()`.** (Issue 1). This is a two-line fix but the features are completely broken without it.

2. **Make CSRF protection default-on in `handleActionRequest`.** Log a warning when no `csrfToken` is provided and `skipCsrf` is not set. A framework that ships security features behind opt-in flags provides a false sense of security.

3. **HTML-escape the `csrfMetaTag` token.** Prevents XSS if a non-standard token value is used.

**P2 (should fix soon):**

4. **Add AbortController to `useInfiniteQuery`.** (Issue 4). Consistency with the other data hooks.

5. **Share error/loading state across SWR instances with the same key.** (Issue 3). Use per-key error and isValidating signals alongside the data signal.

6. **Make `useQuery` retry delay abort-aware.** (Issue 2). Use `AbortSignal` to cancel the retry timeout on unmount.

7. **Remove `_csrfToken` caching in `getCsrfToken`.** Read the meta tag / cookie fresh on each call to handle token rotation.

**P3 (nice to have):**

8. **Clean up `lastFetchTimestamps` during LRU eviction.** Prevents slow memory growth.

9. **Register `computed` disposal in `useSWR`.** Prevents orphaned computed effects on unmount.

10. **Add comments to the LIS index mapping in keyed reconciliation.** The code is correct but hard to follow.

---

## Part 8: Production Readiness Assessment

### Can This Framework Be Used in Production Now?

**Yes, with caveats.**

The core reactive system (`reactive.js`, `dom.js`, `components.js`, `hooks.js`) is now production-quality. The microtask deferral, error boundaries, context, and reconciliation are all correct and well-tested by the three rounds of review.

The data layer (`data.js`) is production-usable for `useFetch` and `useSWR`. `useQuery` has the `fetch()` vs `fetchQuery()` bug that must be fixed first. `useInfiniteQuery` is a beta-quality implementation.

The server actions (`actions.js`) are production-usable IF the developer:
1. Explicitly passes the CSRF token to `handleActionRequest`.
2. Validates arguments inside each action function.
3. Implements rate limiting at the middleware level.

The form system (`form.js`) is now production-usable for all form sizes thanks to per-field signals.

### Comparison to Competitors

| Dimension | What (Post-Phase 2) | React 19 | SolidJS 2 | Svelte 5 |
|-----------|---------------------|----------|-----------|----------|
| **Core reactivity** | A- (signals + microtask) | A (fiber scheduler) | A+ (push-pull) | A (compiled) |
| **Data fetching** | B+ (SWR + Query) | B (RSC, no built-in SWR) | B (createResource) | B- (load functions) |
| **Forms** | B+ (per-field signals) | B+ (via RHF) | B (via third-party) | B+ (bind:value) |
| **Server actions** | B (CSRF, timeout) | A- (encrypted, integrated) | B (server functions) | B (form actions) |
| **Bundle size** | A (8-12KB) | C (30KB+ min) | A (7-10KB) | A (compiled) |
| **Islands/SSR** | A (built-in) | B (RSC, complex) | B+ (solid-start) | A- (SvelteKit) |

What Framework is competitive in its target niche: a lightweight, batteries-included framework with good SSR and islands support. It is not trying to compete with React's ecosystem breadth or SolidJS's raw performance. Its strength is the all-in-one package at a small bundle size.

### What Is Needed for a Confident v1.0 Release

1. Fix the three P1 issues above (one afternoon of work).
2. Add integration tests for the data layer (cache sharing, abort on unmount, deduplication).
3. Add security tests for server actions (CSRF validation, token rotation, timeout).
4. TypeScript declarations for the public API (not blocking for JS-first users but critical for adoption).
5. A migration guide from the previous synchronous effect behavior.

### Final Rating

**8.5/10 for production readiness** (up from 7.5). The P0 blockers from Round 2 are resolved. The remaining issues are edge cases and hardening, not fundamental design flaws.

**9/10 for architecture and vision** (up from 8.5). The reactive cache design, memo signal-safety trick, and `scopedEffect` pattern demonstrate strong architectural thinking. The code is consistently clean and well-organized.

The biggest remaining risk is not in the code itself but in the lack of automated test coverage for the correctness properties that were manually verified in these three review rounds. The fixes are correct, but without regression tests, future changes could silently reintroduce the bugs that were found.

---

*This review references source files in `packages/core/src/data.js`, `packages/core/src/components.js`, `packages/core/src/reactive.js`, `packages/server/src/actions.js`, `packages/core/src/dom.js`, `packages/core/src/hooks.js`, `packages/core/src/scheduler.js`, `packages/core/src/form.js`, `packages/core/src/animation.js`, `packages/core/src/a11y.js`, and `docs/EFFECT-TIMING.md`. All line numbers reference the current state of the codebase as of 2026-02-13.*
