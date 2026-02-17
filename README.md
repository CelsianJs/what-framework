# What Framework

The closest framework to vanilla JS, with a React-familiar authoring experience.

- Fine-grained reactivity (signals)
- No virtual DOM diff tree
- Compiler-first JSX path (recommended)
- Optional runtime `h()` path (advanced)

## Install

```bash
npm install what-framework
```

## Fastest Start

```bash
npx create-what my-app
cd my-app
npm install
npm run dev
```

Open `http://localhost:5173`.

## JSX Setup (Manual)

```bash
npm install what-framework what-compiler
npm install -D vite
```

```js
// vite.config.js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

export default defineConfig({
  plugins: [what()],
});
```

## First App

```jsx
import { mount, useSignal, useComputed } from 'what-framework';

function Counter() {
  const count = useSignal(0);
  const doubled = useComputed(() => count() * 2);

  return (
    <main>
      <h1>What Framework</h1>
      <p>Count: {count()}</p>
      <p>Doubled: {doubled()}</p>
      <button onClick={() => count.set(c => c + 1)}>Increment</button>
      <button onClick={() => count.set(0)}>Reset</button>
    </main>
  );
}

mount(<Counter />, '#app');
```

## Canonical DX Rules

1. Default to compiler-first JSX.
2. Use `onClick` in docs/examples.
3. Runtime supports both `onClick` and `onclick` for compatibility.
4. Use signal `.set(...)` as the primary write style.
5. Runtime also supports callable writes (`sig(next)`), kept for compatibility.
6. Use ternaries or `<Show>` for conditionals.
7. `show()` helper was removed from the public API.
8. `formState.errors` is a getter object, not a function.

## Reactivity Ergonomics

Compiler-first JSX handles common reactive expressions directly:

```jsx
<p>{count()}</p>
<ul>{items().map(item => <li key={item.id}>{item.label}</li>)}</ul>
```

In advanced runtime patterns (manual `h()` / lower-level render primitives), explicit function accessors are still useful when you want isolated fine-grained updates.

## Decision Matrix

- Use `useComputed()` for values derived from signals inside components.
- Use `derived()` only inside `createStore(...)`.
- Use `useMemo()` for non-signal dependency-array memoization.

## Forms: Correct Pattern

```jsx
import { useForm, ErrorMessage } from 'what-framework';

function Signup() {
  const { register, handleSubmit, formState } = useForm();

  return (
    <form onSubmit={handleSubmit(async (values) => console.log(values))}>
      <input {...register('email')} placeholder="Email" />
      <ErrorMessage name="email" formState={formState} />

      {formState.errors.password && (
        <span>{formState.errors.password.message}</span>
      )}

      <button type="submit">Submit</button>
    </form>
  );
}
```

## `innerHTML` Rules

Both are supported:

```jsx
<div innerHTML="<strong>Hello</strong>" />
<div dangerouslySetInnerHTML={{ __html: '<strong>Hello</strong>' }} />
```

- `dangerouslySetInnerHTML` and `innerHTML` own the element children.
- Avoid mixing raw HTML props with vnode children on the same element.
- SSR supports both forms.

## Focus Management Pattern

`FocusTrap` is for trapping tab navigation inside dialogs. Use `useFocusRestore()` in the parent to capture/restore trigger focus.

```jsx
import { useSignal, useFocusRestore, FocusTrap } from 'what-framework';

function DialogExample() {
  const open = useSignal(false);
  const focusRestore = useFocusRestore();

  const openDialog = (e) => {
    focusRestore.capture(e.currentTarget);
    open.set(true);
  };

  const closeDialog = () => {
    open.set(false);
    focusRestore.restore();
  };

  return (
    <>
      <button onClick={openDialog}>Open</button>
      {open() ? (
        <FocusTrap>
          <div role="dialog" aria-modal="true">
            <button onClick={closeDialog}>Close</button>
          </div>
        </FocusTrap>
      ) : null}
    </>
  );
}
```

## Styling Guidance

CSS-first by default:

- Use classes, pseudo-classes (`:hover`, `:focus-visible`), and CSS variables.
- Use `style={{ ... }}` for truly dynamic runtime values.
- Avoid per-element JS hover/focus style mutation handlers.

See `/docs/STYLING.md`.

## Migration from `show()`

Use the codemod:

```bash
npm run codemod:show
```

This migrates `show(condition, a, b)` to `condition ? a : b` and removes `show` imports.

## Benchmark Guardrail

Run the cleanup regression gate:

```bash
npm run bench:gate
```

This checks core benchmarks + DX microbenchmarks against committed baselines.

## Release & Deploy

Canonical one-button release pipeline is GitHub Actions workflow:

- `/.github/workflows/release-and-deploy.yml`

It runs quality gates, can publish npm packages, and can deploy docs/landing surfaces to Vercel.

See `/docs/RELEASE.md` for setup and secrets.

## Packages

- `what-framework`
- `what-framework/router`
- `what-framework/server`
- `what-framework/testing`

## Docs

- `/GETTING-STARTED.md`
- `/docs/QUICKSTART.md`
- `/docs/API.md`
- `/docs/STYLING.md`
- `/docs/GOTCHAS.md`
- `/docs/DEVELOPMENT.md`
- `/docs/RELEASE.md`
