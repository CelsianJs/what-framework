# What Framework API Reference

Complete public API for `what-framework`. The root entry is
`packages/core/src/index.js` (its export list is pinned by
`packages/core/test/exports.test.js`); the domain kits are subpaths:

| Import from | Section |
|---|---|
| `what-framework` | [Reactivity](#reactivity), [Rendering](#rendering), [Hooks](#hooks), [Components](#components), [State Management](#state-management), [Head](#head), [Diagnostics](#diagnostics) |
| `what-framework/render` | [Fine-grained primitives](#fine-grained-primitives) |
| `what-framework/dom` | [Utilities](#utilities), [Scheduler](#scheduler) |
| `what-framework/motion` | [Animation](#animation) |
| `what-framework/a11y` | [Accessibility](#accessibility) |
| `what-framework/ui` | [Skeleton / Loading](#skeleton--loading) |
| `what-framework/data` | [Data Fetching](#data-fetching) |
| `what-framework/form` | [Forms](#forms) |
| `what-framework/testing` | [Testing](#testing) |

Every `what-framework/<kit>` has a `what-core/<kit>` twin. Names that left the
root entry in 0.15, and where they went, are listed in [UPGRADING.md](UPGRADING.md).
`useTransition` and `startTransition` are React's transition API (see
[Reactivity](#reactivity) and [ASYNC.md](ASYNC.md)); the animation helper once
named `useTransition` is `useTween` in `what-framework/motion`.

## Conventions

- Docs standardize on `onClick` event casing.
- Runtime accepts `onClick` and `onclick`.
- A signal is written with `count(5)` or `count.set(5)`: the same write. The
  docs use `count(5)`.
- `show()` helper is removed.

---

## Reactivity

| Export | Type | Notes |
|---|---|---|
| `signal(initial)` | `Signal<T>` | Getter/setter signal (`sig()`, `sig.set(...)`, `sig(...)`) |
| `computed(fn)` | `Computed<T>` / `AsyncComputed<T>` | Derived value, recomputed when read after an input changed. A function that returns a promise or an async iterable makes an async value ([ASYNC.md](ASYNC.md)): an `async` function, or one that takes `{ signal }` (the run's AbortSignal), starts at creation and fetches again when an input changes; a newer run aborts the older one, the last value stays meanwhile, `c.pending()` says a new value is on its way and `c.peek()` reads the last one |
| `refresh(c)` | `Promise<T>` | Fetch an async computed again now; resolves with the value of that run (also one the function answers at once) or rejects with its error |
| `isPending(fn)` | `boolean` | Tracked: whether an async value `fn` reads is fetching a new value (false on first load) |
| `startTransition(fn)` | `Promise<void>` | What `fn`'s writes reach stays as it was until the async values they made fetch have landed, then commits in one flush; resolves at the commit (inside an async action that commits with it: once only the action keeps it waiting). A write after an `await` inside `fn` is an ordinary write: wrap it in `startTransition` too |
| `useTransition()` | `[() => boolean, startTransition]` | React's hook; `isPending()` is true from the call until the commit. A rejected action shows in the `<ErrorBoundary>` above the component, as in React 19, and the returned promise rejects |
| `useOptimistic(state, update?)` | `[() => S, (value) => void]` | React 19's: `optimistic()` is `state` (pass the accessor, `likes`, not `likes()`) with each overlay `addOptimistic(value)` added, through `update(current, value)`; an overlay lives until the transition it was added in commits, and adds to the committed value. Call `addOptimistic` inside `startTransition` |
| `useActionState(action, initial, permalink?)` | `[() => S, dispatch, () => boolean]` | React 19's: `dispatch(payload)` runs `action(previousState, payload)` inside a transition; dispatches queue; the new state commits with the transition, in the flush that shows the data its action revalidated. A throw reaches the nearest `<ErrorBoundary>`. `permalink` is where its `<Form>` posts without JavaScript, by default the page itself ([DATA.md](DATA.md)) |
| `useFormStatus()` | `{ pending(), data(), method, action }` | React 19's: the submission of the `<Form>` (what-framework/server) around the component |
| `use(x)` | `T` | A promise's value (the component suspends until it settles; make the promise outside the component), a context's value, or an accessor read untracked. A transition does not hold a component that suspends on it ([ASYNC.md](ASYNC.md#limits)) |
| `settled()` | `Promise<void>` | Resolves once nothing is queued, fetching, streaming (an async iterable still pulled) or in a transition, and no `<Suspense>` waits to reveal: for tests and agents, act, then `await settled()`, then read the DOM |
| `effect(fn)` | `() => void` | Reactive side-effect + disposer. Owns what each run creates (effects, computeds, roots, cleanups) and disposes it before the next run |
| `batch(fn)` | `T` | Batch writes: effects run once, synchronously, when the outermost batch ends; returns what `fn` returns |
| `untrack(fn)` | `T` | Read without dependency tracking |
| `flushSync()` | `void` | Flush pending effects synchronously |
| `createRoot(fn)` | `T` | Scoped reactive root with cleanup; one created under another owner (an effect's run included) is disposed with it |
| `getOwner()` / `runWithOwner(owner, fn)` | | Capture and restore the reactive owner, e.g. across an `await`: work created after an `await` belongs to no owner unless it is created inside `runWithOwner` |
| `createSelector(source)` | `(key) => boolean` | O(1) keyed selection: `isSelected(key)` is `key === source()`, but only the readers of the keys a change leaves and enters re-run |

### Signal

```jsx
const count = signal(0);

count();               // read
count(1);              // write
count(c => c + 1);     // updater
count.set(2);          // the same write as count(2)
count.peek();          // untracked read
count.subscribe(fn);   // shorthand for effect(() => fn(count()))

const todos = signal([]);
todos.mutate(list => list.push({ id: 1, title: 'Write docs' })); // in place
```

A write is skipped when the new value is `Object.is`-equal to the old one, so
pushing onto the same array and writing it back changes nothing.
`sig.mutate(fn)` is for that case: `fn` receives the current value to change in
place, and then every reader is notified exactly as a write notifies them,
batched the same way (inside `batch()` at its end, otherwise on the next
microtask or `flushSync()`). If `fn` throws, nothing is notified. Equality
still applies downstream: a computed that returns the mutated value itself (or
anything else equal to its last result) recomputes but does not notify its own
readers, so a computed that must see the change derives a new value from it,
such as a copy, a length or a field.

### Selection: `createSelector`

```jsx
import { signal, createSelector } from 'what-framework';

const rows = signal([{ id: 1, label: 'One' }, { id: 2, label: 'Two' }]);
const selected = signal(null);
const isSelected = createSelector(selected);

function Table() {
  return (
    <table>
      <tbody>
        {rows().map(row => (
          <tr key={row.id} class={isSelected(row.id) ? 'danger' : ''} onClick={() => selected(row.id)}>
            <td>{row.label}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Selecting a row re-runs the bindings of the previously selected row and the
newly selected one, not one binding per row. A read right after a write returns
the new answer. A key's bookkeeping is released when the last owner (list row,
mount root) that read it is disposed.

You rarely need to call it: inside a keyed `.map()` row the compiler rewrites
`selected() === row.id` (or `!==`, either order) in a render binding to a
selector by itself, when `selected` is a signal, computed, destructured prop or
imported accessor declared outside the row and never reassigned, and the other
operand reads the row without calling anything. Opt out with
`/* @what-no-selector */` before the comparison or the `.map()` call, or for a
whole build with the compiler option `autoSelector: false` (`what({ autoSelector:
false })` in the Vite config). In development the compiler logs each file it
rewrites once.

---

## Rendering

| Export | Notes |
|---|---|
| `Fragment` | Group children without wrapper (compiler target) |
| `html\`...\`` | Tagged template vnode API |
| `mount(node, container)` | Mount compiled DOM, a vnode, a thunk or an array into a container; returns the unmount function. A container that already holds a mounted or hydrated tree has it disposed first |
| `hydrate(node, container, { onHydrationError }?)` | Adopt the server-rendered DOM in `container` (an element or a selector) instead of creating it: where the markup matches, no node is created and nothing the server sent is fetched again. Returns the unmount function, as `mount()` does. The tree is built in a root under the current owner; a later `mount()` or `hydrate()` into the container disposes it. A mismatch reports `ERR_HYDRATION_MISMATCH` (`{ kind, component, ownerPath, path, expected, found, recovery }`) in development and to `onHydrationError` in every build, and the differing part is rendered on the client. A `<noscript>`'s content is the server's alone, as in React: with scripts on the browser keeps it as text, so the client neither builds nor hydrates it. A field the user changed before hydration keeps its value, and no event is dispatched for it. Compiled JSX hydrates when compiled with what-compiler's `hydratable` option (what-compiler/vite's `'auto'` turns it on for a project that renders on the server) |
| `applyStreamedBoundaries()` | Swap in streamed boundaries on a page streamed with `noScripts`; call before `hydrate` |
| `h(tag, props, ...children)` | Create vnodes directly (exported from core) |

> JSX is the primary authoring format. The compiler transforms JSX into optimized DOM operations. `h()` is also exported for programmatic vnode creation and is used internally by the compiler. An app that never makes a vnode (no `h()`, no `Suspense`, `ErrorBoundary` or `Portal`) does not carry the vnode renderer.

### Fine-grained primitives

Imported from `what-framework/render`, the runtime compiled JSX calls, for code
written without JSX.

| Export | Notes |
|---|---|
| `template(html)` | DOM template factory, markup parsed as HTML (table parts included) |
| `svgTemplate(html)` | DOM template factory for SVG markup |
| `insert(parent, child, marker?)` | Reactive insertion helper; with no marker on an empty parent a text value is set with `textContent` |
| `mapArray(source, mapper, options?)` | Keyed (`options.key`) or unkeyed list mapping of an accessor, or of an array for a list that never changes; a repeated key or item gets a row per occurrence |
| `spread(el, props)` | Direct prop spreading |
| `delegateEvents(names, root?)` | Event delegation on `root` (the document by default) |
| `on(el, event, handler, options?)` | Add a DOM listener, removed when the current owner (the component, list row or root being built) is disposed; returns the function that removes it sooner. In components, write `onClick={...}` in JSX |
| `classList(el, classes)` | Reactive class toggles |
| `isHydrating()` | True while a hydration pass walks existing DOM |
| `_$Island` | What `<Counter client:idle />` compiles to: `h(_$Island, { component: Counter, mode: 'idle' })`, an island that hydrates itself when its trigger fires (`load`, `idle`, `visible`, `interaction`, `media` with `mediaQuery`, `static`). `interaction` listens in the capture phase for a click, focus (keyboard focus on a control inside it too), mouseenter or touchstart, and hydrates before the event reaches its target, so the handler the island sets runs for that first interaction. The registry-based island component is what-framework/server's `Island` |
| `_$memo(fn)` | The eager, equality-gated memo compiled branch conditions use. The root entry's `memo` is React's component memo |

Delegated handlers run innermost first along the event's composed path, so a
handler inside an open shadow tree runs, with `e.target` the node the event came
from; once the event leaves the shadow tree that node lives in, `e.target` is the
host, and a light-DOM child slotted into a shadow host stays the target, as a
native listener would see. A handler on a disabled element is skipped. A shadow
root or an element that delegates for its own subtree
(`delegateEvents(['click'], shadowRoot)`) runs the handlers inside it, its own
included, and the document's listener does not run them again. `currentTarget`
and `target` are restored after the walk even when a handler throws.

### JSX attributes the compiler lowers

| Attribute | Behaviour |
|---|---|
| `class` / `className` | `className` on HTML elements, the `class` attribute on SVG elements (decided at compile time) |
| `classList={{ name: cond }}` | Toggles each class by the truthiness of its value over the class attribute; a function value, or a function classList, is a reactive accessor; a key may hold several space-separated classes; a key dropped from a later object falls back to the class attribute. With `class` it composes in prop order, as the server folds them: a classList after `class` toggles over every value `class` writes, a `class` after the classList replaces it |
| `ref={fn}` | Called with the element |
| `ref={refObject}` | `refObject.current` is set to the element; an unset ref (`undefined`) is ignored |
| `ref={el}` with `let el` | The element is assigned to the variable, also when it still holds the element of an earlier render |

The ref expression is evaluated once.

---

## Hooks

<!-- hooks-contract:start (generated by scripts/generate-error-docs.mjs from packages/create-what/agent-instructions.js) -->

The hooks keep React's names and call shapes: `const [count, setCount] = useState(0)`, `useReducer(reducer, initial)`, `useMemo(fn)`, `useEffect(fn, deps)` returning a cleanup, `useRef(initial).current`, `useContext(Ctx)`, `useId()` (a string). What differs is that a component runs once, so a hook cannot hand you this render's value. It hands you the signal:

- `useState` and `useReducer` return `[accessor, setter]`. `count` is a function: read the value by calling it, `count()` or `state().items`. `setCount(5)` and `setCount((c) => c + 1)` write, as in React.
- `useMemo(fn)` returns an accessor too (`total()`), recomputed when a signal `fn` reads changes. Its dependency array is ignored, and so is `useCallback`'s, which returns your function unchanged. A promise it returns stays a promise (`ERR_ASYNC_MEMO`): fetch with `computed()`.
- `useEffect(fn)` runs after the component mounts and re-runs when a signal it reads changes; the cleanup it returns runs before the next run and on unmount. With a dependency array it re-runs only for the accessors listed (`[count]`, never `[count()]`: a plain value reports `ERR_EFFECT_DEP_NOT_FUNCTION`), and `[]` runs it once.
- `useContext(Ctx)` returns what the nearest provider passed. Provide a signal for a value that changes (`<Theme value={theme}>`) and call it where you read it.
- React's async hooks keep their shapes and hand you accessors too: `const [isPending, start] = useTransition()` (`isPending()`; a rejected action shows in the `<ErrorBoundary>` above), `const [optimistic, addOptimistic] = useOptimistic(state, update)` (pass the accessor `state`, read `optimistic()`), and `const [data, { loading, error, refetch, mutate }] = createResource(fetcher)` (`data()`, `loading()`, `error()`). `use(promise)` and `use(Ctx)` return the value itself, but a transition does not hold a component that suspends on `use(promise)`: make the data an async computed of the state the transition writes.
- A component is never `async`: one that returns a promise renders it as text (`ERR_ASYNC_COMPONENT`).
- The rules that exist because React re-renders do not apply: no stale closures (a handler that calls `count()` reads the current value), no exhaustive dependency lists, nothing to memoize for a stable identity. Hooks still run only in a component body.

The habit that makes React-trained code correct: **whatever a hook or `signal()` returns, call it to read it.** In development, a signal used as a value without the call (`` `${count}` ``, `count + 1`) reports `ERR_MISSING_SIGNAL_READ`.

Data a component fetches is an async value, not an effect: `computed(async ({ signal }) => …)` fetches, aborts a run a newer one replaces, keeps its last value meanwhile, and is read by calling it (`users()`) under a `<Suspense fallback>` that shows on first load only. `refresh(users)` fetches again while `users.pending()` says so, `startTransition(() => page(2))` keeps the screen as it is until what the write made fetch has landed, and a test acts, then `await settled()`, then reads the DOM. Data several components share by key comes from the query cache: `query(() => ['user', id()], fetchUser)` from `what-framework/data` is the same kind of value, with one request per key, and the server renders it and hands it to the client. Mutations are actions: `const [result, run, isPending] = useActionState(action, initial)` runs one in a transition, and its state commits with the data it revalidated (`invalidateQueries` inside it).

```jsx
import { mount, useState, useEffect, useMemo } from 'what-framework';

function Counter() {
  const [count, setCount] = useState(0);
  const doubled = useMemo(() => count() * 2);
  useEffect(() => {
    document.title = `Count: ${count()}`;
  });
  return <button onClick={() => setCount((c) => c + 1)}>{() => `${count()} doubled is ${doubled()}`}</button>;
}

mount(<Counter />, '#app');
```

```jsx
import { mount, computed, refresh, Suspense } from 'what-framework';

function Users() {
  const users = computed(async ({ signal }) => (await fetch('/api/users', { signal })).json());
  return (
    <section>
      <button onClick={() => refresh(users)}>{() => (users.pending() ? 'Refreshing…' : 'Refresh')}</button>
      <ul>{() => users().map((user) => <li key={user.id}>{user.name}</li>)}</ul>
    </section>
  );
}

mount(<Suspense fallback={<p>Loading…</p>}><Users /></Suspense>, '#app');
```

<!-- hooks-contract:end -->

| Export | Notes |
|---|---|
| `useState(initial)` | `[accessor, setter]`: read with `count()`, write with `setCount(v)` or `setCount(fn)` |
| `useSignal(initial)` | The signal itself, scoped to the component |
| `useComputed(fn)` | A computed accessor scoped to the component |
| `useEffect(fn, deps?)` | Runs after mount; re-runs when a signal it reads changes, or with `deps` only for the accessors listed; `[]` runs once. Runs in the user phase, after the DOM bindings of the same flush; the first run on the microtask after the component (docs/EFFECT-TIMING.md). Disposed with the component; does nothing during a server render |
| `useMemo(fn, deps?)` | A computed accessor (`total()`); `deps` is ignored. A promise it returns stays a promise (`ERR_ASYNC_MEMO` in development): fetch with `useComputed` or `computed()` |
| `useCallback(fn, deps?)` | Returns `fn` unchanged; `deps` is ignored |
| `useRef(initial)` | Mutable ref (`ref.current`) |
| `createContext(defaultValue?)` | Context factory. The context is its own provider: `<Ctx value={v}>` and `<Ctx.Provider value={v}>` are the same component |
| `useContext(ctx)` | Read context value from the nearest provider above the current owner, so it also works in a region, effect or list row long after the component body ran. A context created with no default, read with no provider above, reports `ERR_CONTEXT_NOT_PROVIDED` in development |
| `useReducer(reducer, initial, init?)` | `[accessor, dispatch]`: read with `state()` |
| `useId(prefix?)` | Unique id string, stable for the component's life, as in React |
| `onMount(fn)` | Runs `fn` once the component has mounted, in the user phase of the flush after the component is built (as `useEffect`'s first run). Like the `use*` hooks it needs a component body: outside one it throws `ERR_HOOK_OUTSIDE_COMPONENT` |
| `onCleanup(fn)` | Runs when the current owner goes away: the component being rendered (on unmount), the effect whose run is executing (before its next run and on disposal, like the function the effect returns; an `onMount` callback included), or the root, list row or region around the call. With no owner, as after an `await`, development reports `ERR_CLEANUP_WITHOUT_OWNER` |
| `createResource(fetcher, options?)` | `[data, { loading, error, refetch, mutate }]`: `data` is an async computed (a read before it lands holds under a `<Suspense>`), `loading()` and `error()` are accessors, `refetch(source?)` resolves when it lands, `mutate(value)` sets the data. `{ key }` adopts the server's value by key while hydrating; a keyless one adopts by its place in the tree |
| `useLoaderData()` | The current page's server loader data, on the server and after hydration |

---

## Components

| Export | Notes |
|---|---|
| `memo(component, areEqual?)` | Kept for React code: components run once, so there is no re-render to skip; it wraps the component and ignores `areEqual` |
| `lazy(loader)` | Lazy component loader |
| `Suspense` | Shows `fallback` until the async values and lazy components under it have first shown (a value computed from another async value included), then reveals everything at once. After that a refresh keeps the content up; a component that suspends again (`lazy()`, `use(promise)`) shows the fallback with the content kept mounted behind it. `onMount`/`useEffect` under it first run at the reveal. A server-rendered one is adopted as it is ([ASYNC.md](ASYNC.md)) |
| `ErrorBoundary` | Error capture boundary: catches what its children throw while they are built and afterwards (effect re-runs and cleanups, bindings, list rows, components created later, async values that rejected) and shows `fallback({ error, reset })`; `reset()` fetches again the async value runs whose errors it caught and builds the children again. An error in the fallback goes to the boundary above; with no boundary an error is logged and the app keeps running |
| `Show` | Conditional component |
| `For` | List component: `each` is an accessor (`each={items}`) or an array; compiled JSX makes an expression such as `each={items().filter(f)}` reactive like any other, and one that picks an accessor, `each={archived() ? done : open}`, reads the accessor it picks. With `key={(item) => item.id}` a row is built once per key and its item is an accessor, `item()`, that follows an item replaced under the key; without `key` the row gets the item itself. `.map()` with a `key` prop is the usual form in compiled JSX: its rows keep their DOM and follow a replaced item too |
| `Switch` / `Match` | Conditional branch set |
| `Portal` | Render children into `target` (an element or a CSS selector), `document.body` when there is none; see [Portal](#portal) |

### Portal

`<Portal target>` renders its children into `target`, an element or a CSS
selector, and into `document.body` when there is no `target`. They are built
under the portal's owner, so context and boundaries reach them, and they leave
the target when the portal goes: its `<Show>` turns false, or its component
unmounts. A selector that matches nothing renders nothing, and reports
`ERR_PORTAL_TARGET_MISSING` in development. The server renders nothing for a
portal; hydration builds it on the client, in its target.

```jsx
import { signal, Show, Portal } from 'what-framework';

function Settings() {
  const open = signal(false);
  return (
    <section>
      <button onClick={() => open(true)}>Edit</button>
      <Show when={open}>
        <Portal>
          <div role="dialog" aria-modal="true" class="modal">
            <p>Settings</p>
            <button onClick={() => open(false)}>Close</button>
          </div>
        </Portal>
      </Show>
    </section>
  );
}
```

### Forwarding children into a boundary or a provider

Your own wrapper around `ErrorBoundary`, `Suspense` or a `Context.Provider`
works with no extra ceremony:

```jsx
function MyBoundary({ children, fallback }) {
  return <ErrorBoundary fallback={fallback}>{children}</ErrorBoundary>;
}
```

The compiler keeps children that are only forwarded unbuilt until the component
they are handed to has run, which is what lets the boundary catch them and the
provider publish its value in time.

Inspecting children is the one thing that cannot stay lazy: reading
`children.length` builds the subtree, and building it is exactly what the
boundary has to be around. A component that both inspects and forwards has to
pick one. Set `Component._deferChildren = true` to pick forwarding, which makes
`props.children` a zero-argument factory the runtime calls inside the boundary
and gives up inspection:

```jsx
function Panel({ children }) {
  return <ErrorBoundary fallback={<p>failed</p>}>{children}</ErrorBoundary>;
}
Panel._deferChildren = true;   // only needed if Panel also read children itself
```

Three other shapes read `children` before the wrapper's body runs and need the
same flag: a `children` binding with a default value (`{ children = null }`), a
parameter pattern with a rest element (`{ children, ...rest }`), and a forward
that goes through a local first (`const kids = children`). Write the forward as
`{ children }` or `props.children` and none of them apply.

An expression child is now built by the component it is handed to, not by the
caller, so a component that never renders its children never evaluates them.
This has always been true of element children; an expression child with a side
effect no longer runs for a component that discards it.

### Conditional patterns

```jsx
{ready() ? <Dashboard /> : <Spinner />}

<Show when={ready()} fallback={<Spinner />}>
  <Dashboard />
</Show>
```

---

## State Management

| Export | Notes |
|---|---|
| `createStore(definition)` | Store hook factory |
| `derived(fn)` | Store-level derived field marker |

### Stores and actions

`createStore(definition)` makes each plain value a signal, each
`derived((state) => …)` a computed, and every other function an action. It
returns a hook. The object the hook returns has a getter for each state and
derived field (a read inside a reactive child or an effect tracks it) and the
actions as plain functions.

```jsx
import { createStore, derived } from 'what-framework';

const useTodos = createStore({
  items: [],
  remaining: derived((state) => state.items.filter((t) => !t.done).length),
  add(text) {
    this.items = [...this.items, { id: crypto.randomUUID(), text, done: false }];
    return this.items.length;
  },
});

function TodoCount() {
  const todos = useTodos();
  return <button onClick={() => todos.add('Write docs')}>{() => todos.remaining} left</button>;
}
```

- In an action, `this` reads the current state and derived values, untracked.
- Assigning a state key (`this.items = …`) writes its signal, and the write is
  what notifies. `this.items.push(item)` changes the array but no reader
  re-runs: assign a new array or object. Assigning a derived or unknown key
  does nothing.
- An action runs as one batch: its effects run once, synchronously, when it
  returns, and an action it calls (`this.add(…)`) joins the same batch. It
  returns what the function returns.
- `const { remaining } = useTodos()` reads the value once. Keep the object and
  read `todos.remaining` where it should update, inside a function in JSX:
  `{() => todos.remaining}`, `class={() => (todos.filter === 'all' ? 'on' : '')}`.
  The compiler cannot tell that a store field is reactive, so a bare
  `{todos.remaining}` is evaluated once.

### Decision matrix

- `useComputed` or `useMemo`: a value derived from signals in a component; both
  return an accessor and track what they read (`useMemo` ignores its deps).
- `derived`: derived value inside store definition.

---

## Utilities

Imported from `what-framework/dom`.

| Export | Notes |
|---|---|
| `cls(...args)` | Conditional class helper |
| `style(obj)` | CSS text helper |
| `debounce(fn, ms)` | Debounce utility |
| `throttle(fn, ms)` | Throttle utility |
| `useMediaQuery(query)` | Media-query signal |
| `useLocalStorage(key, initial)` | LocalStorage-backed signal |
| `useClickOutside(ref, handler)` | Outside-click helper |
| `clearHead()` | Clear the head tags `<Head>` manages |

---

## Head

| Export | Notes |
|---|---|
| `Head` | Sets `<title>`, `<meta>` and `<link>` tags from any component, on the client and in a server render |
| `getResponse()` | The server render's response (`setStatus`, `setHeader`, `redirect`); inert on the client |

`<Head>` takes `title`, `meta` and `link` props (`meta` and `link` are an
object or an array of them), and also `<title>`, `<meta>` and `<link>`
children, which set the same tags; any other child renders in place. Tags are
de-duplicated: a `meta` is keyed by its `name`, `property` or `httpEquiv`, a
`link` by `rel` plus `href`, and a later tag with the same key, or a later
title, replaces the earlier one, so a child beats a prop of the same `<Head>`.
On the client it updates `document.head`; in a server render the tags are
collected for the document's `<head>` with the same keys, so the client does
not duplicate them.

```jsx
import { Head } from 'what-framework';

function ProductPage() {
  return (
    <main>
      <Head title="Products" meta={{ name: 'description', content: 'Every product' }} />
      <Head>
        <title>Product 42</title>
        <link rel="canonical" href="https://example.com/products/42" />
      </Head>
      <h1>Product 42</h1>
    </main>
  );
}
```

---

## Scheduler

Imported from `what-framework/dom`.

| Export | Notes |
|---|---|
| `scheduleRead(fn)` | Queue DOM read |
| `scheduleWrite(fn)` | Queue DOM write |
| `flushScheduler()` | Flush queues immediately |
| `measure(fn)` | Promise-wrapped read |
| `mutate(fn)` | Promise-wrapped write |
| `useScheduledEffect(readFn, writeFn?)` | Read/write split effect |
| `nextFrame()` | Next animation frame promise |
| `raf(key, fn)` | Debounced RAF by key |
| `onResize(el, cb)` | Resize observer helper |
| `onIntersect(el, cb, options?)` | Intersection observer helper |
| `smoothScrollTo(el, options?)` | Smooth scroll helper |

---

## Animation

Imported from `what-framework/motion`.

| Export | Notes |
|---|---|
| `spring(initial?, config?)` | Spring value |
| `tween(from, to, config?)` | Tween value |
| `easings` | Easing collection |
| `useTween(options?)` | Eased 0..1 progress (`isTransitioning()`, `progress()`, `start()`). Named `useTransition` before 0.15 |
| `useGesture(ref, handlers?)` | Gesture helper |
| `useAnimatedValue(initial?)` | Managed animated value helper |
| `createTransitionClasses(name)` | Transition class map |
| `cssTransition(element, name, type?, duration?)` | Run a CSS enter/exit class sequence |
| `transitionClass(name, active)` | Enter/leave classes as props to spread on an element |

---

## Accessibility

Imported from `what-framework/a11y`. `useId` is a [hook](#hooks) on the root entry.

| Export | Notes |
|---|---|
| `useFocus()` | Current focus helpers |
| `useFocusRestore()` | Capture/restore focus |
| `useFocusTrap(ref)` | Programmatic focus trap |
| `FocusTrap` | Focus trap wrapper |
| `announce(msg, options?)` | Live region announcement |
| `announceAssertive(msg)` | Assertive announcement |
| `SkipLink` | Skip link component |
| `useAriaExpanded(initial?)` | Expanded-state helpers |
| `useAriaSelected(initial?)` | Selected-state helpers |
| `useAriaChecked(initial?)` | Checked-state helpers |
| `useRovingTabIndex(countOrGetter)` | Roving tab index helper |
| `VisuallyHidden` | Screen-reader-only wrapper |
| `LiveRegion` | Live region component |
| `useIds(count, prefix?)` | Batch ids |
| `useDescribedBy(description)` | `aria-describedby` helpers; `descriptionId` is a string |
| `useLabelledBy(label)` | `aria-labelledby` helpers; `labelId` is a string |
| `Keys` | Keyboard constants |
| `onKey(key, handler)` | Key filter wrapper |
| `onKeys(keys, handler)` | Multi-key filter wrapper |

### Recommended modal pattern

- Parent captures trigger focus with `useFocusRestore().capture(...)`.
- Dialog subtree is wrapped with `<FocusTrap>`.
- Parent restores focus on close with `.restore()`.

---

## Skeleton / Loading

Imported from `what-framework/ui`.

| Export | Notes |
|---|---|
| `Skeleton` | Base skeleton block |
| `SkeletonText` | Multi-line skeleton |
| `SkeletonAvatar` | Avatar skeleton |
| `SkeletonCard` | Card skeleton |
| `SkeletonTable` | Table skeleton |
| `IslandSkeleton` | Island placeholder skeleton |
| `useSkeleton(asyncFn, deps?)` | Async + skeleton helper |
| `Placeholder` | Generic placeholder |
| `LoadingDots` | Dot loading indicator |
| `Spinner` | SVG spinner |

---

## Data Fetching

Imported from `what-framework/data`. One cache: every key is one entry, an
async value in the graph, shared by `query()` and every hook
([DATA.md](DATA.md)).

| Export | Notes |
|---|---|
| `query(key, fetcher, options?)` | `AsyncComputed<T>`: the cached value of the key (a key, or a function of signals returning one). Suspends and holds like any async value, dedupes readers, keeps the last value with `pending()` while a new key or a refetch loads, aborts a key nothing reads, `refresh(q)` refetches; server-rendered values are adopted on hydrate under their key. Options: `staleTime`, `gcTime`, `retry`, `retryDelay`, `initialData` |
| `useQuery(options)` | TanStack Query's shape; never suspends. `queryKey` may be a function; `enabled`, `staleTime`, `gcTime`, `select`, `placeholderData`, `keepPreviousData`, `refetchOnWindowFocus`, `refetchOnReconnect`, `refetchInterval`, `retry` |
| `useSWR(key, fetcher, options?)` | SWR's shape: `data` (or `fallbackData`, or null), `error`, `isLoading`, `isValidating`, `mutate`, `revalidate`; a null, false or throwing key pauses it |
| `useInfiniteQuery(options)` | Pages as one entry: `data()` is `{ pages, pageParams }`, `fetchNextPage`, `fetchPreviousPage` |
| `useFetch(url, options?)` | One URL's JSON from the cache; `url` may be a function |
| `invalidateQueries(keyOrPredicate, options?)` | Mark stale and refetch what is shown (inside a transition, it joins it); an array key is a prefix; returns a promise of the refetches |
| `invalidatePath(path)` / `onRevalidate(path, cb)` | Refetch what was read on `path` (route data, queries) and run its callbacks; a server action's `revalidate` calls it |
| `prefetchQuery(key, fetcher, options?)` | Fill the entry unless it is fresh; resolves with the value |
| `setQueryData(key, updater)` | Land a value in the entry now, for every reader |
| `getQueryData(key)` | The cached value (undefined: nothing; null: hard-invalidated) |
| `clearCache()` | Drop everything (logout); what is in flight never lands |

Server actions (`action(fn, { revalidate, invalidates })`, `<Form action>`)
and router navigations (`preload`, transitions) are in [DATA.md](DATA.md).

---

## Forms

Imported from `what-framework/form`.

| Export | Notes |
|---|---|
| `useForm(options?)` | Form state + validation |
| `useField(name, options?)` | Single-field primitive |
| `rules` | Built-in validation rules |
| `simpleResolver(ruleMap)` | Rule-map resolver |
| `zodResolver(schema)` | Zod resolver adapter |
| `yupResolver(schema)` | Yup resolver adapter |
| `Input` / `Textarea` / `Select` / `Checkbox` / `Radio` | Bound field components |
| `ErrorMessage` | Form error component |

### Correct error access

```jsx
const { formState } = useForm();

formState.errors.email?.message; // correct
formState.error('email')?.message; // optional field accessor
```

### `ErrorMessage`

```jsx
<ErrorMessage name="email" formState={formState} />
```

Compatibility input is supported:

```jsx
<ErrorMessage name="email" errors={() => legacyErrors} />
```

---

## Diagnostics

| Export | Notes |
|---|---|
| `getDiagnostics({ since? })` | Coded diagnostics development checks reported, after a cursor |
| `subscribeDiagnostics(fn)` | Listen to every report; returns the unsubscribe function |
| `clearDiagnostics()` | Forget buffered events |
| `getErrorDefinition(code)` | The catalogue entry for an `ERR_*` code: template, suggestion, example in development; code, severity and template in the production build (`what_fix` and [ERRORS.md](ERRORS.md) carry the full entry) |
| `WhatError` | The structured error class |

Tools that render or classify errors (`ERROR_CODES`, `createWhatError`,
`classifyError`, `reportDiagnostic`), the guardrails and the devtools hooks are
in `what-core/internal`, what-core's interface to its sibling packages; it is
not for applications and not covered by semver.

---

## Raw HTML behavior

Both are supported in DOM + SSR:

```jsx
function RawHtml() {
  return (
    <>
      <div innerHTML={{ __html: '<strong>Hello</strong>' }} />
      <div dangerouslySetInnerHTML={{ __html: '<strong>Hello</strong>' }} />
    </>
  );
}
```

Rule: if either raw HTML prop is set, it owns element children. A plain string is never parsed as markup (`innerHTML="<b>x</b>"`): pass `{ __html }`.

---

## Testing

Imported from `what-framework/testing`. The DOM helpers need a DOM: a browser,
or jsdom / happy-dom in Node.

| Export | Notes |
|---|---|
| `render(vnode, { container? })` | Mount into a fresh container; returns it, query helpers and `unmount` |
| `renderTest(Component, props?)` | Mount a component; `update()` flushes effects, `unmount()` disposes |
| `cleanup()` | Dispose every tree `render()` and `renderTest()` mounted; call it in `afterEach` |
| `fireEvent` / `screen` / `expect` | DOM events, document-wide queries, DOM assertions |
| `waitFor(fn, options?)` / `waitForElementToBeRemoved(fn, options?)` | Poll until truthy or gone |
| `act(fn)` | Run `fn`, then wait until what it started has landed: queued effects, async values, transitions (`settled()`) |
| `settled()` | The root entry's `settled()`: resolves once nothing is queued, fetching or in a transition |
| `flushEffects()` | Run pending effects now |
| `trackSignals(fn)` | `{ accessed, written }`: the named signals `fn` read and wrote |
| `mockSignal(name, initial)` / `createTestSignal(initial)` / `mockComponent(name?)` | Signals that keep their history; a stub component that records its calls |
| `captureDiagnostics(fn)` | The diagnostics `fn` reported and the effects it ran |
| `expectNoDiagnostics(cap, { allow? })` | Throw on any diagnostic whose code is not in `allow` |
| `expectDiagnostic(cap, { code, exact?, min?, max? })` | Throw unless the capture holds `code`, that many times, and nothing else |
| `expectRuns(cap, { effect?, component?, exact?, min?, max? })` | Throw unless the selected effects ran that many times |

### Diagnostics and effect runs

```jsx
import { render, fireEvent, captureDiagnostics, expectNoDiagnostics } from 'what-framework/testing';

const view = render(<Signup />);
const cap = captureDiagnostics(() => {
  fireEvent.change(view.getByTestId('email'), 'a@b.co');
  flushSync();
});
expectNoDiagnostics(cap);
```

`captureDiagnostics(fn)` returns `{ events, runs, effects, result }`, or a
promise of it when `fn` returns a promise. It throws in production builds,
which report nothing.

- `events`: the diagnostics reported, kept off the console. Repeats of one code
  on one subject fold into one event with a `count`.
- `runs`: runs by effect or computed function name (`'(anonymous)'` otherwise),
  for those that ran. A first run counts.
- `effects`: one `{ name, kind, owner, runs }` for each effect and computed that
  ran or was known to exist, with `runs: 0` for one that stayed idle. `kind` is
  `'effect'` or `'computed'`; `owner` is the component path, root first
  (`['<Signup>', '<Header>']`), or `null` outside any component.
- `result`: what `fn` returned.

`expectDiagnostic` and `expectRuns` take the same count options: `exact`, or
`min` and/or `max`. With none of them the count is "at least once". An unknown
option, a count that is not a whole number of 0 or more, `exact` with `min` or
`max`, and `min` above `max` throw a `TypeError`.

### `expectDiagnostic(cap, { code, exact?, min?, max? })`

Passes when the capture holds `code` and no other code, reported that many
times. The occurrences add up each event's `count`: one report repeated on one
subject and one report on each of two subjects both count 2.

```js
const field = useForm().register('email');
const cap = captureDiagnostics(() => field.oninput('a@b.co'));
expectDiagnostic(cap, { code: 'ERR_FORM_HANDLER_WITHOUT_EVENT', exact: 1 });
```

### `expectRuns(cap, { effect?, component?, exact?, min?, max? })`

Counts the runs of the selected effects and computeds during the capture:

| Select | Example | Counts |
|---|---|---|
| nothing | `expectRuns(cap, { max: 4 })` | every effect and computed run: the whole interaction |
| `effect` | `expectRuns(cap, { effect: 'mirrorEmail', exact: 1 })` | those with that function name |
| `component` | `expectRuns(cap, { component: 'Header', exact: 0 })` | those created in `<Header>` or in a component inside it, every instance |
| both | `expectRuns(cap, { component: 'Row', effect: 'syncRow', max: 1 })` | those with that name created in `<Row>` or inside it |

A name or component that matches no effect that ran or was known to exist
throws and lists what ran, so a misspelling fails instead of passing as zero
runs. An effect that did not run is known only when it was created inside a
`render()` / `renderTest()` tree or the capture.

An effect's component comes from the owner tree (`__ownerPath`): the component
whose body, output, region or list row created it, or whose effect, `useEffect`
or `onMount` run created it, with the components above it. An effect outside
any component, created at module scope or in a `createRoot` outside one, has
`owner: null` and is in no component's count.

While they watch, the helpers wrap the devtools hooks. Installed devtools keep
receiving every call, and the hooks underneath are put back once no tree is
mounted and no capture is open.
