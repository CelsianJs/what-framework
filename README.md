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

## React Compatibility

Use 90+ React ecosystem libraries with zero code changes via `what-react`:

```bash
npm install what-react
```

Zustand, React Hook Form, TanStack Query, Radix UI, Framer Motion, and more — all work out of the box. `useState` becomes a signal, `useEffect` becomes an effect. Same API, faster runtime.

## Docs

- [Getting Started](/GETTING-STARTED.md)
- [Quick Start](/docs/QUICKSTART.md)
- [API Reference](/docs/API.md)
- [Styling Guide](/docs/STYLING.md)
- [Gotchas](/docs/GOTCHAS.md)
- [Development](/docs/DEVELOPMENT.md)
- [Release](/docs/RELEASE.md)

## License

MIT
