# Getting Started with What Framework

Canonical setup for new apps. The What compiler is required — it handles JSX transforms and automatic reactivity wrapping.

## 1. Create a project

```bash
npx create-what my-app
cd my-app
npm install
npm run dev
```

Open `http://localhost:5173`.

Bun works too: `bun create what@latest my-app`, then `bun run dev`.

`create-what` wires up Vite + the compiler automatically, so most teams never touch bundler config.

## 2. Manual setup (Vite + compiler)

```bash
mkdir my-app && cd my-app
npm init -y
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

```html
<!-- index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>What App</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

```jsx
// src/main.jsx
import { mount, useSignal, useComputed } from 'what-framework';

function App() {
  const count = useSignal(0);
  const doubled = useComputed(() => count() * 2);

  return (
    <div>
      <h1>Hello What</h1>
      <p>Count: {count()}</p>
      <p>Doubled: {doubled()}</p>
      <button onClick={() => count.set(c => c + 1)}>+</button>
      <button onClick={() => count.set(c => c - 1)}>-</button>
    </div>
  );
}

mount(<App />, '#app');
```

## 3. Important defaults

- Use `onClick` in source code and docs.
- Runtime accepts `onclick` too (compatibility).
- Prefer `sig.set(value)` and `sig.set(prev => next)`.
- Callable setters (`sig(value)`) remain supported.
- Use ternaries / `<Show>` for conditionals.
- `show()` is removed.

## 4. Reactivity mental model

The compiler handles reactive expressions automatically:

```jsx
<p>{count()}</p>
<ul>{items().map(item => <li key={item.id}>{item.name}</li>)}</ul>
```

Signal reads in JSX attributes and children are auto-wrapped — no manual `{() => ...}` needed.

## 5. Forms

`formState.errors` is a getter object:

```jsx
const { formState } = useForm();

if (formState.errors.email) {
  console.log(formState.errors.email.message);
}
```

Not:

```jsx
// wrong
formState.errors();
```

## 6. Raw HTML

Both are valid:

```jsx
<div innerHTML="<strong>Hello</strong>" />
<div dangerouslySetInnerHTML={{ __html: '<strong>Hello</strong>' }} />
```

If you use one of these props, it owns the element children.

## 7. Accessibility pattern for dialogs

Use parent-controlled focus restore:

```jsx
const focusRestore = useFocusRestore();

function openDialog(e) {
  focusRestore.capture(e.currentTarget);
  isOpen.set(true);
}

function closeDialog() {
  isOpen.set(false);
  focusRestore.restore();
}
```

Wrap dialog body with `<FocusTrap>`.

## 8. Next docs

- `/docs/QUICKSTART.md`
- `/docs/API.md`
- `/docs/STYLING.md`
- `/docs/GOTCHAS.md`
