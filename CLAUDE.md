# What Framework

Signal-based reactive web framework. Components run ONCE — no re-renders, no virtual DOM.

## Writing Code

```js
import { signal, effect, computed, batch, onMount, h, mount } from 'what-framework';

// State: signal(initialValue, 'debugName')
const count = signal(0, 'count');
count()           // read -> 0
count.set(5)          // write -> sets to 5
count.set(c => c + 1) // updater -> increments

// Derived state
const doubled = computed(() => count() * 2);

// Side effects (auto-tracks signal reads)
effect(() => console.log('Count:', count()));

// Batch multiple writes (effects run once at end)
batch(() => { a.set(1); b.set(2); });

// Components run ONCE — the function body never re-executes
function Counter() {
  const count = signal(0, 'count');
  return h('div', {},
    h('span', {}, () => `Count: ${count()}`),  // reactive text
    h('button', { onClick: () => count.set(c => c + 1) }, 'Add'),
  );
}

mount(h(Counter, {}), '#app');
```

### Key Differences from React
- `signal()` not `useState()` — read with `()`, write with `.set(newVal)`
- Components run once, not on every state change
- No JSX re-render — signals create fine-grained DOM effects
- `effect()` not `useEffect()` — no dependency array, auto-tracks
- `computed()` not `useMemo()` — lazy, cached
- Import from `'what-framework'`

### Signal Scope
- **`signal()`** — use anywhere: module scope, inside components, in stores. This is the standard API.
- **Module-scope signals** — shared across components (like a global store). Define outside any function.
- **Component-scope signals** — local to one component. Define inside the component function.
- Components run once, so signal declarations in the body execute exactly once (not per-render like React hooks).

## Release Channels

Use npm `latest` for normal projects. Use the `backport` dist-tag only for the maintained 0.6.x line; those package versions are intentionally staggered by changed package. Pin legacy backport-only docs MCP as `what-mcp@0.6.0` when needed, and prefer `what-devtools-mcp@backport` for live debugging.

## MCP DevTools

This project has a live debugging MCP server (`what-devtools-mcp`). When the app is running in a browser, you can inspect it in real time.

### Quick Start (First 5 Minutes)

New to this app? Run these in order:
1. `what_connection_status` — orient (am I connected? how big is the app?)
2. `what_diagnose` — health check (any errors or issues?)
3. `what_page_map` — visual structure + accessibility (what's on the page?)
4. `what_components` -> `what_explain` on a leaf component — deep dive
5. `what_signals({filter: "task|theme|view", named_only: true})` — check key state
6. `what_dependency_graph({signalId: N, direction: "downstream"})` — trace reactivity of the main signal

Tips:
- Start `what_explain` on a **leaf component** (like TaskItem), not a container (like App). Containers often show 0 signals because state is module-scoped.
- If a user reports a bug, verify with `what_errors` before assuming it exists — claims may be false.

### Decision Tree

| I want to... | Use this |
|---|---|
| Get oriented / check connection | `what_connection_status` |
| Health check (errors + perf + reactivity) | `what_diagnose` |
| Find a component by name | `what_components {filter}` |
| Understand one component deeply | `what_explain {componentId}` |
| See the component hierarchy | `what_component_tree` |
| Check a signal's current value | `what_signals {filter, named_only: true}` |
| See all effects and their run counts | `what_effects {minRunCount}` |
| Understand why a signal changed | `what_signal_trace {signalId}` |
| See what depends on a signal | `what_dependency_graph {signalId, direction: "downstream"}` |
| See what an effect depends on | `what_dependency_graph {effectId, direction: "upstream"}` |
| Find runtime errors | `what_errors` |
| Get component layout/styles (no image) | `what_look {componentId}` |
| Get full page structure | `what_page_map` |
| Get a visual screenshot | `what_screenshot {componentId}` (use after what_look) |
| Inspect raw DOM | `what_dom_inspect {componentId, depth}` |
| Find performance issues | `what_perf {threshold}` |
| Compare before/after state | `what_diff_snapshot {action: "save"}` then `{action: "diff"}` |
| Change a signal live | `what_set_signal {signalId, value}` |
| Navigate to a route | `what_navigate {path}` |
| Click a button/link | `what_click {text: "Submit"}` or `{testId: "add-task"}` |
| Fill a form field | `what_fill {label: "Email", value: "test@test.com"}` |
| Fill multiple fields at once | `what_fill {inputs: {email: "a@b.com", password: "secret"}}` |
| Submit a form | `what_interact {action: "submit_form", componentId: N}` |
| Select a dropdown option | `what_interact {action: "select_option", label: "Country", value: "US"}` |
| Toggle a checkbox/switch | `what_interact {action: "toggle", text: "Dark Mode"}` |
| Hover over an element | `what_interact {action: "hover", text: "Menu"}` |
| Scroll to an element | `what_interact {action: "scroll_to", componentId: N}` |
| Type text into focused input | `what_interact {action: "type", value: "hello"}` |
| Check text is visible | `what_assert {text: "Welcome", visible: true}` |
| Verify signal value | `what_assert {signalName: "count", value: 3}` |
| Verify no errors on page | `what_assert {selector: ".error", count: 0}` |
| Check current route | `what_assert {route: "/dashboard"}` |
| Wait for loading to finish | `what_wait {text: "Loading", gone: true}` |
| Wait for component to mount | `what_wait {componentId: 5, mounted: true}` |
| Wait for app to be idle | `what_wait {idle: true}` |
| See everything I can interact with | `what_page_map_interactive` |
| Validate code before saving | `what_lint {code}` |
| Generate boilerplate | `what_scaffold {type, name}` |
| Diagnose an error code | `what_fix {errorCode}` |
| Monitor reactive events live | `what_watch` |
| Get all state at once | `what_snapshot` (full dump) or `what_snapshot {diff: true}` (changes only) |

### Tool Categories

**Inspect (text, cheap):**
- `what_connection_status` — bootstrap: app info, counts, tool catalog
- `what_diagnose` — one-call health check: errors, perf, reactivity issues
- `what_components {filter}` — list components and get IDs (gateway to everything)
- `what_component_tree {depth, filter}` — hierarchy with signal/effect counts per node
- `what_explain {componentId}` — everything about one component: signals, effects, DOM, errors
- `what_signals {filter, named_only}` — signal values (**always filter, never dump all**)
- `what_effects {minRunCount, depSignalId}` — effects with dep counts, run counts, timing
- `what_look {componentId}` — computed styles, layout, dimensions (~400 tokens)
- `what_page_map` — full page layout skeleton: landmarks, buttons, headings, interactive elements
- `what_dom_inspect {componentId, depth}` — raw DOM tree and HTML

**Debug:**
- `what_signal_trace {signalId}` — why did this signal change? causal chain
- `what_dependency_graph {signalId|effectId, direction}` — reactive flow graph (topology, not values)
- `what_errors` — runtime errors with fix suggestions
- `what_watch` — observe reactive events over a time window
- `what_diff_snapshot {action}` — save/diff reactive state snapshots

**Performance:**
- `what_perf {threshold}` — hot effects, subscriber counts, memory estimate

**Visual (use after text tools):**
- `what_screenshot {componentId}` — cropped component image (5-20KB, not full page)

**Act:**
- `what_set_signal {signalId, value}` — change a signal value in the live app
- `what_navigate {path}` — navigate to a route

**Interact (Playwright-killer tools):**
- `what_click {text|ariaLabel|testId|role}` — click elements semantically, returns what changed (signals, components, navigation)
- `what_fill {label|name|placeholder, value}` — fill form fields, returns validation state
- `what_fill {inputs: {field: "value", ...}}` — fill multiple fields in one call
- `what_interact {action, ...}` — compound actions: submit_form, select_option, toggle, scroll_to, hover, type, clear, focus
- `what_assert {text|signalName|selector|route, ...}` — verify page state without screenshots
- `what_wait {text|componentId|signalId|idle, timeout}` — wait for async conditions
- `what_page_map_interactive` — enhanced page map showing exact tool/args for every interactive element

**Code quality (no browser needed):**
- `what_lint {code}` — static analysis, 7 rules
- `what_scaffold {type, name}` — generate boilerplate structure (imports, function shape, signal declarations). Note: produces a skeleton, not production code — expect ~10% survival for real integration. Best used to confirm idiomatic patterns.
- `what_fix {errorCode}` — **hidden gem**: diagnosis + fix + code example for any error code. Cheap (~160 tokens), offline, accurate. Use as FIRST tool when you encounter a What Framework error.
- `what_validate {code}` — quick syntax/parse check (pass/fail). Shallower than what_lint.

### Workflows

**Find and inspect a component:**
`what_components({filter:"Stats"})` -> get componentId -> `what_explain({componentId: 4})`

**Debug a signal's reactive graph:**
`what_signals({filter:"count"})` -> get signalId -> `what_dependency_graph({signalId: 1, direction: "downstream"})`

**Before/after comparison:**
`what_diff_snapshot({action:"save"})` -> make change -> `what_diff_snapshot({action:"diff"})`

**Performance audit:**
`what_perf({threshold: 3})` -> `what_effects({minRunCount: 2})` -> `what_dependency_graph({effectId: N})` on hot effects

**Visual/layout audit:**
`what_page_map` -> `what_look({componentId: N})` on key components -> `what_screenshot` only if text isn't enough

**Health check:**
`what_diagnose` -> investigate flagged items with `what_signals` or `what_effects` -> trace with `what_dependency_graph`

**Disconnected reactivity (two UI parts should update together but don't):**
`what_dependency_graph({signalId: N, direction: "downstream"})` -> check that ALL expected effects appear as downstream edges. Missing edges = that component won't react to the signal. Compare with `what_explain` on both components to see their effect `depSignalIds`.

**Find reactive waste:**
`what_effects({minRunCount: 1})` -> look for effects with high run counts relative to user interactions -> `what_dependency_graph({effectId: N, direction: "upstream"})` to find which signals trigger them

**Multi-signal interaction debugging (order-of-operations bugs):**
`what_diff_snapshot({action: "save"})` -> `what_set_signal` (signal A) -> `what_diff_snapshot({action: "diff"})` -> save again -> `what_set_signal` (signal B) -> diff again. Compare the two cascades: if signal B's diff shows 0 effects triggered, the reactive chain is broken.

**Code review via MCP (no source files needed):**
`what_diagnose` + `what_page_map` + `what_signals({named_only: true})` + `what_perf` + `what_dependency_graph` on the main signal. Catches reactivity anti-patterns, accessibility gaps, dead signals, and architecture issues in ~6 calls. Follow up with source-level review only for findings that need disambiguation.

**Build & test new features:**
`what_look` on existing components to match styling -> `what_scaffold` for structure -> write code -> `what_lint` to validate -> `what_diff_snapshot({action: "save"})` -> `what_set_signal` to simulate the feature's trigger -> `what_diff_snapshot({action: "diff"})` to verify the reactive cascade works end-to-end.

**Interact with the page (no Playwright needed):**
`what_page_map_interactive` -> see all interactive elements with exact tool/args -> `what_fill({label: "Email", value: "test@test.com"})` -> `what_fill({label: "Password", value: "secret"})` -> `what_click({text: "Login"})` -> check what changed in the response.

**Fill and submit a form:**
`what_page_map_interactive` -> `what_fill({inputs: {email: "a@b.com", password: "secret"}})` -> `what_interact({action: "submit_form", componentId: N})` -> `what_assert({route: "/dashboard"})`.

**Test a user flow end-to-end:**
`what_diff_snapshot({action: "save"})` -> `what_click({text: "Add Task"})` -> `what_fill({placeholder: "Enter task...", value: "Buy milk"})` -> `what_click({text: "Save"})` -> `what_assert({text: "Buy milk", visible: true})` -> `what_diff_snapshot({action: "diff"})` to see the full reactive cascade.

**Wait for async operations:**
`what_click({text: "Load Data"})` -> `what_wait({text: "Loading", gone: true})` -> `what_assert({text: "Data loaded"})`.

**Verify state without screenshots:**
`what_assert({signalName: "count", value: 5})` + `what_assert({selector: ".todo-item", count: 3})` + `what_assert({route: "/tasks"})` — all in one pipeline, no images needed.

**Effect should have fired but didn't (stale subscription):**
If `what_dependency_graph` shows an edge from signal to effect, but `what_diff_snapshot` after changing that signal shows the effect didn't re-run, the subscription may be stale. This happens when a component that owns the effect is unmounted and remounted (e.g., view switches). Check effect `runCount` before and after — if unchanged despite the signal changing, the effect lost its subscription during a remount cycle. Fix: move the effect to module scope or use `computed()` instead.

### Understanding Diagnostic Output

**"N signals with no subscribers"** — Normal in What Framework. Signals read inside `() => ...` reactive text bindings (marked as `<!--fn-->` in DOM) update the DOM directly without going through tracked effects. These signals ARE reactive, just not through the effect system the devtools tracks. Only investigate if a signal should be triggering an effect but isn't.

**"N effects with no signal dependencies"** — Normal. These are one-shot setup effects that run once during component creation (DOM manipulation, event listeners, initialization). They have runCount=0 or 1 and never re-fire. Expected in What Framework's "components run once" model.

**Components showing signalCount=0, effectCount=0** — Signals and effects are attributed to the scope where they were *created*, not where they're *consumed*. Module-scope signals (shared stores) won't appear on any component. Use `what_signals` and `what_effects` directly instead of relying on per-component counts.

**`parentId: null` on all components (flat tree)** — The component tree reports creation-time parent relationships. If the framework doesn't track parentage (or uses a flat mounting model), all components appear at root level. Use `what_page_map` for the actual visual hierarchy. Prefer `what_components` over `what_component_tree` — the hierarchy feature is not yet functional.

**`<!--fn-->` in DOM output** — These comment markers indicate reactive text bindings: inline functions that re-evaluate when their signal dependencies change. They're the primary reactivity mechanism in templates — more common than tracked effects.

**`what_signal_trace` shows empty `recentWrites`** — The write trace requires `what_watch` to have been running first to capture events. Without a prior watch session, `recentWrites` will always be empty. Run `what_watch` for a few seconds, trigger the write, then call `what_signal_trace`.

**`what_eval` returns "disabled"** — Disabled by default for security. Only available when the MCP server starts with `--unsafe-eval` or `WHAT_UNSAFE_EVAL=1`. Use `what_signals`, `what_dom_inspect`, or `what_look` instead.

### Parameter Reference

| Tool | Param | Type | Notes |
|---|---|---|---|
| `what_signals` | `filter` | string | Regex pattern. Always use this. |
| `what_signals` | `named_only` | boolean | `true` or `false`, not a string |
| `what_effects` | `minRunCount` | number | Filter to effects that ran >= N times |
| `what_effects` | `depSignalId` | number | Filter to effects depending on this signal |
| `what_dependency_graph` | `direction` | `"upstream"` `"downstream"` `"both"` | Default: `"both"` |
| `what_look` | `componentId` | number | Required |
| `what_screenshot` | `componentId` | number | Optional (omit for full page) |
| `what_dom_inspect` | `depth` | number | How deep to traverse (default: 3) |
| `what_diff_snapshot` | `action` | `"save"` or `"diff"` | Save first, then diff |
| `what_perf` | `threshold` | number | Flag effects with >= N subscribers |
| `what_scaffold` | `type` | `"component"` `"page"` `"form"` `"store"` `"island"` | What to generate |
| `what_scaffold` | `props` | string[] | Prop names the component accepts |
| `what_scaffold` | `signals` | string[] | Signal names to declare |
| `what_click` | `text` | string | Button/link text to click |
| `what_click` | `ariaLabel` | string | Click by aria-label |
| `what_click` | `testId` | string | Click by data-testid |
| `what_click` | `role` | string | Click by ARIA role |
| `what_click` | `componentId` | number | Scope search to this component |
| `what_click` | `index` | number | If multiple matches, click Nth (0-based) |
| `what_fill` | `label` | string | Find input by label text |
| `what_fill` | `name` | string | Find input by name attribute |
| `what_fill` | `placeholder` | string | Find input by placeholder |
| `what_fill` | `value` | string | Value to fill (single-field mode) |
| `what_fill` | `inputs` | object | Multi-fill: `{fieldName: "value", ...}` |
| `what_interact` | `action` | string | `"submit_form"` `"select_option"` `"toggle"` `"scroll_to"` `"hover"` `"type"` `"clear"` `"focus"` |
| `what_assert` | `text` | string | Assert text exists on page |
| `what_assert` | `visible` | boolean | Text must be visually visible |
| `what_assert` | `signalName` | string | Assert signal by name |
| `what_assert` | `value` | any | Expected signal value |
| `what_assert` | `selector` | string | CSS selector to count |
| `what_assert` | `count` | number | Expected element count |
| `what_assert` | `route` | string | Assert current path |
| `what_wait` | `text` | string | Wait for text to appear |
| `what_wait` | `gone` | boolean | Wait for text to disappear |
| `what_wait` | `idle` | boolean | Wait for no reactive activity |
| `what_wait` | `timeout` | number | Max wait in ms (default: 5000, max: 30000) |

### Parallel-Safe Tools

These tools are read-only and safe to call in parallel (batch them to save round-trips):
- `what_perf`, `what_effects`, `what_signals`, `what_components`, `what_component_tree`
- `what_dependency_graph`, `what_explain`, `what_look`, `what_page_map`, `what_dom_inspect`
- `what_diagnose`, `what_errors`, `what_snapshot`
- `what_diff_snapshot({action: "save"})` (saving is read-only — it stores a copy)
- `what_lint`, `what_scaffold`, `what_fix` (offline tools, always safe)

**Read-only interaction tools (safe to parallelize):**
- `what_assert` — state verification, no side effects
- `what_page_map_interactive` — enhanced page map, read-only

**NOT safe to parallelize:** `what_set_signal`, `what_click`, `what_fill`, `what_interact` — these mutate state and must run sequentially. `what_wait` blocks until a condition is met, so parallelize with caution.

### Diff Cascade Metrics

When `what_diff_snapshot({action: "diff"})` returns, understand the output:
- `effectsTriggered` — effects that already existed and re-ran (re-evaluated their dependencies)
- `effectsAdded` — new effects created (component mounts, new subscriptions)
- `effectsRemoved` — effects torn down (component unmounts)
- `signalsChanged` — signals whose values differ from baseline (includes cascading changes)
- `componentsAdded/Removed` — mount/unmount cycles

Tip: `what_perf` already includes `largestSubscribers` with signal IDs and names — skip `what_signals` if you only need to know which signals are hottest.

### Principles

1. **`what_connection_status` first** — always orient before diving in
2. **`what_diagnose` for health** — one call catches errors, perf, and reactivity issues
3. **`what_explain` over individual calls** — replaces separate signals + effects + DOM lookups
4. **`what_look` before `what_screenshot`** — 10x cheaper, usually sufficient
5. **`what_signals` with `filter` and `named_only: true`** — never dump all signals unfiltered
6. **`what_lint` before saving** — catch framework-specific mistakes before they ship
7. **`what_dependency_graph` for topology** — values are truncated; use `what_signals` for full values
8. **Text tools before visual tools** — orient with data, then confirm visually if needed
9. **Re-fetch component IDs after state changes** — IDs are ephemeral. After `what_set_signal` changes that cause mount/unmount, always re-query with `what_components`
10. **`what_set_signal` can cascade** — setting one signal may trigger effects that change other signals. Use `what_diff_snapshot` to see the full impact

### Troubleshooting

**"No browser connected" / `connected: false`:**
Open the app URL in a browser (or refresh with Cmd+Shift+R), wait 2-3 seconds, then retry. The devtools client auto-connects on page load. Most tools require a live browser — exceptions: `what_lint`, `what_scaffold`, `what_fix` work offline.

**"Component N not found":**
Component IDs are ephemeral — they change when components mount/unmount (e.g., view switches, filter changes). Always re-fetch IDs with `what_components({filter})` after any `what_set_signal` call that alters the component tree.

**`what_screenshot` tainted canvas error:**
Some pages block canvas export due to cross-origin resources. Use `what_look` instead — it returns computed styles, layout, dimensions, and child structure. Usually sufficient without a screenshot.

**`what_set_signal` shows `previous: undefined`:**
Known display quirk. Use `what_diff_snapshot` (save before, diff after) for accurate before/after comparison.

**Connection errors gate everything:**
If any tool returns "No browser connected", don't retry the same call. Fix the connection first (open/refresh the browser). Connection errors mask input validation — even if your signalId is wrong, you'll only see the connection error. Fix the connection, then re-test.

**Offline tools always work (even without a browser):**
`what_lint`, `what_scaffold`, `what_fix`, `what_connection_status` — these never need a browser. Use them when the connection is down.

**`what_lint` false positive on `signal-write-in-render`:**
Handler functions defined inside the component body are flagged because the function definition runs at "render" time. This includes both named handlers (`function handleClick() { sig(val) }`) and **inline arrow handlers in JSX** (`onClick={() => sig(val)}`). If the signal write is only called from an event handler (onclick, oninput, etc.), it's safe to ignore. What Framework components run once, so defining handlers in the body is the normal pattern. To confirm it's a false positive, re-run `what_lint` with `rules` excluding `"signal-write-in-render"` — if 0 issues remain, the code is correct.
