# Changelog

All notable changes to What Framework will be documented in this file.

## [0.15.0] - Unreleased

Minor release with breaking changes. All 13 maintained packages move to 0.15.0
together; deprecated `what-mcp` stays frozen at 0.12.4. React's familiar names
and call shapes now run on a new engine: push-pull signals with an owner tree,
async values in the graph, a compiled server target with out-of-order
streaming, hydration that adopts the server's DOM, data and actions built on
transitions, a router whose navigations are transitions, and one coded
diagnostics channel behind 25 MCP tools.

[docs/UPGRADING.md](docs/UPGRADING.md) is the upgrade guide. It lists every
moved, renamed and removed name, and each behaviour change below with its
migration. `npx eslint --fix .` with eslint-plugin-what 0.15 rewrites the
moved imports. `docs/releases/v0.15.0.md` has the release summary.

### Breaking: upgrading and imports

- **Upgrade every What package together, then recompile.** what-compiler 0.15
  output runs only on what-core 0.15, and the reverse: a page fails with
  `does not provide an export named '_$mapKeyed'`, and a 0.14-compiled SVG
  template root throws `ERR_TEMPLATE_NAMESPACE`. what-text 0.14 installs
  beside what-core 0.15 and fails at import. The server and the client must
  run the same release, because the hydration protocol changed.
  *Migration:* move every What package to 0.15.0 in one install, and publish
  libraries compiled with what-compiler 0.15.
- **what-compiler is a peer dependency of what-framework**, and what-framework
  an optional peer of what-compiler, so npm refuses to upgrade either alone
  (`ERESOLVE`); before, both installed beside each other and the build failed
  with `"_$own" is not exported`, or built and drew some SVG as HTML.
  what-compiler/vite and the Babel plugin also stop a build whose
  what-framework or what-core is another release
  (`ERR_COMPILER_RUNTIME_MISMATCH`, naming both versions). *Migration:* list
  what-compiler in devDependencies if your build imports it (Yarn does not
  install it for you, and pnpm does not expose it). An app upgraded with a
  package manager other than npm, with only what-framework moved to 0.15, is
  not caught: upgrade every What package together.
- **The root entry has 58 names instead of 177.** The kits moved to
  `what-framework/a11y`, `/ui`, `/motion`, `/dom`, `/form`, `/data` and
  `/render`, each with a `what-core/<kit>` twin, and internals moved to
  `what-core/internal`. No name is kept behind as an alias.
  *Migration:* run `npx eslint --fix .` (`what/no-moved-imports`). A moved
  import that remains fails a `what-compiler/vite` build with
  `ERR_MOVED_IMPORT` and the import to write.
- **Removed names:** `each`, `atom`, `storeComputed`, `onRootCleanup`,
  `signalMemo`, `getLoaderData`, `getResource`, `_template`, `collectError`,
  `getCollectedErrors`, `clearCollectedErrors`, `installAgentContext`, the
  component and signal registry helpers, `getHealth`, `checkComponentName`
  and `installSignalReadGuardrail`. *Migration:* UPGRADING's Removed table
  gives the replacement for each, such as `signal`, `derived`, `onCleanup`,
  `computed`, `useLoaderData`, `createResource(fetcher, { key })`,
  `getDiagnostics()` or what-devtools.
- **`useTransition` and `startTransition` on the root entry are React's
  transition API.** *Migration:* the animation helper is `useTween` and the
  class helper is `transitionClass`, both from `what-framework/motion`.
- **The root `Island` export is removed.** *Migration:* import `Island` from
  `what-framework/server` (`{ name, props, mode }`). `client:*` JSX needs no
  change. Code that called `h(Island, …)` imports `_$Island` from
  `what-framework/render`.
- **`memo` is no longer exported from `what-framework/render`.** That was the
  compiler's eager memo, now `_$memo`. The root `memo` is React's component
  memo, unchanged. *Migration:* use `computed()` or `useMemo`.
- **Buildless pages that load What through a hand-written import map** must
  map what the framework's own modules import: `what-framework/<kit>` imports
  `what-core/<kit>`, `what-framework/render` imports `what-core/render`, and
  `what-server/islands` and `what-router` import `what-core/internal`.
  what-core reads its development flag through its own `#env` import.
  *Migration:* add the entries, and
  `"scopes": { "/node_modules/what-core/": { "#env": "/node_modules/what-core/src/env.js" } }`.
  The create-what full-stack template builds its map from the packages'
  `exports` and `imports`.
- **Packages export three tiers.** Each export of what-core, what-router and
  what-server resolves `production` to `dist/*.min.js` (development code
  removed), `module` to `dist/*.js` (development checks read
  `process.env.NODE_ENV`), and `development`, `node` and the defaults to
  `src/`. A bundle that resolves `module` ignores `globalThis.__WHAT_DEV__`,
  and an unminified esbuild or rolldown build with no `NODE_ENV` of its own is
  a development build. *Migration:* minify, or define `process.env.NODE_ENV`
  as `"production"`. A tool that passes custom conditions adds `production`.
  Custom tooling that externalizes every bare specifier bundles `#` imports
  with their package.

### Breaking: reactivity, effects and hooks

- **Effect order.** Render-phase effects, which include every DOM binding,
  run before user-phase effects (`{ phase: 'user' }`, `useEffect`,
  `onMount`). An effect runs before the effects created during its run, and
  otherwise in the order the write reached them. 0.14 sorted by graph depth.
  *Migration:* an effect that reads DOM a binding writes uses
  `{ phase: 'user' }`. A value another effect computes belongs in a signal or
  a `computed()`.
- **`batch()` returns the callback's value.** A batch that ends inside an
  effect's run or a computed's evaluation leaves its effects to the flush
  already running. *Migration:* read the signals you wrote, rather than
  relying on their effects having run.
- **`onCleanup()` follows the owner.** Inside an effect it belongs to that
  run. With no owner it does nothing and reports `ERR_CLEANUP_WITHOUT_OWNER`
  in development. *Migration:* replace `onRootCleanup` with `onCleanup`.
- **An effect owns what its run creates** and disposes it before the next
  run. A component is an owner too: everything it creates, a bare `effect()`
  included, is disposed with it, whether it was built from compiled JSX or
  `h()`. *Migration:* delete hand-written disposal of nested effects. Create
  an effect that must outlive the run outside it.
- **`useEffect` and `onMount` run after their flush's DOM bindings**, in that
  flush, and an error they throw reaches the nearest `<ErrorBoundary>`.
  *Migration:* code that called `flushSync()` after mounting should expect
  them to have run.
- **`<ErrorBoundary>` catches errors thrown after mount**: effect re-runs,
  bindings, list rows, `useEffect` and `onMount`. *Migration:* none, unless an
  error was meant to pass the boundary.
- **`useId()` returns a string**, as do the ids from `useDescribedBy` and
  `useLabelledBy`. *Migration:* write `id` where you wrote `id()`.
- **Async functions are reported in development.** An `async` effect reports
  `ERR_ASYNC_EFFECT`. An `async` component renders its promise as text and
  reports `ERR_ASYNC_COMPONENT`. A `useMemo` that returns a promise reports
  `ERR_ASYNC_MEMO`. *Migration:* fetch with an async `computed()`.
- **Development warnings are coded `[what] ERR_…` lines.** A looping effect
  is stopped after 100 flush rounds (0.14: 25) as `ERR_INFINITE_EFFECT`.
  `useContext()` of a context with no default and no provider reports
  `ERR_CONTEXT_NOT_PROVIDED`. A signal converted to a string or a number
  reports `ERR_MISSING_SIGNAL_READ` and converts as in production, to the
  function's source. *Migration:* assert on the code, not the text, and call
  the signal.

### Breaking: async values

- **A computed whose function returns a promise, a thenable or an async
  iterable is an async value.** Its readers wait for it to land, and under a
  `<Suspense>` the fallback shows. *Migration:* to keep a promise as the
  value, wrap it, `computed(() => ({ promise }))`, or use `useMemo`.
- **A `computed`/`useComputed` function that declares a parameter receives
  `{ signal }`** and starts when it is created. *Migration:* drop the
  parameter, or pass the signal to `fetch`.
- **`createResource`'s `data` is an async value.** It has no `.set`. A read
  before the first value waits or suspends instead of returning `null`.
  `loading` and `error` are accessors, and `refetch` returns a promise that
  never rejects. *Migration:* put a `<Suspense fallback>` around it (or read
  `loading()` and `data.peek()`), and write with `mutate(value)`.
- **`<Suspense>` shows its fallback on first load only.** A later refresh
  keeps the content mounted (read `c.pending()` to show staleness). A later
  suspension brings the fallback back and keeps the children mounted. Effects
  under a boundary that has not revealed its content run at the reveal.
- **what-server's `useOptimistic(initial, reducer)` object is gone.**
  `useOptimistic(state, update)` returns `[optimistic, addOptimistic]`, as in
  React 19, from the root entry (what-server re-exports it). *Migration:*
  `startTransition(async () => { add(x); serverState(await action()); })`. A
  rejection rolls the overlay back.

### Breaking: rendering, lists and hydration

- **`hydrate()` returns the unmount function**, as `mount()` does. It takes a
  selector and `{ onHydrationError }`. Mounting or hydrating into a container
  that holds a root disposes that root first. *Migration:*
  `const unmount = hydrate(<App />, el)`, and query the container for nodes.
- **`hydrate()` adopts the server's DOM** where the markup matches, and
  renders only the differing part on the client. Compiled JSX adopts only
  when compiled with what-compiler's `hydratable` option. `what-compiler/vite`
  turns it on (`'auto'`) for a project that renders on the server.
  *Migration:* for a client build the plugin cannot detect, pass
  `what({ hydratable: true })`. JSX compiled without it renders on the client
  and reports `ERR_HYDRATION_MISMATCH` of kind `not-hydratable`.
- **Vnodes are recognised by a private brand.** An object shaped
  `{ tag, props, children }` (from JSON, a store or a literal) renders as
  text on the client, on the server and in islands. `vnode._vnode` and
  `el._vnode` are gone. An island's vnode prop is revived only where the
  server recorded one. *Migration:* make elements with `h()` or JSX. A
  library checks with `isVNode` from `what-core/internal`.
- **A function `key` on a component is a prop**, not the vnode key, unless it
  is a signal. So `<For key={(item) => item.id}>` works under `h()` and the
  JSX runtime. *Migration:* none for a `key` that is a row's key value.
- **A keyed `.map()` row follows an item replaced under its key.** Compiled
  rows read the new item in place and keep their nodes and focus. A row that
  handed the item to a component is built again from it. *Migration:* none,
  unless code relied on a row ignoring the new item.
- **`on(el, event, handler)` removes its listener when the current owner is
  disposed.** *Migration:* attach long-lived listeners outside a component.
- **A style object after a style string replaces the string's declarations**
  on compiled and spread paths, as `h()` already did and Solid does. `null`,
  `undefined` and `false` clear the inline style on every path.
- **A compiled component that destructures `children` and only places it runs
  its body before its children are built**, as `props.children` and `h()`
  already did, so its `onMount` runs before its children's and a component
  that never places its children no longer builds them. *Migration:* code that
  needs its children built while its own body runs reads `props.children` at
  that point. A component that inspects its children is unchanged.
- **`ERR_HYDRATION_MISMATCH` carries a record**,
  `{ kind, component, ownerPath, path, expected, found, recovery }`, in
  development and through `onHydrationError` in every build. The "already
  built DOM" warning is kind `not-hydratable`, and `shadow-root` is a new
  kind. *Migration:* read the record, and handle the new kinds where you
  switch over `kind`.
- **Hydration's trust baseline.** After `hydrate()` the page holds what a
  client render of the same tree and data holds. A server attribute survives
  only where a prop renders exactly its value. A refused URL removes the
  attribute. A style object replaces the inline style. An element the client
  leaves empty is emptied, and a declarative shadow root is replaced, each
  with a report. SECURITY.md has a Hydration section. *Migration:* markup a
  server adds outside the rendered tree no longer survives hydration.
- **Hydratable server output changed.** `renderToStream`,
  `renderToStringAsync`, `renderDocument`, `renderDocumentStream` and
  `renderToHydratableString` write one protocol:
  - owner-path `data-hk` keys (`0`, `00`, …), comment markers around reactive
    children and arrays, and `<!--b-->…<!--/b-->` boundaries;
  - a keyed list's `<!--k:SALT:DIGESTS-->` comment, a per-render salt and a
    64-bit digest per key, or `<!--k!-->` when a key cannot be compared, which
    the client rebuilds;
  - `<textarea>` and `<title>` content as text only, and a newline after
    `<pre>`, `<textarea>` and `<listing>`;
  - compiled keyed-row fields with no `<!--$-->` markers.

  *Migration:* tests that match exact HTML strip the protocol, or render with
  `renderToString`. Code that parsed the keyed-list comment should stop.
- **what-react:** `cloneElement(nonElement)` returns its argument, and
  `isValidElement` accepts only real elements. *Migration:* pass a real
  element, or call `createElement(obj.type, obj.props)` on purpose.
- **JSX passed in any prop is built where the component places it**, inside
  the component's run, as `children` are: its components run after the
  receiving component's body, are owned by it and see its context, and while
  hydrating it claims the server's nodes there. A destructured prop that is
  only placed compiles to a read where it stands, and a prop handed on reaches
  the next component unbuilt. *Migration:* code that relied on a JSX prop's
  components having run before the receiving component reads the prop where
  the JSX is wanted; pass data, not JSX, to a component that inspects it.
- **The same JSX placed twice in one run is built twice**, as `h()` and the
  server render it; before, one set of nodes moved to the last place.
  *Migration:* a component that relied on one set of nodes places it once.
- **`<ErrorBoundary>` and `<Suspense>` read `fallback` when they show it**, so
  a JSX fallback is built afresh each time it is shown.
- **JSX built before it is placed is reported while hydrating.** JSX in a
  variable, an argument or an object, a prop a component inspects, and a prop
  given to an `h()` component are built before the walk reaches their place.
  Hydration puts them in the server's place, reports `ERR_HYDRATION_MISMATCH`
  of kind `prebuilt` with the owner, and moves what the user typed or chose in
  a form control there to the new control.
- **`hydrate()`, `mount()` and what-react's roots throw
  `ERR_MOUNT_TARGET_MISSING`** for a `null` container or a selector that
  matches nothing, instead of a WeakMap `TypeError`.
- **Action keys and hydration keys are structural.** A component's place
  among keyed rows is its place in its parent's output and its JSX's source
  position, never a count of the components before it, on the server, the
  stream and hydration alike. A form served by the previous version and
  posted to this one finds no state for its key and re-renders as on a first
  visit. `Fragment` takes no step in owner paths. *Migration:* none; it
  happens once per open page across the deploy.
- **A `<Show>` or `<Switch>` arm's reactive expression is a reactive child of
  its own**: `<Show when={x}>{count()}</Show>` updates the text without
  rebuilding the arm. *Migration:* code that relied on the arm rebuilding
  reads the value in a component the arm renders.
- **Server markup:** a fragment among an element's children is written in
  place with no array markers, and a keyed `.map()` is written with its list
  markers and keys wherever it stands. *Migration:* build client and server
  with this compiler and runtime together.
- **After a component's run, a read of a JSX prop that does not place it
  gives a placeable**: an opaque value, the same every time, built where it
  is placed, under that place's owner, context and error boundary. The same
  holds during the run once the prop is placed. A presence test in `onMount`
  or `useEffect` is true without running the prop's components, and a
  handler that shows it in a dialog builds it there. *Migration:* inspect a
  JSX prop during the run, or alias it there (`const panels = props.panels`);
  pass data, not JSX, to a component that inspects it.
- **A JSX prop is built untracked**: a `<Show>` or condition around its place
  no longer depends on the signals its JSX read when built, so it is not
  rebuilt when they change. Its own reactive reads update in place.
- **An array literal of JSX, or a `.map()` returning JSX, passed in a prop is
  lazy** like any JSX prop. *Migration:* none for a component that places it;
  one that inspects it inspects it during its run.

### Breaking: server rendering

- **`renderToStream()` returns a `RenderStream`**,
  `{ shellReady, allReady, response, pipe, readable, abort }`, which is also
  async-iterable. It takes options (`loaderData`, `request`, `response`,
  `signal`, `nonce`, `noScripts`, `onError`, `idPrefix`) instead of a render
  context. *Migration:* `for await` works as before. `.next()` now throws.
  Pass loader data and the request as options.
- **`renderToStringAsync(vnode, init?, options?)` renders on the streaming
  engine.** `init` is `{ loaderData, signal, request, response }`, and any
  other field rejects with a `TypeError`. A resource with no `key` is
  returned in `owned`, not under `resources.__r0`. *Migration:* send `owned`
  along with `resources`, or let `renderDocument()` write the payload.
- **A `mode: 'server'` route streams shell-first.** Status and headers are
  final when the shell is ready. *Migration:* decide them in the loader, or
  set `page: { stream: false }`.
- **what-isr stores only public renders.** A render is private, and never
  stored or shared, when it sets a cookie, sets `Cache-Control` with
  `private`, `no-store` or `no-cache`, sets `Vary`, or reads a request header
  or cookie that the route's `vary` does not name. In a render the cache may
  share, `request` is a real `Request` that carries only the headers and
  cookies the route's `vary` names, so `fetch(request)` and
  `new Request(request)` forward nothing the cache key does not vary on. On
  cacheable routes the loader no longer sees `utm_*` and the other ignored
  parameters.
  *Migration:* name what the page varies on (`page: { vary: ['cookie:session'] }`).
  To forward a visitor's credentials upstream from a cached route, read them
  through `request.headers` (which makes that render private), name them in
  `vary`, or use `mode: 'server'`. Read tracking parameters on the client.
- **Error details stay on the server.** `<!-- SSR Error -->` comments and
  resource error records carry the message only when `NODE_ENV` is exactly
  `development`. *Migration:* read errors from `onError`.
- **The Node adapter answers 400 to a request target that is not a path.**
  `toNodeListener` and `whatMiddleware` refuse `*`, absolute-form and
  authority-form targets, and any target whose URL cannot be built.
  `whatMiddleware` passes a handler's error to `next(err)` instead of
  rejecting. *Migration:* behind a forward proxy that sends absolute-form
  targets, rewrite them to origin-form at the proxy.
- **what-isr keys on the request's origin as well as its path.** On upgrade
  every cached entry misses once, and a deployment that serves one app on
  several hosts keeps one entry per host. *Migration:* to share entries, have
  the proxy send one canonical Host. A custom `cacheKey()` caller can pass
  `origin`. A regeneration with no request (`createScheduler`,
  `revalidatePath`/`revalidateTag` with `regenerate`) refreshes the entry of
  each origin stored for the path, up to 16, or renders a default entry at
  `createCacheEngine({ origin })` (default `http://localhost`), which a
  request whose origin has no entry is served. `engine.regenerate(match)`
  resolves `CacheEntry | null`. `createCacheEngine({ origins })` names the
  public origins to cache: a request for any other host renders uncached, and
  a regeneration renders exactly those. The full-stack starter reads them from
  `PUBLIC_ORIGIN`. Without it, a regeneration prefers the origins visitors
  read most recently. `createCacheEngine` throws on an origin without a scheme
  and on an empty `origins`, naming the value, and the starter stops on a
  `PUBLIC_ORIGIN` that names no origin. *Migration:* write full origins
  (`'https://shop.example'`), or leave `origins` out.
- **A Host header that is not a host gets 400** from `toNodeListener`,
  `whatMiddleware`, `nodeActionMiddleware` and the Vura handler. *Migration:*
  fix a proxy that forwards a malformed Host.
- **A second copy of what-core bundled into a library throws
  `ERR_FOREIGN_ENGINE_IN_SSR`** when it makes an async value during a server
  render, instead of fetching twice. *Migration:* mark what-framework as a
  peer dependency of the library.
- **Full-stack apps scaffolded from an earlier create-what** render routes
  with their own function, which ignores redirects and headers. *Migration:*
  in `server.js`, use
  `const renderPage = createRouteRenderer(documentOptions)` from
  `what-framework/server`.
- **A request target whose path has a dot segment (`.`, `..`, `%2e`) or a
  backslash gets 400** from `toNodeListener`, `whatMiddleware`,
  `nodeActionMiddleware` and `what dev`/`what preview`, so a path guard in
  front (an Express `app.use('/admin', …)`) routes the same path What renders.
  Browsers never send one. *Migration:* none for browser traffic. A client
  that sends such paths must resolve them first.
- **`exportStatic()` resolves `{ pages, redirects, skipped }`.** A page that
  redirects is written as a redirect stub, and a page with another status is
  skipped with a warning.
- **SSR style objects follow a conservative value grammar.** A value with a
  CSS comment, an escape outside a string, or an unquoted `url(` that is not a
  valid url token is dropped. *Migration:* write the value without it.

### Breaking: data, actions, forms and routing

- **`useAction`, `useFormAction`, `useMutation` and `formAction` (what-server)
  are removed.** *Migration:*
  `const [result, run, isPending] = useActionState((prev, args) => save(args), null)`,
  the action inside `startTransition`, or `<Form action={save}>`.
  `ERR_FORM_ACTION_NOT_REGISTERED` is gone: a plain function is a valid
  `action`.
- **The query hooks read one cache of async values.** `useQuery`, `useSWR`,
  `useInfiniteQuery` and `useFetch` keep their shapes. *Migration:*
  - `invalidateQueries` returns a promise of the refetches; code that ignored
    it is unchanged.
  - Callbacks fire once per landing, for the reader that started the fetch.
    To react in every component, read `data()` in an effect.
  - Unmounting a key's last reader cancels its fetch in flight, and a remount
    refetches. `setQueryData` drops a fetch in flight for its key; call
    `invalidateQueries` afterwards for a fresh copy.
  - `prefetchQuery`'s fetcher gets the key as written plus `{ signal }`, not
    the normalized string. Read the array, or `String(key)`.
  - `setQueryData`'s updater gets `undefined` for a key with nothing cached.
    Write `(prev = []) => …`.
  - A key may be a function of signals (`queryKey: () => ['search', term()]`).
    Move a signal read inside `queryFn` into the key.
  - The hooks render their first state on the server and while hydrating:
    loading, or their own `initialData`/`fallbackData`. To server-render data,
    read it with `query()`.
- **`onRevalidate` and `invalidatePath` come from `what-framework/data`**;
  what-server re-exports them. `invalidatePath` also refetches the queries
  read on the path.
- **The action endpoint refuses cross-site posts** (`Sec-Fetch-Site:
  cross-site` or `same-site`, or a foreign or `null` `Origin`) with 403, even
  with a valid token, and accepts same-origin posts without one. The
  server's own origin takes its scheme from the connection (a TLS socket, or
  the platform's URL), or from `X-Forwarded-Proto` when the request carries
  it. *Migration:* name another origin of the app with
  `createRequestHandler({ csrf: { trustedOrigins: ['https://…'] } })`. Behind
  a TLS proxy that sends no `X-Forwarded-Proto`, make it send one, or list the
  app's https origin in `trustedOrigins`.
- **`<Form>`** omits the empty token field and no longer warns about a missing
  token. It resets at its submission's commit, only after the action
  succeeds: uncontrolled fields clear, and a controlled field keeps what its
  prop holds, as in React 19. `useFormStatus().action` is the action function
  or `null`. *Migration:* reset by hand in the action's success path if you
  relied on an immediate reset, and compare `action` against your function,
  not its id.
- **`_state` and `_actionKey` are reserved `<Form>` field names**, with
  `_action`, `_redirect` and the CSRF field. *Migration:* rename a field with
  one of these names. A server action's own `<Form>` posts back to the page it
  is on without relying on the Referer, and `redirect` applies to that form
  only.
- **A form's reset after an action runs after the commit**, so a
  `defaultValue` read from `useActionState`'s new state applies. A `<Form>`
  with no `csrfToken` prop no longer adds the page's token while hydrating,
  which the server never wrote. The enhanced submit still sends it in
  `X-CSRF-Token`.
- **`<Form>`'s JavaScript submit follows the form's `enctype`.** A file field
  in a form without `multipart/form-data` sends the file's name, as the
  browser's native submit does. A `File` in what an action returns is `null`
  in its state, with and without JavaScript. *Migration:* add
  `enctype="multipart/form-data"` to forms with file inputs, and return what
  you show about a file (its name, its size), not the file.
- **`enhanceForms()` submits a same-origin form without a token**, as the
  native submit would, and leaves the decision to the endpoint.
  `data-no-csrf` is gone. *Migration:* remove `data-no-csrf`, and check the
  response where you relied on the client-side "Missing CSRF token" refusal.
- **Navigations are transitions.** `navigate()` and `<Link>` load a lazy
  route's chunk and run its `preload` while the old page stays. A lazy
  route's fallback no longer flashes on navigation; it still shows on first
  load. A newer navigation supersedes one still preparing. `navigate()`
  resolves, and `route.isNavigating` turns false, once the new page's first
  data has landed. *Migration:* return what the page needs at once from
  `preload`. Use `navigate(to, { flushSync: true })` for an immediate commit.
- **Route middleware runs once per navigation**, before the route's `preload`,
  and again only when a signal it read changes. A declined route is never
  prepared. A middleware that navigates supersedes its own navigation.
  *Migration:* keep middleware free of side effects that expected a second
  call at render.
- **The router commits the URL the address bar commits**, with dot segments
  resolved, and splits it as `URL` does (`?q=a?b` is `{ q: 'a?b' }`). A
  path that starts `//` is that path, not another host. A nested `<Router>`
  has route state of its own.
- **`isSafeUrl` refuses an absolute URL the URL parser rejects**, so
  `<Link href="http://[">` renders `href="about:blank"`.
- **A server never navigates.** During a server render, route state is the
  request's own, and a `<Router url>` keeps route state of its own, which
  readers outside it do not see. `navigate()`, a middleware redirect,
  `<Redirect>`, a `guard()` path fallback and a `redirect()` thrown from a
  component body under a `<Router>` redirect the response (a same-origin
  path). A
  `beforeNavigate` or `afterNavigate` subscribed during a server render is not
  kept. *Migration:* read the redirect from the response you passed in
  (`createResponse()`); the deploy adapters answer with the 3xx. Read the URL
  a `<Router url>` was given inside that Router.
- **A refused action call rejects with a coded error and `status`:**
  `ERR_PAYLOAD_TOO_LARGE` with `limit` for a 413, `ERR_ACTION_FAILED`
  otherwise. The 413 JSON body is `{ message, code, limit }`. *Migration:*
  branch on `error.code`, and wrap the component that calls `useActionState`
  in an `<ErrorBoundary>` to show it. The upload recipe checks the file's size
  in the browser first, and names the limit in its boundary.
- **An action body that does not parse is answered 400 and runs no action**,
  on every entry point: JSON for an action call, HTML for a form post. Before,
  a malformed multipart call ran the action with no fields.
- **Every form POST to a page is read under `bodyLimit`** on every platform,
  including a page whose loader reads its own upload: over the limit it gets
  the 413 page.
- **A request body whose stream fails while it is read is a 400** on every
  entry point and runs no action, including a no-JS post that names its
  action in the query on the Node adapter (it ran the action with `{}`).

### Breaking: compiler

- **Component props are live.** A prop whose value reads a signal is passed
  as a getter over the expression: `<Badge on={count() > 0} />` updates the
  child's `{props.on}`, and a destructured `({ on })`, where it renders, and
  the child still runs once and keeps its state. Before, the value was read
  once and the prop froze with no warning. The compiler reads a destructured
  prop as `props.<key>` where it is used (unless it is reassigned, nested, or
  has a default that is not a plain literal), a read of props in JSX is a
  binding, and `{...props}` spreads and rest elements keep the getters
  (what-core `_$merge`, `_$omit`). Props objects What builds have no
  prototype; `_$createComponent` takes one as the component's own, and h()
  keeps the getters of one. Code that relied on a prop staying at its first
  value reads it once in the body instead (`const first = props.value`).
- **`<Row item={item} />` in a keyed `.map()` follows an item replaced under
  its key.** An attribute named like the row's variable was taken as a read
  of it, so the row kept the item it was built with.

- **Server transforms compile for the server.** The Vite plugin's `ssr`
  option, on by default, compiles a module Vite transforms for the server
  with the server target, which every what-server renderer accepts.
  *Migration:* test runners that set `ssrGuard: false` to get DOM output from
  server transforms set `ssr: false, ssrGuard: false`. With the Babel plugin,
  the server target is `generate: 'ssr'`.
- **A call in JSX is static only when the compiler proves it.** A call is
  left unwrapped only when nothing it reaches can read a signal. A call it
  cannot prove (a parameter, a method of a value it did not see made, a
  getter, a class instance, a callback handed on, a generator, an unknown
  global) is a reactive child. *Migration:* none for correctness; snapshot
  tests of compiled output or server markup may show new thunks or markers.
- **`autoSelector`, on by default, rewrites `selected() === row.id`** in a
  keyed `.map()` row into a `createSelector` lookup. *Migration:* opt out
  with `/* @what-no-selector */` or `autoSelector: false`.
- **Markup the HTML parser would move fails the build** with
  `ERR_INVALID_HTML_NESTING`, and the server target refuses unsafe static
  values with `ERR_UNSAFE_STATIC_MARKUP`. *Migration:* write markup the parser
  keeps, such as a `<tbody>` around rows.
- **Development output carries names and locations** (`devMetadata`, on in
  the Vite dev server, never in `vite build`). *Migration:* update snapshots
  of development output.

### Breaking: tools

- **eslint-plugin-what:** `what/no-signal-in-effect-deps` is now
  `what/no-signal-read-in-effect-deps` and reports the opposite case
  (`[count()]`, fixed to `[count]`). `what/no-destructured-props` is retired.
  `what/no-moved-imports` and `what/no-effect-self-write` are errors in
  `recommended`. *Migration:* rename or delete the rules in a config that
  lists them, then run `eslint --fix`.
- **what-devtools:** `subscribe()` events carry ids instead of registry
  entries, and `safeSerialize(value, depth)` is `safeSerialize(value, budget)`.
  *Migration:* look entries up by id in the exported `signals`, `effects` or
  `components` map.
- **what-devtools-mcp:** 0.14's 29 tools are now 25.
  - `what_component_tree`, `what_diff_snapshot`, `what_watch`,
    `what_record_window`, `what_validate` and `what_perf` are gone. *Migration:*
    UPGRADING's MCP table gives the call for each.
  - Every answer is compact JSON with a `seq` cursor; the prose `summary` is
    gone.
  - The Vite plugin pairs the page, and another dev server serves the same
    endpoint with `createDiscoveryHandler({ root })`.
  - `what_signals` counts include async computed rows (writable rows have
    `id`, async rows `effectId`).
  - Causal recording starts on connection. *Migration:* reproduce the action
    after connecting.
  - `what_diagnose`'s hot-effect cutoff defaults to 5 runs. *Migration:* pass
    `threshold: 50` for 0.14's cutoff.
  - `what_errors` returns hydration guidance in `mismatchFixes[kind]`.
- **`what dev` answers 403 to a Host it does not serve**, so a DNS-rebinding
  page cannot read the dev sources. It serves localhost, `*.localhost`, IP
  literals and `--host`. *Migration:* for a tunnel or a LAN name, add it to
  `allowedHosts` in the config or pass `--allowed-hosts a,b` (`true` allows
  any). `what preview` checks the same list, the Host is read as a host before
  any name test, and the HMR socket accepts the same origins.

### Added

- **`live(source)`**, a read-only live view of the object an accessor returns:
  `view.name` reads the current value's `name`, through getters What reads as
  live props. A table hands its column render functions `live(() => row)`, and
  each cell is built once per row and keeps its state while its bindings follow
  a replaced item (docs/API.md, live views). Found dogfooding Vura, which wrote
  one for its Table.
- **A keyed row is built again only for a field its building code read.** A
  read of one field of the row's item while the row is built (`row.kind` in
  the row's own code, a `kind={row.kind}` prop a row component reads in its
  body, `view.kind` through a live view) records that field; a replaced item that leaves every
  recorded field the same (`Object.is`) keeps the row, and its bindings follow
  the new item. A read of the whole item (handed to a function, a method
  called on it) still rebuilds the row on any replacement. Before, any read
  rebuilt it: a Vura row component that named its signal after `ev.id` lost its
  state on every refetch.
- **`ERR_REBUILT_COMPONENT` (development).** A reactive region that runs
  again and rebuilds a component holding state (it created a signal, or it is
  a React island) reports it once per region, with the rewrite that keeps the
  component: a JSX ternary or `<Show>`, with the changing value read in the
  props. Found dogfooding Vura, whose data-driven tabs rebuilt their charts and
  menus on every refetch.
- **Structural sharing in `useQuery` and `useSWR`** (TanStack Query's
  default, `structuralSharing`, default `true`): a refetch that answers data
  equal to the cache keeps the cached references, and a changed list keeps
  every row it did not change. Keyed rows follow an item replaced under their
  key, so without it every background refetch of an unchanged list rebuilt
  each row's rendered cells and lost their state (found dogfooding Vura's
  dashboard: a revealed secret re-masked, an open row menu closed).
- **`useQuery`/`useSWR` accessors are computeds**: a fetch that starts or
  lands without changing what `data()`, `isLoading()` or `error()` return
  re-runs nothing that reads them, so a region that reads them keeps what it
  rendered across a background refetch; `select` is memoized on the cached
  value, as in TanStack Query.
- **`staleTime: 0` data is stale at once**, as in TanStack Query: a reader
  mounted in the same millisecond as a `setQueryData` fetched nothing and never
  followed the signals its `queryFn` reads.
- **A forwarded live prop reaches the child as its value**
  (`<Leaf counts={props.data} />` with `data` a live prop): the child read the
  slot's read function, and now reads the value, live, wherever it reads it.
- **what-devtools-mcp/vite looks for `what-devtools` where Vite resolves the
  bootstrap's import** (a node_modules at or above the root), not through
  `NODE_PATH`: under pnpm, whose bin shims set `NODE_PATH` to the hidden store,
  a copy there passed the check and the dev server then failed on the import.
- **vnodes render when what-core runs from source under Vite 5's SSR
  transform** (Vitest 2 inlining a linked or monorepo copy): h.js installs the
  vnode renderer through closures, so an import cycle that transform does not
  hoist no longer leaves it undefined ("vnodeRows is not a function").

- **React packages inside native What components, with plain JSX**
  (what-react, `packages/react-compat/MIXED.md`). With what-compiler's
  `what()` next to `reactCompat()`, files stay native What and a React
  component used as a tag (`<BarChart data={sales()} />` from recharts) renders
  as a React island: React's rules inside it, its props built again when a
  signal they read changes, its React state kept. A file that imports `react`,
  calls a React hook (from a React package, a store a React package builds, or
  a custom hook calling one) or carries `@jsxImportSource react` is a React
  file; a native component it renders runs once, keeps its state and reads its
  props live. React components are found through re-export barrels; React
  context and What context cross the boundary both ways; a React component in a
  native keyed list keeps its row. Islands render on the server with React's
  server rules (initial state, no effects, server snapshots, `<Suspense>`
  fallbacks), native components inside them included; hydration hands each
  island its server HTML and replaces it with the client render before the
  next paint, with no mismatch. A Vite server build bundles the app's React
  packages (`ssr.noExternal`) so they reach what-react. A signal read while a
  React component renders re-renders it. TypeScript: `what-react/mixed` in `compilerOptions.types` makes React
  components valid tags in native files; native-only apps keep What's stricter
  component types. `reactCompat()` returns its plugins as an array.
- **`create-what`'s React option scaffolds a native app with a React file in
  it** (`what()` and `reactCompat()`, a native `main.jsx`, zustand in
  `BearCounter.jsx`), instead of an app whose JSX all ran through what-react.

- **`ERR_COMPILER_RUNTIME_MISMATCH`**: what-compiler/vite and the Babel plugin
  stop a build whose what-framework or what-core is a different release.
- **Engine.** A push-pull signal engine with an owner tree, equality cut-off
  and evaluation on a bounded stack, and the new `createSelector`.
  Development code sits behind a build-time `__DEV__` and is absent from
  production builds.
- **Async values.** `computed()` over a promise, a thenable or an async
  iterable, with `{ signal }`, supersede and abort, `.pending()` and
  `.peek()`. `refresh()`, `isPending()`, `startTransition()`/`useTransition()`,
  `useOptimistic()`, `use()` and `settled()`. `<Suspense>` catches async reads
  anywhere under it and reveals once dependent values have landed.
  `ErrorBoundary`'s `reset()` retries only the sources of the errors it
  caught. A rejected `useTransition` action shows in the nearest
  `<ErrorBoundary>`, as in React 19. `settled` is exported from
  `what-framework/testing`, and `act()` resolves after it.
- **Server rendering.** A compiled server target. Buffered and out-of-order
  streaming, with `applyStreamedBoundaries()` for `noScripts` pages. The
  request context survives `await`. Async values render on the server, are
  serialized and are adopted on hydrate. A render sets its status, headers and
  redirect: loaders get `response`, components call `getResponse()`,
  `response.redirect(path)` takes a same-origin path, and
  `response.redirectExternal(url)` leaves the site.
  `renderToString(vnode, { response })`, and `renderToStringAsync` returns
  `response`. `createRouteRenderer(documentOptions)` is the route renderer
  `createRequestHandler` uses, for a custom server. The create-what full-stack
  template uses it, so route middleware redirects, `response.redirect()`,
  status and headers work there. `createCacheEngine({ origin, origins })`
  names the origin a request-less regeneration renders at and the public
  origins to cache.
- **Hydration by adoption.** Matching markup creates no nodes, each reactive
  child runs once, and nothing the server sent is fetched again. Keyless
  server values are found by owner identity. A component that suspends while
  hydrating keeps the server's content. A streamed boundary hydrates when its
  content arrives. `onHydrationError` works in production, and
  `hydrateIslands`/`autoIslands` take it too.
- **Data.** `query(key, fetcher, options?)` in `what-framework/data`:
  reactive keys, one request per key, the last value with `pending()` while
  refetching, abort of keys nothing reads, `gcTime`, `refresh(q)`, and server
  rendering with adoption on hydrate. One cache under `query` and the hooks,
  with function keys, `keepPreviousData`, function `placeholderData`,
  `isPlaceholderData`, `dataUpdatedAt`, `refetchOnReconnect` and
  `initialData`. `invalidatePath(path)`.
- **Actions and forms.** `useActionState` and `useFormStatus` (React 19) on
  the root entry. Server actions are transitions on the client, with an
  `invalidates` option, and their revalidation commits with them. Actions run
  in their request's context, with `getRequest()` and a query cache of their
  own. `<Form>` accepts client actions. CSRF by Fetch Metadata and `Origin`,
  so forms on cached and streamed pages post without a token, with
  `trustedOrigins` for other origins. Server validation with and without
  JavaScript: `useActionState(serverAction, initial)` with
  `<Form action={dispatch}>` calls the action with `(previousState, fields)`.
  Without JavaScript the form posts to its own page, and
  `createRequestHandler` runs the action and renders that page with the
  result, `private, no-store` and outside the cache, for the form that posted
  only: a long draft comes back whole, two editors of one action keep their
  own results, and no Referer is needed. Reloading that page re-posts, as with
  any form POST. `getResponse().redirect(path)` inside an action redirects a
  no-JS post with 303 and a fetch call once its revalidation has landed, so a
  successful save can go to the record. A custom server uses
  `createFormPostHandler()` ([docs/DATA.md](docs/DATA.md), "An edit form with
  server validation"). The full-stack starter's `/edit/:slug` page uses it.
  Inside a keyed list (`<For key>`, `.map()` with `key`) a posted result
  follows its row's key, so it comes back to its own record when rows were
  added, removed or reordered in between; unkeyed repeated forms are matched
  by position. Row keys never appear in the page: the form posts a digest
  under the render's salt. `bodyLimit` (default 1 MB) on
  `createRequestHandler`, `nodeActionMiddleware` and the action endpoint sets
  the largest body read; a page post over it gets an HTML 413. A server-action
  form takes files: a multipart post reaches the action with each file as a
  Web `File`, with and without JavaScript, parsed by the platform under
  `bodyLimit`. A keyed list's identity is where it is written, so an earlier
  list that is empty in one render no longer moves the result.
  `toNodeListener(handler, { bodyLimit })` serves a wrapped handler, and
  `createFormPostHandler` takes `bodyLimit`.
- **Router.** Route `preload` with a `data` prop, `navigate(to,
  { flushSync })`, and `route.isNavigating` from the moment a navigation
  starts, including one started inside a transition.
- **Components and the compiler.** `<For>` takes an array or an accessor, and
  `<For key>` keeps rows per key on the runtime path. Compiled JSX makes
  `each={items().filter(f)}`, optional chains and calls given a reactive
  callback reactive. what-compiler's `hydratable` option, and
  `what-compiler/vite`'s `hydratable: 'auto' | true | false`. Compiled keyed
  rows write a plain item field (`{row.label}`) as a text node with no effect.
- **Diagnostics.** One coded channel: `getDiagnostics()`,
  `subscribeDiagnostics()`, `clearDiagnostics()`, `getErrorDefinition()` and
  `WhatError` on the root entry, `captureDiagnostics()` in
  `what-framework/testing`. A catalogue of 72 codes, each with a fix and an
  example, rendered as [docs/ERRORS.md](docs/ERRORS.md), the site's errors
  page, and the `diagnostics.json` and generated `skills/` that ship in
  what-framework. New development codes include `ERR_ASYNC_COMPONENT`,
  `ERR_ASYNC_MEMO`, `ERR_SUSPEND_IN_TRANSITION`, `ERR_WRITE_AFTER_AWAIT` and
  `ERR_QUERY_OUTSIDE_RENDER`. The production build's catalogue keeps each
  code's severity and message and leaves the fix and example to `what_fix` and
  docs/ERRORS.md (5.3 KB gzip instead of 22.1 KB).
- **MCP tools.** `what_events` (a cursor over lifecycle, async, transition,
  Suspense and action events) and `what_why` (why a run, a skipped effect or a
  mount happened, back to the write or landing). Async flight details and
  stalled-work diagnosis (`what_diagnose({ focus: "async" })`), unread written
  signals with creation sites, repeated computeds, hydration adoption counts
  and kind-specific mismatch fixes. `what_cache` shows each key's status,
  readers, age and last fetch. `what_invalidate_cache` takes array prefixes.
  `what_lint` compiles the snippet with the project's ESLint config
  (`filePath`), and `what_scaffold` detects the project's template. The server
  exits on stdin EOF and frees its port. `what_navigate` loads the URL on a
  page with no client router. `what_connection_status` and `what_diagnose`
  name the files to pass to `what_lint`, and `what_events` folds repeated
  timer runs.
- **eslint-plugin-what.** `no-moved-imports` (with autofix),
  `no-signal-read-in-effect-deps`, `no-effect-self-write`, `effect-cleanup`,
  `no-unsafe-innerhtml`, `no-async-component`, `no-promise-in-usememo`,
  `no-optimistic-snapshot` and `prefer-async-computed` in `recommended`;
  `prefer-computed` and `signal-debug-name` in `strict`. `no-uncalled-signals`
  knows `pending()`, `useTransition()[0]` and `useOptimistic()[0]`.
- **Types.** `useOptimistic` accepts a signal or a computed. `<For>` has
  keyed and unkeyed signatures. An `async` component is a type error in JSX.
  `action()` accepts a synchronous function. `what-framework/router`
  re-exports what-router's declarations.
- **Benchmarks and gates.** Reactivity, SSR, size and krausest harnesses
  against Solid 1.9, Solid 2.0 and React 19 (`benchmark/`),
  `npm run bench:hydrate` in `benchmark/ssr`, size ceilings in
  `.size-budgets.json` with the cause of each change, and
  `npm run check:snippets`, which runs every code block shipped in the docs,
  READMEs, skills and MCP resources. `npm run check:node-floor` keeps APIs
  newer than Node 20 out of the shipped code and the tests, and CI runs the
  suite on Node 20, 22, 24 and 26. `npm run bench:gate` measures core and DX
  against a reference build (`benchmark/reference.json`) in interleaved runs
  of one session. The gate judges each operation by its throughput, median
  call and 95th-percentile call (`WHAT_BENCH_TOLERANCE_TAIL`, default 0.25),
  so a change that slows one call in twenty fails it. Every package declares
  `engines.node: ">=20"`. The gate re-runs once and fails only an operation
  that missed on both attempts, and each benchmark runs its queued effects
  after it is measured, so its warm-up measures that operation alone.

### Fixed

- **Development locations name the line you wrote.** Vite reprints a
  .jsx/.tsx file with esbuild (oxc on Vite 8) before what-compiler's plugin
  runs, so every `file:line:col` in a diagnostic and in the devtools could
  point a line or more away (a leading comment was enough). The plugin maps
  each one back through the combined source map, and what-react's mixed JSX
  keeps every statement on its source line.
- **`<Show>` and `<Match>` take any value as `when`** in their types
  (`when={user()}`), as they do at run time.
- **`what/no-signal-write-in-render` checks render code in JSX:** a write in
  a JSX function child (`{() => { tab(0); ... }}`) or in a host element's
  non-event attribute function runs whenever the region does. **`what/prefer-
  computed` warns in every preset**: an effect that only writes one signal is
  a `computed()`.

- **`what/no-moved-imports` covers dynamic imports.** `const { useQuery } =
  await import('what-framework')`, `(await import(...)).name` and
  `import(...).then(({ name }) => ...)` are reported, and rewritten when every
  name they read moved to one subpath.
- **`lazy()` infers the props of the component its loader resolves to**,
  through `import('./Chart').then((m) => ({ default: m.Chart }))` as well.
- **what-router skips a scroll that would not move the page**, so a test DOM
  (jsdom) no longer logs "Not implemented: window.scrollTo" on navigation.
- **what-react writes `tabIndex` on SVG elements as `tabindex`**, the attribute
  that makes them focusable (recharts' chart surface).

- **A `<Head>` title, meta or link whose hole reads a value goes to the head
  on the server.** `<title>{name()}</title>` or `content={'about ' + name()}`
  stayed in the body; the server now evaluates the hole once and moves the tag.

- **Request isolation (security).** Loaders and actions run in their request's
  server context, so `prefetchQuery` and the query cache never serve one
  user's data to another, including on a server with a DOM global and no
  AsyncLocalStorage. Outside any render the server cache is never shared. On
  the server, route state (`route.url`, `route.query`, `useParams()`,
  `useSearch()`, `useRoute()`) is the request's own, also for ISR-cached
  pages. Process-wide registries are shared by every tier of the packages one
  process loads, so `node --conditions=production` no longer splits
  what-server's action registry (actions answered 404) or what-router's
  matcher. Each process-wide key names a protocol version
  (`Symbol.for('what.actions.v1')`, …), so a copy of another protocol keeps
  its own. Work that a second copy of what-core bundled into a library creates
  during a server render is released with the render, from its first
  operation. An async value such a copy makes during a server render throws
  `ERR_FOREIGN_ENGINE_IN_SSR`: bundle one copy of what-framework. One realm
  serves one app's actions: two apps in one process that register the same
  action id share it, and development reports `ERR_DUPLICATE_ACTION_ID`.
- **Redirects and URLs (security).** `_redirect` and `response.redirect()`
  refuse dot-segment targets such as `/.//evil`, and what-isr's path predicate
  matches what-server's. SVG `values`, `to`, `from` and `by` with
  `javascript:` are refused on every path. The Origin-only CSRF path compares
  the full origin, and the Node adapter sees TLS as https.
- **Request targets (security).** A target that is not a path (`GET //`, `*`,
  absolute or authority form) gets a 400 or goes to `next()` in `what dev`,
  `what preview`, the create-what full-stack server and its Vite middleware,
  and what-server's Node adapter and middlewares, so one request cannot end
  the process. The Host header must be a host (a DNS name, IPv4 address or
  bracketed IPv6 literal, with an optional port): anything else, including a
  path, a query, a backslash or userinfo, gets 400 from `toNodeListener`,
  `whatMiddleware`, `nodeActionMiddleware` and the Vura handler, with nothing
  logged. The path What routes on comes from the request target only.
  `what dev` and `what preview` answer 500 to a request that throws, and a
  module name such as `/@what/__proto__` no longer reaches what an object
  inherits, so no single request ends them. `nodeActionMiddleware` never
  rejects. The router's and the cache's URL parsing never throws on a
  request's path. HTTP/2 requests render and route like HTTP/1: pseudo-headers
  are skipped, and a validated `:authority` is the host when Host is absent.
  An HTTP/2 request whose Host and `:authority` differ gets 400.
  `ERR_REDIRECT_CYCLE` reports route patterns (`/verify/:token`), never the
  visitor's paths, query or fragment. `what dev`'s HMR socket accepts only
  loopback, `--host` and `allowedHosts` origins, not any IP address. Every
  entry point answers a body over `bodyLimit` by one rule, an HTML page for a
  browser's form post and JSON for an action call, and
  `nodeActionMiddleware`'s 413 now reaches the client instead of a reset
  connection.
- **Form data (security).** No-JS and enhanced form fields such as
  `constructor` and `__proto__` arrive as own fields. ISR loader `query`
  objects are null-prototype. A malformed cookie no longer fails every page. A
  cached ISR render sees exactly what its key is made of: the key holds the
  request's origin (scheme and host) as well as its path, so two hosts keep
  two entries and a Host one sender chose never reaches another host's
  visitors; a repeated cookie name counts once, with its first value. A stored
  ISR render sees the URL and params of its key: a trailing slash is dropped,
  and HEAD renders as GET. A posted `_state` is read as plain values: no
  member named `toString` or `valueOf` survives. ISR stores and serves only
  GET and HEAD renders: a POST to a cached route renders `private, no-store`
  and is never stored. A request for an origin outside `origins` is answered
  `private, no-store`. Behind a TLS proxy, the request URL, the CSRF check and
  the ISR origin all take the scheme from `X-Forwarded-Proto`.
- **Keyed hydration.** A server row is adopted only as its own key's row;
  rows in another order are moved and the rest rebuilt, with a report, so
  what was typed into a row stays with its key. A differing text takes exactly
  its share of the server's merged text.
- **Hydration.** Arrays, fragments and providers before a boundary adopt
  cleanly. Interaction islands hydrate on keyboard focus, and the click that
  hydrates one reaches its handler. `<Show>`, `<For>`, `<Switch>` and
  `<Match>` take no owner-path step, so mixed compiled and runtime JSX keeps
  its keys. A compiled `<Portal>`'s children and an island's slot hydrate
  where they render. Event handlers belong to their owner. A late streamed
  boundary's mismatch reaches `onHydrationError`, and a mismatch is reported
  once per region. Stale server attributes are removed from claimed elements.
  A custom element's own property is written on hydration even when the
  server's attribute matches. Hydration keeps what the user typed, checked or
  selected before it ran, controlled or not, on every path, and dispatches no
  event for it, as released React does, so a value the browser restored on
  Back is not taken for an edit. A field counts as edited only when the
  browser's own reset would change it (a range's midpoint, a color's default
  and a disabled first option group are untouched). Handlers see the edits
  made after hydration; a file chosen before it stays in the form and submits.
  On the client a `<noscript>`'s content is neither rendered nor hydrated.
  `onMount` and `useEffect` after hydration see the user's edits, so a
  dependent field can be updated from them there. A form field named after a
  form member (`reset`, `elements`, …) no longer breaks hydration or submit.
  Hydrating a controlled select is linear in its options again, an untouched
  field is not copied to decide whether it was edited, and the copies run no
  element constructors and load no images. A compiled component hydrates its
  children in place however it reads `children` (destructured, renamed, with a
  literal default or a rest element, or as `props.children`) and wherever it
  places them. A compiled array that mixes text, a reactive value, a list or a
  conditional with elements adopts in document order
  (`<Button>Save <Icon /></Button>`). `<Form>`, `<Link>`, `<NavLink>`,
  `<Outlet>`, `<Head>`, the form kit's `<Select>` and the a11y components take
  compiled children unbuilt, so they hydrate in place. A streamed `<Suspense>`
  with a `lazy()` child hydrates whatever the order of its content, its code
  and `hydrate()`. Hydration no longer copies a form-associated custom element
  that reports `type === 'radio'`.
- **Async values.** `settled()` waits for the reveal's effects and for
  streams, and never spins on a synchronous refetch. `refresh()` settles when
  the function answers at once or throws. Transitions that reach one binding
  commit together, and an urgent write no longer releases a held region. A
  second optimistic overlay shows while another action holds the view.
  `createResource().mutate()` during a transition aborts the request. A
  transition awaited inside an action no longer deadlocks.
  `ERR_PENDING_READ_UNTRACKED` is no longer reported for a `pending()` read in
  a binding during server rendering.
- **Retention.** Unmounted components, abandoned promises, held effects,
  dropped query flights, unmounted `useActionState` dispatches, rejected form
  actions, superseded navigations and `<Suspense>` boundaries unmounted while
  waiting retain nothing.
- **Forms.** A control named `reset` or `elements` no longer breaks a reset,
  and a reset that throws becomes the form's `form:error`. A multiple
  `<select>` keeps its array value through a reset. Getter-only properties
  such as an input's `form` and `list` are set as attributes, so
  `h('input', { form })` no longer throws. Value and checked bindings no
  longer rewrite the value they last wrote, so a refetch keeps what the user
  typed. `useFormStatus().data()` is the latest submission still pending. A
  value released to `null` or `undefined` makes the field uncontrolled, so a
  form reset restores its default, in `h()` and compiled output. A field's
  value, checkedness and selection are written as its state, and its defaults
  as its markup, on every path (h(), compiled, spread, hydration, and every
  server renderer), as React 19 does. A server-rendered field shows its value,
  or its default when the value is nullish, in its one content attribute, and
  a `<textarea>` carries it as its text. A multiple `<select>` given one value
  marks only the first option with that value. Option values are matched after
  HTML whitespace stripping, so a leading no-break space counts. A checkbox
  the user clicked still follows its signal. A value released to `null` keeps
  the field's default, and a select whose value starts `null` keeps its
  options' defaults. Unselecting every option of a single select leaves none
  selected. A radio's `defaultChecked` no longer unchecks a controlled
  sibling. `register(name, { type: 'radio' }).checked()` is `undefined`, not
  `false`, when the registration has no value. A server-rendered
  `<select value>` marks the options it names `selected` (in a multiple
  select, every one its array names), so a form posted before hydration
  carries them. A later write to a select's value supersedes a deferred
  earlier one, and `false` clears it. An action result whose `then` getter
  throws reaches `form:error`. Server rendering decides each `<option>`'s
  `selected` from the `<select>` it sits in, including options a `<Suspense>`
  streams inside a select, and never rewrites emitted markup, so a value or
  title containing `selected` is kept. A controlled `<select>` follows its
  value when its options change: added, removed or re-valued by a region,
  `<For>`, `<Show>` or `.map()`. A `style` going from an object to `null` no
  longer throws. A controlled select also follows an option whose text is its
  value, and an emptied keyed list of options; an uncontrolled select's
  default follows options that arrive later, a streamed `<Suspense>` included,
  until the user chooses. Style objects set CSS custom properties (`--accent`)
  on every path. Changing an option's label no longer re-selects a controlled
  select.
- **Data.** A fetcher that throws reaches the `<ErrorBoundary>`. A fetch that
  lands `undefined` is data. A superseded invalidation answers when its
  replacement lands. The query hooks and a `query()` on one key no longer
  report a hydration mismatch.
- **Router.** A delayed View Transition cannot commit a superseded navigation.
  A `preload` that throws renders the route's error boundary. `<Router>`
  server-renders the request's URL with its `preload`. A relative `<Link>` is
  active on the server as on the client, and a relative server `navigate()`
  resolves against the page. A nested Router's middleware and `preload` read
  its own route, and sibling server Routers keep their own URLs. A navigation
  started from inside a guard is released when the Router unmounts. An async
  page reads its nearest `<Router>`, its hooks and the context its parents
  provide after an `await`, also in a nested or sibling Router and in
  concurrent streams. A redirect loop reports `ERR_REDIRECT_CYCLE` with the
  URLs it went through and the routes whose guards sent it on. A `<Router>`
  that unmounts removes only its own action-redirect registration.
- **Compiler.** The callee analysis is iterative, so a module of thousands of
  chained helpers or aliases compiles. A getter read through a local alias is
  reactive, and a member replaced through a destructuring or a `for…of` loop
  is seen. An `Array.of()` or `Array.from()` array of primitives the compiler
  can see is static. `x?.map((item) => <Row key=… />)` and lists nested in
  keyed rows, ternaries and `&&` are keyed on the server as on the client. A
  keyed `.map()` row in a template literal no longer crashes it. A getter
  reached through property access, destructuring, a function's return or an
  array is reactive in JSX. A module of very deep expressions or very long
  chains of reassigned locals compiles, and its reads stay reactive. A
  differential test compiles thousands of generated modules both as analysed
  and fully reactive, and checks that both render the same. Tagged templates
  (the `html` tag included) and array and object spreads in JSX expressions
  are reactive unless the compiler proves them static.
- **Server.** A component given one child receives the child itself, as on
  the client. SSR style objects drop the declarations the client's CSSOM
  would drop. A no-JS action sees `getRequest()` before its first `await`
  without AsyncLocalStorage. what-server's bundler tier no longer writes SSR
  error details into pages.
- **Development builds report diagnostics in every bundler**: Vite's dev
  server, webpack's development mode, Rollup with node-resolve and
  `NODE_ENV=development`, and a default `bun build`. Markup that names a
  global `process` (`<form id="process">`) no longer switches what-core into
  development mode. An app's `Error.prepareStackTrace` that throws no longer
  breaks signal creation in development.
- **create-what full-stack.** A production build serves and publishes only the
  packages' production files (`dist/*.min.js`: no development tier, no source
  maps) whatever the host's `NODE_ENV`, `node server.js` names its mode on its
  first line, and `npm run smoke:clean` stops only its own checkout's servers.
  Its scheduled warm-up of the home page no longer throws, and the entry it
  renders is the one visitors read. `<Portal>` with no `target` renders into
  `document.body`, and a selector that matches nothing reports
  `ERR_PORTAL_TARGET_MISSING`. `what build` no longer changes whitespace
  inside attribute values, `<pre>` and `<textarea>`. `revalidatePath` and
  `revalidateTag` with `regenerate` and no `routeResolver` render from the
  route last rendered for the path instead of throwing.
- **Hydration keeps what the server rendered in more shapes:** JSX in a
  named prop (`<Layout header={<Search />}>`) and a `fallback` handed on
  through a wrapper adopt the server's nodes and keep what the user typed;
  a body child of `<Head>` hydrates in place; two components side by side
  that each return a fragment starting with text or an expression, component
  rows of an unkeyed `.map()`, several components in a `<Show>`, an array
  literal of text and JSX, and a boundary first in an array are adopted in
  order. A generated compiled-JSX hydration oracle checks hundreds of
  component trees for adoption, kept edits and in-place updates.
- **A form after a keyed list keeps its no-JS result** when rows were added
  or removed between the page and the post: a component's place no longer
  counts the components inside an earlier list's rows. A list in
  `<Suspense>` after a conditional list keeps its rows' results.
- **Form bodies parse in linear time on every Node version.** On Node 24, a
  1 MB urlencoded body of key-only pairs (`a&a&…`) blocked the server for
  about 5 seconds before any check.
- **`what dev`'s refused-origin log** escapes every character outside
  printable ASCII, says when it stops listing origins, and tells a page on
  the dev server's host but another port that the port is wrong. With
  `--host 0.0.0.0` or `::`, the machine's addresses are read at each check,
  so an address it gave up is refused.
- **Docs.** A file input with nothing chosen reaches the action as an empty
  `File` (`size` 0), not `''`. The server README hydrates the built-in
  document at `document.body`. SECURITY.md gives measured per-request memory
  for form parsing in place of "about three times `bodyLimit`".
- **No-JS form results land on the right row in more layouts:** a
  conditional component before its list
  (`{pinned.length > 0 && <Table rows={pinned} />}<Table rows={records} />`,
  and the h() function child), one helper rendering two lists, and a list in
  an h() `<Suspense>` or `<ErrorBoundary>`. An island's `useActionState`
  outside a keyed list hydrates into the server's key.
- **A field component that returns a fragment** (`<><label>…</label><input /></>`)
  followed by other controls hydrates in place inside `<Form>`, a wrapper, a
  `<Show>` or a provider: what the user typed or chose before the page's code
  ran is kept, a chosen file included. Before, the controls after it were
  built again and an upload field lost its file.
- **A layout whose header returns a fragment starting with a component,
  followed by `<Suspense>` or `<ErrorBoundary>`, hydrates in place.** Before,
  hydrating threw while revealing the boundary and left its content dead.
  Keyed rows of a fragment-returning component, a fragment among an element's
  children, `<Show>`/`<For>` in an array literal and a reactive expression in
  a `<Show>` arm are adopted in place too. The compiled-JSX hydration oracle
  now finds no divergence in 14,300 generated trees over 8 seeds.
- **JSX passed to a component and placed in a `<Show>` or a reactive
  condition keeps what the user typed** when a signal its JSX read changes
  (`<Modal body={<EditForm item={selected()} />} />`), as with `h()`.
- **A JSX prop read after the component's run** (a test in `onMount`, a
  handler that shows it in a dialog, a read after an `await`) is no longer
  built with no owner: before, it got every context's default, its effects
  outlived the page and its errors skipped the `<ErrorBoundary>`.
- **`items={links.map((l) => <li>{l}</li>)}` and JSX array props hydrate in
  place.** JSX a `.map()` builds into a variable is reported `prebuilt` with
  form state kept. Form state moves only to the control that corresponds to
  it (tag, type, name and `form` attribute), never into a `<noscript>`.
- **Form bodies keep a leading U+FEFF**, as every WHATWG reader does, and a
  refused action call rejects with its coded error whatever its body is (a
  proxy's page, `null`). The upload recipe and the starter show the error's
  message when a proxy's own 413 carries no `limit`.
- **A compiled `client:load` island inside keyed rows keeps its no-JS
  result** after hydration, under the server's keys.
- **The full-stack starter's `/new` form shows why the server refused a
  post** (a 413 with the limit, another refusal, a failed request), and
  what-react's `hydrateRoot()` names itself in `ERR_MOUNT_TARGET_MISSING`.

### Performance

- The compiled create-what counter is smaller than 0.14's: compiled output
  no longer carries the vnode reconciler, and an app with no computed leaves
  out the engine's pull phase. Apps written with `h()`, and apps that use
  async values or hydrate, are larger. UPGRADING's Bundle size section has
  the measured numbers and their causes.
- An app that makes no `computed()`, `useMemo()` or `createSelector()` does
  not bundle the engine's pull phase (the lazy computeds' verification, the
  deferral of deep chains, the release of unobserved computeds): about
  1.1 KB gzip. The first computed installs it, which costs an app that makes
  computeds about 70 B.
- `<ErrorBoundary>` and `<Portal>` carry their client renderers on their
  vnodes, as `<Suspense>` does, so an `h()` or runtime-JSX app that uses
  neither leaves them out (about 380 B gzip).
- Browser bundles leave out the server render's resource store: a server
  render installs it, not `hydrate()` or `query()` (about 410 B gzip in a
  hydrating app, 220 B in an app that uses the query cache).
- A swap of two rows among 1,000 reads about 12 keys instead of about 2,000.
- Development-tier signal writes, batches and effect runs take 0.72–0.93×
  0.14's time, and a page without devtools takes no stack trace per signal.
- `jsx()` no longer allocates an array per element (h() SSR heap −10% at 1k
  rows).
- The check that refuses an async value a second copy of what-core makes
  during a server render (`ERR_FOREIGN_ENGINE_IN_SSR`) comes with the server
  render, not with every async-capable value: about 120 B gzip off an app that
  calls `computed()`.
- A hydrating app that never sets a `<select>`'s value leaves out the option
  marking hydration repeats for controlled selects (about 160 B gzip), and
  browser bundles leave out the lookup a second copy adopts from a server
  render.
- In development, an effect flush no longer allocates a `Map` and a `Set` for
  its infinite-loop report.

## [0.14.0] - 2026-10-13

Minor release: all 13 maintained packages move to 0.14.0 together. It adds
public API to `what-server` (`createVuraHandler`, `buildVuraOutput`) and a
build step to the create-what full-stack template. Deprecated `what-mcp` stays
frozen at 0.12.4.

### Deploy to Vura

- New Vura adapter in `what-server` (also reachable as `what-framework/server`
  under Node). `createVuraHandler(optionsOrHandler)` returns the Function
  module Vura loads, `{ fetch(request, env) }`. It accepts the same options as
  `createRequestHandler` or an existing handler, and rebuilds `request.url`
  from the edge's `x-forwarded-host` and `x-forwarded-proto` so the app sees its
  public origin.
- `buildVuraOutput({ entry, staticFiles })` writes Vura's build output:
  `dist/static/**` for the CDN, the entry bundled by esbuild into one
  self-contained `dist/functions/_/index.js`, and a v1 `dist/manifest.json`
  with one catch-all serverless route. The deploy needs only the `api` and
  `function-compute` features, with no dedicated compute. The manifest sets
  `"filesystemFirst": true` so the edge serves the client JS and CSS from
  `dist/static` before the catch-all Function. esbuild is resolved from the
  project and is never a runtime dependency.
- The what-isr poll scheduler does not run inside a Vura Function. Schedule
  revalidation with an external cron that calls `POST /__what_revalidate`.
- The create-what full-stack template now has `npm run build`, which writes
  Vura output. `function.js` reuses `createHandler()` from `server.js`, and the
  browser allowlist moved to `client-files.js`, one list that both the server
  and the build read. `npm run dev` and `npm start` are unchanged, except that
  framework sources are now served from `/node_modules/what-framework/src/` and
  `/node_modules/what-core/src/` only (what the import map points at), not from
  the whole package directory.

### Behaviour change: production without `WHAT_REVALIDATE_SECRET`

- The full-stack template's `server.js` used to exit at startup when
  `NODE_ENV=production` and `WHAT_REVALIDATE_SECRET` was unset, which would
  crash a serverless Function on every cold start. It now logs one warning and
  does not mount the revalidate webhook, so `POST /__what_revalidate` returns
  404. With the secret set, the webhook works as before. Development still
  generates a secret per run.
- The template's `what.config.js` no longer claims that `what build` and
  `what start` read it to pick a deploy adapter. Its comment now says what
  actually reads it.

## [0.13.11] - 2026-10-08

### Safer server rendering and private pages

- Server rendering rejects invalid attribute names before writing any value,
  including `false` values on data and accessibility attributes. Valid
  attributes keep their existing behavior.
- Concurrent page requests no longer share a render marked private or using
  request headers. Each waiting request renders with its own context; public
  page results still share work and private results remain uncached.
- Installing `what-server` on its own now installs its required `what-router`
  peer, so the Node server entry works without monorepo dependency hoisting.

### Reliable updates and recovery

- Reactive attributes on hydrated elements stop updating when those elements
  are disposed. Detached elements no longer retain these subscriptions.
- A throwing error-boundary fallback no longer leaves later components in the
  failed boundary's context.
- Stable effect failures are reported in production without stopping sibling
  effects or subsequent updates.
- DevTools report an effect's initial execution and dependencies before the
  first signal write, without executing the callback a second time. Lazy
  computed values remain lazy.

### Clearer development feedback

- Edits to imported components appear without a manual browser refresh. When
  no component-replacement runtime is installed, the compiler reloads the
  page; this fallback does not preserve local component state.
- The recommended ESLint configuration warns when native component props are
  destructured during setup, which can capture their initial values. React
  compatibility components are excluded.
- TypeScript and generated-project guidance now explain reactive prop access
  and the dependency graph accurately.

### Release verification

- Local verification and the publisher share one correctness-gate list,
  including declaration parity, error catalogue/docs checks, typechecks and
  lint. Local performance gates remain blocking; CI retains its separate
  non-blocking performance signal.
- Publishing requires the `main` branch. Already-published versions reconcile
  the requested npm tag only after missing cohort members publish; registry
  verification checks both exact versions and that tag before installing
  pinned packages.
- CI adds a bounded native WebKit qualification for hydration, inputs, radio
  controls, events, SVG and visible islands, plus packed standalone-server
  verification. These checks are not a claim of exhaustive browser coverage.

See `docs/releases/v0.13.11.md` for migration guidance and scope. No new runtime
dependencies or performance improvements are claimed. All 13 maintained
packages advance together; deprecated `what-mcp` stays frozen at 0.12.4.

## [0.13.10] - 2026-09-28

### Imported values in compiled JSX

- **what-compiler no longer calls an imported binding used as an attribute
  value.** `<a href={DOCS_URL}>` with `export const DOCS_URL = '/docs'` compiled
  to `DOCS_URL()` and threw `DOCS_URL is not a function` at render. The compiler
  treated every relative import as a signal, but an import can hold any value.
  The identifier is now passed through uncalled, and the runtime setters
  resolve a function value as a reactive accessor exactly as `h()` does. So an
  imported string, number, class name or style object renders, and an imported
  signal, computed or accessor function still updates the attribute. Named,
  default and namespace imports behave the same way. A local
  `const x = signal()` is still called, since the compiler can prove what it is.
- `<Show when={X}>` and `<Match when={X}>`, where `X` is an import or a
  destructured prop (bare, or the root of a plain member chain like `ns.open`),
  now compile to `typeof X === 'function' ? X() : X`. This matches the
  components' own runtime check. An imported boolean flag previously threw
  `FLAG is not a function`.
- The differential fuzzer gained an imported-bindings arm: 300 random trees that
  place constants, `null`, a signal, a computed, a function, a default import
  and namespace members in attribute, child and component-prop positions,
  compared against the `h()` tree before and after a write. On the previous
  compiler the first tree throws `DFLT is not a function`. All 300 now match.

### Attribute aliases on the server and in compiled templates

- **SSR now renames `htmlFor` to `for`.** `<label htmlFor="email">` was written
  to HTML as `htmlFor="email"`, which the browser parses as a meaningless
  `htmlfor` attribute. Hydration never corrects a static attribute, so the label
  stayed disconnected from its input after hydration too. `renderToString`,
  `renderToStream` and `renderDocument` now rename every prop whose attribute
  name differs by more than case: `htmlFor` to `for`, `httpEquiv` to
  `http-equiv`, `acceptCharset` to `accept-charset`, and `className` to `class`
  as before. Case-only names such as `tabIndex` and `readOnly` need no rename,
  because HTML attribute names are case-insensitive.
- what-compiler's static templates had the same gap for `httpEquiv` and
  `acceptCharset`: `<meta httpEquiv="refresh">` with a literal value became an
  `httpequiv` attribute, while the same prop with a dynamic value worked. Both
  are now renamed, so compiled, `h()` and server output agree.

### New `create-what` template: static site with islands

- `npm create what@latest my-site -- --template=islands` (or choice 3 at the
  template prompt) scaffolds JSX pages prerendered to static HTML with
  interactive islands: two pages, one shared layout, one island.
  - `npm run dev` renders each page on request through Vite.
  - `npm run build` writes `dist/index.html` and `dist/about/index.html`, with
    the island's markup already in the HTML.
  - `npm run preview` serves `dist/` the way a static host does.
- The island hydrates in place over the server markup when its `mode` fires.
  A page without islands loads one small entry script and no framework code.
- Pages use the automatic JSX runtime (`jsxImportSource: 'what-framework'`)
  rather than what-compiler, because every page is rendered on the server.
  Built on `renderDocument`, `exportStatic`, `Island` and `hydrateIslands`.
- `npm run smoke:scaffold` now covers the template end to end. It scaffolds and
  installs from local tarballs, checks dev-server pages and island hydration in
  a real browser, and builds. It then checks the static files, confirms the
  built island hydrates in place (the server-rendered button is the live one)
  and increments, and checks that a page without islands requests only the
  entry script.

## [0.13.9] - 2026-09-26

### Consistent static-page data

- Static and hybrid exports now run each concrete page's loader once and share
  its result between the rendered HTML and navigation data. Changing data can
  no longer produce one revision on first load and another on client navigation.
- Custom static renderers share a lazily resolved loader snapshot, preserving
  their ability to prepare loader context before its first read. Snapshots
  are isolated per URL and export run; the caller's route loader is not mutated.

### Release tooling

- Refresh the existing MCP tooling's locked Hono dependency to 4.13.9 to clear
  the repository audit gate. No dependency is added to the browser runtime.

## [0.13.8] - 2026-09-07

Published September 7, 2026 (UTC), including the declaration corrections
prepared in the unpublished 0.13.7 candidate. All 13 maintained packages were
published with provenance and passed registry and published-app verification.
The historical 0.13.7 preparation notes remain unchanged.

### Protected routes fail closed

- JavaScript callers returning a promise or thenable from route middleware now
  receive `ERR_ASYNC_MIDDLEWARE` before the protected component mounts. Rejected
  results are observed without treating an async result as authorization.
- Synchronous allow, deny and redirect behavior is unchanged. Async checks
  belong in `asyncGuard(check)(Component)`, not `middleware[]`. Client-side
  guards control rendering/navigation; enforce authorization on the server.

### More useful benchmark diagnostics

- DOM reports preserve raw samples, per-operation sample counts, and browser,
  machine and toolchain details so timing changes can be investigated with
  their context. The `samplesPerRound` field is now an operation-name map.
- This is diagnostic evidence, not a speed improvement claim. Timed operations,
  aggregation, baselines and tolerances are unchanged; historical measurements
  have not been relabeled as new measurements.

See `docs/releases/v0.13.8.md` for migration and candidate verification limits.
No new dependencies or rendering capabilities are introduced.

## [0.13.7] - 2026-09-06

### Strict TypeScript contracts for reactive applications

- Components and JSX now accept the reactive child values the runtime already
  supports, including function returns, arrays, text and empty values. Invalid
  object/promise returns and incorrect component props remain type errors.
- Reactive DOM attributes can return null or undefined to remove an attribute.
- Router middleware types now match the synchronous runtime: return true/void
  to continue, false to block, or a string to redirect. The context includes path.

### Middleware migration

Async middleware was incorrectly accepted by the old declarations; the router
does not await it. Wrap the route component with `asyncGuard(check)(Component)`
instead of putting an async function in `middleware[]`. This is a declaration
correction, not newly enforced runtime authorization. See
`docs/releases/v0.13.7.md`. No new runtime dependencies are introduced.

## [0.13.6] - 2026-09-06

### Safer full-stack scaffolds

- Generated full-stack servers return HTTP 400 for malformed URL paths instead
  of crashing the process. Subsequent valid requests continue to work.
- Generated servers start correctly from directories containing spaces, and
  printed POSIX `cd` commands safely handle spaces and option-like paths.
- Unknown, empty, or whitespace-only template selections fail explicitly
  instead of silently generating the SPA template.
- The maintained release group contains 13 packages. Deprecated `what-mcp`
  remains frozen at 0.12.4.

### Existing generated applications

Updating `create-what` does not rewrite an existing application's `server.js`.
Apply the generated-server request parsing and startup-guard changes described
in `docs/releases/v0.13.6.md`, or generate a new comparison project and port those
changes without overwriting application code. No new runtime dependencies or
rendering/SSR capabilities are introduced by this patch.

## [0.13.5] - 2026-09-05

### Reactive updates and request reliability

- Conditional reactive views keep updating when a new dependency appears after earlier renders. Ordinary effects no longer silently switch to inline scheduling after repeated single-dependency runs.
- Disposed roots release owned computed subscriptions; failed setup and throwing cleanup no longer leave orphaned effects or siblings running.
- Query decoding preserves `+`, `=`, malformed escapes and repeated parameters. ISR cache keys retain the order of repeated values, preventing one request from receiving another request's cached result.
- Mixed-version Vite workspaces configure JSX for the consuming app's Vite version. Package builds now return failure when an entry fails instead of printing a successful result.
- Compatible dependency security patches and TypeScript 7 source/declaration tooling improvements are included. Runtime support is unchanged.

### Upgrade note

Clear or rebuild persisted ISR entries produced by the previous duplicate-query normalization, or allow their normal expiry before relying on the new ordering. This release does not add paired fine-grained compiled-JSX SSR/hydration; the supported VNode/automatic JSX SSR path remains available.

### Compiler and rendering corrections

Five fixes to the **compiled** path, plus DOM parity between the three render
paths. Every one was found by executing the compiler's output and comparing it
against `h()` and against SSR, not by reading code, and none of them was visible
to the 2,566 tests that were already green.

### Fixed

- **A compiled component could silently vanish from a server-rendered page.**
  what-compiler's output is client-only: a component body lowers to a
  module-scope `_$template()` and a `cloneNode`, so it returns finished DOM and
  has no server-rendered form. Reaching a renderer with one produced
  `Invalid tag name in SSR: undefined` (`ERR_INVALID_SSR_TAG`), whose documented
  cause is a component returning a plain object. Worse, every render path
  degrades rather than 500s, so when the compiled node arrived through a reactive
  thunk, a keyed list, a stream or an `<ErrorBoundary>` the throw was absorbed
  and the component simply disappeared: `renderToString(h('main', null, () =>
  Compiled()))` returned `"<main></main>"`, with the warning dev-gated so
  production logged nothing and the server reported success. Measured by the
  lowering fuzzer: 250 of 500 generated tree-routes rendered a silent hole.

  There is now one named code, `ERR_COMPILED_JSX_IN_SSR`, raised at three seams.
  what-compiler's Vite plugin refuses the transform at **build time** when it is
  compiling for the SSR environment and the output builds DOM, naming the file
  and both supported alternatives; the verdict is read from the emitted code, so
  a server-action module and a `hydrate()`-only module still compile. what-server
  distinguishes a DOM node from a bad tag name. And all eleven degrading catches
  now rethrow this one code, because a build misconfiguration cannot be retried
  or fallen back from. A genuinely invalid tag still raises
  `ERR_INVALID_SSR_TAG`.

  This does **not** make compiled JSX server-render. Ordinary JSX already does,
  via the automatic runtime (`jsxImportSource: "what-framework"`), verified on a
  DOM-less Node process; what-compiler's fine-grained output is the case with no
  server form. A hydratable codegen target is scoped in
  `docs/SSR-COMPILED-JSX-SCOPING.md` and deliberately not attempted here.

- **Compiled fragments rendered their slots in the wrong order** (#65). Fragment
  lowering emitted one insert per slot against a shared parent, so a fragment
  with three dynamic slots could realize them out of source order. The lowering
  now emits one marker per slot and flattens children into the parent's entry
  list, which is the same shape `h()` produces. Found by differential fuzzing
  compiled JSX against `h()`: 1,417 of 2,000 randomly generated trees diverged
  before the fix, 0 of 2,000 after.

- **Compiled reactive regions leaked their effects** (#64). `insert()` anchored
  its effect disposer on the parent rather than on the region's own marker, so
  toggling a region on and off accumulated one live effect per cycle. Measured:
  after 30 toggles a single signal write ran the inner thunk 31 times; it now
  runs once.

- **`hydrate()` could blank the page** (#64). Given DOM a component had already
  built, the hydrate walk replaced the server's markup instead of claiming it.
  It now claims and replaces under the cursor, and warns once per `hydrate()`
  rather than once per node.

- **Compiled JSX could not hydrate at all.** `hydrate(<App />, container)` is the
  documented client entry and it lowered to
  `hydrate(_$createComponent(App, ...), container)`, which runs the component and
  builds its DOM before `hydrate()` is called. A built tree has its bindings
  wired to its own nodes, so the walk could only insert it and let the trim
  delete the server's markup: every compiled app that hydrated discarded its
  whole server render. The warning above made that visible in development, and
  warnings are stripped from production builds, so in production it was silent
  and the resulting markup was byte-identical to a correct hydration.

  JSX written directly inside a `hydrate()` call now lowers to `_$componentVNode`,
  which is `_$createComponent` stopping one step short of building. The walk
  reaches the server's nodes and claims them: proved by node identity, since
  markup equality is exactly what a client render also satisfies. The callee is
  resolved through Babel's scope, so an aliased or namespaced import is rewritten
  and a local `hydrate` that shadows the import is not.

  The root only. A host element lowers to a template clone, so `<App><p>hi</p></App>`
  still builds the `<p>`. That bounds less than it appears: a component whose own
  body the compiler lowered returns a template clone, and `renderToString` cannot
  render one either, so it has no server markup to adopt. Components in a
  hydrated tree are written with `h()` or the automatic JSX runtime, as the
  fullstack scaffold and every smoke app already do; only the client entry needs
  what-compiler.

- **Static attributes after a spread were applied in the wrong order** (#65).
  `<div id="a" {...props} />` and `<div {...props} id="a" />` compiled to the
  same thing. Static attributes from the first spread onward are now emitted as
  ordered calls, so the last writer in source order wins.

- **Accessor props were not auto-thunked** (#65). `{props.count()}` rendered once
  and never updated, contradicting the documented behaviour. The auto-thunk now
  widens to accessor calls and to a known set of pure built-in methods.

- **Boolean `data-*` disagreed across all three paths** (#66). `data-open={true}`
  produced `data-open="true"` from the compiler, `data-open=""` from `h()` and a
  bare `data-open` from SSR. `data-*` is enumerated, not a genuine HTML boolean:
  unlike `disabled`, `="false"` is a real value that CSS selectors and
  `element.dataset` both read. All three now emit `="true"`. Genuine HTML
  booleans, non-boolean `data-*` and nullish `data-*` are unchanged, each with
  its own control test.

- **`data-hk` outlived hydration** (#66). The server stamps it on component roots
  so the client can correlate the trees, and the client never reads it: the prop
  loop only skips the key. It was therefore left in the document forever, so a
  hydrated page and a client-rendered page disagreed on every component root,
  permanently. It is now stripped at the claim site, so only elements the walk
  actually claimed lose it; an element the client declares empty is left alone,
  because an island fills its host from the server markup still inside it and
  hydrates that markup later.

- **A reactive region removed the nodes it remembered, not the nodes it held**
  (#68). A region recorded the nodes its value produced at mount and reused that
  record as the removal set. That is sound for content the region built outright
  and wrong for content that manages itself: a list and a nested region each own
  an effect and go on replacing their own nodes. So hiding a conditional whose
  list had grown stranded every row added since mount, and showing it again
  rendered a second list beside the orphans, permanently. Broken on three paths
  (compiled `insert()`, `h()` via `createDOM`, and `hydrateNode`), all three
  fixed. **Not a regression** from the fragment work above: byte-identical at the
  commit before it, and it reproduces with no fragment present at all.

- **Component and island spreads ignored source order** (#69). An earlier spread
  was dropped *entirely* rather than overridden, so `<Box {...a} mid="m" {...b} />`
  emitted `Object.assign({}, b, {mid:"m"})` and every key in `a` vanished. That is
  data loss, not just precedence. Props are now built as an ordered argument list
  and merged left to right, which is what `h()` and the element path already did.
  Islands additionally keep `component`, `mode` and `mediaQuery` last, so user
  data written after a directive cannot reach the hydration machinery.

- **A lone component spread mutated the caller's object.** `_$createComponent`
  wrote `children` (and `_$lazyChildren`) onto the props object it was handed,
  and the compiler passed a single spread through uncopied. So
  `<Box {...reused}>FIRST</Box><Box {...reused}/>` rendered FIRST twice and left
  `reused` carrying a `children` key the user never wrote. The compiler now
  copies a non-literal single spread the same way a multi-prop merge already
  did (accessor VALUES copied, never invoked). The runtime copies before it
  attaches children, so hand-written `_$createComponent` calls are safe too.

### Known

- Island attributes with hyphens emit invalid JavaScript: `<Chart client:load
  data-x="1" />` compiles to `{data-x:"1"}`, a syntax error, because the island
  branch does not test the attribute name the way the component branch does.

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
