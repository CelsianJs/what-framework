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

## DOM regression report provenance

The release gate uses `../dom-gate.mjs`, which aggregates the **25th percentile
of pooled samples**, not this comparison CLI's median. To retain a diagnostic
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
operations default to 10 samples, while `create10k` defaults to 5. `--samples`
changes only the ordinary operations. Each result retains `samples` as arrays
in round order (at the harness's existing two-decimal precision), `sampleCounts`
per round, and total `sampleCount`. An unequal per-round count is represented by
`null` in the summary map; the exact counts remain in `sampleCounts`.

Gate fields `name`, `label`, `ms`, `spread`, aggregate and noise floor are
unchanged. `spread` is the range of per-round p25 values, **not** a standard
deviation or confidence interval. Historical reports lack the new provenance;
do not assume their browser, machine state or sampling conditions match a new
report. Retained samples permit further analysis, but repeated samples within a
round are not automatically independent. No baseline or tolerance change is
implied by recording metadata.

Report-generation tests run without Chromium and are discovered by the normal
test runner:

```bash
node scripts/run-all-tests.mjs benchmark
```
