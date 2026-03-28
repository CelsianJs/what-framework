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

---

## Round 4 — CLAUDE.md Stress Test (2026-03-28)

**Pre-conditions:**
- `.mcp.json` at project root (from R1 fix)
- Demo app running at localhost:3456 with MCP bridge connected
- Agents given ONLY the create-what CLAUDE.md template as guidance (simulating fresh users)

### Agent 4A: Complex State Debugging

- **Task:** Debug incorrect overdue count + stats not updating with filters
- **Result:** SUCCESS — found both root causes using only MCP tools
- **Tokens:** ~44K total (29 tool uses)
- **MCP calls:** 20 (+ 2 retries due to named_only type issue)
- **Non-MCP escapes:** 0
- **Root causes found:**
  1. Overdue count includes completed tasks (should filter `completed === false`)
  2. Stats don't respond to filter changes — `effect_2` and `effect_3` depend only on `tasks`, not on `filterStatus`. Proven via dependency graph.
- **CLAUDE.md gaps identified:**
  - `what_effects` not mentioned (critical for seeing run counts and deps)
  - `what_dom_inspect` not mentioned
  - `what_page_map` not mentioned
  - `what_component_tree` not mentioned
  - `named_only` parameter type undocumented (caused failed call)
  - No guidance on interpreting dependency graphs (what missing edges mean)
  - No "disconnected reactivity" debugging workflow
  - No explanation of `<!--fn-->` markers

### Agent 4B: Performance + Visual Audit

- **Task:** Full performance, visual layout, and reactive health audit
- **Result:** SUCCESS — comprehensive findings using only MCP tools
- **Tokens:** ~47K total (32 tool uses)
- **MCP calls:** 30 (+ 1 retry)
- **Non-MCP escapes:** 0
- **Key findings:**
  - Performance: No hot effects, all run counts = 1. `tasks` signal is reactive hub (3 subscribers).
  - 39/43 signals have 0 effect subscribers (normal — DOM bindings bypass effects)
  - 71/74 effects have 0 signal deps (normal — one-shot setup effects)
  - Dead code: `dragState` signal (null, 0 subscribers), `formError` (empty, 0 subscribers)
  - Accessibility: All 9 checkboxes unlabeled (no `<label>` or `aria-label`)
  - Layout: Clean 720px centered column, consistent 24px padding
  - Minor vertical rhythm inconsistency (12px margin-top on TaskList vs none elsewhere)
- **CLAUDE.md gaps identified:**
  - `what_perf` not in Key Tools (essential for performance audit)
  - `what_effects` not mentioned at all
  - `what_page_map` not in Key Tools
  - `what_component_tree` not mentioned
  - No explanation of what "signals with no subscribers" means
  - No performance audit workflow
  - No visual audit workflow
  - Workflows section too brief (only 3, needed 6+)
- **Token efficiency feedback:**
  - `what_look` best cost/value ratio (~150-200 tokens)
  - `what_dependency_graph` too heavy — full signal values inlined (tasks array repeated)
  - `what_page_map` slightly heavy — repetitive elements (9 checkboxes, 9 delete buttons)

### Round 4 Summary

| Metric | Target | R1 Actual | R4 Actual | Improvement |
|--------|--------|-----------|-----------|-------------|
| MCP tool calls | >0 | 0 | 50 total | Fixed |
| Non-MCP escapes | 0 | 30+ | 0 | 100% |
| Avg tokens | <=5K | ~61K | ~46K | 25% better |
| Broken encounters | 0 | 4 | 2 (named_only type) | 50% better |
| Task success | 100% | 0% full | 100% full | Fixed |

### Fixes Applied After Round 4

1. **CLAUDE.md rewritten** — Added:
   - Decision tree (22 "I want to..." entries mapping to tools)
   - 5 missing tools added to documentation (what_effects, what_perf, what_page_map, what_component_tree, what_dom_inspect)
   - 4 new workflows (performance audit, visual audit, disconnected reactivity, reactive waste)
   - "Understanding Diagnostics" section (subscriberless signals, dep-less effects, flat trees, <!--fn--> markers)
   - Parameter reference table with types
   - Updated principles
2. **what_dependency_graph token fix** — Signal values now truncated (arrays show `Array(N)`, objects/strings capped at 80 chars). Saves ~200 tokens per graph call.
3. **create-what template updated** — Scaffolded CLAUDE.md now matches root (condensed version with decision tree, workflows, diagnostics, parameter types)

### Bugs Found by Agents (Valid)
1. **Overdue includes completed tasks** — only 1 task is truly overdue, count shows 2
2. **Stats ignore filter state** — effects 2/3 depend only on `tasks`, not `filterStatus`
3. **Dead signals** — `dragState` and `formError` have 0 subscribers
4. **Accessibility** — 9 unlabeled checkboxes in TaskList

---

## Round 5 — Post-Improvement Validation (2026-03-28)

**Goal:** Verify the improved CLAUDE.md (with decision tree, diagnostics, parameter types) actually helps.

### Agent 5A: Feature Build (Sort by Due Date in Board View)

- **Task:** Understand Board layout, switch views via signal, build sort feature, lint+validate
- **Result:** SUCCESS — built full SortByDueDate feature, 0 lint errors
- **Tokens:** ~57K total (43 tool uses)
- **MCP calls:** 32
- **Non-MCP escapes:** 0
- **Parameter type errors:** 0 (CLAUDE.md key params table worked)
- **Decision Tree usage:** Agent cited it as primary guide for tool selection
- **What worked:**
  - Decision Tree correctly guided tool selection at every step
  - "Understanding Diagnostics" section prevented confusion on signalCount=0
  - what_look-before-what_screenshot principle saved tokens when screenshot failed
  - what_diff_snapshot before/after workflow worked perfectly for view switch verification
- **New gaps found:**
  - No "browser not connected" recovery guidance (5 failed calls before opening browser)
  - Component ID instability not warned about (stale IDs after view switch)
  - what_screenshot failure modes not documented (tainted canvas)
  - what_set_signal `previous: undefined` display quirk not documented
  - what_scaffold params (props, signals, type options) not in parameter table

### Agent 5B: Theme Debugging + Accessibility Audit

- **Task:** Toggle dark/light theme, check contrast/readability, audit all interactive elements for a11y
- **Result:** SUCCESS — found real theme issues + 4 accessibility problems
- **Tokens:** ~55K total (39 tool uses)
- **MCP calls:** 32 (28 MCP + 1 Playwright for browser open + 3 what_lint)
- **Non-MCP escapes:** 1 (Playwright to open browser — "not connected" recovery)
- **Parameter type errors:** 1 (named_only boolean serialized as string — framework issue, not docs)
- **Findings:**
  - Completed TaskItems in dark mode: opacity 0.5 fails WCAG AA (~2.5:1 contrast vs required 4.5:1)
  - Stat labels borderline contrast in dark (~4:1)
  - 8 unlabeled checkboxes (no aria-label, no <label>)
  - StarRating missing container role="radiogroup"
  - Sort dropdown missing aria-label
  - Filter buttons missing aria-pressed
- **New gaps found:**
  - Same "not connected" recovery issue as 5A
  - Same component ID instability issue
  - what_set_signal cascading effects not documented (theme change triggered view switch)
  - what_lint false positive on signal-write-in-render not documented
  - what_snapshot tool not in decision tree

### Round 5 Summary

| Metric | Target | R4 | R5 | Trend |
|--------|--------|----|----|-------|
| Non-MCP escapes | 0 | 0 | 1 (browser open) | Regressed (need recovery docs) |
| Parameter errors | 0 | 2 | 0-1 | Improved (param table works) |
| Avg tokens | <=5K | ~46K | ~56K | Regressed (harder tasks) |
| "Missing tool" complaints | 0 | 5+/agent | 0 | Fixed (decision tree works) |
| Task success | 100% | 100% | 100% | Maintained |
| CLAUDE.md section citations | N/A | 2-3/agent | 5-6/agent | Agents using more sections |

### Key Improvements Validated (R4 -> R5)
1. **Decision Tree** — Both agents cited it as their primary navigation tool. 0 "which tool?" confusion.
2. **Understanding Diagnostics** — Prevented false confusion about subscriberless signals and empty component counts.
3. **Parameter Types** — 0 type errors on 5A (R4 had 2). The 1 error on 5B was a framework serialization bug.
4. **Workflows** — Performance audit and visual audit workflows were used as documented.

### Fixes Applied After Round 5
1. **Troubleshooting section added** to both root CLAUDE.md and create-what template:
   - "Not connected" recovery (open browser, wait 2-3s)
   - Component ID instability warning
   - Screenshot tainted canvas fallback
   - what_set_signal `previous: undefined` quirk
   - what_lint false positive on signal-write-in-render
2. **what_snapshot added** to decision tree
3. **what_scaffold params** added to parameter reference (type, props, signals)
4. **Principles 9-10 added:** Re-fetch IDs after state changes; what_set_signal can cascade
5. **what_diff_snapshot output capped** — Large added/removed lists now show count + sample (max 10), saves ~1500 tokens per diff with view switches
6. **what_dependency_graph values truncated** (from R4) — Arrays show `Array(N)` instead of full contents

---

## Round 6 — Multi-Signal Interactions + Code Generation (2026-03-28)

**Goal:** Push into harder territory: multi-signal cascade debugging and accessibility-first code generation with lint validation.

### Agent 6A: Multi-Signal Cascade Debugging

- **Task:** Debug order-of-operations bug where search->sort loses results but sort->search works
- **Result:** SUCCESS — identified root cause in 12 MCP calls
- **Tokens:** ~45K total (18 tool uses)
- **MCP calls:** 12 (!!!)
- **Non-MCP escapes:** 0
- **Parameter errors:** 0
- **Root cause found:** sortBy has only 1 downstream effect while searchQuery has 12. effect_1 (the main filter/sort effect) appears to lose its sortBy subscription during component remount cycles triggered by search. Board column effects don't subscribe to sortBy at all.
- **Most valuable tools:** what_diff_snapshot (save/diff/save/diff pattern was "smoking gun"), what_dependency_graph (revealed asymmetric subscriptions)
- **CLAUDE.md assessment:**
  - Decision Tree: "Used heavily to pick the right tool at each step. Accurate for every choice."
  - Disconnected reactivity workflow: "Exactly the right mental model"
  - New gaps: No multi-signal interaction debugging workflow; no "effect should have fired but didn't" pattern; no runCount interpretation guidance

### Agent 6B: Accessibility-First Code Generation

- **Task:** Audit accessibility issues, use what_scaffold + what_lint to write accessible components
- **Result:** SUCCESS — wrote 2 complete components, both lint-validated
- **Tokens:** ~37K total (17 tool uses) — BEST efficiency yet
- **MCP calls:** 12
- **Non-MCP escapes:** 0
- **Parameter errors:** 0
- **Components built:**
  - AccessibleTaskItem: labeled checkbox with aria-label, role="listitem", reactive styling
  - AccessibleFilterBar: role="group" with aria-label, aria-pressed on buttons, visually-hidden label for select
- **Lint results:** TaskItem passed all 7 rules. FilterBar had 2 expected false positives on signal-write-in-render (inline handlers). Confirmed by re-running with rule excluded.
- **What_scaffold assessment:** "Boilerplate was too generic to save meaningful effort for a targeted rewrite." Suggested: `accessible: true` option, `based_on: componentId` to scaffold from existing DOM.
- **CLAUDE.md assessment:**
  - Decision Tree: "guided tool selection perfectly"
  - False positive docs: "critical — without it I would have wasted time restructuring correct code"
  - New gaps: No accessibility patterns; inline arrow handlers should be mentioned alongside named handlers in lint FP docs

### Round 6 Summary

| Metric | Target | R1 | R4 | R5 | R6 | Trend |
|--------|--------|----|----|----|----|-------|
| Avg MCP calls | <=10 | 0 | 25 | 32 | **12** | Improving fast |
| Non-MCP escapes | 0 | 30+ | 0 | 1 | **0** | Fixed |
| Parameter errors | 0 | N/A | 2 | 0-1 | **0** | Fixed |
| Avg tokens | <=5K | 61K | 46K | 56K | **41K** | 33% better than R4 |
| CLAUDE.md sections cited | N/A | 0 | 3 | 5-6 | **6-8** | Agents using everything |
| Task success | 100% | 0% | 100% | 100% | **100%** | Maintained |

### Key R6 Findings
1. **12 MCP calls per agent** — the CLAUDE.md is now guiding efficient tool selection. Agents aren't flailing.
2. **what_diff_snapshot save/diff/save/diff** pattern is the killer debugging workflow. Both rounds proved it.
3. **what_lint with rule exclusion** for false positive confirmation is a validated pattern.
4. **what_scaffold is too generic** for specialized tasks — feature idea for `accessible: true` option.

### Fixes Applied After Round 6
1. **Multi-signal interaction workflow** added to CLAUDE.md and create-what template
2. **Stale subscription debugging pattern** added (effect should fire but doesn't)
3. **Lint false positive clarification** — inline arrow handlers added alongside named handlers
4. **Both root CLAUDE.md and create-what template updated**

---

## Round 7 — Token Efficiency Push (2026-03-28)

**Goal:** <10 MCP calls and <35K tokens per task. Agents given explicit call budget.

### Agent 7A: Live State Orchestration (10-call budget)

- **Task:** Full round-trip: dark/board -> light/list -> dark/board. Verify each step with diff_snapshot.
- **Result:** SUCCESS — 10 calls exactly, full round-trip verified
- **Tokens:** ~31K total (14 tool uses)
- **MCP calls:** 10
- **Key technique:** Aggressive parallel batching (2-3 calls per round). Skipped redundant verification — diff already proves state.
- **New gaps:** No parallel-safe tool guidance, no compact mode for diff, no initial state recommendation

### Agent 7B: Performance Profiling (8-call budget)

- **Task:** Profile reactive performance, find bottlenecks, propose optimization, lint-validate it
- **Result:** SUCCESS — complete profile + optimization in 8 calls
- **Tokens:** ~37K total (10 tool uses)
- **MCP calls:** 8 (beat the budget)
- **Key findings:**
  - `tasks` signal: 13 subscribers (hot hub). `searchQuery`: 12. `filterStatus`: 11.
  - 4 duplicate viewMode effects (5, 7, 8, 19) — all ran 4 times
  - Adding 1 task triggers 73 reactive operations
  - Memory: 34.7 KB (not a concern)
- **Optimizations proposed:** computed() memoization layer for filtered tasks, viewMode effect consolidation, batch() for multi-signal writes. All lint-validated.
- **Key technique:** Used what_perf subscriber data to skip what_signals. Parallelized perf+effects, graph+save, diff+lint.
- **New gaps:** Same parallel-safe tool request; what_perf/what_signals overlap not documented; diff cascade metrics (effectsAdded vs effectsTriggered) not explained

### Round 7 Summary

| Metric | Target | R1 | R4 | R5 | R6 | R7 | Trend |
|--------|--------|----|----|----|----|-----|-------|
| Avg MCP calls | <=10 | 0 | 25 | 32 | 12 | **9** | 64% better than R6 |
| Non-MCP escapes | 0 | 30+ | 0 | 1 | 0 | **0** | Maintained |
| Parameter errors | 0 | N/A | 2 | 0-1 | 0 | **0** | Maintained |
| Avg tokens | <=5K | 61K | 46K | 56K | 41K | **34K** | 17% better than R6 |
| Task success | 100% | 0% | 100% | 100% | 100% | **100%** | Maintained |

### Fixes Applied After Round 7
1. **Parallel-safe tool list** added — explicit list of read-only tools safe to batch
2. **Diff cascade metrics explained** — effectsTriggered vs effectsAdded vs effectsRemoved
3. **what_perf/what_signals overlap noted** — skip what_signals when what_perf already has subscriber data
4. **Both root CLAUDE.md and create-what template updated**

---

## Round 8+ — Next Phase (Hourly Iteration)

**Status:** The CLAUDE.md is now mature. Key metrics from R1 -> R7:
- MCP calls: 0 -> 9 (agents went from unable to use tools to surgically efficient)
- Escapes: 30+ -> 0 (no Playwright/grep/read fallbacks needed)
- Param errors: N/A -> 0 (all types documented)
- Tokens: 61K -> 34K (44% reduction)
- CLAUDE.md citations: 0 -> 6-8 sections per agent (agents actively using every section)

**Remaining token gap:** 34K vs 5K target. The overhead is primarily:
- Tool result JSON serialization (~15K)
- Agent reasoning between calls (~10K)
- Task planning/reporting (~9K)
The 5K target may be unrealistic for complex multi-step tasks — 20-30K may be the practical floor.

**Next focus areas:**
- Server-side: Further output compression (compact mode for diff, summary-only mode for dep graphs)
- CLAUDE.md: Consider adding task-type templates ("debugging template", "code gen template") that prescribe exact 5-8 call sequences
- Testing: Try completely novel tasks (e.g., "build a router plugin", "add animation to transitions") that aren't covered by existing workflows

---

## Round 8 — Creative Building Tasks (2026-03-28)

**Goal:** Test BUILD tasks (not just debug). Can the CLAUDE.md guide agents through designing + implementing + validating new features?

### Agent 8A: Build Notification Toast System (8-call budget)

- **Task:** Build notifications signal, NotificationToast component, NotificationContainer, integrate with task complete/delete
- **Result:** SUCCESS — complete notification system built and lint-validated
- **Tokens:** ~53K total (33 tool uses — higher because agent also read/wrote source)
- **MCP calls:** 8
- **Non-MCP escapes:** 0 (but did read source files to understand existing patterns)
- **Code output:** ~100 LOC notification system with auto-dismiss, color-coded types, CSS animation
- **what_scaffold assessment:** "Low survival rate (~10%). Only import pattern and function shape used."
- **New gaps:**
  - No signal() scope guidance (agent initially used wrong API)
  - No "existing code patterns" tool — agents need to understand app structure before building
  - Scaffold store template pushed toward unnecessary createStore abstraction

### Agent 8B: Build Keyboard Shortcuts System (10-call budget)

- **Task:** Build KeyboardShortcuts + ShortcutHelp overlay, test with set_signal/diff
- **Result:** SUCCESS — complete keyboard system with integration test
- **Tokens:** ~34K total (14 tool uses — excellent efficiency)
- **MCP calls:** 10 (exact budget)
- **Integration test:** save -> set_signal(theme + viewMode) -> diff proved shortcuts would trigger correct cascades
- **what_scaffold assessment:** "Starting point, not production code. Useful to confirm idiomatic patterns."
- **New gaps:**
  - No "test your changes" workflow for build tasks
  - No CSS scaffolding — UI components need CSS but scaffold only produces JS
  - Missing guidance on integrating generated code into existing app

### Round 8 Summary

| Metric | R6 | R7 | R8 | Notes |
|--------|----|----|-----|-------|
| Avg MCP calls | 12 | 9 | **9** | Maintained |
| Avg tokens | 41K | 34K | **44K** | Up (BUILD tasks require source reads) |
| Non-MCP escapes | 0 | 0 | **0** | Maintained |
| Param errors | 0 | 0 | **0** | Maintained |
| Task success | 100% | 100% | **100%** | Maintained |

### Key R8 Finding: BUILD vs DEBUG

BUILD tasks have fundamentally different needs than DEBUG tasks:
- **DEBUG:** Agent inspects live app, traces reactive chains, identifies root causes. MCP tools are the ONLY interface needed.
- **BUILD:** Agent needs (1) existing code patterns (reading source), (2) scaffold for structure, (3) lint for validation, (4) diff for integration testing. MCP tools complement source reading, don't replace it.

The CLAUDE.md already guides BUILD tasks well for steps 2-4, but agents still need to read source to understand existing patterns. This is fine — the MCP tools aren't meant to replace source reading for builds.

### Fixes Applied After Round 8
1. **Signal scope section** added to Writing Code (module-scope vs component-scope)
2. **"Build & Test" workflow** added to Workflows section
3. **Scaffold honest limitations** documented ("~10% survival rate, skeleton not production code")
4. **Both root CLAUDE.md and create-what template updated**

---

## Cumulative Progress (R1 -> R8)

| Metric | R1 | R4 | R5 | R6 | R7 | R8 |
|--------|----|----|----|----|-----|-----|
| Avg MCP calls | 0 | 25 | 32 | 12 | 9 | 9 |
| Non-MCP escapes | 30+ | 0 | 1 | 0 | 0 | 0 |
| Param errors | N/A | 2 | 0-1 | 0 | 0 | 0 |
| Avg tokens | 61K | 46K | 56K | 41K | 34K | 44K |
| Task success | 0% | 100% | 100% | 100% | 100% | 100% |
| CLAUDE.md sections | 2 | 8 | 10 | 12 | 13 | 15 |

**CLAUDE.md now contains:**
- 22-entry decision tree
- 10 workflows (find, debug, before/after, perf, visual, health, disconnected, multi-signal, stale subscription, build & test)
- Understanding Diagnostics (5 entries)
- Parameter reference (12 entries)
- Parallel-safe tool list
- Diff cascade metrics
- Signal scope guidance
- 10 principles
- 5 troubleshooting entries
- Scaffold honest assessment

The CLAUDE.md has reached maturity for the current tool set. Further improvements are incremental — the agent-first developer experience is fundamentally improved.

---

## Round 9 — Max Variety + Multi-Model (2026-03-28)

**Goal:** 3 agents with maximum variety: trivial task, full architecture map, error handling edge cases. Also created AGENTS.md for model-agnostic use.

### Agent 9A: Trivial 3-Call Task

- **Task:** What's the current theme and how many tasks are completed?
- **Result:** BLOCKED — browser disconnected between rounds (all 3 calls failed with "No browser connected")
- **Tokens:** ~21K (5 tool uses)
- **MCP calls:** 3 (all connection errors)
- **Finding:** Browser WebSocket connection drops when tab closes/computer sleeps. The troubleshooting section told the agent what to do but it couldn't fix it (can't open a browser).

### Agent 9B: Full Architecture Map (12-call budget)

- **Task:** Map all components, signals, effects, reactive graph, layout, issues
- **Result:** PARTIAL — 7/9 MCP calls blocked by disconnection, but agent pivoted to source reading and produced an excellent architecture map
- **Tokens:** ~48K (22 tool uses)
- **MCP calls:** 9 (only 2 worked: connection_status + lint)
- **Valuable findings:**
  - what_lint found a real bug: `value={text}` missing signal read (should be `value={text()}`)
  - Discovered examples/task-manager doesn't have devtools plugin configured
  - Agent compensated by reading source — proves MCP tools complement, don't replace source reading
  - Found unused `batch` import (dead code)

### Agent 9C: Error Handling Edge Cases (8-call budget)

- **Task:** Test error responses for invalid IDs, empty filters, broken code
- **Result:** SUCCESS — comprehensive error quality audit in 6 calls
- **Tokens:** ~24K (8 tool uses)
- **Key findings on error quality:**
  - Connection errors mask input validation (signalId 999 returns "No browser connected" not "Signal not found")
  - Inconsistent error shapes: some use `{summary, nextSteps}`, others `{hint, tool, nextSteps}`
  - what_lint caught 2/4 intentional bugs (signal-write-in-render + missing-cleanup)
  - Every error includes `nextSteps` — always actionable
  - Missing error codes on connection errors (lint has `ERR_*` codes, connection errors are just strings)
- **Recommended addition:** Error handling section for CLAUDE.md

### Round 9 Summary

| Metric | R8 | R9 | Notes |
|--------|----|----|-------|
| Task success | 100% | 33% (1 full, 1 partial, 1 blocked) | Browser disconnection |
| Avg tokens | 44K | 31K | Lower because connection errors returned fast |
| New issues found | 0 | 4 (error shapes, lint coverage, connection masking, dead code) | |

### Fixes Applied After Round 9
1. **AGENTS.md updated** — MCP section rewritten with battle-tested 28-tool decision tree, recipes, parameter types, pitfalls, efficiency tips (was outdated with 18 tools)
2. **create-what now scaffolds AGENTS.md** alongside CLAUDE.md and .mcp.json
3. **Error handling guidance added** to CLAUDE.md Troubleshooting section (connection errors mask validation, offline tools always work)
4. **Browser reconnected** — opened app in browser to restore WebSocket bridge

### Multi-Model Strategy (New)
- `CLAUDE.md` — Claude Code (mature, iterated through R1-R9)
- `AGENTS.md` — Model-agnostic (OpenCode, Codex, Gemini, Cursor, any MCP agent). Recipe-based, prescriptive format.
- `.mcp.json` — MCP server config (works with any MCP-capable tool)
- `.cursor/mcp.json` — Cursor-specific MCP config
- **Next:** Test with Kimi K2, DeepSeek V3 via OpenCode. Test with Codex CLI. Compare performance across models.

---

## Cumulative Progress (R1 -> R9)

| Metric | R1 | R4 | R5 | R6 | R7 | R8 | R9 |
|--------|----|----|----|----|-----|-----|-----|
| Avg MCP calls | 0 | 25 | 32 | 12 | 9 | 9 | 6 |
| Non-MCP escapes | 30+ | 0 | 1 | 0 | 0 | 0 | 0 |
| Param errors | N/A | 2 | 0-1 | 0 | 0 | 0 | 0 |
| Avg tokens | 61K | 46K | 56K | 41K | 34K | 44K | 31K |
| Task success | 0% | 100% | 100% | 100% | 100% | 100% | 33%* |

*R9 success rate lowered by browser disconnection, not CLAUDE.md quality.

**Total test agents dispatched:** 12 (across 6 rounds)
**Total commits:** 6
**CLAUDE.md sections:** 17 (decision tree, 11 workflows, diagnostics, params, parallel-safe, diff metrics, signal scope, principles, troubleshooting, scaffold note, error handling)
**Files shipped by create-what:** CLAUDE.md, AGENTS.md, .mcp.json, .cursor/mcp.json

---

## Round 10 — AGENTS.md Validation + Rapid-Fire Efficiency (2026-03-28)

**Goal:** Test the AGENTS.md recipe format (simulating non-Claude models) and push efficiency limits.

### Agent 10A: AGENTS.md Format Test (Simulating Non-Claude Model)

- **Task:** Debug Stats not updating with filter changes, using ONLY AGENTS.md as guide
- **Result:** SUCCESS — found root cause in 7 calls
- **Tokens:** ~27K (8 tool uses)
- **MCP calls:** 7 (1 retry from named_only type error)
- **Root cause:** Stats has 0 signals/0 effects — completely disconnected from filterStatus reactive graph
- **AGENTS.md assessment:**
  - Recipes worked well for the standard find-component and debug-signal workflows
  - Parameter type table prevented most mistakes but named_only still tripped once (string vs boolean)
  - Missing: "reactivity gap" recipe (why doesn't component X react to signal Y?)
  - Missing: guidance on interpreting 0-signal/0-effect components (means disconnected)
  - Suggestion: add concrete examples like `what_signals({filter: "name", named_only: true})` in recipes

### Agent 10B: Rapid-Fire 5 Micro-Tasks (15-call budget)

- **Task:** Theme check, component count, hottest signal, perf check, write+lint computed
- **Result:** ALL 5 TASKS COMPLETE — **5 calls (budget was 15, 67% under)**
- **Tokens:** ~24K (7 tool uses)
- **MCP calls:** 5 total (1 per task avg, 2 shared between tasks)
- **Key technique:** Batched 3 parallel calls in round 1 (connection_status + perf + signals), 2 in round 2 (dep_graph + lint). Tasks 2 and 4 were free (answered from other calls' data).
- **Results:** theme=light, 13 components, tasks signal (3 downstream effects), no perf issues (0 hot effects), computed overdueCount lint-validated

### Round 10 Summary

| Metric | R9 | R10 | Notes |
|--------|----|----|-------|
| Task success | 33%* | **100%** | Browser reconnected |
| Avg MCP calls | 6 | **6** | R10B achieved 1 call/task |
| Avg tokens | 31K | **26K** | Best yet |
| Parameter errors | 0 | **1** | named_only in AGENTS.md test |

### Fixes Applied After Round 10
1. **"Reactivity gap" recipe** added to AGENTS.md (why component X doesn't react to signal Y)
2. Pushed all commits to remote

**Total across all rounds:** 14 test agents, 7 rounds active, 7 commits, 3 files scaffolded by create-what (CLAUDE.md, AGENTS.md, .mcp.json)

---

## Round 11 — Tool Audit + Stress Test (2026-03-28)

**Goal:** Test lesser-used tools and stress-test rapid mutations.

### Agent 11A: Untested Tools Audit (12-call budget)

- **Task:** Test what_watch, what_signal_trace, what_fix, what_validate, what_eval, what_dom_inspect, what_component_tree
- **Result:** SUCCESS — comprehensive quality audit of 7 tools
- **Tokens:** ~29K (13 tool uses)
- **MCP calls:** 12
- **Tool rankings:**
  | Tool | Quality | CLAUDE.md Priority |
  |---|---|---|
  | **what_fix** | Excellent (diagnosis + fix + code example, offline, ~160 tokens) | HIGH — hidden gem |
  | **what_dom_inspect** | Very useful (raw DOM, structured tree, ~300 tokens) | MEDIUM |
  | **what_watch** | Partial (captures user events, misses programmatic set_signal) | MEDIUM |
  | **what_signal_trace** | Partial (needs what_watch running first for write history) | MEDIUM |
  | **what_validate** | Shallow (pass/fail syntax only, ~100 tokens) | LOW |
  | **what_eval** | Blocked (disabled by default, correct security posture) | LOW |
  | **what_component_tree** | Broken (parentId always null, hierarchy non-functional) | LOW |

### Agent 11B: Stress Test — Rapid Sequential Mutations (10-call budget)

- **Task:** 6 rapid signal mutations (3 forward + 3 reverse), verify clean round-trip
- **Result:** PASS — 0 errors, 0 stale data, clean round-trip in exactly 10 calls
- **Tokens:** ~26K (13 tool uses)
- **Key findings:**
  - All 6 mutations registered correctly with accurate prev/current values
  - Reactive cascading worked: filterStatus="active" correctly unmounted 6 components, reversal remounted them
  - Signal count grew from 25 to 49 during session (new component instances created signals)
  - 184 events in 60s labeled "normal" — no runaway effects
  - 0 runtime errors from rapid mutations

### Fixes Applied After Round 11
1. **what_fix promoted** to prominent CLAUDE.md position (labeled "hidden gem")
2. **what_validate** added to code quality tools
3. **what_signal_trace prerequisite** documented (needs what_watch running first)
4. **what_eval disabled** documented in diagnostics
5. **what_component_tree broken** noted (prefer what_components)

**Cumulative: 16 test agents, 8 rounds active, 9 commits, R1→R11**

---

## Round 12 — Onboarding + Code Review Workflows (2026-03-28)

**Goal:** Test two untested use cases: new developer onboarding and code review via MCP only.

### Agent 12A: New Developer Guided Walkthrough (8-call budget)

- **Task:** Follow CLAUDE.md step by step as a brand-new developer to understand the app
- **Result:** SUCCESS — 6 calls, produced accurate 3-sentence app summary from MCP data alone
- **Tokens:** ~35K (9 tool uses)
- **CLAUDE.md ordering assessment:** "Yes, mostly natural. Would move diagnose to position 2 (right after connection_status)."
- **New gaps:**
  - No "Quick Start" section for new developers (5-minute onboarding path)
  - Should note that container components (App) show 0 signals — start with leaf components
  - Signal value truncation not documented

### Agent 12B: Code Review via MCP Only (10-call budget)

- **Task:** Full code review covering reactivity, performance, accessibility, dead code, architecture
- **Result:** SUCCESS — 6 calls, 12 findings (2 critical, 4 warning, 6 info)
- **Tokens:** ~33K (8 tool uses)
- **Findings:**
  - CRITICAL: 8 unlabeled checkboxes, 65 orphan effects (possible leak)
  - WARNING: theme/viewMode signals disconnected (0 subscribers), monolithic filter+sort effect, garbled select label
  - INFO: clean dependency graph (star topology from tasks), healthy performance (39KB, 0 hot effects)
- **Verdict:** "Code Review via MCP is viable. Worth adding to CLAUDE.md."
- **Recommended workflow:** diagnose + page_map + signals(named_only) + perf + dependency_graph = first-pass code review in 5-6 calls

### Fixes Applied After Round 12
1. **Quick Start section** added to CLAUDE.md and create-what template (5-step onboarding path)
2. **Diagnose moved to position 2** in recommended flow (after connection_status, before page_map)
3. **"Code Review via MCP" workflow** added to Workflows section
4. **Leaf component tip** added (start with TaskItem, not App)
5. **Both root CLAUDE.md and create-what template updated**

### Tool Fix Status (from pre-R12 work)
All 4 tool fixes committed and pushed but need MCP server restart to take effect:
- what_component_tree: infer hierarchy from mount order
- what_eval: safe read-only expressions without --unsafe-eval
- what_signal_trace: auto-initialize event tracking (not lazy)
- what_watch: flush events immediately after set_signal

**Cumulative: 18 test agents, 9 rounds active, R1→R12. CLAUDE.md: 20 sections, 12 workflows.**
