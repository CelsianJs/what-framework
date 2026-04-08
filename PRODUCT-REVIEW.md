# What Framework — Critical Product Review

*Reviewed: 2026-04-08 (updated) | Version: 0.6.0 | Rating: 7/10*

---

## 1. What Is It?

What Framework is a signal-based reactive web framework written in JavaScript (with TypeScript definitions) that compiles JSX to direct DOM operations — no virtual DOM, no re-renders. It's a monorepo of 13 packages (~24,200 LOC of framework code, ~11,700 LOC of tests) at version 0.6.0, pre-1.0, under active development by a single maintainer for roughly 6 weeks. Its stated positioning is "the web framework built for AI agents," with MCP-based devtools as its headline feature.

---

## 2. Is It Real?

**Yes, this is functioning software with serious engineering behind it.**

**What works:**

- **Reactive core** — signals, computed, effects, batch with topological ordering and iterative evaluation handling 10,000+ computed chains without stack overflow. Recent optimizations brought signal read overhead from 4.01x to 1.26x vanilla.
- **Fine-grained DOM rendering** — template cloning + per-binding effects. No virtual DOM. Compiler extracts static HTML into module-level templates, cloned via `cloneNode(true)`.
- **18-tool MCP devtools** — live browser inspection via WebSocket bridge with token-based auth, zod-validated schemas, and structured responses with `summary + details + nextSteps`.
- **Compiler** (Babel plugin) — static template extraction, reactive expression detection, event delegation. Vite plugin with HMR boundary support.
- **Router** — file-based + programmatic, nested layouts, View Transitions API, scroll restoration, URL sanitization.
- **SSR** — streaming, islands architecture with 6 hydration modes (load, idle, visible, action, media, static), server actions with CSRF protection.
- **React compat** — confirmed working with 49+ libraries (zustand, framer-motion, radix-ui, react-query, cmdk, emotion, styled-components, etc.).
- **Interactive playground** — CodeMirror 6 editor, live iframe preview, 10 examples, console capture, URL sharing, dark/light themes. Hosted at [playground.whatfw.com](https://playground.whatfw.com). Professional quality.
- **CLI** — `npm create what@latest` scaffolder, `what dev` with HMR.
- **ESLint plugin** — 9 signal-specific lint rules.
- **14 example apps** — task manager, TodoMVC, dashboard, real-world suite.

**What's not yet built:**

- ~~**Hosted playground**~~ — now deployed at [playground.whatfw.com](https://playground.whatfw.com) and linked from README
- **True progressive hydration** — some SSR paths destroy server HTML and re-render fresh
- **Production profiling** — devtools are dev-mode only
- **Component library ecosystem** — zero third-party packages
- **Community infrastructure** — no Discord, GitHub Discussions, or forums

**Tests:** 653+ tests across 26+ test files using Node's native test runner. ~11,700 LOC of test code. Nearly 1:1 test-to-source ratio for the core package. Tests cover topological ordering, diamond dependencies, deep computed chains (10K+), stack overflow prevention, XSS, CSRF, infinite loops, disposal/cleanup, hydration mismatches, and 11 documented gotchas. All 614 tests pass on Node 20 and 22.

**Verdict: This is real, working software with production-quality engineering in the core. The reactive system, compiler, devtools, and playground are all functional — not stubs.**

---

## 3. Is It Offering Something Unique?

### What's genuinely differentiated

**MCP DevTools for AI agents.** 18 structured tools let an AI agent inspect signals, effects, components, dependency graphs, and even mutate state in a running application — without opening browser DevTools. No competitor has anything like this. The implementation is thorough: 5,450 LOC, WebSocket bridge with crypto-based auth, zod schemas, structured JSON responses with suggested next steps.

**Agent-first error system.** Every error is a `WhatError` object: machine-readable code, human-readable message, suggested fix, code example, file/line/component context. JSON-serializable. 10+ documented error codes. No competitor provides machine-readable errors at this level.

**Runtime guardrails.** Catches developer mistakes at runtime with actionable messages: missing signal reads (`count` vs `count()`), infinite effect loops (25-iteration cap with specific effect names), signal writes during render, XSS via innerHTML (requires `{ __html: ... }` wrapper). These are safety nets most frameworks leave to linters.

**Batteries-included in zero dependencies.** Forms with Zod/Yup resolvers, SWR-like data fetching (useSWR, useQuery, useInfiniteQuery), spring/tween animations, accessibility utilities (focus traps, roving tabindex, ARIA helpers, screen reader announcements), 10 skeleton loaders, DOM scheduler — all in the core. No npm dependencies at runtime.

### What's NOT differentiated

- **Signal-based reactivity with components-run-once** — SolidJS does this with a more mature compiler and better performance (~1.05x vanilla vs What's ~2.42x)
- **Fine-grained DOM updates without VDOM** — SolidJS, Svelte 5 (runes), Vue 3.6 (Vapor Mode) all do this
- **Template cloning for static HTML** — SolidJS's compiler does this more aggressively with optimization passes
- **Small bundle size** — Preact + Signals is smaller (~5.6 KB); Svelte compiles to less; Qwik ships ~1 KB initial
- **JSX compilation** — standard approach shared with Solid, React, Preact
- **Islands architecture** — Astro, Fresh (Preact), SvelteKit, Qwik all have this

**Differentiation verdict: The MCP devtools, structured error system, and agent guardrails are genuinely novel — no competitor has them. The reactive core is well-built but architecturally similar to SolidJS. "Built for AI agents" is the only defensible moat.**

---

## 4. Who Is This For?

**Target users:**

- **AI-assisted developers** who use Claude Code, Cursor, or similar tools and want their framework to be debuggable by their AI agent — not just by them manually in Chrome DevTools
- **Solo developers and small teams** building internal tools where ecosystem size doesn't matter but DX, debugging speed, and batteries-included design do
- **Developers migrating from React** who want signals without learning a completely new paradigm (the React compat layer bridges 49+ libraries)

**Adjacent audiences:**

- **Framework learners** — the codebase is ~24K LOC of readable JavaScript with architecture docs, honest self-assessments, and 19 documented gotchas. Excellent educational resource.
- **AI agent builders** — teams building AI coding assistants could study this as a reference for how to make software agent-inspectable
- **Internal platform teams** — controlled stack, no community dependency needed, batteries-included eliminates third-party risk

**Who this is NOT for:**

- Teams that need to hire developers who already know the framework
- Performance-critical applications where every millisecond matters (benchmarks still lag competitors)
- Projects requiring a large component library ecosystem

**Market positioning:** This sits in the "opinionated alternative framework" space alongside Solid, Svelte, and Qwik — but positions itself on the AI-tooling axis rather than the performance axis. The question is whether "built for AI agents" is a category or a feature.

---

## 5. Security Audit

The security posture is **strong for a pre-1.0 framework** — above average for the space.

### Findings

| Severity | Finding | Location | Impact |
|----------|---------|----------|--------|
| HIGH | `what_eval` executes arbitrary JS in browser via `new Function()` | `devtools-mcp/src/client-commands.js:153` | Full browser context access (mitigated: requires `--unsafe-eval` flag + auth) |
| HIGH | `what_set_signal` allows arbitrary state mutation | `devtools-mcp/src/tools.js` | Can modify any signal value (mitigated: requires authenticated WebSocket) |
| MEDIUM | CORS `Access-Control-Allow-Origin: *` on token discovery endpoint | `devtools-mcp/src/bridge.js:57` | Token endpoint reachable from any origin (mitigated: requires localhost access + token for WS) |
| MEDIUM | `Object.assign` in `html` tagged template spread without prototype filtering | `core/src/h.js:137` | Prototype pollution if user passes `{__proto__: {...}}` in spread (mitigated: developer-controlled values) |
| LOW | Playground iframe not sandboxed | `sites/playground/src/preview.js:34-36` | User code has full DOM access (intentional: code needs `document.getElementById`) |

### What's Well-Protected (no vulnerabilities found)

| Area | Implementation | Assessment |
|------|---------------|------------|
| **XSS via innerHTML** | Requires `{ __html: ... }` wrapper; plain strings rejected with dev warning (`dom.js:651-673`) | Correct |
| **XSS via text rendering** | Uses `textContent` (auto-escapes HTML) (`render.js:200-201`) | Correct |
| **CSRF** | `crypto.randomUUID()` tokens, constant-time comparison, `X-CSRF-Token` header (`actions.js:44-68`) | Correct |
| **URL sanitization** | Blocks `javascript:`, `data:`, `vbscript:` with control-char stripping (`render.js:24-36`, `router/src/index.js:10-19`) | Correct |
| **Prototype pollution** | `Object.create(null)` for EMPTY_OBJ, no `__proto__` assignments | Clean |
| **Command injection** | Uses `spawn()` with array args, `safePath()` validates file paths (`cli/src/cli.js:14-37`) | Correct |
| **DevTools auth** | `crypto.randomBytes(24)` token, `127.0.0.1` binding, `verifyClient` on WebSocket (`bridge.js:34-44`) | Correct |
| **SSR escaping** | `escapeHtml()` on all text output, meta tags, styles (`server/src/index.js:32-100`) | Correct |
| **Hardcoded secrets** | Previously had `"dev123"` in `.mcp.json` — **fixed** in commit `b78b9b5`, now uses env var | Fixed |
| **Security tests** | 25+ test cases covering URL sanitization, innerHTML, CSRF, prototype pollution (`core/test/security.test.js`) | Comprehensive |

**Security verdict: One previously-critical issue (hardcoded token) is now fixed. The devtools eval/set_signal tools are properly gated behind flags and auth. XSS, CSRF, URL sanitization, and DOM manipulation safety are all well-implemented with dedicated security tests. This is above-average security awareness for any framework, let alone pre-1.0.**

---

## 6. Engineering Quality

### What's great

- **Reactive system correctness.** Topological ordering prevents diamond-dependency glitches. Iterative computed evaluation via throw/catch trampoline handles 10K+ chains without stack overflow. Infinite loop detection caps at 25 flush iterations with specific effect names in the warning. These are hard problems solved correctly. (`packages/core/src/reactive.js`)

- **Recent performance optimizations.** Signal read overhead dropped from 4.01x to 1.26x vanilla. Computed create+read improved 64%. h() element creation improved 154%. Specific techniques: `arguments.length` instead of rest params (eliminates array allocation), `._owner` property instead of WeakMap (20x faster), `===` + NaN check instead of `Object.is`, epoch-based subscriber dedup cache, V8 hidden class optimization. All 614 tests pass. (Commit `ffe2454`)

- **Structured error system.** Every error is a `WhatError` with code, message, suggestion, file, line, component, and code example. JSON-serializable for agent consumption. 10+ documented codes. Runtime guardrails catch missing signal reads, infinite loops, XSS, and signal writes during render. (`packages/core/src/errors.js`, `guardrails.js`)

- **Test quality.** 653+ tests covering the problems that actually matter: topological ordering, diamond dependencies, deep computed chains, stack overflow prevention, XSS, CSRF, infinite loops, disposal/cleanup. Nearly 1:1 test-to-source ratio for core. CI runs on Node 20 + 22 with benchmark regression gate (>5% fails build).

- **Clean architecture.** Acyclic dependency graph: `reactive.js` (tier 0, no deps) → `hooks.js` (tier 1) → `dom.js` + `render.js` (tier 2) → `store.js`, `data.js`, `form.js` (tier 3) → `index.js` (re-exports). No circular dependencies. 13 packages with clear boundaries.

### What's good

- **Zero runtime dependencies.** Core ships with no npm dependencies. Unusual and valuable.
- **Documentation honesty.** CRITICAL-REVIEW.md, HONEST-ASSESSMENT.md, and GOTCHAS.md openly discuss weaknesses. 19 documented gotchas with code examples. Builds trust.
- **Benchmark methodology.** Percentile stats (p10, p50, p90, p99), warmup iterations, GC forcing, tail trimming. Regression gate in CI.
- **Interactive playground.** CodeMirror 6, live preview, 10 examples, URL sharing, professional design. 1,911 LOC of quality code.
- **HMR in dev mode.** Vite plugin appends HMR boundaries to component files, smart reload for utility files.

### What's bad

- **Performance still lags competitors.** Despite significant improvements, internal benchmarks show ~2.42x vanilla overall (DOM rendering benchmark, not just signal ops). SolidJS is 1.05-1.11x, Svelte 1.13x, Preact 1.24x, Vue 1.29x, React 1.54x. The signal operations are now competitive (1.26x vanilla for reads), but the rendering pipeline still has overhead.

- **No TypeScript source.** All 24K LOC is vanilla JavaScript with hand-written `.d.ts` files. No `tsc --noEmit` in CI to catch type definition drift. Every major competitor writes source in TypeScript.

- **Compiler is naive compared to SolidJS.** Does static template extraction and reactive expression wrapping, but no optimization passes, no dead code elimination, and naive reactivity detection (any call with signal args gets wrapped). SolidJS's compiler does significantly more analysis.

### What needs work

- **No linting or formatting in CI.** No ESLint enforcement, no Prettier checks, no pre-commit hooks.
- **SSR hydration gap.** Some paths destroy server HTML and re-render fresh. Defeats SSR performance benefits.
- **`useLayoutEffect` semantic mismatch in react-compat.** Maps to async effect. Libraries that depend on synchronous layout reads before paint will break.
- ~~**Playground not discoverable.**~~ Now hosted at [playground.whatfw.com](https://playground.whatfw.com) and linked from README, docs nav, and footer.

---

## 7. Competitive Landscape

| Capability | What Framework | SolidJS | Svelte 5 | Vue 3 (+Vapor) | Preact Signals | Qwik |
|---|---|---|---|---|---|---|
| **Reactivity** | Runtime signals | Compiled signals | Compiler runes | Proxy (+Vapor) | Signals+VDOM | Resumable |
| **Components re-render?** | No | No | No | Yes (No w/Vapor) | Yes (bypassable) | No |
| **Core bundle (min+gzip)** | ~9.6 KB | ~7.6 KB | ~2-4 KB | ~6 KB (Vapor) / ~20 KB | ~5.6 KB | ~1 KB initial |
| **js-framework-benchmark** | ~2.42x (internal) | ~1.05-1.11x | ~1.13x | ~1.29x (Vapor: ~1.1x) | ~1.24x | Good startup |
| **SSR** | Yes (stream) | Yes (SolidStart) | Yes (SvelteKit) | Yes (Nuxt) | Yes (Fresh) | Yes (core) |
| **True hydration** | Partial | Yes (progressive) | Yes (minimal) | Yes (full + lazy) | Yes | N/A (resumable) |
| **Islands** | Yes (6 modes) | Experimental | Via SvelteKit | Via Nuxt | Via Fresh | Built-in |
| **Router** | Yes (View Transitions) | solid-router | SvelteKit | vue-router | preact-router | Qwik City |
| **TypeScript source** | No (.d.ts only) | Yes | Yes | Yes | Yes | Yes |
| **AI/MCP DevTools** | **Yes (18 tools)** | No | No | No | No | No |
| **Structured errors** | **Yes (JSON codes)** | No | No | Some | No | No |
| **Built-in forms** | **Yes (Zod/Yup)** | No | Bind directives | No | No | No |
| **Built-in data fetching** | **Yes (SWR-like)** | createResource | SvelteKit load | No | No | Qwik City |
| **Built-in animations** | **Yes (spring/tween)** | No | Yes | Partial | No | No |
| **Built-in a11y utils** | **Yes (focus/ARIA)** | No | No | No | No | No |
| **React compat** | Yes (49+ libs) | No | No | No | Inherent | Yes |
| **Interactive playground** | **Yes** ([playground.whatfw.com](https://playground.whatfw.com)) | Yes | Yes | Yes | Yes | Yes |
| **Component libraries** | None | Growing | Large | Massive | React (aliased) | Limited |
| **Maturity** | v0.6 (6 weeks) | v1.9+ (4 years) | v5 (stable) | v3.5+ (5+ years) | v10+ (8+ years) | v2.0 (3+ years) |

**Key observation:** What Framework's batteries-included design (forms, data, animations, a11y, skeletons — all zero-dependency) is genuinely differentiated. No competitor bundles all of these. The MCP devtools remain the only feature no competitor can claim. But performance, TypeScript, compiler sophistication, and ecosystem are behind every competitor listed.

---

## 8. What to Fix Now

### Before anyone sees this

1. ~~**Link the playground from README.**~~ Done. Prominent "Try Online" link added to README, docs site nav, docs hero, and footer.

2. ~~**Host the playground on Vercel.**~~ Done. Deployed at [playground.whatfw.com](https://playground.whatfw.com) and added to default deploy targets.

3. **Host example apps.** Deploy task-manager, TodoMVC, and dashboard to Vercel. Link from README.

### Before launch/promotion

4. **Add `tsc --noEmit` to CI.** Hand-written `.d.ts` files with no verification will drift from implementation. This is a ticking time bomb.

5. **Add ESLint + Prettier to CI and pre-commit hooks.** Code quality enforcement shouldn't be optional.

6. **Fix `useLayoutEffect` in react-compat.** Currently maps to async effect. Libraries like `@floating-ui/react` that depend on synchronous layout reads will break. This is a correctness bug.

7. **Create GitHub Discussions.** Pre-1.0 developers have no place to ask questions or get help. Zero community infrastructure.

8. **Submit to js-framework-benchmark.** Either close the performance gap first or own the narrative with a blog post explaining tradeoffs. Silence on benchmarks is worse than honest results.

### Can wait

9. **Convert source to TypeScript.** Every competitor uses TS source. Matters for contributors and catching bugs at compile time.

10. **Add compiler optimization passes.** Dead code elimination, better reactivity analysis, HMR state preservation. The compiler works but is naive compared to SolidJS's.

11. **Fix SSR hydration.** Implement true progressive hydration instead of destroy-and-re-render.

12. **Build a community space.** Discord server with invite link in README. Not urgent at pre-1.0 but needed before any marketing push.

---

## 9. The Verdict & Path Forward

### What's strong

**The reactive core is correctly engineered and now well-optimized.** Signal read at 1.26x vanilla is competitive with SolidJS-level signal performance. Topological ordering, iterative evaluation, diamond-dependency prevention, and ownership-based disposal are hard problems done right. The recent optimization pass (commit `ffe2454`) shows the developer understands V8 internals: rest args elimination, hidden class shapes, WeakMap avoidance, epoch-based dedup caching.

**The MCP devtools are a genuine innovation.** 5,450 LOC, 18 tools, WebSocket bridge with crypto auth, zod schemas, structured JSON responses. No other framework lets an AI agent inspect and modify a running application's reactive graph. This isn't a checkbox feature — it's a deeply considered system.

**The batteries-included design is compelling.** Forms with validation resolvers, SWR-like data fetching, spring/tween animations, accessibility utilities, skeleton loaders, DOM scheduler — all built-in, all zero-dependency. For teams that want to avoid dependency management, this is a real value proposition that no competitor matches.

**The playground is polished.** CodeMirror 6 with branded theme, live preview with debounced execution, console capture, URL sharing, 10 complete examples. Professional quality that matches competitors.

**The documentation is honest.** GOTCHAS.md, HONEST-ASSESSMENT.md, and the previous PRODUCT-REVIEW (this document) openly discuss limitations. This builds trust with technical evaluators who are allergic to marketing spin.

### What's holding it back

**Performance is still below competitors in DOM benchmarks.** Signal operations are now fast (1.26x vanilla for reads), but the full rendering pipeline benchmarks at ~2.42x vanilla. SolidJS is 1.05x, Svelte 1.13x, React 1.54x. The gap is in the rendering layer (template cloning, insert, reconciliation), not the reactive core. Marketing "Small & Fast" while being slower than React damages credibility.

**No ecosystem creates a chicken-and-egg problem.** Zero component libraries, zero community packages, zero Stack Overflow answers. A developer choosing What Framework is choosing to build everything from scratch or rely on the React compat layer.

**Single-maintainer risk.** All 13 packages, all documentation, all examples — one person. Technical evaluators at companies will flag this.

**The "AI agents" pitch is ahead of the market.** Most developers don't yet use AI agents to debug applications. The MCP devtools are impressive engineering, but the target audience (developers who want a new framework AND use AI coding agents) may be narrow today. This is a bet on the future.

~~**Playground and examples are invisible.**~~ The playground is now hosted at [playground.whatfw.com](https://playground.whatfw.com) and linked from README, docs, and the homepage. The 14 examples still require local setup — deploying a few key examples (task-manager, TodoMVC, dashboard) would further improve discoverability.

### Strategic advice (Launch Strategy)

1. ~~**Deploy the playground and link it everywhere.**~~ Done. Hosted at [playground.whatfw.com](https://playground.whatfw.com). Linked from README, homepage nav/hero, docs nav/hero, and footer.

2. **Create a killer AI-agent demo video.** Record a 3-minute screen recording of Claude Code debugging a complex reactive bug using MCP devtools: `what_diagnose` → `what_dependency_graph` → `what_set_signal` → bug found and fixed, all without opening the browser. Post to r/webdev, r/javascript, Hacker News, and X. The "framework for AI agents" story only lands if people can *see* an agent using it.

3. **Close the rendering performance gap.** The signal operations are now competitive (1.26x). Focus optimization work on `render.js` (template cloning, insert, mapArray reconciliation) and `dom.js` (createElement, attribute setting). Target: get the DOM benchmark from 2.42x to under 1.5x. At that point, "Small & Fast" becomes defensible.

4. **Target Claude Code power users as the beachhead.** Don't try to compete with React/Solid/Svelte for general web development. Position as "the framework that gets better when you use it with an AI agent." Write a tutorial for Claude Code users. Get listed in AI coding tool ecosystem docs. The niche is small today but growing fast.

5. **Ship one production reference app.** Not TodoMVC — a real app. A project management tool or admin dashboard with auth, forms, data fetching, routing, and the devtools in action. Deploy it on Vercel with source on GitHub. This proves the framework works at scale and gives evaluators something concrete to assess.

---

## 10. Rating

**7/10**

The reactive core is well-engineered and recently optimized (signal read at 1.26x vanilla). The MCP devtools are genuinely innovative — no competitor has anything like them. The batteries-included design (forms, data, animations, a11y, zero deps) is a real value proposition. The interactive playground is polished. Documentation is honest and thorough. Security fundamentals are sound with dedicated test coverage.

What prevents a higher score: DOM rendering performance still lags competitors (2.42x vanilla vs React's 1.54x), the playground and examples are invisible to evaluators (not hosted, not linked), TypeScript source is missing (hand-written .d.ts with no CI verification), and there's no ecosystem or community infrastructure. The project has moved meaningfully since the last review — performance optimizations, playground, security fix — and the trajectory is positive. Getting the playground hosted, closing the rendering perf gap, and shipping that demo video would push this into 7.5-8 territory.
