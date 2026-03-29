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

## CSS Patterns

Use CSS custom properties for theming:
```css
:root, [data-theme="light"] {
  --bg: #ffffff; --text: #1a1a1a; --border: #e5e7eb;
  --accent: #3b82f6; --card: #f8f9fa;
}
[data-theme="dark"] {
  --bg: #0f0f0f; --text: #e5e5e5; --border: #2a2a2a;
  --accent: #60a5fa; --card: #1a1a1a;
}
```

## Accessibility
- Add `aria-label` to icon buttons
- Use `role="group"` with `aria-label` for button groups
- Add `aria-pressed` to toggle buttons
- Use `<label>` elements for form inputs
- Respect `prefers-reduced-motion` for animations
- Use `prefers-color-scheme` as dark mode default

## Development Workflow — MCP DevTools

After writing code, start the dev server with `npm run dev` and open the app in a browser. Then use the MCP DevTools to inspect and iterate:

1. `what_connection_status` — verify browser is connected, get signal/component counts
2. `what_diagnose` — health check for errors, perf issues, reactivity problems
3. `what_page_map` — verify the full page structure and interactive elements
4. `what_look {componentId}` — check component layout, styles, dimensions without screenshots
5. `what_errors` — find runtime errors with fix suggestions
6. `what_lint {code}` — validate code before saving (works without browser)
7. `what_signals {filter}` — inspect signal values to debug state
8. `what_dependency_graph {signalId}` — trace reactive dependencies
9. `what_set_signal` + `what_diff_snapshot` — test changes and verify cascading effects

Use MCP tools instead of browser screenshots for inspecting the app — they're faster, cheaper, and return structured data.
