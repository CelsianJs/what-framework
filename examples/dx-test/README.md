# DX Test — What Framework

Interactive test app exercising all core What Framework patterns with JSX.

## What This Tests

1. **useSignal & useComputed** -- reactive state and derived values
2. **List Rendering** -- dynamic lists with `.map()` and reactive updates
3. **Conditional Rendering** -- toggling UI with reactive function children
4. **Store (Global State)** -- `createStore` with `derived` computeds and actions
5. **useEffect & useRef** -- side effects and DOM refs (timer example)
6. **Batch Updates** -- `batch()` for grouping multiple signal writes

## Getting Started

```bash
npm install
npm run dev
# Open http://localhost:5173
```

To build for production:

```bash
npm run build
npm run preview
```

## Project Structure

```
dx-test/
  index.html          Entry HTML
  vite.config.js      Vite + what-compiler plugin
  package.json
  src/
    app.jsx           All 6 test sections in one file
```

## Key Patterns

```jsx
import { useSignal, useComputed, mount } from 'what-framework';

function Counter() {
  const count = useSignal(0);
  const doubled = useComputed(() => count() * 2);

  return (
    <div>
      <p>Count: {() => count()}</p>
      <p>Doubled: {() => doubled()}</p>
      <button onClick={() => count.set(c => c + 1)}>+1</button>
    </div>
  );
}

mount(<Counter />, '#app');
```
