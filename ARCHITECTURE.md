# Architecture

A map of the repository for people (and agents) who need to change something
and want to know where it lives. It describes what is here today, not a plan.

**This document is about where the code lives.** For **how the framework
works** — the mental model, the rendering pipeline, islands, the agent surface
— see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

For how to run things, see [CONTRIBUTING.md](CONTRIBUTING.md). For what the
project is trying to be, see [VISION.md](VISION.md).

---

## The one-paragraph version

What compiles JSX into direct DOM operations and drives them with signals.
There is no virtual DOM and no diff: a compiled component runs **once**, and
the reactive graph updates the exact text node or attribute that depends on a
signal. That single decision explains most of the layout below — the compiler
exists to emit those operations, the core exists to run them, and the server
exists to produce HTML those operations can adopt instead of recreate.

---

## The 14 packages

Every package publishes independently at the same version. `what-framework` is
the umbrella most apps install.

| Package | Directory | Depends on | What it is |
|---|---|---|---|
| `what-core` | `packages/core` | nothing | Signals, effects, the DOM runtime, hooks, JSX runtimes |
| `what-compiler` | `packages/compiler` | `@babel/core`, `what-core` (peer) | JSX → DOM operations; the Vite plugin and file router |
| `what-router` | `packages/router` | `what-core` (peer) | Client routing, route matching, View Transitions |
| `what-server` | `packages/server` | `what-core`, `what-router` (peer) | SSR, islands, server actions, deploy adapters |
| `what-isr` | `packages/cache` | `what-server` (peer) | Origin-first ISR cache engine |
| `what-framework` | `packages/what` | core + router + server + compiler | Umbrella re-export |
| `what-framework-cli` | `packages/cli` | `what-framework` | `what dev`, `what build`, `what generate`, `what preview` |
| `create-what` | `packages/create-what` | nothing | `npx create-what` scaffolder |
| `what-react` | `packages/react-compat` | `what-core` (peer) | React semantics on a dedicated compat runtime |
| `what-text` | `packages/what-text` | `what-core`, `@chenglou/pretext` (peers) | Optional text engine |
| `what-devtools` | `packages/devtools` | `what-core` (peer) | Signal inspector, component tree, effect graph |
| `what-devtools-mcp` | `packages/devtools-mcp` | `what-devtools` (peer) | MCP server bridging agents to a live app |
| `eslint-plugin-what` | `packages/eslint-plugin` | `eslint` (peer) | 9 rules for the mistakes this model invites |
| `what-mcp` | `packages/mcp-server` | nothing | **Deprecated.** Docs MCP server |

Nothing in `packages/` depends on anything outside it except `@babel/core`,
`@modelcontextprotocol/sdk`, `ws`, `zod` and `eslint` — and every one of those
sits in a build-time or tooling package. **The runtime packages have zero
runtime dependencies.**

---

## what-core

`packages/core/src`, ~12.3k lines. The only package everything else assumes.

### The reactive graph — `reactive.js`

Signals are functions. `count()` reads, `count(2)` and `count.set(2)` write.
Reading inside an effect subscribes it.

The graph is **level-based**, not topologically re-sorted per flush:

- a signal is level 0
- a computed's inner effect is level 1
- an effect is `max(level of its deps) + 1`

Effects flush in level order, so a value is never recomputed from a stale
dependency and no effect runs twice for one batch. A subscriber `Set` owned by
an effect carries `_owner`; a signal's own subscriber Set deliberately does
not, and `_owner === undefined` is what marks level 0. That invariant is load
bearing — see the comment at `reactive.js:50` before touching it.

`__devtools` is a hook surface with three lifetimes: `null` in production, a
buffering placeholder in dev before install, and the real hooks after
`__setDevToolsHooks()`. Every hook call is optional (`?.()`) because the
function is public and a partial object is a legitimate thing to install.

### The DOM runtime — `dom.js`, `render.js`

`render.js` holds the primitives compiled output calls: `_$template`,
`insert`, `spread`, `setProp`/`setClass`/`setStyle`/`setAttr`, `memo`,
`delegateEvents`, `mapArray`. `dom.js` holds the parts that are not compiled —
`mount`, `createDOM`, boundaries, portals.

Boundaries (error, suspense, portal) are delimited by **comment markers**
rather than wrapper elements, so nothing appears in the DOM that a CSS
selector or a screen reader would trip over. Range disposal walks between the
markers.

### Components run once

A component function body executes a single time. Props are read through a
reactive proxy, so `props.label` tracks and `const { label } = props` does not.
That is the single most common mistake this model invites, which is why it has
an ESLint rule, an MCP analysis rule, and a catalogue entry
(`ERR_DESTRUCTURED_PROPS`) all pointing at it.

### The rest of core

| File | Role |
|---|---|
| `h.js` | Element descriptors for uncompiled use |
| `hooks.js` | `useState`, `useContext`, `useReducer`, and friends — all returning accessors |
| `store.js`, `data.js` | Reactive stores; `useQuery`/`useMutation` |
| `scheduler.js` | Read/write batching against the frame |
| `head.js` | Deduplicated `<head>` management, server and client |
| `server-context.js` | Render-scoped context; the SSR keystone |
| `hydration-data.js` | Reads the single server payload script |
| `errors.js` | The error-code catalogue (see below) |
| `warnings.js`, `guardrails.js` | Dev-mode checks |
| `a11y.js`, `animation.js`, `form.js`, `skeleton.js` | Standalone utilities |
| `testing.js` | `render`, `act`, `trackSignals`, query helpers |
| `jsx-runtime.js`, `jsx-dev-runtime.js` | The automatic JSX runtimes |

---

## what-compiler

`packages/compiler/src`, ~4.8k lines.

```
JSX source
  └─ babel-plugin.js      static shape  →  _$template('<div>...</div>')
                          dynamic bits  →  _$insert(el, () => expr, marker)
                          attributes    →  setClass / setAttr / setProp
                          components    →  _$createComponent(Comp, props)
                          events        →  $$click prop + delegateEvents(['click'])
  └─ vite-plugin.js       wires the transform, HMR, the error overlay,
                          and the server-action id registry
  └─ file-router.js       pages/ directory → route table
  └─ runtime.js           the helpers compiled output imports
```

Two details worth knowing before editing `babel-plugin.js`:

- `For`, `Show`, `Switch` and `Match` are **lowered**, not called. They are in
  `LOWERED_TAGS`; the plugin rewrites them into runtime calls, so they are
  globals from ESLint's point of view rather than imports.
- Markers for dynamic children are **pre-captured** in one left-to-right walk
  when two or more children need a DOM reference. Walking
  `el.firstChild.nextSibling…` from the root per child was the dominant
  quadratic in both compile time and emitted bundle size.

Uncompiled `h()` still works. The compiler is an optimization, not a
requirement.

---

## what-server

`packages/server/src`, ~3.2k lines.

```
request
  └─ adapter/{node,cloudflare,vercel,static}.js   runtime entry
       └─ adapter/core.js                          shared request pipeline
            ├─ action-handler.js   POST /__what_action, body caps, CSRF
            ├─ index.js            renderToString → renderDocument
            │    ├─ server-context (head sink, loader data, resources)
            │    ├─ islands.js     island stores + hydration markers
            │    └─ serialize.js   one <script id="__what_data"> payload
            └─ revalidation-registry.js  → what-isr, when installed
```

`renderDocument` emits exactly one JSON payload script. The client reads it
through `hydration-data.js`, so there is one serialization format rather than
per-island blobs.

Server actions get a stable id from the compiler (file path + export name).
`<Form action={fn}>` posts to that id and works with JavaScript disabled —
that path is covered end to end in `smoke/`.

---

## what-isr

`packages/cache/src`, ~1.2k lines. Deliberately **standalone**: it never
imports what-server, which is what keeps it usable from any adapter. The
render function is injected.

Stale-while-revalidate with in-flight deduplication, a `vary` model that
refuses to build a key it cannot resolve rather than guessing, pluggable
stores (memory, filesystem, Redis-shaped injected client) and optional CDN
fan-out (Cloudflare, Fastly, Vercel).

---

## Errors

`packages/core/src/errors.js` is the single catalogue: 30 codes, each with a
severity, a suggestion and a worked bad/good example. The `what_errors` MCP
tool reads it, so the audience is usually an agent.

**A throw carries only its `code`.** The suggestion and the example live once,
in the catalogue, and `classifyError(err)` resolves them. That is a size
decision: importing `createWhatError()` into what-server's client-shipped
action surface retains the whole catalogue through the bundler and cost 6 KB
gzipped. It is also the only rule that works for the packages which cannot
import core at all — what-isr, the compiler, the MCP server, the CLI.

`scripts/check-error-codes.mjs` asserts every `ERR_*` literal under
`packages/*/src` is catalogued.

---

## Agent surface

This is the part of the repo that exists because of the "built for AI agents"
positioning, and it is real code rather than a claim:

- **`what-devtools`** registers signals, effects and components, and exposes
  them on `window.__WHAT_DEVTOOLS__`.
- **`what-devtools-mcp`** bridges that over a WebSocket to an MCP server, so
  an agent can read live app state, not just source. `bridge.js` is the
  socket, `client*.js` is the in-page half, `tools*.js` are the MCP tools.
- **`eslint-plugin-what`** encodes nine rules for the mistakes this model
  invites — uncalled signals, writes inside computeds, camelCase events,
  destructured props.
- **`errors.js`** makes every failure machine-readable.

---

## Build and gates

`scripts/build.js` is the build config: esbuild, per-package entry lists, code
splitting for core so shared internals become one chunk. Six packages produce
`dist/`; the rest ship source.

The gates, all runnable locally and all run in CI:

| Command | What it protects |
|---|---|
| `npm run lint` | The framework passes its own ESLint rules |
| `npm run typecheck` | The hand-written `.d.ts` files compile |
| `npm run typecheck:src` | `allowJs` + `checkJs` over all 106 implementation files |
| `npm run hygiene:types` | Declarations and runtime exports match, both directions |
| `npm run hygiene:publish` | Export maps resolve, tarballs are complete, packed types typecheck in a clean consumer |
| `npm run check:error-codes` | Every thrown `ERR_*` is catalogued |
| `npm run check:size` | Bundle budgets in `.size-budgets.json` |
| `npm test` | 173 test files, Node's built-in runner |
| `npm run test:stress` | `stress-tests/`, adversarial cases |
| `npm run test:prod` | The production build is not a blank screen |
| `npm run bench:gate` | Performance has not regressed |
| `npm run smoke:scaffold` | `create-what` produces something that runs |
| `npm run smoke:apps` | Four real apps in a real browser, 84 checks |

`npm run release:verify` runs all of them in order.

`smoke:apps:npm` is the same browser suite pointed at the **published**
packages instead of the workspace. It is the only gate that catches a
packaging defect, so run it after every publish.

---

## Repository layout

```
packages/     the 14 published packages
scripts/      build, gates, release, codemods
smoke/        real apps exercised in a real browser
stress-tests/ adversarial cases outside the unit suite
benchmark/    cross-framework harness + krausest
examples/     example apps
docs/         reference docs
docs-site/    whatfw.com
sites/        the other public sites
types/        internal-only .d.ts, used by typecheck:src, never published
```

---

## CI

**`.depot/workflows/` is authoritative.** CI has run on Depot since
2026-07-11.

`.github/workflows/` holds a copy of each workflow with the triggers reduced to
`workflow_dispatch`, kept as a manual fallback if Depot is unavailable. They
are not automatic, and they will drift: **change the Depot copy first, then
mirror it.**
