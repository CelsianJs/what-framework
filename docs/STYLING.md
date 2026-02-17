# Styling in What Framework

What Framework is styling-agnostic. The recommended default is CSS-first.

## Canonical approach

1. Base styling with classes and CSS files.
2. Interaction states with CSS pseudo-classes (`:hover`, `:focus-visible`, `:active`).
3. Theming via CSS variables.
4. Use inline style objects only for dynamic runtime values.

## Class patterns

```jsx
import { cls } from 'what-framework';

function Button({ tone = 'primary', disabled = false }) {
  return (
    <button
      className={cls('btn', `btn-${tone}`, { 'is-disabled': disabled })}
      disabled={disabled}
    >
      Save
    </button>
  );
}
```

```css
.btn {
  border-radius: 10px;
  border: 1px solid transparent;
  padding: 0.6rem 1rem;
  cursor: pointer;
}

.btn-primary {
  background: #2563eb;
  color: white;
}

.btn-primary:hover {
  background: #1d4ed8;
}

.btn:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: 2px;
}
```

## Dynamic inline styles

Use inline object style for truly dynamic values:

```jsx
function Progress({ value }) {
  return (
    <div
      className="progress-bar"
      style={{ width: `${value()}%` }}
      aria-valuenow={value()}
    />
  );
}
```

The framework supports both string and object styles; docs standardize on object style in JSX.

## CSS variable theming

```css
:root {
  --surface: #ffffff;
  --text: #0f172a;
  --accent: #2563eb;
}

.theme-dark {
  --surface: #0f172a;
  --text: #e2e8f0;
  --accent: #60a5fa;
}
```

```jsx
function Card({ theme }) {
  return (
    <article className={cls('card', { 'theme-dark': theme() === 'dark' })}>
      <h2>Card</h2>
    </article>
  );
}
```

```css
.card {
  background: var(--surface);
  color: var(--text);
  border: 1px solid color-mix(in srgb, var(--text) 20%, transparent);
}
```

## Anti-pattern: JS hover/focus style mutation

Avoid this pattern:

```jsx
<button
  onMouseEnter={(e) => { e.currentTarget.style.background = '#1d4ed8'; }}
  onMouseLeave={(e) => { e.currentTarget.style.background = '#2563eb'; }}
>
  Save
</button>
```

Prefer CSS rules for interaction states. It is faster to author, easier to maintain, and avoids repeated handler boilerplate.

## When to use `style()` helper

`style(obj)` is mainly useful for SSR/string-style output in lower-level runtime code.

```js
import { style } from 'what-framework';

const cssText = style({ color: 'red', fontSize: '14px' });
```
