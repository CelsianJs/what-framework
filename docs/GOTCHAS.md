# What Framework — Gotchas & Common Surprises

Hard-won lessons from building real apps with What Framework.

## 1. `useEffect` deps with functions → runs every render

```js
// BAD — new function reference every render, depsChanged always true
useEffect(() => {
  doSomething();
}, [() => store.someValue]);

// GOOD — read the value first, pass primitive to deps
const val = store.someValue;
useEffect(() => {
  doSomething();
}, [val]);
```

**Why:** `depsChanged` uses `Object.is()` to compare deps. A function literal creates a new object each render, so `Object.is(fn1, fn2)` is always `false`. This silently runs your effect on every single re-render.

## 2. `spring()` must be persisted across renders

```js
// BAD — creates a new spring every re-render, animation restarts from 0
function AnimatedValue({ target }) {
  const s = spring(0);
  useEffect(() => { s.set(target); }, [target]);
  return h('span', null, Math.round(s.current()));
}

// GOOD — persist with useRef
function AnimatedValue({ target }) {
  const ref = useRef(null);
  if (!ref.current) ref.current = spring(0);
  const s = ref.current;
  useEffect(() => { s.set(target); }, [target]);
  return h('span', null, Math.round(s.current()));
}
```

**Why:** Components re-run their entire function body on every render (they run inside an `effect()`). Calling `spring()` raw creates a new spring instance each time. The old spring's animation continues but nobody reads its signals.

## 3. `useSWR` key must be a string, not a function

```js
// BAD — function as key creates new Map entry every render
const { data } = useSWR(() => `items-${query}`, fetcher);

// GOOD — pass the string directly
const { data } = useSWR(`items-${query}`, fetcher);
```

**Why:** `useSWR` uses the key as a `Map` key. A function creates a new closure each render, so each render gets a different cache entry. Data from previous renders is orphaned.

## 4. `useSWR` returns signal getters — call them with `()`

```js
const { data, isLoading, error } = useSWR('key', fetcher);

// BAD — these are functions, not values
if (isLoading) { ... }  // always truthy (function reference)

// GOOD — call them to get the value
if (isLoading()) { ... }
const items = data() || [];
```

## 5. `formState.errors` / `formState.values` are getters, NOT functions

```js
const { formState } = useForm({ ... });

// BAD — TypeError
const errors = formState.errors();
const values = formState.values();

// GOOD — property access (they're getters)
const errors = formState.errors;
const values = formState.values;

// BUT these ARE functions:
const dirty = formState.isDirty();
const submitting = formState.isSubmitting();
```

## 6. `h()` stringifies function children

```js
// BAD — renders the function source code as text
h('span', null, () => computedValue())

// GOOD — pass the value directly
h('span', null, computedValue())
```

**Why:** `flattenChildren` in `h.js` converts anything that isn't null/boolean/string/number/array/vnode into a string via `String(child)`. Functions become `"() => computedValue()"` as literal text.

## 7. `show()` evaluates the condition as a value, doesn't call it

```js
// BAD — isLoading is a function reference (always truthy)
show(isLoading, h('div', null, 'Loading...'))

// GOOD — use a ternary with the called signal
isLoading() ? h('div', null, 'Loading...') : null
```

**Why:** `show(condition, vnode)` checks `if (condition)`. A function reference is always truthy. Use ternaries with signal getter calls instead.

## 8. `derived()` in stores uses parameter, not `this`

```js
// BAD — `this` is undefined in derived
const store = createStore({
  theme: 'dark',
  isDark: derived(function() { return this.theme === 'dark'; }),
});

// GOOD — state is passed as first parameter
const store = createStore({
  theme: 'dark',
  isDark: derived(state => state.theme === 'dark'),
});

// NOTE: Actions DO use `this` (it's bound to the proxy)
const store = createStore({
  count: 0,
  increment() { this.count++; },  // ✓ this works
});
```

## 9. SVG `innerHTML` — use `dangerouslySetInnerHTML`

```js
// BAD — setAttribute('innerHTML', ...) doesn't work on SVG
h('svg', { innerHTML: '<path d="..." />' })

// GOOD
h('svg', { dangerouslySetInnerHTML: { __html: '<path d="..." />' } })
```

## 10. Custom element `<what-c>` and constructor restrictions

The framework wraps components in `<what-c>` custom elements with `display: contents`. Setting attributes/styles in the custom element constructor violates the spec in strict Chromium. The framework uses `connectedCallback` instead.

If you define your own custom elements, do DOM manipulation in `connectedCallback`, not `constructor`.

## 11. `useMemo` deps have the same function-reference gotcha

```js
// BAD — new function every render
const filtered = useMemo(() => {
  return data().filter(x => x.active);
}, [() => data()]);

// GOOD — read signal first
const dataVal = data();
const filtered = useMemo(() => {
  return dataVal.filter(x => x.active);
}, [dataVal]);
```

## 12. `mount()` expects a vnode, not a bare function

```js
// BAD — TypeError: vnode.children is not iterable
mount(App, '#app');

// GOOD — wrap in h() to create a vnode
mount(h(App), '#app');

// JSX equivalent
mount(<App />, '#app');
```

**Why:** `mount()` expects a vnode (the result of `h()`), not a component function. `h(App)` creates a vnode with `tag: App`, which the reconciler knows how to render.

## 13. `signal()` inside components loses state on re-render

```js
// BAD — creates a new signal every re-render, state resets to 0
function Counter() {
  const count = signal(0);
  return h('button', { onClick: () => count.set(c => c + 1) }, count());
}

// GOOD — useSignal persists across re-renders via hooks array
function Counter() {
  const count = useSignal(0);
  return h('button', { onClick: () => count.set(c => c + 1) }, count());
}
```

**Why:** Components re-run their entire function body inside an `effect()`. Raw `signal()` creates a brand-new signal each time. `useSignal()` stores the signal in a hooks array so it persists.

## 14. Mutable variables reset on re-render — use `useRef`

```js
// BAD — nextId resets to 4 on every re-render
function TodoList() {
  let nextId = 4;
  const addItem = () => { /* nextId++ is lost */ };
}

// GOOD — useRef persists across re-renders
function TodoList() {
  const nextIdRef = useRef(4);
  const addItem = () => { nextIdRef.current++; };
}
```

**Why:** Same reason as gotcha #13. The component function re-runs entirely, so `let` variables reset. `useRef` stores the value in the hooks array.

## 15. Render components with `h(Component)`, not `Component()`

```js
// BAD — runs in parent's effect scope, no isolated cleanup
function App() {
  return h('div', null, Counter());
}

// GOOD — creates proper component with its own effect scope
function App() {
  return h('div', null, h(Counter));
}
```

**Why:** `h(Counter)` tells the reconciler to create a component boundary — the component gets its own reactive effect and cleanup scope. Calling `Counter()` directly runs it inside the parent's effect, so hooks and effects aren't properly scoped.

## General mental model

- **Components re-run entirely** on signal changes (no partial re-execution)
- **`useState` returns `[value, setter]`** — `value` is plain JS, not a signal
- **Anything called in the component body** during render is tracked by the reactive effect
- **Event handlers are wrapped in `untrack()`** — signal reads in handlers don't create subscriptions
- **Effects flush via microtask** — not synchronous. `signal.set()` → `queueMicrotask` → effect re-runs
- **`useEffect` cleanup + re-run also via `queueMicrotask`** — not immediate
