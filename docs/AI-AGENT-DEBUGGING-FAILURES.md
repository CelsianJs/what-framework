# AI Agent Debugging Failures: Where MCP DevTools Win

Research-backed catalog of specific debugging scenarios where AI coding agents fail, and where WhatFW's MCP DevTools provide a measurable advantage. Each scenario is designed to become a test case.

**Research sources:** Augment Code failure patterns report, rtrvr.ai DOM Intelligence study, Addy Osmani's Chrome DevTools MCP analysis, METR developer productivity study, Coderabbit AI vs Human Code report, Microsoft debugging study, VibeCheetah production bug analysis, developerway.com AI debugging investigation.

---

## Category A: "I Can't See What's Wrong"

Visual and layout bugs where screenshots are ambiguous or insufficient.

### A1. Invisible Overlap: Button Present But Unclickable

**The bug:** A button renders at the correct position, but an invisible element (transparent div, absolutely-positioned sibling, or modal backdrop with `pointer-events: auto`) sits on top. Clicks never reach the button.

**Why AI agents fail:** A screenshot shows the button exactly where it should be. The page looks correct. The agent reads the source code and sees the button has an `onClick` handler. Nothing looks wrong in either the visual or the code. The agent enters a loop of "the code looks correct, try adding `z-index: 9999`" which may not work if the parent creates a stacking context.

**MCP solution:** `what_look { componentId }` returns the computed `z-index`, the resolved stacking context, the exact bounding rect, and whether the element is obscured. The agent can see "this element's bounding rect overlaps with element X which has a higher stacking order" -- information that is invisible in both screenshots and source code.

**Token cost comparison:**
- Without MCP: Screenshot (20,000 tokens) + 3 rounds of guessing z-index fixes (3 x screenshot verification = 60,000 tokens) + file reads (~2,000 tokens). Total: ~82,000 tokens. Likely fails.
- With MCP: `what_look` (400 tokens) + `what_look` on parent (400 tokens). Total: ~800 tokens. Direct root cause.

---

### A2. Overflow Hidden Clipping Content

**The bug:** A child element is partially or fully clipped by a parent with `overflow: hidden`. The content exists in the DOM but is invisible to users. Common with scrollable containers, card components, and dropdown menus that render inside constrained parents.

**Why AI agents fail:** The screenshot shows missing content, but the agent inspects the source and sees the element is rendered. It concludes "the element is there" and starts debugging the wrong thing -- maybe adding more padding, changing display properties, or questioning whether the content is being rendered at all. Reading the source files does not reveal `overflow: hidden` on a grandparent component defined in a different file.

**MCP solution:** `what_look { componentId }` returns the bounding rect of the element AND the overflow properties of its ancestors. The agent can see "this element is 200px tall but its ancestor container has overflow: hidden and is only 100px tall" -- direct identification of the clipping boundary.

**Token cost comparison:**
- Without MCP: Screenshot (20,000) + reading 3-5 component files to find overflow ancestor (~4,000) + 2 screenshot verification rounds (40,000). Total: ~64,000 tokens.
- With MCP: `what_look` on child (400) + `what_look` on parent (400). Total: ~800 tokens.

---

### A3. Flexbox/Grid Alignment Off by Pixels

**The bug:** Items in a flex or grid container are slightly misaligned -- off by 2-4 pixels, or one item wraps unexpectedly at a specific viewport width. The page "looks mostly right" but is subtly wrong.

**Why AI agents fail:** Screenshots at default resolution cannot reliably distinguish 2px alignment differences. The agent sees "looks fine" in the screenshot. Even if the user reports the issue, the agent has no way to measure the actual pixel positions. It resorts to guessing: "try adding `align-items: center`" or "add `gap: 0`" without knowing what the computed values actually are.

**MCP solution:** `what_look` returns exact pixel dimensions (`boundingRect: { x: 12, y: 100, width: 298, height: 44 }`) and computed flex/grid properties (`display: flex`, `alignItems: stretch`, `gap: 8px`). The agent can compare sibling bounding rects mathematically and identify the exact misalignment.

**Token cost comparison:**
- Without MCP: 2 screenshots at different resolutions (40,000) + trial-and-error CSS changes with verification (3 x 20,000 = 60,000). Total: ~100,000 tokens. May not converge.
- With MCP: `what_page_map` (800) + `what_look` on container (400) + `what_look` on misaligned child (400). Total: ~1,600 tokens.

---

### A4. Responsive Breakpoint Rendering Wrong at Specific Width

**The bug:** The layout breaks at a specific viewport width (e.g., 768px-800px gap between tablet and desktop breakpoints). Elements stack incorrectly, a sidebar disappears, or text overlaps an image.

**Why AI agents fail:** Screenshots are captured at one viewport width. The agent does not know what width to test. Even with a screenshot showing the broken layout, the agent cannot determine which CSS media query is active, what the container's computed width is, or where the breakpoint boundary falls. It guesses breakpoint values from the Tailwind config or CSS and proposes fixes that may address the wrong breakpoint.

**MCP solution:** `what_eval { code: "return { innerWidth: window.innerWidth, matchedBreakpoints: getComputedStyle(document.documentElement).getPropertyValue('--breakpoint') }" }` combined with `what_look` gives the exact viewport width and computed layout properties at the current size. The agent can verify which breakpoint is active and what CSS rules apply.

**Token cost comparison:**
- Without MCP: Screenshot (20,000) + reading Tailwind/CSS config (1,000) + 3 fix attempts with screenshots (60,000). Total: ~81,000 tokens.
- With MCP: `what_eval` for viewport (200) + `what_look` (400) + `what_page_map` (800). Total: ~1,400 tokens.

---

### A5. Computed Style Conflict (CSS Specificity War)

**The bug:** A component's styles are overridden by a more specific selector from a parent component, global stylesheet, or third-party CSS. The element has the correct class but renders with wrong colors, fonts, or spacing.

**Why AI agents fail:** The agent reads the component's CSS/Tailwind classes and sees they are correct. It reads the rendered HTML and sees the correct classes are applied. It cannot see that a higher-specificity selector from `globals.css` or a parent component is overriding the expected styles. This requires computed style inspection -- the difference between "what CSS was written" and "what CSS was applied."

**MCP solution:** `what_look { componentId }` returns computed styles (not authored styles). The agent sees `color: rgb(255,0,0)` even though the component's class specifies blue. This immediately signals a specificity override. Combined with `what_eval` to query `getComputedStyle().cssText`, the agent can identify which rule won.

**Token cost comparison:**
- Without MCP: Reading 3-5 CSS files searching for conflicts (~4,000) + screenshot (20,000) + 2 guessing rounds (40,000). Total: ~64,000 tokens.
- With MCP: `what_look` (400) + `what_eval` for specificity check (300). Total: ~700 tokens.

---

## Category B: "I Don't Know Why This Happened"

State and reactivity bugs where the cause is not visible in source code or screenshots.

### B1. Click Handler Fires But UI Doesn't Update

**The bug:** The user clicks a button. The event handler runs (confirmed by console.log). But the UI does not update. The signal value changes, but the DOM element showing that value remains stale.

**Why AI agents fail:** The agent reads the code and sees a correct pattern: `onClick -> signal.set() -> UI should update`. Without runtime access, it cannot determine where the chain breaks. Common root causes invisible to static analysis: (1) the signal is read with `.peek()` somewhere, breaking tracking, (2) the DOM binding reads a different signal instance (shadowed variable), (3) the signal update is inside `untrack()`, (4) a stale closure captured the initial value.

**MCP solution:** `what_watch { duration: 5000 }` while the user clicks. The agent sees whether `signal:updated` events fire and whether corresponding `effect:run` events follow. If the signal updates but no effect runs, `what_dependency_graph { signalId }` reveals "this signal has 0 subscribers" -- the binding is broken. If the effect runs but DOM doesn't change, `what_dom_inspect` shows what the effect actually produced.

**Token cost comparison:**
- Without MCP: Reading 2-3 source files (3,000) + 5 rounds of adding console.logs, rebuilding, re-reading output (5 x 2,000 = 10,000). Total: ~13,000 tokens. Often fails because the agent cannot observe the reactive chain.
- With MCP: `what_watch` (500) + `what_dependency_graph` (800) + `what_signal_trace` (600). Total: ~1,900 tokens. Direct root cause identification.

---

### B2. Signal Has Unexpected Value (Mystery Write)

**The bug:** A signal that should be `5` is `0`. Something wrote to it, but the user and the agent do not know what. The value was correct 2 seconds ago.

**Why AI agents fail:** The agent searches the codebase for every `.set()` call on that signal. In a non-trivial app, there may be 5-10 places that write to a signal. Without runtime tracing, the agent cannot determine which write happened most recently, in what order, or what triggered it. It reads the code paths and guesses.

**MCP solution:** `what_signal_trace { signalId }` returns the causal chain: which effect wrote the value, what triggered that effect, and what signals that effect depends on. Example output: "signal 'count' was set to 0 by effect 'resetHandler', which was triggered by signal 'routeChanged' updating to '/home'." This is a complete causal story.

**Token cost comparison:**
- Without MCP: Grep for `.set()` calls (~500) + reading 5 files for context (5,000) + adding console.log at each write site (5 rounds x 2,000 = 10,000). Total: ~15,500 tokens. May take 15-30 minutes.
- With MCP: `what_signals { filter }` (300) + `what_signal_trace` (600). Total: ~900 tokens. Instant.

---

### B3. Form Submit Does Nothing (Silent Failure)

**The bug:** User fills out a form and clicks submit. Nothing happens. No error, no navigation, no feedback. The page just sits there.

**Why AI agents fail:** The agent reads the form component and sees `onSubmit` handler that calls an API. The code looks correct. Without runtime access, the agent cannot determine: (1) whether the form's submit event actually fired, (2) whether the handler threw a silently caught error, (3) whether a validation signal blocked submission, (4) whether the API call is pending or failed. The agent enters a guessing loop.

**MCP solution:** `what_watch { duration: 5000, filter: "signal:updated|error:captured" }` while the user submits. If no events fire: the event handler is not connected (DOM issue). If signals update but no error: check the API-related signals with `what_signals { filter: "loading|error|submit" }`. If an error was captured: `what_errors` gives the full stack trace with the component association.

**Token cost comparison:**
- Without MCP: Reading form component (1,500) + reading API service (1,500) + screenshot (20,000) + 3 guessing rounds (6,000). Total: ~29,000 tokens.
- With MCP: `what_watch` (500) + `what_signals` (300) + `what_errors` (300). Total: ~1,100 tokens.

---

### B4. Derived/Computed Value Stale After Parent Update

**The bug:** A computed value depends on a signal, but after the signal updates, the computed value still shows the old result. Common when computed dependencies are not properly tracked due to conditional reads or early returns.

**Why AI agents fail:** The agent reads the `useComputed` call and sees it references the correct signal. Static analysis says "this should work." The bug is a conditional branch inside the computed that skips reading the signal on certain code paths, breaking the dependency tracking. This is invisible without understanding the runtime dependency graph.

**MCP solution:** `what_dependency_graph { effectId: <computedId>, direction: "upstream" }` shows exactly which signals the computed is currently tracking. If the signal is missing from the upstream list, the agent knows the tracking was broken. `what_signal_trace` confirms whether the computed re-ran when the signal changed.

**Token cost comparison:**
- Without MCP: Reading computed + signal code (2,000) + 4 rounds of hypothesizing about dependency tracking (8,000). Total: ~10,000 tokens. Often misdiagnosed.
- With MCP: `what_dependency_graph` (800). Total: ~800 tokens. Root cause is visible in the graph.

---

### B5. State Lost on Route Navigation

**The bug:** User navigates from page A to page B and back. A form on page A has been reset, a counter is back to 0, or a selection is gone. The state was supposed to persist.

**Why AI agents fail:** The agent reads the component code and sees signals initialized with default values. It reasons "signals should persist if the component stays mounted." But it cannot determine whether the component was unmounted and remounted during navigation (destroying and recreating signals) without observing the runtime component lifecycle.

**MCP solution:** `what_diff_snapshot { action: "save" }` before navigation, `what_navigate { path: "/pageB" }`, `what_navigate { path: "/pageA" }`, then `what_diff_snapshot { action: "diff" }`. The diff shows exactly which signals were destroyed and recreated, which components unmounted, and which effects re-ran. The agent can see "component 'FormPage' was unmounted and remounted -- all 5 signals were recreated with default values."

**Token cost comparison:**
- Without MCP: Reading router config (1,000) + reading component code (1,500) + 3 attempts at fix (adding state persistence/context) without verifying root cause (6,000). Total: ~8,500 tokens.
- With MCP: `what_diff_snapshot save` (200) + `what_navigate` x2 (300) + `what_diff_snapshot diff` (500). Total: ~1,000 tokens.

---

## Category C: "It Works But It's Wrong"

Subtle behavioral bugs that are functionally correct but have hidden problems.

### C1. List Re-Renders on Every Keystroke (Performance Disaster)

**The bug:** A search input filters a list. Every keystroke causes the entire list to re-render (all items, not just changed ones). The app feels sluggish with 100+ items. Functionally correct -- the filter works -- but unusably slow.

**Why AI agents fail:** The agent reads the code and sees `items.filter(item => item.name.includes(query()))` which looks correct. It has no way to measure how many effects run per keystroke, which effects are hot, or whether the filtering is happening per-item or per-list. Screenshots show the filter working. The agent declares "looks correct" and moves on.

**MCP solution:** `what_perf` immediately identifies "effect 'listItemRender' has run 4,700 times in 30 seconds -- flagged as hot." `what_dependency_graph { effectId }` shows every list item effect depends on the `query` signal directly, meaning every keystroke re-runs every item. The fix is clear: use a computed filtered list, not per-item filtering.

**Token cost comparison:**
- Without MCP: User reports "it's slow." Agent reads code (2,000) + adds `console.time` calls (2,000) + 2 screenshot rounds showing it works (40,000). Total: ~44,000 tokens. Likely misses the root cause.
- With MCP: `what_perf` (400) + `what_dependency_graph` (800). Total: ~1,200 tokens. Direct identification.

---

### C2. Memory Leak from Uncleared Effect Subscription

**The bug:** A component that mounts/unmounts repeatedly (e.g., in a tabbed interface or modal) leaks memory. Each mount creates event listeners, WebSocket subscriptions, or timers that are never cleaned up. After 50 open/close cycles, the app is 800KB heavier and event handlers fire multiple times.

**Why AI agents fail:** The agent reads the `useEffect` and may see a cleanup function is returned. But it cannot verify that the cleanup actually runs, that it removes all listeners, or that the subscription reference is stale. Static analysis sees "cleanup exists" and declares it correct. The leak requires runtime observation over time.

**MCP solution:** `what_diff_snapshot { action: "save" }`, then cycle the component 5 times, then `what_diff_snapshot { action: "diff" }`. The diff shows "5 new effects created, 0 disposed" -- the effects are leaking. `what_effects { minRunCount: 1 }` reveals orphaned effects that should have been cleaned up. `what_perf` shows subscriber count growing linearly.

**Token cost comparison:**
- Without MCP: Reading effect code (1,500) + Chrome DevTools memory snapshot (unavailable to AI) + guessing cleanup fixes (3 rounds x 2,000 = 6,000). Total: ~7,500 tokens. Cannot actually detect the leak.
- With MCP: `what_diff_snapshot save` (200) + cycle component + `what_diff_snapshot diff` (500) + `what_effects` (400). Total: ~1,100 tokens. Leak is quantified.

---

### C3. Effect Runs Twice on Mount (Duplicate API Call)

**The bug:** A component's data-fetching effect runs twice when it mounts, causing two identical API calls. The UI shows correct data (the second response overwrites the first), but the network cost is doubled and the server sees duplicate requests.

**Why AI agents fail:** The screenshot shows correct data. The agent reads the code and sees one `useEffect` with one API call. It looks correct. The double-run could be caused by: (1) React Strict Mode (if using react-compat), (2) a parent component remounting the child, (3) a signal dependency causing an immediate re-trigger. None of these are visible in the source code of the component itself.

**MCP solution:** `what_effects { filter: "fetch" }` shows `runCount: 2` immediately after mount. `what_watch` during mount shows two `effect:run` events. `what_dependency_graph` reveals whether a signal dependency triggered the re-run or if the component mounted twice (two `component:mounted` events).

**Token cost comparison:**
- Without MCP: Network tab (unavailable to AI) + reading code (2,000) + guessing about Strict Mode or mount behavior (4,000). Total: ~6,000 tokens.
- With MCP: `what_effects` (300) + `what_watch` (500). Total: ~800 tokens.

---

### C4. Infinite Effect Loop (Caught by Framework but Burning CPU)

**The bug:** An effect reads a signal and writes to the same signal (directly or through a chain). WhatFW's runtime guard catches it and logs a warning, but the effect still runs 50+ times before being killed, burning CPU and creating a visible flicker.

**Why AI agents fail:** The agent may not see the warning if it is reading source code. Even if the user reports "it flickers," the agent reads the effect code and may not trace the circular dependency through multiple levels of computed values and effects. The cycle might be: effect A reads signal X -> writes signal Y -> computed Z depends on Y -> effect B depends on Z -> writes signal X.

**MCP solution:** `what_diagnose { focus: "performance" }` immediately flags "effect 'syncState' has runCount 247 -- suspected infinite loop." `what_dependency_graph { effectId }` renders the full cycle: signal X -> effect A -> signal Y -> computed Z -> effect B -> signal X. The cycle is visible as a loop in the graph. `what_fix { error: "ERR_INFINITE_EFFECT" }` provides the fix pattern.

**Token cost comparison:**
- Without MCP: Reading 3+ files tracing the dependency chain (4,500) + 3 fix attempts breaking the wrong link (6,000). Total: ~10,500 tokens.
- With MCP: `what_diagnose` (600) + `what_dependency_graph` (800) + `what_fix` (150). Total: ~1,550 tokens.

---

### C5. Accessibility Attributes Missing (Invisible to Screenshots)

**The bug:** A custom dropdown component renders correctly and functions correctly, but has no ARIA roles, no `aria-expanded`, no keyboard navigation, and no focus management. A screenshot shows a working dropdown. Screen reader users cannot use it.

**Why AI agents fail:** Screenshots are purely visual. They cannot detect missing ARIA attributes, focus order, or keyboard accessibility. The agent sees "the dropdown opens and closes" in the screenshot and declares it working. Code reading might catch missing attributes, but only if the agent specifically checks for accessibility -- which requires knowing what ARIA attributes a custom dropdown needs.

**MCP solution:** `what_look { componentId }` includes an `accessibility` section with `role`, `aria-*` attributes, `tabIndex`, and focusability. `what_page_map` includes interactive elements with their accessibility properties. The agent can see "this dropdown has role: undefined, aria-expanded: missing, tabIndex: undefined" -- concrete missing attributes.

**Token cost comparison:**
- Without MCP: Screenshot (20,000 tokens, detects nothing). Agent must specifically think to check ARIA in code (2,000). Total: ~22,000 tokens. Usually skipped entirely.
- With MCP: `what_look` (400) -- accessibility data is included automatically. Total: ~400 tokens.

---

## Category D: "I Can't Reproduce It"

Timing, race condition, and intermittent bugs.

### D1. Data Flashes Then Disappears (Effect Cleanup Timing)

**The bug:** Data loads and briefly appears in the UI, then vanishes. The component fetches data, renders it, then an effect cleanup from a previous render or a competing effect resets the signal to its default value.

**Why AI agents fail:** This bug is timing-dependent. A screenshot captures either the data-present state or the data-absent state, never the transition. The agent reads the code and sees a fetch effect that correctly sets data. It may not notice that another effect (or a cleanup function from a different effect) resets the signal after a microtask delay.

**MCP solution:** `what_watch { duration: 5000, filter: "signal:updated" }` captures the exact sequence: signal 'data' set to [{...}] at t=100ms, then signal 'data' set to [] at t=150ms. The agent sees the competing write. `what_signal_trace { signalId }` identifies which effect caused the reset.

**Token cost comparison:**
- Without MCP: 3 screenshots at different moments (60,000) + reading all effects in the component (3,000) + 3 fix attempts (6,000). Total: ~69,000 tokens.
- With MCP: `what_watch` (500) + `what_signal_trace` (600). Total: ~1,100 tokens.

---

### D2. Race Condition in Parallel API Calls

**The bug:** Two API calls fire in sequence (e.g., user rapidly switches between tabs). The second call resolves first, updates the UI correctly, then the first call resolves and overwrites the UI with stale data. The user sees Tab B's content briefly, then Tab A's content appears in Tab B.

**Why AI agents fail:** This is inherently non-reproducible from static code analysis. The agent reads the fetch code, which looks correct for a single request. The race condition only manifests when network latency varies. Screenshots capture the final (wrong) state but give no information about the ordering of state changes.

**MCP solution:** `what_watch { duration: 5000 }` during rapid tab switching captures the event sequence: signal 'activeTab' updated to 'B', signal 'data' updated to [Tab B data], signal 'data' updated to [Tab A data]. The out-of-order write is visible in the timeline. `what_signal_trace` on the data signal shows which effect caused each write and when.

**Token cost comparison:**
- Without MCP: Reading fetch code (1,500) + trying to reproduce (screenshot, 20,000) + guessing about AbortController (3,000). Total: ~24,500 tokens. May not reproduce.
- With MCP: `what_watch` during the interaction (500) + `what_signal_trace` (600). Total: ~1,100 tokens. Race condition captured in timeline.

---

### D3. Component Mounted Twice (Phantom Duplicate)

**The bug:** A component mounts, unmounts, and remounts during initial page load. This creates duplicate side effects: two WebSocket connections, two fetch calls, two event listeners. The user sees duplicate data or conflicting behavior.

**Why AI agents fail:** The agent reads the component code and sees a single `<MyComponent />` in the JSX. It reads the router and sees the route maps to one component. It has no way to detect that the component actually mounted twice without observing the runtime lifecycle. This can be caused by: parent re-render, key change causing remount, or conditional rendering that flips true->false->true during initialization.

**MCP solution:** `what_watch { duration: 3000, filter: "component:mounted|component:unmounted" }` during page load shows: "component 'DataPanel' mounted at t=50ms, unmounted at t=80ms, mounted at t=82ms." The mount-unmount-mount pattern is captured. `what_component_tree` confirms the current mount state.

**Token cost comparison:**
- Without MCP: Reading parent component chain (3,000) + adding lifecycle console.logs (3,000) + 2 rounds of investigation (4,000). Total: ~10,000 tokens.
- With MCP: `what_watch` (500). Total: ~500 tokens.

---

### D4. Event Fires But Signal Update Is Batched Away

**The bug:** An event handler calls `signal.set()` three times with different values. Only the last value takes effect because WhatFW batches signal writes. The intermediate values are never observed by effects, causing logic that depends on intermediate states to break.

**Why AI agents fail:** The agent reads the handler and sees three `.set()` calls. It expects all three to trigger effects. Without understanding the batching model (and more importantly, without seeing it in action), the agent cannot predict that intermediate values are swallowed. It may add unnecessary `setTimeout` or `queueMicrotask` calls trying to force updates.

**MCP solution:** `what_watch { duration: 3000 }` during the event shows only one `signal:updated` event (the final value), confirming batching. `what_fix` with the relevant error code explains the batching model and suggests using `batch()` explicitly or restructuring the logic to not depend on intermediate values.

**Token cost comparison:**
- Without MCP: Reading code (1,500) + 4 rounds of adding timing hacks (8,000). Total: ~9,500 tokens.
- With MCP: `what_watch` (500) + `what_fix` (150). Total: ~650 tokens.

---

### D5. Hydration-Like Mismatch on Dynamic Content

**The bug:** Server-rendered or statically pre-built content mismatches the client-side dynamic content. A timestamp, user-specific data, or randomized content differs between the pre-rendered HTML and the client-side signals. The UI "jumps" or flickers on load.

**Why AI agents fail:** The agent cannot compare the pre-rendered HTML with the client-side DOM simultaneously. It reads either the server template or the client component, not both at the same time. The mismatch is between two runtime states that exist at different moments in time.

**MCP solution:** `what_watch { duration: 3000 }` on page load captures the transition: initial DOM content vs. signal-driven updates. `what_diff_snapshot` before and after client-side hydration shows exactly which signals changed values from their pre-rendered state. The specific mismatching values are visible.

**Token cost comparison:**
- Without MCP: Reading server template (1,500) + reading client component (1,500) + 2 screenshots comparing states (40,000). Total: ~43,000 tokens.
- With MCP: `what_watch` during load (500) + `what_diff_snapshot` (500). Total: ~1,000 tokens.

---

## Summary Table

| # | Scenario | Category | MCP Tool(s) | Tokens Without MCP | Tokens With MCP | Savings |
|---|----------|----------|-------------|-------------------|-----------------|---------|
| A1 | Invisible element overlap | Visual | `what_look` | ~82,000 | ~800 | 100x |
| A2 | Overflow hidden clipping | Visual | `what_look` | ~64,000 | ~800 | 80x |
| A3 | Flexbox pixel misalignment | Visual | `what_look`, `what_page_map` | ~100,000 | ~1,600 | 63x |
| A4 | Responsive breakpoint failure | Visual | `what_eval`, `what_look` | ~81,000 | ~1,400 | 58x |
| A5 | CSS specificity override | Visual | `what_look`, `what_eval` | ~64,000 | ~700 | 91x |
| B1 | Click handler, no UI update | State | `what_watch`, `what_dependency_graph` | ~13,000 | ~1,900 | 7x |
| B2 | Mystery signal write | State | `what_signal_trace` | ~15,500 | ~900 | 17x |
| B3 | Form submit does nothing | State | `what_watch`, `what_signals`, `what_errors` | ~29,000 | ~1,100 | 26x |
| B4 | Stale computed value | State | `what_dependency_graph` | ~10,000 | ~800 | 13x |
| B5 | State lost on navigation | State | `what_diff_snapshot`, `what_navigate` | ~8,500 | ~1,000 | 9x |
| C1 | Excessive re-renders | Perf | `what_perf`, `what_dependency_graph` | ~44,000 | ~1,200 | 37x |
| C2 | Memory leak from effects | Perf | `what_diff_snapshot`, `what_effects` | ~7,500 | ~1,100 | 7x |
| C3 | Double effect run on mount | Perf | `what_effects`, `what_watch` | ~6,000 | ~800 | 8x |
| C4 | Infinite effect loop | Perf | `what_diagnose`, `what_dependency_graph` | ~10,500 | ~1,550 | 7x |
| C5 | Missing accessibility | A11y | `what_look`, `what_page_map` | ~22,000 | ~400 | 55x |
| D1 | Data flash then disappear | Timing | `what_watch`, `what_signal_trace` | ~69,000 | ~1,100 | 63x |
| D2 | Race condition in API calls | Timing | `what_watch`, `what_signal_trace` | ~24,500 | ~1,100 | 22x |
| D3 | Component mounted twice | Timing | `what_watch` | ~10,000 | ~500 | 20x |
| D4 | Batched signal update | Timing | `what_watch`, `what_fix` | ~9,500 | ~650 | 15x |
| D5 | Hydration mismatch | Timing | `what_watch`, `what_diff_snapshot` | ~43,000 | ~1,000 | 43x |

**Aggregate:** Average token savings across all 20 scenarios is approximately 36x. For visual bugs (Category A), savings average 78x because screenshots are extremely expensive and provide less information. For timing bugs (Category D), savings average 33x because those bugs often cannot be debugged at all without runtime observation.

---

## Key Insight for Test Suite Design

The most valuable tests are the ones where **the bug is literally undetectable without MCP tools.** These are:

1. **B1, B2, B4** -- Reactive chain breaks that look correct in source code
2. **D1, D2, D3** -- Timing-dependent bugs that require event timeline observation
3. **C2** -- Memory leaks that require before/after measurement
4. **A1, A5** -- Visual bugs where the screenshot shows "nothing wrong"

Tests should be structured as:
1. Create a WhatFW app with the specific bug baked in
2. Give an AI agent the app + a user complaint ("the button doesn't work")
3. Measure: (a) whether the agent identifies the root cause, (b) how many tokens it uses, (c) whether the fix is correct
4. Run once without MCP tools, once with MCP tools
5. Compare success rate and token cost

The hypothesis: With MCP tools, agents should achieve 90%+ success rate on all 20 scenarios. Without MCP tools, agents should fail on 12-15 of the 20 scenarios (particularly all of Category D and most of Category B).

---

## Sources

- [Augment Code: 8 Failure Patterns in AI-Generated Code](https://www.augmentcode.com/guides/debugging-ai-generated-code-8-failure-patterns-and-fixes)
- [rtrvr.ai: DOM Intelligence Architecture -- Why Screenshots Reduce Performance](https://www.rtrvr.ai/blog/dom-intelligence-architecture)
- [Addy Osmani: Give Your AI Eyes -- Chrome DevTools MCP](https://addyosmani.com/blog/devtools-mcp/)
- [Coderabbit: AI vs Human Code Generation Report (1.7x more issues)](https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report)
- [developerway.com: Debugging with AI -- Can It Replace an Experienced Developer?](https://www.developerway.com/posts/debugging-with-ai)
- [VibeCheetah: Why Vibe-Coded Apps Crash in Production](https://vibecheetah.com/blog/fix-buggy-vibe-coded-apps-deployed-rescue-2026)
- [AI Coding Tools That Actually See Your Browser (2026)](https://dev.to/bluehotdog/ai-coding-tools-that-actually-see-your-browser-2026-2hoc)
- [Chrome DevTools MCP -- Google Developers Blog](https://developer.chrome.com/blog/chrome-devtools-mcp)
- [TechCrunch: AI Models Still Struggle to Debug Software (Microsoft Study)](https://techcrunch.com/2025/04/10/ai-models-still-struggle-to-debug-software-microsoft-study-shows/)
- [Stack Overflow: Are Bugs Inevitable with AI Coding Agents?](https://stackoverflow.blog/2026/01/28/are-bugs-and-incidents-inevitable-with-ai-coding-agents/)
- [The Register: AI-Authored Code Contains Worse Bugs](https://www.theregister.com/2025/12/17/ai_code_bugs/)
- [arxiv: A Survey of Bugs in AI-Generated Code](https://arxiv.org/html/2512.05239v1)
