# What Framework — Real Benchmark Results

**Date:** 2026-02-14
**Tool:** js-framework-benchmark (official, https://github.com/krausest/js-framework-benchmark)
**Method:** Headless Chrome, CPU 4x throttle, 15 iterations, trace-based timing
**Hardware:** MacBook Pro (same machine for both runs)

## Duration Benchmarks (median total, ms — lower is better)

| Benchmark | Vanilla JS | What v0.1.0 | Ratio | Overhead |
|---|---|---|---|---|
| Create 1,000 rows | 28.6ms | 37.0ms | 1.29x | +8.4ms |
| Replace 1,000 rows | 33.0ms | 45.5ms | 1.38x | +12.5ms |
| Update every 10th row (x16) | 18.6ms | 70.8ms | **3.81x** | +52.2ms |
| Select row | 5.0ms | 52.6ms | **10.52x** | +47.6ms |
| Swap rows | 20.0ms | 66.0ms | **3.30x** | +46.0ms |
| Remove row | 15.6ms | 41.2ms | **2.64x** | +25.6ms |
| Create 10,000 rows | 301.0ms | 384.9ms | 1.28x | +83.9ms |
| Append 1,000 rows | 34.8ms | 55.2ms | 1.59x | +20.4ms |
| Clear 1,000 rows (x8) | 14.0ms | 31.2ms | 2.23x | +17.2ms |

**Geometric Mean: 2.42x**

## Memory (MB)

| Metric | Vanilla JS | What v0.1.0 |
|---|---|---|
| Ready memory | 0.56 MB | 0.57 MB |
| Run 1k memory | 2.03 MB | 3.63 MB |
| Run+clear memory | 0.62 MB | 0.79 MB |

## Bundle Size

| Metric | Vanilla JS | What v0.1.0 |
|---|---|---|
| Uncompressed | 11.3 KB | 14 KB |
| Compressed (gzip) | 2.5 KB | 4.8 KB |

## Comparison to Published Scores

| Framework | Score |
|---|---|
| vanillajs | 1.00x (baseline) |
| solid v1.9 | 1.11x |
| svelte v5 | 1.13x |
| preact v10 | 1.24x |
| vue v3.6 | 1.29x |
| angular v19 | 1.52x |
| react v19 | 1.54x |
| **What v0.1.0** | **2.42x** |

## Root Cause Analysis

### Good: Creation operations (1.28-1.59x)
The `h()` → vnode → reconcile → DOM path works well for bulk creation. Script overhead is modest (5-14ms), and the rest is browser paint time which is roughly equal across frameworks.

### Bad: Partial update operations (2.64-10.52x)
This is the architectural bottleneck. When ANY signal changes:

```
signal.set() → App component effect re-runs → creates ALL 1000 vnodes → reconciles EVERY row
```

Even to change 1 CSS class on 1 row, the framework rebuilds the entire vnode tree and diffs every single node. This is the same fundamental problem as React without memo/useMemo, but worse because we don't even have those escape hatches working at the row level.

### Moderate: Clear (2.23x)
Disposal overhead from cleaning up effects and DOM nodes. The `<what-c>` custom element wrapper adds per-component teardown cost.

## What Needs to Change

The partial update operations account for ~80% of the score gap. Fixing them requires:

1. **Fine-grained reactivity at the DOM level** — signals should update individual DOM properties directly, not trigger full component re-renders
2. **Per-row effects** — each row should have its own reactive scope so changing one row doesn't touch the others
3. **Skip static subtree diffing** — the button toolbar never changes, don't rebuild its vnodes

These changes would bring partial updates from 40-50ms script time down to <1ms, which would drop the geometric mean from 2.42x to approximately 1.2-1.4x.
