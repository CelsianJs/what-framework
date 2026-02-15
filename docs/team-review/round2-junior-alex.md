# Round 2 Review: What Framework (Post-Phase 1 Fixes)
## Reviewer: Alex (Junior Developer, 1.5 years React experience)
## Date: February 2026

---

## Table of Contents

1. [Fix Verification](#fix-verification)
2. [New Issues Found](#new-issues-found)
3. [API Ergonomics Round 2](#api-ergonomics-round-2)
4. [Building Advanced Apps](#building-advanced-apps)
5. [Framework Gaps for Real-World Apps](#framework-gaps-for-real-world-apps)
6. [Comparison Update](#comparison-update)
7. [Updated Wishlist](#updated-wishlist)

---

## Fix Verification

I re-read every source file. Here is my assessment of each Phase 1 fix, whether it was applied correctly, and whether it introduced any regressions.

### Fix 1: Diamond Dependency Glitch in reactive.js

**Status: FIXED -- but with a behavioral change worth noting.**

In my first review I flagged that `computed` could produce glitch values when two computed signals depend on the same source (the classic diamond dependency problem). The fix is in `reactive.js` lines 145-158:

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
  if (batchDepth === 0) scheduleMicrotask();
}
```

All effects are now deferred via `pendingEffects` and a microtask, rather than running synchronously inline. The `_onNotify` callback on computed signals marks them dirty without recomputing. This is correct -- effects always run after all signals have been written, so computeds that depend on the same root signal will never observe a half-updated state.

**Potential regression:** The move to microtask-based flushing means effects no longer run synchronously by default. This is a semantic change. Code that did this before the fix:

```js
const a = signal(1);
effect(() => console.log(a()));
a.set(2);
// Previously: console.log(2) ran synchronously
// Now: console.log(2) runs on the next microtask
```

This is actually the correct behavior (SolidJS and Preact Signals both defer), but any existing code that relied on synchronous effect execution will break. The `flushSync()` export covers this escape hatch, which is good. However, the QUICKSTART docs should mention this timing model. Right now there is no documentation about when effects fire relative to signal writes.

**Verdict: Fix is correct, no functional regression, but timing semantics changed without documentation.**

### Fix 2: DocumentFragment Bug in patchNode

**Status: FIXED.**

In my first review I noted that `patchNode` in `dom.js` would crash when encountering an array vnode because `DocumentFragment` nodes empty themselves when appended, breaking the reconciliation state. The fix at `dom.js` lines 546-558:

```js
// Array -- use marker comments to bracket the range (DocumentFragment empties on append)
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

This uses marker comments (`<!--[-->` and `<!--]-->`) to bracket array ranges instead of relying on a `DocumentFragment`. The `startMarker._arrayEnd` reference allows future reconciliation to find the extent of the array. This is the same strategy Svelte uses.

**Potential issue I noticed:** The marker-based approach creates the array region correctly, but I do not see any code in `reconcileChildren` or `patchNode` that detects `startMarker._arrayEnd` on subsequent patches. When the component re-renders and produces the same array structure, `patchNode` receives `startMarker` (a comment node) and the new array vnode. The code at line 521 checks `domNode.nodeType === 8` (comment) for null/false/true placeholders, but does not check for `_arrayEnd`. This means the second render will see a comment node, not recognize it as an array bracket, and fall through to one of the replacement branches.

I believe this works in practice because the whole component re-renders via its reactive effect, which calls `reconcileChildren(wrapper, vnodes)` at the wrapper level (line 248), not `patchNode` on individual children. So the array is handled at the `reconcileChildren` level where child-by-child diffing occurs. But if someone manually nests arrays (e.g., `h('div', null, [a, b], [c, d])`), the second render might not correctly update the bracketed array region.

**Verdict: Fix is correct for the common case. Edge case with nested arrays in static elements might still have issues, but unlikely to hit in practice.**

### Fix 3: ErrorBoundary Using Component Tree Instead of Stack

**Status: FIXED.**

This was a significant issue. Previously, `reportError` walked the runtime `componentStack` array, which is only populated during render. Errors thrown asynchronously (e.g., in `useEffect`, event handlers, promises) would find an empty stack and never reach the boundary.

The fix adds `_parentCtx` to each component context (`dom.js` line 174):

```js
_parentCtx: componentStack[componentStack.length - 1] || null,
```

And `_errorBoundary` is inherited via the parent chain (`dom.js` lines 176-183):

```js
_errorBoundary: (() => {
  let p = componentStack[componentStack.length - 1];
  while (p) {
    if (p._errorBoundary) return p._errorBoundary;
    p = p._parentCtx;
  }
  return null;
})()
```

The `reportError` function in `components.js` (lines 142-153) now walks `_parentCtx`:

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

This is correct. The component tree (`_parentCtx`) is persistent, so async errors can traverse it at any time. The error boundary context in `createErrorBoundary` (`dom.js` lines 265-271) also sets `_errorBoundary` on a dedicated `boundaryCtx`, which child components find via the stack during render.

**One thing I want to verify:** The `_errorBoundary` on each component context is captured at creation time (during render). If the error boundary itself unmounts and remounts, child components that were created before the remount will still hold a reference to the old boundary's `handleError` function. This could potentially invoke a stale handler. In practice this is unlikely because an error boundary remounting means its children remount too, but it is worth being aware of.

**Verdict: Fix is correct and handles async errors properly. No regressions observed.**

### Fix 4: Memory Leaks in useMediaQuery and useLocalStorage

**Status: FIXED.**

My first review identified that both `useMediaQuery` and `useLocalStorage` in `helpers.js` added event listeners without cleanup. Both now register cleanup callbacks on the component context.

`useMediaQuery` (`helpers.js` lines 85-100):

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

`useLocalStorage` (`helpers.js` lines 104-144):

```js
const dispose = effect(() => {
  try {
    localStorage.setItem(key, JSON.stringify(s()));
  } catch { /* quota exceeded, etc */ }
});

let storageHandler = null;
if (typeof window !== 'undefined') {
  storageHandler = (e) => {
    if (e.key === key && e.newValue !== null) {
      try { s.set(JSON.parse(e.newValue)); } catch {}
    }
  };
  window.addEventListener('storage', storageHandler);
}

const ctx = _getCurrentComponentRef?.();
if (ctx) {
  ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
  ctx._cleanupCallbacks.push(() => {
    dispose();
    if (storageHandler) window.removeEventListener('storage', storageHandler);
  });
}
```

Both fixes correctly tie cleanup to the component lifecycle. When the component unmounts, `disposeComponent` in `dom.js` runs `_cleanupCallbacks`, which removes the listeners.

**Remaining concern:** If these functions are called _outside_ a component context (e.g., at module level for global state), the cleanup is never registered. The `ctx` check is `_getCurrentComponentRef?.()`, which returns `null` outside a component. This means the listeners persist for the lifetime of the app. This is actually correct behavior for global usage (you want the signal to stay alive), but it should be documented. A developer who calls `useMediaQuery('(prefers-color-scheme: dark)')` at the module level should know the listener is permanent.

**Verdict: Fix is correct. Cleanup works inside components. Outside components, listeners are intentionally permanent but undocumented.**

### Fix 5: Router Link '/' Always Active

**Status: FIXED.**

My first review identified that the `Link` component's `isActive` check (`currentPath.startsWith(href)`) meant the home link at `/` was always active since every path starts with `/`.

The fix in `router/src/index.js` line 265:

```js
const isActive = href === '/' ? currentPath === '/' : currentPath.startsWith(href);
```

This special-cases `/` to require an exact match. Every other href still uses `startsWith`, which is correct for nested routes (e.g., `/users` should be active on `/users/123`).

**Edge case I noticed:** What about hrefs like `/a`? If the current path is `/about`, then `currentPath.startsWith('/a')` is `true`, so the `/a` link would incorrectly show as active. The `startsWith` check should probably be `currentPath === href || currentPath.startsWith(href + '/')` to ensure it only matches at path segment boundaries.

Consider:
- `href="/a"`, `currentPath="/about"` => `"/about".startsWith("/a")` is `true` -- BUG
- `href="/a"`, `currentPath="/a/b"` => `"/a/b".startsWith("/a")` is `true` -- CORRECT
- With the fix: `currentPath === "/a" || currentPath.startsWith("/a/")` => would give correct results for both

**Verdict: The '/' case is fixed, but a similar prefix-matching bug exists for short paths. Needs a segment-boundary check.**

### Fix 6: Silent Error Swallowing

**Status: PARTIALLY FIXED.**

My first review complained about empty catch blocks throughout the codebase. Let me check each location:

**`dom.js` line 44** -- cleanup error: `console.error('[what] cleanup error:', e)` -- FIXED
**`dom.js` line 53** -- onCleanup error: `console.error('[what] onCleanup error:', e)` -- FIXED
**`dom.js` line 57** -- effect dispose error: still `{ /* effect already disposed */ }` -- NOT FIXED
**`dom.js` line 218** -- render error: `console.error('[what] Uncaught error in component:', ...)` -- FIXED
**`dom.js` line 237** -- onMount error: `console.error('[what] onMount error:', e)` -- FIXED

**`reactive.js` line 114** -- cleanup error: still `{ /* cleanup error */ }` -- NOT FIXED
**`reactive.js` line 135** -- dispose cleanup error: still `{ /* cleanup error */ }` -- NOT FIXED

**`helpers.js` line 119** -- localStorage write: still `{ /* quota exceeded, etc */ }` -- NOT FIXED (though this one is debatable)
**`helpers.js` line 127** -- JSON parse: still `catch {}` -- NOT FIXED

So the DOM layer (`dom.js`) now logs errors, which is good. But the reactive layer (`reactive.js`) still silently swallows cleanup errors. And `helpers.js` still has empty catches for localStorage operations.

The `reactive.js` ones matter because if a cleanup function throws (e.g., trying to remove a listener that was never added, or calling a disposed resource), the developer gets zero feedback. At minimum, a `console.warn` in development mode would help.

The `helpers.js` localStorage catches are more defensible -- `localStorage.setItem` can throw `QuotaExceededError`, and `JSON.parse` on corrupted data should gracefully degrade. But a `console.warn` for the quota exceeded case would help developers notice they are hitting storage limits.

**Verdict: Partially fixed. dom.js has proper error logging now. reactive.js and helpers.js still have silent catches.**

---

## New Issues Found

Now that I have spent more time with the codebase, here are issues I missed in Round 1 or that the Phase 1 changes introduced.

### New Issue 1: `computed` Can Trigger Infinite Loops Without Clear Error

In `reactive.js`, the `computed` function creates an inner effect:

```js
export function computed(fn) {
  let value, dirty = true;
  const subs = new Set();

  const inner = _createEffect(() => {
    value = fn();
    dirty = false;
    notify(subs);
  }, { lazy: true });
  // ...
}
```

When `fn` is evaluated, it calls `notify(subs)`, which adds subscribers to `pendingEffects`. If one of those subscribers reads the computed again (triggering another `_runEffect(inner)`), we get a re-entrant computation. The `flush()` function at line 171 has a 100-iteration guard:

```js
while (pendingEffects.size > 0 && iterations < 100) { ... }
if (iterations >= 100) {
  console.warn('[what] Possible infinite effect loop detected');
}
```

But 100 iterations is a lot of wasted CPU before the developer gets a vague warning. And the warning says "possible" -- it does not tell you which signal or effect is looping. For a junior developer (like me), debugging this would be painful. Better behavior would be to track the specific effect that re-triggered and name it in the error message, perhaps using the component's `displayName` or the effect's function name.

### New Issue 2: `useContext` Reads the Render-Time Stack, Not the Tree

`useContext` in `hooks.js` lines 133-143:

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

This walks the `componentStack` -- the runtime render stack, not the `_parentCtx` tree. The same bug that ErrorBoundary had before the Phase 1 fix. If a component reads context in a `useEffect` callback or an event handler (after the render stack has unwound), `_getComponentStack()` returns an empty or unrelated stack, and the context lookup fails silently by returning the default value.

This is a real problem. Consider:

```js
function Child() {
  const theme = useContext(ThemeContext); // Works during render

  useEffect(() => {
    const theme = useContext(ThemeContext); // BROKEN - stack is empty
    // theme is now the default value, not the provided one
  }, []);

  return h('div', null, theme);
}
```

The fix should use `_parentCtx` traversal, similar to how `reportError` was fixed. The current component context should store a reference to its provider chain, and `useContext` should walk `_parentCtx` instead of the render stack.

### New Issue 3: `createResource` Does Not Integrate with Component Lifecycle

In `hooks.js` lines 207-246, `createResource` creates signals and starts a fetch, but the effect that holds the fetch result is not scoped to any component. If the component unmounts while a fetch is in flight:

```js
const refetch = async (source) => {
  loading.set(true);
  error.set(null);
  try {
    const fetchPromise = fetcher(source);
    currentFetch = fetchPromise;
    const result = await fetchPromise;
    if (currentFetch === fetchPromise) {
      data.set(result);       // Signal write on unmounted component
      loading.set(false);
    }
  } catch (e) { ... }
};
```

Writing to signals after unmount does not crash (signals are standalone), but it does trigger effects that may try to update disposed DOM nodes. The `effect` in `createComponent` checks `ctx.disposed` at the top, so the render effect will bail out. But any other effects subscribing to these signals (e.g., from other mounted components sharing the resource) will still fire.

Compare this to `useSWR` in `data.js`, which uses `scopedEffect` to tie its lifecycle to the component. `createResource` does not use `scopedEffect` -- it uses a bare `async` function with no lifecycle integration.

**Recommendation:** `createResource` should accept a cleanup mechanism or use `AbortController` to cancel in-flight fetches when the component unmounts, similar to how React's `useEffect` cleanup pattern works.

### New Issue 4: `useSWR` Returns Inconsistent Signal Types

Look at the `useSWR` return value in `data.js` lines 169-183:

```js
return {
  data: () => data(),        // Function wrapper
  error: () => error(),      // Function wrapper
  isLoading,                 // RAW computed signal (no wrapper!)
  isValidating: () => isValidating(),  // Function wrapper
  mutate: (newData, ...) => { ... },
  revalidate,
};
```

Notice that `isLoading` is returned as a raw computed signal, while `data`, `error`, and `isValidating` are wrapped in `() =>` function closures. This means:

```js
const { data, isLoading } = useSWR(key, fetcher);
data();         // Correct -- calls the wrapper function
isLoading();    // Also works -- calls the computed signal
// But they have different identities:
typeof data;      // 'function' -- a wrapper
typeof isLoading; // 'function' -- but a computed signal with .set, .peek, etc.
```

The inconsistency means `isLoading` has extra properties (`.peek()`, `._signal`) that `data` does not. If someone tries `data.peek()`, it is undefined. If someone does `isLoading.set(true)`, computed signals do not have `.set`, so it is also undefined. This is confusing.

All return values should be consistently wrapped (or consistently raw).

### New Issue 5: `For` Component Evaluates `each` Non-Reactively

In `components.js` lines 173-185:

```js
export function For({ each, fallback = null, children }) {
  const list = typeof each === 'function' ? each() : each;
  if (!list || list.length === 0) return fallback;

  const renderFn = Array.isArray(children) ? children[0] : children;
  if (typeof renderFn !== 'function') {
    console.warn('For: children must be a function');
    return fallback;
  }

  return list.map((item, index) => renderFn(item, index));
}
```

The `each` prop is unwrapped once with `each()` if it is a function. But this happens during the render of the parent component (since `For` is called as a component function). If `each` is a signal, reading it here subscribes the _parent_ component to the signal, not `For` itself. This means the entire parent re-renders when the list changes, not just the `For` region.

In SolidJS, `<For>` creates its own reactive scope that only updates the specific list items that changed, without re-rendering the parent. Here, `For` is just a plain function that returns an array of vnodes -- it has no internal reactive scope.

This is fine for small lists but defeats the purpose of having a `<For>` component for larger lists. The developer gets the API shape of SolidJS's `<For>` but not the performance characteristics.

### New Issue 6: `Show` Component Has the Same Problem as `show()` Helper

In `components.js` lines 164-168:

```js
export function Show({ when, fallback = null, children }) {
  const condition = typeof when === 'function' ? when() : when;
  return condition ? children : fallback;
}
```

This evaluates `when` once during render. There is no reactive scope specific to `Show` -- the parent component's effect is the reactive boundary. This means `<Show>` is equivalent to:

```js
when() ? children : fallback
```

Which is exactly what the `show()` helper does. There is no benefit to using `<Show>` over a ternary, except readability. The docs should make this clear. In SolidJS, `<Show>` creates a fine-grained reactive boundary that avoids re-rendering siblings. Here, it does not.

### New Issue 7: `memo` Does Not Work Correctly With Signal-Based Rendering

In `components.js` lines 13-29:

```js
export function memo(Component, areEqual) {
  const compare = areEqual || shallowEqual;
  let prevProps = null;
  let prevResult = null;

  function MemoWrapper(props) {
    if (prevProps && compare(prevProps, props)) {
      return prevResult;
    }
    prevProps = { ...props };
    prevResult = Component(props);
    return prevResult;
  }

  MemoWrapper.displayName = `Memo(${Component.name || 'Anonymous'})`;
  return MemoWrapper;
}
```

`memo` stores `prevResult` (the previous vnode tree) and returns it if props have not changed. But the problem is that `prevResult` may contain stale closures or stale signal reads.

Consider: a `memo`-wrapped component reads a global signal internally. The parent passes the same props, so `memo` returns `prevResult`. But the global signal changed. The returned vnode tree contains the old signal values baked in. The component does not re-render because `memo` short-circuited.

In React, this works because `React.memo` prevents the component _function_ from being called, but React's reconciler still manages subscriptions via hooks. In What Framework, the component function IS the reactive effect. Skipping it means skipping signal subscription, which means updates are missed.

This is subtle but important. `memo` is fundamentally at odds with signal-based reactivity when the component reads signals that are not passed as props.

### New Issue 8: `createStore` Action Proxy Uses `peek()`, Missing Reactivity

In `store.js` lines 74-91:

```js
actions[key] = (...args) => {
  batch(() => {
    const proxy = new Proxy({}, {
      get(_, prop) {
        if (signals[prop]) return signals[prop].peek();
        if (computeds[prop]) return computeds[prop].peek();
        return undefined;
      },
      set(_, prop, val) {
        if (signals[prop]) signals[prop].set(val);
        return true;
      },
    });
    fn.apply(proxy, args);
  });
};
```

Actions use `.peek()` to read signal values, which means they read without subscribing. This is intentional -- you do not want actions to create reactive dependencies. But it also means that `this.count` inside an action reads the value at the time of the call, not reactively. This is correct behavior for actions.

However, there is a subtle bug: if an action calls another action via `this`, it does not work. The proxy's `get` trap only checks `signals` and `computeds`, not `actions`. So `this.increment()` inside an action would return `undefined`.

```js
const useStore = createStore({
  count: 0,
  increment() { this.count++; },
  incrementTwice() {
    this.increment();  // undefined! Actions are not on the proxy
    this.increment();
  },
});
```

**Recommendation:** Add actions to the proxy's `get` trap:

```js
get(_, prop) {
  if (signals[prop]) return signals[prop].peek();
  if (computeds[prop]) return computeds[prop].peek();
  if (actions[prop]) return actions[prop];  // Add this
  return undefined;
},
```

### New Issue 9: `useEffect` Cleanup Timing Is Different From React

In `hooks.js` lines 67-86:

```js
export function useEffect(fn, deps) {
  // ...
  if (depsChanged(hook.deps, deps)) {
    queueMicrotask(() => {
      if (ctx.disposed) return;
      if (hook.cleanup) hook.cleanup();
      hook.cleanup = fn() || null;
    });
    hook.deps = deps;
  }
}
```

The cleanup runs in a `queueMicrotask`, which means it runs _before_ the next render but _after_ the current synchronous code. In React, `useEffect` cleanup runs before the new effect runs, but both happen after paint. Here, the effect runs on the microtask after render, which is before paint.

More importantly, there is no guarantee about ordering between multiple `useEffect` calls. If a component has two effects:

```js
useEffect(() => { console.log('A'); return () => console.log('cleanup A'); }, [dep]);
useEffect(() => { console.log('B'); return () => console.log('cleanup B'); }, [dep]);
```

Each schedules its own `queueMicrotask`. The microtask queue is FIFO, so order is preserved. But if one effect synchronously writes to a signal (triggering a re-render), the second effect's microtask might run in a different render cycle's context.

This is an edge case, but worth documenting.

### New Issue 10: Portal Implementation Is Incomplete

In `helpers.js` lines 148-157:

```js
export function Portal({ target, children }) {
  if (typeof document === 'undefined') return null;
  const container = typeof target === 'string'
    ? document.querySelector(target)
    : target;
  if (!container) return null;
  return { tag: '__portal', props: { container }, children: Array.isArray(children) ? children : [children], _vnode: true };
}
```

`Portal` returns a vnode with `tag: '__portal'`, but looking through all of `dom.js`, there is no special handling for `'__portal'` anywhere. The `createComponent` function checks for `'__errorBoundary'` and `'__suspense'`, but not `'__portal'`:

```js
if (Component === '__errorBoundary' || vnode.tag === '__errorBoundary') {
  return createErrorBoundary(vnode, parent);
}
if (Component === '__suspense' || vnode.tag === '__suspense') {
  return createSuspenseBoundary(vnode, parent);
}
```

This means `Portal` is non-functional. The vnode with `tag: '__portal'` will be treated as a component call with a string function, which will crash (`typeof '__portal'` is `'string'`, not `'function'`, so it falls through to element creation, creating a literal `<__portal>` HTML element).

This is not a Phase 1 regression -- it was always broken. But I missed it in Round 1 because I did not trace the full render path for Portal.

---

## API Ergonomics Round 2

Now that I have spent significantly more time reading the code and mentally building with the framework, here are my updated ergonomics observations.

### The Signal/Hook Duality Is Still the Biggest Friction Point

After the Phase 1 fixes, the framework is more correct, but the fundamental tension between signals and hooks remains. The component rendering model is `effect(() => Component(propsSignal()))` -- the entire component body is a reactive effect. This means:

1. Every signal read inside the component subscribes the entire component to that signal.
2. `useState` returns `[s(), s.set]` -- the value is unwrapped, so changes trigger the parent effect (the component).
3. `useSignal` returns the raw signal, so the developer chooses when to unwrap.

The practical result: whether you use `useState` or `useSignal`, the component re-renders on any state change. There is no fine-grained update at the component level. The "fine-grained" updates happen at the DOM level via reconciliation, which patches only changed DOM nodes. This is closer to React's model than SolidJS's model, despite using signals under the hood.

This needs to be explained clearly in the docs. Right now, a developer reading "fine-grained reactivity without virtual DOM overhead" expects SolidJS-level granularity. What they get is closer to "React with signals as state containers and surgical DOM patching instead of virtual DOM diffing."

### The `() =>` Wrapper Tax

When using signals in JSX/h() props, developers need to wrap reactive values in functions:

```js
h('span', { style: () => ({ color: theme() }) }, () => count())
```

Every signal read that should update independently needs a `() =>` wrapper. But looking at `setProp` in `dom.js`, there is no handling for function-valued props (except event handlers). So the `() =>` in the style prop above does not actually do anything special -- it is just evaluated during the component's reactive effect re-run. The function wrapper is needed for the _child text_ case, but not for props.

Wait -- actually, looking more carefully at `createDOM` in `dom.js`, text children are converted to `document.createTextNode(String(vnode))`. If `vnode` is a function, it would render as the function's `.toString()`, not its return value. So the `() =>` wrapper for children does not work either, unless the entire component re-renders.

After tracing through the code more carefully, I believe the `() =>` pattern only works because:
1. The signal read (`count()`) inside the `() =>` wrapper triggers the parent component's effect.
2. The parent component re-renders, calling `() => count()` again to get the new value.
3. The reconciler diffs the new text/props against the old DOM.

So the `() =>` wrapper is actually unnecessary -- `count()` alone would work the same way because both cause the component effect to re-run. The wrapper might be a holdover from SolidJS patterns where functions are evaluated lazily in the DOM. In What Framework, they are not.

This is extremely confusing. The demos use `() =>` wrappers in some places and bare signal reads in others, and they all work the same way.

### `formState.errors()` Is Still Verbose

Even after Phase 1, accessing form errors requires calling the signal function:

```js
formState.errors().email?.message
```

In React Hook Form, this is just `errors.email?.message`. The extra `()` is a constant papercut. A possible improvement: the `formState` object could use getters (like `createStore` does) instead of signal wrappers:

```js
formState: {
  get errors() { return errors(); },
  get values() { return values(); },
  // ...
}
```

This would let developers write `formState.errors.email?.message` without the `()`.

### Event Handler Error Propagation Is Good Now

After the Phase 1 fixes, errors in component render bodies are caught by error boundaries and logged to the console. Event handlers are wrapped in `untrack` (`dom.js` line 667):

```js
const wrappedHandler = (e) => untrack(() => value(e));
```

But errors thrown inside event handlers are not caught by the error boundary. The `untrack` wrapper does not have a try/catch. If a handler throws:

```js
onClick: () => { throw new Error('oops'); }
```

This propagates as an uncaught error to the browser's global error handler, bypassing the error boundary. React does not catch event handler errors in error boundaries either, but it is worth noting.

---

## Building Advanced Apps

I mentally walked through building five complex applications. Here is where the framework helps and where it falls short.

### App 1: Drag-and-Drop Kanban Board

A Kanban board needs: columns with cards, drag to reorder cards within a column, drag to move cards between columns, visual indicators during drag (ghost card, drop targets).

**What works:**
- `useGesture` from `animation.js` provides `onDrag`, `onDragStart`, `onDragEnd` with position and velocity tracking. This is a solid foundation.
- `spring` can animate card positions when they settle into new positions.
- `createStore` could manage the board state (columns, cards, card order).
- The keyed reconciliation with LIS in `dom.js` handles reordering efficiently.

**What is missing or broken:**

1. **No drag-and-drop abstraction layer.** `useGesture` gives raw mouse/touch coordinates, but I need to build all the higher-level logic myself: hit testing to determine which column/position to drop into, calculating drop indicators, constraining drag axes, handling scroll during drag, managing the drag preview/ghost element. In React, `@dnd-kit` or `react-beautiful-dnd` handle all of this. Here I am building from scratch.

2. **No way to pass data through the drag operation.** When dragging a card, I need to know which card is being dragged and attach metadata (card ID, source column). `useGesture` tracks coordinates but has no concept of drag data or a drag context.

3. **Global store limitations.** `createStore` cannot handle nested state updates cleanly. Moving a card from column A to column B requires:
   ```js
   // Remove from source column's cards array
   // Add to target column's cards array at specific index
   ```
   Without Immer or structural sharing, this means spreading nested arrays manually inside a batch. With a complex board (multiple columns, each with many cards), this gets tedious.

4. **The `useGesture` cleanup.** Looking at `animation.js` lines 416-435, the `attachListeners` function adds event listeners to `window` for `mousemove`, `mouseup`, etc. These are cleaned up when the scoped effect disposes. But during the drag operation, the card element might be removed from the DOM (if the component re-renders the list). The gesture state would become stale.

**Effort estimate:** To build a basic Kanban board (3 columns, drag cards between them, persist to localStorage), I estimate 400-500 lines of application code, compared to maybe 200 lines with React + @dnd-kit.

### App 2: Real-Time Chat Component

A chat app needs: WebSocket connection, message list with auto-scroll, typing indicators, message input, user presence, optimistic message sending.

**What works:**
- Signals for message state: `const messages = signal([])`.
- `onCleanup` for WebSocket teardown.
- `onMount` for establishing the connection.
- `useLocalStorage` for persisting unread count or draft message.
- `batch` for updating multiple state values when a message arrives (messages list, unread count, last message time).

**What is missing or broken:**

1. **No auto-scroll primitive.** When new messages arrive, the chat should auto-scroll to the bottom _unless_ the user has scrolled up to read history. This requires:
   - Detecting scroll position relative to the bottom.
   - Conditionally scrolling after DOM update.
   - `smoothScrollTo` from `scheduler.js` exists but works on arbitrary elements, not specifically on "scroll-to-bottom-if-near-bottom" logic.
   I need to build this myself with `useRef`, `onMount`, and manual scroll calculations.

2. **No `useWebSocket` hook.** I need to manage the WebSocket lifecycle manually:
   ```js
   function Chat() {
     const ws = useRef(null);
     const messages = useSignal([]);

     onMount(() => {
       ws.current = new WebSocket(url);
       ws.current.onmessage = (e) => {
         messages.set(prev => [...prev, JSON.parse(e.data)]);
       };
     });

     onCleanup(() => {
       ws.current?.close();
     });
   }
   ```
   This is straightforward but could be a reusable hook. The framework does not include one.

3. **Large message list performance.** With thousands of messages, the reconciler diffs every child of the message list on every update. There is no virtualization built into the framework. In React, I would reach for `react-window` or `@tanstack/virtual`. Here, I need to build or find a virtualized list.

4. **Optimistic updates race condition.** If I optimistically add a message and then the server sends back the confirmed message, I need to deduplicate. The `useSWR` `mutate` function supports optimistic updates, but WebSocket-based chat does not use SWR -- it is push-based, not pull-based. There is no framework primitive for push-based state reconciliation.

**Effort estimate:** A basic chat (connect, send, receive, display) is maybe 150 lines. Adding auto-scroll, typing indicators, presence, and optimistic sending pushes it to 400+.

### App 3: Multi-Step Wizard Form

A wizard needs: multiple steps, validation per step, forward/back navigation, progress indicator, final submission of all data, persisting draft state.

**What works:**
- `useForm` handles validation per step (I can validate only the current step's fields).
- `useLocalStorage` can persist the wizard state across refreshes.
- `useState` or `useSignal` for tracking the current step.
- The built-in `rules` (required, email, minLength, etc.) cover common validations.

**What is missing or broken:**

1. **`useForm` does not support step-based validation natively.** The `validate(fieldName)` method validates a single field, but there is no `validate(['field1', 'field2'])` for validating a subset of fields (the current step's fields). I would need to call `validate` in a loop:
   ```js
   const stepFields = { 0: ['name', 'email'], 1: ['address', 'city'], 2: ['payment'] };
   async function validateStep() {
     const fields = stepFields[currentStep()];
     let valid = true;
     for (const field of fields) {
       const result = await form.validate(field);
       if (!result) valid = false;
     }
     return valid;
   }
   ```
   This works but is boilerplate that the framework should handle.

2. **No form field array support.** If a wizard step asks "add your team members" with dynamic rows, I need `useFieldArray` (from React Hook Form). There is no equivalent. I would manage an array signal and build my own add/remove/reorder logic.

3. **No cross-step dependency validation.** If step 3's validation depends on values entered in step 1 (e.g., "confirm email matches the one you entered earlier"), the `simpleResolver` validates each field independently. The `match` rule exists (`rules.match('password', 'Passwords must match')`) but it matches within the same form values object, so it would work. Actually, this is fine -- all step values are in the same `useForm` state.

4. **`useForm` register returns stale `value`.** Looking at `form.js` line 67:
   ```js
   function register(name, options = {}) {
     return {
       name,
       value: values()[name] ?? '',  // Evaluated once when register is called
       // ...
     };
   }
   ```
   The `value` is read once from the signal when `register()` is called. If the form re-renders, `register` is called again and gets the new value. But if someone caches the registered props (e.g., `const emailProps = register('email')` at the top of the component), the `value` is stale in subsequent renders. In React Hook Form, `register` returns a ref-based binding that always reads the current value. Here, the developer must call `register` inside the render on every re-render, which is correct but easy to get wrong.

**Effort estimate:** A 4-step wizard with validation, back/forward, progress bar, and localStorage persistence: ~300 lines.

### App 4: Searchable Dropdown / Combobox

A combobox needs: text input with filtering, dropdown list of options, keyboard navigation (arrow keys, enter, escape), selection, multi-select variant, async option loading, accessibility (ARIA).

**What works:**
- `useRovingTabIndex` from `a11y.js` for keyboard navigation between options.
- `useAriaExpanded` for the dropdown open/close state.
- `useAriaSelected` for the selected option.
- `useFocusTrap` could be used for the dropdown (though it might be overkill).
- `Keys` and `onKey` from `a11y.js` for keyboard event handling.
- `useSWR` or `useQuery` for async option loading.
- `debounce` from `helpers.js` for debouncing search input.
- `useId` for generating unique ARIA IDs.

**What is missing:**

1. **No `useClickOutside` hook.** Comboboxes need to close when clicking outside. I need to build this myself:
   ```js
   function useClickOutside(ref, handler) {
     useEffect(() => {
       const listener = (e) => {
         if (ref.current && !ref.current.contains(e.target)) handler();
       };
       document.addEventListener('mousedown', listener);
       return () => document.removeEventListener('mousedown', listener);
     }, []);
   }
   ```
   This is a common enough pattern that the framework should include it.

2. **No floating UI / positioning utility.** The dropdown needs to be positioned relative to the input, flipping when it hits viewport edges. In React, `@floating-ui/react` handles this. Here I need manual positioning with `getBoundingClientRect` and scroll/resize listeners. This is a significant amount of code for a common pattern.

3. **The accessibility story is actually quite good.** Between `useRovingTabIndex`, `useAriaExpanded`, `useId`, `onKey`, and `Keys`, I have most of what I need for a properly accessible combobox. This is a genuine strength of the framework.

4. **Virtualization for large option lists.** If I have 10,000 options, I need a virtualized list. No built-in support.

**Effort estimate:** A fully accessible, keyboard-navigable, async-loading combobox: ~350 lines (with framework's a11y utilities helping significantly).

### App 5: Notifications System with Toasts

A toast notification system needs: global notification store, auto-dismiss with timers, pause-on-hover, stack multiple notifications, enter/exit animations, different types (success, error, warning, info), action buttons, positioning (top-right, bottom-center, etc.).

**What works:**
- `createStore` for the global notification state.
- `spring` or `tween` for entrance/exit animations.
- `cssTransition` from `animation.js` for CSS-based transitions.
- `Portal` for rendering toasts outside the main app tree -- **except Portal is broken (see New Issue 10).**

**What is missing or broken:**

1. **Portal does not work.** This is the most critical blocker. Toasts must render in a portal to avoid being clipped by `overflow: hidden` parents or affected by parent transforms. Since `Portal` is non-functional (no handler for `__portal` in `dom.js`), I cannot use it. I would need to manually call `mount()` on a separate container:
   ```js
   const toastContainer = document.createElement('div');
   document.body.appendChild(toastContainer);
   mount(h(ToastList, {}), toastContainer);
   ```
   This works but breaks the component tree -- toasts cannot access context from the main app tree.

2. **No `useTimeout` / `useInterval` hooks.** Auto-dismiss needs timers that are properly cleaned up. I can use `useEffect` with `setTimeout` inside it, but a dedicated hook would be cleaner:
   ```js
   // What I want:
   useTimeout(() => dismiss(id), 5000);

   // What I have to write:
   useEffect(() => {
     const timer = setTimeout(() => dismiss(id), 5000);
     return () => clearTimeout(timer);
   }, []);
   ```
   Not terrible, but the custom hook would be nicer and handle edge cases (pause/resume).

3. **Animation lifecycle is manual.** When a toast should exit, I need to:
   - Start the exit animation.
   - Wait for it to complete.
   - Remove the toast from the store.
   There is no built-in "animate then remove" pattern. `cssTransition` returns a promise, which helps, but coordinating it with the store update requires careful sequencing. In Framer Motion, `<AnimatePresence>` handles this automatically.

4. **No `AnimatePresence` equivalent.** This is a critical missing piece for any component that needs exit animations. When a vnode is removed from the tree, the DOM reconciler immediately removes the DOM node (`disposeTree` + `removeChild`). There is no way to say "keep this node alive for 300ms while it animates out." This affects not just toasts but any component with exit animations: modals, dropdown menus, page transitions, etc.

**Effort estimate:** A basic toast system (show, auto-dismiss, stacking): ~200 lines. A production-quality one (enter/exit animations, pause-on-hover, positioning, portal): ~500 lines, and the animations would be janky without `AnimatePresence`.

---

## Framework Gaps for Real-World Apps

After mentally building all five apps above, here are the cross-cutting concerns that would block production use:

### 1. No Virtualization

Any app with long lists (chat messages, search results, data tables, combobox options) needs virtualization. The framework has no `<VirtualList>` or `useVirtualizer` equivalent. This is not a core framework concern (React does not have it built-in either), but given that What Framework includes data fetching, forms, animations, and accessibility built-in, the absence of virtualization is notable.

### 2. No AnimatePresence / Exit Animations

As discussed in the toast system above, there is no way to delay DOM removal for exit animations. This is a hard requirement for polished UIs. Every modal, dropdown, toast, and page transition needs it.

### 3. Portal Is Broken

Modals, tooltips, toasts, dropdown menus -- all need portals. The current `Portal` implementation returns a vnode with an unhandled tag. Until this is fixed, these common UI patterns require workarounds.

### 4. No SSR Hydration Mismatch Detection

The server package has `renderToString` and `renderToStream`, but there is no mention of hydration mismatch detection. If the server renders HTML that differs from what the client would render (common with date/time formatting, user-agent-dependent code, etc.), the client silently produces wrong output or crashes. React warns about hydration mismatches. The framework should too.

### 5. No Error Recovery in Data Fetching

`useSWR` and `useQuery` handle errors by setting an error signal, but there is no built-in retry UI pattern. TanStack Query has `retry`, `retryDelay`, and `useErrorBoundary` integration. `useQuery` in the framework has `retry` and `retryDelay`, which is good, but there is no integration with `ErrorBoundary`. If a query fails after all retries, the error just sits in the signal -- the error boundary does not catch it because the error is not thrown, it is stored.

### 6. No Route-Level Data Loading

Modern frameworks (Remix, Next.js, SvelteKit) support loading data at the route level before the component renders. The router has `loading` states, but no `loader` function that runs before the component mounts. The developer must combine `useSWR` inside each route component, leading to waterfall fetches for nested routes.

### 7. No Type Safety in Routing

Route params are typed as `Record<string, string>` (or rather, they are untyped JavaScript objects). In a TypeScript project, I would want:

```ts
// What I want:
const { id } = useParams<{ id: string }>();

// What I get:
const { params } = route;  // params: any
```

TanStack Router and the latest React Router have made significant strides in type-safe routing.

---

## Comparison Update

After Phase 1 fixes, here is how the framework compares:

### Improved Since Round 1

| Aspect | Before Phase 1 | After Phase 1 |
|--------|----------------|---------------|
| Error boundaries | Broken for async errors | Work correctly via _parentCtx tree |
| Memory leaks | useMediaQuery/useLocalStorage leaked | Properly cleaned up in component scope |
| Link active state | '/' always active | Fixed with exact match for '/' |
| Cleanup error visibility | Completely silent | dom.js now logs errors |
| Diamond dependency | Could produce glitch values | Effects deferred via microtask |

### Still Behind React

| Aspect | React | What | Gap |
|--------|-------|------|-----|
| Context in effects | Works via fiber tree | Broken (uses render stack) | Critical |
| Portal | Works | Broken | Critical |
| Exit animations | AnimatePresence (Framer Motion) | Nothing | Major |
| Virtualization | react-window, @tanstack/virtual | Nothing | Major |
| Error overlay | Built into dev mode | Nothing | Moderate |
| Type-safe routing | TanStack Router | No types | Moderate |
| Route data loading | Remix loaders | Nothing | Moderate |

### Where What Framework Leads

| Aspect | What Advantage |
|--------|----------------|
| Bundle size | ~4kB vs React's ~40kB (10x smaller) |
| Built-in a11y | useFocusTrap, useRovingTabIndex, announce -- no extra deps |
| Built-in forms | useForm + validation -- no react-hook-form needed |
| Built-in data fetching | useSWR, useQuery -- no tanstack-query needed |
| Islands architecture | First-class, five hydration modes |
| Source readability | ~2000 lines total core, fully understandable |
| Built-in animations | spring, tween, useGesture -- no framer-motion needed |
| Gesture support | Built-in drag, pinch, swipe, long-press detection |

### Honest Assessment After Phase 1

The Phase 1 fixes addressed the most critical correctness issues. Error boundaries work now. Memory leaks are fixed. The diamond dependency glitch is resolved. These were all blockers for any serious use.

But the fixes also revealed deeper architectural decisions that cannot be patched incrementally:
- The component rendering model (whole-component reactive effects) means fine-grained reactivity is at the DOM level, not the component level.
- The context system using the render stack is fundamentally fragile.
- Portal support requires adding a new code path to the DOM reconciler.
- Exit animations require a fundamentally different approach to DOM node removal.

The framework is in a better position than before, but the gap between "technically correct" and "production-ready" is still significant.

---

## Updated Wishlist

My top 10 things that would make me seriously consider adopting What Framework for a production project:

### 1. Fix `useContext` to Walk the Component Tree, Not the Render Stack

This is the most critical remaining bug. Context is fundamental to any non-trivial app. The fix should be straightforward -- the same `_parentCtx` traversal used for error boundaries should work for context lookup.

### 2. Implement Portal Support in the DOM Reconciler

Add a `createPortal` code path to `dom.js` that renders children into a specified container while maintaining the component context chain. Without this, modals, tooltips, and toasts require ugly workarounds.

### 3. Add AnimatePresence / Exit Animation Support

Allow developers to delay DOM node removal until an exit animation completes. This could be a simple API:

```js
h(Animate, { show: isVisible, enter: 'fade-in', exit: 'fade-out', duration: 300 },
  h('div', null, 'Content')
)
```

### 4. Fix the `memo` and Signal Interaction

Either document that `memo` should not be used with components that read global signals, or change `memo` to only prevent the parent from calling the component function while still allowing the component's own effects to re-run.

### 5. Fix `createStore` Action Proxy to Include Actions

Add `actions[prop]` to the proxy's `get` trap so that `this.otherAction()` works inside actions.

### 6. Add `useClickOutside` Hook

This is needed for every dropdown, popover, and modal. It should be in the core utilities.

### 7. Make `useSWR` Return Types Consistent

Either all return values should be wrapped functions, or all should be raw signals. The current mix (`isLoading` is a raw computed, everything else is a wrapper function) is confusing.

### 8. Add Route-Level Data Loading

Support `loader` functions in route definitions that run before the component mounts:

```js
defineRoutes({
  '/users/:id': {
    component: UserProfile,
    loader: ({ params }) => fetch(`/api/users/${params.id}`).then(r => r.json()),
  },
});
```

### 9. Document the Effect Timing Model

Explain when effects fire (microtask after signal write), how `batch` affects timing, what `flushSync` does and when to use it, and how `useEffect` timing differs from React's `useEffect` (which fires after paint).

### 10. Add Remaining Silent Error Logging

Change the empty `catch` blocks in `reactive.js` (cleanup errors) and `helpers.js` (localStorage errors) to at least `console.warn` in development mode. Consider a `__DEV__` flag or environment check to avoid production overhead.

---

## Closing Thoughts

Phase 1 fixed the correctness issues I found. The framework no longer has glitch values from diamond dependencies, error boundaries work for async errors, memory leaks in utility hooks are cleaned up, and the router's active link logic is correct for the `/` case.

But spending more time with the codebase revealed deeper issues that Phase 1 did not address: `useContext` has the same stack-vs-tree bug that error boundaries had, `Portal` is completely non-functional, `memo` conflicts with signal-based reactivity, and the `For`/`Show` components do not provide the fine-grained reactivity their SolidJS-inspired APIs imply.

The framework's strength remains its impressive feature density in a small package. Having forms, data fetching, animations, gestures, accessibility, and islands built into ~2000 lines of readable code is genuinely remarkable. The Phase 1 fixes show that the maintainers take correctness seriously.

My updated rating: **7.5/10 for personal projects (up from 7), 5/10 for production team projects (up from 4).** The correctness fixes moved the needle. The remaining issues are addressable, and none of them are architectural dead ends. If Phase 2 fixes the context system, portals, and adds exit animation support, this becomes a genuinely compelling alternative for small-to-medium production apps.

---

*Review written after re-reading all source files in packages/core/src/, packages/router/src/, and my previous review. Analysis is based on source code reading and mental execution of five advanced application architectures.*
