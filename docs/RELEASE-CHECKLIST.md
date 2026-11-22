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
- [ ] Update CHANGELOG.md with actual changes and compatibility boundaries:
      breaking changes first, each with its migration. For a release that
      moves or removes names, update docs/UPGRADING.md's hand-written parts
      and run `npm run docs:imports`.
- [ ] Run `npm run release:verify`: shared correctness checks plus blocking
      local benchmarks. A successful workspace import is not a substitute.
- [ ] Run `npm run release:publish -- --dry-run`; it must not publish or retag.
- [ ] Open a normal PR, wait for exact-head required CI checks, and merge
      through the documented review path. Never push directly to main.

The shared runner checks publish surface before and after building, tests,
type/export parity, the error catalogue and generated docs, both typechecks,
lint, consumer size budgets, production behavior, packed scaffolding and real
application browser flows. CI treats benchmark results as a separate signal;
local release verification keeps them blocking.

## Qualify the release candidate

`release:verify` runs on one Node version, inside the workspace. These checks
cover what it cannot. Record the command, the result and the machine load for
each.

- [ ] **Node versions.** Run `node scripts/run-all-tests.mjs` and
      `npm run -s test:stress` on Node 20 (the latest 20.x: `engines` is
      `>=20`, and jsdom needs 20.19 or later), 22, 24 and the current
      release. CI's test job runs the same four (`ci.yml`: 20, 22, 24, 26). A
      pass on one version says nothing about the others: a test or a shipped
      module that uses an API newer than Node 20 fails only there.
- [ ] **Real installs.** `npm run smoke:scaffold` packs every package,
      scaffolds every create-what template against the tarballs, installs,
      builds and serves each one, drives it over HTTP and in a headless
      browser when one is installed, and lints it.
      `npm run smoke:apps` builds and drives the apps under `smoke/apps`
      against the workspace build and checks their capability matrix. Both are
      in `release:verify`; a failure in either blocks the release even when
      every unit test passes. After publication,
      `npm run smoke:apps:npm -- --version=<version>` runs the same apps
      against the registry.
- [ ] **Bundlers.** From the packed tarballs, build a counter, a hydrated
      server-rendered page and a routed app with Vite (dev server and
      `vite build`), esbuild (default, `--minify`, and `--platform=node` with
      `--conditions=development` and with `--conditions=production`), Rollup
      with @rollup/plugin-node-resolve (development and production),
      webpack 5 (development and production) and Bun (default and
      `--production`). Each must run in a browser; each must resolve the tier
      its conditions select ([UPGRADING.md](UPGRADING.md#bundle-size));
      development builds must report diagnostics and production builds must
      carry none. `export-tiers.test.js`, `server-runtime-bundlers.test.js` and
      `check:size` cover part of this in the suite; the browser matrix is run
      by hand.
- [ ] **Benchmarks on a quiet machine only.** Check `uptime` before each run,
      run one benchmark at a time, and do not record a baseline or read a
      `bench:gate` result while other work loads the machine. The baselines
      store the load they were recorded under; a gate miss under load is not a
      regression until paired runs of the old and new code on a quiet machine
      show one.
- [ ] **Fresh benchmark results.** After the version bump, regenerate every
      results file from its directory, so each names the version it measured:
      `benchmark/reactivity` (`npm run bench`), `benchmark/ssr`
      (`npm run bench`, then `npm run bench:hydrate`), `benchmark/size`
      (`npm run measure`) and `benchmark/krausest` (`npm run build`, then
      `npm run bench`). Then run `npm run bench:update` for the benchmarks
      site, and commit the RESULTS.md and results.json files with the release.

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
