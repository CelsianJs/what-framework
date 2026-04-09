# Deployment Status & Cleanup Plan

*Last updated: 2026-04-08*

## What Was Done (v0.7.0 Release)

### npm Publishing
- All 12 packages published to npm at v0.7.0
- Published in dependency order via `scripts/publish-packages.mjs`
- Granular access token with bypass-2FA required for publishing
- Token should be added as `NPM_TOKEN` GitHub repo secret for CI

### GitHub
- PR #9 merged to main (squash merge)
- GitHub release tagged `v0.7.0` with changelog
- Release URL: https://github.com/CelsianJs/what-framework/releases/tag/v0.7.0

### Vercel Deployments
- **Playground** deployed to Vercel (project: `playground-lilac-five`)
  - Current URL: https://playground-lilac-five.vercel.app
  - Target URL: https://playground.whatfw.com (CNAME added, pending Vercel domain config)
  - Deployed as non-git-based deployment (manual `vercel` CLI push)

### DNS
- CNAME record added: `playground.whatfw.com` → `cname.vercel-dns.com`
- Domain needs to be added in Vercel dashboard: https://vercel.com/matts-projects-cabbdd6c/playground-lilac-five/settings/domains

---

## Current Vercel State (Needs Cleanup)

The Vercel deployments are currently **non-git-based** (manual CLI deploys). This means:
- Deployments don't auto-trigger on push to main
- No preview deployments on PRs
- Deploy state can drift from git state

### Current deploy targets (from `scripts/deploy-vercel.mjs`)
1. `sites/benchmarks` → benchmarks.whatfw.com
2. `docs-site` → whatfw.com
3. `docs-site/docs` → whatfw.com/docs
4. `sites/react-compat` → react.whatfw.com
5. `sites/playground` → playground.whatfw.com (newly added)

### Cleanup TODO

- [ ] **Link Vercel projects to GitHub repo** — enables auto-deploy on push and PR previews
- [ ] **Consolidate Vercel projects** — check if each deploy target is a separate Vercel project or if they should be
- [ ] **Set up git-based deployments** for all 5 targets so `git push` to main auto-deploys
- [ ] **Add `VERCEL_TOKEN`** as GitHub repo secret for CI workflow deploys
- [ ] **Add `NPM_TOKEN`** (granular, bypass-2FA) as GitHub repo secret
- [ ] **Verify the `Release And Deploy` workflow** works end-to-end via GitHub Actions
- [ ] **Remove manual deployment artifacts** (`.vercel/` directories in deploy targets)
- [ ] **Set up `playground.whatfw.com`** domain in Vercel dashboard (CNAME already added)

---

## Release Process Reference

Full release process documented in:
- `docs/RELEASE.md` — CI workflow, secrets, commands
- `docs/RELEASE-CHECKLIST.md` — step-by-step checklist for version bumps, publish, deploy, verification

Quick release:
```bash
npm run release:verify && npm run release:publish && npm run deploy:vercel
```

CI release (preferred once secrets are configured):
- GitHub Actions → "Release And Deploy" → Run workflow
- Set `publish_packages: true`, `deploy_web: true`
