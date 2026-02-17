# What Framework — Agent Guide

Use this guide when generating or reviewing What Framework code.

## Canonical defaults

1. Use package imports from `what-framework`.
2. Prefer compiler-first JSX.
3. Use `onClick` style event casing in code generation.
4. Runtime supports both `onClick` and `onclick`.
5. Prefer signal writes with `.set(...)`.
6. Runtime compatibility callable writes (`sig(next)`) remain valid.
7. Use ternaries or `<Show>` for conditions.
8. Do not generate `show(...)` (removed API).
9. `formState.errors` is a getter object, never `formState.errors()`.
10. Prefer CSS-first styling. Avoid JS hover style mutation handlers.

## Quick setup

```bash
npm install what-framework
```

For JSX projects:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "what-framework"
  }
}
```

## Recommended authoring

```jsx
import { mount, useSignal, useComputed } from 'what-framework';

function Counter() {
  const count = useSignal(0);
  const doubled = useComputed(() => count() * 2);

  return (
    <div>
      <p>Count: {count()}</p>
      <p>Doubled: {doubled()}</p>
      <button onClick={() => count.set(c => c + 1)}>Increment</button>
    </div>
  );
}

mount(<Counter />, '#app');
```

## Decision matrix

- `useComputed(fn)`: derived from signals in component scope.
- `derived(fn)`: derived fields inside `createStore(...)`.
- `useMemo(fn, deps)`: dependency-array memo for non-signal values.

## Forms

```jsx
const { register, handleSubmit, formState } = useForm();

<form onSubmit={handleSubmit(onSubmit)}>
  <input {...register('email')} />
  {formState.errors.email && <span>{formState.errors.email.message}</span>}
</form>
```

`ErrorMessage` helper:

```jsx
<ErrorMessage name="email" formState={formState} />
```

## Focus management

- Wrap dialogs with `<FocusTrap>`.
- Capture and restore trigger focus from parent logic with `useFocusRestore()`.

## Raw HTML

Both are supported:

```jsx
<div innerHTML="<strong>Hello</strong>" />
<div dangerouslySetInnerHTML={{ __html: '<strong>Hello</strong>' }} />
```

If either prop is set, it owns that element's children.

## Stack note

Focus scope for this guide is frontend What Framework only.

- `what-framework` (frontend)
- `celsian` (backend; out of scope here)
- `thenjs` (meta-framework; out of scope here)
