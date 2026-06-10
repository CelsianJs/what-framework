# Development Guide

How to work on What Framework in this repository.

## Monorepo layout

14 packages live in `packages/` (directory name → published npm name):

```
what-fw/
├── packages/
│   ├── core/           # what-core — runtime: reactivity, DOM, hooks, components, forms, data, a11y
│   ├── what/           # what-framework — umbrella package (re-exports core/router/server)
│   ├── router/         # what-router — client-side + file-based routing
│   ├── server/         # what-server — SSR, islands, static generation, server actions
│   ├── cache/          # what-isr — origin-first ISR cache engine
│   ├── compiler/       # what-compiler — JSX transform (Babel + Vite plugin)
│   ├── what-text/      # what-text — optional text engine (@chenglou/pretext)
│   ├── create-what/    # create-what — scaffolder (npm create what@latest)
│   ├── cli/            # what-framework-cli — dev server, build, start
│   ├── react-compat/   # what-react — React compatibility layer
│   ├── eslint-plugin/  # eslint-plugin-what — lint rules
│   ├── devtools/       # what-devtools — browser dev panel
│   ├── devtools-mcp/   # what-devtools-mcp — MCP bridge to live app state
│   └── mcp-server/     # what-mcp — docs MCP server (deprecated)
├── benchmark/
├── examples/
├── sites/              # playground, react-compat, benchmarks (deployed surfaces)
├── docs-site/          # whatfw.com
└── docs/
```

## Canonical package naming

Use only:

- `what-framework`
- `what-framework/router`
- `what-framework/server`
- `what-compiler`
- `create-what`

Avoid alias/package drift in docs and examples.

## Common commands

```bash
npm test
npm run build
npm run bench
npm run bench:dx
npm run bench:gate
npm run smoke:scaffold   # scaffold both templates from local tarballs and verify hydration
```

Notes:

- scaffolded apps (`create-what`) run at `http://localhost:5173`.
- Vite is the current implementation detail behind the scaffold; app teams should use `npm run dev/build/preview` rather than Vite commands directly.

## DX cleanup regression checks

```bash
npm run bench:gate
```

This runs:

1. Core benchmark suite (`benchmark/run.js`)
2. DX microbenchmarks (`benchmark/dx-microbench.js`)
3. Baseline comparison from `benchmark/baseline/*.json`

A regression beyond configured tolerance fails the command.

To reduce flaky failures from machine jitter, the gate re-runs benchmarks once when an initial regression is detected.

## Release automation

Canonical CI/release workflows:

- `/.github/workflows/ci.yml`
- `/.github/workflows/release-and-deploy.yml`

The release workflow runs tests/build/bench gates, then can:

1. Publish packages to npm in dependency order.
2. Deploy configured docs/web surfaces to linked Vercel projects.

See `/docs/RELEASE.md` for required secrets and one-button run steps.

## `show()` migration tool

`show()` is removed from the public API. A codemod exists for migrating old code:

```bash
node scripts/codemods/show-to-ternary.js <paths...>           # report only
node scripts/codemods/show-to-ternary.js --write <paths...>   # rewrite in place
```

## Docs consistency checklist

When changing behavior, update these together:

- `/README.md`
- `/GETTING-STARTED.md`
- `/docs/QUICKSTART.md`
- `/docs/API.md`
- `/docs/GOTCHAS.md`
- `/docs/STYLING.md`
- `/CLAUDE.md`
- `/docs/RELEASE.md`

## API contract checklist

For breaking or compatibility-sensitive changes:

1. Runtime in `packages/core/src/*`
2. Type definitions in `packages/core/index.d.ts` and `packages/what/index.d.ts`
3. Tests in `packages/core/test/*`
4. Migration notes/codemods if required
5. Bench regressions blocked via `bench:gate`
