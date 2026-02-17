# What Framework Thread Update

Date: February 17, 2026

This document summarizes the work completed during this thread to implement the “Major DX Cleanup Plan” for **What Framework** (scope explicitly excludes ThenJS/Celsian work).

## Goals Re-stated (DX + Perf)

- Make authoring feel React-familiar by default (JSX-first).
- Remove/avoid confusing “wrapper everywhere” and `show()` footguns in docs and API surface.
- Standardize workflow (scaffold/dev/build/preview) and naming (`what-framework`).
- Fix confirmed runtime/compiler bugs (forms, raw HTML, event casing, compiler output correctness).
- Keep benchmarks strong; treat regressions as blockers.

## High-Level Result

- The compiler/runtime contract for **compiler-first JSX** was hardened substantially:
  - Stable node targeting (`childNodes` not `children`).
  - Stable dynamic child placement using template markers + `insert(..., marker)`.
  - Correct prop semantics via runtime `setProp()` (property vs attribute; raw HTML behavior).
  - Template serialization corrected for non-void self-closing tags.
- Docs/workflow were aligned to a single canonical path.
- Bench/test guardrails were expanded and made less flaky.
- Old “landing page” surfaces were removed from the repository and deploy defaults.

## Implementation Summary

### 1) Canonical Workflow + Naming

- Canonical package naming standardized on:
  - `what-framework`, `what-framework/router`, `what-framework/server`, `what-framework/render`, `what-framework/testing`
  - `what-compiler`
  - `create-what`
- Canonical workflow:
  - `npx create-what my-app`
  - `npm run dev` / `npm run build` / `npm run preview`
  - Vite is treated as an implementation detail in docs (still used underneath).

Relevant docs updated:

- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/README.md`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/GETTING-STARTED.md`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/docs/QUICKSTART.md`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/docs/API.md`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/docs/DEVELOPMENT.md`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/docs/RELEASE.md`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/AGENTS.md`

### 2) API Cleanup Decisions (DX)

- `show()`:
  - Removed from the public API surface (docs and types reflect this).
  - Codemod is available for migration: `scripts/codemods/show-to-ternary.js`.
  - Canonical conditional patterns are ternaries and `<Show>`.

- Events:
  - Runtime supports both `onClick` and `onclick`.
  - Docs/examples standardize on React-style `onClick`.

- Signals:
  - Runtime supports both `sig.set(next)` and callable writes `sig(next)` for compatibility.
  - Docs standardize on `.set(...)`.

- Styling:
  - Docs shifted to CSS-first interaction states (`:hover`, `:focus-visible`) and discourage per-element JS style mutation handlers.
  - Inline object styles are documented for truly dynamic values: `style={{ position: 'absolute' }}`.
  - Styling guide exists: `/Users/macbookpro-kirby/Desktop/Coding/what-fw/docs/STYLING.md`.

### 3) Compiler-First JSX: Correctness Fixes

Primary fixes in the JSX compiler output (What Babel plugin):

- Node targeting:
  - Use `childNodes[index]` in generated code (stable across text/comment nodes).
- Dynamic child ordering:
  - Template extraction inserts `<!--$-->` placeholders for expression/component children.
  - Generated code uses `insert(parent, value, marker)` to preserve source order.
- Prop writes:
  - Dynamic prop writes are emitted via runtime helper `setProp()` (instead of raw `setAttribute`).
- Template serialization:
  - Non-void self-closing JSX tags (e.g. `<section />`) now serialize as `<section></section>` to avoid HTML parser reshaping.
  - Void tags (e.g. `<input />`) serialize as `<input>`.

Key compiler file:

- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/packages/compiler/src/babel-plugin.js`

New compiler regression tests:

- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/packages/compiler/test/babel-plugin.test.js`

### 4) Runtime Rendering: Correctness + Interop

Runtime rendering fixes/alignments made during the loop (high level):

- Introduced/standardized `setProp(el, key, value)` as an exported render helper and used it in spread paths.
- Hardened `insert()` behavior for:
  - vnode/component children coming from compiler-first output
  - reactive vnode arrays (avoid `[object Object]` stringification)
- Raw HTML props:
  - `innerHTML` and `dangerouslySetInnerHTML` supported in DOM + SSR.
  - Rule: if either raw HTML prop is set, it owns element children (documented and tested).

Key runtime files touched (most relevant):

- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/packages/core/src/render.js`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/packages/core/src/index.js`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/packages/what/src/render.js`

### 5) Forms + ErrorMessage Alignment

Fixed/standardized form error semantics:

- `formState.errors` is a getter object (not a function).
- `ErrorMessage` aligns with `formState.errors` semantics and supports a legacy compatibility input where needed.

Key files:

- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/packages/core/src/form.js`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/docs/API.md`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/docs/QUICKSTART.md`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/docs/GOTCHAS.md`

### 6) FocusTrap DX + Lifecycle

- Added `useFocusRestore()` and documented parent-controlled focus restore pattern.
- Hardened focus trap lifecycle behavior around conditional rendering/unmount flows.

Key files:

- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/packages/core/src/a11y.js`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/docs/API.md`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/README.md`

### 7) Types Synchronization

- Signal type reflects callable setter + `.set(...)`.
- Render types include `setProp` and render module typings were added/updated to match the runtime/compiler output.

Key files:

- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/packages/core/index.d.ts`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/packages/core/render.d.ts`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/packages/what/index.d.ts`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/packages/what/render.d.ts`

### 8) Performance Guardrails (Benchmarks)

Bench setup:

- Benchmarks live under `/Users/macbookpro-kirby/Desktop/Coding/what-fw/benchmark` (note: folder name is `benchmark/`, not `benchmarks/`).
- `npm run bench:gate` compares against `benchmark/baseline/*.json`.

Gate improvement (flakiness reduction):

- `bench:gate` will now re-run once if a regression is detected to reduce false failures from CPU jitter.
  - Implementation: `/Users/macbookpro-kirby/Desktop/Coding/what-fw/benchmark/check-regressions.js`

Representative values from a passing gate run during this thread (machine-dependent):

- `signal() write (1 subscriber)`: ~650k ops/s
- `batch() 100 writes, 1 effect`: ~580k ops/s
- `innerHTML patch path`: ~8.6k ops/s
- `event prop normalize (onClick)`: ~700–800 ops/s

### 9) Example Apps + DX Review Artifacts

Created/used multiple npm-consumer validation projects:

1. **8-page single app review** (router + pages; includes `REVIEW.md` and smoke script):
   - `/Users/macbookpro-kirby/Desktop/Coding/what-fw/examples/npm-eight-pages-review`
   - Note: this project currently references `what-framework@0.4.2`/`what-compiler@0.4.2` and served as an early “npm consumer” baseline; it should be bumped when validating the next publish.

2. **8-app suite** (eight independent apps, each with its own port) for broad npm-consumer validation:
   - `/Users/macbookpro-kirby/Desktop/Coding/what-fw/examples/npm-app-suite`

3. **Local loop validation app** to reproduce and verify compiler/runtime edge cases quickly:
   - `/Users/macbookpro-kirby/Desktop/Coding/what-fw/examples/local-loop-validation`

Thread feedback tracking docs:

- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/training-builds/FINAL_REPORT.md`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/training-builds/REVIEW.md`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/training-builds/CLEANUP_STATUS.md`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/training-builds/NPM_DX_FEEDBACK_2026-02-17.md`

### 10) Landing Pages Removal + Deploy Defaults

Removed from repository:

- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/sites/main`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/sites/immersive`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/sites/editorial`

Updated Vercel deploy defaults to no longer target the removed directories:

- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/scripts/deploy-vercel.mjs`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/docs/RELEASE.md`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/.github/workflows/release-and-deploy.yml`

Remaining deployable surfaces in repo:

- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/sites/benchmarks`
- `/Users/macbookpro-kirby/Desktop/Coding/what-fw/docs-site`

## Validation Performed in This Thread

- Unit + integration tests:
  - `npm test` (pass)
  - Added compiler regressions in `packages/compiler/test`.
- Benchmarks:
  - `npm run bench`, `npm run bench:dx`, `npm run bench:gate`
  - Gate now retries once on suspected noisy regressions.
- Browser validation:
  - Local loop validation app verified that previous `innerHTML` undefined-node crash is resolved (only initial missing favicon noise remained, which is now fixed in scaffold).

## Not Done / Follow-Ups

- npm publish was **not executed** in this thread from this workspace.
  - Publishing is wired via `scripts/publish-packages.mjs` and `/.github/workflows/release-and-deploy.yml` and requires credentials/secrets.
- No git push was performed in this thread from this workspace.
- `examples/npm-eight-pages-review` should be bumped to the next published version and re-smoked after publish.
- Decide on “Vite abstraction” level:
  - Keep current approach (Vite scripts in scaffold) or ship an official `what dev/build/preview` CLI as the public surface.

