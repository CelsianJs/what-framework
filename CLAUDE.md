# What Framework

Signal-based reactive web framework. Components run ONCE — no re-renders, no virtual DOM.

## Writing Code

```js
import { signal, effect, computed, batch, onMount, h, mount } from 'what-framework';

// State: signal(initialValue, 'debugName')
const count = signal(0, 'count');
count()           // read -> 0
count(5)          // write -> sets to 5
count(c => c + 1) // updater -> increments

// Derived state
const doubled = computed(() => count() * 2);

// Side effects (auto-tracks signal reads)
effect(() => console.log('Count:', count()));

// Batch multiple writes (effects run once at end)
batch(() => { a(1); b(2); });

// Components run ONCE — the function body never re-executes
function Counter() {
  const count = signal(0, 'count');
  return h('div', {},
    h('span', {}, () => `Count: ${count()}`),  // reactive text
    h('button', { onclick: () => count(c => c + 1) }, 'Add'),
  );
}

mount(h(Counter, {}), '#app');
```

### Key Differences from React
- `signal()` not `useState()` — read with `()`, write with `(newVal)`
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

## MCP DevTools

This project has a live debugging MCP server (`what-devtools-mcp`). When the app is running in a browser, you can inspect it in real time.

### First Call

`what_connection_status` — returns app info, signal/effect/component counts, full tool catalog, and recommended next steps. **Always start here.**

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

**Code quality (no browser needed):**
- `what_lint {code}` — static analysis, 7 rules
- `what_scaffold {type, name}` — generate boilerplate structure (imports, function shape, signal declarations). Note: produces a skeleton, not production code — expect ~10% survival for real integration. Best used to confirm idiomatic patterns.
- `what_fix {errorCode}` — error diagnosis with code examples

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

**Build & test new features:**
`what_look` on existing components to match styling -> `what_scaffold` for structure -> write code -> `what_lint` to validate -> `what_diff_snapshot({action: "save"})` -> `what_set_signal` to simulate the feature's trigger -> `what_diff_snapshot({action: "diff"})` to verify the reactive cascade works end-to-end.

**Effect should have fired but didn't (stale subscription):**
If `what_dependency_graph` shows an edge from signal to effect, but `what_diff_snapshot` after changing that signal shows the effect didn't re-run, the subscription may be stale. This happens when a component that owns the effect is unmounted and remounted (e.g., view switches). Check effect `runCount` before and after — if unchanged despite the signal changing, the effect lost its subscription during a remount cycle. Fix: move the effect to module scope or use `computed()` instead.

### Understanding Diagnostic Output

**"N signals with no subscribers"** — Normal in What Framework. Signals read inside `() => ...` reactive text bindings (marked as `<!--fn-->` in DOM) update the DOM directly without going through tracked effects. These signals ARE reactive, just not through the effect system the devtools tracks. Only investigate if a signal should be triggering an effect but isn't.

**"N effects with no signal dependencies"** — Normal. These are one-shot setup effects that run once during component creation (DOM manipulation, event listeners, initialization). They have runCount=0 or 1 and never re-fire. Expected in What Framework's "components run once" model.

**Components showing signalCount=0, effectCount=0** — Signals and effects are attributed to the scope where they were *created*, not where they're *consumed*. Module-scope signals (shared stores) won't appear on any component. Use `what_signals` and `what_effects` directly instead of relying on per-component counts.

**`parentId: null` on all components (flat tree)** — The component tree reports creation-time parent relationships. If the framework doesn't track parentage (or uses a flat mounting model), all components appear at root level. Use `what_page_map` for the actual visual hierarchy.

**`<!--fn-->` in DOM output** — These comment markers indicate reactive text bindings: inline functions that re-evaluate when their signal dependencies change. They're the primary reactivity mechanism in templates — more common than tracked effects.

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

### Parallel-Safe Tools

These tools are read-only and safe to call in parallel (batch them to save round-trips):
- `what_perf`, `what_effects`, `what_signals`, `what_components`, `what_component_tree`
- `what_dependency_graph`, `what_explain`, `what_look`, `what_page_map`, `what_dom_inspect`
- `what_diagnose`, `what_errors`, `what_snapshot`
- `what_diff_snapshot({action: "save"})` (saving is read-only — it stores a copy)
- `what_lint`, `what_scaffold`, `what_fix` (offline tools, always safe)

**NOT safe to parallelize:** `what_set_signal` calls that share downstream effects (order matters). `what_set_signal` on independent signals IS safe to batch.

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

**`what_lint` false positive on `signal-write-in-render`:**
Handler functions defined inside the component body are flagged because the function definition runs at "render" time. This includes both named handlers (`function handleClick() { sig(val) }`) and **inline arrow handlers in JSX** (`onClick={() => sig(val)}`). If the signal write is only called from an event handler (onclick, oninput, etc.), it's safe to ignore. What Framework components run once, so defining handlers in the body is the normal pattern. To confirm it's a false positive, re-run `what_lint` with `rules` excluding `"signal-write-in-render"` — if 0 issues remain, the code is correct.
