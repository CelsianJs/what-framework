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

1. Core benchmark suite (`benchmark/run.js`) and DX microbenchmarks (`benchmark/dx-microbench.js`), each against a reference build: the packages of the commit in `benchmark/reference.json`, read from git history, running the current benchmark scripts. The two sides run in 9 interleaved pairs (`WHAT_BENCH_PAIRS`), alternating which goes first, and each guarded operation is judged by the median of its per-pair ratios (`benchmark/ab.mjs`).
2. Script time from click until microtasks drain, with DOM verification in Chromium (`benchmark/dom-gate.mjs`, 21 rounds), compared with `benchmark/baseline/dom.json`.

A core or DX operation fails below 95% of the reference (`WHAT_BENCH_TOLERANCE_CORE`, `WHAT_BENCH_TOLERANCE_DX`, default 0.05); a DOM operation fails 10% above its baseline (`WHAT_BENCH_TOLERANCE_DOM`) and by more than the `noiseFloorMs` recorded in it (0.005 ms, one tick of the isolated Chromium clock). Measuring both sides in one session takes the machine's state out of the ratio: an unchanged build lands at 96-105% even on a loaded machine, and a 10% slower signal write at about 90%. The gate re-runs once before it fails.

`npm run bench:record` moves the reference to `HEAD` (and re-records `benchmark/baseline/core.json` and `dx.json`, which the documentation's numbers come from): run it only when a change in performance is intended. A shallow clone has no reference commit, so CI checks out with `fetch-depth: 0`.

The DOM stage uses the 25th percentile of the pooled script samples and records each round’s raw samples, browser provenance, and how often the frame callback provided the stop point.

The DOM stage needs a Chromium and an install inside `benchmark/krausest`. CI's `bench-gate` job provisions both and runs the DOM stage as a non-blocking gross-regression signal (50% tolerance, 5 rounds), because its baseline is recorded on local hardware and shared runners are slower; core and DX keep their floors there, since they are measured against the reference on the same runner. Set `WHAT_BENCH_SKIP_DOM=1` to skip the stage; nothing in `release:verify` sets it.

Re-record the DOM baseline with `npm run bench:dom` (63 rounds) on an idle machine. The gate requires a script-only baseline stamped with `click-to-microtasks`.

CI runs the What-only reactivity correctness gate with `npm ci --ignore-scripts --prefix benchmark/reactivity` followed by `npm run --prefix benchmark/reactivity bench -- --check`.

To reduce flaky failures from machine jitter, the gate re-runs benchmarks once when an initial regression is detected.

## Release automation

Authoritative CI and release workflows:

- `/.github/workflows/ci.yml` (automatic CI)
- `/.github/workflows/release-and-deploy.yml`

The GitHub release workflow runs the shared correctness gates, retains a separate nonblocking CI benchmark signal, publishes the maintained npm cohort, and verifies exact versions and the requested tag. Run the full local `release:verify` for blocking performance qualification. Web surfaces deploy separately through native GitHub-to-Vercel integration; the release workflow does not deploy them.

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
