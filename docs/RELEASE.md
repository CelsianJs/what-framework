# Release Guide

This document is the source of truth for publishing What Framework packages and deploying web surfaces.

## CI Workflow

Canonical workflow:

- `/.github/workflows/release-and-deploy.yml`

Manual trigger inputs:

1. `publish_packages` (boolean)
2. `deploy_web` (boolean)
3. `deploy_targets` (optional comma-separated override)
4. `npm_tag` (default `latest`)
5. `dry_run` (boolean)

The workflow always runs `npm run -s release:verify` before publish/deploy.
When packages are published, it also runs `npm run -s verify:registry` and uploads
`artifacts/registry-smoke.json`. A release is not complete until this registry
smoke passes against npm.

## Required Secrets

Set these repository secrets in GitHub:

1. `NPM_TOKEN` (npm publish token with package publish permissions)
2. `VERCEL_TOKEN` (Vercel token with access to linked projects)

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
