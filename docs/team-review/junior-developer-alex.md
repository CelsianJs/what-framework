# Junior Developer Review: What Framework
## Reviewer: Alex (1.5 years experience, primarily React)
## Date: February 2026

---

## Table of Contents

1. [First Impressions](#first-impressions)
2. [Learning Curve from React](#learning-curve-from-react)
3. [API Ergonomics](#api-ergonomics)
4. [Documentation Quality](#documentation-quality)
5. [DX Pain Points](#dx-pain-points)
6. [Things I Love](#things-i-love)
7. [Comparison to React](#comparison-to-react)
8. [Building the 5 Apps](#building-the-5-apps)
9. [Missing Features](#missing-features)
10. [Bug Risks](#bug-risks)
11. [Specific Code Feedback](#specific-code-feedback)
12. [Wishlist](#wishlist)
13. [Final Verdict](#final-verdict)

---

## First Impressions

When I first opened the codebase, my immediate reaction was: "Wait, this is the whole framework?" The core reactive system in `packages/core/src/reactive.js` is roughly 180 lines. The entire `h()` function and tagged template parser in `packages/core/src/h.js` is about 200 lines. Coming from React where the source spans thousands of files, this felt refreshingly small.

The index.js exports gave me anxiety though. There are **a lot** of exports:

```js
// From packages/core/src/index.js
export { signal, computed, effect, batch, untrack } from './reactive.js';
export { h, Fragment, html } from './h.js';
export { mount } from './dom.js';
export { useState, useSignal, useComputed, useEffect, useMemo, useCallback, useRef, useContext, useReducer, createContext, onMount, onCleanup, createResource } from './hooks.js';
export { memo, lazy, Suspense, ErrorBoundary, Show, For, Switch, Match, Island } from './components.js';
export { createStore, storeComputed, atom } from './store.js';
// ... animation, a11y, skeleton, data, form, scheduler...
```

This is simultaneously impressive (it has everything) and overwhelming (where do I start?). React has a smaller surface area for the core -- you learn `useState`, `useEffect`, `useRef`, and you are productive. Here, there is `signal`, `computed`, `effect`, `useState`, `useSignal`, `useComputed`, `useEffect`, `createResource`, `useSWR`, `useQuery`, `useFetch`... That is a lot of overlapping ways to do similar things.

My first positive reaction: the demo files are written in plain `h()` calls without JSX, and they are still readable. That tells me the API design is decent. My first negative reaction: I immediately felt uncertain about which API to use for any given task.

---

## Learning Curve from React

### What Transferred Immediately

The hooks API is a direct mirror of React. When I saw this in `demo/src/pages/demos.js`:

```js
function Counter() {
  const [count, setCount] = useState(0);
  const doubled = useMemo(() => count * 2, [count]);

  return h('div', { class: 'demo-card' },
    h('h3', { class: 'demo-title' }, 'Counter with Computed'),
    h('div', { class: 'counter' },
      h('button', { class: 'counter-btn', onClick: () => setCount(c => c - 1) }, '\u2212'),
      h('span', { class: 'counter-value' }, count),
      h('button', { class: 'counter-btn', onClick: () => setCount(c => c + 1) }, '+'),
    ),
    h('p', { class: 'text-muted text-center mt-4' }, 'Doubled: ', doubled),
  );
}
```

I immediately understood it. `useState`, `useMemo`, `useEffect` with deps arrays, `useRef` -- all 1:1 with React. That is a huge win for adoption.

### What Confused Me

**1. signal() vs useState() vs useSignal()**

The QUICKSTART.md says `useSignal` is "preferred" over `useState`. But the demo files overwhelmingly use `useState`. The home page (`demo/src/pages/home.js`) uses `useState`. The demos page uses `useState` everywhere. The islands page uses `useState`. I only see `useSignal` imported but not heavily used in demos.

This sends a mixed message. The docs say one thing, the example code does another.

**2. When to call signals as functions**

In the reactive system, you read a signal by calling it: `count()`. But `useState` returns the plain value. So sometimes I write `count` and sometimes `count()`. In the demos, I see:

```js
const [count, setCount] = useState(0);
// ... later:
h('span', { class: 'counter-value' }, count),
```

Here `count` is a plain number. But if I used `useSignal`:

```js
const count = useSignal(0);
// ... later:
h('span', { class: 'counter-value' }, count()),
```

Now I need the `()`. This switching back and forth is a source of bugs waiting to happen.

**3. The `h()` function as the primary authoring mode**

I understand that JSX compiles to `h()`, but all the demo files are written without JSX. At first I thought, "Okay, they just have not set up the compiler for the demo." But it made me wonder -- is h() supposed to be the primary way to write code? Looking at the home page, the nesting gets intense:

```js
h('div', { class: 'hero-code' },
  h('div', { class: 'code-block' },
    h('div', { class: 'code-header' },
      h('div', { class: 'code-dots' },
        h('span', { class: 'code-dot' }),
        h('span', { class: 'code-dot' }),
        h('span', { class: 'code-dot' }),
      ),
      h('span', { class: 'code-filename' }, 'counter.jsx'),
    ),
    // ...
  ),
),
```

This is 7 levels deep and very hard to visually parse. In React with JSX this would be much more readable. I get that it works, but I would never want to write a real app this way.

**4. Two mental models: reactive and hook-based**

The framework wants to be both SolidJS (signals, `effect`, `computed`, fine-grained reactivity) and React (hooks, `useState`, `useEffect`, dependency arrays). This is a double-edged sword. For me coming from React, the hooks feel natural. But I know that the signal-based approach is fundamentally different -- and mixing them feels like I am never sure which paradigm I am supposed to be in.

---

## API Ergonomics

### The Good

**Signals are elegant.** The core reactive primitives in `reactive.js` are beautiful:

```js
export function signal(initial) {
  let value = initial;
  const subs = new Set();

  function read() {
    if (currentEffect) {
      subs.add(currentEffect);
      currentEffect.deps.add(subs);
    }
    return value;
  }

  read.set = (next) => {
    const nextVal = typeof next === 'function' ? next(value) : next;
    if (Object.is(value, nextVal)) return;
    value = nextVal;
    notify(subs);
  };

  read.peek = () => value;
  // ...
}
```

I love that a signal is just a function with `.set()` and `.peek()` attached. No class, no wrapper object, no proxy. It is the simplest possible reactive primitive. The `Object.is` check for skipping no-op updates is exactly right.

**`batch()` is intuitive.** Coming from React where batching is automatic in event handlers but not in async code, having an explicit `batch()` makes the mental model clearer:

```js
batch(() => {
  firstName.set('Jane');
  lastName.set('Doe');
  // Effects run once, not twice
});
```

**`cls()` is a nice built-in.** Every React project I have worked on installs `clsx` or `classnames`. Having it built in is a small but appreciated touch:

```js
cls('btn', isActive && 'active', { disabled, primary })
```

**`show()` and `each()` helpers are convenient.** These read well in `h()` calls:

```js
show(submitted,
  h('div', { style: {...} }, 'Form submitted: ', () => submitted?.email)
)
```

**`createStore` with `storeComputed` is smart.** The explicit marker for computed properties solves a real disambiguation problem:

```js
const useCounter = createStore({
  count: 0,
  doubled: storeComputed(state => state.count * 2),  // explicitly computed
  addItem(item) { this.items.push(item); },            // action (not confused)
});
```

The comment in the source explains the problem well -- without the marker, a function taking one argument looks the same as a computed and an action.

### The Awkward

**`useForm` error access is verbose.** Look at this from `demos.js`:

```js
h('input', {
  ...register('email'),
  placeholder: 'Email',
  style: {
    width: '100%',
    padding: '0.75rem 1rem',
    border: () => formState.errors().email ? '2px solid var(--color-error)' : '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    fontSize: 'var(--text-sm)',
  },
}),
show(formState.errors().email,
  h('span', { style: {...} },
    () => formState.errors().email?.message
  )
),
```

`formState.errors().email?.message` -- that is calling a signal function, accessing a property, then optional chaining. Every time I want to show a form error, I am writing the same chain twice (once for the condition, once for the message). In React Hook Form, you get `errors.email?.message` -- simpler.

**Mixing `show(condition, ...)` with signal-based conditions is confusing.** In the DataDemo:

```js
show(isLoading,
  h('div', { ... },
    h(Skeleton, { width: '100%', height: 48 }),
    // ...
  )
),
show(error, h('p', { ... }, 'Error loading data')),
show(() => data() && !isLoading(),
  h('ul', { ... },
    () => (data() || []).map(user =>
      h('li', { ... }, ...)
    )
  )
),
```

Sometimes `show` gets a plain value (`isLoading`), sometimes it gets a function (`() => data() && !isLoading()`). Which one am I supposed to use? Looking at the `show` helper source:

```js
export function show(condition, vnode, fallback = null) {
  return condition ? vnode : fallback;
}
```

This is a plain ternary -- it does not unwrap signals. So `show(isLoading, ...)` only works if `isLoading` is a truthy value at render time, not a signal. But `isLoading` from `useSWR` is a signal. This is a potential source of subtle bugs. Does `show` re-evaluate when the signal changes? Looking at the implementation, no -- it just returns one or the other at call time. So either the whole component re-renders (because of signals read elsewhere), or this is wrong.

**Event handler naming: `onClick` vs `onclick`.** The `h()` function uses React-style `onClick` (camelCase), which the `setProp` function in `dom.js` transforms:

```js
if (key.startsWith('on') && key.length > 2) {
  const event = key.slice(2).toLowerCase();
  // ...
}
```

But the `html` tagged template examples in the README use `onclick` (lowercase). This inconsistency is a papercut. I would expect the framework to standardize on one style.

---

## Documentation Quality

### What is Good

The QUICKSTART.md is comprehensive. It covers project scaffolding, manual setup, project structure, JSX configuration, signals, components, hooks, routing, islands, forms, data fetching, animation, global state, build-step-free authoring, configuration, and CLI commands. That is a lot of ground covered and it is mostly well-organized.

The API.md is thorough. Every export has a code example, both in `h()` and JSX syntax. The tables summarizing features are helpful.

The README is a great landing page -- it immediately shows a counter example, explains the "why," and lists features at a glance.

### What is Missing or Confusing

**1. No error message documentation.** When something goes wrong (like calling a hook outside a component), I get `'Hooks must be called inside a component'`. But there is no troubleshooting section explaining common errors and how to fix them.

**2. No migration guide from React.** The framework markets itself as React-compatible, but there is no dedicated "Coming from React?" guide that maps React patterns to What patterns. For example:
- `React.memo` -> `memo()` (same!)
- `useContext` + `<Context.Provider>` -> same API
- `React.lazy` + `<Suspense>` -> `lazy()` + `<Suspense>` (same!)
- But `useState` returns the value directly, not a snapshot like in React 18+

**3. No guidance on "which API should I use?"** Should I use `signal` or `useSignal`? `useState` or `useSignal`? `show()` or `<Show>`? `each()` or `<For>`? `useSWR` or `useQuery` or `useFetch` or `createResource`? The docs list all of them without helping me choose. A "Decision Tree" section would be incredibly helpful.

**4. The demo code does not use JSX.** Every demo file uses raw `h()` calls. If JSX is the "recommended" approach, the demos should demonstrate it. Seeing 500 lines of nested `h()` calls is not going to attract React developers.

**5. No TypeScript guide.** The README mentions "Full type definitions included" but there is no documentation about how to use TypeScript with the framework. I see `packages/core/index.d.ts` exists, but no guide.

**6. No section on testing in QUICKSTART.** Testing is mentioned in the API reference, but the quickstart guide does not explain how to write and run tests. For a junior developer, knowing how to test my components from day one is important.

---

## DX Pain Points

### 1. Deeply Nested h() Calls

I already mentioned this, but it bears repeating. The `demo/src/pages/home.js` file is 157 lines and the entire component is one massive deeply-nested `h()` tree. I counted up to 8 levels of nesting. Without syntax highlighting for JSX, tracking opening and closing parentheses is a nightmare. I lost track multiple times while reading the code.

### 2. The `<what-c>` Custom Element Wrapper

Components render inside a `<what-c style="display:contents">` wrapper element (from `dom.js`):

```js
wrapper = document.createElement('what-c');
wrapper.style.display = 'contents';
```

This means the DOM tree always has extra elements that do not correspond to anything in my component code. When I inspect the DOM in DevTools, I will see `<what-c>` wrappers everywhere. While `display: contents` makes them invisible in layout, they can still cause issues:
- CSS selectors like `div > p` might break
- `querySelector` results might include unexpected elements
- Third-party libraries that walk the DOM might get confused
- There is no clear explanation in the docs about this behavior

### 3. No DevTools Extension

React has React DevTools. Vue has Vue DevTools. I did not find any mention of developer tools for What Framework. When I have a chain of signals and effects and something is not updating, how do I debug it? I am left with `console.log`.

### 4. Swallowed Errors in Cleanup

In `dom.js`, cleanup errors are silently caught:

```js
if (e._cleanup) {
  try { e._cleanup(); } catch (err) { /* cleanup error */ }
  e._cleanup = null;
}
```

And in `reactive.js`:

```js
try { e._cleanup(); } catch (err) { /* cleanup error */ }
```

As a junior developer, silent error swallowing is one of the most frustrating things to debug. If my cleanup function throws, I will never know. At minimum, there should be a `console.warn` in development mode.

### 5. Confusing Interaction Between Component Re-renders and Signals

The component rendering system in `dom.js` wraps the entire component in a reactive `effect`:

```js
const dispose = effect(() => {
  if (ctx.disposed) return;
  ctx.hookIndex = 0;
  componentStack.push(ctx);

  let result;
  try {
    result = Component(propsSignal());
  } catch (error) {
    // ...
  }
  // ...
});
```

This means the component re-runs whenever any signal read inside it changes. But it also has `useState` and `useEffect` with dependency arrays, which are React's model for controlling when things update. These two models can conflict:
- If I read a signal in a component but do not want the whole thing to re-render, I need `untrack()`.
- But `untrack` is not mentioned in QUICKSTART.md at all.
- The docs say signals give "fine-grained" updates, but component-level re-rendering is not fine-grained -- it is the same as React.

### 6. No Hot Module Replacement (HMR) State Preservation

I did not find any mechanism for preserving component state during HMR. React's Fast Refresh preserves state across hot reloads. Without this, every time I save a file during development, all my component state resets. For a form I have been filling out or a list I have been building, this is painful.

---

## Things I Love

### 1. The Entire Reactive System is 180 Lines

I can actually read and understand the entire reactivity engine. In `reactive.js`, everything is visible: how signals track subscribers, how effects run, how batching works, how computed values are lazy. There is no magic. If something goes wrong, I can trace through the code myself.

### 2. Signals as Functions is Brilliant

```js
const count = signal(0);
count();        // read
count.set(5);   // write
count.peek();   // read without tracking
```

This is the simplest possible API for reactive state. No `.value` (like Vue refs), no special accessor syntax, no proxy magic. Just call the function.

### 3. The h() VNode System is Dead Simple

```js
export function h(tag, props, ...children) {
  props = props || EMPTY_OBJ;
  const flat = flattenChildren(children);
  const key = props.key ?? null;
  return { tag, props, children: flat, key, _vnode: true };
}
```

A VNode is just a plain object with `tag`, `props`, `children`, and `key`. No fibers, no lanes, no priority system. This is refreshingly transparent.

### 4. Islands Architecture is First-Class

The `Island` component in `components.js` supports five hydration modes out of the box:

```js
switch (mode) {
  case 'load':       queueMicrotask(doHydrate); break;
  case 'idle':       requestIdleCallback(doHydrate); break;
  case 'visible':    new IntersectionObserver(...).observe(el); break;
  case 'interaction': el.addEventListener('click', hydrate, { once: true }); break;
  case 'media':      window.matchMedia(mediaQuery)...; break;
}
```

This is not an afterthought or a plugin -- it is built into the core. Coming from React where you need Next.js + `dynamic()` + various workarounds for partial hydration, having this built-in is a significant advantage.

### 5. Built-in Form Handling with Validation Resolvers

The `useForm` hook with `simpleResolver`, `zodResolver`, and `yupResolver` means I do not need to install `react-hook-form` or `formik` separately. The demo form validation code is compact and readable:

```js
const { register, handleSubmit, formState, reset } = useForm({
  defaultValues: { email: '', password: '' },
  resolver: simpleResolver({
    email: [rules.required('Email is required'), rules.email()],
    password: [rules.required('Password is required'), rules.minLength(6, 'Min 6 characters')],
  }),
});
```

### 6. The Bundle Size Claim is Believable

I manually counted lines in the core source files. The reactive system is ~180 lines. The DOM reconciler is ~720 lines. Hooks are ~260 lines. The h() function is ~200 lines. Components are ~300 lines. This really could be under 4kB gzipped. Compare that to React + ReactDOM at ~40kB.

### 7. SWR-style Data Fetching Baked In

Having `useSWR`, `useQuery`, and `useInfiniteQuery` built into the framework means I do not need to add `swr`, `react-query`, or `@tanstack/react-query` as separate dependencies. The demo shows a clean usage pattern:

```js
const { data, error, isLoading, mutate } = useSWR('demo-users', mockFetch);
```

### 8. Accessibility Utilities Included

The `a11y.js` module exports `useFocusTrap`, `announce`, `useRovingTabIndex`, `VisuallyHidden`, `LiveRegion`, and more. Most React projects I have seen treat accessibility as an afterthought. Having these primitives built in encourages good practices from the start. The demo even includes a modal with focus trapping:

```js
useFocusTrap(modalRef, modalOpen);
```

---

## Comparison to React

### Where What Wins

| Aspect | React | What | Winner |
|--------|-------|------|--------|
| Bundle size | ~40kB gzipped | ~4kB gzipped | What |
| Built-in routing | No (need react-router) | Yes | What |
| Built-in form handling | No (need react-hook-form) | Yes | What |
| Built-in data fetching | No (need swr/tanstack-query) | Yes | What |
| Islands architecture | No (need Next.js + workarounds) | Built-in | What |
| Source code readability | Thousands of files, fibers, lanes | 180-line reactive system | What |
| No-build-step option | No | Yes (h() or html tagged template) | What |

### Where React Wins

| Aspect | React | What | Winner |
|--------|-------|------|--------|
| Ecosystem | Massive | Nonexistent | React |
| DevTools | React DevTools | Nothing | React |
| Community/StackOverflow | Millions of answers | Zero | React |
| Production battle-testing | 10+ years, Facebook scale | Brand new | React |
| TypeScript DX | First-class, mature | Type defs exist but untested | React |
| Concurrent features | Suspense, transitions, streaming | Basic | React |
| Learning resources | Thousands of tutorials | README + API docs | React |
| Hiring pool | Everyone knows React | No one knows What | React |
| Server Components | React Server Components | Not comparable | React |
| Error messages | Descriptive with suggestions | Basic throws | React |

### The Honest Truth

If I were building a personal project or a marketing site with islands of interactivity, I would seriously consider What Framework. The bundle size, built-in islands, and simplicity are compelling.

If I were joining a team or building a production app that needs to be maintained by multiple developers over years, I would stick with React. The ecosystem, tooling, community support, and hiring advantages are too significant to ignore at this point.

---

## Building the 5 Apps

### App 1: Simple Counter

**In React:**
```jsx
function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>;
}
```

**In What (with JSX):**
```jsx
function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>;
}
```

Verdict: Identical. No friction at all. This is the framework's sweet spot.

**In What (without JSX):**
```js
function Counter() {
  const [count, setCount] = useState(0);
  return h('button', { onClick: () => setCount(c => c + 1) }, 'Count: ', count);
}
```

Still very clean. The `h()` API handles this well.

### App 2: Todo List with Add/Remove/Toggle

This is where things start to show nuances. Looking at the actual `TodoList` demo in `demos.js`:

```js
function TodoList() {
  const [todos, setTodos] = useState([]);
  const [input, setInput] = useState('');
  const inputRef = useRef(null);

  const remaining = useMemo(
    () => todos.filter(t => !t.done).length,
    [todos]
  );

  const addTodo = () => {
    if (!input.trim()) return;
    setTodos(prev => [...prev, { id: Date.now(), text: input.trim(), done: false }]);
    setInput('');
  };
  // ...
}
```

**Friction point 1:** Immutable state updates. Just like React, I have to do `setTodos(prev => prev.map(...))` and `setTodos(prev => prev.filter(...))`. The framework does not help with this -- no `produce()` (Immer) built in.

**Friction point 2:** The todo list rendering uses `...todos.map(todo => ...)` with the spread operator:

```js
h('ul', { class: 'todo-list' },
  ...todos.map(todo =>
    h('li', { key: todo.id, class: `todo-item${todo.done ? ' done' : ''}` },
      // ...
    )
  ),
),
```

This works, but notice the `...` spread. Without it, you are passing an array as a single child. With it, each element is a separate child argument. I would forget this spread and get rendering bugs.

**Friction point 3:** The `key` prop on `h('li', { key: todo.id, ... })` is handled correctly -- it is extracted from props in `h()`:

```js
const key = props.key ?? null;
if (props.key !== undefined) {
  props = { ...props };
  delete props.key;
}
```

Good -- same behavior as React. But the docs do not explain when keys are necessary, which is important for list rendering.

**Could I use signals instead?** Using `useSignal` for the todo list would mean:

```js
const todos = useSignal([]);
// Adding:
todos.set(prev => [...prev, { id: Date.now(), text: input(), done: false }]);
```

The mutation semantics are the same. Signals do not help with array immutability -- I still need to create a new array. A `createStore` approach might be nicer for complex state.

### App 3: Form with Validation

Looking at `FormDemo` in `demos.js`, this is where the framework actually shines versus React. The `useForm` + `simpleResolver` + `rules` API is compact:

```js
const { register, handleSubmit, formState, reset } = useForm({
  defaultValues: { email: '', password: '' },
  resolver: simpleResolver({
    email: [rules.required('Email is required'), rules.email()],
    password: [rules.required('Password is required'), rules.minLength(6, 'Min 6 characters')],
  }),
});
```

**Friction point 1:** Accessing errors is verbose. `formState.errors().email?.message` -- that is calling a signal, then optional chaining. In React Hook Form, it is just `errors.email?.message`.

**Friction point 2:** Showing error styling requires wrapping in a function for reactivity:

```js
border: () => formState.errors().email ? '2px solid var(--color-error)' : '1px solid var(--color-border)',
```

That `() =>` wrapper is easy to forget. Without it, the border would be evaluated once and never update when errors change. This is a gotcha that would bite me repeatedly.

**Friction point 3:** The `register` function returns props to spread. In the `h()` API, this is `{ ...register('email') }`. This works, but I cannot see what props it generates without reading the source. The docs do not show what `register()` returns.

**What I would build (with JSX):**
```jsx
function LoginForm() {
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { email: '', password: '' },
    resolver: simpleResolver({
      email: [rules.required(), rules.email()],
      password: [rules.required(), rules.minLength(8)],
    }),
  });

  return (
    <form onSubmit={handleSubmit(data => console.log(data))}>
      <input {...register('email')} placeholder="Email" />
      <Show when={formState.errors().email}>
        <span class="error">{() => formState.errors().email?.message}</span>
      </Show>
      <input {...register('password')} type="password" />
      <button type="submit">Login</button>
    </form>
  );
}
```

This is quite clean! The form story is actually one of What's strengths.

### App 4: Data-Fetching Component with Loading States

The `DataDemo` in `demos.js` uses `useSWR`:

```js
const mockFetch = () => new Promise((resolve) => {
  setTimeout(() => {
    resolve([
      { id: 1, name: 'Alice', role: 'Engineer' },
      { id: 2, name: 'Bob', role: 'Designer' },
      { id: 3, name: 'Carol', role: 'PM' },
    ]);
  }, 1000);
});

const { data, error, isLoading, mutate } = useSWR('demo-users', mockFetch);
```

**Friction point 1:** The conditional rendering with `show()` is fragile. Look at this pattern:

```js
show(isLoading,
  h('div', { ... }, h(Skeleton, { ... }))
),
show(error, h('p', { ... }, 'Error loading data')),
show(() => data() && !isLoading(),
  h('ul', { ... }, ...)
),
```

Three separate `show()` calls, where `isLoading` and `error` are signals but used as plain values. This works because the component re-renders when signals change (the entire component function is wrapped in an `effect`). But it is confusing -- `show` looks like it should be reactive but it is just a ternary.

**Friction point 2:** Rendering data requires a function wrapper:

```js
() => (data() || []).map(user =>
  h('li', { key: user.id, ... },
    h('span', null, user.name),
    h('span', null, user.role),
  )
)
```

The `() =>` at the beginning and `data() || []` pattern is boilerplate I would need to remember. In React, I would just do `data?.map(...)`.

**Friction point 3:** I see four different data fetching APIs: `useFetch`, `useSWR`, `useQuery`, and `createResource`. Which should I use? The docs list all of them but do not provide guidance on when to use which. As a junior developer, I want a single recommended approach.

**What I would build (with JSX):**
```jsx
function UserList() {
  const { data, isLoading, error } = useSWR('users', () =>
    fetch('/api/users').then(r => r.json())
  );

  return (
    <div>
      <Show when={isLoading()} fallback={null}>
        <Skeleton width="100%" height={200} />
      </Show>
      <Show when={error()}>
        <p class="error">Failed to load</p>
      </Show>
      <Show when={() => data() && !isLoading()}>
        <ul>
          {() => data().map(user => <li key={user.id}>{user.name}</li>)}
        </ul>
      </Show>
    </div>
  );
}
```

The `<Show>` component approach with JSX is actually clean. My main complaint is the `() =>` wrappers needed for the `when` prop and for children that read signals.

### App 5: Multi-Page App with Routing

Looking at the router source in `packages/router/src/index.js` and the layout in `demo/src/layouts/main.js`:

```js
export function Layout({ children }) {
  return h('div', { class: 'layout' },
    h('nav', { class: 'nav' },
      h('div', { class: 'nav-inner' },
        h(Link, { href: '/', class: 'nav-logo' }, 'What'),
        h('div', { class: 'nav-links' },
          h(Link, { href: '/', class: 'nav-link' }, 'Home'),
          h(Link, { href: '/demos', class: 'nav-link' }, 'Demos'),
          // ...
        ),
      ),
    ),
    h('main', { class: 'content' },
      h('div', { class: 'container' }, children),
    ),
    h('footer', { class: 'footer-simple' },
      h('p', null, 'What Framework v0.1.0'),
    ),
  );
}
```

**Friction point 1:** The `Link` component auto-applies `active` and `exact-active` classes, which is great. But looking at the source:

```js
const currentPath = route.path;
const isActive = currentPath.startsWith(href);
const isExactActive = currentPath === href;
```

This means the `/` route is "active" for every page (since every path starts with `/`). The home link would always have the `active` class. This is a common routing bug.

**Friction point 2:** The `Router` component requires routes as a flat array:

```js
h(Router, {
  routes: [
    { path: '/', component: Home },
    { path: '/about', component: About },
  ],
  fallback: NotFound,
  globalLayout: Layout,
})
```

This is fine, but the `defineRoutes` helper returns an array, and `nestedRoutes` returns an array, and `routeGroup` returns an array. For a large app, composing these together is just `[...routes1, ...routes2, ...]`. There is no route tree builder or file-based route scanner built in (despite the docs mentioning file-based routing).

**Friction point 3:** Route guards are functions that wrap components:

```js
const requireAuth = guard(
  () => isAuthenticated(),
  '/login'
);
const ProtectedDashboard = requireAuth(Dashboard);
```

This is clean! But it is evaluated once at component creation time. If the auth state changes after the component is mounted, the guard does not re-evaluate. You would need `asyncGuard` for that.

**What I would build (with JSX):**
```jsx
const routes = defineRoutes({
  '/': Home,
  '/about': About,
  '/dashboard': requireAuth(Dashboard),
  '/login': Login,
});

function App() {
  return <Router routes={routes} fallback={NotFound} globalLayout={Layout} />;
}

mount(<App />, '#app');
```

This is straightforward and familiar. The routing story is simple, which is good for basic apps. For complex apps with nested layouts and data loading per route, I would want more.

---

## Missing Features

1. **No concurrent rendering.** React 18+ has `useTransition`, `useDeferredValue`, and `Suspense` for data fetching. What has basic `Suspense` for lazy loading but nothing for concurrent UI patterns like showing stale content while fetching.

2. **No server components.** React Server Components fundamentally change the client/server boundary. What's `server()` wrapper just marks a component as server-only -- it does not allow server and client components to interleave in a single tree.

3. **No streaming SSR with Suspense boundaries.** The `renderToStream` exists but there is no mention of how Suspense boundaries interact with streaming. React can stream HTML and progressively fill in Suspense boundaries.

4. **No built-in CSS solution.** No CSS-in-JS, no CSS modules integration, no scoped styles. The demos use a global CSS file. For a framework that targets React developers, having no built-in styling solution is notable.

5. **No Immer or immutable update helpers.** Every state update requires creating new objects/arrays manually. A `produce()` function or `setTodos(draft => { draft[0].done = true })` pattern would be valuable.

6. **No file-based routing implementation.** The docs extensively describe file-based routing (`src/pages/index.jsx -> /`), but looking at the code, I do not see any implementation that scans the filesystem and generates routes. It is described as a feature but appears to be vaporware.

7. **No i18n support.** No internationalization primitives or integration.

8. **No middleware for SSR.** The server package has `renderToString` and `renderToStream`, but no Express/Hono/Fastify middleware for easy integration.

9. **No `useFormContext`.** React Hook Form has `useFormContext` for nested form components. I do not see an equivalent -- every form field needs the `register` function passed as a prop.

10. **No error overlay in development.** React's dev mode shows a red error overlay when something crashes. I did not find anything similar.

---

## Bug Risks

### 1. Race Condition in createResource

In `hooks.js`:

```js
const refetch = async (source) => {
  loading.set(true);
  error.set(null);

  try {
    const fetchPromise = fetcher(source);
    currentFetch = fetchPromise;
    const result = await fetchPromise;

    if (currentFetch === fetchPromise) {
      data.set(result);
      loading.set(false);
    }
  } catch (e) {
    if (currentFetch === fetchPromise) {
      error.set(e);
      loading.set(false);
    }
  }
};
```

The `currentFetch === fetchPromise` check prevents stale updates -- good. But `loading.set(true)` happens before the check. If I rapidly call `refetch`, loading will flicker to `true` on every call even if previous fetches are being abandoned. The loading state should only be set for the "winning" fetch.

### 2. Memory Leak in useMediaQuery

```js
export function useMediaQuery(query) {
  if (typeof window === 'undefined') return signal(false);
  const mq = window.matchMedia(query);
  const s = signal(mq.matches);
  mq.addEventListener('change', (e) => s.set(e.matches));
  return s;
}
```

There is no cleanup. The `change` event listener on the `MediaQueryList` is never removed. If this function is called inside a component that unmounts and remounts, listeners accumulate. This should return a cleanup function or integrate with the component lifecycle.

### 3. Memory Leak in useLocalStorage

```js
export function useLocalStorage(key, initial) {
  // ...
  const s = signal(stored);

  effect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(s()));
    } catch { /* quota exceeded, etc */ }
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === key && e.newValue !== null) {
        try { s.set(JSON.parse(e.newValue)); } catch {}
      }
    });
  }

  return s;
}
```

Same problem: the `storage` event listener is never removed. And the `effect` creates a subscription that is never disposed. If called inside a component, this leaks.

### 4. show() Helper is Not Reactive

As I mentioned earlier:

```js
export function show(condition, vnode, fallback = null) {
  return condition ? vnode : fallback;
}
```

This evaluates `condition` once when called. If `condition` is a signal, the return value is determined at call time, not reactively. This will confuse developers who expect `show(isLoading, ...)` to react to `isLoading` changes. It only works because the parent component re-renders when signals change, but that is an indirect dependency -- not the behavior `show` implies.

### 5. Stale Closure Risk in useState

```js
export function useState(initial) {
  const ctx = getCtx();
  const { index, exists } = getHook(ctx);

  if (!exists) {
    const s = signal(typeof initial === 'function' ? initial() : initial);
    ctx.hooks[index] = s;
  }

  const s = ctx.hooks[index];
  return [s(), s.set];
}
```

`useState` returns `[s(), s.set]`. The value `s()` is the signal's current value at render time. But event handlers created during render capture this value in a closure:

```js
const [count, setCount] = useState(0);
// `count` is always 0 in this closure!
const handleClick = () => setCount(count + 1);
```

In React, this is also a known issue, but React has batching and the updater function pattern (`setCount(c => c + 1)`) to work around it. What has the same issue. The docs should prominently warn about this and always recommend the updater function pattern.

### 6. The `<what-c>` Wrapper in SVG

In `dom.js`, SVG components use a `<g>` wrapper instead of `<what-c>`:

```js
if (isSvg) {
  wrapper = document.createElementNS(SVG_NS, 'g');
} else {
  wrapper = document.createElement('what-c');
  wrapper.style.display = 'contents';
}
```

A `<g>` element is not invisible -- it participates in SVG layout and can affect transforms, opacity inheritance, and bounding box calculations. Unlike `display: contents`, a `<g>` is a real grouping element. Components inside SVGs might render differently than expected because of this extra `<g>` wrapper.

---

## Specific Code Feedback

### Code I Found Impressive

**The LIS algorithm in dom.js** -- An actual Longest Increasing Subsequence implementation for O(n log n) keyed reconciliation:

```js
function longestIncreasingSubsequence(arr) {
  if (arr.length === 0) return [];
  const n = arr.length;
  const dp = new Array(n).fill(1);
  const parent = new Array(n).fill(-1);
  const tails = [0];

  for (let i = 1; i < n; i++) {
    if (arr[i] > arr[tails[tails.length - 1]]) {
      parent[i] = tails[tails.length - 1];
      tails.push(i);
    } else {
      let lo = 0, hi = tails.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[tails[mid]] < arr[i]) lo = mid + 1;
        else hi = mid;
      }
      // ...
    }
  }
  // ...
}
```

This is a proper computer science algorithm implementing the same approach used by frameworks like Inferno and ivi. I am impressed that a ~4kB framework includes this optimization.

**The cleanup tracking in reactive.js** -- Effects track their dependencies bidirectionally:

```js
function read() {
  if (currentEffect) {
    subs.add(currentEffect);
    currentEffect.deps.add(subs); // Track reverse dep for cleanup
  }
  return value;
}
```

And cleanup removes the effect from all its dependency sets:

```js
function cleanup(e) {
  for (const dep of e.deps) dep.delete(e);
  e.deps.clear();
}
```

This prevents stale subscriptions when an effect's dependencies change. It is the same approach SolidJS uses.

**The computed lazy evaluation:**

```js
export function computed(fn) {
  let value, dirty = true;
  const subs = new Set();

  const inner = _createEffect(() => {
    value = fn();
    dirty = false;
    notify(subs);
  }, { lazy: true });

  function read() {
    if (currentEffect) {
      subs.add(currentEffect);
      currentEffect.deps.add(subs);
    }
    if (dirty) _runEffect(inner);
    return value;
  }

  inner._onNotify = () => { dirty = true; };
  // ...
}
```

Computed values are lazy (only recompute when read) and cached. The `_onNotify` callback just marks the value as dirty without recomputing. This is efficient and avoids unnecessary computation.

### Code I Found Confusing

**The Spring animation demo:**

```js
h('div', {
  style: () => ({
    width: '60px',
    height: '60px',
    background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-hover) 100%)',
    borderRadius: 'var(--radius-xl)',
    transform: `translateX(${x.current()}px) scale(${scale.current()})`,
  }),
}),
```

The `style` prop is a function (`() => ({...})`). When is this function called? Looking at `setProp` in `dom.js`:

```js
if (key === 'style') {
  if (typeof value === 'string') {
    el.style.cssText = value;
  } else if (typeof value === 'object') {
    for (const prop in value) {
      el.style[prop] = value[prop] ?? '';
    }
  }
  return;
}
```

Wait -- there is no handling for `typeof value === 'function'`! So if I pass a function as `style`, it will be treated as an object (since functions are objects in JS), and the `for (const prop in value)` loop will iterate over function properties, which is probably nothing. This means the Spring demo's style function is never called by the prop system. So how does it work?

Actually, re-reading this -- I think this works because the component re-renders when `x.current()` and `scale.current()` change (they are signals). On re-render, the function is called during component rendering (not during prop application), and the result is passed to `h()`. But the pattern is still confusing because it looks like the function should be called reactively by the DOM layer.

**The error boundary pattern:**

```js
export function ErrorBoundary({ fallback, children, onError }) {
  const errorState = signal(null);

  const handleError = (error) => {
    errorState.set(error);
    // ...
  };

  const reset = () => errorState.set(null);

  return {
    tag: '__errorBoundary',
    props: { errorState, handleError, fallback, reset },
    children: Array.isArray(children) ? children : [children],
    _vnode: true,
  };
}
```

`ErrorBoundary` returns a raw VNode object instead of using `h()`. This is an implementation detail leaking into the component API. It uses a magic tag `'__errorBoundary'` that the DOM reconciler special-cases. Same for `Suspense` with `'__suspense'`. This feels fragile.

**The `show()` usage inconsistency in demos.js:**

```js
// Sometimes isLoading is used directly (as a signal value from component render)
show(isLoading, ...)

// Sometimes a function wrapper is used
show(() => data() && !isLoading(), ...)

// Sometimes used for conditional display of a non-reactive value
show(submitted, ...)
```

Three different patterns for the same helper. This inconsistency makes me uncertain about which pattern is correct.

---

## Wishlist

Here is what would make What Framework my go-to choice:

### Must-Have (Blocking)

1. **JSX demos.** Rewrite the demo files to use JSX. The `h()` call demos actively discourage React developers from adopting the framework.

2. **A "Coming from React" guide.** A single page that maps every React concept to What's equivalent, with gotchas highlighted.

3. **A "Which API?" decision tree.** Signal vs useState vs useSignal. useSWR vs useQuery vs useFetch vs createResource. show() vs Show. each() vs For. Give me one recommended path.

4. **Fix memory leaks in useMediaQuery and useLocalStorage.** These need component lifecycle integration or explicit disposal.

5. **Fix the `show()` helper** to handle signal values properly, or document that it is not reactive and that the `Show` component should be preferred for reactive conditions.

6. **Development mode with warnings.** Console warnings for common mistakes: hook called outside component, signal read without tracking, cleanup function not returned from useEffect.

7. **DevTools.** Even a simple browser extension that shows the component tree, active signals, and effect dependencies would be transformative for debugging.

### Nice-to-Have (Would Improve DX)

8. **Immutable update helpers.** Something like `produce()` for deeply nested state updates.

9. **Error overlay in development.** A red screen with the component stack trace when something crashes, similar to React's error overlay.

10. **Hot module replacement with state preservation.** Save my form state across hot reloads.

11. **CSS scoping solution.** Even a simple convention like CSS modules or `:where(.component) {}` scoping.

12. **File-based routing implementation.** The docs describe it extensively, but I could not find an actual implementation. Ship it or remove it from the docs.

13. **A single "recommended" data fetching hook.** If `useSWR` is the recommended one, make that clear and mark the others as alternatives for specific use cases.

14. **Plugin system.** Allow third parties to add features without forking the framework.

### Long-Term Vision

15. **Component DevTools with signal graph visualization.** Show me which signals affect which DOM nodes.

16. **Type-safe routing.** Routes that give me typed params in TypeScript.

17. **First-party meta-framework.** Like Next.js is to React, or Nuxt is to Vue. A full-stack framework that handles routing, SSR, API routes, and deployment.

18. **VS Code extension.** Syntax highlighting for `client:` directives, autocomplete for framework exports, inline documentation.

---

## Final Verdict

**Rating: 7/10 for personal projects, 4/10 for production team projects.**

What Framework is an impressive technical achievement. The reactive system is elegant. The API surface is comprehensive (arguably too comprehensive). The bundle size is genuinely tiny. The islands architecture is a standout feature that most frameworks cannot match without significant effort.

For me as a junior developer, the React-compatible hooks were the bridge that let me start using the framework immediately. I could write `useState`, `useEffect`, `useMemo` and feel at home. The fact that signals power everything under the hood is interesting but does not change my day-to-day code when using the hooks API.

The biggest barriers to adoption are:

1. **Too many ways to do the same thing.** The framework needs to be more opinionated. Pick one recommendation for each use case and stick with it.
2. **No ecosystem.** No component libraries, no DevTools, no Stack Overflow answers, no tutorials beyond the README.
3. **Documentation assumes expertise.** The docs are thorough but do not hand-hold. A junior developer needs more "do this, not that" guidance.
4. **The demo code is written in h() instead of JSX.** This is the wrong foot to start on when targeting React developers.

What I would tell my team: "This is worth watching. The technical foundations are solid. But it is not ready for our production app yet. Let me experiment with it on a side project and report back in six months."

---

*Review written after reading all source files in `packages/core/src/`, all demo files in `demo/src/`, all documentation in `docs/`, and the router source in `packages/router/src/`. No code was executed; all analysis is based on source code reading.*
