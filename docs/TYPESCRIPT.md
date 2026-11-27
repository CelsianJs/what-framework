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
    "jsxImportSource": "what-framework",
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
- **`jsxImportSource: "what-framework"`** — Points TypeScript to What's JSX type definitions
- **`noEmit: true`** — TypeScript is for type checking only; Vite + What compiler handle the build

## File Extensions

Both `.jsx` and `.tsx` files work with the What compiler. Use `.tsx` when you want TypeScript checking:

```tsx
// src/App.tsx
import { useSignal } from 'what-framework';

function App() {
  const count = useSignal<number>(0);
  return <button onClick={() => count.set(c => c + 1)}>{count()}</button>;
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
import { signal, useSignal } from 'what-framework';

interface User {
  id: number;
  name: string;
}

// Type is inferred from the initial value
const count = signal(0);                 // Signal<number>
const user = signal<User | null>(null);  // Explicit generic

// Read and write are type-safe
count();           // number
count.set(5);      // OK; count.set('5') does not compile

// useSignal is the same inside a component body (outside one, a hook throws)
function Greeting() {
  const name = useSignal('');            // Signal<string>
  return <button onClick={() => name.set('Ada')}>{name() || 'Set name'}</button>;
}
```

### Typed Stores

```tsx
import { createStore, derived } from 'what-framework';

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

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

function TodoCount() {
  const todos = useTodos();
  return <button onClick={() => todos.add('Write docs')}>{() => todos.filtered.length} shown</button>;
}
```

The hook's object reads state and derived fields as values (`todos.filtered` is
a `Todo[]`, not a function); read them inside a reactive child or an effect to
track them. Actions assign state through `this`, and each runs as one batch.

### Typed Components

Components are regular functions — TypeScript infers everything:

```tsx
interface ButtonProps {
  label: string;
  /** Changes over time: the parent passes a signal or accessor. */
  variant?: () => 'primary' | 'secondary';
  onClick?: (e: MouseEvent) => void;
}

function Button(props: ButtonProps) {
  return (
    <button class={`btn btn-${props.variant?.() ?? 'primary'}`} onClick={(e) => props.onClick?.(e)}>
      {props.label}
    </button>
  );
}
```

Components run once. A prop whose value reads a signal (`label={name()}`) is
passed live, as a getter, so its type is the value's type (`label: string`)
and `props.label`, or a destructured `{ label }`, shows the current value
where it renders. A prop can also be typed and passed as an accessor
(`variant={variant}`), which the component calls where it renders
(`props.variant()`). A handler is called through the props
(`onClick={(e) => props.onClick?.(e)}`), so it follows the parent's current
one; `onClick={props.onClick}` is read once.

### Typed Refs and Lists

A ref to an element is typed as in React: `useRef<HTMLInputElement>(null)`
holds `HTMLInputElement | null`, null until the element mounts. `<For>`
takes the signal itself and types each row's item from it:

```tsx
import { useRef, useSignal, onMount, For } from 'what-framework';

interface Todo {
  id: number;
  text: string;
}

function TodoList() {
  const input = useRef<HTMLInputElement>(null);
  const todos = useSignal<Todo[]>([]);
  onMount(() => input.current?.focus());

  return (
    <div>
      <input ref={input} />
      <ul>
        <For each={todos}>{(todo) => <li>{todo.text}</li>}</For>
      </ul>
    </div>
  );
}
```

### Typed Forms

`useForm<Values>()` types the values the submit handler, `formState.values`
and `reset()` take. Without the type argument they are inferred from
`defaultValues`:

```tsx
import { useForm, ErrorMessage, rules, simpleResolver } from 'what-framework/form';

interface LoginValues {
  email: string;
  password: string;
}

function Login() {
  const { register, handleSubmit, formState } = useForm<LoginValues>({
    defaultValues: { email: '', password: '' },
    resolver: simpleResolver({ email: [rules.required(), rules.email()] }),
  });
  const onSubmit = async (values: LoginValues) => {
    await fetch('/api/login', { method: 'POST', body: JSON.stringify(values) });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('email')} type="email" />
      <ErrorMessage name="email" formState={formState} />
      <input {...register('password')} type="password" />
      <button type="submit">Log in</button>
    </form>
  );
}
```

### Typed Events

A handler on an element types `e.currentTarget` as that element, as React's
types do, so reading the field needs no cast:

```tsx
import { useSignal } from 'what-framework';

function Search() {
  const term = useSignal('');
  return (
    <form onSubmit={(e) => { e.preventDefault(); e.currentTarget.reset(); }}>
      <input value={term()} onInput={(e) => term.set(e.currentTarget.value)} />
    </form>
  );
}
```

`e.currentTarget` is `HTMLInputElement` on an `<input>`, `HTMLFormElement` on
a `<form>`, and the SVG element's own type inside `<svg>`. `e.target` stays
`Element`, because the event may have started at a descendant: narrow it
(`e.target instanceof HTMLButtonElement`) before reading its fields.

### Typed Routes

A parsed query is a `RouteQuery`, `Record<string, string | string[]>`: a key
the URL repeats (`?tag=a&tag=b`) holds every value. Narrow a value before you
use it as a string:

```tsx
import { route, type RouteMiddleware, type RouteQuery } from 'what-framework/router';

const first = (query: RouteQuery, key: string): string | undefined => {
  const value = query[key];
  return Array.isArray(value) ? value[0] : value;
};

function Page() {
  return <p>Page {() => first(route.query, 'page') ?? '1'}</p>;
}

const isLoggedIn = () => document.cookie.includes('session=');

// Middleware gets { path, url, params, query, route }; `url` is the whole
// destination, path + search + hash.
const requireLogin: RouteMiddleware = ({ url }) =>
  isLoggedIn() || `/login?next=${encodeURIComponent(url)}`;
```

A route list typed as `RouteConfig[]` types each route's `preload` context
(`params`, `query`, `url`). A page gets what its `preload` returned as `data`:
`RouteComponentProps<T>` types it as `T`, optional because a route without
`preload` has none (`RouteComponentProps` alone leaves it `any`):

```tsx
import { Router, type RouteComponentProps, type RouteConfig } from 'what-framework/router';
import { query } from 'what-framework/data';

interface User {
  id: number;
  name: string;
}

const loadUser = (id: string) =>
  query(['user', id], (key, { signal }) => fetch(`/api/users/${key[1]}`, { signal }).then((r) => r.json() as Promise<User>));

function UserPage({ data }: RouteComponentProps<ReturnType<typeof loadUser>>) {
  return <h1>{data?.()?.name}</h1>;
}

const routes: RouteConfig[] = [
  { path: '/users/:id', preload: ({ params }) => loadUser(params.id), component: UserPage },
];

export function App() {
  return <Router routes={routes} />;
}
```

Without the `RouteConfig[]` annotation, `({ params })` in `preload` is an
implicit `any` under `strict`.

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

There is no What-specific editor extension; none is needed. The editor's own
TypeScript service reads What's JSX types through `jsxImportSource`, so
completions, hover types and errors work in `.tsx` files. A scaffolded app's
`.vscode/settings.json` points VS Code at the project's TypeScript
(`typescript.tsdk`), and its `.vscode/extensions.json` recommends VS Code's
ESLint extension, which shows eslint-plugin-what's warnings as you type.

## ESLint

A project made by create-what lints `.ts` and `.tsx` files out of the box:
its `eslint.config.js` layers typescript-eslint's parser over them, and the
What rules check them as they check `.jsx`. Unused variables are reported
(typescript-eslint's rule in TypeScript files, which counts a name used only
as a type).

In a project of your own:

```bash
npm install -D eslint eslint-plugin-what typescript-eslint
```

```js
// eslint.config.js
import what from 'eslint-plugin-what';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist', 'node_modules'] },
  what.configs.compiler,  // 'compiler' with what-compiler, 'recommended' without
  { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } },
];
```

Without the parser layer, the first piece of TypeScript syntax stops
`npm run lint` with `Parsing error: Unexpected token`.

## Troubleshooting

### "Cannot find module 'what-framework'"
Make sure the package is installed: `npm install what-framework`

### JSX types not working
Verify `jsxImportSource` is set to `what-framework` in tsconfig.json, and that `what-framework` is installed.

### Type errors in `.jsx` files
TypeScript doesn't check `.jsx` files by default. Either rename to `.tsx` or add `"allowJs": true` and `"checkJs": true` to your tsconfig.
