# js-framework-benchmark entry: what (keyed)

This directory is shaped as a `frameworks/keyed/what` entry for
[krausest/js-framework-benchmark](https://github.com/krausest/js-framework-benchmark),
ready to PR upstream.

## How to submit

1. Fork `krausest/js-framework-benchmark` and copy this directory to
   `frameworks/keyed/what/` (drop this README or keep it minimal).
2. From the benchmark repo root: `npm ci`, then
   `cd frameworks/keyed/what && npm install && npm run build-prod`.
3. Verify locally per upstream docs: start the benchmark server
   (`npm start` at the repo root) and open
   `http://localhost:8080/frameworks/keyed/what/dist/` — all 9 operations must
   work; then run `npm run bench keyed/what` from `webdriver-ts`.
4. Run the upstream keyed-correctness checks
   (`npm run isKeyed keyed/what` in `webdriver-ts`) — this implementation is
   keyed: the compiler lowers the `.map()` + `key` to keyed reconciliation
   (`_$mapArray`), so row DOM nodes move/persist by id.
5. Open the PR following upstream's "How to add a new framework" checklist.

## Notes for reviewers

- `what-framework`/`what-compiler` are published on npm (same version line).
- JSX is compiled by `what-compiler/vite` (babel) into template cloning +
  per-binding effects — no virtual DOM. Components run once.
- The implementation mirrors the official Solid entry's idioms (per-row label
  signals; selection via a signal compared per row).
- `customURL` points at `dist` because the entry is built with vite.
