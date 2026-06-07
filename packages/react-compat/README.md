# what-react

React compatibility layer for [What Framework](https://whatfw.com). Use React ecosystem libraries with What's signal-based engine under the hood -- zero code changes required.

**90+ React libraries confirmed working**, including zustand, @tanstack/react-query, react-hook-form, framer-motion, @radix-ui, react-select, react-router, and many more.

## Install

```bash
npm install what-react what-core
```

## Setup

Add the Vite plugin -- one line is all you need:

```js
// vite.config.js
import { defineConfig } from 'vite';
import { reactCompat } from 'what-react/vite';

export default defineConfig({
  plugins: [reactCompat()],
});
```

The plugin handles everything automatically:
- Aliases `react` and `react-dom` imports to `what-react`
- Configures JSX to use the What runtime
- Auto-detects installed React packages and excludes them from pre-bundling
- Resolves `use-sync-external-store` shims

## Usage

Install any React library and use it normally. No code changes needed.

```jsx
// zustand -- just works
import { create } from 'zustand';

const useStore = create((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
}));

function Counter() {
  const count = useStore((s) => s.count);
  const increment = useStore((s) => s.increment);
  return <button onClick={increment}>Count: {count}</button>;
}
```

```jsx
// @tanstack/react-query -- just works
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Todos />
    </QueryClientProvider>
  );
}

function Todos() {
  const { data } = useQuery({
    queryKey: ['todos'],
    queryFn: () => fetch('/api/todos').then(r => r.json()),
  });
  return <ul>{data?.map(t => <li key={t.id}>{t.title}</li>)}</ul>;
}
```

## How It Works

`what-react` implements React's public API using What's signals and reconciler:

- `useState`, `useEffect`, `useMemo`, etc. map to What's hook system
- `createElement` maps to What's `h()` hyperscript
- Class components (`Component`, `PureComponent`) are wrapped as function components
- `createRoot` / `render` map to What's `mount()`
- `createPortal` creates portal vnodes handled by What's reconciler
- `forwardRef`, `cloneElement`, `Children`, `createContext` all implemented

The key insight: React libraries import `react` and call its hooks. By aliasing `react` to `what-react`, those hooks execute on What's signal engine instead. The library never knows the difference.

## What's Implemented

### React (index.js)

`useState`, `useEffect`, `useLayoutEffect`, `useInsertionEffect`, `useMemo`, `useCallback`, `useRef`, `useContext`, `useReducer`, `useImperativeHandle`, `useId`, `useDebugValue`, `useSyncExternalStore`, `useTransition`, `useDeferredValue`, `createElement`, `createContext`, `createRef`, `createFactory`, `forwardRef`, `cloneElement`, `isValidElement`, `Component`, `PureComponent`, `Fragment`, `Suspense`, `StrictMode`, `memo`, `lazy`, `Children`, `startTransition`

### ReactDOM (dom.js)

`createRoot`, `hydrateRoot`, `render`, `unmountComponentAtNode`, `createPortal`, `flushSync`, `findDOMNode`, `unstable_batchedUpdates`

### Vite Plugin (vite-plugin.js)

`reactCompat(options?)` -- configures all aliases and optimizeDeps automatically

## Plugin Options

```js
reactCompat({
  exclude: ['my-custom-react-lib'],  // Additional packages to exclude from pre-bundling
  autoDetect: true,                   // Auto-detect installed React packages (default: true)
})
```

## Sub-path Exports

| Path | Contents |
|---|---|
| `what-react` | React API (hooks, createElement, Component, etc.) |
| `what-react/dom` | ReactDOM API (createRoot, createPortal, etc.) |
| `what-react/jsx-runtime` | JSX automatic runtime |
| `what-react/jsx-dev-runtime` | JSX dev runtime |
| `what-react/vite` | Vite plugin |

## Links

- [React Compat Showcase](https://react.whatfw.com)
- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)
- [Benchmarks](https://benchmarks.whatfw.com)

## License

MIT
