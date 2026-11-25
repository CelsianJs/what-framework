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
`useSyncExternalStore` reads its server snapshot (without one it throws
React's error, and the island renders in the browser), and a `<Suspense>`
whose children suspend writes its fallback. Host elements' props are
written as React's server renderer writes them where the browser can tell
the difference (an object on a custom element writes nothing,
`draggable={false}` writes `draggable="false"`, `title={true}` nothing,
`xlinkHref` `xlink:href`, `strokeWidth: 2` is unitless; REACT-COMPAT.md,
Known limitations, lists what differs only in the HTML text). Native components inside an island
render on the server too, and React context reaches React components inside
them. what-server writes each island between `<!--[]-->` markers (its
hydratable renderers, the stream and `renderToStringAsync`).

Hydration adopts the server's native nodes as always and hands each island
its markers. Once the walk is done, the island renders as it would in the
browser, but every element and text node it mounts is the server's node at
that place (src/hydrate.js): nothing is created, moved or removed where the
browser renders what the server did. Event handlers and refs attach to the
server's nodes, layout effects see them, and effects run once, in the
browser. Whatever the page held in those nodes stays: focus, a selection,
text typed before the page hydrated, a scroll position, a playing video, an
image that has loaded, a CSS transition. What-react's Vite plugin installs
this in a build what-compiler compiles for hydration (below); without it, an
island renders in the browser and replaces the server's HTML.

What that looks like, measured on the 40 package fixtures
(`matrix-browser.mjs --serve=ssr`, Chromium; 32 of them render on the
server with real React, each as a React file and, for 19, as a native file
too):

- Every element and text node the server wrote for an island is in the page
  afterwards wherever React's hydration keeps it (a library that removes
  nodes in an effect removes them on both; the island of `hydration-edges`
  that throws while it hydrates is left empty, by design), and hydration
  creates no more nodes than React's does: none in 21 fixtures (React: none
  in 20); in the other 11 a
  library builds nodes in an effect once it has mounted (Recharts draws its
  chart, the virtualized lists their rows, TipTap its editor), and the count
  is React's. The matrix checks both against the real React run of each
  fixture.
- A field of an island that the user focused and typed into before the page
  hydrated keeps the focus in all 12 fixtures that have one, and the text
  in the 6 where React keeps it (Ant Design, cmdk, hydration-edges,
  input-otp, react-hook-form, TanStack Table). In the other 6 React itself
  puts the field's value back
  (a controlled field that renders again), and so does what-react. The
  matrix checks it against the React run: what React keeps, what-react has
  to keep.
- No frame shows less than React's hydration shows, and the layout shift
  Chromium reports is React's (0 to 0.59, the largest for Ant Design).

Before this, an island's server HTML was replaced: every island element was
built again, and focus and typed text were lost in all 11.

React's rules, where they can be seen (react-dom 19.3.0 and 19.3.1, measured
in `test/island-adopt.test.js` and `test/island-adopt-faults.test.js`):

- The server writes `<!--$--><!--/$-->` between two texts in a row, where
  React writes `<!-- -->`, so the browser keeps them as two text nodes to
  adopt. An empty string renders nothing, on the server and in the browser,
  as in React.
- An attribute the server wrote stays as it is when it is the client's: no
  attribute is written again. One that differs takes the client's value and
  is reported (React keeps the server's and warns in development). One the
  client does not render (an extension's `data-gramm`, a password manager's
  `autocomplete`) stays, and is reported, as React keeps it and warns.
- A text that differs takes the client's text in the server's node and is
  reported. Where an element's children differ from the server's in
  structure (a node the client does not render, one the server did not,
  another tag), the client renders that element's children again, all of
  them, in place of the server's: one item's typed text, focus, scroll
  position or open `<details>` never ends up in another's node. React
  renders the nearest `<Suspense>` boundary again (the root when there is
  none). At an island's top, or a `<Suspense>`'s, the island or that
  boundary's content is rendered again. Each report is one
  `ERR_HYDRATION_MISMATCH` per element and kind, with what-core's record
  (kind `text`, `tag`, `missing`, `extra-nodes`, `marker` or `attribute`),
  as a development diagnostic and to hydrate()'s `onHydrationError` in every
  build. A form and a button keep nodes the client does not render at their
  end, unreported, as React keeps them (a password manager's). Raw HTML
  (`dangerouslySetInnerHTML`) that differs keeps the server's; development
  reports it, as React warns.
- `suppressHydrationWarning` keeps an element's own attributes and text as
  the server wrote them, unreported (React's rule).
- A form field keeps what the user did to it before hydration: its value is
  not written, onChange fires at the next edit with the whole text, and a
  controlled field shows its value again when it renders again, as in React.
  An uncontrolled textarea keeps typed text too, where React puts back a
  default that is not empty; a controlled one shows its value at once, as
  in React.
- A form whose `action` is a function (a button's `formAction`, a
  `useActionState` action) has React's guard as its action on the server
  (`javascript:throw new Error('React form unexpectedly submitted.')`), and
  the page a small capture script (the form's last child, once a page): a
  submit before the island hydrates neither navigates nor puts the fields in
  the URL, and the action runs with what was submitted once the island has
  hydrated, as React replays it. A Content Security Policy that refuses
  inline scripts keeps the guard working (the javascript: URL is refused
  too), and the submission is lost.
- An island that throws while it hydrates, with no error boundary above it,
  takes nothing else down: the walk, the other islands and the native page
  hydrate. What its render did goes (no ref or effect of it runs), and it
  renders again in the browser, as React renders a root again after an error
  while hydrating; if that throws too, the island is left empty, as React
  unmounts such a root (the server's HTML of a component that cannot render
  in the browser would look live and do nothing). The error goes to the
  console in every build and to `onHydrationError` as `{ kind: 'error',
  recovery: 'client-render' | 'none', error }`. An error boundary inside
  the island catches it first, as always.
- `useId` gives the ids the server wrote. An island numbers its ids in
  render order behind its own owner path, and a `<Suspense>` takes one of
  them and numbers what renders inside it behind that one, on both sides:
  content the server gave up on (it wrote the fallback) and content that
  suspends while it hydrates (which numbers its ids from the start again
  when it hydrates) change no id after the boundary. A portal's content
  (browser only) and a `<noscript>`'s (server only) are numbered apart.
  React's ids name a component's place in the tree; here they differ
  between the two sides for a component that renders on one side only, with
  no node and a `useId`, before another that uses one, for a component that
  calls `useId` a different number of times on each side, and after a part
  whose structure differs (reported).
- `useSyncExternalStore` reads the server snapshot in everything the island
  renders while it hydrates (a portal's content and what is rendered anew
  included, so two readers of one store agree in that commit), then renders
  again with the client's when it differs.
- A portal renders nothing on the server (React's server renderer throws
  on one) and its children are created in the browser, as in React.
- What a `<noscript>` holds is rendered on the server; in the browser no
  component in it renders or runs an effect, as in React.
- Refs attach and layout effects run in one pass, children first, as React
  interleaves them; insertion effects before, passive effects after.
- A `<Suspense>` the server rendered is adopted; one whose fallback the
  server wrote (its children suspended there) renders afresh in the browser,
  as React renders such a boundary. When something inside a boundary
  suspends while it hydrates, the boundary keeps the server's HTML as it is,
  shows no fallback, and hydrates once the promise settles; if it renders
  again on the client first, its server HTML goes and it renders as any
  boundary does. Both are React's behaviour.

A native component a React tree renders hydrates in place too, an island
inside it included: the server brackets it (`<!--[]-->…<!--/[]-->`), and
what-core walks that bracket (render.js `_hydrateRange`, called from
hydrate.js claimNative). What is not adopted yet: React elements a native
component places (its `children`, a slot prop), and a What accessor or
boundary placed in React elements. The browser builds those again in place
of the bracketed nodes, so focus and typed text inside them are lost. React
elements around them are adopted.

The plugin installs adoption by adding `import 'what-react/hydrate-islands'`
to each JSX file what-compiler compiles for hydration (the entry that calls
`hydrate()` is one), so a client build that only mounts does not carry the
code. An import runs before the code of the module that has it, so adoption
is installed before a `hydrate()` that the same module calls at its top level
(`test/island-install.test.js`). `reactCompat({ hydrateIslands: false })`
turns adoption off: the plugin adds `import 'what-react/claim-islands'`
instead, and each island takes the server's region for its own and renders
over it in the browser. One of the two is what lets an island hydrate at
all, so a build without what-react's plugin imports one of them (or calls
`_hydrateIslands()` or `_claimIslands()` from `what-react/mixed`) before
`hydrate()`; without either, development warns that the island is built
again instead of claiming the server's HTML.

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
the SVG into it, as React's own server renderer does. Eight of the 40
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

- A React element that native code places in a hole itself (a value a React
  file made and handed over, not a React tag and not `children` given to a
  native component) renders as an island of its own, by React's rules. A
  keyed list of such elements keeps each row by key when the list changes:
  its nodes, its React state, the text typed in it and the focus
  (`test/native-keyed-list.test.js`, `test/native-keyed-scenes.test.js`). In
  a client build whose native code makes no vnode (compiled JSX makes none)
  what-react installs its own vnode renderer in what-core, whose regions
  hand it each value that holds a React element, and it reconciles that value
  as React reconciles a component's children: each array of the hole is a
  list of its own, a row is kept by its key (unkeyed, its place) and its
  type, and renders its new props; two arrays of one hole (`{[rows(a),
  rows(b)]}`, a nested array, a list and an element beside it) never take
  each other's rows, a key that moves to another array mounts again, and a
  row whose key goes unmounts before the update returns. A key repeated in
  one array keeps the first element's row, the others mount again
  (development warns). A row that moves gets the focus back if the move took
  it and nothing else was focused.
  This comes with `what-react/mixed`, which a React file's JSX imports once
  what-react's plugin lowers it, so elements made only without JSX
  (`React.createElement` in a file with no JSX, or a package) are built
  again. A page that hydrates, and an app whose native code makes a vnode or
  renders a native component inside a React tree, keep the list through
  what-core's keyed rows (its vnode renderer is installed there), which
  build a row again when its element's props change, and do not give a
  moved row its focus back, and build an unkeyed list of such elements again
  whenever it changes. Rendering the list in a React component keeps it by
  React's rules in every build.
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
- Hydration adopts what React renders in an island and a native component
  a React tree renders (with what-core's `_hydrateRange`), not React
  elements a native component places (its `children`, a slot prop) or a
  What accessor or boundary placed in React elements: that part is built
  again in place of the server's nodes, and focus or typed text in it is
  lost (Server rendering).
- Where hydration differs from React's (Server rendering and
  REACT-COMPAT.md, Known limitations, have each): children that differ in
  structure are rendered again for their element, where React renders the
  nearest `<Suspense>` again; an attribute that differs takes the client's
  value, where React keeps the server's; an uncontrolled textarea keeps
  what was typed; `useId` is numbered in render order (inside each
  `<Suspense>`), not by tree position, so a component that renders on one
  side only with a `useId` and no node shifts the ids after it; a form
  submitted before hydration is lost where a Content Security Policy refuses
  inline scripts (the capture script carries no nonce), or when its form is
  rendered again because its structure differed; a click on an island before
  the page has hydrated is lost, as in React without a boundary to replay
  it; the server's HTML differs from React's in its text only (bare
  booleans, `&#39;`, two comments between texts, attribute order) and React
  19's resource hoisting (`precedence`, `<title>`, `<meta>` moved to the
  head, image preloads) is not done; a portal renders nothing on the server,
  where React throws.
- A client production build (`vite build` without `--ssr`) does not carry
  the island server renderer: what-react's plugin leaves it out of the
  bundle, so a React island cannot be rendered to a string in the browser
  (it renders empty, with a warning). The dev server and a server build
  carry it.
- In the dev server, a React package that ships CommonJS only stays external
  in a server render; an island that uses it renders in the browser. A
  production server build bundles it. A dependency of a React package that
  Node and a bundler load differently (no `exports`, a CommonJS `main`, an
  ES `module` build: @emotion/hash 0.8 under antd) is bundled in the dev
  server too, so its default import is the module's, as in a production
  build.
- The dev server needs no list of React packages: every dependency is
  pre-bundled by Vite as in any app, and `react` inside the bundles is the
  page's one what-react. `reactCompat({ exclude: ['pkg'] })` keeps a package
  out of pre-bundling; its CommonJS dependencies then have to be in
  `optimizeDeps.include`, as Vite's documentation says for any excluded
  package.

## How it works

`reactCompat()`'s mixed plugin runs before what-compiler. In a native file it
replaces each React tag, with its subtree, by
`<ReactIsland view={() => createElement(...)} />` (through an arrow the module
defines, which what-compiler calls as a plain function), a native component
from `what-react/mixed` that mounts a what-react root and renders `view` under a
signal tracker. In a React file it lowers all JSX to what-react's
`createElement` and wraps native tags with `nativeRef()`, which mounts the
native component once with a props object of getters. what-compiler skips
React files and compiles native files as usual. Tests:
`test/mixed-plugin.test.js` (which files and tags are React),
`test/mixed.test.js` (state, props, context and cleanup across the boundary),
`test/mixed-ssr.test.js` (server render, the stream, hydration, keyed rows),
`test/island-adopt.test.js` and `test/island-adopt-compiled.test.js` (an
island adopting the server's HTML, React's rules beside each, every kind of
mismatch), `test/island-adopt-faults.test.js` (an island that throws, ids
around Suspense, children that differ in structure, attributes only the
server has, a form submitted before hydration, refs and layout effects in
order), `test/island-server.test.js` (the server's markup against React's),
`test/island-hydration.test.js` (islands that native code swaps or removes
after hydration), `test/vite-plugin.test.js` (the dev server, a dev-server
render and a production server build of an installed app: one what-react in
each), `test/mixed-browser.mjs` (a Vite build, the dev server, and a server
render the browser hydrates, in Chromium, with Recharts, react-hook-form and
React context) and `test/matrix-browser.mjs` (40 package fixtures driven in
Chromium as React files inside a native app, 20 of them also written as
native files: Radix, MUI, Ant Design, Headless UI, Recharts, react-select,
framer-motion and others; as a production build, in the dev server, and
rendered by a production server build and hydrated; the table is in
REACT-COMPAT.md).
