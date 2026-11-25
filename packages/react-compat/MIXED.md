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

`npm create what` with "Add React library support" scaffolds this setup.

### TypeScript

- Add `what-react/mixed` to `compilerOptions.types` (or
  `/// <reference types="what-react/mixed" />` in `src/vite-env.d.ts`). React
  components then type-check as tags in native files, with their props
  checked. A native-only app leaves it out and keeps What's stricter
  component types.
- Install `@types/react` and `@types/react-dom`: they are what
  `import { useState, type ChangeEvent } from 'react'` means to `tsc`.
  what-react's own declarations cover its runtime exports, not React's type
  vocabulary (`ChangeEvent`, `CSSProperties`, …).
- Start each React file written in TypeScript with
  `/** @jsxImportSource react */`. `tsconfig.json` has one `jsxImportSource`
  for the project, What's, which is right for native files; the pragma is how
  TypeScript is told, per file, that this file's JSX is React's. Without it
  an ordinary React component gets errors on its refs, `style` objects,
  event handlers and `children` (they are checked against What's types). The
  pragma also makes the file a React file for the plugin, whatever it
  imports. The dev server names a `.tsx` React file that lacks it.

```tsx
/** @jsxImportSource react */
import { useState, type ChangeEvent } from 'react';

export function Field() {
  const [text, setText] = useState('');
  return <input value={text} onChange={(e: ChangeEvent<HTMLInputElement>) => setText(e.target.value)} />;
}
```

The scaffold installs both type packages and its React file carries the
pragma. A native `.tsx` file needs nothing: it uses the React component as a
tag.

## Which files are React files

A `.jsx`/`.tsx` file of your app is a **React file** when it:

- imports `react` or `react-dom` (type-only imports do not count),
- calls a hook it imports from React code (`useForm()` from
  `react-hook-form`, `useStore()` from a zustand store file), also as a
  member of a namespace or default import (`rhf.useForm()` with
  `import * as rhf from 'react-hook-form'`),
- starts with `/** @jsxImportSource react */`, or
- matches the `react` option: `reactCompat({ react: ['src/legacy/'] })`
  (path prefixes from the project root, RegExps or functions).

Every other file is a **native file**. `/** @jsxImportSource what-framework */`
makes a file native whatever it imports.

## In a native file

A JSX tag whose component comes from React (an npm package that depends on
`react`, or a React file of your app, also through `export ... from` barrels)
starts a **React island**. A member tag counts by its object: `<motion.div>`
and `<Dialog.Root>` are React tags when `motion` and `Dialog` come from React.
Everything inside that tag follows React's rules:

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

One React element is handed over as one placeholder to place. Several
(`children` with more than one child, any array that holds an element) are
an array with a placeholder per child, so the native component can count
them, take one by index and place each where it wants:

```jsx
// Native: the first child in the header, the rest in the body.
export function Split(props) {
  return (
    <section>
      <header>{props.children[0]}</header>
      <main>{props.children.slice(1)}</main>
    </section>
  );
}
```

The array is what a native component gets from native JSX: nested arrays
are flat and empty children (`null`, `false`) are left out, so
`{open && <Body />}` adds an entry when `open` turns true. Text children are
placeholders too. Each placeholder carries a key (the child's key, or its
position in React's list): when the list changes, what-core keeps the ones
that stayed, and React state inside them survives. While the list keeps its
shape the native component is not told anything: React patches each child
in place.

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
again. Effects run then, once, in the browser. What that looks like, measured
on the 38 package fixtures (`matrix-browser.mjs --serve=ssr --probe`,
Chromium; 30 of them render on the server):

- No frame shows less than React's own hydration of the same fixture shows
  (the fewest elements any animation frame saw are the same in both), and
  the layout shift Chromium reports is 0 to 0.004 (React's hydration: 0 to
  0.59, the largest for Ant Design).
- Every element of an island is built again: none of the server's island
  elements is in the page afterwards (React keeps all of them, or all but a
  few the library itself replaces). The native elements around the islands
  are kept. The island renders once in the browser, not twice.
- Focus and typed text are lost: a field of an island that the user focused
  and typed into before the page hydrated is a new element afterwards,
  unfocused, with its initial value (11 fixtures have such a field; all 11).
  React keeps the focus in all 11, and the text in 5: where the field is
  controlled, React puts the state's value back too.

A component that throws on the server leaves its island empty there and the
browser renders it; the server prints a warning that names the error, in
production too. A hook that finds no component rendering fails the page's
render instead: on a server that means two copies of what-react are loaded
(below), and every island would be empty.

The client build that hydrates has to be compiled for it (what-compiler's
`hydratable`). The plugin decides from the Vite config (`appType: 'custom'`,
an SSR build, `--ssrManifest`); a plain `vite build` whose pages a server
renders needs `what({ hydratable: true })`, or hydration reports
`ERR_HYDRATION_MISMATCH` and renders the page again.

A library can still need the browser to draw: Recharts 3 measures its chart
in an effect, so the server writes its sized wrapper and the browser draws
the SVG into it, as React's own server renderer does. Eight of the 38
fixtures do not render on the server with real React either (a store that
reads `localStorage` or `window` as it loads, a browser router, a portal
target read while rendering); an island like that is left to the browser.

### What a server render bundles

A package that Node loads itself (an external) gets Node's `react`, which is
React, not what-react. So `reactCompat()` tells Vite to bundle, in a server
render (`ssr.noExternal`):

- `what-react`, always. Left external, Node loads a second copy beside the
  one the `react` alias bundles, hooks and the island renderer never see
  each other's components, and every island renders empty. A server build
  that would hold two copies is refused with an error that says so.
- the React packages the app depends on (found from its package.json) and
  the React packages those depend on.
- in a production server build (`vite build --ssr`), also the React packages
  that ship CommonJS only, and everything a React package depends on. A
  bundled package's imports are otherwise left in the bundle for Node to
  resolve, and Node refuses what bundlers accept (a directory import:
  react-transition-group's `dom-helpers/addClass`).
- in the dev server, a CommonJS file that a bundled package imports by path
  (`@mui/material` imports `react-transition-group/cjs/TransitionGroupContext.js`)
  is converted to an ES module as it loads. A React package that is CommonJS
  only stays external there, so in development an island that uses one
  renders in the browser (with the warning above); the production build
  renders it on the server.

`reactCompat({ autoDetect: false })` adds only `what-react`; the list is then
yours (`ssr.noExternal`). `ssr.external` in your config wins over it.

## Limits

- React hooks run only in React files. Calling one in a native component
  throws `ERR_HOOK_OUTSIDE_RENDER`.
- A native component inside a React tree is rebuilt (losing its state, with
  a development warning) when its React parent passes a prop it did not have
  on the first render. Pass every prop from the first render, undefined if
  need be.
- A native component that reads one child by index in an expression that
  runs again (`{props.children[0]}`) builds that child again when the list
  of children changes (a child came, went or moved), and React state inside
  it is lost. Rendering the list (`{props.children}`, or a slice of it)
  keeps every child that stayed; so does a child placed once, outside JSX
  expressions (`const first = props.children[0]`).
- On the server a native component gets a single child as the child itself
  also when React's `children` was an array with one entry left; in the
  browser that is an array of one. Write `[].concat(props.children)` where
  the count matters.
- A React tag is rendered as SVG only when an `<svg>` element is its JSX
  ancestor in the same file. A React component that renders bare SVG
  children (`<g>`, `<path>`) and is placed inside an `<svg>` written in
  another file, or inside a native component that renders the `<svg>`,
  gets HTML elements that do not draw. Write the `<svg>` in the file that
  uses the React tag, or let the React component render its own `<svg>`.
- Imports are followed through static `export { X } from`, `export * from`
  and `import X` + `export { X }`. A component reached any other way
  (`export const Chart = lib.Chart`) is native unless its file is a React
  file; use the `react` option or the pragma.
- A component is React code where it is written, not where it is used. Three
  things therefore belong in a React file, imported into the native one:
  a component made by calling a library (`const Tag = styled('span')(...)`,
  `styled.button`), a component handed to a React package as a prop
  (`rowComponent={Row}`, `components={{ a: Link }}`), and JSX handed to a
  React package from outside a React tag (`toast.custom(() => <b>…</b>)` in a
  native click handler). JSX written inside a React tag's own props is
  React's already: a render prop (`itemContent={(i) => <div>…</div>}`,
  `renderInput={(params) => <TextField {...params} />}`) needs nothing.
- In development every saved edit reloads the page, and state is lost:
  an edit to a React file, to a native file, and a change to what makes a
  file a React file (adding a `react` import, a re-export). There is no hot
  replacement yet. what-compiler gives each component file a hot-update
  boundary that hands the new module to a replacement runtime
  (`window.__WHAT_HMR_ACCEPT__`) and reloads the page when none is installed,
  and none is. Keeping a React file's state across an edit would take what
  React Fast Refresh does: the plugin registering each component of a React
  file under a stable id, what-react rendering a component through that
  registry (so a mounted instance picks up the new function and re-renders,
  or remounts when its hooks changed), and the React file accepting its own
  update.
- Inside a React tag the cost is React's; outside, What's.
- An island stands between the two comment markers what-core gives a
  component that returns several nodes; a native component inside React
  adds two comment markers of its own. React components add none, and
  `null`, `false` and a portal leave no node, except at an island's top
  (outside every element it renders), where each is one comment so the
  island keeps a node (REACT-COMPAT.md, Known limitations).
- Hydration replaces an island's server HTML instead of adopting it node by
  node: focus and text typed into a React field before the page hydrates are
  lost, and a node a script took from the server's HTML is no longer in the
  page (see Server rendering for what was measured).
- In the dev server, a React package that ships CommonJS only stays external
  in a server render; an island that uses it renders in the browser. A
  production server build bundles it.
- The dev server needs no list of React packages: every dependency is
  pre-bundled by Vite as in any app, and `react` inside the bundles is the
  page's one what-react. `reactCompat({ exclude: ['pkg'] })` keeps a package
  out of pre-bundling; its CommonJS dependencies then have to be in
  `optimizeDeps.include`, as Vite's documentation says for any excluded
  package.

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
`test/mixed-ssr.test.js` (server render, the stream, hydration, keyed rows),
`test/island-hydration.test.js` (islands that native code swaps or removes
after hydration), `test/vite-plugin.test.js` (the dev server, a dev-server
render and a production server build of an installed app: one what-react in
each), `test/mixed-browser.mjs` (a Vite build, the dev server, and a server
render the browser hydrates, in Chromium, with Recharts, react-hook-form and
React context) and `test/matrix-browser.mjs` (39 package fixtures driven in
Chromium as React files inside a native app, 19 of them also written as
native files: Radix, MUI, Ant Design, Headless UI, Recharts, react-select,
framer-motion and others; as a production build, in the dev server, and
rendered by a production server build and hydrated; the table is in
REACT-COMPAT.md).
