# What Framework Release Checklist

Use this checklist with [RELEASE.md](RELEASE.md) and the authoritative hosting
map in [DEPLOYMENTS.md](../DEPLOYMENTS.md). Source merging, npm publication and
website deployment are distinct proofs; do not mark one complete from another.

## Prepare a reviewed release

- [ ] Use Node 24 LTS and a clean, scoped release branch; preserve unrelated work.
- [ ] Add behavioral regressions that fail on the old implementation.
- [ ] Review the change independently and record known verification limits.
- [ ] Run `npm run version:bump patch` (or the explicitly intended version).
- [ ] Inspect resulting manifest, dependency, lockfile and site-pin changes.
- [ ] Maintain the 13-package cohort: `what-core`, `what-text`, `what-router`,
      `what-server`, `what-isr`, `what-compiler`, `what-devtools`,
      `what-devtools-mcp`, `eslint-plugin-what`, `what-react`, `what-framework`,
      `what-framework-cli`, and `create-what`.
- [ ] Leave deprecated `what-mcp` frozen at 0.12.4; do not republish or retag it.
- [ ] Update CHANGELOG.md with actual changes and compatibility boundaries.
- [ ] Run `npm run release:verify`: shared correctness checks plus blocking
      local benchmarks. A successful workspace import is not a substitute.
- [ ] Run `npm run release:publish -- --dry-run`; it must not publish or retag.
- [ ] Open a normal PR, wait for exact-head required Depot checks, and merge
      through the documented review path. Never push directly to main.

The shared runner checks publish surface before and after building, tests,
type/export parity, the error catalogue and generated docs, both typechecks,
lint, consumer size budgets, production behavior, packed scaffolding and real
application browser flows. CI treats benchmark results as a separate signal;
local release verification keeps them blocking.

## Publish from GitHub Actions

- [ ] Dispatch `release-and-deploy.yml` from `main`, using only its actual
      inputs: `publish_packages`, `npm_tag`, and `dry_run`.
- [ ] Use the existing scoped NPM_TOKEN secret; never print its value.
- [ ] Confirm the main-ref guard, auth preflight and shared correctness runner
      pass before publication.
- [ ] Confirm publication/provenance and the post-publish registry smoke pass.
- [ ] Verify every maintained package's exact version AND requested dist-tag.
- [ ] For a custom tag, check it explicitly, for example
      `WHAT_REGISTRY_TAG=next npm run verify:registry`.
- [ ] Check the registry artifact and published-package application smoke,
      not just the workspace suite.
- [ ] Create or update the GitHub release from the verified release commit.

The publisher uses dependency order, then reconciles requested tags only after
missing cohort versions have published. Tag writes are not atomic. If a write
fails, inspect the recorded failure and rerun to reconcile remaining members;
do not assume a skipped existing version already has the requested tag.

## Verify websites separately

- [ ] Keep native GitHub-to-Vercel integration for the marketing domains.
      The npm workflow has no `deploy_web` input or automatic Vercel CLI step.
- [ ] Confirm each production deployment is READY on the intended main SHA.
- [ ] Check whatfw.com/docs, playground.whatfw.com, react.whatfw.com, and
      benchmarks.whatfw.com with meaningful page/asset or browser checks.
- [ ] Check the built version badge and docs imports after the version bump;
      the build derives shared layout metadata, so do not hand-rewrite every HTML file.
- [ ] Run docs-site template tests and public smoke if starter metadata changed.

Sites can start building before a new npm version is available. Existing
ETARGET-only install retries cover a short publication delay; if they exhaust,
verify the failed deployment and redeploy after npm publication. Do not report
the websites shipped merely because the package release succeeded.
