# What Framework DevTools MCP Server — Design

## The idea

AI agents debugging a What Framework app cannot see what happens at runtime: they read code, take screenshots and guess. what-devtools-mcp gives them the live app's state (signals, effects, components, diagnostics, errors, cache, route) and a few actions, through MCP tools that answer in compact JSON.

## Architecture

```
Browser page                                   Node: what-devtools-mcp
┌───────────────────────────────┐             ┌──────────────────────────────────┐
│ what-core ── hooks ──▶ what-devtools        │ bridge.js                         │
│  (__depsOf, __subsOf,   (registry,          │  WebSocket :port   sessions s1…   │
│   __currentEffect,       revisions,  ──ws──▶│  control  :port+1  pairing, probe │
│   onSignalUpdate,        previews,          │                                   │
│   onEffectRun)           loop watch)        │ tools*.js ◀── MCP stdio ── agent  │
│                          │                  └──────────────────────────────────┘
│              client.js (batches events,               ▲
│              answers commands)                        │ POST /__what_mcp_pair
│                                                       │ (Node to Node)
│ Vite dev server: /__what_mcp_discovery ───────────────┘
└───────────────────────────────┘
```

The Vite plugin injects a bootstrap first in `<head>`, so devtools are installed before app code: a check that fires while modules load (an uncalled signal at module scope) and an effect that throws at startup are recorded, and replayed when the bridge connects.

## Sessions

Each page load that connects is one session (`s1`, `s2`, …) with its own event log, diagnostics, errors, baseline and pending commands. Ids (signals, effects, components) belong to a page load, so nothing is compared or merged across sessions: a second tab never changes another session's answers, closing one tab does not disconnect another, a snapshot diff never crosses pages, and when more than one session is live every live tool needs `session` (without it the answer lists the sessions). A page whose socket drops and comes back with the same page id resumes its session. Closed sessions are kept briefly so `what_events` and `what_errors` can still read what they buffered.

## Trust

The bridge admits a browser page only with a credential issued for that page's exact origin:

1. The bridge writes a pairing key to `<project>/node_modules/.cache/what-devtools-mcp/bridge.json` (or takes `WHAT_MCP_TOKEN`).
2. The page fetches `/__what_mcp_discovery` from its own dev server. The dev server refuses requests from any other origin.
3. The dev server, Node-side, reads the pairing key (walking up from its root) and POSTs `{ key, origin, root }` to the bridge's control port. The bridge refuses a wrong key, a non-loopback origin, a root outside its project, and any request that carries browser headers (`Origin`, `Sec-Fetch-Site`). It answers with a credential bound to that origin.
4. The page opens the WebSocket with the credential; the bridge checks that the socket's `Origin` is the one the credential was issued for.

One dev-server origin is served at a time. While it has a live page, and for a short grace period after (so a reload keeps it), another origin is refused at pairing and at the socket, and `what_connection_status` reports the refusal. A non-browser local process (tests, scripts) may connect with the pairing key itself.

Every inbound message is checked for shape and size (8 MiB per frame, 2000 events per batch, known event names only); a bad one is dropped and counted. A response is accepted only on the socket its command was sent on.

Free text that originates in the page (diagnostic and error messages, stacks, DOM text and HTML, the title, eval results) is wrapped in `«…»` in tool output, with any guillemets inside it replaced, and the server's instructions tell the agent it is data. A diagnostic's fix always comes from the server's own catalogue, never from the page.

## Time

Every event gets a bridge-wide sequence number `seq`. The page buffers events for a few milliseconds and always flushes the buffer before answering a command, and the socket is ordered, so when an answer arrives the session's latest `seq` is exactly the state the answer describes. That is the `seq` every live answer carries; there is no snapshot cache to go stale.

For an action (`what_set_signal`, `what_navigate`, `what_invalidate_cache`, `what_eval`) the page flushes, sends a mark, acts, runs the effects it queued (`flushSync`), flushes again and answers. The bridge records the mark's position, so the answer can say `since` (the cursor just before the action) and list the events in `(since, seq]`: the writes and effect runs the action caused. `what_events({ after: since })` then reads everything from the action on, including later async work. `what_events` pages with `next`; reading from `next` never repeats or skips, and `lostThrough` says when the bounded log evicted events the reader had not seen.

`what_navigate` changes the URL the way back/forward does, so what-router runs its guards, and waits (bounded) until the router's state matches the address bar. what-router names its state signals `what-router:*` in development, which is how the page reads the router's own view separately from `location`.

## Truth before tokens

- The page sends its whole registry for every state read: ids, names, revisions, run counts and dependencies are never truncated. Only each signal's `value` is a bounded preview (long strings, arrays and objects end with an explicit marker). Tools filter and page on the full data.
- Change detection uses revisions: devtools counts every write to a signal (from the engine's `onSignalUpdate` hook), so `what_snapshot` diff sees a change the preview cannot show.
- The writer of a signal update is the effect running at write time (`__currentEffect()` inside `onSignalUpdate`); a write from an event handler has none. `onEffectRun`'s `causes` say which dependency changed, which `what_events`, `what_effects` and `what_signal_trace` show as `← signal`.
- The engine stops a flush after a fixed number of rounds. Until it reports that itself, devtools detects it from the hooks (an effect queued by an effect's write that never ran before the task ended) and reports `ERR_INFINITE_EFFECT` with the effect's name and the number of re-runs.
- Diagnostics are bounded (500 per session), and `what_errors` returns a complete summary by code, a page of entries and a loss watermark.

## Tools

The shipped set is 24, documented tool by tool in [docs/MCP-DEVTOOLS.md](../../docs/MCP-DEVTOOLS.md):

| Group | Tools |
|---|---|
| Orient and diagnose | `what_connection_status`, `what_errors`, `what_fix`, `what_diagnose`, `what_events` |
| State | `what_signals`, `what_effects`, `what_components`, `what_explain`, `what_snapshot`, `what_dependency_graph`, `what_signal_trace`, `what_cache` |
| Visual and DOM | `what_look`, `what_page_map`, `what_screenshot`, `what_dom_inspect`, `what_route` |
| Act | `what_set_signal`, `what_navigate`, `what_invalidate_cache`, `what_eval` |
| Code (offline) | `what_lint`, `what_scaffold` |

`what_lint` runs eslint-plugin-what's rules through ESLint (the preset create-what configures) plus a real compile, so it agrees with the project's own lint. `what_scaffold`'s templates are compiled, run and linted in the test suite, and they render the `what://docs/patterns` resource. `what_eval` without `--unsafe-eval` answers only a fixed list of reads, each resolved with the browser's own accessor captured at load (no code runs and no page-defined getter is called).

## Example session

```
→ what_connection_status
← { "connected": true, "session": "s1", "issues": ["ERR_MISSING_SIGNAL_READ «Signal \"title\" was used as a value without being called …»"], … , "seq": 12 }

→ what_set_signal { signalId: 4, value: 5 }
← { "previous": 0, "current": 5, "since": 12, "events": ["#13 write count=5", "#14 run Counter#2 (2) ← count#4"], "seq": 14 }
```
