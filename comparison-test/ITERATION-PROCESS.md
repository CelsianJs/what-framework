# WhatFW MCP Iteration Process

## Goal

Fresh agents (zero prior context) perform complex debugging and building tasks on WhatFW apps using MCP tools, with **low token usage** and **high success rate**. Each iteration cycle improves the tools based on real agent feedback.

## The Cycle

```
┌─────────────────────────────────────────────────────────────┐
│  1. DISPATCH TEST AGENT                                     │
│     - Fresh subagent, zero context about WhatFW              │
│     - Given: app URL, entry point, task description           │
│     - Given: CLAUDE.md + MCP server connection                │
│     - Task: debug/build/improve the running app               │
│     - Tracked: every tool call, token count, time, success    │
├─────────────────────────────────────────────────────────────┤
│  2. COLLECT METRICS                                          │
│     Agent reports back:                                       │
│     - Tool calls: which tools, in what order, how many        │
│     - Token usage: input + output                             │
│     - Success: did it complete the task?                      │
│     - Pain points: what was confusing, broken, or wasteful?   │
│     - Fallbacks: did it escape to Playwright/grep/manual?     │
│     - Time to first useful action                             │
├─────────────────────────────────────────────────────────────┤
│  3. ANALYZE                                                  │
│     Coordinator reviews:                                      │
│     - Where did the agent waste tokens? (noise, wrong tools)  │
│     - Where did it escape MCP? (broken tools, missing tools)  │
│     - What tools were never called? (discovery problem)       │
│     - What tools were called but useless? (bad output)        │
│     - What questions did the agent ask that tools should answer│
├─────────────────────────────────────────────────────────────┤
│  4. IMPROVE                                                  │
│     Fix the identified issues:                                │
│     - Fix broken tools                                        │
│     - Improve noisy tool output                               │
│     - Add missing tools                                       │
│     - Improve tool descriptions                               │
│     - Update CLAUDE.md / MCP prompt                           │
│     - Update tool-pipelines guide                             │
├─────────────────────────────────────────────────────────────┤
│  5. RE-TEST with FRESH agent                                 │
│     New subagent, same task, see if metrics improved          │
│     Compare: tokens, tool calls, success, time                │
│     If improved → next task/scenario                          │
│     If not → back to step 3                                   │
└─────────────────────────────────────────────────────────────┘
```

## Test Scenarios (Progressive Difficulty)

### Level 1: Orientation
"Connect to the running app and tell me what it is, what components it has, and what the current state looks like."
- **Measures:** Can the agent orient itself using only MCP tools?
- **Success:** Correct app description, component list, signal values — no file grepping

### Level 2: Visual Inspection
"The Stats component looks wrong. Check its layout, styles, and values."
- **Measures:** Can the agent use what_look/what_explain instead of screenshots?
- **Success:** Identifies component by ID, reads styles, checks signal values

### Level 3: State Debugging
"The filter isn't working — clicking 'Active' still shows completed tasks."
- **Measures:** Can the agent trace state flow using what_signal_trace/what_dependency_graph?
- **Success:** Identifies the filterStatus signal, traces to filteredTasks computed, finds the bug

### Level 4: Bug Fix
"Add a 'Sort by Name' option to the sort dropdown."
- **Measures:** Can the agent use what_lint, edit code, verify via MCP?
- **Success:** Code is correct, what_diagnose shows no errors, what_look confirms UI change

### Level 5: Complex Feature
"Add drag-and-drop task reordering."
- **Measures:** Full development cycle: scaffold → code → lint → verify → debug
- **Success:** Working feature, low token count, minimal non-MCP tool usage

## Agent Prompt Template

```
You are testing WhatFW's MCP DevTools. You have access to an MCP server called
"what-devtools-mcp" that connects to a live WhatFW app running in the browser.

Your task: {TASK_DESCRIPTION}

The app is running at http://localhost:3456.
Source code is at: packages/devtools-mcp/test/demo-app/app.jsx

RULES:
- Use MCP tools as your PRIMARY way to inspect the app
- Start with what_connection_status to orient yourself
- Use what_look instead of screenshots whenever possible
- Use what_signals with filter instead of dumping all state
- Track your own efficiency: note when you use non-MCP tools and why

When you're done, report:
1. Task result (success/partial/failed)
2. Tool call log: list every MCP tool you called, in order
3. Non-MCP escapes: any time you used Playwright, grep, or file reads instead of MCP
4. Pain points: what was confusing, broken, slow, or noisy
5. Suggestions: what tool/feature would have helped
6. Token estimate: rough count of your input+output
```

## Metrics Dashboard

After each test, record:

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Tool calls to orient | <= 2 | Count calls before first useful action |
| Total MCP tool calls | <= 15 per task | Count from agent report |
| Non-MCP escapes | 0 | Count Playwright/grep/file reads |
| Token usage | <= 5K per task | Agent self-report + API tracking |
| Task success | 100% | Binary + quality score |
| Time to first useful insight | <= 30s | From connection to first finding |
| Broken tool encounters | 0 | Count error responses from MCP |

## Running the Iteration

### From the coordinator session (this one):

```
1. Start demo app:
   ! cd ~/Desktop/Coding/ZVN/WhatStack/what-fw && npx vite --config packages/devtools-mcp/test/demo-app/vite.config.js

2. Dispatch test agent (subagent):
   Agent: "You are testing WhatFW MCP DevTools. [scenario prompt]. Report metrics when done."

3. Read agent's feedback

4. Fix issues identified

5. Kill and restart demo app (pick up code changes)

6. Dispatch NEW fresh agent with same scenario

7. Compare metrics

8. Repeat until targets met, then advance to next scenario
```
