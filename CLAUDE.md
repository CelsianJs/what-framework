# Project Instructions

## MCP DevTools

This project has an MCP server (`what-devtools-mcp`) that connects to the running app in the browser. When connected, you can inspect live state, debug reactivity, check visual layout, and modify signals — all without screenshots.

### Getting Started
1. Call `what_connection_status` — it returns everything: app info, component/signal/effect counts, framework primer, available tools, and recommended workflow
2. Follow the `workflow` field in the response — it tells you what to call next

### Key Principles
- Use `what_look` for visual info (text, ~400 tokens) before `what_screenshot` (image, ~15KB)
- Use `what_signals` with `filter` and `named_only: true` — never dump all signals unfiltered
- Use `what_explain` for one component instead of calling signals + effects + dom separately
- Use `what_lint` before saving any code changes
- Use `what_diagnose` as your one-call health check
