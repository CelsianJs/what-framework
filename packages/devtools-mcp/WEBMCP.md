# WebMCP: Browser-Native MCP for What Framework

## Vision

WebMCP eliminates the WebSocket bridge entirely. Instead of running an MCP server as a separate Node.js process, the MCP server runs **inside the browser** and AI agents connect directly.

```
Current:  Browser  --WS-->  Node.js (bridge + MCP stdio)  --stdio-->  Agent
WebMCP:   Browser (MCP HTTP/SSE)  --HTTP-->  Agent
```

The bridge layer disappears. Latency drops. One fewer process to manage. "Zero-config AI debugging" becomes real — just start your app.

## Why What Framework Should Own This

No other framework has MCP integration at all. By building WebMCP directly into the framework, What Framework becomes the first **agent-native** frontend framework — where AI agents are first-class consumers of the development experience, not afterthoughts.

## Architecture

### Current (v0.1-0.2): Node.js Bridge

```
┌─────────────┐     WebSocket      ┌──────────────────────┐     stdio     ┌─────────────┐
│   Browser    │ ──────────────────▶│   Node.js Process    │ ◀────────────▶│  AI Agent    │
│              │                    │   ├── WS Bridge      │               │ (Claude Code)│
│  what-core   │                    │   ├── MCP Server     │               │              │
│  devtools    │                    │   └── Tool Handlers  │               │              │
│  client.js   │                    │                      │               │              │
└─────────────┘                    └──────────────────────┘               └─────────────┘
```

### Target (v0.3+): WebMCP

```
┌───────────────────────────────┐     HTTP/SSE     ┌─────────────┐
│          Browser              │ ◀───────────────▶│  AI Agent    │
│                               │                  │ (Claude Code)│
│  what-core                    │                  │              │
│  devtools                     │                  │              │
│  ┌──────────────────────┐     │                  │              │
│  │  MCP Server          │     │                  │              │
│  │  (Service Worker or  │     │                  │              │
│  │   SharedWorker)      │     │                  │              │
│  │  ├── Tool Handlers   │     │                  │              │
│  │  └── HTTP/SSE        │     │                  │              │
│  └──────────────────────┘     │                  │              │
└───────────────────────────────┘                  └─────────────┘
```

### Key Design Decision: Transport-Agnostic Tool Handlers

Tool logic is separated from transport. Each tool is a pure function:

```js
// Pure handler — no bridge, no transport dependency
function handleSignals({ filter, id }, snapshot) {
  let signals = snapshot.signals || [];
  if (id != null) signals = signals.filter(s => s.id === id);
  if (filter) {
    const re = new RegExp(filter, 'i');
    signals = signals.filter(s => re.test(s.name));
  }
  return { count: signals.length, signals, summary: `${signals.length} signals` };
}
```

The Node.js MCP server wraps these with a state read over the bridge (`fetchState`, which asks the page for `__WHAT_DEVTOOLS__.getState()`).
The browser WebMCP server would call `window.__WHAT_DEVTOOLS__.getState()` directly.
Same handlers, different plumbing.

## Implementation Path

### Phase 1: Transport-Agnostic Refactor (v0.2)
- Extract pure tool handler functions from `tools.js`
- Each handler takes `(params, snapshot, context)` and returns data
- Node.js MCP server wraps handlers with bridge calls
- No behavioral change — just cleaner architecture

### Phase 2: SharedWorker MCP Server (v0.3)
- Create a SharedWorker that runs the MCP server
- SharedWorker communicates with the main page via MessageChannel
- SharedWorker exposes HTTP/SSE endpoint via Fetch event handling
- Vite dev server proxies `/mcp/*` to the SharedWorker's endpoint

### Phase 3: Service Worker for Production Dev Mode (v0.4+)
- Service Worker intercepts `/mcp/*` requests
- Works even when the app is served from any origin
- AI agents connect via standard HTTP, no special configuration

## Vite Integration

The Vite plugin would detect WebMCP capability and configure automatically:

```js
// vite.config.js — no change needed, plugin handles everything
export default {
  plugins: [what(), whatDevToolsMCP()],
};

// Under the hood, the plugin:
// 1. Injects the WebMCP SharedWorker script
// 2. Proxies /mcp/* to the worker
// 3. Prints: "MCP devtools available at http://localhost:5173/mcp"
```

## How AI Agents Connect

### Current (stdio)
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

### WebMCP (HTTP/SSE)
```json
{
  "mcpServers": {
    "what-devtools": {
      "url": "http://localhost:5173/mcp"
    }
  }
}
```

No separate process. No `npx`. Just a URL.

## Technical Considerations

### SharedWorker vs Service Worker
- **SharedWorker**: Shares state across tabs. Better for dev — one MCP endpoint serves all tabs.
- **Service Worker**: Intercepts network requests. Better for production-like dev mode.
- Start with SharedWorker (simpler), migrate to Service Worker when needed.

### Browser Limitations
- SharedWorkers are not supported in all contexts (no cross-origin)
- Service Workers require HTTPS in production (fine for localhost)
- Both are available in all modern browsers

### Backwards Compatibility
- Keep the Node.js bridge as a fallback for environments where SharedWorker isn't available
- The `.claude/mcp.json` config can specify either `command` (Node.js) or `url` (WebMCP)
- Auto-detect: if `url` fails, fall back to `command`

## Timeline

| Phase | What | When |
|-------|------|------|
| v0.2 | Transport-agnostic handler refactor | Now |
| v0.3 | SharedWorker prototype | After tool set stabilizes |
| v0.4 | Production-ready WebMCP | After user feedback |

## Open Questions

1. **Authentication**: Should the WebMCP endpoint require a token? Dev-only suggests no, but if someone accidentally deploys with devtools enabled...
2. **Multi-tab**: SharedWorker naturally handles this. Should the MCP server expose per-tab state or merged state?
3. **Hot reload**: When the app hot-reloads, the SharedWorker should preserve its MCP connection state. How to handle the devtools re-initialization?
4. **MCP SDK**: Does the MCP SDK support running in a browser/worker context? If not, we may need a lightweight browser-compatible MCP protocol implementation.
