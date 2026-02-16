# What Framework Training Builds

8 small, realistic apps that collectively exercise the entire `what-framework@0.4.2` API surface. Each app is self-contained (no external APIs -- mock data where needed), buildable in 50-150 lines of meaningful JSX, and structured with multiple component files.

---

## App 1: Expense Tracker

**A personal finance tracker where you add expenses with categories, see running totals, and filter by category or date range.**

### Features Exercised

- `createStore` with `derived` and actions (expense list, add/remove/edit actions)
- `derived` for computed totals (total spend, per-category breakdown)
- `useForm` + `simpleResolver` + `rules.required()` + `rules.min()` (validated expense entry)
- `register`, `handleSubmit`, `formState.errors`, `reset`
- `For` (render expense list with keyed items)
- `Show` (empty state, filter panel toggle)
- `cls()` (category color badges, active filter highlighting)
- `useLocalStorage` (persist expenses across reloads)
- `computed` (filtered expenses derived from category + date filters)
- `batch` (bulk delete selected expenses atomically)
- `signal` (filter state, selected items)

### File Structure

```
training-builds/01-expense-tracker/
  ├── index.html
  ├── vite.config.js
  ├── package.json
  ├── src/
  │   ├── main.jsx
  │   ├── App.jsx
  │   ├── store/expenses.js
  │   ├── components/ExpenseForm.jsx
  │   ├── components/ExpenseList.jsx
  │   ├── components/CategoryFilter.jsx
  │   └── components/Summary.jsx
```

### Key Patterns

- `createStore` with `derived()` computing per-category totals and overall spend
- `useForm` with `simpleResolver` for multi-field validated expense entry
- `useLocalStorage` hydrating store on load, syncing on every change
- `batch()` for bulk-delete: remove multiple expenses without intermediate re-renders
- `For` with `key={expense.id}` for efficient list reconciliation
- `cls('badge', { active: selectedCategory() === cat })` for conditional styling

---

## App 2: Markdown Notes

**A note-taking app with a sidebar of saved notes, a textarea editor, and a live-updating markdown preview pane.**

### Features Exercised

- `useState` (active note ID, editor content)
- `useSignal` (raw signal for search query)
- `useEffect` with cleanup (auto-save debounced effect)
- `useRef` (textarea ref for auto-resize, preview scroll sync)
- `createContext` / `useContext` (theme context: light/dark mode)
- `useLocalStorage` (persist notes array)
- `debounce` (debounced preview rendering)
- `cls` (active note highlighting, theme classes)
- `memo` (memoized sidebar list items -- skip re-render when props unchanged)
- `onMount` (focus textarea on mount, restore last-opened note)
- `onCleanup` (dispose auto-save timer)
- `For` (note list sidebar)
- `Show` (empty state when no notes)

### File Structure

```
training-builds/02-markdown-notes/
  ├── index.html
  ├── vite.config.js
  ├── package.json
  ├── src/
  │   ├── main.jsx
  │   ├── App.jsx
  │   ├── context/ThemeContext.jsx
  │   ├── components/Sidebar.jsx
  │   ├── components/NoteListItem.jsx
  │   ├── components/Editor.jsx
  │   ├── components/Preview.jsx
  │   └── utils/markdown.js
```

### Key Patterns

- `memo(NoteListItem)` so the entire sidebar does not re-render on every keystroke
- `useRef` for textarea auto-resize: measure `scrollHeight`, set `style.height`
- `debounce(renderMarkdown, 300)` so preview updates are not triggered per character
- `createContext` + Provider at App level, `useContext` in Editor/Sidebar for theme
- `onMount` to focus the textarea and restore the last-opened note from localStorage
- `onCleanup` to clear the debounced auto-save timer on unmount
- `useEffect` with cleanup returning a dispose function for the save interval

---

## App 3: Animated Dashboard Cards

**A dashboard with metric cards that animate smoothly when their values change, and support drag-to-reorder.**

### Features Exercised

- `spring` (smooth number counter animation on value change)
- `tween` + `easings` (card entrance animation with easeOutCubic)
- `useAnimatedValue` with `interpolate` (map drag offset to opacity/scale)
- `useTransition` (coordinated enter/exit when cards reorder)
- `signal` / `computed` (metric values, derived display strings)
- `useRef` (card DOM refs for position measurement)
- `onResize` from scheduler (responsive card grid recalculation)
- `batch` (update multiple metric signals simultaneously)
- `For` with keys (keyed card list for proper reorder reconciliation)
- `effect` (subscribe to data source, update metrics)
- `useGesture` (drag-to-reorder cards)

### File Structure

```
training-builds/03-animated-dashboard/
  ├── index.html
  ├── vite.config.js
  ├── package.json
  ├── src/
  │   ├── main.jsx
  │   ├── App.jsx
  │   ├── components/Dashboard.jsx
  │   ├── components/MetricCard.jsx
  │   ├── components/AnimatedNumber.jsx
  │   ├── components/CardGrid.jsx
  │   └── data/mock-metrics.js
```

### Key Patterns

- `spring(0, { stiffness: 120, damping: 14 })` for smooth number counting
- `tween(0, 1, { duration: 400, easing: easings.easeOutCubic })` for card entrance
- `useAnimatedValue` + `.interpolate([0, 100], [1, 0.6])` mapping drag distance to opacity
- `onResize(gridRef.current, rect => columns.set(...))` for responsive layout
- `batch(() => { revenue.set(...); users.set(...); })` when mock data refreshes
- `useGesture(cardRef, { onDrag, onDragEnd })` for reorder interaction
- `For` with stable `key={card.id}` so reorder animates correctly

---

## App 4: Accessible Modal System

**A reusable modal/dialog system with proper focus management, keyboard navigation, screen reader support, and click-outside dismissal.**

### Features Exercised

- `FocusTrap` component (trap focus inside open modal)
- `useFocusTrap` hook (programmatic activate/deactivate)
- `announce()` / `announceAssertive()` (screen reader announcements on open/close)
- `SkipLink` (skip navigation at page level)
- `useRovingTabIndex` (keyboard navigation in a button group inside the modal)
- `onKey` / `onKeys` / `Keys` (Escape to close, Enter/Space to confirm)
- `Portal` (render modal into `document.body`)
- `useClickOutside` (click outside modal backdrop to dismiss)
- `useId` (unique IDs for aria-labelledby, aria-describedby)
- `VisuallyHidden` (screen-reader-only modal description)
- `LiveRegion` (announce dynamic content changes)
- `useRef` (modal container ref, trigger button ref for focus restore)
- `signal` (modal open/closed state)
- `Show` (conditional modal rendering)

### File Structure

```
training-builds/04-accessible-modals/
  ├── index.html
  ├── vite.config.js
  ├── package.json
  ├── src/
  │   ├── main.jsx
  │   ├── App.jsx
  │   ├── components/Modal.jsx
  │   ├── components/ModalTrigger.jsx
  │   ├── components/ConfirmDialog.jsx
  │   ├── components/ButtonGroup.jsx
  │   └── components/DemoPage.jsx
```

### Key Patterns

- `Portal({ target: 'body' })` to render modal outside the component tree
- `FocusTrap` wrapping modal content so Tab cycles within the dialog
- `useClickOutside(modalRef, closeModal)` for backdrop click dismissal
- `onKey(Keys.Escape, closeModal)` registered on the modal container
- `useId('modal')` generating paired IDs for `aria-labelledby` / `aria-describedby`
- `announce('Dialog opened: Confirm deletion')` on modal open
- `useRef` to store the trigger button and restore focus on close
- `useRovingTabIndex(3)` for arrow-key navigation between action buttons
- `VisuallyHidden` for descriptions that screen readers need but sighted users do not

---

## App 5: Data Table with SWR

**A paginated, searchable, sortable data table backed by mock API fetchers, with infinite scroll, loading skeletons, and error recovery.**

### Features Exercised

- `useSWR` (fetch page data with stale-while-revalidate, mock fetcher)
- `useQuery` (fetch aggregate stats with retry and staleTime)
- `useInfiniteQuery` (infinite scroll mode with `getNextPageParam`)
- `invalidateQueries` (manual refresh button)
- `Skeleton` / `SkeletonTable` (loading placeholders matching table shape)
- `Suspense` (loading boundary wrapping data table)
- `ErrorBoundary` (catch fetch errors, show retry UI with `reset`)
- `Switch` / `Match` (render loading / error / empty / data states)
- `debounce` (debounced search input)
- `computed` (derive sort comparator from sort column + direction signals)
- `For` (render table rows with keyed items)
- `signal` (search query, sort state, page number)
- `Spinner` / `LoadingDots` (inline loading indicators)
- `onIntersect` (trigger infinite scroll when sentinel element is visible)

### File Structure

```
training-builds/05-data-table/
  ├── index.html
  ├── vite.config.js
  ├── package.json
  ├── src/
  │   ├── main.jsx
  │   ├── App.jsx
  │   ├── components/DataTable.jsx
  │   ├── components/TableRow.jsx
  │   ├── components/SearchBar.jsx
  │   ├── components/SortHeader.jsx
  │   ├── components/Pagination.jsx
  │   ├── components/InfiniteScroll.jsx
  │   └── data/mock-fetcher.js
```

### Key Patterns

- `useSWR(\`users?page=\${page()}&q=\${search()}\`, mockFetcher)` with reactive key
- `useQuery({ queryKey: ['stats'], queryFn: fetchStats, staleTime: 30000, retry: 2 })`
- `useInfiniteQuery({ queryFn, getNextPageParam: (last) => last.nextCursor })` for infinite scroll
- `Switch`/`Match` rendering four states: loading, error, empty, and populated
- `ErrorBoundary` with `fallback={({ error, reset }) => <RetryUI />}`
- `SkeletonTable({ rows: 10, columns: 5 })` matching the real table shape
- `debounce(query => search.set(query), 300)` on search input
- `onIntersect(sentinelRef.current, entry => { if (entry.isIntersecting) fetchNextPage() })`

---

## App 6: Multi-Step Form Wizard

**A three-step registration form with per-step validation, animated step transitions, a progress bar, and a summary review page.**

### Features Exercised

- `useForm` (separate form instance per step with independent validation)
- `useField` (standalone controlled fields for custom inputs)
- `rules.required()`, `rules.email()`, `rules.minLength()`, `rules.match()`, `rules.pattern()` (comprehensive validation across steps)
- `simpleResolver` (resolver per step)
- `useReducer` (wizard state machine: current step, direction, completed steps)
- `Show` (render active step)
- `Switch` / `Match` (render step content based on current step index)
- `transition()` helper (CSS transition classes for step slide animation)
- `createContext` / `useContext` (wizard context: aggregated form data, navigation functions)
- `memo` (memoize step components to preserve form state when navigating back)
- `computed` (progress percentage from current step)
- `signal` (animation direction: forward/backward)
- `ErrorMessage` component (display per-field errors)
- `Input`, `Select`, `Checkbox` (form components)

### File Structure

```
training-builds/06-form-wizard/
  ├── index.html
  ├── vite.config.js
  ├── package.json
  ├── src/
  │   ├── main.jsx
  │   ├── App.jsx
  │   ├── context/WizardContext.jsx
  │   ├── components/WizardShell.jsx
  │   ├── components/ProgressBar.jsx
  │   ├── components/StepAccount.jsx
  │   ├── components/StepProfile.jsx
  │   ├── components/StepReview.jsx
  │   └── utils/wizard-reducer.js
```

### Key Patterns

- Per-step `useForm({ resolver: simpleResolver({ email: [rules.required(), rules.email()] }) })`
- `useReducer(wizardReducer, { step: 0, direction: 'forward', completed: [] })` as state machine
- `Switch`/`Match` rendering the active step based on `state.step`
- `transition('slide', direction() === 'forward')` for directional CSS transitions
- `createContext` at WizardShell level providing `{ data, next, prev, goTo }` to all steps
- `memo(StepAccount)` so going back to step 1 does not re-mount and lose entered data
- `computed(() => ((step() + 1) / totalSteps) * 100)` driving the progress bar width
- `rules.match('password', 'Passwords must match')` for confirm-password field

---

## App 7: Kanban Board

**A task board with To Do / In Progress / Done columns, draggable cards, inline editing, and persistent state.**

### Features Exercised

- `createStore` with `derived` and actions (board state: columns, tasks, move/add/edit/delete)
- `derived` (per-column task counts, total task count)
- `signal` / `effect` (drag state, inline edit state)
- `batch` (move task between columns: remove from source + add to target atomically)
- `untrack` (read current task content during save without subscribing)
- `For` with keys (render columns and tasks within each column)
- `useCallback` (stable handlers passed to memoized task cards)
- `useMemo` (memoized sorted task list per column)
- `cls` (drag-over highlight, priority badges, column styling)
- `useMediaQuery` (single-column layout on mobile)
- `useClickOutside` (close inline editor when clicking away)
- `useLocalStorage` (persist board state)
- `computed` (filtered tasks when search is active)

### File Structure

```
training-builds/07-kanban-board/
  ├── index.html
  ├── vite.config.js
  ├── package.json
  ├── src/
  │   ├── main.jsx
  │   ├── App.jsx
  │   ├── store/board.js
  │   ├── components/Board.jsx
  │   ├── components/Column.jsx
  │   ├── components/TaskCard.jsx
  │   ├── components/InlineEditor.jsx
  │   └── components/AddTaskInput.jsx
```

### Key Patterns

- `createStore({ tasks: [], derived: tasksByColumn: derived(s => groupBy(s.tasks, 'column')), ... })`
- `batch(() => { this.tasks = this.tasks.filter(t => t.id !== id); targetColumn.push(task); })`
- `untrack(() => taskContent())` when saving inline edit to avoid re-subscribing
- `useCallback(handleDrop, [columnId])` for stable drop handlers in memoized columns
- `useMemo(() => tasks().sort(comparePriority), [tasks()])` for sorted display
- `useClickOutside(editorRef, () => closeEditor())` for inline edit dismissal
- `useMediaQuery('(max-width: 768px)')` toggling between horizontal and stacked layout
- `cls('card', { dragging: isDragging(), 'priority-high': task.priority === 'high' })`

---

## App 8: Theme Playground

**A live theme editor where you toggle between themes, customize CSS custom properties (colors, spacing, radii), and see all changes reflected in real-time across a set of preview components.**

### Features Exercised

- `createContext` / `useContext` (nested theme providers: global theme + section overrides)
- `useMediaQuery` (`prefers-color-scheme` detection for system default)
- `useLocalStorage` (save theme preferences, restore on reload)
- `computed` (derive CSS variable map from theme signal)
- `effect` (apply CSS custom properties to `document.documentElement` when theme changes)
- `style()` helper (convert theme object to inline style strings)
- `Portal` (color picker popup rendered into body)
- `onMount` (read system preference, apply saved theme on startup)
- `flushSync` (force synchronous style update when toggling themes for instant visual feedback)
- `signal` (individual color/spacing/radius values)
- `batch` (reset all theme values to defaults atomically)
- `useClickOutside` (dismiss color picker popup)

### File Structure

```
training-builds/08-theme-playground/
  ├── index.html
  ├── vite.config.js
  ├── package.json
  ├── src/
  │   ├── main.jsx
  │   ├── App.jsx
  │   ├── context/ThemeContext.jsx
  │   ├── components/ThemeControls.jsx
  │   ├── components/ColorPicker.jsx
  │   ├── components/PreviewCard.jsx
  │   ├── components/PreviewForm.jsx
  │   └── data/default-themes.js
```

### Key Patterns

- Nested `ThemeContext.Provider`: global at root, section-level overrides in preview panels
- `useMediaQuery('(prefers-color-scheme: dark)')` to detect system preference on first load
- `effect(() => { const vars = themeVars(); for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v); })`
- `style({ backgroundColor: primary(), borderRadius: radius() + 'px' })` for preview components
- `Portal({ target: 'body' })` for the color picker floating popup
- `flushSync()` after theme toggle to avoid flash of intermediate state
- `batch(() => { primary.set('#...'); secondary.set('#...'); ... })` for "reset to defaults"
- `useLocalStorage('what-theme', defaultTheme)` restoring full theme object

---

## Coverage Matrix

Every row represents a required feature category. Every column is an app. A checkmark means that app exercises features from that category.

| Feature Category | App 1 | App 2 | App 3 | App 4 | App 5 | App 6 | App 7 | App 8 |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Basic signals** (signal, computed, effect, batch) | X | X | X | | | | X | X |
| **Hooks** (useState, useSignal, useComputed, useEffect, useRef, useReducer, onMount, onCleanup) | | X | | | | X | X | |
| **Store** (createStore, derived, actions) | X | | | | | | X | |
| **Conditional rendering** (Show, Switch/Match, ternaries) | X | | | | X | X | | |
| **List rendering** (For, .map with keys) | X | X | X | | X | | X | |
| **Forms** (useForm, useField, validation, register) | X | | | | | X | | |
| **Data fetching** (useSWR, useQuery, useInfiniteQuery, invalidateQueries) | | | | | X | | | |
| **Animation** (spring, tween, useTransition, useAnimatedValue, easings) | | | X | | | X | | |
| **Accessibility** (FocusTrap, announce, useRovingTabIndex, keyboard nav) | | | | X | | | | |
| **Helpers** (cls, debounce, throttle, style, useLocalStorage, useClickOutside, useMediaQuery) | X | X | | X | X | | X | X |
| **Context** (createContext, useContext, Provider) | | X | | | | X | | X |
| **ErrorBoundary** | | | | | X | | | |
| **Portal** | | | | X | | | | X |
| **Refs** (useRef for DOM access) | | X | X | X | | | | |
| **Lifecycle** (onMount, onCleanup, useEffect cleanup) | | X | | | | | | X |
| **Memo** (memo for performance) | | X | | | | X | X | |

### Per-App API Summary

| App | Primary APIs |
|---|---|
| **01 Expense Tracker** | createStore, derived, useForm, simpleResolver, rules, For, Show, cls, useLocalStorage, computed, batch |
| **02 Markdown Notes** | useState, useSignal, useEffect, useRef, createContext, useContext, useLocalStorage, debounce, cls, memo, onMount, onCleanup, For, Show |
| **03 Animated Dashboard** | spring, tween, easings, useAnimatedValue, interpolate, useTransition, useGesture, signal, computed, useRef, onResize, batch, For, effect |
| **04 Accessible Modals** | FocusTrap, useFocusTrap, announce, SkipLink, useRovingTabIndex, onKey, onKeys, Keys, Portal, useClickOutside, useId, VisuallyHidden, LiveRegion, useRef, signal, Show |
| **05 Data Table** | useSWR, useQuery, useInfiniteQuery, invalidateQueries, Skeleton, SkeletonTable, Suspense, ErrorBoundary, Switch, Match, debounce, computed, For, Spinner, LoadingDots, onIntersect |
| **06 Form Wizard** | useForm, useField, rules (all), simpleResolver, useReducer, Show, Switch, Match, transition, createContext, useContext, memo, computed, ErrorMessage, Input, Select, Checkbox |
| **07 Kanban Board** | createStore, derived, signal, effect, batch, untrack, For, useCallback, useMemo, cls, useMediaQuery, useClickOutside, useLocalStorage, computed |
| **08 Theme Playground** | createContext, useContext, useMediaQuery, useLocalStorage, computed, effect, style, Portal, onMount, flushSync, signal, batch, useClickOutside |
