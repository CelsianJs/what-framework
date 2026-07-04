# Changelog

All notable changes to What Framework will be documented in this file.

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
