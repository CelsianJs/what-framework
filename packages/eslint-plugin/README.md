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

### `what/no-destructured-props`

Warns when native What components destructure their props during run-once
setup. Keep the props object and read properties inside reactive bindings:

```jsx
// Bad: the label is sampled once during component setup.
function Button({ label }) { return <button>{label}</button>; }

// Good: the binding reads the current property when it updates.
function Button(props) { return <button>{() => props.label}</button>; }
```

The rule is enabled in recommended/compiler presets and is an error in strict.
It does not apply this native contract to React compatibility components or
unrelated domain/event destructuring. It does not promise the compiler will
automatically wrap arbitrary property reads; explicit accessors work in both
compiled and automatic-runtime authoring.

### `what/no-uncalled-signals`

Catches the #1 mistake for new developers: using a signal reference instead of calling it. Signals are functions -- you must call them to read the value.

```jsx
// Bad -- conditionals are always truthy; bare JSX reads rely on compiler auto-wrapping
<span>{count}</span>
{isLoading && <Spinner />}
<span>{swr.data}</span>

// Good -- explicit reads work everywhere, compiler or not
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
  'what/no-h-in-user-code': 'warn',
  'what/signal-call-in-jsx': 'warn',
  'what/no-set-in-computed': 'error',
  'what/no-destructured-props': 'warn',
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
  'what/no-h-in-user-code': 'error',
  'what/signal-call-in-jsx': 'error',
  'what/no-set-in-computed': 'error',
  'what/no-destructured-props': 'error',
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
  'what/no-h-in-user-code': 'warn',
  'what/signal-call-in-jsx': 'off',
  'what/no-set-in-computed': 'error',
  'what/no-destructured-props': ['warn', { assumeNative: true }],
}
```

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
