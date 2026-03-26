# MCP DevTools Reference

Complete guide to What Framework's MCP-based debugging tools. These let AI agents inspect and manipulate a running WhatFW app without browser access.

## Architecture

```
+-----------------+     WebSocket (9229)     +------------------+     stdio/MCP     +------------------+
|  Browser App    | <----------------------> |  Bridge Server   | <---------------> |  AI Agent        |
|  (client.js)    |   snapshots, events,     |  (Node.js)       |   tool calls,    |  (Claude, etc.)  |
|                 |   command responses       |                  |   responses      |                  |
+-----------------+                          +------------------+                   +------------------+
```

The bridge server (`what-devtools-mcp`) runs as a Node.js process. It:
1. Starts a WebSocket server on port 9229 (configurable via `WHAT_MCP_PORT`)
2. Receives state snapshots and events from the browser client
3. Stores an event log (last 1000 events) and error log (last 100 errors)
4. Forwards commands from the agent to the browser
5. Exposes 18 MCP tools for agents

## Setup

### 1. Install

```bash
npm install -D what-devtools-mcp what-devtools
```

### 2. Configure Vite

```js
// vite.config.js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';
import whatDevToolsMCP from 'what-devtools-mcp/vite-plugin';

export default defineConfig({
  plugins: [
    what(),
    whatDevToolsMCP({ port: 9229 }),  // port is optional, 9229 is default
  ],
});
```

The Vite plugin auto-injects the client script during `vite dev`. It:
- Imports `what-devtools` and installs the instrumentation hooks
- Imports `what-devtools-mcp/client` and connects to the bridge
- Only active in dev mode (`apply: 'serve'`)

### 3. Configure MCP Client

**Claude Code:**
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

**Cursor:**
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

### 4. Start Your App

```bash
npm run dev
```

Open the app in a browser. The client connects to the bridge automatically.

### 5. Verify Connection

```
Agent: what_connection_status
-> "Connected. App has 12 signals, 8 effects, 5 components."
```

---

## Tool Reference

### Read Tools

#### `what_connection_status`

Check if a WhatFW app is connected via WebSocket.

**Parameters:** None

**Response:**
```json
{
  "summary": "Connected. App has 12 signals, 8 effects, 5 components.",
  "connected": true,
  "hasSnapshot": true,
  "signalCount": 12,
  "effectCount": 8,
  "componentCount": 5
}
```

---

#### `what_signals`

List all reactive signals with current values.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `filter` | string (regex) | Filter signal names |
| `id` | number | Get a specific signal by ID |

**Example:**
```
what_signals { filter: "count" }
```

**Response:**
```json
{
  "summary": "12 signals total. 2 match filter 'count'. Values: count=5, itemCount=3",
  "count": 2,
  "signals": [
    { "id": 3, "name": "count", "value": 5, "componentId": 1 },
    { "id": 7, "name": "itemCount", "value": 3, "componentId": 2 }
  ]
}
```

---

#### `what_effects`

List all active effects with dependency signal IDs, run counts, and timing.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `minRunCount` | number | Only effects with runCount >= this |
| `filter` | string (regex) | Filter effect names |
| `depSignalId` | number | Find effects depending on this signal |

**Example:**
```
what_effects { minRunCount: 50 }
```

**Response:**
```json
{
  "summary": "8 effects tracked. 2 returned after filters. 2 have run 50+ times (textUpdate, listRender).",
  "count": 2,
  "effects": [
    { "id": 5, "name": "textUpdate", "runCount": 247, "depSignalIds": [3], "depSignalNames": ["count"] }
  ]
}
```

---

#### `what_components`

List all mounted components.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `filter` | string (regex) | Filter component names |

**Response:**
```json
{
  "summary": "5 components mounted. Tree depth: 3. Root: App > [Header, Main > [Counter, Form]]",
  "count": 5,
  "components": [...]
}
```

---

#### `what_snapshot`

Get a full state snapshot (signals, effects, components, errors).

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `maxSignals` | number | 100 | Max signals to return |
| `maxEffects` | number | 100 | Max effects to return |

---

#### `what_errors`

Get captured runtime errors with context.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `since` | number | Only errors after this Unix timestamp (ms) |

**Response:**
```json
{
  "summary": "3 errors captured. Most recent: TypeError in effect 'fetchData' (5s ago).",
  "count": 3,
  "errors": [...],
  "nextSteps": [
    "Use what_signals to check signal values referenced in the error stack traces",
    "Use what_effects to inspect the failing effect's dependencies",
    "Use what_watch to observe if the error recurs"
  ]
}
```

---

#### `what_cache`

Inspect SWR/useQuery cache entries.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `key` | string | Filter by key (substring match) |

---

#### `what_component_tree`

Get the component hierarchy as a tree with signal/effect counts per node.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `rootId` | number | -- | Start from this component ID |
| `depth` | number | 10 | Max depth to traverse |
| `filter` | string (regex) | -- | Only subtrees containing matching names |

---

#### `what_dependency_graph`

Get the reactive dependency graph showing signal-to-effect relationships.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `signalId` | number | -- | Focus on this signal |
| `effectId` | number | -- | Focus on this effect |
| `direction` | enum | `both` | `downstream`, `upstream`, or `both` |

**Example:**
```
what_dependency_graph { signalId: 3, direction: "downstream" }
```

**Response:**
```json
{
  "summary": "1 signal, 3 effects, 3 edges. Focused on signal #3. Direction: downstream.",
  "nodes": [
    { "type": "signal", "id": 3, "name": "count", "value": 5 },
    { "type": "effect", "id": 5, "name": "textUpdate", "runCount": 247 },
    { "type": "effect", "id": 6, "name": "classList", "runCount": 12 },
    { "type": "effect", "id": 9, "name": "derivedCalc", "runCount": 247 }
  ],
  "edges": [
    { "from": { "type": "signal", "id": 3 }, "to": { "type": "effect", "id": 5 }, "relation": "triggers" },
    { "from": { "type": "signal", "id": 3 }, "to": { "type": "effect", "id": 6 }, "relation": "triggers" },
    { "from": { "type": "signal", "id": 3 }, "to": { "type": "effect", "id": 9 }, "relation": "triggers" }
  ]
}
```

---

### Write Tools

#### `what_set_signal`

Set a signal value in the running app.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `signalId` | number | Signal ID (from `what_signals`) |
| `value` | any | New value (JSON-compatible) |

**Example:**
```
what_set_signal { signalId: 3, value: 0 }
```

**Response:**
```json
{
  "summary": "Signal 3 updated. Previous: 5, New: 0",
  "success": true,
  "signalId": 3,
  "previousValue": 5,
  "newValue": 0
}
```

---

#### `what_invalidate_cache`

Force-refresh a cache key.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `key` | string | Cache key to invalidate |

---

### Observe Tools

#### `what_watch`

Watch for reactive changes over a time window. Blocks for the duration, then returns collected events.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `duration` | number | 3000 | Duration in ms (max 30000) |
| `filter` | string (regex) | -- | Filter event names |

**Event types:** `signal:created`, `signal:updated`, `signal:disposed`, `effect:created`, `effect:run`, `effect:disposed`, `error:captured`, `component:mounted`, `component:unmounted`

**Example:**
```
what_watch { duration: 5000, filter: "signal:updated" }
```

---

### Inspection Tools

#### `what_eval`

Execute JavaScript in the browser context. Has access to `window`, `document`, `__WHAT_DEVTOOLS__`, and `__WHAT_CORE__`.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `code` | string | -- | JavaScript to execute |
| `timeout` | number | 5000 | Max execution time (ms, max 30000) |

**Example:**
```
what_eval { code: "return document.querySelectorAll('[data-island]').length" }
```

---

#### `what_dom_inspect`

Get the rendered DOM output of a component.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `componentId` | number | -- | Component ID (from `what_components`) |
| `depth` | number | 3 | Max DOM depth |

---

#### `what_diagnose`

Run a comprehensive diagnostic check. Identifies errors, performance issues, and reactivity problems.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `focus` | enum | `all` | `errors`, `performance`, `reactivity`, or `all` |

**Checks performed:**
- **Errors:** Runtime errors captured
- **Performance:** Hot effects (runCount > 50), high event volume (> 500/min)
- **Reactivity:** Orphan signals (no subscribers), effects with no dependencies

---

### Navigation Tools

#### `what_route`

Get current route information.

**Parameters:** None

**Response:**
```json
{
  "summary": "Path: /users/123 (pattern: /users/:id) | Params: id=123",
  "path": "/users/123",
  "matchedRoute": "/users/:id",
  "params": { "id": "123" },
  "query": {},
  "hash": ""
}
```

---

#### `what_navigate`

Navigate to a different route.

**Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | string | -- | Path to navigate to |
| `replace` | boolean | false | Use replaceState |

---

### Diff Tool

#### `what_diff_snapshot`

Compare app state between two points in time.

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `action` | enum | `save` (store baseline) or `diff` (compare to baseline) |

**Workflow:**
```
Agent: what_diff_snapshot { action: "save" }
  -> "Baseline saved. 12 signals, 8 effects, 5 components."

  ... user interacts with the app ...

Agent: what_diff_snapshot { action: "diff" }
  -> "3 signals changed, 2 effects re-ran, 1 component mounted."
```

---

## MCP Resources

The DevTools server also exposes three MCP resources for agent context:

| Resource URI | Description |
|-------------|-------------|
| `what://docs/reactivity-model` | How signals, effects, computed, and batch work |
| `what://docs/debugging-guide` | Step-by-step debugging workflows |
| `what://docs/api-reference` | Quick API reference |

Agents can read these resources to understand WhatFW concepts before using the tools.

---

## Debugging Workflows

### "UI isn't updating"

1. `what_signals { filter: "relevant_name" }` -- is the value what you expect?
2. `what_watch { duration: 5000 }` -- ask user to trigger the action. Do `signal:updated` events appear?
3. If no updates: the event handler isn't calling `sig.set()`. Check source code.
4. If updates appear but UI doesn't change: the component isn't reading the signal reactively. Look for stale closures or `peek()`.

### "Infinite effect loop"

1. `what_effects { minRunCount: 50 }` -- find hot effects
2. `what_dependency_graph { effectId: N }` -- see what signals this effect reads and writes
3. If an effect reads and writes the same signal: use `untrack()` for the read

### "Slow performance"

1. `what_diagnose { focus: "performance" }` -- identify hot effects and event volume
2. `what_effects { minRunCount: 20 }` -- find frequently-running effects
3. Consider using `batch()` to group signal writes

### "Component shows wrong data"

1. `what_component_tree` -- verify hierarchy
2. `what_dom_inspect { componentId: N }` -- see actual rendered output
3. `what_signals` -- check signal values

### "Route not working"

1. `what_route` -- check current path, params, matched pattern
2. `what_navigate { path: "/expected" }` -- test navigation
