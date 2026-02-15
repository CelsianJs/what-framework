# Senior Developer Review -- What Framework

**Reviewer**: Senior Frontend Developer (8+ years: React, Svelte, SolidJS, Vue)
**Date**: February 2026
**Files Reviewed**: All core source, router, server, islands, actions, type definitions, docs

---

## Executive Summary

What Framework is an ambitious attempt to unify the best ideas from the modern frontend ecosystem -- Solid's signals, React's hooks API, Astro's islands architecture, and SvelteKit's SSR ergonomics -- into a single, no-build-step, vanilla-JS-first package. The reactive primitives in `reactive.js` are genuinely well-implemented: clean, compact, and correct in the common case. The sheer breadth of what is offered (signals, hooks, SWR, forms, animations, a11y, skeletons, server actions, islands) in roughly 2,500 lines of total source is impressive and suggests a strong understanding of what production apps actually need.

However, after reading every line of source code and mentally building several production scenarios against this framework, I have serious concerns about its readiness for production use. The signal system has subtle edge cases around diamond dependencies and nested effects. The component rendering model wraps every component in an `effect()`, which creates a tight coupling between the signal system and the VDOM that will cause unpredictable re-renders at scale. The context system is fundamentally broken for any app with more than one consumer of the same context at different tree depths. The `useState` hook returns a stale value on every render after the first one because it reads the signal synchronously and then discards the reactive connection. And the reconciler, while having a solid LIS algorithm for keyed lists, re-creates entire component subtrees on every patch through `patchNode`, which defeats the purpose of fine-grained reactivity.

That said, I am genuinely excited about the direction. The API surface area is well-chosen, the islands architecture is more feature-complete than Astro's basic offering (priority queues, shared stores, multiple hydration modes), and the DX story for small-to-medium apps without a build step is compelling. With focused work on the core rendering pipeline and a few critical bug fixes, this could become a real contender for the "progressive enhancement" and "islands" niche that Astro currently owns but with a much more integrated component model.

---

## What I'd Build With This (And How It Feels)

### Scenario 1: Complex Dashboard with Real-Time Updates

Imagine building an analytics dashboard: a sidebar with filters, a header with user info, a main panel with 6 chart widgets each fetching different data, and a WebSocket connection pushing live updates to the charts.

**In What Framework:**
```js
function Dashboard() {
  const filters = useSignal({ dateRange: '7d', region: 'us' });
  const ws = useRef(null);

  useEffect(() => {
    ws.current = new WebSocket('/ws/metrics');
    ws.current.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setQueryData(`metrics-${data.chartId}`, data);
    };
    return () => ws.current.close();
  }, []);

  return h('div', { class: 'dashboard' },
    h(Sidebar, { filters }),
    h('main', null,
      h(For, { each: charts }, (chart) =>
        h(ChartWidget, { key: chart.id, chart, filters })
      ),
    ),
  );
}

function ChartWidget({ chart, filters }) {
  const { data, isLoading } = useQuery({
    queryKey: ['metrics', chart.id, filters()],
    queryFn: () => fetchMetrics(chart.id, filters()),
    refetchInterval: 30000,
  });

  if (isLoading()) return h(SkeletonCard, {});
  return h('div', null, /* render chart */);
}
```

**The pain points vs React:**
- The `h()` nesting gets deep fast. Six levels of `h()` calls for a moderately complex layout is hard to scan. React with JSX would be dramatically more readable here.
- The `filters` signal being passed as a prop and then called with `filters()` inside `useQuery`'s `queryKey` creates a subtle problem: `queryKey` is evaluated once when `useQuery` first runs inside an `effect`, but the serialization to a cache key (`queryKey.join(':')`) would produce `[object Object]` since it calls `.toString()` on the signal function.
- `setQueryData` for WebSocket updates works, but there is no mechanism to trigger re-fetch or notify the `useQuery` hook that its data changed externally. The signal inside `useQuery` is local -- `setQueryData` updates the cache Map but not the signal.

**In React with TanStack Query:** The same dashboard would have better DevTools support, the query invalidation would actually work end-to-end, and JSX makes the template much more maintainable. What's `useQuery` is a "looks like TanStack Query" API that is missing about 80% of the actual functionality.

**Verdict:** Possible but painful. The data layer gaps would force me to write workarounds within the first week.

### Scenario 2: E-Commerce Product Page with Cart

A product page with image gallery, variant selector, reviews with infinite scroll, "add to cart" with optimistic UI, and a checkout flow.

**In What Framework:**
```js
function ProductPage({ params }) {
  const { data: product } = useQuery({
    queryKey: ['product', params.id],
    queryFn: () => fetchProduct(params.id),
  });

  const cart = useIslandStore('cart', { items: [], total: 0 });

  const addToCart = action(async (item) => {
    await fetch('/api/cart', { method: 'POST', body: JSON.stringify(item) });
  });

  const { trigger, isPending } = useAction(addToCart);

  return h('div', null,
    h(Show, { when: () => product() }, () =>
      h('div', null,
        h('h1', null, () => product().name),
        h('p', null, () => product().price),
        h('button', {
          onClick: () => trigger({ id: product().id }),
          disabled: isPending(),
        }, isPending() ? 'Adding...' : 'Add to Cart'),
      )
    ),
    h(Reviews, { productId: params.id }),
  );
}
```

**Problems I hit:**
- `Show` with a function child (the render-prop pattern `() => h(...)`) is not actually supported. Looking at the source, `Show` returns `children` directly when the condition is truthy. If `children` is a function, it would try to render a function as a VNode, which would fail silently or produce `[object Function]` as text.
- The `useIslandStore` / `action` / `useAction` combination works across islands, which is genuinely nice. But mixing server actions with island stores requires careful understanding of what runs where -- there is no compile-time enforcement of `'use server'` like Next.js provides.
- Infinite scroll reviews would use `useInfiniteQuery`, which looks correct in its implementation but has no mechanism for placeholder data or keeping previous page data visible while fetching.

**In SvelteKit:** This would be dramatically simpler. Svelte's template syntax, built-in transitions for the cart flyout, `load` functions for SSR data, and form actions for the cart mutation are all first-class, well-tested features.

**Verdict:** The islands + shared store model is the killer feature here. Being able to have a static product description with just the cart widget and reviews as islands is exactly right for e-commerce. But the DX friction of `h()` calls and the half-implemented data layer would slow the team down.

### Scenario 3: Multi-Step Form Wizard with Validation

A 4-step registration form: personal info, address, payment, and confirmation. Each step has field-level validation, the form state persists across steps, and "back" preserves values.

**In What Framework:**
```js
function RegistrationWizard() {
  const step = useSignal(0);
  const { register, handleSubmit, formState, setValue, getValue, watch } = useForm({
    defaultValues: { name: '', email: '', street: '', city: '', cardNumber: '' },
    resolver: simpleResolver({
      name: [rules.required()],
      email: [rules.required(), rules.email()],
      street: [rules.required()],
      city: [rules.required()],
    }),
  });

  const steps = [
    () => h('div', null,
      h('input', { ...register('name'), placeholder: 'Name' }),
      h(ErrorMessage, { name: 'name', errors: formState.errors }),
      h('input', { ...register('email'), placeholder: 'Email' }),
      h(ErrorMessage, { name: 'email', errors: formState.errors }),
    ),
    // ... more steps
  ];

  return h('div', null,
    h('div', { class: 'steps' }, steps[step()]()),
    h('div', { class: 'nav' },
      h(Show, { when: () => step() > 0 },
        h('button', { onClick: () => step.set(s => s - 1) }, 'Back')
      ),
      h('button', {
        onClick: () => {
          if (step() < 3) step.set(s => s + 1);
        },
      }, step() < 3 ? 'Next' : 'Submit'),
    ),
  );
}
```

**The good:** `useForm` with `simpleResolver` and `rules` is a clean API. The React Hook Form influence is clear and welcome. The built-in `rules.match()` for password confirmation is a nice touch.

**The bad:**
- `register()` returns `{ name, value, onInput, onBlur, onFocus, ref }` where `value` is read once from `values()[name]`. This means the input will not update its displayed value when the signal changes. In React Hook Form, `register` integrates with the controlled/uncontrolled input model; here, the value is stale after the first render because the component re-renders via the signal effect, but `register()` captures the value at call time.
- Per-step validation is not built in. You would need to validate specific fields per step, which requires calling `validate('name')` individually rather than just `validate()`. The API supports this, but the `validate(fieldName)` path runs the entire resolver and then picks out one field's errors, which is wasteful with complex schemas.
- No `watch` with callback. The `watch(name)` returns a computed signal, which is fine for reactive templates, but there is no `watch(name, callback)` form for side effects.

**In React Hook Form:** This would be cleaner with `useFormContext`, step-specific `useForm` instances, or their built-in `trigger('fieldName')` for per-field validation. The controlled/uncontrolled input story is much more mature.

**Verdict:** Works for simple forms. Falls apart for complex multi-step wizards because `register()` produces stale values and per-step validation requires boilerplate.

### Scenario 4: Real-Time Chat Application

WebSocket-backed chat with message list, typing indicators, presence, and message reactions.

**This is where the framework's strengths shine.** Signals are perfect for real-time state. A `signal` for messages, a `signal` for typing users, and a `signal` for presence -- each updating independently without triggering re-renders of unrelated parts. The `For` component for the message list with keyed reconciliation would handle insertions efficiently. The `spring` animation for new message slide-in would be smooth.

**But:** The lack of virtualized list support means a chat with 10,000 messages would eventually crawl. `For` renders every item every time. There is no built-in `VirtualList` or windowing. This is table stakes for chat at scale.

---

## Deep Technical Analysis

### Signal System

The reactive primitives in `/packages/core/src/reactive.js` are the heart of the framework, and they are implemented with admirable conciseness (~168 lines).

**What is done well:**
- Automatic dependency tracking via the `currentEffect` global is clean and correct for the simple case.
- The cleanup mechanism (`cleanup(e)` removes the effect from all subscriber sets, `e.deps.clear()` resets) prevents stale subscriptions.
- `batch()` with depth counting handles nested batches correctly.
- `computed()` is genuinely lazy -- it only recomputes when dirty AND read. This is the right design (matches SolidJS).
- The `_onNotify` hook on computed effects allows them to mark dirty without immediately recomputing. This is a sophisticated optimization.

**Concerns:**

1. **Diamond dependency problem.** Consider:
```js
const a = signal(1);
const b = computed(() => a() + 1);
const c = computed(() => a() + 2);
effect(() => console.log(b() + c())); // Should log 5
a.set(2); // Should log 7, but might log 6 or 8 first (glitch)
```
When `a.set(2)` fires, it notifies `b`'s inner effect and `c`'s inner effect. Both are marked dirty via `_onNotify`. Then the outer effect re-runs. It reads `b()` which triggers recomputation of `b`, then reads `c()` which triggers recomputation of `c`. In the non-batched case, this actually works correctly because computeds are lazy. However, if the outer effect is in the `pendingEffects` set during a `batch()`, and the computeds are also in `pendingEffects`, the flush order matters. The `flush()` function iterates `pendingEffects` in Set insertion order and skips effects with `_onNotify`. This means computeds never run during flush -- they are only recomputed on read. This is actually correct. **But** if you have an effect that reads a computed that reads another computed that reads a signal, and all three are pending, the double-evaluation during the effect run could be expensive. There is no topological sorting or priority queue.

2. **No effect scheduling/priority.** All effects are equal. In React, `useTransition` and `startTransition` let you mark some updates as low-priority. Solid has `createTransition`. What has no equivalent -- every signal write immediately (or at batch-end) triggers all dependent effects.

3. **Memory leak potential.** Effects that create other effects (common when a component's effect creates computed values) create a parent-child relationship that is not tracked. If the parent effect is disposed, child effects remain. The `_disposeEffect` function cleans up subscriptions but does not dispose child effects. In practice, this means component unmount only cleans up the top-level effect created in `createComponent`, not any effects created by hooks inside that component.

4. **No error boundary in effects.** If an effect throws, the error propagates up and can leave `currentEffect` in a corrupted state. The `try/finally` in `_runEffect` does restore `currentEffect`, but the effect is not automatically disposed or retried. A throwing effect will be re-triggered on the next signal change, potentially causing infinite error loops.

### Component Model & Rendering

The rendering model in `dom.js` is the most concerning part of the framework.

**The fundamental design decision:** Every component is wrapped in an `effect()`. When any signal read during the component's render function changes, the entire component re-renders and reconciles.

```js
// From dom.js, createComponent():
const dispose = effect(() => {
  if (ctx.disposed) return;
  ctx.hookIndex = 0;
  componentStack.push(ctx);
  let result;
  try {
    result = Component({ ...props, children });
  } catch (error) { /* ... */ }
  componentStack.pop();
  // reconcile...
});
```

**Problems:**

1. **Every signal read in a component triggers full component re-render.** If a component reads 5 signals, changing any one of them re-runs the entire component function and reconciles all its children. This is React's model, not Solid's. In Solid, signal reads in JSX expressions create fine-grained subscriptions at the DOM node level. In What, the granularity is at the component level. This means the `useSignal` / `useComputed` hooks are cosmetic -- they provide a signal-like API but deliver React-like re-render behavior.

2. **`useState` returns a stale value.** Look at the implementation:
```js
export function useState(initial) {
  const ctx = getCtx();
  const { index, exists } = getHook(ctx);
  if (!exists) {
    const s = signal(typeof initial === 'function' ? initial() : initial);
    ctx.hooks[index] = s;
  }
  const s = ctx.hooks[index];
  return [s(), s.set];  // s() reads the value NOW, returns a plain value
}
```
The `s()` call inside the effect means it subscribes the component's effect to the signal. The returned `value` (first element) is a snapshot. This means inside event handlers, `value` is stale -- it captures the value at render time. React has the same issue, and it is a well-known footgun. But React at least has `useRef` and functional updaters as documented workarounds. What's documentation does not mention this.

3. **Component re-creation in `patchNode`.** When the reconciler encounters a component VNode during patching:
```js
// Component
if (typeof vnode.tag === 'function') {
  // Re-create component (future: memoize + diff props)
  const node = createComponent(vnode, parent);
  parent.replaceChild(node, domNode);
  return node;
}
```
The comment says "future: memoize + diff props." This means every time a parent re-renders and its child is a component, the child is fully torn down and re-created. All state is lost. All effects re-run. This is catastrophic for any non-trivial app. The `memo()` wrapper exists but it only prevents re-render at the VNode level -- if the parent's reconciler hits a component VNode, it bypasses memo entirely and calls `createComponent` fresh.

4. **No component unmount cleanup.** The `mount()` function returns an unmount function that simply does `container.textContent = ''`. There is no traversal to dispose effects, run cleanup callbacks, or trigger `onCleanup` handlers. Component `ctx.effects` contains dispose functions, but nobody calls them on unmount. The `onMount` callbacks stored in `ctx._mountCallbacks` are never invoked -- there is no code that reads `_mountCallbacks` and calls them.

5. **`hookIndex` reset but not validated.** The `ctx.hookIndex` is reset to 0 on each render. If a component conditionally calls hooks (violating rules of hooks), the framework will silently use the wrong hook slot. React at least warns about this in development mode. What has no such protection.

### Router

The router in `/packages/router/src/index.js` is competent but basic.

**Strengths:**
- View Transitions API support via `document.startViewTransition` is forward-thinking.
- `compilePath` handles `:param`, `[param]` (file-based), `[...catchAll]`, and route groups correctly.
- `Link` component with `activeClass` and `exactActiveClass` is a nice DX touch.
- Prefetching on hover is smart.

**Weaknesses:**

1. **No route-level data loading.** React Router has `loader`, SvelteKit has `load`, SolidStart has `routeData`. What's router has no way to prefetch data for a route before navigation completes. The `loading` component is shown during navigation, but the actual data fetching happens after the component mounts, causing a flash of loading state.

2. **The `Router` component re-evaluates on every render.** It reads `_url()` inside what appears to be a component function. Because the `Router` component is wrapped in an effect by `createComponent`, any URL change re-runs the entire Router, re-matches routes, and -- critically -- calls `batch(() => { _params.set(...); _query.set(...) })` on every render. This means params and query signals fire even when they have not changed, because the batch + set happens unconditionally.

3. **No route transition animations.** The View Transitions API is great, but there is no mechanism for component-level enter/exit animations during route changes. Svelte has `in:` and `out:` transitions. React has `<AnimatePresence>`. What's `transition` helper returns CSS classes but there is no lifecycle hook to delay unmount until an exit animation completes.

4. **`asyncGuard` creates a new effect on every render.** The guard component calls `effect()` inside a component function without using a hook. This means every render creates a new effect that re-checks the guard, potentially causing infinite re-render loops if the guard's result changes a signal that triggers a re-render.

5. **No programmatic route matching.** You cannot call `matchRoute` externally to check if a path matches a route (for active link highlighting in custom components, breadcrumbs, etc.). The function is module-private.

### Data Layer

**`useFetch`** is a basic wrapper around `fetch`. It creates a bare `effect()` (not `useEffect`) that fires on every reactive re-evaluation, which means it will re-fetch every time any signal it depends on changes. Since it depends on the `url` parameter which could be a signal, this could cause infinite fetch loops if the response updates a signal that triggers a re-render.

**`useSWR`** is the most complete data fetching hook. The deduplication via `inFlightRequests` with a timestamp is a good pattern. Revalidation on focus and reconnect work correctly. However:
- The cache is a plain `Map` with no TTL or size limit. In a long-running SPA, this will grow unbounded.
- The `dedupingInterval` check compares timestamps, but `existingPromise.promise` might have already resolved. The dedup logic should also check if the promise is settled.
- `mutate` updates both the signal and the cache, but there is no way to trigger revalidation across different components that use the same key. Each `useSWR` call creates its own signal -- they do not share a signal for the same key.

**`useQuery`** mimics TanStack Query's API but misses critical features:
- No query client or provider. All state is module-scoped singletons.
- `retry` works but `retryDelay` is only applied after the first failure. The initial attempt has no timeout.
- `staleTime` compares against `lastFetchTime` which is a closure variable. Different components using the same `queryKey` each have their own `lastFetchTime`.
- No `keepPreviousData` option.
- No structural sharing of results.
- `enabled` is checked once at effect creation time and then reactively inside the effect. But if `enabled` changes from `false` to `true`, the effect needs to re-run, which only happens if `enabled` is a signal and is read inside the effect. Since `enabled` is a plain boolean from the options object, it is read once and never re-evaluated.

**`useInfiniteQuery`** is functional but:
- No error handling per page.
- No `isFetchingNextPage` / `isFetchingPreviousPage` in the error case.
- `refetch` resets all pages and starts over. There is no `refetchPage` for individual pages.

**Cache invalidation:** `invalidateQueries` deletes from the cache Map but does not notify any active queries to refetch. This is the most critical gap. In TanStack Query, invalidation triggers a refetch of all active queries matching the key. Here, it just deletes the cache entry, so the next time a component mounts and calls `useQuery`, it will fetch fresh data -- but already-mounted components will continue showing stale data.

### Islands Architecture

This is the strongest part of the framework.

The islands implementation in `/packages/server/src/islands.js` is genuinely sophisticated:

**Strengths:**
- Six hydration modes (load, idle, visible, action, media, static) cover every real-world scenario I have encountered.
- Priority-based hydration queue with `enqueueHydration` and `processQueue` ensures critical islands hydrate first.
- `boostIslandPriority` for dynamic priority changes (e.g., user scrolls toward an island) is a pattern I have not seen in Astro.
- `createIslandStore` for shared state across islands solves the biggest pain point in Astro's islands model.
- Serialization/deserialization of shared stores for SSR is clean.
- The `island:hydrated` CustomEvent for analytics and debugging is a thoughtful touch.

**Comparison to Astro:**
Astro's islands are simpler (`client:load`, `client:idle`, `client:visible`, `client:media`, `client:only`) but lack priority ordering, shared state, and dynamic priority boosting. What's implementation is more feature-complete. However, Astro has the advantage of framework-agnostic islands (React, Svelte, Vue in the same page), while What's islands are What-only.

**Concerns:**
- `scheduleHydration` uses `requestIdleCallback` for `idle` mode, with a 200ms `setTimeout` fallback for Safari. This is correct but the timeout should be configurable.
- The `visible` mode uses IntersectionObserver with a `200px` rootMargin, which is a good default but not configurable per-island.
- The `action` mode listens for `click`, `focus`, `mouseover`, and `touchstart`. The `mouseover` triggers hydration on hover, which might be too eager for some use cases.
- `mount(Component({ ...props, ...storeProps }), el)` calls the component function and mounts the result, but this means the component is invoked outside of the reactive system. If the component uses `useSignal` or `useState` inside, `getCurrentComponent()` will return null and throw. This is a critical bug -- **island components cannot use hooks**.

### DX Without JSX

The `h()` function is the primary authoring experience, and it is the framework's biggest DX weakness.

**The problem illustrated:**
```js
// What Framework
function Dashboard() {
  return h('div', { class: 'dashboard' },
    h('header', { class: 'header' },
      h('h1', null, 'Dashboard'),
      h('nav', null,
        h(Link, { href: '/' }, 'Home'),
        h(Link, { href: '/settings' }, 'Settings'),
      ),
    ),
    h('main', { class: 'content' },
      h(Show, { when: () => isLoading() },
        h(SkeletonCard, {}),
      ),
      h(Show, { when: () => !isLoading() },
        h(For, { each: () => items() }, (item) =>
          h(Card, { key: item.id },
            h('h2', null, item.title),
            h('p', null, item.description),
            h('button', { onClick: () => select(item) }, 'View'),
          ),
        ),
      ),
    ),
    h('footer', null, h('p', null, 'Copyright 2026')),
  );
}
```

```jsx
// The same in React JSX
function Dashboard() {
  return (
    <div className="dashboard">
      <header className="header">
        <h1>Dashboard</h1>
        <nav>
          <Link href="/">Home</Link>
          <Link href="/settings">Settings</Link>
        </nav>
      </header>
      <main className="content">
        {isLoading ? <SkeletonCard /> : items.map(item => (
          <Card key={item.id}>
            <h2>{item.title}</h2>
            <p>{item.description}</p>
            <button onClick={() => select(item)}>View</button>
          </Card>
        ))}
      </main>
      <footer><p>Copyright 2026</p></footer>
    </div>
  );
}
```

The JSX version is dramatically easier to read, maintain, and review in PRs. The `html` tagged template helps somewhat, but the parser in `h.js` is described as "not full HTML -- good enough for most cases." I found issues:
- Component tags (capitalized) are parsed as strings, not component references. `html\`<MyComponent />\`` would try to create an element called "MyComponent", not invoke the component function.
- Spread syntax (`...${props}`) is supported, but conditional rendering still requires `${condition ? html\`...\` : null}`.
- No syntax highlighting or editor support for the tagged template.

**My recommendation:** Invest in a simple JSX transform (even a Babel plugin) or a Vite plugin that converts JSX to `h()` calls. The "no build step" philosophy is admirable but the authoring experience is the single biggest barrier to adoption.

### Error Handling & Edge Cases

1. **Error boundaries work on initial render only.** The `ErrorBoundary` component in `components.js` creates a signal for error state and a handler. The handler is pushed to `errorBoundaryStack` during `createErrorBoundary` in `dom.js`. But `errorBoundaryStack.push(boundary)` happens inside the boundary's effect, and `errorBoundaryStack.pop()` happens immediately after -- meaning the boundary is only on the stack during the boundary's own render, not during its children's render. For child errors to be caught, the boundary must be on the stack when `createComponent` runs for the child. Since the boundary's effect runs, pushes, renders children, pops, and returns, this should work on initial mount. But on re-render, if a child effect throws, the boundary is no longer on the stack.

2. **`createResource` has a bug in the error handler.** Line 217 compares `currentFetch === fetcher` instead of `currentFetch === fetchPromise`. This means errors from concurrent fetches will never update the error state because the comparison always fails. The variable `fetcher` is the function, not the promise.

3. **No error recovery in `useSWR` / `useQuery`.** If a fetch fails and the component re-renders, the effect re-runs and retries immediately. There is no exponential backoff in `useSWR` (only `useQuery` has `retry`). A 404 from the API would cause `useSWR` to retry on every focus/reconnect event forever.

4. **The `Portal` component is declared but never handled in the reconciler.** `helpers.js` returns `{ tag: '__portal', props: { container }, children, _vnode: true }` but `dom.js` has no case for `__portal` tags. The reconciler would try to `document.createElement('__portal')`, which would create an unknown HTML element.

5. **`onMount` callbacks are never called.** The `onMount` hook in `hooks.js` pushes to `ctx._mountCallbacks`, but no code in `dom.js` ever reads or invokes these callbacks. The `ctx.mounted` flag is set to `true` in `createComponent`, but `_mountCallbacks` is ignored.

6. **`onCleanup` callbacks are never called.** Same issue: `ctx._cleanupCallbacks` is populated but never invoked.

### Performance Concerns

1. **Every component wrapped in `effect()`.** This is the core performance concern. Each component creates one effect. A page with 500 components (not unusual for a data table) creates 500 effects, each with their own subscriber sets. Any global signal (like a theme or locale) that is read by all 500 components will have a subscriber set of size 500. Changing that signal triggers 500 effect re-runs.

2. **`reconcileKeyed` has an O(n) loop inside the LIS mapping.** The `lisSet` computation on lines 323-332 of `dom.js` maps LIS indices back to new-node indices with a nested loop, making the overall complexity O(n * m) instead of the expected O(n log n).

3. **Props spreading creates new objects on every render.** `Component({ ...props, children })` in `createComponent` creates a new props object every render. Combined with the shallow comparison in `memo`, this means memoized components always see "different" props because the children reference changes. The `memo` wrapper would need to exclude `children` from comparison, but it does not.

4. **`useSWR` and `useQuery` create multiple effects per call.** Each `useSWR` call creates up to 4 effects (initial fetch, focus revalidation, reconnect revalidation, polling). For a page with 20 queries, that is 80 effects just for data fetching.

5. **No batching in `setProp` for style objects.** Setting 10 style properties calls `el.style[prop] = value` 10 times, potentially causing 10 style recalculations. Should batch via `cssText` or `requestAnimationFrame`.

6. **The skeleton CSS is injected into the document head via JavaScript.** `injectStyles()` creates a `<style>` element. On a page with many skeleton instances, this runs the style injection check many times (though it short-circuits after the first). More importantly, the CSS should be extractable at build time for critical path optimization.

---

## Comparison Matrix

| Dimension | What | React 19 | SolidJS 2 | Svelte 5 | Astro 5 |
|---|---|---|---|---|---|
| **Reactivity Model** | Signals (auto-track) | useState + re-render | Signals (fine-grained) | Runes (compiled signals) | N/A (static) |
| **Rendering Granularity** | Component-level | Component-level | DOM node-level | DOM node-level | Static HTML |
| **Template Syntax** | `h()` / tagged template | JSX | JSX | Svelte template | Astro template |
| **Bundle Size (core)** | ~4 kB claimed | ~40 kB | ~7 kB | ~2 kB | 0 kB |
| **SSR** | Yes (string + stream) | Yes (mature) | Yes (mature) | Yes (mature) | Yes (mature) |
| **Islands** | Yes (6 modes) | No (native) | No (native) | No (native) | Yes (5 modes) |
| **Shared Island State** | Yes | N/A | N/A | N/A | No (manual) |
| **Hydration Priority** | Yes (queue-based) | No | No | No | No |
| **Router** | Built-in (basic) | React Router (mature) | SolidStart (mature) | SvelteKit (mature) | File-based (mature) |
| **Data Fetching** | Built-in (SWR + Query) | TanStack Query | createResource | load functions | Astro.fetch |
| **Forms** | Built-in (basic) | React Hook Form | Module (basic) | Svelte forms | N/A |
| **Animation** | Springs + tweens | Framer Motion | solid-transition | svelte/motion | CSS only |
| **A11y** | Built-in utilities | aria packages | No built-in | No built-in | Lint rules |
| **DevTools** | None | React DevTools | Solid DevTools | Svelte DevTools | Astro toolbar |
| **TypeScript** | .d.ts files | First-class | First-class | First-class | First-class |
| **Error Boundaries** | Yes (basic) | Yes (mature) | Yes (mature) | Yes (basic) | N/A |
| **Suspense** | Yes (basic) | Yes (mature) | Yes (mature) | No | N/A |
| **Testing** | Built-in (basic) | Testing Library | Testing Library | Testing Library | Testing Library |
| **Build Step Required** | No | Yes (JSX) | Yes (JSX) | Yes (compiler) | Yes |
| **Ecosystem Size** | None | Massive | Growing | Large | Growing |
| **Production Battle-tested** | No | Yes | Moderate | Yes | Yes |
| **Server Actions** | Yes (basic) | Next.js (mature) | SolidStart (mature) | SvelteKit (mature) | Astro actions |
| **Concurrent Rendering** | No | Yes | No | No | N/A |
| **Code Splitting** | `lazy()` | `lazy()` + Suspense | `lazy()` | Dynamic imports | Automatic |
| **Documentation** | Minimal | Extensive | Good | Extensive | Extensive |

---

## What's Missing for Production

Ranked by criticality:

1. **Working component lifecycle** -- `onMount` and `onCleanup` are defined but never invoked. This is not a "missing feature" but a ship-blocking bug.

2. **Component-level unmount/disposal** -- When a component is removed from the DOM, its effects, intervals, event listeners, and child components must be cleaned up. Currently, `container.textContent = ''` is the only cleanup.

3. **DevTools** -- Any non-trivial debugging requires DevTools. A browser extension that shows the component tree, signal values, effect dependencies, and re-render counts. Without this, debugging a production app is flying blind.

4. **Working Portal** -- The `__portal` tag is not handled by the reconciler.

5. **Proper error boundaries for async errors** -- Effects that throw need to propagate to the nearest error boundary. Currently, they just `console.error`.

6. **Cache invalidation that notifies active queries** -- `invalidateQueries` must trigger refetch on mounted components, not just delete the cache entry.

7. **JSX support** -- A Vite/esbuild plugin that transforms JSX to `h()` calls. The `h()` API is fine as a compile target but painful as an authoring experience.

8. **Virtualized lists** -- Any list over ~100 items needs windowing. `VirtualList`, `VirtualGrid`, `VirtualTable` components.

9. **SSR hydration mismatch detection** -- When the server-rendered HTML does not match the client render, there should be a warning and graceful recovery. Currently, `mount()` just blows away the container content.

10. **State persistence across route changes** -- The router re-creates components on navigation. State is lost unless stored in signals outside the component tree.

11. **Middleware execution in the router** -- Route configs accept `middleware` but the Router component never checks or executes them.

12. **CSS-in-JS or scoped styles** -- No built-in solution for component-scoped CSS.

13. **HMR support** -- Hot module replacement for the dev server. Without HMR, every code change requires a full page reload, losing all component state.

14. **Server-side data loading in routes** -- `loader` functions that run before the component renders, with data available as props.

15. **i18n** -- Internationalization primitives (locale signal, `t()` function, pluralization).

---

## Specific Bugs / Issues I Found in the Source

### Critical Bugs

1. **`createResource` error handler compares wrong variable** (`/packages/core/src/hooks.js` line 217)
   ```js
   // BUG: compares fetcher (function) instead of fetchPromise
   if (currentFetch === fetcher) {
     error.set(e);
     loading.set(false);
   }
   // Should be:
   if (currentFetch === fetchPromise) {
   ```

2. **`onMount` callbacks never invoked** (`/packages/core/src/hooks.js` lines 174-179 and `/packages/core/src/dom.js`)
   `ctx._mountCallbacks` is populated but never read.

3. **`onCleanup` callbacks never invoked** (`/packages/core/src/hooks.js` lines 185-189)
   `ctx._cleanupCallbacks` is populated but never read.

4. **Portal tag not handled by reconciler** (`/packages/core/src/helpers.js` line 131)
   Returns `{ tag: '__portal', ... }` but `dom.js` has no case for `__portal`.

5. **Island components cannot use hooks** (`/packages/server/src/islands.js` line 237)
   ```js
   mount(Component({ ...props, ...storeProps }), el);
   ```
   This calls the Component function directly, outside of `createComponent`. The component stack is empty, so `getCurrentComponent()` returns undefined, and any hook call throws.

6. **Component re-creation on every reconciliation** (`/packages/core/src/dom.js` lines 450-455)
   ```js
   if (typeof vnode.tag === 'function') {
     const node = createComponent(vnode, parent);
     parent.replaceChild(node, domNode);
     return node;
   }
   ```
   Every component child is destroyed and recreated on parent re-render. All state is lost.

### Moderate Issues

7. **`createContext` is a global singleton** (`/packages/core/src/hooks.js` lines 140-149)
   ```js
   export function createContext(defaultValue) {
     const ctx = { _value: defaultValue, Provider: ... };
     return ctx;
   }
   ```
   The Provider sets `ctx._value = value` globally. If two parts of the tree provide different values for the same context, they overwrite each other. There is no tree-scoping. This is fundamentally broken for nested providers.

8. **`useEffect` with empty deps still subscribes to component re-renders** (`/packages/core/src/hooks.js` lines 67-86)
   `useEffect(fn, [])` runs once and the cleanup is registered. But because it runs inside the component's effect, `depsChanged(undefined, [])` returns true on first render but false on subsequent renders. This is correct. However, if the component re-renders and `ctx.hookIndex` is reset, the hook slot is revisited, `depsChanged([], [])` correctly returns false, and the effect does not re-run. This is fine -- but the effect's cleanup function is not called on component unmount because `ctx` cleanup is never processed.

9. **`useReducer` dispatch creates a new closure on every render** (`/packages/core/src/hooks.js` lines 154-169)
   The `dispatch` function is captured in the hook slot on first render and reused. This is actually correct -- `dispatch` is stable. But the `[hook.signal(), hook.dispatch]` return creates a new array on every render, which means any dependency on the array itself (not its contents) will always be "changed."

10. **`useSWR` effect creates event listeners without cleanup** -- The focus and reconnect effects do return cleanup functions, but these are bare `effect()` calls (from `reactive.js`), not `useEffect` from hooks. The cleanup return value from the reactive `effect()` is not the cleanup function inside it -- `effect()` returns a dispose function. The cleanup function returned by the effect's callback is only called when the effect re-runs or is disposed. Since these effects never re-run (they have no signal dependencies), the cleanup is only called on dispose. But nobody calls the dispose function.

11. **Router `batch` inside a component function** (`/packages/router/src/index.js` lines 185-188)
   ```js
   batch(() => {
     _params.set(matched.params);
     _query.set(parseQuery(search));
   });
   ```
   This runs inside the Router component's render, which is inside a reactive effect. Calling `batch` inside an effect that is already processing can cause re-entrancy issues.

12. **`html` tagged template does not support component references** (`/packages/core/src/h.js`)
   The parser matches `<[A-Z]\w*` as a tag name, but the result is a string, not a component function reference. To use components in `html` templates, you would need to pass them as interpolated values, which is not demonstrated in any documentation.

### Minor Issues

13. **`memo` stores result across all instances** (`/packages/core/src/components.js` lines 13-29)
   `prevProps` and `prevResult` are in the `memo` closure, shared across all uses of the memoized component. If `MemoComp` is used in two places with different props, the second instance will short-circuit with the first instance's result if props match.

14. **Missing `.peek()` usage in several places** -- `useForm`'s `register` function reads `values()[name]` which tracks a dependency. If called inside an effect, this creates an unwanted subscription.

15. **`Spinner` injects a `<style>` tag inside an `<svg>` element** (`/packages/core/src/skeleton.js` line 351) -- While some browsers tolerate this, it is not valid SVG. The keyframe should be defined in a document-level style tag.

16. **`useRovingTabIndex` takes a static `itemCount`** (`/packages/core/src/a11y.js` line 272) -- If the list length changes, the modular arithmetic uses the stale count. It should accept a signal or getter.

---

## Recommendations (Prioritized)

### Must Fix Before v1

1. **Fix component lifecycle** -- Implement `onMount` invocation after DOM insertion and `onCleanup` invocation on component removal. This is non-negotiable for any real application.

2. **Fix component disposal on reconciliation** -- When `patchNode` encounters a component, it must diff props and reuse the existing component instance instead of creating a new one. Only create a new component if the component function itself changed.

3. **Fix the context system** -- Implement tree-scoped context. Each component should walk up to find the nearest Provider, not read a global variable. This could use the component stack during render.

4. **Fix the `createResource` error handler bug** -- Change `currentFetch === fetcher` to `currentFetch === fetchPromise`.

5. **Implement Portal rendering** -- Handle `__portal` vnodes in the reconciler by mounting children into the target container.

6. **Fix island hydration to support hooks** -- Change `mount(Component({ ...props, ...storeProps }), el)` to `mount(h(Component, { ...props, ...storeProps }), el)` so the component goes through `createComponent` and has access to the component context.

7. **Fix cache invalidation** -- `invalidateQueries` must trigger refetch on all active `useQuery`/`useSWR` instances that match the invalidated key. Store active queries in a registry.

### Should Improve

8. **Add JSX support via a Vite plugin** -- This does not need to be in core. A `vite-plugin-what-jsx` that transforms JSX to `h()` calls would dramatically improve authoring DX.

9. **Implement proper component diffing** -- Detect when a component VNode has the same constructor as the existing DOM and reuse the component instance, only updating props.

10. **Add effect disposal hierarchy** -- When a parent effect is disposed, dispose all child effects. This prevents memory leaks from nested effects in components.

11. **Add development mode warnings** -- Hook ordering violations, missing keys in lists, signal reads outside effects, unused signals.

12. **Add middleware execution to the router** -- The infrastructure is there (route config accepts middleware), but the Router component ignores it.

13. **Add route-level data loading** -- A `loader` function in route config that runs before the component renders, with the result passed as a prop.

14. **Add SSR hydration** -- Currently `mount()` clears the container. Implement a `hydrate()` function that attaches to existing DOM, reconciling differences without full re-render.

### Nice to Have

15. **Transition animations for route changes** -- Enter/exit animations with deferred unmount.

16. **Virtualized list component** -- `VirtualList` and `VirtualTable` for large datasets.

17. **CSS scoping solution** -- Even a simple convention like CSS Modules support or a `css` tagged template.

18. **DevTools browser extension** -- Component tree viewer, signal inspector, effect dependency graph.

19. **Persistent query client** -- Offline support by persisting the query cache to localStorage/IndexedDB.

### Consider for v2

20. **Concurrent rendering** -- Ability to interrupt expensive renders, similar to React's concurrent features.

21. **Compiler** -- A Svelte-style compiler that eliminates the VDOM overhead entirely by compiling components to direct DOM manipulation.

22. **Module federation** -- Lazy loading island code from different origins for micro-frontend architectures.

23. **Streaming SSR with Suspense** -- The `renderToStream` exists but does not integrate with `Suspense` boundaries to stream shell + deferred content.

---

## Overall Rating

| Aspect | Score (1-10) | Notes |
|---|---|---|
| **API Design / Ergonomics** | 7 | Well-chosen APIs, familiar to React/Solid users. Loses points for `h()` DX. |
| **Signal System** | 8 | Clean, correct, compact. Missing some edge case handling. |
| **Component Model** | 3 | Component-level re-renders, no instance reuse on reconciliation, broken lifecycle. |
| **Router** | 5 | Functional for basic apps. Missing data loading, middleware execution, animations. |
| **Data Fetching** | 5 | Good API surface, but cache invalidation is broken and features are half-implemented. |
| **Forms** | 6 | Solid foundation with `useForm` + resolvers. `register()` stale value issue is a footgun. |
| **Islands Architecture** | 9 | Best-in-class for a non-Astro framework. Priority queue + shared stores is excellent. |
| **SSR** | 6 | `renderToString` works. No hydration, no streaming + Suspense integration. |
| **Animation** | 7 | Springs and tweens are well-implemented. Gesture system is surprisingly complete. |
| **Accessibility** | 8 | Comprehensive built-in a11y utilities. Focus trap, roving tab index, announcements. |
| **Testing** | 5 | Basic but functional. Missing many Testing Library features. |
| **TypeScript** | 5 | `.d.ts` files exist but are basic. No generic inference for stores or forms. |
| **Performance** | 4 | Component-level re-renders, no scheduling, O(n*m) in keyed reconciliation. |
| **Documentation** | 6 | API reference is thorough. Missing guides, tutorials, and migration docs. |
| **Production Readiness** | 2 | Multiple critical bugs, no lifecycle, no DevTools, no ecosystem. |
| **Bundle Size** | 9 | Genuinely tiny if the claim holds. Hard to verify without a build. |
| **Innovation** | 8 | The combination of signals + hooks + islands is unique and well-motivated. |
| **Overall** | **5.5** | Great ideas, promising architecture, but needs significant work on fundamentals. |

---

**Bottom line:** I would not bet a production app on this today. The critical bugs in component lifecycle, context, and reconciliation would cause real production incidents. However, the architecture is sound, the API design is thoughtful, and the islands implementation is genuinely innovative. If the core rendering pipeline is fixed (component instance reuse, proper lifecycle, tree-scoped context), and a JSX path is offered, this could become a compelling choice for content-heavy sites that need selective interactivity -- a space where Astro currently dominates but with a less integrated component model. I would revisit after a v0.5 that addresses the "Must Fix" items above.
