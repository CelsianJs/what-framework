# Effect Timing Model

Understanding when effects run is critical for writing correct What Framework code.

## The Core Rule

**Reads are immediate; effect re-runs are deferred.** A write is visible to every read right away, including reads of computeds that depend on it. The effects that depend on it run later: on the next microtask, at the end of the outermost `batch()`, or in `flushSync()`, whichever comes first.

```js
const count = signal(0);
const doubled = computed(() => count() * 2);

effect(() => {
  console.log('count is', count());
});

count.set(1);
console.log(count(), doubled()); // 1 2 — fresh, before any effect re-ran
console.log('after set');        // logs before the effect re-runs
// Output:
// count is 0        (first run: synchronous, inside effect())
// 1 2
// after set
// count is 1        (microtask flush)
```

An effect's **first run is synchronous**: `effect(fn)` runs `fn` once, tracking what it reads, before it returns.

## Why Defer Effects?

1. **No glitches.** Multiple writes in the same synchronous block settle together:
   ```js
   firstName.set('John');
   lastName.set('Doe');
   // An effect that reads both runs ONCE, with ('John', 'Doe')
   ```

2. **No visual flicker.** The microtask flush runs before the browser paints, so DOM updates from effects appear together.

3. **Consistent state.** An effect never sees a mix of old and new values. Before it re-runs, the computeds it depends on are brought up to date (see [How a write reaches an effect](#how-a-write-reaches-an-effect)).

## batch()

`batch()` groups writes; effects run once, synchronously, when the outermost batch ends. It returns the callback's value:

```js
const total = batch(() => {
  count.set(1);
  name.set('updated');
  return count() + 1;      // reads inside the batch are fresh too
});
// Effects have run here, once. total === 2
```

Outside a `batch()`, writes in the same synchronous block already share one microtask flush. Use `batch()` when the effects must have run by the time the call returns.

- `batch()` is synchronous. With an `async` callback it groups only the writes made before the first `await`; the later ones flush on their own microtasks, as unbatched writes do.
- A batch that ends while an effect is running or a computed is being evaluated does not flush there: the running flush picks the effects up, or else the microtask does. A flush never starts in the middle of an effect's run or a computed's evaluation, so neither is ever re-entered.

## flushSync()

`flushSync()` runs the pending effects now:

```js
count.set(5);
flushSync();
// Effects have already run — DOM is updated
const height = element.offsetHeight; // Safe to measure
```

Use it when you need DOM state that depends on a write (measuring after an update). Inside an effect (also inside `untrack()` in an effect), a computed, or a flush in progress it is a no-op, reported in development as `ERR_NESTED_FLUSH_SYNC`: the running flush, or the microtask, picks the effects up.

An effect's re-run owns what it creates, wherever the flush started: a `flushSync()` or `batch()` called inside `createRoot` does not hand that root the effects created by the re-runs it triggers.

## Effect Ordering

Effects are not sorted by depth. Consistency comes from pulling (an effect verifies its inputs before it runs), so ordering only has to answer one question: who runs first when several effects are due.

1. **Render phase, then user phase.** `effect(fn)` is a render-phase effect (DOM bindings). `effect(fn, { phase: 'user' })` is a user-phase effect: in a flush, user-phase effects run only once no render-phase effect is queued, so they observe settled bindings. If a user-phase effect writes, the render effects it dirtied run after the current user round, before any later user round (as React re-renders after all effects of a commit).
2. **Parent before child.** An effect created while another effect was running (a component mounted by a reactive region, for example) is that effect's child. A child is never queued before its parent, so a region re-runs, and disposes children it no longer needs, before those children could run against data the region guards. This holds across phases: an effect created while a user-phase effect runs is user-phase itself, so it re-runs after its parent in the user round. (A user-phase child of a render-phase parent needs nothing: render effects run first.)
3. **Otherwise, notification order**: the order in which the write reached the effects.
4. **`useEffect` and `onMount` in React's order.** A component's first runs are queued once its output is built, so on mount they run after its children's, siblings in the order they were built. A user round that runs some of them again runs every cleanup first, then every run, in the order they first ran, each after the round's effects below its component (a child's re-run, or the first run of a row a list just added). On unmount a component's `useEffect` cleanups run before anything below it is disposed, siblings first to last; `onCleanup` keeps the owner's order (children first, newest first). See [GOTCHAS 22](GOTCHAS.md#22-useeffect-runs-in-reacts-order-oncleanup-in-the-owners) for the two orders that are What's own.

```js
const s = signal(0);
const c1 = computed(() => s() + 1);
const c2 = computed(() => c1() + 1);

effect(() => console.log('deep', c2()));     // reached through c1, c2
effect(() => console.log('shallow', s()));   // reads s directly

s.set(1);
// deep 3
// shallow 1
// s notified c1 (on the first effect's path) before the second effect.
// Both saw settled values; neither ran twice.
```

**Each effect runs at most once per round**, however many of its inputs changed. An effect whose inputs recomputed to the same values does not run at all.

**Loop guard.** A flush runs at most 100 rounds. An effect that keeps writing a signal it reads (directly or through other effects) is stopped there, and the effects still queued are dropped, not run. The computeds those effects read are brought up to date first, so the next write reaches them again as usual. Cascades that settle in fewer rounds complete normally. In development the engine reports `ERR_INFINITE_EFFECT` for each effect still queued that wrote a signal during the flush, with its name and the number of times it re-ran; production builds keep the cap and print one line, `[what] Possible infinite effect loop detected`.

## How a write reaches an effect

```
signal.set(newValue)
  │
  ├── Object.is(old, new)? → nothing happens
  │
  ├── Synchronous push (no user code runs):
  │   ├── direct subscribers become DIRTY
  │   ├── everything further downstream becomes PENDING ("may have changed")
  │   ├── each node is visited at most once per write
  │   └── every effect reached is queued (render or user queue, parent first)
  │
  ├── Schedule: queueMicrotask(flush) unless inside batch() or a flush
  │
  └── Flush (microtask, end of batch(), or flushSync())
        └── round after round, render queue first, then user queue:
            for each queued effect
              ├── DIRTY   → run it
              ├── PENDING → check its computed inputs, depth-first:
              │             recompute those that are stale; if none of them
              │             changed value, skip the effect
              └── run: previous cleanup, then fn, tracking its reads anew
```

## computed() Timing

Computeds are lazy: they recompute when read after a dependency changed, not before.

```js
const count = signal(0);
const doubled = computed(() => count() * 2);

count.set(5);
// doubled is marked stale but NOT recomputed yet
console.log(doubled()); // Recomputes NOW, returns 10
```

- **Equality cut-off.** A computed that recomputes to the same value (`Object.is`) leaves its subscribers alone.
- **Errors are cached.** A computed whose function throws keeps the error as its value: every read rethrows the same error object, until a dependency changes.
- **Unobserved computeds let go.** When the last effect or computed reading a computed goes away, the computed stops listening to its own dependencies (so a long-lived signal does not keep it alive) and recomputes on its next read. A computed read while nothing observes it (in a component body, an event handler, `untrack()` or `peek()`) keeps its dependencies until the current task ends, so repeated reads in one task are cached; at the next microtask, after any flush already scheduled, it lets go of them the same way. A component-scope `computed(...)()` over a module-level signal is therefore never retained by that signal.
- **Cycles throw.** A computed that reads its own value, directly or through computeds that read it, throws an `Error` with `code: 'ERR_COMPUTED_CYCLE'` (in development the message names the computed). The error is cached like any computed error. This holds for cycles of any length.
- **`memo()`** from `what-framework/render` (not the root entry's `memo`, which wraps a component) is a computed evaluated once at creation; after that it behaves like any computed.

**Deep chains.** The first evaluation of a computed that reads a never-evaluated computed recurses on the JavaScript stack. Past 1,000 computeds evaluating one inside another (only the first read of a chain that long), the engine defers the deepest node and abandons every evaluation above it with an internal exception, then evaluates the chain from the bottom. Values and errors are never affected: an abandoned run is discarded and repeated, even if user code caught the exception. What user code can observe is a `catch` block around a read in such a chain running once, in a run that is then discarded. Effects never see it. Making it unobservable would mean never nesting evaluations, which is impossible for a computed whose dependencies are not known until it runs.

Reading a computed inside an effect brings it up to date first, so branches the effect does not read are never evaluated.

## untrack()

`untrack()` reads signals without subscribing. The effect will not re-run when the untracked signal changes:

```js
effect(() => {
  const name = userName(); // Tracked — effect re-runs when userName changes
  const config = untrack(() => appConfig()); // NOT tracked
});
```

## Errors in effects

An error thrown by an effect's first run propagates out of `effect()`; inside a component, the component catches it and hands it to the nearest `<ErrorBoundary>`. An error thrown by a **re-run** never aborts the flush: the other effects still run. It goes to the nearest owner that has an `_onError` handler (an `<ErrorBoundary>` installs one on the root of its children), else to `console.error`. A handler that throws passes its error further up. Nothing halts on an unhandled error.

An error thrown by an effect's **cleanup** (the function it returned, or an `onCleanup` registered during its run), before a re-run or on disposal, is routed the same way and never stops the re-run or the disposal. An owner that is being disposed does not handle errors (its handler would answer for a scope that is going away): those go to the next live owner up, else to `console.error`.

Cleanups run untracked: a signal read in a cleanup subscribes nothing, even when another effect's run is what disposed it.

A devtools hook that throws is reported to `console.error` and otherwise ignored; it cannot stop a flush or leave the graph half-updated.

## useEffect Timing

`useEffect` and `onMount` are **user-phase** effects of their component. Their first run does not happen in the component body: it waits for the flush that follows the component's creation (the microtask after the code that built it, the end of the outermost `batch()`, or, for a component a region builds during a flush, the user round of that same flush), and in that flush it comes after the render-phase effects, which are the DOM bindings. Re-runs of a `useEffect` are user-phase too. So both always see the DOM their own flush settled, including a binding created after them. That is still before paint, which differs from React:

| Framework | useEffect timing |
|-----------|-----------------|
| **What** | After the bindings of the same flush (microtask, before paint) |
| React | After paint (via requestAnimationFrame/scheduler) |
| Solid | After the render effects of the same flush |
| Svelte | After DOM update (tick) |

A component disposed before that flush never runs them. During a server render they do nothing. User-phase effects can also be created directly: `effect(fn, { phase: 'user' })` (its first run is synchronous, re-runs are user-phase).

**Migration (0.15):** `useEffect` used to create a render-phase effect on a microtask, and `onMount` callbacks ran on a microtask outside the reactive flush. Code that relied on a `useEffect` re-run seeing a binding's *previous* DOM now sees the updated DOM; code that called `flushSync()` right after mounting and expected `useEffect`/`onMount` not to have run yet now finds them run by that flush. An error thrown by `onMount` or by a `useEffect` run now reaches the nearest `<ErrorBoundary>` instead of only the console.

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

## Effects and Component Lifecycle

Components run once. A component is an owner: the effects, computeds, bindings, components and cleanups its body and its output create belong to it, and it belongs to the owner it is rendered under (the reactive region's run, list row, boundary arm or `mount()` root that built it), which disposes it when it lets the component go:

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

When the region that rendered `Timer` switches to other content, the run that built `Timer` is disposed, which disposes `Timer`'s owner and every effect it holds -- including the `insert()` effect for the `<span>` text and the `useEffect` with the interval cleanup. This holds whether the region built `Timer` on its first run or on a later one.

An effect owns what its run creates the same way: effects, computeds, roots and `onCleanup` callbacks created during a run are disposed before the effect runs again, and when it is disposed. A computed owns what its evaluation creates:

```js
effect(() => {
  if (!enabled()) return;
  const id = setInterval(poll, 1000);
  onCleanup(() => clearInterval(id));      // runs before the next run, and on disposal
  effect(() => console.log(status()));      // disposed before the next run
});
```

Owners (`createRoot`, components, effects, `getOwner()` / `runWithOwner()`) follow these rules:

- **A root whose function throws is disposed** before the error propagates: whatever it created so far is cleaned up, since the caller never received its disposer.
- **An owner that is already disposed disposes what it is given at once**: an effect created under it (through `runWithOwner`, say, after an `await`) runs its first run and is disposed right after, cleanup included; `onCleanup` runs the cleanup immediately; a root created under it is disposed when its function returns. A computed is not registered with it and behaves as an unowned computed. The same applies when an effect's first run disposes its own owner, and to work attached with `runWithOwner` to an effect's run that has since been superseded by a newer run.
- **What is created with no owner current belongs to no owner**: at module scope, or after an `await`. It lives until it is disposed explicitly. To attach work after an `await`, read `getOwner()` before it and create the work inside `runWithOwner(owner, ...)`. In development, an effect created after the `await` of an async `onMount` or `useEffect` callback with no owner current is reported as `ERR_ORPHAN_EFFECT`. During a server render with an async context provider, such work goes to the render's own root instead, and is released with the render.
- **Disposing an effect costs amortized O(1)**, also for a long-lived owner whose effects come and go: disposed entries are swept from the owner's list once they make up half of it.

Effects that return a function get automatic cleanup: the returned function runs before each re-execution and on final disposal:

```js
effect(() => {
  const handler = () => console.log('resize');
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler); // Cleanup
});
```

An effect that reads no signal on its first run, returns no cleanup and creates nothing can never run again, so it is released immediately: nothing keeps it alive. One that created something (an `onCleanup` included) stays registered with its owner, so what it created is disposed with that owner.
