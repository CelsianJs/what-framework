# krausest-style keyed benchmark

Standard [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
keyed operations for **what** (compiled fine-grained path), **react 19**,
**solid**, and **vanilla JS** (reference floor).

Operations: create 1k, replace all, partial update (every 10th), select row,
swap rows, remove row, create 10k, append 1k, clear.

## Run it

```bash
cd benchmark/krausest
npm install        # isolated deps (react, solid, vite) — NOT the repo root
npm run build      # vite production build per framework -> dist/<fw>/
npm run bench      # full run  (or: npm run bench:quick)
```

Results land in [`RESULTS.md`](RESULTS.md) (table + machine info + caveats)
and `results.json` (raw samples). The driver uses the repo root's `playwright`
devDependency (headless Chromium) — everything else is installed here.

## Layout

| Path | What |
|---|---|
| `frameworks/<fw>/` | One self-contained implementation per framework (identical markup/CSS) |
| `shared/main.css` | Identical styling for all implementations |
| `build-all.mjs` | Vite production builds (`what` is aliased to the repo's `packages/*` sources) |
| `bench.mjs` | Playwright driver — methodology documented at the top of the file |
| `submission/` | Ready-to-PR `frameworks/keyed/what` entry for the upstream js-framework-benchmark repo |

## Methodology (short version)

Each op = unmeasured prep, then ONE measured `click()`: timed in-page from
before the synchronous click dispatch to a double `requestAnimationFrame`
after it (script + style + layout + frame commit). The DOM is asserted after
every measured action (row counts, selection class, label suffix) so no
implementation can win by skipping work. Median of 10 samples (5 for 10k-row
ops) after warmup. **Read the caveats in RESULTS.md before quoting numbers** —
this approximates but does not replicate the official harness (no CPU
throttling, no CDP timeline tracing).
