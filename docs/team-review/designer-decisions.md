# Framework Designer Response -- What Framework

**Author**: Framework Designer
**Date**: 2026-02-10
**In response to**: Senior Developer Review, Junior Developer Review, Feedback Synthesis

---

## CORRECTION: JSX Support Already Exists

**The team review missed a critical package.** `packages/compiler/` contains a full JSX compilation pipeline that was already built:

- **`packages/compiler/src/babel-plugin.js`** — Full JSX-to-DOM transform with:
  - Signal auto-unwrapping (wraps expressions in arrow functions automatically)
  - Event modifiers (`onClick|preventDefault`, `onClick|stopPropagation`)
  - Two-way binding (`bind:value`, `bind:checked`)
  - Island directives (`client:load`, `client:idle`, `client:visible`, `client:interaction`, `client:media`)
  - Control flow component optimization (`Show`, `For`, `Switch`, `Match`)
  - SVG element support
  - Spread attribute handling

- **`packages/compiler/src/vite-plugin.js`** — Vite integration processing `.jsx`/`.tsx` files

- **`packages/compiler/src/runtime.js`** — A fine-grained DOM runtime that:
  - Creates individual reactive text nodes via `createReactiveText()` (NOT component-level re-renders)
  - Creates individual reactive property bindings via `bindProperty()` (per-attribute effects)
  - This is the fine-grained reactivity model the senior dev was requesting

**Issues this resolves from the review:**
- Issue 8 (No JSX support) — **Already solved.** The Babel plugin transforms JSX to optimized DOM calls.
- The `() => value()` footgun — **Already solved.** The Babel plugin's `mightBeSignal()` auto-wraps reactive expressions.
- Component-level re-renders — **Partially solved.** The compiler runtime uses per-node effects, not component-level effects. However, this is a separate runtime from `packages/core/src/dom.js`. The two need to be reconciled.
- `bind:value` two-way binding — **Already implemented** in the compiler, a feature not yet in core.
- Island directives in JSX (`client:idle`) — **Already implemented** in the Babel plugin.

**Remaining gaps:**
- The compiler runtime (`runtime.js`) and the core runtime (`dom.js`) are two separate systems that need unification
- The demo app and docs don't use JSX — they should be updated to show JSX as the primary authoring experience
- The compiler runtime's `_createComponent` uses `untrack(() => Component(props))` which means components run outside the reactive system — hooks won't work here either (same island bug)

---

## My Vision (Restated)

The original vision was: "The closest framework to vanilla JS." After reading both reviews line by line, I am not changing the vision. I am sharpening it.

The reviews confirmed what I suspected but had not fully articulated: the vision is correct, but the execution is trying to serve two masters. The framework wants to be "vanilla JS with superpowers" while also being "React but lighter." Those are not the same thing, and the places where both reviewers experienced the most pain are exactly the places where those two goals collide.

Here is the sharpened vision:

**What is a signals-first framework for building progressively enhanced websites. It is not a React replacement. It is what you use when you want mostly static HTML with islands of interactivity, fine-grained reactivity without a virtual DOM re-render cycle, and the smallest possible JavaScript footprint. It is for people who think React sends too much JavaScript to the client and who want to stay close to the platform.**

What has changed in my thinking:

1. **The React compatibility hooks were a mistake in emphasis, not in existence.** They should exist for incremental adoption. They should not be the first thing anyone sees. The framework's identity is signals, not hooks.

2. **The "no build step" philosophy was too rigid.** The correct position is: "works without a build step, great with one." JSX support is coming. The `h()` function will become a compile target, not the primary authoring surface.

3. **The bundle size claim needs to be honest.** The core (signals + h + mount + components) is genuinely tiny. The "batteries included" modules are separate packages. The README should reflect what you actually ship, not a theoretical minimum.

4. **Islands are the identity.** Both reviewers independently confirmed this. The framework should lead with islands architecture and signals-based partial hydration. That is the unique contribution. "Better React" is not -- React is already good at being React.

---

## Identity Resolution

The synthesis correctly identified the core tension:

> Identity A: "Better React" -- React-compatible hooks, familiar patterns, easy migration.
> Identity B: "Vanilla JS with Signals" -- No build step, raw signals, islands architecture, progressive enhancement.

**My answer: Identity B, unambiguously. But with a bridge for React developers.**

Here is why Identity A is wrong for this framework:

- Being "Better React" requires React's level of ecosystem maturity, documentation quality, DevTools, and community. We are years away from that, and it is not the right race to run.
- The senior developer demonstrated exactly why: `useState` returns stale values, `useEffect` cleanup never runs, the component model re-renders like React but without React's optimizations. Claiming to be "React but better" while being worse at the things React is good at destroys trust.
- The junior developer was drawn to the React-familiar API, but her trust would erode the moment she hit the `useState` stale-value footgun or discovered that "fine-grained updates" was marketing language for component-level re-renders.

Here is why Identity B is right:

- The islands architecture is rated 9/10 by the senior developer. It is genuinely novel -- priority-based hydration, shared island stores, six hydration modes. No other non-meta-framework offers this.
- The signal system is rated 8/10. Clean, correct, lazy computeds, automatic dependency tracking. This is the real primitive.
- The "ship less JavaScript" positioning is honest and differentiated. React cannot credibly claim this.
- The "no build step required" positioning is unique among modern frameworks.

**Who is What for?**

1. **Primary audience**: Developers building content-heavy sites (marketing pages, e-commerce, documentation, blogs) who want islands of interactivity with minimal JavaScript. They may be coming from Astro, Eleventy, or vanilla JS. They value performance and progressive enhancement.

2. **Secondary audience**: React developers who are tired of the bundle size, the memoization ceremony, and the dependency array footguns, and who are building new projects where they can choose the stack. They want something familiar enough to be productive but fundamentally simpler.

3. **Not our audience (for now)**: Teams building large enterprise SPAs with complex state management, hundreds of components, and existing React component library dependencies. React, Solid, or Svelte serve them better today.

The bridge for React developers: React-compatible hooks will remain as an optional import (`what/compat` or `what/hooks`), clearly documented as a migration aid, not the primary API. The primary API is signals, and every example in the docs will use signals.

---

## Response to Critical Issues

### Bug Fixes (Non-Negotiable)

These are bugs. They are not design decisions. They are broken code that must be fixed before any adoption push.

---

**Bug 1: `onMount` and `onCleanup` callbacks are never invoked**

- **Fix**: After the component's initial render in `createComponent`, iterate `ctx._mountCallbacks` and invoke each one. On component disposal (new: implement a proper disposal chain), iterate `ctx._cleanupCallbacks` and invoke each one. The `ctx.mounted` flag is already set to `true` but nothing reads `_mountCallbacks` afterward -- add that read immediately after `ctx.mounted = true` in the initial mount branch.
- **Scope**: Small. ~15 lines of code in `dom.js`.
- **Priority**: Immediate. This is a ship-blocking bug. Any component that sets up a subscription, timer, or event listener is broken.

---

**Bug 2: Component re-creation on every reconciliation**

- **Fix**: In `patchNode`, when encountering a component VNode (`typeof vnode.tag === 'function'`), check if the existing DOM node's associated component has the same constructor function. If so, update props and let the reactive system handle the re-render. Only create a new component if the constructor changed. This requires storing the component context on the marker comment node (or a WeakMap from DOM node to component context) so we can find it during reconciliation.
- **Scope**: Medium-large. This touches `patchNode`, `createComponent`, and requires a component instance registry. Estimated 50-80 lines of new code plus refactoring.
- **Priority**: Immediate. Without this fix, any parent re-render destroys all child component state. This makes the framework unusable for any stateful component tree.

---

**Bug 3: Context system is globally scoped**

- **Fix**: Replace the global `ctx._value` approach with a component-stack-based lookup. Each `Provider` pushes a value onto a context-specific stack during render and pops after. `useContext` walks the component stack (or an owner chain) to find the nearest Provider. This is how Solid does it. Implementation: during `createComponent`, store a reference to the parent component context. `useContext` walks up this chain looking for a matching provider.
- **Scope**: Medium. Requires changes to `createContext`, `useContext`, `createComponent` (to track parent context), and the Provider component. Estimated 40-60 lines.
- **Priority**: Immediate. Nested providers (theme context, auth context, locale context) are fundamental to any real application.

---

**Bug 4: Island components cannot use hooks**

- **Fix**: Change `mount(Component({ ...props, ...storeProps }), el)` to `mount(h(Component, { ...props, ...storeProps }), el)` in the islands hydration code. This routes the component through `createComponent` in `dom.js`, which sets up the component context and pushes to `componentStack`. The component can then call hooks normally.
- **Scope**: Small. One line change in `islands.js`, plus a test to verify hooks work inside islands.
- **Priority**: Immediate. Islands are our best feature. They must be able to use the core API.

---

**Bug 5: `createResource` error handler compares wrong variable**

- **Fix**: Change `if (currentFetch === fetcher)` to `if (currentFetch === fetchPromise)` on line 217 of `hooks.js`. The `fetcher` is the function, not the promise. The `currentFetch` variable stores the promise, so the comparison should be against `fetchPromise`.
- **Scope**: Tiny. One-line fix.
- **Priority**: Immediate.

---

**Bug 6: Cache invalidation does not notify active queries**

- **Fix**: Introduce an active query registry. When `useQuery` or `useSWR` mounts, register the query key and a refetch callback in a module-level `Map`. When the component unmounts (once we fix disposal), unregister. `invalidateQueries(key)` then: (1) deletes the cache entry, and (2) iterates the active registry and calls `refetch()` on every entry whose key matches. This is the TanStack Query pattern, simplified.
- **Scope**: Medium. New registry data structure, registration/unregistration in `useQuery`/`useSWR`, and updated `invalidateQueries`. Estimated 30-40 lines.
- **Priority**: This week. Data fetching is broken without this, but it is less immediately catastrophic than the lifecycle and component bugs.

---

**Bug 7: Portal tag not handled by the reconciler**

- **Fix**: In `createDOM` in `dom.js`, add a case for `vnode.tag === '__portal'`: extract the `container` from `vnode.props`, create children via `createDOM`, and append them to the portal container instead of the current parent. In `patchNode`, handle `__portal` similarly.
- **Scope**: Small-medium. ~20 lines in `dom.js`.
- **Priority**: This week.

---

### Design Decisions

---

**Issue 8: No JSX support**

- **Decision**: ACCEPT
- **Reasoning**: Both developers independently identified this as the number one adoption barrier. The senior called it "fine as a compile target but painful as an authoring experience." The junior said "if this framework does not get JSX support, adoption will be severely limited." They are both right. My original commitment to "no compiler needed" was correct in spirit but wrong in application. The framework should work without a compiler. It should not require developers to suffer without one.
- **Implementation**: Ship a `vite-plugin-what` that transforms JSX to `h()` calls. Use `jsxFactory: 'h'` and `jsxFragment: 'Fragment'` in the esbuild/Babel config. This is the same approach Preact uses (`@preact/preset-vite`). The plugin is optional -- `h()` remains the underlying API and works without any build step. The `html` tagged template remains as a second no-build option.
- **Trade-offs**: We gain massive DX improvement and adoption potential. We lose the purity of "no build step needed" as the default path, but we preserve it as an option. This is the right trade.

---

**Issue 9: Three state primitives with no guidance**

- **Decision**: ACCEPT WITH MODIFICATION
- **Reasoning**: Both reviewers are right that the docs are incoherent about which primitive to use. But I disagree with the junior's suggestion to "lead with `useState`." Leading with `useState` doubles down on Identity A ("Better React"), which is the wrong identity. The correct answer: lead with `signal()` everywhere. `useSignal()` is the in-component version. `useState()` moves to `what/compat` and is documented as a migration aid.
- **Implementation**:
  - Primary API (docs, README, all examples): `signal()` for global state, `useSignal()` for component-scoped state, `computed()` for derived values.
  - Migration aid (`what/compat`): `useState`, `useReducer`, `useCallback`, `useMemo`. Documented in a "Coming from React" guide with clear warnings about behavioral differences (stale values in `useState`, etc.).
  - The `useComputed()` hook is redundant with `computed()` -- remove it from the primary API. If you need a computed inside a component, use `computed()` directly. The hook slot tracking adds nothing.
- **Trade-offs**: React developers will see an unfamiliar API on first contact. But the junior herself acknowledged that `computed()` is "genuinely superior" to `useMemo`, and "no dependency arrays" is her number one praise. We should lean into what is actually better, not what is merely familiar.

---

**Issue 10: Framework not published to npm**

- **Decision**: ACCEPT
- **Reasoning**: The junior is right: "until `npm install what` works, the framework does not exist for most developers." There is no counter-argument to this.
- **Implementation**: Publish packages under the `what` scope: `what` (core), `what-router`, `what-server`, `what-cli`, `create-what`. Reserve the npm names immediately. Target: within 2 weeks.
- **Trade-offs**: None. This is table stakes.

---

**Issue 11: Import path inconsistency**

- **Decision**: ACCEPT
- **Reasoning**: Three names for the same package is indefensible. The junior is right that this is "deeply confusing."
- **Implementation**: The canonical import is `what`. The router is `what-router` (or `what/router` via package.json exports). The server is `what-server` (or `what/server`). Remove all references to `@what/core` and `@aspect/core` from user-facing code. The CLI import rewriting should map `what` to the local dev server path transparently.
- **Trade-offs**: Breaking change for anyone using the current `@aspect/core` import. Acceptable since we are pre-1.0 and effectively have zero external users.

---

**Issue 12: The `() => value()` reactive wrapper is undocumented**

- **Decision**: ACCEPT
- **Reasoning**: This is the most important concept in the framework and it is learned by accident. That is a documentation failure, not a design failure. The pattern is inherent to signal-based reactivity with an `h()` function -- you need a thunk to create a reactive binding. JSX support will partially solve this (the JSX transform can automatically wrap signal reads), but the concept still needs to be explicitly taught.
- **Implementation**:
  - Add a prominent "Reactive Expressions" section to the QUICKSTART, immediately after introducing signals. Title it: "Making the DOM React to Signals."
  - Show the three patterns: static value, reactive text (`() => count()`), reactive prop (`style: () => ({...})`).
  - Explain WHY: "When you pass a function as a child or prop value, What calls it inside a reactive effect. When any signal read inside that function changes, What updates just that DOM node."
  - With JSX support, the JSX transform should handle this transparently for expression children: `<p>{count()}</p>` compiles to `h('p', null, () => count())`.
- **Trade-offs**: None. Pure documentation improvement plus JSX ergonomics.

---

**Issue 13: `useState` returns stale values (undocumented footgun)**

- **Decision**: ACCEPT WITH MODIFICATION
- **Reasoning**: The senior correctly diagnosed this. But rather than documenting workarounds for a broken API, the fix is to de-emphasize `useState` in favor of `useSignal`, which does not have this problem because you always call the getter fresh. `useState` moves to `what/compat` with a clear warning.
- **Implementation**: In the `what/compat` documentation for `useState`, add a prominent callout: "Unlike React, the value returned by `useState` is a snapshot captured at render time. For always-current values, use `useSignal()` instead, which returns a getter function." Provide a migration example.
- **Trade-offs**: React developers lose the familiar `[value, setter]` destructuring as the primary pattern. But `useSignal()` returning a signal object is actually simpler -- you read with `sig()`, write with `sig.set()`. No stale closures. No tuple destructuring. This is the better API.

---

**Issue 14: No component unmount cleanup**

- **Decision**: ACCEPT
- **Reasoning**: The senior is right that `container.textContent = ''` is not cleanup. It is amputation.
- **Implementation**: Implement a proper disposal chain:
  1. When `createComponent` creates a component context, store the dispose function and all child effect dispose functions.
  2. When a component is removed from the DOM (via reconciliation or unmount), call `dispose()` on the component's reactive effect, then iterate `ctx.cleanups` and call each one, then iterate `ctx._cleanupCallbacks` and call each one.
  3. `mount()` returns an unmount function that walks the component tree and properly disposes everything, then clears the container.
  4. Effect parent-child tracking: when an effect creates a child effect (inside `createComponent`), store the child's dispose function on the parent. Disposing a parent disposes all children.
- **Scope**: Medium-large. This is intertwined with Bug 1 (lifecycle callbacks) and Bug 2 (component re-creation). All three should be implemented together.
- **Priority**: Immediate. Part of the same "fix the component model" sprint as Bugs 1-3.

---

**Issue 15: No DevTools**

- **Decision**: DEFER
- **Reasoning**: DevTools are essential for production adoption. But they are a large investment and the framework's core rendering model needs to be fixed first. Building DevTools on top of a broken component model would mean rebuilding them after the fixes. Ship the foundation fixes first, then DevTools.
- **Timeline**: Phase 4. After foundation fixes, DX improvements, and documentation.
- **Intermediate solution**: Add a `__WHAT_DEV__` global that, when enabled, logs component renders, signal writes, and effect executions to the console in a structured format. This is cheap to implement and covers 60% of the debugging use case.

---

**Issue 16: No route-level data loading**

- **Decision**: ACCEPT
- **Reasoning**: The senior is right that every modern framework has this. Without it, every navigation causes a loading flash.
- **Implementation**: Add a `loader` property to route definitions:
  ```js
  defineRoutes({
    '/users/:id': { component: UserProfile, loader: ({ params }) => fetchUser(params.id) },
  });
  ```
  The router calls `loader` before rendering the component. The result is passed as a `data` prop to the component. Combine with `Suspense` for loading states during navigation.
- **Scope**: Medium. Changes to the router's navigation logic, plus integration with Suspense.
- **Priority**: Phase 2.

---

**Issue 17: Router middleware declared but never executed**

- **Decision**: ACCEPT
- **Reasoning**: Dead code that accepts configuration and does nothing is worse than not having the feature. Either implement it or remove the config option.
- **Implementation**: Implement middleware execution in the Router component. Before rendering a route, iterate its `middleware` array and call each one with `{ params, query, next }`. If any middleware does not call `next()` or calls `redirect()`, the navigation is aborted or redirected. This covers auth guards, role checks, and analytics.
- **Scope**: Small-medium. ~30 lines in the router.
- **Priority**: Phase 2.

---

**Issue 18: No SSR hydration**

- **Decision**: ACCEPT
- **Reasoning**: `mount()` clearing the container negates SSR benefits. A `hydrate()` function is essential.
- **Implementation**: Add `hydrate(vnode, container)` that walks the existing DOM and attaches reactive bindings without recreating elements. For each element, compare the vnode tag and props against the existing DOM node. Attach event handlers and reactive effects. Only replace nodes where there is a mismatch.
- **Scope**: Large. This is a significant addition to `dom.js` and requires careful handling of text nodes, component boundaries, and mismatches.
- **Priority**: Phase 2. Islands partially solve this (they hydrate individual containers), but full-page hydration is needed for SSR-rendered SPAs.

---

**Issue 19: SWR/useQuery cache grows unbounded**

- **Decision**: ACCEPT
- **Reasoning**: Both reviewers flagged this. An unbounded Map is a memory leak in long-running SPAs.
- **Implementation**: Add `cacheTime` option (default: 5 minutes) to `useSWR` and `useQuery`. When a query is no longer active (no mounted components reading it), start a timer. After `cacheTime`, delete the entry. Also add a `maxCacheSize` option with LRU eviction as a safety valve.
- **Scope**: Small-medium. Timer management plus LRU logic. ~40 lines.
- **Priority**: Phase 2.

---

**Issue 20: No virtualized list support**

- **Decision**: DEFER
- **Reasoning**: Valid need, but this is a feature that can be a separate package (`what-virtual`) rather than a core concern. The core framework should not grow to include virtualization before the fundamentals are solid. Community libraries like `react-window` emerged for React -- the same pattern can work here.
- **Timeline**: Phase 4 or community contribution.

---

**Issue 21: Error boundaries fail for async/effect errors**

- **Decision**: ACCEPT
- **Reasoning**: The senior correctly identified that the boundary is only on the stack during its own render. Effects that throw later are not caught.
- **Implementation**: When creating a component's reactive effect, store a reference to the nearest error boundary from the boundary stack at component creation time (not at error time). When the effect throws, report to that stored boundary reference. This decouples error reporting from the synchronous render stack.
- **Scope**: Small-medium. Changes to `createComponent` and the effect wrapper. ~20 lines.
- **Priority**: This sprint (Phase 1).

---

**Issue 22: API surface overwhelm (120+ exports from core)**

- **Decision**: ACCEPT WITH MODIFICATION
- **Reasoning**: The junior is right that 120+ exports is overwhelming. Her proposed split is largely correct. However, I will go further than she suggested.
- **Implementation**: See "API Surface Reduction" section below.

---

**Issue 23: No error messages for silent failures**

- **Decision**: ACCEPT
- **Reasoning**: Silent failures are the worst kind of bug. The junior's prediction of the "forgot `() =>` wrapper" debugging session is exactly what will happen to every new user.
- **Implementation**: Add a development mode (`__WHAT_DEV__`) that:
  - Warns when a function is rendered as a text child instead of being called (likely a forgotten `() =>` wrapper becomes just a function reference).
  - Warns when a signal function is used in a boolean context without being called (`if (isLoading)` instead of `if (isLoading())`).
  - Warns when hooks are called in different order between renders (rules of hooks violation).
  - Warns when a component re-renders more than 50 times in 1 second (likely infinite loop).
  - These checks are stripped in production builds by dead-code elimination on the `__WHAT_DEV__` constant.
- **Scope**: Medium. Scattered checks across `dom.js`, `hooks.js`, and `h.js`.
- **Priority**: Phase 2.

---

**Issue 24: No HMR support**

- **Decision**: DEFER
- **Reasoning**: HMR requires deep integration with the bundler and the component model. Fix the component model first, then build HMR on top of it.
- **Timeline**: Phase 3-4.

---

**Issue 25: `Spinner` injects `<style>` inside `<svg>`**

- **Decision**: ACCEPT
- **Reasoning**: Invalid SVG markup. Easy fix.
- **Implementation**: Move the keyframe style injection to a document-level `<style>` tag (same as the skeleton styles), not inside the SVG.
- **Scope**: Tiny.
- **Priority**: Phase 1 (as part of general bug fixes).

---

**Issue 26: `useRovingTabIndex` takes static `itemCount`**

- **Decision**: ACCEPT
- **Reasoning**: Dynamic lists are common. The hook should accept a signal or getter.
- **Implementation**: Accept either a number or a function. If function, call it to get the current count.
- **Scope**: Tiny.
- **Priority**: Phase 2.

---

**Issue 27: No CSS scoping solution**

- **Decision**: DEFER
- **Reasoning**: CSS scoping is a solved problem with CSS Modules, CSS-in-JS libraries, or even just BEM conventions. The framework should not prescribe a styling solution at this stage. Instead, document recommended approaches and provide examples.
- **Implementation**: Add a "Styling" section to the docs showing: (1) CSS Modules with Vite, (2) inline styles with reactive signals, (3) the built-in `cls()` utility for conditional classes. No built-in CSS-in-JS.
- **Timeline**: Phase 3 (documentation).

---

**Issue 28: Missing `watch` with callback in `useForm`**

- **Decision**: DEFER
- **Reasoning**: Valid but not critical for v1. Users can achieve this with `effect(() => { const val = formValues().fieldName; callback(val); })`.
- **Timeline**: Post v1.

---

**Issue 29: No playground / REPL**

- **Decision**: ACCEPT
- **Reasoning**: The junior is right that a playground is the fastest path to adoption. "Try without installing" reduces friction to near zero. This is especially important since the framework is not yet on npm.
- **Implementation**: Build a web-based playground using a similar approach to the Solid playground -- an in-browser editor with a preview pane. Since What works without a build step, the playground can be simpler than most: just eval the code in an iframe with the framework loaded via a script tag.
- **Scope**: Medium-large as a standalone project.
- **Priority**: Phase 3.

---

**Issue 30: Documentation needs a React migration guide**

- **Decision**: ACCEPT
- **Reasoning**: React developers are the secondary audience. A migration guide cuts learning time significantly.
- **Implementation**: Create a "Coming from React" doc page with side-by-side comparisons for 10 common patterns: state, effects, context, memoization, refs, lists, conditional rendering, forms, data fetching, and routing.
- **Scope**: Medium (documentation effort).
- **Priority**: Phase 3.

---

**Issue 31: `show()` vs `Show`, `each()` vs `For` vs `.map()` -- duplicate APIs**

- **Decision**: ACCEPT WITH MODIFICATION
- **Reasoning**: Both reviewers are confused by duplicate APIs. But I disagree with removing them entirely. The function forms (`show()`, `each()`) are useful for inline usage without creating component overhead. The component forms (`Show`, `For`) are useful in JSX templates.
- **Implementation**: The docs will clearly recommend:
  - Use `Show` and `For` as the primary APIs (they work naturally in both `h()` and JSX).
  - `show()` and `each()` are documented as "utility alternatives for inline use" in the helpers section, not in the main tutorial.
  - `.map()` with a reactive wrapper is documented as "how it works under the hood" in an advanced section.
  - Remove `show()` and `each()` from the primary `what` import. Move them to `what/helpers` or keep them unexported.
- **Trade-offs**: Slightly larger core API, but with clear guidance. One way to do things in the tutorial, alternatives in the reference docs.

---

## Answers to the Team's Questions

### Question 1: JSX -- Will you add it?

**Yes.** We will ship `vite-plugin-what` that transforms JSX to `h()` calls. The philosophical commitment to "no build step" remains -- the framework works without a compiler, via `h()` calls or the `html` tagged template. But the recommended developer experience will be JSX via Vite.

The `html` tagged template will also be improved (see Question 8), but JSX is the primary authoring experience going forward.

This does not compromise the "no compiler needed" promise. It reframes it: "No compiler required. But we recommend one."

### Question 2: Which state primitive is canonical?

**`signal()` is canonical for global/module-scoped state. `useSignal()` is canonical for component-scoped state.**

- `signal()`: Use for state that lives outside components (stores, shared state, module-level state).
- `useSignal()`: Use for state inside a component (tied to component lifecycle).
- `computed()`: Use for derived values, anywhere.
- `useState()`: Moves to `what/compat`. Documented as "for React developers migrating incrementally." With a clear warning about stale values.
- `useComputed()`: Removed. Use `computed()` directly.

Every example in the README, QUICKSTART, and API docs will use `signal()`/`useSignal()`. The React hooks are mentioned once in a "Coming from React" section and imported from `what/compat`.

### Question 3: Should the rendering model be component-level or fine-grained?

**Fine-grained is the goal. The current component-level re-render is a bug, not a feature.**

The senior is right: wrapping every component in an `effect()` that re-runs the entire component function on any signal change is React's model, not the model we are marketing. The junior believed the marketing ("signals update only the exact DOM nodes that read them") and would be betrayed when she discovered the reality.

However, the fix is nuanced. True fine-grained reactivity (Solid's model) requires either a compiler that creates individual effects per expression, or a fundamentally different approach to how `h()` handles reactive children.

**The plan:**

Phase 1 (immediate): Fix component re-creation in `patchNode`. When a parent re-renders, reuse child component instances instead of recreating them. This alone eliminates the worst symptom (child state loss on parent re-render).

Phase 2: Make `h()` handle reactive children (functions) at the DOM level. When `h()` receives a function as a child, instead of evaluating it during the component render (which subscribes the component's effect), create a separate micro-effect that only updates that specific text node. This is how Solid's compiled JSX works, but we can do it at runtime in the `createDOM` function. Each `() => count()` child becomes its own independent effect that owns a single text node. This gives us fine-grained reactivity without a compiler.

Phase 3: Same treatment for reactive props. When a prop value is a function, create a micro-effect that updates just that attribute/style.

After Phase 3, the component's top-level effect only runs for structural changes (different children count, different component type). Signal changes that only affect text content or prop values update at the DOM node level. This matches the marketing promise.

**This is the single most important architectural change in the roadmap.**

### Question 4: Should built-in features stay in core or become separate packages?

**Separate packages with subpath exports.**

The core package (`what`) exports:
- Reactive primitives: `signal`, `computed`, `effect`, `batch`, `untrack`
- Virtual DOM: `h`, `Fragment`, `html`, `mount`
- Component utilities: `memo`, `lazy`, `Suspense`, `ErrorBoundary`, `Show`, `For`, `Switch`, `Match`
- Lifecycle: `onMount`, `onCleanup`
- Resource: `createResource`
- Utilities: `cls`, `Portal`
- Store: `createStore`

That is approximately 25 exports. Everything else moves to subpath exports:

- `what/data` -- `useFetch`, `useSWR`, `useQuery`, `useInfiniteQuery`, cache utilities
- `what/form` -- `useForm`, `useField`, `rules`, resolvers, form components
- `what/animation` -- `spring`, `tween`, `easings`, `useGesture`, `useTransition`
- `what/a11y` -- Focus management, ARIA helpers, keyboard navigation
- `what/skeleton` -- Loading state components
- `what/scheduler` -- DOM read/write scheduling
- `what/compat` -- React-compatible hooks (`useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `useReducer`, `useContext`, `createContext`)
- `what/testing` -- Testing utilities (already separated)

The `package.json` uses the `exports` field to define these subpath exports. Tree-shaking works at the module level. The bundle size claim becomes honest: "Core: ~2kB gzipped. With data fetching and forms: ~5kB. With everything: ~8kB."

### Question 5: What is the production readiness timeline?

**Realistic timeline to v0.5 (first usable release): 8-10 weeks.**

- Weeks 1-3: Foundation fixes (Bugs 1-7, component model overhaul)
- Weeks 4-5: Fine-grained reactivity (reactive children/props in `h()`)
- Weeks 6-7: JSX plugin, npm publishing, import path standardization
- Weeks 8-9: Documentation rewrite, API surface reorganization
- Week 10: v0.5.0 release with "alpha" label

**v1.0: 6-9 months from now.** Requires: DevTools, hydration, HMR, comprehensive test suite, real-world production usage by at least 2-3 projects, and a stable API that we commit to not breaking.

The senior rated production readiness 2/10. That is fair for today. After the Phase 1 fixes, I would expect 5/10. After v0.5, I would target 7/10. v1.0 should be 8/10.

### Question 6: Who is the target user?

Answered in the Identity Resolution section above. Primary: developers building content-heavy sites who want islands of interactivity. Secondary: React developers seeking lighter alternatives for new projects.

### Question 7: Islands as the primary selling point?

**Yes.** The README should lead with islands and progressive enhancement. The elevator pitch changes from "React alternative" to "the islands framework that feels like vanilla JS."

However, What is not just an islands framework. It is a full component framework that excels at islands. The distinction: Astro is a meta-framework that uses other frameworks (React, Svelte) for its islands. What is the framework itself -- you write your islands in What, and the islands architecture is native, not bolted on. Shared island stores, priority hydration, and six hydration modes are native features, not plugins.

The positioning: "Build websites with islands of interactivity. Ship zero JavaScript by default. Hydrate exactly what you need, when you need it. Fine-grained reactivity with signals. No virtual DOM overhead. ~2kB core."

### Question 8: `html` tagged template -- invest or abandon?

**Invest, but as the secondary option behind JSX.**

The `html` tagged template is valuable for the "no build step" use case. But it needs work:

1. **Fix component references**: The template should support component references via interpolation: `` html`<${MyComponent} name="World" />` ``. This is how Preact's `htm` works and it solves the "cannot reference component functions" problem.
2. **Add examples everywhere**: Every code example in the docs should show both JSX and `html` tagged template versions (in a tabbed code block).
3. **Improve the parser**: The current parser is described as "not full HTML -- good enough for most cases." It needs to handle self-closing tags, boolean attributes, and spread props correctly.

The `html` template is the answer for: CDN usage (no build step), quick prototyping, embedded widgets, and developers who philosophically prefer no-compile. JSX is the answer for: production apps, teams, and anyone who wants the best DX.

### Question 9: What is the error/warning strategy for development mode?

A development mode with verbose warnings, gated behind `__WHAT_DEV__`. See Issue 23 above for the specific warnings.

The pattern: `if (__WHAT_DEV__) console.warn('[what] ...')`. Build tools (Vite, esbuild, webpack) can replace `__WHAT_DEV__` with `false` in production, and dead-code elimination removes all warning code. Zero cost in production.

Specific warnings to implement:
1. Function passed as text child that is not a reactive wrapper (likely forgot `() =>`)
2. Signal function used in boolean context without calling it
3. Hook called outside component context (already exists)
4. Hook call order changed between renders
5. Component re-rendered >50 times in 1 second
6. Signal written inside a component render (outside event handler or effect)
7. `useEffect` cleanup function not returned (common mistake)

### Question 10: npm publishing timeline?

**Within 2 weeks.** Package names: `what` (core), `what-router`, `what-server`, `what-cli`, `create-what`. Reserve these names on npm immediately even if the first publish is a placeholder.

The first publish will be v0.1.0 with an "experimental" tag. The README will clearly state: "This is pre-release software. The API may change. Do not use in production."

---

## The h() Function Question

This was the number one issue from both developers, so it deserves a thorough answer.

**Current state**: `h()` is the only authoring experience. The `html` tagged template exists but is underdocumented and has limitations (no component references by name). Both developers describe `h()` as "miserable," "painful," and "the single biggest barrier to adoption."

**My position**: They are right. I was wrong to make `h()` the primary authoring surface. `h()` is an excellent compile target and a viable escape hatch. It is not a viable authoring experience for anything beyond trivial components.

**The plan, in order:**

1. **JSX support via `vite-plugin-what`** (Phase 2, weeks 6-7): A Vite plugin that transforms JSX to `h()` calls. Configuration:
   ```js
   // vite.config.js
   import what from 'vite-plugin-what';
   export default { plugins: [what()] };
   ```
   This enables:
   ```jsx
   function Counter() {
     const count = useSignal(0);
     return (
       <div>
         <p>Count: {count()}</p>
         <button onClick={() => count.set(c => c + 1)}>+</button>
       </div>
     );
   }
   ```
   The JSX transform will also automatically wrap signal reads in reactive closures for text children. `{count()}` compiles to `() => count()` as a child of `h()`. This eliminates the biggest footgun.

2. **Improved `html` tagged template** (Phase 2): Fix component references, add spread support, improve parser robustness. The `html` template becomes the recommended "no build step" option:
   ```js
   function Counter() {
     const count = useSignal(0);
     return html`
       <div>
         <p>Count: ${() => count()}</p>
         <button onClick=${() => count.set(c => c + 1)}>+</button>
       </div>
     `;
   }
   ```

3. **Docs rewrite** (Phase 3): Every code example shows JSX as the primary syntax with a "No build step" tab showing the `html` template version. The `h()` function is documented in the API reference as the underlying primitive but is not shown in tutorials.

**What this means for the "no compiler needed" promise**: The promise evolves. The new framing: "What works without a build step -- use the `html` tagged template or raw `h()` calls. But for the best developer experience, we recommend JSX via our Vite plugin." This is honest and practical. Preact has had this exact positioning for years and it works.

---

## State Management Simplification

**The current problem**: Three primitives (`signal()`, `useState()`, `useSignal()`) that do similar things, with no guidance on when to use which.

**The solution**: Two primitives, clearly differentiated.

| Primitive | Where to use | Returns | Read | Write |
|-----------|-------------|---------|------|-------|
| `signal(initial)` | Anywhere (module scope, stores, global) | Signal object | `sig()` | `sig.set(value)` |
| `useSignal(initial)` | Inside components only | Signal object | `sig()` | `sig.set(value)` |

That is it. `signal()` for state that lives outside components. `useSignal()` for state that is scoped to a component instance (allocated on first render, reused on re-renders via hook slot).

`computed()` remains as the only way to derive state. It works anywhere.

`effect()` remains as the only way to create side effects. It works anywhere.

**What happens to the React hooks?**

They move to `what/compat`:
- `useState` -- wraps `useSignal`, returns `[value, setter]` tuple. Documented warning: value is a snapshot, may be stale in closures.
- `useEffect` -- stays in core actually, since it provides the deps-array model that is useful even in a signals world (for imperative side effects where you want explicit deps).
- `useMemo` -- wraps `computed`. Documented as "use `computed()` directly for signal-based derivation."
- `useCallback` -- wraps `useMemo`. Same note.
- `useRef` -- stays in core. Refs are orthogonal to signals vs hooks.
- `useReducer` -- moves to `what/compat`.
- `useContext` / `createContext` -- stay in core. Context is fundamental.

**Revised core hooks** (exported from `what`):
- `useSignal` -- component-scoped signal
- `useEffect` -- side effects with deps array (kept because it is genuinely useful for imperative effects)
- `useRef` -- mutable ref
- `useContext` / `createContext` -- context
- `onMount` -- run once after mount
- `onCleanup` -- run on unmount

That is 6 hooks + 1 factory. Clean, minimal, and each has a clear purpose.

---

## API Surface Reduction

**Current state**: 120+ exports from `what` core.

**Proposed core** (`what`): ~30 exports

```
signal, computed, effect, batch, untrack
h, Fragment, html, mount
useSignal, useEffect, useRef, useContext, createContext
onMount, onCleanup
createResource
memo, lazy, Suspense, ErrorBoundary
Show, For, Switch, Match
createStore
cls, Portal
```

**Proposed subpath exports**:

`what/compat` (~8 exports):
```
useState, useMemo, useCallback, useReducer, useComputed
```

`what/data` (~9 exports):
```
useFetch, useSWR, useQuery, useInfiniteQuery
invalidateQueries, prefetchQuery, setQueryData, getQueryData, clearCache
```

`what/form` (~7 exports):
```
useForm, useField, rules, simpleResolver, zodResolver, yupResolver, ErrorMessage
```

`what/animation` (~6 exports):
```
spring, tween, easings, useTransition, useGesture, useAnimatedValue
```

`what/a11y` (~12 exports):
```
useFocus, useFocusTrap, FocusTrap, announce, announceAssertive
SkipLink, useRovingTabIndex, VisuallyHidden, LiveRegion
useId, Keys, onKey
```

`what/skeleton` (~8 exports):
```
Skeleton, SkeletonText, SkeletonAvatar, SkeletonCard, SkeletonTable
IslandSkeleton, Placeholder, Spinner
```

`what/scheduler` (~6 exports):
```
scheduleRead, scheduleWrite, flushScheduler, nextFrame, onResize, onIntersect
```

`what/head` (~1 export):
```
Head
```

`what/testing` (~already separated):
```
render, cleanup, fireEvent, waitFor, screen, act
```

**What gets cut entirely**:

- `atom` -- redundant with `signal()`. `createStore` covers the store use case. `atom` adds confusion.
- `style` utility function -- it does the same thing as inline styles in props. Not needed.
- `debounce` / `throttle` -- these are generic utilities, not framework primitives. Use `lodash-es/debounce` or write your own 5-line version.
- `useMediaQuery` / `useLocalStorage` -- these are recipes, not primitives. Document them in a "Recipes" page.
- `smoothScrollTo` -- not a framework concern.
- `measure` / `mutate` -- aliases for `scheduleRead`/`scheduleWrite`. Remove the aliases.
- `raf` -- alias for `requestAnimationFrame`. Not needed.
- `show()` / `each()` -- moved to `what/helpers`, not in core. Use `Show`/`For` components instead.
- `useIds` / `useDescribedBy` / `useLabelledBy` -- low-level a11y that can be composed from `useId`. Remove from the export, keep as internal utilities in `what/a11y`.
- `onKeys` -- redundant with `onKey`. Remove.
- `transition` / `createTransitionClasses` / `cssTransition` -- CSS transition helpers that overlap with the animation module. Consolidate in `what/animation`.
- `LoadingDots` -- opinionated UI component. Move to a recipes page or a separate `what-ui` package.
- `useSkeleton` -- the hook version is unnecessary; the components are sufficient.
- Form components (`Input`, `Textarea`, `Select`, `Checkbox`, `Radio`) -- these are thin wrappers around HTML elements. They belong in a `what-ui` component library, not the framework. The `useForm` + `register` pattern works with native HTML elements.

**Net result**: Core drops from 120+ to ~30 exports. Total across all subpath exports: ~75. Each subpath is independently importable and tree-shakeable.

---

## Implementation Roadmap

### Phase 1: Foundation Fixes (Weeks 1-3) -- Must-do before any adoption push

- [ ] **Fix `onMount` invocation** -- Call `ctx._mountCallbacks` after initial render in `createComponent`. (Small)
- [ ] **Fix `onCleanup` invocation** -- Call `ctx._cleanupCallbacks` on component disposal. (Small)
- [ ] **Implement component disposal chain** -- Parent effect disposal triggers child effect disposal. `mount()` unmount function walks the tree. (Medium)
- [ ] **Fix component re-creation in `patchNode`** -- Reuse component instances when constructor matches. Store component context on marker nodes. (Medium-large)
- [ ] **Fix context system** -- Tree-scoped context via component parent chain. (Medium)
- [ ] **Fix island hook support** -- Route island hydration through `createComponent`. (Small)
- [ ] **Fix `createResource` error handler** -- `currentFetch === fetchPromise` instead of `currentFetch === fetcher`. (Tiny)
- [ ] **Implement Portal rendering** -- Handle `__portal` in `createDOM` and `patchNode`. (Small)
- [ ] **Fix error boundary for async errors** -- Store boundary reference on component context. (Small)
- [ ] **Fix `memo` instance sharing** -- Move `prevProps`/`prevResult` to per-use storage via WeakMap or component context. (Small)
- [ ] **Fix `Spinner` style injection** -- Move to document-level style tag. (Tiny)
- [ ] **Fix router `batch` re-entrancy** -- Move param/query updates out of the render path, or guard against re-entrant batch. (Small)

### Phase 2: DX & Architecture Improvements (Weeks 4-7)

- [ ] **Implement fine-grained reactive children** -- Function children in `h()` get their own micro-effects that update individual DOM nodes. (Large -- this is the most important architectural change)
- [ ] **Implement fine-grained reactive props** -- Function prop values get micro-effects per attribute. (Medium)
- [ ] **Ship `vite-plugin-what`** -- JSX transform to `h()` calls, with automatic reactive wrapping for expression children. (Medium)
- [ ] **Improve `html` tagged template** -- Component references via interpolation, spread props, self-closing tags. (Medium)
- [ ] **Fix cache invalidation** -- Active query registry, `invalidateQueries` triggers refetch on active queries. (Medium)
- [ ] **Add cache eviction** -- `cacheTime` with TTL, `maxCacheSize` with LRU. (Small)
- [ ] **Implement route-level data loading** -- `loader` in route config, data passed as props. (Medium)
- [ ] **Implement router middleware execution** -- Run middleware before rendering route. (Small)
- [ ] **Publish to npm** -- Reserve package names, publish v0.1.0-experimental. (Small)
- [ ] **Standardize import paths** -- `what`, `what/router`, `what/server`. Remove all `@what/core` and `@aspect/core` references. (Small)
- [ ] **Add development mode warnings** -- `__WHAT_DEV__` gated warnings for common mistakes. (Medium)

### Phase 3: Documentation & Onboarding (Weeks 8-10)

- [ ] **Rewrite README** -- Lead with islands positioning, show JSX examples, honest bundle size claims. (Medium)
- [ ] **Rewrite QUICKSTART** -- Use `signal()`/`useSignal()` consistently, explain reactive expressions upfront. (Medium)
- [ ] **Reorganize API docs** -- Reflect new subpath exports, remove cut APIs, add deprecation notices. (Medium)
- [ ] **Write "Coming from React" migration guide** -- 10 patterns, side-by-side. (Medium)
- [ ] **Write "Reactive Expressions" guide** -- Explain `() => value()`, static vs reactive, when and why. (Small)
- [ ] **Write "Styling" guide** -- CSS Modules, inline styles, `cls()` utility. (Small)
- [ ] **Build playground** -- In-browser editor with preview, no install required. (Large)
- [ ] **Add tabbed code examples** -- JSX / html template / h() for every example. (Medium)

### Phase 4: Polish & Ecosystem (Weeks 11+)

- [ ] **Implement SSR hydration** -- `hydrate()` function that attaches to existing DOM. (Large)
- [ ] **Add `__WHAT_DEV__` console debugging** -- Component renders, signal writes, effect executions. (Medium)
- [ ] **HMR support** -- Vite plugin integration for hot module replacement. (Large)
- [ ] **DevTools browser extension** -- Component tree, signal inspector, effect graph. (Large)
- [ ] **TypeScript improvements** -- Generic inference for stores, forms, and context. (Medium)
- [ ] **Virtualized list** -- `VirtualList` component, possibly as `what-virtual` package. (Medium)
- [ ] **Comprehensive test suite** -- Unit tests for every core function, integration tests for common patterns. (Large)

---

## What We WON'T Change (And Why)

### 1. The signal primitive API will not change to match React's `[value, setter]` tuple.

`signal()` returns an object. You read with `sig()`. You write with `sig.set()`. This is intentional. The tuple destructuring pattern (`[value, setter]`) is a React convention, not an inherent good. The signal object is:
- More composable (pass one thing around, not two)
- Avoids stale closures (the getter is always current)
- Familiar to Solid, Preact Signals, Angular Signals, and Vue ref users
- Simpler to type in TypeScript (one type parameter, not a tuple)

React's `useState` tuple will remain available in `what/compat` for migration, but the primary API stays as-is.

### 2. Components are functions, not classes or compiled artifacts.

No `.what` files. No single-file components. No compiler-required syntax. Components are plain JavaScript functions that return virtual DOM. This is the "closest to vanilla JS" promise and it stays.

### 3. The `h()` function stays as the underlying primitive.

JSX and `html` templates compile or desugar to `h()` calls. The `h()` function is the stable, documented low-level API. It will not be hidden or deprecated. It will be de-emphasized in tutorials in favor of JSX/`html`, but it remains the foundation.

### 4. No virtual DOM in memory.

The framework diffs against the live DOM, not a retained virtual DOM tree. This is an intentional trade-off: we use slightly more CPU for diffing (reading live DOM vs reading a JS object) but save significant memory. For the content-heavy, islands-oriented use case, this is the right trade.

### 5. Islands are first-class, not an afterthought.

We will not extract islands into a meta-framework. Islands are part of the core architecture. The server package renders static HTML with island markers. The client package hydrates islands selectively. This is not Astro's model (meta-framework wrapping other frameworks). This is the framework itself.

### 6. `effect()` stays auto-tracking (no dependency arrays for reactive effects).

The senior mentioned `useTransition` and scheduling priorities. We will not add React's concurrent features. Our answer to "some updates are expensive" is: signals are cheap, fine-grained reactivity means you update less, and if you really need to defer work, use `requestIdleCallback` or `scheduler.postTask`. The framework should not have an opinion about scheduling; the platform already provides these primitives.

### 7. The core will NOT include i18n, CSS-in-JS, or state machines.

These are application-level concerns, not framework-level concerns. The framework provides signals and effects. You can build i18n, CSS-in-JS, and state machines on top of them. We will provide recipes in the docs, not built-in implementations.

---

## Revised Positioning

### Current elevator pitch:
"The closest framework to vanilla JS. Signals, islands, SSR, and React-compatible hooks in ~4kB."

### New elevator pitch:
"Build fast websites with islands of interactivity. What gives you signals-based reactivity, progressive hydration, and zero JavaScript by default -- in a ~2kB core that feels like writing vanilla JS."

### New README opening:

```
# What

Build fast websites with islands of interactivity.

What is a signals-based web framework for building progressively enhanced
websites. Ship zero JavaScript by default. Hydrate interactive components
only when needed. Fine-grained reactivity with no virtual DOM overhead.

- 2kB core (signals + components + rendering)
- Islands architecture with 6 hydration modes
- Signals that update individual DOM nodes, not entire components
- Works without a build step. Great with one.
```

The key changes:
1. Lead with islands and progressive enhancement, not "React alternative"
2. Honest bundle size (core is 2kB, not "full runtime is 4kB")
3. "Works without a build step. Great with one." -- honest framing of the JSX situation
4. Remove "React-compatible hooks" from the headline. They exist but they are not the identity.

---

## Final Thoughts

### What surprised me

The degree of agreement between the two reviewers. When I asked for independent reviews, I expected the senior to find architectural issues and the junior to have onboarding complaints, with little overlap. Instead, their top three issues were identical: `h()` is painful, state management is confusing, the reactive wrapper pattern is undocumented. That convergence is a strong signal (no pun intended) that these are real problems, not matters of taste.

The senior's finding that `onMount`/`onCleanup` callbacks are never invoked was a genuine "oh no" moment. I knew the component model needed work, but I did not realize that lifecycle hooks were completely non-functional. That is the kind of bug that makes you question what else you missed. It is humbling.

The junior's point about career risk was something I had not considered at all. "I would be the only person at my company using this. If I leave, nobody can maintain my code." This is the adoption barrier that no amount of technical excellence can overcome. It can only be addressed with ecosystem growth, community, documentation, and time. There are no shortcuts.

### What confirmed my instincts

The islands architecture being the highest-rated feature by both reviewers confirms that the core thesis is sound. The web needs less JavaScript, not more. Progressive hydration is the right answer for the majority of websites. The fact that the senior rated it 9/10 and compared it favorably to Astro -- while pointing out features Astro lacks -- tells me the investment there was correct.

The signal system being praised by both reviewers (senior: 8/10, junior: "genuinely superior to React's dependency arrays") confirms that fine-grained reactivity is the right model. The implementation needs to actually deliver on the fine-grained promise (fixing the component-level re-render issue), but the primitive design is sound.

### What I got wrong

1. I prioritized breadth over depth. 120+ exports with half-implemented features is worse than 30 exports that all work correctly. The senior's catalog of bugs in data fetching, forms, and components reveals that I was racing to add features without solidifying the foundation.

2. I underestimated how painful `h()` is for real development. I use it daily and have adapted. New users have not. The junior's raw frustration ("writing `h()` calls all day is miserable") is not a skill issue -- it is a design failure in the authoring experience.

3. I overestimated the value of React compatibility. The React hooks are a trap: they look familiar but behave differently in subtle ways. The senior found `useState` stale values. The junior would have found them in week two. Familiarity that breeds false confidence is worse than unfamiliarity that demands learning.

4. I shipped lifecycle hooks that do not work. There is no excuse for this. `onMount` and `onCleanup` accept callbacks and do nothing. If the feature was not ready, it should not have been exported.

### The path forward

The framework is not ready for production. Both reviewers agree on this. The senior rates production readiness 2/10. The junior says "not today, maybe in 6 months." They are both being generous -- I would rate it 1/10 for production use given the lifecycle bugs.

But the foundation is sound. The signal system works. The islands architecture is innovative. The philosophical positioning is clear and differentiated. What is needed is the discipline to fix the fundamentals before adding more features, the humility to accept that JSX is necessary even if philosophically impure, and the honesty to market what the framework actually does rather than what it aspires to do.

The next 10 weeks are about earning the right to say "production ready." Fix the bugs. Deliver fine-grained reactivity. Ship JSX. Publish to npm. Rewrite the docs. Then -- and only then -- invite people to build with it.

---

*This document will be updated as implementation progresses. Each Phase 1 item will be tracked as a GitHub issue and linked here when completed.*
