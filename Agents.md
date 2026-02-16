# What Framework — Agent Guide

> The closest framework to vanilla JS. Signals, components, fine-grained reactivity — no virtual DOM.

## Quick Start

```bash
npm install what-framework
```

```json
// tsconfig.json or jsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "what-framework"
  }
}
```

```jsx
import { signal, computed, mount } from 'what-framework';

function Counter() {
  const count = signal(0);
  const doubled = computed(() => count() * 2);

  return (
    <div>
      <p>{() => `Count: ${count()}, Doubled: ${doubled()}`}</p>
      <button onclick={() => count(count() + 1)}>Increment</button>
    </div>
  );
}

mount(<Counter />, '#app');
```

---

## How What Differs from React

This is the section to read carefully. What Framework looks like React but works fundamentally differently under the hood.

### 1. Signals, not useState

React re-renders entire component trees. What Framework uses **signals** — fine-grained reactive values that update only the DOM nodes that read them.

```jsx
// React
const [count, setCount] = useState(0);
// Re-renders the entire component on every change

// What Framework
const count = signal(0);
// Only the DOM nodes that call count() update — nothing else re-renders
```

**Key difference**: In React, the component function re-runs. In What, the component function runs **once**, and signal reads create subscriptions that update the DOM directly.

### 2. Components run once

```jsx
function MyComponent() {
  console.log('This runs ONCE, not on every update');
  const name = signal('world');

  // This effect re-runs when name() changes
  useEffect(() => {
    document.title = `Hello ${name()}`;
  });

  return <div>{() => `Hello ${name()}`}</div>;
}
```

React components are functions that re-execute on every state change. What components execute once — the signal system handles reactivity after that.

### 3. No virtual DOM

What Framework diffs against the **live DOM**, not a virtual copy. There's no reconciliation step, no fiber tree, no diffing algorithm. Signal changes go straight to the DOM node that reads them.

This means:
- No `key` prop needed for lists (use `<For>` component)
- No stale closure bugs
- No dependency arrays on effects (signals are tracked automatically)
- No `useCallback`/`useMemo` for performance (signals are already granular)

### 4. Event handlers: lowercase, not camelCase

```jsx
// React — synthetic event, camelCase
<button onClick={(e) => handleClick(e)}>

// What — real DOM event, lowercase
<button onclick={(e) => handleClick(e)}>
```

No synthetic event system. No event pooling. It's just `addEventListener` under the hood. Event handler names are **lowercase** (`onclick`, not `onClick`).

### 5. Reactive children need a function wrapper

```jsx
const count = signal(0);

// WRONG — renders once, never updates
<p>{count()}</p>

// RIGHT — wrapping in a function makes it reactive
<p>{() => count()}</p>
<p>{() => `Count is ${count()}`}</p>
```

When you want text to update reactively, wrap it in an arrow function. The function creates a reactive subscription — without it, the value is read once and never updates.

### 6. Computed values are automatic

```jsx
// React — manual dependency tracking
const doubled = useMemo(() => count * 2, [count]);

// What — automatic tracking
const doubled = computed(() => count() * 2);
// Recomputes when count changes. No dependency array needed.
```

### 7. Effects track dependencies automatically

```jsx
// React — you choose deps (and get it wrong)
useEffect(() => {
  fetchUser(userId);
}, [userId]); // forget a dep → stale closure bug

// What — tracked automatically
useEffect(() => {
  fetchUser(userId()); // signal read → auto-subscribed
});
// Re-runs when userId signal changes. No deps array.
```

**Important gotcha**: Don't pass functions as deps. Functions create new references every time, so deps always look "changed". Use primitive signal values.

### 8. No useCallback/useMemo needed

Since components run once and signals handle reactivity, there's no wasted re-render to prevent. `useCallback` and `useMemo` exist for React compatibility but are rarely needed.

### 9. Stores instead of Context + Reducers

```jsx
import { createStore, derived } from 'what-framework';

const store = createStore({
  todos: [],
  filter: 'all',
});

// Derived values (like selectors)
const filtered = derived(state => {
  if (state.filter === 'all') return state.todos;
  return state.todos.filter(t => t.status === state.filter);
});

// Update (direct mutation — signals handle reactivity)
store.todos = [...store.todos, newTodo];
store.filter = 'active';
```

No action creators, no reducers, no dispatch. Just mutate the store.

---

## Complete API Reference

### Reactivity
| Export | Description |
|--------|-------------|
| `signal(value)` | Create a reactive value. Read: `sig()`. Write: `sig(newVal)` |
| `computed(fn)` | Derived value, auto-tracks dependencies |
| `effect(fn)` | Side effect, re-runs when tracked signals change |
| `batch(fn)` | Group multiple signal writes into one update |
| `untrack(fn)` | Read signals without creating subscriptions |
| `flushSync()` | Force synchronous effect flush |
| `createRoot(fn)` | Create a reactive scope with cleanup |

### Rendering
| Export | Description |
|--------|-------------|
| `mount(jsx, selector)` | Mount a component to the DOM |
| `Fragment` | Group children without a wrapper element |

### Hooks (React-compatible)
| Export | Description |
|--------|-------------|
| `useState(initial)` | Signal-backed state (React API) |
| `useSignal(initial)` | Create signal inside component |
| `useComputed(fn)` | Computed inside component |
| `useEffect(fn)` | Effect with auto-tracking |
| `useMemo(fn)` | Memoized computation |
| `useCallback(fn)` | Memoized callback |
| `useRef(initial)` | Mutable ref that persists across signal updates |
| `useContext(ctx)` | Read context value |
| `useReducer(reducer, init)` | Reducer-based state |
| `onMount(fn)` | Run once after mount |
| `onCleanup(fn)` | Run on disposal |
| `createResource(fetcher)` | Async data resource |

### Components
| Export | Description |
|--------|-------------|
| `<Show when={signal} fallback={jsx}>` | Conditional rendering |
| `<For each={list}>{item => jsx}</For>` | List rendering |
| `<Switch>` / `<Match when={cond}>` | Pattern matching |
| `<Suspense fallback={jsx}>` | Async loading boundary |
| `<ErrorBoundary fallback={jsx}>` | Error catching |
| `lazy(() => import('./Cmp'))` | Code-split component |
| `<Island>` | Partial hydration boundary |
| `<Portal target={el}>` | Render outside component tree |
| `memo(component)` | Skip re-computation (rarely needed) |

### Data Fetching
| Export | Description |
|--------|-------------|
| `useSWR(key, fetcher)` | Stale-while-revalidate data fetching |
| `useQuery(key, fetcher)` | Query with caching |
| `useInfiniteQuery(key, fn)` | Paginated/infinite queries |
| `useFetch(url, options)` | Simple fetch wrapper |
| `invalidateQueries(key)` | Refetch cached queries |
| `prefetchQuery(key, fn)` | Pre-fetch data |

### Forms
| Export | Description |
|--------|-------------|
| `useForm(config)` | Form state management |
| `useField(name)` | Individual field binding |
| `<Input>`, `<Textarea>`, `<Select>`, `<Checkbox>`, `<Radio>` | Bound form components |
| `zodResolver(schema)` | Zod validation integration |
| `yupResolver(schema)` | Yup validation integration |

### Animation
| Export | Description |
|--------|-------------|
| `spring(value, config)` | Physics-based spring animation |
| `tween(value, config)` | Duration-based tween |
| `easings` | Easing functions (linear, easeInOut, etc.) |
| `useTransition(signal)` | Animate signal changes |
| `useGesture(el, handlers)` | Drag/pinch gesture handling |
| `cssTransition(config)` | CSS transition helper |

### Accessibility
| Export | Description |
|--------|-------------|
| `useFocusTrap(el)` | Trap focus inside element |
| `<FocusTrap>` | Component wrapper for focus trapping |
| `announce(message)` | Screen reader announcement |
| `<SkipLink>` | Skip to content link |
| `useRovingTabIndex()` | Arrow key navigation |
| `<VisuallyHidden>` | Visually hidden but accessible |
| `useId()` | Unique ID generation |
| `Keys` | Keyboard key constants |

### State Management
| Export | Description |
|--------|-------------|
| `createStore(initial)` | Reactive store |
| `derived(fn)` | Store-level computed values |
| `atom(initial)` | Standalone reactive atom |

### Utilities
| Export | Description |
|--------|-------------|
| `cls(...args)` | Conditional class names |
| `style(obj)` | Dynamic inline styles |
| `debounce(fn, ms)` | Debounced function |
| `throttle(fn, ms)` | Throttled function |
| `useMediaQuery(query)` | Responsive media query |
| `useLocalStorage(key)` | Persistent signal in localStorage |
| `<Head>` | Document head management (title, meta) |

### Routing (`what-framework/router`)
| Export | Description |
|--------|-------------|
| `<Router>` | Root router component |
| `<Link to="/path">` | Navigation link with prefetch |
| `<Outlet />` | Nested route renderer |
| `route` | Current route state (path, params, query) |
| `navigate(path)` | Programmatic navigation |
| `<FileRouter />` | File-based routing |
| `guard(fn)` | Route guard |
| `prefetch(path)` | Prefetch route |
| `enableScrollRestoration()` | Save/restore scroll position |

---

## Key Gotchas

1. **Reactive children need `() =>`**: Wrap dynamic text in arrow functions — `{() => count()}` not `{count()}`. Without the wrapper, it renders once and never updates.

2. **`useEffect` deps**: Functions create new refs every time → deps always look "changed". Use primitive signal values, not functions.

3. **`spring()` / `tween()` must be in `useRef`**: Components run once but you don't want to recreate animations. Wrap in `useRef`.

4. **`useSWR` key must be a string**: It's used as a Map key. Pass `'/api/users'`, not `() => '/api/users'`.

5. **`useSWR` returns signal getters**: Call them — `data()`, `isLoading()`, `error()`.

6. **`formState.errors`/`.values` are property getters** (no parens), but `.isDirty()` IS a function.

7. **`derived()` in stores**: Use `derived(state => ...)` not `derived(function() { this... })`.

8. **Event handlers are lowercase**: `onclick`, `onsubmit`, `oninput` — not `onClick`, `onSubmit`, `onInput`.

---

## The Stack

What Framework is the frontend layer of a three-framework stack:

| Layer | Framework | What it does |
|-------|-----------|-------------|
| **Frontend** | **What Framework** | Signals, components, reactivity, routing |
| **Backend** | **CelsianJS** | Server, RPC, caching, tasks, middleware, SSE, WebSocket |
| **Meta-framework** | **ThenJS** | File routing, SSR, Vite plugin, build, deploy adapters |

Each works independently. Use What alone for SPAs. Add CelsianJS for a backend. Add ThenJS for the full-stack Next.js-like experience.

```
npm install what-framework          # Frontend only
npm install what-framework celsian  # + Backend (when published)
npx create-then my-app              # Full stack (when published)
```
