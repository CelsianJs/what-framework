# Pretext Integration — Design Spec

**Date:** 2026-04-09
**Status:** Draft — not yet implemented, not yet on a branch
**Author:** brainstormed with Claude
**Scope:** Integrate [@chenglou/pretext](https://github.com/chenglou/pretext) into what-framework as an optional text engine — providing DOM-free text measurement and rich text rendering components.

---

## Summary

Pretext (by Cheng Lou, Midjourney) is a 15KB zero-dependency TypeScript library that performs multiline text measurement and layout entirely outside the DOM. It uses Canvas `measureText()` for glyph widths, then pure arithmetic for line breaking — roughly 300-600x faster than DOM-based measurement and capable of 120fps text reflow.

This spec integrates Pretext into what-framework in two independent ways:

1. **Global measure-only mode** — a runtime opt-in that routes dynamic text through Pretext for measurement, yielding performance benefits without changing how text looks or behaves in the DOM.
2. **Alpha text components** — `<TextFlow>`, `<TextCanvas>`, `<TextSVG>` — explicit components for rich text layout (magazine-style columns, text flowing around shapes, canvas/SVG text rendering).

Both systems share one internal adapter and are **fully optional**. Pretext is a peer dependency, not a hard dependency. Apps that don't opt in get identical bytes and behavior.

---

## Goals

- **Truly native feel** — `configureText({ measure: true })` is a first-class framework option, not a third-party patch
- **Near-zero cost when off** — if the flag isn't set and the alpha components aren't imported, the 15KB Pretext library is never loaded. The adapter adds ~1KB of gating code to core (honestly acknowledged, not hidden). One negligible branch in `insert()`. Verified per-bundler in CI.
- **Optional dependency** — Pretext is a peer dep. Missing it fails loudly with clear install instructions, never silently
- **No core DX disruption** — the public API of the compiler, `template()`, `h()`, `insert()`, JSX syntax, and devtools (`what_lint`, `what_scaffold`, `what_fix`) is unchanged. `insert()` gains one config-gated branch in its body, but its signature and observable behavior (when the flag is off) are identical.
- **Validated performance** — the global measure hook only fires where benchmarks prove it wins. No theatre.
- **Alpha text components** — clearly labeled, scoped, and isolated from core rendering paths

## Non-Goals

- Text selection, a11y, or SEO support for `<TextCanvas>` / `<TextSVG>` in v1 (documented limitation, deferred)
- Changing how static text (baked into templates) is handled — static text never goes through Pretext
- Replacing browser text rendering globally — even in full measure mode, text still renders via DOM text nodes
- Framework-level plugin/middleware system (YAGNI — Pretext is the only known consumer)
- Server-side rendering integration (Pretext requires Canvas, which is browser-only; SSR text path unchanged)

---

## Architecture

Two independent systems sharing one internal adapter:

```
                    ┌─────────────────────────────┐
                    │  text-engine.js (internal)  │
                    │  - lazy imports pretext     │
                    │  - measureCache             │
                    │  - queryTextLayout()        │
                    └──────────────┬──────────────┘
                                   │
                ┌──────────────────┴──────────────────┐
                │                                     │
                ▼                                     ▼
    ┌────────────────────────┐          ┌──────────────────────────┐
    │ insert() measure hook  │          │ TextFlow/Canvas/SVG      │
    │ (opt-in via config)    │          │ (explicit components)    │
    │ - zero cost when off   │          │ - alpha, via /text entry │
    │ - text DOM unchanged   │          │ - tree-shaken if unused  │
    └────────────────────────┘          └──────────────────────────┘
```

### Independence guarantees

- Alpha components work **with or without** `configureText({ measure: true })`. They always use Pretext directly when rendered.
- The global measure hook works **without** importing any alpha component. It's a pure performance optimization — no markup changes required.
- Both share the `measureCache` — if `TextFlow` is used on one paragraph and the global hook measures a nearby text node, they reuse prepared segments when possible.

---

## Component 1: Configuration & Runtime Hook

### Public API

```js
import { configureText } from 'what-framework';

configureText({
  measure: true,  // enable Pretext-based measurement for dynamic text
  cacheSize: 1000, // optional — LRU cache bound (default 1000)
});
```

`configureText()` follows the existing `configureGuardrails()` convention in `packages/core/src/guardrails.js`. **No new generic `configure()` API is introduced** — this keeps the public surface minimal and matches the framework's existing config pattern.

### Configuration timing contract

- **Must be called once, before any component mounts.** If called after `mount()`, a console warning fires and the configuration is still applied, but already-inserted dynamic text will not be retroactively measured. Users get mixed behavior, which is documented as "don't do this."
- **Not reactive.** Changing the config mid-app does not invalidate the measure cache or trigger remeasurement. It's a startup setting.
- **Dev-mode assertion:** in dev builds, calling `configureText()` after the first `mount()` logs a structured warning via the existing error collector.

### Behavior when `measure` is `true`

- On first dynamic text insertion, `insert()` lazy-imports `@chenglou/pretext`
- Calls `prepare(text, fontInfo)` to segment and cache glyph widths via Canvas
- Calls `layout(containerWidth, lineHeight)` to compute line breaks arithmetically
- Writes the result to `textNode.data` as before — identical DOM output
- The framework now *knows* line breaks and block dimensions without triggering reflow

### Behavior when `measure` is `false` (default)

- The lazy `import()` never fires
- **Zero Pretext bytes in the bundle** (the 15KB library itself)
- **~1KB of gating/adapter code still exists in the core bundle** — the config check, font resolution helper, and the adapter's cache structure. This is honest overhead, not zero. Documented as such.
- A single branch exists in `insert()`: `if (textConfig.measure && typeof child === 'function')` — negligible runtime cost, only checked once per dynamic text insertion

### Where the hook adds real value

- Container sizing decisions that depend on text dimensions
- Layout calculations during window resize (re-running `layout()` with a new width is pure arithmetic)
- Signal-driven text updates where the framework would otherwise force reflow to measure
- Apps with many simultaneous dynamic text nodes

### Where the hook must skip (measured at runtime)

- Static text baked into `template()` — never goes through `insert()`
- Text that never changes dimensions (single-line, fixed-width containers)
- Cases where benchmarks show Pretext + Canvas measurement is slower than the browser's natural path

The hook is **opt-in at the config level** and **opt-in at the per-insertion level** — it only fires where it provably wins.

---

## Component 2: Pretext Adapter (Internal)

### Location

`packages/core/src/text-engine.js` — internal module, not exported from `what-framework`.

### Responsibilities

- Lazy-import `@chenglou/pretext` on first use
- Cache `prepare()` results keyed by `font + text` (glyph widths don't change for the same combo)
- Resolve font info from the DOM via `getComputedStyle(parent)` — reads `font-family`, `font-size`, `font-weight`, `font-style`, and `line-height`. Batched and amortized per parent element (one read per parent, reused across all its dynamic text children).
- Expose `queryTextLayout(el)` to internal framework code for reflow-free dimension queries
- LRU-bound the measure cache so long-running apps don't leak
- **Gate all measurement on font readiness** — see Font Loading Strategy below

### Font Loading Strategy

This is critical and was missed in v1 of the spec.

Canvas `measureText()` returns metrics for whichever font is currently loaded — if a custom web font hasn't finished loading, it measures the **fallback font**. If we cache those metrics, we serve stale wrong measurements forever.

**Strategy:**

1. Before any measurement, await `document.fonts.ready`. The adapter maintains a `fontsReady` promise; the first call to `measureText()` awaits it, subsequent calls are synchronous.
2. Subscribe to `document.fonts.addEventListener('loadingdone', ...)` — when new fonts load (e.g., lazy-loaded fonts, user-triggered font changes), **invalidate any cache entries whose font-family matches the newly loaded font.**
3. Provide an internal `clearMeasureCache(fontFamily?)` API for explicit invalidation.
4. In dev mode, warn if `measureText()` is called before fonts are ready — signals a misconfigured startup.

Consequence: the first text measurement after page load is async (awaits fonts.ready). All subsequent measurements are sync. This means the `insert()` hook may defer the first text insertion by a frame — we need to verify this doesn't cause visible layout shift.

### Sketch

```js
// Internal — not exported
let pretext = null;
const measureCache = new Map(); // key: "font|text" -> prepared segments
const MAX_CACHE_ENTRIES = 1000;

async function ensurePretext() {
  if (pretext) return pretext;
  try {
    pretext = await import('@chenglou/pretext');
    return pretext;
  } catch (err) {
    console.warn(
      'what-framework: text.measure requires @chenglou/pretext. ' +
      'Install it with: npm i @chenglou/pretext'
    );
    throw err;
  }
}

function measureText(text, font, containerWidth, lineHeight) {
  const key = `${font}|${text}`;
  let prepared = measureCache.get(key);
  if (!prepared) {
    if (measureCache.size >= MAX_CACHE_ENTRIES) {
      // LRU eviction — drop oldest entry
      const oldestKey = measureCache.keys().next().value;
      measureCache.delete(oldestKey);
    }
    prepared = pretext.prepare(text, font);
    measureCache.set(key, prepared);
  }
  return pretext.layout(prepared, containerWidth, lineHeight);
}
```

### Cache invalidation strategy

- Entries are evicted LRU-style when the cache exceeds `MAX_CACHE_ENTRIES` (default 1000, configurable via `configureText({ measure: true, cacheSize: 2000 })`)
- Signal-driven text that changes content invalidates its specific cache entry; same text at a new width reuses the prepared segments
- On font changes (rare) the cache can be cleared via an internal API

---

## Component 3: Alpha Text Components

### Export path

`what-framework/text` — a separate entry point, not bundled with core. Tree-shaken away entirely if unused.

### `<TextFlow>` — DOM-based magazine layout

```js
import { TextFlow } from 'what-framework/text';

h(TextFlow, {
  columns: 2,
  around: shapeSignal,      // signal returning shape path/rect to flow around
  width: () => containerWidth()
}, () => articleText())
```

- Uses Pretext's `layout()` to compute line breaks and positions
- Renders as positioned `<span>` elements inside a container `<div>`
- Reactive: `columns`, `width`, `around`, and text content can all be signals
- **Fallback:** if Pretext isn't installed, renders a plain `<div>` with CSS `column-count` (graceful degradation, no throw — this is the DOM-based variant). **Caveat:** the CSS fallback supports `columns` but not `around` — shape-flow requires Pretext and is silently dropped in the fallback. A console warning is emitted once per component if `around` is set without Pretext.

### `<TextCanvas>` — Canvas-based text

```js
import { TextCanvas } from 'what-framework/text';

h(TextCanvas, {
  width: 600, height: 400,
  font: '16px Inter',
  around: shapePath
}, () => text())
```

- Pretext computes layout; canvas paints via `CanvasRenderingContext2D.fillText()`
- Ideal for decorative text, data viz labels, creative effects
- **No text selection or a11y** — alpha, documented limitation
- **Fallback:** if Pretext isn't installed, throws a clear error at component creation time

### `<TextSVG>` — SVG-based text

```js
import { TextSVG } from 'what-framework/text';

h(TextSVG, {
  width: 600,
  around: shapePath
}, () => text())
```

- Pretext computes positions; renders as SVG `<text>`/`<tspan>` elements
- Scalable, styleable via CSS, works inside existing `<svg>` trees
- **No text selection** — alpha, documented limitation
- **Fallback:** if Pretext isn't installed, throws a clear error at component creation time

### Constraints (binding for all three)

- Live in `packages/core/src/text/` but only reachable via `what-framework/text` export
- Do **NOT** touch `insert()`, `template()`, the compiler, or any core rendering path
- Marked `@alpha` in JSDoc — API may change without a semver major
- Listed in package docs as experimental

---

## Dependency Strategy

### Peer dependency, not hard dependency

- `@chenglou/pretext` listed as an **optional peer dependency** in `packages/core/package.json`
- Apps that don't opt in don't install it, don't bundle it, don't ship it
- The lazy `import()` naturally handles missing dependency — rejected promise caught and surfaced as a clear error

### Error messages

- **Global measure mode + missing Pretext:** `console.warn` + fall back to native DOM text behavior. App continues to work.
- **Alpha component used + missing Pretext (TextFlow):** fall back to CSS columns, no error
- **Alpha component used + missing Pretext (TextCanvas/TextSVG):** throw at component creation: `"TextCanvas requires @chenglou/pretext. Install it with: npm i @chenglou/pretext"`

### Version pinning

- Peer dep specifies a version range compatible with the Pretext API we target
- Locked to a specific minor version initially since Pretext is new and may evolve

---

## Validation Plan

This is non-negotiable — the feature ships only when benchmarks prove it wins.

### Benchmark suite

Located at `packages/core/benchmarks/text-engine.bench.js`. Compares:

1. **100 static text nodes** — baseline, should show no difference (hook skips static)
2. **100 dynamic text nodes updating once** — measures cold-start overhead
3. **100 dynamic text nodes updating 60 times** — measures cached path (expected biggest win)
4. **Window resize reflow** — 1000 text nodes, container width changes — expected huge win since `layout()` is pure arithmetic
5. **Rapid signal-driven text changes** — measures cache hit rate and eviction behavior
6. **Single text node** — pathological case, expected to show overhead

### Acceptance criteria

- Scenarios 3 and 4 **must** show Pretext is ≥2x faster than native DOM measurement for the feature to ship as a default-ready option
- Scenario 6 **must not** show Pretext making things worse by more than 10% — if it does, the hook must detect and skip single-node cases
- Bundle size impact when `measure` is `false` and alpha components aren't imported: **≤1KB delta** (adapter gating code only — Pretext itself must be zero bytes)
- **Per-bundler bundle-size verification in CI:** Webpack, Vite, esbuild, Rollup. Each bundler's output is measured and asserted. If any bundler pulls Pretext into the main chunk when the flag is off, the PR fails.
- **Cross-reference lint check:** automated check that `packages/core/src/index.js` (and anything else in the main export path) does not import from `packages/core/src/text/`. Failing CI if violated.
- **Visual regression suite** for alpha components — pixel-diff tests for `<TextFlow>`, `<TextCanvas>`, `<TextSVG>` against reference images.
- **Hydration parity test:** SSR → hydrate with `configureText({ measure: true })` produces no visual change vs. hydration without the flag.

### Known risks and mitigations

#### Bundle size risks

| Risk | Severity | Mitigation |
|---|---|---|
| Dynamic `import()` tree-shaking varies by bundler | **High** | Per-bundler bundle-size tests in CI: Webpack, Vite, esbuild, Rollup. "Bundle analyzer" alone is not sufficient — each bundler configuration needs verification. |
| The `text-engine.js` adapter adds ~1KB to core even when off | Medium | Acknowledged explicitly in docs. Not claimed as "zero." Kept minimal and audited for dead-code elimination of unused branches. |
| `/text` subpath export can leak into main bundle via cross-reference | **High** | Enforce via lint rule or build check: `packages/core/src/index.js` must not import anything from `packages/core/src/text/`. Violations fail CI. |
| Optional peer dep triggers warnings in strict CI/lint tools | Low | Document in install guide. Users can suppress or ignore. |

#### Correctness risks

| Risk | Severity | Mitigation |
|---|---|---|
| Web fonts not loaded when measuring → stale metrics cached | **High** | Font Loading Strategy (see Component 2). `document.fonts.ready` gate + invalidation on `loadingdone` events. |
| Canvas `measureText()` diverges from actual rendering (subpixel, ligatures, kerning, font-feature-settings) | Medium | Validate against what-framework visual regression corpus. Document known divergences. Measure-mode is informational; alpha components position their own text so divergence is self-consistent. |
| `getComputedStyle()` triggers reflow | Low | Batch font resolution per parent, read once per insertion, cache on the parent element. |
| SSR hydration produces different text layout than client measurement | **High** | **Decision: hydration does NOT measure.** In hydration mode, the insert() hook skips Pretext entirely — the server already wrote text nodes, and we trust them. The measure cache is populated lazily as signal updates trigger remeasures. Documented as: "SSR hydration is unaffected by `configureText({ measure: true })`." |

#### Dependency and maintenance risks

| Risk | Severity | Mitigation |
|---|---|---|
| Pretext is 2 weeks old — API may evolve or break | **High** | Pin to specific minor version. Isolate all Pretext calls behind the adapter module so breaking changes can be absorbed in one place. Add adapter contract tests. |
| Pretext could be abandoned by Cheng Lou | Medium | **See Rollback Plan below.** The adapter boundary means we can swap Pretext for an alternative (or write our own) without touching the hook or the alpha components. |
| Benchmark suite rots if Pretext API changes | Medium | Run benchmarks in CI, not just locally. If they break, the PR goes red. |
| Alpha components set a precedent for "experimental-in-core" | Low | Documented as intentional pattern in contributor guide. If we don't want the pattern, we isolate these in a separate package instead. |

#### Repo cleanliness risks

| Risk | Severity | Mitigation |
|---|---|---|
| 6+ new files across multiple directories | Low | Scoped review — all new files live in predictable locations (`text-engine.js` at core root, `text/` subfolder for components). |
| `configureText()` is a new public API surface | Low | Matches existing `configureGuardrails()` convention — not a new paradigm. |
| Documentation commitment for alpha features | Medium | Label clearly as alpha in docs. Link to a "stability policy" section. Issues for alpha features are triaged at lower priority. |
| Testing infrastructure burden (visual, correctness, perf, bundler, integration) | Medium | Scoped to what's essential. Visual regression for alpha components. Correctness tests for the adapter. Bundle-size CI for core. Skip exhaustive cross-bundler matrix until the feature proves its value. |

---

## Rollback Plan

If Pretext becomes incompatible, abandoned, or fails to deliver measurable value, we need a clean exit path.

**The adapter boundary is the rollback boundary.** All Pretext-specific code lives in `packages/core/src/text-engine.js` and `packages/core/src/text/`. Nothing else imports `@chenglou/pretext` directly.

**To remove Pretext entirely:**
1. Delete `packages/core/src/text-engine.js`
2. Delete `packages/core/src/text/` and the `/text` subpath export
3. Remove the `insert()` hook branch (single-line revert)
4. Remove the `configureText()` export and the peer dep declaration
5. Mark the feature removed in CHANGELOG and update docs

**To replace Pretext with an alternative:**
1. Rewrite `text-engine.js` to call the new library's `prepare`/`layout` equivalents
2. No changes to `insert()`, `configureText()`, or the alpha components' public APIs
3. Update peer dep in `package.json`

**Time estimate for clean rollback:** under an hour, because the isolation is explicit and enforced.

---

## Delivery Plan

### Branch strategy

- **Not to main** until validated
- Feature branch: `feat/pretext-integration`
- PR stays open for review and benchmarking before merge
- If benchmarks don't meet acceptance criteria, PR is revised or closed — not merged as "good enough"

### PR contents

1. `packages/core/src/text-engine.js` — adapter (internal)
2. `packages/core/src/render.js` — minimal `insert()` hook (one branch, config-gated)
3. `packages/core/src/text/` — alpha components (TextFlow, TextCanvas, TextSVG)
4. `packages/core/package.json` — peer dep declaration, `./text` export path
5. `packages/core/benchmarks/text-engine.bench.js` — benchmark suite
6. `docs/TEXT-ENGINE.md` — user documentation with examples, caveats, and "when to use"
7. PR description documenting:
   - Benchmark results (real numbers, not claims)
   - Bundle size delta in both enabled and disabled states
   - Known limitations and edge cases
   - Visual regression test results

### What-framework specific checks

- `what_lint` must still pass on all existing and new code (no new warnings)
- `what_diagnose` must show no new reactive anti-patterns
- Existing tests must pass without modification
- New tests added for: adapter caching, insert hook gating, each alpha component's reactive behavior

---

## Open Questions (to resolve during implementation)

Reduced scope — the significant ones have been moved into the spec body or the Rollback Plan.

1. **Where exactly in `insert()` does the hook live?** Confirm during implementation that one branch at the function entry point is the minimum-invasive placement. Alternative: a separate `insertWithMeasure()` variant dispatched by config.
2. **LRU cache size default** — 1000 is a guess. Benchmark a realistic app to pick the right default. May become configurable per-app via `configureText({ cacheSize })`.
3. **Monorepo peer dep location** — `packages/core/package.json` is the leading candidate so users installing `what-framework` get prompted. Verify this propagates correctly through the monorepo's publish flow.

---

## Success Criteria

This integration is successful if:

- ✅ Apps that don't opt in see ≤1KB bundle delta (adapter only, Pretext itself zero) and zero behavior change
- ✅ Apps that enable `configureText({ measure: true })` get measurable performance wins on real scenarios (not synthetic benchmarks only) — ≥2x on the win scenarios
- ✅ Alpha components enable creative text layouts with clearly documented limitations
- ✅ Installation, error messages, and fallbacks are clear enough that a user hitting a missing-dep error can resolve it in under 30 seconds
- ✅ The PR lands on a feature branch, gets reviewed, and merges to main only after benchmarks prove the value
- ✅ Public APIs of the compiler, `template()`, `h()`, `insert()`, JSX, and devtools are unchanged
- ✅ Hydration parity test passes — SSR apps are not affected
- ✅ Rollback plan is executable in under an hour if needed

## Failure Criteria

This integration should be **rolled back or redesigned** if:

- ❌ Benchmarks fail to show ≥2x improvement on Scenarios 3 and 4
- ❌ Any bundler test shows Pretext pulled into the main chunk when the flag is off
- ❌ Adapter gating code exceeds ~1KB in the core bundle
- ❌ Any existing test breaks
- ❌ `what_lint` or `what_diagnose` surface new warnings
- ❌ Public APIs of compiler/template/h/insert change in any observable way
- ❌ Font loading strategy produces visible layout shift on first paint
- ❌ Hydration parity test fails
