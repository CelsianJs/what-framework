# Changelog

All notable changes to What Framework will be documented in this file.

## [0.13.4] - 2026-08-25

### Fixed

- **A keyless `createResource()` never resolved on the server.** `renderToStream`,
  `renderToStringAsync` and `renderDocument` all shipped the `<Suspense>`
  fallback as final HTML instead of the data, after paying for twelve
  sequential fetches of it.

  `createResource` names a keyless resource `__r${counter++}` from a counter on
  the render context. Both server resolve loops re-render the tree after
  awaiting the pending promises, and neither restored that counter: pass 0
  stored `__r0` and suspended, pass 1 asked for `__r1`, found nothing cached,
  started the fetch again and suspended again. Twelve passes later the loop gave
  up and emitted the fallback.

  Passing an explicit `key` bypassed the counter and worked, which is why the
  feature looked functional in any example that used one.

  A page with one 120 ms resource now streams its shell immediately and its
  resolved data at 125 ms. Before, it emitted "loading" at 1,453 ms.

  Nothing caught it because every `<Suspense>` test asserted boundary structure,
  that a fallback renders and that a marker tag does not leak into the output,
  and none asserted that data actually arrives.
  `packages/server/test/async-resource-resolution.test.js` now does, including
  that each resource is fetched exactly once.

## [0.13.3] - 2026-08-25: a custom render could set headers on half its routes

### Fixed

- **`render` result headers were dropped on the direct-render path.** A deploy
  adapter's custom `render` can return `headers` alongside `html` and `status`.
  The ISR cache path spread them onto the Response; the direct-render path
  (server mode, or any route with no cache engine) built its Response from
  `html` and `status` only and threw the rest away.

  So the same `render`, returning the same result, set response headers for a
  cached route and silently set nothing for an uncached one. The sharp edge is
  a redirect: a render returning `{ status: 302, headers: { Location } }` on a
  server-mode route produced a 302 with no `Location`, which a browser shows as
  a blank page with nothing to explain it. Vura hit exactly this implementing
  `throw ctx.redirect('/login')` in a page loader.

  The direct path now spreads `out.headers` the way the cache path always has.
  The spread happens before the CSRF cookie is applied, so a render still
  cannot drop the cookie half of the double-submit check, and server mode still
  gets its `Cache-Control: private, no-store`.

## [0.13.2] - 2026-08-25: a process-wide registry that was not process-wide

### Fixed

- **`revalidateTag()` and `revalidatePath()` silently did nothing when the caller
  was in a different bundle from the adapter.** The revalidation registry held
  its handler in a module-level `let`. That binding is process-wide only while
  there is exactly one instance of the module, and a bundler decides that, not
  the framework.

  Vura bundles its server entry and each API route separately: the entry inlined
  what-server and `createRequestHandler` bound *its* copy of the registry, while
  an API route imported `what-framework/server` as an external and read a
  *different* copy, permanently null. So `await revalidateTag('posts')` in a
  route handler returned without error, the dev warning that would have said so
  was suppressed by `NODE_ENV=production`, and the page stayed stale until its
  own revalidate window expired. Caching worked; purging did not; nothing said
  anything.

  The handler now lives at `Symbol.for('what.revalidationHandler')` on
  `globalThis`, which is the scope the thing being stored actually has. No API
  change: `setRevalidationHandler`, `getRevalidationHandler`, `revalidatePath`
  and `revalidateTag` all behave identically within a single instance.

### Internal

- **The benchmark gate and its baselines used different estimators.** The gate
  compared the best of N runs against a baseline recorded from a single run. A
  single draw from a one-sided noisy distribution that lands high permanently
  consumes the whole tolerance, so `batch() 100 writes, 1 effect` failed or
  passed on scheduling luck. `npm run bench:record` now produces baselines
  through the same best-of-N path the gate uses, and prints every guarded
  threshold's movement before overwriting. The DX suite, previously measured
  once per attempt, is best-of-6 like core.

  The baselines themselves were deliberately not re-recorded: nine of eleven
  guarded ops now measure 7-89% *faster* than their 2026-03-26 thresholds and
  two measure slower, which is what a stale baseline set looks like rather than
  a regression. Re-recording needs a measurement environment that can resolve
  10%, which this one cannot. See the 2026-08-25 section of
  WHAT-FW-GOLD-STANDARD-AUDIT-2026-08-23.md.

## [0.13.1] - 2026-08-25: fragments, and the gates that missed them

**One behaviour change, and it is a correction.** A JSX fragment used as a child
of an element now renders its content, in its place. It previously dropped part
of that content and appended the rest to the end of the parent. Any markup that
looks different after upgrading was rendering wrongly before.

### Fixed

- **A fragment child of an element keeps its content and its position.** The
  lowering handled only expression children and inserted them with no anchor, so
  three things went wrong at once and none of them made a sound:

  | Written | Rendered before | Rendered now |
  |---|---|---|
  | `<span><>plain</>{x}</span>` | `<span>x</span>` | `<span>plainx</span>` |
  | `<span><><b>c</b></>{x}</span>` | `<span>x</span>` | `<span><b>c</b>x</span>` |
  | `<span><>{"A"}</>{"C"}</span>` | `<span>CA</span>` | `<span>AC</span>` |

  The fragment now reserves one marker in the template and every child inserts
  before it, which keeps the children in order and the fragment among its
  siblings. Found by a new differential fuzzer: 62 of its first 300 random trees
  diverged from the equivalent `h()` tree, and all 62 were this.

- **Invalid HTML nesting says what happened.** `<p>a<div>b</div>c</p>` is markup
  the HTML parser is required to restructure, which left compiled output walking
  a tree that no longer matched the source and failing with
  `Cannot read properties of null (reading 'firstChild')` inside generated code.
  It now throws `ERR_INVALID_HTML_NESTING`, naming both tags. Dev builds only.

- **The npm registry verification no longer looks for a package it does not
  install.** Freezing `what-mcp` in 0.13.0 removed it from the install list but
  left `assertHelp(tmp, 'what-mcp')` behind, so the 0.13.0 release published all
  thirteen packages correctly and then failed its own verification. The bin list
  is now derived from the manifests of the packages actually installed.

### Added

- **`what-devtools` and `what-devtools-mcp` ship type declarations.** Both were
  published with none, so `installDevTools()`, `getSnapshot()`, `DevPanel`,
  `connectDevToolsMCP()` and the Vite plugin were all implicit `any` — the Vite
  plugin worst of all, since it goes in `vite.config.ts`.
- **A published error-code reference**, generated from the catalogue:
  [docs/ERRORS.md](docs/ERRORS.md) and `/docs/reference/errors` on the site. All
  31 codes with severity, raising package, suggestion and worked example. Until
  now the only way to read a code's fix was to call the `what_errors` MCP tool,
  which means running the framework; pasting `ERR_ISR_VARY_UNRESOLVED` into a
  search engine found nothing.
- **`ERR_INVALID_HTML_NESTING`**, bringing the catalogue to 31.
- **A differential fuzzer for the compiler's JSX lowering**
  (`packages/compiler/test/lowering-parity-fuzz.test.js`). Compiled JSX must
  render the same DOM as the `h()` tree it lowers to, before and after a signal
  write, over 300 seeded random trees. The compiler's other tests are all
  shape-by-shape and structurally blind to cases nobody thought to write.

### Changed

- **The type-parity gate now covers `.jsx` entry points.** It compiles them the
  way the framework does rather than reporting them unimportable, so
  `what-devtools/panel`'s new declarations are actually checked against its
  runtime. 32 declaration files checked before, 33 now.
- **`release-and-deploy` has no Depot counterpart, on purpose.** `secrets.NPM_TOKEN`
  is a GitHub secret and npm provenance is minted from GitHub's OIDC issuer, so a
  Depot run resolves the token to an empty string and fails at the publish step
  after ten minutes of green gates. A test asserts the copy stays gone, and the
  workflow gained a fail-fast preflight for the token.
- **`check:error-docs` and `lint` join `release:verify`.** `lint` was in CI but
  not in the release gate, so a release could be cut with a lint error that only
  surfaced on the PR. That is exactly what happened to the first push of this
  one.

## [0.13.0] - 2026-08-25: the implementation gets checked

Minor rather than patch for two reasons: there are new public exports
(`getErrorDefinition`), and two type declarations were widened. Nothing was
narrowed and no runtime behaviour was removed, so an upgrade from 0.12.4 should
be uneventful.

The theme is that the framework's own code was not being checked. `tsconfig.json`
only ever included `packages/*/*.d.ts` — its own comment said so — so all 106
implementation files had no static analysis, and until this release the repo
shipped `eslint-plugin-what` while having no ESLint config of its own. Turning
both on found real defects. So did running the stress tests, which no script
and no workflow had been executing.

### Fixed

- **`__setDevToolsHooks()` no longer crashes on a partial hooks object.**
  Fourteen call sites read `if (__DEV__ && __devtools) __devtools.onSignalCreate(sig)`,
  guarded on the object but never on the method. Installing a single hook — the
  obvious way to observe one kind of event, and exactly what `trackSignals()`
  builds when no devtools are present — made the next `signal()` throw
  `TypeError: __devtools.onSignalCreate is not a function`.
- **`trackSignals()` actually tracks signals.** It previously missed transitive
  reads through computeds and reported writes it should not have.
- **`VNodeChild` accepts a vnode with typed props.** `VNode<P>` is invariant in
  `P`, and `VNodeChild` referred to the default `VNode<Record<string, any>>`, so
  `h('div', {}, h('h1', { style: '…' }, '404'))` did not typecheck and neither
  did passing that tree to `mount()`. This never affected JSX authoring —
  `jsx()`/`jsxs()` return the default `VNode` — but it did affect what-router,
  the other packages that build vnodes with `h()`, and anyone calling `h()`
  directly in TypeScript.
- **`mount()` declares the `DocumentFragment` container it always accepted.**
  what-react mounts into a detached fragment on purpose; the declaration said
  `string | Element`.
- **`useDebugValue(value)` matches React's arity.** It was a zero-argument stub
  that every caller, including this package's own selector store, violated.
- **`what_search` no longer throws on a non-string query.**
- **The CLI dev and preview servers handle a request with no URL.**
- Eight stale assertions inside the stress tests, which had been failing on
  `main` unnoticed because nothing ran them.

### Added

- **Every error the framework throws now carries an `ERR_*` code.** 17 throw
  sites across what-server, what-react, what-text, what-isr, the compiler, the
  CLI and the MCP server. The catalogue in `packages/core/src/errors.js` grew to
  30 entries, each with a severity, a suggestion and a worked bad/good example.
  Messages are unchanged.
- **`getErrorDefinition(code)`** resolves a code to its catalogue entry, and
  `classifyError(err)` now consults `err.code` before falling back to matching
  on the message. A throw carries only its code so that the catalogue does not
  reach the client bundle; this is how the suggestion is recovered.
- **Type declarations for `eslint-plugin-what` and `what-text`**, which were
  both programmatically imported and shipped without any.
- **what-core's cross-package internals are declared** (`_isAriaAttr`,
  `_beginComponentSSR`, `_endComponentSSR`, `_mapArrayToArray`,
  `__installServerContextStorage`, `_setTextInsertHook`, `_$createComponent`).
  They are `@internal` and carry no compatibility promise, but they cross
  package boundaries, so a rename should be caught.

### Changed

- **`what-mcp` is frozen at 0.12.4 and no longer republished.** It is deprecated
  in favour of `what-devtools-mcp` and was being version-bumped on every release,
  which made an abandoned package look maintained.

### Repository

None of this changes the published packages, but it is why the fixes above were
findable:

- `typecheck:src` — `allowJs` + `checkJs` + `strict` over all 106 implementation
  files in all 14 packages
- `lint` — the framework passes its own ESLint rules
- `check:error-codes` — every `ERR_*` literal thrown anywhere is catalogued
- `test:stress` — the six stress-test files nothing was running
- the packed-consumer typecheck now exercises the shapes a user actually writes
- `ARCHITECTURE.md`, CODEOWNERS, issue and PR templates, `CODE_OF_CONDUCT.md`
- `CONTRIBUTING.md`'s error-code section described a `WF-XXXX` scheme that does
  not exist anywhere in the repository; it now describes the real one
- shared test helpers (`test-utils/`), replacing hand-rolled JSDOM setup in 66
  files that disagreed about which globals to install

## [0.12.4] - 2026-08-15: everything the documentation said was broken, and several things it did not

### Read this before upgrading

This is a patch release, but five of the fixes change behaviour you may be
relying on. None is a gratuitous change: in each case the old behaviour was the
defect. They are collected here so an `npm update` does not surprise you.

- **`zodResolver` and `yupResolver` now rethrow** anything that is not a
  validation error. They used to swallow it and report the form as VALID, which
  is why this release exists. If a schema of yours throws (a mis-built schema, a
  failed fetch inside an async `.refine()`), submission now fails loudly where it
  previously went through. That is the point, but it is a change.
- **`refetch()` now issues a request even inside `staleTime`.** It previously
  returned the cached value. An explicit refetch should refetch, but a component
  calling it on a timer will now do real work.
- **Type declarations were corrected to match the runtime**, so code written
  around the WRONG declarations will now fail `tsc`: `useState`'s first element
  is a signal accessor and not a `T`, `batch` returns undefined, `useMemo`
  returns a computed accessor, and `useReducer`'s state shape changed. Runtime
  behaviour is unchanged; only the types moved.
- **`enableScrollRestoration()` now restores a saved position on ordinary
  forward navigation**, not just on back/forward. A nav-bar link back to a page
  you scrolled earlier lands where you left it rather than at the top. Hash links
  still win over a saved position.
- **`<Radio>` writes its own `value`** instead of a boolean, and a `<Radio>` with
  no `value` now dev-warns and renders unregistered instead of writing the DOM
  default `"on"` and rendering the whole group checked.

Twenty-eight correctness fixes, all found by one technique and all kept honest by
another.

The technique that found them: reading every code sample on whatfw.com and then
RUNNING it. The docs describe what the framework is supposed to do, so each place
the docs were "wrong" was equally likely to be a place the framework was wrong.
That produced the first six fixes directly. It also produced a list of things the
docs had to describe as permanent limitations, because the audit's job was to be
accurate and the framework genuinely did not do them: `<For fallback>` silently
dropped by the compiler, `useQuery({ enabled: false })` permanently dead,
`generateStaticPage` unable to render any component with a hook, `Radio` exported
and inert, `cssTransition` never settling, `zodResolver` silently passing every
invalid form under Zod 4. That list became this release.

The technique that kept it honest: every fix was verified by an independent pass
whose instructions were to REFUTE it by running it, not to read it. That pass
rejected five of eleven groups. Several fixes were worse than the bugs they
closed. `useRovingTabIndex` located items by an id that `hydrate()` renumbers, so
with two islands on a page keyboard focus jumped out of the widget the user was
in and into an unrelated one. `clearCache()` wiped shared data but could not
reach the per-hook status signal, turning a stale render into a TypeError on
logout. A reactive `enabled` gate aborted an in-flight explicit `refetch()` and
resolved its promise with `undefined`. Boundary hydration desynced the cursor and
put a second copy of the trailing element on screen. Every one of those was
demonstrated with a public-API reproduction, repaired, and re-checked by a third
pass whose specific job was to confirm the repair had not quietly regressed to
the original bug in order to kill the regression.

The general lesson is in that paragraph rather than in any individual fix: a test
that asserts on the DOM cannot see an inserter leak, a type test written to the
fix passes for any fix, and a hydration test with no trailing sibling structurally
cannot detect a cursor desync. Four of the defects below shipped originally
because the test that should have caught them was shaped like the bug.

### Fixed

- **SSR emitted a function's source code into attributes.** `renderAttrs`
  skipped event handlers and then `String()`d whatever was left, and a function
  stringifies as its own source. So the documented way to make an attribute
  reactive, `<span className={() => theme()}>`, server-rendered as
  `class="() =&gt; theme()"`. The real class was absent from the HTML, so CSS
  keyed on it did not apply for crawlers or no-JS visitors, and hydration then
  replaced it, so a browser devtools pane showed the correct value and hid the
  problem. what-router's `<Link>` hit this on every link, since it always passes
  a thunk as `class`. Function values are now resolved the way every client path
  already resolved them.

- **`<ErrorBoundary>` did not catch on the server.** It has no server branch, so
  the marker vnode fell through to the generic element renderer and a component
  that threw during SSR propagated straight out of `renderToString` and
  `renderToHydratableString`, taking down the entire page response. The one
  construct whose whole purpose is to stop a subtree failure from becoming a page
  failure did nothing at all server-side. It now renders its fallback while the
  rest of the page continues. A thrown thenable still passes through to the
  nearest `<Suspense>`, because a suspended resource is not an error.

- **Boundary marker tags leaked into the HTML.** The same missing branch emitted
  a literal `<__errorBoundary>` element on all three server paths, and
  `<__suspense boundary="[object Object]" fallback="[object Object]">` on the
  hydratable path, along with the boundary's internal props stringified into
  attributes. Both now render their subtree and never themselves.

- **`<Portal>` server-rendered its contents inline under a DOM shim.** Portal is
  client-only by design and returns `null` when there is no `document`, but that
  guard is environmental rather than a server check, so SSR under jsdom or
  happy-dom sailed past it and produced
  `<__portal container="[object HTMLDivElement]">` with the portal's children
  emitted at the portal's own position instead of its target. It now renders
  nothing on the server either way, so a DOM shim cannot change the output.

- **`data-hk` was emitted once per component rather than once per element.**
  Every component injects the attribute into the first element of its own output,
  and a component that returns a component resolves to the SAME element at every
  level, so `Outer -> Middle -> Inner -> <p>` produced
  `<p data-hk="h0" data-hk="h1" data-hk="h2">`. A duplicate attribute is invalid
  HTML and browsers silently keep only the first. This is the most ordinary
  composition there is, so it affected essentially every server-rendered page.

- **The compiler emitted a key function with an unbound variable.** `key={i}`,
  the pattern the framework's own tutorial taught, compiled to
  `{ key: t => i }` with `i` free, because the key is hoisted out of the map
  callback and receives only its first parameter. The failure was the quiet kind:
  the list rendered correctly once, then the first update threw
  `ReferenceError: i is not defined` inside the reconciler's effect, the effect
  error handler swallowed it into a single `console.error`, and the list stayed
  frozen on its initial contents for the rest of the session. The compiler now
  detects a key it cannot reach (the index, or any variable declared inside the
  callback) and falls back to positional reconciliation. That is also the
  semantically correct answer: a key derived from the index IS the position, so
  it carries no identity across an update.

  A bare `key={i}` is silent, because it is a deliberate statement that position
  is identity and positional reconciliation is exactly that, so there is no edit
  that would improve the output. Anything that only PART-uses the index warns,
  because those look like a stable composite identity and are not:
  `key={`${item.type}-${i}`}` changes the moment a row moves. A key built from a
  variable declared in the callback body warns for the same reason it used to
  crash.

- **`zodResolver` silently disabled validation under Zod 4.** Zod 3 exposed the
  issue list as both `.issues` and a legacy `.errors` alias; Zod 4 dropped
  `.errors`. The resolver read `.errors` alone, collected nothing, returned an
  empty error map, and `handleSubmit` reads "no errors" as VALID, so every
  invalid form submitted. No test in CI could catch it: the repo only resolves
  zod 3.25.76, transitively, through devtools-mcp. Two adjacent holes went with
  it: anything thrown that was not a `ZodError` was swallowed and reported as
  zero errors, and a symbol path segment threw inside `path.join('.')` and
  discarded every issue in the list. `yupResolver` had the same non-validation
  hole. Every resolver now reports errors or rethrows. None can answer "no
  errors" because it failed to understand its own library.

- **`Radio` was exported and completely inert.** Its change handler called
  `registered.onInput`, a key `register` never defines, so nothing was ever
  written; it registered untyped, so it would have stored a boolean for a group
  sharing one field; and its `checked` was a one-shot read, which never updates
  because components run once. Fixing it surfaced that spreading a registration
  clobbers a caller's `onBlur`/`onFocus`, and that `setProp` keys listener
  bookkeeping by event NAME so a caller's `onChange` died against the
  registration's `onchange`. Handlers now compose.

- **`useQuery({ enabled: false })` had no working form at all.** `enabled` was
  captured once, `refetch()` was gated by the same check, and `status()` stayed
  `'loading'` forever, so a disabled query was indistinguishable from a loading
  one and the button-click-to-fetch pattern was unreachable. `enabled` now takes
  a boolean, signal or thunk; an explicit `refetch()` is ungated and cannot be
  cancelled by an unrelated re-render; a disabled query reports `idle`.

- **`clearCache()` permanently detached every mounted component.** It emptied the
  Maps while live components held the old signal objects, contradicting the
  documented promise that components sharing a key share one set of signals. It
  now resets in place, moving status and data together, clears
  `useInfiniteQuery` data, and drops rather than nulls a module-scope query's key.

- **`useInfiniteQuery` ignored every base option.** `enabled`, `staleTime`,
  `select`, `retry` and `onSuccess` fell into an unused rest parameter, it never
  joined the shared cache despite computing a normalized key, it had no error or
  status surface, and it duplicated `initialPageParam` in `pageParams`.

- **The ARIA prop helpers froze on the first read.** `buttonProps()`,
  `panelProps()`, `itemProps()`, `checkboxProps()` and `getItemProps()` returned
  plain objects built from an eager signal read, so the spread form every reader
  reaches for snapshotted the ARIA state at mount. An accordion's `aria-expanded`
  never changed. They now return accessor-valued props, and every enumerated
  value is emitted as the string `"true"`/`"false"`: a raw boolean renders as
  `aria-expanded=""` or drops the attribute, and neither is "false" to a screen
  reader.

- **`useRovingTabIndex` never moved focus**, which is the entire point of the
  WAI-ARIA pattern it is named after, and its container hard-coded
  `role="listbox"` over whatever the caller wrote. `focusItem()` is now
  bounds-checked and `focusIndex` is clamped when a dynamic count shrinks: both
  previously left every item at `tabindex="-1"`, dropping the widget out of the
  tab order entirely.

- **`cssTransition()` never settled.** It asks for a reflow READ from inside a
  WRITE, and `flushScheduler` drained reads before writes and cleared its
  `scheduled` flag last, while `schedule()` short-circuits while that flag is
  true, so the read landed in an already-drained queue with no frame armed. Fixed
  in the scheduler, because scheduling from within a flush is a property it
  should have regardless of the caller: leftover work arms another frame.

- **An `<ErrorBoundary>` or `<Portal>` lost its subtree on hydration.**
  `hydrateNode` had no branch for the marker tags, so a boundary anywhere in a
  server-rendered tree warned `expected <__errorBoundary>, got P` and dropped its
  children. Boundary end markers are on `claimNode`'s skip list so a cursor
  desync cannot destroy one.

- **`spread()` dropped `ref` on the compiled path.** Unlike `applyProps` and
  `setProp`, which both special-case it, `spread()` had no `ref` branch, so a ref
  landed in the reactive-prop branch and was invoked with NO ARGUMENT. Every
  `{...register(...)}` spread silently lost its ref.

- **`generateStaticPage` could not render a component that used a hook.** It
  called `page.component(data)` bare, outside the component frame
  `renderToString` establishes, so `useState`, `useSignal`, `useEffect`,
  `useMemo`, `useRef`, `onMount` and `Context.Provider` all threw. It was
  presented as the static-generation entry point while being unusable for most
  real pages.

- **A defaulted `children` prop rendered on the client but not the server.**
  `dom.js` passes `undefined` for a childless component so a JS default parameter
  applies; all three server call sites passed `children: vnode.children`, and
  `[]` is defined. `SkipLink` was the visible case, shipping a server-rendered
  link with no accessible name, a WCAG 2.4.4 failure.

- **`useLoaderData()` took the client path during a real server render.** It
  branched on `typeof document === 'undefined'`, so under jsdom or happy-dom it
  returned the stale hydration payload instead of the loader's result. Same
  defect class 0.12.0 fixed for `renderToString`.

- **`<Form>`'s dev warning was false.** It told developers `csrfToken` is passed
  to loaders. It was not, on any stock path, so following the runtime's own
  advice shipped a form with an empty token and a silent 403 on the no-JS
  submit. The token is threaded where it is legitimately available and the
  warning says when that is. It is deliberately NOT invented for a cached
  response, because cached HTML is shared between visitors.

- **A guarded JSX arm was hoisted out of its guard.** `{cond() && <p>{cond().message}</p>}`
  evaluated `cond().message` unconditionally at mount and threw, and so did the
  ternary form. That is the idiomatic React shape.

- **`<Show>` did not make its static children lazy when compiled.** Children were
  built alongside the enclosing component with their bindings running
  synchronously, so `<Show when={user}><p>{() => user().name}</p></Show>` threw
  when `user` was null. The same JSX was already correct uncompiled.

- **The compiler silently discarded `fallback` on `<For>`.** Its attribute loop
  read only `each` and `key` and emitted no diagnostic, while the runtime `For`
  implements it, so upgrading a buildless app to the Vite compiler lost its empty
  state with nothing on the console.

- **`extractPageConfig` silently returned `{ mode: 'client' }` for valid
  configs.** It quoted bare keys with a regex over the whole matched object, so a
  colon inside a string value corrupted `vary: ['cookie:theme']` into invalid
  JSON, and it stripped `//` comments AFTER collapsing trailing commas. Both
  failures were silent, and that config is what `what generate` reads, so a route
  that legitimately declared `vary` was quietly skipped by static generation.

- **`enableScrollRestoration()` could not restore a position.** Three writers
  disagreed about the stored shape and the key, so the restore effect handed
  `window.scrollTo` an object, which coerces to NaN and jumps to the top. A URL
  with a hash now reaches its anchor even when a position is saved for that exact
  URL, so clicking the same `#install` link twice lands on the section both
  times.

- **Type declarations contradicted the runtime.** `useState`'s first element is a
  signal accessor, not a `T`. `batch` returns undefined. `ActionOptions` omitted
  `revalidateTags` and `timeout`, both of which the runtime reads, so the
  documented working call failed excess-property checking. `pollInterval` was
  declared on `PageCacheConfig` and read by nothing.

### Known limitations, unchanged

- `<Suspense>` still does not hydrate. `hydrateNode`'s component branch swallows a
  thrown thenable instead of suspending, so a `lazy()` child whose chunk has not
  landed, which is always true on a real first load, never flips `loading`.
  `<ErrorBoundary>` and `<Portal>` hydration are fixed; Suspense is not.
- There is still no keyed reconciliation on the uncompiled runtime path, and no
  portable spelling for a keyed `<For>`: compiled keyed mode passes a signal
  accessor and uncompiled passes the raw item.
- There is still no cross-instance ISR regeneration lock, so with the Redis store
  and N instances, N concurrent regenerations of the same key can run.
- `renderToStream` still runs `useEffect` bodies on the server while
  `renderToString` suppresses them.

### Changed

- The bundle-size gate accepted any claim between 80% and 100% of the ceiling,
  a band wide enough to hide the exact drift it existed to catch: all three
  size claims in the repo still read "~5.6 KB" long after the bundle measured
  6.37 KB, and all three passed. The floor is now 95%, and the claims are
  corrected.
- `scripts/bump-version.mjs` now moves the What dependency ranges in every
  non-workspace manifest, not just `docs-site`. A caret range on a 0.x version
  pins the MINOR, so the twenty-odd apps under `examples/` reading
  `"what-framework": "^0.6.0"` installed a framework six minor releases old, and
  `sites/react-compat` and `sites/playground` had each frozen at whatever was
  current the day they were written. `file:` links and `*` are left alone.

### Added

- `docs-site/scripts/check-api-refs.mjs`, run as a `prebuild` gate: every
  `import { ... } from 'what-*'` in the documentation is checked against the
  real runtime exports, so a page cannot go on teaching an export that no longer
  exists. Entry points are discovered from each package's own `exports` map
  rather than hand-listed.
- whatfw.com now has a 404 page. Any unmatched path previously returned Vercel's
  raw platform error, with no nav, no search, no link home and none of the site's
  styling, which is the single most likely error state on a docs site.

## [0.12.3] - 2026-08-09: SSR could not render a component that used a hook, and hydration was discarding client state

Twenty-two correctness fixes across SSR, hydration, the compiler, the router and
the query layer. They were found the same way, and it is worth saying how,
because it is the reason there are twenty-two: by building four real
applications and driving them in a real browser, then adversarially reviewing
each round of fixes, then fuzzing the result.

Almost every one needed two features **combined** to reproduce: SSR *and* a hook;
SSR *and* hydration *and* a toggle; a query key *and* a signal *and* an
invalidation. The 1,900-test unit suite covers each of those alone and was fully
green through all of them.

**If you server-render, upgrade. If you use the compiler, upgrade.** Several of
these are visible on the first page load of an ordinary app; one means whole
categories of component could not be server-rendered at all; and three exist
only on the compiled path, which is the recommended one. The storefront app is
hand-written and uncompiled, the admin dashboard is a compiled Vite SPA, and
putting the compiler in the loop exposed a second set of bugs that no amount of
reviewing the first set would have reached.

A note on how the hydration fixes were verified, since three consecutive rounds
of hand-written fixes each closed the case in front of them and left the class
open. A differential fuzz now generates 400 random trees, server-renders each
with one set of values, hydrates with a different set, and asserts the result is
identical to a client-only render. Scored against the same trees: **0.12.2 under
browser conditions diverged on 186 of 400; this release diverges on 0.**

### Fixed

- **No component using a hook could be server-rendered.** `renderToString` called
  the component function directly, with nothing on the component stack, so every
  hook that resolves a context threw: `useState`, `useSignal`, `useComputed`,
  `useEffect`, `useMemo`, `useCallback`, `useRef`, `useReducer`, `onMount`,
  `onCleanup`, and `Context.Provider`. One of them anywhere in the tree and the
  page failed to render at all. This was not a hydration warning or a degraded
  render: `renderToString` threw. All three server paths
  (`renderToString`, `renderToHydratableString`, `renderToStream`) each had their
  own copy of the bare call. Components now run under a real context, which stays
  open while the subtree renders so `useContext` resolves through it, and is
  marked disposed on the way out so no `useEffect` body or `onMount` callback
  ever fires on the server.
- **A compiled keyed list rendered empty on the server and crashed hydration.**
  `.map()` with a `key` prop, and `<For>`, lower to a mapArray *inserter*, a
  function taking `(parent, marker)` rather than a thunk. Neither SSR nor
  hydration had a branch for it, so both called it with no arguments. On the
  server the throw was swallowed and the container rendered **empty**: a
  compiled app served HTML with no list rows in it. On the client the same throw
  escaped `hydrate()`, so the **whole page** stopped hydrating and stayed inert.
  This is the ordinary shape for a compiled app, whose server HTML comes from an
  uncompiled render and whose client bundle is compiled.
- **A reactive region lost its owning component on every re-run.** The effect
  behind `{() => ...}` re-runs with the component stack unwound, so anything it
  built after the first paint had no owner. `useContext` fell through to the
  context **default** for everything rendered after a state change, and an
  `<ErrorBoundary>` stopped catching throws from components created by an inner
  region. `dom.js` had this fix; `render.js`'s `insert()`, the path the compiler
  emits for every reactive expression, did not, so it was broken for exactly the
  users on the recommended build setup. Both are correct on first paint and only
  break once the app is interactive.
- **The compiler called every destructured prop as if it were a signal.**
  `function Badge({ label })` with `<span data-label={label}>` compiled to
  `setAttr(el, 'data-label', label())` and threw `label is not a function` on any
  ordinary string prop, rendering nothing for that component and everything under
  it. The same identifier as a *child* compiled uncalled, so the two positions
  disagreed inside one element. Props now pass through uncalled; the runtime
  setters already resolve a function value reactively, so an accessor prop stays
  reactive and a real `signal()` is still auto-invoked.
- **Hydration threw away the client's value in every browser.** Correcting a text
  mismatch lived inside the dev-only warning branch, and "dev mode" was decided by
  reading `process.env.NODE_ENV`, which no browser has. The check was therefore
  false in the only environment where hydration runs, and the correction never
  happened: the server's text stayed on screen until some later write happened to
  touch that node. Anything the server cannot know rendered stale, so a cart
  restored from `localStorage` showed 0 items, a saved theme showed the default,
  a relative timestamp showed the build time. It self-heals on the next write,
  which is why it reads like a broken store rather than a hydration bug. The
  correction is now unconditional; only the warning is dev-gated, and the dev
  check now uses `__DEV__`, which resolves correctly in a browser.
- **A hydrated `<Show>` (any reactive region) lost its position on the first
  toggle and stopped updating on the second.** The client render path wraps every
  reactive function child in `<!--fn-->` / `<!--/fn-->` markers; the hydration
  path created none. Without a marker, `reconcileInsert` had no insertion point
  and appended to the end of the parent, so a region flipping content jumped to
  the bottom of its container. And the effect's disposer was attached to the
  *content* node, so removing that content disposed the effect and the region
  went dead. Client-only rendering was always correct, which is why nothing
  caught it. Hydration now creates the same markers, keeps the hydration cursor
  aligned, and hands the end marker to `reconcileInsert`.
- **`enhanceForms()` could not talk to `/__what_action`.** `<Form>` emits
  `data-enhance`, and the enhancer posted a `FormData` object, which is
  multipart. The action endpoint parses `application/x-www-form-urlencoded` or
  JSON and nothing else, so the body failed to parse, the `_action` field went
  missing, and every enhanced form answered 400. The no-JS path kept working, so
  the feature looked healthy wherever it was tested with scripting off. Enhanced
  posts now use the same encoding as the plain submit they replace.
- **A `<Form>` inside a cached page could never submit.** The enhancer refused to
  post whenever the page had no `<meta name="what-csrf-token">`, but `static` and
  `hybrid` pages are shared between visitors and deliberately carry no per-visitor
  token. Token recovery now falls back meta -> the form's own hidden field ->
  the `what-csrf` cookie.
- **A query went permanently deaf to `invalidateQueries()` after its first
  refetch.** `useQuery` and `useSWR` subscribed to their key once, *outside* the
  effect that fetches, while that effect's cleanup unsubscribed. The effect
  re-runs whenever the query function reads a changed signal, which is the entire
  point of a reactive query key, so the first reactive refetch dropped the
  subscription and never restored it. The first invalidation, before any refetch,
  works, which is why a test that mounts a query and immediately invalidates it
  passes. The subscription now lives inside the effect.
- **Every fetch pinned the Node event loop for five minutes.** The cache-cleanup
  `setTimeout` was not unref'd, so any process that ran one query stayed alive for
  a full `cacheTime` after its work finished. It is opportunistic housekeeping and
  is now unref'd.
- **Nested reactive regions interleaved instead of nesting.** Hydration claims the
  inner content first, so an inner region's markers went in first and the outer
  region's start marker landed *inside* the inner pair. Switching the outer arm
  then removed the visible content but neither the inner markers nor the inner
  effect: the orphaned effect kept rendering into a region that was switched off,
  and its output came back doubled when the outer arm returned. `<Show>` wrapping
  `<Show>` or `<For>` is the canonical shape for this. A region now opens its
  marker before its value is hydrated, and owns everything between its markers.
- **A region that rendered nothing lost its position permanently.** `<Show>` with
  no fallback, or `{cond && <X/>}`, claims no node during hydration, so both
  markers were appended to the end of the parent. When the condition later
  flipped, the content appeared below every following sibling, forever, with no
  warning.
- **Empty reactive text destroyed its next sibling.** A reactive child rendering
  `''` claimed the following node, found an element where it wanted text, and
  replaced that element with an empty text node. The server's real markup was
  discarded and every later sibling shifted, cascading a warn-and-recreate through
  the rest of the parent: an `<input>` the visitor had already typed into was
  replaced and lost its value. An empty string now claims a text node if one is
  there, and claims nothing otherwise, so it can never consume a non-text
  sibling. The bogus "expected text node" warning that came with it is gone too.
- **Hydration left server markup on screen that the client never claimed.** The
  flip side of the above: a region that is empty on the client and was *not*
  empty on the server correctly refuses to claim that content, and so had nothing
  to remove it. No effect owned it and no update could reach it, so the server's
  signed-in header simply stayed visible to a signed-out visitor, underneath the
  region meant to replace it. Hydration now removes unclaimed nodes *after* the
  walk finishes, when anything unclaimed is unreferenced by definition, and never
  during it. Excluded, because the walk does not own them: an element whose
  client tree declares no children (this is how an island keeps the server HTML
  it will hydrate later, and how a `mode: 'static'` island keeps its content
  forever), `dangerouslySetInnerHTML` payloads, and `<body>` / `<html>` at the
  root, where the scripts and hydration payload live.
- **Every inline SVG went blank on hydration.** `nodeName` is uppercased for HTML
  elements but case-preserved for everything else, so an `<svg>`'s `nodeName` is
  `svg` and could never equal `tag.toUpperCase()`. Every server-rendered SVG
  failed to match, warned `expected <svg>, got svg`, and was destroyed, then
  rebuilt with `document.createElement`, which lands in the XHTML namespace and
  does not render as SVG at all. The comparison is now case-insensitive, and the
  mismatch fallback goes through the same `createDOM` path a client-only render
  uses, so a rebuild is namespace-correct and sets attributes rather than
  properties.
- **A component disposed itself the first time its own root updated.** A hydrated
  component's context is anchored to a DOM node so disposal can reach it. When
  the component's root is a reactive region, that node is the region's *content*,
  which the region replaces on its first update, taking the whole component
  context with it: every effect, cleanup and `onCleanup` died while the component
  was still mounted. A region root now anchors to the parent element instead.
- **A region could never remove content it created during hydration.** When the
  server rendered nothing and the client renders something, the content is
  created rather than claimed, and the mismatch fallback appended it past the
  hydration cursor. The region's end marker then landed *before* its own content,
  so the region owned nothing: switching the condition off left the content on
  screen permanently. The fallbacks now insert at the cursor and advance it.
- **`enhanceForms()` ignored the form's `enctype`, silently dropping file
  uploads.** Fixing the multipart-by-default bug above overcorrected into
  urlencoded-always, which meant a form that correctly declared
  `enctype="multipart/form-data"` posted without its file bytes. Encoding now
  follows the form's own `enctype`, as the browser does.
- **`enhanceForms()` leaked the CSRF token cross-origin, and broke on ordinary
  forms.** A form whose action pointed at another origin was handed this
  visitor's double-submit token; it is now only ever sent same-origin, and a
  cross-origin form is no longer blocked by our token policy. A GET form
  serialized its fields and then discarded them, fetching a bare URL. A field
  named `method` or `action` shadowed `form.method` / `form.action` with the input
  element itself (`HTMLFormElement` is `[LegacyOverrideBuiltIns]`), throwing after
  `preventDefault()` so the submit did nothing at all: no request, no error event,
  no native fallback. The submitter button's `name`/`value` was never sent, so a
  multi-button form could not tell the server which button was pressed. Newlines
  in text fields now normalize to CRLF, matching what a plain submit sends.
- **`invalidateQueries()` was answered from the freshness window.** A query with a
  `staleTime`, or a `useSWR` inside its default 2s `dedupingInterval`, returned
  cached data instead of refetching. Invalidation means "this data is wrong now",
  which is the one caller that must never be deduped. Ordinary reactive refetches
  still dedupe.
- **`invalidateQueries()` opened one request per subscriber.** "Dedupe window"
  named two different mechanisms sharing one map. Bypassing the *freshness*
  window on invalidation is right; bypassing request *coalescing* is not, because
  every component reading a key subscribes separately, so one call arrives at N
  subscribers and the in-flight map is what collapses them into a single fetch.
  Four components on one key issued four concurrent requests whose responses
  raced to write the cache. Invalidation now bumps a per-key epoch before waking
  anyone: siblings coalesce, and a request that started before the invalidation
  can never answer it. The epoch is a counter rather than a timestamp because
  `Date.now()` has 1ms resolution, and the tie was reachable.
- **Every guarded route logged a false redirect cycle in Chromium.** One guarded
  deep link produced 25 `[what-router] Redirect cycle detected` errors and a
  flash of the redirect-loop screen. `navigate()` sets `_isNavigating`
  immediately but defers the URL write into `document.startViewTransition`, and
  the router's matching reads `_isNavigating`, so the flag flip re-ran the match
  against the still-old URL and counted the same hop twice. The detector then
  cleared the navigation state mid-navigation. A redirect to a target that is
  already pending is now recognized as a re-match of the same hop.
- **An interrupted view transition surfaced as an uncaught page error.**
  `navigate()` awaited only the transition's `.finished`, leaving the `.ready`
  rejection unhandled, so two navigations in quick succession produced
  `pageerror: Transition was skipped` in any error reporter the app had
  installed, for a navigation that actually succeeded.
- **Polling intervals and retry timers kept Node processes alive.** `refetchInterval`
  and `refreshInterval` armed intervals that are never cleared outside a component
  lifecycle, so an SSR render leaked one per render and kept calling the query
  function after the HTML had been sent. Those, and the retry-backoff timer, are
  now unref'd, and each query keeps a single cleanup timer instead of arming a new
  one per fetch.

### Changed

- **`enhanceForms()` now navigates after a followed redirect.** The action
  endpoint answers 303, so the enhanced path lands where the unenhanced one
  would. Navigation is same-origin only: a native submit would follow an off-site
  redirect, but a framework default that lets a server move the page to another
  origin is not one worth having. Call `preventDefault()` on the `form:response`
  event to keep the page put and handle the response yourself.

### Added

- **An application smoke suite (`npm run smoke:apps`).** Real, demoable
  applications, driven in a real browser, run against either the workspace source
  or the **published** packages (`npm run smoke:apps:npm`). The published mode is
  the direct answer to the 0.12.0/0.12.1 packaging defects, which were invisible
  to every workspace test by construction. A capability contract fails the run
  when a framework capability has no app covering it, or when an app claims a
  capability that no passing check ever reported. Wired into `release:verify` and
  CI. See `smoke/README.md`, and `smoke/FINDINGS.md` for the full diagnosis behind
  every fix above.
- **A differential hydration fuzz** (`hydration-parity-fuzz.test.js`). 400
  generated trees, each server-rendered with one set of signal values and
  hydrated with a different set, asserted identical to a client-only render of
  the same tree. It knows nothing about markers or cursors, so unlike a
  hand-written case it cannot be satisfied by a narrow fix. It is what closed
  this bug class, after three rounds of hand-written fixes had not.

### Known gaps (not fixed here)

- `renderToString` still emits no `<!--fn-->` markers for a reactive region, so
  hydration has to infer the boundary of anything that serialized to nothing
  rather than being told it. The inference is now exact enough to score 0/400 on
  the fuzz, but emitting the markers is the durable fix. Deliberately deferred
  because it changes every server-rendered byte. Tracked for 0.13.0.
- `hydrateNode` has no branch for `<ErrorBoundary>` / `<Suspense>` boundary tags
  or for `<Portal>`. Tracked for 0.13.0. (Compiled `mapArray` output was listed
  here in error: fix 18 in this same release added exactly that branch,
  `render.js:1900`.)

- The **runtime** render path has no keyed reconciliation: `dom.js` never reads
  `vnode.key`, so a buildless app rebuilds every list row on each change. Keys
  work only on the compiled path. Tracked for 0.13.0.
- `<For>` passes **raw items** on the runtime path and **signal accessors** on the
  compiled path, so the same JSX behaves differently depending on whether the
  compiler ran. Unifying them is an API decision. Tracked for 0.13.0.

## [0.12.2] - 2026-08-09: what-server node-condition types are actually reachable

0.12.1 published `what-server/node.d.ts` but TypeScript still could not see the Node-only
exports. Two further causes, both now fixed and both now covered by a gate that fails
without them.

### Fixed

- **Export conditions resolve first-match, and `"types"` was listed before `"node"`.** The
  top-level `types` therefore won for every resolver and the `node` condition's
  declarations were unreachable, so `createServer`, `toNodeListener`, `whatMiddleware`,
  `exportStatic`, `createVercelHandler` and `buildVercelOutput` still did not typecheck.
  The `node` condition now comes first. Runtime resolution is unchanged: Node already
  ignored `types` and matched `node`.
- **`what-server/node.d.ts` referenced `node:http`**, which made `@types/node` a hard
  requirement for every consumer of what-server, including browser and edge consumers that
  never touch that entry point. `createServer` now returns a structural `NodeHttpServer`
  interface covering `listen`/`close`/`address`/`on`. The runtime value is still an
  `http.Server`.
- **`hygiene:publish`'s packed-consumer typecheck now imports node-only exports**, so a
  shadowed or unpublished condition fails the gate instead of reaching npm.

## [0.12.1] - 2026-08-09: packaging fix for what-server type declarations

### Fixed

- **`what-server` pointed its `node` export condition at a declaration file it did not publish.** 0.12.0 added `exports["."].node.types = "./node.d.ts"` but left `node.d.ts` out of `files`, so TypeScript consumers resolving the `node` condition (the normal case under `node16`/`nodenext`) got a dangling types path and "could not find a declaration file". JavaScript consumers were unaffected. If you are on 0.12.0 and use TypeScript with what-server, upgrade.
- **`hygiene:publish` now verifies that every `types` path declared anywhere in `exports` is actually in the package tarball**, walking nested export conditions rather than only the top-level key. Nothing caught the above: the workspace resolves the path fine and the failure only appears after a consumer installs. Verified by reintroducing the bug and watching the gate fail.

## [0.12.0] - 2026-08-09: competitive parity, and four headline features that never worked

Correctness work from the 2026-08-09 competitive parity audit. Almost every item here is a
feature that existed, was documented, and did not work.

Minor rather than patch for two reasons: `<Form>` is new public API, and the
`nestedRoutes()` path fix is breaking for anyone who worked around the index-route bug by
linking to the trailing-slash URL. See BREAKING below.

### Breaking

- **`nestedRoutes()` now joins paths on segment boundaries.** An index child previously
  produced `basePath + '/'` (`/dashboard/`), which the base URL never matched. It now
  produces the base itself (`/dashboard`). If you worked around this by linking to
  `/dashboard/`, point those links at `/dashboard`. `{ path: '' }` was already correct and
  is unchanged.
- **Node-only server exports moved to the `node` condition's declarations.** `createServer`,
  `toNodeListener`, `whatMiddleware`, `exportStatic`, `createVercelHandler` and
  `buildVercelOutput` are declared in `what-server/node.d.ts` instead of the root
  `index.d.ts`. TypeScript consumers resolving the `node` condition (the normal case) are
  unaffected; anyone resolving the browser/edge condition no longer sees types for
  functions their runtime never had.

### Added

- **`<Form>`.** The no-JS server-action path already worked, but reaching it meant hand-writing four exact things per form: the endpoint, the `_action` id, the `what-csrf-token` field and the `_redirect`. Misspelling the CSRF field is silent, the POST is simply rejected. `<Form action={createPost} redirect="/">` emits a real `<form method="post">` that submits with JavaScript disabled and is enhanced to a fetch when JS is present. It takes the action function itself, so the id cannot drift.
- **`invalidateQueries(['todos'])` accepts a prefix.** An array key now invalidates everything beneath it (`['todos', 1]`, `['todos', {done: true}]`), matching the shape's obvious meaning. Matching is on segment boundaries, so `['todo']` never matches `'todos'`. Pass `{exact: true}` for the single key.
- **`tsconfig.json` and a `typecheck` gate.** The `.d.ts` files are the only part of this repo TypeScript ever sees, they are written by hand, and nothing compiled them. Typechecking them under `NodeNext` (what a modern `"type": "module"` consumer uses) found 24 extensionless relative imports, which meant importing the framework's types under `node16`/`nodenext` resolution produced errors before a consumer wrote a line of code, plus three island interfaces declared twice. Runs in CI and `release:verify`.
- **Type declarations for 35 exports that had none**, including `hydrate`, `renderDocument`, `renderToStringAsync`, `serializeState`, the CSRF helpers, the action handlers, the deploy adapters and the testing utilities. The type-parity gate is now bidirectional and runs in CI and `release:verify`: it previously caught declarations with no runtime export but never the reverse, so shipped features stayed invisible to every TypeScript user.

### Fixed

- **`nestedRoutes()`'s index child never matched.** `path: basePath + child.path` turned the README's own documented example (`nestedRoutes('/dashboard', [{ path: '/' }, ...])`) into `/dashboard/`, which `/dashboard` does not match, so the documented shape 404s on its own index route. Paths are now joined on segment boundaries, and a base with a trailing slash or a child without a leading one both work.
- **`<FileRouter error={...}>` was declared, destructured, and never used.** A documented public prop that silently did nothing. `FileRouter` also dropped each route's own `loading` and `error` while mapping the file-router format, so neither convention could ever render. Route-level components now win, with the `error` prop as the default.
- **`RouteConfig.error` was typed `Component<{ error: Error }>`** while the runtime invokes it with `{ error, reset }`, so the recovery callback was invisible to TypeScript users.
- **The loading component shown during a navigation belonged to the route being LEFT.** `_url` only commits when the navigation finishes, so while an async guard ran the router still matched the departing route and rendered its `loading:`. A `loading:` declared on the page being navigated TO could never be shown. The destination's now wins, falling back to the departing route's for the case that was already deliberate and tested.
- **`ErrorBoundary` and `Suspense` stopped working the moment an app became interactive.** The reactive fn-child effect re-runs long after the render that created it, when the component stack is empty, so everything it built on a re-run got `parentCtx = null` and the owner chain was severed. The two mechanisms that walk that chain both went blind: `ErrorBoundary` did not catch a throw from any component rendered after a state change (the region simply went blank), and `Suspense` did not see a `lazy()` component reached by a state change, so its pending promise escaped as an uncaught error and the region stayed empty forever. Both worked on first paint, which is why no first-render test caught either. This also blocked route-level code splitting outright: navigating to a `lazy()` route rendered a permanently blank page. The compiled fine-grained path was unaffected; this was the runtime `h()` path, which is what the router itself renders through.
- **The router read bare `scrollX`/`scrollY` globals** in two places while using `window.scrollY` in others. Those only resolve when `window` IS the global object, so any environment that provides `window`/`document` without copying every window property onto `globalThis` (jsdom-based SSR tests, some worker shims) threw `ReferenceError` on the first navigation.
- **`client:*` island directives deleted their own component.** `<Counter client:idle />` rendered an empty marker div on *every* path: the server branch never rendered the component, and the client branch read `hydrated()` once inside a run-once component so the swap-in never fired. Islands now render their HTML on the server and hydrate in place over that exact DOM (verified: the server node is reused, not replaced, and no content is rendered twice). `mode: 'static'` ships HTML and attaches no JS at all.
- **Island children and spread props were dropped by the compiler.** The island branch handed the runtime an empty children array and `continue`d past every spread, so `<Panel client:visible {...cfg}>text</Panel>` lost both its text and every prop in `cfg`. Both now pass through the same children protocol as any other component, with explicit attributes winning over the spread and the directive's own `mode` winning over both.
- **`ref` never fired when hydrating.** `hydrateElementProps` skipped the prop outright, so any component that reached for its own DOM node through a ref got nothing under SSR while working correctly in a client-only render: a bug that only reproduces in production.
- **`aria-*` and `role` were serialized as HTML booleans.** A generic boolean branch ran before the ARIA branch, so `aria-checked={true}` became `aria-checked=""` (not a valid enumerated value) and `aria-checked={false}` removed the attribute entirely, which reads as "unsupported" rather than "unchecked" to assistive technology. The server dropped the `false` case too. Genuine HTML boolean attributes such as `disabled` keep HTML boolean semantics.
- **`useId()` allocated from a process-global counter.** Ids drifted between the SSR pass and hydration and interleaved across concurrent requests, breaking exactly the `for` / `aria-labelledby` relationships the primitive exists to create. The counter is now render-scoped, and `hydrate()` restarts the sequence so the client reproduces the server's ids.
- **SSR ran without a render scope under any DOM shim.** `renderToString` established its render context only when `typeof document === 'undefined'`, which is a proxy for "am I on the server" that is wrong under jsdom, happy-dom or a Workers polyfill. The scope is now established by "no scope yet", which is the actual condition.
- **Array query keys missed the cache from every API except `useQuery`.** `useQuery` joined `['todos', 1]` into a string while `invalidateQueries`, `prefetchQuery`, `setQueryData` and `getQueryData` used the raw value, so they looked up an `Array` object as a `Map` key and silently did nothing. Segments now escape `:`, so `['user', 'a:b']` can no longer collide with `['user', 'a', 'b']` and serve one query's data to another.
- **React elements carried no `$$typeof` brand.** Ecosystem libraries do not duck-type elements: MUI, emotion, styled-components, recharts and react-select all check the brand before treating a value as renderable, so compat elements were classified as plain objects and rendered nothing. `memo`, `lazy` and `Suspense` are branded too. The brand is also what makes elements XSS-safe against JSON injection, since a symbol cannot survive `JSON.parse`.
- **`what-framework/server` and `what-framework/testing` declarations had drifted 45 and 4 exports behind their runtimes.** Both runtimes are pure barrels; their declarations now mirror that with `export * from`, so they cannot drift again. Node-only adapters (`createServer`, `toNodeListener`, `whatMiddleware`, `exportStatic`, the Vercel pair) moved to a `node` condition declaration rather than being promised to browser and edge consumers.
- **The client form enhancer's CSRF error named a meta tag the framework never emits** (`csrf-token` instead of `what-csrf-token`), sending anyone who hit it to add the wrong tag.
- **`what_connection_status` under-reported the MCP tool catalogue by 41%.** The tool agents are told to call FIRST answered with a hand-maintained array of 17 entries while 29 tools were registered. The catalogue is now derived from registration itself, and additionally splits tools by what can answer with no browser attached, which is the distinction that actually costs an agent turns.

## [0.11.8] - 2026-08-09: security, correctness and release-gate remediation

The largest correctness release since 0.10. It closes both CRITICAL and all ten HIGH
findings from the 2026-07-26 product review, the four advertised features that were
broken in shipped code, and the follow-on defects the 2026-08-09 audit found in the
remediation itself. If you are on any 0.11.x, upgrade.

### Security

- **cache: `vary` declared as anything other than an array produced a shared cache key AND `Cache-Control: public`.** `vary: 'cookie:session'`, the most natural shorthand, was treated as an already-resolved map, so the key was built from the declaration string's character indices: one entry for every user. `buildCacheHeaders` independently re-tested `Array.isArray` and emitted `public` at the same time, so both failures pointed the same way and there was no second line of defence. A single `normalizeVaryDeclaration()` now feeds both; it accepts `string` and `string[]` and fails closed on every other shape.
- **cache: `redactVary()` had never actually redacted anything.** `cacheKey()` joined its fields with a NUL byte while `redactVary()` searched for a space, so it found no separator and returned every key verbatim, session token included. This affected the Redis store and the filesystem store equally. The separator is now one constant.
- **cache: the filesystem store never redacted at all**, so it wrote raw session cookies into the entry body and both reverse indexes, three copies per entry with no TTL on the index files.
- **release: the publish workflow ran its browser-backed gates in silently degraded mode.** It never installed Chromium, so on the exact run that ships to npm, 15 browser tests skipped and the scaffold smoke fell back to an HTTP-only marker check, skipping SSR hydration, the server-action round trip and the ISR cache assertion. The run still printed green.

### Changed

- **router: `parseQuery()` returns a null-prototype object.** `route.query` and the object returned by `parseQuery()` are created with `Object.create(null)`, which closes prototype-pollution via a crafted query string (`?__proto__=x`). This is observable: `query.hasOwnProperty(k)`, `query.toString()` and anything else inherited from `Object.prototype` is no longer available on the result. Use `Object.prototype.hasOwnProperty.call(query, k)` (or `k in query`) instead. Reading, spreading, `Object.keys()`, `JSON.stringify()` and destructuring are unaffected.
- **cache: Redis cache keys now store a hash of the `vary` segment instead of its raw value.** Redis keeps key names and set members verbatim, so raw `vary` values (which include session cookies) were readable via `SCAN`, echoed by `MONITOR` and captured in RDB/AOF backups. Path and query stay legible. Existing Redis entries for `vary` routes are keyed under the old scheme and will miss once; they expire on their own TTL.
- **cache: an explicit `revalidate: 0` in a page config is honoured** instead of being coerced to the 60s hybrid default.
- **router: `isSafeUrl()` rejects a backslash in any scheme-less URL**, not only in one starting with `/`. Browsers normalize the backslash to a forward slash, so `\evil.com` resolved off-origin. Allowlisted absolute URLs are unaffected.

### Fixed

- **cache: `revalidate: 0` meant cache forever.** The value propagated correctly and was then turned into `expiresAt: Infinity`, so the one setting a developer reaches for to disable caching did the opposite. An explicit `0` is now immediately stale; an undeclared revalidate on a static route still stays durable.
- **create-what: the full-stack template scaffolded MCP config it never wired up.** It shipped `.mcp.json`, `.cursor/mcp.json` and a CLAUDE.md promising 29 live tools while omitting `what-devtools`, the browser bridge the MCP server talks to, so every live tool reported no browser. It now installs, serves and bootstraps the bridge in dev.
- **devtools-mcp: `what_fix` accepts `errorCode` as well as `error`.** Every CLAUDE.md this project has scaffolded documented `{errorCode}` while the schema only took `{error}`, so the tool the guide tells agents to reach for FIRST returned a validation error. The docs are corrected and the alias is permanent.
- **repo: the root `package.json` version tracks the release again.** It read 0.11.0 while the group shipped 0.11.1 through 0.11.7.
- **core: hydrated components no longer leak.** The hydration path attached the component context to no DOM node, so `disposeTree` could not reach it and every hydrated component leaked its cleanups, `useEffect` disposers and reactive-child effects.
- **core: head dedup keys are escaped before entering a CSS selector.** A key containing selector metacharacters (including the `JSON.stringify` fallback used for a meta with no `name`/`property`) raised `DOMException: Invalid selector` and broke all client head management.
- **cache: the filesystem store reads the pre-0.11.8 reverse-index shape.** The index changed from one JSON array per tag/path to a directory of per-key files with no migration, so after an in-place upgrade `deleteByPath`/`deleteByTag` returned `[]` for pre-upgrade entries while the revalidate webhook still reported success.
- **cache: `revalidatePath()` and `revalidateTag()` no longer reject** when the resolved route cannot be keyed.
- **server: `what-server/islands` ships its type declarations.** `islands.d.ts` was in neither the `files` array nor the subpath's `types` condition.
- **core (types): `Component<P>` may return `null` again.** The narrowing to `() => VNode` made `Show`, `For` and any component that legitimately renders nothing fail typecheck.

## [0.11.7] - 2026-07-16

Patch release. All 14 packages move together to 0.11.7.

### Fixed

- **server: Node request and island state remain isolated across concurrent async rendering without leaking Node built-ins into browser or edge bundles.** `AsyncLocalStorage` now lives behind the Node server export condition; the default server entry stays browser-safe while Node SSR preserves request-local action and island state.
- **compiler: removed server actions no longer survive Vite hot reload.** The action registry now clears IDs owned by an updated or unlinked module before registering its current exports, preventing stale action dispatch after edits.
- **compiler: server action transforms keep stable, collision-resistant IDs and preserve the complete production Node server API.** Browser-bundle and packed-package regressions exercise the same public entry points consumers install.

### Verified

- Node 20 and 22: 1,493 regular tests plus 40 adversarial stress tests.
- Build, all 37 public subpath checks, packed declarations, production smoke, and packed SPA/full-stack scaffold smoke.

## [0.11.6] - 2026-07-11 — runtime `<Show>`/`<For>`/`<Switch>` are reactive

Patch release. All 14 packages move to 0.11.6 together (fixed-group release). One correctness fix (#22) surfaced by production app work, plus release-workflow hygiene (#20, #21). No API changes.

### Fixed
- **core: the runtime `<Show>`, `<For>`, and `<Switch>`/`<Match>` built-ins are now reactive.** When JSX goes through the automatic runtime (`jsxImportSource: "what-framework"` — the standard Vite/esbuild/tsc setup) or a direct `h()` / `_$createComponent()` call, these control-flow helpers are invoked as the `Show()`/`For()`/`Switch()` component *functions* in `packages/core/src/components.js`. Because components run once and never re-execute, these functions read their reactive prop (`when()` / `each()`, or each `<Match>`'s `when()`) eagerly in the run-once body and returned **static** content — so `<Show when={() => authed()}>` rendered once and never advanced when the signal flipped (the classic identity-gate trap), `<For each={() => items()}>` never re-rendered on list change, and `<Switch>`/`<Match when={() => sig()}>` never switched arms. All now return a reactive **thunk**, which `createDOM`'s fn-child path wraps in a fine-grained effect — the same reactive form the fine-grained babel plugin already lowers `<Show>`/`<For>` to. This aligns the JSX pipelines: for `<Show>`/`<For>` the compiler path was already reactive and the runtime path now matches; `<Switch>`/`<Match>` are **not** lowered by the compiler at all, so the runtime path is the only path and the thunk is what makes them reactive in the first place. `<For>`'s empty-list `fallback` and auto-key detection, and `<Switch>`'s fallback + `<Match>` resolution, are all preserved; `.map()` with a `key` prop (or the compiler-lowered `<For>`) remains the keyed-efficient list path. Note: PR #18 fixed a *different* bug (user-written thunks in a component's array child position) and did not touch these helpers, which never emit a thunk into a child position. Surfaced in a fresh 0.11.5 app whose `<Show>` identity gate never advanced.

### Verified
- New regression suite (`packages/core/test/reactive-show-for-runtime.test.js`, 7 cases) drives the runtime path exactly as the automatic JSX runtime emits it (`_$createComponent(Show|For|Switch, ...)`, with `<Match>` as a lazy `h(Match, ...)` marker vnode): `<Show>` flips on a `() => sig()` thunk and on a bare signal accessor; `<For>` re-renders when the list grows/shrinks and honors the empty-list fallback; `<Switch>` flips between `<Match>` arms and to fallback in both directions and reacts to a bare signal accessor; and a plain component with a thunk child updates. Fails on 0.11.5 (6 Show/For/Switch assertions render once and never update), passes now.
- Full suite green (1475 tests) plus the adversarial stress suite (40). Build, `check:size` (within budget), and `test:prod` (built-dist reactivity smoke) all pass.

## [0.11.5] - 2026-07-06 — nullish attribute values render as absent, not the literal string "undefined"

Patch release. All 14 packages move to 0.11.5 together (fixed-group release). One production-surfaced correctness fix, no API changes. Same family as the previously-fixed aria-boolean coercion bug.

### Fixed
- **core: `null`/`undefined` attribute values now mean "no attribute" (React/Solid semantics) instead of stamping the literal string `"undefined"` / `"null"`.** `<button title={maybeUndefined}>` previously rendered `title="undefined"` in the DOM; a `data-`/`aria-` attribute bound to an undefined value rendered `aria-label="undefined"`; and a reactive attribute thunk that returned `undefined` on a later update stamped `"undefined"` rather than removing the attribute. Both client-side `setProp` implementations — `dom.js` (the `h()`/`createDOM` path) and `render.js` (the fine-grained-compiler path, used for spreads and any name the compiler can't statically classify) — passed a nullish value straight through to `el.setAttribute(key, value)` (in the `data-*`/`aria-*`, SVG, and `key in el`/default branches), which coerces `undefined`/`null` to a string. Both now short-circuit a nullish value to `removeAttribute(key)` before those branches (resetting any reflected DOM property first, e.g. `el.title`, so the attribute and property clear together and a later reactive update re-adds cleanly). Legitimate falsy values are unchanged: `0` and `""` still set the attribute (`0` / empty), `false` still removes a boolean attribute, and `on*` handlers are unaffected. The compiler's statically-recognized `data-*`/`aria-*` path (`setAttr`) already removed on nullish; this closes the same gap in the two generic dispatchers. The SSR serializer (`what-server` `renderToString`) already skipped nullish attributes and is now covered by regression tests. Surfaced in production app work on 0.11.4.

### Verified
- New regression suite (`packages/core/test/attr-nullish.test.js`, 22 cases) covers both client `setProp` paths and the SSR serializer: static `undefined`/`null`, `data-*`/`aria-*` variants, a reactive attr transitioning value→undefined→value (removes then re-adds), spreads with nullish values, and the preserved semantics for `0`, `""`, `false`/`true` booleans, and `on*` handlers. Fails on 0.11.4 (13 client-path assertions stamp `"undefined"`), passes now.
- Full suite green (1462 tests) plus the adversarial stress suite. All release gates pass on clean `main`: `hygiene:publish`, `build`, `check:size` (within budget), `test:prod`, `bench:gate`, `smoke:scaffold`.

## [0.11.4] - 2026-07-04 — reactive branch-switch reconciler fix; exports-map CJS-resolve regression; devtools-mcp graceful degrade

Patch release. All 14 packages move to 0.11.4 together (fixed-group release). Three production-surfaced fixes, plus the devtools/MCP prod-leak hardening carried over from Unreleased. No API changes. 0.11.3 shipped an exports-map packaging regression that broke real consumers (see below), so this patch is warranted for that alone.

### Fixed
- **core: a reactive `() => cond ? <Component/> : <element>` thunk that is the direct child of an element no longer stacks copies of the component branch on repeated toggles.** A component realizes to a `DocumentFragment` bounded by comment markers (`<!--c:start--> … <!--c:end-->`). The single-node "replace" fast path in `reconcileInsert` treated that fragment `value` as one node and called `parent.replaceChild(fragment, current)` — but inserting a fragment moves its children into the DOM and leaves the fragment **empty**, so the value stored as the new `current` no longer referenced the real inserted nodes. The next switch away therefore could not find or remove them, and each return to the component branch **appended another copy** (a production dashboard stacked four empty-states). Branches returning a single intrinsic element swapped cleanly via a real `replaceChild`, which is exactly the asymmetry that hid the bug. `DocumentFragment` values (and `current`) are now excluded from that fast path on both sides, so a component branch always flows through `valuesToNodes`, which flattens the fragment to its child nodes and tracks each one for correct removal on the next reconcile. Distinct from the 0.11.3 thunk-in-array-child fix (that covered array child positions; this covers the direct single-value child position) and from the 0.11.2 component-swap fix (that covered `valuesToNodes` tracking; this covers the fast-path bypass of it). Surfaced in production dashboard work on 0.11.3.
- **packaging: every public package export resolves again under `require()` / `createRequire().resolve()`, not only `import()` — fixes a 0.11.3 regression.** In 0.11.3, `what-react`'s subpath exports were rewritten from plain-string targets (which resolve under *every* condition) to conditional objects listing only `types` + `import`, with **no** `require`/`default` fallback. A bare-string export like `".": "./src/index.js"` resolves for both ESM and CJS; a `{ types, import }` object does not — the CJS resolver has no `import` condition, so `createRequire(...).resolve('what-react')` (and `/dom`, `/vite`, `/jsx-runtime`, `/jsx-dev-runtime`) threw `ERR_PACKAGE_PATH_NOT_EXPORTED`, breaking a real consumer's `vite.config` + Vitest, which resolve our packages through Node's CJS resolver. Every public package's conditional exports entry now ends with a `default` condition pointing at its ESM source, so all 37 public subpaths across the 14 packages resolve under `require()` as well as `import()`. (The other conditional-export packages — `what-framework`, `what-core`, `what-router`, `what-server`, `what-isr`, `what-compiler`, `what-text` — never had a `default`/`require` condition either; they are hardened here in the same pass.)
- **devtools-mcp: the Vite plugin no longer crashes `vite dev` when the optional `what-devtools` peer is not installed.** The injected bootstrap does `import { installDevTools } from 'what-devtools'`; with the peer absent, Vite's dev transform could not resolve that bare import and the whole dev server died with a transform error. `what-devtools` is now a formally optional peer (`peerDependenciesMeta`), and the plugin probes for it up front (resolve from the project root). When it's missing, the plugin degrades gracefully — `resolveId`/`load`/`transformIndexHtml` inject nothing and it logs one clear, non-fatal `console.info` ("`what-devtools` is not installed — skipping DevTools/MCP dev injection") — instead of crashing dev.
- **devtools-mcp: the DevTools/MCP client can no longer leak into a production build.** The Vite plugin (`what-devtools-mcp/vite-plugin`) injects a `<script src="/@id/…virtual:what-devtools-mcp/bootstrap">` that installs the devtools client and opens a WebSocket to a local bridge. It was guarded only by `apply: 'serve'`, which excludes it from `vite build` — correct, but a single point of failure: a meta-framework that flattens plugin arrays and re-invokes hooks, a consumer that spreads the plugin into another plugin's returned list, or a config that forgets its own command guard can defeat `apply` and ship the dev-only bootstrap into prod. When that happened on a real deploy, the production page requested `virtual:what-devtools-mcp/bootstrap` (500 in prod) and, with a dev server live on the machine, could follow it to `localhost`. The plugin now also captures the resolved Vite command in `configResolved` and makes `resolveId`/`load`/`transformIndexHtml` no-op whenever `command === 'build'`, and the injected bootstrap wraps its side effects in `if (import.meta.env.DEV)` so that even a directly-imported bootstrap dead-code-eliminates and tree-shakes to nothing in a prod bundle. Net effect: a production build now contains **zero** devtools/MCP code regardless of how the plugin is wired. (The browser client already refused to connect under `import.meta.env.PROD`; it performs no cross-origin navigation.) (PR #19)

### Verified
- New regression test (`packages/core/test/reactive-thunk-branch-switch.test.js`) toggles a direct-child thunk between a bare component and an intrinsic element, a bare component and another bare component, and a bare component and `null`, asserting exactly one copy after repeated cycles (fails on 0.11.3 — orphaned/stacked component fragments — passes now).
- New hygiene guard in `scripts/check-publish-surface.mjs` (run by `hygiene:publish`) exercises `createRequire().resolve()` for every public exports subpath across all 14 packages, so an exports map can never silently drop its CJS entry point again. Verified it fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` against the 0.11.3-style map and passes after the fix.
- New regression test (`packages/devtools-mcp/test/vite-plugin-missing-peer.test.js`) drives `configResolved` with a project root outside the workspace (peer unresolvable) and asserts no injection + one notice + no throw; and, with the peer present, that injection still happens. The prod-build regression suite (`vite-plugin-prod-build.test.js`) — real `vite build`, zero devtools refs, with and without `apply` — still passes.
- Full suite green (1440 tests) plus the adversarial stress suite. All release gates pass on clean `main`: `hygiene:publish`, `build`, `check:size` (within budget), `test:prod`, `smoke:scaffold`, `bench:gate`.

## [0.11.3] - 2026-07-04 — reactive thunk-in-array-child fix; TypeScript declarations (JSX, what-react, what-compiler)

Patch release. All 14 packages move to 0.11.3 together (fixed-group release). No API changes — one reactivity fix plus additive TypeScript declarations.

### Fixed
- **core: reactive `() => expr` thunks passed as a component child or prop are now live wherever they land in a render position.** Previously a thunk only stayed reactive when it was the direct child of an *intrinsic* element (`<div>{() => count()}</div>`). Passed to a component with a sibling — e.g. `<Card><Header/>{() => body()}</Card>` — the compiler lowers the children to an array (`_$createComponent(Card, null, [<Header/>, () => body()])`), so `props.children` is an array and `{props.children}` compiles to `_$insert(el, props.children)`. That array skipped `insert()`'s function/effect branch and reached `valuesToNodes`, which resolved the thunk exactly once (`value()`) with **no** reactive subscription — the child rendered its initial value and never updated, silently. (A single-child thunk worked by luck: `props.children` *was* the thunk, hitting `insert()`'s function branch.) `valuesToNodes` now routes function values through `createDOM`'s reactive fn-child path — a dedicated effect between stable comment markers — so a thunk in an array position updates exactly like one that's the direct child of an element. Event handlers and manually-called render props are unaffected (only functions in a render/child position reach `valuesToNodes`). Surfaced in production dashboard work on 0.11.2.

### Added
- **JSX TypeScript types.** `what-framework/jsx-runtime` and `what-core/jsx-runtime` (and their `jsx-dev-runtime` counterparts) now ship type declarations, including a `JSX` namespace with `IntrinsicElements`. TypeScript users authoring JSX with `"jsxImportSource": "what-framework"` previously got `TS7026` (no `JSX.IntrinsicElements`) and `TS7016` (no declaration for `what-framework/jsx-runtime`) on every element under `strict`; JSX now type-checks. Types mirror What's lenient runtime — both `class`/`className`, camelCase and lowercase event handlers, reactive `() => value` attribute values, `data-`/`aria-`/custom attributes, and SVG — while still rejecting genuinely wrong props (e.g. a non-function `onclick`). Works under `jsx: "react-jsx"`, `"react-jsxdev"`, and `"preserve"` (the create-what scaffold config).
- **`what-react` TypeScript types.** The React compatibility layer previously shipped no declarations — `import { useState } from 'what-react'` and JSX authored with `"jsxImportSource": "what-react"` resolved to `any`. `what-react` now ships `.d.ts` for its full public surface: hooks (`useState`/`useReducer`/`useMemo`/`useRef`/`useContext`/… with React generics), `createElement`/`forwardRef`/`memo`/`lazy`/`Suspense`/`Children`/`cloneElement`, class-component bases, the `React` default object, `what-react/dom` (`createRoot`/`hydrateRoot`/`createPortal`/…), `what-react/vite`, and a React-flavored `JSX` namespace (camelCase events, `className`, object `style`). Wrong props/hook arguments are rejected (not blanket `any`).
- **`what-compiler` TypeScript types.** The compiler's public API now ships declarations for the Vite plugin (`what`/`vitePlugin` with typed `WhatVitePluginOptions`), the Babel plugin, the file-router codegen (`scanPages`/`extractPageConfig`/`generateRoutesModule`/…), and the runtime re-exports — so `vite.config` / `babel.config` authoring against `what-compiler` is type-checked.

### Verified
- Full suite green (1431 tests) plus adversarial stress suite. New regression test covers the thunk-in-array-child reactive path; the TypeScript declarations are type-checked against fixture JSX/TS under `strict`.
- All release gates pass on clean `main`: `hygiene:publish`, `build`, `check:size` (within budget), `test:prod`, `smoke:scaffold`, `bench:gate`.

## [0.11.2] - 2026-06-26 — recharts SVG portal fix; persistent router layout; component-swap reconciler fix

### Fixed
- **react-compat:** SVG portal children are now created in the SVG namespace (recharts 3.x renders its chart layers via `createPortal` into SVG `<g>` targets — previously they were created in the HTML namespace and never painted).
- **react-compat:** camelCase SVG presentation props (`strokeWidth`, `fillOpacity`, `clipPath`, `strokeDasharray`, …) now map to the correct kebab-case SVG attributes instead of being written as invalid lowercase attributes.
- **router:** `globalLayout` is now persistent across navigations. The layout was wrapped around the matched element *inside* the per-URL reactive thunk, so every `navigate()` rebuilt the global layout — re-instantiating the app shell and everything it mounts (sidebars, toasters, command palettes, global key listeners) on each route change. The layout is now rendered once around a reactive `content` child, so navigation reconciles only the matched page in place. 404/403/redirect screens now render inside the shell. The no-`globalLayout` path is unchanged.
- **core:** component-subtree swaps via a reactive `{expr}` child no longer orphan the previous subtree. `reconcileInsert`/`valuesToNodes` tracked the whole `DocumentFragment` a component realizes to (`<!--c:start--> … <!--c:end-->`), which empties on insertion — so the next swap could not find or remove the old nodes and appended instead of replaced. Fragment children are now flattened into the tracked set (mirroring the `createDOM` reactive fn-child path). Surfaced by the router `globalLayout` change; affects any app swapping components through a reactive expression.

### Verified
- recharts 3.8.1 added to the verified compat matrix (browser-tested); replaced the prior fake-green recharts fixture with a real acceptance section.
- Full suite green (1416 tests). New regression tests: router globalLayout persistence; `insert()` component-subtree swap removes the old subtree.

## [0.11.1] - 2026-06-10 — Audit fixes: release hygiene, scaffold security, browser production mode

A focused follow-up to 0.11.0 from a full public-surface + engineering audit.
All 14 packages move to 0.11.1 together (fixed-group release). No API changes.

### Fixed
- **`what-framework-cli init` produced a non-working scaffold** — it generated
  only `package.json` + config, with scripts calling a `what` bin no dependency
  provided. `init` now delegates to the create-what scaffolder and produces a
  runnable app (regression-tested so a phantom-bin script can't return).
- **Fullstack template served all of `/src/` over HTTP** — `src/db.js` and
  `src/actions/**` (server-only code) were fetchable in dev *and* prod. Static
  serving is now deny-by-default: only client assets resolve; server-only
  modules 404. Verified against a path-traversal/encoding attack battery.
- **Production bundles ran in dev mode in the browser** — `__DEV__` defaulted to
  `true` whenever there was no `process` global (i.e. every browser), shipping
  dev warnings/guards and surfacing a spurious internal `template()` XSS warning
  on production sites. `__DEV__` now resolves production-safe
  (`globalThis.__WHAT_DEV__` › `import.meta.env.DEV` › `process.env.NODE_ENV` ›
  `false`); production builds dead-code-eliminate all dev branches.
- **No-JS form submission failed** — SSR forms omitted the `_action`/CSRF inputs
  the server required; the server now also accepts the CSRF token from the form
  body, so rendered forms submit without JavaScript.
- **Unknown routes returned cacheable soft-404s** — now real `404`s with
  `no-store`, never ISR-cached.

### Changed
- **Playground teaches JSX, not `h()`** — examples are authored in JSX and
  compiled in-browser by the real What compiler (added a "view compiled output"
  toggle). Previously 238 hand-written `h()` calls.
- **Docs & marketing sites** — working docs search (`/` + Cmd-K), honest
  react-compat hero, build-time version badges, favicons; one consistent version
  across every surface (was three).
- **Release hygiene is now mechanical** — `bump-version` sweeps version strings,
  the CHANGELOG stub, and the SECURITY window so versions can't drift again.

### Build & publish
- **what-core npm payload 4.2 MB → 423 KB** (clean `dist/` before build, ship
  only `dist/**/*.min.js`, no sourcemaps in the tarball); new size-budget CI gate.
- Compiler Vite 8 support (`oxc`), MCP `--help` on both bins, and the
  devtools-mcp `localhost:9230` console-noise fix (same-origin discovery).

## [0.11.0] - 2026-06-09 — React compat that actually runs React libraries, fullstack scaffold, compiler perf

All 14 packages move to 0.11.0 together (fixed-group release). The test suite
grew from 1068 to 1300+ tests.

### Changed — react-compat rework (breaking within the compat layer)
- **Real React hook semantics** — `useState`/`useReducer`/`useMemo`/etc. now
  return plain values (not signal accessors) and a compat re-render runtime
  re-executes compat components on state change, matching what React libraries
  actually expect. This is what unblocked real third-party libraries.
- **CJS React-ecosystem libraries load** (react-select, @emotion/* and friends)
  — the alias loader now handles CommonJS interop.
- **Six real libraries verified in CI on every push** (the `react-compat-libs`
  pillar job runs them against a live fixture, failing — not skipping — when the
  fixture is missing): zustand, @tanstack/react-query, react-hook-form,
  react-hot-toast, @headlessui/react, and framer-motion (browser-verified).

### Added — fullstack scaffold & CI gates
- **`npm create what -- --fullstack` produces a working app** — the template
  installs, builds, serves, and hydrates (file-routed SSR pages, a server
  action, origin-first ISR `server.js`). Previously the scaffold shipped broken
  (missing entry-client, unpublished dep name).
- **Scaffold smoke gate in CI** — every push scaffolds both templates from
  local tarballs, runs them, and asserts hydration in a real Chromium.
- **Deploy adapters verified end-to-end** (node / static / vercel / cloudflare)
  with full test coverage, plus a krausest-style benchmark harness
  (~1.06x vanilla JS on keyed list operations).

### Performance — compiler & runtime
- Branch memoization for conditional JSX (ternary/`&&` arms compile to cached
  templates instead of re-creating DOM).
- Specialized property setters emitted per attribute kind (class/style/value/
  generic) instead of one megamorphic `setProp`.
- Single-evaluation mount path and a zero-dependency effect release pool.
- Tree-shakeable compiled output — unused runtime helpers no longer anchor the
  whole module graph.

### Security
- Blocked backslash open-redirect variants (`/\evil.com`) in the server
  redirect path.
- Action request bodies are size-capped on the fetch-handler path (parity with
  the Node path).
- CSRF cookie is now issued with the `Secure` attribute.

### Fixed
- Reactive fragment expression children update correctly (previously static
  after first render in some fragment positions).
- `setStyle` clears stale keys when a style object loses properties.
- `what-devtools-mcp` handles WebSocket `EADDRINUSE` gracefully instead of
  crashing; MCP client console noise quieted; devtools test-runner hang fixed.
- ESLint presets (`plugin:what/recommended`) actually resolve; guardrails wired
  into the dev runtime; `what_eval` denylist hardened.

### Docs & claims honesty
- Removed fabricated benchmark numbers; standardized bundle-size claims to
  measured numbers; React-lib compat count corrected; MCP snippet fixed;
  tool count corrected 28 → 29.
- whatfw.com docs site is now itself built with What (SSG via
  `renderToString`, 40 pages).
- Shipped `llms.txt` / `llms-full.txt`.

## [0.10.0] - 2026-06-08 — Full-stack: SSR data, served actions, origin-first ISR

A complete full-stack story, built additively (no breaking changes; the 0.9
suite stays green and grew to 1068 tests). Everything is new files, new exports,
and new optional params.

> **Note:** `0.9.0` was never published to npm, so this release also delivers all
> of the `0.9.0` production-readiness fixes below — including the critical
> production blank-screen fix (`what-core` code-splitting). Upgrading from
> `0.8.4` gets both the fixes and the full-stack features.

### Added — SSR & data
- **Render-scoped server context** (`what-core` `server-context.js`) — the
  concurrency keystone. Sync `renderToString` uses a set/cleared module global
  within one tick; async paths (`renderToStream`, loaders, resources) thread the
  context explicitly, so SSR state never leaks across concurrent requests.
- **SSR `<Head>` collection** — `Head()` now writes title/meta/link into the
  render context (same dedup keys as the client) and returns its children on the
  server. New `renderToStringWithHead(vnode) → { body, head }`. `renderToString`
  is unchanged for existing callers.
- **Server data loaders** — co-locate `export const loader = ({ params, query,
  request }) => data` with a page; resolved before render and delivered via the
  isomorphic `useLoaderData()` (server reads the context, client reads the
  hydration payload). New `renderPage` / `renderDocument` seams.
- **Async Suspense streaming** — `renderToStream` resolves thrown promises;
  server-aware `createResource` suspends and serializes its result. A single
  consolidated hydration payload (`<script id="__what_data">`) carries
  `{ loaderData, resources, islandStores }`, XSS-escaped via `serializeState`.

### Added — actions
- **Served server actions** — `createActionHandler` mounts `POST /__what_action`
  (CSRF-validated, fail-closed, errors masked). `nodeActionMiddleware` and
  `fetchActionHandler` cover connect/express and edge/Deno/Bun. `action()` gains
  `revalidate` / `revalidateTags` that fire after success.

### Added — caching / ISR (`what-isr`, new package, zero runtime deps)
- **Origin-first ISR engine** — stale-while-revalidate, in-flight dedupe (one
  render for N concurrent misses), `getStaticPaths` fallbacks
  (`'blocking'`/`true`/`false`).
- **Stores** — memory (LRU + tag/path reverse indexes), filesystem (atomic
  tmp+rename, sharded), redis (injected client). Swappable without touching pages.
- **Invalidation** — `revalidatePath` / `revalidateTag` purge the origin store
  (and any CDN), wired into `what-server` via a registry indirection (no hard
  dep). Constant-time-secret revalidation webhook at `POST /__what_revalidate`.
- **Poll regeneration** — a zero-dep scheduler (`pollInterval`), self-rescheduling
  with jitter, a concurrency cap, joining the same in-flight lock.
- **CDN bonus** — `buildCacheHeaders` (`s-maxage` / `stale-while-revalidate` /
  `Cache-Tag` / `Surrogate-Key` / `X-What-Cache`) and `CDNAdapter` purge impls
  for Cloudflare / Fastly / Vercel. All optional — the engine no-ops without one.

### Added — routing, adapters, DX
- **Isomorphic matcher** — `what-router/match` (DOM-free `matchRoute`/`parseQuery`)
  for server use. File-router codegen now emits live `loader`/`getStaticPaths`/
  `page` bindings (SPA output byte-identical; server module separate).
- **Deploy adapters** — one Web-Fetch core powering `node`, `static`
  (`exportStatic`), `vercel` (`buildVercelOutput`), and `cloudflare`
  (`createCloudflareHandler`). `createServer` wires the poll scheduler + SIGTERM.
- **CLI `what start`** — runs the project `server.js` (Node adapter), forwarding
  SIGINT/SIGTERM for scheduler cleanup.
- **`create-what --fullstack`** — scaffolds a file-routed SSR app (loaders,
  `getStaticPaths`, a server action, origin-first ISR `server.js`,
  `what.config.js`) with a `what-isr` dep and a `start` script.
- **Examples** — `examples/blog` (loaders, ISR, action revalidation) and
  `examples/shop` (ISR grid, `mode:'server'` dashboard, cart actions), each with
  an end-to-end test proving the full SSR → loader → ISR → action → revalidate loop.
- **Docs** — new Full-Stack guides: Data Loading, Server Actions, Caching & ISR
  (with the no-CDN vs CDN graceful-degradation matrix), and Deployment.

## [0.9.0] - 2026-06-06 — Production-readiness pass

This release folds in the fixes from a full production-readiness audit. Highlights:

### Fixed (critical)
- **Production build no longer renders a blank page.** `what-core` is now built
  with code-splitting so `dom.js` (the component stack) and `reactive.js` (the
  tracking context) are a single shared instance across every entry. Previously
  the minified `index`/`render` bundles each inlined their own copy, so
  `useSignal()` read a different component stack than the compiler's
  `_$createComponent` pushed — blanking every production build. Added a
  `test:prod` smoke gate (run under `--conditions=production`) wired into
  `release:verify` and CI.
- **`npm install` resolves cleanly** — internal `what-*` peer/deps bumped to
  `^0.9.0` (were pinned `^0.8.4`, causing ERESOLVE).
- **Component disposal runs on list-item removal** — removing items from a list
  (keyed or unkeyed) now disposes the item's component context, fixing a leak of
  effects/cleanups/`onCleanup`/listeners/devtools registrations on every
  mutation.
- **DevTools MCP bridge locked to loopback origins** — the token endpoint no
  longer sends a wildcard CORS header and the WebSocket handshake requires a
  loopback `Origin`, closing a cross-origin token-theft / app-takeover vector.
- **Island SSR state is escaped** — `serializeIslandStores()` (and the new
  exported `serializeState()` helper) escape `</script>` breakout, fixing a
  stored-XSS vector for user-controlled store values.

### Fixed
- **Compiler: `.map()` inside a ternary/`&&` stays reactive** — the surrounding
  condition is now re-tracked instead of read once at mount.
- **Compiler is no longer O(n²)** for elements with many dynamic children —
  per-scope memoization of signal collection + a shared forward cursor walk for
  child markers make compile time and emitted size linear (an 800-child element
  went from ~366ms/3.8MB to ~20ms/88KB).
- **Effect errors are isolated during flush** — one throwing effect no longer
  aborts the rest of the batch; errors are reported, not swallowed silently.
- `what_eval` executes the same validated string it checks; `ws` floor raised to
  `^8.18.0`; `what-devtools-mcp` gains `repository`/`homepage` metadata.

### Changed
- **Canonical signal API unified on `signal()`.** `signal()` is now the single
  documented primitive for creating reactive state everywhere — module scope,
  component bodies, and stores. Because components run once, a `signal()` in a
  component body executes exactly once (no hook-ordering rule), so it fully
  supersedes the component-only `useSignal()`. `useSignal()`/`useComputed()`/
  `useEffect()` remain as a documented React-familiarity compat shim (they
  return the same objects). The `create-what` scaffold, landing page, Learn
  guide, and READMEs now lead with `signal()` + call-to-write (`count(v)`, with
  `count.set(v)` as the explicit alias); the React-migration guide keeps the
  `use*` mapping but points to `signal()` as canonical.
- Honest size/claims: docs and sites now state ~8KB gzip for a typical app
  (~31KB full runtime before tree-shaking) instead of the previous "12KB", the
  React-compat count is unified at 90+, and site versions are aligned to 0.9.0.
- CI runs on `ubuntu-latest` with Playwright Chromium installed; server tests
  are now part of `npm test`.

---

## [0.9.0-dev] - 2026-05-27

### Added
- **Interactive playground** (`examples/playground/`): CodeMirror 6 editor
  with sandboxed iframe preview, 5 starter examples, CSP-locked, infinite
  loop watchdog. No server-side execution.
- **Kanban example** (`examples/kanban/`): multi-board kanban with HTML5
  DnD, `what-router`, and localStorage persistence.
- New MCP tool `what_record_window`: effect-run delta over a sampling
  window. Answers "which effects fired during this action?"
- `what_set_signal` gains `rawString` parameter to bypass auto-coercion
- Compiler: `.map()` lowering now walks into ternary (`cond ? arr.map(...) : fallback`)
  and logical `&&` expressions for keyed reconciliation
- Compiler: `<For key={...}>` support
- Compiler: event modifier `__` syntax (JSX-safe, e.g., `onclick__prevent`)
- Devtools: component-scope attribution via stack-trace matching
- Devtools: pre-install signal buffer retroactively registers module-scope
  signals created before `installDevTools` runs
- 2 new lint rules: `destructured-props-lose-reactivity`,
  `module-scope-signal-missing-name`

### Fixed
- **Reconciler: adjacent-item removal corruption** — live-DOM boundary walk
  replaces stale marker references
- **Reconciler: adjacent swap infinite loop** — dedicated path for adjacent
  items avoids pre-computed boundary invalidation
- **Reconciler: general-case ref bug** — suffix items were positioned
  incorrectly when reorder occurred before a suffix
- **Compiler: TDZ ReferenceError** on early-return JSX with interpolation
  inside if/while/single-statement parents
- **Compiler: `<Show>` double-evaluated `when`** — hoisted into a local
- **Compiler: `<Show>` invoked non-functions** (member/literal expressions)
  as signal accessors
- `h()` stringified DOM-node children (`[object HTMLDivElement]`)
- JSX text trimmed adjacent to expressions (`"5items"` instead of `"5 items"`)
- `createStore` action return values silently dropped
- `setProp` and `spread()` effect disposers now tracked on `_propEffects`
  so `disposeTree` tears them down on unmount
- `what_set_signal` no longer corrupts non-primitive values (was double-
  stringifying arrays/objects)
- Vite devtools plugin works out of the box (virtual module pattern
  replaces broken inline bare-specifier script)
- `__drainPreinstallBuffer` was defined but not exported — devtools
  registry reported 0 signals in real apps
- SELECT value timing: shared `_setSelectValue` with microtask retry
- SVG class attribute: uses `setAttribute` instead of `className`
- Component invocation wrapped in `untrack()` — parent effects no longer
  capture inner subscriptions
- DnD drop-indicator flicker in kanban (dragleave debounce)
- Bench innerHTML warnings: 276 → 0

### Security
- `what_navigate`: reject `javascript:`, `data:`, `vbscript:` URLs
- Props proxy: block `__proto__`/`constructor`/`prototype` in get+set traps
- SSR URL sanitization: block `data:` protocol (was missing, client-side
  already blocked it)
- `what_eval` safe-read: strict property-access regex with proto denylist
- `dangerouslySetInnerHTML`: dev-mode XSS pattern warning
- Bridge: auth token redacted from startup logs

### Performance
- **Keyed reconciler swap/single-move fast paths**: single-item reorder
  drops from ~78ms to ~0.5ms in 420-card lists
- Multi-node item reconciliation via per-item markers (components returning
  fragments now reorder correctly under LIS)

### Docs
- README + QUICKSTART: fixed API examples (`useSignal` → `signal`)
- MCP tool count corrected: 18 → 29
- API.md: `h()` is public (was incorrectly claimed non-existent)
- MIGRATION-FROM-REACT: `what-core` → `what-framework`
- CLAUDE.md: Lists section with .map() vs <For> comparison table

### Tests
- 808 → 900 tests (+92)
- Server package: 36 tests from zero (SSR rendering + security)
- Security boundaries: 25 tests (URL validation, proto guard, XSS warn)
- Reconciler: swap, adjacent, multi-node, reuse-vs-dispose, untrack
- Compiler: Show variants, .map lowering, ternary, TDZ, event modifiers

## [0.8.4] - 2026-05-11

### Fixed
- CLI `what build` crash (`_configCache` initialization-order) when invoked via `npx --package what-framework-cli`
- CLI tests added for build and init commands

## [0.8.3] - 2026-05-11

### Fixed
- `create-what` scaffolded stale `^0.6.0` dependencies instead of the current release line
- `create-what --help` no longer accidentally creates an app
- CI workflow opts into Node 24 Actions runtime (preempt deprecation warnings)
- Benchmark gate tolerance loosened for GitHub-hosted runner noise

## [0.8.2] - 2026-05-11

### Changed
- Hardening release: corrected package metadata and cross-package dependency ranges
- Stress tests moved from `tmp/` to `stress-tests/` with README
- Server package gets built `dist/index.js` entry point

## [0.8.1] - 2026-05-11

### Fixed
- Corrected cross-package dependency version ranges to `^0.8.0`

## [0.8.0] - 2026-05-11

### Added
- `what-text` package — optional text engine integration with `@chenglou/pretext`
- Text components: `TextFlow`, `TextCanvas`, `TextSVG` (alpha)
- Core text hook: `configureText` / `getTextConfig` with `/text` subpath export
- Lazy Pretext loader, LRU `measureText` cache, font-ready gate
- `measureTextIfEnabled` hook in `insert()` (config-gated, skipped during hydration)
- Interactive Pretext demo at `/pretext.html`
- Text engine benchmark suite (6 scenarios)
- Playground moved to `playground.whatfw.com`

## [0.7.0] - 2026-04-06

### Added
- Interactive playground with 10 live examples
- Cross-framework benchmark harness (What vs React vs Svelte) with viewer dashboard
- MCP DevTools iterations R4–R15: tool audit, parallel-safe tools, diff metrics, Quick Start onboarding, offline scenarios, configurable port
- `create-what` scaffold includes MCP devtools, CLAUDE.md, `.mcp.json` by default
- CONTRIBUTING.md with git/PR/issue workflow rules
- Standalone MCP tool test runner

### Changed
- Signal read performance: 4.01x overhead reduced to 1.26x vanilla (rest-args allocation eliminated)
- Computed create+read: +64% faster; diamond dependency: +81% faster (WeakMap to direct property)
- DOM rendering pipeline optimizations (stable effects, lightweight scopes)

### Fixed
- Compiler: strip `key` props (no VDOM diffing), scope-aware transforms
- 4 blocking compiler/runtime issues (#1–#4)
- MCP tool fixes: component tree, eval safe-read, signal trace, watch flush

### Security
- Removed hardcoded MCP token

## [0.6.0] - 2026-03-26

### Added
- Agent-first MCP tools, structured error system (`WhatError`, `ERR_*` codes), and guardrails
- Error overlay, testing utilities (`renderTest`, `act`, `waitFor`), and dev panel improvements
- Benchmark regression gate (`npm run bench:gate`) in CI
- SECURITY.md with responsible disclosure policy
- CHANGELOG.md
- Parallel CI jobs: test (Node 20+22 matrix), build, audit, bench-gate

### Changed
- ErrorBoundary and Suspense boundaries now use comment node markers (`<!-- eb:start -->` / `<!-- eb:end -->`) instead of `<span style="display:contents">` wrappers, eliminating DOM pollution, CSS selector breakage, and a11y issues
- Component boundaries use comment nodes (`<!-- c:start -->` / `<!-- c:end -->`) with `_commentCtxMap` WeakMap pattern
- Build size reporting now shows minified bundle sizes instead of misleading source-vs-bundle reduction percentages
- `generateActionId` uses a counter-based fallback instead of `Math.random()`
- Rebrand: "the web framework built for AI agents"

### Fixed
- Compiler: scope-aware signal transforms, no IIFE wrapping, event delegation
- Security: innerHTML XSS prevention via `{ __html }` safety marker, SSR input hardening
- Memo glitch with stale signal reads
- Hooks, Router, and react-compat for run-once component model
- Hydration mismatch detection and reporting
- Guard reconciler `insertBefore` against stale refs from nested reconciliation

### Security
- Added `npm audit --audit-level=moderate` to CI pipeline
- innerHTML requires explicit `{ __html: content }` opt-in to prevent XSS
- SSR input sanitization hardened

## [0.5.0] - 2026-03-01

### Added
- Fine-grained reactive DOM runtime (no VDOM, no diffing)
- Signal-driven rendering: components run once, signals drive updates
- Islands architecture for partial hydration
- Server-side rendering with streaming support
- File-based router with nested layouts
- Real-world example suite with Playwright tests

### Changed
- Architecture shift from VDOM reconciler to direct DOM manipulation
- Components execute once at mount time, not on every state change
