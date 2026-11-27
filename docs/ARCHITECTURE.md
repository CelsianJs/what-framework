# What Framework -- Architecture

> **This document is about how the framework works** — the mental model, the
> rendering pipeline, islands, the agent surface.
>
> For **where the code lives** — the package graph, what each directory is for,
> which gate protects what, which CI is authoritative — see
> [ARCHITECTURE.md](../ARCHITECTURE.md) at the repository root.

## Overview

WhatFW is a fine-grained reactive framework built for AI agents and developers who want the closest thing to vanilla JS with a React-familiar authoring experience.

Components run once. Signals drive individual DOM updates. There is no virtual DOM, no tree diffing, and no reconciler for static content.

**Agent-first design principles:**
- Small, predictable API surface (agents make fewer errors)
- MCP DevTools bridge for live debugging without browser access
- Structured error codes with signal/effect context
- Compiler guardrails that catch mistakes before runtime

### Core Mental Model

Your component function executes a single time and returns real DOM nodes. Every dynamic expression (text content, attribute value, class name, style) becomes an individual `effect()` bound to the exact DOM node it updates. When a signal changes, only the effects that read that signal re-run, and each effect updates only the one DOM node it owns.

```
+-----------------------------------------------------+
|                   Your App                           |
|  Components . Pages . Layouts . Islands              |
+-----------------------------------------------------+
|                                                      |
|  +---------+  +--------+  +----------------------+   |
|  |  Hooks   |  | Router |  |  Store / Context      |  |
|  | useState |  | routes |  |  createStore()        |  |
|  | useEffect|  | Link   |  |  derived()            |  |
|  +----+-----+  +---+----+  +--------+-------------+  |
|       |            |                |                 |
|  +----+------------+----------------+---------------+ |
|  |           Reactive Core (Signals)                | |
|  |  signal() . computed() . effect() . batch()      | |
|  +----------------------+---------------------------+ |
|                         |                             |
|  +----------------------+---------------------------+ |
|  |      Fine-Grained Rendering Pipeline             | |
|  |  template() -> cloneNode -> insert() + effect()  | |
|  |  mapArray() -> LIS-based keyed reconciliation    | |
|  +--------------------------------------------------+ |
|                                                      |
|  +--------------------------------------------------+ |
|  |           Islands Architecture                   | |
|  |  Static HTML + selective hydration               | |
|  |  load . idle . visible . action . media          | |
|  +--------------------------------------------------+ |
|                                                      |
|  +--------------------------------------------------+ |
|  |           MCP DevTools Bridge                    | |
|  |  25 tools: signals, effects, components, DOM,    | |
|  |  cache, errors, dependency graph, diagnostics    | |
|  +--------------------------------------------------+ |
|                                                      |
+------------------------------------------------------+
|  CLI: dev . build . preview . generate               |
+------------------------------------------------------+
```

## Rendering Pipeline

### How JSX Becomes DOM

```
JSX source code
      |
  Babel compiler (babel-plugin.js)
      |
      +--- Static HTML -> template() calls (module-level constants)
      |         |
      |    cloneNode(true) -- zero-cost DOM duplication
      |
      +--- Dynamic expressions -> insert() + effect() calls
      |         |
      |    Each expression gets its own effect bound to one DOM node
      |
      +--- Dynamic props -> spread() / setProp() + effect() calls
                |
           Each reactive prop gets its own micro-effect
```

### Compiler Output Example

Given this JSX:

```jsx
function Counter() {
  const count = useSignal(0);
  return (
    <div class="counter">
      <h1>Counter</h1>
      <p>{count()}</p>
      <button onClick={() => count.set(c => c + 1)}>+1</button>
    </div>
  );
}
```

The compiler produces (simplified):

```js
import { _$template, insert as _$insert } from 'what-framework/render';

// Static HTML extracted to module scope, parsed on first use, cloned per instance
const _tmpl$0 = /* @__PURE__ */ _$template('<div class=counter><h1>Counter</h1><p></p><button>+1');

function Counter() {
  const count = useSignal(0);
  const _el$0 = _tmpl$0();                       // cloneNode -- instant
  const _el$1 = _el$0.firstChild.nextSibling;    // <p>
  const _el$2 = _el$1.nextSibling;               // <button>
  _$insert(_el$1, () => count());                // the <p>'s only child: one textContent write
  _el$2.$$click = () => count.set(c => c + 1);   // delegated event
  return _el$0;                                  // real DOM node, not a vnode
}
```

Key points:

- **Template extraction.** The compiler identifies static HTML subtrees and hoists them into `_$template()` calls at module scope. A template is parsed into a `<template>` element the first time it is cloned (so importing a module touches no DOM and unused markup is never parsed), and every component instance calls `cloneNode(true)` to get its DOM -- no createElement chains, no string parsing per instance. The markup is minified the way the HTML parser allows: simple attribute values unquoted, no space after a quoted value, no closing tags at the end.

- **Namespaces at compile time.** Every JSX element is annotated with the namespace it renders in: under `<svg>` it is SVG, under `<math>` MathML, and the HTML parser's integration points switch back to HTML (the children of SVG `<foreignObject>`, `<desc>` and `<title>`, of an HTML-encoded `<annotation-xml>`, and of the MathML token elements `<mi>`, `<mo>`, `<mn>`, `<ms>`, `<mtext>`). That context crosses into the JSX of dynamic children, which become templates of their own. A template whose root is an SVG or MathML element other than `<svg>`/`<math>` is wrapped in one and flagged, and the runtime clones the wrapper's child; a root with no JSX around it is placed by its tag (`<path>` is SVG, `<a>` is HTML). Because the namespace is known, `class` compiles to a `className` write on HTML elements and to the attribute on SVG ones.

- **Per-binding effects.** Dynamic expressions (`{count()}`) become `insert()` calls. The compiler auto-wraps signal reads into `() => count()`, creating a subscription to exactly that signal. When `count` changes, only this one text node updates.

- **Reads that need no effect.** A child that is an expression with no call in it (`{props.title}`, `{props.item.label}`, `{item.price * item.qty}`) compiles to `_$plain(el, () => props.item.label)`. The runtime reads it once, as the first run of an effect, and what it read decides: nothing reactive (a prop handed a plain value) writes the text and keeps nothing; only the item of a list row being built (a row's component handed the item) makes the text a field of that row, which the row's item cell writes when the row gets another item, as it writes an inline row's `{row.label}`; anything else, or a value that is not text, is the effect any reactive child is, with that read as its first run. A field belongs to its row only when what created it lives exactly as long as the row: the row's own template, or a component with only components between it and the row's scope (reactive.js `_livesWithRow`). Text built by something that can go first (a region of the row that runs again, a row of a list inside the row, a component behind `<Show>`) is an effect, which goes with its owner; a field there would be held and written until the row's next item. The same rule decides whether `_$field` binds an inline row's `{row.label}` that is not in the template the row's callback returns: the compiler marks those (`_$field(el, cell, value, marker, read, 1)`), and a field in the row's own template, which is built with the row, is bound with no check. A component that fails after it bound a field (it suspended, and an outer boundary took it) has that field dropped when its row is built. For each new item of its row a field is read again through one reused tracking node (`_readAlone`), creating nothing: text from the item alone is written, and anything else (it read a signal, it is not text, it threw) is read once more as an effect's first run and becomes the region it then needs. The code for these row fields is installed by `_$rowFields()`, which the compiler writes in the options of a keyed list whose rows can hold one (`fields: _$rowFields()`: the row renders a component, or holds a child that only reads and is more than one field of the item), so a program with no such list does not carry it. An expression with a call in it is never treated this way: the compiler cannot see what a call does.

- **Insert markers only where needed.** A dynamic child is inserted before the next element or text node of the template; a `<!>` comment is written only between two dynamic children or between two text runs (which would otherwise parse as one node); the last child is appended; an element's only child gets no marker, and a text value there is set with a single `textContent` write. Fragments are flattened into the parent's child list.

- **No virtual DOM, no diffing.** The compiler output returns real DOM nodes. There is no VNode creation, no tree diff, no patch phase. Static content has zero runtime overhead after the initial clone.

- **Nesting checked at compile time.** Markup the HTML parser would restructure (a `<div>` in a `<p>`, a row directly in a `<table>`, a link in a link, an element in a `<textarea>`, an HTML element directly in SVG, ...) is a compile error, `ERR_INVALID_HTML_NESTING` at `file:line:column`, in both targets.

- **Hygienic names.** Every name the compiler introduces (`_el$0`, `_tmpl$0`, `_$insert`, the `Island` import, ...) skips the names the file already uses.

The compiler is split into a shared front end and two back ends (`packages/compiler/src/babel/`): `common.js` classifies elements, normalizes attribute names, annotates namespaces and hands out names; `dom.js` is the client back end above; `ssr.js` is the server back end below. Both read the same classification, so server markup and client templates cannot drift.

#### Development metadata

With `devMetadata` (on in the `vite` dev server, never in `vite build`) the compiler passes names and source locations, all in the form `"name@path:line:column"` (path relative to the project root, 1-based column, read in the same pass that lowers the JSX):

```js
_$createComponent(Row, props, children, "Row@src/App.jsx:12:5");
signal(0, "count@src/store.js:3:15");              // What's own signal(), when unnamed
effect(fn, { name: "save@src/store.js:9:1" });     // What's own effect()
_$effect(() => _$setAttr(el, "title", t()), { name: "li.title@src/App.jsx:14:9" });
_$insert(el, () => x(), marker, "li.children@src/App.jsx:15:11");
```

A production build is byte-identical with the option on or off.

#### What is compiled, and which functions are components

The compiler's rewrites are written for an app's source, so two rules keep them there.

**Files.** The Vite plugin compiles the app's own files: a JSX file `include` matches (`.jsx`, `.tsx`), and a script module that declares server actions or, in the dev server, imports `what-framework` or `what-core` (its `signal()` and `h()` calls get development names), unless `exclude` matches it. It never compiles a dependency's: nothing under `node_modules` (an npm or pnpm install), whatever `include` and `exclude` say, and no script file of one of What's own packages wherever it sits (`packages/compiler/src/framework-files.js`). A package is What's own when the nearest `package.json` with a name above the file names one (`what-core`, `what-react`, `what-router`, `what-server` and the rest) and the file is one it publishes (its `files`): this catches a workspace link, which Vite resolves to the package's own directory, outside `node_modules`, where no path pattern can tell it from the app. A JSX file What publishes (`what-devtools/panel`) is compiled for its JSX only. `compileDependencies` opts a dependency's files in, compiled as the app's (the Babel plugin's `appSource`). The Babel plugin applies the same rule to a file it is handed: in a file What publishes it adds no development names and no server action ids, and takes no function without JSX for a component, so the framework's own source comes out of every mode as it went in (`packages/compiler/test/framework-source-untouched.test.js` compiles all of it).

**Functions.** Reading props where they are used (a destructured prop as `props.<key>` at each read, a returned prop placed with `_$place`, a rest element kept live as `_$omit`) changes what a function's parameter reads, so it applies to a component only (common.js `isComponentWithoutJsx`):

- a function that renders JSX (JSX anywhere in its body, nested callbacks included), whatever its name: a component, a `memo()` or `forwardRef()` render function, a render helper;
- a function with no JSX that is named as a component (`function Card`, `const Card = …`, `memo(…)` or `forwardRef(…)` assigned to `Card`, `Tabs.Panel = …`, a default export) and renders as one: it calls What's `h()` (imported from `what-framework` or `what-core`), so `function Box({ as, ...rest }) { return h(as, rest) }` keeps `rest` live, or it returns a prop as it is (`return props.children`, `({ children }) => children`), which is placed where it renders.

Nothing else is: a helper that destructures its argument, capitalised or not (`function Point({ x, y, ...rest })` returning an object), a `forwardRef()` implementation that calls the render function it was given (what-react's `ForwardRefComponent`), a higher-order component that calls the component it wraps, a reducer, a class's method. Those come out as they went in, in `.js`, `.ts` and `.jsx` files alike (`packages/compiler/test/component-rule.test.js`). The other rewrites (signal reads wrapped in bindings, `.map()` lowering, prop aliases, event handlers, spread children) only touch JSX or what a component's JSX reads.

- **Event delegation.** Event handlers are stored as `el.$$eventName` properties. A single document-level listener per event type (registered lazily, the first time an element needs it) walks the event's composed path and calls the handlers on it, innermost first. `e.target` reads at each handler as the native target would there: the inner node inside an open shadow tree, the host once the event leaves the shadow tree that node lives in, and the slotted node itself for a light-DOM child slotted into a shadow host. A disabled element's handler is skipped. A shadow root or an element passed to `delegateEvents(names, root)` delegates for its own subtree, its own handler included, and the document's listener does not run those handlers again. `currentTarget` and `target` are handed back after the walk, also when a handler throws. A handler belongs to the owner it was set under (the element is marked with it): once that owner is disposed the handler never runs again and is dropped the first time an event reaches it, also on an element that outlived the owner (one the next `hydrate()` of the same container claims, one the app keeps and inserts again). A listener the compiler adds for an event that is not delegated is removed with its owner.

- **Compiled-only runtime.** Compiled output imports `what-framework/render`, which never reaches the vnode renderer (`createDOM`: elements from vnodes, `<ErrorBoundary>`/`<Suspense>`/`<Portal>`). Vnodes are handed to a renderer held in an import-free slot (`vnode-renderer.js`) that `h.js` fills when imported, and every vnode producer (`h()`, the JSX runtime, the boundaries, `lazy`, `_$Island`) imports `h.js`. A compiled-only app therefore bundles none of it; an app that uses a boundary or `h()` gets it back automatically. The vnode of a `<Suspense>`, an `<ErrorBoundary>` or a `<Portal>` carries its own client renderer (`mount`), so an `h()` app that never uses one does not carry that either. A class component is not a vnode: the small bridge that runs it lives in `render.js` (`_toFunctionComponent`, which every path that runs a component it is handed asks: compiled JSX, the vnode renderer, hydration, `memo()` and an `<ErrorBoundary>`'s fallback), so a compiled-only bundle renders one under every bundler. Every vnode carries the renderer of the copy of what-core that made it (`_$r`, set where `h.js` installs the renderer), so a copy with no renderer of its own (an app whose JSX is all compiled, rendering a library bundled with its own what-core) renders another copy's vnode with that copy's renderer; a vnode-shaped value that reaches a copy with neither throws `ERR_NO_VNODE_RENDERER` in development, and the message says what to import. A compiled module imports the smallest helper its JSX needs, chosen per module as `_$mapKeyed` is chosen over `mapArray`: the component call with no lazy children (`_$createLeaf`) when no component of the module is handed children or JSX in a prop, and without the class bridge and the rendering of a tag held in a binding (`_$createFn`, `_$createLazyFn` with lazy children, `_$hcreateFn` hydrating) when every component is a function the module defines and uses only in JSX, or one of what-framework's or its router's; the reactive region alone (`_$reactive`) when every hole holds a function written in it. Any other component call runs its tag as a component (render.js `asComponent`): a class through its bridge, a string as the element it names (`const Tag = props.as; <Tag {...rest} />`, as React renders it: its props spread on it, its children the props' children), and a tag in a constant (`const Tag = 'select'`) is compiled as the element itself. Such an element is created in the namespace of where it stands (render.js `tagElement`): a name only SVG or only MathML has by its name, as a template root is placed; a name SVG shares with HTML (`a`, `title`, `script`, `style`) by the namespace of the place a component is called in, which the compiler passes to a call in SVG or MathML, or in HTML inside one, whose component can build such a tag (`_$inNs(ns, () => call)`, an owner carrying the namespace for what the component builds, then and in later runs of its regions; dom.js `mayBuildTag` leaves out a component the module defines whose JSX names none). In hydratable output it claims the server's element where the walk stands (render.js `claimedTag`, through `_$hcreateComponent`), as compiled `<a {...props}>{props.children}</a>` claims its own. An element with a spread and no children written in JSX is given the spread's children (common.js `spreadChildren`: `{_$place(src, "children")}`, the server's `src.children`), and the setters never write `children` as an attribute. The code that keeps a `<select>` and its `<option>`s in step with their props is installed (dom.js `_installSelects`) by a compiled module whose JSX writes one (`_$selects()` at module scope), by the vnode renderer and hydration, and by `spread()`, `setProp()` and `setValue()` written by hand; compiled output calls those setters as `_$spread`, `_$setProp` and `_$setValue`, which do not bring it. A select whose value it wrote carries it (`_$select`), so whatever puts the select back (a controlled field after its events, `_resetForm`) needs none of its own: a page can hold two copies of what-core, and the first to bind a field listens for the window and puts back the other copy's fields too. The same goes for a list or region that changes the options under a select: until a copy installs its select code, what it calls when it changes the children of a parent (render.js `optionsChanged`) calls the code the parent, or the parent's parent, carries, so the options one copy renders into the other copy's controlled select are selected as its value says. A copy with no select pays a function call and two property reads per list or region change for it, and no null checks.

- **Compiler and runtime move together.** The runtime takes the compiler's output protocol as given rather than second-guessing it: `_$template(html, 2)` marks a template whose SVG or MathML root the compiler wrapped, and a template without the flag parses as HTML. what-compiler requires the what-core of its own minor version, so an installed pair always agrees; output from an older compiler that reaches a newer runtime anyway (a library shipping precompiled code) throws `ERR_TEMPLATE_NAMESPACE` in development at its first SVG or MathML root.

### List Reconciliation (mapArray)

Lists are the one place where reconciliation is needed. `mapArray` provides keyed list rendering with LIS (Longest Increasing Subsequence) optimization; a `.map()` with a `key` prop compiles to it, and `<For each={items}>` (the accessor) uses it too:

```jsx
import { signal, For } from 'what-framework';

const items = signal([{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);

function Lists() {
  return (
    <>
      <ul>{items().map(item => <li key={item.id}>{item.name}</li>)}</ul>
      <ul>
        <For each={items} key={item => item.id}>
          {(item, index) => <li>{() => item().name}</li>}
        </For>
      </ul>
    </>
  );
}
```

The reconciler:
1. Skips common prefix/suffix (items that haven't moved)
2. Detects a swap or a single moved row and moves just those
3. Builds a key map for the middle section
4. Computes the LIS of old indices to find the maximum set of items that don't need to move
5. Only moves items not in the LIS; creates/destroys items as needed
6. Each list item gets its own lightweight scope, and a removed row is disposed through it

This runs in O(n log n) time for the general case, with O(n) fast paths for append, prepend, clear, replace-all and identity (no change).

Keyed and unkeyed lists share the reconciler and the row representation: an unkeyed list keys each row by its item. A key may repeat (an unkeyed list of plain values often repeats them): every occurrence gets a row of its own, and from one update to the next the rows of a repeated key are matched in order of appearance, so no row is ever orphaned. Only when the key map comes out shorter than the range does the reconciler chain the occurrences, so unique keys pay nothing for this. A keyed list whose items repeat a key reports `ERR_DUPLICATE_KEY` in development, with the list's source location when the compiler passes `loc`, because rows that share a key are told apart only by order and a reorder can hand one item another's DOM and state.

A row that renders a single element or text node is its own boundary, and so is a row that is a component returning one element (`<Row key={item.id} item={item} />`); any other row (a fragment, an array, a component that returns more or less than one element) is preceded by a `<!--i-->` comment. Removing a row disposes its scope, which owns its bindings, its components, any list nested in it, its reactive regions and what they render, and any portal in it (a portal removes its nodes from their container when its owner is disposed), so removing a row never walks its DOM. Clearing a list, or replacing every row, disposes the scopes and then drops all row nodes at once: one `textContent = ''` when the list is all its parent holds, a `Range` otherwise. Rows are built straight into the live parent.

The compiler lowers `items().map(item => <li key={item.id}>…</li>)` to a keyed list, imported as the keyed-only entry (`_$mapKeyed`) by a module whose lists are all of that kind. Inside such a row, `selected() === item.id` in a render binding is rewritten to a `createSelector` lookup, so changing the selection re-runs two rows' bindings instead of every row's. The row reads its item through a cell (`_$item(cell)`); a read of one field names it (`_$item(cell, "name").name`), and a `live()` view's property read names its key (reactive.js `_readKey`). A row that is a component is handed the item as a live prop (`get item() { return _$item(cell); }`), and the plain reads of it in the component's JSX are fields of the row (`_$plain`, above). A read the row's building code makes (not a binding's) records the field, or the whole item when none is named, and a replaced item rebuilds the row only when a recorded field holds another value (`_setRowItem`); otherwise the row is kept and its bindings follow the new item.

On the `h()` path the same holds for a reactive child that returns an array of keyed vnodes (`() => items().map(item => h(Row, { key: item.id, item }))`, and the runtime `<For>`, which keys rows by `id`, `key` or a primitive item): the region keeps one row per key across runs, built by the same reconciler, so a key that persists keeps its nodes and its component. As in a compiled keyed list, a kept row is not rebuilt from its new vnode; data that changes under a persisting key belongs in a signal the row reads. An array that is not all keyed vnodes is rebuilt on every run, as before.

## Signal System

### Primitives

```
signal(initialValue)
  +-- Read:  sig() -- returns value, auto-tracks in the running effect/computed
  +-- Write: sig(value), sig.set(value) or sig.set(prev => next); no-op if Object.is equal
  +-- Peek:  sig.peek() -- read without tracking
  +-- Subscribe: sig.subscribe(fn) -- shorthand for effect(() => fn(sig()))

computed(fn)
  +-- Lazy: recomputes only when read after a dependency changed
  +-- Fresh: a read right after a write sees the new value
  +-- Equality cut-off: recomputing to the same value (Object.is) notifies no one
  +-- Errors: a throw is cached and rethrown to every reader until an input changes
  +-- Released when unobserved: drops its own dependencies when the last reader goes

memo(fn)            (what-framework/render; the root entry's memo() is a component wrapper)
  +-- A computed evaluated once at creation

effect(fn, { stable?, phase? })
  +-- Runs immediately on creation, tracking what fn() reads
  +-- Re-runs (on a microtask, at batch() end or in flushSync()) when an input changed
  +-- Cleanup: if fn() returns a function, it runs before each re-run and on dispose
  +-- Dispose: returns a function that unsubscribes and runs the final cleanup
  +-- phase: 'user' re-runs after every render-phase effect of the flush
```

### Graph representation

Every node is a small fixed-shape object; a signal's function, a computed's reader and an effect's dispose function close over it. Dependency edges are `Link` records in two doubly linked lists at once: the subscriber's dependencies and the dependency's subscribers. A node that re-runs and reads the same dependencies in the same order reuses its links, so a stable update allocates nothing; dependencies a run no longer reads are unlinked when it ends.

### Propagation: push marks, pull values

```
signal D
  +-- computed B
  +-- computed C
       +-- effect A -- reads B() and C()

D.set(...):
  push  B and C become DIRTY (direct subscribers); A becomes PENDING and is queued.
        Each node is visited at most once per write.
  flush A is PENDING: check its inputs depth-first. B and C recompute.
        If either changed value, A runs, seeing both new values. If neither
        did (the equality cut-off), A does not run.
```

There is no level sort. Consistency comes from the pull: an effect, or a computed being read, verifies its inputs (iteratively, without recursion) before it runs, so it never sees half-updated state. Effects are queued render phase first, then user phase; within a queue a parent effect (the effect that was running when another was created) always precedes its children, otherwise notification order applies. `useEffect` and `onMount` keep React's order: a component's first runs are held until its output is built (children first), and a user round with re-runs runs every cleanup, then every run, children first (reactive.js _holdUser, orderUserRound). The microtask flush, `batch()` and `flushSync()` all drain the same queues, at most 100 rounds per flush. See [EFFECT-TIMING.md](./EFFECT-TIMING.md). The pull phase, and the release of computeds nothing observes, are installed by the first computed or selector: an app of signals and effects alone does not ship them.

### Bounded-stack evaluation

Updates never recurse: the dependency check is iterative. Only the first evaluation of a chain recurses, through user code (a computed reading a never-evaluated computed). Past 1,000 nested evaluations a read is deferred: the frames above it are abandoned and stay stale, and the outermost read evaluates the deferred nodes deepest-first. A frame detects the deferral itself, so a user `try/catch` around the read cannot swallow it. Chains of 100,000+ computeds evaluate without stack overflow.

## Ownership and Disposal

Every piece of reactive work has an owner that disposes it: effects, computeds, roots, components and `onCleanup` callbacks register with the owner that is current when they are created. Disposing an owner disposes its child owners first, newest first, then its own registrations in reverse order; a cleanup that throws does not stop the others. The cleanups of `useEffect` and `onMount` effects come before all of that, in React's order: the owner's own, in the order they were made, then those of the owners linked below it, first to last (reactive.js userCleanups).

### Owners

- **Roots.** `createRoot(fn)` makes an owner and hands `fn` its disposer. A root created under another owner joins that owner's child list (an intrusive sibling list, so leaving it is O(1)) and is disposed with it; disposing a root rethrows the first cleanup error after running all of them. A root whose function throws is disposed before the error propagates.
- **Effects and computeds.** An effect owns what its run creates: effects, computeds, roots, components and cleanups created while it runs are disposed before its next run and when it is disposed. A computed owns what its evaluation creates the same way. The owner record of a run is made the first time the run creates something, and the run itself is found from what the engine already tracks (the node whose reads it records, or the effect executing), so an effect or computed that creates nothing pays one null field and one null check per run. `getOwner()` inside a run returns that run's record: work attached to it later with `runWithOwner` goes with that run, and work attached to a run that has already been superseded is disposed at once.
- **Components.** Creating a component creates an owner under the current one. The component's body and its output are built under it, untracked, so its hooks (`hooks`, `hookIndex`), its context values (`context`), and every effect, binding and nested component it creates belong to it; whoever disposes the owner it was created under (a region's run, a list row, a boundary's arm, a mount root) disposes all of it. Hooks resolve through the owner tree: the component a hook belongs to is the nearest component owner above the current owner, and `useContext` walks owners up to the nearest provider, so context resolves the same way in a body, in a region or effect that re-runs long after it, in a list row and through a portal.
- **List rows.** A row is an item scope: an owner the list reconciler disposes when the row's key goes (and the list's cleanup disposes with the list), not linked into the list's owner, because a row outlives the run of the list's effect that built it. It still points at its parent, so errors and context lookups go up the tree.
- **Mount and hydrate roots.** `mount()` and `hydrate()` build in a root of their own, recorded on the container: mounting or hydrating into a container that holds a root disposes that root first, and the function `mount()` and `hydrate()` return disposes it. Compiled `mount(<App />, el)` builds `App` before `mount()` makes its root; a component built under no owner marks its start comment, and the root adopts it.

What is created with no owner current (at module scope, or after an `await`) belongs to no owner and lives until it is disposed explicitly; a computed lets go of its dependencies when nothing observes it. To attach work after an `await` to the owner that started it, read `getOwner()` before the `await` and create the work inside `runWithOwner(owner, ...)`. In development, an effect created after the `await` of an async `onMount` or `useEffect` callback, under no owner, is reported (`ERR_ORPHAN_EFFECT`) with the component it was obviously meant for. On the server, each render owns a root: component frames are owners under it, so what a render's components create is released with the render; with an async context provider installed, what an async server component creates after an `await` goes to its own render's root too, so nothing a finished request created can run later.

A region (a function child, a `<Show>` arm) is an effect, so what it renders belongs to the run that rendered it and goes when the region renders something else. A keyed vnode list in a region keeps its rows across runs: each row is a root under the owner the region was created under, disposed when its key goes. Nothing walks the DOM to find reactive work: removing nodes only removes them.

### Errors and boundaries

An owner can carry handlers. `_onError` receives errors: an error thrown by an effect's re-run or cleanup, by a binding (a computed read in one included), by a list row's effects, by a component created later, or by a component's body or output while it is built, goes to the nearest live owner above it that has an `_onError` handler; a handler that throws passes its error further up. With no handler the error is logged with `console.error` and the flush goes on: nothing halts. An error thrown by the first run of an effect created outside any component propagates out of `effect()`. Every thrown error reaches the devtools `onError` hook once.

`<ErrorBoundary>` installs its handler on the root its children are built in. When it catches, it disposes that root and shows its fallback, built under the boundary's owner, so an error in the fallback goes to the boundary above. `reset()` disposes the fallback and builds the children again. `<Suspense>` installs `_onPending` the same way: a thenable a component throws while it is built (`lazy()` before its chunk lands, a resource) goes to the nearest `_onPending` above it, and so does a binding or effect held on an async value that has not landed, which the boundary counts until a run of it completes (docs/ASYNC.md).

### Development and production tiers

`__DEV__` is the only switch. Each export of what-core, what-router and what-server names three files for it, by condition:

- `production`: `dist/*.min.js`, where it is the literal `false`, so devtools hooks, dev warnings and the devtools pre-install buffer are removed from the bundle. what-compiler/vite, webpack 5, Rollup's node-resolve (its default with `NODE_ENV` unset or `production`) and `node --conditions=production` select it; any non-development `vite build` through `what-compiler/vite` also folds it in the source.
- `module`: `dist/*.js`, where each use reads `(process.env.NODE_ENV !== "production")` in place. A bundler that names neither `development` nor `production` selects it: esbuild and rolldown with their default conditions, `bun build --production`. Each defines `process.env.NODE_ENV` itself: `"production"` when it minifies (Bun: with `--production`), `"development"` otherwise. So an unminified esbuild or rolldown build with no `NODE_ENV` of its own is a development build, diagnostics included, and a production build must minify or define `process.env.NODE_ENV` as `"production"`. Node, Vite, webpack, Rollup with node-resolve and the buildless template's import map never select `module`.
- `development`, `node`, `import`, `default`: `src/`, for dev servers, Node, server bundles and tests. `node` comes before `module`, so a server bundle (esbuild for Node, `bun build --target=bun`) resolves the source exactly as Node does.

The source reads the flag through what-core's `#env` import (package.json `imports`), which follows the same conditions:

- `development`: `src/env-development.js`, `true`. Vite's dev server, webpack's development mode, Rollup with node-resolve and `NODE_ENV=development`, and `bun build` without `--production` resolve it, so their development builds report diagnostics wherever they run, with or without a `process` in the page. `bun build --minify` alone is such a build: a production Bun build passes `--production` (or `--define process.env.NODE_ENV='"production"'`). `node --conditions=development` is one too, whatever `NODE_ENV` says.
- `default`: `src/env.js`, resolved at runtime: `globalThis.__WHAT_DEV__` set before load forces either tier, else Vite's `import.meta.env.DEV`, else a server runtime's `process.env.NODE_ENV` (a `process` whose `versions.node` is a string: page markup can name a global `process`, but never make that a string), else production.

A buildless page that maps the framework's source through an import map maps `#env` in what-core's scope (create-what's full-stack template does). A tool that resolves `node` for a bundle served to a browser (esbuild `--platform=node`) gets `src/` with the runtime flag, which a browser answers with production; give such a build `--conditions=development` or `--conditions=production`.

Every dist file is one source module's output and imports its siblings, in both tiers (`scripts/build.js`): two exports that reach a module share its state (what-server's action registry, what-core's component stack and tracking context), and an app bundled from dist/ tree-shakes as it does from src/. A process can still load two tiers, or a tier and the source: a component bundled for the browser that the production server renders. The state that is the process's is kept once for every tier, under `Symbol.for` keys on `globalThis`: the render context (so that component's `getResponse()` and loader data are the render's), the async context provider and the server-process mark, the server action registry, the devtools hooks, and the page's streamed-boundary hook, which resumes the boundaries of each tier. The signal graph and the caches stay a tier's own: a signal of one tier read in an effect of another is not tracked, so an app's client code comes from one tier. `scripts/check-size.mjs` fails if a production bundle contains development-only code, including a counter built with esbuild's defaults (`--bundle --minify`, nothing else).

### Component Lifecycle

A component runs once, under an owner of its own (see Ownership above) that holds:
- `Component` -- the component function
- `hooks`, `hookIndex` -- persisted hook state (signals, refs, etc.), allocated on the first hook
- `context` -- the context values it provides
- in development, `devLoc` (the compiler's `"Name@src/File.jsx:12:5"`), `_parentCtx` (the nearest component above) and `_wrapper` (its start comment), which devtools read

A component receives its props as a plain object, as React's are: Object.prototype is its prototype, so `props.hasOwnProperty(k)`, `String(props)` and lodash's `isPlainObject(props)` work, and so do a rest element of them (`_$omit`) and a spread's merge (`_$merge`). A props object that holds a getter (a live prop, or the lazy getter of children or of JSX passed in a prop) is marked as What's by a property no listing shows (`Symbol.for('what-core.props.v1')`, not enumerable; dom.js _markProps), which keeps its getters live through every copy and merge. One that holds none is not marked: a copy of it is the same either way. Compiled JSX passes a component its live props in a literal of its own, marked as it is built (`_$marked({ get on() { … } })`, the mark not enumerable), which the component gets as it is. The runtime also takes a literal marked with a key of its own (`{ [_$props]: true, … }`, the mark hidden when the component gets it) and one with no prototype (`{ __proto__: null, … }`, given Object.prototype in place, which V8 serves more slowly: each such object gets a hidden class of its own). An object with no prototype counts as What's in every copy and merge, as a live() view does. Copies take own keys only and define a key named `__proto__` as a property, so no copy sets a prototype from user data, and an element is never written a `__proto__`. In development the props are frozen, so a write throws. A component that returns one element is that element in the DOM: nothing is added around it, so a component call costs no node. Any other output (a fragment, text, an array, a reactive child, nothing, or what a component built from vnodes returns) is bracketed by `<!--c:start-->` and `<!--c:end-->` comments, and so is a component that threw or suspended. Nothing reads the comments to find a component: the owner tree disposes it, and in development the node that opens its output (the element, or the start comment) answers `__ownerOf`. Disposing its owner (when the owner it was created under is disposed) runs its cleanups and disposes every effect, binding and component it created. `useEffect` and `onMount` are user-phase effects of the component: their first run waits for the flush after the component is built and comes after that flush's render-phase effects (the DOM bindings), so they see settled DOM, and after its children's, as in React (docs/EFFECT-TIMING.md).

In development the engine exposes the owner tree to tools (`what-core/internal`): `__ownerOf(node)` is the owner of an effect, a computed, an owner, or a DOM node (the component whose output holds it), and `__ownerPath(x)` names the scopes holding `x`, root first (`['<App>', '<TodoRow>', 'effect "sync"']`), with the innermost source location the compiler supplied as `loc`. Every coded diagnostic's `owner` and `loc` come from it unless the call site passes its own.

## SSR and Hydration

### Server Rendering

`renderToString` and `renderToHydratableString` produce HTML on the server:

```js
import { renderToHydratableString } from 'what-server';

const html = renderToHydratableString(<App />);
// <main data-hk="0"><h1>Hi <!--$-->1<!--/$--></h1>
//   <ul><!--$--><!--[]--><li data-hk="00">a</li><li data-hk="01">b</li><!--/[]--><!--/$--></ul>
//   <!--b!--><i>oops</i><!--/b--></main>
```

`renderToString` writes plain HTML. Every other renderer (`renderToHydratableString`,
`renderToStream`, `renderToStringAsync`, `renderDocument`,
`renderDocumentStream`), from `h()` and from compiled server output alike,
writes the same **hydration protocol**, which `hydrate()` reads:

| Markup | Written for |
|---|---|
| `data-hk="<owner path>"` | the first element of a component's output, when its output starts with an element; when components nest so that several start on the same element, the innermost one's |
| `<!--$-->…<!--/$-->` | a reactive child (`() => count()`, compiled `{count()}`) |
| `<!--[]-->…<!--/[]-->` | an array child (a `.map()`, `<For>`) |
| `<!--b-->…<!--/b-->` | a `<Suspense>` or `<ErrorBoundary>` that rendered its children |
| `<!--b!-->…<!--/b-->` | one that rendered its fallback |
| `<!--b--><template id="pl-ID"></template>…<!--pl-ID--><!--/b-->` | a boundary still streaming: its fallback between the placeholder and its end comment (see Streaming) |

The owner path is the one the data channel already names components by (see
Hydration data): the server and the client assign the same path to the same
component, so the key needs no counter of its own.

The `<App />` above can come from any JSX toolchain: `h()` by hand, the
automatic JSX runtime (`jsxImportSource: "what-framework"`), or
**what-compiler's server target**, which the Vite plugin uses for every module it
transforms for the server.

#### Compiled server output (`generate: "ssr"`)

The server back end lowers each element template to static strings, escaped and
validated at build time, and one call made where the JSX expression runs, as
the `h()` call it stands for would be. Event handlers and refs are dropped at
compile time; the runtime is `what-server/ssr-runtime`, imported through
`what-framework/ssr-runtime`:

```js
// <div class="card" id={props.id} title={t()} onClick={go}>Hello {name}!{count()}</div>
const _tmpl$0 = _$ssrTemplate(['<div class="card"', '', '>Hello ', '!', '</div>'],
  [['plain', 'id'], ['plain', 'title'], null, null]);
_$ssr(_tmpl$0, props.id, () => t(), _$ssrText(name), () => count());
```

- Every hole is what `h()` would be handed in its place, evaluated in source
  order: a value written as itself (`{label}`, `id={props.id}`, a non-reactive
  expression) is read when the JSX expression runs; a reactive expression
  (`{count()}`, `title={t()}`) is the thunk `h()` gets from the auto-thunk,
  rendered where the markup is placed; a component, a fragment, `<Show>`,
  `<Switch>` and `<For>` are the vnode or the reactive child they are with
  `h()` and the DOM back end, but a fragment among an element's children is
  those children in its place, as the DOM back end lays the element out, and a
  keyed `.map()` is bracketed as the array the DOM back end's keyed list
  hydrates, wherever it stands. JSX built in a loop, from a variable written again
  later, or inside a `try`, therefore means what it means on the client.
- The result is compiled **Markup**: finished HTML, or HTML with the thunks,
  vnodes and reactive attributes between it, which the renderer that places it
  renders in document order with `h()`'s rules for each (a reactive child that
  throws renders an empty region, one that suspends is retried on its own, an
  attribute whose thunk throws is dropped, a component renders in the frame
  that places it). The compiled output is byte-identical to the `h()`-rendered
  output for the same tree, side effects in the same order, in every renderer
  (`packages/compiler/test/lowering-parity-fuzz.test.js`). Rows of a `.map()`
  are written straight into the list's markup (`_$ssrRow`).
- **Trust:** a string is always text. HTML travels only as Markup, recognised by
  a private class field (`packages/server/src/compiled.js`) that JSON,
  `structuredClone`, store proxies and catch-all `Proxy` objects cannot carry;
  a second copy of the runtime in the same process registers its brand check in
  one process-wide set. A vnode is branded the same way: an instance of
  what-core's `VNode` class (`packages/core/src/vnode-renderer.js`), made only by
  `h()`, the JSX runtime and the boundaries, and every renderer, on the server
  and the client, asks the brand before it treats an object as an element, so
  `{ "tag": "div", "props": { "dangerouslySetInnerHTML": … } }` arriving from an
  API renders as the text `[object Object]`. A row a `.map()` or `<For>`
  callback returns, a child or a component result that is a string is escaped. The stream's own work items
  are instances of a private class, so a value cannot pose as one.
- **Security:** the rules exist once, in what-core's markup rules
  (`what-core/internal/markup-rules`), which the compiler, the server runtime,
  the `h()` renderers and the client all apply
  (`packages/server/test/markup-rules-parity.test.js`). Static values the
  rules refuse are compile errors on both targets (`ERR_UNSAFE_STATIC_MARKUP`:
  `javascript:`/`vbscript:`/`data:` URLs, `srcdoc`, `outerHTML`, a string
  `innerHTML`, `<script>`/`<style>` text that could end the element); dynamic
  values are escaped and URL-checked at run time, spreads and `classList` go
  through `renderAttrs`, `innerHTML` requires `{ __html }`, and a tag computed at
  run time is a vnode the renderer checks. JSX as an island prop is refused
  (`ERR_JSX_ISLAND_PROP`): island props are serialized to JSON.
- **Raw text:** `<script>` and `<style>` hold raw text in HTML, so every server
  path writes their text unescaped, with `</` (and `<!--` in a script) encoded
  the way CSS, JavaScript and JSON read as the same text. In SVG or MathML they
  are ordinary elements whose text is escaped; the renderers track the
  namespace for this.
- **Hydration keys** (`data-hk`) are placed as the output is written: a
  component's key is pending until the next write, which either is the opening
  tag of an element (the key goes into it) or anything else (the key is
  dropped), so placing it costs the length of the first tag rather than a scan
  and copy of the whole output at every nesting level.

With `ssr: false` on the Vite plugin, server transforms are compiled as client
output, and one that would build DOM is refused at build time with
`ERR_COMPILED_JSX_IN_SSR`; what-server raises the same code if client output
reaches a renderer in a process that has a DOM.

### Streaming

`renderToStream` (and `renderDocumentStream`, which the deploy adapters use for
`mode: 'server'` routes) sends the shell first and every waiting `<Suspense>`
later, out of order:

```html
<!-- chunk 1: the shell, with the fallback in place -->
<main>...<!--b--><template id="pl-wb3k9x2f1-0"></template><p>Loading...</p><!--pl-wb3k9x2f1-0--><!--/b--><footer>...</footer></main>
<!-- chunk 2: when the boundary's data is ready -->
<script type="application/json" data-what-data>{"resources":{"rows":[...]}}</script>
<template id="wb3k9x2f1-0"><table>...</table></template>
<script>_$W.s("wb3k9x2f1-0")</script>
```

The renderer is an explicit work stack with one buffer per segment (the shell,
or one boundary), so a segment is one chunk. A component frame is an owner
under the render's root, current only for the synchronous call that needs it,
so concurrent requests never see each other's context. The response (status, headers,
redirect) is committed with the shell. With `noScripts`, the swap scripts are
left out and the client entry calls `applyStreamedBoundaries()`.

Boundary ids carry a random part that is new for every stream, and the swap
finds the content as the `<template>` before its script and the placeholder as
a `<template>` with that id, so page markup cannot name or hijack a boundary.
The swap replaces the placeholder, the fallback and the end comment with the
content, leaving `<!--b-->content<!--/b-->`, the markup a buffered render
writes. A boundary the server could not render sends its `failed` record and
`_$W.s(id, 1)`, which removes the placeholder and its end comment and turns
`<!--b-->` into `<!--b!-->`: the fallback stands alone, hydrates as a
server-rendered fallback, and the client renders the boundary. Either way the
swap then calls `_$W.h(id)`, which a page that has already hydrated installs
(below), so a boundary that arrives after `hydrate()` is hydrated in place.
`applyStreamedBoundaries()` (the `noScripts` form) does the same.
`<Head>` tags set inside a boundary after the shell travel with it
(`_$W.t(...)`, or a `head` entry with `noScripts`).

The same engine renders the buffered forms (`renderToStringAsync`,
`renderDocument`): nothing is written while it runs, and once every boundary
has settled the segments are stitched back together, so a buffered page is the
streamed page after its swaps.

Every render owns a reactive root and an AbortController (`createRenderContext`
in what-server's context.js). Each synchronous slice runs under the root, so
the effects and computeds a component body creates are disposed when the
render ends; the controller follows the caller's signal, is aborted when the
consumer stops reading, and its listener on the caller's signal is removed when
the render ends.

### Hydration data

Everything the server rendered with reaches the client through one channel:
`<script id="__what_data" type="application/json">` on a buffered page or in a
stream's shell, plus one `<script type="application/json" data-what-data>` per
streamed boundary. Each carries `loaderData`, `resources` (keyed resources),
`owned` (keyless resources, named by their component's owner path),
`errors`/`ownedErrors` (failed resources; the error's message only when
`NODE_ENV` is exactly `development`, a `code` only when it is a framework
`ERR_*` code), `owners` (the component name behind each owned owner path),
`failed` (boundaries the server could not finish), `head` (late head tags, with
`noScripts`) and `islandStores`. The client reads only
`<script type="application/json">` elements, so page markup carrying the id or
the attribute is ignored, and reads them all as one payload, so
`createResource` adopts the server's value instead of fetching again.

A keyless resource or async computed is adopted by key: while hydrating, every
component owner gets the same owner path the server gave its frame
(`_assignHydrationOwnerPath`, called where the client creates a component), and
the value looks up its own owner key. A component whose output starts with an
element the server keyed takes its path from that `data-hk` (the step of it
right after its parent's path), so it finds its own values wherever the trees
diverged before it: a branch only one side rendered, the children a boundary
tried before its fallback, a streamed fallback. A component with no key in
front of it is numbered in order, but only while the walk has matched the
server's structure; after a structural mismatch, or where the server rendered
nothing at all, it is numbered under a prefix no server key has, and fetches.
The built-ins what-compiler lowers away (`<Show>`, `<For>`, `<Switch>`,
`<Match>`, and `<>`, which it renders as an array or its element's own
children) take no step when they run as components, so a subtree has the same
paths compiled and through h(). In development a value is adopted only when the
server's component at that path has the same name, and otherwise the resource
fetches and reports `ERR_HYDRATION_OWNER_MISMATCH`; a production build, whose
bundle renames every function, adopts by the path alone. Each `hydrate()` call
counts from its container's anchor again, and a boundary that resumes later
counts on the call it belongs to. A root counts from the server's root when its
container holds the page's data element, or from the path in its
`data-what-owner` attribute (an island); any other second root fetches.

### Client Hydration

```js
import { hydrate } from 'what-framework';

// The full-page document what-server renders puts the route under <body>.
const unmount = hydrate(<App />, document.body, {
  onHydrationError: (mismatch) => reportToMonitoring(mismatch), // optional, every build
});
```

A page that writes its own wrapper (`<div id="app">`) hydrates that element.
No element at all (`null`, or a selector that matches nothing) throws
`ERR_MOUNT_TARGET_MISSING`, as `mount()` does.

`hydrate()` adopts the server's DOM as the DOM of the tree. One walk over the
container's nodes, in document order, claims each node the tree renders (an
element of the same tag, the same text), attaches the bindings to it, and adds
no node where the markup matches. The walk runs in a `batch()`, under a root
recorded on the container as `mount()`'s is: the returned function unmounts it
(disposing every owner and effect and emptying the container), and hydrating
or mounting into a container that holds a root disposes that root first.

- **Elements and text** are claimed at the cursor. The region and array
  markers are transparent to a claim, and a text claim reads across what the
  HTML parser merged: `Hello {name}!` arrives as one text node, and each part
  claims its share of it, so merged text is never a mismatch.
- **A reactive child** claims what lies between its `<!--$-->` and `<!--/$-->`
  and keeps the markers as its range. Its function runs once: the region's
  effect adopts on its first run instead of rendering again. Markup without
  markers (`renderToString`, hand-written) is adopted too, the region making
  its two markers around what it claimed.
- **A keyed list** (`<For>`, a keyed `.map()` or `?.map()` of vnodes or
  compiled rows, a nested one in a row included) adopts each row's server
  nodes as that row, so the first reorder moves the server's nodes rather than
  rebuilding them. The server writes a random salt for the render and a digest
  of each row's key under it after the list's opening marker
  (`<!--k:SALT:DIGESTS-->`: each digest a 64-bit HalfSipHash-2-4 of the salt,
  the key's type and its value, eleven characters), so the page carries no key
  itself, no digest can be computed before the render, and two keys share one
  by accident with odds of 2^-64. A digest can still confirm a key someone
  guesses against the page's salt: a key with little entropy (a small integer
  id, an e-mail address from a directory) can be enumerated page by page, so a
  key is not a secret. A server row is adopted only as the row of the key
  whose digest is its own: rows the client
  has in another order are adopted by key and moved into the client's order
  (reported as kind `key`, recovery `move`), and when a server row's key is
  not among the client's, no server row is taken and the client builds the
  list (recovery `client-render`). Keys are strings and finite numbers; a list
  with any other key (NaN, an object, a boolean, null) writes `<!--k!-->`, and
  the client builds it and reports it, as it does when two different keys of
  its own share a digest. What was typed into a row before hydration stays
  with that row's key. A compiled row's callback is given its client index, and
  a text the client renders differently (the index of a row that moved) takes
  exactly its own share of the server's text: the text after it, which the
  parser merged with it, is still claimed by what follows. A compiled row of several nodes
  starts at the array marker the server bracketed it with, and a compiled
  `<For fallback>` adopts its rows, or its fallback, whichever the server
  rendered. A compiled keyed row's plain field of its item (`{row.label}`) is a
  text node of its own that the row's item cell rewrites when the row gets a
  new item: no effect, region or marker per field; the server writes it as
  plain text and the walk claims that text node.
- **An array** a component or a reactive child returned is walked between
  its markers, so what follows it (a boundary, a region) starts after the
  closing one. A component given one child gets the child itself on both
  sides, so a component that returns its children (a context provider, as
  `<Form>` renders) writes no array markers around one.
- **A component** gets the owner path the server gave it, as the data channel
  needs (Hydration data). A `data-hk` on its first element is checked against
  that path (a key that cannot be the component's is reported as kind `key`
  with recovery `none`: the markup itself matched) and removed. Children a
  component renders elsewhere (`<Portal>`, an island's slot) are built, or
  hydrated, where they render, never where the component stands.
- **Text-only elements.** `<textarea>` and `<title>` hold text the parser
  decodes (a comment there is text), so the server writes their children with
  no markers and the walk claims that text as one text node. The parser drops a
  newline right after `<pre>`, `<textarea>` and `<listing>`, so the server
  writes one there and content that begins with a newline keeps it.
- **`<Suspense>` and `<ErrorBoundary>`** read their marker: `<!--b-->` adopts
  the children; `<!--b!-->` renders the children on the client and keeps the
  server's fallback only if they throw or suspend there too; a streaming
  placeholder adopts the fallback now and the children when the content
  arrives (`_resumeBoundary`, which `_$W.h(id)` calls), reporting to the same
  `onHydrationError`; unmounting before then drops the wait. A component that
  suspends while its server content is adopted (a `lazy()` chunk not loaded
  yet) leaves that content up, untouched, and the boundary walks it again once
  the chunk has landed: no fallback frame and no rebuild. Without a marker, a
  `<Suspense>` whose fallback renders exactly what the cursor stands on showed
  its fallback, anything else its children.

**Compiled JSX** is adopted when it is compiled for hydration:
what-compiler's `hydratable` option, which the Vite plugin sets for a project
that renders on the server (`appType: 'custom'`, an SSR build, or a client
build with `build.ssrManifest`; `hydratable: true | false` overrides it). A hydratable template claims the server's nodes
while hydrating (`_$claim`, `_$next`, `_$hole`, `_$exit`) and clones itself
otherwise, so the same build also mounts. A component's compiled children,
and every prop its caller wrote as JSX or handed on from its own props
(`_$slots`), are lazy getters built where the component reads them (what-core
dom.js `_installLazyChildren`). A component that only places such a prop has
each read compiled as a placing read where it stands (`_$place`, what-compiler's
`deferPlacedProps`), which builds it there, so it claims inside the
component's own element; a prop placed twice is built twice. A build is
untracked, so a `<Show>` or a condition it is placed in does not depend on
the signals its JSX read; with no owner current it is the component's. A
read that does not place it once its JSX is placed, or any after the
component's run, gets a placeable, built where it is placed as an element is
(its first placement takes a build still waiting for one); a prop the run
never read is built once at that read, under the component's owner, to tell
JSX from data. Any other read during the run
(an inspection, an `h()` component's) builds it off the walk, as JSX that is
not written in place in its parent (built ahead of time into a variable, or
by a `.map()` into one) is (`_$outside`): it takes the place of the server's
rendering of it where it is placed, reported as a mismatch of kind
`prebuilt`, and what the user changed in the server's form controls there (a
value, checkedness, a selection, files) goes to the built controls that
correspond: the same tag, type, name and `form` attribute, in order where
both hold as many, and never one inside a `<noscript>`.
No node the server rendered is replaced without a report. An array of compiled members (a component's children,
a fragment, a `<Show>`'s content, an array literal, the rows of an unkeyed
`.map()` of components, a row of several nodes) claims in document
order: an element or a component claims when it is created, and text, a
reactive child or a list is adopted when the array is placed, so where one of
those comes before an element, or an element's hoisted setup before an
earlier member, or a component's own array markers could be taken for the
array's, the array is built by `_$members` instead, its members created
in order and each of the others adopted where it stands (`_$member`), inside
the array's server markers; placing it afterwards adopts nothing again, and
nor does placing the nodes a component adopted. A component's several
children have server markers of their own only where they are placed as the
whole value of a component or a reactive child: placed in an element's hole,
among a fragment's or an array's members, or as a boundary's or an `h()`
element's children, the server writes them in place, the placing read says so
(`_$place(props, key, 1)`), and their `_$members` takes none, so the markers
of a first child that brings its own (a component that returns a fragment)
stay that child's. `<Head>` builds its compiled
children where it stands: a `<title>`, `<meta>` or `<link>` among them, which
the server wrote into `<head>`, is built on the client, and the others claim
in place. A part of
a template with no bindings in it is adopted whole when the server wrote
exactly the template's nodes (one `isEqualNode`), and claimed node by node,
each difference reported, otherwise. Compiled
without the option, a component returns DOM it already built, before the walk
can claim anything: `hydrate()` puts it in place of the server's copy and
reports one `ERR_HYDRATION_MISMATCH` of kind `not-hydratable`. The page works;
the reuse is lost. A hydratable build carries the hydration runtime (about
11.3 KB gzip: the `compiled-hydrate` counter of `.size-budgets.json` against
the same app mounted); a build without the option carries none of it.

**Mismatches** are reported, never silently rewritten: one record per region
(a marked region, else the element the walk is in),
`{ kind, component, ownerPath, path, expected, found, recovery }`, where `kind`
is `tag`, `text`, `missing`, `extra-nodes`, `marker`, `key`, `shadow-root`,
`prebuilt` or `not-hydratable` and `path` is the DOM path under the container. Development
prints it as `ERR_HYDRATION_MISMATCH`; every build, production included,
passes it to `options.onHydrationError`. Development also reports, as the
diagnostic only, each attribute of a claimed element that the server wrote
otherwise than the client's first write gives it (kind `attribute`, with the
attribute's name): compared once the walk is done, as written (a URL is not
resolved, class tokens keep their order), with a boolean attribute equal by
its presence and `style` by its declarations. An attribute the client does
not write is not compared, and the client's value is the one kept. Recovery client-renders the smallest
part it can: the one element (with its subtree) or text node that differs is
replaced by the client's, nodes the client does not render are removed, and a
missing node is inserted. Leftovers at the end of an element or region are
removed (reported as `extra-nodes`). Only at the container's top level are the
stream's own elements left in place: its data elements, the content templates
of boundaries not yet swapped in, and its `_$W` scripts. A `<body>` or `<html>`
container's own leftovers are left alone, since the page puts its scripts and
other roots there.

**Claimed markup is held to the client's rules** (SECURITY.md, Hydration).
`hydrate()` never parses a string: it adopts nodes the browser built from the
response, and from then on the client owns them as if it had created them.
After the walk the container holds exactly what a client render of the same
tree with the same data holds:

- A claimed element's attributes end as a client render's. On an h() element a
  server attribute stays as it is only where a prop renders exactly that value
  (a string or number the setter writes as it stands); every other prop is
  written by its setter, each of which writes its attribute whole (a refused
  URL removes the attribute, a style object replaces the inline style), and an
  attribute no prop renders is removed. A reactive prop's attribute stands
  until the effect's first run writes the client's value, and goes if that run
  is held on a value that has not landed. A compiled element takes exactly its
  template node's attributes, and its bindings write the dynamic ones.
- An element the client leaves empty keeps what the server put in it only
  where the client says so: an island's host (which the island hydrates), and
  an element whose raw HTML a binding writes (`{ __html }`, kept when it is the
  same). Anything else in it is left over.
- An element hosting a shadow root (a declarative one: `<template
  shadowrootmode="open">` in the response) is not what the client renders, as
  the page would show the shadow tree: it is replaced and reported as
  `shadow-root`, also inside a static subtree adopted whole (`isEqualNode`
  does not see shadow roots).
- Raw inner HTML is only ever the client's `{ __html }`. Markers are matched by
  their exact text and position and are never interpreted further.
- Event handlers belong to their owner: once the component, row or root that
  set one is disposed (a later `hydrate()` of the same container replacing it,
  an unmount), it never runs again, also on an element that outlived it.

Recovery leaves what a client render leaves
(`packages/core/test/hydration-mismatch.test.js`,
`packages/core/test/hydration-trust.test.js`).

### Islands Architecture

Pages are divided into static HTML and interactive islands:

```html
<body>
  <!-- Static: zero JS -->
  <nav>...</nav>

  <!-- Island: hydrates on idle -->
  <div data-island="search" data-island-mode="idle">
    <!-- Server-rendered HTML -->
  </div>

  <!-- Static: zero JS -->
  <main>...</main>

  <!-- Island: hydrates on first interaction -->
  <div data-island="cart" data-island-mode="action">
    <!-- Server-rendered HTML -->
  </div>
</body>
```

An island's props travel as JSON in the island's element. A prop that is a
vnode (`icon={<Icon />}`) is recorded by its path in `data-island-vnodes`, and
the client revives exactly those paths into vnodes with `h()`; anything else
shaped like a vnode stays data, so props from an API cannot become markup.

Six hydration modes control when each island activates:

| Mode | Triggers when |
|------|---------------|
| `load` | Page loads (immediate) |
| `idle` | Browser is idle (`requestIdleCallback`) |
| `visible` | Island enters viewport (`IntersectionObserver`) |
| `action` | User interacts (click, focus, hover) |
| `media` | Media query matches |
| `static` | Never hydrates (server-only) |

## MCP DevTools Bridge

The `what-devtools-mcp` package provides a WebSocket bridge between a running WhatFW app and AI agents via the Model Context Protocol. This is the agent-first debugging architecture:

```
+------------------+      WebSocket       +------------------+      stdio/MCP      +------------------+
|  Browser App     | <------------------> |  Bridge Server   | <------------------> |  AI Agent        |
|  (client.js)     |      port 9229       |  (Node.js)       |                     |  (Claude, etc.)  |
+------------------+                      +------------------+                      +------------------+
```

The bridge:
1. Receives state snapshots (signals, effects, components) from the browser client
2. Stamps every event with a sequence number and keeps a bounded log, the page's coded diagnostics and an error log
3. Forwards commands from the agent to the browser (eval, navigate, set-signal, etc.)
4. Exposes 25 MCP tools for agents to query and manipulate app state

See `/docs/MCP-DEVTOOLS.md` for the complete tool reference.

## File Structure

```
packages/
+-- core/               Reactive system, rendering, hooks, components
|   +-- src/
|       +-- reactive.js     Signals, computed, effects, batch, ownership
|       +-- render.js       Fine-grained rendering: template, insert, mapArray, spread, components
|       +-- selector.js     createSelector (O(1) keyed selection)
|       +-- dom.js          mount, the vnode renderer (createDOM), the portal renderer, SSR frames
|       +-- vnode-renderer.js  Slot through which render.js reaches createDOM
|       +-- h.js            JSX factory (h, Fragment, html tagged template); installs the vnode renderer
|       +-- hooks.js        React-compatible hooks backed by signals
|       +-- components.js   memo, lazy, Suspense, ErrorBoundary (and their client renderers), Show, For
|       +-- store.js        Global state management (createStore, derived)
|       +-- data.js         Data fetching (useSWR, useQuery, useFetch): what-framework/data
|       +-- form.js         Form utilities (useForm, validation): what-framework/form
|       +-- animation.js    spring, tween, useTween, transitions: what-framework/motion
|       +-- a11y.js         Accessibility utilities: what-framework/a11y (useId stays on the root)
|       +-- scheduler.js    DOM read/write batching, resize/intersection observers
|       +-- head.js         Document head management
|       +-- helpers.js      Utilities (cls, style, useMediaQuery, …: what-framework/dom; transitionClass: /motion; Portal)
|       +-- index.js        Public API re-exports
+-- compiler/           Babel plugin: JSX -> client templates + bindings, or server string templates
+-- router/             Client-side routing (Router, Link, navigate, guards)
+-- server/             SSR, SSG, islands hydration, server actions
+-- react-compat/       React compatibility layer (see REACT-COMPAT.md for the tested matrix)
+-- devtools/           Browser DevTools extension
+-- devtools-mcp/       MCP-based AI debugging bridge (25 tools)
+-- eslint-plugin/      Lint rules for What Framework patterns
+-- mcp-server/         MCP documentation server (deprecated — see what-devtools-mcp)
+-- cli/                Development tools (dev, build, preview, generate)
+-- create-what/        Project scaffolding (npx create-what my-app)
```

## Performance Characteristics

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Signal read | O(1) | Value access; tracking reuses the link from the previous run |
| Signal write | O(r) | r = nodes reached downstream, each marked at most once |
| Effect subscribe | O(1) | One link, or none when re-read in the same order |
| Effect cleanup | O(d) | d = number of dependencies |
| Batch flush | O(e + c) | e queued effects, c computeds re-verified; no sort |
| Template clone | O(n) | n = DOM nodes in template (browser-optimized) |
| insert() | O(1) | Single text node or element update |
| mapArray reconcile | O(n log n) | LIS-based; O(n) for common cases |
| SSR render | O(n) | n = total nodes |
