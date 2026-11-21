# Upgrading to 0.15

0.15 reshapes the public surface. The root entry, `what-framework`, went from
177 names to <!-- root-count -->58<!-- /root-count -->: reactivity, async values, components and
boundaries, hooks, context, stores, `Head`, `mount`/`hydrate` and the
diagnostics read API. The domain kits moved
to subpaths, names that meant something else in React were renamed, and
nothing was kept behind as a deprecated alias: each change below has one
migration.

## Before you start

1. **Upgrade every What package together.** What's packages are released
   together at one version, and what-compiler's output runs only on the
   what-core of its own release. Move every What package in your
   `package.json` to the same 0.15 release in one install: `what-framework`,
   `what-compiler`, `what-core`, `what-router`, `what-server`, `what-isr`,
   `what-devtools`, `what-devtools-mcp`, `what-react`, `what-text` and
   `eslint-plugin-what`. npm does not catch every package left behind:
   what-text 0.14 accepts what-core 0.15 and then fails at import
   ([Companion packages](#companion-packages)).
2. **Recompile.** Build the app again with what-compiler 0.15. A library that
   ships JSX compiled by an older what-compiler needs a release compiled with
   0.15 ([The compiler](#the-compiler)).
3. **Fix the imports.** Run `npx eslint --fix .` with eslint-plugin-what 0.15:
   it rewrites every import of a name that moved or was renamed, and reports
   each removed name with what to write instead. A build through
   `what-compiler/vite` stops at any that remain with `ERR_MOVED_IMPORT` and
   the same answer. The tables below list every change.
4. **Read the behaviour changes** for the parts of What your app uses, then
   run it in development. The runtime reports what it notices as coded
   diagnostics, `[what] ERR_…` in the console and `getDiagnostics()` in code;
   [ERRORS.md](ERRORS.md) has the fix for each code.

## Where things are

| Import from | What it holds |
|---|---|
| `what-framework` | `signal`, `computed`, `effect`, `batch`, `untrack`, `flushSync`, `createRoot`, `getOwner`, `runWithOwner`, `createSelector`; `refresh`, `isPending`, `startTransition`, `useTransition`, `useOptimistic`, `use`, `settled` (async values, [ASYNC.md](ASYNC.md)); `h`, `Fragment`, `html`, `mount`, `hydrate`, `applyStreamedBoundaries`; `useState`, `useSignal`, `useComputed`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `useReducer`, `useId`, `createContext`, `useContext`, `onMount`, `onCleanup`, `createResource`, `useLoaderData`; `memo`, `lazy`, `Suspense`, `ErrorBoundary`, `Show`, `For`, `Switch`, `Match`, `Portal`, `Island`; `createStore`, `derived`; `Head`, `getResponse`; `getDiagnostics`, `subscribeDiagnostics`, `clearDiagnostics`, `getErrorDefinition`, `WhatError` |
| `what-framework/a11y` | focus management, ARIA state helpers, announcements, `useIds`, keyboard helpers |
| `what-framework/ui` | skeletons and loading placeholders |
| `what-framework/motion` | `spring`, `tween`, `easings`, `useTween`, `useGesture`, `useAnimatedValue`, CSS transitions |
| `what-framework/dom` | the DOM read/write scheduler, `cls`, `style`, `debounce`, `throttle`, `useMediaQuery`, `useLocalStorage`, `useClickOutside`, `clearHead` |
| `what-framework/form` | `useForm`, `useField`, `rules`, resolvers, bound field components |
| `what-framework/data` | `useFetch`, `useSWR`, `useQuery`, `useInfiniteQuery` and the query cache |
| `what-framework/render` | the compiled-JSX runtime: `template`, `insert`, `mapArray`, `spread`, `on`, … for code written without JSX |
| `what-core/internal` | what `what-core` shares with `what-server`, `what-devtools` and `what-devtools-mcp`; not for applications, not covered by semver |

Every `what-framework/<kit>` path has a `what-core/<kit>` twin with the same
exports.

A page that loads What without a bundler, through an import map, maps every
specifier the framework's own modules import, not only the ones the app writes:
`what-framework/<kit>` imports `what-core/<kit>`, `what-framework/render`
imports `what-core/render`, and `what-server/islands` and `what-router` import
`what-core/internal`, which 0.14 did not have. what-core also reads its
development flag through its own `#env` import (package.json `imports`), which
a map names in what-core's scope:
`"scopes": { "/node_modules/what-core/": { "#env": "/node_modules/what-core/src/env.js" } }`.
A browser rejects the page's whole module graph over one missing entry, so
nothing on it hydrates. The create-what full-stack template builds its import
map from the packages' `exports` and `imports`, so it already maps all of them.

## For agents and tools

The tables below are generated from `packages/core/src/import-changes.js`, which
is also `IMPORT_CHANGES` in `what-core/internal`. Code that imports one of these
names from the root entry gets that name's entry from it (`ERR_MOVED_IMPORT`):

- `what-compiler/vite` fails the build and the dev-server transform with it,
  instead of the bundler's generic "is not exported".
- eslint-plugin-what's `what/no-moved-imports`, an error in every preset,
  reports it, and `eslint --fix` splits the import per destination, keeping
  aliases and `type` modifiers (`transition` becomes
  `transitionClass as transition`). A removed name is reported and left for you to
  replace.
- what-devtools-mcp's `what_lint` runs that rule, so an agent checking a
  snippet gets the same answer.

`validateImports(names)` in `what-core/internal` returns the same answers to a
tool that checks a list of names.

<!-- import-changes:start (generated by scripts/generate-import-changes.mjs; edit packages/core/src/import-changes.js) -->

### Renamed

| Was | Now | Why |
|---|---|---|
| `useTransition` | `import { useTween } from 'what-framework/motion'` | The animation helper formerly named useTransition is useTween. useTransition and startTransition on the root entry are React's transition API: const [isPending, start] = useTransition(), where isPending is an accessor, read as isPending(). |
| `transition` | `import { transitionClass } from 'what-framework/motion'` | The enter/leave class helper is transitionClass(name, active). |

### Removed

| Was | Write instead |
|---|---|
| `each` | Render lists with .map() and a key prop, or &lt;For>. |
| `atom` | Use signal(initial). |
| `storeComputed` | Use derived(fn) in the store definition. |
| `onRootCleanup` | Use onCleanup(fn): it attaches to the component being rendered, or else to the reactive owner (createRoot, a list row). |
| `signalMemo` | Use computed(fn), which recomputes only when read and skips readers when the value is unchanged. |
| `getLoaderData` | Use useLoaderData(), which reads the same payload on the client and the render context on the server. |
| `_template` | Use template() from what-framework/render; compiled output imports _$template from there. |
| `getResource` | Use createResource(fetcher, { key }), which reads the hydrated value for its key. |
| `collectError` | Nothing collects errors by hand: the runtime reports its coded diagnostics on one channel (getDiagnostics(), subscribeDiagnostics()), and what-devtools records thrown errors (getErrors()). Both are development-only: a production build reports nothing. |
| `getCollectedErrors` | Use getDiagnostics({ since }) for the coded diagnostics (since is the seq the previous call returned, not a timestamp), or getErrors() from what-devtools for thrown errors; both are development-only. |
| `clearCollectedErrors` | Use clearDiagnostics(). |
| `installAgentContext` | Use installDevTools() from what-devtools, which what-devtools-mcp's Vite plugin calls in development: it exposes the app's state as window.__WHAT_DEVTOOLS__, which the what_* MCP tools read. |
| `registerComponent` | Delete the call: with what-devtools installed, every component is registered as it mounts and dropped as it unmounts. |
| `unregisterComponent` | Delete the call: with what-devtools installed, every component is registered as it mounts and dropped as it unmounts. |
| `registerSignal` | Delete the call: with what-devtools installed, every signal is registered as it is created, and nothing has to unregister it. |
| `unregisterSignal` | Delete the call: with what-devtools installed, every signal is registered as it is created, and nothing has to unregister it. |
| `getMountedComponents` | Use getSnapshot().components from what-devtools (development only), or the what_components MCP tool. |
| `getActiveSignals` | Use getSnapshot().signals from what-devtools (development only), or the what_signals MCP tool. |
| `getHealth` | Use the what_diagnose MCP tool (diagnostic codes, errors, hot effects, unread signals), or getDiagnostics() for the coded diagnostics alone. |
| `checkComponentName` | Removed: a function that reaches the runtime is already being called as a component, so its name cannot reveal the lowercase JSX tag (rendered as an unknown element) the check was meant to catch. Name components in PascalCase. |
| `installSignalReadGuardrail` | Nothing to install: in development every signal and computed reports ERR_MISSING_SIGNAL_READ when it is converted to a string or a number, with or without what-devtools. |

### Moved

Each name below keeps its name and behaviour; only the module changed. Every `what-framework/<kit>` path has a `what-core/<kit>` twin.

| Now imported from | Names |
|---|---|
| `what-framework/render` | `on`, `template`, `svgTemplate`, `insert`, `mapArray`, `spread`, `setProp`, `delegateEvents`, `classList`, `isHydrating`, `_$template`, `_$createComponent` |
| `what-framework/server` | `Island` |
| `what-framework/a11y` | `useFocus`, `useFocusRestore`, `useFocusTrap`, `FocusTrap`, `announce`, `announceAssertive`, `SkipLink`, `useAriaExpanded`, `useAriaSelected`, `useAriaChecked`, `useRovingTabIndex`, `VisuallyHidden`, `LiveRegion`, `useIds`, `useDescribedBy`, `useLabelledBy`, `Keys`, `onKey`, `onKeys` |
| `what-framework/ui` | `Skeleton`, `SkeletonText`, `SkeletonAvatar`, `SkeletonCard`, `SkeletonTable`, `IslandSkeleton`, `useSkeleton`, `Placeholder`, `LoadingDots`, `Spinner` |
| `what-framework/motion` | `spring`, `tween`, `easings`, `useGesture`, `useAnimatedValue`, `createTransitionClasses`, `cssTransition` |
| `what-framework/dom` | `scheduleRead`, `scheduleWrite`, `flushScheduler`, `measure`, `mutate`, `useScheduledEffect`, `nextFrame`, `raf`, `onResize`, `onIntersect`, `smoothScrollTo`, `cls`, `style`, `debounce`, `throttle`, `useMediaQuery`, `useLocalStorage`, `useClickOutside`, `clearHead` |
| `what-framework/form` | `useForm`, `useField`, `rules`, `simpleResolver`, `zodResolver`, `yupResolver`, `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `ErrorMessage` |
| `what-framework/data` | `useFetch`, `useSWR`, `useQuery`, `useInfiniteQuery`, `invalidateQueries`, `prefetchQuery`, `setQueryData`, `getQueryData`, `clearCache` |
| `what-core/render` | `_setTextInsertHook` |
| `what-core/internal` | `__setDevToolsHooks`, `__drainPreinstallBuffer`, `__getCacheSnapshot`, `configureGuardrails`, `getGuardrailConfig`, `validateImports`, `ERROR_CODES`, `createWhatError`, `classifyError`, `getServerContext`, `setServerContext`, `runWithServerContext`, `__installServerContextStorage`, `beginHeadCollection`, `endHeadCollection`, `_isAriaAttr`, `_beginComponentSSR`, `_endComponentSSR`, `_mapArrayToArray`, `__readHydrationData`, `__resetHydrationData` |

### New internal names

The root entry never exported these: they are new in 0.15, part of what `what-core` shares with its sibling packages and tools, and not for applications. They are listed so that importing one from the root entry is answered too.

| Imported from | Names |
|---|---|
| `what-core/internal` | `__depsOf`, `__subsOf`, `__currentEffect`, `__ownerOf`, `__ownerPath`, `reportDiagnostic`, `IMPORT_CHANGES`, `_escapeHtml`, `_runInComponentSSR`, `_assignOwnerPath`, `_ownerCounter`, `_currentOwnerPath`, `__flushOutsideServerContext`, `__outsideServerContext`, `__markServerProcess`, `_rowKeyDigest`, `__invalidateFromDevtools`, `_tagQueries`, `_formStatus`, `_formStatusContext`, `_resetForm`, `_devAction`, `__DEV__`, `_urgent`, `_currentTransition`, `_onCommit`, `_pathLoaded`, `isVNode` |

<!-- import-changes:end -->

## Hooks hand you accessors

The hooks kept their call shapes (what changed for `useId()`, `onCleanup()`
and context is under Behaviour changes), but the docs used to say React's
names "mean what they mean in React", which is wrong for the values they
return. This is the contract:

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

## Behaviour changes

Each entry says what changed, whose code it affects, and what to do about it.

### Effects and batch

[EFFECT-TIMING.md](EFFECT-TIMING.md) describes the 0.15 model in full. These
are the differences from 0.14.

- **Effect order.** 0.14 sorted the effects due in a flush by their depth in
  the graph, so an effect that read a signal directly ran before one that read
  it through computeds. 0.15 runs render-phase effects (`effect(fn)`, which
  includes every DOM binding) before user-phase effects
  (`effect(fn, { phase: 'user' })`), runs an effect before the effects created
  during its run, and otherwise follows the order in which the write reached
  them ([Effect Ordering](EFFECT-TIMING.md#effect-ordering)). Each effect still
  sees settled values and runs at most once per round. This affects an effect
  that counts on another effect having run earlier in the same flush. If it
  reads DOM that a binding writes, make it `{ phase: 'user' }`; if it reads
  something another effect computed, keep that value in a signal or a
  `computed()` and read it there, so the engine orders the two.
- **`batch()` returns the callback's value.** `batch(fn)` returned `undefined`
  in 0.14; it now returns what `fn` returns. Effects still run once,
  synchronously, when the outermost batch ends, except when the batch ends
  inside an effect's run or a computed's evaluation: 0.14 ran the effects
  there, in the middle of that run, and 0.15 leaves them to the flush already
  running, or to the next microtask. This affects an effect that calls
  `batch()` and expects the other effects of those writes to have run when it
  returns. Read the signals you wrote instead (a read is always current), or
  move the work that needs those effects into an effect of its own.
- **`onCleanup()` follows the owner, and inside an effect, the run.**
  `onCleanup(fn)` attaches to the component being rendered, or else to the
  reactive owner around the call (`createRoot`, a list row, a mount root, a
  run of an effect, which includes an `onMount` or `useEffect` callback).
  Inside an effect it belongs to that run: it runs before the effect's next
  run, with the values of the run that registered it, and when the effect is
  disposed (a run's cleanups newest first, then the function the effect
  returns). With no owner at all (at module scope, or after an `await`) it does
  nothing, and development reports `ERR_CLEANUP_WITHOUT_OWNER`, because
  nothing would ever run the cleanup. In 0.14 the root entry's `onCleanup`
  threw outside a component (an effect's re-run included), and
  `onRootCleanup` handed each cleanup to the root current at the time, so a
  cleanup registered in an effect ran only when that root was disposed, or
  never when no root was current. Replace `onRootCleanup` with `onCleanup`.
- **An effect owns what its run creates.** Effects, computeds, roots and
  `onCleanup` callbacks created while an effect runs belong to that run: they
  are disposed before the effect runs again, and when it is disposed. A
  computed owns what its evaluation creates the same way
  ([EFFECT-TIMING.md](EFFECT-TIMING.md#effects-and-component-lifecycle)). In
  0.14 an effect re-ran under no owner, so what a re-run created lived until
  it was disposed explicitly, unless a `flushSync()` or `batch()` called
  inside `createRoot` handed it to that root. This affects code that disposed
  a nested effect by hand from the outer effect's cleanup (the disposal is
  now done for you, and a second call does nothing), and code that expected a
  nested effect to outlive the run that created it: create that one outside
  the outer effect.
- **`useEffect` and `onMount` run after the bindings of their flush.** They
  are user-phase effects of their component: the first run comes in the flush
  that follows the component's creation (the microtask after the code that
  built it, the end of the outermost `batch()`, or the user round of the flush
  whose region built the component), after that flush's DOM bindings, and a
  `useEffect` re-run is user-phase too
  ([EFFECT-TIMING.md](EFFECT-TIMING.md#useeffect-timing)). In 0.14 a
  `useEffect` re-run was a render-phase effect that could see a binding's
  previous DOM, and `onMount` ran on a microtask outside the flush. This
  affects code that called `flushSync()` right after mounting and expected
  them not to have run yet, and code that relied on the previous DOM. An
  error they throw now reaches the nearest `<ErrorBoundary>`.

### Hooks, context and components

- **A component is an owner.** Its hooks and context resolve through the
  owner chain, so `useContext` returns the provider's value in an effect
  re-run, a region or a list row long after the body ran; 0.14 read a
  component stack that was empty by then, so the same call reported
  `ERR_HOOK_OUTSIDE_COMPONENT` and returned the default. Everything a
  component creates, a bare `effect()` in its body included, is disposed with
  it, and so with the function `mount()` returns, whether the tree was built
  from compiled JSX or `h()`; 0.14's unmount reached only what was anchored to
  a DOM node, so a bare `effect()` in a component mounted as compiled JSX kept
  running. `mount()` into a container that already holds a mounted or
  hydrated tree disposes that tree first.
- **`<ErrorBoundary>` catches errors after mount.** It catches what its
  children throw while they are built and afterwards: an effect re-run or
  cleanup, a binding, a list row, a component a region builds later, a
  `useEffect` or `onMount` callback. 0.14 caught only errors thrown while the
  children were built; a later one went to the console and left the DOM as it
  was. This affects code that let a later error pass a boundary on purpose.

- `useId()` returns a string, as in React. It used to return a getter. A
  component runs once, so the string is stable for its life. `useDescribedBy`'s
  `descriptionId` and `useLabelledBy`'s `labelId` are strings for the same
  reason. Use the value where you called the getter: `id` instead of `id()`.
- A context is its own provider, as in React 19: `<Theme value="dark">` and
  `<Theme.Provider value="dark">` render the same component, so 0.14 code
  keeps working.
- Reading a context created with `createContext()` (no default) with no
  provider above the reader reports `ERR_CONTEXT_NOT_PROVIDED` in development.
  Production still returns `undefined`. Give the context a default, or render
  a provider above the reader.
- `useFocus()` tracks focus from its first call, starting from the element
  that has focus then. Before, every app registered a document `focusin`
  listener at startup whether or not it used focus tracking. Call `useFocus()`
  before the focus change you want it to see.

### Async values

[ASYNC.md](ASYNC.md) describes the model; each change below has its migration.

- **A computed whose function returns a promise is an async value.** It
  resolves the promise, keeps its last value while a newer run is in flight,
  and a binding that reads it before the first value lands waits for it (under
  a `<Suspense>`, the fallback shows). 0.14 handed the promise to its readers.
  To keep a promise as the value, use `useMemo` or wrap it:
  `computed(() => ({ promise }))`.
- **A `computed`/`useComputed` function that declares a parameter receives
  `{ signal }`** (the run's AbortSignal) and starts when it is created. Drop the
  parameter, or pass the signal to `fetch`.
- **`createResource`'s `data` is an async value.** It returns
  `[data, { loading, error, refetch, mutate }]` as before, but `data` has no
  `.set`, a read before the first value waits or suspends instead of returning
  `null`, `loading` and `error` are accessors, and `refetch` returns a promise
  that never rejects. Put a `<Suspense fallback>` around it (or read
  `loading()` and `data.peek()`), and write with `mutate(value)`.
- **`<Suspense>` shows its fallback for async values on first load only.**
  After the content has shown, a refresh keeps it mounted (read `c.pending()`
  to show staleness); a component that suspends again (`lazy()`,
  `use(promise)`) brings the fallback back and keeps the content mounted behind
  it. `onMount` and `useEffect` under a boundary that has not shown its content
  run when it does.
- **what-server's `useOptimistic` is React 19's.** `useOptimistic(initial,
  reducer)` returned `{ value, isPending, addOptimistic, resolve, rollback,
  withOptimistic, set }`; it is now the root entry's `useOptimistic(state,
  update)`, returning `[optimistic, addOptimistic]`. Write
  `startTransition(async () => { add(x); serverState(await action()); })`:
  a rejection rolls the overlay back, and the promise `startTransition`
  returns rejects.
- **`useTransition` and `startTransition` are React's** (see the Renamed table
  for the animation helper), and `validateImports` no longer redirects them.
- An `async` function passed to `effect`/`useEffect` reports
  `ERR_ASYNC_EFFECT` in development: fetch with an async computed instead.

### Data, actions and routing

[DATA.md](DATA.md) describes the layer: one query cache whose entries are
async values, `query(key, fetcher)` beside the hooks, React 19's action hooks,
and navigations that are transitions. Each change below has its migration.

- **`useQuery`/`useSWR`/`useInfiniteQuery`/`useFetch` read one cache of async
  values.** Their shapes and options stay. A `queryKey` (or SWR key) may be a
  function of signals, and the query follows it to the new key's entry; a
  static array is still read once. A signal read inside `queryFn`/`fetcher`
  still refetches, under the same key: move it into a function key.
- **`invalidateQueries` returns a promise** that resolves once the refetches
  it started have landed. Ignoring it is unchanged.
- **Callbacks fire once per landing**, for the reader that started the fetch
  (an invalidation's belongs to the key's first reader). Two readers of one
  key no longer both run `onSuccess` for one response.
- **Unmounting the last reader of a key while its fetch is in flight cancels
  the fetch**, and a remount fetches again. **`setQueryData` drops a fetch in
  flight** for its key, so a late response cannot overwrite it.
- **what-server's `useAction`, `useFormAction`, `useMutation` and `formAction`
  are removed.** Use `useActionState` from `what-framework`
  (`const [result, run, isPending] = useActionState((prev, args) => save(args), null)`),
  call the action inside `startTransition`, or pass it to
  `<Form action={save}>`. Return an error from the action to show it, or let
  it reach an `<ErrorBoundary>`.
- **A server action called on the client is a transition.** It joins the
  transition it is called in, and its `revalidate` paths
  (`invalidatePath`, which now also refetches the queries read on the path) and
  `invalidates` query keys refetch inside it; it resolves once they have landed.
  `onRevalidate`/`invalidatePath` come from `what-framework/data` (what-server
  re-exports them).
- **`<Form>` accepts a client function** (`useActionState`'s dispatch), runs
  its submit as a transition when mounted (with `useFormStatus()` inside it),
  renders the CSRF field only when it has a token, and no longer warns about
  a missing one.
- **The action endpoint refuses cross-site posts** (`Sec-Fetch-Site:
  cross-site`/`same-site`, or a foreign `Origin`) with 403, token or not, and
  accepts same-origin ones without a token, which is how forms on cached pages
  post. Another origin of the app needs
  `createRequestHandler({ csrf: { trustedOrigins: [...] } })`.
- **`ERR_FORM_ACTION_NOT_REGISTERED` is gone**: a plain function is a valid
  `<Form action>`.
- **A navigation waits for its destination.** `navigate()` and `<Link>` load
  a `lazy()` route's chunk and run its new `preload`, while the old page
  stays, then commit the URL in `startTransition`. The fallback a lazy route
  showed on navigation no longer appears (it still does on first load), a
  navigation started while another is preparing supersedes it instead of being
  dropped, and `navigate()` resolves once the new page is on screen.
  `{ flushSync: true }` commits at once.
- **`renderToString(vnode, { response })`** takes a response to read the
  status and headers back from, and `renderToStringAsync` returns it as
  `response`.

### Lists

- **A keyed `.map()` row follows an item replaced under its key.** A row is
  kept, with its DOM, for as long as its key is in the list; when an immutable
  update or a refetch hands it a new object with the same key, compiled rows
  read the new item in place (what-compiler reads the item through the row's
  item cell), and a row that passed the item to a component, which reads its
  props once, is built again from it. 0.14 kept showing the first object. An
  `h()` or JSX-runtime row is a vnode made again on every run, so a kept key
  whose vnode renders different data gets a row built from the new vnode;
  functions in a kept row are the ones it was built with. This affects code
  that relied on a row ignoring a new item with the same key.

### Hydration

- **`hydrate()` returns the unmount function**, as `mount()` does; 0.14
  returned a node, an array or `null`. It also accepts a selector, and a third
  argument `{ onHydrationError }`. Hydrating or mounting into a container that
  holds a root disposes that root first. Write
  `const unmount = hydrate(<App />, el)`, and query the container for nodes.
- **`hydrate()` adopts the server's DOM.** Where the markup matches, no node is
  created, each reactive child runs once and nothing the server sent is
  fetched again; where it differs, only the differing part is rendered on the
  client. Compiled JSX adopts server markup when compiled with what-compiler's
  `hydratable` option: `what-compiler/vite` turns it on (`hydratable:
  'auto'`) for a project that renders on the server (`appType: 'custom'`,
  `build.ssr`, `build.ssrManifest`); set `what({ hydratable: true })` for the
  client build otherwise. JSX compiled without it renders on the client and
  reports one `ERR_HYDRATION_MISMATCH` of kind `not-hydratable`.
- **`ERR_HYDRATION_MISMATCH` carries a record** `{ kind, component, ownerPath,
  path, expected, found, recovery }`, in development and, through
  `onHydrationError`, in production; the "already built DOM" warning is now
  kind `not-hydratable`.
- **Every hydratable server renderer writes one protocol.** `renderToStream`,
  `renderToStringAsync`, `renderDocument` and `renderDocumentStream` write
  `data-hk` keys (owner paths, `0`, `00`, …, instead of `h0`, `h1`) and comment
  markers around reactive children, arrays and boundaries, as
  `renderToHydratableString` does. A test that matches exact HTML strips them,
  or renders with `renderToString`.
- **Vnodes are recognised by a brand.** Only `h()`, the JSX runtime and the
  boundaries make vnodes: an object shaped `{ tag, props, children }` (from
  JSON, a store, a literal) renders as its text on the client, on the server
  and in islands, and `vnode._vnode` and `el._vnode` are gone. Make elements
  with `h()` or JSX; a library checks with `isVNode` from `what-core/internal`.
  A component that returns a plain object renders it as text on the server
  instead of throwing `ERR_INVALID_SSR_TAG`.
- **An island's vnode prop is revived only where the server recorded one**
  (`data-island-vnodes`); other vnode-shaped data stays data.

### Server rendering

The [what-server README](../packages/server/README.md) documents each of these.

- **`renderToStream()` returns a stream object.** 0.14 returned an
  `AsyncGenerator<string>` and took a render context as its second argument.
  0.15 returns a `RenderStream`, `{ shellReady, allReady, response, pipe,
  readable, abort }`, which is also async-iterable, and takes options
  (`loaderData`, `request`, `response`, `signal`, `nonce`, `noScripts`,
  `onError`, `idPrefix`). It sends the shell first and each `<Suspense>`
  boundary when its data is ready. This affects code that calls `.next()` on
  the result, which now throws a `TypeError`, or passes a second argument.
  Consume the stream one way: `for await (const chunk of stream)` works as
  before; in Node, `await stream.shellReady`, then `stream.pipe(res)`; on a
  Fetch host, `new Response(stream.readable)`. Pass loader data and the
  request as options
  ([Streaming SSR](../packages/server/README.md#streaming-ssr)).
- **`renderToStringAsync()` waits on the streaming engine.**
  `renderToStringAsync(vnode, init?, options?)` renders on the same engine as
  the stream and waits for everything the stream waits for (a resource inside
  or outside a `<Suspense>`, an async component, `lazy()`); 0.14 re-rendered
  the whole tree until its resources settled. A resource with no `key` is
  returned in `owned`, by owner, no longer in `resources` under `__r0`,
  `__r1` and so on. The second argument is the render's inputs,
  `{ loaderData?, signal?, request?, response? }` (a `createResponse()`);
  any other field, or a value of the wrong kind, rejects with a `TypeError`.
  This affects code that builds its own hydration payload from the result:
  send `owned` along with `resources`, or let `renderDocument()` write the
  payload.
- **A render sets its status, headers and redirect.** New in 0.15: a page's
  loader receives `response`, and a component reaches the same object with
  `getResponse()` from `what-framework`. `response.redirect(path, status =
  302)` takes a same-origin path only, so it is safe to hand request data;
  leaving the site is `response.redirectExternal(url, status)`, for an
  absolute `http:` or `https:` URL. A target that either method refuses
  redirects to `/` instead, and development logs `ERR_SSR_UNSAFE_REDIRECT`.
  what-router's `redirect()` thrown from a component body still escapes
  `renderToString()` as a `RouterRedirect` error, as in 0.14; route middleware
  that redirects (a path, or `redirect()`), `<Redirect>` and a `guard()` path
  fallback redirect the render's response. To redirect from a server render, call
  `getResponse().redirect('/login')`; the deploy adapters answer with the
  3xx, and a custom server passes a `createResponse()` in and reads it back
  ([Loaders, status and redirects](../packages/server/README.md#loaders-status-and-redirects)).
- **A `mode: 'server'` route streams.** The deploy adapters send a
  server-mode route's document shell-first (`renderDocumentStream()`); 0.14
  rendered the whole document before answering. The status and headers are
  final when the shell is ready, so a redirect set inside a boundary that
  streams later reaches the browser as a script. This affects a server route
  that decides its status, headers or redirect inside a `<Suspense>`. Decide
  them in the loader, or set `page: { stream: false }` on the route to buffer
  it as 0.14 did.
- **Cached routes are stored only when they are public.** As in 0.14, what-isr
  stores only a 200 render. It now also treats as private, and never stores
  or shares, a render that sets a cookie, sets `Cache-Control` with `private`,
  `no-store` or `no-cache`, sets `Vary`, or reads a request header the route's
  `vary` does not name (a cookie, `Authorization`, `Accept-Language`). A stored
  page keeps the other headers it set. This affects a `static` or `hybrid`
  route whose loader reads cookies or other request headers: 0.14 stored the
  render it made for one visitor and served it to everyone, and 0.15 renders
  for each visitor and caches nothing. Name the header in the route's `vary`
  (`page: { vary: ['cookie:session'] }`) to cache one entry per value
  ([Cached routes and the response](../packages/server/README.md#cached-routes-and-the-response)).
- **Error details stay on the server.** A failed component's
  `<!-- SSR Error -->` comment and a resource's error record carry the error's
  message only when `NODE_ENV` is exactly `development`; 0.14 included it
  whenever `NODE_ENV` was not `production`, unset included. This affects
  anyone who reads server errors in the page source of a staging or test
  server. Read them from `onError` instead: `renderToStream()`,
  `renderToStringAsync()`, `renderDocument()` and `createRequestHandler()`
  take one, and the default logs with `console.error`.
- **`exportStatic()` reports redirects and skipped pages.** It resolves
  `{ pages, redirects, skipped }`; 0.14 resolved `{ pages }`, and its type
  said `string[]`. Each page's loader and components get a `response`: a page
  that redirects is written as a redirect stub and listed in `redirects`, and
  a page that sets any status but 200 is not written, since a static host
  cannot send it, and is listed in `skipped`, with a warning. This affects
  build scripts that read the result. Read `result.pages`, and check
  `result.skipped`
  ([Static export](../packages/server/README.md#static-export-any-cdn-nginx-s3-github-pages-netlify)).

### The compiler

The [what-compiler README](../packages/compiler/README.md) documents the
options.

- **Upgrade it with the runtime, and recompile compiled libraries.**
  what-compiler 0.15 and what-core 0.15 work only with each other, in both
  directions. 0.15's output imports runtime helpers that what-core 0.14 does
  not have (a keyed list imports `_$mapKeyed`, so the page fails with
  `does not provide an export named '_$mapKeyed'`). The 0.15 runtime trusts
  the compiler's namespace flag: a template compiled by 0.14 whose root is an
  SVG or MathML element other than `<svg>` and `<math>` (`<g>`, `<circle>`,
  `<mi>`) has no flag, so development throws `ERR_TEMPLATE_NAMESPACE` and
  production renders it as an unknown HTML element, which draws nothing. This
  affects every app and every library that publishes compiled What output.
  Install what-compiler at the version of what-framework (what-framework 0.15
  depends on both at that version), and publish libraries compiled with
  what-compiler 0.15.
- **Server transforms compile for the server.** The Vite plugin's `ssr`
  option, on by default, compiles a module Vite transforms for the server with
  the server target, which every what-server renderer accepts. 0.14 refused
  such a module with `ERR_COMPILED_JSX_IN_SSR` whenever its output built DOM,
  so server-rendered views had to use `h()` or the automatic JSX runtime. This
  affects SSR setups that kept views away from what-compiler (they can compile
  them like the client now), and test runners that set `ssrGuard: false` to
  get DOM output from server transforms (Vitest under
  `environment: 'node'`): set `ssr: false, ssrGuard: false`
  ([Server builds](../packages/compiler/README.md#server-builds)). With the
  Babel plugin, the server target is `generate: 'ssr'`.
- **Selection comparisons become selectors.** `autoSelector`, on by default,
  rewrites `selected() === row.id` (or `!==`) in a render binding of a keyed
  `.map()` row into a `createSelector` lookup, so a selection change re-runs
  two rows instead of every row. The value is the same, and it fires only when
  `selected` is an accessor declared outside the row and the other side reads
  the row's names without calls. In development each file with a rewrite logs
  it once. This affects a comparison whose `selected()` does more than read a
  signal. Opt out with a `/* @what-no-selector */` comment before the
  comparison or before the `.map()` call, or for a whole build with
  `autoSelector: false`.
- **Development output carries names and locations.** The new Babel option
  `devMetadata` names components, What's `signal` and `effect`, and bindings
  with their source location (`"Row@src/App.jsx:12:5"`), for devtools and
  diagnostics. The Vite plugin turns it on in the dev server and never in
  `vite build`; a production build is byte-identical either way. This affects
  tests that snapshot the compiler's development output, which now include
  these strings, and Babel setups that want the names: pass
  `devMetadata: true` in development.
- **Markup the HTML parser would move fails the build.** Both targets reject a
  `<div>` in a `<p>`, a `<tr>` directly in a `<table>` and the like with
  `ERR_INVALID_HTML_NESTING` at `path:line:column`; the server target also
  rejects static values it would refuse at run time (a `javascript:` URL, a
  static `srcdoc`, a string `innerHTML`) with `ERR_UNSAFE_STATIC_MARKUP`. 0.14
  compiled such markup, and the browser restructured it under the bindings
  that pointed into it. Write markup the parser keeps: a `<tbody>` around the
  rows, a `<div>` in place of the `<p>`.

### Diagnostics

- **A signal used as a value is reported, and looks as it does in
  production.** In development, a signal or computed converted to a string or
  a number (`` `${count}` ``, `count + 1`) reports `ERR_MISSING_SIGNAL_READ`,
  with or without what-devtools, and converts as it does in production: to
  the function's source text. In 0.14 only an app with what-devtools got the
  report, and there the conversion returned the signal's value, so the page
  looked right in development and broke in production. Call the signal:
  `count()`.
- **Development warnings are coded.** What 0.14 printed as free text (a plain
  value in a `useEffect` dependency array, `useContext()` outside a component,
  `flushSync()` inside an effect, a looping effect) is a coded diagnostic in
  0.15: the console line starts with `[what] ERR_…`, `getDiagnostics()` and
  `subscribeDiagnostics()` read it, and `captureDiagnostics()` from
  `what-framework/testing` collects it in a test. A looping effect is stopped
  after 100 flush rounds (0.14: 25) and reported as `ERR_INFINITE_EFFECT`,
  with its name. This affects tests and tools that matched the old console
  text: assert on the code. [ERRORS.md](ERRORS.md) lists every code.

### Bundle size

`npm run check:size` builds each app below for production and holds its
minified, gzipped size to a ceiling in [.size-budgets.json](../.size-budgets.json),
which records the cause of every change.

| App | 0.14 | 0.15 |
|---|---|---|
| A counter written with `h()` | 6601 B | 8889 B |
| The create-what counter, runtime JSX | 6702 B | 8929 B |
| The create-what counter's JavaScript, built as the scaffold builds it (what-compiler), without the modulepreload polyfill Vite adds to a build from `index.html` | 7731 B | 6386 B |

The compiled counter, what the scaffold ships, is 1345 B (17%) smaller in
0.15: compiled output no longer carries the vnode reconciler. 0.14's numbers
include development-only code (828 B of the `h()` counter: 5773 B with its
flag folded out), which 0.15 leaves out of production builds; the `h()`
counter still grows by 2288 B, for the new engine, the engine hooks async
values and transitions need, and for fixes to keyed rows, class composition,
delegated events, hydration, `<Suspense>` release and SVG animation URLs. The
production build (`dist/*.min.js`, what the `production` export condition
resolves) has one file per source module instead of one shared chunk, so an
app bundled from it is as small as the same app bundled from source, and a
compiled app with no `h()`, boundary or portal leaves the vnode renderer out.
Loading the dist straight into a browser without a bundler fetches more,
smaller files. This affects an app written with `h()` that has a size budget:
compiled with what-compiler, the same counter is 6386 B.

Three kinds of app grow more than the counters:

- **An app that calls `computed()`** brings the async core with it
  ([ASYNC.md](ASYNC.md)): the compiled counter with one `computed()` is
  9117 B, against 7979 B in 0.14 (+1138 B).
- **An app that hydrates** carries the hydration runtime: the compiled
  hydrating counter is 18182 B, the same app mounted without hydration 8920 B.
  0.14's compiler had no hydratable output to compare with.
- **A production build that does not resolve the production files.** Each
  export of what-core, what-router and what-server has three: `production`
  (`dist/*.min.js`, development code removed), `module` (`dist/*.js`, every
  development check reading `process.env.NODE_ENV`) and `src/` for
  `development`, `node`, `import` and `default`. Vite with what-compiler, webpack 5
  and Rollup with @rollup/plugin-node-resolve select `production` in a
  production build. esbuild's and rolldown's default conditions and
  `bun build --production` select `module`, and each defines
  `process.env.NODE_ENV` itself: `"production"` when it minifies (Bun: with
  `--production`), `"development"` otherwise. So `esbuild app.js --bundle
  --minify` builds the `h()` counter at 8892 B, and an unminified esbuild or
  rolldown build with no `NODE_ENV` of your own is a development build, with
  its diagnostics: minify, or define `process.env.NODE_ENV` as `"production"`,
  for production. A bundler given custom conditions with neither `production`
  nor `module` bundles `src/` and its development tier (esbuild
  `--conditions=browser`: 31574 B), whatever `process.env.NODE_ENV` says. Add
  `production` to such a list.
- **Development builds report diagnostics in every bundler.** The source reads
  its flag through what-core's `#env` import, by the same conditions: under
  `development` it is on. Vite's dev server, webpack's development mode, Rollup
  with node-resolve and `NODE_ENV=development` (node-resolve picks `production`
  when `NODE_ENV` is unset), and a default `bun build` all resolve it, so their
  builds report in the browser with no `process` in the page; in 0.14 Bun's and
  Rollup's needed `globalThis.__WHAT_DEV__`. Elsewhere the source decides at
  runtime, from `__WHAT_DEV__`, Vite's `import.meta.env.DEV`, or a server
  runtime's `process.env.NODE_ENV`, and markup on the page that names a global
  `process` (`<form id="process">`) no longer switches it. A bundle built for
  Node and served to a browser (esbuild `--platform=node`) resolves `src/`
  without `development`, so a browser runs it as production with its
  development code still in it: give it `--conditions=development` or
  `--conditions=production`.

### Companion packages

Every package moves with what-framework ([Before you start](#before-you-start)).
Beyond that:

- **what-text**: 0.14 imports `_setTextInsertHook` from the what-core root,
  which 0.15 moved to `what-core/render`, and it declared its peer as
  `what-core >=0.7.0`, so npm keeps it beside what-core 0.15 without a warning
  and the app fails at import with `The requested module 'what-core' does not
  provide an export named '_setTextInsertHook'`. Install what-text 0.15.
- **eslint-plugin-what**: one rule was renamed and one retired, and ESLint
  stops with a configuration error on a config that still names either
  (`Key "what/no-destructured-props": Could not find "no-destructured-props"
  in plugin "what"`). The presets are updated; this affects a config that
  lists the rules itself.
  - `what/no-signal-in-effect-deps` is now `what/no-signal-read-in-effect-deps`,
    and it reports the opposite case. 0.14's rule reported an accessor in a
    `useEffect` dependency array (`[count]`) and suggested the value
    (`[count()]`), which is the mistake: a value never changes, so the effect
    never re-runs, and the runtime reports `ERR_EFFECT_DEP_NOT_FUNCTION`. The
    new rule reports `[count()]`, and `eslint --fix` rewrites it to `[count]`.
    Rename the rule in your config, then run the fix over the arrays written to
    satisfy the old rule.
  - `what/no-destructured-props` is retired: a component receives its props
    as the plain values the parent passed, so destructuring them is fine. A
    value that changes is passed as its accessor and called where it renders.
    Delete the rule from your config.
  - `what/no-moved-imports` is new, an error in every preset, with an autofix
    ([For agents and tools](#for-agents-and-tools)).
- **what-devtools**: `subscribe()` events carry ids instead of the registry
  entry. `signal:created` is `{ id, name, componentId }` (0.14 also sent `ref`
  and `createdAt`), `effect:created` is `{ id, name, kind, componentId }`, and
  `component:mounted` is `{ id, name, parentId }` (0.14 also sent `element`
  and `mountedAt`). `safeSerialize(value, depth)` became
  `safeSerialize(value, budget)`, a size in characters of JSON. A subscriber
  that needs the signal, the element or a timestamp looks the entry up by id
  in the exported `signals`, `effects` or `components` map
  ([Event Subscription](../packages/devtools/README.md#event-subscription)).
- **what-devtools-mcp**: see [MCP tools](#mcp-tools).
- **what-server** and **what-isr**: see [Server rendering](#server-rendering).
- **what-compiler**: see [The compiler](#the-compiler).
- **what-router**: navigations are transitions; see [Data, actions and routing](#data-actions-and-routing).
- **what-react**: nothing to change in your code.

## MCP tools

<!-- tool-changes:start (generated by scripts/generate-import-changes.mjs; edit packages/devtools-mcp/tool-changes.js) -->

what-devtools-mcp 0.14.0 registered 29 tools. 6 of them are gone, `what_events`, `what_why` are new, and the server now registers 25. A call to a removed tool fails with `MCP error -32602: Tool … not found`; make the call on its row instead.

| Removed | Use instead |
|---|---|
| `what_component_tree` | `what_components({ tree: true })` |
| `what_diff_snapshot` | `what_snapshot({ mode: "save" })`, then `what_snapshot({ mode: "diff" })` |
| `what_watch`, `what_record_window` | `what_events({ after: seq })` |
| `what_validate` | `what_lint({ code })` (it now compiles the snippet, offline) |
| `what_perf` | `what_diagnose({ focus: "performance" })` |

<!-- tool-changes:end -->

Every answer is compact JSON: 0.14's prose `summary` is gone, and every live
answer carries `seq`, the event cursor `what_events` reads from. A page no
longer fetches its credential from the bridge: the what-devtools-mcp Vite
plugin pairs it, and a dev server other than Vite serves the same endpoint
with `createDiscoveryHandler({ root })`
([Setup](MCP-DEVTOOLS.md#2-configure-vite)). This affects scripts and prompts
written against 0.14's tools: make the calls in the table, and read the
answer's fields. [MCP-DEVTOOLS.md](MCP-DEVTOOLS.md) documents every tool.
