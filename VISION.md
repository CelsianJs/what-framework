# What Framework — Vision

> The familiar parts of React with an entirely new engine underneath, plus a few
> unique optimizations and features, everything bundled, and great dev tools for
> AI and MCP tools for agents.

## The one-line thesis

Frameworks were designed for humans reading code in an editor. What keeps the
parts of React people and models already know, runs them on a fine-grained
signal engine, and is built for **agents reading a running app**: inspecting
signals, reading coded diagnostics, and fixing issues in a single pass.

## What we believe

1. **Keep what people know.** `useState`, `useEffect`, `useMemo`, `useContext`,
   `<Suspense>`, `<ErrorBoundary>`, `startTransition`, `useOptimistic`,
   `useActionState` and JSX keep React's names and call shapes. The one rule
   to learn: a component runs once, so a hook hands you an accessor
   (`count()`) instead of this render's value.

2. **Replace the engine.** Components run **once**. A push-pull signal engine
   with an owner tree updates only the DOM nodes a write reaches: no virtual
   DOM, no re-render, no stale closures, no dependency arrays to get right.
   Async values live in the same graph: a `computed()` that fetches is read
   like any other, `<Suspense>` and transitions hold the screen while it
   lands, and the server renders it and hands it to the client.

3. **Optimize where the engine makes it possible.** The compiler lowers JSX to
   DOM operations with no vnode reconciler in the output. Hydration adopts the
   server's DOM instead of rebuilding it: matching markup creates no nodes and
   nothing the server sent is fetched again. A keyed row's plain field is a
   text node its row writes directly, and a selection comparison becomes a
   two-row update. Development checks are compiled out of production builds.

4. **Everything bundled.** One install, `what-framework`, holds the engine,
   the router, server rendering with streaming and ISR, server actions, the
   query cache, forms, motion, accessibility helpers and the testing helpers,
   on subpaths that tree-shake. They are designed together: an action and the
   refetches it causes commit as one transition, and a navigation is a
   transition too.

5. **Agents are first-class users.** The bottleneck is no longer typing code;
   it is *understanding a live application*. Every runtime problem What
   notices is a coded diagnostic with a fix and an example, from one catalogue
   that the console, the docs, the generated skills and the MCP tools all
   read.

## What this looks like in practice

- **MCP DevTools** (`what-devtools-mcp`): a Model Context Protocol server with
  25 tools that let an agent inspect the signals, effects, components, cache
  and DOM of a *running* app, ask why something ran (`what_why`), read the
  event history (`what_events`), diagnose stalled async work and hydration
  mismatches, and lint, scaffold and fix code offline. This is the headline
  differentiator.
- **Coded diagnostics.** In development the runtime reports `[what] ERR_…`
  diagnostics on one channel (`getDiagnostics()`, `subscribeDiagnostics()`):
  infinite effect loops, a signal used without its call, async components,
  hydration mismatches with a structured record, unsafe `innerHTML`. Each code
  has a fix and an example in [docs/ERRORS.md](docs/ERRORS.md). Lint rules
  and the compiler catch the rest before it runs.
- **Compiler intelligence.** `what-compiler` lowers JSX to fine-grained DOM
  operations with keyed list reconciliation, compiles server modules for a
  server target, rejects markup the HTML parser would move, and records names
  and source locations in development builds for the tools.
- **Full stack, not just a view layer.** File-routed server rendering with
  co-located loaders and `preload`, out-of-order streaming, hydration by
  adoption, CSRF-checked server actions that run as transitions, React 19's
  form hooks, a query cache of async values, and an **origin-first ISR
  engine** (`what-isr`) with stale-while-revalidate, tag and path
  invalidation, webhooks and poll regeneration. Works on any host; a CDN is
  pure upside.

## Who it's for

- **Agent-driven development**: Claude Code, Cursor and similar tools
  building and maintaining real apps with live introspection.
- **React developers** who want the API they know without re-renders, and
  **developers who want Solid-class performance** without a virtual DOM.
- **Teams shipping full-stack sites** that want Next-class DX (loaders,
  actions, ISR) from one framework with a smaller, simpler runtime.

## Honest scope (what we are *not* claiming)

- **Not a drop-in React replacement.** The names and call shapes are React's,
  but a component runs once and hooks return accessors, so React code needs
  its reads changed (`count()`), and a component cannot be rendered off
  screen the way React's concurrent mode renders one. See
  [docs/MIGRATION-FROM-REACT.md](docs/MIGRATION-FROM-REACT.md).
- **The ecosystem is young.** Core (signals, async values, router, server,
  SSR/ISR, actions, forms, data) is tested and verified release by release;
  the broader component and widget ecosystem (`@what/*` headless UI, tables,
  charts) is roadmap, not shipped. See
  [`docs/ECOSYSTEM-PLAN.md`](docs/ECOSYSTEM-PLAN.md).
- **React compatibility** (`what-react`) exists so you can use React-ecosystem
  libraries during migration, but it is a **secondary** feature: native What
  APIs are preferred for new code. See [`REACT-COMPAT.md`](REACT-COMPAT.md).
- **Bytes are earned per feature.** A compiled app is small; an app pays for
  async values, hydration or the `h()` renderer when it uses them, and
  `npm run check:size` holds each kind of app to a ceiling with the cause of
  every change recorded.
- We compete on **familiar APIs on a faster engine, DX for agents, and a real
  full-stack story**, not on ecosystem breadth. That's a deliberate wedge, not
  an accident.

## The bet

If building, debugging and operating a production site is meaningfully easier
when the API is one people already know, the engine underneath is fine-grained
and fast, and an agent can *see the running app*, then "built for AI agents"
stops being a tagline and becomes the reason teams pick What.

---

*See also: [`README.md`](README.md) (packages + where everything deploys),
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (how it works),
[`docs/UPGRADING.md`](docs/UPGRADING.md) (what changed in 0.15),
[`docs/ECOSYSTEM-PLAN.md`](docs/ECOSYSTEM-PLAN.md) (roadmap).*
