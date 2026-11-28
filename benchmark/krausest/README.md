# krausest-style keyed benchmark

Standard [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
keyed operations for **what** (compiled fine-grained path), **react 19**,
**solid 1.9**, **solid 2.0**, and **vanilla JS** (reference floor).

Operations: create 1k, replace all, partial update (every 10th), select row,
swap rows, remove row, create 10k, append 1k, clear.

## Run it

```bash
cd benchmark/krausest
npm install        # isolated deps (react, both Solid majors, vite) — NOT the repo root
npm run build      # vite production build per framework -> dist/<fw>/
npm run bench      # full run: unthrottled + 4x CPU-throttled tables
npm run bench:quick  # smoke run: 3 samples, unthrottled only
```

`node bench.mjs [--quick] [--throttle <rate>[,<rate>...]] [framework ...]`:
`--throttle 4` runs only the 4x table, `--throttle 1,4` both (the default
without `--quick`); naming frameworks (`vanilla what solid solid2`) runs a
subset. The run is non-interactive and fails loudly on any DOM mismatch.

### One component per row

`what-rows`, `solid-rows` and `solid2-rows` are the `what`, `solid` and
`solid2` apps with the row moved into a `Row` component that is handed the
row, the selection and the two handlers as props. Nothing else differs, so the
ratio of a `-rows` variant to its app is what a component call costs in that
framework. They are built with the rest and run only when named:

```bash
node bench.mjs --throttle 1 what what-rows solid solid-rows solid2 solid2-rows
```

Results land in [`RESULTS.md`](RESULTS.md) (tables + machine info + caveats)
and `results.json` (raw samples, bundled package versions, bundle sizes). The
driver uses the repo root's `playwright` devDependency (headless Chromium);
everything else is installed here.

## Layout

| Path | What |
|---|---|
| `frameworks/<fw>/` | One self-contained implementation per framework (identical markup/CSS) |
| `frameworks/solid2/package.json` | npm workspace holding `solid-js@2` and its `@solidjs/*` peers, so Solid 2.0 installs beside the root's Solid 1.9 |
| `frameworks/what-rows/`, `frameworks/solid-rows/`, `frameworks/solid2/rows/` | The component-per-row variants (Solid 2.0's inside its workspace, where `solid-js` resolves to 2.0) |
| `shared/main.css` | Identical styling for all implementations |
| `build-all.mjs` | Vite production builds (`what` is aliased to the repo's `packages/*` sources); writes `dist/<fw>/packages.json` |
| `bench.mjs` | Playwright driver — methodology documented at the top of the file |
| `submission/` | Ready-to-PR `frameworks/keyed/what` entry for the upstream js-framework-benchmark repo |

### Two Solid majors side by side

`solid-js@1.9` is a dependency of this directory; `solid-js@2.0` and
`@solidjs/web@2.0` belong to the `frameworks/solid2` workspace, so npm nests
them under `frameworks/solid2/node_modules` where their peer dependencies
resolve to 2.0. Each is compiled by its own compiler: Solid 1.9 by
`vite-plugin-solid` (`babel-preset-solid` 1.9), Solid 2.0 by
`@solidjs/babel-plugin` 2.0 (the Babel compiler Solid's official
`keyed/solid-next` entry uses; `@solidjs/vite-plugin` would need Vite 8,
which would also change the toolchain the release gate builds `what` with).
`dist/<fw>/packages.json` lists the package and version behind every module
the bundler emitted, and `bench.mjs` refuses to run `solid` unless that shows
`solid-js@1.9.x` and no `@solidjs/*`, or `solid2` unless it shows
`solid-js`, `@solidjs/web` and `@solidjs/signals` at 2.0.x.

## Methodology (short version)

Each op = unmeasured prep, then ONE measured `click()`, timed in-page from
just before the synchronous click dispatch. Two numbers come from that click:

- **total**: to a double `requestAnimationFrame` after it (script + style +
  layout + frame commit). Carries a frame-scheduling floor of roughly 8-10ms.
- **script only**: to the moment the click task and every microtask it queued
  have run: a MessageChannel message posted right after `click()` (or the
  next frame, if the browser renders first), before style and layout. No
  frame floor, so it shows framework cost on cheap ops. Pages are served
  cross-origin isolated for this metric (5us timer resolution).

The DOM is asserted at the script stop point and again after the frame, on
every sample: row counts, the ids of swapped, removed, kept and appended rows,
updated labels and the selection class, so no implementation can win by
skipping or deferring work. Vanilla and Solid 1.9 finish synchronously;
React 19 and Solid 2.0 flush in a microtask; what flushes synchronously at the
end of `batch()` and in a microtask after a bare signal write. Nothing defers
past the microtask checkpoint; a framework that did would fail the run.

CPU throttling uses CDP `Emulation.setCPUThrottlingRate` through a Playwright
CDP session, applied around each measured click only (prep runs unthrottled).
Bundle size is raw, gzip -9 and brotli q11 of every JS asset in `dist/<fw>/`.
Median of 10 samples (5 for create 10k) after warmup. **Read the caveats in
RESULTS.md before quoting numbers**: this approximates but does not replicate
the official harness (uniform throttle rate instead of per-op rates, no CDP
timeline tracing).

## DOM regression report provenance

The release gate uses `../dom-gate.mjs` and takes the **25th percentile of
pooled script-only samples**. It runs What with no CPU throttling, serves
the pages with cross-origin isolation, and verifies DOM state at the
script stop point. Use `npm run bench:dom` from the repo root to record
the committed baseline on the release benchmark machine. To retain a diagnostic
report without overwriting the committed baseline, run from the repo root:

```bash
node benchmark/dom-gate.mjs --out /tmp/what-dom-diagnostic.json --rounds 21
```

Use an absolute Node executable when comparing environments. The report records
that executable, Node version, OS/CPU information and installed Playwright,
Playwright Core, Vite, esbuild and compiler versions. `buildPerformed` indicates
whether this invocation built the benchmark; with `--no-build`, the installed
build-tool versions do **not** establish which versions produced the existing
assets. Missing optional build tools are recorded as `null`.

`browsers[]` preserves the actual browser version, CDP engine revision, protocol,
JavaScript version, user agent and requested launch options for **each round**.
The actual command line is included when Chromium exposes it; otherwise
`commandLine` is `null` with a `commandLineError` explaining why. The harness does
not add `--enable-automation` or change browser flags to obtain this diagnostic.
`toolchain.expectedChromiumRevision` and `expectedChromiumVersion` come from the
installed Playwright manifest: they describe the expected bundled artifact, not
proof of the executable that ran. CDP metadata is collected after the measured
operations; failure to obtain the actual browser version/revision fails the
diagnostic rather than silently claiming unknown browser provenance.

`samplesPerRound` is now an operation-name map, not a single number: ordinary
operations default to 10 samples, while `create10k` uses at most 5 per round.
Each result retains `samples` in round order at three-decimal precision,
per-round `sampleCounts`, per-round `stoppedByFrame` fallback counts, and the
total `sampleCount`. An unequal per-round count is represented by
`null` in the summary map; the exact counts remain in `sampleCounts`.

The `timing` field identifies the `click-to-microtasks` metric in milliseconds.
`spread` is the range of per-round p25 values. The gate requires a script-time
baseline and applies its recorded 0.005 ms noise floor alongside the percentage
tolerance. Retained samples permit further analysis, but repeated samples within
a round are not automatically independent.

Report-generation tests run without Chromium and are discovered by the normal
test runner:

```bash
node scripts/run-all-tests.mjs benchmark
```
