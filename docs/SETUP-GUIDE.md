# What Framework — Local Setup Guide

Get up and running with What Framework in under 5 minutes.

---

## Prerequisites

- **Node.js 18+** (check: `node -v`)
- **npm 9+** (check: `npm -v`)
- A code editor (VS Code recommended)

---

## 1. Create a New Project

```bash
npm create what@latest my-app
cd my-app
npm install
npm run dev
```

Open **http://localhost:5173** — you should see a counter app with increment/decrement buttons.

> **If that doesn't work**, try the explicit form: `npx create-what@latest my-app`
>
> Still getting errors? Clear the npx cache and retry:
> ```bash
> npx --yes create-what@latest my-app
> ```

The scaffolder will ask you:
- **React compat?** — Say yes if you want to use React libraries (zustand, TanStack, etc.)
- **CSS approach?** — Vanilla CSS, Tailwind v4, or StyleX

To skip prompts and get defaults:

```bash
npm create what@latest my-app -- --yes
```

---

## 2. Project Structure

```
my-app/
  src/
    main.jsx       ← Your app entry point
    styles.css     ← Styles
  public/
    favicon.svg
  index.html       ← HTML shell
  vite.config.js   ← Vite + What compiler plugin
  tsconfig.json    ← TypeScript config (JSX types)
  package.json
```

---

## 3. Try Editing the Counter

Open `src/main.jsx`. You'll see something like:

```jsx
import { mount, useSignal } from 'what-framework';

function App() {
  const count = useSignal(0);

  return (
    <main>
      <h1>What Framework</h1>
      <button onClick={() => count.set(c => c - 1)}>-</button>
      <output>{count()}</output>
      <button onClick={() => count.set(c => c + 1)}>+</button>
    </main>
  );
}

mount(<App />, '#app');
```

Key concepts:
- `useSignal(0)` creates a reactive signal with initial value 0
- `count()` reads the value
- `count.set(c => c + 1)` writes a new value
- The compiler handles reactivity automatically — no manual wrappers needed

Try adding a second signal, a computed value, or an effect:

```jsx
import { mount, useSignal, useComputed, useEffect } from 'what-framework';

function App() {
  const count = useSignal(0);
  const doubled = useComputed(() => count() * 2);

  useEffect(() => {
    document.title = `Count: ${count()}`;
  }, []);

  return (
    <main>
      <h1>What Framework</h1>
      <p>Count: {count()}</p>
      <p>Doubled: {doubled()}</p>
      <button onClick={() => count.set(c => c + 1)}>+1</button>
      <button onClick={() => count.set(0)}>Reset</button>
    </main>
  );
}

mount(<App />, '#app');
```

---

## 4. Build for Production

```bash
npm run build
```

Output goes to `dist/`. To preview it:

```bash
npm run preview
```

Open **http://localhost:4173**.

---

## 5. Try React Compat

This lets you use React ecosystem libraries (zustand, TanStack Query, Radix UI, Framer Motion, etc.) on What's signals engine. Zero code changes to the libraries.

### Option A: Scaffold with react compat

```bash
npm create what@latest react-app
# When prompted, say Yes to "Add React library support?"
cd react-app
npm install
npm run dev
```

This gives you a working zustand demo out of the box.

### Option B: Add to an existing project

```bash
npm install what-react
```

Update `vite.config.js`:

```js
import { defineConfig } from 'vite';
import { reactCompat } from 'what-react/vite';

export default defineConfig({
  plugins: [reactCompat()],
});
```

Now install any React library and use it in your What components:

```bash
npm install zustand
```

```jsx
import { mount, useSignal } from 'what-framework';
import { create } from 'zustand';

// Zustand store — works exactly like normal, no changes needed
const useStore = create((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
  reset: () => set({ count: 0 }),
}));

function App() {
  // Zustand hook works inside a What component
  const count = useStore((s) => s.count);
  const increment = useStore((s) => s.increment);
  const reset = useStore((s) => s.reset);

  // You can mix What signals with React libraries
  const localCount = useSignal(0);

  return (
    <main>
      <h1>What + Zustand</h1>

      <section>
        <h2>Zustand Store</h2>
        <p>Count: {count}</p>
        <button onClick={increment}>+1</button>
        <button onClick={reset}>Reset</button>
      </section>

      <section>
        <h2>What Signal</h2>
        <p>Local: {localCount()}</p>
        <button onClick={() => localCount.set(c => c + 1)}>+1</button>
      </section>
    </main>
  );
}

mount(<App />, '#app');
```

Under the hood, zustand internally imports `react` and calls `useState`/`useEffect`. The compat plugin redirects those to What's signals engine. Zustand never knows the difference — but your app is still a What app with `mount()`, signals, and the compiler.

---

## 6. Add Routing

```bash
npm install what-router
```

```jsx
import { mount } from 'what-framework';
import { Router, Link } from 'what-framework/router';

function Home() {
  return <h1>Home</h1>;
}

function About() {
  return <h1>About</h1>;
}

function App() {
  return (
    <div>
      <nav>
        <Link href="/">Home</Link>
        <Link href="/about">About</Link>
      </nav>
      <Router
        routes={[
          { path: '/', component: Home },
          { path: '/about', component: About },
        ]}
      />
    </div>
  );
}

mount(<App />, '#app');
```

---

## 7. Try a Store (Global State)

```jsx
import { mount, createStore, derived } from 'what-framework';

const useTodos = createStore({
  items: [],
  filter: 'all',

  filtered: derived(s => {
    if (s.filter === 'active') return s.items.filter(t => !t.done);
    if (s.filter === 'done') return s.items.filter(t => t.done);
    return s.items;
  }),

  add(text) {
    this.items = [...this.items, { id: Date.now(), text, done: false }];
  },
  toggle(id) {
    this.items = this.items.map(t =>
      t.id === id ? { ...t, done: !t.done } : t
    );
  },
});

function App() {
  const store = useTodos();

  return (
    <div>
      <h1>Todos ({store.items.length})</h1>
      <button onClick={() => store.add('New task')}>Add</button>
      {store.filtered.map(t => (
        <div key={t.id} onClick={() => store.toggle(t.id)}>
          {t.done ? '✓' : '○'} {t.text}
        </div>
      ))}
    </div>
  );
}

mount(<App />, '#app');
```

---

## 8. Forms

```jsx
import { mount, useForm, rules, simpleResolver, ErrorMessage } from 'what-framework';

function Signup() {
  const { register, handleSubmit, formState } = useForm({
    resolver: simpleResolver({
      email: [rules.required(), rules.email()],
      password: [rules.required(), rules.minLength(8)],
    }),
  });

  const onSubmit = (values) => {
    console.log('Form data:', values);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div>
        <input {...register('email')} placeholder="Email" />
        <ErrorMessage name="email" formState={formState} />
      </div>
      <div>
        <input {...register('password')} type="password" placeholder="Password" />
        <ErrorMessage name="password" formState={formState} />
      </div>
      <button type="submit">Sign Up</button>
    </form>
  );
}

mount(<Signup />, '#app');
```

---

## 9. Animation

```jsx
import { mount, useSignal, useRef } from 'what-framework';
import { spring } from 'what-framework';

function App() {
  const ref = useRef(null);
  if (!ref.current) {
    ref.current = spring(0, { stiffness: 200, damping: 15 });
  }
  const x = ref.current;

  return (
    <div>
      <div style={`transform: translateX(${x.current()}px); width: 80px; height: 80px; background: #7c3aed; border-radius: 12px;`} />
      <button onClick={() => x.set(x.current() === 0 ? 200 : 0)}>Animate</button>
    </div>
  );
}

mount(<App />, '#app');
```

---

## Packages Reference

| Package | What it does |
|---------|-------------|
| `what-framework` | Main package — signals, hooks, components, forms, animation, a11y |
| `what-core` | Internal engine (most users use `what-framework` instead) |
| `what-router` | Client-side routing, Link, navigate, guards |
| `what-server` | SSR, streaming, islands, static generation |
| `what-compiler` | JSX compiler (Vite + Babel plugins) |
| `what-react` | React compat — use React libraries on signals |
| `what-devtools` | Runtime signal/effect inspector |
| `eslint-plugin-what` | ESLint rules for signal bugs |
| `create-what` | Project scaffolder |
| `what-framework-cli` | Dev server, build, preview, generate |

---

## Troubleshooting

**`sh: create-what: command not found` when running npx**
→ Use the explicit version: `npx --yes create-what@latest my-app`
→ Or use npm's create shorthand: `npm create what@latest my-app`
→ Make sure you're on **npm 9+** (`npm -v`). Older npm versions have npx bugs.

**"Cannot find module 'what-framework'"**
→ Run `npm install` in your project directory.

**JSX types not working in VS Code**
→ Make sure `tsconfig.json` has `"jsxImportSource": "what-framework"`.

**Vite build fails with Babel errors**
→ Make sure `@babel/core` is in your devDependencies: `npm install -D @babel/core`

**React library not working with what-react**
→ Make sure your vite.config.js uses `reactCompat()` (not `what()`) and that `what-core` is excluded from optimizeDeps (the plugin does this automatically).

---

## Links

- GitHub: https://github.com/CelsianJs/what-framework
- npm: https://www.npmjs.com/package/what-framework
- Docs: https://whatfw.com
- React Compat: https://react.whatfw.com
