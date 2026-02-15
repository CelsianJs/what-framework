# Round 2 Feedback Synthesis: What Framework
**Prepared by:** Sam (Feedback Receiver)
**Date:** 2026-02-13
**Input:** Round 2 Junior Developer Review (Alex), Round 2 Senior Developer Review (Jordan)
**Audience:** Morgan (Framework Designer)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Phase 1 Fix Verification Summary](#phase-1-fix-verification-summary)
3. [Concurrent Fixes Already Applied](#concurrent-fixes-already-applied)
4. [Remaining Issues -- Prioritized](#remaining-issues----prioritized)
5. [Areas of Agreement](#areas-of-agreement)
6. [Areas of Disagreement or Different Perspectives](#areas-of-disagreement-or-different-perspectives)
7. [Updated Scores](#updated-scores)
8. [Recommendations for Morgan](#recommendations-for-morgan)

---

## Executive Summary

Both reviewers confirm that the Phase 1 fixes addressed the three most critical correctness bugs from Round 1: the diamond dependency glitch, the DocumentFragment crash in array patching, and the ErrorBoundary stack-based resolution failure for async errors. The implementations are correct and neither reviewer found regressions in the core fixes. The memory leaks in `useMediaQuery` and `useLocalStorage` are resolved. The router Link active state for `/` is fixed. Style diffing now removes stale properties. The `<what-c>` custom element is properly registered.

However, both reviewers independently discovered the same new P0 bug: `useContext` uses the runtime `componentStack` instead of the `_parentCtx` chain, which means context lookups break on re-renders, in effects, and in event handlers. This is the exact same architectural flaw that ErrorBoundary had before Phase 1 -- and it needs the exact same fix.

Additionally, Jordan's deep-dive into modules not covered in Round 1 (data.js, form.js, animation.js, a11y.js, scheduler.js, actions.js) revealed significant concerns in data fetching (non-reactive shared cache), server actions (no CSRF protection), and form performance (single-signal-for-all-values). Alex's five-application mental walkthrough identified critical gaps in Portal support, exit animations, and virtualization.

The good news: **while the reviews were being written, several of these issues were already identified and fixed in the codebase.** The concurrent fixes are documented in Section 3 below and should be subtracted from the remaining work.

---

## Phase 1 Fix Verification Summary

Both reviewers verified all Phase 1 fixes. Here is the consolidated verification status:

| Fix | Alex | Jordan | Status |
|-----|------|--------|--------|
| Diamond dependency glitch (microtask deferral) | Correct, timing semantics changed but correct | Correct, minor timing gap for imperative code | VERIFIED |
| DocumentFragment bug (marker comments) | Correct for common case, edge case with nested arrays noted | Correct, array-to-array and array-to-non-array transitions flagged | VERIFIED (with edge case) |
| ErrorBoundary tree-based resolution (_parentCtx) | Correct, async errors handled properly | Correct, well-implemented | VERIFIED |
| flush() re-entrant loop with 100-iteration guard | Not explicitly reverified | Correct, no regressions | VERIFIED |
| useMediaQuery memory leak cleanup | Correct, tied to component lifecycle | Correct, module-scope usage intentionally permanent | VERIFIED |
| useLocalStorage memory leak cleanup | Correct, tied to component lifecycle | Correct, same pattern | VERIFIED |
| Router Link '/' exact match | Correct for '/', prefix-matching edge case flagged | Correct, same edge case flagged | VERIFIED (with edge case) |
| Style diffing with _prevStyle | Not explicitly reverified | Correct, handles edge cases | VERIFIED |
| `<what-c>` custom element registration | Not explicitly reverified | Correct, display:contents in constructor | VERIFIED |
| flushSync() export | Not explicitly reverified | Correct, escape hatch works | VERIFIED |

**Conclusion:** All Phase 1 fixes are correct. No functional regressions were introduced. Both reviewers are satisfied with the implementations.

---

## Concurrent Fixes Already Applied

While Alex and Jordan were writing their Round 2 reviews, the following issues were independently identified and fixed in the codebase. These items appear in the reviews as open issues but are now resolved:

### 1. useContext Fixed to Walk _parentCtx Chain (P0 from Both Reviewers)

**What both reviewers found:** `useContext` in `hooks.js` walked the `componentStack` (runtime render stack) instead of the `_parentCtx` chain. This meant context lookups failed on re-renders, in effects, and in event handlers -- the exact same bug pattern as the ErrorBoundary issue from Round 1.

**What was fixed:** `useContext` now uses `getCurrentComponent()` and walks `ctx._parentCtx` to find the nearest provider, matching the `reportError` pattern. The code at `packages/core/src/hooks.js` lines 140-150 now reads:

```js
export function useContext(context) {
  let ctx = getCurrentComponent();
  while (ctx) {
    if (ctx._contextValues && ctx._contextValues.has(context)) {
      const val = ctx._contextValues.get(context);
      ...
    }
    ctx = ctx._parentCtx;
  }
  return context._defaultValue;
}
```

**Impact:** This was the single most critical remaining bug. Both reviewers called it P0. It is now resolved.

### 2. Portal Support Added to dom.js (P0 from Alex)

**What Alex found:** The `Portal` component in `helpers.js` returned a vnode with `tag: '__portal'`, but `dom.js` had no handler for `'__portal'`. The vnode would fall through to element creation, creating a literal `<__portal>` HTML element.

**What was fixed:** A `createPortal` handler was added to `dom.js`. The handler is invoked when `Component === '__portal'` or `vnode.tag === '__portal'`, rendering children into the specified container while maintaining the component context chain.

**Impact:** Portals now work. This unblocks modals, tooltips, toasts, and dropdown menus.

### 3. Suspense Boundary Effect Leak Fixed (P1 from Jordan)

**What Jordan found:** In `createSuspenseBoundary`, the `dispose` function returned by `effect()` was captured but never stored. When the Suspense boundary was removed from the DOM, the effect continued running.

**What was fixed:** A `boundaryCtx` is now created (matching the ErrorBoundary pattern) and `dispose` is pushed into `boundaryCtx.effects`. The code at `dom.js` lines 316-338 now creates a proper boundary context and stores the dispose function.

**Impact:** Suspense boundaries no longer leak effects on unmount.

### 4. Array-to-Array and Array-to-Non-Array Patching Fixed (P1 from Jordan)

**What Jordan found:** When `patchNode` received a `startMarker` (from a previous array render) and a new array vnode or a non-array vnode, the old markers and content between them would leak. There was no code to detect `_arrayEnd` and clean up the marker range.

**What was fixed:** A `cleanupArrayMarkers` helper function was added to `dom.js`. It walks the range between `startMarker` and `endMarker`, disposes each node, removes it from the DOM, and then removes the end marker. This function is called in the null/false/true branch and the text node branch when `domNode._arrayEnd` is detected.

**Impact:** Components that switch between returning arrays and non-arrays no longer leak DOM nodes.

### 5. Link Active State Improved with Segment-Boundary Matching (P2 from Both)

**What both reviewers found:** The `startsWith` check for non-root links could incorrectly match path prefixes (e.g., `/blog` matching `/blog-archive`). Both suggested using `currentPath === href || currentPath.startsWith(href + '/')`.

**What was fixed:** The Link component in `packages/router/src/index.js` now uses segment-boundary matching:

```js
const isActive = href === '/'
  ? currentPath === '/'
  : currentPath === href || currentPath.startsWith(href + '/');
```

**Impact:** Link active state is now correct for all path patterns, not just `/`.

### 6. createStore Action Proxy Now Includes Actions (P1 from Alex)

**What Alex found:** The proxy's `get` trap in `createStore` only checked `signals` and `computeds`, not `actions`. Calling `this.otherAction()` inside an action returned `undefined`.

**What was fixed:** The proxy's `get` trap in `packages/core/src/store.js` line 91 now includes `if (actions[prop]) return actions[prop];`.

**Impact:** Actions can now call other actions via `this.otherAction()`, which is a common pattern in state management.

### 7. FocusTrap Component Effect Scoped to Component Lifecycle (P2 from Jordan)

**What Jordan found:** The `FocusTrap` component created a standalone `effect()` that was not registered on the component context. When the component unmounted, the effect continued running.

**What was fixed:** The `FocusTrap` component now gets the current component context via `getCurrentComponent?.()` and pushes the `dispose` function into `ctx._cleanupCallbacks`.

**Impact:** FocusTrap effects are properly disposed when the component unmounts.

### 8. useId No Longer Wraps Constant in Unnecessary Signal (P2 from Jordan)

**What Jordan found:** `useId` wrapped a never-changing string in a `signal()` and returned `() => id()`, adding unnecessary overhead.

**What was fixed:** `useId` now returns a plain string directly: `return \`${prefix}-${++idCounter}\`;`

**Impact:** Eliminates unnecessary signal allocation for a constant value.

### 9. Spring Cleanup on Component Unmount (P2 from Jordan)

**What Jordan found:** The `spring()` function stored `rafId` but did not register cleanup with any component context. If a spring was created inside a component and the component unmounted while animating, the RAF loop continued running.

**What was fixed:** The spring function now checks for a component context and pushes `stop` into `ctx._cleanupCallbacks`.

**Impact:** Springs no longer waste CPU after component unmount.

### 10. Dead errorBoundaryStack Removed (P2 from Jordan)

**What Jordan found:** `components.js` still exported `errorBoundaryStack`, which was dead code after the Phase 1 fix moved to tree-based resolution.

**What was fixed:** The export was replaced with a comment: `// Legacy errorBoundaryStack removed -- tree-based resolution via _parentCtx._errorBoundary is now the only mechanism.`

**Impact:** Removes confusion about which error boundary mechanism is active.

---

## Remaining Issues -- Prioritized

After subtracting the concurrent fixes, these issues from both reviews still need attention. Items are grouped by priority.

### P0 -- Must Fix Before Any Production Use

| # | Issue | Found By | Module | Description |
|---|-------|----------|--------|-------------|
| 1 | **CSRF protection for server actions** | Jordan | actions.js | `callAction` sends POST to `/__what_action` with no CSRF token. Any malicious website can execute server-side actions on behalf of authenticated users. This is a security vulnerability. |
| 2 | **SWR cache is not reactive across components** | Jordan | data.js | The `cache` Map stores raw values. Two components using `useSWR` with the same key create independent `data` signals. Mutating the cache via one component does not update the other. `invalidateQueries` deletes from the Map but does not notify subscribers. This is a fundamental design flaw. |
| 3 | **Server action input validation** | Jordan | actions.js | `handleActionRequest` passes client-provided `args` directly to the action function with no validation, sanitization, or type checking. Combined with predictable action IDs (`action_1`, `action_2`), an attacker can call any registered action with arbitrary arguments. |

### P1 -- Must Fix Before Production

| # | Issue | Found By | Module | Description |
|---|-------|----------|--------|-------------|
| 4 | **Form performance: single-signal for all values** | Jordan | form.js | `useForm` uses a single `values` signal. Every `setValue` triggers every component that reads `values()` to re-render. For a 20-field form, every keystroke causes full-form re-render. Jordan recommends per-field signals. |
| 5 | **No AbortController in data fetching** | Jordan | data.js, hooks.js | Neither `useSWR`, `useQuery`, nor `useFetch` creates an AbortController. Orphaned HTTP requests continue running after component unmount, wasting bandwidth and potentially causing state inconsistencies. |
| 6 | **createResource does not integrate with component lifecycle** | Alex | hooks.js | `createResource` uses a bare `async` function with no lifecycle integration. Signal writes after component unmount trigger effects on disposed DOM. No AbortController for cancellation. |
| 7 | **Server action error messages leak server details** | Jordan | actions.js | `error.message` in the 500 response could contain database errors, file paths, or sensitive server information. Production responses should return generic messages. |
| 8 | **Server action has no timeout** | Jordan | actions.js | If the server action never responds, the `fetch()` hangs indefinitely (browser default ~300s). Need AbortController with configurable timeout. |
| 9 | **No automatic optimistic rollback on error** | Jordan | actions.js | `useOptimistic` requires manual `rollback()` on failure. Next.js automatically rolls back optimistic updates when server actions throw. |
| 10 | **Unbounded cache growth in data.js** | Jordan | data.js | The `cache` Map grows indefinitely. `useSWR` adds entries on every fetch but never removes them. `useQuery`'s `cacheTime` cleanup uses `setTimeout` not tied to component lifecycle. |
| 11 | **SWR deduplication tracks in-flight requests, not last fetch** | Jordan | data.js | If a revalidation completes and a new one starts within `dedupingInterval`, the deduplication check will not find the completed request and starts a new fetch, defeating the purpose. |
| 12 | **`memo` conflicts with signal-based reactivity** | Alex | components.js | `memo` caches `prevResult` (vnode tree). If the memoized component reads global signals internally, `memo` short-circuits and returns stale vnodes with old signal values baked in. `memo` is fundamentally at odds with signal-based reactivity for components that read non-prop signals. |
| 13 | **`For` does not provide fine-grained reactivity** | Alex | components.js | `For` evaluates `each` once and maps it. The parent's effect is the reactive boundary, not `For` itself. Small lists are fine but defeats the purpose for large lists. This matches Jordan's deferred item from Round 1. |
| 14 | **`Show` does not provide fine-grained reactivity** | Alex | components.js | Same issue as `For`. `Show` evaluates `when` once. There is no reactive scope specific to `Show`. It is equivalent to a ternary. |
| 15 | **`useSWR` returns inconsistent signal types** | Alex | data.js | `isLoading` is returned as a raw computed signal, while `data`, `error`, and `isValidating` are wrapped in `() =>` closures. Inconsistent API surface. |

### P2 -- Should Fix Soon

| # | Issue | Found By | Module | Description |
|---|-------|----------|--------|-------------|
| 16 | **Silent error swallowing in reactive.js** | Alex | reactive.js | `reactive.js` line 114 and line 135 still have empty catch blocks for cleanup errors. `helpers.js` also has empty catches for localStorage operations. Phase 1 only fixed `dom.js`. |
| 17 | **No AnimatePresence / exit animations** | Alex | animation.js | No way to delay DOM removal for exit animations. The reconciler immediately removes nodes via `disposeTree` + `removeChild`. Critical for polished UIs (modals, toasts, dropdowns, page transitions). |
| 18 | **Effect timing model undocumented** | Alex | docs | No documentation about when effects fire (microtask after signal write), how `batch` affects timing, what `flushSync` does, how `useEffect` timing differs from React. The Phase 1 microtask change is a semantic shift that needs explanation. |
| 19 | **Computed infinite loop gives vague error** | Alex | reactive.js | The 100-iteration guard in `flush()` warns "Possible infinite effect loop" without identifying which signal or effect is looping. Debugging this is painful for junior developers. |
| 20 | **useRovingTabIndex takes static itemCount** | Jordan | a11y.js | `itemCount` is captured at call time. If the list shrinks, the modular arithmetic wraps to out-of-bounds indices. Should accept a signal or getter. |
| 21 | **No SSR hydration mismatch detection** | Alex | server | If server-rendered HTML differs from client render (date formatting, user-agent code), the client silently produces wrong output. React warns about hydration mismatches. |
| 22 | **No error recovery/retry UI in data fetching** | Alex | data.js | `useSWR` and `useQuery` handle errors by setting a signal, but there is no integration with `ErrorBoundary`. Failed queries sit in the error signal -- the boundary never catches them. |
| 23 | **useForm register returns stale value** | Alex | form.js | `register(name)` reads `values()[name]` once. If someone caches `const emailProps = register('email')`, the `value` is stale in subsequent renders. |
| 24 | **No useFieldArray for dynamic form rows** | Alex, Jordan | form.js | Both RHF and Formik provide field arrays. What has no equivalent. |
| 25 | **No useClickOutside hook** | Alex | helpers.js | Needed for every dropdown, popover, and modal. Common enough to be framework-provided. |
| 26 | **Euler integration in spring physics** | Jordan | animation.js | First-order Euler integration is least stable for stiff springs. Verlet or RK4 would be more stable for the same computational cost. |
| 27 | **No multi-value springs** | Jordan | animation.js | `spring()` only supports scalar values. UI animations typically need `{ x, y, scale, opacity }`. |
| 28 | **Passive touch listeners prevent scroll prevention** | Jordan | animation.js | `touchstart` uses `{ passive: true }`, preventing `e.preventDefault()` in drag handlers. Need a `preventDefault` option. |
| 29 | **useScheduledEffect creates new closures on every effect run** | Jordan | scheduler.js | Each signal change creates a new `scheduleRead` closure. The `raf()` debounce helper exists but is not used. |
| 30 | **Server action IDs are predictable** | Jordan | actions.js | Plain incremental IDs (`action_1`, `action_2`) are trivially enumerable. Should be encrypted or randomized. |
| 31 | **useEffect cleanup timing differs from React** | Alex | hooks.js | `useEffect` cleanup runs on microtask (before paint), not after paint like React. Multiple effects have no ordering guarantee if one writes to a signal. |
| 32 | **No route-level data loading** | Alex | router | No `loader` function that runs before the component mounts. Developers must use `useSWR` inside each route component, leading to waterfall fetches. |
| 33 | **No type safety in routing** | Alex | router | Route params are untyped JavaScript objects. Modern routers (TanStack Router, React Router) provide typed params. |
| 34 | **No virtualization** | Alex | core | Any app with long lists (chat, search results, data tables) needs virtualization. No `<VirtualList>` or `useVirtualizer`. |
| 35 | **formState.errors() is verbose** | Alex | form.js | Requires calling the signal function: `formState.errors().email?.message` vs RHF's `errors.email?.message`. Could use getters instead. |
| 36 | **Full-form validation on single-field onChange** | Jordan | form.js | When `mode === 'onChange'`, the resolver runs validation for ALL fields on every keystroke, not just the changed field. Expensive for Zod/Yup schemas with async validators. |
| 37 | **No SWR global configuration** | Jordan | data.js | No `SWRConfig` provider for default fetcher, default options. |
| 38 | **No conditional/dependent fetching in useSWR** | Jordan | data.js | `useSWR(null, fetcher)` should skip fetching. Currently it always fetches. |
| 39 | **Redundant wrapper.style.display in createComponent** | Jordan | dom.js | `createComponent` sets `wrapper.style.display = 'contents'` even though the custom element constructor already sets it. Harmless but unnecessary. |
| 40 | **_prevStyle not cleared in removeProp** | Jordan | dom.js | When style prop is removed entirely, `removeProp` clears `el.style.cssText` but does not clear `el._prevStyle`. Minor memory retention. |
| 41 | **Inconsistent _ prefix convention** | Jordan | core | `_parentCtx`, `_errorBoundary`, `_arrayEnd` use `_` prefix. `hooks`, `effects`, `cleanups`, `mounted`, `disposed` do not. Unclear public API boundary. |
| 42 | **No test coverage for Phase 1 fixes** | Jordan | core | No unit tests for microtask deferral, marker comment patching, or `_parentCtx` chain traversal. High regression risk. |
| 43 | **No form context for nested components** | Jordan | form.js | RHF has `FormProvider` + `useFormContext`. What does not propagate form state through context. |

---

## Areas of Agreement

Both reviewers independently converge on the following points. These carry the highest signal.

### 1. useContext Was the Most Critical Remaining Bug

Both Alex and Jordan independently discovered the same `useContext` bug (using `componentStack` instead of `_parentCtx`), both classified it as P0, and both proposed the identical fix: walk `_parentCtx` chain instead of `componentStack`, matching the `reportError` pattern. **This fix has been applied.**

### 2. Phase 1 Fixes Are Correct

Both reviewers verified every Phase 1 fix and confirmed they are correctly implemented with no functional regressions. The microtask deferral for effects is the right approach. The marker comment pattern for array patching matches Svelte's strategy. The `_parentCtx` chain for error boundaries is the industry-standard approach.

### 3. Link Active State Needs Segment-Boundary Matching

Both reviewers independently identified the same edge case: `startsWith('/blog')` incorrectly matches `/blog-archive`. Both proposed the identical fix: `currentPath === href || currentPath.startsWith(href + '/')`. **This fix has been applied.**

### 4. Portal Was Non-Functional

Alex discovered Portal returns a vnode with an unhandled tag. Jordan did not explicitly flag this (it was outside his scope), but the issue is real. **This fix has been applied.**

### 5. The Framework's Strength Remains Feature Density in a Small Package

Both reviewers continue to praise the breadth of built-in capabilities (forms, data fetching, a11y, animations, gestures, islands) in ~2000 lines of readable code. Alex: "genuinely remarkable." Jordan: "more than React, Solid, or Svelte ship out of the box."

### 6. For and Show Components Do Not Provide SolidJS-Level Reactivity

Both reviewers (Alex explicitly, Jordan from Round 1) agree that `For` and `Show` are syntactic sugar over ternaries and `.map()`, not fine-grained reactive boundaries. The API shape implies SolidJS-level performance that the implementation does not deliver.

### 7. Documentation Gaps Persist

Both reviewers flag that the timing model (when effects fire), the `() =>` wrapper pattern, and module-scope hook behavior remain undocumented despite being critical to correct usage.

---

## Areas of Disagreement or Different Perspectives

### 1. Severity of Server Action Security Issues

**Jordan (P0):** CSRF protection is a must-fix before any production use. No input validation on server handlers is a critical security vulnerability.

**Alex (not addressed):** Alex did not review `actions.js` in depth. His review focused on client-side architecture and application-building scenarios.

**Sam's assessment:** Jordan is right that CSRF and input validation are security vulnerabilities that need immediate attention. However, server actions are likely not the first thing most early adopters will use. I would classify CSRF as P0 and input validation as P1, noting that both should be addressed before any production deployment that uses server actions.

### 2. Whether `memo` Is Fundamentally Broken or Just Needs Documentation

**Alex:** Identified the conflict between `memo` and global signal reads as a correctness bug. Recommended either fixing `memo` to still allow the component's own effects to re-run, or documenting that `memo` should not be used with components that read global signals.

**Jordan (Round 1):** Classified the `memo` stale vnode problem as P1 and recommended that `memo` should work at the component effect level rather than caching vnode trees.

**Sam's assessment:** These are complementary perspectives. Alex sees the signal-interaction problem (global signals are missed). Jordan sees the stale vnode problem (cached vnodes reference disposed DOM). Both are real. The fundamental issue is that `memo` as a concept is at odds with the signals-first identity Morgan chose. If signals are the primary state mechanism, components frequently read non-prop signals, making `memo` dangerous. Morgan needs to decide whether `memo` should be kept, redesigned, or deprecated with clear documentation about when it is safe to use.

### 3. Depth of Data Fetching Module Critique

**Jordan:** Deep-dived into `data.js` and found fundamental flaws: non-reactive cache, race conditions in deduplication, unbounded cache growth, no AbortController. Graded it C+.

**Alex:** Used `useSWR` and `useQuery` in his application walkthrough and found them adequate for basic use. His concerns were more about missing features (no `useWebSocket`, no virtualization for large lists) than correctness.

**Sam's assessment:** Jordan's critique is more technically rigorous. The shared cache being non-reactive is a genuine design flaw that will surface as soon as two components share a cache key. Alex's perspective reflects the "works for simple cases" reality -- a solo developer building a simple app might never hit the shared-cache bug. Both perspectives are valid for their respective audiences.

### 4. Whether the Hybrid React/Solid Model Is a Strength or Weakness

**Alex:** Continues to find the signal/hook duality confusing but acknowledges that the React hooks were his on-ramp. Updated assessment is more nuanced: he understands that `() =>` wrappers are unnecessary (both wrapped and unwrapped signal reads work the same way) but finds the inconsistency in demos confusing.

**Jordan:** Accepts the re-run model as the framework's identity (per Morgan's decision) and evaluates it on its own terms. His concerns are about the practical implications (whole-component re-rendering, `For`/`Show` not being fine-grained) rather than the identity itself.

**Sam's assessment:** The tension has softened since Round 1. Morgan's identity decision (signals-first, hooks as compatibility layer) addresses the "which to use" confusion. The remaining issue is not the duality itself but the documentation and demo code not reflecting the chosen identity. The `() =>` wrapper confusion (it works but is unnecessary) is a documentation problem.

### 5. Grading of the Animation Module

**Jordan:** Graded animation.js B. Concerned about Euler integration stability, missing multi-value springs, missing cleanup on unmount (now fixed), no AnimatePresence.

**Alex:** Found `useGesture` and `spring` useful in his Kanban board walkthrough. His concerns were about missing higher-level abstractions (drag-and-drop library, AnimatePresence) rather than the physics implementation.

**Sam's assessment:** Jordan's stability concern about Euler integration is technically valid but unlikely to manifest in typical UI animations. The stiffness/damping values that cause numerical instability are extreme and not commonly used. AnimatePresence is the bigger gap from both perspectives.

---

## Updated Scores

Taking into account both the Phase 1 fixes (verified correct) and the concurrent fixes applied during the review period, here are updated scores.

### What Changed Since Round 1

| Category | Round 1 State | Round 2 State (Post-Concurrent Fixes) |
|----------|---------------|---------------------------------------|
| Core reactivity | Diamond glitch, synchronous effects | Glitch-free, microtask-deferred, flush loop correct |
| Error boundaries | Broken for async errors | Tree-based, works everywhere |
| Memory leaks | useMediaQuery, useLocalStorage, spring, FocusTrap | All fixed with component lifecycle cleanup |
| DOM reconciliation | DocumentFragment crash, array patching broken | Marker comments, array transitions handled |
| Context | Broken on re-renders (componentStack) | Fixed (_parentCtx chain) |
| Portal | Non-functional (unhandled tag) | Functional (createPortal handler) |
| Suspense | Effect leak on unmount | Dispose stored on boundary context |
| Link active state | '/' always active, prefix-matching bugs | Correct for all paths (segment-boundary) |
| Store actions | this.otherAction() undefined | Actions included in proxy |
| a11y useId | Unnecessary signal wrapping | Returns plain string |

### Score Updates

**Alex's Scores:**
- Round 1: 7/10 personal, 4/10 production
- Round 2 (in review): 7.5/10 personal, 5/10 production
- **Post-concurrent-fixes: 8/10 personal, 5.5/10 production**

Rationale: The useContext fix and Portal support were his two biggest remaining blockers. Both are now resolved. The production score remains held back by: no AnimatePresence, server action security concerns (which he did not review but should be aware of), form performance, and missing tests.

**Jordan's Scores:**
- Round 1: 6.5/10 production readiness, 8/10 architecture/vision
- Round 2 (in review): 7.5/10 production readiness, 8.5/10 architecture/vision
- **Post-concurrent-fixes: 8/10 production readiness, 8.5/10 architecture/vision**

Rationale: Jordan's P0 useContext bug is fixed. His P1 Suspense leak and P2 items (FocusTrap, useId, spring cleanup, dead errorBoundaryStack) are fixed. The array patching edge cases he identified are fixed. His remaining P0 items are CSRF (server actions) and the SWR cache reactivity. His production readiness score is held back by those two items and the form performance issue.

**Sam's Combined Assessment:**
- **Core framework (reactive, dom, hooks, components): 8.5/10** -- The core is now correct and well-hardened. No known correctness bugs remain in the core modules.
- **Data fetching (data.js): 6/10** -- Non-reactive cache is a fundamental flaw. No AbortController. Usable for single-component scenarios.
- **Form system (form.js): 6.5/10** -- Works for simple forms. Performance cliff for complex forms. Missing field arrays and form context.
- **Server actions (actions.js): 4/10** -- Security vulnerabilities prevent any production use. Clean API design undermined by missing CSRF and input validation.
- **Animation (animation.js): 7.5/10** -- Spring cleanup now works. Missing AnimatePresence and multi-value springs. Euler integration is adequate for typical use.
- **Accessibility (a11y.js): 8.5/10** -- Best-in-class for a framework-included package. FocusTrap and useId fixes applied. useRovingTabIndex dynamic count still needed.
- **Scheduler (scheduler.js): 8/10** -- Solid implementation. Minor closure retention issue.
- **Router: 8/10** -- Active state fully correct. Missing route-level data loading and typed params.
- **Islands: 9/10** -- Remains best-in-class. No new issues found.

**Overall: 7.5/10 for production readiness (up from ~6 in Round 1).** Fix CSRF, make the SWR cache reactive, and address form performance to reach 8.5/10.

---

## Recommendations for Morgan

### Immediate (This Week)

1. **Add CSRF protection to server actions.** This is the only remaining P0 security issue. Generate a CSRF token cookie server-side, include it in client request headers, validate on the server. Without this, any production deployment using server actions is vulnerable.

2. **Add input validation hooks to `handleActionRequest`.** At minimum, allow action registration to include a validation function. In the short term, sanitize error messages to not leak server details.

3. **Make the SWR cache reactive.** Use a shared signal per cache key instead of a plain Map value. When `mutate(key, newData)` is called, all components using that key should see the update. This is a design change, not a bug fix -- take the time to do it right.

### Near-Term (Next 2 Weeks)

4. **Add AbortController to `useSWR`, `useQuery`, and `createResource`.** This is straightforward and prevents orphaned HTTP requests.

5. **Switch `useForm` to per-field signals.** This is a breaking change to internal implementation (not API surface) that prevents the performance cliff for complex forms.

6. **Document the effect timing model.** Developers need to know: effects run on microtask after signal write; `batch()` groups updates; `flushSync()` forces synchronous execution; `useEffect` fires before paint (unlike React's after-paint).

7. **Add tests for Phase 1 and concurrent fixes.** The fixes are correct but untested. Regression risk is high. Priority areas: microtask deferral, marker comment patching, `_parentCtx` chain traversal, array-to-array transitions, Portal rendering.

### Medium-Term (Next Month)

8. **Design an AnimatePresence solution.** Exit animations are needed for every polished UI. This requires a fundamentally different approach to DOM removal -- delaying `disposeTree` + `removeChild` until an animation completes. Consider a `<Transition>` component that wraps children and manages enter/exit lifecycle.

9. **Decide on `memo`'s future.** Options: (a) deprecate it with clear docs about why it conflicts with signals, (b) redesign it to work at the component effect level (prevent re-render but maintain signal subscriptions), or (c) keep it as-is with prominent warnings about the global signal interaction.

10. **Address `For` and `Show` reactivity expectations.** Options: (a) make them truly fine-grained (Solid-style `mapArray` inside `For`, own reactive scope inside `Show`), (b) document clearly that they are syntactic sugar and do not provide fine-grained updates, or (c) remove them in favor of direct ternaries and `.map()` with the reconciler's keyed diffing.

---

*End of Round 2 synthesis. All issues cross-referenced between both reviews. Concurrent fixes verified against the current codebase. Source file locations verified as of 2026-02-13.*
