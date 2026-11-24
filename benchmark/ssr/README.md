# SSR benchmark

Server rendering of the krausest table page (the same 1,000- and 10,000-row
markup `benchmark/krausest/frameworks/*` render in the browser) in Node,
in-process, for **what** (repo working tree, twice: the h()/runtime-JSX page
through the vnode renderer, and the page compiled by what-compiler's server
target), **solid 1.9**, **solid 2.0** and **react 19** as a reference point.

Measured: synchronous string render (plain and hydratable), streaming of the
plain page, streaming of the page with the table inside one async boundary
(shell-first vs in-order flushing), and heap allocated per render.

## Run it

```bash
cd benchmark/ssr
npm install          # isolated deps, NOT the repo root
npm run bench        # build + full run (3 rounds), about 4 min
npm run bench:quick  # build + smoke run (1 round, few samples), ~30 s
npm run bench:hydrate:quick  # hydration in Chromium (5 runs per entry), ~5 s
node page.mjs --quick --before <what-fw checkout>  # an ordinary page, two checkouts
```

`npm run bench` runs `node build.mjs && node bench.mjs` and writes
[`RESULTS.md`](RESULTS.md) (tables, machine, versions, caveats) and
`results.json` (every raw sample, the job list and the bundle manifest).
`node bench.mjs [--quick] what solid2` limits the run to some frameworks.
Run it on an otherwise idle machine; the jobs are strictly sequential.

`hydrate.mjs` (`npm run bench:hydrate`, 21 runs per entry) measures the other
half: each framework's hydratable server renders the 1,000-row page and its
client hydrates it in Chromium. It reports the `hydrate()` call's time, the
time until a click on a row's label has selected it, the nodes created while
hydrating (zero when the client adopts every node the server wrote) and the
client bundle's gzip size. Each client is built the way an app ships it: the
What clients resolve the `production` export condition (`dist/*.min.js`), so
run `node scripts/build.js` first. `--before <what-fw checkout>` adds
`before.what` built from another (built) checkout, and `before.whatc` when that
checkout's compiler has a server target; 0.14's has none, so that entry is
skipped with a message. React's hydration is not measured: there is no React
entry. It prints its table and writes nothing outside `dist/`.

`page.mjs` renders an ordinary page instead of the table
(`frameworks/whatc/page.jsx`: a storefront with a layout, context, a keyed list
of 48 component rows, reactive text and attributes, `<Show>`, an
`<ErrorBoundary>`, a `<Suspense>` around a resource, an island and a form) with
what-compiler's server target: string render plain and hydratable, the stream,
and heap per render. With `--before <what-fw checkout>` (an installed
checkout, or an export of one with its `node_modules` linked) it builds the
same page with that checkout's compiler and packages, checks that the two
render the same HTML, and alternates the two round by round in fresh
processes, so a change measured on the table page can be checked on a page
that is not one big list. It prints its table and writes nothing outside
`dist/page/`.

## Layout

| Path | What |
|---|---|
| `frameworks/<fw>/app.jsx` | The page in each framework's idiom (same markup, same data); `what` is the h()/runtime-JSX page, `whatc` the what-compiler page |
| `frameworks/<fw>/entry.jsx` | `renderString`, `stream`, `streamAsync` over that framework's server API (What: `renderToStream(...).pipe(out)`) |
| `frameworks/whatc/page.jsx`, `page-entry.jsx` | The ordinary page `page.mjs` renders, and its server entry |
| `frameworks/solid1`, `frameworks/solid2` | npm workspaces, so the two Solid majors each resolve their own `solid-js` |
| `shared/data.mjs` | Seeded dataset and the canonical markup |
| `shared/verify.mjs` | Output equivalence checks run before any timing |
| `build.mjs` | Bundles each framework twice (plain, hydratable) into `dist/` and writes `dist/manifest.json` |
| `worker.mjs` | One measurement job in a fresh process |
| `bench.mjs` | Plans and runs the jobs, aggregates, writes the reports |

## Fairness

- **Compilers.** Each framework's JSX goes through its own compiler in its own
  server mode: `babel-preset-solid@1.9.19` and `@solidjs/babel-plugin@2.0.2`
  with `generate: "ssr"` (the plugin version the solid 2.0.3 monorepo ships;
  the Solid 2 docs list it as the Babel compiler beside the default native
  `@solidjs/compiler`), esbuild's automatic runtime for React, and for What
  twice: `what` with the automatic runtime (`jsxImportSource:
  "what-framework"`, h() vnodes walked by the vnode renderer) and `whatc` with
  what-compiler `{ generate: "ssr" }` (string templates filled by
  what-server/ssr-runtime), from the working tree's packages/compiler.
- **Modes.** `plain` and `hydratable` are separate bundles. Solid decides at
  compile time (`hydratable: false/true`); What picks `renderToString` vs
  `renderToHydratableString`; React picks `renderToStaticMarkup` vs
  `renderToString`. Streams use the hydratable bundles. What's
  `renderToStream` writes the same hydration keys and markers as
  `renderToHydratableString`.
- **Idioms.** Keyed list idiom of each framework: What `.map()` with a `key`
  prop inside a thunk and a function-valued `class` (the h()/runtime-JSX shape
  CLAUDE.md documents), Solid `<For>`, React `memo` rows with `key`. Async:
  What `createResource` + `<Suspense>`, Solid 1 `createResource` +
  `<Suspense>`, Solid 2 async `createMemo` + `<Loading>`, React `use()` +
  `<Suspense>`. Event handlers are written as on the client; Solid's SSR
  compiler drops them, What and React allocate them and skip them at render.
- **Same output.** Before timing, every job asserts row count, cell text at
  three rows, the one selected row, and structural equality with the canonical
  markup after stripping only hydration markers, comments, scripts, templates
  and empty `class` attributes. The checker is self-tested on broken markup at
  the start of every run.
- **Versions.** `dist/manifest.json` (copied into `results.json`) lists every
  `node_modules` package esbuild bundled, read from the bundled files' own
  `package.json`: `solid-js@1.9.20` from `node_modules/solid-js`, and
  `solid-js@2.0.3` + `@solidjs/web@2.0.3` from `frameworks/solid2/node_modules`.
  What resolves through the repo root's workspace symlinks to `packages/*/src`;
  the manifest records the git commit and whether any bundled What source file
  had uncommitted changes.
- **String timing includes encoding.** Solid and React return V8 ropes whose
  flattening is deferred; the timed region is `renderString()` plus
  `Buffer.from()` of the result. Render-only time is reported beside it.
- **What imports `what-server`.** Through `what-framework/server`, esbuild used
  to drop the AsyncLocalStorage setup (finding 1 below, now fixed); importing
  `what-server` keeps the measured configuration the same across versions.

## Why the numbers differ

This section describes What as of commit `0731cbb8`. Since then (server
pipeline upgrade): `renderToStream` is a buffered work-stack renderer that
streams out of order (shell and fallbacks first, one chunk per segment, the
fallback flushed before the data), the string renderer escapes in one pass and
caches attribute-name decisions, and findings 1, 2, 4, 5, 6 and the
`escapeHtml`/`renderAttrs`/recursion items of 7 below are fixed. The vnode walk
itself (finding 3) remains for the `what` entry. The `whatc` entry answers finding 3 the way Solid
does: what-compiler's server target compiles each row to one pre-joined template
with three string holes, filled at the call site, and only components go
through the renderer.

Where the compiled row still differs from Solid 1.9's: a reactive attribute
(`class={selected() === row.id ? 'danger' : ''}`) is evaluated where the row is
placed, in document order with the page's other holes, as h() evaluates the
thunk it is handed (packages/compiler/test/ssr-hole-evaluation.test.js), where
Solid evaluates every hole as the JSX expression runs. So a row is written in
two steps: its template and plain holes when the `.map()` callback runs, with
the attribute's slot and the row's item kept in the list's parts
(`packages/server/src/ssr-runtime.js` `deferRowAttribute`), and the attribute
when the list is rendered. The attribute's function is made once for the list,
not once per row (`packages/compiler/src/babel/ssr.js` `rowAttributes`). A
keyed list's row-key digests are computed only by a hydratable renderer, for
the whole list at once (`packages/server/src/compiled.js` `rowKeys`), and the
stream writes a list's finished HTML and attributes straight into its buffer
(`Markup.pour`). Resolving the attribute as the row is written instead, in a
prototype, took a further 14% off the string render on a loaded machine, which
put it ahead of Solid 1.9; it changes the order side effects run in, so it is
not what ships.

Line numbers are against the what-fw working tree at commit `0731cbb8` and the
Solid monorepo at `b4212bf` (solid-js/@solidjs/web 2.0.3). Profile shares are
from `node --cpu-prof` on this machine while it was loaded; read them as
proportions, not absolutes.

### What vs Solid 2.0, synchronous string render

Solid compiles the page into string templates. For each row, the solid 2.0
output is a single `ssr(_tmpl$, …)` call: the static markup of the whole `<tr>`
is pre-joined at build time, and only the three holes (class, id, label) are
concatenated at runtime (`packages/web/src/server.ts:4931` `ssr()`). Content
holes go through `escape()`, whose fast path is one native regex search for
`[&<]` that returns the input untouched when nothing matches
(`server.ts:5741`, `ESCAPE_CONTENT` at `:5816`). Attribute names come from the
compiler, so `ssrAttribute()` trusts them and concatenates (`server.ts:5595`).
`<For>` on the server reuses one owner for every row (`packages/solid/src/server/signals.ts:3529`),
and a list of finished rows is joined by plain `+=` (`server.ts:5906`
`tryJoinPlainSSRArray`). Event handlers never reach the output code: the
compiler drops them. The static jumbotron (about 30 elements) is one template
string with one hole.

What builds the page at runtime and then walks it:

1. **Vnode construction.** Every element goes through `jsx()`, which copies the
   props with an object rest (`packages/core/src/jsx-runtime.js:13`), and then
   `h()`, which copies them again and `delete`s `key` whenever a key is present
   (`packages/core/src/h.js:40-42`), so every keyed `<tr>`'s props object
   becomes a dictionary-mode object. Each row allocates 8 element vnodes, their
   children arrays and 3 closures (class thunk, two handlers).
2. **Tree walk.** `renderToString` (`packages/server/src/index.js:271-372`)
   recurses per node and per element builds `children.map(renderToString).join('')`
   (`:370`), an array plus a join for every element, and runs
   `assertSafeTag`'s regex (`:362`, `:829-830`) and `_resolveInnerHTML` (`:369`).
   Each recursive call starts with `getServerContext()` (`:274`), which is
   `AsyncLocalStorage.getStore()` once what-server's Node entry is loaded
   (`packages/core/src/server-context.js:35`).
3. **Attributes.** `renderAttrs` (`index.js:868-952`) allocates
   `Object.entries(props)` per element (`:870`), then per attribute does an alias
   Map lookup, `toLowerCase()`, a `startsWith('on')` check, calls a function
   value (`:893`), tests `SAFE_ATTR_NAME` (`:906`), checks `REFUSED_ATTRS`, and,
   for any attribute that is not `class`/`style`, runs `isUnsafeUrlAttribute`
   (`:946`, `:955-960`). Solid does all of that at compile time.
4. **Escaping.** `escapeHtml` (`index.js:973-980`) is five chained
   `String.prototype.replace` calls with global regexes. Each text node and
   attribute value is scanned five times, and numbers are stringified first
   (`:282`, `h.js` `_flattenSingle`). Solid scans once and returns early.

In the 1,000-row profile: `renderToString` self time 25%, `escapeHtml` 25%,
`renderAttrs` 19%, GC 13%, `jsx`/`h` 10%, the two name-validation regexes 3%.
The smoke run measured about 11 MB allocated per 1,000-row render for What vs
about 1 MB for Solid 2.0 and 0.4 MB for Solid 1.9.

`renderToHydratableString` costs about the same as `renderToString`: it is the
same walk plus `data-hk` injection per component (`index.js:243-266`, a regex
match on the head of the component's output) and comment markers.

### Solid 1.9 vs Solid 2.0

Solid 2.0 is slower than 1.9 on this page, by 1.3x to 2.4x depending on mode
and size in the smoke run. In 1.9 the compiled row passes plain
values into `ssr(t, ...nodes)`, a short concat loop
(`node_modules/solid-js/web/dist/server.js:474`). In 2.0 every hole is a
closure (`() => escape(row.id)`; the class hole is a closure that builds the
attribute), and `ssr()` resolves function holes through `tryResolveFunctionHole`
(`server.ts:3908`) so that any hole may suspend, plus live-hole bookkeeping
(`server.ts:4931` and after). Hydratable 2.0 also wraps each content hole in `ssrScope()`. This is the
cost of 2.0's async-aware holes, paid even when nothing is async.

### React 19

React's Fizz renderer builds every element at runtime too (no compile step), so
it lands between What and Solid: per-element prop iteration and escaping,
written into chunk arrays. In the smoke runs React was 5-25x slower than
Solid 2.0. Against What it was up to about 2x faster at 1,000 rows and roughly
level at 10,000 rows, where its timings were the noisiest of the four.

### Streaming, plain page

Solid's `renderToStream` runs the synchronous render and writes the shell in
one chunk. React writes about 4 KB views. What's `renderToStream`
(`index.js:491-637`) is a recursive async generator that yields every opening
tag (`:624`), every text node and every closing tag (`:635`) separately and
delegates children with `yield*` (`:631-633`), so 1,000 rows become about
18,000 chunks. Each chunk is resumed through every `yield*` level above it
(about 10 for a cell's text) and costs at least one microtask in the consumer's
`for await`. In the smoke runs, streaming the page took 5-9x as long as
`renderToString` of the same page. The async-boundary page is cheaper for What
than the plain stream, because `<Suspense>`'s subtree is rendered with
`renderToString` into one chunk (`index.js:577`).

With AsyncLocalStorage installed (what-server's Node entry,
`packages/server/src/node.js:13`), Node 22 runs async_hooks promise hooks on
every promise those generators create. That is 25% of the streaming profile
(`promiseInitHook`, `promiseBeforeHook`, `promiseAfterHook`). A/B at 1,000 rows
(two runs each, loaded machine): about 22 ms per stream without
AsyncLocalStorage, about 36 ms with it. `renderToString` is unaffected (about
4.3 ms either way). The benchmark measures the with-AsyncLocalStorage
configuration, since that is what a Node server gets from what-server. Node's
newer AsyncContextFrame-based AsyncLocalStorage should remove most of this cost;
it is not measured here.

The benchmark's sink is a Node Writable, so these chunk counts cost only a
`write()` call each. On a real HTTP response, the documented loop
(`packages/server/README.md:39-41`, `response.write(chunk)` per chunk) turns
each one into a chunked-encoding frame. That cost is not charged here.

### Streaming, async boundary

Solid and React flush the shell and the fallback in the first chunk (about
1 ms), then stream the resolved table plus a swap script when the data
arrives. What resolves `<Suspense>` in order (`index.js:563-592`; the comment
at `:563-565` says out-of-order is "a future enhancement"): the stream stops at
the boundary, never sends the fallback, and sends nothing after the boundary
(the `<footer>`) until the data has resolved and the boundary's subtree has been
rendered to one string. The "shell end" column shows this directly. Solid also
serializes the resolved rows into the page for hydration, so its async page is
about 25% bigger than React's and What's.

## Findings in what-fw's server renderer

1. **`what-framework/server` loses the Node runtime under esbuild.**
   `packages/what/src/server.js:8` re-exports `what-server`, and
   `packages/what/package.json:64` declares `"sideEffects": false`. esbuild
   0.28.2 drops the re-exporting module and its dependency edge to
   `what-server`'s Node entry, so `__installServerContextStorage(new AsyncLocalStorage())`
   (`packages/server/src/node.js:13`) never runs. Concurrent async renders then
   fall back to the module-global `_current` (`server-context.js:35`). Repro, in
   any directory where `what-framework` resolves:
   ```js
   // node -e "…" with esbuild installed
   const r = await require('esbuild').build({ stdin: { contents:
     "import { renderToString } from 'what-framework/server'; console.log(renderToString)",
     resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
   /new AsyncLocalStorage\(\)/.test(r.outputFiles[0].text)  // false; 'what-server' gives true,
                                                             // ignoreAnnotations: true gives true
   ```
2. **AsyncLocalStorage makes `renderToStream` about 60% slower on Node 22**,
   because every per-chunk promise runs the async_hooks hooks (see above).
3. **No compiled server output.** what-compiler cannot target the server, so
   the fine-grained compiled form of a component cannot be server-rendered, and
   a What app that renders on the server goes through the vnode walk measured
   here. This is the main source of the roughly 10-25x gap to Solid 2.0 in the
   smoke run.
4. **`renderToStream` emits no hydration markers** (`index.js:491-637` never
   calls `nextHydrationId` or writes `<!--$-->`), so a streamed What page cannot
   be hydrated against keys the way `renderToHydratableString` output can.
5. **In-order Suspense streaming** (`index.js:563-592`): no shell-first flush,
   no streamed fallback.
6. **Per-tag chunking** (`index.js:624`, `:635`): about 18 chunks per table row.
7. **Hot-path costs in the string renderer**: five-pass `escapeHtml`
   (`index.js:973-980`), per-element `Object.entries` + per-attribute regex and
   `toLowerCase` in `renderAttrs` (`:868-952`), per-element array + `join`
   (`:370`), a `getServerContext()` call at every recursion (`:274`), and
   double props copies in `jsx()`/`h()` (`jsx-runtime.js:13`, `h.js:40-42`).

None of these blocked the comparison: every framework renders the full,
equivalent page in every mode.
