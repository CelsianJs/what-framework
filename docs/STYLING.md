# Styling in What Framework

What Framework is styling-agnostic — use any CSS approach you prefer. Here are the recommended patterns.

## Inline Styles

Use the `style` prop with an object for dynamic styles:

```js
import { h, signal } from 'what';

function Box() {
  const isExpanded = signal(false);

  return h('div', {
    style: () => ({
      padding: '20px',
      background: isExpanded() ? '#f0f0f0' : '#fff',
      transform: isExpanded() ? 'scale(1.1)' : 'scale(1)',
      transition: 'all 0.3s ease',
    }),
    onClick: () => isExpanded.set(!isExpanded()),
  }, 'Click me');
}
```

Styles can be reactive when you return a function:

```js
// Static style object
h('div', { style: { color: 'red' } })

// Reactive style (recalculates when signal changes)
h('div', { style: () => ({ opacity: visible() ? 1 : 0 }) })
```

## CSS Classes

Use the `class` prop (or `className`):

```js
import { h, signal } from 'what';
import { cls } from 'what';

function Button({ variant, disabled }) {
  return h('button', {
    class: cls('btn', `btn-${variant}`, { 'btn-disabled': disabled }),
  }, 'Click');
}
```

The `cls()` helper handles:
- Strings: `'btn'` → `'btn'`
- Conditionals: `isActive && 'active'` → `'active'` or `''`
- Objects: `{ disabled: true, primary: false }` → `'disabled'`

## CSS Modules

If using a bundler with CSS Modules support:

```js
import { h } from 'what';
import styles from './Button.module.css';

function Button({ children }) {
  return h('button', { class: styles.button }, children);
}
```

## Global CSS

Import CSS files directly (requires bundler):

```js
import './styles.css';
import { h, mount } from 'what';

function App() {
  return h('div', { class: 'container' },
    h('h1', { class: 'title' }, 'Hello')
  );
}
```

## CSS-in-JS (Inline)

For scoped styles without build tools:

```js
import { h } from 'what';

function StyledButton({ children }) {
  return h('button', {
    style: {
      padding: '12px 24px',
      border: 'none',
      borderRadius: '8px',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      fontSize: '16px',
      fontWeight: '600',
      cursor: 'pointer',
      transition: 'transform 0.2s, box-shadow 0.2s',
    },
    onMouseEnter: (e) => {
      e.target.style.transform = 'translateY(-2px)';
      e.target.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.4)';
    },
    onMouseLeave: (e) => {
      e.target.style.transform = 'translateY(0)';
      e.target.style.boxShadow = 'none';
    },
  }, children);
}
```

## Animation Utilities

Use the built-in animation primitives for dynamic styles:

```js
import { h, spring } from 'what';

function AnimatedBox() {
  const x = spring(0);
  const scale = spring(1);

  return h('div', {
    style: () => ({
      transform: `translateX(${x.current()}px) scale(${scale.current()})`,
    }),
    onMouseEnter: () => scale.set(1.1),
    onMouseLeave: () => scale.set(1),
  });
}
```

## CSS Variables (Custom Properties)

Leverage CSS variables for theming:

```js
import { h, signal } from 'what';

function ThemeProvider({ children }) {
  const isDark = signal(false);

  return h('div', {
    style: () => ({
      '--bg-color': isDark() ? '#1a1a1a' : '#ffffff',
      '--text-color': isDark() ? '#ffffff' : '#1a1a1a',
      '--primary': isDark() ? '#6366f1' : '#4f46e5',
    }),
  },
    h('button', { onClick: () => isDark.set(!isDark()) }, 'Toggle Theme'),
    children
  );
}

// Components use CSS variables
function Card({ children }) {
  return h('div', {
    style: {
      background: 'var(--bg-color)',
      color: 'var(--text-color)',
      borderRadius: '8px',
      padding: '16px',
    },
  }, children);
}
```

## Tailwind CSS

What Framework works great with Tailwind:

```js
import { h } from 'what';

function Card({ title, description }) {
  return h('div', { class: 'bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow' },
    h('h2', { class: 'text-xl font-bold text-gray-900 mb-2' }, title),
    h('p', { class: 'text-gray-600' }, description),
  );
}
```

Use `cls()` for conditional Tailwind classes:

```js
import { h, signal } from 'what';
import { cls } from 'what';

function Toggle() {
  const isOn = signal(false);

  return h('button', {
    class: () => cls(
      'px-4 py-2 rounded-full transition-colors',
      isOn() ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-700'
    ),
    onClick: () => isOn.set(!isOn()),
  }, () => isOn() ? 'ON' : 'OFF');
}
```

## Skeleton Styles

Built-in skeleton loaders come with default styles:

```js
import { h, Skeleton, SkeletonText, SkeletonCard } from 'what';

function LoadingState() {
  return h('div', null,
    h(Skeleton, { width: 200, height: 24 }),        // Shimmer effect
    h(SkeletonText, { lines: 3 }),                  // Multiple text lines
    h(SkeletonCard, { imageHeight: 200 }),          // Card placeholder
  );
}
```

Customize skeleton appearance with CSS variables:

```css
:root {
  --skeleton-base: #e0e0e0;
  --skeleton-highlight: #f0f0f0;
  --skeleton-radius: 4px;
}
```

## Best Practices

1. **Prefer CSS for static styles** — Keep inline styles for dynamic values only
2. **Use `cls()` for conditional classes** — Cleaner than string concatenation
3. **Leverage CSS variables** — Great for theming and component customization
4. **Consider co-location** — Keep component styles near component code
5. **Use transitions** — The built-in animation utilities handle this well

## Style Prop Reference

| Prop | Type | Description |
|------|------|-------------|
| `style` | `object \| () => object` | Inline styles, can be reactive |
| `class` | `string \| () => string` | CSS class names, can be reactive |
| `className` | `string \| () => string` | Alias for `class` |
