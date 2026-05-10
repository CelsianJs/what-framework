# What Framework — Next Session Pickup

## Current State
- **Branch**: `audit-hardening`
- **Tests**: 552 passing (node:test, NOT vitest)
- **PM Score**: 7.5/10 (est. 8+ after latest fixes)
- **Test runner**: `node --test 'packages/core/test/*.test.js'`

## What Was Done
- Fixed Island component reactivity bug (eager eval -> reactive function)
- Made Switch/Match reactive when conditions use signals
- Added 30 component tests (ErrorBoundary, Suspense, Island, reportError)
- Added ./hooks and ./react-compat subpath exports with TypeScript declarations
- Removed dead code (depsChanged, __getCacheSnapshot from public API)
- npm audit: 0 vulnerabilities

## What Remains

### Should Fix (from PM Review #3)
1. **Devtools browser tests (9/9 failing)**: Playwright-based tests in `packages/devtools/test/devtools.test.js` all timeout or get connection refused. The Vite dev server spawns but the fixture app never renders. Has been broken across 3 reviews. These are infra-dependent (need running browser+server), not code bugs.

2. **Internal symbols in public API**: `__setDevToolsHooks`, `_template`, `_$template`, `_$createComponent` are exported from main `index.js`. The latter three are compiler output targets. Consider a separate `what-core/compiler` subpath export.

3. **`storeComputed` deprecation**: Still exported and emits console warning. Either remove entirely or document as deprecated in `.d.ts`.

### Nice to Have
- API surface is wide (154 exports) — consider which modules (skeleton, animation, data/SWR, form) could be separate packages
- Verify `what-framework` package version ranges stay synchronized with workspace packages
- Real browser integration tests for Island hydration modes (load, idle, visible, interaction, media)

## How to Resume
```bash
cd what-fw
node --test 'packages/core/test/*.test.js'   # 552 tests, all should pass
# Do NOT use npx vitest — that picks up Playwright specs and fails
```

## Release Gate Notes (audit-hardening)
- Do **not** publish the current package versions (`0.6.x`) to the `latest` npm dist-tag: npm `latest` is already `0.8.1` for the public packages.
- The publish script now fails preflight for local versions lower than or equal to npm `latest` when publishing `latest`.
- If this branch is intended as a backport, publish only with an explicit non-latest dist-tag and the documented safety acknowledgement, for example:
  `node scripts/publish-packages.mjs --tag 0.6-backport --allow-non-latest --dry-run`
- If this sprint is intended to become the next latest release, first update every public package to a consistent version greater than npm `latest` and synchronize dependency ranges before removing `--dry-run`.

## Release Channel Follow-up (0.6.x backport)
- `docs/RELEASE.md` documents the explicit backport command: `npm run release:publish -- --tag 0.6-backport --allow-non-latest --dry-run` before removing `--dry-run` for the actual publish.
- GitHub release workflow has an `allow_non_latest` input; non-`latest` `npm_tag` values require that checkbox, and `allow_non_latest` is rejected with `npm_tag=latest`.
- The docs-site landing page now points MCP setup snippets at `npx what-devtools-mcp` and labels the footer as `v0.6.2` on the `0.6-backport` channel.
- Scaffolder templates (`create-what` and `what init`) use `^0.6.2` package ranges to match this backport lane instead of stale `^0.6.0` ranges.

## 2026-05-10 — Release workflow / production-condition smoke hardening

Gold-standard/product-review refresh found release-flow blast-radius and production export-condition gaps. Addressed locally:

- `release-and-deploy.yml` now splits quality verification, npm publish, and Vercel deploy into separate jobs. Deploy waits for verify and, when requested, successful publish.
- CI package-smoke job now uploads a `package-smoke-log` artifact.
- Packed-package consumer smoke now also runs `node --conditions=production` against production export conditions for core/framework/router/server/render imports.

Verification:
- `npm run -s pack:smoke` passed.
- `npm run -s release:verify` passed: lint, typecheck, node tests (764), devtools public API tests (11), build, package smoke, benchmark gate, Playwright e2e (22), and npm audit (0 vulnerabilities).
- `node scripts/publish-packages.mjs --dry-run --tag backport --allow-non-latest` passed; all 12 backport packages were already published, 0 failures.
- `git diff --check` passed.
