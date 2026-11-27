# Signal-engine benchmark

**Full-size run.**

- 2026-11-27T05:21:42.233Z · 228.4 s wall time
- Node v22.13.1, V8 12.4.254.21-node.22
- Apple M3 Max (14 logical CPUs, 96 GiB), darwin 25.5.0 arm64
- Upstream commit `56eb45e84b3f6fcfa867840725e66b59a9b7467a`
- Working-tree What reactive.js SHA-256 `cb7dfcce995d19e8154268a7ee56db7fd9e433fb9b76d13d6cf59952d30b3286`
- Solid 1.9.20, @solidjs/signals 2.0.3, Alien 3.2.1, Preact 1.14.5
- Case limit 180 s, V8 old-space limit 768 MiB per child process

## Elapsed milliseconds

Each cell is the median of raw samples. The S.js rows retain the upstream sum of fastest per-subcase samples. Failed and incomplete runs have no ranked timing.

| Workload | what | Solid 1.9 | Solid 2.0 signals | Alien | Preact |
| --- | --- | --- | --- | --- | --- |
| avoidablePropagation | 51.373 | 166.413 | 242.049 | 41.248 | 51.856 |
| broadPropagation | 94.677 | 370.999 | 621.891 | 76.434 | 87.784 |
| deepPropagation | 36.086 | 169.370 | 226.752 | 24.288 | 42.711 |
| diamond | 62.859 | 242.930 | 410.461 | 54.515 | 65.944 |
| mux | 104.575 | 232.129 | 238.288 | 100.570 | 107.535 |
| repeatedObservers | 6.781 | 33.482 | 74.008 | 6.416 | 7.893 |
| triangle | 22.762 | 81.560 | 139.590 | 20.604 | 24.485 |
| unstable | 15.038 | 50.160 | 128.335 | 14.487 | 19.350 |
| molBench | 19.565 | 23.642 | 25.476 | 19.617 | 19.368 |
| createSignals | 8.110 | 7.319 | 10.830 | 1.090 | 5.883 |
| createComputations | 83.655 | 240.189 | 267.524 | 72.487 | 132.613 |
| updateSignals | 287.395 | 831.862 | 1793.618 | 307.062 | 328.456 |
| cellx1000 | 0.682 | 1.510 | 1.789 | 0.451 | 0.469 |
| cellx2500 | 2.491 | 4.197 | 4.735 | 1.500 | 1.359 |
| 2-10x5 - lazy80% | 193.171 | 1132.301 | 1104.126 | 168.036 | 222.809 |
| 6-10x10 - dyn25% - lazy80% | 122.857 | 436.183 | 597.341 | 121.551 | 160.232 |
| 4-1000x12 - dyn5% | 322.684 | 1000.862 | 1131.660 | 293.565 | 480.341 |
| 25-1000x5 | 364.255 | 949.588 | 1391.723 | 341.865 | 539.208 |
| 3-5x500 | 90.050 | 236.707 | 402.271 | 84.975 | 119.565 |
| 6-100x15 - dyn50% | 211.394 | 419.037 | 625.640 | 183.383 | 238.593 |
| Geometric mean vs row fastest (20/20 shared passes) | 1.28× | 3.58× | 5.17× | 1.01× | 1.38× |
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
