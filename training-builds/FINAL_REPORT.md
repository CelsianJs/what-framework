# What Framework — Training Build Report

**Date:** 2026-02-16
**Framework Version:** what-framework@0.4.2
**Process:** 8 training apps built by engineer agents, reviewed by senior reviewer, iterated 1 round of fixes, all verified with `vite build`.

---

## Part 1: Best Practices for Developer Docs

These patterns were distilled from building and reviewing 8 real apps. Each is battle-tested and addresses a real pitfall developers will hit.

---

### 1. Reactive Function Children — The #1 Rule

**Every signal read that drives UI must be inside `{() => ...}`.**

```jsx
// WRONG: Runs once at render. Won't update when count changes.
<span>Count: {count()}</span>

// CORRECT: Reactive text
<span>{() => `Count: ${count()}`}</span>

// WRONG: Map runs once. Items won't re-render when signal changes.
{items.map(item => <Card key={item.id} active={activeId() === item.id} />)}

// CORRECT: Reactive list
{() => items().map(item => <Card key={item.id} active={activeId() === item.id} />)}

// CORRECT: Conditional rendering
{() => isOpen() ? <Modal /> : null}
```

**Why this matters:** This was the most common bug found across apps. In App 01, the category filter buttons never visually updated because the `.map()` wasn't wrapped in `{() => ...}`.

---

### 2. Signal API — Use the Unified Getter/Setter

```jsx
import { useSignal } from 'what-framework';

const count = useSignal(0);

// Read
const value = count();

// Write
count(5);

// Update with previous value
count(prev => prev + 1);
```

**Don't mix styles.** Avoid `.set()` — use the function call pattern consistently. This was a common inconsistency across training apps.

---

### 3. Read Signals Once, Use Many Times

Reading the same signal multiple times creates multiple subscriptions. Read it once into a local variable inside a reactive function child:

```jsx
// BAD: Three subscriptions to isMobile
<div style={`display: ${isMobile() ? 'flex' : 'grid'}; gap: ${isMobile() ? '1rem' : '1.5rem'};`}>

// GOOD: One subscription, one variable
{() => {
  const mobile = isMobile();
  return (
    <div style={`display: ${mobile ? 'flex' : 'grid'}; gap: ${mobile ? '1rem' : '1.5rem'};`}>
      ...
    </div>
  );
}}
```

---

### 4. Store Design with Derived Values

The canonical pattern for `createStore` with computed/filtered views:

```jsx
import { createStore, derived } from 'what-framework';

const useBoardStore = createStore({
  tasks: [],

  // Derived values — auto-update when tasks change
  todoTasks: derived(s => s.tasks.filter(t => t.status === 'todo')),
  taskCount: derived(s => s.tasks.length),

  // Actions — use `this` to update state immutably
  addTask(task) {
    this.tasks = [...this.tasks, task];
  },
  removeTask(id) {
    this.tasks = this.tasks.filter(t => t.id !== id);
  },
});
```

**Key points:**
- `createStore` runs at module level — you cannot use hooks like `useLocalStorage` inside it
- For localStorage persistence, use `useLocalStorage` in the component that consumes the store, then sync with `effect()`
- Actions should be immutable (spread + filter, not `.push()` / `.splice()`)

---

### 5. localStorage Persistence with untrack

```jsx
import { useLocalStorage, untrack, effect } from 'what-framework';

function App() {
  const savedData = useLocalStorage('my-key', null);
  const store = useMyStore();

  // Restore: read without subscribing
  const saved = untrack(() => savedData());
  if (saved) {
    store.hydrate(saved);
  }

  // Persist: save whenever store changes
  effect(() => {
    const data = store.items; // subscribes to changes
    const current = untrack(() => savedData());
    if (JSON.stringify(data) !== JSON.stringify(current)) {
      untrack(() => savedData(data));
    }
  });
}
```

---

### 6. Spring/Tween Animations — Always Use useRef

Animation instances must persist across re-renders:

```jsx
import { useRef, useEffect, spring } from 'what-framework';

function AnimatedValue({ value }) {
  const springRef = useRef(null);

  if (!springRef.current) {
    springRef.current = spring(value, { stiffness: 120, damping: 14 });
  }

  useEffect(() => {
    springRef.current.set(value);
  }, [value]);

  return <span>{() => springRef.current.current().toFixed(0)}</span>;
}
```

**Never create `spring()` or `tween()` directly in the component body without `useRef` — they'll be recreated on every re-render.**

---

### 7. CSS Custom Properties for Theming

Bridge framework signals to CSS custom properties for zero-overhead theming:

```jsx
import { signal, effect, batch } from 'what-framework';

const primary = signal('#6366f1');
const surface = signal('#1a1a2e');

// Sync signals to CSS custom properties
effect(() => {
  const root = document.documentElement.style;
  root.setProperty('--primary', primary());
  root.setProperty('--surface', surface());
});
```

Then components use `var(--primary)` in styles — no signal reads needed for themed properties. Components like `PreviewCard` can be fully static with no reactivity overhead.

---

### 8. Accessible Modal Pattern

```jsx
import { Portal, FocusTrap, useClickOutside, onKey, Keys,
         useId, VisuallyHidden, announce } from 'what-framework';

function Modal({ isOpen, onClose, title, children }) {
  const panelRef = useRef(null);
  const titleId = useId();

  useClickOutside(panelRef, onClose);
  onKey(Keys.Escape, onClose);
  announce(`Dialog opened: ${title}`);

  return (
    <Portal target="body">
      <FocusTrap>
        <div role="dialog" aria-modal="true" aria-labelledby={titleId()}>
          <VisuallyHidden><span id={titleId()}>{title}</span></VisuallyHidden>
          <div ref={panelRef}>{children}</div>
        </div>
      </FocusTrap>
    </Portal>
  );
}
```

**Focus restoration:** Handle it in the parent, not the modal. When modals are conditionally rendered (`{() => isOpen() ? <Modal /> : null}`), the modal's cleanup effects won't fire. Store the trigger element ref in the parent and restore focus in the `onClose` callback.

---

### 9. Form Validation with useForm

```jsx
const { register, handleSubmit, formState } = useForm({
  defaultValues: { email: '', password: '' },
  resolver: simpleResolver({
    email: [rules.required('Email is required'), rules.email('Invalid email')],
    password: [rules.required('Required'), rules.minLength(8, 'Min 8 chars')],
  }),
});

// Store register() results to avoid re-calling
const emailField = register('email');
const passwordField = register('password');

// Spread in JSX
<input {...emailField} type="email" />

// Error display
{() => {
  const errors = formState.errors;
  return errors.email ? <span class="error">{errors.email.message}</span> : null;
}}
```

---

### 10. Event Handlers — Always Lowercase

```jsx
// CORRECT
<button onclick={handleClick}>
<input oninput={handleInput} />
<form onsubmit={handleSubmit}>
<div onmouseenter={handleEnter} onmouseleave={handleLeave}>

// WRONG (will silently fail or cause issues)
<button onClick={handleClick}>
<input onInput={handleInput} />
```

---

### 11. Don't Use show() — Use Ternaries

```jsx
// WRONG: show() doesn't call function args
show(isVisible, () => <Modal />);

// CORRECT: Ternary with signal call
{() => isVisible() ? <Modal /> : null}
```

---

### 12. Keep Render Functions Pure

```jsx
// WRONG: Side effects inside reactive function children
{() => {
  fetchData();  // Side effect!
  return <div>{data()}</div>;
}}

// CORRECT: Use effect() for side effects
effect(() => {
  fetchData();
});

// Render function just reads data
{() => <div>{data()}</div>}
```

---

### 13. Use useRef for Mutable Persistent State

```jsx
// WRONG: let variables reset on re-render
let lastValue = null;

// CORRECT: useRef persists across re-renders
const lastValueRef = useRef(null);
```

---

## Part 2: Framework Bugs & Limitations Found

### Confirmed Bugs

1. **`show()` doesn't call function arguments.** If you pass `show(signal, () => <Component />)`, the function is stored but never invoked. Use ternaries instead. Consider fixing or deprecating `show()`.

2. **Focus restoration impossible in conditionally rendered components.** When a modal is rendered via `{() => isOpen() ? <Modal /> : null}`, the `onCleanup` / `useEffect` cleanup inside Modal will not fire because the component is destroyed (removed from DOM) rather than unmounted through the lifecycle. Focus restoration must be handled by the parent.

### Limitations

3. **`createStore` can't use hooks.** Since `createStore` runs at module level (outside component context), you can't use `useLocalStorage`, `useRef`, or any hooks inside it. This forces manual localStorage patterns.

4. **`innerHTML` prop doesn't work.** Must use `dangerouslySetInnerHTML={{ __html: html }}`. While this is the same as React, it's not documented anywhere and developers will try `innerHTML` first.

5. **`useMemo` vs `useComputed` vs `derived` — unclear when to use each.** All three create computed values:
   - `derived(fn)` — store-level, used inside `createStore`
   - `useComputed(fn)` — hook-level, creates a computed signal from other signals
   - `useMemo(fn, deps)` — hook-level, caches a value based on dependency array

   Docs should have a clear decision tree.

6. **No guidance on style syntax.** Both string styles (`style="..."`) and object styles (`style={{...}}`) work, but there's no documented preference. All 8 training apps were inconsistent. Pick one and document it.

---

## Part 3: DX Improvement Suggestions

### Priority 1 — High Impact, High Frequency

#### 1. `useHover()` Hook

The single biggest DX pain point. Every button in every app has 10+ lines of `onmouseenter`/`onmouseleave` handlers. This appeared **50+ times** across 8 apps.

```jsx
// Current: 10 lines per button
<button
  onclick={handleClick}
  style="background: #3b82f6; ..."
  onmouseenter={(e) => { e.target.style.background = '#2563eb'; }}
  onmouseleave={(e) => { e.target.style.background = '#3b82f6'; }}
>

// Proposed:
const hoverProps = useHover({
  background: '#3b82f6',
}, {
  background: '#2563eb',
});

<button onclick={handleClick} {...hoverProps}>
```

#### 2. `<ErrorMessage>` Component for Forms

Every form field needs a 5-line reactive error display block. This appeared in every form across 3 apps.

```jsx
// Current: 5 lines per field
{() => {
  const errors = formState.errors;
  return errors.email ? <span style="...">{errors.email.message}</span> : null;
}}

// Proposed:
<ErrorMessage name="email" formState={formState} />
```

### Priority 2 — Medium Impact

#### 3. `<Transition>` / `<AnimatePresence>` Component

Modal open/close, wizard step transitions, list item enter/exit — all required manual animation code.

#### 4. `useFocusRestore()` Hook

Handles the common pattern of saving the previously focused element and restoring focus when a modal/dialog closes, even when the modal is conditionally rendered.

#### 5. Document `useMemo` vs `useComputed` vs `derived`

Clear decision tree:
- **Inside `createStore`** → use `derived()`
- **Derived from signals** → use `useComputed()`
- **Cached computation with deps** → use `useMemo()`

### Priority 3 — Nice to Have

#### 6. CSS Utility or Stylesheet Pattern

Document a recommended approach for styles. Options:
- CSS custom properties (like App 08's theme system)
- Extracting style constants to modules (like the `form-styles.js` pattern from App 06)
- `<style>` tag injection for keyframes

#### 7. `usePersist(signal, key)` Hook

Simpler localStorage persistence than the manual `useLocalStorage` + `effect` + `untrack` pattern.

---

## Part 4: Summary

### What Worked Well
- **Signals + reactivity model** — Once understood, it's intuitive and powerful
- **`createStore` + `derived`** — Clean, immutable state management
- **`useForm` + `rules` + `simpleResolver`** — Solid form validation DX
- **Accessibility primitives** — `FocusTrap`, `Portal`, `useId`, `VisuallyHidden`, `announce`, `LiveRegion` are comprehensive
- **Data fetching** — `useSWR`, `useInfiniteQuery` with automatic cache/refetch work well
- **Animation** — `spring()` and `tween()` with `useRef` pattern is elegant

### What Tripped Up the Engineer
- **Reactivity boundary** — Forgetting to wrap signal reads in `{() => ...}` (App 01 CategoryFilter bug)
- **Side effects in render** — Putting mutations/fetches inside reactive function children (App 02 Preview)
- **`let` vs `useRef`** — Mutable state in component body getting reset (App 02)
- **Focus restoration timing** — Cleanup not firing in conditionally rendered components (App 04)
- **Hover effect boilerplate** — 50+ identical handler pairs across all apps
- **`useMemo` on static data** — Using `useMemo` for non-signal values (App 07 TaskCard)
- **Mixed signal API** — Inconsistent use of `.set()` vs function call setter

### Fixes Applied During Iteration
All 8 apps were fixed and verified:

| App | Fixes |
|-----|-------|
| 01 Expense Tracker | Wrapped CategoryFilter map in reactive child, removed dead imports, added `{() => ...}` |
| 02 Markdown Notes | Refactored Preview to use effect instead of side effects in render, converted `let` to `useRef`, added delete button UI, wired up onDelete |
| 03 Animated Dashboard | Removed double grid nesting in CardGrid, unified signal API to function call pattern, removed redundant DOM wrappers |
| 04 Accessible Modals | Fixed focus restoration (moved to parent), removed redundant Enter key handlers, extracted inline styles to constants, cleaned up dead imports |
| 05 Data Table | Extracted duplicated th styles to constant, simplified URL parsing, removed redundant nested signal read |
| 06 Form Wizard | Extracted shared form styles to `form-styles.js`, stored `register()` results in variables, merged redundant `getState()` calls, fixed redundant RESET spread |
| 07 Kanban Board | Replaced `useMemo` with plain variable, wrapped Board in reactive child for single signal read, replaced fragile `initialized` flag with comparison, simplified column lookup |
| 08 Theme Playground | Fixed ColorPicker reactivity bug (wrapped swatch in reactive child), reordered signal definitions, removed redundant `activePreset` signal |

### Final Scores (Post-Fix)

| App | Pre-Fix | Post-Fix |
|-----|---------|----------|
| 01 Expense Tracker | 3.5/5 | 4.0/5 |
| 02 Markdown Notes | 3.0/5 | 4.0/5 |
| 03 Animated Dashboard | 4.0/5 | 4.5/5 |
| 04 Accessible Modals | 4.0/5 | 4.5/5 |
| 05 Data Table | 4.0/5 | 4.5/5 |
| 06 Form Wizard | 3.5/5 | 4.0/5 |
| 07 Kanban Board | 4.0/5 | 4.5/5 |
| 08 Theme Playground | 4.0/5 | 4.5/5 |
| **Average** | **3.75** | **4.31** |
