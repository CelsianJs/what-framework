# What Framework Quickstart

Get a WhatFW app running in under 2 minutes. This guide covers both human developers and AI agents.

## 1. Scaffold and Run

```bash
npm create what@latest my-app
cd my-app
npm install
npm run dev
```

Open `http://localhost:5173`.

`create-what` includes Vite + the What compiler. You use `npm run dev/build/preview` and can ignore bundler internals unless you want custom tooling.

Bun works too: `bun create what@latest my-app`, then `bun run dev`.

## 2. MCP Setup (for AI Agents)

If you are an AI agent (Claude Code, Cursor, etc.), add the MCP servers for documentation and live debugging.

### Documentation Server

```json
{
  "mcpServers": {
    "what-framework": {
      "command": "npx",
      "args": ["what-mcp"]
    }
  }
}
```

This gives you 13 tools for querying API docs, examples, and guidance.

### Live DevTools (Optional)

For runtime debugging, add the DevTools MCP server:

```json
{
  "mcpServers": {
    "what-devtools": {
      "command": "npx",
      "args": ["what-devtools-mcp"]
    }
  }
}
```

And add the Vite plugin to your app:

```js
// vite.config.js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';
import whatDevToolsMCP from 'what-devtools-mcp/vite-plugin';

export default defineConfig({
  plugins: [what(), whatDevToolsMCP()],
});
```

Now you can inspect signals, effects, components, DOM, and cache at runtime. See `/docs/MCP-DEVTOOLS.md` for the full tool reference.

## 3. Core Patterns

### Signals

```jsx
import { useSignal } from 'what-framework';

const count = useSignal(0);
count.set(1);
count.set(c => c + 1);
```

Runtime compatibility: `count(1)` also works, but docs standardize on `.set(...)`.

### Derived Values

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

## 4. Rendering Patterns

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

`<For>` is also available for keyed list rendering with LIS-based reconciliation.

## 5. Forms

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

## 6. Styling

Default to CSS-first:

- classes + pseudo-classes (`:hover`, `:focus-visible`)
- CSS variables for theming
- `style={{ ... }}` for dynamic runtime values only

```jsx
<button className="btn btn-primary">Save</button>
<div style={{ opacity: loading() ? 0.5 : 1 }} />
```

Avoid per-element JS hover mutation handlers.

## 7. Focus Management

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

## 8. Raw HTML

Both props are supported:

```jsx
<div innerHTML={{ __html: '<strong>Hello</strong>' }} />
<div dangerouslySetInnerHTML={{ __html: '<strong>Hello</strong>' }} />
```

If either prop is set, it owns that element's children.

## 9. Decision Matrix

- `useComputed(fn)`: derived from signals in a component.
- `derived(fn)`: derived fields inside `createStore(...)`.
- `useMemo(fn, deps)`: dependency-array memo for non-signal values.

## 10. TypeScript

Projects scaffolded with `create-what` include a `tsconfig.json` pre-configured for What Framework. Rename `.jsx` files to `.tsx` to enable type checking:

```tsx
import { useSignal } from 'what-framework';

function Counter() {
  const count = useSignal<number>(0);
  return <button onClick={() => count.set(c => c + 1)}>{count()}</button>;
}
```

Key tsconfig settings: `"jsx": "preserve"` (compiler handles JSX), `"jsxImportSource": "what-framework"`.

See [TYPESCRIPT.md](./TYPESCRIPT.md) for the full guide.

## 11. Tooling

- **ESLint**: `npm i -D eslint-plugin-what` -- catches signal bugs, enforces patterns
- **VS Code**: Install `eslint-plugin-what` for editor integration
- **DevTools**: `npm i -D what-devtools` -- signal inspector panel for development
- **MCP DevTools**: `npx what-devtools-mcp` -- AI agent debugging bridge

## 12. Next Docs

- `/Agents.md` -- Complete agent coding guide
- `/docs/API.md` -- Full API reference
- `/docs/GOTCHAS.md` -- Common mistakes
- `/docs/MCP-DEVTOOLS.md` -- MCP tools reference
- `/docs/AGENT-PATTERNS.md` -- Agent best practices
- `/docs/STYLING.md` -- Styling guide
