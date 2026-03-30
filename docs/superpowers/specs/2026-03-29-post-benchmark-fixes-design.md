# WhatFW Post-Benchmark Fix Sprint

**Date**: 2026-03-29
**Context**: 15 MCP iteration rounds + 7 benchmark rounds revealed compiler bugs, DX gaps, and build context deficiencies. Fixes #1-#4 already shipped (v0.6.1). This spec covers the remaining issues.

## Scope

5 work streams, ordered by impact on benchmark scores:

1. Compiler fix (issue #6)
2. Build context improvements
3. MCP DevTools verification
4. Benchmark infrastructure
5. npm publish + deploy

## 1. Compiler: Strip `key` Props (Issue #6)

**Problem**: WhatFW has no virtual DOM reconciliation, so `key` props are meaningless. But the compiler doesn't know this — it processes `key` like any other prop. When `key={item.id}` appears inside `.map(item => ...)`, the compiler tries to evaluate `item.id` outside the callback scope, causing a ReferenceError.

**Cost**: ~30K tokens of agent debugging per complex app with lists.

**Fix**: Strip `key` props at 3 points in the compiler:

1. `transformComponentFineGrained()` (line ~1099) — skip `key` in the attribute loop, same pattern as `client:*`
2. `extractStaticHTML()` (line ~438) — skip `key` in template generation
3. `applyDynamicAttrs()` — skip `key`, same as the existing `ref` skip

Also strip `key` in runtime `setProp()` as defense-in-depth (same pattern as the `ref` fix from #4).

**Tests**: Add test cases to `babel-plugin.test.js`:
- Component with `key` prop inside `.map()` compiles without error
- `key` prop doesn't appear in compiled output
- `key` prop doesn't appear in static HTML template

**Files**:
- `packages/compiler/src/babel-plugin.js`
- `packages/compiler/test/babel-plugin.test.js`
- `packages/core/src/render.js` (setProp defense)

## 2. Build Context Improvements

**Problem**: Benchmark agents consistently produce lower scores for WhatFW due to missing patterns in the build context. React and Svelte agents get these patterns "for free" from training data. WhatFW agents need explicit guidance.

**File**: `comparison-test/benchmark/prompts/whatfw-build-context.md`

### 2a. Enhanced ARIA Patterns

Current accessibility section is too terse (6 bullet points, no signal-aware examples). Expand with concrete WhatFW syntax:

```js
// Reactive ARIA
h('button', { 'aria-pressed': () => isActive(), 'aria-label': 'Toggle theme' })
h('div', { role: 'log', 'aria-live': 'polite', 'aria-label': 'Messages' })
h('li', { role: 'option', 'aria-selected': () => selected() === item.id })
h('input', { 'aria-invalid': () => hasError(), 'aria-describedby': 'error-msg' })
```

### 2b. localStorage Theme Persistence

Add the exact pattern that agents should use:

```js
const theme = signal(localStorage.getItem('theme') ||
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'), 'theme');

effect(() => {
  localStorage.setItem('theme', theme());
  document.documentElement.setAttribute('data-theme', theme());
});
```

### 2c. "No key Props Needed" Note

Add a clear note in the Key Rules section:
> WhatFW does not use key props — there is no virtual DOM diffing. The `key` prop is stripped by the compiler. Use `.map()` directly without keys.

Update the list render pattern to remove `key`:
```js
() => items().map(item => h(Item, { item }))
```

### 2d. DevTools Plugin in vite.config.js

The existing vite.config.js example doesn't show the devtools plugin. Update to:

```js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';
import whatDevTools from 'what-devtools-mcp/vite';
export default defineConfig({ plugins: [what(), whatDevTools()] });
```

Add a note: "DevTools auto-connect in dev mode. No setup code needed in main.jsx."

## 3. MCP DevTools Verification

**Problem**: 4 tool fixes were committed during the R11 tool audit but never took effect because the MCP server didn't restart.

**Fixes to verify** (already coded):

| Tool | Fix | File |
|------|-----|------|
| `what_component_tree` | Infer parent hierarchy from DOM nesting | `tools-extended.js` |
| `what_signal_trace` | Auto-init event tracking (no `what_watch` prerequisite) | `client-commands.js` |
| `what_watch` | Flush events after `set_signal` | `client.js` |
| `what_eval` | Allow safe read-only expressions (`document.title`, etc.) | `tools-extended.js`, `client-commands.js` |

**Verification**: Restart MCP bridge, run each tool, confirm expected behavior.

## 4. Benchmark Infrastructure

### 4a. Sequential Execution

**Problem**: Running 3 Vite dev servers in parallel causes OOM kills (exit 137).

**Fix**: Update `comparison-test/benchmark/run.js` to run one framework at a time instead of all in parallel. Or limit concurrency to 2.

### 4b. Bundle Size Measurement

**Problem**: WhatFW bundle size (39-40KB gzip) includes devtools client code when measured from dev builds.

**Fix**: Ensure the measurement script uses `vite build` output (which already excludes devtools via `apply: 'serve'`). If there's a custom measurement, verify it builds in production mode.

## 5. Publish & Deploy

After all fixes:

1. Bump `what-core`, `what-compiler`, `what-framework` to 0.6.2
2. `npm run build` — rebuild dist
3. `npm test` — verify 651+ tests pass
4. **Ask Kirby for OTP** — then publish to npm
5. Verify the R7 chat app builds clean with the new packages
6. Check scoreboard: `node comparison-test/benchmark/run.js --scoreboard`

## Parallelization

| Agent | Work | Independent? |
|-------|------|-------------|
| Agent 1 | Fix #6 (compiler key stripping) + tests + setProp defense | Yes |
| Agent 2 | Build context improvements (ARIA, theme, key note, devtools) | Yes |
| Agent 3 | Benchmark infra (sequential runner, bundle measurement) | Yes |

MCP verification happens in the main session (needs live browser).
npm publish happens last (needs OTP).

## Success Criteria

- Issue #6 closed
- 655+ tests pass (existing 651 + new key-prop tests)
- Build context has ARIA patterns, theme persistence, no-key note, devtools plugin
- R7 chat app builds without errors on `what-framework@0.6.2`
- Benchmark infra runs without OOM
- Published to npm as 0.6.2
