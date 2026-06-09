# Deployments

How What Framework's packages and websites are built, hosted, and released. This is the
single source of truth — `docs/DEPLOYMENT-STATUS.md` (an old v0.7.0 snapshot) has been
removed in favor of this file.

## TL;DR

- **npm packages** publish from GitHub Actions (`Release And Deploy` workflow,
  manually triggered) or locally via `npm run release:*`.
- **Websites** deploy via **native Vercel ↔ GitHub integration** — each site is a Vercel
  project connected to `CelsianJs/what-framework` with a Root Directory set. A push to
  `main` auto-deploys every connected site. **No API tokens are used for site deploys.**

---

## Websites

Each row is a separate Vercel project pointing at the same GitHub repo, distinguished by
**Root Directory**. Production branch is `main`; every push to `main` triggers an automatic
production deploy (and PRs get preview deploys).

| Domain | Source (Root Directory) | Build | Output | What it is |
|---|---|---|---|---|
| **whatfw.com** | `docs-site/` | static (no build) | `.` | Marketing home + docs (static HTML, `trailingSlash: true`) |
| **whatfw.com/docs** | `docs-site/docs/` | static | `.` | Docs section (served under the same site) |
| **playground.whatfw.com** | `sites/playground/` | `npm run build` (Vite) | `dist/` | Live in-browser playground (runtime via CDN) |
| **react.whatfw.com** | `sites/react-compat/` | `npm run build` (Vite) | `dist/` | React-compat demo (`what-react`) |
| **benchmarks.whatfw.com** | `sites/benchmarks/` | static (no build) | `.` | Benchmark results (`results.json` + static page) |

**Not deployed:** `sites/showcase/` (`what-showcase`) is a **local-only** showcase — it has
only a `dev` script (`serve.js`) and is not a Vercel project. Run it locally with
`npm run dev` from that directory.

### How a site deploy happens (native integration)
1. Vercel project is connected to `CelsianJs/what-framework` (GitHub App integration).
2. Project **Settings → Root Directory** is set to the path above.
3. Production branch is `main`; build command / output dir come from each site's
   `vercel.json` (or Vercel auto-detection for the static sites).
4. `git push` to `main` → Vercel builds and deploys automatically. No secrets in CI for this
   path.

> Vite sites (`playground`, `react-compat`) **must build on Vercel** — their `dist/` is
> gitignored and not committed.

---

## npm packages

All 14 packages are published together at the same version (currently **0.10.0**). See
[`README.md`](README.md#packages) for the full package table.

### Release commands (local)
```bash
npm run release:patch   # bump patch + verify + publish
npm run release:minor
npm run release:major
# or, granularly:
npm run version:bump <patch|minor|major>
npm run release:verify   # hygiene + test + build + test:prod + bench:gate
npm run release:publish  # publish all packages in dependency order
```

### Release via CI (preferred)
GitHub Actions → **Release And Deploy** workflow (`.github/workflows/release-and-deploy.yml`),
triggered manually (`workflow_dispatch`) with inputs:
- `publish_packages` (default true) — publish to npm
- `deploy_web` (default true) — run the legacy Vercel deploy script (see below)
- `npm_tag` (default `latest`), `deploy_targets`, `dry_run`

npm auth uses the `NPM_TOKEN` repo secret. **Use a classic Automation token (no expiry)** —
granular/expiring tokens die roughly weekly and cause `404` on publish.

### Legacy token-based site deploy (`scripts/deploy-vercel.mjs`)
The workflow's `deploy_web` step runs `scripts/deploy-vercel.mjs`, which does `vercel deploy
--prod` against these targets: `sites/benchmarks`, `docs-site`, `docs-site/docs`,
`sites/react-compat`, `sites/playground`. This path **requires a `VERCEL_TOKEN`** and is the
*fallback* — the native GitHub integration above is the primary, token-free mechanism.
Prefer letting `git push` deploy the sites.

---

## Quality gates (run before any release)

`npm run release:verify` chains:
- `hygiene:publish` — publish-surface check
- `test` — full unit/integration suite + stress tests
- `build` — rebuild `dist/*.min.js` (`node scripts/build.js`)
- `test:prod` — production-conditions build check (`--conditions=production`)
- `bench:gate` — benchmark regression gate

CI also runs `ci.yml` (tests) and `benchmarks.yml` on push.

---

## Quick reference

| I want to… | Do this |
|---|---|
| Deploy a website change | `git push` to `main` (native Vercel auto-deploy) |
| Publish new package versions | GitHub Actions → Release And Deploy, or `npm run release:<level>` |
| Roll a site back | Re-deploy a previous commit from the Vercel dashboard |
| Run a site locally | `cd <site> && npm install && npm run dev` (or `npm run build && npm run preview`) |
