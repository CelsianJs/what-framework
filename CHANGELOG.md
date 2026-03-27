# Changelog

All notable changes to What Framework will be documented in this file.

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
