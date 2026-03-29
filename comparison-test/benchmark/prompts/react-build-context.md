# React 19 — Build Guide

## API

```jsx
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';

// State
const [count, setCount] = useState(0);
setCount(5);          // direct set
setCount(c => c + 1); // updater

// Derived (memoized)
const doubled = useMemo(() => count * 2, [count]);

// Side effect
useEffect(() => {
  console.log(count);
  return () => { /* cleanup */ };
}, [count]);

// Stable callback
const handleClick = useCallback(() => setCount(c => c + 1), []);
```

## Key Patterns

**Component structure:**
```jsx
function App() {
  const [theme, setTheme] = useState(() =>
    localStorage.getItem('theme') || 'light'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  return <div className="app">...</div>;
}
```

**Conditional render:** `{show && <Component />}` or `{show ? <A /> : <B />}`
**List render:** `{items.map(item => <Item key={item.id} item={item} />)}`
**Controlled input:** `<input value={text} onChange={e => setText(e.target.value)} />`
**Ref for DOM:** `const ref = useRef(null); <div ref={ref} />`
**localStorage persistence:** `useEffect(() => localStorage.setItem('k', JSON.stringify(v)), [v])`

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
npm create vite@latest . -- --template react
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
