# Development Guide

How to work on What Framework in this repository.

## Monorepo layout

```
what-fw/
├── packages/
│   ├── core/         # Runtime: reactivity, DOM, hooks, components, forms, data, a11y
│   ├── what/         # Public package: what-framework
│   ├── router/       # what-framework/router
│   ├── server/       # what-framework/server
│   ├── compiler/     # what-compiler (Babel + Vite plugin)
│   └── create-what/  # Scaffolder (npx create-what)
├── demo/
├── benchmark/
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
npm run demo
```

Notes:

- `npm run demo` serves the demo app on `http://localhost:3000`.
- scaffolded apps (`create-what`) run via Vite at `http://localhost:5173`.

## DX cleanup regression checks

```bash
npm run bench:gate
```

This runs:

1. Core benchmark suite (`benchmark/run.js`)
2. DX microbenchmarks (`benchmark/dx-microbench.js`)
3. Baseline comparison from `benchmark/baseline/*.json`

A regression beyond configured tolerance fails the command.

## Release automation

Canonical CI/release workflows:

- `/.github/workflows/ci.yml`
- `/.github/workflows/release-and-deploy.yml`

The release workflow runs tests/build/bench gates, then can:

1. Publish packages to npm in dependency order.
2. Deploy docs/landing surfaces to linked Vercel projects.

See `/docs/RELEASE.md` for required secrets and one-button run steps.

## `show()` migration tool

`show()` is removed from the public API.

```bash
npm run codemod:show:check
npm run codemod:show
```

Codemod path: `scripts/codemods/show-to-ternary.js`.
Default script targets: `demo`, `examples`, `training-builds`.

## Docs consistency checklist

When changing behavior, update these together:

- `/README.md`
- `/GETTING-STARTED.md`
- `/docs/QUICKSTART.md`
- `/docs/API.md`
- `/docs/GOTCHAS.md`
- `/docs/STYLING.md`
- `/Agents.md`
- `/docs/RELEASE.md`

## API contract checklist

For breaking or compatibility-sensitive changes:

1. Runtime in `packages/core/src/*`
2. Type definitions in `packages/core/index.d.ts` and `packages/what/index.d.ts`
3. Tests in `packages/core/test/*`
4. Migration notes/codemods if required
5. Bench regressions blocked via `bench:gate`
