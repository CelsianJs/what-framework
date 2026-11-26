<!-- Generated from docs/UPGRADING.md by scripts/generate-import-changes.mjs: edit that file, then run `npm run docs:imports`. -->
# Upgrading to 0.15

0.15 reshapes the public surface. The root entry, `what-framework`, went from
177 names to <!-- root-count -->59<!-- /root-count -->: reactivity, async values, components and
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
   `eslint-plugin-what`. npm refuses to upgrade what-framework or
   what-compiler alone (`ERESOLVE`); pnpm, Yarn and Bun install the mix, so
   check both versions there ([The compiler](#the-compiler)). npm does not
   catch every package left behind: what-text 0.14 accepts what-core 0.15 and
   then fails at import ([Companion packages](#companion-packages)).
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
   [ERRORS.md](https://github.com/CelsianJs/what-framework/blob/main/docs/ERRORS.md) has the fix for each code.

## Where things are

| Import from | What it holds |
|---|---|
| `what-framework` | `signal`, `computed`, `effect`, `batch`, `untrack`, `flushSync`, `createRoot`, `getOwner`, `runWithOwner`, `createSelector`; `refresh`, `isPending`, `startTransition`, `useTransition`, `useOptimistic`, `use`, `settled` (async values, [ASYNC.md](https://github.com/CelsianJs/what-framework/blob/main/docs/ASYNC.md)); `h`, `Fragment`, `html`, `mount`, `hydrate`, `applyStreamedBoundaries`; `useState`, `useSignal`, `useComputed`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `useReducer`, `useId`, `createContext`, `useContext`, `onMount`, `onCleanup`, `createResource`, `useLoaderData`; `useActionState`, `useFormStatus` (actions, [DATA.md](https://github.com/CelsianJs/what-framework/blob/main/docs/DATA.md)); `memo`, `lazy`, `Suspense`, `ErrorBoundary`, `Show`, `For`, `Switch`, `Match`, `Portal`; `createStore`, `derived`; `Head`, `getResponse`; `getDiagnostics`, `subscribeDiagnostics`, `clearDiagnostics`, `getErrorDefinition`, `WhatError` |
| `what-framework/a11y` | focus management, ARIA state helpers, announcements, `useIds`, keyboard helpers |
| `what-framework/ui` | skeletons and loading placeholders |
| `what-framework/motion` | `spring`, `tween`, `easings`, `useTween`, `useGesture`, `useAnimatedValue`, CSS transitions |
| `what-framework/dom` | the DOM read/write scheduler, `cls`, `style`, `debounce`, `throttle`, `useMediaQuery`, `useLocalStorage`, `useClickOutside`, `clearHead` |
| `what-framework/form` | `useForm`, `useField`, `rules`, resolvers, bound field components |
| `what-framework/data` | `query`, `useFetch`, `useSWR`, `useQuery`, `useInfiniteQuery`, the query cache, `invalidatePath`, `onRevalidate` |
| `what-framework/render` | the compiled-JSX runtime: `template`, `insert`, `mapArray`, `spread`, `on`, … for code written without JSX; the compiler's own helpers are `_$`-prefixed (`_$Island`, `_$memo`) |
| `what-framework/server` | rendering, streaming, `Island`, actions, `<Form>`, the request handler and the deploy adapters ([what-server README](https://github.com/CelsianJs/what-framework/blob/main/packages/server/README.md)) |
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
| `what-core/internal` | `__depsOf`, `__subsOf`, `__currentEffect`, `__ownerOf`, `__ownerPath`, `reportDiagnostic`, `IMPORT_CHANGES`, `_escapeHtml`, `_runInComponentSSR`, `_assignOwnerPath`, `_ownerCounter`, `_currentOwnerPath`, `_actionStateKey`, `_actionKeySalt`, `_currentRowPath`, `_enterRow`, `_installRowKeys`, `_leaveRow`, `_renderSalt`, `_tracksRows`, `__flushOutsideServerContext`, `__outsideServerContext`, `__markServerProcess`, `_rowKeyDigest`, `_engine`, `_runComponentAsync`, `_runComponentSync`, `__invalidateFromDevtools`, `_tagQueries`, `_formStatus`, `_formStatusContext`, `_resetForm`, `_formMember`, `_devAction`, `__DEV__`, `_urgent`, `_currentTransition`, `_onCommit`, `_pathLoaded`, `_contextOf`, `_provide`, `_isServerProcess`, `isVNode`, `_claimRegion`, `_afterWalk`, `_devHoldsState`, `_mountPortal` |

<!-- import-changes:end -->

## Hooks hand you accessors

The hooks kept their call shapes (what changed for `useId()`, `onCleanup()`
and context is under Behaviour changes), but what they return is not what
React returns. This is the contract:

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

[EFFECT-TIMING.md](https://github.com/CelsianJs/what-framework/blob/main/docs/EFFECT-TIMING.md) describes the 0.15 model in full. These
are the differences from 0.14.

- **Effect order.** 0.14 sorted the effects due in a flush by their depth in
  the graph, so an effect that read a signal directly ran before one that read
  it through computeds. 0.15 runs render-phase effects (`effect(fn)`, which
  includes every DOM binding) before user-phase effects
  (`effect(fn, { phase: 'user' })`), runs an effect before the effects created
  during its run, and otherwise follows the order in which the write reached
  them ([Effect Ordering](https://github.com/CelsianJs/what-framework/blob/main/docs/EFFECT-TIMING.md#effect-ordering)). Each effect still
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
  ([EFFECT-TIMING.md](https://github.com/CelsianJs/what-framework/blob/main/docs/EFFECT-TIMING.md#effects-and-component-lifecycle)). In
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
  ([EFFECT-TIMING.md](https://github.com/CelsianJs/what-framework/blob/main/docs/EFFECT-TIMING.md#useeffect-timing)). In 0.14 a
  `useEffect` re-run was a render-phase effect that could see a binding's
  previous DOM, and `onMount` ran on a microtask outside the flush. This
  affects code that called `flushSync()` right after mounting and expected
  them not to have run yet, and code that relied on the previous DOM. An
  error they throw now reaches the nearest `<ErrorBoundary>`.
- **`useEffect` and `onMount` run in React's order.** A parent's effect now
  runs after its children's on mount, every cleanup of a flush runs before
  every run, children first, and a parent's cleanups run before its
  children's on unmount. Within a component, effects keep the order they are
  written in. `onCleanup` and `effect()` keep the owner's order. A 0.14
  workaround that registered children in their bodies keeps working; one
  that relied on the parent's effect running first (to set up something its
  children's effects read) moves that setup into the parent's body, which
  runs before every child ([GOTCHAS.md, 22](https://github.com/CelsianJs/what-framework/blob/main/docs/GOTCHAS.md)).

### Hooks, context and components

- **Props objects are plain objects.** A component's props, a rest element
  of them and a spread's merge inherit from Object.prototype, as React's do:
  `props.hasOwnProperty(k)`, `String(props)`, `props.valueOf()`, classnames
  and lodash's `isPlainObject` work, where they threw or answered false on
  0.14's objects with no prototype, and `props.constructor` is `Object`. This
  affects code that tests `Object.getPrototypeOf(props) === null`.
- **`onChange` fires on each keystroke, as React's does.** On a text
  `<input>` or a `<textarea>` it fires on each edit (keys, paste, undo,
  autofill) and not again on blur; on a checkbox, radio, select or file
  field, when the value changes. Work that ran when the user committed an
  edit (validation, saving, formatting) now runs on every key. Move it to
  `onBlur`, or listen for the DOM's change event on a field the user owns:
  `<input defaultValue={x} ref={(el) => on(el, 'change', commit)} />` (`on`
  from `what-framework/render`). A field whose `value` is bound to state and
  whose only handler was `onChange` now follows the state on each key: write
  the state in `onChange`, or use `defaultValue`. Handlers get the native
  event, so `e.type` is `'input'` while the user types.
  `register('x').oninput` is now `.onchange`.
- **A tag held in a binding is created in the namespace it stands in, and
  hydrates in place.** `<Tag {...rest} />` with `Tag` a string the compiler
  cannot read (`props.as`) rendered every element as HTML, so `as="circle"` in
  an `<svg>` or `as="mi"` did not draw; it is SVG or MathML by its name, and a
  name SVG shares with HTML (`a`, `title`) takes the namespace of the place
  the component is called in. While hydrating, such an element claims the
  server's element instead of replacing it (0.14 reported a `not-hydratable`
  mismatch and rendered it on the client). An `<ErrorBoundary>` whose
  `fallback` is a class component renders it with `{ error, reset }` (0.14
  called it as a function, which threw). A vnode made by another copy of
  what-core on the page (a library bundled with its own) is rendered by that
  copy when the copy rendering it has no vnode renderer, where 0.14 threw
  `ERR_NO_VNODE_RENDERER` in development and showed `[object Object]` in
  production; and `<option>`s one copy renders into the other copy's
  controlled `<select>` are selected as its value says.

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
- **A provider follows its `value`.** `<Theme value={theme()}>` in compiled
  JSX hands the readers each new value, as any other prop written this way
  stays live; the value is read once per change, so an object written there
  (`value={{ user: user(), setUser }}`) is one object for every reader until
  `user` changes. 0.14 read `value` once. A reader's `useContext(Theme)` in
  its body is still a read in a component that runs once: read it where it
  renders (`{useContext(Theme)}`), or pass the signal (`value={theme}`) and
  call it. An `h(Theme, { value: theme() })` call evaluates its argument
  once, as every `h()` argument is: pass the signal there.
- **A field whose `value` or `checked` is bound to state shows the state.**
  After each `input` or `change` event of an `<input>`, `<textarea>` or
  `<select>` whose `value` (or `checked`) compiled JSX binds to state
  (`value={name()}`, a live prop, a signal given as it is, or one of those
  through a spread in a wrapper component), once the handlers and the
  updates they caused are done, the field shows the bound value again: an
  edit the handler did not write back to the state is undone, a radio group
  goes back as a whole, and such a field with no handler cannot be changed by
  the user, as in React. 0.14 left the edit in the field, which then
  disagreed with the state. The check comes once every event of the user's
  action is handled: after the `change` of a click on a checkbox or radio or
  a pick in a select (which fire `input` first), so an `onChange` handler
  reads the new state. A text field is put back after each `input` its
  handlers didn't take; a handler counts while it is there (one `on()` added
  and removed does not), on the field or above it, compiled or made with
  `h()`.
  After its form's reset the field shows the bound value again, as React's
  does. A field that already shows the value is not
  written, so the caret stays; nothing is written while an input method
  composes; a field with `defaultValue` or `defaultChecked` and no `value` is
  the user's. A value that reads no state is still only where the field
  starts: a constant (`value="draft"`), what a spread reads once from a
  plain object (the forms kit's `{...register('title')}`), and every field
  made with `h()`. This affects a field bound to state only to start with
  something in it: write `defaultValue`. Write the state in the handler
  itself, not after an `await` or in a timer, or the field goes back first.
- **A function in a `useEffect` dependency array that is not a signal is
  reported.** A dependency array re-runs the effect for the signals and
  computeds in it. Any other function was, and is, never called (the array
  of a ported effect holds setters and callbacks), so an arrow written as a
  getter, `[() => props.count]`, never re-ran the effect, silently:
  development now reports `ERR_EFFECT_DEP_NOT_SIGNAL` for a function that
  takes no argument. List a computed (`useMemo(() => props.count)`), or omit
  the array.
- Reading a context created with `createContext()` (no default) with no
  provider above the reader reports `ERR_CONTEXT_NOT_PROVIDED` in development.
  Production still returns `undefined`. Give the context a default, or render
  a provider above the reader.
- **A function `key` on a component is a prop**, not the vnode key, unless it
  is a signal, so `<For key={(item) => item.id}>` reaches `<For>` under `h()`
  and the JSX runtime. A `key` that is a row's key value works as before.
- **`on(el, event, handler)` removes its listener when the current owner is
  disposed**, as a JSX event handler is. Attach a listener that must outlive
  the component outside it.
- **`memo` is no longer exported from `what-framework/render`.** That was the
  compiler's eager memo, now `_$memo`; the root `memo` is React's component
  memo, unchanged. Use `computed()` or `useMemo` where you imported it.
- `useFocus()` tracks focus from its first call, starting from the element
  that has focus then. Before, every app registered a document `focusin`
  listener at startup whether or not it used focus tracking. Call `useFocus()`
  before the focus change you want it to see.

### Async values

[ASYNC.md](https://github.com/CelsianJs/what-framework/blob/main/docs/ASYNC.md) describes the model; each change below has its migration.

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

[DATA.md](https://github.com/CelsianJs/what-framework/blob/main/docs/DATA.md) describes the layer: one query cache whose entries are
async values, `query(key, fetcher)` beside the hooks, React 19's action hooks,
and navigations that are transitions. Each change below has its migration.

- **`useQuery`/`useSWR`/`useInfiniteQuery`/`useFetch` read one cache of async
  values.** Their shapes and options stay. A `queryKey` (or SWR key) may be a
  function of signals, and the query follows it to the new key's entry; a
  static array is still read once. A signal read inside `queryFn`/`fetcher`
  still refetches, under the same key: move it into a function key.
  `queryFn` gets the reader's own key as it wrote it (`['todos', 1]`), even
  when another spelling (`'todos:1'`) created the entry they share.
- **`invalidateQueries` returns a promise** that resolves once the refetches
  it started have landed. Ignoring it is unchanged.
- **Callbacks fire once per landing**, for the reader that started the fetch
  (an invalidation's belongs to the active reader that attached last, as in
  TanStack Query). Two readers of one
  key no longer both run `onSuccess` for one response.
- **Unmounting the last reader of a key while its fetch is in flight cancels
  the fetch**, and a remount fetches again. **`setQueryData` drops a fetch in
  flight** for its key, so a late response cannot overwrite it; call
  `invalidateQueries` afterwards for a fresh copy.
- **`prefetchQuery`'s fetcher gets the key as written, plus `{ signal }`**,
  not the normalized string: read the array (`([, id]) => …`) or
  `String(key)`. **`setQueryData`'s updater gets `undefined`** for a key with
  nothing cached, not `null`: write `(prev = []) => …`.
- **The hooks render their first state on the server and while hydrating**:
  loading, or their own `initialData`/`fallbackData`. Right after hydration
  they show what the cache holds, with no request. To render data on the
  server, read it with `query()`, which the server renders and hands to the
  client.
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
- **`<Form>` resets at its submission's commit, only after the action
  succeeds.** As in React 19, the reset clears uncontrolled fields and keeps
  a controlled one (a `value` or `checked` prop) at what its prop holds. Code
  that relied on an immediate reset resets in the action's success path.
  `useFormStatus().action` is the action function or `null`: compare it with
  your function, not an id.
- **`enhanceForms()` submits a same-origin form without a token**, as the
  form's native submit would, and leaves the decision to the endpoint.
  `data-no-csrf` is gone: remove it, and check the response where you relied
  on the client-side "Missing CSRF token" refusal.
- **The action endpoint refuses cross-site posts** (`Sec-Fetch-Site:
  cross-site`/`same-site`, or a foreign `Origin`) with 403, token or not, and
  accepts same-origin ones without a token, which is how forms on cached pages
  post. Another origin of the app needs
  `createRequestHandler({ csrf: { trustedOrigins: [...] } })`. The server's
  own origin takes its scheme from the connection (a TLS socket, or the
  platform's URL), or from `X-Forwarded-Proto` when the request carries it:
  behind a TLS proxy that sends no `X-Forwarded-Proto`, make it send one, or
  list the app's https origin in `trustedOrigins`.
- **Every form POST to a page is read under `bodyLimit`.** An urlencoded or
  multipart POST to a page served by `createRequestHandler` is read first,
  from a copy, to look for `_action`, so one over `bodyLimit` (1 MB by
  default) gets an HTML 413 even when the page has no form action and its
  loader reads the upload itself (0.14 passed such a body through). Raise
  `bodyLimit` for a page that takes large uploads. An action call, or a form
  posted to the action endpoint, whose body does not parse as its content
  type says (a multipart body with the wrong boundary or cut short, JSON that
  is not JSON) is answered 400 and runs no action, on every entry point,
  where 0.14 ran the action with no fields; such a POST to a page names no
  action and reaches the page, as before.
- **A refused action call throws a coded error.** With JavaScript, a call
  over `bodyLimit` rejects with `ERR_PAYLOAD_TOO_LARGE` (`status` 413, `limit`
  the bytes allowed) and any other refusal with `ERR_ACTION_FAILED` and its
  `status`; the 413 answer's JSON carries `code` and `limit`. As any error an
  action throws, it reaches the `<ErrorBoundary>` above the component whose
  `useActionState` dispatched it, and a page with none shows nothing: wrap
  the form's component, and check a file's size before the form is sent
  ([what-server README](https://github.com/CelsianJs/what-framework/blob/main/packages/server/README.md#server-actions)).
- **A component's identity does not count an earlier list's rows.** A form
  after a keyed list (a `.map()` with `key`, a `<For key>`) gets its no-JS
  result back when rows were added or removed between the page and the post:
  the components in the list's rows no longer count toward the place of what
  follows it.
- **`ERR_FORM_ACTION_NOT_REGISTERED` is gone**: a plain function is a valid
  `<Form action>`.
- **A navigation waits for its destination.** `navigate()` and `<Link>` load
  a `lazy()` route's chunk and run its new `preload`, while the old page
  stays, then commit the URL in `startTransition`. The fallback a lazy route
  showed on navigation no longer appears (it still does on first load), and a
  navigation started while another is preparing supersedes it instead of being
  dropped. `navigate()` resolves, and `route.isNavigating` turns false, once
  the new page's first data has landed: data the page reads that `preload`
  does not return shows as pending after the commit, so return what the page
  needs at once from `preload`. `navigate(to, { flushSync: true })` commits at
  once.
- **Route middleware runs once per navigation**, before the route's
  `preload`, on the server and in the browser, and a route it declines is
  never prepared. The page renders by the verdict the navigation reached: a
  redirect it returned, a decline, or what it threw (`ERR_ASYNC_MIDDLEWARE` from an async one, which starts once). It
  runs again only when a signal it read changes. A middleware that calls
  `navigate()` supersedes its own navigation, and the route it was asked about
  is not prepared. This affects middleware with side effects that expected a
  second call at render.
- **The router commits the URL the address bar commits**, dot segments
  resolved (`/old/../find` is `/find`), and splits it as `URL` does (`??a=1`
  is the key `?a`). A path that starts `//` is that path, not another host.
- **`isSafeUrl` refuses an absolute URL the URL parser rejects**, where 0.14
  accepted any URL with a safe scheme, so `<Link href="http://[">` renders
  `href="about:blank"`.
- **A navigation that changes only the hash keeps the page**, as the browser
  does: `navigate('#teams')`, `navigate('/settings#teams')` on `/settings`,
  a `<Link>` to either, and the browser moving the hash. The URL and
  `route.hash` move and the element with that id scrolls into view; no
  guard, middleware or `preload` runs, and `beforeNavigate` and
  `afterNavigate` are not called. 0.14 rebuilt the page for a path with a
  hash. This affects code that ran in `afterNavigate` or a middleware for a
  hash change: read `route.hash` in an effect instead.
- **Parsed queries are typed `RouteQuery`**,
  `Record<string, string | string[]>`: `route.query`, `useSearch()`,
  `parseQuery()`, and the `query` routes, layouts, `preload` and middleware
  receive. A repeated key (`?tag=a&tag=b`) was already an array at runtime.
  Middleware is typed `(context: RouteMiddlewareContext)` and gets `url`, the
  destination's path, search and hash. This affects TypeScript code that
  typed a query as `Record<string, string>`: narrow the value
  (`Array.isArray(v) ? v[0] : v`), or name the shape
  (`useSearch<{ page?: string }>()`).
- **A `<Router>` inside another has route state of its own**, on the server
  and in the browser: what it renders reads the params and query it matched,
  and its parent's subtree keeps reading the parent's. In the browser the
  outermost Router keeps the routes `navigate()` prepares against. This
  affects a page that read a nested Router's params from outside it.
- **A server never navigates.** During a server render, route state
  (`route.url`, `route.query`, `route.params`, `useParams()`, `useSearch()`,
  `useRoute()`) is the request's own, and `navigate()` and a `redirect()`
  thrown from a component body under a `<Router>` redirect the response (as
  `<Redirect>` does); `navigate()` no longer leaves the process's router in a
  navigation that every later render showed. A `beforeNavigate` or
  `afterNavigate` subscribed anywhere in a server process is not kept. A
  `<Router url>` rendered on the server keeps route state of its own, and
  readers outside it see the request's URL: read the URL it was given inside
  it.

### Lists

- **A component that returns one element is that element in the DOM.** 0.14
  put `<!--c:start-->` and `<!--c:end-->` comments around every component's
  output; a compiled component whose function returns one element now has
  none, so `<Row key={item.id} item={item} />` is one node in its list, as a
  row written inline is. A component that returns anything else (a fragment,
  text, an array, a reactive child, nothing), a component built from vnodes,
  and one that threw or suspended keep the comments. A test or a script that
  looks for the comments around a compiled component, or counts the nodes
  beside it, queries the element instead.
- **One DOM element returned by two components is in one place.** A
  component that returns an element it did not build (a node kept in a
  variable, `props.node`) hands back that same node, and a node has one
  place: when two reactive children of the same parent each show a component
  that returns it, it moves to the second, and the first child's next content
  is put where the node went, not where it was. The comments 0.14 put around
  each component kept the two places apart; the element itself placed bare
  (`{cond() ? node : null}`, twice) has always moved this way. Return an
  element the component builds, or a copy (`node.cloneNode(true)`), when it
  can be shown in more than one place.
- **A keyed `.map()` row follows an item replaced under its key.** A row is
  kept, with its DOM, for as long as its key is in the list; when an immutable
  update or a refetch hands it a new object with the same key, compiled rows
  read the new item in place (what-compiler reads the item through the row's
  item cell), and a row that passed the item to a component, which reads its
  props once, is built again from it. 0.14 kept showing the first object. An
  `h()` or JSX-runtime row is a vnode made again on every run, so a kept key
  whose vnode renders different data gets a row built from the new vnode;
  functions in a kept row are the ones it was built with. This affects code
  that relied on a row ignoring a new item with the same key. A row that
  destructures its item (`({ id, label, ...rest }) => <li key={id}>…`)
  follows it too: what-compiler reads `label` as the item's field where it is
  used, and builds the rest element where the row is built, on both targets.
- **A key that reads the index keys the list, as React keys it.** `key={i}`
  and `` key={`${t.term}-${i}`} `` are keyed by item and position, with no
  warning: a row stays while its key does, so a refetch that hands the same
  places new objects keeps the rows and their state. 0.14 fell back to an
  unkeyed list for such a key, built again on every update (with a warning,
  except for a bare `key={i}`). A key built from a name the map callback declares still falls
  back, with a warning.

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
- **A keyed list's comment carries a salted digest of each key**,
  `<!--k:SALT:DIGESTS-->`: a random salt for each render, then each key's
  64-bit digest under it, eleven characters, instead of the keys. A server
  row is adopted only for the client key whose digest is its own. Code that
  parsed the comment should stop; a test that compares two renders' markup
  compares them without it (two renders have two salts).
  A list with a key hydration cannot compare (anything but strings and finite
  numbers) writes `<!--k!-->`, and the client builds that list and reports
  kind `key`, recovery `client-render`.
- **An island reports to the `onHydrationError` of the `hydrate()` that
  rendered it**, when it hydrates later, and `hydrateIslands()` and
  `autoIslands()` take `{ onHydrationError }`.
- **After `hydrate()` the page holds what a client render holds.** A server
  attribute survives only where a prop renders exactly its value, a URL the
  client refuses removes the attribute, a style object replaces the inline
  style, an element the client leaves empty is emptied (kind `extra-nodes`),
  and an element hosting a declarative shadow root is replaced (the new kind
  `shadow-root`). This affects pages whose server adds markup the client tree
  does not render, and code that switches over `kind`
  ([SECURITY.md](https://github.com/CelsianJs/what-framework/blob/main/SECURITY.md#hydration)).
- **Server output for a few elements changed.** `<textarea>` and `<title>`
  content is written as text, with no markers; a newline follows `<pre>`,
  `<textarea>` and `<listing>`, so a leading newline survives; and a compiled
  keyed row's plain field (`{row.label}`) is plain text with no `<!--$-->`
  markers. Tests that match exact HTML should expect these.
- **Compiled children hydrate in place, in order.** A component's children,
  a fragment it returns, a `<Show>`'s content and a row of several nodes adopt
  the server's nodes in document order, wherever the component places them
  and however it reads `children`. Before, children a component read before
  its own element (a destructured `children`, `<Head>`, what-core's form
  `<Select>`) claimed the server's nodes ahead of it, and text, a reactive
  child or a list written before an element (`<Button>Save <Icon /></Button>`)
  went after it: the subtree was built again or shown in another order, and
  what the user typed in it before hydration was lost. No code change; a
  component written with `h()` that places children given in compiled JSX
  sets `_deferChildren`
  ([API](https://github.com/CelsianJs/what-framework/blob/main/docs/API.md#placing-and-forwarding-children-and-other-jsx-props)).
- **JSX in a prop hydrates in place, and nothing is replaced silently.** JSX
  passed in a named prop (`header={<SearchBox />}`), a boundary's fallback
  handed on through a wrapper, a body child of `<Head>`, an array literal and
  adjacent components that return a fragment starting with text now adopt the
  server's nodes; before, they were built on the client and replaced the
  server's copy with no report, and what the user typed there was lost. JSX
  that is still built before it is placed (in a variable, read by a component
  that inspects it, given to an `h()` component) is reported as
  `ERR_HYDRATION_MISMATCH` of kind `prebuilt`, and what the user changed in a
  form control there is kept. `hydrate()` and `mount()` given no element throw
  `ERR_MOUNT_TARGET_MISSING`; the full-page document what-server renders is
  hydrated with `hydrate(<App />, document.body)`.

### Server rendering

The [what-server README](https://github.com/CelsianJs/what-framework/blob/main/packages/server/README.md) documents each of these.

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
  ([Streaming SSR](https://github.com/CelsianJs/what-framework/blob/main/packages/server/README.md#streaming-ssr)).
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
  Under a `<Router>`, a `redirect()` thrown from a component body, route
  middleware that redirects (a path, or `redirect()`), `<Redirect>` and a
  `guard()` path fallback redirect the render's response. To redirect from a
  server render, call `getResponse().redirect('/login')`; the deploy adapters answer with the
  3xx, and a custom server passes a `createResponse()` in and reads it back:
  `renderToString(vnode, { response })` takes one, and `renderToStringAsync`
  returns it as `response`
  ([Loaders, status and redirects](https://github.com/CelsianJs/what-framework/blob/main/packages/server/README.md#loaders-status-and-redirects)).
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
  ([Cached routes and the response](https://github.com/CelsianJs/what-framework/blob/main/packages/server/README.md#cached-routes-and-the-response)).
  A cached render also sees exactly what its key is made of: the key holds
  the request's origin (its scheme and host) as well as its path, so two hosts
  serving one app keep two entries and a Host one sender chose never reaches
  another host's visitors; the parameters the key ignores (`utm_*`, `fbclid`
  and the like) are gone from the loader's `query` and the request URL. Read them on the client, or render the route
  with `mode: 'server'`. Its `request` is a real `Request` that carries only
  the headers and cookies the route's `vary` names, so `fetch(request)` and
  `new Request(request)` forward nothing else. To forward a visitor's
  credentials upstream from a cached route, read them through
  `request.headers`, which makes that render private, name them in `vary`, or
  use `mode: 'server'`.
- **The Node adapter answers 400 to a request target that is not a path.**
  `toNodeListener` and `whatMiddleware` refuse `*`, absolute-form
  (`GET http://other/x`) and authority-form targets, and any target whose URL
  cannot be built; 0.14 joined the Host header and the target as written
  (`http://hosthttp://other/x`). `whatMiddleware` passes a handler's error to
  `next(err)`, where 0.14's rejected. This affects a server behind a forward
  proxy that sends absolute-form targets: rewrite them to origin-form at the
  proxy.
- **SSR style objects follow a conservative value grammar.** A value that
  hides a declaration behind a CSS comment or an escape, or an unquoted
  `url(` that is not a valid url token, is dropped. Write the value without
  it.
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
  ([Static export](https://github.com/CelsianJs/what-framework/blob/main/packages/server/README.md#static-export-any-cdn-nginx-s3-github-pages-netlify)).

### The compiler

The [what-compiler README](https://github.com/CelsianJs/what-framework/blob/main/packages/compiler/README.md) documents the
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
  Install what-compiler at the version of what-framework, and publish
  libraries compiled with what-compiler 0.15. what-compiler is a peer of
  what-framework now, not a dependency, and what-framework an optional peer of
  what-compiler, so npm refuses either one upgraded alone (`ERESOLVE`). An
  install that does not enforce peers (pnpm, Yarn, Bun, or npm with
  `--legacy-peer-deps` or `--force`) can still mix them. what-compiler 0.15
  beside an older runtime then stops the build with
  `ERR_COMPILER_RUNTIME_MISMATCH`, naming both versions; what-compiler 0.14 has
  no such check, so what-framework 0.15 upgraded alone builds and fails as
  above. List what-compiler in `devDependencies` if your build imports it: npm
  and Bun install it with what-framework when you do not, Yarn does not, and
  pnpm does not let the app import it.
- **Rest props and spreads stay live, and a spread's children render.**
  what-compiler rewrites every rest element of destructured props into a copy
  of the props that keeps their live values (`_$omit`): 0.14 rewrote one only
  when the pattern also had a prop it read where it was used, so the most
  common polymorphic component, `({ as: Tag, ...rest }) => <Tag {...rest} />`,
  showed the first `href` and `className` it was handed forever. A rest
  element destructured again, read by key, declared in the body or in a
  nested function that renders JSX, beside a ref parameter
  (`({ ...rest }, ref) => …`) or under a nested pattern is live too, and so is
  a nested pattern itself (`{ style: { color } }`) and a default that reads
  nothing of the component and calls nothing (`items = []`, made once per
  component). An element with a spread and no children of its own renders the
  spread's `children`, on the client and the server: 0.14 wrote them as a
  `children` attribute on the client (`<a {...props} />` showed
  `<a children="…">`) and dropped them on the server. A destructured prop the
  compiler still reads once (one assigned again, a computed key, a default
  that reads another prop or calls something) is reported in development
  builds as `ERR_PROP_READ_ONCE`, with the place and the fix. This affects
  code that relied on a rest element or a spread keeping its first values,
  and tests that match compiled output of rest elements, spreads or
  destructured defaults.
- **An attribute written after a spread wins over it**, as in React:
  `<a {...rest} href="/x" />` keeps `/x` when `rest.href` changes. A handler
  that comes through a spread follows the parent's current one, `children`
  written as an attribute is live, and `const merged = { ...rest, className:
  'x' }` spread onto JSX stays live. This affects code that relied on a
  spread overwriting an attribute written after it: write the attribute
  before the spread.
- **The Vite plugin compiles the app's files, never a dependency's.**
  Nothing under `node_modules` is compiled, whatever `include` and `exclude`
  say: 0.14 compiled it when a custom `exclude` left `node_modules` out of its
  pattern. No script file of one of What's own packages is compiled either,
  wherever it sits: a workspace link (npm, pnpm or Yarn workspaces, `file:`,
  `npm link`) resolves outside `node_modules`, and the dev server compiled
  what-react's, what-router's and what-core's source there as the app's (it
  broke Headless UI's `<Dialog>` in a mixed app, in development only). A JSX
  file What publishes (`what-devtools/panel`) is still compiled. To compile a
  dependency that publishes What JSX as source, name it in
  `compileDependencies` (`what({ compileDependencies: /my-ui-kit/ })`). This
  affects a config whose `exclude` was meant to let a package under
  `node_modules` in, and development names: What's own signals and effects no
  longer show a `name@node_modules/...` location in devtools.
- **Only components have their props read where they are used.** A function
  is one when it renders JSX, or, with no JSX, when it is named as a
  component and calls What's `h()` or returns a prop as it is
  (`(props) => props.children`). 0.15's first builds rewrote every function
  with one parameter: a helper that destructured its argument
  (`function Point({ x, y, ...rest })`), a reducer, a class's method or a
  hand-written `forwardRef()` got `_$omit` and `_$place` in place of its
  destructuring and its returned field. This affects tests that match
  compiled output of plain functions.
- **Server transforms compile for the server.** The Vite plugin's `ssr`
  option, on by default, compiles a module Vite transforms for the server with
  the server target, which every what-server renderer accepts. 0.14 refused
  such a module with `ERR_COMPILED_JSX_IN_SSR` whenever its output built DOM,
  so server-rendered views had to use `h()` or the automatic JSX runtime. This
  affects SSR setups that kept views away from what-compiler (they can compile
  them like the client now), and test runners that set `ssrGuard: false` to
  get DOM output from server transforms (Vitest under
  `environment: 'node'`): set `ssr: false, ssrGuard: false`
  ([Server builds](https://github.com/CelsianJs/what-framework/blob/main/packages/compiler/README.md#server-builds)). With the
  Babel plugin, the server target is `generate: 'ssr'`.
- **A call is static only when the compiler proves it.** A JSX expression
  that calls something is left unwrapped only when nothing the call reaches
  can read a signal: functions and object literals the module declares, given
  the values the call hands them, and built-ins and package utilities applied
  to values the compiler saw made. Anything else is wrapped as a reactive
  child: a method called on a value it did not see made (`{row.padStart(3)}`
  for a parameter), a global the platform does not define, a getter or
  setter, a class instance, a callback handed on, a generator, an async
  function, a default parameter. The rendered text is the same; such a
  child is a region of its own (one effect that runs once, and its comment
  markers on the server). This affects tests that match compiled output or
  server markup of such calls.
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
- **A destructured `children` is read where it is placed.** A component that
  reads `children` only to place it (in an element, a fragment, a condition,
  an array, its result or another component), destructured in the parameter
  list (renamed, with a literal default or a rest element) or from props in
  the body, compiles each read as `props.children` where it stands. Its body
  now runs before its children are built, as with `props.children` and
  `h()`: a log in the component comes before its children's (its `onMount`
  runs after theirs, in React's order).
  Children a condition shows again are built again, as `props.children` does
  (a child component in them used to come back empty). A component that never
  places its children no longer builds them. This affects code that relied on the
  children existing while the component's body ran; read `props.children`
  there (it builds them). A component that inspects its children keeps its
  destructuring ([API](https://github.com/CelsianJs/what-framework/blob/main/docs/API.md#placing-and-forwarding-children-and-other-jsx-props)).
- **JSX passed in any prop is built where the component reads it**, as its
  children are: `<Layout header={<Nav />}>` builds `<Nav />` when Layout reads
  `header`, inside Layout's run, so its components run after Layout's body,
  are owned by Layout and see the context Layout provides; a prop a component
  hands on (`fallback={fallback}`) reaches the next one unbuilt, and a
  destructured prop that is only placed compiles to a read of `props.<name>`
  where it stands. A prop placed twice in one run is built twice, as `h()` and
  the server render it, children included (0.15 moved one set of nodes to the
  last place). `<ErrorBoundary>` and `<Suspense>` read `fallback` when they
  show it. A `.map()` or an array literal that returns JSX
  (`items={links.map((l) => <li>{l}</li>)}`) is such a prop too. Building one
  reads no signal into the `<Show>` or condition it is placed in, so a write
  to a signal its JSX read when it was built leaves it in place. Read after
  the component's run without being placed (a test in `onMount`, a handler
  that shows it in a dialog), a JSX prop runs its components no second time:
  it gives a placeable, a truthy value built where it is placed (a prop the
  run never read is built once, owned by the component, to tell JSX from
  data). This affects code that relied on a JSX prop being built before
  the component ran, on the same nodes being moved, or on inspecting a JSX
  prop after the run (`props.children.length` in an effect): read the prop
  where the JSX is wanted, inspect it during the run, and pass data, not JSX,
  to a component that inspects it.

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
  text: assert on the code. [ERRORS.md](https://github.com/CelsianJs/what-framework/blob/main/docs/ERRORS.md) lists every code.

### Bundle size

`npm run check:size` builds each app below for production and holds its
minified, gzipped size to a ceiling in [.size-budgets.json](https://github.com/CelsianJs/what-framework/blob/main/.size-budgets.json),
which records the cause of every change.

| App | 0.14 | 0.15 |
|---|---|---|
| A counter written with `h()` | 6601 B | 9323 B |
| The create-what counter, runtime JSX | 6702 B | 9362 B |
| The create-what counter's JavaScript, built as the scaffold builds it (what-compiler), without the modulepreload polyfill Vite adds to a build from `index.html` | 7731 B | 5456 B |

The compiled counter, what the scaffold ships, is 2275 B (29%) smaller in
0.15: compiled output no longer carries the vnode reconciler, an app that
makes no computed no longer carries the engine's pull phase, and a compiled
module imports only the runtime its JSX uses (no lazy children when no
component is handed any, no class component bridge when every component is a
function the module defines, no `<select>` code when it makes no select). 0.14's numbers
include development-only code (828 B of the `h()` counter: 5773 B with its
flag folded out), which 0.15 leaves out of production builds; the `h()`
counter still grows by 3550 B, for the new engine, the engine hooks async
values and transitions need, and for fixes to keyed rows, class composition,
delegated events, form fields (a value, checked and the defaults written as
React 19 writes them, on every path, and a controlled select that follows its
value when its options change), styles, hydration, JSX props built where they are placed, `<Suspense>` release, SVG
animation URLs and the render ownership of a second copy of what-core. The production build (`dist/*.min.js`, what the
`production` export condition resolves) has one file per source module
instead of one shared chunk, so an app bundled from it is as small as the
same app bundled from source, and a compiled app with no `h()`, boundary or
portal leaves the vnode renderer out.
Loading the dist straight into a browser without a bundler fetches more,
smaller files. This affects an app written with `h()` that has a size budget:
compiled with what-compiler, the same counter is 5456 B.

Three kinds of app grow more than the counters:

- **An app that calls `computed()`** brings the async core with it
  ([ASYNC.md](https://github.com/CelsianJs/what-framework/blob/main/docs/ASYNC.md)): the compiled counter with one `computed()` is
  9379 B, against 7979 B in 0.14 (+1400 B).
- **An app that hydrates** carries the hydration runtime: the compiled
  hydrating counter is 20407 B, more than twice the same app mounted without
  hydration.
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
  --minify` builds the `h()` counter at 9341 B, and an unminified esbuild or
  rolldown build with no `NODE_ENV` of your own is a development build, with
  its diagnostics: minify, or define `process.env.NODE_ENV` as `"production"`,
  for production. A bundler given custom conditions with neither `production`
  nor `module` bundles `src/` and its development tier (esbuild
  `--conditions=browser`: about 34 KB), whatever `process.env.NODE_ENV` says. Add
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
  - `what/no-effect-self-write` (an effect that writes a signal it reads) is
    new and an error in `recommended`, so a lint run that passed on 0.14 can
    fail. `effect-cleanup`, `no-unsafe-innerhtml`, `no-async-component`,
    `no-promise-in-usememo`, `no-optimistic-snapshot` and
    `prefer-async-computed` warn in `recommended`.
- **what-devtools**: `subscribe()` events carry ids instead of the registry
  entry. `signal:created` is `{ id, name, componentId }` (0.14 also sent `ref`
  and `createdAt`), `effect:created` is `{ id, name, kind, componentId }`, and
  `component:mounted` is `{ id, name, parentId }` (0.14 also sent `element`
  and `mountedAt`). `safeSerialize(value, depth)` became
  `safeSerialize(value, budget)`, a size in characters of JSON. A subscriber
  that needs the signal, the element or a timestamp looks the entry up by id
  in the exported `signals`, `effects` or `components` map
  ([Event Subscription](https://github.com/CelsianJs/what-framework/blob/main/packages/devtools/README.md#event-subscription)).
- **what-devtools-mcp**: see [MCP tools](#mcp-tools).
- **what-server** and **what-isr**: see [Server rendering](#server-rendering).
- **what-compiler**: see [The compiler](#the-compiler).
- **what-router**: navigations are transitions; see [Data, actions and routing](#data-actions-and-routing).
- **what-react**: `isValidElement` accepts only real elements, and
  `cloneElement` returns anything else unchanged, so JSON shaped like an
  element no longer becomes one. Pass a real element, or call
  `createElement(obj.type, obj.props)` on purpose.
  A host element's `props` keep `className` and `htmlFor` (they were renamed
  to `class` and `for`): read `element.props.className`. `Fragment` is
  React's symbol, not what-core's function: compare a fragment element's
  type with `Fragment` from `react`. A controlled field whose `value` or
  `checked` becomes `null` or `undefined` keeps what it shows, as in React:
  clear it with `''` or `false`. A reducer or a `useState` updater that
  throws does so while its component renders, where an error boundary
  catches it, not from the `dispatch` call. Cleanups of a removed subtree
  run parents first, the passive ones after the commit's layout effects.
  A class marked `isReactComponent` that does not extend `Component` needs
  `what-react/class`, which `reactCompat()` imports for you; a build without
  the plugin imports it once, in its entry, or the class throws
  `ERR_CLASS_COMPONENT_NOT_INSTALLED`.

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
([Setup](https://github.com/CelsianJs/what-framework/blob/main/docs/MCP-DEVTOOLS.md#2-configure-vite)). This affects scripts and prompts
written against 0.14's tools: make the calls in the table, and read the
answer's fields. Causal events are recorded from the moment a client
connects, so reproduce an action after connecting to see its history.
`what_signals` counts include async computed rows: rows with `id` are
writable signals, and async rows carry `effectId`. `what_diagnose` counts an
effect as hot above 5 runs (pass `threshold` to change it), and
`what_errors` returns hydration guidance in `mismatchFixes[kind]`.
[MCP-DEVTOOLS.md](https://github.com/CelsianJs/what-framework/blob/main/docs/MCP-DEVTOOLS.md) documents every tool.
