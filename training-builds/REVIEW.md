# What Framework Training Apps — Comprehensive Code Review

**Reviewer:** Senior Code Reviewer
**Date:** 2026-02-16
**Scope:** 8 training applications, all source files in `src/` directories
**Framework Version:** what-framework 0.4.x

> Update (2026-02-17): This review captures findings before the DX cleanup pass. Some issues noted here were intentionally fixed in framework/runtime/docs. See `training-builds/CLEANUP_STATUS.md` for current status.

---

## Table of Contents

1. [Per-App Reviews](#per-app-reviews)
2. [Cross-App Patterns](#cross-app-patterns)
3. [Best Practices Document](#best-practices-document)
4. [Framework Issues Found](#framework-issues-found)

---

## Per-App Reviews

---

### App 01: Expense Tracker

**Path:** `01-expense-tracker/src/`
**Files:** `App.jsx`, `main.jsx`, `store/expenses.js`, `components/CategoryFilter.jsx`, `components/ExpenseForm.jsx`, `components/ExpenseList.jsx`, `components/Summary.jsx`

**Summary:** A full-featured expense tracker with add/delete/bulk-delete, category filtering, localStorage persistence, category breakdown visualization, and form validation. Exercises: `createStore`, `derived`, `signal`, `useSignal`, `useForm`, `rules`, `simpleResolver`, `memo` (imported but unused in this app), reactive function children, inline styles.

**Specific Issues:**

1. **CategoryFilter.jsx, lines 28-29 — Non-reactive inline style reads `activeFilter()` outside a reactive wrapper.**
   The style template literal reads `activeFilter()` directly in the JSX attribute on lines 28-29. Since this is inside a `.map()` which itself is NOT inside a reactive function child `{() => ...}`, the `activeFilter()` calls happen at component render time only. The filter buttons will not reactively update their background/color when the filter changes. The `allFilters.map(...)` block needs to be wrapped in a reactive function child.

   ```jsx
   // BUG: This map runs once; buttons won't visually update when activeFilter changes
   {allFilters.map(filter => {
     ...
     style={`background: ${activeFilter() === filter ? color : 'transparent'};`}
   ```

   **Fix:** Wrap the map in `{() => allFilters.map(...)}`.

2. **CategoryFilter.jsx, line 18 — `activeFilter.set(filter)` uses `.set()` instead of unified getter/setter.**
   While `.set()` may work, the framework convention per the memory document is `activeFilter(filter)`. Inconsistent with how `activeFilter()` is used as a getter in the same file.

3. **ExpenseForm.jsx, lines 49-97 — Repetitive error display pattern.** The exact same error rendering block is duplicated three times (for description, amount, and category fields). This should be extracted into a helper component.

4. **ExpenseList.jsx, line 1 — `Show` imported but never used.** Dead import.

5. **ExpenseList.jsx, line 1 — `batch` imported but never used.** Dead import.

6. **ExpenseList.jsx, line 1 — `cls` imported but never used.** Dead import.

7. **store/expenses.js, line 1 — `batch` and `effect` imported but never used.** Dead imports.

8. **Summary.jsx — No reactivity issues** but the entire breakdown section inside `{() => {...}}` is well-structured. Good pattern.

**Code Quality Score:** 3.5/5
**Strengths:** Clean store design with `derived`, good localStorage persistence, proper form validation.
**Weaknesses:** Reactivity bug in CategoryFilter, dead imports, duplicated error display pattern, heavy inline styles.

---

### App 02: Markdown Notes

**Path:** `02-markdown-notes/src/`
**Files:** `App.jsx`, `main.jsx`, `components/Editor.jsx`, `components/NoteListItem.jsx`, `components/Preview.jsx`, `components/Sidebar.jsx`, `context/ThemeContext.jsx`, `utils/markdown.js`

**Summary:** A split-pane markdown editor with sidebar note list, live preview, search, debounced saves, `localStorage` persistence, and a custom markdown parser. Exercises: `useSignal`, `useLocalStorage`, `useContext`, `createContext`, `useRef`, `onMount`, `onCleanup`, `debounce`, `memo`, `dangerouslySetInnerHTML`.

**Specific Issues:**

1. **Preview.jsx, lines 28-36 — Side effects inside a reactive function child.** The `{() => { ... }}` block at line 17 performs a side effect (calling `debouncedRender`) and manages state (`lastContent`) inside what should be a pure render function. This is an anti-pattern. The markdown re-rendering logic should be in a `useEffect` or `effect`, not inside the render path. This can cause unpredictable re-renders and timing issues.

   ```jsx
   // ANTI-PATTERN: Side effect inside reactive render function
   {() => {
     const content = current.content || '';
     if (content !== lastContent) {
       lastContent = content;
       debouncedRender(content);  // <-- side effect in render!
     }
   ```

2. **Preview.jsx, line 13 — `let lastContent = null` is component-level mutable state.** This will be reset every time the component re-renders. Should be a `useRef` to persist across renders.

3. **App.jsx, lines 36-70 — Initialization logic runs in component body.** The `if (notes().length === 0)` block at line 36 creates a welcome note and calls `notes([welcomeNote])` during the component body execution. This is technically fine for initial setup but creates a side effect during render. Safer to do this in `onMount` or with a conditional initializer.

4. **NoteListItem.jsx — `memo` usage is good** but the `onDelete` prop is declared in the component signature but never used in the rendered output. The delete button exists in the Sidebar but is never wired up — notes cannot be deleted from the UI despite `handleDeleteNote` existing in App.jsx.

5. **Editor.jsx, line 5 — `let pendingSave = null` is component-level mutable state.** Same issue as Preview.jsx — should be `useRef`.

6. **ThemeContext.jsx — Unused.** The `ThemeContext` is created and provided in `App.jsx` but `useContext(ThemeContext)` is called in `AppContent` and the returned `theme` value is never used. Dead code.

7. **Sidebar.jsx — No mechanism to delete notes.** The `onDelete` prop is received but there is no delete button rendered anywhere in the component.

8. **markdown.js — Inline styles in HTML output.** The markdown parser embeds extensive inline styles. This makes the preview non-themeable and tightly couples rendering with presentation.

**Code Quality Score:** 3/5
**Strengths:** Good debounce pattern, proper `onCleanup` for flushing pending saves, `memo` on NoteListItem.
**Weaknesses:** Side effects in render, unused context, missing delete UI despite having delete logic, mutable variables should be refs.

---

### App 03: Animated Dashboard

**Path:** `03-animated-dashboard/src/`
**Files:** `App.jsx`, `main.jsx`, `components/AnimatedNumber.jsx`, `components/CardGrid.jsx`, `components/Dashboard.jsx`, `components/MetricCard.jsx`, `data/mock-metrics.js`

**Summary:** A metrics dashboard with animated number transitions (spring), staggered card entrance animations (tween), responsive grid (media queries), and refresh functionality. Exercises: `spring`, `tween`, `easings`, `useRef`, `useEffect`, `onMount`, `useSignal`, `batch`, `useMediaQuery`.

**Specific Issues:**

1. **App.jsx, line 10 — Style uses object syntax `style={{...}}`.** This is a mixed pattern — some apps use string styles, this one uses object syntax. Both may work but it creates inconsistency. More importantly, the framework docs should clarify which is preferred.

2. **AnimatedNumber.jsx, lines 21-27 — Spring created in component body with `if (!springRef.current)`.** This is a correct and well-documented pattern for persisting spring instances across re-renders using `useRef`. This is one of the best examples of the recommended approach.

3. **AnimatedNumber.jsx, line 32 — `useEffect` with value comparison.** The effect checks `prevValueRef.current !== value` which is correct, but `value` is a prop, not a signal. If the parent re-renders with the same value, the effect will still fire (because `[value]` will be a new reference comparison). This is acceptable but worth noting.

4. **MetricCard.jsx, lines 131-163 — Double-wrapped span elements.** The trend icon has an outer static `<span>` and an inner reactive `{() => <span>...}`. The outer span has styles that are redundant with the inner one. The outer span should be removed.

5. **CardGrid.jsx, lines 22-39 — Unnecessary double grid nesting.** The component renders a `<div style="display: grid">` containing a reactive child that returns ANOTHER `<div style="display: grid">`. The outer grid is unnecessary.

6. **Dashboard.jsx, line 19 — Mixed signal API.** Uses both `metrics(generateMetrics())` (function call setter) and `refreshCount.set(prev => prev + 1)` (`.set()` method). Should pick one style. The unified getter/setter pattern `refreshCount(prev => prev + 1)` is preferred.

7. **MetricCard.jsx — `tween` is NOT stored in a `useRef`.** At line 40, `tween()` is called inside a `setTimeout` inside `onMount`. Since `onMount` runs once, this is actually fine — the tween is a one-shot animation. But if this were to be re-triggered, it would need a ref. The comment in the code says "Entrance animation" so this is acceptable.

**Code Quality Score:** 4/5
**Strengths:** Excellent spring/tween usage, good `useRef` pattern for animation persistence, responsive grid, proper batch usage.
**Weaknesses:** Redundant DOM nesting, mixed style syntax (objects vs strings), mixed signal API (.set vs function call).

---

### App 04: Accessible Modals

**Path:** `04-accessible-modals/src/`
**Files:** `App.jsx`, `main.jsx`, `components/ButtonGroup.jsx`, `components/ConfirmDialog.jsx`, `components/DemoPage.jsx`, `components/Modal.jsx`, `components/ModalTrigger.jsx`

**Summary:** A comprehensive accessible modal system with focus trapping, keyboard navigation, screen reader support, roving tab index for button groups, and animated transitions. Exercises: `Portal`, `FocusTrap`, `useClickOutside`, `onKey`, `Keys`, `useId`, `VisuallyHidden`, `announce`, `LiveRegion`, `useRovingTabIndex`, `SkipLink`, `useRef`, `useEffect`, `useSignal`.

**Specific Issues:**

1. **DemoPage.jsx, lines 224-301 — Massive inline modal definitions.** The basic modal's content is defined inline with ~75 lines of JSX including duplicated `<kbd>` styling. This should be extracted into a separate component.

2. **DemoPage.jsx — Duplicated `<kbd>` styling.** Lines 252-259 and 261-268 have identical `<kbd>` style objects. Should be a shared constant or component.

3. **ConfirmDialog.jsx, lines 97-99 — Calling `roving.getItemProps(0)` multiple times.** Each call to `roving.getItemProps(0)` creates a new object. Should be stored in a variable:
   ```jsx
   const cancelProps = roving.getItemProps(0);
   ```

4. **ConfirmDialog.jsx, line 100 — Redundant Enter key handler.** Buttons already activate on Enter by default in HTML. The explicit `if (e.key === Keys.Enter) handleCancel()` is redundant and could cause double-firing.

5. **Modal.jsx, line 66 — `useEffect` with `[isOpen]` dep.** `isOpen` is a boolean prop, not a signal. The effect runs when the component re-renders and `isOpen` changes. The focus restoration at line 62-63 happens when `isOpen` becomes false, but at that point the modal component may have already been unmounted (since line 73 returns `null` when `!isOpen`). This could be a timing issue. The modal rendering pattern in DemoPage.jsx conditionally renders the Modal only when open (e.g., `{() => basicModalOpen() ? <Modal isOpen={true} ...> : null}`), so `isOpen` is always `true` when Modal exists. The `else` branch at line 58 will never run.

6. **Modal.jsx — Focus restoration may not work.** Since the Modal is conditionally rendered (only exists when open), the `isOpen=false` branch of the effect at lines 58-64 will never execute. Focus restoration needs to happen in the parent or via `onCleanup`.

7. **ModalTrigger.jsx — Well-structured** with proper ref management for focus restoration. Good pattern.

8. **ButtonGroup.jsx — Good roving tab index implementation.** Clean and reusable.

**Code Quality Score:** 4/5
**Strengths:** Excellent accessibility implementation, good use of Portal/FocusTrap/SkipLink/LiveRegion, proper ARIA attributes.
**Weaknesses:** Focus restoration timing bug, redundant Enter handlers, large inline modal content, duplicated styles.

---

### App 05: Data Table

**Path:** `05-data-table/src/`
**Files:** `App.jsx`, `main.jsx`, `components/DataTable.jsx`, `components/InfiniteScroll.jsx`, `components/Pagination.jsx`, `components/SearchBar.jsx`, `components/SortHeader.jsx`, `components/TableRow.jsx`, `data/mock-fetcher.js`

**Summary:** A paginated/infinite-scroll data table with search, sorting, stats bar, skeleton loading, error handling, and view mode toggle. Exercises: `useSWR`, `useQuery`, `useInfiniteQuery`, `useSignal`, `debounce`, `ErrorBoundary`, `Spinner`, `SkeletonTable`, `LoadingDots`, `onIntersect`, `onMount`, `onCleanup`.

**Specific Issues:**

1. **DataTable.jsx, line 17 — SWR key reads signals in component body.** The `swrKey` is computed by reading `page()`, `search()`, `sortField()`, `sortDir()` directly in the component body. This means the component re-renders entirely when any signal changes. While this works, it would be more efficient to use a `useComputed` or `useMemo` for the key.

2. **InfiniteScroll.jsx, lines 59-64 — Massive duplicated `<th>` styles.** Six `<th>` elements with identical 130+ character inline styles. This should be a shared style constant or a `ThHeader` component — especially since the same table header pattern exists in DataTable via SortHeader.

3. **InfiniteScroll.jsx, line 37 — Storing dispose on ref object.** `sentinelRef._dispose = dispose` stores a custom property on the ref object. While this works, it is unconventional. Better to use a separate `useRef` for the dispose function.

4. **InfiniteScroll.jsx, lines 22-39 — Polling retry pattern.** The `checkSentinel` function retries every 100ms if the sentinel isn't in the DOM yet. This is a workaround for a timing issue. A better approach would be to use a ref callback that triggers setup when the element mounts.

5. **Pagination.jsx — Direct signal reads in event handlers.** Lines 22-25 read `currentPage()` inside `onmouseenter`/`onmouseleave` handlers. Since event handlers are wrapped in `untrack()` by the framework, these reads won't create subscriptions — which is correct behavior. Good usage.

6. **TableRow.jsx, line 13 — `formatDate` is duplicated.** This same utility function exists in `02-markdown-notes/src/components/NoteListItem.jsx`. Cross-app duplication.

7. **mock-fetcher.js, line 18 — URL parsing hack.** `new URL('http://x/' + key)` uses a fake base URL to parse query parameters from the SWR key. This is clever but fragile. A better approach would be to pass structured params.

8. **App.jsx — ErrorBoundary usage is excellent.** Good fallback UI with reset functionality.

**Code Quality Score:** 4/5
**Strengths:** Excellent data-fetching patterns (SWR, infinite query), good loading/error states, proper skeleton UI, good ErrorBoundary usage.
**Weaknesses:** Massive duplicated th styles, URL parsing hack, polling retry pattern.

---

### App 06: Form Wizard

**Path:** `06-form-wizard/src/`
**Files:** `App.jsx`, `main.jsx`, `components/ProgressBar.jsx`, `components/StepAccount.jsx`, `components/StepProfile.jsx`, `components/StepReview.jsx`, `components/WizardShell.jsx`, `context/WizardContext.jsx`, `utils/wizard-reducer.js`

**Summary:** A multi-step form wizard with validation, progress tracking, data persistence between steps, and a review/submit flow. Exercises: `useReducer`, `createContext`, `useContext`, `useForm`, `rules`, `simpleResolver`, `useSignal`.

**Specific Issues:**

1. **StepAccount.jsx and StepProfile.jsx — Massively duplicated patterns.** Both files share:
   - Identical `inputStyle` and `labelStyle` constants (lines 4-5 in both)
   - Identical focus/blur handler patterns for styled inputs
   - Identical error display reactive blocks
   - Identical button hover styles

   These should be extracted into shared form components (`FormInput`, `FormSelect`, `FormError`, `WizardButton`).

2. **StepAccount.jsx, lines 63-69 — Complex onblur handler.** The blur handler calls `register('email').onBlur()` then reads `formState.errors` and manually styles the border. This is repeated for every input field. The pattern is correct but extremely verbose.

3. **StepProfile.jsx, line 65 — register() called in onblur.** `register('fullName').onBlur()` is called inside the blur handler. This means `register()` is called on every blur event, which may create redundant registrations depending on the framework's implementation. Ideally, the spread `{...register('fullName')}` already includes the onBlur handler.

4. **ProgressBar.jsx, lines 32-69 — Three redundant `wizard.getState()` calls in reactive functions.** Each `{() => {...}}` block calls `wizard.getState()` independently. The state could be read once and shared.

5. **wizard-reducer.js, line 37 — `RESET` action creates `completed: []`.** But `initialState` already has `completed: []`. The spread `{ ...initialState, completed: [] }` is redundant — `{ ...initialState }` suffices.

6. **StepReview.jsx — Handles async submission well.** Good loading state management with `isSubmitting` signal.

7. **App.jsx — `getState: () => state` provides direct access to reducer state.** This is correct for `useReducer` which returns reactive state. Good pattern.

**Code Quality Score:** 3.5/5
**Strengths:** Clean wizard architecture with reducer + context, good data persistence between steps, validation.
**Weaknesses:** Extreme duplication between StepAccount and StepProfile, verbose blur handlers, no shared form components.

---

### App 07: Kanban Board

**Path:** `07-kanban-board/src/`
**Files:** `App.jsx`, `main.jsx`, `components/AddTaskInput.jsx`, `components/Board.jsx`, `components/Column.jsx`, `components/InlineEditor.jsx`, `components/TaskCard.jsx`, `store/board.js`

**Summary:** A drag-and-drop Kanban board with three columns, inline editing, search, priority levels, localStorage persistence, and responsive layout. Exercises: `createStore`, `derived`, `useSignal`, `useComputed`, `useMemo`, `useLocalStorage`, `useMediaQuery`, `useClickOutside`, `useRef`, `effect`, `untrack`, `cls`, drag-and-drop API.

**Specific Issues:**

1. **TaskCard.jsx, line 59 — `if (isEditing())` in component body.** This reads the signal in the component body (not inside a reactive function child). The conditional return at line 59 means the component switches between editing/viewing modes. However, since `isEditing` is read in the component body, the entire component needs to re-render to switch modes. This is acceptable since the component fully switches its output.

2. **TaskCard.jsx, line 16 — `useMemo` with `[task.priority]` dep.** `task` is a plain object (not a signal), so `task.priority` is a static value. `useMemo` here is unnecessary — a simple variable would suffice: `const priorityLabel = task.priority.charAt(0).toUpperCase() + task.priority.slice(1)`.

3. **Column.jsx, lines 10-17 — `useComputed` with hardcoded column mapping.** The computed value accesses `store.todoTasks`, `store.inProgressTasks`, etc. based on the `id` prop. This is correct but the lookup map is re-created every render. Move it outside or memoize.

4. **App.jsx, lines 19-28 — `effect` with `initialized` flag.** The effect skips the first run to avoid overwriting localStorage-loaded data. This is a common pattern but fragile — if the effect runs for a reason other than task changes, the flag logic breaks. Better to use a separate effect or compare values.

5. **App.jsx, line 13 — `untrack(() => savedTasks())` for initialization.** Good use of `untrack` to read localStorage without creating a subscription. This is a recommended pattern.

6. **InlineEditor.jsx — Excellent `useClickOutside` usage.** Saves on click outside, cancels on Escape. Well-implemented editing experience.

7. **store/board.js — Clean store design.** Good use of `derived` for column-specific task lists and task count. Actions are concise and immutable.

8. **Board.jsx, lines 13-16 — Redundant signal reads.** `isMobile()` is called three times in the template — once in `cls()`, twice in the `style`. Each call creates a subscription. Should read once into a local variable inside a reactive function child.

**Code Quality Score:** 4/5
**Strengths:** Excellent store design, good drag-and-drop implementation, proper localStorage persistence with `untrack`, clean inline editor.
**Weaknesses:** Unnecessary `useMemo`, redundant signal reads, fragile effect initialization.

---

### App 08: Theme Playground

**Path:** `08-theme-playground/src/`
**Files:** `App.jsx`, `main.jsx`, `components/ColorPicker.jsx`, `components/PreviewCard.jsx`, `components/PreviewForm.jsx`, `components/ThemeControls.jsx`, `context/ThemeContext.jsx`, `data/default-themes.js`

**Summary:** A live theme customization playground with preset themes, individual color pickers, radius/spacing sliders, CSS custom property syncing, and localStorage persistence. Exercises: `createContext`, `useContext`, `useLocalStorage`, `useMediaQuery`, `signal`, `effect`, `batch`, `flushSync`, `untrack`, `useSignal`, `useRef`, `useClickOutside`, `Portal`, `cls`.

**Specific Issues:**

1. **ThemeContext.jsx — Individual signals for each color property.** Lines 24-35 create 12 separate `signal()` calls at module level within the component body. This is a sophisticated approach for granular reactivity but creates significant complexity. An alternative would be a single signal holding the theme object, since all properties typically change together (on preset switch). However, for individual color editing, the granular approach does have benefits.

2. **ThemeContext.jsx, lines 62-75 — Initialization code runs synchronously in component body.** The `if (savedName && themes[savedName])` block sets all 12 signals during render. This is a side effect during render but acceptable for initialization.

3. **ThemeContext.jsx, line 56 — `flushSync()` after `batch()`.** This forces synchronous flushing of effects after a theme switch. The comment doesn't explain why this is needed. If the effect at line 120 updates CSS custom properties, forcing sync ensures the DOM updates before the next paint. This is correct but should be documented.

4. **ColorPicker.jsx, line 60 — Inline style reads `currentColor()` outside reactive wrapper.** The button's `style` template literal reads `currentColor()` (line 60: `background: ${currentColor()}`). Since this is not wrapped in `{() => ...}`, the swatch color won't reactively update when the theme changes. The swatch button background will be stale after changing colors.

5. **ColorPicker.jsx, lines 15-16 — `popupX` and `popupY` are used before definition.** `popupX(rect.left)` is called at line 16 but `popupX = useSignal(0)` is defined at line 22. Due to hoisting of `const` within the function, these are technically in the temporal dead zone. However, since `handleSwatchClick` is only called on click (not during render), this won't cause a runtime error. Still, the signal definitions should be moved before the function that uses them.

6. **PreviewCard.jsx — Fully static component.** No signals, no effects. Uses CSS custom properties for theming. This is an excellent pattern — the component doesn't need any framework reactivity because the theme changes are handled via CSS custom properties. Very clean.

7. **PreviewForm.jsx — Standalone form with local state.** Well-structured, uses `var(--*)` CSS properties throughout. The error/success message display using `{() => condition ? ... : null}` is correct.

8. **ThemeControls.jsx, line 27 — `activePreset` signal is redundant.** It's set when a preset is clicked but `ctx.themeName()` already tracks the active theme. The `activePreset` signal is never read.

**Code Quality Score:** 4/5
**Strengths:** Sophisticated theme system with CSS custom properties, excellent use of granular signals, good Portal usage for color picker popup, clean separation of concerns.
**Weaknesses:** Potential reactivity bug in ColorPicker swatch, redundant signal, variable ordering issue, could use simpler architecture.

---

## Cross-App Patterns

### Repeated Code That Should Be Extracted

1. **Inline hover handlers.** Every single app has `onmouseenter`/`onmouseleave` pairs for button hover effects. This pattern appears 50+ times across the codebase:
   ```jsx
   onmouseenter={(e) => { e.target.style.background = '#2563eb'; }}
   onmouseleave={(e) => { e.target.style.background = '#3b82f6'; }}
   ```
   **Recommendation:** Create a `useHoverStyle(normalStyles, hoverStyles)` hook or a `<HoverButton>` component.

2. **Input focus/blur border styling.** At least 6 apps repeat this pattern:
   ```jsx
   onfocus={(e) => { e.target.style.borderColor = '#3b82f6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.15)'; }}
   onblur={(e) => { e.target.style.borderColor = '#2a2a2a'; e.target.style.boxShadow = 'none'; }}
   ```
   **Recommendation:** Create a `useInputFocusStyle()` hook or shared input style constants.

3. **Form error display blocks.** Apps 01 and 06 both repeat this pattern per field:
   ```jsx
   {() => {
     const errors = formState.errors;
     return errors.fieldName ? (
       <span style="...">{errors.fieldName.message}</span>
     ) : null;
   }}
   ```
   **Recommendation:** Create a `<FieldError field="name" formState={formState} />` component.

4. **`formatDate` utility.** Appears in App 02 (`NoteListItem.jsx`) and App 05 (`TableRow.jsx`) with slightly different implementations.

5. **ID generation.** `Date.now().toString(36) + Math.random().toString(36).slice(2, 7)` appears in Apps 01 and 02. App 07 uses `Date.now().toString()`. Should be a shared `generateId()` utility.

6. **`inputStyle` / `labelStyle` constants.** Defined identically in `06-form-wizard/src/components/StepAccount.jsx` and `06-form-wizard/src/components/StepProfile.jsx`.

7. **Button style variants (primary/danger/success).** The same gradient button styles appear in Apps 03, 04 (ButtonGroup, ModalTrigger), and partially in others. Should be a shared `<Button variant="primary">` component.

### Inconsistencies Between Apps

| Pattern | App 01-02 | App 03-04 | App 05-08 |
|---------|-----------|-----------|-----------|
| Style syntax | String (`style="..."`) | Object (`style={{...}}`) | String (`style="..."`) |
| Signal setter | `signal(value)` | Mixed `.set()` and `signal()` | `signal(value)` |
| Event naming | Correct lowercase | Correct lowercase | Correct lowercase |
| Header style | `#f5f5f5` text color | `#f0f0f0` text color | Mixed |
| Border color | `#222` | `rgba(255,255,255,0.08)` | `#1e1e1e` or `#2a2a3e` |
| Background | `#141414` cards | `#1a1a2e` cards | `#111` or `#111118` |

**Key observation:** Each app has its own dark theme variant. There is no shared design system or color palette. Apps 03 and 04 use an indigo/purple palette while others use blue.

### Most Elegant Patterns (Worth Documenting)

1. **App 03 `AnimatedNumber.jsx`** — Textbook example of persisting a spring instance in `useRef` and animating to new values on prop change. Should be the canonical example for spring/tween usage.

2. **App 07 `store/board.js`** — Clean `createStore` with `derived` for filtered lists. Concise immutable actions. Best store example in the set.

3. **App 08 `ThemeContext.jsx`** — Sophisticated CSS custom property bridge between signals and DOM. The `effect()` that syncs signals to `document.documentElement.style.setProperty` is an elegant pattern for theming.

4. **App 07 `App.jsx`, line 13** — `untrack(() => savedTasks())` for reading localStorage without subscribing. Clean initialization pattern.

5. **App 04 `Modal.jsx`** — Comprehensive accessible modal with Portal, FocusTrap, useClickOutside, onKey, useId, VisuallyHidden, and announce. The most complete accessibility implementation.

6. **App 05 `DataTable.jsx`** — SWR key construction from multiple signals with automatic refetching. Shows how to compose signal state into data-fetching keys.

### Worst Anti-Patterns Found

1. **Side effects in reactive render functions** (App 02 `Preview.jsx`) — Calling `debouncedRender()` inside `{() => ...}`. This violates the principle that render functions should be pure.

2. **Mutable `let` variables instead of `useRef`** (App 02 `Preview.jsx` `lastContent`, `Editor.jsx` `pendingSave`) — Component-level `let` variables will be reset on re-render.

3. **Massive inline style strings** (everywhere) — Some style strings exceed 200 characters on a single line. Makes code unreadable and unmaintainable.

4. **Reading signals multiple times** (App 07 `Board.jsx` reads `isMobile()` three times) — Creates redundant subscriptions and wastes renders.

---

## Best Practices Document

### Recommended Patterns

#### 1. Store Design with Derived Values

From App 07 `store/board.js` — The recommended way to create a store with computed/derived values:

```jsx
import { createStore, derived } from 'what-framework';

const useBoardStore = createStore({
  tasks: [],

  // Derived: computed from state, auto-updates when tasks change
  todoTasks: derived(s => s.tasks.filter(t => t.column === 'todo')),
  taskCount: derived(s => s.tasks.length),

  // Actions: use `this` to mutate state immutably
  addTask(task) {
    this.tasks = [...this.tasks, { ...task, id: Date.now().toString() }];
  },

  removeTask(id) {
    this.tasks = this.tasks.filter(t => t.id !== id);
  },
});
```

#### 2. Persisting Spring/Tween Instances

From App 03 `AnimatedNumber.jsx` — Always use `useRef` for animation instances:

```jsx
import { useRef, useEffect, spring } from 'what-framework';

function AnimatedValue({ value }) {
  const springRef = useRef(null);

  // Create spring once
  if (!springRef.current) {
    springRef.current = spring(value, { stiffness: 120, damping: 14 });
  }

  // Animate to new value when prop changes
  useEffect(() => {
    springRef.current.set(value);
  }, [value]);

  return <span>{() => springRef.current.current().toFixed(0)}</span>;
}
```

#### 3. Reactive Text and Lists

Always wrap dynamic content in reactive function children:

```jsx
// Reactive text (primitive values)
<span>{() => `Count: ${count()}`}</span>

// Reactive list (arrays)
<ul>
  {() => items().map(item => (
    <li key={item.id}>{item.name}</li>
  ))}
</ul>

// Conditional rendering
{() => isVisible() ? <Modal /> : null}
```

#### 4. Signal Reads — Read Once, Use Many

From the review findings — avoid reading the same signal multiple times:

```jsx
// BAD: Three separate subscriptions
<div style={`display: ${isMobile() ? 'flex' : 'grid'}; ${isMobile() ? 'flex-direction: column;' : ''}`}>

// GOOD: Read once inside reactive function
{() => {
  const mobile = isMobile();
  return (
    <div style={`display: ${mobile ? 'flex' : 'grid'}; ${mobile ? 'flex-direction: column;' : ''}`}>
      ...
    </div>
  );
}}
```

#### 5. localStorage Initialization with untrack

From App 07 `App.jsx` — Read saved data without creating subscriptions:

```jsx
import { useLocalStorage, untrack } from 'what-framework';

function App() {
  const savedData = useLocalStorage('my-key', null);
  const store = useMyStore();

  // Read saved data once without subscribing
  const saved = untrack(() => savedData());
  if (saved) {
    store.hydrate(saved);
  }
}
```

#### 6. CSS Custom Properties for Theming

From App 08 `ThemeContext.jsx` — Bridge signals to CSS custom properties:

```jsx
import { signal, effect } from 'what-framework';

const primary = signal('#6366f1');

effect(() => {
  document.documentElement.style.setProperty('--primary', primary());
});
```

Then in components, use `var(--primary)` in styles — no signal reads needed for themed properties.

#### 7. Accessible Modal Pattern

From App 04 — Comprehensive modal with all required accessibility features:

```jsx
<Portal target="body">
  <FocusTrap>
    <div role="dialog" aria-modal="true" aria-labelledby={titleId()}>
      <VisuallyHidden>
        <span id={descId()}>{description}</span>
      </VisuallyHidden>
      {/* content */}
    </div>
  </FocusTrap>
</Portal>
```

#### 8. Form Validation with useForm

From Apps 01 and 06:

```jsx
const { register, handleSubmit, formState } = useForm({
  defaultValues: { email: '', password: '' },
  resolver: simpleResolver({
    email: [rules.required('Email is required'), rules.email('Invalid email')],
    password: [rules.required('Required'), rules.minLength(8, 'Too short')],
  }),
});
```

### Common Mistakes

#### 1. Non-Reactive Maps (BUG)

```jsx
// WRONG: The map runs once at render time. Items won't update reactively.
{items.map(item => <div style={`color: ${activeId() === item.id ? 'red' : 'gray'}`}>...</div>)}

// CORRECT: Wrap in reactive function child
{() => items.map(item => <div style={`color: ${activeId() === item.id ? 'red' : 'gray'}`}>...</div>)}
```

#### 2. Side Effects in Render Functions

```jsx
// WRONG: Don't perform side effects inside {() => ...}
{() => {
  fetchData();  // Side effect in render!
  return <div>{data()}</div>;
}}

// CORRECT: Use effect() or useEffect() for side effects
useEffect(() => {
  fetchData();
}, [dependency]);
```

#### 3. Mutable Variables Instead of useRef

```jsx
// WRONG: `let` variables reset on re-render
let lastValue = null;  // Will be reset!

// CORRECT: Use useRef for mutable persistent state
const lastValueRef = useRef(null);
```

#### 4. Mixed Signal API Styles

```jsx
// INCONSISTENT:
count.set(5);           // .set() method
count(prev => prev + 1); // function updater

// PREFERRED: Use unified getter/setter consistently
count(5);               // setter
count(prev => prev + 1); // updater with function
const val = count();    // getter
```

#### 5. Using show() with Function Arguments

```jsx
// WRONG: show() doesn't call function args
show(isVisible, () => <Modal />);

// CORRECT: Use ternary with signal call
{() => isVisible() ? <Modal /> : null}
```

#### 6. Inline Styles Exceeding Readable Length

```jsx
// WRONG: Unreadable 200+ char inline style
<div style="display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; background: #141414; border: 1px solid #2a2a2a; border-radius: 0.5rem; transition: all 0.2s;">

// BETTER: Extract to constant or use style objects
const cardStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.75rem 1rem',
  background: '#141414',
  border: '1px solid #2a2a2a',
  borderRadius: '0.5rem',
  transition: 'all 0.2s',
};
```

---

## Framework Issues Found

### Bugs / Limitations

1. **No guidance on style syntax.** Apps inconsistently use string styles (`style="..."`) and object styles (`style={{...}}`). The framework appears to support both, but documentation should specify the preferred approach and any performance differences.

2. **`show()` limitations are a footgun.** The memory doc notes `show()` doesn't call function args. Developers in these apps have correctly avoided `show()` entirely, using ternaries instead. Consider either fixing `show()` to handle function args or deprecating it in favor of the ternary pattern.

3. **No built-in CSS-in-JS or style utility.** Every app implements hover effects, focus styles, and transitions manually with inline event handlers. This is the single biggest DX pain point across all 8 apps. A `useHover()`, `useFocus()`, or CSS class-based approach would dramatically reduce boilerplate.

4. **`useMemo` / `useComputed` / `derived` overlap.** Three different APIs for computed values: `useMemo` (hook), `useComputed` (hook), `derived` (store-level). The distinction and when to use each is unclear from these examples. App 07 uses both `useComputed` and `useMemo` in different components for similar purposes.

### DX Pain Points

1. **Hover effects require 10+ lines per button.** The `onmouseenter`/`onmouseleave` pattern for hover effects is the most repeated code across all apps. Every interactive element needs ~10 lines of JS just for a hover color change. This is the number one DX complaint these apps reveal.

   **Suggestion:** Support a `style:hover` or `hoverStyle` prop, or provide a `useHover()` hook that returns a style signal.

2. **No CSS class utility or stylesheet support.** All 8 apps use inline styles exclusively. There's no pattern for CSS modules, CSS-in-JS, or even a simple `css()` tagged template. App 08 solves this elegantly with CSS custom properties, but most apps have enormous inline style strings.

   **Suggestion:** Provide a lightweight `css()` utility or document a recommended approach for stylesheets.

3. **Error display boilerplate with `useForm`.** Every form field needs a 5-line reactive error display block. The framework could provide a `<FormField>` or `<ErrorMessage>` component.

   **Suggestion:** Add `<ErrorMessage name="email" formState={formState} />` to the form utilities.

4. **No transition/animation primitives for common patterns.** Staggered entrance animations (App 03 MetricCard), modal open/close transitions (App 04 Modal), and step transitions (App 06 wizard) all required manual animation code. A `<Transition>` or `<AnimatePresence>` component would help.

5. **Focus management utilities are incomplete.** App 04 demonstrates a focus restoration bug where the modal's cleanup effect doesn't fire because the component is conditionally rendered. A `useFocusRestore()` hook that handles this edge case would be valuable.

6. **No `onchange` event handler alias.** App 07 InlineEditor and App 08 PreviewForm use `onchange` for select elements. This works but it's not mentioned whether `onchange` or `oninput` is preferred for selects. Documentation should clarify.

### Missing Features That Would Have Helped

1. **`useHover()` hook** — Returns `{ isHovered, hoverProps }` for attaching to elements. Would eliminate 50+ `onmouseenter`/`onmouseleave` pairs.

2. **`<Transition>` component** — For enter/exit animations on conditional rendering. Would simplify modal animations, wizard step transitions, and list item animations.

3. **`useStaggeredEntrance()` hook** — For the common pattern of animating a list of items in sequence (App 03 MetricCard stagger).

4. **`<FormField>` component** — Wraps label + input + error message with proper accessibility attributes. Would cut form code in half.

5. **`usePersist(signal, key)` hook** — A simpler alternative to the manual localStorage + effect + untrack pattern used in Apps 01, 02, and 07.

6. **CSS class/stylesheet integration** — Even a simple `injectStyles()` utility for adding `<style>` tags would reduce inline style noise. App 05 and 06 manually inject `<style>` tags for keyframe animations.

---

## Summary Scores

| App | Name | Score | Key Strength | Key Weakness |
|-----|------|-------|-------------|--------------|
| 01 | Expense Tracker | 3.5/5 | Store + derived | Reactivity bug, dead imports |
| 02 | Markdown Notes | 3.0/5 | Debounce + cleanup | Side effects in render, unused code |
| 03 | Animated Dashboard | 4.0/5 | Spring/tween patterns | Redundant nesting, mixed APIs |
| 04 | Accessible Modals | 4.0/5 | Accessibility excellence | Focus restore timing, inline bloat |
| 05 | Data Table | 4.0/5 | Data-fetching patterns | Duplicated th styles, URL hack |
| 06 | Form Wizard | 3.5/5 | Wizard architecture | Extreme duplication between steps |
| 07 | Kanban Board | 4.0/5 | Store design, DnD | Unnecessary useMemo, fragile init |
| 08 | Theme Playground | 4.0/5 | CSS custom property bridge | ColorPicker reactivity bug |

**Overall Average: 3.75/5**

The developer demonstrates solid understanding of the framework's core concepts (signals, stores, derived values, effects) and has built progressively more complex apps. The main areas for improvement are:

1. **Reactivity awareness** — Some signal reads happen outside reactive wrappers, causing stale UI
2. **DRY discipline** — Significant code duplication within and across apps, especially for styles and form patterns
3. **Side effect hygiene** — Keep render functions pure; use effects for side effects
4. **Consistent API usage** — Pick one style for signal setters, style syntax, and computed value APIs

The apps collectively serve as an excellent test suite for discovering framework DX gaps, particularly around styling, hover effects, and form utilities.
