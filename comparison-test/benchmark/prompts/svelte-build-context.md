# Svelte 5 — Build Guide

## API (Runes)

```svelte
<script>
  // State
  let count = $state(0);

  // Derived (auto-tracks)
  let doubled = $derived(count * 2);

  // Side effect (auto-tracks)
  $effect(() => {
    console.log(count);
    return () => { /* cleanup */ };
  });

  // Props
  let { title, onClose } = $props();
</script>

<p>{count}</p>
<button onclick={() => count++}>Add</button>
```

## Key Patterns

**Component structure:**
```svelte
<script>
  let theme = $state(localStorage.getItem('theme') || 'light');

  $effect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  });
</script>

<div class="app">...</div>

<style>
  .app { /* scoped styles */ }
</style>
```

**Conditional render:** `{#if show}<Component />{:else}<Other />{/if}`
**List render:** `{#each items as item (item.id)}<Item {item} />{/each}`
**Controlled input:** `<input bind:value={text} />`
**Two-way binding:** `bind:value`, `bind:checked`, `bind:group`
**Event handler:** `<button onclick={handler}>` (Svelte 5 uses lowercase)
**Scoped styles:** All `<style>` blocks are component-scoped by default
**Store file:** Export $state from a .svelte.js file for shared state

## Shared State (Store)

```js
// lib/store.svelte.js
let tasks = $state([]);
let theme = $state('light');

export function getTasks() { return tasks; }
export function addTask(task) { tasks.push(task); }
export { theme };
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

## Project Setup
```
npm create vite@latest . -- --template svelte
npm install
```

## Development Workflow
After writing code, start the dev server with `npm run dev` and use Playwright browser automation to:
1. Navigate to the app URL
2. Take screenshots to verify visual output
3. Check console for errors
4. Test interactive features (clicks, drags, inputs)
5. Fix any issues found
6. Re-verify until clean
