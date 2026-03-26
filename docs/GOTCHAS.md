# Gotchas and Footguns

Updated for the fine-grained reactive architecture. Includes agent-specific gotchas.

## 1. Signal Read Requires `()` Call

Signals are functions. You must call them to read the value.

```jsx
const count = useSignal(0);

// correct
console.log(count());        // 0
console.log(count() + 1);   // 1

// wrong -- this is the function reference, not the value
console.log(count);          // [Function: sig]
console.log(count + 1);     // "function sig() { ... }1"
```

This is the most common mistake for developers and agents coming from React, where `useState` returns a plain value.

## 2. JSX Dynamic Expressions Need `() =>`

In JSX, `{count}` passes the function reference, which renders as text like `"function sig() {...}"`. Wrap dynamic expressions in an arrow function or call the signal directly:

```jsx
const count = useSignal(0);

// correct -- reactive, updates when count changes
<p>{() => count()}</p>

// correct -- compiler auto-wraps in fine-grained mode
<p>{count()}</p>

// wrong -- renders the function reference as a string
<p>{count}</p>
```

The compiler automatically wraps `{count()}` into `() => count()`, making both forms equivalent. But `{count}` (without calling it) is never correct for displaying a signal's value.

## 3. Don't Mutate Signal Values Directly

Signals use `Object.is` for equality checks. Mutating an object/array in place and setting it back will not trigger updates because the reference hasn't changed.

```jsx
const items = useSignal([1, 2, 3]);

// wrong -- mutates in place, Object.is sees same reference
items().push(4);
items.set(items());  // No update! Same array reference.

// correct -- create a new array
items.set(prev => [...prev, 4]);

// wrong -- mutates object in place
const user = useSignal({ name: 'Alice', age: 30 });
user().name = 'Bob';
user.set(user());  // No update!

// correct -- spread into a new object
user.set(prev => ({ ...prev, name: 'Bob' }));
```

## 4. `show()` is Gone

Use ternaries or `<Show>`.

```jsx
// correct
{() => isOpen() ? <Modal /> : null}

// or
<Show when={isOpen}>
  <Modal />
</Show>
```

Run migration codemod:

```bash
npm run codemod:show
```

## 5. `formState.errors` is a Getter Object

```jsx
// correct
formState.errors.email?.message

// wrong
formState.errors().email
```

## 6. Event Casing in Source vs Runtime

- Source/docs: use `onClick`.
- Runtime compatibility: `onclick` still works.

## 7. Signal Setter Style

Docs standardize on `.set(...)`:

```jsx
count.set(c => c + 1)
```

Callable writes are still supported for compatibility:

```jsx
count(c => c + 1)
```

## 8. `useComputed` vs `derived` vs `useMemo`

- `useComputed`: component-level signal-derived values. Auto-tracks deps. Returns a signal accessor.
- `derived`: store-level derived fields inside `createStore`.
- `useMemo`: dependency-array memo for non-signal inputs. Avoid when signals are involved -- use `useComputed` instead.

Using the wrong one often causes confusion about when recomputation occurs.

## 9. Raw HTML Props Own Element Children

Use the `{ __html: string }` form for security:

```jsx
<div innerHTML={{ __html: '<strong>Hello</strong>' }} />
<div dangerouslySetInnerHTML={{ __html: '<strong>Hello</strong>' }} />
```

If you use either prop, do not rely on vnode children in the same element.

## 10. Dialog Focus Restore Should Be Parent-Controlled

`FocusTrap` handles trapping. Parent logic should capture and restore focus with `useFocusRestore()`.

## 11. CSS-First Interactions Are Preferred

Avoid repeated per-element JS hover/focus style mutation handlers. Use CSS pseudo-classes and classes instead.

## 12. Imported Signals May Need Manual Reactive Wrapping

When you pass a signal to a child component or import one from a module, reading it in JSX still requires the `() =>` wrapper for reactivity:

```jsx
// parent.jsx
const count = useSignal(0);
<Child count={count} />

// child.jsx -- inside the component
function Child({ count }) {
  // correct -- reactive
  return <p>{() => count()}</p>;

  // wrong -- reads once, never updates
  const val = count();
  return <p>{val}</p>;
}
```

The key rule: if you want the DOM to update when a signal changes, the signal read (`count()`) must happen inside a reactive context -- either an `effect()`, an `insert()` callback (`() => ...`), or a `computed()`.

## 13. SVG Elements Need Namespace

SVG elements are created with the SVG namespace automatically when nested inside `<svg>`. If you dynamically create SVG elements outside an `<svg>` parent, they may be created as HTML elements instead. Always nest SVG content within an `<svg>` element:

```jsx
// correct -- svg parent detected, children get SVG namespace
<svg viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="40" />
</svg>

// may fail -- circle created as HTML element
{() => showCircle() ? <circle cx="50" cy="50" r="40" /> : null}
// Fix: ensure it's inside an <svg> parent
```

## 14. Components Run Once -- No Re-Execution

Unlike React, the component function body executes exactly once. Code that expects to run on every "render" must be inside an `effect()` or `useEffect()`:

```jsx
function Greeter({ name }) {
  // wrong -- this only logs the initial value
  console.log('Rendering with name:', name());

  // correct -- logs every time name changes
  useEffect(() => {
    console.log('Name changed to:', name());
  });

  return <h1>{() => `Hello, ${name()}`}</h1>;
}
```

## 15. Conditional Signal Reads (Dynamic Dependencies)

Effects auto-track dependencies. If a signal is only read in one branch of a conditional, the effect is only subscribed to it when that branch runs:

```jsx
effect(() => {
  if (showDetails()) {
    console.log(details());  // Only tracked when showDetails() is true
  }
});
```

This is correct behavior (dynamic deps), but it can surprise you if you expect the effect to always react to `details` changes. If you need the effect to always track `details`, read it unconditionally:

```jsx
effect(() => {
  const d = details();  // Always tracked
  if (showDetails()) {
    console.log(d);
  }
});
```

---

## Agent-Specific Gotchas

### 16. Dev-Mode Validation Messages

In development mode, the runtime logs warnings for common mistakes:
- Passing a signal function reference where a value is expected
- Using `formState.errors()` as a function call
- Mixing raw HTML props with children

Agents should treat dev-mode warnings as errors and fix the underlying code.

### 17. innerHTML Requires `{ __html: string }` Object

A common agent mistake is using a plain string for innerHTML. The framework requires the `{ __html: string }` wrapper for security:

```jsx
// WRONG -- agents often generate this
<div innerHTML="<b>bold</b>" />

// CORRECT
<div innerHTML={{ __html: '<b>bold</b>' }} />
```

### 18. MCP Tool Responses Are JSON

All MCP DevTools tool responses are JSON with a `summary` field for quick reading and detailed data fields for deeper inspection. Agents should read the `summary` first and only parse detailed fields when needed.

### 19. Signal IDs Are Runtime-Assigned

Signal and effect IDs returned by MCP tools (`what_signals`, `what_effects`) are assigned at runtime and change between page reloads. Do not hardcode them. Always query for the current ID before using `what_set_signal` or `what_dependency_graph`.

### 20. Effects Flush Asynchronously

Signal writes do not immediately trigger effects. Effects are collected and flushed on the next microtask. If an agent needs to verify the result of a signal write via MCP, it should use `what_watch` with a short duration rather than immediately reading signals.

```
Agent: what_set_signal { signalId: 3, value: 42 }
Agent: what_watch { duration: 500, filter: "signal:updated" }
  -> Confirms the update propagated
```
