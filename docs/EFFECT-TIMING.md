# Effect Timing Model

Understanding when effects run is critical for writing correct What Framework code.

## The Core Rule

**Effects are microtask-deferred.** When you write to a signal, the effects that depend on it do not run immediately. They are collected and flushed on the next microtask.

```js
const count = signal(0);

effect(() => {
  console.log('count is', count());
});

count.set(1);
console.log('after set'); // This logs FIRST
// Output:
// count is 0        (initial run)
// after set          (synchronous)
// count is 1        (microtask flush)
```

## Why Microtask Deferral?

1. **No glitches.** Multiple signal writes in the same synchronous block are automatically batched:
   ```js
   firstName.set('John');
   lastName.set('Doe');
   // Effect that reads both runs ONCE with ('John', 'Doe')
   // Not twice with ('John', oldLast) then ('John', 'Doe')
   ```

2. **No visual flicker.** Effects run before the browser paints (microtasks resolve before requestAnimationFrame), so DOM updates from effects appear atomically.

3. **Predictable ordering.** Effects always see a consistent state.

## batch()

`batch()` groups multiple signal writes and defers all effects until the batch ends:

```js
batch(() => {
  count.set(1);
  name.set('updated');
  // No effects run here
});
// All effects run here, once
```

Outside a `batch()`, each signal write schedules a microtask flush. Multiple writes in the same synchronous block naturally batch because they all resolve to the same microtask. `batch()` is useful when you want to guarantee grouping across async boundaries or when you want explicit documentation of intent.

## flushSync()

`flushSync()` forces all pending effects to run immediately:

```js
count.set(5);
flushSync();
// Effects have already run — DOM is updated
const height = element.offsetHeight; // Safe to measure
```

Use `flushSync()` when you need to read DOM state that depends on a signal change (e.g., measuring element dimensions after a state update). Use sparingly.

## useEffect Timing

`useEffect` fires on microtask (before paint). This differs from React:

| Framework | useEffect timing |
|-----------|-----------------|
| **What** | Microtask (before paint) |
| React | After paint (via requestAnimationFrame/scheduler) |
| Solid | Synchronous (within reactive graph) |
| Svelte | After DOM update (tick) |

### Practical Implications

- **DOM measurements work.** Effects run after signals update the DOM but before the browser paints. You can safely read layout properties.
- **Animations that need the paint:** If your effect needs the browser to have painted first (e.g., reading computed styles after a CSS transition), wrap the measurement in `requestAnimationFrame`:
  ```js
  useEffect(() => {
    requestAnimationFrame(() => {
      const rect = element.getBoundingClientRect();
      // Now the paint has happened
    });
  });
  ```

## Effect Ordering

Effects run in the order they were notified. Pending effects are stored in a `Set`, which deduplicates: if the same effect is notified multiple times (e.g., it reads two signals that both change), it only runs once per flush pass.

If effect A writes to a signal that effect B depends on, B will run in the next iteration of the flush loop:

```js
const a = signal(1);
const b = signal(0);

effect(() => {
  b.set(a() * 2); // Effect A: writes to b when a changes
});

effect(() => {
  console.log('b is', b()); // Effect B: reads b
});

a.set(5);
// Flush pass 1: Effect A runs, sets b to 10
// Flush pass 2: Effect B runs, logs "b is 10"
```

The flush loop runs up to 100 iterations. If effects continuously trigger each other beyond 100 iterations, a warning is logged with the names of the looping effects.

## computed() Timing

Computeds are lazy: they only recompute when read AND a dependency has changed. They do not participate in the microtask flush. Instead, they are marked dirty when a dependency changes and recompute on the next read.

```js
const count = signal(0);
const doubled = computed(() => count() * 2);

count.set(5);
// doubled is marked dirty but NOT recomputed yet
console.log(doubled()); // Recomputes NOW, returns 10
```

## untrack()

`untrack()` reads signals without subscribing. The effect will not re-run when the untracked signal changes:

```js
effect(() => {
  const name = userName(); // Tracked — effect re-runs when userName changes
  const config = untrack(() => appConfig()); // NOT tracked
});
```

## Signal Subscriptions and Component Re-renders

In What Framework, components are wrapped in effects. When a component reads a signal, it subscribes to that signal. When the signal changes, the component re-renders.

```js
function Counter() {
  const count = useSignal(0);
  // Reading count() inside the component creates a subscription
  return h('div', null, `Count: ${count()}`);
  // When count changes, this component re-renders
}
```

Signals provide fine-grained reactivity at the component level: only components that READ a signal re-render when it changes. Parent components that don't read the signal are unaffected.

## Effects and Component Lifecycle

Inside components, use `effect()` directly for local reactive computations. Effects created during a component render should be cleaned up when the component unmounts. The framework provides `scopedEffect` (internal) which automatically ties the effect's lifecycle to the component:

```js
// Internal pattern used by data hooks:
function scopedEffect(fn) {
  const ctx = getCurrentComponent?.();
  const dispose = effect(fn);
  if (ctx) ctx.effects.push(dispose);
  return dispose;
}
```

When building custom hooks that use `effect()`, ensure the effect is disposed on component unmount by either:
1. Returning the dispose function from your hook (the consumer disposes it)
2. Pushing the dispose function to the component's `effects` array

Effects that return a function get automatic cleanup: the returned function runs before each re-execution and on final disposal:

```js
effect(() => {
  const handler = () => console.log('resize');
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler); // Cleanup
});
```
