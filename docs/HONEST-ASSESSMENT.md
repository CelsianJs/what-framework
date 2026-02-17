# What Framework -- Honest Technical Assessment

An unsparing analysis of the What Framework compared to React, Solid, Svelte, Vue, and Preact. Written after reading every source file in the core, router, server, and compiler packages.

> Historical note: This document captures pre-cleanup findings and terminology.
> Canonical current guidance lives in `/README.md`, `/GETTING-STARTED.md`, `/docs/QUICKSTART.md`, `/docs/API.md`, and `/docs/GOTCHAS.md`.

---

## 1. Performance

### The Claim
"Fine-grained updates that skip the virtual DOM. When a signal changes, only the exact DOM nodes that depend on it update."

### The Reality
**This claim is misleading.** The framework absolutely does have a virtual DOM and does perform tree diffing. Here is what actually happens:

1. Components run inside an `effect()`. When any signal read during render changes, the **entire component function re-runs**.
2. The component returns VNodes (virtual DOM objects) from `h()`.
3. The reconciler (`dom.js`) diffs the new VNodes against the live DOM and patches differences.

This is essentially **React's rendering model with signals as the scheduling mechanism**. It is NOT Solid's model, where signals directly update individual DOM nodes without re-running the component function. In Solid, `createSignal` produces a getter that, when read inside JSX, creates a fine-grained subscription at the DOM text node level. In What Framework, reading a signal inside a component subscribes the entire component's render effect, which re-runs the whole function and reconciles the whole subtree.

**Where it is somewhat better than React:**
- Signals provide automatic dependency tracking, so the framework knows which components to re-render without needing `React.memo`, `useMemo`, or `shouldComponentUpdate`. A signal change only re-runs the effects that actually read that signal. This is a real win over React's "re-render everything downward" model.
- `batch()` and microtask flushing prevent redundant intermediate renders.
- The keyed reconciler uses LIS (Longest Increasing Subsequence) for O(n log n) minimal DOM moves, which is solid.

**Where it is worse than Solid/Svelte:**
- Every signal change re-runs the entire component function and diffs VNodes against live DOM. Solid updates the exact DOM text node. Svelte compiles to direct DOM mutations. What Framework does full component re-execution and reconciliation.
- The `notify()` function in `reactive.js` snapshots the subscriber set into an array on every signal write (`const snapshot = [...subs]`). For signals with many subscribers, this creates garbage on every update.
- The reconciler diffs against live DOM (`Array.from(parent.childNodes)`) rather than maintaining a virtual tree. This means every reconciliation reads from the DOM, which can be slower than diffing two JavaScript object trees.
- `computed()` creates an inner effect object on every computed, with lazy evaluation. This is fine, but the implementation has overhead from the `_onNotify` propagation chain that Solid avoids with its compiled approach.

**Where it is worse than React:**
- React 18+ has concurrent rendering, transitions, and Suspense with streaming. What Framework has none of these. Its Suspense implementation is minimal (it catches promises thrown by lazy components, nothing more).
- React's reconciler has been battle-tested at scale for a decade. What Framework's reconciler has edge cases -- for example, the array handling with marker comments (`<!--[-->` and `<!--]-->`) is clever but fragile, and transitioning between array and non-array children involves multiple code paths with subtle correctness requirements.

**Bundle size claim: "~2kB gzipped core"**
This is probably misleading. The `index.js` re-exports from 12 separate source files (reactive, dom, h, hooks, components, helpers, store, head, scheduler, animation, a11y, skeleton, data, form). If you import anything from `what-framework`, tree-shaking would need to be excellent to avoid pulling in the whole thing. No bundler configuration is shown, no actual measured sizes are provided, and the package.json has no minification or bundling setup. The 2kB number likely refers to just `reactive.js` + `h.js`, not what a real app would ship.

### Verdict
Performance is **roughly comparable to Preact** -- signals-based scheduling with VDOM reconciliation. It is **not in the same class as Solid or Svelte** for fine-grained updates. It is **not in the same class as React** for concurrent rendering and ecosystem optimization. The README's claim of "no virtual DOM diffing" is factually incorrect -- the code does exactly that.

---

## 2. Developer Experience

### What is Genuinely Better Than React

1. **Automatic dependency tracking.** No dependency arrays on `useEffect`, `useMemo`, or `useCallback` that you can get wrong. Signals auto-track. This is a real DX win that eliminates an entire class of bugs. (However, the framework then also offers `useEffect` WITH dependency arrays, which re-introduces the same problem.)

2. **No rules of hooks ordering.** Because hooks state is stored by index in a persistent context object, the implementation technically has the same ordering requirement as React. But signals outside components (`signal()`, `computed()`, `effect()`) have no such restriction, which is genuinely better for simple reactive state.

3. **`html` tagged template literal.** Being able to use the framework without a build step is a real advantage for prototyping, small projects, and educational use. The `html` tag parser in `h.js` is lightweight (~130 lines) and handles attributes, interpolation, and nesting.

4. **Built-in batteries.** Having forms, data fetching, animations, accessibility utilities, and a router in the same package is convenient. You do not need to choose between react-query, swr, react-hook-form, framer-motion, react-aria, and react-router. However, each of these built-in solutions is dramatically less featured and less tested than the standalone libraries they replace.

### What is Worse Than React

1. **The hooks are a trap.** The framework offers both `useState`/`useEffect` AND `useSignal`/`signal`/`effect`. The README shows `signal()` used directly in components. But the GOTCHAS.md reveals that `useEffect` with deps has the exact same stale-closure and function-reference problems as React. The framework has not solved React's hooks problems; it has duplicated them and added a second API alongside them.

2. **`<what-c>` wrapper elements.** Every component renders inside a custom element `<what-c style="display:contents">`. While `display: contents` makes these invisible in layout, they are real DOM nodes that:
   - Show up in the DOM inspector, cluttering the tree.
   - Can break CSS selectors like `:first-child`, `>`, and adjacent sibling combinators.
   - Can cause issues with accessibility tools that traverse the DOM tree.
   - Have no equivalent in React, Solid, Vue, or Svelte, all of which render components without wrapper elements.

3. **Error messages are minimal.** The `__DEV__` error messages are brief console warnings. React's development mode produces detailed error messages with component stacks, suggested fixes, and links to documentation. What Framework has none of this.

4. **No DevTools.** React has React DevTools. Vue has Vue DevTools. Svelte has Svelte DevTools. What Framework has nothing. You cannot inspect component trees, signal values, or effect dependencies.

5. **TypeScript support is surface-level.** The package.json references `index.d.ts` but no type-checking integration is shown. React's TypeScript support is comprehensive with generic components, strict event typing, and ref forwarding types. What Framework's type definitions are likely hand-written declarations, not generated from source.

### What is Worse Than Solid

1. **The re-rendering model.** In Solid, you write components once and they never re-run. Signals update DOM directly. In What Framework, components re-run their entire function body on every signal change. This means every local variable is re-created, every `useRef` check runs again, every `useMemo` dep comparison fires. The GOTCHAS.md explicitly warns about this: "Components re-run entirely on signal changes (no partial re-execution)."

2. **The `spring()` must be in `useRef` gotcha.** This is a direct consequence of the re-running model. In Solid, `spring()` at the top of a component works fine because the function only runs once. In What Framework, you need `useRef` to persist it across re-runs. This is worse than React, where at least the mental model is consistent.

### What is Worse Than Svelte

1. **No compilation advantage.** Svelte compiles components into direct DOM manipulation code with no runtime framework. What Framework's compiler is a simple JSX-to-`h()` transform (~560 lines). It does not perform static analysis, dead code elimination, or compile-time optimization of reactive patterns. The "JSX with superpowers" features (event modifiers, bind:value, client directives) are nice syntactic sugar but not performance optimizations.

### What is Worse Than Vue

1. **No template compilation.** Vue's template compiler performs static analysis to identify static subtrees, hoist them, and generate patch flags that make reconciliation dramatically faster. What Framework re-evaluates all children every render.

2. **No reactivity transform.** Vue's reactivity transform (now stable in Vue 3.4+) eliminates the `.value` accessor pattern. What Framework requires `signal()` for read and `signal.set()` for write, with no compile-time sugar.

### Verdict
The developer experience is **a step down from React** in maturity (no DevTools, no ecosystem, minimal errors), **a step down from Solid** in consistency (re-running components creates gotchas that Solid avoids), and **a step down from Svelte** in simplicity (more boilerplate, no compilation benefits). The genuine DX wins (auto-tracking, no build step option, batteries included) are real but modest.

---

## 3. Agentic Experience (AI Code Generation)

### The Claim
The framework should be easier for AI agents to generate code for.

### Honest Analysis

**Arguments in favor:**

1. **Plain JavaScript.** Components are regular functions. No decorators, no class syntax, no template literals with special semantics (cf. Svelte's `$:` syntax). An LLM trained on JavaScript can generate `h('div', { onClick: fn }, child)` without learning framework-specific syntax.

2. **Single file, single language.** Unlike Svelte (which has `<script>`, `<style>`, and template sections with custom syntax) or Vue (SFC with template/script/style blocks), What Framework components are just `.js` files with function definitions. This is easier for an LLM to produce correctly.

3. **Familiar API surface.** The hooks API mirrors React, which LLMs have extensive training data for. An agent that knows React can write What Framework code by substituting imports.

4. **Small API surface.** The core reactive primitives are just `signal`, `computed`, `effect`, `batch`, and `untrack`. An agent needs to learn five concepts, not fifty.

**Arguments against:**

1. **The gotchas are agent-hostile.** The GOTCHAS.md documents 11 specific traps that require human intuition to avoid. An AI agent generating code will naturally write `useSWR(() => \`items-${query}\`, fetcher)` (passing a function as key), `show(isLoading, ...)` (passing a function reference instead of calling it), or `h('span', null, () => value())` (function children that get stringified). These are the exact patterns an LLM would produce because they look correct and match patterns from other frameworks.

2. **Inconsistent API conventions.** `formState.errors` is a getter (no parens). `formState.isDirty()` is a function call. `useSWR` returns `{ data, isLoading }` where both are functions you must call. `useForm.register()` returns an object with a `value` getter. An agent has to memorize which things are getters, which are signals, and which are plain values. This is harder than React (everything is a value) or Solid (everything reactive is a function call).

3. **No ecosystem for training data.** LLMs generate better code for frameworks with large amounts of training data (Stack Overflow answers, blog posts, documentation, open source projects). What Framework has zero external training data. An agent would need the framework docs in its context window for every generation, which is a cost, not a benefit.

4. **Two competing paradigms.** The framework offers both React-style hooks (`useState`, `useEffect`) AND Solid-style primitives (`signal`, `effect`, `createResource`). An agent will mix them unpredictably, and the framework documentation itself uses both styles in different examples.

### Verdict
The "agentic experience" claim has some theoretical merit (plain JS, small API), but in practice the inconsistent conventions and 11 documented gotchas make this framework **harder for AI agents than React** (which has massive training data and consistent conventions) and **harder than Solid** (which has a simpler and more consistent reactivity model). The best framework for AI code generation is the one the AI has the most training data for, and that is React by a wide margin.

---

## 4. Gotchas Comparison

### What Framework's Gotchas (from GOTCHAS.md)
1. `useEffect` deps with functions -- runs every render
2. `spring()` must be persisted with `useRef`
3. `useSWR` key must be a string, not a function
4. `useSWR` returns functions, not values
5. `formState.errors` is a getter, `formState.isDirty()` is a function
6. `h()` stringifies function children
7. `show()` does not call function arguments
8. `derived()` in stores uses parameter, not `this`
9. SVG innerHTML needs `dangerouslySetInnerHTML`
10. Custom element constructor restrictions
11. `useMemo` has the same function-reference deps problem

### React's Well-Known Gotchas
1. Stale closures in `useEffect`
2. Missing dependency arrays
3. Object/array identity in dependency arrays
4. State updates are batched (fixed in React 18)
5. `useEffect` runs after paint, `useLayoutEffect` before
6. Infinite re-render loops from effects setting state
7. Keys in lists
8. Controlled vs. uncontrolled inputs

### Honest Comparison

What Framework has **not eliminated React's gotchas**. It has inherited the worst ones (dependency array issues from #1, #11), added framework-specific ones (function stringification #6, getter vs. function inconsistency #5, component re-execution requiring `useRef` for animations #2), and only removed a few React gotchas (automatic batching by default, no `useLayoutEffect` timing split).

Critically, several of What Framework's gotchas are **unique to this framework** and don't exist in any competitor:
- `h()` stringifying functions (#6) -- React's createElement does not do this.
- `<what-c>` wrapper elements (#10) -- no other framework has this.
- The getter-vs-function-call inconsistency (#5) -- React's state is always plain values; Solid's reactive values are always function calls. What Framework has both, with no consistent rule for which is which.

**Solid has fewer gotchas** because its model is simpler: components run once, signals are always function calls, effects auto-track (no deps arrays). The re-running component model is the root cause of most of What Framework's gotchas, and Solid avoids it entirely.

**Svelte has fewer gotchas** because the compiler handles reactivity. You write `let count = 0` and `count = count + 1`; the compiler makes it reactive. There is no signal API to get wrong.

### Verdict
What Framework has **more gotchas than Solid**, **comparable gotchas to React** (different, not fewer), and **more gotchas than Svelte**. The GOTCHAS.md is honest documentation, but its existence directly contradicts any claim that this framework reduces cognitive traps.

---

## 5. What is Genuinely Unique or Better

Being honest, here are the things this framework does that are worth noting:

### 1. Islands Architecture as a First-Class Concept
The six hydration modes (load, idle, visible, interaction, media, static) with JSX directive syntax (`client:idle`, `client:visible`) is well-designed. Astro pioneered this pattern, but integrating it directly into a signals framework with `<Island>` components and a Babel plugin that compiles `<Counter client:idle />` into `h(Island, { component: Counter, mode: 'idle' })` is clean. This is arguably the framework's strongest feature.

### 2. No-Build-Step Option
The `html` tagged template literal and raw `h()` calls mean you can use this framework in a `<script type="module">` tag with no build tooling. React requires JSX transformation. Solid requires compilation. Svelte requires compilation. Vue can work without a build step but loses template compilation. This is a genuine advantage for small projects, teaching, and prototyping.

### 3. The DOM Scheduler
The `scheduler.js` module (read/write batching to prevent layout thrashing, shared ResizeObserver, debounced RAF) is a thoughtful inclusion. Most frameworks leave this to userland (e.g., you'd use `fastdom` with React). Having it built in and integrated with the reactive system is nice.

### 4. Automatic `untrack()` on Event Handlers
The reconciler automatically wraps all event handlers in `untrack()`, which prevents signal reads inside event handlers from creating reactive subscriptions. This is a subtle but genuine improvement. In Solid, you must manually use `untrack()` or be careful about signal reads in handlers. In What Framework, this is handled by default.

### 5. Everything in One Package
If you want signals + router + forms + data fetching + animations + a11y utilities + SSR + islands in a single `npm install` with no version compatibility matrix, this delivers it. The counter-argument is that each piece is less featured than the standalone alternative, but for small-to-medium projects, "good enough at everything" can beat "best-in-class at one thing."

---

## 6. What is Clearly Worse

### 1. It's a Hybrid That Gets the Worst of Both Worlds
The framework tries to be both React (hooks, VDOM reconciliation, component re-execution) and Solid (signals, auto-tracking, `createResource`). The result is a system where:
- Components re-run entirely (React's model), but signals auto-track (Solid's model), creating confusion about when things re-execute.
- You can use `useState` (returns plain values) or `useSignal` (returns a signal). The two APIs have different behaviors in the same framework.
- `useEffect` has dependency arrays (React pattern) even though the reactive system could auto-track dependencies (Solid pattern). The framework does both and the GOTCHAS.md documents the resulting confusion.

### 2. The Reconciler Has Correctness Risks
Diffing against live DOM (not a retained virtual tree) means every reconciliation does `Array.from(parent.childNodes)`, which creates an array from a live NodeList. If any effect or browser extension modifies the DOM between renders, the reconciler's assumptions break. React maintains its own fiber tree precisely to avoid this class of bugs.

The array-in-reconciliation handling (marker comments, transitions between array and non-array children) has multiple code paths that handle the same scenario differently depending on whether the old node is an array marker, a component wrapper, a text node, or an element. This is complex enough that edge-case bugs are likely.

### 3. No Production Validation
This framework has zero known production deployments, zero GitHub stars from external users, zero community contributions, zero Stack Overflow answers, zero blog posts, zero conference talks, and zero third-party packages built on top of it. Every competitor has thousands to millions of production deployments validating their correctness and performance.

### 4. Memory Leak Potential
The `data.js` cache uses global `Map` objects (`cacheSignals`, `errorSignals`, `validatingSignals`, `cacheTimestamps`) that grow without bound until they hit the 200-entry limit, at which point the LRU eviction kicks in. But eviction skips keys with active subscribers, so a long-running SPA with many `useSWR` calls could still accumulate significant cache entries. The `revalidationSubscribers` map is only cleaned up when the cleanup function from `subscribeToKey` is called, which relies on effect disposal working correctly.

### 5. SSR is Minimal
The SSR implementation (`renderToString`, `renderToStream`) is roughly 200 lines of string concatenation. It does not handle:
- Streaming Suspense boundaries
- Server components with selective hydration
- Head management during SSR (the `Head` component is imported but SSR does not integrate with it)
- Error boundary serialization
- Data serialization for hydration (no `__NEXT_DATA__` or equivalent)

Compare this to Next.js (React), Nuxt (Vue), SvelteKit (Svelte), or SolidStart (Solid), all of which have sophisticated SSR with streaming, data hydration, and edge runtime support.

### 6. The Router is Incomplete
The router handles basic path matching, params, query strings, nested layouts, and middleware. It does not handle:
- Async data loading before route transitions (loaders/actions pattern)
- Typed route params
- Route-level code splitting with proper loading states
- Scroll position restoration across browser sessions (the implementation only saves to an in-memory Map)
- Search parameter synchronization
- Route transitions with proper cancellation

---

## Summary Table

| Category | vs React | vs Solid | vs Svelte | vs Vue | vs Preact |
|----------|----------|----------|-----------|--------|-----------|
| Raw performance | Worse (no concurrent) | Worse (not fine-grained) | Worse (no compiled) | Worse (no patch flags) | Comparable |
| Bundle size | Better | Comparable | Worse (Svelte has no runtime) | Better | Comparable |
| DX maturity | Much worse | Worse | Worse | Worse | Comparable |
| Gotcha count | Similar | More | More | Similar | Similar |
| Ecosystem | None | Tiny vs. small | None vs. growing | None vs. large | None vs. small |
| Islands support | Better | N/A (different arch) | Comparable (SvelteKit) | N/A | N/A |
| No-build option | Better | Better | Better | Comparable | Comparable |
| AI codegen ease | Worse (no training data) | Worse (no training data) | Worse (no training data) | Worse (no training data) | Worse (no training data) |

---

## Bottom Line

The What Framework is a competently implemented signals-plus-VDOM framework that combines ideas from React (hooks, reconciliation) and Solid (signals, auto-tracking) without fully committing to either model. Its islands architecture is its strongest differentiator. Its no-build-step option is a genuine convenience.

But the honest truth is: **this is not better than the frameworks it competes with in any of its four claimed goal areas.** Performance is not better than Solid or Svelte. Developer experience is not better than React or Vue. The gotcha count is not lower than React. The agentic experience claim has no evidence behind it.

What it offers is **one package that does everything adequately**, with a small API surface and no build step required. That is a legitimate value proposition for small projects, prototypes, and learning. It is not a compelling reason to choose it over React, Solid, Svelte, or Vue for a production application.

The framework's best path forward would be to pick one of these two directions:
1. **Go full Solid**: Drop the VDOM reconciler, make signals update DOM directly, eliminate the re-running component model, and become a genuine fine-grained reactive framework. This would actually deliver on the performance claims.
2. **Go full simplicity**: Lean into the no-build-step, single-package, islands-first story. Stop claiming performance parity with Solid. Position it as "the framework for small interactive websites that don't need React's complexity." This is an honest and underserved niche.

Trying to be both React and Solid while being neither is the framework's core problem.
