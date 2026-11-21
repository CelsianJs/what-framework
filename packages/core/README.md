# what-core

The reactive engine behind [What Framework](https://whatfw.com). Provides signals, fine-grained reactivity, components, hooks, and DOM rendering -- all without a virtual DOM diffing step.

Most users should install [`what-framework`](https://www.npmjs.com/package/what-framework) instead. `what-core` is the internal engine consumed by other What packages.

## Install

```bash
npm install what-core
```

## Reactive Primitives

```js
import { signal, computed, effect, batch, untrack } from 'what-core';

const count = signal(0, 'count');

// Read
count();          // 0

// Write: count(5) and count((c) => c + 1) do the same
count.set(5);
count.set((c) => c + 1);

// Derived value: recomputed when read after count changes
const doubled = computed(() => count() * 2);

// Side effect: runs now, then again after count or doubled changes. A write
// outside batch() runs the effects it affects on the next microtask.
effect(() => {
  console.log('Count:', count(), 'doubled:', doubled());
});

// Batch writes: the effects run once, synchronously, when the outermost batch
// ends; batch() returns what the function returns
const first = signal('Ada', 'first');
const last = signal('Lovelace', 'last');
const full = batch(() => {
  first.set('Grace');
  last.set('Hopper');
  return `${first()} ${last()}`;
});

// Read without subscribing
untrack(() => count());
count.peek();
```

## Hooks

The hooks keep React's names and call shapes, but a component runs once, so
they hand you signals: `useState` and `useReducer` return `[accessor, setter]`,
`useMemo` returns an accessor (its dependency array is ignored), and
`useEffect` re-runs when a signal it reads changes, or with a dependency array
only for the accessors listed (`[count]`, never `[count()]`); `[]` runs it once
after mount. Call hooks in a component body.

```jsx
import { useState, useEffect, useMemo } from 'what-core';

function Clock() {
  const [seconds, setSeconds] = useState(0);
  const minutes = useMemo(() => Math.floor(seconds() / 60));

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return <p>{minutes()}:{seconds() % 60}</p>;
}
```

## Components

```jsx
import { mount, signal } from 'what-core';

function Counter() {
  const count = signal(0);
  return (
    <button onClick={() => count.set(c => c + 1)}>{count()}</button>
  );
}

mount(<Counter />, '#app');
```

## Additional Modules

| Export path | Contents |
|---|---|
| `what-core` | Signals, hooks, components and boundaries, context, store, `Head`, `mount`/`hydrate`, diagnostics |
| `what-core/render` | Fine-grained rendering primitives (`template`, `insert`, `spread`, `delegateEvents`, `on`) |
| `what-core/form` | Forms: `useForm`, `useField`, `rules`, resolvers, bound inputs |
| `what-core/data` | Data fetching: `useSWR`, `useQuery`, `useFetch`, the query cache |
| `what-core/a11y` | Focus management, ARIA helpers, announcements |
| `what-core/ui` | Skeleton loaders and spinners |
| `what-core/motion` | Springs, tweens, `useTween`, gestures, CSS transitions |
| `what-core/dom` | The DOM read/write scheduler and DOM utilities |
| `what-core/internal` | What sibling packages (what-server, what-devtools) share with core; not for apps |
| `what-core/jsx-runtime` | JSX automatic runtime |
| `what-core/testing` | Test utilities |

`what-framework` re-exports each of these (except `internal`) under the same subpath.

## API Overview

**Reactivity** -- `signal`, `computed`, `effect`, `batch`, `untrack`, `flushSync`, `createRoot`, `getOwner`, `runWithOwner`, `createSelector`

**Async values** -- an async `computed`, `refresh`, `isPending`, `startTransition`, `useTransition`, `useOptimistic`, `use`, `settled` ([ASYNC.md](https://github.com/CelsianJs/what-framework/blob/main/docs/ASYNC.md))

**Rendering** -- `h`, `Fragment`, `html`, `mount`, `hydrate`, `applyStreamedBoundaries`

**Hooks** -- `useState`, `useSignal`, `useComputed`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `useContext`, `useReducer`, `useId`, `createContext`, `onMount`, `onCleanup`, `createResource`, `useLoaderData`

**Components** -- `memo`, `lazy`, `Suspense`, `ErrorBoundary`, `Show`, `For`, `Switch`, `Match`, `Island`, `Portal`

**Store** -- `createStore`, `derived`

**Head** -- `Head`, `getResponse`

**Diagnostics** -- `getDiagnostics`, `subscribeDiagnostics`, `clearDiagnostics`, `getErrorDefinition`, `WhatError`

**Data Fetching** (`what-core/data`) -- `useSWR`, `useQuery`, `useInfiniteQuery`, `invalidateQueries`, `prefetchQuery`

**Forms** (`what-core/form`) -- `useForm`, `useField`, `rules`, `zodResolver`, `Input`, `Select`, `Checkbox`, `ErrorMessage`

**Animation** (`what-core/motion`) -- `spring`, `tween`, `easings`, `useGesture`, `useTween`

**Accessibility** (`what-core/a11y`) -- `useFocusTrap`, `FocusTrap`, `announce`, `SkipLink`, `useRovingTabIndex`, `VisuallyHidden`, `useIds`

**Scheduler** (`what-core/dom`) -- `scheduleRead`, `scheduleWrite`, `measure`, `mutate`, `onResize`, `onIntersect`, `clearHead`

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)
- [Benchmarks](https://benchmarks.whatfw.com)

## License

MIT
