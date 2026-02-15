# Framework Designer Response: What Framework
**Author:** Morgan (Framework Designer & Architect)
**Date:** 2026-02-13
**Input:** Junior Developer Review (Alex), Senior Developer Review (Jordan), Feedback Synthesis (Sam)

---

## Part 1: Meeting Notes -- Morgan Meets with Sam

### Meeting: Framework Review Synthesis Walk-Through
**Attendees:** Morgan (Framework Designer), Sam (Feedback Receiver)
**Duration:** 90 minutes

---

**Sam:** I have synthesized both reviews into a single document. Let me walk through the major findings, starting with the critical bugs.

**Morgan:** Before we start -- I want to say upfront that I read both reviews cover to cover. Alex's perspective as a junior React developer is exactly the lens we need. Jordan's deep architecture analysis is the kind of rigor that separates a prototype from a real framework. Both reviews are excellent. Let's go.

---

#### Critical Bugs

**Sam:** Jordan found three P0 bugs in the core. First, the diamond dependency glitch -- when signal A feeds both computed B and C, and effect D depends on both, D can see an inconsistent state where B has updated but C has not. Outside of `batch()`, effects run synchronously during notification.

**Morgan:** I knew this was a risk when I chose synchronous effect execution. My reasoning was simplicity: synchronous effects are easier to reason about and debug. But Jordan is right -- this is a correctness bug, not a performance issue. A framework that gives you wrong answers fast is worse than one that gives you right answers slightly later. I accept this as P0.

My instinct is toward a microtask-based deferral for effects outside of batch. Topological sorting adds complexity that I do not want in a 180-line reactive system. Push-pull is elegant but harder to reason about. Deferring to microtask is the simplest correct approach: collect all triggered effects, deduplicate them, run them in one pass at the end of the current microtask. Batch already does this. We just need to make "not in batch" behave the same way.

**Sam:** Second, `patchNode` returns an empty `DocumentFragment` after appending it to the DOM. Any component returning an array of elements can trigger this.

**Morgan:** This is embarrassing. A DocumentFragment empties itself when appended -- that is JavaScript 101. I wrote this code too quickly. The fix is straightforward: after `parent.replaceChild(frag, domNode)`, we need to return a reference to the first inserted child, or better, use a marker comment pattern like SolidJS does. Two marker comments (start and end) bracket the range, and reconciliation operates within that range. This is a small change with a big correctness impact. P0, fix this week.

**Sam:** Third, `ErrorBoundary` uses a runtime stack (`errorBoundaryStack.push/pop`) during synchronous effect execution. Async errors cannot find their boundary because the stack is empty by then.

**Morgan:** This is the one I feel worst about. I knew the stack-based approach was fragile when I wrote it. I chose it because it was simple and worked for the synchronous case. But error boundaries that do not catch async errors are fundamentally broken. We need to associate each component context with its nearest error boundary by walking the component parent chain, not relying on a call stack. This means adding a `_parent` reference to each component context, or storing the error boundary reference directly on the context during creation.

I am going to make this P0 but with a caveat: the fix requires adding a `_parentCtx` or `_errorBoundary` field to the component context in `dom.js`. This is a structural change but not a large one.

**Conclusion:** All three P0 bugs are accepted. They will be fixed in Week 1.

---

#### The API Overlap Problem

**Sam:** Both reviewers independently flagged the same thing: too many ways to do the same task. Five data fetching hooks, three state hooks, two conditional rendering approaches, two list rendering approaches. Alex said it was "overwhelming" and "paralyzing." Jordan said it creates "inconsistent code across teams."

**Morgan:** Let me be honest about how we got here. I built What Framework with the philosophy that it should work however a developer thinks. A React developer thinks in `useState`. A SolidJS developer thinks in `signal`. A "no framework" developer thinks in `show()` and `each()`. I wanted all of them to feel at home.

That was the right instinct for a prototype. It is the wrong instinct for a product. A framework that does not help you choose is not "flexible" -- it is "indecisive." I am ready to make the hard calls on which APIs are primary and which are secondary. We will not remove any APIs in v0.x (that would break existing code), but we will clearly designate "recommended" vs "alternative" APIs in the docs, and the recommended path will be singular: one way to do state, one way to do effects, one way to do conditionals, one way to do lists, one way to do data fetching.

**Sam:** Which ones stay as primary?

**Morgan:** I will detail this in Part 5, but the short version:
- **State:** `useSignal` is primary. `useState` stays for React compatibility but is documented as "compatibility mode."
- **Effects:** `useEffect` for component effects. `effect` for standalone reactive effects.
- **Conditionals:** `Show` component is primary. `show()` gets deprecated (it is literally just a ternary and it is misleadingly non-reactive).
- **Lists:** `For` component is primary. `each()` gets deprecated.
- **Data fetching:** `useSWR` is primary for most use cases. `useQuery` stays for complex scenarios. `useFetch` and `createResource` become documented as "simple" and "Solid-style" alternatives respectively.

**Conclusion:** API consolidation plan needed. One recommended path per task.

---

#### The `<what-c>` Wrapper Debate

**Sam:** Both reviewers raised concerns about `<what-c>`. Alex worried about CSS selectors and third-party DOM libraries. Jordan analyzed `:first-child`, `:nth-child`, direct child selectors, unregistered custom element flash, and SVG `<g>` issues.

**Morgan:** Let me explain why `<what-c>` exists. The reconciler needs a stable DOM node to attach component state to and to scope children under. Without a wrapper, a component that returns multiple root elements has no single DOM node to represent it. React solved this with fibers (an in-memory tree). SolidJS solved this with marker comments. Vue solves it with fragment containers.

I chose custom elements because:
1. `display: contents` makes them layout-invisible
2. They give us a single DOM node to attach `_componentCtx` to
3. They scope `childNodes` for reconciliation
4. They are semantically meaningful in DevTools ("this is a component boundary")

The concerns are real but manageable:
- CSS `:first-child` / `:nth-child` issues: These are real. But `display: contents` means the browser treats the children as if the wrapper does not exist for layout purposes. CSS selectors are the one area where this breaks.
- SVG `<g>` wrapper: This is the more serious issue. A `<g>` element is not invisible -- it participates in SVG grouping, transforms, and bounding boxes. We need a better SVG strategy.
- Flash of incorrect layout: We should register the custom element with `customElements.define()` to prevent this.

**Decision:** Keep `<what-c>` for HTML contexts. Fix SVG by using marker comments instead of `<g>`. Register the custom element. Document the CSS selector implications.

**Conclusion:** `<what-c>` stays with improvements. SVG wrapper changes to marker-comment approach.

---

#### The React vs Solid Identity Question

**Sam:** The big question from both reviews: should the framework lean React or Solid?

**Morgan:** I will address this fully in Part 3, but let me give you the short answer here: **Neither. We lean vanilla JS.**

The React hooks exist as an on-ramp. The Solid-style signals exist because they are the right primitive. The "closest to vanilla JS" identity means: signals are just functions, components are just functions, effects are just subscriptions. We are not React-with-signals or Solid-with-hooks. We are "what if the web platform had signals built in, and someone wrote a tiny framework on top of that?"

The dual API is a problem not because both paradigms exist, but because we have not clearly communicated that signals are the foundation and hooks are the compatibility layer. The docs need to lead with signals and treat hooks as "if you are coming from React, here is the familiar version."

**Conclusion:** Signals-first identity. Hooks as React compatibility layer. Not a React clone, not a Solid clone.

---

#### DX Concerns

**Sam:** Alex flagged several DX pain points: deeply nested `h()` calls, the `() =>` wrapper requirement for reactive values, mixed messaging in demos (using `useState` while docs recommend `useSignal`), no DevTools, no HMR state preservation, silent error swallowing.

**Morgan:** The `h()` nesting is a legitimate complaint. The demos should use JSX. I wrote them in `h()` because I wanted to show that the framework works without a build step, but that was the wrong call for the primary demo. People's first impression should be JSX code that looks almost identical to React.

The `() =>` wrapper is inherent to the signals model when using `h()` directly. With JSX and the compiler, this is handled automatically. This is another argument for making JSX the primary authoring mode in all docs and demos.

The mixed messaging in demos is my fault. I used `useState` in the demos because I was thinking about React developers, but the docs recommend `useSignal`. We need to pick one and be consistent everywhere. The answer is `useSignal` in the docs and JSX demos.

Silent error swallowing is unacceptable. Every `try { ... } catch (err) { /* cleanup error */ }` needs to become `try { ... } catch (err) { if (__DEV__) console.warn('[what] cleanup error:', err); }`. We need a `__DEV__` flag or a global error handler.

**Conclusion:** Rewrite demos in JSX with `useSignal`. Add dev-mode warnings. Fix error swallowing.

---

#### Strengths to Protect

**Sam:** Both reviewers agree on the crown jewels: the islands architecture (best-in-class), the reactive system's simplicity (180 lines), signals-as-functions API, the tiny bundle size, and the built-in batteries (forms, data fetching, a11y).

**Morgan:** These are non-negotiable. Every decision we make from here must be evaluated against: does it keep the reactive system under 200 lines? Does it keep the bundle under 4kB? Does it maintain the islands advantage? Does it keep the API close to vanilla JS?

If a fix bloats the core, we find a different fix. If a feature cannot fit in the budget, it goes in a plugin. The small size is not just a marketing claim -- it is an architectural constraint that forces us to make better design decisions.

**Conclusion:** Protect: islands, reactive simplicity, bundle size, signals-as-functions, batteries-included.

---

## Part 2: Vision Check

### Principle 1: "Closest to vanilla JS"

**Current Grade: B+**

The reactive system is genuinely close to vanilla JS. A signal is a function. An effect is a subscription. A component is a function that returns a description of DOM. There are no classes, no decorators, no special syntax, no compilation required. You can understand the entire reactive system by reading 180 lines of JavaScript.

Where it falls short: the `<what-c>` wrapper is not vanilla -- it is framework machinery leaking into the DOM. The hooks API (`useState`, `useEffect`) adds React-isms that are not vanilla JS patterns. The `() =>` wrapper requirement for reactive text in `h()` calls is a framework convention, not a JS pattern.

**What needs to change:**
- Lead documentation with signals, not hooks
- Make `h()` / `html` tagged template the "no build step" path, JSX the "recommended" path
- Document `<what-c>` as a framework implementation detail, not something developers need to think about
- Consider whether the `() =>` wrapper can be eliminated via the compiler for common cases (it already is in JSX mode)

### Principle 2: "Ship less JavaScript"

**Current Grade: A-**

The islands architecture delivers on this promise better than any competing framework. Six hydration modes, priority-based scheduling, shared state across islands -- this is genuinely best-in-class. A page with three interactive widgets ships only the JS for those three widgets, with the rest being static HTML.

Where it falls short: the "zero JS by default" claim only holds for static pages. Any page with even one interactive component ships the full core runtime (~4kB). Svelte compiles components to standalone code with no shared runtime, achieving true zero-baseline. We cannot match that without a compiler, but we can be transparent about what gets shipped.

**What needs to change:**
- Document exactly what ships: core reactive (1.5kB) + hooks (0.8kB) + island client (0.5kB) = 2.8kB minimum for any interactive page
- Explore tree-shaking to drop unused hook/component code
- The compiler should mark static subtrees to avoid shipping code for them

### Principle 3: "Tiny bundle"

**Current Grade: A**

The core is genuinely tiny. The reactive system is ~180 lines. The reconciler is ~720 lines. The hooks are ~260 lines. The total core is under 4kB gzipped. This is competitive with SolidJS (~7kB) and dramatically smaller than React (~44kB) or Vue (~33kB). Only Svelte (~2kB compiled) is smaller, and that is a fundamentally different approach.

The risk is feature creep. We already ship animation, a11y, forms, data fetching, skeleton loaders, and a scheduler. Each module adds to the total. The current approach of making these tree-shakeable is correct -- you only pay for what you import.

**What needs to change:**
- Enforce a strict size budget: core (signals + reconciler + hooks) must stay under 4kB gzipped
- Each add-on module (forms, data, animation, a11y) must stay under 1kB gzipped individually
- Add bundle size checks to CI
- Move the scheduler and skeleton modules out of the critical path

### Principle 4: "No build step required"

**Current Grade: A-**

The `h()` function and `html` tagged template genuinely work without any build step. You can drop a `<script type="module">` tag in an HTML file, import from a CDN, and have a working reactive application. This is a real differentiator -- React, Solid, and Svelte all effectively require a build step.

Where it falls short: without the compiler, you lose event modifiers, two-way binding, island directives, and the `() =>` wrappers become manual. The no-build-step experience is functional but inferior. The docs do not adequately explain this tradeoff.

**What needs to change:**
- Create a dedicated "No Build Step" guide that honestly describes what you get and what you lose
- Ensure the `html` tagged template handles all common cases without `() =>` wrappers where possible
- Provide a CDN build for browser-direct usage

### Principle 5: "Islands first"

**Current Grade: A**

The islands architecture is the framework's crown jewel. Six hydration modes, priority queue scheduling, `boostIslandPriority` for interaction-triggered promotion, shared state across islands, SSR integration with `serializeIslandStores` / `hydrateIslandStores`. Jordan called it "more sophisticated than Astro's islands." Alex called it "not an afterthought or a plugin."

This is first-class. No other framework bundles this level of island support into the core. Astro comes close but requires a separate UI framework for the interactive parts. What is the UI framework AND the islands runtime.

**What needs to change:**
- The `Island` component in `components.js` is a client-side implementation. The server-side `Island` in `server/src/islands.js` is separate. These should feel like one unified API.
- Document the islands architecture more prominently -- it should be the hero feature on the landing page, not buried after signals and hooks
- Add an "Islands Performance" guide showing real-world measurements

---

## Part 3: Identity Decision

### The Question

Should What Framework lean more toward React's mental model (component re-runs, hooks, dependency arrays) or SolidJS's (run-once components, raw signals, fine-grained DOM updates)?

### The Decision

**What Framework is signals-first, with a React compatibility layer.**

This is not a hedge. Here is the specific, concrete meaning:

1. **Signals are the primary state primitive.** `useSignal` in components, `signal` outside. Documentation leads with signals. Examples use signals. The mental model is: "a signal is a reactive variable."

2. **Components are functions that run in reactive effects.** This is our unique position. Unlike Solid (run once) and React (re-run on setState), What components re-run when signals they read change. This gives us React-familiar re-rendering semantics with Solid-like fine-grained triggering.

3. **React hooks are a compatibility layer.** `useState`, `useMemo`, `useCallback`, `useReducer` all exist and work correctly. They are documented in a "Coming from React" section. They are not the primary API.

4. **The `() =>` accessor pattern is embraced.** `count()` to read, `count.set(5)` to write. This is different from both React (`count` / `setCount`) and Solid (`count()` / `setCount(5)`). It is simpler than both because the signal is one value, not a tuple.

### Rationale

**Why not full React?** Because React's model requires the entire component tree to be aware of state changes. `useState` returns a snapshot value, which means the entire component must re-run to get the new value. This leads to `useMemo`, `useCallback`, `React.memo` -- defensive optimization patterns that add cognitive overhead. Signals avoid this by making reactivity granular.

**Why not full Solid?** Because Solid's "run once" model, while more efficient, is unfamiliar to the vast majority of frontend developers. The "component function is called once, ever" mental model is genuinely confusing for anyone coming from React, Vue, Angular, or even vanilla JS event handlers. It also requires a more sophisticated compiler to achieve.

**Why signals-first with re-rendering?** Because it gives us the best of both worlds for our target developer:
- Signals provide fine-grained reactivity within a component (only the DOM nodes that read a signal update)
- Component re-rendering provides a familiar mental model (your function runs again when state changes)
- The `<what-c>` wrapper scopes re-rendering to the component that actually reads the signal, not the entire tree
- No defensive optimization patterns needed -- if a parent does not read a signal, it does not re-render

**What makes us unique?** We are not "React with signals bolted on" (that is Preact Signals). We are not "Solid with React hooks glued on." We are a framework where signals ARE the state management, components are thin reactive wrappers, and the reconciler only touches what changed. The closest analogy is: "What if the browser had signals natively, and someone wrote the thinnest possible framework layer on top?"

---

## Part 4: Architectural Decisions

### Decision 1: The Glitch / Diamond Dependency Problem

**Decision:** Defer all effects outside of `batch()` to a microtask. Keep synchronous execution inside `batch()`.

**Rationale:** This is the simplest correct approach. Topological sorting requires a dependency graph data structure that adds complexity and memory. Push-pull propagation (Preact Signals v2) is elegant but requires tracking "dirty" state at every node in the graph, which complicates the 180-line reactive system significantly.

Microtask deferral means: when a signal writes outside of batch, instead of running effects synchronously, we add them to `pendingEffects` and schedule a microtask to flush. This makes "no batch" behave like "implicit batch per microtask." The behavior is correct: all effects see consistent state because they run after all synchronous signal writes complete.

**Implementation approach:**
In `reactive.js`, modify `notify()`:
```js
function notify(subs) {
  const snapshot = [...subs];
  for (const e of snapshot) {
    if (e.disposed) continue;
    if (e._onNotify) {
      e._onNotify();
    }
    pendingEffects.add(e);
  }
  // Always defer to microtask (unless already in batch, which has its own flush)
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

**Effort:** Small (20-30 lines changed in `reactive.js`)
**Priority:** P0 -- Week 1

---

### Decision 2: `<what-c>` Wrappers

**Decision:** Keep `<what-c>` for HTML contexts. Register it as a custom element. Replace SVG `<g>` wrapper with marker comments.

**Rationale:** The wrapper provides real value: it scopes component children for reconciliation, provides a place to attach component context, and is semantically meaningful in DevTools. The alternatives (marker comments for everything, fragment ranges) are more complex and harder to debug.

The SVG `<g>` wrapper is the real problem. A `<g>` element is visible to SVG layout -- it affects transforms, opacity, clipping, and bounding box calculations. We need a different approach for SVG. Marker comments (start/end comment pairs) work well here because SVG allows comments, and the reconciler can operate on the range between markers.

**Implementation approach:**
In `dom.js`:
```js
// Register the custom element once
if (typeof customElements !== 'undefined' && !customElements.get('what-c')) {
  customElements.define('what-c', class extends HTMLElement {
    constructor() { super(); this.style.display = 'contents'; }
  });
}
```

For SVG, change `createComponent` to use marker comments:
```js
if (isSvg) {
  const startMarker = document.createComment('what-c');
  const endMarker = document.createComment('/what-c');
  // Insert markers, render children between them
  // Reconcile by collecting nodes between markers
}
```

**Effort:** Medium (50-80 lines changed in `dom.js`)
**Priority:** P1 -- Week 3

---

### Decision 3: Synchronous Effects

**Decision:** Move to microtask-deferred effects (see Decision 1). Keep `batch()` for explicit synchronous grouping.

**Rationale:** Synchronous effects cause the diamond glitch. They also cause multiple re-renders per frame when a component reads multiple signals that change independently. Microtask deferral solves both problems with minimal API change.

The only risk is that code that depends on synchronous effect execution (reading DOM state immediately after a signal write) will break. The mitigation is `batch()` with an explicit flush, or a new `flushSync()` API for the rare cases where synchronous execution is needed.

**Effort:** Small (covered by Decision 1)
**Priority:** P0 -- Week 1

---

### Decision 4: The Reconciler

**Decision:** Keep the "diff against live DOM" approach. Do NOT move to retained VDOM or compiled DOM. Add optimizations for common cases.

**Rationale:** The live-DOM diffing approach is What Framework's unique architectural position. A retained VDOM (React) adds memory overhead and complexity. Compiled DOM (Solid/Svelte) requires a sophisticated compiler that we do not have the resources to build and maintain.

The live-DOM approach has real advantages:
- No memory overhead from a shadow tree
- SSR hydration is trivial (the DOM already exists, we just attach effects)
- The code is simple and auditable (720 lines)
- It works with any DOM modification, including third-party libraries

The performance issues Jordan identified are real but addressable without changing the fundamental approach:
- `Array.from(parent.childNodes)` can be cached on the `<what-c>` wrapper
- The LIS remapping can be optimized from O(n*m) to O(n)
- Style diffing can track old properties to remove stale ones

**Optimizations to add:**
1. Cache child node arrays on `<what-c>` wrappers (avoid `Array.from` on every reconcile)
2. Fix LIS remapping to O(n) with a pre-built index map
3. Add style property tracking to remove stale styles
4. Skip `applyProps` for unchanged prop objects (use a generation counter)

**Effort:** Medium (100-150 lines changed/added in `dom.js`)
**Priority:** P1 -- Weeks 3-4

---

### Decision 5: Component Re-run Model

**Decision:** Stay with "re-run in effect." Do NOT move to Solid's "run once."

**Rationale:** This is the core of our identity decision (Part 3). The re-run model is familiar to React developers, works with hooks, and is simpler to implement and debug. The cost is that component functions run more often than in Solid, but the reconciler ensures only changed DOM is touched.

The key optimization is: with microtask-deferred effects (Decision 1), multiple signal changes within the same microtask only trigger one component re-run. This eliminates the "component reads 10 signals, re-renders 10 times" problem Jordan identified.

**Effort:** None (status quo with Decision 1's optimization)
**Priority:** N/A

---

### Decision 6: ErrorBoundary / Suspense

**Decision:** Move to tree-based boundary resolution. Each component context stores a reference to its nearest error boundary.

**Rationale:** The stack-based approach is fundamentally broken for async errors. Tree-based resolution is the only correct approach. React uses fibers for this. We will use the component context chain.

**Implementation approach:**
In `dom.js`, when creating a component:
```js
const ctx = {
  // ... existing fields ...
  _parentCtx: componentStack[componentStack.length - 1] || null,
  _errorBoundary: null, // set when inside an ErrorBoundary
};
```

When creating an error boundary, set `ctx._errorBoundary` on all child contexts. When `reportError` is called, walk up the `_parentCtx` chain to find the nearest `_errorBoundary`.

This also fixes `errorBoundaryStack.push/pop` which currently happens inside an effect and is immediately popped -- making the boundary visible only during synchronous render.

**Effort:** Medium (40-60 lines changed across `dom.js` and `components.js`)
**Priority:** P0 -- Week 1

---

## Part 5: API Consolidation Plan

### State APIs

| API | Decision | Rationale |
|-----|----------|-----------|
| `signal()` | **Keep -- primary for module scope** | The foundation. Used for global/shared state. |
| `useSignal()` | **Keep -- primary for components** | Component-scoped signal. This is the recommended hook. |
| `useState()` | **Keep -- React compatibility** | Returns `[value, setter]`. Documented as "Coming from React" alternative. |
| `atom()` | **Deprecate** | It is literally `signal()` re-exported. Remove the alias. Confusing redundancy. |

**Documentation:** "Use `useSignal` inside components. Use `signal` for module-level shared state. If you are coming from React, `useState` works identically but returns a snapshot value instead of a signal."

### Derived Value APIs

| API | Decision | Rationale |
|-----|----------|-----------|
| `computed()` | **Keep -- primary for module scope** | Lazy derived signal. Core primitive. |
| `useComputed()` | **Keep -- primary for components** | Component-scoped computed. |
| `useMemo()` | **Keep -- React compatibility** | Uses dependency arrays. Documented as React alternative. |
| `storeComputed()` | **Keep but rename to `derived()`** | The `storeComputed` name is awkward. `derived(fn)` is clearer and more intuitive. |

### Effect APIs

| API | Decision | Rationale |
|-----|----------|-----------|
| `effect()` | **Keep -- standalone reactive effects** | Core primitive for reactive subscriptions outside components. |
| `useEffect()` | **Keep -- primary for component side effects** | React-compatible. Uses deps arrays. Familiar. |
| `onMount()` | **Keep** | SolidJS-style lifecycle. Clear intent: "run once after mount." |
| `onCleanup()` | **Keep** | SolidJS-style lifecycle. Clear intent: "run on unmount." |

### Conditional Rendering APIs

| API | Decision | Rationale |
|-----|----------|-----------|
| `<Show>` | **Keep -- primary** | Component-based conditional. Works in JSX and h(). |
| `show()` | **Deprecate** | It is a plain ternary. It is misleadingly non-reactive. Jordan and Alex both flagged it. Remove from docs, keep the export for backward compatibility but mark as deprecated. |

### List Rendering APIs

| API | Decision | Rationale |
|-----|----------|-----------|
| `<For>` | **Keep -- primary (with fix)** | Component-based list rendering. Must be fixed to support item-level reactivity (see Part 6). |
| `each()` | **Deprecate** | Same problem as `show()` -- just a map wrapper. Use `<For>` or direct `.map()` in JSX. |

### Data Fetching APIs

| API | Decision | Rationale |
|-----|----------|-----------|
| `useSWR()` | **Keep -- primary** | The most intuitive API. Stale-while-revalidate covers 80% of use cases. |
| `useQuery()` | **Keep -- advanced** | For complex scenarios: retries, pagination params, cache management. Document as "when you outgrow useSWR." |
| `useInfiniteQuery()` | **Keep** | Specific use case (infinite scroll). No overlap with others. |
| `useFetch()` | **Deprecate** | It is a thin wrapper over `fetch`. `useSWR` does everything it does and more. |
| `createResource()` | **Keep -- SolidJS compatibility** | For developers coming from Solid. Document as "Solid-style alternative." |

### Global State APIs

| API | Decision | Rationale |
|-----|----------|-----------|
| `signal()` at module scope | **Keep -- primary for simple state** | The simplest possible global state. |
| `createStore()` | **Keep -- primary for complex state** | For multi-field state with actions and computeds. |
| `atom()` | **Deprecate** | Alias for `signal()`. Remove. |

### Summary of Deprecations

1. `atom()` -- use `signal()` instead
2. `show()` -- use `<Show>` or ternary instead
3. `each()` -- use `<For>` or `.map()` instead
4. `useFetch()` -- use `useSWR()` instead
5. `NavLink` -- use `Link` instead (they are identical)
6. `storeComputed()` -- rename to `derived()` (keep `storeComputed` as alias for one major version)

---

## Part 6: The Improvement Roadmap

### Phase 1: Critical Fixes (Week 1-2)

#### 1.1 Fix the Diamond Dependency Glitch
- **What:** Defer all effects outside of `batch()` to a microtask
- **Why:** P0 correctness bug. Effects can see inconsistent state in diamond dependency graphs. (Jordan, Sam synthesis #1)
- **How:** Modify `notify()` in `packages/core/src/reactive.js` to always add to `pendingEffects` and schedule a microtask flush instead of calling `_runEffect(e)` synchronously. Add `scheduleMicrotask()` helper with deduplication flag. Approximately:
  ```
  Lines 145-161 (notify function): Replace synchronous _runEffect call with pendingEffects.add(e) + scheduleMicrotask()
  Add lines ~170-180: scheduleMicrotask() function
  ```
- **Priority:** 1 of 6 in this phase
- **Estimated changes:** ~25 lines modified/added in `packages/core/src/reactive.js`

#### 1.2 Fix the DocumentFragment Bug in patchNode
- **What:** Track inserted children individually when replacing a DOM node with an array VNode
- **Why:** P0 correctness bug. DocumentFragment empties after append, leaving invalid reference. (Jordan, Sam synthesis Bug #1)
- **How:** In `packages/core/src/dom.js`, lines 510-519, replace the fragment-based approach with marker comments:
  ```js
  if (Array.isArray(vnode)) {
    const startMarker = document.createComment('[');
    const endMarker = document.createComment(']');
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
- **Priority:** 2 of 6 in this phase
- **Estimated changes:** ~20 lines modified in `packages/core/src/dom.js`

#### 1.3 Fix ErrorBoundary to Use Tree-Based Resolution
- **What:** Replace `errorBoundaryStack` push/pop with component context chain
- **Why:** P0 correctness bug. Async errors cannot find their boundary. (Jordan, Sam synthesis Bug #2)
- **How:**
  1. In `packages/core/src/dom.js`, add `_parentCtx` to component context (line 151):
     ```js
     _parentCtx: componentStack[componentStack.length - 1] || null,
     ```
  2. In `createErrorBoundary` (line 232), store the boundary handler on child contexts:
     ```js
     // When children are rendered, their contexts get _errorBoundary = handleError
     ```
  3. In `packages/core/src/components.js`, change `reportError` (line 146) to walk `_parentCtx` chain:
     ```js
     export function reportError(error) {
       let ctx = getCurrentComponent();
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
  4. Remove `errorBoundaryStack` entirely.
- **Priority:** 3 of 6 in this phase
- **Estimated changes:** ~40 lines modified across `packages/core/src/dom.js` and `packages/core/src/components.js`

#### 1.4 Fix flush() Re-entrant Effect Dropping
- **What:** Loop `flush()` until `pendingEffects` is empty
- **Why:** P1 bug. Effects that write to signals during flush are dropped. (Jordan, Sam synthesis Bug #4)
- **How:** In `packages/core/src/reactive.js`, lines 163-169, replace:
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
- **Priority:** 4 of 6 in this phase
- **Estimated changes:** ~15 lines modified in `packages/core/src/reactive.js`

#### 1.5 Fix Memory Leaks in useMediaQuery and useLocalStorage
- **What:** Add cleanup via `onCleanup` integration
- **Why:** P0 memory leak. Both hooks add global listeners that are never removed. (Both reviewers, Sam synthesis #1-2)
- **How:** In `packages/core/src/helpers.js` (or wherever these hooks live):
  ```js
  export function useMediaQuery(query) {
    if (typeof window === 'undefined') return signal(false);
    const mq = window.matchMedia(query);
    const s = signal(mq.matches);
    const handler = (e) => s.set(e.matches);
    mq.addEventListener('change', handler);
    // Clean up when component unmounts
    const ctx = getCurrentComponent?.();
    if (ctx) {
      ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
      ctx._cleanupCallbacks.push(() => mq.removeEventListener('change', handler));
    }
    return s;
  }
  ```
  Same pattern for `useLocalStorage`.
- **Priority:** 5 of 6 in this phase
- **Estimated changes:** ~20 lines modified in helpers

#### 1.6 Fix Router Link Active State
- **What:** Special-case `/` to require exact match in `isActive` logic
- **Why:** P1 bug. The home link is always "active" because every path starts with `/`. (Alex, Sam synthesis Bug #6)
- **How:** In `packages/router/src/index.js`, change the `isActive` logic:
  ```js
  const isActive = href === '/'
    ? currentPath === '/'
    : currentPath.startsWith(href);
  ```
- **Priority:** 6 of 6 in this phase
- **Estimated changes:** ~5 lines modified in `packages/router/src/index.js`

---

### Phase 2: Core Improvements (Week 3-4)

#### 2.1 Fix Style Diffing
- **What:** Track old style properties and remove stale ones during reconciliation
- **Why:** P1 bug. Stale CSS properties persist when style objects change between renders. (Jordan)
- **How:** In `packages/core/src/dom.js`, modify `setProp` for style objects (lines 649-658):
  ```js
  if (key === 'style') {
    if (typeof value === 'string') {
      el.style.cssText = value;
    } else if (typeof value === 'object') {
      // Remove old style properties not in new style
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
- **Priority:** 1 of 7 in this phase
- **Estimated changes:** ~15 lines modified in `packages/core/src/dom.js`

#### 2.2 Make `For` Component Item-Reactive
- **What:** `For` should maintain a mapping of key to DOM node and only update items that changed
- **Why:** P0 performance issue. Currently recreates entire list on every parent render. (Jordan)
- **How:** Rewrite `For` in `packages/core/src/components.js` to use a keyed cache:
  ```js
  export function For({ each, fallback = null, children }) {
    const list = typeof each === 'function' ? each() : each;
    if (!list || list.length === 0) return fallback;
    const renderFn = Array.isArray(children) ? children[0] : children;
    if (typeof renderFn !== 'function') return fallback;
    // Return keyed VNodes -- the reconciler handles efficient diffing
    return list.map((item, index) => {
      const vnode = renderFn(item, index);
      // Ensure key is present for keyed reconciliation
      if (vnode && typeof vnode === 'object' && vnode.key == null && item.id != null) {
        vnode.key = item.id;
      }
      return vnode;
    });
  }
  ```
  The real improvement here is ensuring keys are always present so the LIS-based keyed reconciliation in `reconcileKeyed` is used instead of the brute-force `reconcileUnkeyed`. The item-level reactivity (Solid-style `mapArray`) is a Phase 4 optimization.
- **Priority:** 2 of 7 in this phase
- **Estimated changes:** ~20 lines modified in `packages/core/src/components.js`

#### 2.3 Fix memo() Stale VNode Problem
- **What:** The memo comparator should prevent the component effect from re-running, not cache VNode trees
- **Why:** P1 bug. Memoized components return VNodes that reference disposed DOM. (Jordan)
- **How:** Rewrite `memo` in `packages/core/src/components.js`:
  ```js
  export function memo(Component, areEqual) {
    const compare = areEqual || shallowEqual;

    function MemoWrapper(props) {
      const ctx = getCurrentComponent();
      if (!ctx._memoProps) {
        ctx._memoProps = { ...props };
        return Component(props);
      }
      if (compare(ctx._memoProps, props)) {
        // Props haven't changed -- skip re-render by returning the same
        // children that are already in the DOM (don't produce new VNodes)
        return null; // Reconciler treats null as "keep existing"
      }
      ctx._memoProps = { ...props };
      return Component(props);
    }

    MemoWrapper.displayName = `Memo(${Component.name || 'Anonymous'})`;
    return MemoWrapper;
  }
  ```
  Actually, the better approach is to have `memo` work at the component effect level: if props have not changed, do not re-run the component's render effect at all. This requires hooking into `createComponent` in `dom.js` to check the memo condition before calling `Component(propsSignal())`.
- **Priority:** 3 of 7 in this phase
- **Estimated changes:** ~30 lines modified across `packages/core/src/components.js` and `packages/core/src/dom.js`

#### 2.4 Make Context Values Reactive
- **What:** Wrap context values in signals so consumers re-render when values change
- **Why:** P1 architectural bug. Changing a context value does not re-render consumers. (Jordan)
- **How:** In `packages/core/src/hooks.js`, modify `createContext`:
  ```js
  export function createContext(defaultValue) {
    const context = {
      _defaultValue: defaultValue,
      Provider: ({ value, children }) => {
        const ctx = getCtx();
        if (!ctx._contextValues) ctx._contextValues = new Map();
        // Wrap in signal if not already
        if (!ctx._contextSignals) ctx._contextSignals = new Map();
        if (!ctx._contextSignals.has(context)) {
          ctx._contextSignals.set(context, signal(value));
        } else {
          ctx._contextSignals.get(context).set(value);
        }
        ctx._contextValues.set(context, ctx._contextSignals.get(context));
        return children;
      },
    };
    return context;
  }
  ```
  And `useContext` reads the signal:
  ```js
  export function useContext(context) {
    const stack = _getComponentStack();
    for (let i = stack.length - 1; i >= 0; i--) {
      const ctx = stack[i];
      if (ctx._contextValues && ctx._contextValues.has(context)) {
        const val = ctx._contextValues.get(context);
        return typeof val === 'function' && val._signal ? val() : val;
      }
    }
    return context._defaultValue;
  }
  ```
- **Priority:** 4 of 7 in this phase
- **Estimated changes:** ~30 lines modified in `packages/core/src/hooks.js`

#### 2.5 Add Dev-Mode Warning System
- **What:** Console warnings for common mistakes in development builds
- **Why:** Both reviewers flagged silent errors and missing warnings as critical DX gaps.
- **How:** Add a `__DEV__` flag (can be a simple `const __DEV__ = true` that build tools dead-code-eliminate in production). Use it to wrap warnings:
  ```js
  // In reactive.js cleanup
  try { e._cleanup(); } catch (err) {
    if (__DEV__) console.warn('[what] Error in effect cleanup:', err);
  }
  ```
  Warnings to add:
  - Hook called outside component
  - Signal read outside reactive context (optional, as this is valid for peek-like reads)
  - Component returned undefined (missing return statement)
  - `useEffect` dependency array contains a function (stale closure risk)
- **Priority:** 5 of 7 in this phase
- **Estimated changes:** ~50 lines added across `packages/core/src/reactive.js`, `dom.js`, `hooks.js`

#### 2.6 Deprecate show(), each(), atom(), NavLink
- **What:** Mark deprecated APIs with console warnings in dev mode, update docs
- **Why:** API consolidation. These add confusion without adding value. (Both reviewers)
- **How:**
  ```js
  export function show(condition, vnode, fallback = null) {
    if (__DEV__) console.warn('[what] show() is deprecated. Use <Show> component instead.');
    return condition ? vnode : fallback;
  }
  ```
  Same pattern for `each()`, `atom()`. For `NavLink`, just make it a documented alias.
- **Priority:** 6 of 7 in this phase
- **Estimated changes:** ~20 lines added across helpers and store files

#### 2.7 Add AbortController to Data Fetching
- **What:** Abort previous requests when a new one starts in `useSWR`, `useQuery`, `createResource`
- **Why:** P2 performance/correctness issue. Abandoned HTTP requests continue running. (Jordan)
- **How:** In `packages/core/src/data.js` and `packages/core/src/hooks.js`, create an AbortController per fetch:
  ```js
  let controller = null;
  const refetch = async (source) => {
    if (controller) controller.abort();
    controller = new AbortController();
    const { signal: abortSignal } = controller;
    // Pass signal to fetcher
    const result = await fetcher(source, { signal: abortSignal });
    // ...
  };
  ```
- **Priority:** 7 of 7 in this phase
- **Estimated changes:** ~30 lines modified across `packages/core/src/data.js` and `packages/core/src/hooks.js`

---

### Phase 3: DX & Polish (Week 5-6)

#### 3.1 Rewrite Demo App in JSX with useSignal
- **What:** Convert all demo files from `h()` calls + `useState` to JSX + `useSignal`
- **Why:** Both reviewers flagged demos using `h()` as contradicting the "JSX recommended" positioning. Demos using `useState` while docs recommend `useSignal` sends mixed signals. (Alex, Jordan)
- **How:** Rewrite `demo/src/pages/home.js`, `demo/src/pages/demos.js`, `demo/src/pages/docs.js`, `demo/src/pages/islands.js`, `demo/src/layouts/main.js`. Convert:
  ```js
  // Before:
  const [count, setCount] = useState(0);
  return h('button', { onClick: () => setCount(c => c + 1) }, 'Count: ', count);
  // After:
  const count = useSignal(0);
  return <button onClick={() => count.set(c => c + 1)}>Count: {count()}</button>;
  ```
- **Priority:** 1 of 6 in this phase
- **Estimated changes:** ~500 lines rewritten across 5 demo files

#### 3.2 Write "Coming from React" Migration Guide
- **What:** A dedicated guide mapping every React concept to What's equivalent
- **Why:** Alex specifically requested this. It is the #1 adoption tool for React developers.
- **How:** Create `docs/MIGRATION-REACT.md` covering: `useState` -> `useSignal`, `useEffect` -> `useEffect` (same!), `useMemo` -> `useComputed`, `React.memo` -> `memo`, `useContext` -> `useContext` (same!), `React.lazy + Suspense` -> `lazy + Suspense` (same!), gotchas (signals return functions, not values), the `() =>` wrapper pattern.
- **Priority:** 2 of 6 in this phase
- **Estimated changes:** ~200 lines new documentation

#### 3.3 Write "Which API?" Decision Guide
- **What:** A single page with clear recommendations for each task
- **Why:** Alex: "I immediately felt uncertain about which API to use for any given task." (Alex)
- **How:** Create `docs/CHOOSING-APIS.md` with a decision tree:
  ```
  Need component state?
    -> Use useSignal()
    -> Coming from React? useState() works too
  Need shared/global state?
    -> Simple value? signal() at module scope
    -> Complex with actions? createStore()
  Need data fetching?
    -> Standard API call? useSWR()
    -> Complex (retries, pagination)? useQuery()
    -> Infinite scroll? useInfiniteQuery()
  Need conditional rendering?
    -> <Show when={condition}> (or ternary in JSX)
  Need list rendering?
    -> <For each={items}>{item => ...}</For>
  ```
- **Priority:** 3 of 6 in this phase
- **Estimated changes:** ~150 lines new documentation

#### 3.4 Generate Real TypeScript Definitions
- **What:** Replace stub `.d.ts` files with real type definitions
- **Why:** Both reviewers flagged TypeScript as table stakes. The README claims "Full type definitions included" which is currently misleading. (Both reviewers)
- **How:** Write proper `.d.ts` files for every export. Start with the core (`packages/core/index.d.ts`):
  ```typescript
  export declare function signal<T>(initial: T): Signal<T>;
  export interface Signal<T> {
    (): T;
    set(value: T | ((prev: T) => T)): void;
    peek(): T;
    subscribe(fn: (value: T) => void): () => void;
    readonly _signal: true;
  }
  export declare function computed<T>(fn: () => T): Computed<T>;
  // ... etc
  ```
  Then router (`packages/router/index.d.ts`), server (`packages/server/index.d.ts`).
- **Priority:** 4 of 6 in this phase
- **Estimated changes:** ~400 lines new/modified `.d.ts` files

#### 3.5 Add Error Message Catalog
- **What:** Comprehensive error messages with suggestions and error codes
- **Why:** Alex: "No error message documentation." "Basic throws without component names or suggestions." (Alex, Jordan)
- **How:** Create an error catalog in `packages/core/src/errors.js`:
  ```js
  export const errors = {
    E001: 'Hooks must be called inside a component. Did you forget to wrap this in a component function?',
    E002: (name) => `Component "${name}" returned undefined. Did you forget a return statement?`,
    E003: 'useEffect cleanup function threw an error. Check your cleanup logic.',
    // ...
  };
  ```
  Use in all throw/warn sites. Include component name where available.
- **Priority:** 5 of 6 in this phase
- **Estimated changes:** ~80 lines new, ~30 lines modified across core files

#### 3.6 Register `<what-c>` Custom Element + Document Behavior
- **What:** Call `customElements.define('what-c', ...)` and add documentation about the wrapper
- **Why:** Prevents flash of incorrect layout. Addresses Alex's "no documentation about `<what-c>` behavior." (Both reviewers)
- **How:**
  In `packages/core/src/dom.js`, add at module level:
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
  Add a "Component Wrappers" section to `docs/API.md` explaining:
  - Every component renders inside a `<what-c>` element
  - `display: contents` makes it invisible to layout
  - CSS selectors like `:first-child` may need adjustment
  - This is an implementation detail, not something you need to interact with
- **Priority:** 6 of 6 in this phase
- **Estimated changes:** ~10 lines code, ~50 lines documentation

---

### Phase 4: Competitive Features (Week 7-8)

#### 4.1 DevTools Browser Extension (MVP)
- **What:** A Chrome/Firefox extension showing component tree, signal values, and effect dependencies
- **Why:** Both reviewers flagged DevTools as critical for adoption. "When something is not updating, how do I debug it? I am left with console.log." (Alex)
- **How:** Build a minimal extension that:
  1. Injects a hook into the framework's `createComponent` to track the component tree
  2. Exposes signal values and subscriber counts via a `__WHAT_DEVTOOLS__` global
  3. Renders a component tree panel showing signal values
  This is a large effort but has outsized impact on developer adoption.
- **Priority:** 1 of 4 in this phase
- **Estimated changes:** ~500 lines new code (extension), ~50 lines hooks in core

#### 4.2 Compiled Reactivity for Static Content
- **What:** The Babel plugin identifies static subtrees (no signal reads) and hoists them out of component render functions
- **Why:** This is the low-hanging compiler optimization that gives Svelte and Solid their performance edge. Static content should be created once, not recreated on every render.
- **How:** In `packages/compiler/src/babel-plugin.js`, add a static analysis pass:
  1. Walk the JSX tree
  2. Identify subtrees with no signal reads, no dynamic props, no component calls
  3. Hoist them to module-level constants
  ```jsx
  // Before:
  function App() {
    return <div><h1>Static Title</h1><Counter /></div>;
  }
  // After (compiled):
  const _hoisted = h('h1', null, 'Static Title');
  function App() {
    return h('div', null, _hoisted, h(Counter));
  }
  ```
- **Priority:** 2 of 4 in this phase
- **Estimated changes:** ~100 lines in `packages/compiler/src/babel-plugin.js`

#### 4.3 HMR State Preservation
- **What:** Preserve component state across hot module replacement during development
- **Why:** "Every time I save a file during development, all my component state resets." (Alex)
- **How:** In the Vite plugin, add HMR handling:
  1. When a module updates, find components that changed
  2. For unchanged components, preserve their hook state arrays
  3. For changed components, re-create with fresh state
  This follows the React Fast Refresh approach: compare the component function identity, preserve hooks if the component body changed but not its structure.
- **Priority:** 3 of 4 in this phase
- **Estimated changes:** ~150 lines in `packages/compiler/src/vite-plugin.js`

#### 4.4 Suspense Integration with useSWR
- **What:** Make `useSWR`'s `suspense` option actually work
- **Why:** The option is declared but never implemented. This is misleading API surface. (Jordan)
- **How:** When `suspense: true` is passed to `useSWR`, throw the fetch promise during the initial load so that a parent `Suspense` boundary can catch it:
  ```js
  if (opts.suspense && isLoading() && pendingPromise) {
    throw pendingPromise;
  }
  ```
  This mirrors React's experimental Suspense-for-data-fetching pattern.
- **Priority:** 4 of 4 in this phase
- **Estimated changes:** ~20 lines in `packages/core/src/data.js`

---

## Part 7: What We Won't Change (And Why)

### 1. We Will NOT Move to a "Run Once" Component Model

Both reviewers noted that SolidJS's "run once" model is more efficient. Jordan specifically identified that every `useState` state change triggers a full component re-render + reconciliation. This is true, and we are keeping it.

**Why:** The re-run model is the foundation of our React compatibility story. Hooks with dependency arrays only make sense in a re-run model. `useMemo` has no purpose if the component only runs once. The re-run model is also simpler to debug: you can put `console.log` at the top of a component function and see every render. In a run-once model, debugging requires understanding which reactive subscriptions are active.

**Tradeoff:** We pay a performance cost for reconciliation on every state change. The mitigation is: microtask deferral (Decision 1) batches multiple signal changes into one render, and the LIS-based reconciler minimizes DOM operations.

**Revisit when:** We build a sufficiently advanced compiler that can transform component functions into run-once reactive setups while maintaining hook semantics. This is Svelte 5's approach with runes. It is a massive compiler engineering effort and is not on the near-term roadmap.

### 2. We Will NOT Add Concurrent Rendering

Jordan noted that module-level mutable state (`currentEffect`, `componentStack`) makes concurrent rendering impossible. This is correct, and we are not fixing it.

**Why:** Concurrent rendering (React's Fiber architecture) solves a problem that most applications do not have: input responsiveness during heavy rendering. The cost is enormous: fibers, lanes, priority queues, interruptible rendering, time-slicing. React spent 3+ years and thousands of engineering hours building this. We have a 180-line reactive system. Concurrent rendering would 10x the complexity of the core.

**Tradeoff:** Very large component trees (1000+ components rendering simultaneously) may experience janky updates. The mitigation is: signals ensure only the component that reads a changed signal re-renders, not the entire tree. This is inherently more granular than React without fibers.

**Revisit when:** The framework reaches adoption levels where complex apps (dashboards with hundreds of widgets) are a primary use case, AND there is clear user demand for concurrent rendering.

### 3. We Will NOT Remove `useState`

Despite recommending `useSignal` as primary, `useState` stays in the framework permanently.

**Why:** Every React developer on earth knows `useState`. Removing it would be a hostile act toward the exact developers we want to attract. The cost of keeping it is minimal: 12 lines of code. The benefit is that any React developer can start using What Framework with zero new concepts.

**Tradeoff:** Two ways to do component state creates potential confusion. The mitigation is clear documentation: "Use `useSignal`. If you are coming from React, `useState` also works."

**Revisit when:** Never. This is a permanent API.

### 4. We Will NOT Build a Meta-Framework (Yet)

Alex wished for "a full-stack framework that handles routing, SSR, API routes, and deployment" like Next.js. We are not building this now.

**Why:** A meta-framework is a product, not a library feature. It requires file-system routing implementation (which we have documented but not built), a dev server with SSR, a build pipeline, deployment adapters, and ongoing maintenance of integrations with hosting providers. This is a separate team-sized effort.

**Tradeoff:** Developers who want a full-stack solution will choose Next.js, Nuxt, or SvelteKit over What Framework.

**Revisit when:** The core framework is production-ready (all P0/P1 bugs fixed, TypeScript support, DevTools), and there is clear demand from users who want an integrated solution. Alternatively, an Astro integration (using What as Astro's UI framework for islands) could serve this need with less effort.

### 5. We Will NOT Add CSS-in-JS or Scoped Styles

Both reviewers noted the lack of a built-in CSS solution.

**Why:** CSS solutions are opinionated and divisive. CSS Modules, styled-components, Tailwind, vanilla CSS -- every developer has a preference. Building one in would alienate developers who prefer a different approach. The framework works with all CSS approaches because it outputs standard DOM elements.

**Tradeoff:** No "recommended" styling solution. Developers must bring their own.

**Revisit when:** A clear community preference emerges, or the framework builds a Vite plugin that integrates CSS Modules automatically (low effort, high compatibility).

### 6. We Will NOT Build File-Based Routing (Yet)

Alex called out that file-based routing is "extensively documented but appears to be vaporware."

**Why:** Alex is right. The docs describe it, but there is no filesystem scanner that generates routes. This is a build-tool integration, not a runtime feature. It requires the Vite plugin to scan `src/pages/`, generate route definitions, and inject them into the app entry point.

**Decision:** Remove file-based routing from the docs until it is implemented. Document it as a "planned feature." The programmatic routing API (`defineRoutes`, `Router`) is the current supported approach.

**Revisit when:** Phase 4, or when the Vite plugin is mature enough to support it.

---

## Part 8: The "Make It Best" Vision

### The Killer Feature Story

What Framework's killer feature is not one thing -- it is the intersection of three things that no other framework combines:

1. **Islands architecture as a first-class citizen** (not a meta-framework add-on)
2. **Sub-4kB runtime** (smaller than React, Solid, or Vue)
3. **React-familiar API** (zero learning curve for the world's largest developer community)

The pitch is: **"Ship your React skills in 4kB with zero wasted JavaScript."**

This is not "we do everything." It is: we make content-heavy websites with islands of interactivity faster and simpler than any alternative. Marketing sites, documentation sites, e-commerce product pages, blogs with interactive widgets, dashboards with mostly-static layouts. These are the use cases where What wins.

### The Target Developer

**Primary:** A frontend developer with 1-3 years of React experience who is building content-heavy websites and is frustrated by the 44kB React bundle, the need for Next.js/Gatsby for SSR, and the complexity of partial hydration.

**Secondary:** A senior developer who wants the control and transparency of a small framework but does not want to give up the ergonomics of hooks and JSX.

**Not our target (yet):** Enterprise teams building complex SPAs with hundreds of interactive components. Those teams need the ecosystem, DevTools, and battle-testing that React provides.

### The v1.0 Launch Blog Post Headline

**"What Framework: Ship React-style Components in 4kB with Islands That Just Work"**

Subtitle: "The web framework that does not punish your users for your developer experience."

### What Would Make Someone Switch FROM React

1. **Bundle size matters to them.** They are building a marketing site or content site where every kilobyte counts for Core Web Vitals. React + ReactDOM is 44kB. What is 4kB.

2. **They want islands without a meta-framework.** They want partial hydration but do not want to adopt Next.js or Astro. What gives them islands as a core primitive.

3. **They want the simplicity of understanding the framework.** React's source is impenetrable. What's entire reactive system is 180 lines. When something goes wrong, they can trace through the framework source themselves.

4. **They want built-in batteries.** They are tired of installing `react-router`, `react-hook-form`, `swr`, `framer-motion`, and `clsx` for every project. What includes routing, forms, data fetching, animations, and utility functions out of the box.

### What Would Make Someone Choose What for Their NEXT Project

1. **A proven track record.** At least 3-5 production sites using What Framework, with published case studies showing performance improvements over React.

2. **TypeScript support that works.** Real type definitions. Autocomplete in VS Code. Compile-time error checking.

3. **DevTools that help.** Even a basic component tree + signal inspector would make the framework debuggable.

4. **A vibrant example gallery.** 10-20 example applications covering common patterns: blog, e-commerce, dashboard, landing page, SaaS app.

5. **One year of stability.** No breaking API changes for at least one major version. Developers need confidence that the framework will not reinvent itself every six months.

### The Path from Here to v1.0

Phase 1-2 (Weeks 1-4): Fix correctness bugs and core architectural issues. After this, the framework produces correct output in all cases.

Phase 3 (Weeks 5-6): DX improvements. After this, the framework is pleasant to use: real TypeScript, clear documentation, good error messages.

Phase 4 (Weeks 7-8): Competitive features. After this, the framework has DevTools, compiler optimizations, and Suspense integration.

**v0.2.0** (end of Week 4): All P0 bugs fixed, API consolidation complete, dev-mode warnings added. The framework is *correct*.

**v0.3.0** (end of Week 6): TypeScript support, documentation overhaul, demo rewrite. The framework is *usable*.

**v0.4.0** (end of Week 8): DevTools MVP, compiler optimizations, HMR. The framework is *competitive*.

**v1.0** (target: 3-4 months after Phase 4): Production sites running, community feedback incorporated, API stability guaranteed. The framework is *recommended*.

---

### Final Words

This framework started with a simple question: "What if we built the thinnest possible layer over the web platform's own primitives?" Signals are reactive variables. Components are functions. The DOM is the DOM -- we diff against it directly, no shadow copies.

The team review showed me that the vision is right but the execution has gaps. Correctness bugs in the reactive system, memory leaks in utility hooks, a confusing proliferation of APIs, and missing developer tools. These are all fixable. The foundation -- the 180-line reactive system, the islands architecture, the sub-4kB bundle -- is exactly what I intended.

The hardest decision in this document is the identity decision: signals-first, with React compatibility. This means we are not trying to be React, and we are not trying to be Solid. We are trying to be What -- the framework that answers "what if vanilla JS had reactivity built in?"

Now we build it.

-- Morgan, Framework Designer

---

*This document references source files in `packages/core/src/reactive.js`, `packages/core/src/dom.js`, `packages/core/src/hooks.js`, `packages/core/src/components.js`, `packages/core/src/store.js`, and `packages/router/src/index.js`. All line numbers reference the current state of the codebase as of 2026-02-13.*
