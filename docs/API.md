# What Framework API Reference

This page reflects the current public API for `what-framework`.

## Conventions

- Docs standardize on `onClick` event casing.
- Runtime accepts `onClick` and `onclick`.
- Primary signal write style is `.set(...)`.
- Callable signal writes are supported for compatibility.
- `show()` helper is removed.

---

## Reactivity

| Export | Type | Notes |
|---|---|---|
| `signal(initial)` | `Signal<T>` | Getter/setter signal (`sig()`, `sig.set(...)`, `sig(...)`) |
| `computed(fn)` | `Computed<T>` | Lazy derived value |
| `effect(fn)` | `() => void` | Reactive side-effect + disposer |
| `signalMemo(fn)` | `Computed<T>` | Eager memoized computed |
| `batch(fn)` | `T` | Batch multiple writes |
| `untrack(fn)` | `T` | Read without dependency tracking |
| `flushSync()` | `void` | Flush pending effects synchronously |
| `createRoot(fn)` | `T` | Scoped reactive root with cleanup |

### Signal

```jsx
const count = signal(0);

count();               // read
count.set(1);          // canonical write
count.set(c => c + 1); // updater
count(2);              // compatibility write
count.peek();          // untracked read
```

---

## Rendering

| Export | Notes |
|---|---|
| `h(tag, props, ...children)` | Vnode API (compiler target — not typically called directly) |
| `Fragment` | Group children without wrapper (compiler target) |
| `html\`...\`` | Tagged template vnode API |
| `mount(vnode, container)` | Mount root vnode |

> `h()` and `Fragment` are exported because the compiler emits calls to them. You don't need to import or call them directly — write JSX and the compiler handles it.

### Fine-grained primitives

| Export | Notes |
|---|---|
| `template(html)` | Precompiled DOM template factory |
| `insert(parent, child, marker?)` | Reactive insertion helper |
| `mapArray(source, mapper, options?)` | Keyed/unkeyed list mapping |
| `spread(el, props)` | Direct prop spreading |
| `delegateEvents(names)` | Event delegation setup |
| `on(el, event, handler)` | Add/remove event helper |
| `classList(el, classes)` | Reactive class toggles |

---

## Hooks

| Export | Notes |
|---|---|
| `useState(initial)` | React-style tuple state |
| `useSignal(initial)` | Signal state hook |
| `useComputed(fn)` | Component-level computed |
| `useEffect(fn, deps?)` | Effect hook |
| `useMemo(fn, deps?)` | Dependency-array memo |
| `useCallback(fn, deps?)` | Stable callback |
| `useRef(initial)` | Mutable ref |
| `createContext(defaultValue)` | Context factory |
| `useContext(ctx)` | Read context value |
| `useReducer(reducer, initial, init?)` | Reducer hook |
| `onMount(fn)` | Mount lifecycle callback |
| `onCleanup(fn)` | Unmount lifecycle callback |
| `createResource(fetcher, options?)` | Async resource primitive |

---

## Components

| Export | Notes |
|---|---|
| `memo(component, areEqual?)` | Component memoization |
| `lazy(loader)` | Lazy component loader |
| `Suspense` | Fallback boundary for async/lazy |
| `ErrorBoundary` | Error capture boundary |
| `Show` | Conditional component |
| `For` | List component |
| `Switch` / `Match` | Conditional branch set |
| `Island` | Hydration boundary |

### Conditional patterns

```jsx
{ready() ? <Dashboard /> : <Spinner />}

<Show when={ready()} fallback={<Spinner />}>
  <Dashboard />
</Show>
```

---

## State Management

| Export | Notes |
|---|---|
| `createStore(definition)` | Store hook factory |
| `derived(fn)` | Store-level derived field marker |
| `storeComputed(fn)` | Alias of `derived` |
| `atom(initial)` | Standalone signal |

### Decision matrix

- `useComputed`: signal-derived value in component logic.
- `derived`: derived value inside store definition.
- `useMemo`: dependency-array memo for non-signal dependencies.

---

## Utilities

| Export | Notes |
|---|---|
| `each(list, fn, keyFn?)` | Deprecated helper (prefer `.map()` / `<For>`) |
| `cls(...args)` | Conditional class helper |
| `style(obj)` | CSS text helper |
| `debounce(fn, ms)` | Debounce utility |
| `throttle(fn, ms)` | Throttle utility |
| `useMediaQuery(query)` | Media-query signal |
| `useLocalStorage(key, initial)` | LocalStorage-backed signal |
| `useClickOutside(ref, handler)` | Outside-click helper |
| `Portal` | Render outside current subtree |
| `transition(name, active)` | Transition class helper |

---

## Head

| Export | Notes |
|---|---|
| `Head` | Document head management |
| `clearHead()` | Clear managed head tags |

---

## Scheduler

| Export | Notes |
|---|---|
| `scheduleRead(fn)` | Queue DOM read |
| `scheduleWrite(fn)` | Queue DOM write |
| `flushScheduler()` | Flush queues immediately |
| `measure(fn)` | Promise-wrapped read |
| `mutate(fn)` | Promise-wrapped write |
| `useScheduledEffect(readFn, writeFn?)` | Read/write split effect |
| `nextFrame()` | Next animation frame promise |
| `raf(key, fn)` | Debounced RAF by key |
| `onResize(el, cb)` | Resize observer helper |
| `onIntersect(el, cb, options?)` | Intersection observer helper |
| `smoothScrollTo(el, options?)` | Smooth scroll helper |

---

## Animation

| Export | Notes |
|---|---|
| `spring(initial?, config?)` | Spring value |
| `tween(initial?, config?)` | Tween value |
| `easings` | Easing collection |
| `useTransition(options?)` | Transition state helper |
| `useGesture(ref, handlers?)` | Gesture helper |
| `useAnimatedValue(initial?)` | Managed animated value helper |
| `createTransitionClasses(name)` | Transition class map |
| `cssTransition(config)` | CSS transition helper |

---

## Accessibility

| Export | Notes |
|---|---|
| `useFocus()` | Current focus helpers |
| `useFocusRestore()` | Capture/restore focus |
| `useFocusTrap(ref)` | Programmatic focus trap |
| `FocusTrap` | Focus trap wrapper |
| `announce(msg, options?)` | Live region announcement |
| `announceAssertive(msg)` | Assertive announcement |
| `SkipLink` | Skip link component |
| `useAriaExpanded(initial?)` | Expanded-state helpers |
| `useAriaSelected(initial?)` | Selected-state helpers |
| `useAriaChecked(initial?)` | Checked-state helpers |
| `useRovingTabIndex(countOrGetter)` | Roving tab index helper |
| `VisuallyHidden` | Screen-reader-only wrapper |
| `LiveRegion` | Live region component |
| `useId(prefix?)` | Stable id getter |
| `useIds(count, prefix?)` | Batch ids |
| `useDescribedBy(description)` | `aria-describedby` helpers |
| `useLabelledBy(label)` | `aria-labelledby` helpers |
| `Keys` | Keyboard constants |
| `onKey(key, handler)` | Key filter wrapper |
| `onKeys(keys, handler)` | Multi-key filter wrapper |

### Recommended modal pattern

- Parent captures trigger focus with `useFocusRestore().capture(...)`.
- Dialog subtree is wrapped with `<FocusTrap>`.
- Parent restores focus on close with `.restore()`.

---

## Skeleton / Loading

| Export | Notes |
|---|---|
| `Skeleton` | Base skeleton block |
| `SkeletonText` | Multi-line skeleton |
| `SkeletonAvatar` | Avatar skeleton |
| `SkeletonCard` | Card skeleton |
| `SkeletonTable` | Table skeleton |
| `IslandSkeleton` | Island placeholder skeleton |
| `useSkeleton(asyncFn, deps?)` | Async + skeleton helper |
| `Placeholder` | Generic placeholder |
| `LoadingDots` | Dot loading indicator |
| `Spinner` | SVG spinner |

---

## Data Fetching

| Export | Notes |
|---|---|
| `useFetch(url, options?)` | Simple fetch hook |
| `useSWR(key, fetcher, options?)` | SWR-style cache/revalidate hook |
| `useQuery(options)` | Query-style hook |
| `useInfiniteQuery(options)` | Infinite query hook |
| `invalidateQueries(keyOrPredicate, options?)` | Invalidate cached queries |
| `prefetchQuery(key, fetcher)` | Prefetch into cache |
| `setQueryData(key, updater)` | Set cached data |
| `getQueryData(key)` | Get cached data |
| `clearCache()` | Clear query cache |

---

## Forms

| Export | Notes |
|---|---|
| `useForm(options?)` | Form state + validation |
| `useField(name, options?)` | Single-field primitive |
| `rules` | Built-in validation rules |
| `simpleResolver(ruleMap)` | Rule-map resolver |
| `zodResolver(schema)` | Zod resolver adapter |
| `yupResolver(schema)` | Yup resolver adapter |
| `Input` / `Textarea` / `Select` / `Checkbox` / `Radio` | Bound field components |
| `ErrorMessage` | Form error component |

### Correct error access

```jsx
const { formState } = useForm();

formState.errors.email?.message; // correct
formState.error('email')?.message; // optional field accessor
```

### `ErrorMessage`

```jsx
<ErrorMessage name="email" formState={formState} />
```

Compatibility input is supported:

```jsx
<ErrorMessage name="email" errors={() => legacyErrors} />
```

---

## Raw HTML behavior

Both are supported in DOM + SSR:

```jsx
<div innerHTML="<strong>Hello</strong>" />
<div dangerouslySetInnerHTML={{ __html: '<strong>Hello</strong>' }} />
```

Rule: if either raw HTML prop is set, it owns element children.
