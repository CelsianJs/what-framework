# What Framework Quickstart

This is the canonical path for app teams.

## 1. Scaffold and run

```bash
npx create-what my-app
cd my-app
npm install
npm run dev
```

Open `http://localhost:5173`.

`create-what` includes Vite internally. You use `npm run dev/build/preview` and can ignore bundler internals unless you want custom tooling.

## 2. Core patterns

### Signals

```jsx
import { useSignal } from 'what-framework';

const count = useSignal(0);
count.set(1);
count.set(c => c + 1);
```

Runtime compatibility: `count(1)` also works, but docs standardize on `.set(...)`.

### Derived values

```jsx
import { useComputed } from 'what-framework';

const doubled = useComputed(() => count() * 2);
```

### Events

Use React-style casing in source:

```jsx
<button onClick={handleClick}>Click</button>
```

Runtime accepts both `onClick` and `onclick`.

## 3. Rendering patterns

### Conditionals

```jsx
{isReady() ? <Dashboard /> : <Spinner />}
```

Or:

```jsx
<Show when={isReady()} fallback={<Spinner />}>
  <Dashboard />
</Show>
```

`show()` helper is removed from the public API.

### Lists

```jsx
<ul>
  {items().map(item => <li key={item.id}>{item.name}</li>)}
</ul>
```

`<For>` is also available.

## 4. Forms

```jsx
import { useForm, ErrorMessage, rules, simpleResolver } from 'what-framework';

function Login() {
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { email: '', password: '' },
    resolver: simpleResolver({
      email: [rules.required(), rules.email()],
      password: [rules.required(), rules.minLength(8)],
    }),
  });

  return (
    <form onSubmit={handleSubmit(async (values) => console.log(values))}>
      <input {...register('email')} />
      <ErrorMessage name="email" formState={formState} />

      <input {...register('password')} type="password" />
      {formState.errors.password && (
        <span>{formState.errors.password.message}</span>
      )}

      <button type="submit">Submit</button>
    </form>
  );
}
```

`formState.errors` is a getter object. Do not call `formState.errors()`.

## 5. Styling

Default to CSS-first:

- classes + pseudo-classes (`:hover`, `:focus-visible`)
- CSS variables for theming
- `style={{ ... }}` for dynamic runtime values only

```jsx
<button className="btn btn-primary">Save</button>
<div style={{ opacity: loading() ? 0.5 : 1 }} />
```

Avoid per-element JS hover mutation handlers.

## 6. Focus management

Use `FocusTrap` for dialogs and `useFocusRestore` in parent logic:

```jsx
import { useSignal, useFocusRestore, FocusTrap } from 'what-framework';

function DialogExample() {
  const open = useSignal(false);
  const focusRestore = useFocusRestore();

  const onOpen = (e) => {
    focusRestore.capture(e.currentTarget);
    open.set(true);
  };

  const onClose = () => {
    open.set(false);
    focusRestore.restore();
  };

  return (
    <>
      <button onClick={onOpen}>Open</button>
      {open() ? (
        <FocusTrap>
          <div role="dialog" aria-modal="true">
            <button onClick={onClose}>Close</button>
          </div>
        </FocusTrap>
      ) : null}
    </>
  );
}
```

## 7. Raw HTML

Both props are supported:

```jsx
<div innerHTML="<strong>Hello</strong>" />
<div dangerouslySetInnerHTML={{ __html: '<strong>Hello</strong>' }} />
```

If either prop is set, it owns that element's children.

## 8. Decision matrix

- `useComputed(fn)`: derived from signals in a component.
- `derived(fn)`: derived fields inside `createStore(...)`.
- `useMemo(fn, deps)`: dependency-array memo for non-signal values.

## 9. Runtime `h()` path (advanced)

```js
import { h, mount, signal } from 'what-framework';

function App() {
  const count = signal(0);
  return h('button', { onClick: () => count.set(c => c + 1) }, () => count());
}

mount(h(App), '#app');
```

Use this path when you intentionally want compiler-free authoring.

## 10. Migration helpers

```bash
npm run codemod:show
```

Converts `show(condition, a, b)` to `condition ? a : b`.
