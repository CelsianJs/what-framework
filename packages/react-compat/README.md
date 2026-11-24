# what-react

React compatibility layer for [What Framework](https://whatfw.com). Run React ecosystem libraries on What — `what-react` ships a dedicated React-semantics runtime (value-returning hooks, re-renders with keyed reconciliation, working context) that coexists with What's run-once signal engine.

**Tested packages (2026-11-24):** 47 React packages across 38 browser fixtures pass on what-react alone and inside a native What app, among them Radix, MUI, Ant Design, react-aria-components, Headless UI, react-router, Redux Toolkit, zustand, jotai, TanStack Query, Table and Virtual, SWR, react-hook-form, formik, Floating UI, cmdk, sonner, vaul, dnd-kit, react-select, react-day-picker, framer-motion, recharts and styled-components. Anything else is untested. See [REACT-COMPAT.md](https://github.com/CelsianJs/what-framework/blob/main/REACT-COMPAT.md) for the table, the method, what it does not cover and the known limitations.

## Install

```bash
npm install what-react what-core
```

## Setup

### A native What app that uses React packages (recommended)

```js
// vite.config.js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';
import { reactCompat } from 'what-react/vite';

export default defineConfig({
  plugins: [what(), reactCompat()],
});
```

Your files stay native What. A React component used as a tag in a native file
(`<BarChart data={rows()} />` from recharts) renders as a React island; a file
that imports `react` or calls a React package's hook is a React file. See
[MIXED.md](./MIXED.md).

### Every file React (migrating a React app as it is)

```js
// vite.config.js
import { defineConfig } from 'vite';
import { reactCompat } from 'what-react/vite';

export default defineConfig({
  plugins: [reactCompat()],
});
```

Add `what()` later and files that do not import React become native What.

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

`what-react` ships its own React-semantics runtime (`src/runtime.js`) — what-core is not modified:

- Hooks return **values** (`useState` → `[value, setState]`, `useMemo` → the value) with React's deps/cleanup semantics
- Components **re-render** on state change; output is reconciled with a keyed, type-matched diff, so DOM elements and child component state are preserved
- `createContext` / `useContext` propagate real values through the component tree (nested providers, memo-bailout propagation)
- Element refs attach after DOM insertion; `useLayoutEffect` is synchronous at commit; `useEffect` is async; children's effects run before the parent's
- Class components (`Component`, `PureComponent`) are wrapped as function components (state, lifecycle, error boundaries, `contextType`)
- `createPortal`, `lazy` + minimal `Suspense`, `React.memo` with real skip semantics
- Compat semantics apply ONLY to elements created via what-react's `createElement`/JSX runtime — native What components keep their run-once signal semantics, in both directions (What-inside-React and React-inside-What)

React libraries import `react` and call its hooks. By aliasing `react` to `what-react`, those hooks execute on this runtime. SSR of compat components is not supported (browser/jsdom only) — see REACT-COMPAT.md for the full limitations list.

## What's Implemented

### React (index.js)

`useState`, `useEffect`, `useLayoutEffect`, `useInsertionEffect`, `useMemo`, `useCallback`, `useRef`, `useContext`, `useReducer`, `useImperativeHandle`, `useId`, `useDebugValue`, `useSyncExternalStore`, `useTransition`, `useDeferredValue`, `use`, `createElement`, `createContext`, `createRef`, `createFactory`, `forwardRef`, `cloneElement`, `isValidElement`, `Component`, `PureComponent`, `Fragment`, `Suspense`, `StrictMode`, `memo`, `lazy`, `act`, `Children`, `startTransition`

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
| `what-react/mixed` | Native and React components in one tree (what the mixed plugin compiles to; types for mixed apps) |
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
