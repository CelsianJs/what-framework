# Getting Started with What Framework

The first framework built for AI agents. Small API, MCP DevTools, structured errors, compiler guardrails.

## For AI Agents (Claude Code, Cursor, etc.)

### Step 1: Add MCP Servers

Add to your MCP client configuration:

**Claude Code** (`~/.claude/claude_desktop_config.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "what-framework": {
      "command": "npx",
      "args": ["what-mcp"]
    },
    "what-devtools": {
      "command": "npx",
      "args": ["what-devtools-mcp"]
    }
  }
}
```

**Cursor** (`.cursor/mcp.json` in your project root):

```json
{
  "mcpServers": {
    "what-framework": {
      "command": "npx",
      "args": ["what-mcp"]
    },
    "what-devtools": {
      "command": "npx",
      "args": ["what-devtools-mcp"]
    }
  }
}
```

The `what-mcp` server provides 13 documentation tools. The `what-devtools-mcp` server provides 18 live debugging tools.

### Step 2: Create a Project

```bash
npm create what@latest my-app
cd my-app
npm install
npm run dev
```

### Step 3: Enable Live Debugging

Add the DevTools Vite plugin for runtime inspection:

```js
// vite.config.js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';
import whatDevToolsMCP from 'what-devtools-mcp/vite-plugin';

export default defineConfig({
  plugins: [what(), whatDevToolsMCP({ port: 9229 })],
});
```

Now the agent can use `what_connection_status`, `what_signals`, `what_diagnose`, and 15 other tools to inspect the running app.

### Step 4: Read the Agent Guide

See `/Agents.md` for the complete agent coding reference:
- 10 copy-paste patterns
- MCP tools reference with examples
- Top 10 agent mistakes
- Decision matrices

---

## For Developers

### 1. Create a Project

```bash
npm create what@latest my-app
cd my-app
npm install
npm run dev
```

Open `http://localhost:5173`.

Bun works too: `bun create what@latest my-app`, then `bun run dev`.

`create-what` wires up Vite + the compiler automatically, so most teams never touch bundler config.

### 2. Manual Setup (Vite + Compiler)

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

### 3. Important Defaults

- Use `onClick` in source code and docs.
- Runtime accepts `onclick` too (compatibility).
- Prefer `sig.set(value)` and `sig.set(prev => next)`.
- Callable setters (`sig(value)`) remain supported.
- Use ternaries / `<Show>` for conditionals.
- `show()` is removed.

### 4. Reactivity Mental Model

The compiler handles reactive expressions automatically:

```jsx
<p>{count()}</p>
<ul>{items().map(item => <li key={item.id}>{item.name}</li>)}</ul>
```

Signal reads in JSX attributes and children are auto-wrapped -- no manual `{() => ...}` needed.

### 5. Forms

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

### 6. Raw HTML

Both are valid:

```jsx
<div innerHTML={{ __html: '<strong>Hello</strong>' }} />
<div dangerouslySetInnerHTML={{ __html: '<strong>Hello</strong>' }} />
```

If you use one of these props, it owns the element children.

### 7. Accessibility Pattern for Dialogs

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

### 8. Next Docs

- `/docs/QUICKSTART.md` -- Detailed quickstart
- `/docs/API.md` -- Full API reference
- `/docs/GOTCHAS.md` -- Common mistakes
- `/docs/STYLING.md` -- Styling guide
- `/Agents.md` -- Agent coding guide
