# Release Guide

This document is the source of truth for publishing What Framework packages and deploying web surfaces.

## CI Workflow

Canonical workflow:

- `/.github/workflows/release-and-deploy.yml`

Manual trigger inputs:

1. `publish_packages` (boolean)
2. `npm_tag` (default `latest`)
3. `dry_run` (boolean)

Web surfaces (docs-site, benchmarks, playground, react-compat) deploy through
Vercel's Git integration on push. There is no CI deploy step, and no
`VERCEL_TOKEN` in this repo. `scripts/deploy-vercel.mjs` remains available for
local, token-in-hand deploys.

**The site builds race the publish, by design of that ordering.** `docs-site`,
`sites/react-compat` and `sites/playground` pin an exact `what-*` version.
Vercel starts building the moment the version-bump commit lands on `main`,
which is before anyone dispatches this workflow and before anything is on npm,
so `npm install` fails with `ETARGET` and those three checks go red on a commit
that is perfectly fine. Every release did this.

Their `vercel.json` now retries the install, and **only** on `ETARGET`: ten
attempts, twenty seconds apart, so a build that starts inside that window heals
itself. Any other install failure exits immediately, so a genuinely broken build
still fails in seconds.

If you edit that `installCommand`, keep it under **256 characters**. Vercel
validates the `vercel.json` schema before it builds anything, and a longer value
fails the deployment instantly with `installCommand should NOT be longer than
256 characters`, which looks nothing like a build error and produces a zero-second
build.

That covers a prompt release. If the gap between merging the bump and
dispatching the workflow is longer than a few minutes, those three builds still
fail and need a redeploy after publish, from the Vercel dashboard or with
`npm run deploy:vercel`. The lasting fix is to dispatch the release promptly
after the bump lands.

The workflow always runs every correctness gate from `release:verify` before
publish/deploy, except `bench:gate`, which runs as a separate non-blocking step
because the perf baselines are recorded on local hardware. Run
`npm run -s release:verify` locally to get the blocking perf gate.
When packages are published, it also runs `npm run -s verify:registry` and uploads
`artifacts/registry-smoke.json`. A release is not complete until this registry
smoke passes against npm.

## Required Secrets

Set these repository secrets in GitHub:

1. `NPM_TOKEN` (npm publish token with package publish permissions)

## Local Verification

Run full release gates locally:

```bash
npm ci
npm run release:verify
```

After packages are published, verify npm has the expected public package set:

```bash
npm run verify:registry
```

## Publish

Preferred path: trigger the GitHub `Release And Deploy` workflow from `main`.
It uses the repository `NPM_TOKEN`, publishes in dependency order, then runs the
registry smoke.

Local publish is emergency-only. If needed, publish all non-private packages in
dependency order:

```bash
npm run release:publish
```

Dry-run:

```bash
npm run release:publish -- --dry-run
```

Custom tag:

```bash
npm run release:publish -- --tag next
```

## Local Deploy (Vercel)

Deploy defaults:

```bash
npm run deploy:vercel
```

Dry-run:

```bash
npm run deploy:vercel -- --dry-run
```

Override targets:

```bash
npm run deploy:vercel -- --targets "sites/benchmarks,docs-site"
```

Current default targets in `scripts/deploy-vercel.mjs`:

1. `sites/benchmarks`
2. `docs-site`
3. `docs-site/docs`
4. `sites/react-compat`

See also: `docs/RELEASE-CHECKLIST.md` for the full post-release verification checklist.
