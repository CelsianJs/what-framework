# What Framework

**The web framework built for AI agents.**

[whatfw.com](https://whatfw.com) · [Docs](https://whatfw.com/docs) · [React Compat](https://react.whatfw.com) · [Benchmarks](https://benchmarks.whatfw.com) · [GitHub](https://github.com/CelsianJs/what-framework)

---

## Why What?

- **MCP DevTools** — AI agents inspect every signal, effect, and component in a running app via the Model Context Protocol
- **Structured Errors** — Every error returns JSON with code, message, suggested fix, and code example. Agents parse and fix in one pass
- **Agent Guardrails** — Runtime catches infinite loops, missing cleanup, XSS, and signal misuse before they ship
- **Compiler Intelligence** — Write normal JSX. The compiler outputs fine-grained reactive DOM operations. No VDOM diff
- **Small & Fast** — ~15 core APIs, 12KB runtime, zero dependencies, tree-shakeable

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

**Claude Code:**
```json
// .claude/mcp_servers.json
{
  "what-devtools": {
    "command": "npx",
    "args": ["what-devtools", "--mcp"],
    "env": { "PORT": "3001" }
  }
}
```

**Cursor:**
```json
// .cursor/mcp.json
{
  "mcpServers": {
    "what-devtools": {
      "command": "npx",
      "args": ["what-devtools", "--mcp"]
    }
  }
}
```

## Example Component

```jsx
import { mount, useSignal, useComputed } from 'what-framework';

function Counter() {
  const count = useSignal(0);
  const doubled = useComputed(() => count() * 2);

  return (
    <main>
      <h1>What Framework</h1>
      <p>Count: {count()}</p>
      <p>Doubled: {doubled()}</p>
      <button onClick={() => count.set(c => c + 1)}>Increment</button>
      <button onClick={() => count.set(0)}>Reset</button>
    </main>
  );
}

mount(<Counter />, '#app');
```

The compiler handles reactive expressions automatically — signal reads in JSX are auto-wrapped.

## Packages

| Package | Description |
|---|---|
| `what-framework` | Core signals, components, reactivity, forms |
| `what-framework/router` | Client-side routing with View Transitions |
| `what-framework/server` | SSR, islands architecture, static generation |
| `what-framework/testing` | Test utilities |
| `what-compiler` | JSX transform and optimizing compiler |
| `what-devtools` | MCP server for AI agent integration |
| `what-react` | React compatibility layer (90+ React libraries) |
| `create-what` | Project scaffolder |

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

WhatFW ships MCP servers for AI-assisted development:

```json
{
  "mcpServers": {
    "what-framework": { "command": "npx", "args": ["what-mcp"] },
    "what-devtools": { "command": "npx", "args": ["what-devtools-mcp"] }
  }
}
```

18 live debugging tools: inspect signals, effects, components, DOM, cache, dependency graphs, and more. See `/docs/MCP-DEVTOOLS.md`.

## React Compatibility

Use 49+ React ecosystem libraries with `what-react`. This is a secondary feature -- native WhatFW APIs are preferred for new code.

```bash
npm install what-react
```

See `/REACT-COMPAT.md` for the full compatibility matrix.

## Docs

- [Agent Guide](/Agents.md) -- MCP, patterns, mistakes
- [Getting Started](/GETTING-STARTED.md) -- Setup for agents and developers
- [Quick Start](/docs/QUICKSTART.md) -- Tutorial
- [API Reference](/docs/API.md) -- Full API
- [Architecture](/docs/ARCHITECTURE.md) -- Deep-dive
- [MCP DevTools](/docs/MCP-DEVTOOLS.md) -- MCP tools reference
- [Agent Patterns](/docs/AGENT-PATTERNS.md) -- Best practices
- [Gotchas](/docs/GOTCHAS.md) -- Common mistakes
- [Styling Guide](/docs/STYLING.md)
- [Development](/docs/DEVELOPMENT.md)
- [Release](/docs/RELEASE.md)

## License

MIT
