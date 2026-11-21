# What Framework QuickStart for React Developers

The essential guide for humans and AI agents building with What Framework. Covers the mental model shift from React, common patterns, gotchas, and best practices — distilled from building 5 real-world apps.

---

## The Core Mental Model

**In React:** state is a value, components re-run on every state change.
**In What:** state is a signal (a function), components run once, only dependent DOM nodes update.

```jsx
// React
const [count, setCount] = useState(0);
return <span>{count}</span>;  // component re-runs when count changes

// What
const count = useSignal(0);
return <span>{count()}</span>;  // only this text node updates
```

Everything flows from this: **signals are getter functions**. You read by calling them.

---

## Signal Basics

### Read and Write

```jsx
const name = useSignal('Ada');

// READ — call the signal
name()           // → 'Ada'

// WRITE — use .set()
name.set('Grace');
name.set(prev => prev.toUpperCase());  // updater form (avoids stale closures)
```

### The #1 Gotcha: Forgetting `()`

```jsx
// WRONG — renders "[Function]" or is always truthy
<span>{name}</span>
{isLoading && <Spinner />}

// CORRECT
<span>{name()}</span>
{isLoading() && <Spinner />}
```

This is the single most common mistake. Every reactive value — signals, computed values, SWR results — must be **called** to read.

---

## Derived Values with `useComputed`

No dependency array needed. The framework auto-tracks which signals are read:

```jsx
const todos = useSignal([]);
const remaining = useComputed(() => todos().filter(t => !t.done).length);
// remaining() auto-updates whenever todos() changes
```

**When to use what:**
- `useComputed(() => ...)` — derives from signals, auto-tracks deps
- `useMemo(() => ..., [deps])` — dependency-array memo for non-signal values

Prefer `useComputed` when working with signals. It's the idiomatic choice.

---

## Event Handling

```jsx
<button onClick={() => count.set(c => c + 1)}>+</button>
<input onInput={(e) => query.set(e.target.value)} />
```

**Key difference from React:** Use `onInput` (not `onChange`) for text inputs if you want per-keystroke updates. What Framework uses native DOM semantics where `onChange` only fires on blur. For checkboxes and selects, `onChange` works as expected.

Both `onClick` and `onclick` are accepted, but stick with camelCase for consistency.

---

## Lists and Conditionals

Plain JS works. No special components needed:

```jsx
// Lists — use .map() with keys
{todos().map(todo => (
  <li key={todo.id}>{todo.title}</li>
))}

// Conditionals — ternaries
{isLoading() ? <Spinner /> : <Content data={data()} />}

// Guard patterns
{error() && <ErrorBox message={String(error())} />}
```

---

## Global State with `createStore`

Single-object definition: state + derived + actions.

```jsx
import { createStore, derived } from 'what-framework';

export const useAppStore = createStore({
  // STATE — plain values
  items: [],
  filter: 'all',

  // DERIVED — receives state as parameter (NOT this)
  filtered: derived((state) => {
    if (state.filter === 'all') return state.items;
    return state.items.filter(i => i.status === state.filter);
  }),

  count: derived((state) => state.items.length),

  // ACTIONS — use this to read/write
  addItem(item) {
    this.items = [...this.items, item];  // must spread, not push!
  },
  setFilter(f) {
    this.filter = f;
  },
});
```

### Critical Rules

1. **`derived()` uses `state` parameter** — NOT `this`
2. **Actions use `this`** — for both reading and writing state
3. **Never mutate in place** — `this.items.push(x)` won't trigger updates. Always assign a new reference: `this.items = [...this.items, x]`
4. **Actions auto-batch** — multiple writes in one action = one re-render

### Using the store in components

```jsx
function MyComponent() {
  const store = useAppStore();
  return (
    <div>
      <span>{store.count()}</span>
      <button onClick={() => store.addItem({ id: 1, text: 'hello' })}>Add</button>
    </div>
  );
}
```

---

## Data Fetching with `useSWR`

```jsx
import { useSWR, invalidateQueries } from 'what-framework/data';

function Dashboard() {
  const { data, error, isLoading, revalidate } = useSWR('users', fetchUsers);

  if (isLoading()) return <p>Loading...</p>;
  if (error()) return <p>Error: {String(error())}</p>;

  return (
    <ul>
      {(data() || []).map(user => <li key={user.id}>{user.name}</li>)}
    </ul>
  );
}
```

### Key patterns

```jsx
// Static key
useSWR('users', fetchUsers);

// Dynamic key (parameterized)
useSWR(`user:${id}`, fetchUser);      // fetcher receives key as first arg

// Conditional fetching (pass null to skip)
useSWR(selectedId() ? `user:${selectedId()}` : null, fetchUser);

// With options
useSWR('stats', fetchStats, {
  refreshInterval: 5000,    // auto-poll
  dedupingInterval: 2000,   // dedup rapid calls
});

// Manual revalidation
const { revalidate } = useSWR('users', fetchUsers);
<button onClick={() => revalidate()}>Refresh</button>

// Invalidate from anywhere
invalidateQueries('users');                        // exact key
invalidateQueries(key => key.startsWith('user:')); // predicate
```

### Loading vs Validating

- `isLoading()` — true only on initial load (no cached data)
- `isValidating()` — true during any fetch (including background revalidation)

Use `isLoading()` for skeleton screens. Use `isValidating()` for subtle refresh indicators.

---

## Refs and Effects

```jsx
import { useRef, useEffect } from 'what-framework';

function ScrollTracker() {
  const ref = useRef(null);
  const scrollY = useSignal(0);

  useEffect(() => {
    const el = ref.current;
    const handler = () => scrollY.set(el.scrollTop);
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);  // cleanup
  }, []);

  return <div ref={ref}>...</div>;
}
```

Effects run after mount (scheduled via microtask). Empty `[]` = run once. Cleanup function runs on unmount or before re-fire.

---

## React Ecosystem Compatibility

Use `what-react` to import React libraries (zustand, react-query, etc.):

```js
// vite.config.js
import { reactCompat } from 'what-react/vite';

export default defineConfig({
  plugins: [reactCompat()],  // replaces what() — do NOT use both
});
```

Then use React libraries normally:

```jsx
import { create } from 'zustand';
import { useSignal } from 'what-framework';

const useStore = create((set) => ({
  count: 0,
  inc: () => set((s) => ({ count: s.count + 1 })),
}));

function App() {
  const count = useStore((s) => s.count);  // zustand hook — works
  const local = useSignal('hello');         // What signal — also works
  return <div>{count} {local()}</div>;
}
```

**Rules:**
- Use `reactCompat()` as the sole vite plugin (not alongside `what()`)
- Import What-native APIs from `what-framework`
- Import React ecosystem packages normally — the alias layer is invisible
- Use `mount()` from `what-framework`, not `ReactDOM.render`

---

## Project Setup

```bash
npm create what@latest my-app
cd my-app && npm install
```

### Manual setup

```bash
npm install what-framework what-compiler
```

```js
// vite.config.js
import { defineConfig } from 'vite';
import { what } from 'what-compiler/vite';

export default defineConfig({
  plugins: [what()],
});
```

```jsx
// src/main.jsx
import { mount } from 'what-framework';

function App() {
  return <h1>Hello What</h1>;
}

mount(<App />, '#app');
```

---

## Quick Reference: React → What Translation

| React | What Framework | Notes |
|---|---|---|
| `useState(0)` | `useSignal(0)` | Returns signal object, not tuple |
| `count` | `count()` | Must call to read |
| `setCount(5)` | `count.set(5)` | `.set()` or updater `.set(c => c+1)` |
| `useMemo(() => x, [deps])` | `useComputed(() => x)` | No deps array needed |
| `useContext` | `createStore` | Global stores replace context |
| `onChange` (text input) | `onInput` | `onChange` = blur only in What |
| `ReactDOM.render` | `mount(<App />, '#app')` | Selector string |
| `swr.data` | `swr.data()` | All SWR returns are getters |

---

## Common Mistakes Checklist

Before shipping, verify:

- [ ] All signal reads use `()` — `count()` not `count`
- [ ] All SWR field reads use `()` — `data()`, `isLoading()`, `error()`
- [ ] Store arrays use spread, not mutation — `[...arr, item]` not `arr.push(item)`
- [ ] `derived()` uses `state` parameter, not `this`
- [ ] Text inputs use `onInput` for per-keystroke updates
- [ ] Complex nested components with async data are tested for reconciler stability
- [ ] `useComputed` (not `useMemo`) for signal-derived values

---

## Best Practices

1. **Keep components flat** — The reconciler handles complex trees, but simpler structures are more predictable, especially with async data (useSWR).
2. **Separate expensive from cheap computeds** — Put filter/sort in one `useComputed`, put the visible slice in another. Only the cheap one re-runs on scroll.
3. **Use `batch()` for multiple signal writes** — Event handlers may auto-batch, but explicit `batch()` is safer when updating 2+ signals.
4. **Prefer `useSignal` over `useState`** — `useState` works for React compat, but `useSignal` is the native idiom with better performance.
5. **Use `createStore` for shared state** — Replaces Context + useReducer. Single source of truth, no prop drilling.
6. **Static data doesn't need signals** — Constants, config objects, generated datasets — keep them as plain values.
