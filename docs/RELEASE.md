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
6. `allow_non_latest` (boolean; required with a non-`latest` `npm_tag`)

The workflow always runs `npm run -s release:verify` before publish/deploy. CI blocks non-`latest` publishes unless `allow_non_latest` is checked and `npm_tag` is set to an explicit non-`latest` channel.

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

## Release Channel Policy

This branch is a `0.6.x` hardening backport unless package metadata is intentionally bumped above the public npm `latest` version (currently `0.8.1` for the released What packages). Do **not** publish `0.6.x` package versions to the `latest` dist-tag. A `latest` release requires every public package being published to have a version greater than npm `latest`, with internal dependency ranges synchronized to that new version.

Backports must use an explicit non-`latest` dist-tag plus the safety acknowledgement flag:

```bash
npm run release:publish -- --tag 0.6-backport --allow-non-latest --dry-run
npm run release:publish -- --tag 0.6-backport --allow-non-latest
```

Keep `--dry-run` until the publish plan has been reviewed. Remove it only for the actual backport publish.

## Local Publish

Publish all non-private packages in dependency order:

```bash
npm run release:publish
```

Dry-run:

```bash
npm run release:publish -- --dry-run
```

Custom latest-compatible tag (version must still be greater than npm `latest` unless this is an acknowledged backport):

```bash
npm run release:publish -- --tag next
```

Backport tag dry-run:

```bash
npm run release:publish -- --tag 0.6-backport --allow-non-latest --dry-run
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
