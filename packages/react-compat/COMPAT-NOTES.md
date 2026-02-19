# React Compat Layer — Technical Notes

## How It Works (User-Facing)
1. `npm install what-react`
2. Add bundler aliases: `react` → `what-react`, `react-dom` → `what-react/dom`
3. All React libraries now run on What's signals engine

## ThenJS Integration Plan
- **Pre-configure aliases** in `@thenjs/build` Vite plugin automatically
- When user installs any React library, it "just works" — no manual config
- The `create-then` scaffolder should include `what-react` as a dependency
- Consider: auto-detect React imports and suggest compat layer setup

---

## Failure Categories & Root Causes

### 1. Class Component Issues
**Symptom**: `TypeError: Cannot convert undefined or null to object`
**Root Cause**: Libraries using class components that access `this.state` or `this.context` before they're initialized, or use lifecycle methods we don't fully support.
**Fix Applied**: Converted `Component`/`PureComponent` from native ES classes to function constructors (allows transpiled `Component.call(this)` patterns).
**Still Broken**:
- `react-transition-group` — `TransitionGroup.render()` calls `Object.values()` on state that's never initialized (relies on `getDerivedStateFromProps` lifecycle we don't support)
- `react-datepicker` — Class inheritance chain issues

**Potential what-react fix**: Implement `getDerivedStateFromProps` in the class wrapper. This is a React 16.3 lifecycle that many class-heavy libraries depend on. Would NOT require core changes.

### 2. Portal System Issues
**Symptom**: Components render but interactive overlays don't appear, or events don't propagate
**Root Cause**: Our `createPortal` creates a `__portal` vnode that the reconciler handles, but complex nested portals with event bubbling across portal boundaries differ from React's behavior.
**Affected Libraries**:
- `@radix-ui/react-select` — Infinite hang (likely portal + event loop)
- `ag-grid-react` — Custom React portal implementation
- Libraries that nest multiple portals (tooltip inside dialog inside popover)

**Potential what-react fix**: Improve portal event delegation — ensure events bubble correctly across portal boundaries. May need a small core addition to register portal containers for event routing.

### 3. Render Loop / Infinite Re-render
**Symptom**: Browser freezes, tab unresponsive
**Root Cause**: Some libraries rely on React's batching guarantees or `Object.is` comparisons in ways that cause infinite loops with our signals. React batches all state updates within event handlers; our signals can trigger synchronous cascades.
**Affected Libraries**:
- `recharts` — D3 integration triggers continuous re-renders
- `@radix-ui/react-select` — Portal + state interaction causes infinite loop

**Potential what-react fix**: Add a render cycle guard to the class component wrapper (max re-renders per frame). Already have `updateScheduled` throttle but TransitionGroup bypasses it.

### 4. Missing React API Surface
**Symptom**: `X is not a function` or `X is undefined`
**Root Cause**: Library accesses React API we haven't implemented.
**Affected Libraries**:
- `react-paginate` — `d2 is not a function` (minified — likely missing API)
- `react-window v2` — Uses React internals beyond public API

**Currently Implemented**:
- All hooks: useState, useEffect, useLayoutEffect, useInsertionEffect, useMemo, useCallback, useRef, useContext, useReducer, useImperativeHandle, useId, useDebugValue, useSyncExternalStore, useTransition, useDeferredValue
- createElement, createContext, createRef, forwardRef, cloneElement, isValidElement
- Children.map/forEach/count/toArray/only
- Component, PureComponent, memo, lazy, Suspense, StrictMode, Fragment
- createPortal, createRoot, hydrateRoot, render, flushSync, findDOMNode (stub)
- startTransition, unstable_batchedUpdates
- __SECRET_INTERNALS (ReactCurrentOwner, ReactCurrentDispatcher stubs)

**NOT Implemented (potential additions)**:
- `getDerivedStateFromProps` / `getDerivedStateFromError` — Would fix many class component libraries
- `getSnapshotBeforeUpdate` — Rare but some animation libraries use it
- `React.createFactory` — Deprecated but some old libraries use it
- `React.act()` — Testing utility, needed for library tests
- `ReactDOM.createRoot` options (onRecoverableError, identifierPrefix)
- `useActionState` / `useFormStatus` (React 19) — Not needed yet

---

## Confirmed Working: 62 Packages

### Batch 1 (Original 20)
Zustand, Framer Motion, Radix UI (8 primitives), React Spring, TanStack React Query, React Router v6, Ant Design, React Hook Form, TanStack Table, SWR, React Icons, Jotai, dnd-kit, React Markdown, React Hot Toast, TanStack Virtual, react-i18next, Headless UI, React Toastify, React Helmet

### Batch 2 (15)
Lucide React, Redux Toolkit + React-Redux, Sonner, React Dropzone, React Colorful, React Number Format, React Syntax Highlighter, Floating UI, React Textarea Autosize, React Day Picker, Embla Carousel, React Resizable Panels, Emotion (styled), Styled Components, React DnD

### Batch 3 (5)
Radix Suite Extended (Dialog, Popover, Tooltip, DropdownMenu, Tabs, Checkbox, Switch, Avatar), Vaul, react-error-boundary, react-use, input-otp

### Batch 4 (16)
cmdk, react-intersection-observer, use-debounce, usehooks-ts, react-player, react-loading-skeleton, react-countup, react-copy-to-clipboard, react-spinners, react-modal, downshift, react-responsive, react-hotkeys-hook, react-virtuoso, react-json-view-lite, @uidotdev/usehooks

### Batch 5 (7)
valtio, @tanstack/react-form, formik, Radix Extended (ScrollArea, Slider, Toggle, ToggleGroup, Accordion, Progress, Separator), notistack, react-intl, react-wrap-balancer

---

## Under Investigation (Broken): 9 Packages

| Package | Downloads/wk | Category | Issue |
|---------|-------------|----------|-------|
| @radix-ui/react-select | 19M | UI | Infinite hang — portal + event loop |
| recharts | 13.8M | Charts | Render loop — D3 integration |
| react-select | 5.1M | UI | Class component errors |
| react-datepicker | 2.7M | UI | Class inheritance chain |
| react-window v2 | 2.2M | Virtualization | Uses React internals |
| ag-grid-react | 665K | Data Grid | Custom portal system |
| react-transition-group | 22M | Animation | getDerivedStateFromProps missing |
| react-paginate | 560K | UI | Missing API surface |

---

## Priority Fixes (what-react only, NO core changes)

### P0 — Would unlock the most libraries
1. **Implement `getDerivedStateFromProps`** in class wrapper → fixes react-transition-group (22M/wk), potentially react-datepicker, react-select
2. **Add render cycle guard** → prevents infinite loops in recharts, radix-select

### P1 — Would improve reliability
3. **Improve portal event delegation** → fixes nested portal scenarios
4. **Implement `createFactory`** (deprecated but used) → may fix react-paginate

### P2 — Nice to have
5. **Better `findDOMNode` stub** → return actual DOM node for class components
6. **`React.act()`** implementation → enables running library test suites
