# What Framework — API Reference

## Core (`what`)

### Reactive Primitives

#### `signal(initialValue)`
Creates a reactive signal.

```js
const count = signal(0);
count();           // read → 0
count.set(5);      // write
count.set(c => c + 1);  // updater
count.peek();      // read without tracking
count.subscribe(fn); // subscribe to changes, returns unsubscribe fn
```

#### `computed(fn)`
Creates a derived signal. Lazy — only recomputes when read after deps change.

```js
const doubled = computed(() => count() * 2);
doubled();      // read
doubled.peek(); // read without tracking
```

#### `effect(fn)`
Runs `fn` immediately, re-runs when any signal read inside changes. Returns a dispose function.

```js
const dispose = effect(() => {
  console.log(count());
});
dispose(); // stop
```

#### `batch(fn)`
Groups signal writes. Effects only run once at the end.

```js
batch(() => {
  a.set(1);
  b.set(2);
  // effects that read a or b run once here, not twice
});
```

#### `untrack(fn)`
Reads signals inside `fn` without subscribing.

```js
effect(() => {
  const val = untrack(() => someSignal());
  // effect won't re-run when someSignal changes
});
```

---

### Virtual DOM

#### `h(tag, props, ...children)`
Creates a virtual DOM node.

```js
h('div', { class: 'box' }, 'Hello')
h('input', { type: 'text', onInput: (e) => {} })
h(MyComponent, { name: 'World' })
```

**Props handling:**
- `class` / `className` → `el.className`
- `style` (string or object) → `el.style`
- `on*` → event listeners (`onClick` → `click`)
- `ref` → `ref.current = el` or `ref(el)`
- `key` → used for list reconciliation (stripped from props)
- `dangerouslySetInnerHTML` → `el.innerHTML`
- `data-*`, `aria-*` → attributes
- Booleans: `true` → attribute present, `false` → removed

#### `Fragment`
Renders children without a wrapper element.

```js
h(Fragment, null, h('li', null, 'A'), h('li', null, 'B'))
```

#### `html` (tagged template)
No-build alternative to JSX.

```js
const vnode = html`<div class="box">${content}</div>`;
```

#### `mount(vnode, container)`
Mounts a VNode tree into a DOM element.

```js
const unmount = mount(h(App), '#app');
// or
const unmount = mount(h(App), document.getElementById('app'));
unmount(); // remove and clean up
```

---

### Hooks

All hooks must be called inside a component function.

#### `useState(initial)`
```js
const [value, setValue] = useState(0);
setValue(5);            // direct
setValue(prev => prev + 1); // updater
```

#### `useSignal(initial)`
Returns a raw signal. More efficient than useState (no array allocation).
```js
const count = useSignal(0);
count();       // read (triggers re-render)
count.set(5);  // write
```

#### `useComputed(fn)`
```js
const doubled = useComputed(() => count() * 2);
doubled(); // read
```

#### `useEffect(fn, deps)`
```js
useEffect(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id); // cleanup
}, [dependency]);

useEffect(() => { /* runs every render */ });
useEffect(() => { /* runs once */ }, []);
```

#### `useMemo(fn, deps)`
```js
const expensive = useMemo(() => computeValue(a, b), [a, b]);
```

#### `useCallback(fn, deps)`
```js
const handler = useCallback((e) => doStuff(e, dep), [dep]);
```

#### `useRef(initial)`
```js
const ref = useRef(null);
h('input', { ref }); // ref.current = <input>
```

#### `useReducer(reducer, initialState, init?)`
```js
const [state, dispatch] = useReducer(
  (state, action) => {
    switch (action.type) {
      case 'inc': return { count: state.count + 1 };
    }
  },
  { count: 0 }
);
dispatch({ type: 'inc' });
```

#### `createContext(defaultValue)` / `useContext(ctx)`
```js
const ThemeCtx = createContext('light');
// Provider
h(ThemeCtx.Provider, { value: 'dark' }, children)
// Consumer
const theme = useContext(ThemeCtx);
```

---

### Component Utilities

#### `memo(Component, areEqual?)`
Skips re-render if props haven't changed.
```js
const MemoComp = memo(MyComponent);
const MemoComp = memo(MyComponent, (prev, next) => prev.id === next.id);
```

#### `lazy(loader)`
Code-split a component.
```js
const LazyPage = lazy(() => import('./pages/heavy.js'));
h(Suspense, { fallback: h('p', null, 'Loading...') }, h(LazyPage))
```

#### `Suspense({ fallback, children })`
Shows fallback while lazy children load.

#### `ErrorBoundary({ fallback, children })`
Catches errors in children.
```js
h(ErrorBoundary, {
  fallback: ({ error }) => h('p', null, 'Error: ', error.message),
}, h(RiskyComponent))
```

---

### Store

#### `createStore(definition)`
```js
const useCounter = createStore({
  count: 0,                              // state
  doubled: (state) => state.count * 2,   // computed
  increment() { this.count++; },         // action
});

const { count, doubled, increment } = useCounter();
```

#### `atom(initial)`
Simple global signal.
```js
const theme = atom('light');
theme();       // read
theme.set('dark'); // write
```

---

### Head Management

#### `Head({ title, meta, link })`
```js
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

---

### Utilities

#### `show(condition, vnode, fallback?)`
```js
show(isLoggedIn, h(Dashboard), h(Login))
```

#### `each(list, renderFn, keyFn?)`
```js
each(items, (item) => h('li', null, item.name), (item) => item.id)
```

#### `cls(...args)`
```js
cls('btn', isActive && 'active', { disabled, primary })
// → 'btn active primary'
```

#### `debounce(fn, ms)` / `throttle(fn, ms)`
```js
const debouncedSearch = debounce((q) => search(q), 300);
```

#### `useMediaQuery(query)`
```js
const isMobile = useMediaQuery('(max-width: 768px)');
isMobile(); // true/false, reactive
```

#### `useLocalStorage(key, initial)`
```js
const theme = useLocalStorage('theme', 'light');
theme();       // read from localStorage
theme.set('dark'); // syncs to localStorage
```

#### `Portal({ target, children })`
```js
h(Portal, { target: '#modal-root' }, h(Modal))
```

---

## Router (`what/router`)

#### `Router({ routes, fallback })`
#### `Link({ href, replace?, children })`
#### `navigate(to, opts?)`
#### `route` — reactive route state
#### `defineRoutes(config)`
#### `guard(checkFn, fallback)`
#### `prefetch(href)`
#### `Redirect({ to })`

---

## Server (`what/server`)

#### `renderToString(vnode)`
#### `renderToStream(vnode)` — async iterator
#### `definePage(config)` — per-page rendering mode
#### `server(Component)` — mark as server component
#### `island(name, loader, opts)` — register island
#### `Island({ name, props, mode })` — render island placeholder
#### `hydrateIslands()` — client-side hydration
#### `autoIslands(registry)` — auto-discover and hydrate
