# DX Cleanup Status (What Framework)

This file maps key findings from `FINAL_REPORT.md` and `REVIEW.md` to implemented cleanup actions.

## Resolved in framework/runtime

- `show()` footgun: removed from public API.
- `innerHTML` confusion: `innerHTML` and `dangerouslySetInnerHTML` are both supported in DOM + SSR.
- `innerHTML` reconciliation bug: fixed so raw HTML props own element children and update correctly.
- Event casing confusion: runtime supports both `onClick` and `onclick`.
- Focus lifecycle issues: added `useFocusRestore` and hardened `FocusTrap` lifecycle/ref timing.
- Form error API mismatch: `ErrorMessage` aligned with `formState.errors` getter semantics.

## Resolved in type/docs/workflow

- Type drift: signal callable setter compatibility typed (`sig(next)` + `sig.set(next)`).
- `show` typing removed from public types.
- `ErrorMessage` + form typings updated to match runtime.
- Canonical docs path switched to compiler-first JSX.
- Canonical naming/workflow standardized on `what-framework`, `npx create-what`, `npm run dev`.
- Styling guidance shifted to CSS-first with explicit anti-patterns for JS hover style mutation.
- Added `show` codemod: `scripts/codemods/show-to-ternary.js`.

## Performance guardrails

- Added DX microbenchmark suite (`benchmark/dx-microbench.js`).
- Added baseline benchmark snapshots (`benchmark/baseline/core.json`, `benchmark/baseline/dx.json`).
- Added regression gate (`npm run bench:gate`).

## Remaining work for app teams

- Run `npm run codemod:show` in downstream apps.
- Replace any `formState.errors()` usage with `formState.errors`.
- Move button/input interaction styling from JS handlers to CSS pseudo-classes where possible.
