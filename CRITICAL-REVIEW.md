# WhatFramework Critical Review

**All findings addressed in v0.6.0 (2026-03-26).** See git log for fix commits.

---

**HISTORICAL DOCUMENT -- DO NOT USE AS CURRENT REFERENCE**

This review was conducted against the codebase at a point when two rendering systems coexisted
(VDOM reconciler in `dom.js` and fine-grained renderer in `render.js`). The architecture has
since been consolidated to **fine-grained only**: components run once, signals drive individual
DOM effects, and the VDOM reconciler is no longer the primary rendering path.

**Key criticisms that no longer apply:**
- "The framework can't decide what it is" (dual rendering) -- resolved, fine-grained is the sole model
- "Components re-render fully on any signal change" -- resolved, components run once
- "No topological ordering" -- resolved, topological sort is implemented
- "Stack overflow at ~3,500 computed depth" -- resolved, iterative evaluation handles 10K+ chains

**Sections that remain relevant:** Security findings (Section 3), some competitive position
observations (Section 4), and the signal system / LIS reconciler praise (Section 5).

For current architecture documentation, see `/docs/ARCHITECTURE.md`.

---

**Date:** 2026-03-26
**Reviewers:** 4 parallel review agents (Architecture, Build/Test, Security, Competitive)
**Codebase:** ~12K LOC across 13 packages, all JavaScript (no TypeScript source)

---

## TL;DR

WhatFramework is a well-engineered research project with a clean reactive core, but it is architecturally stuck between two rendering models, slower than the frameworks it claims to beat, and lacks the ecosystem/community to compete commercially. The code quality is genuinely good for its age — the signal system works, SSR is correct, and the React compat layer handles real libraries. But it is not ready for production and has no clear market position against Solid, Svelte, or Preact.

**Verdict: Worth keeping as a learning asset and potential technology source for the Vura platform, but not viable as a standalone open-source framework competitor.**

---

## 1. Does It Actually Work?

**Yes.** The framework builds, runs, and mostly works.

| Metric | Result |
|--------|--------|
| Build | Clean, no errors |
| Tests | 255 pass / 2 fail (fixture mismatches, not bugs) |
| SSR 10K rows | 14.6ms, 573KB output, correct HTML |
| Signal create | 8.4M ops/s |
| Signal read | 3.4M ops/s |
| Signal write (1 sub) | 697K ops/s |
| Batch 100K writes | 9.3ms (effect runs exactly once) |
| React compat | Builds react-window, cmdk, sonner, styled-components, emotion |
| Memory leaks | None detected (effects properly unsubscribe on disposal) |

The 2 test failures are in `file-router.test.js` — they expect `/about` but the file is `About.jsx` (case mismatch). Not a framework bug.

---

## 2. Architecture: The Core Problem

### The framework can't decide what it is.

There are **two completely independent rendering systems** that coexist:

| System | File | How it works | Like... |
|--------|------|-------------|---------|
| **VDOM Reconciler** | `dom.js` (1,184 lines) | Creates VNodes via `h()`, diffs against live DOM, patches in place. Components re-render fully on any signal change. | Preact |
| **Fine-Grained Renderer** | `render.js` (786 lines) | `template()` clones static HTML, `insert()` binds reactive expressions directly to DOM nodes. Components run once. | Solid |

The compiler defaults to fine-grained mode, but the demo app uses raw `h()` calls (VDOM mode). The two systems don't integrate — they're parallel codepaths that double the bug surface.

### Signal System: Solid but Not Solid-Level

The reactive primitives (signal, computed, effect, batch, memo) are clean and correct for common cases. Good decisions:
- `Object.is` for equality (handles NaN, -0)
- Microtask scheduling via `queueMicrotask`
- Infinite loop detection (25-iteration cap)
- `batch()` for update coalescing
- `createRoot` for scoped disposal

**But it lacks topological ordering.** Solid uses a sorted execution graph to guarantee no glitches in diamond dependency patterns. WhatFW doesn't — complex reactive graphs (3+ levels of computed chaining) can show inconsistent intermediate states. In practice this is rare, but it's a correctness gap.

**Stack overflow at ~3,500 computed depth.** Lazy evaluation is recursive. A chain of 5,000 computeds hits `RangeError: Maximum call stack size exceeded`. Fix: convert to iterative evaluation.

### SSR: Correct But Fake Hydration

SSR produces correct, escaped HTML. Streaming works. Server actions have proper CSRF protection.

**But there is no real hydration.** The client throws away all server-rendered HTML and re-renders from scratch. From the source: `"Basic implementation -- mounts fresh (true hydration would reuse existing DOM)"`. This defeats the entire performance purpose of SSR.

The islands architecture has the right concept (priority-based hydration: load, idle, visible, action, media) but each island also destroys its server HTML and re-renders client-side.

### Compiler: Basic Babel Transform

The compiler is a Babel plugin (not SWC — slower) with two modes. The fine-grained mode does template extraction and wraps dynamic expressions in effects, which is the right approach. But:

- **Naive reactivity detection** — any `CallExpression` is treated as reactive. `Math.max(a,b)` gets unnecessarily wrapped in an effect.
- **No dead code elimination, no scope analysis, no HMR support** for fine-grained mode
- **Falls back silently to VDOM** when template extraction produces empty HTML, creating mixed output
- **Templates wrapped in IIFEs** instead of hoisted to module scope (extra function allocation overhead)

### React Compat: Impressive Surface, Shallow Depth

49 packages confirmed working. The API coverage is genuinely broad — createElement, forwardRef, Children, class components with full lifecycle, hooks, useSyncExternalStore.

**What's faked:**
- `useLayoutEffect` = `useEffect` (same timing — breaks react-modal, react-popper, any position calculation)
- `useInsertionEffect` = `useEffect` (breaks CSS-in-JS libraries that depend on insertion phase)
- `startTransition` = `queueMicrotask(batch(fn))` (no priority scheduling)
- `StrictMode` = passthrough
- No error boundaries for class components
- `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED` is a stub

---

## 3. Security Findings

### HIGH Severity (3)

| # | Issue | Location |
|---|-------|----------|
| 1 | **`innerHTML` prop bypasses escaping without scary name.** Unlike React's `dangerouslySetInnerHTML`, plain `innerHTML={userInput}` silently injects raw HTML. | `core/src/dom.js:1110`, `core/src/render.js:717` |
| 2 | **Router doesn't validate `javascript:` URLs.** `navigate("javascript:alert(1)")` and `<Link href="javascript:...">` are not sanitized. Middle-click opens in new tab, bypassing click handler. | `router/src/index.js:30-65, 310-349` |
| 3 | **No `javascript:` URL sanitization on rendered `<a href>`.** `el.href = "javascript:alert(1)"` executes on click. React sanitizes this; WhatFW does not. | `core/src/dom.js:1142` |

### MEDIUM Severity (4)

| # | Issue | Location |
|---|-------|----------|
| 4 | **`template()` is a public API that parses raw HTML via innerHTML.** Compiler-only use is safe, but any dev calling `template(userInput)` gets XSS. | `core/src/render.js:14-18` |
| 5 | **SSR `escapeHtml` missing single-quote escape.** Breaks OWASP recommendations. | `server/src/index.js:240-246` |
| 6 | **Compiler `escapeAttr` missing `<` and `>` escape.** A source attribute like `title="foo><script>"` could break out. | `compiler/src/babel-plugin.js:577-579` |
| 7 | **`enhanceForms` submits via fetch without CSRF token.** Server actions have CSRF; enhanced forms bypass it. | `server/src/islands.js:356-386` |

### LOW Severity (4)

| # | Issue |
|---|-------|
| 8 | Island props stored as JSON in DOM attributes — tamperable |
| 9 | `Object.assign` in tagged template spread inherits from prototype |
| 10 | SSR style values not sanitized for CSS injection (`expression()`, `url()`) |
| 11 | CSRF token fallback uses `Math.random()` instead of `crypto.getRandomValues()` |

---

## 4. Competitive Position: Honest Assessment

### Benchmark Reality

The js-framework-benchmark geometric mean is **2.42x slower than vanilla**. For context:
- React: 1.54x
- Preact: 1.39x
- Solid: 1.07x
- Svelte: 1.12x

**WhatFW is slower than React on the standard benchmark.** This disqualifies the "fine-grained performance" marketing claim for the VDOM path.

### What's Genuinely Unique?

| Feature | Unique? | But... |
|---------|---------|--------|
| React compat backed by signals | Yes, interesting | Benchmark shows it's slower, not faster. Preact's compat is battle-tested with thousands of production deploys. |
| MCP DevTools (AI agent bridge) | Yes, novel | Developer tooling, not runtime. Too early to bet on. |
| Islands with hydration modes in JSX | No | Astro, Fresh did it first. |
| Dual rendering (VDOM + fine-grained) | Technically yes | It's a liability, not a feature. Pick one. |

### Who Would Actually Use This?

Honestly? Almost no one in 2026.

- **Not production teams** — no ecosystem, no community, no hiring pipeline
- **Not performance-sensitive apps** — slower than React
- **Not React refugees** — Solid and Svelte are mature alternatives with communities
- **Not beginners** — React/Next.js has vastly better learning resources

The **only credible niche** is as an educational/research framework — the codebase is small (~12K LOC), readable, and well-structured. As a "learn how frameworks work" project, it's excellent.

### Market Timing

The window for "signals-based React alternative" was 2022-2023. React Compiler, Svelte 5 runes, Angular signals, and Vue's existing reactivity have absorbed the signals wave. The market is consolidating, not fragmenting.

---

## 5. What's Actually Worth Keeping

Despite the critical tone, there IS real value here:

1. **The signal system** — clean, correct, performant for normal use. Good foundation.
2. **The fine-grained renderer** (`render.js`) — the LIS-based keyed reconciliation is well-implemented. Per-item `createRoot` scopes are correct.
3. **Server actions** — CSRF protection, constant-time comparison, optimistic updates with rollback. Surprisingly mature.
4. **The codebase itself** — small, readable, well-commented. A good reference implementation.

---

## 6. Recommendations

### If Continuing as a Standalone Framework

1. **Pick ONE rendering model.** Either commit to fine-grained (Solid-style) and delete the VDOM reconciler, or commit to VDOM (Preact-style) and optimize it. The dual approach is the root cause of the identity crisis.
2. **Implement real hydration.** SSR without DOM reuse is just a slower SPA.
3. **Add topological ordering** to the reactive graph to prevent diamond dependency glitches.
4. **Fix the security issues.** At minimum: sanitize `javascript:` URLs, remove plain `innerHTML` prop, fix `escapeHtml` and `escapeAttr`.
5. **Drop the "faster than React" claim** until benchmarks actually support it.
6. **Write comprehensive tests** — especially for reactive edge cases and reconciliation.

### If Pivoting to Internal Use (Vura Platform)

The most pragmatic path. Use WhatFW as the rendering layer for Vura's dashboard and marketing sites. Don't compete with Solid/React/Svelte in the open market. Instead:
- Keep the signal system as the reactive foundation
- Use the fine-grained renderer for Vura's own UI
- Don't invest in React compat (use your own framework for your own platform)
- Focus engineering time on Vura (the deployment platform) and CelsianJS (the backend) where there's actual commercial opportunity

### If Archiving

The code is clean enough to be a portfolio piece or open-source reference. Write a blog post about what was learned. The signal implementation and LIS reconciler are worth studying.

---

## Appendix: File Counts by Package

| Package | Lines | Quality |
|---------|-------|---------|
| core/reactive.js | 384 | 7/10 |
| core/dom.js | 1,184 | 6/10 |
| core/render.js | 786 | 7.5/10 |
| compiler/babel-plugin.js | 1,203 | 5/10 |
| server/ (3 files) | ~1,125 | 5/10 |
| router/ | 587 | 6/10 |
| react-compat/ (6 files) | ~1,014 | 5/10 |
| **Total (core packages)** | **~11,800** | |
