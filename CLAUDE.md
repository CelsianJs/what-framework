# What Framework — AI Agent Instructions

## MCP DevTools Available

This project has a registered MCP server (`what-devtools-mcp`) that connects to a live WhatFW app running in the browser. When the browser app is running, you can inspect it in real-time.

### First Steps
1. Call `what_connection_status` to check if a browser app is connected
2. If connected: call `what_diagnose` for a health check
3. If not connected: the user needs to run their app with the WhatFW devtools Vite plugin

### Key Tools

**Inspection (no image needed):**
- `what_diagnose` — One-call health check (errors, perf, reactivity)
- `what_explain` {componentId} — Full component detail (signals, effects, DOM, errors)
- `what_look` {componentId} — Computed styles, layout, dimensions, accessibility
- `what_signals` — All signal values
- `what_page_map` — Full page layout skeleton

**Debugging:**
- `what_signal_trace` {signalId} — Why did this signal change?
- `what_dependency_graph` {signalId} — Reactive dependency graph
- `what_watch` — Observe events over time
- `what_errors` — Runtime errors with fix suggestions

**Visual:**
- `what_look` — Text-based visual info (USE FIRST, ~400 tokens)
- `what_page_map` — Page layout (~800 tokens)
- `what_screenshot` {componentId} — Cropped component image (USE LAST, 5-20KB)

**Actions:**
- `what_set_signal` {signalId, value} — Change a signal value live
- `what_navigate` {path} — Navigate the app

**Code Quality:**
- `what_lint` {code} — Static analysis (7 rules)
- `what_scaffold` {type, name} — Generate boilerplate
- `what_fix` {errorCode} — Error diagnosis with code examples

### Framework Basics
- Components run ONCE (not on every render like React)
- `signal(value, 'debugName')` for state
- Read: `sig()` — Write: `sig(newValue)` or `sig(prev => next)`
- `effect(() => { ... })` for side effects (auto-tracks signal reads)
- `computed(() => ...)` for derived values (lazy, cached)
- Import from `'what-framework'`
- Use `batch(() => { ... })` to group multiple signal writes

### Anti-Patterns
- Don't screenshot first — use `what_look` (10x cheaper)
- Don't call signals + effects + dom_inspect separately — use `what_explain`
- Don't use `what_eval` for inspection — use the structured tools
- Always call `what_lint` before saving generated code
