# Gotchas and Footguns

Updated for the DX cleanup release.

## 1. `show()` is gone

Use ternaries or `<Show>`.

```jsx
// good
{isOpen() ? <Modal /> : null}
```

Run migration codemod:

```bash
npm run codemod:show
```

## 2. `formState.errors` is a getter object

```jsx
// good
formState.errors.email?.message

// wrong
formState.errors().email
```

## 3. Event casing in source vs runtime

- Source/docs: use `onClick`.
- Runtime compatibility: `onclick` still works.

## 4. Signal setter style

Docs standardize on `.set(...)`:

```jsx
count.set(c => c + 1)
```

Callable writes are still supported for compatibility:

```jsx
count(c => c + 1)
```

## 5. `useComputed` vs `derived` vs `useMemo`

- `useComputed`: component-level signal-derived values.
- `derived`: store-level derived fields inside `createStore`.
- `useMemo`: dependency-array memo for non-signal inputs.

Using the wrong one often causes confusion about when recomputation occurs.

## 6. Raw HTML props own element children

Both are valid:

```jsx
<div innerHTML="<strong>Hello</strong>" />
<div dangerouslySetInnerHTML={{ __html: '<strong>Hello</strong>' }} />
```

If you use either prop, do not rely on vnode children in the same element.

## 7. Dialog focus restore should be parent-controlled

`FocusTrap` handles trapping. Parent logic should capture and restore focus with `useFocusRestore()`.

## 8. CSS-first interactions are preferred

Avoid repeated per-element JS hover/focus style mutation handlers. Use CSS pseudo-classes and classes instead.
