# What Framework

[![npm version](https://img.shields.io/npm/v/what-framework)](https://www.npmjs.com/package/what-framework)
[![license](https://img.shields.io/npm/l/what-framework)](https://github.com/CelsianJs/what-framework/blob/main/LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/CelsianJs/what-framework/ci.yml?branch=main&label=tests)](https://github.com/CelsianJs/what-framework/actions)

**The web framework built for AI agents.**

[whatfw.com](https://whatfw.com) · [Docs](https://whatfw.com/docs) · [Playground](https://playground.whatfw.com) · [React Compat](https://react.whatfw.com) · [Benchmarks](https://benchmarks.whatfw.com) · [GitHub](https://github.com/CelsianJs/what-framework)

> **[Try What Framework in the Playground →](https://playground.whatfw.com)**

---

## Why What?

- **MCP DevTools** — AI agents inspect every signal, effect, and component in a running app via the Model Context Protocol
- **Structured Errors** — Every error returns JSON with code, message, suggested fix, and code example. Agents parse and fix in one pass
- **Agent Guardrails** — Runtime catches infinite loops, missing cleanup, XSS, and signal misuse before they ship
- **Compiler Intelligence** — Write normal JSX. The compiler outputs fine-grained reactive DOM operations. No VDOM diff
- **Small & Fast** — Fine-grained, no VDOM. A typical app ships ~8KB gzipped (TodoMVC ≈8.5KB, a counter ≈7.5KB); the full runtime is ~31KB gzipped before tree-shaking. Minimal dependencies, tree-shakeable

## Quick Start

```bash
npm create what@latest my-app
cd my-app
npm install
npm run dev
```

Open `http://localhost:5173`.

## MCP Setup

Connect your AI agent to a running What app:

```json
{
  "mcpServers": {
    "what-framework": {
      "command": "npx",
      "args": ["what-devtools-mcp"]
    }
  }
}
```

Add to `.claude/mcp_servers.json` (Claude Code) or `.cursor/mcp.json` (Cursor).

## Example Component

```jsx
import { signal, computed, mount } from 'what-framework';

function Counter() {
  const count = signal(0, 'count');
  const doubled = computed(() => count() * 2);

  return (
    <main>
      <h1>What Framework</h1>
      <p>Count: {count()}</p>
      <p>Doubled: {doubled()}</p>
      <button onClick={() => count(c => c + 1)}>Increment</button>
      <button onClick={() => count(0)}>Reset</button>
    </main>
  );
}

mount(<Counter />, '#app');
```

The compiler handles reactive expressions automatically — signal reads in JSX are auto-wrapped.

## Packages

All 14 packages publish together at the same version (currently **0.10.0**).

| Package | Description |
|---|---|
| `what-framework` | Umbrella package — re-exports core, router, server, etc. |
| `what-core` | Signals, components, reactivity, forms, data fetching |
| `what-compiler` | JSX transform and optimizing compiler (`what-compiler/vite`, `/babel`) |
| `what-router` | File-based & programmatic routing with View Transitions |
| `what-server` | SSR, islands architecture, static generation, server actions |
| `what-isr` | Origin-first ISR cache engine (stale-while-revalidate, tags, webhooks) |
| `what-text` | Optional text engine (powered by `@chenglou/pretext`) |
| `create-what` | Project scaffolder (`npm create what@latest`) |
| `what-framework-cli` | CLI — dev server, build, deploy tools (`what dev/build/start`) |
| `what-devtools` | Browser dev panel (signal inspector, component tree) |
| `what-devtools-mcp` | MCP server bridging AI agents to live app state |
| `what-mcp` | MCP server for docs & framework assistance |
| `what-react` | React compatibility layer (use React-ecosystem packages) |
| `eslint-plugin-what` | ESLint rules — catch signal bugs, enforce patterns |

The umbrella `what-framework` exposes subpaths: `what-framework/router`, `/server`,
`/jsx-runtime`, etc.

## Manual Setup

```bash
npm install what-framework what-compiler
npm install -D vite
```

```js
// vite.config.js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

export default defineConfig({
  plugins: [what()],
});
```

Bun works too: `bun create what@latest` and `bun run dev`.

## MCP DevTools (AI Agent Debugging)

What Framework ships an MCP server for AI-assisted development. 29 live debugging tools: inspect signals, effects, components, DOM, cache, dependency graphs, and more. See `/docs/MCP-DEVTOOLS.md`.

## React Compatibility

Use 90+ React ecosystem libraries with `what-react`. This is a secondary feature -- native What Framework APIs are preferred for new code.

```bash
npm install what-react
```

See `/REACT-COMPAT.md` for the full compatibility matrix.

## Where everything lives & deploys

| Surface | Domain | Source | How it deploys |
|---|---|---|---|
| Marketing + docs | [whatfw.com](https://whatfw.com) (`/docs`) | `docs-site/` | Native Vercel ↔ GitHub (push to `main`) |
| Playground | [playground.whatfw.com](https://playground.whatfw.com) | `sites/playground/` | Native Vercel (Vite build) |
| React-compat demo | [react.whatfw.com](https://react.whatfw.com) | `sites/react-compat/` | Native Vercel (Vite build) |
| Benchmarks | [benchmarks.whatfw.com](https://benchmarks.whatfw.com) | `sites/benchmarks/` | Native Vercel (static) |
| npm packages (×14) | [npmjs.com/~](https://www.npmjs.com/package/what-framework) | `packages/*` | `Release And Deploy` workflow / `npm run release:*` |

`sites/showcase/` is local-only (not deployed). Full details — build commands, domains, the
release workflow, tokens vs. native integration — are in **[DEPLOYMENTS.md](DEPLOYMENTS.md)**.

## Docs

- [Vision](VISION.md) -- what What is and why
- [Deployments](DEPLOYMENTS.md) -- where everything lives and how it ships
- [Security Policy](SECURITY.md) -- reporting + supported versions
- [Agent Guide](.internal/Agents.md) -- MCP, patterns, mistakes
- [Getting Started](/GETTING-STARTED.md) -- Setup for agents and developers
- [Quick Start](/docs/QUICKSTART.md) -- Tutorial
- [API Reference](/docs/API.md) -- Full API
- [Architecture](/docs/ARCHITECTURE.md) -- Deep-dive
- [MCP DevTools](/docs/MCP-DEVTOOLS.md) -- MCP tools reference
- [Agent Patterns](/docs/AGENT-PATTERNS.md) -- Best practices
- [Gotchas](/docs/GOTCHAS.md) -- Common mistakes
- [Migration from React](/docs/MIGRATION-FROM-REACT.md) · [TypeScript](/docs/TYPESCRIPT.md) · [Styling](/docs/STYLING.md) · [Development](/docs/DEVELOPMENT.md) · [Release](/docs/RELEASE.md)
- [Ecosystem Roadmap](/docs/ECOSYSTEM-PLAN.md) -- planned `@what/*` packages

## License

MIT
