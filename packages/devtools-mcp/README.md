# what-devtools-mcp

AI-powered debugging for What Framework apps. Lets Claude Code, Cursor, Windsurf, and other AI agents inspect your app's live state — signals, effects, components, errors — in real time.

> **What is MCP?** [Model Context Protocol](https://modelcontextprotocol.io) is an open standard that lets AI coding assistants call tools in external systems. This package exposes your app's runtime state as MCP tools that your AI assistant can call while helping you debug.

## Architecture

```
Browser (What App + devtools)  ──WebSocket:9229──▶  Node.js Process
                                                     ├── WS Bridge (state + events)
                                                     └── MCP Server (stdio) ◀── Claude Code / Cursor
```

## Install

```bash
npm install --save-dev what-devtools what-devtools-mcp
```

## Setup

### Step 1: Add the Vite plugin

```js
// vite.config.js
import what from 'what-compiler/vite';
import whatDevToolsMCP from 'what-devtools-mcp/vite-plugin';

export default {
  plugins: [what(), whatDevToolsMCP()],
};
```

The plugin auto-injects the devtools client in dev mode only (`apply: 'serve'`). It never runs during `vite build`.

### Step 2: Configure your AI tool

**Claude Code** — add to `.claude/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "what-devtools": {
      "command": "npx",
      "args": ["what-devtools-mcp"]
    }
  }
}
```

**Cursor** — add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "what-devtools": {
      "command": "npx",
      "args": ["what-devtools-mcp"]
    }
  }
}
```

**Other MCP clients** — any client that supports stdio transport can connect with:

```
command: npx what-devtools-mcp
```

### Step 3: Start your app

```bash
npm run dev
# In another terminal (or your AI tool starts it automatically):
# The MCP server runs via your AI tool's MCP config — no manual start needed.
```

You should see in the browser console:
```
⚡ What DevTools MCP  Client v0.1.0
MCP  Connecting to bridge on ws://localhost:9229
MCP  🟢 Connected to bridge — AI agent can now inspect this app
MCP  Sent initial snapshot — 5 signals, 3 effects, 2 components
```

## What Can Your AI Do Now?

Here's a real debugging session with Claude Code:

```
You:    "The counter isn't updating when I click the button"

Claude: Let me check your app's reactive state.
        [calls what_signals { filter: "count" }]

        I can see signal 'count' exists with value 0. Let me watch
        what happens when you click.
        [calls what_watch { duration: 5000, filter: "signal:updated" }]

        No signal updates detected in 5 seconds. The click handler
        isn't writing to the signal. Let me check the component.
        [calls what_dom_inspect { componentId: 2 }]

        Found it — the button's onclick calls increment() but that
        function uses count.peek() instead of count.set(). peek()
        reads without triggering reactivity. Here's the fix...
```

The AI sees your app's internals in real time — no console.log, no breakpoints, no guesswork.

## Available Tools

### Read Tools (inspect state)

| Tool | Description |
|------|-------------|
| `what_connection_status` | Check if browser is connected, get counts |
| `what_signals` | List signals with values. Filter by name regex or ID |
| `what_effects` | List effects with deps, run counts, timing. Filter by name or dep signal |
| `what_components` | List mounted components. Filter by name |
| `what_snapshot` | Full state snapshot (signals + effects + components + errors) |
| `what_errors` | Runtime errors with effect context and stack traces |
| `what_cache` | SWR/useQuery cache entries. Filter by key |
| `what_component_tree` | Hierarchical component tree with parent-child relationships |
| `what_dependency_graph` | Reactive dependency graph — which signals feed which effects |
| `what_dom_inspect` | See a component's rendered DOM output |
| `what_route` | Current route info (path, params, query, matched pattern) |

### Write Tools (modify state)

| Tool | Description |
|------|-------------|
| `what_set_signal` | Set a signal's value and see what changes |
| `what_invalidate_cache` | Force-refresh a cache key |
| `what_eval` | Execute arbitrary JS in the browser context |
| `what_navigate` | Navigate to a different route |

### Observe Tools (watch changes)

| Tool | Description |
|------|-------------|
| `what_watch` | Collect reactive events over a time window |
| `what_diff_snapshot` | Save a baseline, take action, diff the changes |

### Diagnostic Tools

| Tool | Description |
|------|-------------|
| `what_diagnose` | Multi-check diagnostic — errors, performance, reactivity in one call |

## Signal Debug Names

For best debugging output, add names to your signals:

```js
// Without name: shows as "signal_1" in devtools
const count = signal(0);

// With name: shows as "count" in devtools
const count = signal(0, 'count');
```

A compiler transform to auto-inject names from variable declarations is planned.

## Manual Setup (without Vite plugin)

```js
import * as core from 'what-core';
import { installDevTools } from 'what-devtools';
import { connectDevToolsMCP } from 'what-devtools-mcp/client';

installDevTools(core);
connectDevToolsMCP({ port: 9229 });
```

Without the Vite plugin the client starts **dormant** — it does not poll for a
bridge, so apps with no bridge running produce zero console/network noise.
To activate it, do one of:

- pass an explicit `token` (e.g. from `WHAT_MCP_TOKEN`): `connectDevToolsMCP({ token })`
- set `window.__WHAT_DEVTOOLS_DEBUG__ = true` before calling it
- call `window.__WHAT_MCP_RECONNECT__()` from the browser console after starting the bridge

The Vite plugin doesn't need any of this: it serves a same-origin
`/__what_mcp_discovery` endpoint and the client polls that quietly, so the
bridge is discovered automatically whenever it's running.

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `WHAT_MCP_PORT` env var | `9229` | WebSocket bridge port |
| Vite plugin `{ port }` | `9229` | Same, via plugin option |

Port 9229 matches Node.js `--inspect` convention. If you're also debugging Node.js, set a different port:

```js
whatDevToolsMCP({ port: 9230 })
```

```json
{
  "mcpServers": {
    "what-devtools": {
      "command": "npx",
      "args": ["what-devtools-mcp"],
      "env": { "WHAT_MCP_PORT": "9230" }
    }
  }
}
```

## Troubleshooting

**"No browser connected"**
Your app isn't running or the Vite plugin isn't configured. Start your dev server and check the browser console for the MCP connection banner.

**"No snapshot available"**
The browser connected but hasn't sent state yet. Refresh the page.

**WebSocket connection refused**
Port 9229 may be in use. Check with `lsof -i :9229` and either kill the process or use a different port.

**Multiple browser tabs**
Only the most recently connected tab's state is tracked. Close extra tabs or use the one you're debugging.

**Empty signal names (signal_1, signal_2)**
Add debug names: `signal(0, 'count')`. See "Signal Debug Names" above.

## WebMCP (Future)

What Framework is designed to support WebMCP — running the MCP server directly in the browser, eliminating the WebSocket bridge entirely. The tool handlers are being built transport-agnostic so they can run in either Node.js or browser context.

See `DESIGN.md` for the full WebMCP architecture plan.
