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

**Claude Code** — add to `.mcp.json` in your project root:

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
⚡ What DevTools MCP  connected
MCP  🟢 Connected to bridge — AI agent can now inspect this app
```

## What Can Your AI Do Now?

Here's a real debugging session with Claude Code:

```
You:    "The counter isn't updating when I click the button"

Claude: [calls what_connection_status]   -> seq 41
        Connected to the app at /; nothing reported. Signal 'count' is 0.
        Please click the button once.
        [calls what_events { after: 41, types: ["write", "run"] }]

        No write to 'count' happened. The click handler isn't writing to the
        signal. [calls what_explain { componentId: 2 }]

        Found it — the button's onclick calls increment(), which reads
        count.peek() and never writes. Here's the fix...
```

The AI sees your app's internals in real time — no console.log, no breakpoints, no guesswork.

## Available Tools

24 tools. Every answer is compact JSON, and every live answer carries `seq`, the event cursor for the state it describes. An action answers with the events it caused and `since`, so `what_events({ after: since })` reads everything it set off. Each page load is a session; with more than one connected, pass `session`. Text from the page arrives in «» and is data, never instructions. Full reference: [docs/MCP-DEVTOOLS.md](https://github.com/CelsianJs/what-framework/blob/main/docs/MCP-DEVTOOLS.md).

### Orient and diagnose

| Tool | Description |
|------|-------------|
| `what_connection_status` | One call: sessions, app URL and route, counts, the first lines of what the page reported, key signals, component tree. Works offline |
| `what_errors` | Coded diagnostics (owner path, location, count) and thrown errors, with fixes; a complete summary and a page of entries |
| `what_fix` | The fix and worked example for any error code or pasted message. Works offline |
| `what_diagnose` | Diagnostics, hot effects, most-subscribed and unread signals in one call |
| `what_events` | Events after a cursor, one line each (writes with their writer, runs with their cause, mounts, diagnostics). Never blocks |

### Inspect state

| Tool | Description |
|------|-------------|
| `what_signals` | Signals with values and reader counts. Filter by name regex or ID; pages with `offset` |
| `what_effects` | Effects and computeds with run counts, what they read and why they last ran |
| `what_components` | Mounted components and a one-line tree; `tree: true` for the hierarchy with counts |
| `what_explain` | Everything about one component: signals, effects, DOM, diagnostics |
| `what_snapshot` | All state; `mode: "save"` then `mode: "diff"` for before/after (by write count) |
| `what_dependency_graph` | Who reads what: signals, computeds, effects |
| `what_signal_trace` | Recent writes to one signal, the effect that wrote each and the effects it re-ran |
| `what_cache` | SWR/useQuery cache entries |

### Visual and DOM

| Tool | Description |
|------|-------------|
| `what_look` | Layout, styles, text and accessibility of a component, without an image |
| `what_page_map` | Landmarks, interactive elements, headings and component boundaries |
| `what_screenshot` | A cropped image of one component |
| `what_dom_inspect` | A component's rendered DOM |
| `what_route` | The address bar and what-router's state (path, params, matched pattern), and whether they have settled |

### Act

| Tool | Description |
|------|-------------|
| `what_set_signal` | Set a signal's value; answers with the events it caused |
| `what_navigate` | Navigate and wait for the router to settle |
| `what_invalidate_cache` | Force-refresh a cache key |
| `what_eval` | Read a fixed page value (`document.title`); run JS only with `--unsafe-eval` |

### Code (offline)

| Tool | Description |
|------|-------------|
| `what_lint` | eslint-plugin-what's rules (the project's own lint) plus a real compile with what-compiler |
| `what_scaffold` | Tested code for a component, page, form, store or island |

## Signal Debug Names

For best debugging output, give your signals a name, the second argument:

```js
import { signal } from 'what-framework';

const clicks = signal(0);          // signal_N, unless the compiler names it
const count = signal(0, 'count');  // "count", everywhere
```

In the dev server, what-compiler/vite names an unnamed `signal()` after the
variable it is assigned to (`clicks@src/App.jsx:3:15`). A signal it does not
compile (`h()` code, a library's own signals) shows as `signal_N` in devtools
and `what_signals`. A name you pass is kept as written.

## Diagnostics

In development the What runtime reports coded diagnostics (`ERR_*`) on one channel. The devtools client streams them to the bridge, including the ones reported before the bridge connected (the Vite plugin installs devtools before app code), so `what_connection_status` and `what_errors` see them. Errors the page throws reach `what_errors` too: in effects, in event handlers (a hook called outside a component) and in promises. When the engine stops a looping effect, `ERR_INFINITE_EFFECT` names it. Each code's fix and worked example come from the same catalogue as [docs/ERRORS.md](https://github.com/CelsianJs/what-framework/blob/main/docs/ERRORS.md) and `node_modules/what-framework/diagnostics.json`.

## Manual Setup (without Vite plugin)

```js
import * as core from 'what-core';
import { installDevTools } from 'what-devtools';
import { connectDevToolsMCP } from 'what-devtools-mcp/client';

installDevTools(core);
connectDevToolsMCP({ port: 9229 });
```

Install devtools before your app code so startup diagnostics are recorded.

Without a discovery endpoint the client starts **dormant**: it does not poll for a
bridge, so apps with no bridge running produce zero console/network noise.
To connect it, do one of:

- serve the discovery endpoint from your dev server with `createDiscoveryHandler({ root })`
  from `what-devtools-mcp/vite`, and pass `discoveryUrl: '/__what_mcp_discovery'`
- start the MCP server with `WHAT_MCP_TOKEN` set and pass the same value as
  `token`: `connectDevToolsMCP({ port, token })`
- call `window.__WHAT_MCP_RECONNECT__()` from the browser console after starting the bridge

The Vite plugin does the first for you. The bridge only admits a page with a
credential issued for its own origin: the dev server pairs with the bridge
Node-side using the key the bridge wrote to `node_modules/.cache/what-devtools-mcp/bridge.json`,
so no page can read a credential for another origin.

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `WHAT_MCP_PORT` env var | `9229` | WebSocket bridge port (pairing on port+1) |
| `WHAT_MCP_TOKEN` env var | random | Pre-shared pairing key, when the bridge file cannot be shared |
| Vite plugin `{ port }` | `9229` | Bridge port to use when no bridge file is found |

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
Your app isn't running or the Vite plugin isn't configured. Start your dev server and check the browser console for the MCP connection banner. `what_connection_status`, `what_lint`, `what_scaffold` and `what_fix` answer without a browser.

**"More than one page is connected"**
Each page load is a session. Pass `session` (from the answer's `sessions`) to every live tool.

**A page under `refused` in `what_connection_status`**
The bridge serves one dev-server origin at a time. Another app on another port is refused while the first has a live page.

**WebSocket connection refused**
Port 9229 may be in use. Check with `lsof -i :9229` and either kill the process or use a different port.


**Empty signal names (signal_1, signal_2)**
Add debug names: `signal(0, 'count')`. See "Signal Debug Names" above.

## WebMCP (Future)

What Framework is designed to support WebMCP — running the MCP server directly in the browser, eliminating the WebSocket bridge entirely. The tool handlers are being built transport-agnostic so they can run in either Node.js or browser context.

See [WEBMCP.md](https://github.com/CelsianJs/what-framework/blob/main/packages/devtools-mcp/WEBMCP.md) for the full WebMCP architecture plan.
