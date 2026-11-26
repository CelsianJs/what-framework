# Signal-engine benchmark

**Full-size run.**

- 2026-11-26T21:51:03.128Z · 224.3 s wall time
- Node v22.13.1, V8 12.4.254.21-node.22
- Apple M3 Max (14 logical CPUs, 96 GiB), darwin 25.5.0 arm64
- Upstream commit `56eb45e84b3f6fcfa867840725e66b59a9b7467a`
- Working-tree What reactive.js SHA-256 `6c4608a4bb4de8cac1a3b7cec68babef1261a70e4cb798875c1d24363533bc16`
- Solid 1.9.20, @solidjs/signals 2.0.3, Alien 3.2.1, Preact 1.14.5
- Case limit 180 s, V8 old-space limit 768 MiB per child process

## Elapsed milliseconds

Each cell is the median of raw samples. The S.js rows retain the upstream sum of fastest per-subcase samples. Failed and incomplete runs have no ranked timing.

| Workload | what | Solid 1.9 | Solid 2.0 signals | Alien | Preact |
| --- | --- | --- | --- | --- | --- |
| avoidablePropagation | 49.215 | 162.455 | 234.666 | 38.226 | 50.374 |
| broadPropagation | 94.198 | 371.852 | 606.770 | 76.310 | 89.657 |
| deepPropagation | 32.345 | 152.374 | 207.350 | 24.085 | 37.699 |
| diamond | 57.019 | 216.188 | 381.897 | 50.612 | 59.015 |
| mux | 94.548 | 212.483 | 216.689 | 84.194 | 99.046 |
| repeatedObservers | 5.993 | 31.188 | 65.738 | 5.962 | 6.774 |
| triangle | 20.252 | 70.674 | 125.225 | 18.588 | 21.634 |
| unstable | 13.422 | 43.995 | 114.654 | 13.644 | 17.041 |
| molBench | 18.115 | 21.488 | 23.643 | 17.673 | 18.034 |
| createSignals | 8.618 | 7.433 | 11.286 | 1.014 | 7.285 |
| createComputations | 88.627 | 215.003 | 235.852 | 71.923 | 126.659 |
| updateSignals | 300.507 | 786.452 | 1721.768 | 317.314 | 315.928 |
| cellx1000 | 0.648 | 1.308 | 1.780 | 0.503 | 0.459 |
| cellx2500 | 1.936 | 3.939 | 4.426 | 1.201 | 1.290 |
| 2-10x5 - lazy80% | 187.002 | 1099.473 | 1122.999 | 164.376 | 223.477 |
| 6-10x10 - dyn25% - lazy80% | 133.341 | 429.705 | 582.041 | 118.786 | 173.987 |
| 4-1000x12 - dyn5% | 307.676 | 1003.592 | 1156.740 | 311.864 | 488.572 |
| 25-1000x5 | 383.964 | 991.810 | 1415.729 | 349.460 | 530.571 |
| 3-5x500 | 97.121 | 255.063 | 404.818 | 85.646 | 121.135 |
| 6-100x15 - dyn50% | 209.836 | 432.165 | 648.382 | 190.953 | 248.087 |
| Geometric mean vs row fastest (20/20 shared passes) | 1.27× | 3.53× | 5.15× | 1.01× | 1.39× |
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
