# What Framework — Vision

> The web framework built for AI agents.

## The one-line thesis

Frameworks were designed for humans reading code in an editor. What is designed for
**agents reading a running app** — inspecting signals, parsing structured errors, and
fixing issues in a single pass — while staying small, fast, and pleasant for humans too.

## What we believe

1. **AI agents are now first-class users of a framework.** The bottleneck is no longer
   typing code — it's *understanding a live application*. A framework that exposes its
   runtime state, reactivity graph, and errors in a machine-readable way is dramatically
   easier for an agent to build, debug, and maintain.

2. **Fine-grained reactivity beats the virtual DOM.** Components run **once**. Signals
   create targeted DOM effects, so an update touches only the nodes that changed — no diff,
   no re-render, no dependency arrays. This is both faster and easier to reason about.

3. **Errors should be fixes, not stack traces.** Core runtime errors carry a code, message,
   suggested fix, and code example, and serialize to JSON. An agent (or a human) can act
   on it without spelunking.

4. **Small API surface, no magic.** `signal`, `computed`, `effect`, `batch`, components as
   plain functions. The compiler turns ordinary JSX into fine-grained reactive operations —
   you write normal code, the compiler does the work.

## What this looks like in practice

- **MCP DevTools** (`what-devtools-mcp`) — a Model Context Protocol server that lets an agent
  inspect every signal, effect, component, and DOM node in a *running* app: dependency
  graphs, signal traces, performance hot-spots, live snapshots. This is the headline
  differentiator.
- **Structured errors + guardrails** — at dev time the runtime catches infinite effect loops,
  refuses unsafe `innerHTML`, and warns on signal misuse; lint rules cover the rest. Core
  errors carry actionable JSON with a code, fix, and example.
- **Compiler intelligence** — `what-compiler` lowers JSX to fine-grained DOM ops with keyed
  list reconciliation, no VDOM.
- **Full-stack, not just a view layer** (as of v0.10) — file-routed SSR with co-located
  loaders, served + CSRF-protected server actions, streaming Suspense, SSR head/meta, and an
  **origin-first ISR engine** (`what-isr`) with stale-while-revalidate, tag/path
  invalidation, webhooks, and poll regeneration. Works on any host; a CDN is pure upside.

## Who it's for

- **Agent-driven development** — Claude Code, Cursor, and similar tools building and
  maintaining real apps with live introspection.
- **Developers who want Solid-class performance** without a virtual DOM and without
  React's re-render mental model.
- **Teams shipping full-stack sites** that want Next-class DX (loaders, actions, ISR) with a
  smaller, simpler runtime.

## Honest scope (what we are *not* claiming)

- The **ecosystem is young.** Core (signals, router, server, SSR/ISR, forms, data fetching)
  is production-grade and tested; the broader component/widget ecosystem (`@what/*` headless
  UI, tables, motion, charts) is roadmap, not shipped. See
  [`docs/ECOSYSTEM-PLAN.md`](docs/ECOSYSTEM-PLAN.md).
- **React compatibility** (`what-react`) exists so you can use React-ecosystem libraries
  during migration, but it is a **secondary** feature — native What APIs are preferred for
  new code. See [`REACT-COMPAT.md`](REACT-COMPAT.md).
- We compete on **DX for agents + fine-grained performance + a real full-stack story**, not
  on ecosystem breadth. That's a deliberate wedge, not an accident.

## The bet

If building, debugging, and operating a production site is meaningfully easier when an agent
can *see the running app* — and the runtime underneath is small and fast — then "built for
AI agents" stops being a tagline and becomes the reason teams pick What.

---

*See also: [`README.md`](README.md) (packages + where everything deploys),
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (how it works),
[`docs/ECOSYSTEM-PLAN.md`](docs/ECOSYSTEM-PLAN.md) (roadmap).*
