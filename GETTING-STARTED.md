# Getting Started with What Framework

Set up a new project from scratch in under 2 minutes.

## 1. Create your project

```bash
mkdir my-app && cd my-app
npm init -y
```

## 2. Install dependencies

```bash
npm install what-framework
npm install -D vite
```

## 3. Configure Vite

Create `vite.config.js`:

```js
import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'what-framework',
  },
});
```

## 4. Add scripts to package.json

Make sure your `package.json` has `"type": "module"` and these scripts:

```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

## 5. Create index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My App</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

## 6. Create src/main.jsx

```jsx
import { signal, computed, mount } from 'what-framework';

function App() {
  const count = signal(0);
  const doubled = computed(() => count() * 2);

  return (
    <div>
      <h1>What Framework</h1>
      <p>{() => `Count: ${count()}`}</p>
      <p>{() => `Doubled: ${doubled()}`}</p>
      <button onclick={() => count(count() + 1)}>+</button>
      <button onclick={() => count(count() - 1)}>-</button>
    </div>
  );
}

mount(<App />, '#app');
```

## 7. Run it

```bash
npm run dev
```

Open http://localhost:5173 — you're live.

---

## How It Works

What Framework is the closest thing to vanilla JS. Components run **once** — signal reads create subscriptions that update the DOM directly. No virtual DOM, no re-renders, no dependency arrays.

### Signals (state)

```jsx
const name = signal('world');

// Read: call with no args
name()          // → 'world'

// Write: call with a value
name('What')    // sets to 'What'

// Write with updater function
name(prev => prev.toUpperCase())
```

### Computed (derived state)

```jsx
const count = signal(5);
const doubled = computed(() => count() * 2);
doubled() // → 10 (auto-updates when count changes)
```

### Reactive text in JSX

Wrap dynamic text in an arrow function so the framework can track it:

```jsx
// Reactive — updates when count changes
<p>{() => `Count is ${count()}`}</p>

// Static — only renders once
<p>{count()}</p>
```

### Event handlers

Always **lowercase** — same as native DOM:

```jsx
<button onclick={() => count(count() + 1)}>Click</button>
<input oninput={(e) => name(e.target.value)} />
<form onsubmit={handleSubmit}>
```

### Effects (side effects)

Auto-track signal dependencies — no dependency arrays needed:

```jsx
import { effect } from 'what-framework';

effect(() => {
  console.log('Count changed to', count());
  // Runs whenever count() changes
});
```

### Batch updates

Group multiple signal writes into one render pass:

```jsx
import { batch } from 'what-framework';

batch(() => {
  firstName('Jane');
  lastName('Doe');
  // Only triggers one re-render
});
```

### Lists

Use `.map()` inside a reactive wrapper:

```jsx
const items = signal(['a', 'b', 'c']);

<ul>
  {() => items().map(item => <li>{item}</li>)}
</ul>
```

### Conditional rendering

Use ternaries:

```jsx
const loggedIn = signal(false);

{() => loggedIn() ? <Dashboard /> : <Login />}
```

---

## Key Differences from React

| React | What Framework |
|-------|---------------|
| `useState(0)` | `signal(0)` |
| `useMemo(() => ..., [deps])` | `computed(() => ...)` |
| `useEffect(() => ..., [deps])` | `effect(() => ...)` |
| `onClick` | `onclick` |
| `{value}` | `{() => value()}` for reactive text |
| Re-renders entire component | Updates only the specific DOM node |
| Virtual DOM diffing | Direct DOM updates via signals |
| `useCallback` / `useMemo` needed | Not needed — no re-renders to optimize |

---

## Full Example App

Check out the demo repo: [what-framework-demo](https://github.com/zvndev/what-framework-demo)

Includes: Counter, Reactivity, Todo App, Data Fetching, Animations, and Forms.
