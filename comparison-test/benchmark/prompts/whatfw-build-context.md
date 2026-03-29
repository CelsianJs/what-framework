# What Framework — Build Guide

Signal-based reactive framework. Components run ONCE — no re-renders, no virtual DOM.

## API

```js
import { signal, effect, computed, batch, onMount, h, mount } from 'what-framework';

// State
const count = signal(0, 'count');
count()           // read
count(5)          // write
count(c => c + 1) // update

// Derived state (auto-tracks)
const doubled = computed(() => count() * 2);

// Side effects (auto-tracks)
effect(() => console.log(count()));

// Batch writes (effects run once at end)
batch(() => { a(1); b(2); });

// Components run ONCE
function Counter() {
  const count = signal(0, 'count');
  return h('div', {},
    h('span', {}, () => `Count: ${count()}`),  // reactive text
    h('button', { onclick: () => count(c => c + 1) }, 'Add'),
  );
}

mount(h(Counter, {}), '#app');
```

## Key Rules
- `signal()` for state — read with `()`, write with `(newVal)` or `(fn)`
- `computed()` for derived values — lazy, cached, auto-tracks
- `effect()` for side effects — auto-tracks, returns cleanup function
- Components run once — the function body never re-executes
- Use `() => expression` in JSX/h() for reactive text and attributes
- `signal()` works at module scope (shared store) or inside components (local)
- Import everything from `'what-framework'`
- Use `h(tag, props, ...children)` for elements or JSX with the compiler

## Patterns

**Reactive text:** `h('span', {}, () => count())`
**Reactive class:** `h('div', { class: () => active() ? 'on' : 'off' })`
**Reactive style:** `h('div', { style: () => ({ color: dark() ? '#fff' : '#000' }) })`
**Conditional render:** `() => show() ? h(Component, {}) : null`
**List render:** `() => items().map(item => h(Item, { key: item.id, item }))`
**Event handler:** `h('button', { onclick: () => count(c => c + 1) }, 'Click')`
**Cleanup in effect:** `effect(() => { const id = setInterval(fn, 1000); return () => clearInterval(id); })`
**localStorage persistence:** `effect(() => localStorage.setItem('key', JSON.stringify(value())))`
**onMount:** `onMount(() => { /* runs once after DOM ready */ return () => { /* cleanup */ } })`

## Project Setup

```json
{
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build" },
  "dependencies": { "what-framework": "latest", "what-compiler": "latest" },
  "devDependencies": { "vite": "latest" }
}
```

```js
// vite.config.js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';
export default defineConfig({ plugins: [what()] });
```

## vs React
| React | What Framework |
|---|---|
| `useState(0)` | `signal(0)` |
| `useEffect(() => {}, [deps])` | `effect(() => {})` (auto-tracks) |
| `useMemo(() => {}, [deps])` | `computed(() => {})` (auto-tracks) |
| Re-renders entire component | Component runs once, signals update DOM directly |
| `<div>{count}</div>` | `h('div', {}, () => count())` |
