# Agent Patterns and Best Practices

How AI agents should write, debug, and maintain What Framework code.

## Pattern 1: Always Read Signals with `()`

Signals are functions. Every signal read must include `()`.

```jsx
// Pattern
const count = useSignal(0);
const name = useSignal('');

// Reading
count()         // number
name()          // string
count.peek()    // read without tracking (use sparingly)

// Writing
count.set(5);
count.set(c => c + 1);
name.set('Alice');
```

## Pattern 2: Immutable Updates for Objects/Arrays

Never mutate signal values in place. Always create new references.

```jsx
// Array operations
const items = useSignal([]);

// Add
items.set(prev => [...prev, newItem]);

// Remove
items.set(prev => prev.filter(item => item.id !== targetId));

// Update one item
items.set(prev => prev.map(item =>
  item.id === targetId ? { ...item, done: true } : item
));

// Object operations
const user = useSignal({ name: '', email: '' });
user.set(prev => ({ ...prev, name: 'Alice' }));
```

## Pattern 3: Component Structure

Components run once. Put reactive logic in effects, derived values in computed.

```jsx
function UserProfile({ userId }) {
  // State
  const editing = useSignal(false);

  // Derived values
  const { data, isLoading, error } = useSWR(
    `user-${userId}`,
    () => fetch(`/api/users/${userId}`).then(r => r.json())
  );

  // Side effects
  useEffect(() => {
    document.title = data()?.name ?? 'Loading...';
  });

  // Event handlers
  const onSave = async (values) => {
    await fetch(`/api/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(values),
    });
    editing.set(false);
  };

  // Render (executes once, dynamic parts update via effects)
  if (isLoading()) return <Spinner />;
  if (error()) return <p>Error: {error().message}</p>;

  return (
    <div>
      <h1>{data().name}</h1>
      <p>{data().email}</p>
      <button onClick={() => editing.set(true)}>Edit</button>
    </div>
  );
}
```

## Pattern 4: Form Handling

Always use the `useForm` hook. Always access errors via getter, never as a function call.

```jsx
import { useForm, ErrorMessage, rules, simpleResolver } from 'what-framework';

function ContactForm() {
  const { register, handleSubmit, formState, reset } = useForm({
    defaultValues: { name: '', email: '', message: '' },
    resolver: simpleResolver({
      name: [rules.required()],
      email: [rules.required(), rules.email()],
      message: [rules.required(), rules.minLength(10)],
    }),
  });

  const onSubmit = async (values) => {
    await fetch('/api/contact', {
      method: 'POST',
      body: JSON.stringify(values),
    });
    reset();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('name')} placeholder="Name" />
      <ErrorMessage name="name" formState={formState} />

      <input {...register('email')} placeholder="Email" />
      <ErrorMessage name="email" formState={formState} />

      <textarea {...register('message')} placeholder="Message" />
      <ErrorMessage name="message" formState={formState} />

      <button type="submit">Send</button>
    </form>
  );
}
```

## Pattern 5: Global State with Stores

Use `createStore` for state shared across components. Use `derived` for computed fields inside the store.

```jsx
import { createStore, derived } from 'what-framework';

const useCart = createStore({
  items: [],
  total: derived(state =>
    state.items().reduce((sum, item) => sum + item.price * item.qty, 0)
  ),
  itemCount: derived(state =>
    state.items().reduce((sum, item) => sum + item.qty, 0)
  ),
});

// In any component:
function CartSummary() {
  const cart = useCart();
  return (
    <div>
      <p>{cart.itemCount()} items</p>
      <p>Total: ${cart.total().toFixed(2)}</p>
    </div>
  );
}

function AddToCartButton({ product }) {
  const cart = useCart();
  const addItem = () => {
    cart.items.set(prev => {
      const existing = prev.find(i => i.id === product.id);
      if (existing) {
        return prev.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i);
      }
      return [...prev, { ...product, qty: 1 }];
    });
  };
  return <button onClick={addItem}>Add to Cart</button>;
}
```

## Pattern 6: Data Fetching

Use `useSWR` for simple fetch-and-cache. Use `useQuery` for more control.

```jsx
import { useSWR, invalidateQueries } from 'what-framework';

function TodoList() {
  const { data, isLoading, error } = useSWR(
    'todos',
    () => fetch('/api/todos').then(r => r.json())
  );

  const addTodo = async (text) => {
    await fetch('/api/todos', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    invalidateQueries('todos');  // refetch
  };

  if (isLoading()) return <Spinner />;
  if (error()) return <p>Error loading todos</p>;

  return (
    <ul>
      {data().map(todo => <li key={todo.id}>{todo.text}</li>)}
    </ul>
  );
}
```

## Pattern 7: Conditional Rendering

Prefer ternaries for simple conditions. Use `<Show>` for readability with fallbacks.

```jsx
// Simple toggle
{isOpen() ? <Panel /> : null}

// With fallback
<Show when={isLoggedIn()} fallback={<LoginPrompt />}>
  <Dashboard />
</Show>

// Multi-branch
<Switch>
  <Match when={status() === 'loading'}><Spinner /></Match>
  <Match when={status() === 'error'}><ErrorView /></Match>
  <Match when={status() === 'success'}><Content /></Match>
</Switch>
```

## Pattern 8: Batch Updates

When writing to multiple signals, wrap in `batch()` to flush effects once.

```jsx
import { batch } from 'what-framework';

const name = useSignal('');
const email = useSignal('');
const age = useSignal(0);

function resetForm() {
  batch(() => {
    name.set('');
    email.set('');
    age.set(0);
    // Effects run once after batch, not three times
  });
}
```

## Pattern 9: Cleanup

Effects return cleanup functions. `onCleanup` registers disposal callbacks.

```jsx
import { useEffect, onCleanup } from 'what-framework';

function Timer() {
  const seconds = useSignal(0);

  useEffect(() => {
    const id = setInterval(() => seconds.set(s => s + 1), 1000);
    return () => clearInterval(id);  // cleanup on re-run or unmount
  });

  // Or use onCleanup for component-level cleanup
  onCleanup(() => {
    console.log('Timer unmounted');
  });

  return <p>Elapsed: {seconds()}s</p>;
}
```

## Pattern 10: MCP Debugging Workflow

When debugging a WhatFW app as an agent:

```
1. Check connection
   what_connection_status

2. Get overview
   what_diagnose { focus: "all" }

3. Investigate specific issue
   what_signals { filter: "relevant" }
   what_effects { depSignalId: <id> }
   what_dependency_graph { signalId: <id> }

4. Test a fix
   what_set_signal { signalId: <id>, value: <test_value> }
   what_watch { duration: 2000 }

5. Verify state
   what_dom_inspect { componentId: <id> }
   what_diff_snapshot { action: "save" }
   ... make changes ...
   what_diff_snapshot { action: "diff" }
```

---

## Anti-Patterns to Avoid

### Do Not Re-Render Manually

There is no `forceUpdate()` or `setState({})` pattern. If the UI isn't updating, the signal isn't being read reactively.

### Do Not Use `useMemo` for Signal-Derived Values

`useMemo` uses a dependency array and doesn't auto-track signals. Use `useComputed` instead.

### Do Not Mix Raw HTML Props with Children

```jsx
// WRONG
<div innerHTML={{ __html: '<b>Hello</b>' }}>
  <p>This will be ignored</p>
</div>

// CORRECT -- choose one or the other
<div innerHTML={{ __html: '<b>Hello</b>' }} />
```

### Do Not Read Signals Outside Reactive Context

```jsx
// WRONG -- reads once, never updates
const val = count();
return <p>{val}</p>;

// CORRECT -- read inside JSX
return <p>{count()}</p>;
```

### Do Not Hardcode MCP Signal/Effect IDs

IDs change between page reloads. Always query first:

```
// WRONG
what_set_signal { signalId: 3, value: 0 }

// CORRECT
what_signals { filter: "count" }  // find current ID
what_set_signal { signalId: <returned_id>, value: 0 }
```
