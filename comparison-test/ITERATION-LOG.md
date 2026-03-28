# WhatFW MCP Iteration Log

## Targets
- Orient in <= 2 MCP calls
- 0 non-MCP escapes (no Playwright/grep fallback)
- <= 5K tokens per task
- 0 broken tool encounters
- 100% task success rate

---

## Round 1 — Baseline (2026-03-28)

**Demo App:** TaskBoard (7+ components, 8 signals, 2 computed, 2 effects)
**Fixes Pre-Applied:** Bootstrap endpoint, visual tool bugs, signal noise reduction, CLAUDE.md

### CRITICAL FINDING: MCP server not available to subagents

All 4 agents **failed to use any MCP tools**. The `what-devtools-mcp` server was registered in `~/.claude.json` (user scope) but subagents spawn as isolated processes that don't inherit MCP connections from the parent session.

**Root cause:** No `.mcp.json` file at the project root. Subagents only see project-level MCP configs.

**Fix applied:** Created `.mcp.json` at project root with the server config + WHAT_MCP_TOKEN env var.

### Agent 1A: Orientation
- **Task:** Connect and describe the app
- **Result:** PARTIAL — fell back to Playwright + source reading
- **Tokens:** ~90K (massive waste on ToolSearch)
- **MCP calls:** 0 (server not found)
- **Non-MCP escapes:** 6 (ToolSearch, Playwright, Read)
- **Pain points:** ToolSearch returned 15-20 irrelevant tools per query. No clear error about why MCP server was missing.
- **Good finding:** Agent was thorough — identified all components, signals, effects from source + browser

### Agent 1B: Visual Debugging (Stats component)
- **Task:** Check Stats card layout and data
- **Result:** PARTIAL — source analysis only
- **Tokens:** ~54K
- **MCP calls:** 0 (server not found)
- **Non-MCP escapes:** 8 (ToolSearch, Read, Bash curl, Grep)
- **Good finding:** Found timezone bug in overdue calculation (date-only strings parse as midnight UTC)

### Agent 1C: State Debugging (filtering)
- **Task:** Debug filtering system
- **Result:** PARTIAL — source analysis found real issues
- **Tokens:** ~53K
- **MCP calls:** 0 (server not found)
- **Non-MCP escapes:** 12 (ToolSearch, Read, Glob, Grep)
- **Good findings:**
  - Stats always shows global counts, not filtered counts (UX confusion)
  - Board view duplicates filter logic independently (maintenance risk)
  - Overdue timezone sensitivity confirmed

### Agent 1D: Feature Build (Sort by Name)
- **Task:** Add "Sort by Name" option
- **Result:** PARTIAL — code changes correct but unverified by MCP
- **Tokens:** ~48K
- **MCP calls:** 0 (server not found)
- **Non-MCP escapes:** 4 (ToolSearch, Bash curl)
- **Code changes:** Correct 3-line change (computed sort branch + dropdown option + comment)
- **Pain point:** Could not use what_lint to validate before saving

### Round 1 Summary

| Metric | Target | Actual | Notes |
|--------|--------|--------|-------|
| MCP tool calls | >0 | 0 | Server not found by any agent |
| Non-MCP escapes | 0 | 30+ total | Every agent fell back to Playwright/Read/Grep |
| Avg tokens | <=5K | ~61K | 12x over target, mostly ToolSearch waste |
| Broken encounters | 0 | 4 | "Server not found" x4 |
| Task success | 100% | 0% full, 100% partial | All completed via fallback, none via MCP |

### Fixes Applied After Round 1
1. **Created `.mcp.json`** at project root — subagents now auto-discover the MCP server
2. All code fixes from previous iteration still apply (bootstrap, visual tools, signal noise)

### Bugs Found by Agents (Valid, Not MCP-Related)
1. **Timezone bug in overdue calculation** — `new Date('2026-03-28')` = midnight UTC, not local midnight
2. **Stats don't reflect active filter** — Shows global counts when filter is active
3. **Board view duplicates filter logic** — Independent computed per column vs shared filteredTasks
4. **Agent 1D successfully added Sort by Name** — 3 correct code changes to app.jsx

---

## Round 2 — First Real MCP Test (Next)

**Pre-conditions:**
- `.mcp.json` at project root with what-devtools-mcp server
- Demo app running at localhost:3456 with WHAT_MCP_TOKEN=dev123
- All visual tool fixes applied (comment node → Element)
- Bootstrap endpoint returns app info + tool catalog

**Test scenarios for Round 2:**
- 2A: Orientation (same as 1A — baseline comparison)
- 2B: Visual debugging with what_look
- 2C: State debugging with what_signal_trace
- 2D: Complex feature: Add drag-to-reorder tasks
