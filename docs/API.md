# What Framework -- API Reference

## Table of Contents

- [Core (`what-framework`)](#core-what-framework)
  - [Reactive Primitives](#reactive-primitives)
  - [Virtual DOM](#virtual-dom)
  - [Fine-Grained Rendering Primitives](#fine-grained-rendering-primitives)
  - [Hooks](#hooks)
  - [Lifecycle Hooks](#lifecycle-hooks)
  - [Control Flow Components](#control-flow-components)
  - [Component Utilities](#component-utilities)
  - [Store](#store)
  - [Head Management](#head-management)
  - [Utilities](#utilities)
  - [DOM Scheduler](#dom-scheduler)
  - [Animation](#animation)
  - [Accessibility](#accessibility)
  - [Skeleton Loaders](#skeleton-loaders)
  - [Data Fetching](#data-fetching)
  - [Form Utilities](#form-utilities)
- [Router (`what-framework/router`)](#router-what-frameworkrouter)
- [Server (`what-framework/server`)](#server-what-frameworkserver)
- [Compiler (`what-compiler`)](#compiler-what-compiler)
- [Testing (`what-framework/testing`)](#testing-what-frameworktesting)

---

## Core (`what-framework`)

```js
import { signal, computed, effect, batch, untrack } from 'what-framework';
```

### Reactive Primitives

#### `signal(initialValue)`

Creates a reactive signal. Signals are the foundation of What Framework's reactivity system. Read by calling the signal as a function; write with `.set()`.

```js
import { signal } from 'what-framework';

const count = signal(0);
count();                   // read -> 0
count.set(5);              // write
count.set(c => c + 1);     // updater function
count.peek();              // read without tracking (no subscription)
count.subscribe(fn);       // subscribe to changes, returns unsubscribe fn
```

#### `computed(fn)`

Creates a derived signal. Lazy -- only recomputes when read after its dependencies change.

```js
import { computed } from 'what-framework';

const doubled = computed(() => count() * 2);
doubled();      // read
doubled.peek(); // read without tracking
```

#### `effect(fn)`

Runs `fn` immediately and re-runs it whenever any signal read inside changes. Returns a dispose function to stop the effect.

```js
import { effect } from 'what-framework';

const dispose = effect(() => {
  console.log('Count is:', count());
});
dispose(); // stop tracking
```

#### `batch(fn)`

Groups signal writes. Effects only run once at the end, not on every individual `.set()` call.

```js
import { batch } from 'what-framework';

batch(() => {
  a.set(1);
  b.set(2);
  // effects that read a or b run once here, not twice
});
```

#### `untrack(fn)`

Reads signals inside `fn` without creating a subscription. Useful inside effects when you want to read a value without triggering re-runs.

```js
import { untrack } from 'what-framework';

effect(() => {
  const val = untrack(() => someSignal());
  // this effect will NOT re-run when someSignal changes
});
```

#### `createRoot(fn)`

Creates an isolated reactive scope. All effects created inside are tracked and disposed together. Essential for per-item cleanup in reactive lists.

```js
import { createRoot } from 'what-framework';

const dispose = createRoot(dispose => {
  effect(() => console.log(count()));
  // dispose() cleans up all effects created in this scope
  return dispose;
});

dispose(); // all effects inside are cleaned up
```

#### `flushSync()`

Force all pending effects to run synchronously. Use sparingly — effects normally flush via microtask.

```js
import { flushSync } from 'what-framework';

count.set(5);
flushSync(); // effects that read count run NOW, not on next microtask
```

#### `signalMemo(fn)`

Eager computed that only propagates when the value actually changes. Unlike `computed` (lazy), `signalMemo` evaluates immediately. Unlike `effect`, it skips notifying subscribers when the recomputed value is the same.

```js
import { signalMemo } from 'what-framework';

// Only 2 of 1000 memos actually change — the other 998 skip notification
const isSelected = signalMemo(() => selected() === item.id);
```

---

### Virtual DOM

#### `h(tag, props, ...children)`

Creates a virtual DOM node. This is the hyperscript API and is the compilation target for JSX (when not using the compiler).

**h() syntax:**
```js
import { h } from 'what-framework';

h('div', { class: 'box' }, 'Hello')
h('input', { type: 'text', onInput: (e) => {} })
h(MyComponent, { name: 'World' })
```

**JSX syntax (with `what-compiler`):**
```jsx
<div class="box">Hello</div>
<input type="text" onInput={(e) => {}} />
<MyComponent name="World" />
```

**Props handling:**

| Prop | Behavior |
|------|----------|
| `class` / `className` | Sets `el.className` |
| `style` (string or object) | Sets `el.style` |
| `on*` | Event listeners (`onClick` becomes `click`) |
| `ref` | `ref.current = el` (object) or `ref(el)` (function) |
| `key` | Used for list reconciliation (stripped from props) |
| `dangerouslySetInnerHTML` | Sets `el.innerHTML` via `{ __html: '...' }` |
| `data-*`, `aria-*` | Set as attributes |
| Boolean `true` | Attribute present |
| Boolean `false` / `null` | Attribute removed |

#### `Fragment`

Renders children without a wrapper element.

**h() syntax:**
```js
import { Fragment } from 'what-framework';

h(Fragment, null, h('li', null, 'A'), h('li', null, 'B'))
```

**JSX syntax:**
```jsx
<>
  <li>A</li>
  <li>B</li>
</>
```

#### `html` (tagged template)

No-build alternative to JSX. Write HTML directly in template literals with interpolated values.

```js
import { html } from 'what-framework';

const vnode = html`<div class="box">${content}</div>`;
```

#### `mount(vnode, container)`

Mounts a VNode tree into a DOM element. Returns an unmount function.

**h() syntax:**
```js
import { mount, h } from 'what-framework';

const unmount = mount(h(App), '#app');
unmount(); // remove and clean up
```

**JSX syntax:**
```jsx
import { mount } from 'what-framework';

const unmount = mount(<App />, '#app');
unmount();
```

The `container` can be a CSS selector string or a DOM element.

---

### Fine-Grained Rendering Primitives

These primitives bypass the VDOM reconciler entirely. Components run once, signals create individual DOM effects. Used by the benchmark and compiler output for maximum performance.

```js
import { template, insert, mapArray, spread, delegateEvents, on, classList } from 'what-framework';
```

#### `template(html)`

Pre-parses an HTML string into a `<template>` element. Returns a factory function that clones the DOM tree via `cloneNode(true)` — 2-5x faster than `createElement` chains.

```js
const rowTmpl = template(
  '<tr><td class="col-md-1"></td><td class="col-md-4"><a></a></td></tr>'
);

const row = rowTmpl(); // fast clone
row.children[0].textContent = '1';
row.children[1].firstChild.textContent = 'Hello';
```

#### `insert(parent, child, marker?)`

Reactive child insertion. Handles all child types:

```js
// Static text
insert(el, 'Hello');

// Reactive text — creates a micro-effect that updates only this text node
insert(el, () => `Count: ${count()}`);

// DOM node
insert(el, someElement);

// Array
insert(el, [node1, node2, node3]);
```

When `child` is a function, `insert` creates an effect that updates only the associated text node when the signal changes — no diffing, no reconciliation.

#### `mapArray(source, mapFn, options?)`

Reactive list rendering with per-item scopes. The critical piece for benchmark-level performance.

```js
// Unkeyed: tracks items by reference
mapArray(
  () => data(),
  (item, index) => {
    const row = rowTmpl();
    row.children[0].textContent = item.id;
    return row;
  }
)(parent);

// Keyed with raw items (best for items with stable identity)
mapArray(
  () => data(),
  (item, index) => renderRow(item),
  { key: item => item.id, raw: true }
)(parent);

// Keyed with item signals (item accessor updates in place when data changes)
mapArray(
  () => data(),
  (itemAccessor, index) => {
    const row = rowTmpl();
    effect(() => { row.children[1].textContent = itemAccessor().label; });
    return row;
  },
  { key: item => item.id }
)(parent);
```

Each list item runs in its own `createRoot` — disposal is automatic when the item is removed.

#### `spread(el, props)`

Fine-grained prop effects. Function props create individual effects; event props use direct assignment.

```js
const el = document.createElement('div');
spread(el, {
  class: () => isActive() ? 'active' : '',  // reactive class
  onClick: handleClick,                       // event handler
  title: 'Static title',                      // static prop
});
```

#### `delegateEvents(eventNames)`

Event delegation: registers a single listener per event type on `document`. Handlers are stored as `el.$$click`, `el.$$input`, etc. Reduces listener count from N to 1.

```js
delegateEvents(['click', 'input']);

// Then assign handlers directly:
el.$$click = () => selectRow(id);
```

#### `on(el, event, handler)`

Non-delegated event listener helper. Returns a cleanup function.

```js
const cleanup = on(el, 'scroll', handleScroll);
cleanup(); // removes listener
```

#### `classList(el, classes)`

Reactive class toggling. Creates an effect that toggles classes based on signal values.

```js
classList(el, {
  active: () => isActive(),
  disabled: () => isDisabled(),
  'has-error': true,  // static
});
```

---

### Hooks

All hooks must be called inside a component function.

#### `useState(initial)`

Returns `[value, setter]`. The setter triggers a re-render of the component.

```js
import { useState } from 'what-framework';

const [value, setValue] = useState(0);
setValue(5);                // direct
setValue(prev => prev + 1); // updater
```

#### `useSignal(initial)`

Returns a raw signal. More efficient than `useState` because it avoids array allocation. Read with `sig()`, write with `sig.set()`.

```js
import { useSignal } from 'what-framework';

const count = useSignal(0);
count();       // read (triggers re-render)
count.set(5);  // write
```

#### `useComputed(fn)`

Creates a derived signal scoped to the component. Only recomputes when its signal dependencies change.

```js
import { useComputed } from 'what-framework';

const doubled = useComputed(() => count() * 2);
doubled(); // read
```

#### `useEffect(fn, deps)`

Runs a side effect after render. The function may return a cleanup function that runs before the next execution and on unmount.

```js
import { useEffect } from 'what-framework';

useEffect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id); // cleanup
}, [dependency]);

useEffect(() => { /* runs every render */ });
useEffect(() => { /* runs once */ }, []);
```

#### `useMemo(fn, deps)`

Memoizes a computed value. Only recomputes when `deps` change.

```js
import { useMemo } from 'what-framework';

const expensive = useMemo(() => computeValue(a, b), [a, b]);
```

#### `useCallback(fn, deps)`

Returns a memoized callback. Identity-stable when `deps` don't change.

```js
import { useCallback } from 'what-framework';

const handler = useCallback((e) => doStuff(e, dep), [dep]);
```

#### `useRef(initial)`

Returns a mutable ref object `{ current }`. Does NOT trigger re-renders on mutation.

**h() syntax:**
```js
import { useRef, h } from 'what-framework';

const ref = useRef(null);
h('input', { ref }); // ref.current = <input>
```

**JSX syntax:**
```jsx
const ref = useRef(null);
<input ref={ref} />
```

#### `useReducer(reducer, initialState, init?)`

State management with a reducer function, like React's `useReducer`.

```js
import { useReducer } from 'what-framework';

const [state, dispatch] = useReducer(
  (state, action) => {
    switch (action.type) {
      case 'inc': return { count: state.count + 1 };
      default: return state;
    }
  },
  { count: 0 }
);
dispatch({ type: 'inc' });
```

#### `createContext(defaultValue)` / `useContext(ctx)`

Create and consume context for passing data through the component tree without props.

**h() syntax:**
```js
import { createContext, useContext, h } from 'what-framework';

const ThemeCtx = createContext('light');

// Provider
h(ThemeCtx.Provider, { value: 'dark' }, children)

// Consumer
const theme = useContext(ThemeCtx);
```

**JSX syntax:**
```jsx
<ThemeCtx.Provider value="dark">
  {children}
</ThemeCtx.Provider>
```

**Important:** `useContext()` must be called during component render, not inside effects or event handlers. To use a context value in a callback, capture it during render:

```jsx
function MyComponent() {
  const theme = useContext(ThemeCtx); // Called during render

  useEffect(() => {
    // Use the captured theme value, not useContext() again
    console.log('Current theme:', theme);
  });

  return <button onClick={() => applyTheme(theme)}>Apply</button>;
}
```

In development mode, calling `useContext()` outside of component render will log a warning.

---

### Lifecycle Hooks

#### `onMount(fn)`

Runs a callback once when the component mounts. SolidJS-style lifecycle hook.

```js
import { onMount } from 'what-framework';

onMount(() => {
  console.log('Component mounted');
});
```

#### `onCleanup(fn)`

Registers a cleanup function to run when the component unmounts.

```js
import { onCleanup } from 'what-framework';

onCleanup(() => {
  console.log('Component unmounting');
});
```

#### `createResource(fetcher, options?)`

Reactive data fetching primitive (SolidJS-style). Returns `[data, { loading, error, refetch, mutate }]`.

```js
import { createResource } from 'what-framework';

const [data, { loading, error, refetch, mutate }] = createResource(
  (source) => fetch(`/api/user/${source}`).then(r => r.json()),
  { source: userId, initialValue: null }
);

data();       // reactive data value
loading();    // true/false
error();      // null or Error
refetch();    // re-fetch data
mutate(val);  // manually update data
```

---

### Control Flow Components

These components provide declarative control flow for rendering. When using the compiler (`what-compiler`), they are optimized into direct runtime calls.

#### `Show`

Conditional rendering. Cleaner than ternaries.

**h() syntax:**
```js
import { Show, h } from 'what-framework';

h(Show, { when: isLoggedIn, fallback: h(Login) }, h(Dashboard))
```

**JSX syntax:**
```jsx
<Show when={isLoggedIn()} fallback={<Login />}>
  <Dashboard />
</Show>
```

#### `For`

Efficient list rendering. Children must be a function `(item, index) => vnode`.

**h() syntax:**
```js
import { For, h } from 'what-framework';

h(For, { each: items, fallback: h('p', null, 'No items') },
  (item, index) => h('li', { key: item.id }, item.name)
)
```

**JSX syntax:**
```jsx
<For each={items()} fallback={<p>No items</p>}>
  {(item, index) => <li key={item.id}>{item.name}</li>}
</For>
```

#### `Switch` / `Match`

Multi-condition rendering (like a switch statement).

**h() syntax:**
```js
import { Switch, Match, h } from 'what-framework';

h(Switch, { fallback: h('p', null, 'Unknown') },
  h(Match, { when: status() === 'loading' }, h(Spinner)),
  h(Match, { when: status() === 'error' }, h(ErrorView)),
  h(Match, { when: status() === 'ready' }, h(Content)),
)
```

**JSX syntax:**
```jsx
<Switch fallback={<p>Unknown</p>}>
  <Match when={status() === 'loading'}><Spinner /></Match>
  <Match when={status() === 'error'}><ErrorView /></Match>
  <Match when={status() === 'ready'}><Content /></Match>
</Switch>
```

---

### Component Utilities

#### `memo(Component, areEqual?)`

Skips re-render if props haven't changed (shallow comparison by default).

```js
import { memo } from 'what-framework';

const MemoComp = memo(MyComponent);
const MemoComp = memo(MyComponent, (prev, next) => prev.id === next.id);
```

#### `lazy(loader)`

Code-split a component. Works with `Suspense` to show a fallback while loading.

**h() syntax:**
```js
import { lazy, Suspense, h } from 'what-framework';

const LazyPage = lazy(() => import('./pages/heavy.js'));
h(Suspense, { fallback: h('p', null, 'Loading...') }, h(LazyPage))
```

**JSX syntax:**
```jsx
const LazyPage = lazy(() => import('./pages/heavy.js'));

<Suspense fallback={<p>Loading...</p>}>
  <LazyPage />
</Suspense>
```

#### `Suspense({ fallback, children })`

Shows a fallback while lazy children are loading. Catches promises thrown by `lazy()` components.

#### `ErrorBoundary({ fallback, children, onError? })`

Catches errors thrown in child components and renders a fallback UI.

**h() syntax:**
```js
import { ErrorBoundary, h } from 'what-framework';

h(ErrorBoundary, {
  fallback: ({ error, reset }) => h('div', null,
    h('p', null, 'Error: ', error.message),
    h('button', { onClick: reset }, 'Retry')
  ),
  onError: (error) => logError(error),
}, h(RiskyComponent))
```

**JSX syntax:**
```jsx
<ErrorBoundary
  fallback={({ error, reset }) => (
    <div>
      <p>Error: {error.message}</p>
      <button onClick={reset}>Retry</button>
    </div>
  )}
  onError={(error) => logError(error)}
>
  <RiskyComponent />
</ErrorBoundary>
```

---

### Store

#### `createStore(definition)`

Creates a global store with state, computed properties, and actions. Returns a hook-like function that provides a reactive proxy when called inside a component.

Computed properties must be marked with `derived()` to distinguish them from actions. Actions use `this` (bound to the store proxy) to read and write state.

```js
import { createStore, derived } from 'what-framework';

const useCounter = createStore({
  count: 0,                                        // state
  doubled: derived(state => state.count * 2),      // computed
  increment() { this.count++; },                   // action (uses `this`)
  addAmount(n) { this.count += n; },               // action with params
});

// In a component:
function Counter() {
  const store = useCounter();
  // State/computed: access as properties (they're getters)
  store.count;    // 0
  store.doubled;  // 0
  // Actions: call directly
  store.increment();
  // Or destructure:
  const { count, doubled, increment } = useCounter();
}
```

#### `derived(fn)`

Marks a function as a computed property in a store definition. The function receives the store state as its first parameter. Without this marker, all functions are treated as actions.

```js
import { derived } from 'what-framework';

const useStore = createStore({
  items: [],
  count: derived(state => state.items.length),       // computed
  isEmpty: derived(state => state.items.length === 0), // computed
  addItem(item) { this.items = [...this.items, item]; }, // action
});
```

> **Note:** `storeComputed()` is a deprecated alias for `derived()`. Use `derived()` in new code.

---

### Head Management

#### `Head({ title, meta, link })`

Manages the document `<head>` declaratively. Sets `<title>`, `<meta>`, and `<link>` tags.

**h() syntax:**
```js
import { Head, h } from 'what-framework';

h(Head, {
  title: 'My Page',
  meta: [
    { name: 'description', content: 'A page' },
    { property: 'og:title', content: 'My Page' },
  ],
  link: [
    { rel: 'canonical', href: 'https://example.com' },
  ],
})
```

**JSX syntax:**
```jsx
<Head
  title="My Page"
  meta={[
    { name: 'description', content: 'A page' },
    { property: 'og:title', content: 'My Page' },
  ]}
  link={[
    { rel: 'canonical', href: 'https://example.com' },
  ]}
/>
```

#### `clearHead()`

Removes all head tags managed by `Head`.

---

### Utilities

#### `show(condition, vnode, fallback?)`

Functional conditional rendering helper.

```js
import { show } from 'what-framework';

show(isLoggedIn, h(Dashboard), h(Login))
```

#### `each(list, renderFn, keyFn?)`

Functional list rendering helper.

```js
import { each } from 'what-framework';

each(items, (item) => h('li', null, item.name), (item) => item.id)
```

#### `cls(...args)`

Utility for composing CSS class names. Accepts strings, booleans, and objects.

```js
import { cls } from 'what-framework';

cls('btn', isActive && 'active', { disabled, primary })
// -> 'btn active primary'
```

#### `debounce(fn, ms)` / `throttle(fn, ms)`

Standard debounce and throttle utilities.

```js
import { debounce, throttle } from 'what-framework';

const debouncedSearch = debounce((q) => search(q), 300);
const throttledScroll = throttle(onScroll, 100);
```

#### `useMediaQuery(query)`

Reactive media query signal. Returns a signal that tracks whether the query matches.

```js
import { useMediaQuery } from 'what-framework';

const isMobile = useMediaQuery('(max-width: 768px)');
isMobile(); // true/false, reactive
```

#### `useLocalStorage(key, initial)`

Signal backed by `localStorage`. Reads from and syncs to `localStorage` automatically.

```js
import { useLocalStorage } from 'what-framework';

const theme = useLocalStorage('theme', 'light');
theme();           // read from localStorage
theme.set('dark'); // syncs to localStorage
```

#### `Portal({ target, children })`

Renders children into a different DOM node, specified by a CSS selector.

**h() syntax:**
```js
import { Portal, h } from 'what-framework';

h(Portal, { target: '#modal-root' }, h(Modal))
```

**JSX syntax:**
```jsx
<Portal target="#modal-root">
  <Modal />
</Portal>
```

---

### DOM Scheduler

Prevents layout thrashing by batching DOM reads and writes into separate phases.

```js
import {
  scheduleRead, scheduleWrite, flushScheduler,
  measure, mutate, nextFrame,
  onResize, onIntersect, smoothScrollTo
} from 'what-framework';
```

#### `scheduleRead(fn)` / `scheduleWrite(fn)`

Queue DOM reads and writes. Reads execute first, writes execute after, preventing forced reflows.

```js
scheduleRead(() => {
  const height = element.offsetHeight;
});
scheduleWrite(() => {
  element.style.height = newHeight + 'px';
});
```

#### `flushScheduler()`

Force immediate execution of all queued read/write operations.

#### `measure(fn)` / `mutate(fn)`

Promise-based versions of `scheduleRead` and `scheduleWrite`.

```js
const width = await measure(() => el.offsetWidth);
await mutate(() => { el.style.width = '100px'; });
```

#### `nextFrame()`

Returns a promise that resolves on the next animation frame.

```js
await nextFrame();
// DOM has updated
```

#### `onResize(element, callback)`

Observes element resizing via `ResizeObserver`. Returns a cleanup function.

```js
const cleanup = onResize(el, ({ width, height }) => {
  console.log(width, height);
});
cleanup(); // stop observing
```

#### `onIntersect(element, callback, options?)`

Observes element intersection via `IntersectionObserver`. Returns a cleanup function.

```js
const cleanup = onIntersect(el, (isIntersecting) => {
  if (isIntersecting) loadMore();
});
cleanup(); // stop observing
```

#### `smoothScrollTo(target, options?)`

Smooth scroll to an element.

```js
smoothScrollTo('#section', { behavior: 'smooth', block: 'start' });
```

---

### Animation

```js
import { spring, tween, easings, useTransition, useGesture, createTransitionClasses } from 'what-framework';
```

#### `spring(initialValue, options?)`

Physics-based spring animation. Returns a reactive animated value.

```js
const x = spring(0, { stiffness: 100, damping: 10, mass: 1 });
x.set(100);        // animate to 100
x.current();       // current animated value
x.target();        // target value
x.velocity();      // current velocity
x.snap(50);        // immediately jump to 50 (no animation)
x.stop();          // stop animation
x.isAnimating();   // animation state
```

#### `tween(from, to, options?)`

Easing-based animation between two values.

```js
const t = tween(0, 100, {
  duration: 300,
  easing: easings.easeOutQuad,
  onUpdate: (value) => console.log(value),
  onComplete: () => console.log('done'),
});
t.value();     // current value
t.progress();  // 0-1 progress
t.cancel();    // stop animation
```

#### `easings`

Built-in easing functions for use with `tween`.

```js
easings.linear
easings.easeInQuad       easings.easeOutQuad       easings.easeInOutQuad
easings.easeInCubic      easings.easeOutCubic      easings.easeInOutCubic
easings.easeInElastic    easings.easeOutElastic
easings.easeOutBounce
// ... and more
```

#### `useTransition(options?)`

Animate between states within a component.

```js
const { isTransitioning, progress, start } = useTransition({ duration: 300 });
await start(() => setState(newState));
```

#### `useGesture(element, handlers)`

Handle touch/mouse gestures with a unified API.

```js
useGesture(ref, {
  onDrag: ({ x, y, deltaX, deltaY, velocity }) => {},
  onDragStart: ({ x, y }) => {},
  onDragEnd: ({ deltaX, deltaY, velocity }) => {},
  onSwipe: ({ direction, velocity }) => {},     // 'up' | 'down' | 'left' | 'right'
  onTap: ({ x, y }) => {},
  onLongPress: ({ x, y }) => {},
  onPinch: ({ scale, centerX, centerY }) => {},
});
```

#### `createTransitionClasses(name)`

Generate CSS transition class names following a naming convention.

```js
const classes = createTransitionClasses('fade');
// { enter, enterActive, enterDone, exit, exitActive, exitDone }
```

---

### Accessibility

```js
import {
  useFocus, useFocusTrap, FocusTrap,
  announce, announceAssertive,
  SkipLink, VisuallyHidden, LiveRegion,
  useAriaExpanded, useAriaSelected, useAriaChecked,
  useRovingTabIndex,
  useId, useIds, useDescribedBy, useLabelledBy,
  Keys, onKey, onKeys,
} from 'what-framework';
```

#### `useFocus()`

Track and manage focus state.

```js
const { current, focus, blur } = useFocus();
focus(element);
blur();
```

#### `useFocusTrap(containerRef)`

Keep keyboard focus within a container (for modals, dialogs, etc.).

```js
const trap = useFocusTrap(modalRef);
trap.activate();   // trap focus inside
trap.deactivate(); // restore previous focus
```

#### `FocusTrap({ children, active })`

Component wrapper for `useFocusTrap`.

**h() syntax:**
```js
h(FocusTrap, { active: isModalOpen }, h(Modal))
```

**JSX syntax:**
```jsx
<FocusTrap active={isModalOpen()}>
  <Modal />
</FocusTrap>
```

#### `announce(message, options?)` / `announceAssertive(message)`

Screen reader announcements via ARIA live regions.

```js
announce('Item added to cart');                    // polite
announceAssertive('Error: Please fill all fields'); // assertive
```

#### `SkipLink({ href, children })`

Accessible skip navigation link. Visually hidden until focused.

**h() syntax:**
```js
h(SkipLink, { href: '#main' }, 'Skip to content')
```

**JSX syntax:**
```jsx
<SkipLink href="#main">Skip to content</SkipLink>
```

#### `useAriaExpanded(initial?)` / `useAriaSelected(initial?)` / `useAriaChecked(initial?)`

ARIA state helpers that return correctly wired props objects.

```js
const { expanded, toggle, buttonProps, panelProps } = useAriaExpanded(false);

// h()
h('button', buttonProps(), 'Toggle');
h('div', panelProps(), content);

// JSX
<button {...buttonProps()}>Toggle</button>
<div {...panelProps()}>{content}</div>
```

#### `useRovingTabIndex(itemCount)`

Keyboard navigation for lists using the roving tabindex pattern. Supports arrow keys, Home, and End.

```js
const { focusIndex, getItemProps, containerProps } = useRovingTabIndex(items.length);

// h()
h('ul', containerProps(),
  items.map((item, i) => h('li', getItemProps(i), item.name))
)

// JSX
<ul {...containerProps()}>
  {items.map((item, i) => <li {...getItemProps(i)}>{item.name}</li>)}
</ul>
```

#### `VisuallyHidden({ children, as? })`

Hides content visually but keeps it accessible to screen readers.

```js
h(VisuallyHidden, null, 'Screen reader only text')
```

#### `LiveRegion({ children, priority?, atomic? })`

ARIA live region component for dynamic content announcements.

```js
h(LiveRegion, { priority: 'polite' }, statusMessage)
```

#### `useId(prefix?)` / `useIds(count, prefix?)`

Generate unique IDs for ARIA attributes, ensuring consistency between server and client.

```js
const getId = useId('input');
h('input', { id: getId() });

const [labelId, inputId] = useIds(2, 'field');
```

#### `useDescribedBy(description)` / `useLabelledBy(label)`

Associate ARIA descriptions and labels with elements.

```js
const { describedByProps, Description } = useDescribedBy('Help text here');
h('input', describedByProps());
h(Description);
```

#### `Keys`

Keyboard key constants for use in event handlers.

```js
Keys.Enter, Keys.Space, Keys.Escape, Keys.Tab,
Keys.ArrowUp, Keys.ArrowDown, Keys.ArrowLeft, Keys.ArrowRight,
Keys.Home, Keys.End
```

#### `onKey(key, handler)` / `onKeys(keys, handler)`

Create key-specific event handler wrappers.

**h() syntax:**
```js
h('input', { onKeyDown: onKey('Enter', submit) })
h('div', { onKeyDown: onKeys(['Enter', ' '], activate) })
```

**JSX syntax:**
```jsx
<input onKeyDown={onKey('Enter', submit)} />
<div onKeyDown={onKeys(['Enter', ' '], activate)} />
```

---

### Skeleton Loaders

```js
import {
  Skeleton, SkeletonText, SkeletonAvatar, SkeletonCard, SkeletonTable,
  IslandSkeleton, Placeholder, LoadingDots, Spinner, useSkeleton,
} from 'what-framework';
```

#### `Skeleton({ width, height, variant?, circle?, count? })`

Base skeleton loading placeholder. Renders a shimmer/pulse/wave animation.

```js
h(Skeleton, { width: 200, height: 20, variant: 'shimmer' })
h(Skeleton, { width: 50, height: 50, circle: true })
h(Skeleton, { count: 3 }) // renders 3 skeletons
```

Variants: `'shimmer'` (default), `'pulse'`, `'wave'`

#### `SkeletonText({ lines?, lastLineWidth?, variant? })`

Multi-line text skeleton.

```js
h(SkeletonText, { lines: 4 })
```

#### `SkeletonAvatar({ size?, variant? })`

Circular avatar skeleton.

```js
h(SkeletonAvatar, { size: 48 })
```

#### `SkeletonCard({ imageHeight?, lines?, variant? })`

Card layout skeleton with an image area and text lines.

```js
h(SkeletonCard, { imageHeight: 200, lines: 3 })
```

#### `SkeletonTable({ rows?, columns?, variant? })`

Table skeleton with configurable rows and columns.

```js
h(SkeletonTable, { rows: 5, columns: 4 })
```

#### `IslandSkeleton({ type?, height? })`

Skeleton specifically for island hydration placeholders.

```js
h(IslandSkeleton, { type: 'card' })  // 'default' | 'card' | 'text'
```

#### `Placeholder({ width?, height?, label?, showLabel?, variant? })`

Generic placeholder box with an optional label.

```js
h(Placeholder, { height: 200, label: 'Loading...' })
```

#### `LoadingDots({ size?, color? })`

Animated loading dots indicator.

```js
h(LoadingDots, { size: 8, color: '#666' })
```

#### `Spinner({ size?, color?, strokeWidth? })`

Spinning loading indicator (SVG-based).

```js
h(Spinner, { size: 24, color: '#666' })
```

#### `useSkeleton(asyncFn)`

Hook that returns loading state and a skeleton component tied to an async operation.

```js
const { isLoading, data, error, Skeleton } = useSkeleton(() => fetchData());
if (isLoading()) return h(Skeleton, { height: 100 });
return h('div', null, data());
```

---

### Data Fetching

```js
import {
  useFetch, useSWR, useQuery, useInfiniteQuery,
  invalidateQueries, prefetchQuery, setQueryData, getQueryData, clearCache,
} from 'what-framework';
```

#### `useFetch(url, options?)`

Simple fetch wrapper with auto-parsing and reactive state.

```js
const { data, error, isLoading, refetch, mutate } = useFetch('/api/user', {
  method: 'GET',
  headers: {},
  transform: (data) => data,
  initialData: null,
});
```

#### `useSWR(key, fetcher, options?)`

Stale-while-revalidate data fetching pattern.

```js
const { data, error, isLoading, isValidating, mutate, revalidate } = useSWR(
  'user-data',
  (key) => fetch('/api/user').then(r => r.json()),
  {
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    refreshInterval: 0,
    dedupingInterval: 2000,
    fallbackData: null,
    onSuccess: (data, key) => {},
    onError: (error, key) => {},
  }
);
```

#### `useQuery(options)`

TanStack Query-like API for complex data fetching with caching, retries, and refetching.

```js
const {
  data, error, status,
  isLoading, isError, isSuccess, isFetching,
  refetch,
} = useQuery({
  queryKey: ['todos', userId],
  queryFn: ({ queryKey }) => fetchTodos(queryKey[1]),
  enabled: true,
  staleTime: 0,
  cacheTime: 5 * 60 * 1000,
  refetchOnWindowFocus: true,
  refetchInterval: false,
  retry: 3,
  retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
  onSuccess: (data) => {},
  onError: (error) => {},
  onSettled: (data, error) => {},
  select: (data) => data,
  placeholderData: null,
});
```

#### `useInfiniteQuery(options)`

Paginated/infinite scroll data fetching.

```js
const {
  data, hasNextPage, hasPreviousPage,
  isFetchingNextPage, fetchNextPage, fetchPreviousPage,
  refetch,
} = useInfiniteQuery({
  queryKey: ['posts'],
  queryFn: ({ pageParam }) => fetchPosts(pageParam),
  getNextPageParam: (lastPage) => lastPage.nextCursor,
  getPreviousPageParam: (firstPage) => firstPage.prevCursor,
  initialPageParam: 0,
});

// data().pages = [...], data().pageParams = [...]
```

**Notes:**
- Page fetches are **sequential**, not parallel. Calling `fetchNextPage` while a fetch is in flight aborts the previous request.
- `refetch()` keeps existing pages visible while re-fetching the first page (SWR pattern — no flash of empty state).
- The `queryFn` receives `{ signal }` for abort support. Pass it to your fetch call:

```js
queryFn: ({ pageParam, signal }) => fetch(`/api/posts?cursor=${pageParam}`, { signal }).then(r => r.json()),
```

#### Cache Management

```js
invalidateQueries('user-data');                       // invalidate specific key
invalidateQueries((key) => key.startsWith('user'));   // invalidate by predicate
prefetchQuery('user', fetcher);                       // prefetch into cache
setQueryData('user', data);                           // set cache manually
setQueryData('user', (prev) => ({ ...prev }));        // updater function
getQueryData('user');                                 // read from cache
clearCache();                                         // clear all cached data
```

---

### Form Utilities

```js
import {
  useForm, useField,
  rules, simpleResolver, zodResolver, yupResolver,
  Input, Textarea, Select, Checkbox, Radio, ErrorMessage,
} from 'what-framework';
```

#### `useForm(options?)`

Full-featured form management with validation, dirty tracking, and submission handling.

```js
const {
  register,
  handleSubmit,
  setValue,
  getValue,
  setError,
  clearError,
  clearErrors,
  reset,
  watch,
  validate,
  formState: {
    values, errors, touched, isDirty, isValid,
    isSubmitting, isSubmitted, submitCount, dirtyFields,
  },
} = useForm({
  defaultValues: { email: '', password: '' },
  mode: 'onSubmit',          // 'onSubmit' | 'onChange' | 'onBlur'
  reValidateMode: 'onChange',
  resolver: zodResolver(schema),
});
```

**h() syntax:**
```js
h('form', { onSubmit: handleSubmit(onValid, onInvalid) },
  h('input', { ...register('email') }),
  show(formState.errors().email,
    h('span', null, formState.errors().email?.message)
  ),
  h('button', { type: 'submit' }, 'Submit'),
)
```

**JSX syntax:**
```jsx
<form onSubmit={handleSubmit(onValid, onInvalid)}>
  <input {...register('email')} />
  <Show when={formState.errors().email}>
    <span>{formState.errors().email?.message}</span>
  </Show>
  <button type="submit">Submit</button>
</form>
```

#### `useField(name, options?)`

Individual field control for custom field components.

```js
const field = useField('email', {
  defaultValue: '',
  validate: (value) => !value ? 'Required' : null,
});

h('input', field.inputProps());
show(field.error(), h('span', null, field.error()));
```

#### Validation Rules

Built-in validation rules for use with `simpleResolver`.

```js
import { rules, simpleResolver } from 'what-framework';

const resolver = simpleResolver({
  email: [rules.required(), rules.email()],
  password: [rules.required(), rules.minLength(8)],
  confirmPassword: [rules.match('password', 'Passwords must match')],
});
```

Available rules:

| Rule | Description |
|------|-------------|
| `rules.required(message?)` | Field must not be empty |
| `rules.minLength(min, message?)` | Minimum string length |
| `rules.maxLength(max, message?)` | Maximum string length |
| `rules.min(min, message?)` | Minimum numeric value |
| `rules.max(max, message?)` | Maximum numeric value |
| `rules.pattern(regex, message?)` | Must match regex |
| `rules.email(message?)` | Must be valid email |
| `rules.url(message?)` | Must be valid URL |
| `rules.match(field, message?)` | Must match another field |
| `rules.custom(validator)` | Custom validation function |

#### Resolvers

Integrate with external validation libraries.

```js
import { zodResolver, yupResolver } from 'what-framework';

// With Zod
const resolver = zodResolver(z.object({
  email: z.string().email(),
  password: z.string().min(8),
}));

// With Yup
const resolver = yupResolver(yup.object({
  email: yup.string().email().required(),
}));
```

#### Form Components

Pre-built form components that integrate with `useForm`.

```js
import { Input, Textarea, Select, Checkbox, Radio, ErrorMessage } from 'what-framework';

h(Input, { register, name: 'email', error: errors().email })
h(Textarea, { register, name: 'bio' })
h(Select, { register, name: 'country' }, options)
h(Checkbox, { register, name: 'terms' })
h(Radio, { register, name: 'plan', value: 'pro' })
h(ErrorMessage, { name: 'email', errors })
```

---

## Router (`what-framework/router`)

```js
import {
  Router, Link, NavLink, Redirect, Outlet,
  navigate, route, prefetch,
  guard, asyncGuard,
  defineRoutes, nestedRoutes, routeGroup,
  useRoute, enableScrollRestoration,
  viewTransitionName, setViewTransition,
} from 'what-framework/router';
```

### `Router({ routes, fallback, globalLayout? })`

The root router component. Matches the current URL against a list of route definitions and renders the matching component.

**h() syntax:**
```js
h(Router, {
  routes: [
    { path: '/', component: Home },
    { path: '/about', component: About },
    { path: '/users/:id', component: User },
    { path: '/blog/*', component: BlogLayout },
  ],
  fallback: NotFound,
  globalLayout: RootLayout,
})
```

**JSX syntax:**
```jsx
<Router
  routes={[
    { path: '/', component: Home },
    { path: '/about', component: About },
    { path: '/users/:id', component: User },
    { path: '/blog/*', component: BlogLayout },
  ]}
  fallback={NotFound}
  globalLayout={RootLayout}
/>
```

### Route Definition

A route object supports these properties:

| Property | Description |
|----------|-------------|
| `path` | URL pattern (supports `:param`, `*` catch-all, `[param]` file-based syntax) |
| `component` | Component to render |
| `layout` | Layout wrapper component |
| `loading` | Component shown during navigation |
| `error` | Component shown on route errors |
| `children` | Nested route definitions |
| `middleware` | Array of middleware functions |

### `Link({ href, replace?, children, prefetch?, activeClass?, exactActiveClass?, transition? })`

Client-side navigation link. Intercepts clicks and uses `navigate()` instead of full page load. Adds `active` and `exact-active` classes automatically.

**h() syntax:**
```js
h(Link, { href: '/about' }, 'About')
h(Link, { href: '/login', replace: true }, 'Login')
```

**JSX syntax:**
```jsx
<Link href="/about">About</Link>
<Link href="/login" replace>Login</Link>
```

`Link` props:
- `prefetch` (default: `true`) -- prefetch the link target on hover
- `activeClass` (default: `'active'`) -- class added when route matches (prefix)
- `exactActiveClass` (default: `'exact-active'`) -- class added on exact match
- `transition` (default: `true`) -- use View Transitions API

### `navigate(to, opts?)`

Programmatic navigation.

```js
navigate('/dashboard');
navigate('/login', { replace: true });
navigate('/home', { transition: true });      // View Transitions API (default)
navigate('/page', { state: { from: '/' } });  // history state
```

### `route`

Reactive route state object. All properties are signal-backed and reactive.

```js
route.path;          // current path string
route.params;        // { id: '123' } -- dynamic params
route.query;         // { page: '1' } -- query params
route.hash;          // '#section'
route.isNavigating;  // true during navigation
route.error;         // navigation error or null
```

### `useRoute()`

Hook that returns computed signals for route state, plus navigation functions.

```js
const { path, params, query, hash, isNavigating, navigate, prefetch } = useRoute();
path();   // reactive current path
params(); // reactive params
```

### Nested Layouts

Routes can specify a layout wrapper and can be nested.

```js
const routes = [
  {
    path: '/dashboard',
    component: DashboardLayout,
    children: [
      { path: '', component: DashboardHome },
      { path: 'settings', component: Settings },
    ],
  },
];
```

### Route Groups

Group routes under a shared layout without affecting the URL structure.

```js
const routes = routeGroup('auth', [
  { path: '/login', component: Login },
  { path: '/register', component: Register },
], {
  layout: AuthLayout,
  middleware: [requireGuest],
});
```

### `defineRoutes(config)`

Convenience helper to define routes from a flat object.

```js
const routes = defineRoutes({
  '/': Home,
  '/about': About,
  '/users/:id': { component: User, layout: UserLayout },
});
```

### `nestedRoutes(basePath, children, options?)`

Helper for defining nested routes under a common base path.

```js
const routes = nestedRoutes('/dashboard', [
  { path: '', component: DashboardHome },
  { path: '/settings', component: Settings },
], { layout: DashboardLayout });
```

### `guard(check, fallback)`

Route guard / middleware. Wraps a component to conditionally allow rendering.

```js
const requireAuth = guard(
  () => isAuthenticated(),
  '/login'  // redirect path, or a component
);

// Apply to route
{ path: '/admin', component: requireAuth(AdminPage) }
```

### `asyncGuard(check, options?)`

Async route guard with loading state support.

```js
const requireAdmin = asyncGuard(
  async (props) => {
    const user = await fetchUser();
    return user.isAdmin;
  },
  { fallback: '/unauthorized', loading: LoadingPage }
);
```

### `Redirect({ to })`

Component that immediately redirects to another route.

```js
h(Redirect, { to: '/login' })
```

### `Outlet({ children })`

For nested route rendering in layout components. Renders the matched child route.

```js
function DashboardLayout({ children }) {
  return h('div', { class: 'dashboard' },
    h('nav', null, /* sidebar */),
    h(Outlet, null, children)
  );
}
```

### `prefetch(href)`

Hint the browser to prefetch a route's assets (adds a `<link rel="prefetch">` tag).

```js
prefetch('/heavy-page');
```

### View Transitions

The router uses the View Transitions API by default for smooth page transitions.

```js
navigate('/new-page', { transition: true });

// Name elements for cross-page transitions
h('img', { ...viewTransitionName('hero-image'), src: '...' })

// Set transition type
setViewTransition('slide');
```

### `enableScrollRestoration()`

Enable automatic scroll position saving and restoration across navigations.

```js
enableScrollRestoration();
```

---

## Server (`what-framework/server`)

```js
import {
  renderToString, renderToStream,
  definePage, generateStaticPage,
  server,
  island, Island,
  createIslandStore, useIslandStore,
  hydrateIslands, autoIslands,
  action, formAction, useAction, useFormAction,
  useOptimistic, useMutation,
  invalidatePath, onRevalidate,
} from 'what-framework/server';
```

### Server-Side Rendering

#### `renderToString(vnode)`

Renders a VNode tree to an HTML string. Handles components, elements, text, and arrays.

```js
import { renderToString } from 'what-framework/server';
import { h } from 'what-framework';

const html = renderToString(h(App));
```

#### `renderToStream(vnode)`

Returns an async iterator for streaming SSR. Supports async components.

```js
import { renderToStream } from 'what-framework/server';

for await (const chunk of renderToStream(h(App))) {
  response.write(chunk);
}
```

#### `definePage(config)`

Declare per-page rendering mode.

```js
import { definePage } from 'what-framework/server';

export const page = definePage({
  mode: 'static',  // 'static' | 'server' | 'client' | 'hybrid'
  prerender: true,
});
```

| Mode | Description |
|------|-------------|
| `'static'` | Pre-rendered at build time (default). Zero runtime JS. |
| `'server'` | Rendered on each request. |
| `'client'` | Rendered in the browser (SPA mode). |
| `'hybrid'` | Static shell with interactive islands. |

#### `generateStaticPage(page, data?)`

Generates a full static HTML document for a page, including document shell, meta tags, and island hydration scripts.

```js
import { generateStaticPage } from 'what-framework/server';

const html = generateStaticPage({
  component: HomePage,
  title: 'Home',
  meta: { description: 'Welcome' },
  mode: 'hybrid',
  islands: ['cart', 'search'],
});
```

#### `server(Component)`

Mark a component as server-only. It renders on the server and sends HTML to the client. Zero client JS is shipped.

```js
import { server } from 'what-framework/server';

const Header = server(({ title }) => h('header', null, title));
```

### Islands Architecture

The islands architecture allows you to ship mostly static HTML while selectively hydrating interactive components. Each "island" is a self-contained interactive component that hydrates independently.

#### `island(name, loader, opts?)`

Register an island component for client-side hydration.

```js
import { island } from 'what-framework/server';

island('cart', () => import('./islands/cart.js'), {
  mode: 'visible',
  priority: 10,
  stores: ['cart'],
});
```

Options:
- `mode` -- hydration strategy (see table below)
- `media` -- media query string (for `'media'` mode)
- `priority` -- higher values hydrate first (default: `0`)
- `stores` -- array of shared store names this island uses

#### Island Hydration Modes

| Mode | Description |
|------|-------------|
| `'load'` | Hydrate immediately on page load |
| `'idle'` | Hydrate when the browser is idle (`requestIdleCallback`) |
| `'visible'` | Hydrate when scrolled into view (`IntersectionObserver`, 200px margin) |
| `'action'` | Hydrate on first user interaction (click, focus, hover, touch) |
| `'media'` | Hydrate when a media query matches |
| `'static'` | Never hydrate -- pure HTML, no client JS |

#### `Island({ name, props?, mode?, priority?, stores? })`

Server-side component that renders a placeholder `<div>` with `data-*` attributes for client-side hydration.

**h() syntax:**
```js
import { Island } from 'what-framework/server';

h(Island, { name: 'cart', props: { items: [] } })
```

**JSX syntax:**
```jsx
<Island name="cart" props={{ items: [] }} />
```

#### `hydrateIslands()`

Client-side function. Discovers all `[data-island]` elements on the page and schedules hydration based on their mode and priority. Also hydrates shared stores from SSR data.

```js
import { hydrateIslands } from 'what-framework/server';

hydrateIslands();
```

#### `autoIslands(registry)`

Registers multiple islands from a registry object, then automatically calls `hydrateIslands()` when the DOM is ready.

```js
import { autoIslands } from 'what-framework/server';

autoIslands({
  cart: { loader: () => import('./islands/cart.js'), mode: 'visible' },
  search: { loader: () => import('./islands/search.js'), mode: 'idle' },
  header: { loader: () => import('./islands/header.js'), mode: 'load' },
});
```

#### Shared Island State

Islands can share reactive state through named stores, persisted across islands and page navigations.

```js
import { createIslandStore, useIslandStore } from 'what-framework/server';

// Create a shared store (usually at module level)
const cartStore = createIslandStore('cart', { items: [], total: 0 });

// Access from any island
const store = useIslandStore('cart');
store.items;           // read (reactive)
store.items = [...];   // write (triggers updates)
store._batch(() => {   // batch multiple writes
  store.items = newItems;
  store.total = newTotal;
});
store._getSnapshot();  // non-reactive snapshot
```

For SSR:
```js
import { serializeIslandStores, hydrateIslandStores } from 'what-framework/server';

// On server: serialize stores into HTML
const json = serializeIslandStores();

// On client: restore stores from SSR data
hydrateIslandStores(json);
```

### Server Actions

Call server-side functions from client code seamlessly. On the server, the function runs directly. On the client, it makes a `fetch` POST to `/__what_action`.

#### `action(fn, options?)`

Define a server action.

```js
import { action } from 'what-framework/server';

const saveUser = action(async (data) => {
  const user = await db.users.create(data);
  return { success: true, id: user.id };
}, {
  id: 'saveUser',
  onSuccess: (result) => console.log('Saved:', result),
  onError: (error) => console.error(error),
  revalidate: ['/users'],  // paths to revalidate after success
});

// Call from client
const result = await saveUser({ name: 'John' });
```

#### `formAction(actionFn, options?)`

Wraps a server action for form submissions. Converts `FormData` to a plain object and calls the action.

```js
import { formAction } from 'what-framework/server';

const handleSubmit = formAction(saveUser, {
  onSuccess: (result, form) => { /* ... */ },
  onError: (error, form) => { /* ... */ },
  resetOnSuccess: true,
});

// Use as form handler
h('form', { onSubmit: handleSubmit }, /* ... */)
```

#### `useAction(actionFn)`

Hook that returns reactive state for a server action call.

```js
import { useAction } from 'what-framework/server';

const { trigger, isPending, error, data, reset } = useAction(saveUser);

await trigger({ name: 'John' });
isPending(); // true while request is in flight
error();     // null or Error
data();      // result data
reset();     // clear error and data
```

#### `useFormAction(actionFn, options?)`

Combines `useAction` with form handling. Returns `handleSubmit` for use on `<form>` elements.

```js
import { useFormAction } from 'what-framework/server';

const { handleSubmit, isPending, error, data } = useFormAction(saveUser, {
  resetOnSuccess: true,
});

// h()
h('form', { onSubmit: handleSubmit },
  h('input', { name: 'email' }),
  h('button', { type: 'submit', disabled: isPending() }, 'Save'),
)

// JSX
<form onSubmit={handleSubmit}>
  <input name="email" />
  <button type="submit" disabled={isPending()}>Save</button>
</form>
```

#### `useOptimistic(initialValue, reducer)`

Optimistic UI updates. Apply changes immediately and roll back on failure.

```js
import { useOptimistic } from 'what-framework/server';

const { value, isPending, addOptimistic, resolve, rollback, set } = useOptimistic(
  [],  // initial value (e.g., list of items)
  (currentItems, newItem) => [...currentItems, newItem]  // reducer
);

// Optimistic add
const action = { id: 'temp', name: 'New Item' };
addOptimistic(action);

try {
  const savedItem = await saveItem(action);
  resolve(action);
  set(items => items.map(i => i.id === 'temp' ? savedItem : i));
} catch (e) {
  rollback(action, originalItems);
}
```

#### `useMutation(mutationFn, options?)`

Simple mutation helper with state tracking.

```js
import { useMutation } from 'what-framework/server';

const { mutate, isPending, error, data, reset } = useMutation(
  (data) => fetch('/api/save', { method: 'POST', body: JSON.stringify(data) }),
  {
    onSuccess: (result) => { /* ... */ },
    onError: (error) => { /* ... */ },
    onSettled: (data, error) => { /* ... */ },
  }
);

await mutate({ name: 'John' });
```

#### `invalidatePath(path)` / `onRevalidate(path, callback)`

Path-based revalidation. Register callbacks and trigger them when data at a path becomes stale.

```js
import { onRevalidate, invalidatePath } from 'what-framework/server';

// Register a revalidation callback
const unsubscribe = onRevalidate('/users', () => {
  refetchUsers();
});

// Trigger revalidation (e.g., after a mutation)
invalidatePath('/users');
```

#### `handleActionRequest(req, actionId, args)`

Server-side middleware for handling action requests. Returns `{ status, body }`.

```js
import { handleActionRequest } from 'what-framework/server';

// In your server middleware
app.post('/__what_action', async (req, res) => {
  const actionId = req.headers['x-what-action'];
  const { args } = req.body;
  const result = await handleActionRequest(req, actionId, args);
  res.status(result.status).json(result.body);
});
```

---

## Compiler (`what-compiler`)

The What compiler transforms JSX into `h()` calls that flow through the core VNode reconciler -- one unified rendering path. It provides event modifiers, two-way binding, and island directives as compile-time conveniences on top of the standard `h()` API.

### Installation

```bash
npm install what-compiler
```

### Babel Plugin

```js
// babel.config.js
import whatBabelPlugin from 'what-compiler/babel';

export default {
  plugins: [whatBabelPlugin],
  parserOpts: {
    plugins: ['jsx']
  }
};
```

### Vite Plugin

```js
// vite.config.js
import whatVitePlugin from 'what-compiler/vite';

export default {
  plugins: [whatVitePlugin({
    include: /\.[jt]sx$/,     // file extensions to process (default)
    exclude: /node_modules/,  // files to skip (default)
    sourceMaps: true,         // enable source maps (default)
    production: false,        // production optimizations (auto-detected from NODE_ENV)
  })],
};
```

The Vite plugin automatically:
- Transforms JSX files (`.jsx` and `.tsx`) into `h()` calls via the Babel plugin
- Preserves JSX for the What Babel plugin (disables esbuild JSX handling)
- Pre-bundles `what-framework` for fast development

---

### JSX Transformation

The compiler transforms JSX into `h()` calls. All rendering -- JSX and hand-written `h()` -- goes through the same VNode reconciler.

**Input (JSX):**
```jsx
function Counter() {
  const count = signal(0);
  return (
    <div class="counter">
      <p>Count: {count()}</p>
      <button onClick={() => count.set(c => c + 1)}>+1</button>
    </div>
  );
}
```

**Output (compiled):**
```js
import { h } from 'what-core';

function Counter() {
  const count = signal(0);
  return h('div', { class: 'counter' },
    h('p', null, 'Count: ', count()),
    h('button', { onClick: () => count.set(c => c + 1) }, '+1'),
  );
}
```

---

### Expressions in JSX

JSX expressions are passed through directly as children or prop values to `h()`. The VNode reconciler handles rendering them. Reactivity works through component re-rendering -- when signals read inside a component change, the component's render effect re-runs.

```jsx
const count = signal(0);
const name = signal('World');

// These are passed through as-is:
<p>{count()}</p>              // value passed as child to h()
<p>{name()}</p>               // value passed as child to h()
<p class={dynamicClass()}>    // value passed as prop to h()
```

For reactive updates, the component re-renders when signals change (the reconciler's effect tracks signal reads).

---

### Event Modifiers

Event handlers support pipe-separated modifiers that are applied at compile time:

```jsx
// Calls e.preventDefault() before your handler
<form onSubmit|preventDefault={handleSubmit}>

// Calls e.stopPropagation() before your handler
<div onClick|stopPropagation={handleClick}>

// Only fires if e.target === e.currentTarget
<div onClick|self={handleClick}>

// addEventListener with { once: true }
<button onClick|once={handleClick}>

// addEventListener with { capture: true }
<div onClick|capture={handleClick}>

// addEventListener with { passive: true }
<div onScroll|passive={handleScroll}>

// Multiple modifiers can be combined
<form onSubmit|preventDefault|stopPropagation={handleSubmit}>
```

| Modifier | Effect |
|----------|--------|
| `preventDefault` | Calls `e.preventDefault()` before the handler |
| `stopPropagation` | Calls `e.stopPropagation()` before the handler |
| `self` | Only fires when `e.target === e.currentTarget` |
| `once` | Listener is removed after first invocation |
| `capture` | Uses capture phase (`addEventListener` option) |
| `passive` | Marks as passive listener (`addEventListener` option) |

---

### Two-Way Binding

The `bind:` directive creates two-way data binding between a signal and a form element.

```jsx
const name = signal('');
const agreed = signal(false);

// Text input: syncs signal <-> input value
<input type="text" bind:value={name} />

// Checkbox: syncs signal <-> checked state
<input type="checkbox" bind:checked={agreed} />
```

The compiler transforms `bind:` directives into normal props at compile time:

- `bind:value={signal}` compiles to `{ value: signal(), onInput: (e) => signal.set(e.target.value) }`
- `bind:checked={signal}` compiles to `{ checked: signal(), onChange: (e) => signal.set(e.target.checked) }`

This means `bind:` is purely a compile-time convenience -- it produces standard `h()` props:

```jsx
// bind:value={name} compiles to:
h('input', { value: name(), onInput: (e) => name.set(e.target.value) })
```

---

### Island Directives (JSX)

When using the compiler, you can declare island hydration strategies directly in JSX with `client:*` directives:

```jsx
// Hydrate immediately on page load
<Cart client:load items={items} />

// Hydrate when the browser is idle
<Sidebar client:idle />

// Hydrate when scrolled into view
<Comments client:visible postId={post.id} />

// Hydrate on first user interaction (click, focus, hover)
<SearchBox client:interaction />

// Hydrate when a media query matches
<MobileMenu client:media="(max-width: 768px)" />
```

The compiler transforms `client:*` directives into `h(Island, ...)` calls:

```js
// <Cart client:load items={items} />
// compiles to:
h(Island, { component: Cart, mode: 'load', items: items })

// <MobileMenu client:media="(max-width: 768px)" />
// compiles to:
h(Island, { component: MobileMenu, mode: 'media', mediaQuery: '(max-width: 768px)' })
```

The `Island` component is part of `what-core` and handles deferred hydration through the normal VNode reconciler.

| Directive | Hydration Trigger |
|-----------|-------------------|
| `client:load` | Immediately |
| `client:idle` | `requestIdleCallback` |
| `client:visible` | `IntersectionObserver` |
| `client:interaction` | Click, focus, or mouseenter |
| `client:media="(query)"` | When media query matches |

---

### Control Flow Components

Control flow components (`Show`, `For`, `Switch`, `Match`) are rendered as normal components through the VNode reconciler:

```jsx
// <Show> compiles to h(Show, { when: condition() }, h(Content, null))
<Show when={condition()}>
  <Content />
</Show>

// <For> compiles to h(For, { each: items() }, renderFn)
<For each={items()}>
  {(item) => <li>{item.name}</li>}
</For>

// <Switch>/<Match> compile to normal h() calls
<Switch>
  <Match when={a()}>A</Match>
  <Match when={b()}>B</Match>
</Switch>
```

All control flow goes through the same reconciler as regular components -- no special runtime needed.

---

### SVG Support

The core DOM reconciler automatically detects SVG elements and uses `document.createElementNS` with the correct SVG namespace. No special syntax or compiler support is needed -- SVG works identically whether you use JSX or `h()` directly.

```jsx
<svg width="100" height="100">
  <circle cx="50" cy="50" r={radius()} fill="blue" />
  <path d={pathData()} stroke="red" />
</svg>
```

Recognized SVG elements: `svg`, `path`, `circle`, `rect`, `line`, `polyline`, `polygon`, `ellipse`, `g`, `defs`, `use`, `symbol`, `clipPath`, `mask`, `pattern`, `image`, `text`, `tspan`, `textPath`, `foreignObject`, `linearGradient`, `radialGradient`, `stop`

---

### Compiler Output

The compiler outputs calls to these functions, automatically imported from `what-core`:

| Function | Purpose |
|----------|---------|
| `h(tag, props, ...children)` | Create a VNode (element, component, or fragment) |
| `Fragment` | Fragment component for `<>...</>` syntax |
| `Island` | Island component for `client:*` directives |

All rendering goes through the VNode reconciler in `what-core/dom.js`. There is no separate compiler runtime.

---

## Testing (`what-framework/testing`)

```js
import {
  render, fireEvent, cleanup,
  waitFor, waitForElementToBeRemoved, act,
  createTestSignal, mockComponent,
  expect,
} from 'what-framework/testing';
```

### `render(vnode, options?)`

Renders a VNode into a test container and returns query utilities.

**h() syntax:**
```js
const { container, getByText, getByTestId, unmount } = render(h(Counter));
```

**JSX syntax:**
```jsx
const { container, getByText, getByTestId, unmount } = render(<Counter />);
```

### Query Methods

```js
getByText('Hello')           // exact text match
getByText(/hello/i)          // regex match
getByTestId('submit-btn')    // by data-testid
getByRole('button')          // by ARIA role
getAllByText('Item')          // returns array
queryByText('Hello')         // returns null if not found (no throw)
findByText('Hello')          // async, waits for element to appear
```

### `fireEvent`

Simulate DOM events in tests.

```js
fireEvent.click(button);
fireEvent.change(input, 'new value');
fireEvent.input(input, 'typing');
fireEvent.submit(form);
fireEvent.focus(element);
fireEvent.blur(element);
fireEvent.keyDown(element, 'Enter');
fireEvent.keyUp(element, 'Escape', { ctrlKey: true });
```

### Async Utilities

```js
await waitFor(() => getByText('Loaded'));
await waitForElementToBeRemoved(() => getByText('Loading'));
await act(async () => { await doSomething(); });
```

### Signal Testing

```js
const { signal, value, history, reset } = createTestSignal(0);
signal.set(5);
console.log(history); // [0, 5]
reset();
```

### Mock Components

```js
const MockButton = mockComponent('Button');
render(h(MockButton, { disabled: true }));
console.log(MockButton.calls); // [{ props: { disabled: true }, timestamp: ... }]
```

### Assertions

```js
import { expect } from 'what-framework/testing';

expect.toBeInTheDocument(element);
expect.toHaveTextContent(element, 'Hello');
expect.toHaveAttribute(element, 'disabled');
expect.toHaveClass(element, 'active');
expect.toBeVisible(element);
expect.toBeDisabled(element);
expect.toHaveValue(input, 'test');
```

### Cleanup

Call `cleanup()` after each test to remove rendered components and clean up effects.

```js
import { cleanup } from 'what-framework/testing';

afterEach(cleanup);
```
