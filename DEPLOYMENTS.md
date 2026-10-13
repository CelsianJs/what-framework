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

## Websites — authoritative map (every marketing domain we own)

**This table is the single source of truth. Never guess where a site deploys — look here.**

All sites are **separate Vercel projects** on the **`zvn-dev` team** (`team_zCLdY1qPIO8Foz3XjEbNkGBg`),
each connected to the **same** GitHub repo `CelsianJs/what-framework` via the native GitHub App
integration and distinguished by **Root Directory**. Production branch is `main`: **every push to
`main` auto-deploys all of them** (PRs get preview deploys). No tokens involved in this path.

| Domain | Vercel project (name · ID) | Root Directory | Build → Output | `vercel.json` | Verify live |
|---|---|---|---|---|---|
| **whatfw.com** (+ `/docs`) | `docs-site` · `prj_ep4dUv055n8Jkd5S6Yv4xF7KLvjw` | `docs-site/` | `npm run build` → `dist/` (`trailingSlash`) | `docs-site/vercel.json` | `curl -s https://whatfw.com \| grep what-devtools-mcp` |
| **react.whatfw.com** | `react-compat` · `prj_xg7dy7zvoDxBPTdPOMSG9JlGQ86B` | `sites/react-compat/` | `npm run build` (Vite) → `dist/` | `sites/react-compat/vercel.json` | SPA — browser-check the `<h1>` ("Most React Libraries.") |
| **playground.whatfw.com** | `playground` · `prj_oWjJlPUmtjMGV8SeZpsBNV40sGsl` | `sites/playground/` | `npm run build` (Vite) → `dist/` | `sites/playground/vercel.json` | `curl -sI https://playground.whatfw.com` → 200 |
| **benchmarks.whatfw.com** | `benchmarks` · `prj_hGXzCgoZW4eY5NtyB0AWSjjGNVxC` | `sites/benchmarks/` | static (no build) → `.` | none (auto-detect) | `curl -s https://benchmarks.whatfw.com/results.json` |

Notes:
- **whatfw.com is NOT a no-build static site anymore.** Since the docs-site→What SSG rebuild it
  builds via `npm run build` → `dist/` (was previously raw static HTML; update any old notes that
  still say "static/no build").
- `/docs` is served by the **same** `docs-site` project (a subpath, not its own project).
- The repo-root `.vercel/project.json` points at a legacy **`what-fw`** project
  (`prj_B08UghZUQ0FVwvezeWd45CL6knyk`) that is **not** a marketing domain — ignore it.
- **Not deployed:** `sites/showcase/` (`what-showcase`) is local-only (`serve.js`, no Vercel project).

### Cached project links (so `vercel`/MCP calls don't guess)
Each site dir has a committed `.vercel/project.json` with its `projectId` + `orgId`. The
`react-compat` / `playground` `dist/` are gitignored and **must build on Vercel** (not committed).

### How a site deploy happens
1. Vercel project connected to `CelsianJs/what-framework` (GitHub App).
2. **Settings → Root Directory** set to the path above; production branch `main`.
3. Build command / output come from each site's `vercel.json` (or auto-detect for `benchmarks`).
4. `git push origin main` → Vercel builds + deploys every connected project automatically.

### Did my push actually ship? (don't shoot in the dark)
- **CLI:** `gh api repos/CelsianJs/what-framework/commits/main --jq .sha` → compare to the live deploy.
- **MCP / dashboard:** list deployments for the project ID above and confirm the newest is
  `state: READY`, `target: production`, and `githubCommitSha` = your latest `main` SHA.
- **Content check:** SPA sites (react-compat/playground) are client-rendered — `curl` of the HTML
  won't show hero text; grep the built `/assets/index-*.js` bundle or browser-render the page.

---

## Deploying apps built WITH What (the adapters)

This file covers the framework's own sites/packages. To deploy an **app built
with What**, use the `what-server` deploy adapters — Node (`createServer`),
static export (`exportStatic`), Vercel (`createVercelHandler` +
`buildVercelOutput`, Build Output API v3), and Cloudflare Workers
(`createCloudflareHandler`, ES module worker). All four wrap the same
Web-Fetch core, with CSRF protection on by default. Step-by-step instructions:
[`packages/server/README.md` → "Deploying"](packages/server/README.md#deploying).
Each adapter is verified by `packages/server/test/deploy-readiness.test.js`.

---

## npm packages

The 13 maintained packages publish together at the version recorded in
[`CHANGELOG.md`](CHANGELOG.md). Deprecated `what-mcp` is frozen at 0.12.4 and
excluded from new cohorts. See [`README.md`](README.md#packages).

### Release commands (local)
```bash
npm run release:patch   # bump patch + verify + publish
npm run release:minor
npm run release:major
# or, granularly:
npm run version:bump <patch|minor|major>
npm run release:verify   # shared correctness gates + blocking local benchmarks
npm run release:publish  # publish maintained cohort and reconcile requested tags
```

### Release via CI (preferred)
GitHub Actions → **Release And Deploy** workflow (`.github/workflows/release-and-deploy.yml`),
triggered manually (`workflow_dispatch`) with inputs:
- `publish_packages` (default true) — publish to npm
- `npm_tag` (default `latest`) — requested tag verified across the maintained cohort
- `dry_run` (default false) — do not publish or retag

Dispatch from `main` only. The workflow rejects other refs before accessing
publication credentials. It runs `release:verify:correctness`, followed by a
separate nonblocking CI benchmark signal. Local `release:verify` retains the
blocking benchmark. Web deployment is not a release-workflow input.

npm auth uses the existing `NPM_TOKEN` repository secret. Its permissions must
cover the maintained packages and satisfy npm's publishing/2FA policy. The
workflow preflights authentication and requests OIDC provenance. Do not print
tokens or assume provenance means token-free trusted publishing. Publication
and tag reconciliation are separate non-atomic operations; a failed cohort
stops, and a verified rerun reconciles remaining members.

### Legacy token-based site deploy (`scripts/deploy-vercel.mjs`)
For an explicit local fallback, `scripts/deploy-vercel.mjs` runs `vercel deploy
--prod` against these targets: `sites/benchmarks`, `docs-site`, `docs-site/docs`,
`sites/react-compat`, `sites/playground`. This path **requires a `VERCEL_TOKEN`** and is the
*fallback* — the native GitHub integration above is the primary, token-free mechanism.
The release workflow does not run this script. Prefer the reviewed PR/main path
and native Git integration described above.

---

## Quality gates (run before any release)

`npm run release:verify` uses the shared correctness runner with a blocking
local benchmark. The correctness list includes:
- `hygiene:publish` — publish-surface check
- `test` — full unit/integration suite + stress tests
- `build` — rebuild `dist/*.min.js` (`node scripts/build.js`)
- type/export parity, both typechecks, lint, error catalog/documentation consistency and bundle budgets
- `test:prod` — production-conditions build check (`--conditions=production`)
- `bench:gate` — benchmark regression gate
- packed scaffolder and real application browser smokes

Automatic CI lives under `.depot/workflows/`; GitHub CI/size/benchmark copies
are manual fallbacks. Benchmark refreshes use a branch/PR, not a direct main
push. If repository policy denies the bot's PR creation, its branch and
artifact remain available for a maintainer to open the PR without bypassing
checks.

---

## Quick reference

| I want to… | Do this |
|---|---|
| Deploy a website change | `git push` to `main` (native Vercel auto-deploy) |
| Publish new package versions | GitHub Actions → Release And Deploy, or `npm run release:<level>` |
| Roll a site back | Re-deploy a previous commit from the Vercel dashboard |
| Run a site locally | `cd <site> && npm install && npm run dev` (or `npm run build && npm run preview`) |
