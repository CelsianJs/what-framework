# eslint-plugin-what

ESLint rules for [What Framework](https://whatfw.com). Catches common signal bugs and enforces framework patterns. Designed for ESLint 9+ flat config.

## Install

```bash
npm install eslint-plugin-what --save-dev
```

Requires ESLint 9 or later.

## Setup

```js
// eslint.config.js
import what from 'eslint-plugin-what';

export default [
  what.configs.recommended,
];
```

## Configs

| Config | Description |
|---|---|
| `what.configs.recommended` | Balanced rules as warnings |
| `what.configs.strict` | All rules as errors + `prefer-set` |
| `what.configs.compiler` | For projects using the What compiler (disables rules the compiler handles) |

## Rules

### `what/no-uncalled-signals`

Catches the #1 mistake for new developers: using a signal reference instead of calling it. Signals are functions -- you must call them to read the value.

```jsx
// Bad -- renders "[Function]", conditionals always truthy
<span>{count}</span>
{isLoading && <Spinner />}
<span>{swr.data}</span>

// Good
<span>{count()}</span>
{isLoading() && <Spinner />}
<span>{swr.data()}</span>
```

Tracks signals from `useSignal`, `signal`, `useComputed`, `computed`, and getter fields from `useSWR`, `useFetch`, `useQuery`, `useInfiniteQuery`.

### `what/no-signal-in-effect-deps`

Prevents passing signal getters as effect dependencies. Signals are already reactive -- including them in deps arrays causes effects to re-run on every render.

```js
// Bad -- signal reference in deps causes infinite re-runs
useEffect(() => { ... }, [count]);

// Good -- rely on auto-tracking
useEffect(() => { ... }, []);
```

### `what/reactive-jsx-children`

Without the What compiler, bare signal reads in JSX capture the value once and won't update. This rule ensures dynamic values are wrapped in reactive functions.

```jsx
// Bad (without compiler) -- won't update
<p>{count()}</p>

// Good
<p>{() => count()}</p>
```

Disabled automatically in the `compiler` config preset.

### `what/no-signal-write-in-render`

Prevents writing to signals during component render, which can cause infinite re-render loops.

```jsx
// Bad
function App() {
  count.set(5); // writing during render
  return <p>{count()}</p>;
}

// Good
function App() {
  useEffect(() => { count.set(5); }, []);
  return <p>{() => count()}</p>;
}
```

### `what/no-camelcase-events`

Enforces lowercase event handler names (`onclick` instead of `onClick`). What Framework uses lowercase events natively. Disabled in the `compiler` config (the compiler normalizes events).

```jsx
// Bad
<button onClick={handler}>

// Good
<button onclick={handler}>
```

### `what/prefer-set`

Suggests using `signal.set()` instead of `signal(value)` for signal writes. Off by default (style preference).

```js
// Flagged
count(5);

// Preferred
count.set(5);
```

## Config Details

### recommended

```js
{
  'what/no-signal-in-effect-deps': 'warn',
  'what/reactive-jsx-children': 'warn',
  'what/no-signal-write-in-render': 'warn',
  'what/no-camelcase-events': 'warn',
  'what/no-uncalled-signals': 'warn',
  'what/prefer-set': 'off',
}
```

### strict

```js
{
  'what/no-signal-in-effect-deps': 'error',
  'what/reactive-jsx-children': 'error',
  'what/no-signal-write-in-render': 'error',
  'what/no-camelcase-events': 'error',
  'what/no-uncalled-signals': 'error',
  'what/prefer-set': 'warn',
}
```

### compiler

```js
{
  'what/no-signal-in-effect-deps': 'warn',
  'what/reactive-jsx-children': 'off',       // compiler handles reactive wrapping
  'what/no-signal-write-in-render': 'warn',
  'what/no-camelcase-events': 'off',          // compiler normalizes events
  'what/no-uncalled-signals': 'warn',
  'what/prefer-set': 'off',
}
```

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
