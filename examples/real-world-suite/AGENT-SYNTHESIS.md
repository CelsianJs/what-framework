# Agent Synthesis: Common Findings Across 5 Real-World Apps

Compiled from DEVLOGs of 5 agent developers building with What Framework for the first time.

---

## Universal Gotchas (Hit by 3+ agents)

### 1. Signals are functions, not values
Every agent stumbled on this. React muscle memory makes you write `{count}` or `{swr.data}` instead of `{count()}` or `{swr.data()}`. Forgetting the `()` renders `[Function]` or silently breaks conditionals (a function reference is always truthy).

**Agents affected:** All 5
**Severity:** High — silent bugs, no compile error
**Recommendation:** A lint rule catching signal references used without invocation would eliminate this class of bug entirely.

### 2. `.set()` vs direct mutation for arrays/objects
Multiple agents tried `this.tasks.push(item)` in store actions. Signals track by reference — in-place mutation doesn't trigger updates. You must assign a new reference: `this.tasks = [...this.tasks, item]`.

**Agents affected:** App-01, App-03, App-04
**Severity:** Medium — data updates silently fail to re-render

### 3. `derived()` uses `state` parameter, actions use `this`
The `createStore` API has a clean but initially confusing split: derived fields receive state as a function parameter, while actions read/write via `this`. Two agents initially tried `this` inside derived.

**Agents affected:** App-03, App-05
**Severity:** Medium — runtime error if using `this` in derived

### 4. `onChange` vs `onInput` for text inputs
React normalizes `onChange` to fire on every keystroke. What Framework uses native DOM semantics where `onChange` only fires on blur. Use `onInput` for per-keystroke updates on text inputs.

*Since 0.15, `onChange` is React's: it fires on every keystroke.*

**Agents affected:** App-01, App-03
**Severity:** Low — functional but confusing behavior difference

---

## Framework Strengths (Praised by multiple agents)

1. **Fine-grained reactivity** — Components run once, only DOM nodes with signal dependencies update. No `React.memo`, no `useMemo` dance.
2. **`useComputed` auto-tracking** — No dependency arrays needed. The framework tracks which signals are read.
3. **`useSWR` API** — Familiar SWR semantics (stale-while-revalidate, deduplication, focus revalidation) with signal-based returns.
4. **`createStore` ergonomics** — Single object definition for state + derived + actions. Zustand-like simplicity with built-in reactivity.
5. **React compat layer** — `reactCompat()` vite plugin made zustand work without any modifications to the library.

---

## Real Framework Findings

### Reconciler crash with complex component trees + useSWR (App-02)
The original app-02 had deeply nested components each using `useSWR`. The reconciler threw `HierarchyRequestError: Failed to execute 'insertBefore'` when async data resolved and triggered vnode updates. Flattening to a simpler component structure resolved it.

**Assessment:** This appears to be a real reconciler edge case. The crash involves certain vnode structures (possibly `&&` patterns producing `false` vnodes, or deeply nested component hierarchies with async state transitions). Worth investigating.

### Reactive text interpolation concatenates without spaces (App-04)
JSX like `<span>Showing {start} of {total} rows</span>` may render as "Showing12of10000rows" without spaces. The reactive text nodes don't preserve whitespace between interpolations the way React does.

**Assessment:** Minor but surprising. Workaround is explicit spaces in the template text or wrapping in `{` `` ` ` ``}` template literals.

### useEffect + useRef timing edge case (App-04)
`useEffect(() => { ... containerRef.current ... }, [])` worked for attaching scroll listeners, but programmatic scrolling from Playwright didn't always trigger the signal update chain properly. The framework schedules effects via `queueMicrotask`, so the ref is available — but the scroll-to-render pipeline may have subtle timing issues under rapid external manipulation.

**Assessment:** Minor — only manifested during automated testing, not user interaction.

---

## Proposed Framework Changes

### Should Fix (Real Bugs)
1. **Reconciler insertBefore crash** — Investigate the component tree + useSWR crash pattern from app-02. Complex component hierarchies shouldn't cause DOM errors.

### Nice to Have (DX Improvements)
1. **Lint rule / dev-mode warning** for signal references used without `()` — This is the #1 source of bugs for new developers.
2. **Dev-mode warning for in-place array mutation** in store actions — Detect `.push()`, `.splice()`, `.sort()` on signal-backed arrays and warn.

### Not Needed (QuickStart docs are sufficient)
- `derived()` vs `this` confusion → well-documented, clear pattern once learned
- `onChange` vs `onInput` → standard DOM behavior, just needs a note in docs
- `useSignal` vs `useState` → clear distinction, both work
