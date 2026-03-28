# What Framework

Signal-based reactive web framework. Components run ONCE — no re-renders, no virtual DOM.

## Writing Code

```js
import { signal, effect, computed, batch, onMount, h, mount } from 'what-framework';

// State: signal(initialValue, 'debugName')
const count = signal(0, 'count');
count()           // read → 0
count(5)          // write → sets to 5
count(c => c + 1) // updater → increments

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

## MCP DevTools

This project has a live debugging MCP server (`what-devtools-mcp`). When the app is running in a browser, you can inspect it in real time.

### First Call
`what_connection_status` — returns app info, signal/effect/component counts, full tool catalog, and recommended next steps. Always start here.

### Tool Overview

**Inspect (no image, cheap):**
- `what_diagnose` — one-call health check: errors, perf, reactivity issues
- `what_components {filter}` — list components (gateway to getting componentId)
- `what_explain {componentId}` — everything about one component: signals, effects, DOM, errors
- `what_look {componentId}` — computed styles, layout, dimensions (~400 tokens)
- `what_signals {filter, named_only}` — signal values (always filter, never dump all)
- `what_page_map` — full page layout skeleton: landmarks, buttons, headings

**Debug:**
- `what_signal_trace {signalId}` — why did this signal change? causal chain
- `what_dependency_graph {signalId}` — reactive flow: signal → effects → downstream
- `what_errors` — runtime errors with fix suggestions
- `what_watch` — observe reactive events over time
- `what_diff_snapshot` — save/diff reactive state snapshots

**Performance:**
- `what_perf` — signal count, effect count, hot effects, largest subscriber counts, memory estimate

**Visual (use after text tools):**
- `what_screenshot {componentId}` — cropped component image (5-20KB, not full page)

**Act:**
- `what_set_signal {signalId, value}` — change a signal in the live app
- `what_navigate {path}` — navigate to a route

**Code quality (no browser needed):**
- `what_lint {code}` — static analysis, 7 rules
- `what_scaffold {type, name}` — generate component/page/form/store boilerplate
- `what_fix {errorCode}` — error diagnosis with code examples

### Common Workflows

**Find a component:**
`what_components({filter:"Stats"})` → get ID → `what_explain({componentId: 4})`

**Debug a signal:**
`what_signals({filter:"count"})` → get ID → `what_dependency_graph({signalId: 1})`

**Before/after comparison:**
`what_diff_snapshot({action:"save"})` → make change → `what_diff_snapshot({action:"diff"})`

### Connection Note

If `connected: false`, refresh the browser tab or check that the MCP bridge is running.

### Principles
- `what_look` before `what_screenshot` (10x cheaper)
- `what_explain` instead of calling signals + effects + dom separately
- `what_signals` with `filter` and `named_only: true` — never dump unfiltered
- `what_lint` before saving generated code
- `what_diagnose` as your health check
