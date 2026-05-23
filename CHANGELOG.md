# Changelog

All notable changes to What Framework will be documented in this file.

## [Unreleased]

### Added
- New MCP tool `what_record_window`: opens a sampling window and ranks
  effects by re-runs delta. Answers "which effects fired for this action?"
  Complements `what_perf` (cumulative) and `what_watch` (raw events).
- New example `examples/kanban`: multi-board kanban with HTML5 DnD,
  `what-router`, and localStorage persistence. Includes 11 store unit
  tests wired into the root test glob.

### Fixed
- `h()` stringified live DOM-node children to `"[object HTMLDivElement]"`,
  breaking wrapper components (Link, custom containers) when JSX children
  were pre-realized. `_flattenSingle`/`_flattenInto` now detect `nodeType`.
- JSX text adjacent to expressions was trimmed by the compiler, rendering
  `"5items"` instead of `"5 items"`. Added React-spec `normalizeJsxText()`
  and replaced 8 trim sites in `packages/compiler/src/babel-plugin.js`.
- `createStore` action return values were silently dropped. `const id =
  store.addItem()` produced `undefined`. Actions now propagate the result
  out of the `batch()` wrapper.

### Tests
- +5 `h-dom-children.test.js`
- +4 `jsx-whitespace.test.js`
- +3 `store-return-value.test.js`
- +5 `record-window.test.js`
- +11 `examples/kanban/test/store.test.js`

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
