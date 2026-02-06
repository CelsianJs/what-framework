# What

**The closest framework to vanilla JS.**

What is a lightweight, signals-based web framework with islands architecture, SSR/SSG support, file-based routing, and a React-familiar hooks API — all in ~4kB gzipped with zero build step required.

```js
import { h, mount, signal } from 'what';

function App() {
  const count = signal(0);
  return h('div', null,
    h('h1', null, 'Count: ', () => count()),
    h('button', { onClick: () => count.set(c => c + 1) }, '+'),
  );
}

mount(h(App), '#app');
```

## Features

- **Signals** — Fine-grained reactivity. Only DOM nodes that depend on changed data update. No virtual DOM tree diffing.
- **Islands** — Zero JS by default. Hydrate interactive parts independently: on idle, on scroll, on click.
- **Tiny** — Core runtime ~4kB gzipped. No compiler, no virtual DOM, just JavaScript.
- **Familiar** — React-like hooks (useState, useEffect, useMemo) backed by signals.
- **File Routing** — Drop files in `pages/` and they become routes. Dynamic params with `[slug]`.
- **Hybrid Rendering** — Static, server, client, or hybrid — per page. Like Astro, but simpler.
- **Server Components** — Mark components as `server()` for zero client JS.
- **Zero Config** — Works out of the box. One config file when you need it.
- **No Docker** — Fast builds, simple deployment. Just HTML/CSS/JS.

## Quick Start

```bash
npx create-what my-app
cd my-app
npm install
npm run dev
```

## Documentation

- [Quick Start Guide](docs/QUICKSTART.md)
- [API Reference](docs/API.md)
- [Architecture](docs/ARCHITECTURE.md)

## Packages

| Package | Description | Size |
|---------|-------------|------|
| `@what/core` | Signals, hooks, VDom, utilities | ~3kB gzip |
| `@what/router` | Client-side routing | ~1kB gzip |
| `@what/server` | SSR, SSG, islands | ~1kB gzip |
| `what-fw` | CLI (dev, build, preview, generate) | — |
| `create-what` | Project scaffolding | — |

## Examples

### Counter

```js
import { h, mount, useState } from 'what';

function Counter() {
  const [count, setCount] = useState(0);
  return h('div', null,
    h('span', null, count),
    h('button', { onClick: () => setCount(c => c + 1) }, '+'),
  );
}

mount(h(Counter), '#app');
```

### Todo List

```js
import { h, mount, useState } from 'what';

function Todos() {
  const [todos, setTodos] = useState([]);
  const [input, setInput] = useState('');

  const add = () => {
    if (!input.trim()) return;
    setTodos(t => [...t, { id: Date.now(), text: input, done: false }]);
    setInput('');
  };

  return h('div', null,
    h('input', { value: input, onInput: e => setInput(e.target.value) }),
    h('button', { onClick: add }, 'Add'),
    h('ul', null,
      ...todos.map(t => h('li', { key: t.id }, t.text)),
    ),
  );
}

mount(h(Todos), '#app');
```

### Islands

```js
import { island, Island } from 'what/server';

island('cart', () => import('./islands/cart.js'), { mode: 'action' });

function Page() {
  return h('div', null,
    h('nav', null, 'Static nav — zero JS'),
    h(Island, { name: 'cart' }),  // Hydrates on first click
    h('footer', null, 'Static footer — zero JS'),
  );
}
```

### Global Store

```js
import { createStore } from 'what';

const useTheme = createStore({
  mode: 'light',
  toggle() { this.mode = this.mode === 'light' ? 'dark' : 'light'; },
});

function ThemeToggle() {
  const { mode, toggle } = useTheme();
  return h('button', { onClick: toggle }, mode);
}
```

## Benchmarks

Run locally: `npm run bench`

```
signal() create           4,200,000+ ops/s
signal() read             1,500,000+ ops/s
computed() create + read  1,400,000+ ops/s
effect() create + dispose 2,000,000+ ops/s
h() element               5,500,000+ ops/s
h() component call        6,900,000+ ops/s
renderToString() simple     720,000+ ops/s
```

## CLI

```bash
what dev        # Dev server with HMR
what build      # Production build (minified, tree-shaken)
what preview    # Preview production build
what generate   # Static site generation
```

## Configuration

```js
// what.config.js
export default {
  mode: 'hybrid',        // 'static' | 'server' | 'client' | 'hybrid'
  pagesDir: 'src/pages',
  outDir: 'dist',
  islands: true,
  port: 3000,
};
```

## License

MIT
