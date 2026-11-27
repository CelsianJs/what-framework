# What Framework

[![npm version](https://img.shields.io/npm/v/what-framework)](https://www.npmjs.com/package/what-framework)
[![license](https://img.shields.io/npm/l/what-framework)](https://github.com/CelsianJs/what-framework/blob/main/LICENSE)
[![CI](https://img.shields.io/github/checks-status/CelsianJs/what-framework/main?label=CI)](https://github.com/CelsianJs/what-framework/commits/main)

**The web framework built for AI agents.** The familiar parts of React on an
entirely new engine, with everything bundled and MCP tools for agents.

[whatfw.com](https://whatfw.com) · [Docs](https://whatfw.com/docs) · [Playground](https://playground.whatfw.com) · [React Compat](https://react.whatfw.com) · [Benchmarks](https://benchmarks.whatfw.com) · [GitHub](https://github.com/CelsianJs/what-framework)

> **[Try What Framework in the Playground →](https://playground.whatfw.com)**

---

## Why What?

- **Familiar API** — `useState`, `useEffect`, `useMemo`, `useContext`, `<Suspense>`, `<ErrorBoundary>`, `startTransition`, `useOptimistic` and `useActionState` keep React's names and call shapes. A component runs once, so a hook hands you an accessor: call it to read it (`count()`)
- **A new engine** — Push-pull signals with an owner tree update only the DOM a write reaches. Async values live in the graph: a `computed()` that fetches is read like any other value, under `<Suspense>` and transitions
- **Everything bundled** — Router, server rendering with out-of-order streaming, hydration that adopts the server's DOM, ISR, server actions, a query cache, forms, motion and a11y helpers, all in `what-framework`
- **MCP DevTools** — 25 Model Context Protocol tools let AI agents inspect the signals, effects, components, cache and DOM of a running app, and ask why something ran
- **Coded diagnostics** — Every problem the runtime notices in development is an `ERR_…` code with a fix and an example ([docs/ERRORS.md](docs/ERRORS.md)), on one channel that the console, the MCP tools and `getDiagnostics()` read. Agents parse and fix in one pass
- **Agent Guardrails** — In dev mode the runtime catches infinite effect loops, refuses unsafe `innerHTML`, and reports a signal used without its call. Lint rules catch the rest before they ship
- **Compiler Intelligence** — Write normal JSX. The compiler outputs fine-grained reactive DOM operations, with no vnode reconciler and no VDOM diff
- **Small & Fast**: fine-grained, no VDOM. `npm run check:size` bundles counter apps for production (the `production` export condition), minified and gzipped with Node's zlib at level 9 (1 KB = 1024 B): written with `h()` and bundled by esbuild, a counter app is 9.39KB (9611 B); the create-what counter compiled from JSX by what-compiler/vite in a production `vite build`, the way the scaffold builds it, is 5.38KB (5514 B) of JavaScript, not counting the modulepreload polyfill Vite adds to a build from the scaffold's `index.html`. Minimal dependencies, fully tree-shakeable

## Quick Start

```bash
npm create what@latest my-app
cd my-app
npm install
npm run dev
```

Open `http://localhost:5173`.

## MCP Setup

Projects scaffolded with `npm create what@latest` already include the browser-side
bridge the MCP server talks to, and wire it up for you. Add it by hand only when
you are setting a project up manually:

```bash
npm install -D what-devtools what-devtools-mcp
```

Add `whatDevToolsMCP()` from `what-devtools-mcp/vite-plugin` to the Vite
plugins ([setup](packages/devtools-mcp/README.md#setup)), then connect your AI
agent to a running What app:

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

Add to `.mcp.json` in the project root (Claude Code) or `.cursor/mcp.json` (Cursor).

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

The 13 maintained packages publish together at the same version. The table also lists deprecated `what-mcp`, frozen at 0.12.4 and excluded from new releases. See [CHANGELOG.md](CHANGELOG.md) for the current release.

| Package | Description |
|---|---|
| `what-framework` | Umbrella package: the core API on its root entry; router, server and the kits (forms, data, motion, a11y, …) on subpaths |
| `what-core` | Signals, components, reactivity, hooks, stores; forms, data fetching and the other kits on subpaths |
| `what-compiler` | JSX transform and optimizing compiler (`what-compiler/vite`, `/babel`) |
| `what-router` | File-based & programmatic routing; navigations are transitions, with View Transitions |
| `what-server` | SSR with out-of-order streaming, islands, static generation, server actions |
| `what-isr` | Origin-first ISR cache engine (stale-while-revalidate, tags, webhooks) |
| `what-text` | Optional text engine (powered by `@chenglou/pretext`) |
| `create-what` | Project scaffolder (`npm create what@latest`) |
| `what-framework-cli` | CLI — dev server, build, deploy tools (`what dev/build/start`) |
| `what-devtools` | Browser dev panel (signal inspector, component tree) |
| `what-devtools-mcp` | MCP server bridging AI agents to live app state — 25 tools |
| `what-mcp` | **Deprecated** — docs/assistance MCP server, superseded by `what-devtools-mcp` |
| `what-react` | React compatibility layer (use React-ecosystem packages) |
| `eslint-plugin-what` | ESLint rules — catch signal bugs, enforce patterns |

The umbrella `what-framework` exposes subpaths: `what-framework/router`, `/server`,
`/form`, `/data`, `/motion`, `/a11y`, `/ui`, `/dom`, `/render`, `/testing`,
`/jsx-runtime`. [docs/UPGRADING.md](docs/UPGRADING.md) lists which names moved
off the root entry in 0.15.

## Manual Setup

```bash
npm init -y
npm install what-framework what-compiler
npm install -D vite
```

Set `"type": "module"` in `package.json` — `what-compiler/vite` is ESM-only, and Vite can't resolve it from a CommonJS project:

```json
{
  "type": "module"
}
```

```js
// vite.config.js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

export default defineConfig({
  plugins: [what()],
});
```

Run the dev server with `npx vite` (open `http://localhost:5173`), and build with `npx vite build`.

Bun works too: `bun create what@latest` and `bun run dev`.

## MCP DevTools (AI Agent Debugging)

What Framework ships an MCP server for AI-assisted development. 25 tools: inspect signals, effects, components, DOM, cache, dependency graphs and diagnostics in a live app, plus offline lint, scaffolding and error fixes. See [docs/MCP-DEVTOOLS.md](docs/MCP-DEVTOOLS.md).

## React Compatibility

Use React packages inside native What components with `what-react`. Your own code stays native What; a React component used as a tag renders as a React island, with React's rules inside it and its props kept up to date from your signals.

```bash
npm install what-react
```

```js
// vite.config.js
plugins: [what(), reactCompat()]
```

```jsx
import { BarChart, Bar } from 'recharts';

function Sales() {
  const rows = signal([{ day: 'Mon', total: 3 }]);
  return <section><h2>{rows().length} days</h2><BarChart width={300} height={150} data={rows()}><Bar dataKey="total" /></BarChart></section>;
}
```

[`packages/react-compat/MIXED.md`](packages/react-compat/MIXED.md) has the rules (which files are React files, context, server rendering, limits). See [`REACT-COMPAT.md`](REACT-COMPAT.md) for the tested compatibility matrix. The verified list of libraries is the source of truth.

## Where everything lives & deploys

| Surface | Domain | Source | How it deploys |
|---|---|---|---|
| Marketing + docs | [whatfw.com](https://whatfw.com) (`/docs`) | `docs-site/` | Native Vercel ↔ GitHub (push to `main`) |
| Playground | [playground.whatfw.com](https://playground.whatfw.com) | `sites/playground/` | Native Vercel (Vite build) |
| React-compat demo | [react.whatfw.com](https://react.whatfw.com) | `sites/react-compat/` | Native Vercel (Vite build) |
| Benchmarks | [benchmarks.whatfw.com](https://benchmarks.whatfw.com) | `sites/benchmarks/` | Native Vercel (static) |
| Maintained npm packages (×13) | [npmjs.com/~](https://www.npmjs.com/package/what-framework) | `packages/*` | `Release And Deploy` workflow / `npm run release:*` |

`sites/showcase/` is local-only (not deployed). Full details — build commands, domains, the
release workflow, tokens vs. native integration — are in **[DEPLOYMENTS.md](DEPLOYMENTS.md)**.

## Docs

- [Vision](VISION.md) -- what What is and why
- [Deployments](DEPLOYMENTS.md) -- where everything lives and how it ships
- [Security Policy](SECURITY.md) -- reporting + supported versions
- [Agent Guide](CLAUDE.md) -- MCP, patterns, mistakes
- [Getting Started](GETTING-STARTED.md) -- Setup for agents and developers
- [Quick Start](docs/QUICKSTART.md) -- Tutorial
- [API Reference](docs/API.md) -- Full API
- [Architecture](docs/ARCHITECTURE.md) -- Deep-dive on how the framework works
- [MCP DevTools](docs/MCP-DEVTOOLS.md) -- MCP tools reference
- [Agent Patterns](docs/AGENT-PATTERNS.md) -- Best practices
- [Gotchas](docs/GOTCHAS.md) -- Common mistakes
- [Error codes](docs/ERRORS.md) -- diagnostics, each with a fix and a worked example
- [Migration from React](docs/MIGRATION-FROM-REACT.md) · [TypeScript](docs/TYPESCRIPT.md) · [Styling](docs/STYLING.md) · [Development](docs/DEVELOPMENT.md) · [Release](docs/RELEASE.md)
- [Ecosystem Roadmap](docs/ECOSYSTEM-PLAN.md) -- planned `@what/*` packages

### Contributing

- [Contributing](CONTRIBUTING.md) -- setup, the gates, the PR workflow
- [Repository Architecture](ARCHITECTURE.md) -- where the code lives and what protects it
- [Code of Conduct](CODE_OF_CONDUCT.md)

## License

MIT
