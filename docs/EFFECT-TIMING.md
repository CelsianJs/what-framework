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

## Effect Ordering: Topological Sort

Effects are executed in topological order based on their dependency depth:

- **Level 0:** Source signals (not executed, just the origin)
- **Level 1:** Effects/computeds that read only source signals
- **Level 2:** Effects/computeds that read level-1 computeds
- And so on

When multiple effects are pending in the same flush, they are sorted by level (lowest first). This ensures that computeds closer to the signal source update before effects that depend on them.

```js
const a = signal(1);
const b = computed(() => a() * 2);    // level 1
const c = computed(() => b() + 1);    // level 2

effect(() => {
  console.log('c is', c());           // level 3 — runs last
});

a.set(5);
// Flush: b recomputes (level 1) → c recomputes (level 2) → effect runs (level 3)
// Effect sees consistent state: c = (5 * 2) + 1 = 11
```

Deduplication: pending effects are stored with a `_pending` flag. If the same effect is notified multiple times (e.g., it reads two signals that both change), it only runs once per flush pass.

The flush loop runs up to 25 iterations. If effects continuously trigger each other beyond 25 iterations, execution stops to prevent infinite loops.

## Fine-Grained Effects: Per-Binding, Not Per-Component

In WhatFW, effects are created **per dynamic binding**, not per component. The compiler extracts each dynamic expression into its own `insert()` call, which internally wraps the expression in an individual `effect()`.

```jsx
function UserCard() {
  const name = useSignal('Alice');
  const age = useSignal(30);
  const bio = useSignal('Developer');

  return (
    <div class="card">
      <h2>{() => name()}</h2>       {/* effect #1: updates <h2> text only */}
      <span>{() => age()}</span>     {/* effect #2: updates <span> text only */}
      <p>{() => bio()}</p>           {/* effect #3: updates <p> text only */}
    </div>
  );
}
```

After compilation, there are three independent effects:
1. Effect #1 tracks `name` and updates only the `<h2>` text node
2. Effect #2 tracks `age` and updates only the `<span>` text node
3. Effect #3 tracks `bio` and updates only the `<p>` text node

When `name.set('Bob')` is called:
- Only effect #1 fires
- Only the `<h2>` text content changes
- The component function does NOT re-run
- Effects #2 and #3 are not touched
- No diffing, no reconciliation

This is the fundamental difference from React's model (re-run entire component, diff entire subtree) and the source of WhatFW's performance advantage for updates.

### Signal write → DOM update timeline

```
signal.set(newValue)
  │
  ├── Synchronous: notify subscribers, mark computeds dirty
  │   └── For each subscriber effect: set _pending = true, push to pendingEffects
  │
  ├── Schedule: queueMicrotask(flush) if not already scheduled
  │
  └── Microtask boundary ─────────────────────────────────
      │
      flush()
        ├── Sort pendingEffects by topological level
        ├── For each effect (lowest level first):
        │   ├── Run cleanup from previous execution (if any)
        │   ├── Re-run the effect function
        │   ├── Track new signal reads (dynamic dependency tracking)
        │   └── Effect updates its one DOM node
        └── If new effects were scheduled during flush, loop (up to 25 iterations)
```

## computed() Timing

Computeds are lazy: they only recompute when read AND a dependency has changed. They do not participate in the microtask flush directly. Instead, they are marked dirty when a dependency changes and recompute on the next read.

```js
const count = signal(0);
const doubled = computed(() => count() * 2);

count.set(5);
// doubled is marked dirty but NOT recomputed yet
console.log(doubled()); // Recomputes NOW, returns 10
```

When a computed is read inside an effect during flush, it recomputes on demand before the effect uses its value. This lazy evaluation avoids unnecessary computation for computeds that are conditionally read.

## untrack()

`untrack()` reads signals without subscribing. The effect will not re-run when the untracked signal changes:

```js
effect(() => {
  const name = userName(); // Tracked — effect re-runs when userName changes
  const config = untrack(() => appConfig()); // NOT tracked
});
```

## Effects and Component Lifecycle

Components run once. Effects created during the component's single execution are registered with the component's context and automatically disposed when the component unmounts:

```js
function Timer() {
  const elapsed = useSignal(0);

  useEffect(() => {
    const id = setInterval(() => elapsed.set(e => e + 1), 1000);
    return () => clearInterval(id);  // Cleanup runs on unmount
  }, []);

  return <span>{() => elapsed()}</span>;
}
```

When `Timer` is removed from the DOM, `disposeTree` walks the subtree, finds the component context, and disposes all registered effects -- including the `insert()` effect for the `<span>` text and the `useEffect` with the interval cleanup.

Effects that return a function get automatic cleanup: the returned function runs before each re-execution and on final disposal:

```js
effect(() => {
  const handler = () => console.log('resize');
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler); // Cleanup
});
```
