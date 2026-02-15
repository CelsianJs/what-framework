# Feedback Synthesis -- What Framework Review

## Process

Two developers independently reviewed the What Framework over the period of February 2026. Neither saw the other's review. The Senior Developer (8+ years: React, Svelte, SolidJS, Vue) performed a deep source code audit of every package, mentally building four production scenarios against the framework and cataloging specific bugs with line numbers. The Junior Developer (~2 years, mostly React/Next.js) spent approximately 6 hours reading docs and source, simulating the onboarding experience from minute one, and comparing the DX to React at every step. This synthesis presents their feedback as a conversation -- agreements, disagreements, and unique perspectives -- organized by severity for the framework designer.

---

## The Conversation Between Our Developers

### Where Both Developers Agree

These are the strongest signals in the review. When a developer with 8 years of experience and a developer with 2 years of experience independently flag the same issue, it is almost certainly real and important.

**1. The `h()` function is the single biggest barrier to adoption.**

This is the most emphatic point of agreement across both reviews. Both developers independently wrote side-by-side comparisons of `h()` vs JSX and reached the same conclusion.

- **Senior says:** "The `h()` function is the primary authoring experience, and it is the framework's biggest DX weakness." He provides a 30-line `h()` Dashboard example next to a 20-line JSX version and calls the JSX version "dramatically easier to read, maintain, and review in PRs." His recommendation: "Invest in a simple JSX transform (even a Babel plugin) or a Vite plugin that converts JSX to `h()` calls."
- **Junior says:** "Writing `h()` calls all day is miserable for building real UIs." and "This is the number one reason I would hesitate to adopt this framework. JSX exists for a reason." He tracks the exact frustration: "One missing comma or misplaced parenthesis and the whole component breaks, likely with an unhelpful error." His recommendation: "If this framework does not get JSX support, adoption will be severely limited."

Both also note that the `html` tagged template literal, which could serve as a middle ground, is barely mentioned in the docs, never shown in real examples, and has known limitations (cannot reference component functions by tag name).

**2. `signal()` vs `useState()` vs `useSignal()` -- too many ways to do the same thing, with no guidance on which to use.**

- **Senior says (implicitly):** His scenarios use both `useSignal` and `useState` interchangeably. He notes that `useState` "returns a stale value on every render after the first" due to how it reads the signal synchronously, and that the documentation does not mention this footgun.
- **Junior says (explicitly):** "Three ways to do the same thing" is his #2 pain point. "The README uses `signal()`, the QUICKSTART uses `useState()`, the demo uses both interchangeably. This is the second biggest onboarding problem." He asks for a clear decision tree and suggests leading with `useState` for React migrants.

Both are pointing at the same root problem: the framework offers three state primitives without explaining when or why to choose each one, and the documentation inconsistently uses different ones in different places.

**3. The `() => value()` reactive wrapper pattern is undocumented and confusing.**

- **Senior says:** He demonstrates that `h('p', null, 'Count: ', () => count())` requires the outer arrow function for reactivity, and that the framework silently fails without it. He notes inconsistencies across examples.
- **Junior says:** This is his #3 pain point. "This pattern is never explicitly taught. I discovered it by reading examples." He predicts the exact Stack Overflow question: "I wrote `h('p', null, count)` but my counter never updates. What am I doing wrong?" He also identifies that the docs themselves are inconsistent -- the README uses `() => count()` but the QUICKSTART uses `count` directly.

Both see this as a documentation failure that creates a silent-failure footgun.

**4. Import path confusion (`'what'` vs `'@what/core'` vs `'@aspect/core'`).**

- **Senior says (implicitly):** He references `@aspect/core` as the actual package name while the docs say `what`.
- **Junior says (explicitly):** "This is three different names for the same thing and it is deeply confusing during development." He traces the confusion: the README says `'what'`, the demo uses `'@what/core'`, and the package is actually named `'@aspect/core'`. The CLI silently rewrites imports, which adds another layer of indirection.

**5. The islands architecture is the strongest part of the framework.**

The most important agreement on the positive side.

- **Senior says:** "This is the strongest part of the framework." He rates it 9/10 and calls it "genuinely sophisticated" -- noting that the priority-based hydration queue, `boostIslandPriority`, and shared island stores are features not even found in Astro.
- **Junior says:** "Islands architecture built in" is one of her top 8 things that are "actually better than React." She appreciates that it is first-class rather than requiring a separate meta-framework.

**6. Signals-based reactivity (automatic dependency tracking, no dependency arrays) is genuinely better than React's model.**

- **Senior says:** The signal system is "implemented with admirable conciseness" and is "clean, correct, compact." He rates it 8/10. He specifically praises lazy `computed()` and the batch depth counting.
- **Junior says:** "No dependency arrays" is her #1 thing that is better than React. "I will never again forget to add `count` to my `useEffect` deps. `computed(() => count() * 2)` just works. This is genuinely superior."

**7. Bundle size is impressive and matters.**

- **Senior says:** Rates bundle size 9/10. "Genuinely tiny if the claim holds."
- **Junior says:** "4kB is genuinely impressive. My React + react-dom + router + form library + SWR stack is easily 100kB+."

However, the junior raises a valid trust concern: "It feels like it is trying to be everything at once" and questions whether tree-shaking actually achieves the 4kB claim when the core includes animation, a11y, skeleton, data fetching, and forms.

**8. The data layer looks like TanStack Query / SWR but is missing critical functionality.**

- **Senior says:** "`useQuery` mimics TanStack Query's API but misses critical features." He catalogs specific gaps: no query client, broken `enabled` reactivity, no `keepPreviousData`, no structural sharing. Most critically: "`invalidateQueries` deletes from the cache Map but does not notify any active queries to refetch. This is the most critical gap."
- **Junior says:** "What if `useSWR` has a bug? In the React ecosystem, I would switch libraries. Here, I am stuck." She also notes the unbounded cache Map: "For a real app with lots of data, this would be a memory leak."

**9. The API surface is too large for a 4kB framework.**

- **Senior says (implicitly):** His comparison matrix shows the framework trying to compete with 5+ separate libraries simultaneously.
- **Junior says (explicitly):** "The framework exports approximately 120+ symbols from the core package alone. For comparison, React's core exports about 20." She provides a specific breakout of what should be in core (~25 exports) vs what should be separate packages.

---

### Where They Disagree

These are interesting tensions where the designer's judgment is needed.

**1. Component-level re-renders: how much does it matter?**

- **Senior (concerned):** This is his primary architectural criticism. He explains that wrapping every component in an `effect()` means "the `useSignal` / `useComputed` hooks are cosmetic -- they provide a signal-like API but deliver React-like re-render behavior." He considers this a fundamental design flaw that "defeats the purpose of fine-grained reactivity" and rates the component model 3/10.
- **Junior (unaware):** She praises the framework's claim that "signals update only the exact DOM nodes that read them" as one of its advantages over React. She does not realize that the current implementation contradicts this marketing claim.

**Tension for the designer:** The senior sees the implementation reality; the junior sees the marketing promise. If the framework ships as-is, early adopters like the junior will eventually discover the gap between the promise ("fine-grained updates that skip the virtual DOM") and the reality (component-level re-renders), and that discovery will erode trust. The designer needs to decide: fix the rendering granularity, or change the marketing language.

**2. Built-in batteries: strength or liability?**

- **Senior (cautiously positive):** He sees the breadth of built-in features (forms, data fetching, animations, a11y) as evidence of "a strong understanding of what production apps actually need." He evaluates each on its merits.
- **Junior (conflicted):** She calls it both a strength ("Not needing to install `react-hook-form` separately is a real DX win") and a weakness ("It feels like it is trying to be everything at once"). Her concern: "What if `useSWR` has a bug? In the React ecosystem, I would switch libraries. Here, I am stuck."

**Tension for the designer:** The "batteries included" approach is a philosophical choice. The junior's concern is about lock-in and quality guarantees; the senior's concern is about each battery being half-charged. The designer needs to decide: keep everything built-in and commit to quality, or modularize and let some features be optional.

**3. React compatibility hooks: bridge or trap?**

- **Senior (skeptical):** He identifies that `useState` "returns a stale value on every render after the first" because it reads the signal synchronously. He sees the React compatibility layer as introducing subtle bugs that React developers would not expect.
- **Junior (appreciative):** She finds `useState` reassuring: "oh I can use what I already know." She explicitly suggests the framework should "lead with `useState`" in docs for React migrants.

**Tension for the designer:** The junior's onboarding experience benefits from React-familiar APIs. The senior's production experience reveals that those same APIs behave subtly differently and create footguns. Should the framework lean into React familiarity (risking subtle bugs) or lean into its native signal API (risking adoption barriers)?

---

### Senior-Only Insights (Architecture & Internals)

These are issues the junior would not see but that matter for production use.

**1. `onMount` and `onCleanup` callbacks are never invoked.**
The hooks push to `ctx._mountCallbacks` and `ctx._cleanupCallbacks`, but no code in `dom.js` ever reads or invokes them. This is not a missing feature -- it is a ship-blocking bug.

**2. Component re-creation on every reconciliation.**
When `patchNode` encounters a component VNode, it destroys and recreates the child component from scratch. All state is lost. The comment in source says "future: memoize + diff props" -- meaning this is a known gap.

**3. Context system is fundamentally broken.**
`createContext` uses a global singleton. Nested providers overwrite each other. Two parts of the tree providing different values for the same context will conflict.

**4. Memory leak potential from orphaned effects.**
Effects that create child effects (common in components) have no parent-child tracking. Disposing a parent effect does not dispose its children.

**5. `createResource` error handler has a variable comparison bug.**
Line 217 compares `currentFetch === fetcher` (the function) instead of `currentFetch === fetchPromise` (the promise). Errors from concurrent fetches silently fail to update state.

**6. Portal tag not handled by the reconciler.**
`Portal` returns `{ tag: '__portal', ... }` but `dom.js` has no case for `__portal`. The reconciler would create an unknown HTML element.

**7. Island components cannot use hooks.**
`mount(Component({ ...props, ...storeProps }), el)` calls the component function directly, outside `createComponent`. The component stack is empty, so any hook call throws.

**8. `useSWR` effects create event listeners without proper cleanup.**
Focus and reconnect effects are bare `effect()` calls whose dispose functions are never called. Long-running SPAs accumulate orphaned listeners.

**9. Router `batch()` inside a component render can cause re-entrancy.**
The Router component calls `batch(() => { _params.set(...); _query.set(...) })` inside its render function, which is already inside a reactive effect.

**10. `memo` shares state across all instances of the memoized component.**
`prevProps` and `prevResult` are in the `memo` closure, shared globally. Two uses of the same memoized component with different props interfere with each other.

**11. Performance: O(n*m) in keyed list reconciliation.**
The `lisSet` computation has a nested loop making the reconciler slower than expected for large lists.

**12. Error boundaries only work on initial render.**
The boundary is only on the error boundary stack during its own render. Child errors from later effect re-runs are not caught.

---

### Junior-Only Insights (DX & Onboarding)

These are issues the senior would overlook but that matter for adoption.

**1. The framework cannot actually be installed.**
"The packages are not published to npm. `npx create-what my-app && npm install` would fail." The docs present it as ready-to-use, but it is not. This breaks the first-run experience entirely.

**2. The `isLoading()` signal-as-function footgun.**
The junior predicts a specific 30-minute debugging session: "`isLoading` in SWR (the real library) is a boolean. I would write `if (isLoading)` (without parentheses) first, get `true` (because a function is truthy), and wonder why my loading state never goes away."

**3. `formState.errors().email` vs `formState.errors.email`.**
The signal wrapping means an extra `()` call that React Hook Form users will forget. No TypeScript error catches this because the type definitions do not prevent the mistake.

**4. `show()` function vs `Show` component -- duplicate APIs without guidance.**
Same for `each()` vs `For` vs `.map()`. The junior counts three ways to render lists and asks "When and why would I choose one over another?"

**5. No styling guidance.**
"The form demo has inline styles on everything. There is no mention of a recommended styling approach in the quickstart." The senior mentions CSS-in-JS as a "nice to have"; the junior experiences the gap immediately in practice.

**6. The "would I ask this on Discord" list reveals real confusion patterns.**
The junior provides 12 specific questions she would ask on a support channel. These are a roadmap for documentation improvements. The most telling: "Can I use JSX with What? Writing `h()` is driving me crazy."

**7. Career risk of adopting an unknown framework.**
"I would be the only person at my company using this. That is a career risk. If I leave, nobody can maintain my code." This is a real adoption barrier that framework authors often underestimate.

**8. Need for a playground.**
"A web-based playground (like the Svelte REPL or SolidJS playground) where people can try the framework without installing anything. This is the fastest path to adoption."

**9. Inconsistent examples across documentation pages.**
The junior noticed that each doc file (README, QUICKSTART, API reference, demo) seems written with a different mental model of the "right" way to use the framework. This creates confusion that compounds with time.

---

## Consolidated Issue Tracker

### CRITICAL (Blocks Production Use)

**Issue 1: `onMount` and `onCleanup` callbacks are never invoked**
- **Who flagged it:** Senior
- **Impact:** Any component that relies on mount/cleanup lifecycle (setting up subscriptions, timers, event listeners, third-party library initialization) silently fails. The hooks exist, accept callbacks, and do nothing.
- **Evidence:** Senior: "`ctx._mountCallbacks` is populated but never read. This is not a 'missing feature' but a ship-blocking bug."
- **Comparable:** React's `useEffect` with `[]` deps, Solid's `onMount`/`onCleanup`, Svelte's `onMount`/`onDestroy` -- all correctly invoke lifecycle callbacks.

**Issue 2: Component re-creation on every parent re-render**
- **Who flagged it:** Senior
- **Impact:** When a parent component re-renders, all child components are destroyed and recreated from scratch. All child state is lost. All child effects re-run. This makes any stateful component tree unusable.
- **Evidence:** Senior quotes the source: `if (typeof vnode.tag === 'function') { const node = createComponent(vnode, parent); parent.replaceChild(node, domNode); return node; }` with the comment "future: memoize + diff props."
- **Comparable:** React reuses component instances and only updates props. Solid creates components once and never re-runs them. Svelte compiles away the problem.

**Issue 3: Context system is globally scoped (broken for nested providers)**
- **Who flagged it:** Senior
- **Impact:** Two `Provider` components for the same context overwrite each other's values globally. A theme context with "dark" in a sidebar and "light" in the main content would break.
- **Evidence:** Senior: "The Provider sets `ctx._value = value` globally. If two parts of the tree provide different values for the same context, they overwrite each other. There is no tree-scoping."
- **Comparable:** React's context uses tree-scoped lookup. Solid's context walks the owner chain. Both correctly scope values to tree position.

**Issue 4: Island components cannot use hooks**
- **Who flagged it:** Senior
- **Impact:** Any island component that calls `useState`, `useSignal`, `useEffect`, or any other hook will throw. Since islands are the framework's strongest feature, this means the strongest feature cannot use the core API.
- **Evidence:** Senior: "`mount(Component({ ...props, ...storeProps }), el)` calls the Component function directly, outside of `createComponent`. The component stack is empty, so `getCurrentComponent()` returns undefined, and any hook call throws."
- **Comparable:** Astro islands hydrate through the framework's component system. This is a bug, not a design limitation.

**Issue 5: `createResource` error handler compares wrong variable**
- **Who flagged it:** Senior
- **Impact:** Errors from concurrent fetches silently fail to update error state. Users see no error indication when API calls fail.
- **Evidence:** Senior identifies line 217: `if (currentFetch === fetcher)` should be `if (currentFetch === fetchPromise)`.
- **Comparable:** N/A -- this is a straightforward bug.

**Issue 6: Cache invalidation does not notify active queries**
- **Who flagged it:** Senior (detailed), Junior (conceptual concern)
- **Impact:** Calling `invalidateQueries` deletes the cache entry but does not trigger refetch on mounted components. Already-rendered components continue showing stale data.
- **Evidence:** Senior: "In TanStack Query, invalidation triggers a refetch of all active queries matching the key. Here, it just deletes the cache entry."
- **Comparable:** TanStack Query maintains an active query registry and triggers refetch on invalidation. SWR uses a global mutate that notifies all hooks using the same key.

**Issue 7: Portal tag not handled by the reconciler**
- **Who flagged it:** Senior
- **Impact:** Using `Portal` creates an unknown HTML element `<__portal>` in the DOM instead of rendering children into the target container. Modals, tooltips, and dropdowns that need to escape their parent's DOM position are broken.
- **Evidence:** Senior: "`helpers.js` returns `{ tag: '__portal', props: { container }, children, _vnode: true }` but `dom.js` has no case for `__portal` tags."
- **Comparable:** React's `createPortal`, Solid's `Portal`, Vue's `Teleport` -- all mount children into an external container.

---

### HIGH (Significantly Hurts DX / Adoption)

**Issue 8: No JSX support**
- **Who flagged it:** Both
- **Impact:** Every component must be authored with `h()` calls, which both developers independently describe as the biggest DX pain point. The `html` tagged template exists but is undocumented in practice and cannot reference component functions.
- **Evidence:** Senior: "The `h()` API is fine as a compile target but painful as an authoring experience." Junior: "Writing `h()` calls all day is miserable for building real UIs."
- **Comparable:** Preact offers both `h()` and JSX via a Babel plugin. Solid uses JSX. Svelte has its own template syntax. No modern framework forces raw `createElement`-style calls as the primary authoring experience.

**Issue 9: Three state primitives with no guidance**
- **Who flagged it:** Both
- **Impact:** Developers do not know whether to use `signal()`, `useState()`, or `useSignal()`. The documentation uses all three interchangeably, creating confusion from minute one.
- **Evidence:** Junior: "Which one am I supposed to use? This is the first thing I read and I already do not know which approach to take." Senior demonstrates that `useState` has a stale-value footgun that is undocumented.
- **Comparable:** Solid has `createSignal` as the one way. React has `useState` as the one way. Vue has `ref`/`reactive` with clear guidance.

**Issue 10: Framework not published to npm**
- **Who flagged it:** Junior
- **Impact:** The standard onboarding flow (`npx create-what my-app && npm install && npm run dev`) does not work. The scaffolded project references `"what": "^0.1.0"` which does not exist on npm.
- **Evidence:** Junior: "Until `npm install what` works, the framework does not exist for most developers."
- **Comparable:** Every competitor (`npm install react`, `npm create vite`, `npx create-next-app`) works out of the box.

**Issue 11: Import path inconsistency**
- **Who flagged it:** Both
- **Impact:** Three different import paths (`'what'`, `'@what/core'`, `'@aspect/core'`) for the same package, with silent CLI rewriting. Developers cannot tell which is correct.
- **Evidence:** Junior: "This is three different names for the same thing and it is deeply confusing during development."
- **Comparable:** React is always `'react'`. Solid is always `'solid-js'`. One name, everywhere.

**Issue 12: The `() => value()` reactive wrapper is undocumented**
- **Who flagged it:** Both
- **Impact:** The most important concept in the framework -- how to make text children reactive -- is never explicitly taught. Developers discover it by accident, and getting it wrong produces silent failures.
- **Evidence:** Junior: "This is the most important concept and it is currently undiscovered by accident." Senior notes that the docs are internally inconsistent about when the wrapper is needed.
- **Comparable:** Solid's JSX handles this transparently. Svelte's template syntax handles this transparently. Vue's template syntax handles this transparently. Only raw `h()` calls require this manual wrapping.

**Issue 13: `useState` returns stale values (undocumented footgun)**
- **Who flagged it:** Senior (diagnosed), Junior (would encounter)
- **Impact:** `useState` reads the signal value synchronously and returns a snapshot. Inside event handlers, the value is stale -- it captures the value at render time. React has the same issue but documents it extensively with workarounds. What does not.
- **Evidence:** Senior: "The `s()` call inside the effect means it subscribes the component's effect to the signal. The returned `value` is a snapshot."
- **Comparable:** React documents this behavior and provides `useRef` and functional updaters as workarounds. Solid's `createSignal` returns a getter function that is always current.

**Issue 14: No component unmount cleanup**
- **Who flagged it:** Senior
- **Impact:** `mount()` returns an unmount function that does `container.textContent = ''`. No effects are disposed, no cleanup callbacks run, no child components are torn down. Long-running SPAs leak memory and event listeners.
- **Evidence:** Senior: "There is no traversal to dispose effects, run cleanup callbacks, or trigger `onCleanup` handlers."
- **Comparable:** React, Solid, Svelte, and Vue all have complete teardown chains on unmount.

**Issue 15: No DevTools**
- **Who flagged it:** Senior
- **Impact:** Debugging production issues requires inspecting component trees, signal values, effect dependencies, and re-render counts. Without DevTools, developers are "flying blind."
- **Evidence:** Senior: "Any non-trivial debugging requires DevTools."
- **Comparable:** React DevTools, Solid DevTools, Svelte DevTools, Vue DevTools -- all provide component tree inspection and state debugging.

---

### MEDIUM (Notable Gaps)

**Issue 16: No route-level data loading**
- **Who flagged it:** Senior
- **Impact:** Data fetching happens after component mount, causing a flash of loading state on every navigation. No mechanism to prefetch data before rendering.
- **Evidence:** Senior: "React Router has `loader`, SvelteKit has `load`, SolidStart has `routeData`. What's router has no way to prefetch data for a route before navigation completes."
- **Comparable:** Every modern meta-framework (Next.js, Remix, SvelteKit, SolidStart) has route-level data loading.

**Issue 17: Router middleware declared but never executed**
- **Who flagged it:** Senior
- **Impact:** Route configs accept `middleware` but the Router component never checks or executes them. Auth guards and other middleware are non-functional.
- **Evidence:** Senior: "The infrastructure is there (route config accepts middleware), but the Router component ignores it."

**Issue 18: No SSR hydration (mount blows away server HTML)**
- **Who flagged it:** Senior
- **Impact:** `mount()` clears the container with `textContent = ''`. Server-rendered HTML is destroyed and re-rendered from scratch on the client. This negates the SSR performance benefit.
- **Evidence:** Senior: "Currently `mount()` clears the container. Implement a `hydrate()` function that attaches to existing DOM."
- **Comparable:** React has `hydrateRoot`. Solid has `hydrate`. Both reconcile with existing DOM rather than replacing it.

**Issue 19: Memory: SWR/useQuery cache grows unbounded**
- **Who flagged it:** Senior (detailed), Junior (noted)
- **Impact:** The global cache `Map` has no TTL, no size limit, no garbage collection. Long-running SPAs accumulate cache entries indefinitely.
- **Evidence:** Senior: "The cache is a plain `Map` with no TTL or size limit. In a long-running SPA, this will grow unbounded." Junior: "For a real app with lots of data, this would be a memory leak."
- **Comparable:** TanStack Query has `cacheTime` with automatic garbage collection. SWR has configurable cache providers.

**Issue 20: No virtualized list support**
- **Who flagged it:** Senior
- **Impact:** Lists with more than ~100 items degrade performance. Chat apps, data tables, and infinite scroll are impractical.
- **Evidence:** Senior: "Any list over ~100 items needs windowing. `VirtualList`, `VirtualGrid`, `VirtualTable` components."
- **Comparable:** React has `react-window` and `react-virtuoso`. Solid has `solid-virtual`. Most frameworks have community or built-in windowing solutions.

**Issue 21: Error boundaries fail for async/effect errors**
- **Who flagged it:** Senior
- **Impact:** The error boundary is only on the stack during its own render. Effects that throw later (after initial render) are not caught by boundaries; they just `console.error`.
- **Evidence:** Senior: "If a child effect throws, the boundary is no longer on the stack."
- **Comparable:** React error boundaries catch all render and lifecycle errors. Solid's error boundaries catch errors from effects and computations.

**Issue 22: API surface overwhelm (120+ exports from core)**
- **Who flagged it:** Junior (explicitly), Senior (implicitly via comparison matrix)
- **Impact:** New developers face a wall of 120+ exports when they open the API docs. The framework appears complex despite positioning as lightweight.
- **Evidence:** Junior: "The framework exports approximately 120+ symbols from the core package alone. For comparison, React's core exports about 20." She provides a proposed split into core (~25 exports) and optional subpath imports.
- **Comparable:** React core: ~20 exports. Solid core: ~30 exports. Svelte core: ~15 exports.

**Issue 23: No error messages for silent failures**
- **Who flagged it:** Junior
- **Impact:** Forgetting `() =>` wrapper, forgetting `()` on signal reads in conditionals, and passing a signal function where a value is expected all fail silently. No warnings, no errors, just incorrect behavior.
- **Evidence:** Junior: "What happens when I forget the `() =>` wrapper and my UI does not update? No error. Silent failure. I would stare at my code for an hour."
- **Comparable:** React has extensive development mode warnings. Solid warns about common mistakes. Vue has helpful runtime warnings.

---

### LOW (Polish & Nice-to-Have)

**Issue 24: No HMR support**
- **Who flagged it:** Senior
- **Impact:** Every code change requires a full page reload, losing all component state. Slows development iteration.

**Issue 25: `Spinner` injects `<style>` inside `<svg>`**
- **Who flagged it:** Senior
- **Impact:** Invalid SVG markup. Most browsers tolerate it, but it fails validation.

**Issue 26: `useRovingTabIndex` takes static `itemCount`**
- **Who flagged it:** Senior
- **Impact:** Dynamic lists (adding/removing items) break keyboard navigation.

**Issue 27: No CSS scoping solution**
- **Who flagged it:** Senior (mentioned), Junior (felt in practice)
- **Impact:** No built-in way to scope styles to components. The demo uses inline styles everywhere.

**Issue 28: Missing `watch` with callback in `useForm`**
- **Who flagged it:** Senior
- **Impact:** Cannot run side effects when a specific form field changes without creating a separate `effect`.

**Issue 29: No playground / REPL**
- **Who flagged it:** Junior
- **Impact:** Potential users cannot try the framework without installing it (which currently does not work anyway).

**Issue 30: Documentation needs a React migration guide**
- **Who flagged it:** Junior
- **Impact:** React developers (the primary target audience based on the API) have no bridging material. A side-by-side comparison page would cut learning time significantly.

**Issue 31: `show()` vs `Show`, `each()` vs `For` vs `.map()` -- duplicate APIs without guidance**
- **Who flagged it:** Junior
- **Impact:** Three ways to conditionally render, three ways to render lists, with no explanation of when to use which. Adds to the "too many APIs" problem.

---

## Strengths Worth Preserving

The designer should NOT change these -- both developers praised them.

1. **The signal system's core design.** Clean, correct, lazy computeds, automatic dependency tracking. Senior rates it 8/10 and calls it "implemented with admirable conciseness." Junior calls auto-tracking "genuinely superior" to React's dependency arrays.

2. **The islands architecture.** Senior rates it 9/10 -- "best-in-class for a non-Astro framework." Priority-based hydration, shared island stores, six hydration modes, and `boostIslandPriority` are unique innovations. Junior appreciates it as first-class rather than requiring a meta-framework.

3. **Bundle size ambition.** Both developers find the ~4kB claim compelling and important for the framework's positioning.

4. **`useForm` with built-in validation rules.** Both developers appreciate not needing a separate form library. The React Hook Form-like API is familiar and productive.

5. **`computed()` laziness.** Both developers note that lazy evaluation (only recompute when read) is smarter than React's `useMemo` (runs on every render where deps change). The junior specifically says this "would save me hours of debugging."

6. **The philosophical positioning.** "The closest framework to vanilla JS" is a clear, compelling tagline. Both developers understand the value proposition immediately.

7. **Accessibility utilities.** The senior rates them 8/10 -- "comprehensive built-in a11y utilities." Focus trap, roving tab index, screen reader announcements, and ARIA helpers are unusually complete for a framework this size.

8. **Physics-based animation.** Springs, tweens, gesture handling, and easings are well-implemented. The senior rates animations 7/10.

---

## The Core Tension

Based on both reviews, the What Framework's central tension is:

**It markets itself as "the closest framework to vanilla JS" with fine-grained signal reactivity, but its implementation delivers React-level component re-renders through a React-like hooks API, without React's ecosystem, tooling, or documentation maturity.**

The framework is caught between two identities:

- **Identity A: "Better React"** -- React-compatible hooks (`useState`, `useEffect`, `useMemo`), familiar patterns, easy migration from React. The junior is drawn to this identity.
- **Identity B: "Vanilla JS with Signals"** -- No build step, raw `h()` calls, signal-first reactivity, islands architecture, progressive enhancement. The tagline and philosophy describe this identity.

The problem is that Identity A requires the framework to be as polished and correct as React (which it is not -- stale values in `useState`, broken lifecycle, missing DevTools). And Identity B requires the authoring experience to be pleasant without JSX (which it is not -- `h()` calls are universally criticized).

The islands architecture is where these identities converge successfully: static HTML with selective hydration using signals. Both developers independently identified islands as the framework's strongest contribution. The designer should consider whether the core framework positioning should be **"the best islands framework"** rather than **"a React alternative."**

---

## Questions for the Framework Designer

Based on both reviews, these decisions need the designer's input:

1. **JSX: Will you add it?** Both developers independently identified `h()` as the #1 adoption barrier. A Vite/Babel plugin would address this without compromising the "no build step" option. Is the philosophical commitment to no-compile more important than adoption? Would promoting the `html` tagged template as the primary authoring experience (with examples everywhere) be an acceptable middle ground?

2. **Which state primitive is canonical?** `signal()`, `useState()`, or `useSignal()`? The docs need to pick one for the primary narrative and clearly explain when to use the others. What is the recommended path for React migrants vs new users?

3. **Should the rendering model be component-level or fine-grained?** The current implementation re-renders entire components on any signal change (like React). The marketing says "fine-grained updates that skip the virtual DOM." Which is the intended behavior? If fine-grained is the goal, the rendering pipeline needs a redesign.

4. **Should built-in features stay in core or become separate packages?** The junior suggests moving animation, a11y, skeleton, data fetching, and forms into subpath exports. The senior evaluates each on its merits but notes many are half-implemented. Is it better to ship a small, solid core and grow, or ship everything and iterate?

5. **What is the production readiness timeline?** The senior identifies 7 "must fix before v1" items and rates production readiness 2/10. The junior says "not today, but maybe in 6 months." What is the realistic path to a stable release that addresses the critical bugs?

6. **Who is the target user?** React developers who want something lighter? Astro users who want a more integrated component model? Vanilla JS developers who want structure? The answer to this question should determine which API is primary, which docs come first, and which features are prioritized.

7. **Islands as the primary selling point?** Both developers rated islands as the strongest feature. Should the framework reposition around islands (competing with Astro) rather than as a general-purpose React alternative?

8. **`html` tagged template: invest or abandon?** It could solve the `h()` pain without a build step, but it currently cannot reference component functions and has no examples in the docs. Is it worth investing in, or should JSX be the answer?

9. **What is the error/warning strategy for development mode?** The junior identified multiple silent-failure scenarios. Will there be a dev mode with verbose warnings (like React's development build)?

10. **npm publishing timeline?** The junior says the framework "does not exist for most developers" until it is on npm. When will the packages be published, and under what names (`what` vs `@what/*`)?

---

## Raw Metrics

- **Senior overall rating:** 5.5/10
- **Junior "would I use this":** Not today, maybe in 6 months (conditional on JSX support, npm publishing, and doc cleanup)
- **Number of critical bugs found:** 7 (all by senior: lifecycle not invoked, component re-creation, broken context, island hooks, createResource bug, broken cache invalidation, Portal not handled)
- **Number of high DX issues found:** 7 (by both: no JSX, three state primitives, undocumented reactivity pattern, import confusion, not on npm, stale useState, no DevTools)
- **Number of medium issues found:** 8
- **Number of low/polish issues found:** 8+
- **Top comparison frameworks mentioned:** React (both, extensively), SolidJS (senior), Svelte/SvelteKit (senior), Astro (both), TanStack Query (both), React Hook Form (both), SWR (junior)
- **Senior's highest-rated aspect:** Islands Architecture (9/10) and Bundle Size (9/10)
- **Senior's lowest-rated aspect:** Production Readiness (2/10) and Component Model (3/10)
- **Junior's most frequent frustration:** `h()` function nesting (mentioned 8+ times)
- **Junior's strongest praise:** No dependency arrays / automatic tracking
