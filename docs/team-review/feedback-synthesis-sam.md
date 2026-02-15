# Feedback Synthesis: What Framework Team Review
**Prepared by:** Sam (Feedback Receiver)
**Date:** 2026-02-13
**Input:** Junior Developer Review (Alex), Senior Developer Review (Jordan)
**Audience:** Framework Designer

---

## Section 1: Executive Summary

The team's overall sentiment toward What Framework is **cautiously optimistic**. Both reviewers recognize the framework as a genuinely impressive technical achievement for its size -- the ~180-line reactive system, the built-in islands architecture, and the breadth of features packed into a sub-4kB core all drew explicit praise. However, both reviewers independently identified the same structural problems: memory leaks in utility hooks, a reactivity system with glitch vulnerabilities, a confusing proliferation of overlapping APIs, and a gap between the framework's documentation claims and its actual implementation state. Alex rated the framework 7/10 for personal use and 4/10 for production team use. Jordan rated it 6.5/10 for production readiness and 8/10 for architecture and vision. The consensus is clear: the foundation is strong, but the framework is at a "solid prototype" stage, not production-ready. The islands architecture is the standout differentiator the team wants preserved and expanded. The biggest risk to adoption is not technical -- it is the overwhelming number of ways to accomplish the same task, which paralyzes new developers. The framework needs to pick a lane on several key API decisions before it can be recommended for real-world use.

---

## Section 2: Consensus Points

These are issues or praise points where **both** developers independently converged. These carry the highest signal.

### 2.1 Memory Leaks in `useMediaQuery` and `useLocalStorage`

| | Detail |
|---|---|
| **Issue** | Both hooks add global event listeners (`matchMedia` change, `window` storage) that are never removed when the component unmounts. The `useLocalStorage` effect is also never disposed. |
| **Junior (Alex)** | Identified the missing cleanup in both hooks. Called them "memory leaks" and listed them as must-fix blocking issues. |
| **Senior (Jordan)** | Confirmed the leak, traced the reference chain (listener -> signal -> subscribers), and classified it as a genuine memory leak pattern. |
| **Impact** | **Critical** -- Any component using these hooks leaks memory on every mount/unmount cycle. |

### 2.2 Too Many Overlapping APIs

| | Detail |
|---|---|
| **Issue** | Multiple ways to do the same thing: `signal` vs `useState` vs `useSignal`; `useSWR` vs `useQuery` vs `useFetch` vs `createResource`; `show()` vs `<Show>`; `each()` vs `<For>`. No guidance on which to choose. |
| **Junior (Alex)** | First impression was "overwhelming." Explicitly requested a "Which API?" decision tree. Said "the framework needs to be more opinionated." |
| **Senior (Jordan)** | Recommended removing `show()` entirely (it is just a ternary). Recommended removing `NavLink` (it is just `Link` re-exported). Suggested simplifying `storeComputed`. |
| **Impact** | **High** -- This is the #1 adoption barrier for new developers and creates inconsistent code across teams. |

### 2.3 The `show()` Helper is Not Reactive

| | Detail |
|---|---|
| **Issue** | `show(condition, vnode, fallback)` is a plain ternary that evaluates `condition` once at call time. It is not reactive. Using it with signals only works because the parent component re-renders. |
| **Junior (Alex)** | Found the inconsistent usage patterns in demos (sometimes plain value, sometimes function wrapper). Called it "a potential source of subtle bugs" and "confusing." |
| **Senior (Jordan)** | Recommended removing `show()` entirely in favor of the `<Show>` component. |
| **Impact** | **High** -- The API implies reactivity it does not provide, leading to bugs. |

### 2.4 Silent Error Swallowing in Cleanup

| | Detail |
|---|---|
| **Issue** | Multiple places in `reactive.js` and `dom.js` catch errors in cleanup functions and do nothing: `try { e._cleanup(); } catch (err) { /* cleanup error */ }`. |
| **Junior (Alex)** | "As a junior developer, silent error swallowing is one of the most frustrating things to debug." Requested at minimum `console.warn` in dev mode. |
| **Senior (Jordan)** | Called it an anti-pattern. Recommended a configurable error handler at minimum. |
| **Impact** | **Medium** -- Does not cause incorrect behavior but makes debugging extremely difficult. |

### 2.5 The `<what-c>` Wrapper Has Tradeoffs

| | Detail |
|---|---|
| **Issue** | Every component renders inside a `<what-c style="display:contents">` custom element (or `<g>` for SVG). This adds extra DOM nodes, can break CSS selectors (`:first-child`, `>`), and the SVG `<g>` wrapper is not invisible to layout. |
| **Junior (Alex)** | Worried about CSS selectors, `querySelector`, and third-party DOM libraries. Noted no documentation about this behavior. |
| **Senior (Jordan)** | Analyzed CSS implications (`:nth-child`, direct child selectors), the unregistered custom element flash-of-incorrect-layout issue, and the SVG `<g>` problem. Also noted performance implications for deep component trees. |
| **Impact** | **Medium** -- Mostly invisible but causes real problems in specific scenarios (SVG, CSS selectors, deep nesting). |

### 2.6 Islands Architecture is Best-in-Class

| | Detail |
|---|---|
| **Praise** | Six hydration modes, priority queue scheduling, shared state across islands, and the `boostIslandPriority` UX optimization. |
| **Junior (Alex)** | "Not an afterthought or a plugin -- it is built into the core." Called it a "significant advantage over React." |
| **Senior (Jordan)** | "The islands implementation is the framework's strongest differentiator." Rated it "more sophisticated than Astro's islands." |
| **Impact** | N/A -- This is the framework's **crown jewel**. Protect and expand it. |

### 2.7 No DevTools

| | Detail |
|---|---|
| **Issue** | No browser extension, no signal graph visualization, no component tree inspector. |
| **Junior (Alex)** | Listed DevTools as a must-have on the wishlist. "Even a simple browser extension... would be transformative for debugging." |
| **Senior (Jordan)** | Listed "DevTools extension (signal inspection, component tree, performance profiling)" as a feature to add. |
| **Impact** | **High** -- Critical for developer adoption and debugging experience. |

### 2.8 No Real TypeScript Support

| | Detail |
|---|---|
| **Issue** | The README claims "Full type definitions included" but the `.d.ts` files are stubs. No TypeScript guide exists. |
| **Junior (Alex)** | "The README mentions 'Full type definitions included' but there is no documentation about how to use TypeScript." |
| **Senior (Jordan)** | "The framework has `.d.ts` stub files but no real type definitions. For a framework that wants to compete with React, full TypeScript support is table stakes." |
| **Impact** | **High** -- TypeScript is a baseline expectation for modern frameworks. The README claim is misleading. |

### 2.9 The Reactive System is Elegant and Readable

| | Detail |
|---|---|
| **Praise** | Both reviewers praised the ~180-line reactive system for its clarity, correctness of the core patterns, and the bidirectional dependency tracking. |
| **Junior (Alex)** | "I can actually read and understand the entire reactivity engine." Called signals-as-functions "brilliant." |
| **Senior (Jordan)** | "The cleanup mechanism is sound." Validated the bidirectional tracking as the standard approach used by SolidJS, Vue 3, and Preact Signals. |
| **Impact** | N/A -- Core strength to preserve. |

### 2.10 Demo Code Uses `h()` Instead of JSX

| | Detail |
|---|---|
| **Issue** | All demo files use raw `h()` calls despite JSX being "recommended." The README uses signals, but demos use `useState`. Mixed signals about the intended authoring style. |
| **Junior (Alex)** | "The demo code is written in h() instead of JSX. This is the wrong foot to start on when targeting React developers." |
| **Senior (Jordan)** | "A proper docs site with searchable API reference, migration guides... would significantly improve adoption." (Implied -- the demos are insufficient documentation.) |
| **Impact** | **Medium** -- First impressions matter for adoption. The demos undermine the framework's pitch to React developers. |

---

## Section 3: Critical Bugs (Shipping Blockers)

### Bug 1: `patchNode` Returns Empty `DocumentFragment`

| | Detail |
|---|---|
| **File** | `packages/core/src/dom.js`, lines 510-519 |
| **Code** | When an array VNode replaces a DOM node, a `DocumentFragment` is created, children are appended, the fragment replaces the old node, and the fragment is returned. But `DocumentFragment` empties itself when appended to the DOM. The returned reference is invalid. |
| **Found by** | Jordan |
| **Severity** | **P0 -- Shipping Blocker** |
| **Impact** | Subsequent reconciliation fails because the returned node reference points to an empty fragment. Any component that returns an array of elements (e.g., a `Fragment`) could trigger this. |
| **Suggested Fix** | Track the inserted children individually. Return the first child or a reference to the inserted range, not the fragment. Consider a sentinel/marker approach similar to SolidJS. |

### Bug 2: `ErrorBoundary` Stack Cannot Catch Async Errors

| | Detail |
|---|---|
| **File** | `packages/core/src/dom.js`, lines 242-251; `packages/core/src/components.js`, lines 146-153 |
| **Code** | `errorBoundaryStack.push()` and `.pop()` happen inside synchronous effect execution. When errors occur asynchronously (e.g., in `useEffect`, promises), the stack is empty. `reportError` finds no boundary and returns `false`. |
| **Found by** | Jordan |
| **Severity** | **P0 -- Shipping Blocker** |
| **Impact** | Async errors in components are completely unhandled by ErrorBoundary. This defeats the purpose of error boundaries. |
| **Suggested Fix** | Associate error boundaries with component contexts in the tree rather than using a runtime stack. Walk the component parent chain to find the nearest boundary, similar to React's fiber-based approach. |

### Bug 3: Diamond Dependency Glitch in Computed Values

| | Detail |
|---|---|
| **File** | `packages/core/src/reactive.js`, lines 44-72 (computed), lines 145-161 (notify) |
| **Code** | In a diamond dependency graph (A -> B, A -> C, B+C -> D), when A changes, D can observe an inconsistent state where B has updated but C has not. Outside of `batch()`, effects run synchronously during notification. |
| **Found by** | Jordan |
| **Severity** | **P0 -- Shipping Blocker** |
| **Impact** | Any non-trivial signal graph can produce glitched intermediate states. This is the most fundamental correctness issue in the reactivity system. |
| **Suggested Fix** | Implement push-pull propagation (like Preact Signals v2) or topological sorting (like SolidJS). Alternatively, defer all effects outside of batch to a microtask. |

### Bug 4: `flush()` Drops Re-entrant Effects

| | Detail |
|---|---|
| **File** | `packages/core/src/reactive.js`, lines 163-169 |
| **Code** | `flush()` takes a snapshot of `pendingEffects` and clears the set. If effects in the flush queue write to signals, the new pending effects are added to the already-cleared set. These effects do not run until the next signal write. |
| **Found by** | Jordan |
| **Severity** | **P1 -- High** |
| **Impact** | Intermediate states can be missed. Effects that depend on effects can behave unpredictably. |
| **Suggested Fix** | Add a loop in `flush()` that continues until `pendingEffects` is empty. |

### Bug 5: `memo` Returns Stale VNodes

| | Detail |
|---|---|
| **File** | `packages/core/src/components.js`, lines 14-29 |
| **Code** | `memo` stores `prevResult` in a closure. Since components run inside reactive effects, the memo check returns VNodes from a previous render that may reference disposed DOM nodes. The reconciler then tries to patch against nodes that no longer exist. |
| **Found by** | Jordan |
| **Severity** | **P1 -- High** |
| **Impact** | Memoized components can cause DOM reconciliation failures when the previous render's DOM has been disposed. |
| **Suggested Fix** | The memo comparator should work at the component level (preventing re-render) rather than returning stale VNode trees. |

### Bug 6: Router `Link` Active State Bug

| | Detail |
|---|---|
| **File** | `packages/router/src/index.js` |
| **Code** | `const isActive = currentPath.startsWith(href);` -- The `/` route is "active" for every page since every path starts with `/`. The home link always has the `active` class. |
| **Found by** | Alex |
| **Severity** | **P1 -- High** |
| **Impact** | Navigation UI appears broken on every page. |
| **Suggested Fix** | Special-case `/` to require exact match, or use a more sophisticated path matching algorithm. |

---

## Section 4: Memory Leaks & Performance Issues

### Memory Leaks (ordered by severity)

| # | Leak | Location | Found By | Severity |
|---|------|----------|----------|----------|
| 1 | `useMediaQuery` event listener never removed | `packages/core/src/helpers.js:81-87` | Both | **P0** |
| 2 | `useLocalStorage` storage event listener + effect never disposed | `packages/core/src/helpers.js:91-118` | Both | **P0** |
| 3 | Global `cache` and `inFlightRequests` Maps grow indefinitely | `packages/core/src/data.js:8-9` | Jordan | **P1** |
| 4 | `debouncedCallbacks` module-level Map grows with dynamic keys | `packages/core/src/scheduler.js:130` | Jordan | **P2** |
| 5 | `prefetchedUrls` Set in router never cleared | `packages/router/src/index.js:407` | Jordan | **P2** |
| 6 | `scrollPositions` Map in router grows with every visited path | `packages/router/src/index.js:422` | Jordan | **P2** |
| 7 | `focusedElement` signal and global `focusin` listener never removed (intentional singleton) | `packages/core/src/a11y.js:10-15` | Jordan | **P3** |
| 8 | Standalone effects created outside components have no parent and must be manually disposed | `packages/core/src/reactive.js` | Jordan | **P2** |

### Performance Issues (ordered by severity)

| # | Issue | Location | Found By | Severity |
|---|-------|----------|----------|----------|
| 1 | `For` component recreates entire list on every parent render | `packages/core/src/components.js:167-179` | Jordan | **P0** |
| 2 | Components reading many signals re-render once per signal change outside `batch()` | `packages/core/src/dom.js` (component effect) | Jordan | **P1** |
| 3 | `reconcileChildren` calls `Array.from(parent.childNodes)` on every reconciliation | `packages/core/src/dom.js:555` | Jordan | **P1** |
| 4 | LIS remapping is O(n*m) instead of O(n) | `packages/core/src/dom.js:387-396` | Jordan | **P2** |
| 5 | `applyProps` uses identity comparison -- fails for style objects and callbacks, causing unnecessary DOM writes | `packages/core/src/dom.js:607-609` | Jordan | **P2** |
| 6 | `setProp` for `style` does not remove stale style properties | `packages/core/src/dom.js:649-658` | Jordan | **P1** |
| 7 | Computed chains cause synchronous cascading re-evaluation O(depth) per read | `packages/core/src/reactive.js` | Jordan | **P2** |
| 8 | No AbortController usage in data fetching -- abandoned HTTP requests continue running | `packages/core/src/hooks.js`, `data.js` | Jordan | **P2** |

---

## Section 5: API Design Issues

### APIs That Overlap (Too Many Ways to Do the Same Thing)

| Task | Available APIs | Recommended? |
|------|---------------|-------------|
| Component state | `signal()`, `useState()`, `useSignal()` | Docs say `useSignal` preferred, demos use `useState` |
| Derived values | `computed()`, `useMemo()`, `useComputed()`, `storeComputed()` | No clear recommendation |
| Side effects | `effect()`, `useEffect()` | `useEffect` inside components, `effect` outside |
| Conditional rendering | `show()`, `<Show>` | No recommendation; `show()` is misleadingly non-reactive |
| List rendering | `each()`, `<For>`, `array.map()` | No recommendation |
| Data fetching | `useFetch()`, `useSWR()`, `useQuery()`, `useInfiniteQuery()`, `createResource()` | No recommendation |
| Global state | `signal()` at module scope, `createStore()`, `atom()` | No recommendation |

**Recommendation from both reviewers:** Pick one recommended approach for each task. Document the others as alternatives for advanced use cases. A "Decision Tree" or "Which API?" guide is needed.

### APIs That Are Missing

| Missing API | Who Identified | Priority |
|-------------|---------------|----------|
| `createRoot` / ownership scopes for effects | Jordan | High |
| `useTransition` / concurrent mode primitives | Both | Medium |
| `useId` (consistent between SSR and client) | Jordan | Medium |
| `useFormContext` for nested form components | Alex | Medium |
| Reactive context (changing context value does not re-render consumers) | Jordan | High |
| Suspense integration with `useSWR`/`useQuery` (option exists but is not implemented) | Jordan | High |
| `renderHook` testing utility | Jordan | Low |
| CSS scoping solution | Both | Medium |
| Immutable update helpers (`produce()`) | Alex | Low |
| Middleware for SSR (Express/Hono/Fastify) | Alex | Medium |

### APIs That Are Confusing

| API | Issue | Who |
|-----|-------|-----|
| `storeComputed()` marker | Awkward API. Exists because the framework cannot distinguish actions from computeds. Jordan suggests using `get` keyword or `derived()`. | Jordan |
| `formState.errors().email?.message` | Verbose chain: calling a signal, then property access, then optional chaining. React Hook Form is simpler: `errors.email?.message`. | Alex |
| `register()` return value | Not documented what props it returns. Developers must read source code. | Alex |
| Style prop as function | `style: () => ({...})` -- the `setProp` function does not handle `typeof value === 'function'` for style. Works only because the component re-renders. Confusing. | Alex |
| `NavLink` component | Just re-exports `Link` (line 289-291 in router). Should be removed. | Jordan |

### APIs That Deviate from Norms Without Justification

| API | Deviation | Who |
|-----|-----------|-----|
| `_signal` brand | Uses duck-typing (`._signal = true`) instead of `Symbol`. Any function with `._signal = true` is treated as a signal. | Jordan |
| `_` prefix inconsistency | Some internal properties use `_` prefix (`_signal`, `_vnode`), others do not (`deps`, `lazy`, `disposed`). Unclear what is public API. | Jordan |
| `ErrorBoundary` / `Suspense` returning raw VNode objects | Return objects with magic tags (`__errorBoundary`, `__suspense`) instead of using `h()`. Implementation detail leaking into API. | Alex |
| `onClick` vs `onclick` | `h()` API uses camelCase `onClick`, but `html` tagged template examples use lowercase `onclick`. Should standardize. | Alex |
| `For` component eager evaluation | SolidJS `For` creates a reactive scope per item. What's `For` is just `list.map()` with extra steps -- defeats keyed reconciliation purpose. | Jordan |
| `Show` component eager evaluation | SolidJS `Show` creates its own reactive scope. What's `Show` subscribes the parent component to the condition. | Jordan |

---

## Section 6: DX (Developer Experience) Issues

### Learning Curve Concerns

| Issue | Who | Severity |
|-------|-----|----------|
| Two mental models (React hooks + SolidJS signals) coexist without clear guidance on when to use which | Alex | High |
| `count` vs `count()` -- knowing when to call signals as functions is a constant source of bugs | Alex | High |
| `() =>` function wrappers needed for reactive text and attributes in `h()` API are easy to forget | Alex | Medium |
| `untrack()` needed to prevent unwanted re-renders, but not mentioned in QUICKSTART.md | Alex | Medium |
| Demo code overwhelmingly uses `useState` while docs recommend `useSignal` -- mixed signals | Alex | Medium |

### Documentation Gaps

| Gap | Who | Priority |
|-----|-----|----------|
| No "Coming from React" migration guide | Alex | High |
| No "Which API?" decision tree | Alex | High |
| No error message troubleshooting section | Alex | Medium |
| No TypeScript usage guide | Both | High |
| No testing section in QUICKSTART.md | Alex | Medium |
| No documentation about the `<what-c>` wrapper behavior | Alex | Medium |
| No guidance on when keys are necessary for list rendering | Alex | Low |
| File-based routing extensively documented but not actually implemented | Alex | High |
| `useSWR` `suspense` option declared but not implemented -- misleading API surface | Jordan | Medium |

### Tooling Gaps

| Gap | Who | Priority |
|-----|-----|----------|
| No DevTools extension | Both | High |
| No HMR state preservation (Fast Refresh equivalent) | Both | High |
| No development-mode error overlay | Alex | Medium |
| No development-mode warnings (hooks called conditionally, signals read outside context, etc.) | Both | High |
| `act()` in testing is insufficient -- does not handle `requestAnimationFrame` or `requestIdleCallback` | Jordan | Medium |
| No `renderHook` testing utility | Jordan | Low |
| No `userEvent` simulation (only `fireEvent`) | Jordan | Low |

### Error Messages

| Issue | Who | Severity |
|-------|-----|----------|
| Errors in cleanup functions are silently swallowed | Both | High |
| Error messages are basic throws without component names or suggestions | Alex | Medium |
| No error overlay in development mode | Alex | Medium |
| `Component.name || 'Anonymous'` pattern exists but is not extended to all error paths | Jordan | Low |

### Debugging Experience

| Issue | Who | Severity |
|-------|-----|----------|
| No signal graph visualization | Both | High |
| No way to inspect which signals are subscribed to which effects | Both | High |
| `console.log` is the only debugging tool | Alex | High |
| Silent error swallowing makes tracking down bugs in cleanup functions nearly impossible | Both | High |

---

## Section 7: Architecture Concerns

### 7.1 The Hybrid React/Solid Component Model

**What it is:** Components run inside reactive effects (like Solid), but re-run entirely on updates and produce VNode trees that are reconciled (like React). `useState` returns plain values (React pattern), while `useSignal` returns signal accessors (Solid pattern).

**Alex's perspective:** The React hooks were the bridge that let him start using the framework immediately. But having two mental models (hooks vs signals) was confusing, and he was "never sure which paradigm I am supposed to be in."

**Jordan's perspective:** Identified the fundamental tradeoff: every `useState` state change triggers a full component re-render + reconciliation, unlike SolidJS where only the specific DOM operation that reads the signal updates. The model is "correct but means every state change triggers a full component re-render."

**Key tension:** The framework wants to be beginner-friendly (React hooks) and performant (SolidJS signals), but the two models create cognitive overhead and the reconciliation overhead negates some of the signal performance benefits.

### 7.2 The `<what-c>` Wrapper Approach

**Alex's concerns:** CSS selectors, querySelector, third-party DOM libraries, no documentation.

**Jordan's concerns:** CSS `:first-child`/`:nth-child`/`>` selectors, flash of incorrect layout from unregistered custom element, SVG `<g>` wrapper affecting transforms and bounding boxes, extra DOM depth in benchmarks.

**Key question:** Is the `<what-c>` wrapper the right reconciliation boundary strategy? Alternatives include marker comments (Solid), keyed root elements (Vue), or fragment-based ranges.

### 7.3 Synchronous Effect Execution

**What it is:** Outside of `batch()`, effects run synchronously during notification (`_runEffect(e)` in the notify loop). This causes the diamond dependency glitch problem and means components reading multiple signals can re-render multiple times per update.

**Jordan's analysis:** This is the "single most important change" needed. Recommends deferring effects to a microtask outside of batch, implementing push-pull propagation, or topological sorting.

**Trade-off:** Synchronous execution is simpler and more predictable for debugging but sacrifices correctness and performance.

### 7.4 The Reconciler Design (VNodes vs Live DOM)

**What it is:** Rather than maintaining a retained virtual DOM (React) or compiling away the VDOM (Svelte/Solid), What diffs new VNodes against the live DOM.

**Jordan's analysis:**
- **Pro:** No fiber tree overhead. Faster for small-to-medium apps.
- **Pro:** No parallel code paths for CSR and SSR.
- **Con:** Cannot time-slice. Cannot interrupt rendering. Cannot prioritize updates.
- **Con:** `Array.from(parent.childNodes)` on every reconciliation is expensive for large component trees.
- **Con:** The `For` component recreates the entire list on every render because there is no item-level reactivity.

**Key question:** Is the reconciler the long-term approach, or should the framework invest in compile-time optimizations (like the Babel plugin generating direct DOM operations for static structures)?

### 7.5 Module-Level Mutable State Prevents Concurrency

**What it is:** `currentEffect`, `componentStack`, `errorBoundaryStack` are module-level mutable variables. Two concurrent renders would corrupt each other's state.

**Jordan's assessment:** This makes concurrent rendering fundamentally impossible. If concurrency is a non-goal, document it explicitly. If it is a future goal, a context-based approach is needed.

### 7.6 Context Is Not Reactive

**What it is:** `useContext` reads the context value at render time by walking the component stack. Changing a context value does not re-render consumers.

**Jordan's assessment:** This is a fundamental limitation. Context values should be wrapped in signals so consumers automatically re-render.

---

## Section 8: What's Working Great

These are the framework's strengths that both reviewers want preserved and built upon.

1. **Islands Architecture** -- Six hydration modes with priority queue, shared state, and `boostIslandPriority`. More sophisticated than Astro. Both reviewers call it "best-in-class" and the framework's primary differentiator.

2. **The Reactive System's Simplicity** -- ~180 lines, readable, follows established patterns (SolidJS/Vue 3/Preact Signals). The bidirectional dependency tracking and lazy computed evaluation are correct and elegant.

3. **Signals-as-Functions API** -- `count()` to read, `count.set(5)` to write, `count.peek()` to read without tracking. Simpler than `.value` (Vue) or `[getter, setter]` tuple (Solid).

4. **Bundle Size** -- Genuinely tiny. The claims are believable and verifiable by counting source lines. A real competitive advantage.

5. **React-Compatible Hooks** -- `useState`, `useEffect`, `useMemo`, `useRef`, `useContext` are 1:1 with React. Zero learning curve for the basics.

6. **Built-in Form Handling** -- `useForm` with `simpleResolver`, `zodResolver`, `yupResolver`. Eliminates the need for `react-hook-form` or `formik`.

7. **Built-in Data Fetching** -- `useSWR`, `useQuery`, `useInfiniteQuery`. Eliminates the need for `swr` or `@tanstack/react-query`.

8. **Built-in Accessibility Utilities** -- Focus traps, ARIA helpers, roving tab index, screen reader announcements. More than most frameworks ship out of the box.

9. **The `html` Tagged Template** -- Genuine build-step-free development. Good escape hatch for prototyping and small projects.

10. **The LIS Reconciliation Algorithm** -- O(n log n) keyed reconciliation using Longest Increasing Subsequence. Proper CS algorithm matching Inferno/ivi quality.

11. **The Compiler Design** -- Two-way binding (`bind:value`), event modifiers (`onClick|preventDefault`), island directives (`client:idle`). All compile to standard `h()` calls -- no special runtime needed.

12. **Spring Animation Physics** -- Correct damped harmonic oscillator with `dt` cap. Well-implemented.

13. **The Scheduler's Read/Write Separation** -- Based on `fastdom` principles. Prevents layout thrashing.

---

## Section 9: Comparison to Competition

### Alex's Comparison (React-focused)

| Aspect | What Wins | React Wins |
|--------|-----------|------------|
| Bundle size | ~4kB vs ~40kB | |
| Built-in routing, forms, data fetching, islands | Yes | No (need separate packages) |
| Source code readability | Transparent 180-line system | Thousands of files, fibers, lanes |
| No-build-step option | h() / html tagged template | Not available |
| | | Ecosystem, DevTools, community |
| | | TypeScript DX, concurrent features |
| | | Error messages, learning resources |
| | | Hiring pool, production battle-testing |
| | | Server Components |

**Alex's verdict:** Would use What for personal projects and marketing sites. Would stick with React for production team apps.

### Jordan's Comparison (Multi-framework, detailed)

| Feature | What | React 18 | SolidJS 1.8 | Svelte 5 | Vue 3.4 |
|---------|------|----------|-------------|----------|---------|
| Bundle size | ~4kB | ~44kB | ~7kB | ~2kB (compiled) | ~33kB |
| Islands | Built-in (best) | Third-party | Not built-in | Not built-in | Not built-in |
| Concurrent rendering | No | Yes | No | No | No |
| TypeScript | Stubs only | Full | Full | Full | Full |
| Ecosystem | None | Massive | Growing | Growing | Large |
| DevTools | None | Yes | Yes | Yes | Yes |

**Jordan's verdict:** What Framework's niche is the multi-page app / islands architecture space where zero-JS-by-default is a genuine advantage. If the reactivity correctness issues and TypeScript support are addressed, it could find a real niche.

### Competitive Positioning Summary

**Where What can win:**
- Islands-first architecture (better than Astro because it is a full framework, not a meta-framework)
- Bundle size (only Svelte is smaller, but Svelte has no built-in islands)
- All-in-one solution (router + forms + data + SSR + islands in one package)
- Progressive enhancement story

**Where What cannot compete (yet):**
- Production readiness (correctness bugs, memory leaks)
- TypeScript support (table stakes, completely missing)
- Ecosystem (zero third-party packages, components, or tools)
- DevTools and debugging experience
- Community and learning resources

---

## Section 10: Questions for the Framework Designer

### Identity and Positioning

1. **Should the framework lean more React-like or Solid-like?** The hybrid model creates cognitive overhead. Both reviewers found the dual mental model confusing. Should `useState` be the primary API (familiar but slower) or `useSignal` (performant but unfamiliar)? Should one be deprecated?

2. **Is the `<what-c>` wrapper worth the tradeoff?** It simplifies reconciliation but adds DOM nodes, breaks CSS selectors, and causes SVG issues. Would marker comments or fragment ranges be better? Is the implementation cost of changing worth the DX improvement?

3. **Should overlapping APIs be consolidated?** Five data fetching hooks, three state hooks, two conditional rendering approaches, two list rendering approaches. Should the framework pick winners and deprecate the rest, or keep them all for flexibility?

4. **Priority: breadth of features vs depth of core?** The framework ships forms, animations, a11y, data fetching, routing, SSR, islands, testing -- all in ~4kB. Should the next phase deepen the core (fix glitches, add TypeScript, improve performance) or widen the surface (add more features)?

### Technical Decisions

5. **Is concurrent rendering a goal?** Module-level mutable state makes it impossible. If it is a non-goal, document it and accept the limitation. If it is a goal, significant refactoring is needed.

6. **Should the reconciler be replaced with compile-time optimizations?** The Babel plugin could generate direct DOM operations for static structures, eliminating reconciler overhead. This is the Svelte/Solid approach. Worth the compiler complexity?

7. **Should `show()` be removed?** Both reviewers flagged it as confusing and non-reactive. Jordan explicitly recommends removal. It is literally `condition ? a : b`.

8. **Should `For` be made item-reactive?** Currently it recreates the entire list on every render. SolidJS's `For` maintains per-item reactivity. This is a significant architecture decision.

9. **How should the glitch problem be solved?** Topological sort (SolidJS), push-pull propagation (Preact Signals v2), or microtask deferral? Each has different trade-offs for synchronous vs async behavior.

10. **Is file-based routing implemented or vaporware?** The docs describe it extensively. Alex could not find an implementation. Should it be built or removed from the docs?

### Adoption and Ecosystem

11. **Who is the target developer?** Alex (junior, React background) had different needs than Jordan (senior, multi-framework). The framework tries to serve both but may need to pick a primary audience.

12. **Should the demo be rewritten in JSX?** Both reviewers noted the demos use `h()` calls, which contradicts the "JSX recommended" positioning.

13. **What is the DevTools strategy?** Both reviewers flagged this as a critical gap. A simple signal inspector would be high impact.

14. **What is the TypeScript strategy?** Stubs exist. Real types are needed. Generate from JSDoc, or rewrite core in TypeScript?

---

## Section 11: Prioritized Issue List

| # | Issue | Category | Severity | Found By | Effort |
|---|-------|----------|----------|----------|--------|
| 1 | Diamond dependency glitch in reactivity system | Bug | P0 | Jordan | Large |
| 2 | `patchNode` returns empty `DocumentFragment` | Bug | P0 | Jordan | Small |
| 3 | `ErrorBoundary` stack cannot catch async errors | Bug | P0 | Jordan | Medium |
| 4 | `useMediaQuery` memory leak | Bug | P0 | Both | Small |
| 5 | `useLocalStorage` memory leak | Bug | P0 | Both | Small |
| 6 | `For` component recreates entire list (no item-level reactivity) | Perf | P0 | Jordan | Large |
| 7 | `flush()` drops re-entrant effects | Bug | P1 | Jordan | Small |
| 8 | `memo` returns stale VNodes referencing disposed DOM | Bug | P1 | Jordan | Medium |
| 9 | Router `Link` active state always matches `/` | Bug | P1 | Alex | Small |
| 10 | Style diffing does not remove stale style properties | Bug | P1 | Jordan | Small |
| 11 | No TypeScript support (only stubs) | DX | P1 | Both | Large |
| 12 | Too many overlapping APIs without guidance | API | P1 | Both | Medium |
| 13 | `show()` helper is not reactive -- misleading API | API | P1 | Both | Small |
| 14 | Context values are not reactive | Bug | P1 | Jordan | Medium |
| 15 | No DevTools extension | DX | P1 | Both | Large |
| 16 | No development-mode warnings | DX | P1 | Both | Medium |
| 17 | `reconcileChildren` allocates array on every call | Perf | P1 | Jordan | Small |
| 18 | Components re-render per signal outside `batch()` | Perf | P1 | Jordan | Large |
| 19 | Global data caches grow unbounded | Perf | P1 | Jordan | Medium |
| 20 | `useSWR` suspense option declared but not implemented | Bug | P1 | Jordan | Medium |
| 21 | No AbortController in data fetching hooks | Perf | P2 | Jordan | Medium |
| 22 | Demo code uses `h()` instead of JSX | DX | P2 | Both | Medium |
| 23 | No "Coming from React" migration guide | DX | P2 | Alex | Medium |
| 24 | No "Which API?" decision tree documentation | DX | P2 | Alex | Small |
| 25 | `applyProps` identity comparison fails for objects/callbacks | Perf | P2 | Jordan | Medium |
| 26 | LIS remapping is O(n*m) instead of O(n) | Perf | P2 | Jordan | Small |
| 27 | No HMR state preservation | DX | P2 | Both | Large |
| 28 | Computed chains cause O(depth) synchronous cascading | Perf | P2 | Jordan | Medium |
| 29 | `storeComputed` is an awkward API | API | P2 | Jordan | Small |
| 30 | Standalone effects have no ownership tree | Arch | P2 | Jordan | Large |
| 31 | File-based routing documented but not implemented | DX | P2 | Alex | Large |
| 32 | Silent error swallowing in cleanup | DX | P2 | Both | Small |
| 33 | `_signal` brand uses duck-typing instead of Symbol | API | P2 | Jordan | Small |
| 34 | SVG `<g>` wrapper affects layout | Bug | P2 | Both | Medium |
| 35 | `useRovingTabIndex` takes static `itemCount` | Bug | P2 | Jordan | Small |
| 36 | `register()` return value not documented | DX | P2 | Alex | Small |
| 37 | `useSWR` deduplication uses `Date.now()` (same-millisecond race) | Bug | P2 | Jordan | Small |
| 38 | `useEffect` cleanup timing fragile on unmount | Bug | P2 | Jordan | Medium |
| 39 | `debouncedCallbacks` module Map grows | Perf | P2 | Jordan | Small |
| 40 | `prefetchedUrls` / `scrollPositions` in router never cleared | Perf | P2 | Jordan | Small |
| 41 | No error message documentation / troubleshooting section | DX | P2 | Alex | Small |
| 42 | `onClick` vs `onclick` inconsistency | API | P3 | Alex | Small |
| 43 | No testing section in QUICKSTART.md | DX | P3 | Alex | Small |
| 44 | `_` prefix convention inconsistent for internal properties | API | P3 | Jordan | Small |
| 45 | `ErrorBoundary`/`Suspense` return raw VNode objects with magic tags | Arch | P3 | Alex | Medium |
| 46 | No CSS scoping solution | DX | P3 | Both | Large |
| 47 | No immutable update helpers (produce) | API | P3 | Alex | Medium |
| 48 | No `useFormContext` for nested forms | API | P3 | Alex | Medium |
| 49 | No i18n support | API | P3 | Alex | Large |
| 50 | No SSR middleware for Express/Hono/Fastify | API | P3 | Alex | Medium |
| 51 | Router `batch()` inside render function may cause re-entrancy | Bug | P3 | Jordan | Small |
| 52 | Island hydration `processQueue` not re-entrant safe | Bug | P3 | Jordan | Small |
| 53 | Race condition in `createResource` loading flicker | Bug | P3 | Alex | Small |
| 54 | `NavLink` is redundant (re-exports `Link`) | API | P3 | Jordan | Small |
| 55 | No concurrent rendering (module-level mutable state) | Arch | P3 | Jordan | Large |
| 56 | No streaming SSR with Suspense boundaries | API | P3 | Both | Large |
| 57 | `form.register` re-renders entire form on any field change | Perf | P3 | Jordan | Medium |
| 58 | No error overlay in development mode | DX | P3 | Alex | Medium |
| 59 | `act()` testing utility insufficient for RAF/rIC-based effects | DX | P3 | Jordan | Small |
| 60 | `focusedElement` global signal never garbage collected | Perf | P3 | Jordan | Small |

---

## Appendix: Reviewer Profiles and Biases

**Alex (Junior, 1.5 years, React):** Evaluated the framework primarily through the lens of "can I use this coming from React?" Strong focus on learning curve, documentation, and API surface clarity. Less likely to identify deep architectural issues, more likely to identify DX friction. Rating: 7/10 personal, 4/10 production.

**Jordan (Senior, 10+ years, React/Vue/Svelte/SolidJS/Angular):** Evaluated the framework through the lens of correctness, architecture, and competitive positioning. Deep analysis of the reactivity system, reconciler, and comparison to prior art. Less likely to identify beginner friction, more likely to identify correctness and performance issues. Rating: 6.5/10 production readiness, 8/10 architecture and vision.

**Pattern:** Where Alex sees confusion ("I do not know which API to use"), Jordan sees architectural debt ("these APIs have different correctness properties"). Where Alex sees missing docs, Jordan sees missing implementations. The combination covers both the adoption path and the technical foundation.

---

*End of synthesis. All issues cross-referenced between both reviews. Source file locations verified against the codebase.*
