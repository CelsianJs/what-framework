# WhatFW Release Checklist

Use this checklist every time you make changes to the framework and want to release.
Works for both human developers and AI agents.

> **Automation note:** The GitHub Actions workflow `release-and-deploy.yml` can handle npm publish + Vercel deploy automatically. Always run `npm run release:verify` locally first. See `docs/RELEASE.md` for CI details and required secrets (`NPM_TOKEN`, `VERCEL_TOKEN`).

---

## Pre-Release

- [ ] All tests pass: `npm test`
- [ ] Build succeeds: `npm run build`
- [ ] Benchmark gate passes: `npm run bench:gate`
- [ ] Full verification in one command: `npm run release:verify`
- [ ] No security regressions — check `innerHTML`, `template()`, CSRF, `javascript:` URL paths
- [ ] Codemods applied if API surface changed: `npm run codemod:show:check`

---

## Version Bump

- [ ] Bump version in root `package.json`
- [ ] Bump ALL 12 packages to the same version:

| # | Package (npm name) | File path |
|---|---|---|
| 1 | `what-core` | `packages/core/package.json` |
| 2 | `what-router` | `packages/router/package.json` |
| 3 | `what-server` | `packages/server/package.json` |
| 4 | `what-compiler` | `packages/compiler/package.json` |
| 5 | `what-devtools` | `packages/devtools/package.json` |
| 6 | `what-mcp` | `packages/mcp-server/package.json` |
| 7 | `what-devtools-mcp` | `packages/devtools-mcp/package.json` |
| 8 | `eslint-plugin-what` | `packages/eslint-plugin/package.json` |
| 9 | `what-react` | `packages/react-compat/package.json` |
| 10 | `what-framework` | `packages/what/package.json` |
| 11 | `what-framework-cli` | `packages/cli/package.json` |
| 12 | `create-what` | `packages/create-what/package.json` |

- [ ] Update cross-package dependency versions (these use `^` or `>=` ranges):

| Package | Depends on | Range style |
|---|---|---|
| `what-compiler` | `what-core` | `^X.Y.Z` |
| `what-devtools` | `what-core` | `^X.Y.Z` |
| `what-devtools-mcp` | `what-devtools` | `>=X.Y.Z` |
| `what-react` | `what-core` | `^X.Y.Z` |
| `what-router` | `what-core` | `^X.Y.Z` |
| `what-server` | `what-core` | `^X.Y.Z` |
| `what-framework` | `what-core`, `what-router`, `what-server`, `what-compiler` | `^X.Y.Z` |
| `what-framework-cli` | `what-framework` | `^X.Y.Z` |

---

## npm Publish

Publish in this exact order (dependency graph, from `scripts/publish-packages.mjs`):

```
1.  packages/core          → what-core
2.  packages/router        → what-router
3.  packages/server        → what-server
4.  packages/compiler      → what-compiler
5.  packages/devtools      → what-devtools
6.  packages/mcp-server    → what-mcp
7.  packages/devtools-mcp  → what-devtools-mcp
8.  packages/eslint-plugin → eslint-plugin-what
9.  packages/react-compat  → what-react
10. packages/what          → what-framework
11. packages/cli           → what-framework-cli
12. packages/create-what   → create-what
```

- [ ] Dry-run first: `npm run release:publish -- --dry-run`
- [ ] Publish for real: `npm run release:publish`
- [ ] (Optional) Publish with dist-tag: `npm run release:publish -- --tag next`
- [ ] Verify all packages show correct version on npm:
  ```bash
  npm view what-framework version
  npm view what-core version
  npm view what-compiler version
  npm view what-devtools-mcp version
  npm view create-what version
  ```
- [ ] Test scaffolder works: `npm create what@latest test-app` (then delete `test-app/`)
- [ ] Test MCP server starts: `npx what-devtools-mcp` (Ctrl-C after it starts)
- [ ] Test doc MCP server: `npx what-mcp` (Ctrl-C after it starts)

---

## Web Deployments

Four default deploy targets (from `scripts/deploy-vercel.mjs`):

```
1. sites/benchmarks   → benchmarks.whatfw.com
2. docs-site          → whatfw.com
3. docs-site/docs     → whatfw.com/docs
4. sites/react-compat → react.whatfw.com
```

- [ ] Deploy all at once: `npm run deploy:vercel`
- [ ] Or deploy individually:
  ```bash
  npm run deploy:vercel -- --targets "docs-site"
  npm run deploy:vercel -- --targets "docs-site/docs"
  npm run deploy:vercel -- --targets "sites/benchmarks"
  npm run deploy:vercel -- --targets "sites/react-compat"
  ```
- [ ] Dry-run first if unsure: `npm run deploy:vercel -- --dry-run`
- [ ] Verify all sites return 200:
  ```bash
  curl -sI https://whatfw.com | head -1
  curl -sI https://whatfw.com/docs | head -1
  curl -sI https://benchmarks.whatfw.com | head -1
  curl -sI https://react.whatfw.com | head -1
  ```

---

## Documentation Updates

### Version badges in docs-site (36 HTML files)

The docs-site uses a hardcoded version badge in the nav: `<span class="logo-badge">vX.Y.Z</span>`.
This appears in **every** HTML file. Update all at once:

```bash
# From repo root — replace old version with new version in all docs-site HTML files
find docs-site -name "*.html" -exec sed -i '' 's/v0\.6\.0/vNEW_VERSION/g' {} +
```

Files that contain version strings:
- `docs-site/index.html` — nav badge AND footer (`v0.X.Y &middot; MIT License`)
- `docs-site/docs/index.html` — nav badge
- `docs-site/docs/learn/*.html` (15 files) — nav badge
- `docs-site/docs/tutorial/*.html` (7 files) — nav badge
- `docs-site/docs/reference/*.html` (9 files) — nav badge

- [ ] Update version badge in all 36 docs-site HTML files
- [ ] Update footer version in `docs-site/index.html`
- [ ] Verify no stale versions remain: `grep -r 'v0\.' docs-site/ --include='*.html' | grep -v 'css\|animation\|opacity\|shadow\|transition\|delay'`

### Markdown documentation

- [ ] Check `docs/SETUP-GUIDE.md` — line 30 has a pinned version (`create-what@0.5.6`), update to current
- [ ] Check `docs/API.md` — verify exports match `packages/core/src/index.js`
- [ ] Check `docs/MCP-DEVTOOLS.md` — verify tool count and names match `packages/devtools-mcp/src/tools.js`
- [ ] Check `Agents.md` — verify MCP tool tables match actual implementations
- [ ] Check `GETTING-STARTED.md` — verify install commands and setup examples
- [ ] Check `README.md` — verify package table, MCP setup examples, and feature claims
- [ ] Check `REACT-COMPAT.md` — update confirmed working count if compat layer changed
- [ ] Check `packages/devtools-mcp/README.md` — verify tool table matches implementation
- [ ] Check `packages/mcp-server/README.md` — verify tool table matches implementation
- [ ] Check `docs/RELEASE.md` — verify deploy target list matches `scripts/deploy-vercel.mjs` defaults

### Known stale-version locations to check

| File | What to check |
|---|---|
| `docs-site/index.html` | Nav badge, footer version |
| `docs-site/docs/**/*.html` | Nav badge (35 files) |
| `docs/SETUP-GUIDE.md` | Pinned `create-what@X.Y.Z` version |
| `packages/devtools-mcp/README.md` | Client banner version string |

---

## GitHub

- [ ] Commit all version bumps and doc updates
- [ ] Push to `main`
- [ ] Create GitHub release:
  ```bash
  gh release create vX.Y.Z --title "vX.Y.Z" --notes "Changelog here..."
  ```
- [ ] Update GitHub repo description/topics if positioning changed

### Or use the CI workflow

- [ ] Trigger `Release And Deploy` workflow from GitHub Actions:
  - Go to Actions > Release And Deploy > Run workflow
  - Set `publish_packages: true`, `deploy_web: true`, `npm_tag: latest`
  - The workflow runs `release:verify` automatically before publish/deploy

---

## Post-Release Verification

- [ ] `npm install what-framework@<version>` works in a fresh directory
- [ ] `npm create what@latest` scaffolds correctly and the generated app runs
- [ ] MCP server starts: `npx what-devtools-mcp`
- [ ] Doc MCP server starts: `npx what-mcp`
- [ ] Landing page (https://whatfw.com) shows correct version in badge and footer
- [ ] Docs site (https://whatfw.com/docs) loads and shows correct version
- [ ] Benchmarks site (https://benchmarks.whatfw.com) loads
- [ ] React compat site (https://react.whatfw.com) loads
- [ ] All doc links from README work (no 404s)
- [ ] Search npm for `what-framework` — verify latest version shows

---

## Quick Reference: One-Liner Release (after version bumps are committed)

```bash
# Verify → Publish → Deploy (local)
npm run release:verify && npm run release:publish && npm run deploy:vercel
```

```bash
# Dry-run everything first
npm run release:verify && npm run release:publish -- --dry-run && npm run deploy:vercel -- --dry-run
```
