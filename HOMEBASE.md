# What Framework — Homebase Reference

> The single source of truth for the What Framework ecosystem.
> Agents: read this first before starting any work.

## The Three Frameworks

| Framework | Role | Repo | Packages | Site |
|-----------|------|------|----------|------|
| **What** | Frontend (signals, reactivity, components) | `zvndev/what-fw` | `what-core`, `what-framework`, `what-router`, `what-server`, `what-compiler` | whatframework.dev |
| **CelsianJS** | Backend (server, RPC, caching, tasks) | `CelsianJs/*` | `@celsian/server`, `@celsian/rpc`, `@celsian/cache`, `@celsian/schema`, `@celsian/adapter-*` | — |
| **ThenJS** | Meta-framework (What + CelsianJS = Next.js) | lives in `thenjs/` within what-fw | `thenjs`, `@thenjs/build`, `create-then` | thenjs.dev |

---

## Repository Map

```
what-fw/
├── packages/              # Core framework packages (npm workspaces)
│   ├── core/              # what-core — signals, effects, components, hooks, store
│   ├── router/            # what-router — file-based + programmatic routing
│   ├── server/            # what-server — SSR, islands, static generation
│   ├── compiler/          # what-compiler — Babel plugin + Vite plugin + file router
│   ├── what/              # what-framework — meta-package re-exporting all above
│   ├── cli/               # what-framework-cli — dev/build/preview commands
│   ├── create-what/       # create-what — project scaffolder (npx create-what)
│   ├── eslint-plugin/     # eslint-plugin-what — 5 lint rules for signal bugs
│   ├── devtools/          # what-devtools — signal inspector + DevPanel component
│   └── mcp-server/        # what-mcp — MCP server for Claude integration
│
├── demo/                  # Demo app (port 3000) — 5 pages showcasing features
├── sites/
│   ├── showcase/          # Flux dashboard (port 3001) — full production demo
│   └── benchmarks/        # Browser benchmark visualization (Vercel)
│
├── docs/                  # Markdown docs (API, Architecture, Gotchas, TypeScript, etc.)
├── docs-site/             # Landing page + docs (whatframework.dev, Vercel)
│
├── benchmark/             # Performance test suite (Node.js, no browser)
├── scripts/               # Build, deploy, publish, codemods
│
├── examples/              # Example apps (7 apps, npm-based)
├── training-builds/       # 8 training apps with best-practice docs
│
├── thenjs/                # ThenJS meta-framework
│   ├── packages/          # thenjs, @thenjs/build, create-then, server, rpc
│   ├── vscode-extension/  # VS Code extension (syntax + snippets)
│   └── docs-site/         # ThenJS docs (Astro/Starlight, thenjs.dev)
│
└── .vscode/               # Workspace settings + extension recommendations
```

---

## Packages — What Framework

All packages at **version 0.5.2**. Published to npm under their package names.

| Package | npm name | Purpose | Key exports |
|---------|----------|---------|-------------|
| **Core** | `what-core` | Signals, effects, hooks, components, store, rendering | `signal`, `computed`, `effect`, `h`, `mount`, `useSignal`, `createStore`, `For`, `Show`, `ErrorBoundary` |
| **Router** | `what-router` | Client-side routing with View Transitions | `Router`, `Route`, `Link`, `navigate`, `useRoute` |
| **Server** | `what-server` | SSR, islands architecture, static generation | `renderToString`, `Island`, `hydrate` |
| **Compiler** | `what-compiler` | JSX transform (Babel plugin + Vite plugin) | `whatBabelPlugin`, `whatVitePlugin`, `generateRoutesModule` |
| **Framework** | `what-framework` | Meta-package bundling core+router+server+compiler | Re-exports everything |
| **CLI** | `what-framework-cli` | `what` command for dev/build/preview | CLI binary |
| **Scaffolder** | `create-what` | `npx create-what my-app` | CLI binary |
| **ESLint** | `eslint-plugin-what` | 5 lint rules for signal bugs | `configs.recommended`, `configs.strict`, `configs.compiler` |
| **DevTools** | `what-devtools` | Signal inspector + floating DevPanel | `installDevTools`, `DevPanel` |
| **MCP** | `what-mcp` | MCP server for Claude | CLI binary |

### ESLint Rules

| Rule | Default | What it catches |
|------|---------|-----------------|
| `what/no-signal-in-effect-deps` | warn | Signal getters in `useEffect` deps (infinite re-runs) |
| `what/reactive-jsx-children` | warn | Bare `{count()}` in JSX without compiler |
| `what/no-signal-write-in-render` | warn | Signal writes outside event handlers/effects |
| `what/no-camelcase-events` | warn | `onClick` without compiler (fixable) |
| `what/prefer-set` | off | Suggests `sig.set(v)` over `sig(v)` (fixable) |

---

## Packages — ThenJS

| Package | npm name | Purpose |
|---------|----------|---------|
| **ThenJS** | `thenjs` | CLI for dev/build/preview |
| **Build** | `@thenjs/build` | Vite plugin, file-based routing, page scanning |
| **Scaffolder** | `create-then` | `npx create-then my-app` |
| **Server** | `@thenjs/server` | Server runtime (wraps CelsianJS) |
| **RPC** | `@thenjs/rpc` | Type-safe RPC layer |

---

## Apps & Sites

### Demo App — `demo/`
- **Port**: 3000
- **Run**: `npm run demo` (from root)
- **Pages**: Home, Demos, Islands, Benchmarks, Docs
- **Purpose**: Live development showcase using local framework source
- **Server**: Custom Node.js dev server (`demo/serve.js`) with import transforms

### Showcase App (Flux) — `sites/showcase/`
- **Port**: 3001
- **Run**: `cd sites/showcase && npm run dev`
- **Pages**: Dashboard, Projects, Team, Settings
- **Purpose**: Production-grade project management dashboard demo

### Docs Site — `docs-site/`
- **URL**: whatframework.dev
- **Deploy**: Vercel (ZVN DEV team)
- **Build**: Static HTML (no build step)
- **Run locally**: Just open `docs-site/index.html`

### ThenJS Docs — `thenjs/docs-site/`
- **URL**: thenjs.dev
- **Deploy**: Vercel
- **Build**: Astro + Starlight
- **Run locally**: `cd thenjs/docs-site && npm run dev`

### Benchmark Site — `sites/benchmarks/`
- **URL**: Deployed to Vercel
- **Build**: Static HTML
- **Purpose**: Browser-based benchmark visualization

### VSCode Extension — `thenjs/vscode-extension/`
- **Marketplace ID**: `zvndev.thenjs`
- **Features**: Syntax highlighting (event modifiers, bindings, directives), 18+ snippets
- **Publish**: `cd thenjs/vscode-extension && npx @vscode/vsce package`

---

## Examples

| Directory | Purpose | Uses npm? |
|-----------|---------|-----------|
| `examples/what-starter` | Starter template | Yes (v0.5.2) |
| `examples/starter-app` | Dev server example | Local workspace |
| `examples/local-loop-validation` | Form validation | Vite |
| `examples/npm-eight-pages-review` | 8-page app review | Yes (v0.5.2) |
| `examples/npm-app-suite/` | 8 focused apps | Yes (v0.5.2) |
| `examples/task-manager` | Todo/task management | Vite |
| `examples/dx-test` | DX testing | Vite |

### Training Builds — `training-builds/`

8 production-ready examples with best-practice documentation:

| # | App | Demonstrates |
|---|-----|-------------|
| 01 | Expense Tracker | Stores, derived state, forms |
| 02 | Markdown Notes | Computed signals, localStorage |
| 03 | Animated Dashboard | Animations, data visualization |
| 04 | Accessible Modals | Focus management, FocusTrap, a11y |
| 05 | Data Table | Large lists, sorting, filtering |
| 06 | Form Wizard | Multi-step forms, validation |
| 07 | Kanban Board | Drag-drop, complex state |
| 08 | Theme Playground | CSS variables, theming |

Key docs: `training-builds/FINAL_REPORT.md` (canonical patterns), `CLEANUP_STATUS.md` (resolved issues).

---

## Benchmarking

### Node.js Benchmarks — `benchmark/`

Three benchmark scripts:

```bash
npm run bench          # Full suite (signals, computed, effects, batch, VNode, SSR)
npm run bench:dx       # DX-specific (event normalization, innerHTML, form errors)
npm run bench:gate     # Regression gate — compares vs baseline, fails if >20% slower
```

**How it works:**
1. `benchmark/run.js` — Runs 10K+ iterations per test, measures ops/sec, avg, p50, p99
2. `benchmark/dx-microbench.js` — DOM-based tests using JSDOM
3. `benchmark/check-regressions.js` — Loads baseline from `benchmark/baseline/*.json`, runs current, compares
4. Tolerance: `WHAT_BENCH_TOLERANCE_CORE=0.2` (20%), `WHAT_BENCH_TOLERANCE_DX=0.25` (25%)

**Baselines** live in `benchmark/baseline/core.json` and `benchmark/baseline/dx.json`.

**Output**: Console formatted table + optional `--json <path>` for CI.

### Release Verification

```bash
npm run release:verify   # test → build → bench:gate (all three must pass)
```

This is the gate before `npm run release:publish`.

### Browser Benchmarks — `sites/benchmarks/`

Static HTML page deployed to Vercel. Runs benchmarks in the browser for real-world perf measurement.

---

## Deployment

### Vercel (ZVN DEV team — Pro workspace)

| Site | Directory | URL |
|------|-----------|-----|
| What Framework Landing | `docs-site/` | whatframework.dev |
| Benchmark Visualization | `sites/benchmarks/` | (Vercel subdomain) |
| ThenJS Docs | `thenjs/docs-site/` | thenjs.dev |

**Deploy command**: `npm run deploy:vercel`
**Script**: `scripts/deploy-vercel.mjs` (uses Vercel CLI, needs `VERCEL_TOKEN` or local login)

### npm

**Publish command**: `npm run release:publish`
**Script**: `scripts/publish-packages.mjs`
**Published packages**: what-core, what-framework, what-router, what-server, what-compiler, what-framework-cli, create-what

**Not yet published**: eslint-plugin-what, what-devtools, what-mcp

---

## Scripts Reference

| Command | Script | Purpose |
|---------|--------|---------|
| `npm run build` | `scripts/build.js` | Minify all packages → `dist/` (~4kB gzipped core) |
| `npm run test` | Node.js `--test` | Run core + router + compiler tests |
| `npm run bench` | `benchmark/run.js` | Full benchmark suite |
| `npm run bench:gate` | `benchmark/check-regressions.js` | Regression check vs baseline |
| `npm run demo` | `demo/serve.js` | Start demo app (port 3000) |
| `npm run deploy:vercel` | `scripts/deploy-vercel.mjs` | Deploy to Vercel |
| `npm run release:verify` | test + build + bench:gate | Pre-publish checks |
| `npm run release:publish` | `scripts/publish-packages.mjs` | Publish to npm |
| `npm run codemod:show` | `scripts/codemods/show-to-ternary.js` | Migrate `show()` → ternaries |

---

## Key Architecture Decisions

- **Fine-grained reactivity**: Signals auto-track in effects. No VDOM diffing.
- **Compiler-first**: JSX → `template()` + `insert()` + `effect()`. Static HTML extracted to templates, dynamics in targeted effects.
- **Unified signal API**: `sig()` reads, `sig(val)` writes, `sig.set(val)` explicit write, `sig.peek()` untracked read.
- **Event handlers**: Always lowercase at runtime (`onclick`). Compiler normalizes `onClick` → `onclick`.
- **Effects flush async**: Via `queueMicrotask`, not synchronous. Use `flushSync()` sparingly.
- **Custom element wrapper**: `<what-c display:contents>` for component boundaries.
- **Islands architecture**: Zero JS by default, hydrate components on demand with `client:load/idle/visible`.

---

## GitHub & npm Metadata

All What Framework packages point to:
- **Repository**: `https://github.com/zvndev/what-fw`
- **Bugs**: `https://github.com/zvndev/what-fw/issues`
- **Homepage**: `https://whatframework.dev`

All ThenJS packages point to:
- **Repository**: `https://github.com/zvndev/thenjs`
- **Bugs**: `https://github.com/zvndev/thenjs/issues`
- **Homepage**: `https://thenjs.dev`

---

## TODO — What Needs Updating

Track these items when starting a new session:

### Unpublished Packages
- [ ] `eslint-plugin-what` — needs npm publish
- [ ] `what-devtools` — needs npm publish
- [ ] VSCode extension — needs `vsce publish` to marketplace

### Docs & Sites
- [ ] docs-site (whatframework.dev) — add ESLint, DevTools, TypeScript sections
- [ ] ThenJS docs (thenjs.dev) — update CelsianJS backend references
- [ ] README.md — add badges for new packages (eslint-plugin, devtools)

### Testing
- [ ] ESLint plugin — add integration tests against real What Framework code
- [ ] DevTools — add tests for signal registration/disposal
- [ ] Error overlay — add visual test in demo app

### DevTools Phase 2
- [ ] Chrome extension with dedicated DevTools panel
- [ ] Signal dependency graph visualization
- [ ] Time-travel debugging (signal value history)

### Ecosystem
- [ ] Update all example apps to use eslint-plugin-what
- [ ] Add DevPanel to demo app for showcase
- [ ] Benchmark: add npm-pull test that installs from registry and benchmarks

### Release Checklist (for next version bump)
1. `npm run release:verify` (test + build + bench:gate)
2. Bump versions in all package.json files
3. `npm run release:publish`
4. `npm run deploy:vercel`
5. Update benchmark baselines if performance improved
6. Publish VSCode extension (`vsce publish`)
7. Publish new packages (eslint-plugin, devtools)

---

*Last updated: February 17, 2026*
*Current version: 0.5.2*
*Branch: main (claude/vanilla-js-framework-mDooB)*
