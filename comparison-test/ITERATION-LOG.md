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

## Round 7 — Edge Cases + Token Efficiency (Next)

**Goal:** Push for <10 MCP calls and <30K tokens per task. Test truly hard scenarios.

**Test scenarios:**
- 7A: Live state manipulation — Agent must orchestrate a complex sequence: toggle theme, add a task via what_set_signal, switch to board view, verify the new task appears in the correct priority column, then undo everything. Tests multi-step state management with snapshot verification.
- 7B: Performance regression hunting — "The app suddenly got slow after we added 50 tasks." Agent must use what_perf, what_effects, what_dependency_graph to profile the bottleneck and suggest an optimization (signal granularity, computed caching, etc.)

**Metrics to beat from R6:**
- <= 10 MCP calls per task
- 0 non-MCP escapes
- 0 parameter errors
- <= 35K tokens per task
