# Signal-engine benchmark

The Node suite runs the Kairo propagation cases, molBench, S.js creation and update cases, both cellx depths, and all six dynamic graph configurations from [milomg/js-reactivity-benchmark](https://github.com/milomg/js-reactivity-benchmark/tree/56eb45e84b3f6fcfa867840725e66b59a9b7467a). It compares the working tree's What engine with Solid 1.9, Solid 2.0's standalone engine, Alien Signals, and Preact Signals Core.

From this directory, with Node 22.12 or newer:

```sh
npm ci --ignore-scripts
npm run bench
```

Use `npm run bench -- --quick` for a smoke run. Both commands overwrite `RESULTS.md` and `results.json`. Use the full run on a quiet machine for baseline measurements. Cases run serially with individual 20-second smoke and three-minute full limits. Framework failures are recorded in the outputs, and the runner continues through the remaining cases.

Run `npm run bench -- --check` for CI-style verification of the What engine. It checks adapter behavior, runs the Kairo and both cellx depths once per verification pass, counts S.js callbacks at smoke size, and checks the dynamic graphs at their full upstream iteration counts. It exits nonzero for a failed or incomplete workload and leaves the timing reports untouched.

## Adapters

What imports `packages/core/src/reactive.js` directly. The adapter uses lazy `computed`, creates each graph with `createRoot`, and disposes every root at cleanup. The initial effect runs synchronously. Later updates normally use a microtask, while the outer `batch` drains them synchronously at the end of each harness transaction.

Solid 1.9 uses its production client runtime so effects execute in Node. Solid 2.0 uses a lazy `createMemo`, passes the harness's single tracked callback to the compute phase of `createEffect`, and uses `flush(fn)` during setup and after each transaction. The callback may update plain JS counters and arrays. The workloads perform no reactive writes inside their effects. Each adapter discards incidental effect return values according to the harness's void callback contract.

## Method

- The lockfile pins the upstream Git commit. Upstream's core package declares ISC and the pinned repository has no separate LICENSE file. The runner bundles the required source modules from the installed dependency, exposes case selection and sample hooks, and uses the upstream assertions and adapter checks.
- Full-size runs keep the upstream workload dimensions and repeat counts. Smoke runs shrink the Kairo repeat count and S.js graph size, and time up to 50 dynamic iterations per sample on a fresh graph. Dynamic smoke verification still attempts the upstream iteration count on a warmed graph. Both modes use the upstream cellx depths.
- Each framework and workload runs in a fresh process, with the three S.js groups sharing one process. The runner rotates framework order by case. It uses production builds, natural V8 collection, and a 768 MiB old-space limit. Callback counts from the dynamic graphs come from the upstream counter. Other callback counts come from a separate pass.
- The report uses median elapsed time for Kairo, cellx, and dynamic cases. S.js retains upstream's sum of the fastest samples across its subcases. The overall score is the geometric mean of ratios to each row's fastest engine, on cases that completed and passed their checks across all five engines. The JSON includes individual timings and expected and actual results where the upstream suite provides them.
