# Native What and React in one app

Write your app in native What and use React packages inside it, with plain
JSX on both sides:

```jsx
// src/Dashboard.jsx: a native What file
import { signal } from 'what-framework';
import { BarChart, Bar, XAxis } from 'recharts';

const sales = signal([{ day: 'Mon', total: 3 }]);

export function Dashboard() {
  return (
    <main>
      <h1>{sales().length} days</h1>
      <BarChart width={300} height={150} data={sales()}>
        <XAxis dataKey="day" />
        <Bar dataKey="total" />
      </BarChart>
    </main>
  );
}
```

`<h1>` is native What: the component runs once and only that text updates.
`<BarChart>` is a React component: it renders with React's rules, and when
`sales` changes it gets the new `data` and re-renders without being rebuilt.

## Setup

```js
// vite.config.js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';
import { reactCompat } from 'what-react/vite';

export default defineConfig({
  plugins: [what(), reactCompat()],
});
```

With both plugins, what-react compiles in mixed mode. With `reactCompat()`
alone, every JSX file is React code (REACT-COMPAT.md).

In TypeScript, add `what-react/mixed` to `compilerOptions.types` (or
`/// <reference types="what-react/mixed" />` in `src/vite-env.d.ts`). React
components then type-check as tags in native files, with their props checked.
A native-only app leaves it out and keeps What's stricter component types.

`npm create what` with "Add React library support" scaffolds this setup.

## Which files are React files

A `.jsx`/`.tsx` file of your app is a **React file** when it:

- imports `react` or `react-dom` (type-only imports do not count),
- calls a hook it imports from React code (`useForm()` from
  `react-hook-form`, `useStore()` from a zustand store file),
- starts with `/** @jsxImportSource react */`, or
- matches the `react` option: `reactCompat({ react: ['src/legacy/'] })`
  (path prefixes from the project root, RegExps or functions).

Every other file is a **native file**. `/** @jsxImportSource what-framework */`
makes a file native whatever it imports.

## In a native file

A JSX tag whose component comes from React (an npm package that depends on
`react`, or a React file of your app, also through `export ... from` barrels)
starts a **React island**. Everything inside that tag follows React's rules:

- Props are values. They are built again whenever a signal they read
  changes, and the React tree below is reconciled, so React state survives.
- Host elements inside the tag (`<span>`, `<button>`) are React elements, so
  libraries that inspect or clone their children (`asChild`, Recharts' axes)
  see what they expect.
- A native component written inside the tag still runs once and keeps its
  state; each React render hands it the new prop values.

Outside React tags, the file is native What, compiled by what-compiler as
always. A native file that uses no React component compiles exactly as it
would without what-react.

## In a React file

Its components are React components: hooks return values and components
re-render. A native component it renders (imported from a native file or a
native package) runs once and keeps its state. It reads its props live, so
each React render shows the new values, and a callback prop always calls the
latest one. React elements it is handed (`children`, a `header` prop) are
rendered by React where it places them, keeping their state and context.

A What signal read while a React component renders re-renders that component
when it changes, so React files can read native state directly.

## Context

React context crosses native layers: a React component inside a native
component inside a React provider finds the provider. What context crosses
React layers: a native component inside a React island finds the What
providers around the island.

## Server rendering

React islands render on the server with React's server rules: each
component renders once, hooks give their initial values, effects do not run,
`useSyncExternalStore` reads its server snapshot, and a `<Suspense>` whose
children suspend writes its fallback. Native components inside an island
render on the server too, and React context reaches React components inside
them. what-server writes each island between `<!--[]-->` markers (its
hydratable renderers, the stream and `renderToStringAsync`).

Hydration adopts the server's native nodes as always and hands each island
its markers. Once the walk is done, the island replaces the server's HTML
between them with its client render, in one step before the page paints
again, so the page does not flash or shift. Effects run then, once, in the
browser. A component that throws on the server leaves its island empty there
(with a development warning); the browser renders it.

A library can still need the browser to draw: Recharts 3 measures its chart
in an effect, so the server writes its sized wrapper and the browser draws
the SVG into it, as React's own server renderer does.

For a Vite server build, `reactCompat()` bundles the React packages the app
depends on (Vite's `ssr.noExternal`), found from its package.json, with the
React packages they depend on, so their `import 'react'` reaches what-react.

## Limits

- React hooks run only in React files. Calling one in a native component
  throws `ERR_HOOK_OUTSIDE_RENDER`.
- A native component inside a React tree is rebuilt (losing its state, with
  a development warning) when its React parent passes a prop it did not have
  on the first render. Pass every prop from the first render, undefined if
  need be.
- Imports are followed through static `export { X } from`, `export * from`
  and `import X` + `export { X }`. A component reached any other way
  (`export const Chart = lib.Chart`) is native unless its file is a React
  file; use the `react` option or the pragma.
- In development, a change to what makes a file a React file (adding a
  `react` import, a re-export) reloads the page.
- Inside a React tag the cost is React's; outside, What's.
- Each island and each native component inside React adds two comment
  markers to the DOM.
- Hydration replaces an island's server HTML instead of adopting it node by
  node: text typed into a React field before the page hydrates is lost.
- A React package that ships CommonJS only stays external in a Vite server
  build; an island that uses it renders in the browser.

## How it works

`reactCompat()`'s mixed plugin runs before what-compiler. In a native file it
replaces each React tag, with its subtree, by
`<ReactIsland view={() => createElement(...)} />`, a native component from
`what-react/mixed` that mounts a what-react root and renders `view` under a
signal tracker. In a React file it lowers all JSX to what-react's
`createElement` and wraps native tags with `nativeRef()`, which mounts the
native component once with a props object of getters. what-compiler skips
React files and compiles native files as usual. Tests:
`test/mixed-plugin.test.js` (which files and tags are React),
`test/mixed.test.js` (state, props, context and cleanup across the boundary),
`test/mixed-ssr.test.js` (server render, the stream, hydration, keyed rows)
and `test/mixed-browser.mjs` (a Vite build, the dev server, and a server
render the browser hydrates, in Chromium, with Recharts, react-hook-form and
React context).
