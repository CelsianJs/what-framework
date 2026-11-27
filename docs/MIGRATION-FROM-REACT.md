# Migration from React

A practical guide for React developers evaluating or switching to What Framework. No marketing -- just the differences, with code examples.

## What's the Same

These patterns transfer directly with no changes.

### JSX Syntax

Identical. The same JSX you write in React works here.

```jsx
// React and WhatFW — same syntax
function Greeting({ name }) {
  return <h1 className="title">Hello, {name}</h1>;
}
```

### useRef

Same API, same behavior. Returns a mutable ref object.

```jsx
function InputFocus() {
  const inputRef = useRef(null);

  onMount(() => {
    inputRef.current.focus();
  });

  return <input ref={inputRef} />;
}
```

### useContext / createContext

Identical pattern, including React 19's form: the context is its own provider,
so `<ThemeContext value="dark">` and `<ThemeContext.Provider value="dark">` are
the same component.

```jsx
const ThemeContext = createContext('light');

function App() {
  return (
    <ThemeContext value="dark">
      <Toolbar />
    </ThemeContext>
  );
}

function Toolbar() {
  const theme = useContext(ThemeContext);
  return <div class={theme}>...</div>;
}
```

A provider follows its value as in React: `<ThemeContext value={theme()}>`
hands its readers each new theme. A reader's body runs once, so read the
context where it renders (`<div class={useContext(ThemeContext)}>`) rather
than into a variable first ([GOTCHAS 24](GOTCHAS.md#24-a-context-provider-follows-its-value-a-readers-body-does-not)).

A context created without a default (`createContext()`) says its value must
come from a provider: in development, reading it with no provider above reports
`ERR_CONTEXT_NOT_PROVIDED` instead of silently returning `undefined`.

### useId

`useId()` returns a string, as in React. The component runs once, so it is
stable for the component's life.

```jsx
function Field({ label }) {
  const id = useId();
  return <><label for={id}>{label}</label><input id={id} /></>;
}
```

### Component Composition

Same patterns -- children, render props, higher-order components all work.

```jsx
function Card({ children, title }) {
  return (
    <div class="card">
      <h2>{title}</h2>
      <div class="card-body">{children}</div>
    </div>
  );
}

function App() {
  return (
    <Card title="Welcome">
      <p>Card content here</p>
    </Card>
  );
}
```

### Portals

react-dom's `createPortal(children, node)` is the `<Portal>` component, on the
root entry. `target` is an element or a CSS selector, `document.body` when
there is none. There is no `createPortal` export: an import of it fails in the
browser with "does not provide an export named 'createPortal'".

```jsx
import { Portal, useState } from 'what-framework';

function Modal({ onClose, children }) {
  return (
    <Portal target={document.body}>
      <div role="dialog" aria-modal="true">
        <button onClick={onClose}>Close</button>
        {children}
      </div>
    </Portal>
  );
}

function App() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open() ? <Modal onClose={() => setOpen(false)}>Hi</Modal> : null}
    </>
  );
}
```

The condition sits where the modal renders, in the parent's JSX. Written in
the modal as React does (`if (!open) return null`), it is read once
(`ERR_PROP_READ_ONCE`). [API.md, Portal](./API.md#portal) has the rest.

### Spread Props and Polymorphic Components

Rest props, `as` props and wrappers that spread their props keep working as written, and follow the parent's state as React re-renders them:

```jsx
// A design system's Box, Text or Button with `as`
const Box = ({ as: Tag = 'div', size = 'md', ...rest }) => <Tag class={'box-' + size} {...rest} />;

// A wrapper that spreads everything, children included
const Link = (props) => <a {...props} />;

// A forwardRef-style render function (what-react's forwardRef, or React 19's ref prop)
const Input = ({ label, ...rest }, ref) => <label>{label}<input ref={ref} {...rest} /></label>;

const page = <>
  <Box as="a" href={url()} title={title()}>{label()}</Box>  {/* every prop and the text stay live */}
  <svg><Box as="circle" r={radius()} /></svg>                 {/* an SVG element, drawn */}
</>;
```

The rest element keeps the props live wherever it goes (spread, handed on, destructured again, read by key, merged into an object literal that is spread onto JSX), a spread's `children` render as the element's children, and a tag held in a binding (`<Tag />` with `Tag` a string) is created in the namespace it stands in and hydrates in place. An attribute written after a spread wins over it (`<a {...rest} href="/x" />` keeps `/x`), a handler that comes through a spread follows the parent's current one, `children` written as an attribute stays live, and an accessor callback over a prop (`read={() => props.project}`) returns the prop's current value. Two things are read once, as everything outside JSX is in a component that runs once: the tag (`as={isLink() ? 'a' : 'button'}` keeps its first element; branch in JSX to switch) and a handler written directly (`onClick={props.onClick}`; write `onClick={(e) => props.onClick?.(e)}`). Shapes the compiler cannot read where you use them are reported at build time as `ERR_PROP_READ_ONCE`: a destructured prop you assign again, a component that picks what it returns from a prop (`return on ? <A /> : <B />`; branch in JSX with `{() => …}` or `<Show>`), and props handed to a JSX helper as a value (`mk({ value })`; write `mk(props)` or `<Mk value={value} />`). The props and a rest element are plain objects, as React's are (`rest.hasOwnProperty(k)`, `String(props)`, `Object.keys`, a spread). A plain function that only destructures its argument, such as a reducer or a factory, is not taken for a component and keeps its destructuring as written. See [GOTCHAS.md](./GOTCHAS.md#26-rest-props-and-polymorphic-components-stay-live).

### Event Handling

Same `onClick`, `onChange`, `onSubmit` patterns.

```jsx
function Button() {
  const handleClick = (e) => {
    e.preventDefault();
    console.log('clicked');
  };

  return <button onClick={handleClick}>Click me</button>;
}
```

Controlled fields work as in React: a field whose `value` (or `checked`) is
bound to state shows the state, so an edit the handler does not write back is
undone, and such a field with no handler cannot be changed. Use `defaultValue`
for a field the user owns. A value that reads no state (a constant, the
forms kit's `{...register('name')}`) is only where the field starts
([GOTCHAS 23](GOTCHAS.md#23-a-field-whose-value-or-checked-is-bound-to-state-is-controlled)).
`onChange` is React's: on a text field or a textarea it fires on each edit
as the user types, on a checkbox, radio or select on each click or pick, and
a `<form onChange>` hears its fields. The handler is handed the DOM event
(`e.type` is `input` while the user types). For the commit only, on blur or
Enter, use `onBlur`, or the DOM's `change` event with `on(el, 'change', fn)`
from `what-framework/render`.

```jsx
function Name() {
  const [name, setName] = useState('');
  return <input value={name()} onChange={(e) => setName(e.target.value)} />;
}
```

## What's Different

These are the patterns that change. Read this section carefully.

### React's hooks, in a component that runs once

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

### Signal-Based State

**React:**
```jsx
const [count, setCount] = useState(0);
// count is a value: 0, 1, 2, ...
// setCount is a function: setCount(5) or setCount(prev => prev + 1)
```

**WhatFW with useState:**
```jsx
const [count, setCount] = useState(0);
// count is a FUNCTION (signal accessor) — call it to read: count()
// setCount works the same: setCount(5) or setCount(prev => prev + 1)
```

**WhatFW with useSignal (preferred):**
```jsx
const count = useSignal(0);
// Read:  count()
// Write: count.set(5) or count.set(prev => prev + 1)
// Peek:  count.peek() — read without creating a subscription
```

### Reading State in JSX

**React:**
```jsx
import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);
  return <p>Count: {count}</p>;
}
```

**WhatFW:**
```jsx
import { useState } from 'what-framework';

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <p>Count: {() => count()}</p> {/* the wrapper written out */}
      <p>Count: {count()}</p>       {/* the compiler wraps the call */}
    </div>
  );
}
```

The compiler automatically wraps `{count()}` in `() => count()` for you. Both forms produce the same output: an effect that updates just that text node when `count` changes.

A bare `{count}` child renders the value too (a function child is read as an accessor), but eslint-plugin-what flags it, and inside an expression it breaks: ``{`Count: ${count}`}`` or `{count + 1}` converts the function itself, renders its source text and reports `ERR_MISSING_SIGNAL_READ` in development. Call it: `count()`.

### Components Run Once

This is the most important conceptual difference.

**React:** Component function re-runs on every state change. Local variables are recreated. You need `useMemo`, `useCallback`, and `React.memo` to prevent unnecessary work.

**WhatFW:** Component function runs exactly once. The returned DOM is permanent. Signals create individual effects that surgically update specific DOM nodes.

```jsx
// This function runs ONCE
function Counter() {
  const count = useSignal(0);

  // This log runs once, not on every update
  console.log('Counter component executed');

  // The effect created by {() => count()} updates only this text node
  return (
    <div>
      <p>{() => count()}</p>
      <button onClick={() => count.set(c => c + 1)}>+1</button>
    </div>
  );
}
```

**Implications of run-once:**
- No stale closures -- the function body is only entered once, so there's only one closure
- No need for `useCallback` dependency arrays -- the callback is created once and captures the signal, which always returns the latest value
- No need for `useMemo` dependency arrays -- `useMemo(fn)` and `useComputed(fn)` both track the signals `fn` reads, and `useMemo` ignores the array
- `signal()`, `computed()` and `effect()` work anywhere, module scope included; the `use*` hooks and `onMount` still run only in a component body (outside one they throw `ERR_HOOK_OUTSIDE_COMPONENT`)

**Two React habits that read state once.** State read in the component body,
outside JSX and outside a function, is read when the component runs, and
never again:

```jsx
import { useState, useMemo, useEffect } from 'what-framework';

function Users({ load }) {
  const [loading, setLoading] = useState(true);
  useEffect(() => { load().then(() => setLoading(false)); }, []);
  // React: `if (loading) return <p>Loading…</p>;` Here that branch is taken
  // once and kept. Branch where it renders:
  return <>{() => (loading() ? <p>Loading…</p> : <ul />)}</>;
}

function Signup() {
  const [name, setName] = useState('');
  // React: `const valid = name.length > 0;` Here a plain const keeps its
  // first value. Derive it, and call it where it is shown:
  const valid = useMemo(() => name().length > 0);
  return (
    <form>
      <input value={name()} onChange={(e) => setName(e.target.value)} />
      <button disabled={!valid()}>Sign up</button>
    </form>
  );
}
```

A development build reports both shapes when they read state
(`ERR_STATE_READ_ONCE`). For a prop it reports the first, a return the prop
decides (`ERR_PROP_READ_ONCE`); a value derived from a prop in the body
(`const label = name.toUpperCase()`, then `{label}`) is not reported and keeps
its first value. Write it in the JSX (`{name.toUpperCase()}`) or derive it with
`useMemo(() => …)` and call it there.

### useMemo / useComputed

**React:**
```jsx
const doubled = useMemo(() => count * 2, [count]);
// Must manually specify [count] as dependency
// Bug if you forget a dependency
```

**WhatFW:**
```jsx
const doubled = useComputed(() => count() * 2);
// No dependency array — auto-tracks that it reads count()
// Recomputes only when count changes
// Returns a signal accessor: read with doubled()
```

`useMemo(() => count() * 2)` is the same hook under React's name: it returns an accessor (`doubled()`), tracks what it reads, and ignores a dependency array if you pass one.

### useCallback

**React:**
```jsx
const handleClick = useCallback(() => {
  setCount(count + 1);
}, [count]);
// Must update dep array when closure variables change
// Stale closure bug if deps are wrong
```

**WhatFW:**
```jsx
const handleClick = useCallback(() => {
  count.set(c => c + 1);
});
// No dependency array needed — count.set is stable
// No stale closure — count() always returns latest value
// The function reference is stable (created once)
```

### useEffect

**React:**
```jsx
useEffect(() => {
  document.title = `Count: ${count}`;
}, [count]);
// Must specify deps manually
// Runs after paint
```

**WhatFW (no deps -- auto-tracking):**
```jsx
useEffect(() => {
  document.title = `Count: ${count()}`;
});
// No dependency array: auto-tracks signal reads
// Runs before paint (microtask timing)
// Re-runs whenever count() changes
```

**WhatFW (empty deps -- mount only):**
```jsx
useEffect(() => {
  console.log('mounted');
  return () => console.log('unmounted');
}, []);
// Same as React: runs once on mount, cleanup on unmount
```

**WhatFW (signal deps -- explicit tracking):**
```jsx
useEffect(() => {
  console.log('count changed to', count());
}, [count]);
// Deps are the accessors themselves: [count], never [count()]
// Re-runs only when a listed accessor changes; reads in the body are not tracked
```

A value in the array (`[count()]`) is read once and never changes, so the effect never re-runs: development reports `ERR_EFFECT_DEP_NOT_FUNCTION`, and eslint-plugin-what's `no-signal-read-in-effect-deps` flags it.

Only signals and computeds in the array are read. Any other function is never called, because a ported array holds setters and callbacks (`[setCount]`, `[load]`): an arrow written as a getter, `[() => props.count]`, does not re-run the effect, and development reports `ERR_EFFECT_DEP_NOT_SIGNAL`. List a computed (`useMemo(() => props.count)`) or drop the array. Callbacks can be left out: a component runs once, so they never change.

**Effects run in React's order.** On mount a child's `useEffect` and `onMount` run before its parent's. When state changes, every cleanup runs first, then every run, children first. On unmount a parent's cleanups run before its children's. A child that registers with its parent in an effect has registered by the time the parent's effect runs, as in React. What's own `onCleanup` runs children first, and a component inside a reactive child (`{open() ? <Panel /> : null}`) runs after the components written beside it ([GOTCHAS 22](GOTCHAS.md#22-useeffect-runs-in-reacts-order-oncleanup-in-the-owners)).

### Conditional Rendering

**React:**
```jsx
{isLoggedIn && <Dashboard />}
{isLoading ? <Spinner /> : <Content />}
```

**WhatFW:**
```jsx
{isLoggedIn() && <Dashboard />}
{isLoading() ? <Spinner /> : <Content />}

// Or use the Show component:
<Show when={isLoggedIn}>
  <Dashboard />
</Show>
```

Call the signal in the condition. The compiler wraps a JSX expression that calls an accessor, so the branch switches when the signal changes; `{() => isLoggedIn() && <Dashboard />}` is the same expression with the wrapper written out. Without the call, `{isLoggedIn && <Dashboard />}` tests the function, which is always truthy.

### List Rendering

**React:**
```jsx
{items.map(item => <li key={item.id}>{item.name}</li>)}
```

**WhatFW:**
```jsx
{items().map(item => <li key={item.id}>{item.name}</li>)}

// Or the <For> component, which hands each row an accessor:
<For each={items} key={item => item.id}>
  {(item) => <li>{() => item().name}</li>}
</For>
```

Keep `.map()` with a `key` prop, and call the list's accessor (`items()`). The compiler lowers it to keyed reconciliation with LIS-based minimal DOM moves; each row gets its own reactive scope that is disposed on removal, and a row whose item is replaced under the same key (an immutable update, a refetch) keeps its DOM and shows the new item, as React does, a row that destructures its item (`({ id, label, ...rest }) => …`) included. `<For each={items}>` takes the accessor (or an array; compiled JSX makes `each={items().filter(f)}` reactive too), and with `key` hands each row its item as an accessor (`item()`), built once per key.

An index key works as React keys it: `key={i}` and `` key={`${t.term}-${i}`} `` are keyed lists, with no warning: a row stays while its key does, so a refetch that hands the same places new objects keeps the rows. A render callback in a row (`{renderCell(item)}`, a column's `render(row)`) is handed the raw item, as in React, and the JSX it returns is built again when a refetch replaces the item. To keep the cell's DOM, hand it a live view, `renderCell(live(() => item))`, or render a component, `<Cell item={item} />` ([GOTCHAS 26](GOTCHAS.md#26-rest-props-and-polymorphic-components-stay-live)).

## What's Better

### No Dependency Array Bugs

The #1 source of React bugs is wrong or missing dependency arrays. WhatFW eliminates this entirely:

```jsx
// React: easy to get wrong, and a slow old reply can overwrite a newer one
useEffect(() => {
  fetchData(userId, filter).then(setData);  // Bug if you forget [filter]
}, [userId]);

// WhatFW: an async value tracks what it reads, and the newest run wins
const data = computed(({ signal }) => fetchData(userId(), filter(), { signal }));
// Refetches when either changes; the older request is aborted
```

Fetching in a `useEffect` still races in WhatFW: an async `computed()` is the
replacement (see [ASYNC.md](ASYNC.md)).

### No Stale Closure Issues

**React** (the classic stale closure bug):
```jsx
import { useState, useEffect } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCount(count + 1);         // Always sees count = 0 (stale closure)
    }, 1000);
    return () => clearInterval(id);
  }, []);                           // Missing count in deps

  return <p>{count}</p>;
}
```

**WhatFW** (no stale closure possible):
```jsx
import { useSignal, useEffect } from 'what-framework';

function Counter() {
  const count = useSignal(0);

  useEffect(() => {
    const id = setInterval(() => {
      count.set(c => c + 1);       // Always works — count.set is stable
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return <p>{count()}</p>;
}
```

### No Unnecessary Re-renders

**React** (the parent re-renders all children on any state change):
```jsx
function Parent() {
  const [name, setName] = useState('');
  const [age, setAge] = useState(0);

  return (
    <div>
      <NameDisplay name={name} />     {/* Re-renders when age changes too */}
      <AgeDisplay age={age} />        {/* Re-renders when name changes too */}
    </div>
  );
}
// Fix requires React.memo, useMemo, useCallback — boilerplate
```

**WhatFW** (each binding is independent):
```jsx
function Parent() {
  const name = useSignal('');
  const age = useSignal(0);

  return (
    <div>
      <NameDisplay name={name} />     {/* Only updates when name changes */}
      <AgeDisplay age={age} />        {/* Only updates when age changes */}
    </div>
  );
}
// No memo, no optimization needed — fine-grained by default
```

`NameDisplay` and `AgeDisplay` receive the signals and call them where they render (`{name()}`), so a change updates that one text node and no component runs again.

### Fine-Grained DOM Updates

When a signal changes, only the specific DOM nodes that read that signal are updated. No component function re-executes. No virtual DOM diff. The update path is: signal write --> notify subscriber effect --> effect updates one DOM node.

### Smaller Bundle, Faster Startup

The core reactive system + rendering primitives are significantly smaller than React + ReactDOM. Tree-shaking removes unused features (forms, animations, data fetching) if you don't import them.

## What's Not Available

Be aware of these gaps before migrating.

### Transitions Without Priority Scheduling

`useTransition`, `startTransition` and `useOptimistic` have React's shapes
([ASYNC.md](ASYNC.md)). A transition holds what its writes reach on screen
until the async work they started has landed, then commits it in one flush.
There is no priority scheduling: nothing is interrupted or rendered in the
background, because there is no render to interrupt. `isPending` and the
optimistic state are accessors: call them, and pass `useOptimistic` the
accessor (`useOptimistic(likes)`, not `likes()`). A rejected `useTransition`
action shows in the `<ErrorBoundary>` above the component, as in React 19, and
the promise `start` returns rejects too. The animation helper that used to be
called `useTransition` is `useTween` in `what-framework/motion`.
`useDeferredValue` is not implemented.

React's tabs pattern, panels that `use()` a cached promise switched inside
`startTransition`, shows the fallback here instead of keeping the old tab
(development reports `ERR_SUSPEND_IN_TRANSITION`): a transition holds async
values, not components that suspend. Make the tab's data an async value of the
tab signal, which the transition holds:

```jsx
import { signal, computed, startTransition, Suspense } from 'what-framework';

const tab = signal('about');
const content = computed(({ signal }) => fetch('/api/tabs/' + tab(), { signal }).then((r) => r.text()));

export function Tabs() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <button onClick={() => startTransition(() => tab('posts'))}>Posts</button>
      <p>{content()}</p>
    </Suspense>
  );
}
```

### Suspense Shows Its Fallback Only Once

An async value suspends its `<Suspense>` like a lazy component does:
`computed(fn)` takes a function that returns a promise, `use(promise)` reads a
promise in a component, and `createResource` is built on them. A component is
never `async`: an `async function` component renders its promise as text
(`ERR_ASYNC_COMPONENT`); read an async value in JSX instead. The fallback stays
until every value under it has landed, one fetched with another's result
included. Unlike React, an async value shows the fallback only on first load: after the content has
shown, a refetch keeps it on screen, and `pending()` tells you it is stale. A
`lazy()` component or `use(promise)` brings the fallback back, as in React,
and the content stays mounted behind it, with its DOM state. The server waits for
async values in `renderDocument` and `renderToStream`, and the client adopts
them when it hydrates, with no second fetch. See [ASYNC.md](ASYNC.md).

### Data Libraries, Actions and Routing Map Onto One Cache

TanStack Query, SWR, React 19's actions and react-router's data APIs each
have a What counterpart. They all sit on one query cache, whose entries are
async values ([DATA.md](DATA.md)). Accessors replace values: `q.data()`, not
`q.data`.

| React ecosystem | What |
|---|---|
| `useQuery({ queryKey, queryFn, enabled, staleTime, select, placeholderData })` (TanStack) | `useQuery` from `what-framework/data`, same options. `queryKey` may also be a function of signals: `() => ['user', id()]`. |
| `useSuspenseQuery`, `use(promise)` for data | `query(key, fetcher)`: suspends its `<Suspense>` on first load, then keeps the value with `pending()` |
| `queryClient.invalidateQueries`, `setQueryData`, `getQueryData`, `prefetchQuery` | The same names from `what-framework/data`, on the one cache (no client object) |
| `useInfiniteQuery` | `useInfiniteQuery`: `data().pages`, `fetchNextPage()` |
| `useSWR(key, fetcher, { dedupingInterval, fallbackData, keepPreviousData })`, `mutate` | `useSWR`, same options, and `mutate` on the result |
| `useMutation({ mutationFn, onSuccess })` | `useActionState(action, initial)`, or the action inside `startTransition`; revalidate with `invalidateQueries` inside it |
| `useActionState`, `useFormStatus`, `useOptimistic` (React 19) | The same names from `what-framework`, same shapes, accessors for the state |
| `<form action={serverAction}>` | `<Form action={serverAction}>` from `what-framework/server`. It works without JavaScript, and runs as a transition with JavaScript. |
| `'use server'` functions, `revalidatePath` | `action(fn, { revalidate: [path], invalidates: [key] })` from `what-framework/server`. On the client it is a transition that refetches what it revalidates. |
| react-router `loader` / `useLoaderData` on the client | A route's `preload({ params })` that returns queries; the page gets them as `data` |
| react-router navigations wrapped in `startTransition` | `navigate()` and `<Link>`: the old page stays until the new route's chunk and `preload` data have landed |
| `useNavigation().state === 'loading'` | `route.isNavigating`, or `useTransition`'s `isPending` around `navigate()` |

### No Server Components

React Server Components (RSC) are not available. There is no `.server.js` / `.client.js` boundary. All components run on both server (for SSR) and client (for interactivity).

### No React DevTools

React DevTools does not work with WhatFW, and there is no browser extension. In development, what-devtools instruments the page (a `DevPanel` component from `what-devtools/panel`, and the `__WHAT_DEVTOOLS__` console global listing signals, effects and components), and what-devtools-mcp is an MCP debugging bridge for AI agents. A scaffolded app has both wired up. The tooling is less mature than React's.

### Ecosystem Libraries

React libraries that depend on React internals (`__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED`, fiber tree access) will not work. Libraries that use only the public React API often work through the react-compat layer, but not always. Confirmed working libraries include react-window, cmdk, sonner, styled-components, and emotion.

## Migration Checklist

1. Keep `useState` and `useReducer` destructuring: `const [val, setVal]` --> `val` is now an accessor, call `val()` to read
2. `useEffect`: drop the dependency array and let the effect re-run on the signals it reads, or keep one that lists accessors (`[count]`, never `[count()]`, which reports `ERR_EFFECT_DEP_NOT_FUNCTION`, and never a getter arrow, which reports `ERR_EFFECT_DEP_NOT_SIGNAL`); `[]` still runs once after mount. Effects run in React's order, children first
3. `useMemo` and `useCallback` ignore their dependency arrays: delete them. `useMemo` returns an accessor, so read `total()`
4. Remove all `React.memo()` wrappers (unnecessary with fine-grained updates)
5. Call accessors where they render (`{count()}`, `class={active() ? 'on' : ''}`); the compiler makes those reactive. Write `() =>` yourself only when the read hides inside a call whose arguments call nothing
6. Props written as in React stay live: `<Child count={count()} />` updates the child's `{props.count}` (or a destructured `{count}`, a nested one or one with a default) where it renders, and the child keeps its state; so do rest props (`({ as: Tag, ...rest }) => <Tag {...rest} />`) and spread props. A value the child computes in its body outside JSX is read once: write it in JSX or in `computed()`. Passing the accessor itself (`count={count}`, called as `count()` in the child) also works. Don't assign a destructured prop (`size = size ?? 'md'`): give it a default (`{ size = 'md' }`) or a new name; the build reports `ERR_PROP_READ_ONCE` for that assignment, for a component that picks what it returns from a prop and for props handed to a JSX helper as a value, but not for a value computed from a prop in the body. Handlers, `children` and objects merged from a rest stay live through forwarding, and an attribute after a spread wins over it
7. Keep `.map()` with a `key` prop for lists, on the accessor: `{items().map(item => <li key={item.id}>…</li>)}`. An index key (`key={i}`) works as React keys it. A render callback gets the raw item: use `live(() => item)` or a `<Cell item={item} />` component to keep a cell's DOM across refetches
8. Replace `React.lazy` with `lazy` from what-framework (same API). A download that failed is tried again on the next render (an error boundary's reset) and the next navigation to its route, where `React.lazy` keeps the error until a reload
9. Update imports: `react` --> `what-framework`. React's hooks keep their names there; the router and the domain kits are subpaths (`what-framework/router`, `/form`, `/data`, `/a11y`, `/ui`, `/motion`, `/dom`, and `/server` for SSR, islands and actions)
