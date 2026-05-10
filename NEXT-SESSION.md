# What Framework — Next Session Pickup

## Current State
- **Branch**: `audit-hardening`
- **Latest verification**: `npm run -s release:verify` passed on 2026-05-10.
- **Release verify coverage**: lint, typecheck, node tests (764), devtools public API tests (11), build, packed-package smoke, benchmark gate, Playwright e2e (22), and npm audit (0 vulnerabilities).
- **Release lane**: `backport` npm dist-tag for the 0.6.x lane; do not publish these versions to npm `latest` because public latest is already `0.8.1`.

## What Was Done
- Fixed Island component reactivity bug (eager eval -> reactive function).
- Made Switch/Match reactive when conditions use signals.
- Added component tests for ErrorBoundary, Suspense, Island, and reportError.
- Added `./hooks` and `./react-compat` subpath exports with TypeScript declarations.
- Removed dead code (`depsChanged`, `__getCacheSnapshot` from public API).
- Added release preflight protection against accidentally publishing old `0.6.x` packages to `latest`.
- Split release/deploy workflow so Vercel deploy cannot mask npm publish failures.
- Added production export-condition smoke coverage for packed packages.

## What Remains

### Should Fix (fresh review)
1. **Backport package clarity**: `what-mcp` and `eslint-plugin-what` remain `0.6.0` while other backport packages are `0.6.3`. Release dry-run currently skips them as already published, but future backport notes should call out whether they are intentionally unchanged.
2. **Internal/compiler-facing symbols in public API**: `__setDevToolsHooks`, `_template`, `_$template`, `_$createComponent` are still exported from main `index.js`. Consider a separate `what-core/compiler` subpath export in a future non-backport release.
3. **`storeComputed` deprecation**: Still exported and emits console warning. Either remove in the next breaking/minor lane or document as deprecated in `.d.ts`.

### Nice to Have
- API surface is wide (154 exports) — consider which modules (skeleton, animation, data/SWR, form) could be separate packages.
- Real browser integration tests for Island hydration modes (load, idle, visible, interaction, media).

## How to Resume
```bash
cd what-fw
npm run -s release:verify
node scripts/publish-packages.mjs --dry-run --tag backport --allow-non-latest
```

## Release Gate Notes (audit-hardening)
- Do **not** publish the current package versions (`0.6.x`) to the `latest` npm dist-tag: npm `latest` is already `0.8.1` for the public packages.
- The publish script now fails preflight for local versions lower than or equal to npm `latest` when publishing `latest`.
- If this branch is intended as a backport, publish only with an explicit non-latest dist-tag and the documented safety acknowledgement, for example:
  `node scripts/publish-packages.mjs --tag backport --allow-non-latest --dry-run`
- If this sprint is intended to become the next latest release, first update every public package to a consistent version greater than npm `latest` and synchronize dependency ranges before removing `--dry-run`.

## Release Channel Follow-up (0.6.x backport)
- `docs/RELEASE.md` documents the explicit backport command: `npm run release:publish -- --tag backport --allow-non-latest --dry-run` before removing `--dry-run` for the actual publish.
- GitHub release workflow has an `allow_non_latest` input; non-`latest` `npm_tag` values require that checkbox, and `allow_non_latest` is rejected with `npm_tag=latest`.
- The docs-site landing page now points MCP setup snippets at `npx what-devtools-mcp` and labels the footer as `v0.6.3` on the `0.6-backport` channel.
- Scaffolder templates (`create-what` and `what init`) use `^0.6.3` package ranges to match this backport lane instead of stale `^0.6.0` ranges.

## 2026-05-10 — Release workflow / production-condition smoke hardening

Gold-standard/product-review refresh found release-flow blast-radius and production export-condition gaps. Addressed locally:

- `release-and-deploy.yml` now splits quality verification, npm publish, and Vercel deploy into separate jobs. Deploy waits for verify and, when requested, successful publish.
- CI package-smoke job now uploads a `package-smoke-log` artifact.
- Packed-package consumer smoke now also runs `node --conditions=production` against production export conditions for core/framework/router/server/render imports.

Verification:
- `npm run -s pack:smoke` passed.
- `npm run -s release:verify` passed: lint, typecheck, node tests (764), devtools public API tests (11), build, package smoke, benchmark gate, Playwright e2e (22), and npm audit (0 vulnerabilities).
- `node scripts/publish-packages.mjs --dry-run --tag backport --allow-non-latest` passed; 0.6.2 packages were already published; the 0.6.3 patch lane is for the registry-smoke export fix.
- `git diff --check` passed.

## 2026-05-10 — Registry smoke and handoff truth follow-up

Fresh product/gold-standard reviews found contradictory handoff state and missing post-publish registry verification. Addressed locally:

- Rewrote the current-state section to reflect the latest `release:verify` result instead of stale 552-test/devtools-failing notes.
- Added `packageManager: npm@11.0.0` to pin the toolchain used locally for this verification tranche.
- Added `scripts/smoke-registry-consumer.mjs` and `npm run registry:smoke` for post-publish registry consumer checks.
- Release workflow now runs registry smoke after non-dry-run publish and uploads `artifacts/registry-smoke.json` with `if-no-files-found: error`.

Verification:
- `node --check scripts/smoke-registry-consumer.mjs` passed
- `npm run -s release:verify` passed: lint, typecheck, node tests (764), devtools tests (11), build, packed package smoke, benchmark gate, Playwright e2e (22), npm audit (0 vulnerabilities)
- `git diff --check` passed

Not run:
- `npm run registry:smoke` is post-publish only and requires the just-published npm package set.

## 2026-05-10 — Registry smoke artifact + test-result hygiene follow-up

Fresh re-review found the new registry smoke script installed packages but did not yet write the artifact the workflow uploads, and tracked Playwright result files remained in git. Addressed locally:

- `scripts/smoke-registry-consumer.mjs` now mirrors pack smoke expectations: installs published packages, imports public APIs, runs production-condition imports, verifies CLI binaries, runs `what` and `create-what --help`, and writes `artifacts/registry-smoke.json`.
- Removed tracked Playwright/test-result artifacts from the index and extended `.gitignore` for test-result output.
- Added `scripts/check-artifact-hygiene.mjs`, `npm run hygiene:artifacts`, and wired it into `release:verify`.

Verification:
- `node --check scripts/smoke-registry-consumer.mjs` passed
- `node --check scripts/check-artifact-hygiene.mjs` passed
- `npm run -s hygiene:artifacts` passed
- `npm run -s release:verify` passed: lint, hygiene, typecheck, node tests (764), devtools tests (11), build, packed package smoke, benchmark gate, Playwright e2e (22), npm audit (0 vulnerabilities)
- `git diff --check` passed

Not run:
- `npm run registry:smoke` is post-publish only and requires the just-published npm package set.
