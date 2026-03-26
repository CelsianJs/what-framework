# Migration from React

A practical guide for React developers evaluating or switching to What Framework. No marketing -- just the differences, with code examples.

## What's the Same

These patterns transfer directly with no changes.

### JSX Syntax

Identical. The same JSX you write in React works here.

```jsx
// React and WhatFW — same syntax
function Greeting({ name }) {
  return <h1 className="title">Hello, {name}</h1>;
}
```

### useRef

Same API, same behavior. Returns a mutable ref object.

```jsx
function InputFocus() {
  const inputRef = useRef(null);

  onMount(() => {
    inputRef.current.focus();
  });

  return <input ref={inputRef} />;
}
```

### useContext / createContext

Identical pattern.

```jsx
const ThemeContext = createContext('light');

function App() {
  return (
    <ThemeContext.Provider value="dark">
      <Toolbar />
    </ThemeContext.Provider>
  );
}

function Toolbar() {
  const theme = useContext(ThemeContext);
  return <div class={theme}>...</div>;
}
```

### Component Composition

Same patterns -- children, render props, higher-order components all work.

```jsx
function Card({ children, title }) {
  return (
    <div class="card">
      <h2>{title}</h2>
      <div class="card-body">{children}</div>
    </div>
  );
}

function App() {
  return (
    <Card title="Welcome">
      <p>Card content here</p>
    </Card>
  );
}
```

### Event Handling

Same `onClick`, `onChange`, `onSubmit` patterns.

```jsx
function Button() {
  const handleClick = (e) => {
    e.preventDefault();
    console.log('clicked');
  };

  return <button onClick={handleClick}>Click me</button>;
}
```

## What's Different

These are the patterns that change. Read this section carefully.

### Signal-Based State

**React:**
```jsx
const [count, setCount] = useState(0);
// count is a value: 0, 1, 2, ...
// setCount is a function: setCount(5) or setCount(prev => prev + 1)
```

**WhatFW with useState:**
```jsx
const [count, setCount] = useState(0);
// count is a FUNCTION (signal accessor) — call it to read: count()
// setCount works the same: setCount(5) or setCount(prev => prev + 1)
```

**WhatFW with useSignal (preferred):**
```jsx
const count = useSignal(0);
// Read:  count()
// Write: count.set(5) or count.set(prev => prev + 1)
// Peek:  count.peek() — read without creating a subscription
```

### Reading State in JSX

**React:**
```jsx
return <p>Count: {count}</p>;
```

**WhatFW:**
```jsx
// Option 1: Wrap in arrow function (explicit, always works)
return <p>Count: {() => count()}</p>;

// Option 2: Direct call (compiler auto-wraps in fine-grained mode)
return <p>Count: {count()}</p>;

// WRONG: This renders the function reference as text, e.g., "function sig() {...}"
return <p>Count: {count}</p>;
```

The compiler automatically wraps `{count()}` in `() => count()` for you. Both forms produce the same output: an effect that updates just that text node when `count` changes.

### Components Run Once

This is the most important conceptual difference.

**React:** Component function re-runs on every state change. Local variables are recreated. You need `useMemo`, `useCallback`, and `React.memo` to prevent unnecessary work.

**WhatFW:** Component function runs exactly once. The returned DOM is permanent. Signals create individual effects that surgically update specific DOM nodes.

```jsx
// This function runs ONCE
function Counter() {
  const count = useSignal(0);

  // This log runs once, not on every update
  console.log('Counter component executed');

  // The effect created by {() => count()} updates only this text node
  return (
    <div>
      <p>{() => count()}</p>
      <button onClick={() => count.set(c => c + 1)}>+1</button>
    </div>
  );
}
```

**Implications of run-once:**
- No stale closures -- the function body is only entered once, so there's only one closure
- No need for `useCallback` dependency arrays -- the callback is created once and captures the signal, which always returns the latest value
- No need for `useMemo` dependency arrays -- `useComputed` auto-tracks signal dependencies
- No "rules of hooks" ordering concerns for signal primitives used outside components

### useMemo / useComputed

**React:**
```jsx
const doubled = useMemo(() => count * 2, [count]);
// Must manually specify [count] as dependency
// Bug if you forget a dependency
```

**WhatFW:**
```jsx
const doubled = useComputed(() => count() * 2);
// No dependency array — auto-tracks that it reads count()
// Recomputes only when count changes
// Returns a signal accessor: read with doubled()
```

### useCallback

**React:**
```jsx
const handleClick = useCallback(() => {
  setCount(count + 1);
}, [count]);
// Must update dep array when closure variables change
// Stale closure bug if deps are wrong
```

**WhatFW:**
```jsx
const handleClick = useCallback(() => {
  count.set(c => c + 1);
});
// No dependency array needed — count.set is stable
// No stale closure — count() always returns latest value
// The function reference is stable (created once)
```

### useEffect

**React:**
```jsx
useEffect(() => {
  document.title = `Count: ${count}`;
}, [count]);
// Must specify deps manually
// Runs after paint
```

**WhatFW (no deps -- auto-tracking):**
```jsx
useEffect(() => {
  document.title = `Count: ${count()}`;
});
// No dependency array: auto-tracks signal reads
// Runs before paint (microtask timing)
// Re-runs whenever count() changes
```

**WhatFW (empty deps -- mount only):**
```jsx
useEffect(() => {
  console.log('mounted');
  return () => console.log('unmounted');
}, []);
// Same as React: runs once on mount, cleanup on unmount
```

**WhatFW (signal deps -- explicit tracking):**
```jsx
useEffect(() => {
  console.log('count changed to', count());
}, [count]);
// Deps should be signal functions (not values)
// The framework calls each dep to establish tracking
```

### Conditional Rendering

**React:**
```jsx
{isLoggedIn && <Dashboard />}
{isLoading ? <Spinner /> : <Content />}
```

**WhatFW:**
```jsx
{() => isLoggedIn() && <Dashboard />}
{() => isLoading() ? <Spinner /> : <Content />}

// Or use the Show component:
<Show when={isLoggedIn}>
  <Dashboard />
</Show>
```

Wrap conditionals in `() =>` so they become reactive expressions. Without the wrapper, the condition is evaluated once at component creation and never updates.

### List Rendering

**React:**
```jsx
{items.map(item => <li key={item.id}>{item.name}</li>)}
```

**WhatFW:**
```jsx
<For each={items} key={item => item.id}>
  {(item, index) => <li>{() => item().name}</li>}
</For>

// Or with mapArray directly:
{mapArray(items, (item, index) => <li>{() => item().name}</li>, { key: item => item.id })}
```

`For` provides keyed reconciliation with LIS-based minimal DOM moves. Each item gets its own reactive scope that is automatically disposed on removal.

## What's Better

### No Dependency Array Bugs

The #1 source of React bugs is wrong or missing dependency arrays. WhatFW eliminates this entirely:

```jsx
// React: easy to get wrong
useEffect(() => {
  fetchData(userId, filter);       // Bug if you forget [filter]
}, [userId]);

// WhatFW: auto-tracks everything
useEffect(() => {
  fetchData(userId(), filter());   // Automatically re-runs when either changes
});
```

### No Stale Closure Issues

```jsx
// React: classic stale closure bug
function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setCount(count + 1);         // Always sees count = 0 (stale closure)
    }, 1000);
    return () => clearInterval(id);
  }, []);                           // Missing count in deps
}

// WhatFW: no stale closure possible
function Counter() {
  const count = useSignal(0);

  useEffect(() => {
    const id = setInterval(() => {
      count.set(c => c + 1);       // Always works — count.set is stable
    }, 1000);
    return () => clearInterval(id);
  }, []);
}
```

### No Unnecessary Re-renders

```jsx
// React: Parent re-renders all children on any state change
function Parent() {
  const [name, setName] = useState('');
  const [age, setAge] = useState(0);

  return (
    <div>
      <NameDisplay name={name} />     {/* Re-renders when age changes too */}
      <AgeDisplay age={age} />        {/* Re-renders when name changes too */}
    </div>
  );
}
// Fix requires React.memo, useMemo, useCallback — boilerplate

// WhatFW: each binding is independent
function Parent() {
  const name = useSignal('');
  const age = useSignal(0);

  return (
    <div>
      <NameDisplay name={name} />     {/* Only updates when name changes */}
      <AgeDisplay age={age} />        {/* Only updates when age changes */}
    </div>
  );
}
// No memo, no optimization needed — fine-grained by default
```

### Fine-Grained DOM Updates

When a signal changes, only the specific DOM nodes that read that signal are updated. No component function re-executes. No virtual DOM diff. The update path is: signal write --> notify subscriber effect --> effect updates one DOM node.

### Smaller Bundle, Faster Startup

The core reactive system + rendering primitives are significantly smaller than React + ReactDOM. Tree-shaking removes unused features (forms, animations, data fetching) if you don't import them.

## What's Not Available

Be aware of these gaps before migrating.

### No Concurrent Features

React 18+ concurrent features are not available:
- `startTransition` -- exists as a compatibility shim but does not provide priority scheduling
- `useDeferredValue` -- not implemented
- `useTransition` -- exists but is not concurrent (no time-slicing)

### No Suspense for Data Loading

Suspense works for `lazy()` component loading only. It does not support:
- Data fetching with Suspense (`use()` / throw Promise pattern for arbitrary data)
- Streaming SSR with Suspense boundaries
- Nested Suspense with progressive hydration

For data fetching, use `useSWR`, `useQuery`, or `useFetch` instead.

### No Server Components

React Server Components (RSC) are not available. There is no `.server.js` / `.client.js` boundary. All components run on both server (for SSR) and client (for interactivity).

### No React DevTools

React DevTools does not work with WhatFW. The framework has its own DevTools extension and an MCP-based debugging bridge for AI-assisted development, but the tooling is less mature.

### Ecosystem Libraries

React libraries that depend on React internals (`__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED`, fiber tree access) will not work. Libraries that use only the public React API often work through the react-compat layer, but not always. Confirmed working libraries include react-window, cmdk, sonner, styled-components, and emotion.

## Migration Checklist

1. Replace `useState` return destructuring: `const [val, setVal]` --> getter is now a function, call `val()` to read
2. Remove all dependency arrays from `useEffect` (or switch to signal-based deps)
3. Remove all dependency arrays from `useMemo` (replace with `useComputed`)
4. Remove `useCallback` dependency arrays
5. Remove all `React.memo()` wrappers (unnecessary with fine-grained updates)
6. Wrap dynamic JSX expressions in `() =>` for reactive updates
7. Replace `.map()` in JSX with `<For>` for keyed list rendering
8. Replace `React.lazy` with `lazy` from what-core (same API)
9. Update imports: `react` --> `what-core`
