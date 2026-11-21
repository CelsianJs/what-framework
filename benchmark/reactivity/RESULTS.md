# Signal-engine benchmark

**Full-size run.**

- 2026-11-20T07:12:56.081Z · 809.7 s wall time
- Node v22.13.1, V8 12.4.254.21-node.22
- Apple M3 Max (14 logical CPUs, 96 GiB), darwin 25.5.0 arm64
- Upstream commit `56eb45e84b3f6fcfa867840725e66b59a9b7467a`
- Working-tree What reactive.js SHA-256 `4a63da947b3c83637bcb65375eb0123af8d6599d68a95a241b5eced720ced09f`
- Solid 1.9.20, @solidjs/signals 2.0.3, Alien 3.2.1, Preact 1.14.5
- Case limit 180 s, V8 old-space limit 768 MiB per child process

## Elapsed milliseconds

Each cell is the median of raw samples. The S.js rows retain the upstream sum of fastest per-subcase samples. Failed and incomplete runs have no ranked timing.

| Workload | what | Solid 1.9 | Solid 2.0 signals | Alien | Preact |
| --- | --- | --- | --- | --- | --- |
| avoidablePropagation | 450.734 | 177.781 | 538.139 | 119.906 | 64.405 |
| broadPropagation | 566.175 | 382.521 | 806.604 | 78.679 | 90.832 |
| deepPropagation | 148.497 | 153.709 | 278.405 | 25.061 | 39.465 |
| diamond | 485.230 | 275.268 | 387.587 | 72.062 | 116.481 |
| mux | 525.864 | 246.383 | 246.381 | 107.048 | 114.631 |
| repeatedObservers | 16.139 | 33.345 | 72.227 | 6.214 | 7.606 |
| triangle | 104.130 | 100.114 | 134.831 | 19.829 | 23.769 |
| unstable | 91.755 | 63.255 | 146.652 | 16.268 | 21.774 |
| molBench | 33.560 | 24.478 | 26.201 | 21.030 | 20.410 |
| createSignals | 26.982 | 8.646 | 10.327 | 1.014 | 9.770 |
| createComputations | 259.941 | 257.247 | 247.010 | 74.179 | 124.830 |
| updateSignals | 1275.442 | 854.862 | 1706.071 | 302.279 | 292.468 |
| cellx1000 | heap limit | 1.170 | 1.718 | 0.449 | 0.408 |
| cellx2500 | heap limit | 3.553 | 4.972 | 1.368 | 1.313 |
| 2-10x5 - lazy80% | 770.996 | 1134.718 | 1047.007 | 164.226 | 226.030 |
| 6-10x10 - dyn25% - lazy80% | timeout | 386.539 | 560.204 | 116.541 | 163.830 |
| 4-1000x12 - dyn5% | timeout | 977.982 | 1150.520 | 296.546 | 480.244 |
| 25-1000x5 | 20440.790 | 969.347 | 1375.553 | 342.147 | 496.551 |
| 3-5x500 | heap limit | 260.565 | 425.016 | 90.049 | 124.681 |
| 6-100x15 - dyn50% | heap limit | 488.133 | 704.278 | 235.935 | 259.845 |
| Geometric mean vs row fastest (14/20 shared passes) | 6.26× | 3.85× | 5.85× | 1.05× | 1.46× |
| Upstream adapter checks | failed | passed | passed | passed | passed |

## Executed callbacks

Computed / effect callbacks. Kairo counts cover one warmed invocation, cellx covers graph creation plus one update, S.js totals aggregate one sample per subcase, and dynamic rows show the built-in computed count for the last timed replay. Dynamic effect counts are unavailable. The JSON includes the full-size dynamic verification counts and S.js subcases.

| Workload | what | Solid 1.9 | Solid 2.0 signals | Alien | Preact |
| --- | --- | --- | --- | --- | --- |
| avoidablePropagation | 5,005 / 1,001 | 2,002 / 0 | 2,002 / 0 | 2,002 / 0 | 2,002 / 0 |
| broadPropagation | 5,100 / 2,550 | 5,100 / 2,550 | 5,100 / 2,550 | 5,100 / 2,550 | 5,100 / 2,550 |
| deepPropagation | 2,550 / 51 | 2,550 / 51 | 2,550 / 51 | 2,550 / 51 | 2,550 / 51 |
| diamond | 3,006 / 501 | 3,006 / 501 | 3,006 / 501 | 3,006 / 501 | 3,006 / 501 |
| mux | 3,618 / 1,800 | 1,836 / 18 | 1,836 / 18 | 1,836 / 18 | 1,836 / 18 |
| repeatedObservers | 101 / 101 | 101 / 101 | 101 / 101 | 101 / 101 | 101 / 101 |
| triangle | 1,010 / 101 | 1,111 / 101 | 1,010 / 101 | 1,010 / 101 | 1,010 / 101 |
| unstable | 402 / 101 | 303 / 101 | 302 / 101 | 202 / 101 | 202 / 101 |
| molBench | 11 / 6 | 10 / 4 | 10 / 4 | 9 / 4 | 9 / 4 |
| createSignals | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| createComputations | 0 / 675,100 | 0 / 675,100 | 0 / 675,100 | 0 / 675,100 | 0 / 675,100 |
| updateSignals | 0 / 11,300,400 | 0 / 11,300,400 | 0 / 11,300,400 | 0 / 11,300,400 | 0 / 11,300,400 |
| cellx1000 | — | 8,000 / 8,000 | 8,000 / 8,000 | 8,000 / 8,000 | 8,000 / 8,000 |
| cellx2500 | — | 20,000 / 20,000 | 20,000 / 20,000 | 20,000 / 20,000 | 20,000 / 20,000 |
| 2-10x5 - lazy80% | 3,480,000 / — | 8,400,000 / — | 3,480,000 / — | 3,480,000 / — | 3,480,000 / — |
| 6-10x10 - dyn25% - lazy80% | — | 1,290,000 / — | 1,155,000 / — | 1,155,000 / — | 1,155,000 / — |
| 4-1000x12 - dyn5% | — | 1,463,000 / — | 1,463,000 / — | 1,463,000 / — | 1,463,000 / — |
| 25-1000x5 | 732,000 / — | 732,000 / — | 732,000 / — | 732,000 / — | 732,000 / — |
| 3-5x500 | — | 1,246,500 / — | 1,246,500 / — | 1,246,500 / — | 1,246,500 / — |
| 6-100x15 - dyn50% | — | 1,078,000 / — | 1,078,000 / — | 1,078,000 / — | 1,078,000 / — |

## Failed or incomplete cases

- **what / adapter checks** — failed during adapter.
  - what | static graph. Expected `11`, observed `14`.
  - what | static graph, read 2/3 of leaves. Expected `41`, observed `44`.
- **what / cellx1000** — heap limit during cellx1000 build and first update.
- **what / cellx2500** — heap limit during cellx2500 build and first update.
- **what / 6-10x10 - dyn25% - lazy80%** — timeout during dynamic graph warmup.
- **what / 4-1000x12 - dyn5%** — timeout during dynamic graph warmup.
- **what / 3-5x500** — heap limit during dynamic graph warmup.
- **what / 6-100x15 - dyn50%** — heap limit during dynamic graph warmup.

See results.json for sample arrays, per-case exit status and assertion details. These synthetic graph workloads measure different work across engines when callbacks are skipped or retried. Ratios apply only to the shared passing workload set.
