# TypeScript with What Framework

What Framework ships complete TypeScript definitions for all packages. This guide covers setup, configuration, and common patterns.

## Quick Setup

Projects created with `npx create-what` include TypeScript configuration out of the box.

For existing projects, add a `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "jsxImportSource": "what-core",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

Key settings:
- **`jsx: "preserve"`** — Let the What compiler handle JSX, not TypeScript
- **`jsxImportSource: "what-core"`** — Points TypeScript to What's JSX type definitions
- **`noEmit: true`** — TypeScript is for type checking only; Vite + What compiler handle the build

## File Extensions

Both `.jsx` and `.tsx` files work with the What compiler. Use `.tsx` when you want TypeScript checking:

```tsx
// src/App.tsx
import { useSignal } from 'what-framework';

function App() {
  const count = useSignal<number>(0);
  return <button onclick={() => count.set(c => c + 1)}>{count()}</button>;
}
```

## Type Definitions

All packages publish `.d.ts` files:

| Package | Types |
|---------|-------|
| `what-core` | `what-core/index.d.ts` |
| `what-framework` | Re-exports from `what-core` |
| `what-router` | `what-router/index.d.ts` |
| `what-compiler` | Build tool — no runtime types needed |

## Common Patterns

### Typed Signals

```tsx
import { useSignal, signal } from 'what-framework';

// Type is inferred from the initial value
const count = useSignal(0);           // Signal<number>
const name = useSignal('');           // Signal<string>
const user = useSignal<User | null>(null);  // Explicit generic

// Read and write are type-safe
count();           // number
count.set(5);      // OK
count.set('5');    // Type error
```

### Typed Stores

```tsx
import { createStore, derived } from 'what-framework';

interface TodoStore {
  items: Todo[];
  filter: 'all' | 'active' | 'done';
}

const useTodos = createStore({
  items: [] as Todo[],
  filter: 'all' as 'all' | 'active' | 'done',
  filtered: derived((state: TodoStore) => {
    if (state.filter === 'all') return state.items;
    return state.items.filter(t => t.done === (state.filter === 'done'));
  }),
  add(text: string) {
    this.items = [...this.items, { id: Date.now(), text, done: false }];
  },
});
```

### Typed Components

Components are regular functions — TypeScript infers everything:

```tsx
interface ButtonProps {
  label: string;
  variant?: 'primary' | 'secondary';
  onclick?: () => void;
}

function Button({ label, variant = 'primary', onclick }: ButtonProps) {
  return (
    <button class={`btn btn-${variant}`} onclick={onclick}>
      {label}
    </button>
  );
}
```

### Typed Context

```tsx
import { createContext, useContext } from 'what-framework';

interface Theme {
  primary: string;
  bg: string;
}

const ThemeContext = createContext<Theme>({ primary: '#2563eb', bg: '#fff' });

function ThemedButton() {
  const theme = useContext(ThemeContext);
  return <button style={`color: ${theme.primary}`}>Click</button>;
}
```

## IDE Support

Install the **ThenJS + What Framework** VS Code extension (`zvndev.thenjs`) for:
- Syntax highlighting for event modifiers, bindings, and directives
- Code snippets for signals, effects, components, and more
- TypeScript-aware completions

## ESLint

Add `eslint-plugin-what` for What-specific lint rules:

```bash
npm install -D eslint-plugin-what
```

```js
// eslint.config.js
import what from 'eslint-plugin-what';

export default [
  what.configs.compiler,  // Use 'compiler' preset when using what-compiler
];
```

## Troubleshooting

### "Cannot find module 'what-framework'"
Make sure the package is installed: `npm install what-framework`

### JSX types not working
Verify `jsxImportSource` is set to `what-core` in tsconfig.json, and that `what-core` is installed (it's a dependency of `what-framework`).

### Type errors in `.jsx` files
TypeScript doesn't check `.jsx` files by default. Either rename to `.tsx` or add `"allowJs": true` and `"checkJs": true` to your tsconfig.
