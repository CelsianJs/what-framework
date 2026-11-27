# Signal-engine benchmark

**Full-size run.**

- 2026-11-27T01:32:53.350Z · 240.3 s wall time
- Node v22.13.1, V8 12.4.254.21-node.22
- Apple M3 Max (14 logical CPUs, 96 GiB), darwin 25.5.0 arm64
- Upstream commit `56eb45e84b3f6fcfa867840725e66b59a9b7467a`
- Working-tree What reactive.js SHA-256 `d26fb2ed70fd79a854f4778354a49f9a4691542264f0f8895beb00fd982441a4`
- Solid 1.9.20, @solidjs/signals 2.0.3, Alien 3.2.1, Preact 1.14.5
- Case limit 180 s, V8 old-space limit 768 MiB per child process

## Elapsed milliseconds

Each cell is the median of raw samples. The S.js rows retain the upstream sum of fastest per-subcase samples. Failed and incomplete runs have no ranked timing.

| Workload | what | Solid 1.9 | Solid 2.0 signals | Alien | Preact |
| --- | --- | --- | --- | --- | --- |
| avoidablePropagation | 49.997 | 166.390 | 236.032 | 39.943 | 51.788 |
| broadPropagation | 96.423 | 364.070 | 610.277 | 75.693 | 87.308 |
| deepPropagation | 33.158 | 152.109 | 204.297 | 24.098 | 37.788 |
| diamond | 57.290 | 219.896 | 377.580 | 48.957 | 60.587 |
| mux | 95.789 | 213.951 | 214.665 | 83.459 | 95.430 |
| repeatedObservers | 6.025 | 29.645 | 65.492 | 5.770 | 6.801 |
| triangle | 21.033 | 73.022 | 127.101 | 18.584 | 22.322 |
| unstable | 13.324 | 46.403 | 115.600 | 13.157 | 16.829 |
| molBench | 17.873 | 22.152 | 24.177 | 18.295 | 18.137 |
| createSignals | 8.302 | 8.954 | 9.568 | 0.984 | 9.632 |
| createComputations | 77.855 | 198.200 | 253.995 | 67.516 | 121.258 |
| updateSignals | 268.160 | 783.644 | 1728.002 | 296.980 | 333.461 |
| cellx1000 | 0.670 | 1.193 | 1.836 | 0.405 | 0.421 |
| cellx2500 | 2.016 | 4.255 | 4.473 | 1.232 | 1.151 |
| 2-10x5 - lazy80% | 184.159 | 1131.265 | 1031.040 | 162.489 | 217.544 |
| 6-10x10 - dyn25% - lazy80% | 122.914 | 389.694 | 574.011 | 120.710 | 159.470 |
| 4-1000x12 - dyn5% | 333.366 | 997.448 | 1095.048 | 307.343 | 483.193 |
| 25-1000x5 | 364.224 | 976.568 | 2125.715 | 341.530 | 534.701 |
| 3-5x500 | 94.097 | 296.534 | 555.329 | 96.119 | 130.360 |
| 6-100x15 - dyn50% | 329.008 | 970.175 | 1129.336 | 324.772 | 395.344 |
| Geometric mean vs row fastest (20/20 shared passes) | 1.28× | 3.69× | 5.39× | 1.01× | 1.41× |
| Upstream adapter checks | passed | passed | passed | passed | passed |

## Executed callbacks

Computed / effect callbacks. Kairo counts cover one warmed invocation, cellx covers graph creation plus one update, S.js totals aggregate one sample per subcase, and dynamic rows show the built-in computed count for the last timed replay. Dynamic effect counts are unavailable. The JSON includes the full-size dynamic verification counts and S.js subcases.

| Workload | what | Solid 1.9 | Solid 2.0 signals | Alien | Preact |
| --- | --- | --- | --- | --- | --- |
| avoidablePropagation | 2,002 / 0 | 2,002 / 0 | 2,002 / 0 | 2,002 / 0 | 2,002 / 0 |
| broadPropagation | 5,100 / 2,550 | 5,100 / 2,550 | 5,100 / 2,550 | 5,100 / 2,550 | 5,100 / 2,550 |
| deepPropagation | 2,550 / 51 | 2,550 / 51 | 2,550 / 51 | 2,550 / 51 | 2,550 / 51 |
| diamond | 3,006 / 501 | 3,006 / 501 | 3,006 / 501 | 3,006 / 501 | 3,006 / 501 |
| mux | 1,836 / 18 | 1,836 / 18 | 1,836 / 18 | 1,836 / 18 | 1,836 / 18 |
| repeatedObservers | 101 / 101 | 101 / 101 | 101 / 101 | 101 / 101 | 101 / 101 |
| triangle | 1,010 / 101 | 1,111 / 101 | 1,010 / 101 | 1,010 / 101 | 1,010 / 101 |
| unstable | 202 / 101 | 303 / 101 | 302 / 101 | 202 / 101 | 202 / 101 |
| molBench | 9 / 4 | 10 / 4 | 10 / 4 | 9 / 4 | 9 / 4 |
| createSignals | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| createComputations | 0 / 675,100 | 0 / 675,100 | 0 / 675,100 | 0 / 675,100 | 0 / 675,100 |
| updateSignals | 0 / 11,300,400 | 0 / 11,300,400 | 0 / 11,300,400 | 0 / 11,300,400 | 0 / 11,300,400 |
| cellx1000 | 8,000 / 8,000 | 8,000 / 8,000 | 8,000 / 8,000 | 8,000 / 8,000 | 8,000 / 8,000 |
| cellx2500 | 20,000 / 20,000 | 20,000 / 20,000 | 20,000 / 20,000 | 20,000 / 20,000 | 20,000 / 20,000 |
| 2-10x5 - lazy80% | 3,480,000 / — | 8,400,000 / — | 3,480,000 / — | 3,480,000 / — | 3,480,000 / — |
| 6-10x10 - dyn25% - lazy80% | 1,155,000 / — | 1,290,000 / — | 1,155,000 / — | 1,155,000 / — | 1,155,000 / — |
| 4-1000x12 - dyn5% | 1,463,000 / — | 1,463,000 / — | 1,463,000 / — | 1,463,000 / — | 1,463,000 / — |
| 25-1000x5 | 732,000 / — | 732,000 / — | 732,000 / — | 732,000 / — | 732,000 / — |
| 3-5x500 | 1,246,500 / — | 1,246,500 / — | 1,246,500 / — | 1,246,500 / — | 1,246,500 / — |
| 6-100x15 - dyn50% | 1,078,000 / — | 1,078,000 / — | 1,078,000 / — | 1,078,000 / — | 1,078,000 / — |

## Failed or incomplete cases

None.

See results.json for sample arrays, per-case exit status and assertion details. These synthetic graph workloads measure different work across engines when callbacks are skipped or retried. Ratios apply only to the shared passing workload set.
