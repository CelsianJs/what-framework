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

const count = signal(0);

// Read
count();          // 0

// Write
count.set(5);
count.set(c => c + 1);

// Derived value
const doubled = computed(() => count() * 2);

// Side effects
effect(() => {
  console.log('Count:', count());
});

// Batch updates (effects run once at the end)
batch(() => {
  a.set(1);
  b.set(2);
});

// Read without subscribing
untrack(() => someSignal());
count.peek();
```

## Hooks

React-compatible hooks backed by signals internally.

```js
import {
  useState, useEffect, useMemo, useCallback,
  useRef, useReducer, useContext, createContext,
  onMount, onCleanup,
} from 'what-core';

const [count, setCount] = useState(0);

useEffect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
}, []);
```

## Components

```js
import { h, mount, Fragment, memo, lazy, Suspense, ErrorBoundary, Show, For } from 'what-core';

function Counter() {
  const count = signal(0);
  return h('button', { onclick: () => count.set(c => c + 1) }, () => count());
}

mount(h(Counter), '#app');
```

## Additional Modules

| Export path | Contents |
|---|---|
| `what-core` | Signals, hooks, components, store, forms, data fetching, animation, a11y, skeleton loaders |
| `what-core/render` | Fine-grained rendering primitives (`template`, `insert`, `spread`, `delegateEvents`) |
| `what-core/jsx-runtime` | JSX automatic runtime |
| `what-core/testing` | Test utilities |

## API Overview

**Reactivity** -- `signal`, `computed`, `effect`, `batch`, `untrack`, `flushSync`, `createRoot`

**Rendering** -- `h`, `Fragment`, `html`, `mount`, `template`, `insert`, `spread`, `delegateEvents`

**Hooks** -- `useState`, `useSignal`, `useComputed`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `useContext`, `useReducer`, `createContext`, `onMount`, `onCleanup`, `createResource`

**Components** -- `memo`, `lazy`, `Suspense`, `ErrorBoundary`, `Show`, `For`, `Switch`, `Match`, `Island`, `Portal`

**Store** -- `createStore`, `derived`, `atom`

**Data Fetching** -- `useSWR`, `useQuery`, `useInfiniteQuery`, `invalidateQueries`, `prefetchQuery`

**Forms** -- `useForm`, `useField`, `rules`, `zodResolver`, `Input`, `Select`, `Checkbox`, `ErrorMessage`

**Animation** -- `spring`, `tween`, `easings`, `useGesture`, `useTransition`

**Accessibility** -- `useFocusTrap`, `FocusTrap`, `announce`, `SkipLink`, `useRovingTabIndex`, `VisuallyHidden`, `useId`

**Scheduler** -- `scheduleRead`, `scheduleWrite`, `measure`, `mutate`, `onResize`, `onIntersect`

**Head** -- `Head`, `clearHead`

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)
- [Benchmarks](https://benchmarks.whatfw.com)

## License

MIT
