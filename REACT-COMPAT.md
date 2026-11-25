# React Compatibility Layer (`what-react`)

`what-react` runs React packages on What Framework. It is a secondary feature:
What's native APIs (`signal`, `computed`, `createStore`, `query`, …) are
preferred for new code. Reach for the compat layer when you need a React
package with no What equivalent.

It is used two ways:

- **Mixed mode** (`plugins: [what(), reactCompat()]`): your files stay native
  What, and a React package's components are used in them with plain JSX
  (`<BarChart data={rows()} />`). Only the files that import `react` or call a
  React package's hook are React code. Rules:
  [packages/react-compat/MIXED.md](packages/react-compat/MIXED.md).
- **Full compat** (`reactCompat()` alone): every JSX file is React code and
  the whole app runs on what-react.

## Setup

```bash
npm install what-react what-core
```

```js
// vite.config.js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';
import { reactCompat } from 'what-react/vite';

export default defineConfig({
  plugins: [what(), reactCompat()],   // mixed mode; reactCompat() alone for full compat
});
```

The plugin aliases `react`, `react-dom`, `react-dom/client`,
`react/jsx-runtime`, `react/compiler-runtime` and `use-sync-external-store` to
the package `what-react`, sets the automatic JSX runtime, and keeps one
what-react in the page and in a server render:

- **Dev server (`vite`).** React libraries are pre-bundled by Vite like any
  dependency, which is what converts their CommonJS dependencies for the
  browser. Only what the plugin replaces is kept out of pre-bundling
  (`react`, `react-dom`, `use-sync-external-store`, what-react and the
  framework packages), so `react` stays an import inside each bundle and
  resolves to the page's what-react. No list of library names is kept: a
  package the plugin has never heard of is handled like every other.
- **Production build (`vite build`).** One bundle, one what-react.
- **Server render (`vite build --ssr`, a dev server's `ssrLoadModule`).**
  what-react and the React packages are bundled into the server's modules
  (Vite's `ssr.noExternal`); the rules are in MIXED.md, "What a server
  render bundles". Only mixed mode renders on the server.

It also adds `import 'what-react/class'` to every module whose code has
`isReactComponent` in it, so a class marked that way without extending
`Component` renders. A build without the plugin (esbuild, another bundler)
that has such a class imports `what-react/class` once, in its entry; without
it the class throws `ERR_CLASS_COMPONENT_NOT_INSTALLED` ("What an app
carries", below).

## How it works

`what-react` has its own renderer (`packages/react-compat/src/runtime.js`)
next to What's run-once renderer. what-core is not modified.

- **Hooks return values**, and a state change re-runs the component. The new
  output is reconciled against the last one, so DOM elements, focus, input
  state and child component state survive, as in React.
- **State updates are queued** and applied when the component renders: a
  reducer or an updater that throws reaches the error boundary, and an
  updater queued behind another sees its result. A component that sets its
  own state while it renders renders again before its commit (React's state
  from the previous render), at most 25 times; then it throws React's "Too
  many re-renders" error, which its error boundary catches.
- **Children are matched as React matches them**: by key, or by index inside
  their own list, where a nested array (a `.map()`) is a list of its own, and
  a lone child by its key too (`return <Form key={user} />` mounts a new
  `Form` when the key changes). A kept node is moved only when its list's own
  order changed; nodes a library inserted or moved itself are left where
  they are, until the list's own order changes around them: the part of the
  list that changed is then put in order in the list's element, a node a
  library had moved elsewhere included. React does the same for the nodes
  its reorder moves (a reversed list takes back such a node), and throws
  when it has to insert before one a library took away.
- **The DOM work is React's**: an element is built whole and inserted once, a
  list that kept its order is patched without reading or moving a node, an
  element whose only child is text holds it as its text content (an empty
  text leaves no node), and a component adds no node of its own. `null`,
  `false`, `undefined`, an empty string and a portal leave no node where
  they stand, nor does a component that renders one of them (the one exception is the top of a
  React island, under Known limitations). What a component that has no node
  in the document renders next (it rendered nothing or a portal, or a
  library removed what it rendered) goes before the first node of what
  follows it in the tree, inside the element that holds it, as React places
  it. `packages/react-compat/test/perf-counts.test.js` pins the counts.
- **Element content** follows React's rules: changing between text,
  children and `dangerouslySetInnerHTML` clears what was there, and the HTML
  is written again only when its string changed. What a `<noscript>` holds
  is never rendered in the browser (React's `shouldSetTextContent`): no
  component in it renders or runs an effect. A `<textarea>`'s children
  are its default value when it mounts; later children are not rendered, and
  an uncontrolled textarea without `defaultValue` gets the default value ''
  when it renders again, as in React 19.
- **A commit runs its effects in React's phases**: insertion effects, then
  the layout phase (the DOM is in place), where each element's ref attaches
  and each component's layout effects run in one pass, children before
  parents (a `<div ref>` after the layout effects of the components inside
  it, before its own component's), all before the commit returns; passive
  effects after it and always before the next render. In the layout phase
  and in the passive phase every cleanup runs before any effect. The same
  holds when an island hydrates (react-dom 18.3.1 and 19.3.0 measured,
  `react-semantics.test.js`). A subtree that is removed is cleaned up
  parents first: its layout cleanups while its refs and its DOM are still
  there, its passive cleanups with the commit's other passive effects. Where
  the order still differs from React's is listed under Known limitations.
- **Events** are native listeners on the elements, and a handler receives a
  synthetic event object (the native event's fields as own properties, React's
  methods, `nativeEvent`), one per native event and React event type, with
  `currentTarget` set while the handler runs. `offsetX`, `offsetY`, `layerX`
  and `layerY` are read from the native event when a handler asks for them
  (the browser lays the page out to answer), so an event forces no layout by
  itself; a copy of the event (`{ ...event }`) leaves those four out, as it
  leaves out React's methods. `onChange` fires when the
  field's value changed, on the field and on the elements above it. An event
  inside a portal goes on to the portal's React parents.
- **Controlled fields** show their props: when no handler takes an edit, the
  field (a text field, a checkbox, a radio group, a select, single or
  multiple) is put back at the end of the event's dispatch, after what the
  handlers set has rendered.
- **Context, Suspense and error boundaries** work across the tree. Suspense
  keeps content that was already shown mounted and hidden while it waits.
- **Class components** get their lifecycles, `shouldComponentUpdate`,
  `PureComponent`, context in the constructor and refs to the instance.
- Compat rules apply only to elements made by what-react's `createElement` or
  JSX runtime. What's own components are unaffected by this package.

## The package matrix

`packages/react-compat/test/matrix-browser.mjs` builds a fixture for each
package with Vite and drives it in headless Chromium: open, type, select,
navigate, drag, sort, with assertions on the DOM after each step. Every
fixture runs four ways with the same assertions:

| Column | What runs |
|---|---|
| Real React | React 19.3.1 and react-dom. The control: a fixture that fails here is a fixture bug. All 40 pass. |
| Full compat | `reactCompat()` alone, the whole fixture on what-react. |
| Mixed, React file | `what()` + `reactCompat()`: a native What app mounts the fixture (a React file) as a React island. |
| Mixed, native file | `what()` + `reactCompat()`: the same screen written as a native What file, with signals for state and the package's tags as plain JSX. "not written" means no native variant exists for that fixture (see the note under the table). |

and each way is served three ways (`--serve`), because each finds failures
the others cannot see:

| Served as | What it is | Real React | Full compat | Mixed, React file | Mixed, native file |
|---|---|---|---|---|---|
| `build` | A production client build, static files | 40 of 40 | 40 of 40 | 40 of 40 | 20 of 20 |
| `dev` | Vite's dev server: dependencies pre-bundled, modules served one by one | 40 of 40 | 40 of 40 | 40 of 40 | 20 of 20 |
| `ssr` | A production server build renders the fixture in Node; the production client build hydrates it, then the same steps run | 40 of 40 | not run | 40 of 40 | 20 of 20 |

Full compat has no server renderer (Known limitations), so it has no `ssr`
run. In the `ssr` run a what-react column fails when real React rendered the
fixture on the server and the island came out empty, even if the browser then
rendered it and every step passed. Eight fixtures do not render on the server
with real React either (jotai, redux, zustand, react-i18next and the React
surface fixture read `window` or `localStorage` as they load; the two
react-router fixtures and react-select read `document` while rendering): that
is recorded from the control, the page mounts in the browser, and the steps
run. The other 32 render on the server in every column, and the `ssr` run
checks each what-react column against the control's hydration of the same
fixture: no more element and text nodes created than React's hydration
creates, and, for the 12 fixtures with a text field, the focus and the text
a user typed into the server's HTML before the page hydrated (the client
bundle held back) kept wherever React keeps them. A spec can also act on
the server's HTML before the page hydrates (`beforeHydration`, then
`afterHydration` once it has): `hydration-edges` submits a form there, and
what real React does with it what-react has to do. What hydration does to an
island's HTML is in MIXED.md, "Server rendering".

Results of 2026-11-24, on the 0.15 working tree: 40 fixtures, covering 50
packages besides React itself. The table below is the `build` run; the `dev`
and `ssr` runs have the same result in every cell they have.
`pass` = every step of the fixture passed.

| Package | Version | Full compat | Mixed, React file | Mixed, native file | What the fixture does |
|---|---|---|---|---|---|
| react, react-dom (API surface) | 19.3.1 | pass | pass | not written | Events through portals, ref callbacks with cleanup, `ref` as a prop, `useImperativeHandle`, context as provider with `use`, `use(promise)` and `lazy` under Suspense, a subtree that suspends after mounting keeps its state, `useTransition` with an async action, `useOptimistic`, `useActionState` with a form `action` and `useFormStatus`, class components (context in the constructor, `shouldComponentUpdate`, `PureComponent`, ref to the instance, `setState` callback), child slots and keys, DOM props, synthetic events, controlled fields (a refused edit, a radio group, a multiple select, an `onChange` on the form, a field that stops being controlled), uncontrolled selects, `useSyncExternalStore`, `useEffectEvent`, `flushSync`, effect order, error boundaries for render and effect errors and for a reducer that throws |
| react, react-dom (hydration edges) | 19.3.1 | pass | pass | pass | `draggable={false}` on an image and a link; a form whose `action` is a `useActionState` function, submitted after mounting and, in the `ssr` run, before the page hydrates (no navigation; the action runs once it has, as in React); in the native file an island that throws while it hydrates, beside two islands and native text that stay live |
| @radix-ui/react-dialog, react-popover, react-tooltip, react-slot | 1.3.1, 1.3.1, 1.4.1, 1.5.0 | pass | pass | pass | Dialog: `asChild` trigger, portal to `<body>`, focus moved in and trapped, a controlled input inside, a Popover nested in the dialog (its portal counts as inside), Escape closes the top layer only, focus returned. Popover positioned and closed by an outside press. Tooltip on hover. `Slot` merging props and joining the class names of both sides. The page's scroll locked while the dialog is open (react-remove-scroll, switched on by a function component's `defaultProps`) |
| @radix-ui/react-dropdown-menu, react-select, react-tabs | 2.2.1, 2.4.1, 1.2.1 | pass | pass | pass | Menu in a portal, arrow keys past a disabled item, Enter selects and closes, a checkbox item, a submenu by keyboard. Select by keyboard and by pointer. Tabs by click and arrow keys |
| @mui/material, @emotion/react, @emotion/styled | 9.6.0, 11.14.0, 11.14.1 | pass | pass | pass | Emotion styles from a custom theme, Button, a controlled TextField, Select (Popover and Modal portal, keyboard and pointer), Dialog (focus trap, `autoFocus`, a Select inside it, fade-out then unmount), Checkbox, Autocomplete, Tabs, Tooltip, Snackbar auto-hide |
| antd | 6.7.2 | pass | pass | pass | CSS-in-JS theme token, a controlled Input with clear, Select, Modal with `message`, Form validation fail then pass, Table sort and pagination, Tabs, the static `message.info` |
| react-aria-components | 1.22.1 | pass | pass | not written | Button `onPress`, a controlled TextField, Select (collection built from JSX, keyboard pick), ComboBox, modal Dialog (portal, autoFocus, focus containment, Escape), Checkbox, Switch, Tabs |
| @headlessui/react | 2.2.10 | pass | pass | pass | Menu, Switch, Listbox, Combobox, Dialog (portal, focus trap, Escape), Disclosure, Tabs |
| react-router (data router) | 7.18.6 | pass | pass | not written | `createBrowserRouter` and `RouterProvider`: `Link`, `NavLink` active state, nested `Outlet`, a route `loader`, browser back and forward, `useSearchParams`, `useNavigate`, a `<Form>` action, an `errorElement`, layout state kept |
| react-router (declarative) | 7.18.6 | pass | pass | not written | `BrowserRouter`, `Routes`, `Route`: `NavLink` class function, `useLocation`, link state, `useParams`, `<Navigate>`, replace navigation, back, a catch-all route |
| @reduxjs/toolkit, react-redux | 2.15.0, 9.3.1 | pass | pass | not written | `configureStore`, `createSlice`, `useSelector` (plain, `createSelector`, `shallowEqual`), `createAsyncThunk`, a dispatch from outside React, no re-render for another slice |
| zustand | 5.1.0 | pass | pass | not written | Selectors, `useShallow`, actions from a click and from outside React, `persist`, no re-render for another slice |
| jotai | 3.0.2 | pass | pass | not written | Primitive, derived and writable atoms, a controlled input on an atom, `atomWithStorage`, an async atom under Suspense, `unwrap`, a store write from outside React |
| @tanstack/react-query | 5.108.4 | pass | pass | not written | `useQuery` pending, data and error, a key change with placeholder data, the cache, `useMutation` with `invalidateQueries`, `useSuspenseQuery`, `useIsFetching` |
| swr | 2.5.1 | pass | pass | not written | `useSWR` loading then data, one request for three hooks on a key, a key change, local and global `mutate`, `useSWRMutation` |
| @tanstack/react-table | 9.3.1 | pass | pass | not written | `useTable` with sorting, filtering and pagination, `FlexRender`, a header click cycling the sort, typing in a filter, new data |
| @tanstack/react-virtual | 3.14.28 | pass | pass | not written | 10,000 rows of two heights: a window in the DOM, a row that grows and is measured again through its `measureElement` ref, a row keeping its state while the window moves, row effects mounting and cleaning up, scrolling, `scrollToIndex`, a click on a virtual row |
| react-window | 2.5.4 | pass | pass | pass | `List` over 5,000 rows: a window in the DOM, a row with its own state keeping it while the window moves, a button in a row stopping its click, row effects mounting and cleaning up, scrolling, `scrollToRow`, changing row props |
| react-virtuoso | 4.18.24 | pass | pass | pass | 2,000 rows of measured heights: a row keeping its state while the window moves, a button in a row stopping its click, row effects mounting and cleaning up, scrolling, `scrollToIndex`, `rangeChanged`, a growing count (that last step is quarantined on what-react: an open defect) |
| react-hook-form | 7.92.0 | pass | pass | not written | `register`, validation on submit with focus on the first error, a `watch` subscription in an effect, `touchedFields` on blur, `Controller`, `useFieldArray` append, remove and swap with the rows' elements kept, `useWatch`, `setFocus`, a field that unregisters when it unmounts, `reset` |
| formik | 2.4.9 | pass | pass | not written | `<Formik>`, `<Field>` as input, select and checkbox, `validate` with `<ErrorMessage>`, a field touched on blur, focus on the first bad field (`innerRef` and an effect), `useField`, `<FieldArray>` push, remove and swap of keyed rows, submit, reset, `enableReinitialize` |
| @floating-ui/react | 0.27.20 | pass | pass | not written | `useFloating` with offset, flip, shift, arrow and `autoUpdate`; click, dismiss, role and hover interactions; `FloatingPortal`; `FloatingFocusManager`; `useListNavigation`; the measured position |
| cmdk | 1.1.1 | pass | pass | pass | Filtering and ranking as you type (items and groups hide), the empty state, arrow keys, Enter; `Command.Dialog` |
| sonner | 2.0.8 | pass | pass | pass | Plain and success toasts, an action button, `toast.promise`, a JSX toast, measured stacking, dismiss one and all |
| vaul | 1.1.2 | pass | pass | pass | A controlled drawer in a portal, a controlled input inside, Close and Escape with the exit animation, a pointer drag down that dismisses it |
| @dnd-kit/core, @dnd-kit/sortable | 6.3.1, 10.0.0 | pass | pass | not written | A sortable list: a pointer drag with `DragOverlay`, a keyboard drag with the screen-reader announcement, DOM nodes kept across the reorder |
| react-select | 5.10.2 | pass | pass | pass | A single select (menu in a portal, type to filter, keyboard, clear, a ref to the instance, the menu closing on blur, an `onKeyDown` that prevents the default), a multi select with removable values (the one that stays keeps its element), an async select |
| react-day-picker | 10.0.2 | pass | pass | pass | A single-date picker by click and by arrow keys, month navigation, a range picker with disabled days |
| framer-motion | 14.14.0 | pass | pass | pass | Mount and prop-driven animation, `AnimatePresence` exit before unmount, variants with staggered children, `whileHover`, pointer `drag` writing a motion value |
| recharts | 3.11.1 | pass | pass | pass | BarChart with grid, axes, legend, a hover Tooltip and a click on a bar, new data in the same SVG, a LineChart in `ResponsiveContainer`, a PieChart |
| styled-components | 6.6.0 | pass | pass | not written | Styles from props and `ThemeProvider`, a prop and a theme change in place, `styled(Component)`, `css`, `as`, `.attrs`, transient props, `createGlobalStyle` mounted and unmounted, `keyframes`, a ref to a styled element, `useTheme` in an effect, a keyed list of styled items reordered |
| react-markdown, remark-gfm | 10.1.0, 4.0.1 | pass | pass | pass | CommonMark and GFM to elements, custom `components` (one with an effect and a ref, one with state, a link with a click handler), raw HTML kept as text, a block inserted before a list whose items keep their state, new source |
| @tiptap/react, @tiptap/starter-kit, @tiptap/pm | 3.35.0, 3.35.0, 3.35.0 | pass | pass | not written | A ProseMirror editor: typing, bold from a toolbar button and from Mod-b, undo and redo from a button and the keyboard, a toolbar that follows the selection (`useEditorState`), and two React node views drawn inside ProseMirror's DOM: an inline chip that marks itself when selected, a block whose hint shows while its editable content is empty |
| lucide-react | 1.79.0 | pass | pass | pass | Icons as `forwardRef` SVG components: size, color, stroke and class as real SVG attributes, a ref, swapping icons |
| react-i18next, i18next | 18.0.3, 27.2.7 | pass | pass | not written | `useTranslation` with interpolation, plurals and a namespace, `<Trans>` with an element, `changeLanguage` from inside and outside React |
| react-hot-toast | 2.6.1 | pass | pass | pass | Success and error toasts, an id that is not duplicated, a toast that removes itself, `toast.promise`, a JSX toast, dismiss all |
| react-transition-group | 4.4.5 | pass | pass | not written | `CSSTransition` enter and exit classes with callbacks and `unmountOnExit`, `TransitionGroup` (add, removal held until the exit ends with the content's effect cleaned up after it, a reorder that moves the elements), `SwitchTransition` |
| react-error-boundary | 6.1.6 | pass | pass | not written | A render error shows the fallback, calls `onError` and cleans up the effects of what it replaced; a fallback that focuses its button (a ref in an effect); `resetErrorBoundary` as a click handler; `resetKeys`; `useErrorBoundary().showBoundary`; an error thrown in an effect; a new `key` on the boundary |
| react-resizable-panels | 4.24.1 | pass | pass | pass | A pointer drag on the separator, arrow keys on it, `onLayoutChange`, panel state kept |
| input-otp | 1.5.0 | pass | pass | pass | A hidden real input driving rendered slots, the active slot, a pattern refusing letters, Backspace, `onComplete`, a reset from outside |

**"not written" in the native-file column.** A package whose API is hooks
(zustand, jotai, Redux, TanStack Query, Table and Virtual, SWR,
react-hook-form, formik, Floating UI, dnd-kit, react-i18next, TipTap) has no
native-file form: the file that calls its hook is a React file, which is the
"Mixed, React file" column. For react-router, styled-components,
react-transition-group, react-error-boundary and react-aria-components a
native variant is possible in part and was not written; nothing is claimed
for it.

### What the matrix does not cover

- **A dev-server render.** `ssr` is a production server build. A server
  render through Vite's dev server (`ssrLoadModule`) is covered for recharts
  and react-hook-form (`npm run test:browser:mixed`), for a CommonJS file of
  a bundled package (`test/vite-plugin.test.js`) and not per package.
- **Streaming.** The `ssr` run renders to a string
  (`renderToHydratableString`).
- **Hot replacement.** Every edit reloads the page (MIXED.md, Limits).
- **Other browsers.** Chromium only.
- **Performance.** Nothing here measures speed or bundle size.
- **Each package's whole API.** A row says the listed interactions work.

### Not run: no claim either way

Chakra UI, Mantine, Base UI, Apollo Client, MobX, valtio, react-dnd,
@hello-pangea/dnd, Lexical, Slate, React Flow (@xyflow/react),
react-spring, Embla, Swiper, react-dropzone, react-pdf (the viewer),
react-toastify, react-helmet-async, next-themes, react-intl, Stripe's React
bindings, and everything else not in the table.

### Unsupported

| What | Why |
|---|---|
| react-three-fiber, react-konva, ink, @react-pdf/renderer, anything built on `react-reconciler` | They bring their own renderer and drive it through React's reconciler package, which what-react does not implement. |
| React Server Components and packages that need them (`server-only`, the Next.js app router) | what-react is a client runtime. |
| `react-dom/server` (`renderToString` and friends) | Not provided. A package that calls it in the browser gets real React's, which cannot render what-react elements. |
| Packages that read React's internals (`__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE`, fibers on DOM nodes, React DevTools hooks) | There are no fibers. The React 18 internals object exists with empty dispatchers only. |

## What the matrix found, by cause

Run with the same fixtures, what-react as it was before this work (commit
`de9f188b`) passed 24 of the 37 package fixtures in full compat, 22 of 37 as
React files in a native app and 8 of the 19 native-file variants, and could
not build the React-surface fixture (missing exports). Each cause below is
fixed in `packages/react-compat/src` and has a unit test in
`packages/react-compat/test/react-semantics.test.js` (or the file named);
all 28 tests of that file fail on the old runtime.

| Cause | Packages it broke | Fix |
|---|---|---|
| Unkeyed children were matched by position among unkeyed siblings, so a keyed sibling that left moved every later child into another slot and remounted it | react-select (the input lost focus and its text on the first key) | Children are matched by key or by index inside their own list; a nested array is its own list |
| Kept nodes were re-inserted whenever their container held nodes the list did not own | Radix Dialog (two portals in `<body>` re-inserted each other, blurring the focused input) | A kept node moves only when its list's order changed |
| Unmounting removed what stood between a component's markers | cmdk (it sorts its items in the DOM; filtered items stayed on screen) | A component's nodes are found through its rendered tree |
| A re-render could start before the last commit's passive effects ran | Radix DropdownMenu, Select (a layer read a registry before registering; its content stayed `pointer-events: none`) | Pending passive effects run before every render |
| A parent's layout effect ran before its descendant's when both re-rendered on their own in one commit | cmdk (no item selected after clearing the search) | Descendants' effects are queued first |
| Events inside a portal did not reach the portal's React parents | Radix (a Popover inside a Dialog). MUI was listed here too; its fixture passes with these listeners switched off, so it is not evidence for this row | Two document listeners per event type carry the event along the React path |
| Handlers received the native event: no `isPropagationStopped()`, and `{ ...event }` copied nothing | Ant Design Table (sorting threw), Radix Select, react-aria-components (keyboard navigation dead) | A synthetic event object with own fields and React's methods |
| `onInput` and `onChange` on one field shared a listener slot; `onInput={undefined}` removed the `onChange` handler | react-aria-components | Handlers are kept per React prop |
| A prop that was `undefined` was written as `''` (`maxLength` became 0, `href` a link to the page, `tabIndex` focusable) | react-aria-components (the text field accepted no text) | Null and undefined props are left out, and taken back when they become undefined |
| `aria-*={false}` removed the attribute | Headless UI Switch (`aria-checked`), Radix menu checkbox items, react-window rows (`aria-selected`) | Written as text, as React does |
| `autoFocus` was not applied | MUI Dialog, cmdk | The element is focused when it mounts |
| A controlled field kept what the user typed when the handler refused it | input-otp | The field goes back to its prop at the end of the change event's dispatch (the second review, below, made this synchronous and covered selects and radio groups) |
| Class components were constructed without context, `shouldComponentUpdate` was ignored, `this.state` changed at the `setState` call, a ref was passed as a prop | react-transition-group (`TransitionGroup` never animated new items), react-select refs | Rewritten class wrapper (`runtime.test.js`, `react-semantics.test.js`) |
| A portal into an object that is not a DOM node crashed | react-aria-components (it renders its collections into a document of its own) | Such a portal renders into a detached shadow tree and mirrors its elements into the library's document |
| `<motion.div>` and `<table.FlexRender>` were lowered as host elements in mixed mode | framer-motion, TanStack Table (mixed mode only) | A member tag's object is a variable (`mixed-plugin.test.js`) |
| React 19 names were missing; a missing named export fails the whole build | any package importing them | `useOptimistic`, `useActionState`, `useEffectEvent`, `Profiler`, `Activity`, `cache`, `useFormStatus`, form `action` functions, `<Context value>`, ref cleanup functions, async transitions, `react/compiler-runtime` |
| `Children.count`, `map` and `toArray` skipped empty children and gave no keys | found with the React-surface fixture | React's rules for empty children (`runtime.test.js`); React's keys came with the second review, below |
| An error thrown in an effect was logged, not routed | found with the React-surface fixture | It goes to the nearest error boundary |
| Content that suspended after mounting was unmounted, losing its state | found with the React-surface fixture | It stays mounted and hidden behind the fallback |
| `reactCompat()` alone set Vite's deprecated `esbuild` option on Vite 8 | every full-compat build (a warning) | The `oxc` option on Vite 8 and later |

vaul also failed on the old runtime (the input inside its drawer could not be
clicked) and passes now; which of the fixes above it needed was not isolated.

## What the second review found

A reviewer ran the same components on real React (19.3.0, and 18.3.1 for
effect order and `defaultProps`) and on what-react as it was at commit
`cbbfd764`, in jsdom. Each row below was a difference then and is fixed. The
tests are in `packages/react-compat/test/react-semantics.test.js` under "The
second review" (`mixed.test.js` and `mixed-plugin.test.js` for the mixed-mode
rows); each states the value React printed. 27 of the 31 tests added to
`react-semantics.test.js` fail on `cbbfd764`; the other four hold behaviour
that was already right.

| Difference at `cbbfd764` | Now |
|---|---|
| A reducer or a `useState` updater ran inside `dispatch`/`setState`: what it threw went to the caller, not to the error boundary, and an updater ran even when its component unmounted first | Actions are queued per hook and applied by the render. With nothing queued the action is tried at the call, as React does for `useState` (a state that does not change schedules no render; what it throws is thrown again by the render) |
| A refused edit stayed in a controlled field until a microtask later; `<select multiple value={[…]}>` selected nothing and was never restored; a refused click in a controlled radio group left nothing checked; a field whose `value` or `checked` became undefined was emptied | The field is restored when the event's dispatch ends, after what the handlers set has rendered. A select's options follow its value (an array for `multiple`; the first option when none matches). The other members of a radio group are put back with the one that was clicked. A field that stops being controlled keeps what it shows |
| An uncontrolled `<select>` showed its last option (the reconciler inserts new children last to first), ignored `defaultValue` unless it named the last option, and ignored it for `multiple` | It starts as a browser shows one built in order: its `defaultValue`, the last option marked `selected`, or the first option that is not disabled |
| An `onChange` on an element above a text field (a form) fired when the field lost focus, not per keystroke; a native `change` on a text field with a new value fired none | `onChange` on any element hears React's change event of the fields inside it; a text field's `change` counts when its value is new (`fireEvent.change`) |
| `onChange` fired for an `input` event that changed nothing | It fires when the field's value (or `checked`) is not the one last seen, as React's value tracking decides |
| A layout cleanup ran right before its own effect, component by component; passive effects the same | Per phase, every cleanup, then every effect |
| Unmounting ran children's cleanups before parents', detached an element's ref before the layout cleanups above it, and ran passive cleanups together with layout cleanups | Parents first; layout cleanups see their refs and their DOM; passive cleanups run in the passive phase, with refs already null |
| `useInsertionEffect` ran while its component rendered (parent before child, also for a render that then threw) | It runs in the commit, children before parents, before refs and layout effects |
| A host element's `props` had `class` and `for` in place of `className` and `htmlFor`: a Radix `Slot` (and any `cloneElement` merge) lost the child's classes | The props keep React's names |
| `defaultProps` of a function component, a `forwardRef` or a `memo` were ignored (Radix Dialog never locked the page's scroll: react-remove-scroll's `enabled` is a default prop) | Resolved when the element is made, for every component type; a `memo`'s inner component's too, as React 18 does |
| `Children.toArray`/`map` keys were not React's: no escaping, and nested arrays shared one counter, so two children could get one key and one of them was remounted on the next render | React's keys (`.$a=0b=2c`, `.1:0`, `.1:$x`) |
| `Context.Provider` and `Context.Consumer` had no `$$typeof`, `Fragment` was what-core's function, a `forwardRef` had no `render`: `react-is` 18's `isContextProvider`, `isContextConsumer` and `isFragment` answered false | `Provider.$$typeof` is `react.provider`, `Consumer.$$typeof` is `react.context`, `Fragment` is `Symbol.for('react.fragment')` (an element made with what-core's Fragment gets it too), `forwardRef(render).render` is `render`, a context has `_currentValue` |
| One synthetic event object per native event: an `onInput` handler that kept its event later read `type: 'change'`, and `currentTarget` stayed set | One object per native event and React type; `currentTarget` is null outside a handler |
| A form's function `action` did not run when an `onSubmit` handler called `stopPropagation()` | It runs unless a handler called `preventDefault()` |
| `componentDidCatch` got `componentStack: ''` | One `\n    at Name` line per component, from the one that threw to the root |
| `useDeferredValue(value, initialValue)` ignored `initialValue` | The first render gets `initialValue`, and a render with `value` follows |
| `getSnapshotBeforeUpdate` was called before `render()` | After `render()`, before the component's DOM changes |
| An effect whose deps changed in a render that then suspended (or threw) never ran when the component rendered again | The render that did not commit leaves the effect to the next one |
| Mixed mode: a hook called on an import (`rhf.useForm()` with `import * as rhf`) did not make the file a React file | It does (`mixed-plugin.test.js`) |
| Mixed mode: a native component inside a React tree got several React children as one placeholder | An array with a placeholder per child (`mixed.test.js`, MIXED.md) |

The second-review probes that already matched React still do: capture and
bubble order, `stopPropagation` among React handlers, focus and blur
bubbling, events through nested portals, `onScroll` not bubbling,
select/radio/file `onChange`, a textarea's children when it mounts (an
update matched React only from the third review on, below), class
lifecycles and `setState` callbacks, errors from render and effects reaching
boundaries, Suspense keeping shown state, render-phase updates that settle,
`useOptimistic`, `useActionState`, form actions with `useFormStatus`,
`use()`, keyed and nested-array reconciliation, `cloneElement`,
`startTransition` and `unstable_batchedUpdates`.

## What the third review found

A reviewer ran the same components on real React 19.3.0 and on what-react at
commit `a6888c51` (the reconciler rewrite), in jsdom. Identity, state, move
sets, commit order and the detached-build mount path matched React; these
five did not, and each is fixed with a test in
`packages/react-compat/test/react-semantics.test.js` under "The third
review" (`mixed.test.js` for islands and native components,
`perf-counts.test.js` for the count that changed). Each test states the
value React gave and fails on `39441d2d`.

| Difference at `a6888c51` | Now |
|---|---|
| An element that went from text children to `dangerouslySetInnerHTML` rendered empty for one commit: the HTML was written, then the text's removal cleared it. The HTML was also written again on every render with a new `{ __html }` object, replacing its nodes | The element shows the HTML. Text, children, HTML and nothing replace each other in any order, as in React, and HTML is written only when its string changed |
| A component whose placeholder comment a library removed rendered its next output at the end of its parent | It renders before the first node of what follows it in the tree, as React places it (React's `getHostSibling`). Outside an island's top it no longer has a placeholder to lose (next row) |
| A hole (`null`, `false`, `undefined`) and a portal left a comment where they stood, and a text child that became `''` an empty text node: `childNodes` had nodes React's has not, which code that walks them (an editor, a text-splitting helper, an `innerHTML` snapshot) sees | They leave no node, except at the top of a React island (Known limitations). Measured on the matrix's TipTap fixture: at `a6888c51` three comments stood inside ProseMirror's DOM (in its React node views); now none, as with React. Every step of the fixture passed both ways |
| A `<textarea>`'s children wrote its value on every render, over what the user typed | Its children are its default value when it mounts. Later children are not rendered; an uncontrolled textarea without `defaultValue` gets the default value '' when it renders again, as React 19 does, and what it shows does not change |
| A component that set its state every time it rendered was rendered 26 times, then its partial state (`n=25`) was committed and an error logged | It throws React's error, "Too many re-renders. React limits the number of renders to prevent an infinite loop.", after the first render and 25 more; its error boundary shows it, and without one the root's render throws. React renders it 53 times (it tries the render again after an error); the outcome is the same |

Found while checking the documentation: a row inserted before a row a
library had moved out of the list's element went to the end of the list.
It goes before the next row still in the element now (React throws
`NotFoundError` there).

Speed did not change: `perf-counts.test.js` passes with one count changed (a
component that renders nothing creates no comment: 0, was 1), and the
krausest app on what-react, script thread time in 6 interleaved rounds
against hand-written JS, is 3.11 times (3.13 before; React 5.13; an
earlier 8-round run gave 3.22 and 3.21), every operation within 4% of
before; a native list with one React component per row is 1.26 times an
all-native row (1.27 before). The
`react-counter` bundle is 22,170 B gzip (22,251 before): the attribute map
for SVG is built from its names, and a production build leaves out the
explanation of three messages (`ERR_HOOK_OUTSIDE_RENDER` and the two of the
update-loop guard): each keeps its first sentence (and the error its code,
whose fix what-core's error catalogue has); development shows them whole.

## What an app carries

Production builds through Vite, gzip, as `npm run check:size` measures them
(Node 22.13.1), beside what React 19.3.1 ships for the same app:

| Scenario | what-react now | at `90c91c40` | React 19.3.1 |
|---|---|---|---|
| `react-counter`: a counter, `reactCompat()` alone | 16,175 B | 22,160 B | 67,599 B |
| `mixed-recharts`: a native What page that draws a recharts chart; the chunk that holds what-core and what-react, recharts' own code apart | 23,672 B | 29,074 B | 67,383 B (React and ReactDOM) |
| `mixed-hydrate`: a native page with one React island, hydrating | 42,788 B | 44,964 B | (none) |

`node benchmark/size/why.mjs <scenario>` lists what is in a scenario's
bundle, declaration by declaration, with what keeps each one there.

What an app does not use, it does not carry:

- **What-core's vnode renderer.** what-react's elements are what-core vnodes
  as before, made by what-core's unbuilt component call (`_$componentVNode`)
  instead of `h()`, which installs what-core's renderer: only native What code
  needs it. A page that hydrates installs it (`_claimIslands`, which the
  hydrating entry's import runs), as does an app
  whose native code makes a vnode or renders a native component inside a
  React tree. Without it, a React element that reaches what-core (a function
  child that returns one, a portal placed by native code) renders as an island
  of its own, by React's rules; what-core used to render a host element there
  with What's prop rules.
- **Class components.** `Component`'s definition installs the class
  lifecycle, so a program without `Component` does not carry it. A class
  marked `isReactComponent` that does not extend `Component` (by hand, as
  React accepts, or by a library) gets it from `what-react/class`, which
  what-react's Vite plugin imports into every module that has
  `isReactComponent` in it (the framework's own files excepted); a build
  without the plugin imports it once. Without either, such a class is
  refused with `ERR_CLASS_COMPONENT_NOT_INSTALLED` instead of rendering
  nothing. With the lifecycle installed, a class that has a `render()` method
  and no `Component` base still renders as a class.
- **`Suspense`, `StrictMode`, `Profiler`, `Activity`** carry their statics
  from where they are made, so an app that renders none drops them.
- **Island hydration.** How an island claims the server's region is installed
  by the hydrating entry (`what-react/claim-islands`, which
  `what-react/hydrate-islands` includes; the plugin adds the import to every
  module what-compiler compiles for hydration, MIXED.md). A client build
  carries neither that nor island
  adoption (`hydrate.js`) nor the island server renderer (`server.js`, which a
  stand-in replaces in every client build; an island's server branch lives in
  it now).
- **The island's component call.** The mixed plugin's island tag is an arrow
  the native module defines, which what-compiler calls as a plain function.
  An imported component could be a class component or a tag held in a
  binding, and the general call that looks for those brought what-core's
  element-from-tag code (a props spread, every field type) into every page
  with an island: 3,270 B of the recharts page.

check-size fails when one of these comes back: a native app built with
`reactCompat()` as well must be the same bytes as without it, and a client
build must carry no island adoption and no island server renderer.

A library that reads React through its namespace object keeps every export of
`react` in the bundle: recharts reads `React['useId'.toString()]`, so the
recharts page carries the class lifecycle, `Children`, `Suspense` and the other
hooks whether it uses them or not, as it would carry them with React.

Speed did not change: `perf-counts.test.js` passes unchanged, and the
krausest app on what-react (16,953 B gzip, 23,109 B before; React's 68,394 B)
is 3.32 times hand-written JS in script thread time over 8 interleaved rounds
(3.41 before, React 5.71; an earlier run of the size changes alone gave 3.19
against 3.22), no operation slower beyond the run's noise. A native list with
one React component per row is 1.29 times an all-native one (1.27 before;
1.31 and 1.31 in the earlier run).

## Known limitations

- **Rendering is synchronous.** There is no time slicing. A transition's
  updates render in the next flush like any other; `isPending` is true only
  while an async action is running. `useDeferredValue` defers nothing after
  its initial value: it returns the value it was given. A transition does
  not keep the old screen while new content suspends: the Suspense fallback
  shows. No package in the matrix was affected.
- **Render and commit are one pass.** React renders a whole tree, then
  commits it; here each component is rendered and its DOM patched in turn.
  What follows from it:
  - A removed component's layout cleanups (and `componentWillUnmount`) run
    while the reconciler is at its place in the tree, before the components
    after it have rendered. In React they run after every render of the
    commit.
  - `getSnapshotBeforeUpdate` is called after its component's `render()` and
    before that component's own DOM changes, but DOM that an earlier part of
    the same commit patched (a parent's attributes, an earlier sibling) is
    already new.
  - A ref whose callback changed is detached while its element is patched,
    before the commit's insertion effects; the new one attaches in the
    layout phase, as in React. React detaches it in its mutation phase,
    component by component with the insertion effects and layout cleanups.
  - Every insertion effect of a commit runs before any layout cleanup.
    React runs a component's insertion effects and layout cleanups
    together, component by component.
  - If a descendant throws during a subtree's first commit, effect cleanups
    of partially mounted children may not run before the boundary's fallback
    replaces them. Not re-checked in this pass.
- **State updates.**
  - `useReducer` runs an action at the `dispatch` call when nothing is
    queued, with the reducer of the last render (React 17's behaviour), and
    keeps the result. React 18 runs every action while rendering, with that
    render's reducer.
  - A render whose queued actions leave the state as it was is committed
    like any other (its children render, its effects without deps run).
    React discards it.
  - Setting another component's state while a component renders works, with
    no warning.
- **`StrictMode` does nothing.** No double render, no second run of effects
  in development.
- **`useActionState`.** `isPending` is true while an action runs that was
  dispatched outside a transition; React reports false there, with a
  warning.
- **Suspense.** Content that suspends on its first mount is not mounted
  until the promise settles (React also shows only the fallback). Content
  that suspends after it was shown stays mounted and hidden, and keeps its
  state. Unlike React, its layout effects are not cleaned up while it is
  hidden and run again when it returns.
- **`<Activity mode="hidden">` renders nothing.** React keeps the hidden
  tree's state; here it unmounts.
- **Server rendering.** Full compat has none: `renderToString` of a compat
  element is unsupported, and `hydrateRoot` renders the root in the browser
  in place of the server's HTML. Of its options it honours
  `identifierPrefix` (`useId` gives `_<prefix>r_<n>_`, React's client ids)
  and `onRecoverableError` (called once, with React's "Hydration failed
  because the server rendered HTML didn't match the client" error, when what
  the client rendered is not the server's HTML, comments aside). In mixed
  mode React islands render on the server and hydrate by adopting the
  server's elements and text (MIXED.md, Server rendering): focus, typed text
  and anything else attached to those nodes stay, as with React. Where they
  differ from React (react-dom 19.3.0 unless named):
  - Where an element's children differ from the server's in structure (a
    node the client does not render, one the server did not, another tag),
    the client renders that element's children again, all of them; React
    renders the nearest `<Suspense>` boundary again (the root when there is
    none). So both lose what the user did to those nodes, and neither gives
    one item's typed text, focus or scroll position to another. A text or an
    attribute that differs is mended in the server's node: the client's
    value is written, where React keeps the server's attribute (and warns in
    development) and renders the boundary again for a text. Each is reported
    as `ERR_HYDRATION_MISMATCH`, once per element and kind.
  - An attribute only the server wrote (one an extension added before
    hydration: `data-gramm`, a password manager's `autocomplete`) stays, as
    in React, and is reported (recovery `none`).
  - Raw HTML (`dangerouslySetInnerHTML`) that differs keeps the server's, as
    in React; development reports it, as React warns.
  - An uncontrolled textarea keeps text typed before hydration where React
    puts back its default; a controlled one shows its value, as in React.
  - An island that throws while it hydrates (no error boundary above takes
    it) is rendered again in the browser, as React renders a root again
    after an error while hydrating; if that throws too, the island is left
    empty, as React unmounts the root. The error is logged
    (`console.error`, every build) and handed to `onHydrationError` (kind
    `error`); the rest of the page and its other islands hydrate as if it
    were not there.
  - A native component a React tree renders hydrates in place, an island
    inside it included (what-core's `_hydrateRange` walks its bracket). Still
    built again in place of the server's nodes: React elements a native
    component places (its `children`, a slot prop), and a What accessor or
    boundary placed in React elements. Focus and typed text inside those are
    lost.
  - `useId` numbers ids in render order behind the island's owner path, and
    behind each `<Suspense>`'s own id inside it; React's ids name a
    component's place in the tree. They agree wherever both sides render the
    same components: also when the server gave up on a boundary's content or
    it suspends while it hydrates, beside a portal's content and a
    `<noscript>`'s. Different on the two sides (where React's would not be):
    a component that renders on one side only, with no node and a `useId`,
    before another that uses one; a component that calls `useId` a different
    number of times on each side; what follows a part whose structure
    differs (reported).
  - A form whose `action` (or a button whose `formAction`) is a function is
    written with React's guard, `action="javascript:throw new Error('React
    form unexpectedly submitted.')"`, and a small capture script as the
    form's last child, once a page: a submit before the island has hydrated
    neither navigates nor puts the fields in the URL, and runs the action
    with its data once it has (a `useActionState` action included), as React
    replays it. With a Content Security Policy that refuses inline scripts
    the guard still holds (the javascript: URL is refused too); the
    submission is then lost. what-react writes no nonce on the script.
  - The server's markup follows React's rules where the browser can tell
    them apart (attributes, their values, `style`; `test/island-server.test.js`).
    In the HTML text it differs: booleans are bare (`disabled`) where React
    writes `disabled=""`, `'` is `&#39;` (React: `&#x27;`), a textarea's
    content starts with a newline, attribute order, and separators between
    texts are two comments (`<!--$--><!--/$-->`) where React writes one
    (hydration needs the pair to find each text). React's `<!--$-->`
    markers around a `<Suspense>` are `<!--[]-->…<!--/[]-->` (its fallback,
    `<!--$-->` around another pair). They stay in the page after
    hydration, as React's do. React 19's resource handling is not done:
    `<link rel="stylesheet" precedence>`, `<style precedence>`, an async
    `<script>`, `<title>` and `<meta>` stay where the island renders them
    (React moves them to the start of the document, `precedence` becoming
    `data-precedence`), and no `<link rel="preload">` is written for an
    image.
  - A portal renders nothing on the server, where React's server renderer
    throws ("Portals are not currently supported by the server renderer"):
    an island with an ungated `createPortal` renders on the server here.
  - What a `<noscript>` holds is rendered on the server and never in the
    browser, as in React.
  - `useSyncExternalStore` without `getServerSnapshot` throws React's error
    on the server ("Missing getServerSnapshot, which is required for
    server-rendered content. Will revert to client rendering."), and the
    island renders in the browser. While an island hydrates every reader
    sees the server snapshot (a portal's content and what is rendered anew
    included), then the client's.
  The matrix's `ssr` run exercises it for every fixture (`hydration-edges`:
  `draggable={false}`, a form submitted before hydration, an island that
  throws beside two that do not).
- **Class components.** Legacy context (`contextTypes`, `childContextTypes`)
  and string refs are not supported. `componentDidCatch`'s `componentStack`
  names components only: no host elements, no source locations.
- **Events are not delegated to the root.** Handlers are native listeners on
  their elements. What follows from it:
  - A handler runs in DOM order with any native listener on the same path.
  - `stopPropagation()` in a React handler also stops native listeners
    further up, which React does only from the root on. Inside a portal that
    includes native listeners on the portal's container (a click-away
    listener a library put on the element it portals into): React lets them
    run, here they do not.
  - `onMouseEnter` and `onMouseLeave` do not cross portals.
  - A form's function `action` does not run when a listener that is not
    React's stops the `submit` event before it reaches the document.
  - `onWheel`, `onTouchStart` and `onTouchMove` listeners are not passive
    (React's are on the root, passive): `preventDefault()` takes effect in
    them, where React ignores it. What that costs while scrolling was not
    measured.
- **`onChange`.**
  - A checkbox or a radio fires it on the native `change` event; React fires
    it during the `click` before that event. A click gives the same result
    either way. A script that sets `checked` and dispatches only `change`
    fires `onChange` here and not in React.
  - A value a script assigned (`input.value = 'x'`) counts as a change at
    the next event. React counts the assignment as seen and fires nothing,
    which is why tests written for React use the prototype's setter; both
    ways fire here.
  - A `change` event from any element that is not a form field reaches
    `onChange`; React passes it on for custom elements only.
- **Controlled fields.**
  - When a listener that is not React's stops a field's change event, or the
    event does not bubble, a refused edit is put back a microtask (in a
    browser, at worst a task) after the dispatch instead of at its end.
  - The `value` attribute is not kept in step with a controlled input's
    value (React writes it, except for a focused number field), nor a
    controlled textarea's text content (its default value) with its value.
  - `defaultValue` on a `<select>` whose options arrive in a later render is
    not applied: the first option is shown, as in React.
- **Nodes React does not make.** `null`, `false`, `undefined` and a portal
  leave no node, except at the top of a React island that has no markers
  (a React tag in a native file, or a React component that native code
  renders, mounted in the browser): there, outside every element the
  island renders, a hole is one `<!--w:h-->` comment and a portal one
  `<!--w:portal-->` comment, also when the hole is all a component at that
  top renders (`function Modal({ open }) { return open ? … : null }` as an
  island's whole output). Native code holds no place for an island, and
  nothing of React's follows it to find one from, so the island keeps a
  node. Inside any element the island renders, and in a root, a portal's
  container or a native component's children, none is left. An island a
  server rendered stands between its markers and keeps none either. A
  library that removes every node of an island (that comment included)
  leaves what it renders next nowhere to go: it is not shown.
- **Elements.**
  - A host element given both `class` and `className` keeps `className`.
  - `React.version` is `18.3.1` and elements carry React 18's brand
    (`Symbol.for('react.element')`), with React 19's API on top (`ref` is a
    prop and is also on the element). A package that branches on the version
    takes its React 18 path. `react-is` 18 recognises elements, memo,
    forwardRef, fragments, providers and consumers; `react-is` 19, which
    looks for React 19's brand, recognises none of them (run against
    `react-is` 19.3.1). No package in the matrix was affected.
  - `Suspense`, `StrictMode` and `Profiler` are functions, not React's
    symbols: `react-is`'s `isSuspense`, `isStrictMode` and `isProfiler`
    answer false.
  - A context's `_currentValue` is its default value; React also keeps the
    nearest provider's value there while it renders.
  - A `memo`'s inner component's `defaultProps` apply (React 18.3.1; React 19
    dropped them).
- **`Profiler` measures nothing**, and the resource hints of `react-dom`
  (`preload`, `preinit`, …) do nothing.
- **A portal into a library's own document** (react-aria-components) is
  compared with its mirror after each commit that changed it, in time
  proportional to the collection's size.
- **Cost with many portals.** Routing an event out of a portal scans the
  children of the portals in its containers. Not measured.
- **A list that was reordered moves the nodes React moves** (a row that moved
  up stays, the rows it passed move), not the fewest possible: swapping two
  rows of 1,000 moves 997, as in React.
- **An update loop through effects is stopped, not thrown.** (One inside a
  render throws React's error, as in React: How it works.) A component that
  sets state every time it commits (an effect with no dependencies) is
  stopped after 100 render cycles in one flush, with an error in the console: what is queued
  renders, and its state updates are then refused until the event loop has
  turned, so the screen shows the state as it stands. React throws "Maximum
  update depth exceeded" after 50 nested updates. A loop that goes through a
  promise (an effect resolves one that sets state) is not ended: after 1,000
  flushes with no turn of the event loop, rendering waits for one and goes
  on, with an error in the console and no update lost, so the page stays
  responsive (React's scheduler yields the same way). Updates made in
  separate tasks are never counted, however fast they come.
- **Bridge-mounted compat components** (a compat component rendered by
  what-core outside mixed mode) attach refs and layout effects before the
  surrounding What fragment is in the document, so layout read there on first
  mount can be zero. Not re-checked in this pass.

## Re-running

```bash
# Unit suites (jsdom), part of `npm test`
node --test 'packages/react-compat/test/*.test.js'

# The package matrix (Chromium). Install the fixture's packages once, at the
# versions its committed lockfile pins (403 packages, about 435 MB):
npm ci --prefix packages/react-compat/test/fixtures/matrix
npm run test:browser:matrix                 # a production client build
npm run test:browser:matrix -- --serve=dev  # Vite's dev server
npm run test:browser:matrix -- --serve=ssr  # a production server build, hydrated
#   --mode=react,compat,mixed   which builds (default: all three; mixed runs both mixed columns)
#   --only=mui,cmdk             which fixtures
#   --md                        print table rows   --json=out.json   full results
#   --retries=1                 rerun a failed fixture once before calling it failed; reruns are listed
#   --probe                     ssr: no longer needed (typing into the server's HTML before it hydrates always runs)
#   --timeout=15000             per-wait timeout in ms, for a slow machine

# Mixed mode end to end: production build, dev server, server render and hydration
npm run test:browser:mixed
```

CI runs the three as the `react-matrix` job, one leg per `--serve`
(`.github/workflows/ci.yml`).

The matrix exits 0 when real React passes every fixture and every what-react
result is a pass or a failure the fixture's spec lists under `known` with its
reason. A spec can quarantine a step for what-react (`quarantined`): it is
reported when it fails and does not fail the run. One step is: react-virtuoso's
"a growing count", which on what-react sometimes stops short of the last rows
(an open defect; the spec has the numbers). Each fixture is a folder in
`packages/react-compat/test/fixtures/matrix/src/libs`: `fixture.jsx` (a React
file), `spec.mjs` (the steps and assertions, shared by every column), and
`native.jsx` where the same screen exists as a native What file. Adding a
package is adding a folder and its dependency to the fixture's `package.json`.
