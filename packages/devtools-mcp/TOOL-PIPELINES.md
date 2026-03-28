# WhatFW MCP DevTools: Tool Pipeline Guide

> **Audience:** AI coding agents (Claude Code, Cursor, Windsurf, Copilot, etc.)
> **Purpose:** Call the right tools, in the right order, using the fewest tokens.
> **Tools covered:** 28

This document is available as an MCP resource at `what://docs/tool-pipelines`.

---

## 1. Tool Tiers and Token Costs

Every tool has a cost. The cost is the approximate number of tokens in the response payload. Cheaper tools should be preferred when they answer the question.

### Tier 1 -- Free (no bridge needed, static analysis)

These tools work offline. They do not require a browser connection.

| Tool | What it does | Approx tokens |
|------|-------------|---------------|
| `what_lint` | Static analysis on a code snippet. Catches 7 common mistakes. | 50-200 |
| `what_scaffold` | Generate idiomatic boilerplate (component, page, form, store, island). | 100-300 |
| `what_fix` | Given an error code, returns diagnosis + fix + code example. | 100-200 |

**When to use Tier 1:** Before saving code (`what_lint`), when generating new code (`what_scaffold`), when an error code appears (`what_fix`). These never fail due to disconnection.

### Tier 2 -- Cheap (~100-300 tokens)

Lightweight queries that return small payloads.

| Tool | What it does | Approx tokens |
|------|-------------|---------------|
| `what_connection_status` | Is the browser connected? How many signals/effects/components? | 100-150 |
| `what_route` | Current path, params, query, matched route pattern. | 100-200 |
| `what_navigate` | Navigate to a different route. Returns new path. | 100-150 |

**When to use Tier 2:** First call in any session (`what_connection_status`), route debugging (`what_route`), testing navigation (`what_navigate`).

### Tier 3 -- Standard (~300-800 tokens)

The workhorse tools. Most debugging starts here.

| Tool | What it does | Approx tokens |
|------|-------------|---------------|
| `what_signals` | List signals with current values. Filterable by name or ID. | 200-600 |
| `what_effects` | List effects with deps, run counts, timing. Filterable. | 200-600 |
| `what_components` | List mounted components with tree summary. | 200-500 |
| `what_snapshot` | Full state dump (signals + effects + components + errors). | 400-800 |
| `what_errors` | Runtime errors with classification, severity, and suggestions. | 200-600 |
| `what_cache` | SWR/useQuery cache entries. | 200-400 |
| `what_diagnose` | One-call health check: errors + performance + reactivity issues. | 300-800 |
| `what_look` | Computed styles, bounding rect, layout, text, accessibility. | 300-500 |
| `what_page_map` | Full page skeleton: landmarks, interactives, headings, positions. | 500-1000 |
| `what_perf` | Performance snapshot: hot effects, subscriber counts, memory. | 300-600 |

**When to use Tier 3:** `what_diagnose` is the default "check everything" tool. `what_look` replaces screenshots in most cases. `what_signals` and `what_effects` are for targeted state inspection.

### Tier 4 -- Rich (~800-2000 tokens)

Deep inspection tools that return large structured data.

| Tool | What it does | Approx tokens |
|------|-------------|---------------|
| `what_explain` | Everything about one component: signals, effects, DOM, errors. | 600-1500 |
| `what_component_tree` | Hierarchical tree with parent-child links and signal/effect counts. | 400-1500 |
| `what_dependency_graph` | Reactive graph: which signals feed which effects. | 400-1500 |
| `what_signal_trace` | Causal chain: who wrote to a signal and why. | 400-1200 |
| `what_diff_snapshot` | Before/after comparison of full app state. | 300-1000 |
| `what_watch` | Collect reactive events over a time window. | 300-2000 |
| `what_dom_inspect` | Rendered DOM output of a component (HTML + structure). | 400-1500 |
| `what_validate` | Compile code through the browser pipeline; returns errors or output. | 300-800 |

**When to use Tier 4:** When Tier 3 tools reveal an issue that needs deeper investigation. `what_explain` replaces 4 separate calls. `what_signal_trace` answers "why did this change?"

### Tier 5 -- Expensive (5-20KB)

Visual tools with large payloads.

| Tool | What it does | Approx tokens |
|------|-------------|---------------|
| `what_screenshot` | Base64 image of a component's bounding box. | 5000-20000 |

**When to use Tier 5:** Only after `what_look` is insufficient. Always try text-based inspection first.

### Tier 6 -- Dangerous (requires explicit flag)

These tools mutate state or execute arbitrary code. Use with care.

| Tool | What it does | Requires |
|------|-------------|----------|
| `what_eval` | Execute arbitrary JS in the browser context. | `--unsafe-eval` flag or `WHAT_UNSAFE_EVAL=1` env var |
| `what_set_signal` | Set a signal value; triggers reactive updates. | Connected browser |
| `what_invalidate_cache` | Force-refresh a cache key; triggers refetch. | Connected browser |

**When to use Tier 6:** `what_set_signal` for testing "what happens if this value changes?" scenarios. `what_invalidate_cache` for stale data issues. `what_eval` is an escape hatch -- prefer structured tools.

---

## 2. Recommended Pipelines

### Pipeline A: "I just connected -- what's the app state?"

**Use when:** Starting a new session, reconnecting after HMR, or orienting yourself.

```
Step 1: what_connection_status
         -> Confirms bridge is up, gets signal/effect/component counts.
         -> If not connected: STOP. Fix the connection first.

Step 2: what_page_map
         -> Full page skeleton with landmarks, headings, interactive
            elements, and component boundaries with positions.

Step 3: what_components
         -> List all components with IDs and tree summary.
```

**Result:** ~600 tokens. Agent knows the app structure, page layout, and component inventory.

**When to skip steps:**
- If `what_connection_status` shows 0 components, the app may not be rendering. Check for errors with `what_errors`.
- If you only need component IDs, skip `what_page_map`.

---

### Pipeline B: "Something looks wrong"

**Use when:** A visual bug is reported, the UI does not match expectations, or something "looks off."

```
Step 1: what_diagnose
         -> One-call health check: errors, performance issues, reactivity
            problems.
         -> If errors found: what_fix { error: "<code>" } for each error.
         -> If errors found: investigate and fix. Done.

Step 2: what_look { componentId }
         -> If no errors but visually wrong: inspect the specific
            component's computed styles, dimensions, layout, text.
         -> If layout is wrong: check the parent component with
            what_look { componentId: <parentId> }
         -> If the text description makes the issue clear: fix it. Done.

Step 3: what_screenshot { componentId, maxWidth: 300 }
         -> Only if what_look's text description is ambiguous.
         -> Crop to just the component (not full page).
```

**Result:** ~500-1500 tokens depending on path taken.

**Key rule:** Always try `what_look` before `what_screenshot`. The text description is 10-40x cheaper and sufficient for layout issues, missing text, wrong colors, and sizing bugs.

---

### Pipeline C: "Why did this value change?"

**Use when:** A signal has an unexpected value, state changed without obvious cause, or tracking down a reactive chain.

```
Step 1: what_signals { filter: "<name>" }
         -> Find the signal, confirm its current value, get its ID.
         -> If the value is correct: the bug is elsewhere. STOP.

Step 2: what_signal_trace { signalId }
         -> Shows: which effects wrote to this signal, the causal chain,
            what signals those effects depend on.
         -> Example output: "signal 'count' was written by effect
            'handleClick', which depends on signal 'buttonRef'"

Step 3: what_dependency_graph { signalId }
         -> Full reactive graph radiating from this signal.
         -> Shows all effects that read it (downstream) and all signals
            that feed the writing effects (upstream).
```

**Result:** ~800 tokens. Agent can trace any state flow from cause to effect.

**Shortcut:** If you already know the signal ID, skip step 1.

---

### Pipeline D: "Tell me everything about this component"

**Use when:** Deep-diving into a single component's behavior.

```
Step 1: what_explain { componentId }
         -> Returns in ONE call:
            - All signals with current values
            - All effects with dependency names and run counts
            - Rendered DOM output (HTML)
            - Any errors associated with this component
```

**Result:** ~800 tokens, but saves 3-4 separate round trips.

**This single call replaces:**
- `what_signals { componentId }` -- signals
- `what_effects { componentId }` -- effects
- `what_dom_inspect { componentId }` -- DOM
- `what_errors` filtered by component -- errors

Always prefer `what_explain` over calling these four tools separately.

---

### Pipeline E: "I'm building a new feature"

**Use when:** Writing new code in a development loop.

```
Step 1: what_scaffold { type, name, props, signals }
         -> Generate idiomatic boilerplate to start from.
         -> Types: component, page, form, store, island.

Step 2: [Agent writes/edits code]

Step 3: what_lint { code }
         -> Validate BEFORE saving. Catches 7 common mistakes:
            missing-signal-read, innerhtml-without-html,
            effect-writes-read-signal, missing-cleanup,
            signal-write-in-render, missing-key-in-for,
            prefer-computed-over-effect.
         -> Fix any issues found. Repeat step 2-3 if needed.

Step 4: [Agent saves file. HMR fires in the browser.]

Step 5: what_connection_status
         -> Confirm app reconnected after HMR.
         -> If disconnected: wait 2 seconds, try again.

Step 6: what_diagnose
         -> Health check the app after the change.
         -> Catches new errors, performance regressions, reactivity issues.

Step 7: what_look { componentId }
         -> Verify the new component renders correctly.
         -> Check dimensions, layout, text content, styles.
```

**Loop steps 2-7 until the feature is complete.**

**Result:** ~1200 tokens per iteration.

---

### Pipeline F: "Before and after"

**Use when:** Verifying that a change had the intended effect, or testing what happens when you trigger an action.

```
Step 1: what_diff_snapshot { action: "save" }
         -> Stores the current state as a baseline.
         -> Records: all signal values, effect run counts, component list.

Step 2: [Agent makes changes, or asks the user to trigger an action]

Step 3: what_diff_snapshot { action: "diff" }
         -> Compares current state to the saved baseline.
         -> Returns ONLY what changed:
            - Signals: changed values, new signals, removed signals
            - Effects: which ones re-ran and how many times
            - Components: newly mounted, unmounted
            - Errors: new errors since baseline
```

**Result:** ~400 tokens. Clean, minimal diff showing exactly what changed.

**Perfect for:**
- Verifying a bug fix worked
- Confirming a feature change has the right side effects
- Testing that a signal write triggers the expected effects

---

### Pipeline G: "The page layout needs work"

**Use when:** Iterating on UI, adjusting styles, fixing layout issues.

```
Step 1: what_page_map
         -> Full page skeleton with positions and dimensions.
         -> Identifies all landmarks, headings, buttons, inputs,
            and WhatFW component boundaries.

Step 2: what_look { componentId }
         -> Inspect a specific component's styles, dimensions, layout.
         -> Key properties: bounding rect, display/flex/grid, padding,
            margin, color, font-size, text content.
         -> Repeat for each component that needs adjustment.

Step 3: [Agent makes CSS/layout changes]

Step 4: what_look { componentId }
         -> Verify the change took effect.
         -> Only use what_screenshot if the text description does not
            clarify whether the visual result is correct.
```

**Loop steps 2-4 until layout is correct.**

**Result:** ~600-1000 tokens per iteration.

**Key rule:** Avoid screenshots for layout work. `what_look` returns exact pixel dimensions, computed styles, and layout classification. This is almost always sufficient for CSS debugging.

---

### Pipeline H: "Performance check"

**Use when:** The app feels slow, effects run too often, or memory usage is a concern.

```
Step 1: what_perf
         -> Returns: hot effects (high run counts), largest subscriber
            counts, event rate, memory estimate.
         -> If no issues: DONE. App is healthy.

Step 2: what_dependency_graph { effectId }
         -> If hot effects found: see what signals trigger the hot effect.
         -> Identify the root signal(s) causing excessive re-execution.

Step 3: what_signal_trace { signalId }
         -> Trace why the triggering signals change frequently.
         -> Common root causes: unbatched writes, timer-driven updates,
            effects that write to signals they read.
```

**Result:** ~600 tokens.

**Common fixes to suggest:**
- `batch()` to group multiple signal writes
- `computed()` instead of effect + signal pair
- `untrack()` to break read-write cycles
- Debounce/throttle for event-driven updates

---

### Pipeline I: "Debug a specific error"

**Use when:** An error code or error message is known.

```
Step 1: what_fix { error: "<code or message>" }
         -> Offline lookup. Returns diagnosis, fix, and code example.
         -> Supports exact codes (ERR_INFINITE_EFFECT) and fuzzy match
            on error message text.
         -> If the fix is clear: apply it. Done.

Step 2: what_errors
         -> If context is needed: get full error list with stack traces,
            component associations, and timestamps.

Step 3: what_explain { componentId }
         -> If the error is in a specific component: deep inspect it.
         -> See the component's signals, effects, and DOM to understand
            the context.
```

**Result:** ~300-800 tokens depending on depth needed.

---

## 3. Anti-Patterns (What NOT to Do)

### DO NOT call `what_screenshot` first

`what_look` costs 300-500 tokens. `what_screenshot` costs 5,000-20,000 tokens. The text description from `what_look` includes exact pixel dimensions, computed styles, layout type, text content, and accessibility info. This is sufficient for the vast majority of visual bugs.

**Rule:** Always call `what_look` first. Only call `what_screenshot` if the text description is genuinely ambiguous (e.g., you need to verify visual alignment, image rendering, or animation state).

### DO NOT call `what_signals` + `what_effects` + `what_dom_inspect` separately

`what_explain` combines all three (plus error info) in a single call. One round trip instead of four.

```
BAD  (4 calls, ~1600 tokens, 4 round trips):
  what_signals { filter: "..." }
  what_effects { filter: "..." }
  what_dom_inspect { componentId }
  what_errors

GOOD (1 call, ~800 tokens, 1 round trip):
  what_explain { componentId }
```

### DO NOT call `what_snapshot` repeatedly

The snapshot is cached for 100ms on the bridge side. Calling it 5 times in a row returns the same data 5 times. Call it once, parse the result, use what you need.

If you need to detect changes over time, use `what_diff_snapshot` (save baseline, wait, diff) or `what_watch` (collect events over a window).

### DO NOT use `what_eval` for state inspection

There are structured tools for every common inspection task:

| Instead of | Use |
|-----------|-----|
| `what_eval { code: "window.__WHAT_DEVTOOLS__.getSignals()" }` | `what_signals` |
| `what_eval { code: "document.querySelector(...).style" }` | `what_look` |
| `what_eval { code: "window.location.pathname" }` | `what_route` |

`what_eval` is an escape hatch for scenarios not covered by the 27 other tools. It requires the `--unsafe-eval` flag and returns unstructured data.

### DO NOT forget `what_lint` before saving code

`what_lint` catches errors that are guaranteed to break at runtime:
- **missing-signal-read:** `{count}` instead of `{count()}` -- renders "[Function]"
- **effect-writes-read-signal:** Infinite loop
- **signal-write-in-render:** Infinite re-execution
- **innerhtml-without-html:** XSS vulnerability
- **missing-cleanup:** Memory leak
- **missing-key-in-for:** Incorrect list reordering
- **prefer-computed-over-effect:** Performance hint

These take 0 tokens of browser communication. There is no reason to skip them.

### DO NOT start with `what_dependency_graph`

The dependency graph is the most expensive inspection tool in Tier 4. It returns every node and edge in the reactive graph (or a subgraph). Start with `what_signals` to understand what signals exist and their values, then use `what_signal_trace` to trace specific changes, and only call `what_dependency_graph` when you need the full picture.

### DO NOT call `what_diagnose` and `what_perf` in the same pipeline

`what_diagnose` already checks performance (hot effects, event volume). `what_perf` adds subscriber counts and memory estimate. If you need the extra detail, call `what_perf` alone. If you need a general health check, call `what_diagnose` alone. Calling both doubles the cost for marginal extra information.

---

## 4. Single Agent vs Multi-Agent

### Single agent (Claude Code, Cursor, Windsurf)

Use pipelines sequentially. Budget: aim for <2000 tokens of tool output per iteration.

**Session start sequence:**
1. Pipeline A (orient) -- ~600 tokens
2. Pipeline B or C (investigate) -- ~800 tokens
3. Pipeline E (build/fix) -- ~1200 tokens per loop

**Decision tree for "what tool do I call next?":**

```
Is the app connected?
  NO  -> what_connection_status, fix connection, retry
  YES -> Is something wrong?
    NOT SURE -> what_diagnose (catches everything)
    YES, VISUAL BUG -> what_look { componentId }
    YES, STATE BUG -> what_signals { filter } then what_signal_trace
    YES, ERROR -> what_fix { error: "code" }
    NO -> Am I building a feature?
      YES -> Pipeline E loop
      NO -> Pipeline D for understanding
```

### Multi-agent (orchestrated team)

Different agents should use different tool subsets to avoid redundant calls.

**Build agent:**
Pipeline E loop. Tools: `what_scaffold`, `what_lint`, `what_connection_status`, `what_diagnose`, `what_look`.

**Debug agent:**
Pipeline C then Pipeline B. Tools: `what_signals`, `what_signal_trace`, `what_dependency_graph`, `what_diagnose`, `what_look`, `what_errors`, `what_fix`.

**Review agent:**
Pipeline A, then Pipeline D for each component, then Pipeline H. Tools: `what_connection_status`, `what_page_map`, `what_components`, `what_explain`, `what_perf`.

**UI agent:**
Pipeline G loop. Tools: `what_page_map`, `what_look`, `what_screenshot` (sparingly).

**Shared rule for all agents:** Every agent should call `what_connection_status` first to confirm the bridge is up. If the bridge is down, no browser-dependent tool will work.

---

## 5. Tool Call Priority

When unsure what to call, use this priority order:

| Priority | Tool | When |
|----------|------|------|
| 1 | `what_diagnose` | Something might be wrong (catches errors + perf + reactivity in one call) |
| 2 | `what_explain` | You need to understand a specific component |
| 3 | `what_look` | You need visual info about a component |
| 4 | `what_signals` | You need to check specific signal values |
| 5 | `what_lint` | You are about to save code |
| 6 | `what_page_map` | You need the full page layout |
| 7 | `what_fix` | An error code appeared |
| 8 | `what_perf` | Performance concern |
| 9 | `what_signal_trace` | Tracing a state change |
| 10 | `what_dependency_graph` | Need the full reactive graph |
| 11 | Everything else | As needed for specific scenarios |

**The golden rule:** `what_diagnose` first, `what_explain` for depth, `what_look` for visuals, `what_lint` before saving.

---

## 6. Token Budget Examples

| Task | Pipeline | Approx tokens | Tool calls |
|------|----------|---------------|------------|
| Initial connect + understand app | A | ~600 | 3 |
| Debug a visual bug | B | ~800 | 2-3 |
| Trace a state change | C | ~800 | 3 |
| Deep inspect one component | D | ~800 | 1 |
| Build + verify a feature (1 loop) | E | ~1200 | 5-6 |
| Verify a change worked | F | ~400 | 2 |
| Iterate on layout (1 loop) | G | ~800 | 3-4 |
| Performance check | H | ~600 | 2-3 |
| Debug a specific error | I | ~400 | 1-3 |

**Full development cycle** (orient + build + debug + verify):

~3000-5000 tokens of tool output, spread across 10-15 tool calls.

Compare to screenshot-based approaches: a single full-page screenshot is 20,000+ tokens. Three screenshots during a debug session costs 60,000+ tokens for less information than the structured tools provide.

---

## 7. Tool Reference Quick-Lookup

### By category

**State inspection:** `what_signals`, `what_effects`, `what_snapshot`, `what_cache`
**Component inspection:** `what_components`, `what_component_tree`, `what_explain`, `what_dom_inspect`
**Visual inspection:** `what_look`, `what_page_map`, `what_screenshot`
**Reactive tracing:** `what_dependency_graph`, `what_signal_trace`
**Error handling:** `what_errors`, `what_fix`, `what_diagnose`
**Mutation:** `what_set_signal`, `what_invalidate_cache`, `what_navigate`, `what_eval`
**Observation:** `what_watch`, `what_diff_snapshot`
**Code quality:** `what_lint`, `what_validate`, `what_scaffold`
**Meta:** `what_connection_status`, `what_route`, `what_perf`

### By requirement

**No browser needed:** `what_lint`, `what_scaffold`, `what_fix`
**Browser required:** All other tools
**Explicit flag required:** `what_eval` (`--unsafe-eval` or `WHAT_UNSAFE_EVAL=1`)

---

## 8. Cascade Rules

Some tools naturally chain. When a tool's output suggests a next step, follow these cascades:

```
what_diagnose -> issues found?
  errors     -> what_fix { error: code } for each
  hot effects -> what_dependency_graph { effectId }
  orphan sigs -> what_explain { componentId } for the owning component

what_errors -> error with code?
  YES -> what_fix { error: code }
  context has componentId? -> what_explain { componentId }

what_signals -> unexpected value?
  -> what_signal_trace { signalId }

what_signal_trace -> writer effect found?
  -> what_dependency_graph { effectId }

what_look -> layout wrong?
  -> what_look { componentId: parentId }
  -> still unclear? -> what_screenshot { componentId }

what_lint -> issues found?
  -> fix code, re-run what_lint until clean

what_perf -> hot effects?
  -> what_dependency_graph { effectId }
  -> what_signal_trace { signalId } for triggering signal

what_connection_status -> not connected?
  -> wait 2s, retry
  -> still not connected? -> check dev server, check Vite plugin
```

---

## 9. Response Parsing

Every tool returns a `summary` field as the first key in its JSON response. This is a human-readable one-line description of the result. **Read the summary first.** If the summary answers your question, you do not need to parse the full response.

```json
{
  "summary": "3 issues found: 1 error, 2 warnings.",
  "issueCount": 3,
  "issues": [ ... ]
}
```

**Summary-only decision making:** For many tools, the summary alone is enough to decide the next step. This avoids processing large response payloads when a quick check is all you need.

**Count fields:** Most tools include a `count` field alongside detailed arrays. Check the count before iterating over the array -- if `count: 0`, skip the array entirely.
