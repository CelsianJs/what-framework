# What Framework — Critical Product Review

*Reviewed: 2026-04-08 | Version: 0.6.0 | Rating: 6.5/10*

---

## 1. What Is It?

What Framework is a signal-based reactive web framework written in JavaScript (with TypeScript definitions) that compiles JSX to direct DOM operations — no virtual DOM, no re-renders. It's a monorepo of 13 packages (~23,700 LOC of framework code, ~10,400 LOC of tests) at version 0.6.0, pre-1.0, under active development by a single maintainer for roughly 6 weeks. Its stated positioning is "the web framework built for AI agents," with MCP-based devtools as its headline feature.

---

## 2. Is It Real?

**Yes, this is functioning software.** It builds, runs, and does what it claims.

**What works:**
- The reactive core (signals, computed, effects, batch) is correctly implemented with topological ordering and iterative evaluation that handles 10,000+ computed chains without stack overflow
- Fine-grained DOM rendering via template cloning and per-binding effects — no virtual DOM diffing
- 18-tool MCP devtools server that connects to a live browser session for real-time inspection
- Compiler (Babel plugin) extracts static HTML into templates and wraps dynamic expressions
- Router with View Transitions API support, file-based and programmatic modes
- SSR with streaming, islands architecture (5 hydration modes), server actions with CSRF protection
- React compatibility layer confirmed working with 49 React ecosystem libraries (zustand, framer-motion, radix-ui, react-query, etc.)
- CLI scaffolder (`npm create what@latest`) produces runnable projects
- ESLint plugin with signal-specific lint rules
- 14 example applications, a documentation site built with the framework itself

**What's not yet built:**
- No interactive playground/REPL (every competitor has one)
- No hosted demo — all examples require local setup
- True hydration is incomplete (server HTML is destroyed and re-rendered fresh in some paths)
- No production profiling tools (devtools are dev-mode only)
- No component library ecosystem (zero third-party packages)

**Tests:** 653+ tests across 26 test files using Node's native test runner. Test LOC is nearly 1:1 with source code for the core package. Tests cover edge cases like diamond dependencies, infinite loops, deep computed chains, XSS prevention, and CSRF. The test suite is comprehensive and well-structured.

**Verdict: This is a real, working framework — not a collection of stubs. The core is solid; the ecosystem is nascent.**

---

## 3. Is It Offering Something Unique?

### What's genuinely differentiated

**MCP DevTools for AI agents.** No other framework has this. 18 structured tools (`what_signals`, `what_effects`, `what_dependency_graph`, `what_diagnose`, `what_set_signal`, etc.) let an AI agent inspect and modify a running application's reactive graph without opening browser DevTools. This isn't a gimmick — the implementation is thorough, with WebSocket bridging, token-based auth, and zod-validated schemas.

**Agent-first error system.** Every error is a structured JSON object with machine-readable codes, human-readable messages, suggested fixes, and code examples. No competitor does this. Example:
```json
{
  "code": "ERR_INFINITE_EFFECT",
  "message": "Effect exceeded 25 flush iterations",
  "suggestion": "Use untrack() to read without subscribing",
  "codeExample": "..."
}
```

**Batteries-included in a small package.** Built-in forms (with Zod/Yup resolvers), SWR-like data fetching, spring/tween animations, accessibility utilities (focus traps, ARIA helpers, roving tabindex), and skeleton loaders — all in the core. Competitors require third-party packages for most of these. Zero runtime dependencies.

**Runtime guardrails.** Catches common mistakes at runtime with actionable messages: missing signal reads (`count` vs `count()`), infinite effect loops (25-iteration cap), signal writes during render, XSS via innerHTML (requires `{ __html: ... }` wrapper). These are developer safety nets that most frameworks leave to linters.

### What's NOT differentiated

- **Signal-based reactivity with components-run-once** — SolidJS does this with a more mature compiler and better performance
- **Fine-grained DOM updates without VDOM** — SolidJS, Svelte 5 (runes), and Vue 3.6 (Vapor Mode) all do this
- **Template cloning for static HTML** — SolidJS's compiler does this more aggressively
- **Small bundle size** — Preact + Signals is smaller; Svelte compiles to less code; Qwik ships ~1KB initial
- **JSX compilation** — Standard approach shared with Solid, React, Preact
- **Islands architecture** — Astro, Fresh, SvelteKit, Qwik all have this

**Differentiation verdict: The MCP devtools and structured error system are genuinely novel. The reactive core is well-built but architecturally identical to SolidJS. The "built for AI agents" positioning is the only defensible moat.**

---

## 4. Who Is This For?

**Target users:**
- **AI-assisted developers** who use Claude Code, Cursor, or similar tools and want their framework to be debuggable by their AI agent — not just by them manually in Chrome DevTools
- **Solo developers and small teams** building internal tools where ecosystem size doesn't matter but DX and debugging speed do
- **Developers migrating from React** who want signals without learning a completely new paradigm (the React compat layer bridges 49+ libraries)

**Adjacent audiences:**
- **Framework learners** — the codebase is ~24K LOC of readable JavaScript, well-documented with architecture docs and an honest self-assessment. Excellent educational resource for understanding how signals and fine-grained rendering work
- **AI agent builders** — teams building AI coding assistants could study this as a reference for how to make software agent-inspectable
- **Internal platform teams** — if you control the stack and don't need community packages, the batteries-included design (forms, data, a11y, animation) eliminates third-party dependency risk

**Who this is NOT for:**
- Teams that need to hire developers who already know the framework
- Performance-critical applications (benchmarks show 2.42x slower than vanilla — worse than React)
- Projects requiring a large component library ecosystem

**Market positioning:** This sits in the "opinionated alternative framework" space alongside Solid, Svelte, and Qwik — but positions itself on the AI-tooling axis rather than the performance axis. The question is whether "built for AI agents" is a category or a feature.

---

## 5. Security Audit

The security posture is **surprisingly strong for a pre-1.0 framework**. Most common vulnerability classes are properly handled.

### Findings

| Severity | Finding | Location | Impact |
|----------|---------|----------|--------|
| CRITICAL | Hardcoded MCP auth token `"dev123"` in version control | `.mcp.json:7` | Known secret in public repo; anyone can connect to dev MCP bridge |
| HIGH | `what_eval` executes arbitrary JS in browser context via `new Function()` | `devtools-mcp/src/client-commands.js:153` | Full browser context access (mitigated: requires `--unsafe-eval` flag) |
| HIGH | `what_set_signal` allows arbitrary state mutation via devtools | `devtools-mcp/src/tools.js:610-635` | Can modify any signal value (mitigated: requires authenticated WebSocket) |
| LOW | CORS `Access-Control-Allow-Origin: *` on token discovery endpoint | `devtools-mcp/src/bridge.js` | Token endpoint accessible from any origin (acceptable: token still required for WS) |

### What's Well-Protected (no vulnerabilities found)

| Area | Implementation | Assessment |
|------|---------------|------------|
| **XSS via innerHTML** | Requires `{ __html: ... }` wrapper; plain strings rejected with dev warning | Correct |
| **XSS via text rendering** | Uses `textContent` (auto-escapes HTML) | Correct |
| **CSRF** | `crypto.randomUUID()` tokens, constant-time comparison, `X-CSRF-Token` header | Correct |
| **URL sanitization** | Blocks `javascript:`, `data:`, `vbscript:` with control-char stripping | Correct |
| **Prototype pollution** | No `__proto__` assignments or recursive untrusted spreads | Clean |
| **Command injection** | Uses `spawn()` with array args, not shell strings | Correct |
| **DevTools auth** | `crypto.randomBytes(24)` token, `127.0.0.1` binding, `verifyClient` on WebSocket | Correct |
| **Event handlers** | Delegated via property assignment, no string-based binding | Clean |
| **Attribute setting** | Proper `setAttribute` for data/aria, property assignment for known DOM props | Clean |

**Security verdict: The one critical issue (hardcoded token) is an easy fix. The framework's security fundamentals — XSS prevention, CSRF, URL sanitization, DOM manipulation safety — are genuinely well-implemented. The devtools eval/set_signal capabilities are properly gated behind flags and auth. This is above-average security awareness for a pre-1.0 framework.**

---

## 6. Engineering Quality

### What's great

- **Reactive system correctness.** Topological ordering prevents diamond-dependency glitches. Iterative computed evaluation via a throw/catch trampoline handles 10K+ chains without stack overflow. Infinite loop detection caps at 25 flush iterations. These are hard problems solved correctly. (`packages/core/src/reactive.js`, 384 LOC)

- **Structured error system.** Every error is a `WhatError` object with code, message, suggestion, and code example. JSON-serializable for agent consumption. 10+ documented error codes covering the most common developer mistakes. (`packages/core/src/errors.js`, 254 LOC)

- **Test quality.** Tests cover topological ordering, diamond dependencies, deep computed chains (10K+), stack overflow prevention, XSS prevention, CSRF, infinite loops, and cleanup/disposal. The test suite catches the bugs that actually matter.

- **Clean module architecture.** Reactive primitives in `reactive.js` with no dependencies. Hooks depend on reactive. DOM depends on reactive + hooks. No circular dependencies. Clear separation of concerns across 13 packages.

### What's good

- **CI pipeline.** GitHub Actions runs tests on Node 20 & 22, build verification, `npm audit`, and a benchmark regression gate that fails if any benchmark degrades >5%.

- **Documentation honesty.** The project includes `CRITICAL-REVIEW.md` and `HONEST-ASSESSMENT.md` that openly discuss weaknesses. `GOTCHAS.md` documents 11 common pitfalls. This level of self-awareness is rare.

- **Zero runtime dependencies.** The core ships with literally no npm dependencies — unusual and valuable for a framework.

- **Benchmark methodology.** Uses percentile stats (p10, p50, p90, p99), warmup iterations, GC forcing, and tail trimming. Baseline comparison with regression detection. Rigorous for a small project.

### What's bad

- **Performance.** Internal benchmarks and the js-framework-benchmark show 2.42x slower than vanilla JavaScript. This is slower than React (1.54x). For a framework that markets itself as "Small & Fast," this is a credibility problem. Signal operations are fast (8.4M creates/s, 3.4M reads/s), but the rendering pipeline has overhead.

- **No TypeScript source.** All source is vanilla JavaScript with hand-written `.d.ts` files. These can drift from implementation. No `tsc --noEmit` in CI to catch type definition staleness. Every major competitor writes source in TypeScript.

- **Compiler naiveté.** The Babel plugin does static template extraction and reactive expression wrapping, but no optimization passes, no dead code elimination, no HMR support, and naive reactivity detection (any call with signal args gets wrapped). SolidJS's compiler is significantly more sophisticated.

### What needs work

- **No linting or formatting in CI.** No ESLint enforcement, no Prettier checks, no pre-commit hooks. Code style is convention-based, not machine-enforced.

- **SSR hydration gap.** The hydrate path destroys server HTML and re-renders fresh in some cases. This defeats the purpose of SSR for performance (the user sees a flash of content being replaced). True progressive hydration is not yet implemented.

- **`useLayoutEffect` semantic mismatch.** The React compat layer maps `useLayoutEffect` to a regular async effect — but React libraries that depend on synchronous layout reads before paint will break. This is a correctness issue, not just a performance issue.

---

## 7. Competitive Landscape

| Capability | What Framework | SolidJS | Svelte 5 | Vue 3 (+Vapor) | Preact Signals | Qwik |
|---|---|---|---|---|---|---|
| **Reactivity** | Runtime signals | Compiled signals | Compiler runes | Proxy-based (+Vapor) | Signals + VDOM | Resumable signals |
| **Components re-render?** | No | No | No | Yes (No with Vapor) | Yes (bypassable) | No |
| **Core bundle (min+gzip)** | ~5-6 KB (est.) | ~7.6 KB | ~2-4 KB | ~16-20 KB | ~5.6 KB | ~1 KB initial |
| **SSR** | Yes (stream) | Yes (SolidStart) | Yes (SvelteKit) | Yes (Nuxt) | Yes | Yes (core design) |
| **True hydration** | Partial | Yes (progressive) | Yes (selective) | Yes (full + lazy) | Yes | N/A (resumable) |
| **Islands** | Yes (5 modes) | Experimental | Via SvelteKit | Via Nuxt | Via Fresh | Built-in |
| **Router** | Yes | solid-router | SvelteKit router | vue-router | preact-router | Qwik City |
| **TypeScript source** | No (.d.ts only) | Yes | Yes | Yes | Yes | Yes |
| **AI/MCP DevTools** | **Yes (18 tools)** | No | No | No | No | No |
| **Structured errors** | **Yes (JSON, codes)** | No | No | Some | No | No |
| **Built-in forms** | **Yes** | No | No | No | No | No |
| **Built-in data fetching** | **Yes (SWR-like)** | createResource | SvelteKit load | Third-party | Third-party | Qwik City |
| **Built-in animations** | **Yes** | No | Yes | Partial | No | No |
| **Built-in a11y utils** | **Yes** | No | No | No | No | No |
| **React compat** | Yes (49 libs) | No | No | No | Inherent | Yes |
| **Interactive playground** | No | Yes | Yes | Yes | Yes | Yes |
| **Component libraries** | None | Growing | Growing fast | Massive | React (aliased) | Limited |
| **js-framework-benchmark** | 2.42x (internal) | ~1.01-1.05x | Top tier | Good (Vapor: near-Solid) | Good | Good startup |
| **Maturity** | v0.6 (6 weeks) | v1.9+ (4 years) | v5 (stable) | v3.5+ (mature) | v10+ (mature) | v2.0 |

**Key observation:** What Framework's batteries-included design (forms, data fetching, animations, a11y) is genuinely differentiated — no competitor bundles all of these. But its performance, TypeScript story, compiler sophistication, and ecosystem are behind every competitor. **The MCP devtools are the only feature no competitor can claim.**

---

## 8. What to Fix Now

### Before anyone sees this

1. **Remove `"dev123"` from `.mcp.json`** and add the file to `.gitignore` or use environment variable references. This is a hardcoded secret in version control. (`.mcp.json:7`)

2. **Add `tsc --noEmit` to CI** to catch type definition drift. Hand-written `.d.ts` files with no verification are a ticking time bomb.

3. **Fix `useLayoutEffect` semantics in react-compat.** Currently maps to async effect. Libraries like `@floating-ui/react` and `react-virtualized` depend on synchronous layout reads. This is a correctness bug, not a nice-to-have. (`packages/react-compat/src/`)

### Before launch/promotion

4. **Build an interactive playground.** Every competitor has one. This is the single biggest onboarding gap. A StackBlitz-based or embedded REPL on whatfw.com would dramatically reduce time-to-evaluation.

5. **Submit to js-framework-benchmark.** Performance claims without the standard benchmark are unverifiable. If 2.42x is the real number, don't claim "Fast" in marketing — pivot messaging to "Right-sized" or "Agent-optimized." If there's optimization headroom, close the gap first.

6. **Add ESLint + Prettier to CI and pre-commit hooks.** Code quality enforcement shouldn't be optional for contributors.

7. **Host example apps on Vercel.** A `what-examples.vercel.app` with the task manager, TodoMVC, and dashboard would let evaluators try the framework without cloning anything.

8. **Fix SSR hydration.** Destroying server HTML and re-rendering fresh negates SSR's performance benefit. Implement true progressive hydration or clearly document the limitation.

### Can wait

9. **Convert source to TypeScript.** Every competitor uses TS source. This matters for contributor experience, IDE support, and catching bugs at compile time.

10. **Add performance optimization passes to the compiler.** Dead code elimination, better reactivity analysis, HMR support. The compiler works but is naive compared to SolidJS's.

11. **Build a community space.** Discord or GitHub Discussions. Not urgent at pre-1.0, but needed before marketing push.

12. **Write a deployment/production guide.** Currently no documentation on deploying What Framework apps to Vercel, Cloudflare, or any platform.

---

## 9. The Verdict & Path Forward

### What's strong

**The reactive core is correctly engineered.** Topological ordering, iterative evaluation, ownership-based disposal, and diamond-dependency prevention are hard problems done right. The code is readable, well-tested, and architecturally clean.

**The MCP devtools are a genuine innovation.** No other framework lets an AI agent inspect and modify a running application's reactive graph through structured tools. This isn't a checkbox feature — it's 5,450 lines of thoughtful implementation with zod schemas, WebSocket bridging, token auth, and 18 purpose-built tools.

**The batteries-included design is compelling.** Forms, data fetching, animations, accessibility utilities, skeleton loaders, error boundaries — all built-in, all zero-dependency. For teams that want to avoid dependency management, this is a real value proposition.

**The documentation is honest.** CRITICAL-REVIEW.md, HONEST-ASSESSMENT.md, and GOTCHAS.md openly discuss limitations. This builds trust with technical evaluators.

### What's holding it back

**Performance is below competitors.** At 2.42x vanilla, it's slower than React. Marketing "Small & Fast" while being slower than the framework you're positioning against damages credibility. Developers who evaluate frameworks look at benchmarks.

**No ecosystem creates a chicken-and-egg problem.** Zero component libraries, zero community packages, zero Stack Overflow answers. A developer choosing What Framework is choosing to build everything from scratch or rely solely on the React compat layer.

**Single-maintainer risk.** All 13 packages, all documentation, all examples — one person. Technical evaluators at companies will flag this as a bus-factor concern.

**The "AI agents" pitch is unclear in value.** Most developers don't yet use AI agents to debug their applications. The MCP devtools are impressive engineering, but the target audience (developers who both want a new framework AND use AI coding agents) may be too narrow to sustain the project.

### Strategic advice (Launch Strategy)

1. **Build the playground first, market second.** An interactive StackBlitz/WebContainer playground on whatfw.com is the single highest-ROI investment. Every framework evaluation starts with "let me try it in the browser." Without this, most evaluators bounce. Don't announce anything until this exists.

2. **Create a killer AI-agent demo video.** Record a 3-minute video of Claude Code debugging a complex reactive bug in a What Framework app using the MCP devtools — showing `what_diagnose` -> `what_dependency_graph` -> `what_set_signal` -> bug found and fixed. Post to r/webdev, Hacker News, and X. The "framework for AI agents" story only lands if people can *see* an agent using it.

3. **Submit to js-framework-benchmark and own the narrative.** If performance is 2.42x, submit it anyway and publish a blog post: "Why we chose developer experience over raw benchmark speed." Transparency about tradeoffs builds more credibility than silence. If you can optimize first, even better — but don't hide from the benchmark.

4. **Target the "Claude Code power users" niche specifically.** Don't try to compete with React/Solid/Svelte for general web development. Position as "the framework that gets better when you use it with an AI agent." Write a tutorial for Claude Code users. Get listed in Claude Code's ecosystem docs. Partner with AI coding tool communities.

5. **Ship a production-quality reference app.** Not TodoMVC — a real app. A project management tool, a blog engine, or an admin dashboard that shows forms, data fetching, auth, routing, and the devtools in action. This proves the framework works at scale and gives evaluators something concrete to assess.

---

## 10. Rating

**6.5/10**

The reactive core is well-engineered, the MCP devtools are genuinely innovative, and the batteries-included design is thoughtfully executed. For a 6-week-old, single-developer, pre-1.0 framework, the code quality and testing rigor are above average. But performance below React, no interactive playground, no ecosystem, incomplete hydration, and unverified benchmark claims hold it back from a higher score. The framework has clear strengths to build on — the question is whether "built for AI agents" can carve out a viable niche, or whether it remains a well-built solution in search of a large-enough audience.
