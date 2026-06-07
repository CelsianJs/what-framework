# what-framework

The closest framework to vanilla JS. Signals-based reactivity, compiler-first JSX, islands architecture -- no virtual DOM diffing overhead.

This is the main package for What Framework. It re-exports everything from [`what-core`](https://www.npmjs.com/package/what-core) plus routing, server rendering, and the compiler.

## Install

```bash
npm install what-framework
```

Or scaffold a new project:

```bash
npm create what@latest my-app
cd my-app
npm install
npm run dev
```

## Quick Start

```jsx
import { mount, useSignal } from 'what-framework';

function Counter() {
  const count = useSignal(0);

  return (
    <div>
      <p>Count: {count()}</p>
      <button onClick={() => count.set(c => c + 1)}>+</button>
    </div>
  );
}

mount(<Counter />, '#app');
```

## Signals

Fine-grained reactivity without a virtual DOM. Updates flow directly to the DOM nodes that depend on a signal.

```js
import { signal, computed, effect } from 'what-framework';

const name = signal('World');
const greeting = computed(() => `Hello, ${name()}!`);

effect(() => console.log(greeting()));

name.set('What');
// logs: "Hello, What!"
```

## Hooks

React-familiar hooks, powered by signals under the hood.

```js
import { useState, useEffect, useMemo, useRef, useReducer, createContext, useContext } from 'what-framework';

const [count, setCount] = useState(0);

useEffect(() => {
  document.title = `Count: ${count}`;
}, [count]);
```

## Components

```jsx
import { memo, lazy, Suspense, ErrorBoundary, Show, For } from 'what-framework';

// Conditional rendering
<Show when={() => loggedIn()}>
  <Dashboard />
</Show>

// List rendering
<For each={() => items()}>
  {(item) => <li>{item.name}</li>}
</For>

// Code splitting
const Settings = lazy(() => import('./Settings'));

<Suspense fallback={<Spinner />}>
  <Settings />
</Suspense>
```

## Data Fetching

SWR and TanStack Query-style data hooks built in.

```js
import { useSWR, useQuery } from 'what-framework';

const { data, error, isLoading } = useSWR('user', () =>
  fetch('/api/user').then(r => r.json())
);

const { data, refetch } = useQuery({
  queryKey: ['todos'],
  queryFn: () => fetch('/api/todos').then(r => r.json()),
  staleTime: 5000,
});
```

## Forms

Built-in form handling with validation.

```jsx
import { useForm, rules, simpleResolver } from 'what-framework';

const { register, handleSubmit, formState } = useForm({
  resolver: simpleResolver({
    email: [rules.required(), rules.email()],
    password: [rules.required(), rules.minLength(8)],
  }),
});
```

## Animation

Physics-based springs and gesture support.

```js
import { spring, tween, useGesture } from 'what-framework';

const x = spring(0, { stiffness: 100, damping: 10 });
x.set(200); // animate to 200
```

## Sub-path Exports

| Path | Contents |
|---|---|
| `what-framework` | Full API (signals, hooks, components, forms, animation, a11y, etc.) |
| `what-framework/router` | Client-side routing |
| `what-framework/server` | SSR and static generation |
| `what-framework/render` | Fine-grained rendering primitives |
| `what-framework/testing` | Test utilities |
| `what-framework/jsx-runtime` | JSX automatic runtime |

## Vite Setup

```js
// vite.config.js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

export default defineConfig({
  plugins: [what()],
});
```

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)
- [Benchmarks](https://benchmarks.whatfw.com)
- [React Compat](https://react.whatfw.com) -- use 90+ React libraries with What

## License

MIT
