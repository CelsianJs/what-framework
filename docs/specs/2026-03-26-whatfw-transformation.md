# WhatFramework Transformation Spec

**Date:** 2026-03-26
**Decision:** Commit to fine-grained rendering. Kill VDOM. Beat React. Approach vanilla JS.
**Market Position:** "Solid's speed with React's ecosystem."

---

## Architecture: Fine-Grained Only

### What We're Keeping
- `packages/core/src/reactive.js` — Signal system (with upgrades below)
- `packages/core/src/render.js` — Fine-grained renderer (template, insert, mapArray)
- `packages/compiler/` — Babel plugin fine-grained mode (with upgrades)
- `packages/server/` — SSR (with real hydration added)
- `packages/router/` — Client routing (with security fixes)
- `packages/react-compat/` — React compat layer (rewritten for fine-grained)

### What We're Deleting
- `packages/core/src/dom.js` — VDOM reconciler (1,184 lines). Gone entirely.
- All `h()` function usage in demos, examples, docs-site
- VDOM mode in compiler (`babel-plugin.js` legacy path)
- `<what-c>` custom element wrapper system

---

## Sprint 1: Core Performance & Security (Dev Agents 1-3)

### Dev 1: Reactive System Upgrade
**Goal: Topological ordering + iterative evaluation = no glitches, no stack overflow**

1. **Add topological ordering to reactive graph**
   - Each computed/effect gets a `_level` (depth from source signals)
   - When signal writes, collect all dirty nodes, sort by level ascending, execute in order
   - This prevents diamond dependency glitches (effect sees consistent state)
   - Reference: Solid's `runUpdates` with `Updates` queue sorted by `_state`

2. **Convert computed evaluation from recursive to iterative**
   - Walk dependency chain collecting dirty computeds into a stack
   - Evaluate bottom-up (deepest dependency first)
   - Eliminates stack overflow at depth 3500+

3. **Ownership tree for automatic disposal**
   - Components create an owner scope. Child components are owned by parent.
   - When parent disposes, all children dispose automatically.
   - No more orphaned subscriptions from createRoot leaks.

4. **Benchmark gate: must match or beat Solid's signal throughput**
   - Signal create: >10M ops/s
   - Signal read: >5M ops/s
   - Batch 100K writes: <5ms

### Dev 2: Delete VDOM + Compiler Hardening
**Goal: Single rendering path, smarter compiler**

1. **Delete dom.js entirely** — remove all imports, update all re-exports
2. **Delete h() function** — or keep only as JSX factory that feeds into fine-grained path
3. **Remove VDOM mode from compiler** — delete legacy transform path, remove fallback-to-VDOM
4. **Improve reactivity detection in compiler**
   - Track which identifiers are signals (from `useSignal`, `signal()`, `computed()` calls)
   - Only wrap signal reads in effects, not all function calls
   - `Math.max(a, b)` should NOT be wrapped; `count()` (where count is a signal) SHOULD be
5. **Hoist templates to module scope** — eliminate IIFE wrappers per element
6. **Component functions run ONCE** — compiler must ensure component body is not re-executed
   - JSX expressions become individual effects bound to DOM nodes
   - Props are reactive (accessed via getter, not re-passed)

### Dev 3: Security Fixes + SSR Hydration
**Goal: Fix all HIGH/MEDIUM security issues, implement real DOM hydration**

1. **Security fixes (all from audit)**
   - Sanitize `javascript:`, `data:`, `vbscript:` URLs in router navigate(), Link, and setProp for href/src/action
   - Remove plain-string `innerHTML` prop — keep only `dangerouslySetInnerHTML`
   - Fix `escapeHtml`: add single-quote escape (`&#39;`)
   - Fix compiler `escapeAttr`: add `<` and `>` escape
   - Add CSRF token to `enhanceForms` fetch requests
   - Use `crypto.getRandomValues()` in CSRF fallback (not Math.random)
   - Make `template()` non-public or add dev-mode assertion

2. **Real DOM hydration**
   - Server renders HTML with hydration markers (comments or data attributes)
   - Client walks existing DOM nodes instead of creating new ones
   - `hydrateRoot(container, component)` reuses server HTML
   - Hydration mismatch detection with dev-mode warnings
   - Islands hydration also reuses DOM (not destroy+recreate)

3. **Router scroll restoration fix**
   - Save scroll position on SPA navigation (before pushState)
   - Restore on popstate (back/forward)
   - Handle same-page hash links without full route re-match

---

## Sprint 2: React Compat for Fine-Grained + Examples

### React Compat Rewrite for Fine-Grained
The compat layer needs to work with fine-grained rendering where components run once:

1. **useState → signal** (already done, but verify with run-once semantics)
2. **useEffect → effect with cleanup** (already done)
3. **useLayoutEffect → synchronous pre-paint effect** (currently faked as useEffect — MUST FIX)
   - Use `requestAnimationFrame` + `queueMicrotask` timing or MutationObserver
4. **useRef → plain object** (works naturally with run-once)
5. **useMemo/useCallback → computed** (simpler with run-once — no deps array needed)
6. **Class components → wrapped in fine-grained renderer**
   - Component instance created once, `render()` wrapped in effect
   - Lifecycle methods fire at correct times

### Example Projects (2 apps to stress-test the framework)
1. **TodoMVC** — Standard benchmark app. Must pass all TodoMVC specs.
2. **Dashboard with data tables** — Real-world app: sortable tables, charts, filters, API calls. Tests list performance, complex reactivity, and React compat (using react-window or similar).

---

## Performance Targets

| Benchmark | Current | Target | Reference |
|-----------|---------|--------|-----------|
| Geometric mean vs vanilla | 2.42x | <1.15x | Solid is 1.07x |
| Create 1K rows | ? | <1.2x | Solid: 1.03x |
| Replace 1K rows | ? | <1.15x | Solid: 1.04x |
| Select row | 10.52x | <1.5x | Solid: 1.01x |
| Partial update | ? | <1.1x | Solid: 1.02x |
| Swap rows | ? | <1.1x | Solid: 1.02x |
| Remove row | ? | <1.1x | Solid: 1.02x |
| Startup time | ? | <1.3x | Solid: 1.09x |
| Memory | ? | <1.2x | Solid: 1.03x |

---

## Market Position: "React's ecosystem at Solid's speed"

**One-liner:** WhatFramework runs your React libraries at near-vanilla-JS speed without a virtual DOM.

**The pitch:**
- You already know JSX and React hooks
- Your favorite React libraries work (react-window, cmdk, zustand, etc.)
- But under the hood: fine-grained signals, no VDOM, no diffing
- Components run once. Only the specific DOM nodes that need updating get touched.
- Result: 10x faster renders than React, approaching vanilla JS

**Target audience:**
- React developers frustrated by re-render performance
- Teams that can't migrate to Solid because of React library dependencies
- Developers who want Solid's architecture but React's ecosystem

**Not competing with:**
- Svelte (different authoring model, different ecosystem)
- Preact (VDOM-based, different performance profile)
- Solid (lower-level, smaller React compat surface)

**Differentiator vs Solid:**
Solid's react-compat (`solid-react-compat`) is minimal. WhatFW's compat layer is deep (49+ packages working, class components, full lifecycle). If we can deliver Solid's speed WITH React compat, that's a genuine market position.
