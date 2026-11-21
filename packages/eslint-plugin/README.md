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
  what.configs.compiler, // or what.configs.recommended without what-compiler
];
```

Each preset is a complete flat-config entry: it carries its own `files` glob
(`**/*.{js,jsx,ts,tsx}`) and turns on JSX parsing. TypeScript syntax also needs
a TypeScript parser layered on top, such as typescript-eslint.

## Configs

| Config | Description |
|---|---|
| `what.configs.compiler` | For projects compiled with what-compiler, as a create-what SPA is: turns off the rules the compiler makes unnecessary (`reactive-jsx-children`, `no-camelcase-events`, `signal-call-in-jsx`) and declares `For`, `Show`, `Switch` and `Match` as globals, since the compiler lowers them without an import |
| `what.configs.recommended` | For JSX without the compiler (the automatic runtime, as the islands template uses) and `h()` code: most rules warn; `no-moved-imports`, `no-effect-self-write` and `no-set-in-computed` are errors |
| `what.configs.strict` | Every rule `recommended` turns on, as an error, plus `prefer-set`, `signal-debug-name` and `prefer-computed` as warnings |

Rules that match a catalogue code carry it in `meta.docs.code`.
what-devtools-mcp's `what_lint` runs these same rules, with the `compiler`
preset, and reports each finding with that code.

## Rules

### `what/no-moved-imports`

In 0.15 the root entry (`what-framework`, and `what-core` alike) kept the core
API: the domain kits moved to subpaths, a few names were renamed and some were
removed (`ERR_MOVED_IMPORT`). The rule reports each such name imported from the
root entry with the answer `IMPORT_CHANGES` in `what-core/internal` records,
the same table docs/UPGRADING.md lists and what-compiler's Vite plugin fails the
build with. Before the fix:

<!-- snippet: bad lint=ERR_MOVED_IMPORT -->
```js
import { signal, useForm, Spinner, useTransition as animate } from 'what-framework';
```

`eslint --fix` splits the import per destination:

```js
import { signal } from 'what-framework';
import { useForm } from 'what-framework/form';
import { Spinner } from 'what-framework/ui';
import { useTween as animate } from 'what-framework/motion';
```

The fix keeps `as` aliases and `type` modifiers, keeps a renamed name's local
binding (`useTransition` becomes `useTween as useTransition`), moves an import
from `what-core` to the `what-core/<kit>` twin, and rewrites re-exports
(`export { … } from 'what-framework'`) the same way. A removed name, such as
`getCollectedErrors`, has no destination: it is reported with its replacement
and left for you to change. The rule is an error in every preset.

### `what/no-effect-self-write`

An effect that reads a signal and writes the same signal re-triggers itself on
every run until the engine stops the flush (reported live as
`ERR_INFINITE_EFFECT`):

<!-- snippet: bad lint=ERR_INFINITE_EFFECT -->
```js
import { signal, effect } from 'what-framework';

const count = signal(0, 'count');
effect(() => { count(count() + 1); }); // reads count, then writes it: runs again
```

Reads inside `untrack()`, through `peek()` or in an updater function do not
subscribe:

```js
import { signal, effect, untrack } from 'what-framework';

const count = signal(0, 'count');
effect(() => { count(untrack(count) + 1); });
```

A write guarded by a test of the same signal, whose value does not depend on
that signal, settles after one re-run and is not reported:
`if (count() > 9) count(0)`, `if (open()) open(false)`.

### `what/effect-cleanup`

An effect that adds an event listener or starts an interval returns a cleanup
(or calls `onCleanup()`), so a re-run or an unmount does not leave the old one
running (`ERR_MISSING_CLEANUP`). This effect never removes its listener:

<!-- snippet: bad lint=ERR_MISSING_CLEANUP -->
```js
import { signal, effect } from 'what-framework';

const width = signal(window.innerWidth, 'width');
const onResize = () => width(window.innerWidth);

effect(() => {
  window.addEventListener('resize', onResize);
});
```

Return the function that undoes it:

```js
import { signal, effect } from 'what-framework';

const width = signal(window.innerWidth, 'width');
const onResize = () => width(window.innerWidth);

effect(() => {
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
});
```

### `what/no-unsafe-innerhtml`

`innerHTML` takes the explicit `{ __html: content }` marker; the runtime refuses
a raw value (`ERR_UNSAFE_INNERHTML`):

<!-- snippet: bad lint=ERR_UNSAFE_INNERHTML -->
```jsx
function Bio(props) {
  return <div innerHTML={props.html} />;
}
```

Pass the marker, with content you trust or have sanitized, or render the
content as text:

```jsx
function Bio(props) {
  return <div innerHTML={{ __html: props.html }} />;
}
```

### `what/signal-debug-name` and `what/prefer-computed`

Hints, off except in `strict`: a module-scope `signal()` without a debug name
shows as `signal_N` in devtools, and an effect whose only job is to write one
signal is a `computed()`.

### `what/no-uncalled-signals`

Catches the #1 mistake for new developers: using a signal where its value was
meant (`ERR_MISSING_SIGNAL_READ`). Signals are functions: call them to read the
value. A signal in a condition is always truthy, and in a template literal or
arithmetic it is the function's source text:

<!-- snippet: bad lint=ERR_MISSING_SIGNAL_READ -->
```jsx
import { signal, useState } from 'what-framework';

const isLoading = signal(false, 'isLoading');

function Status() {
  const [count] = useState(0);
  return (
    <p title={`Count: ${count}`}>
      {isLoading && <em>Loading…</em>}
      {count + 1}
    </p>
  );
}
```

Call the signal where its value is meant. A signal that is the whole JSX child
or attribute value (`{count}`, `title={count}`) is a live binding, with the
compiler or without it, and is not reported:

```jsx
import { signal, useState } from 'what-framework';

const isLoading = signal(false, 'isLoading');

function Status() {
  const [count] = useState(0);
  return (
    <p title={() => `Count: ${count()}`}>
      {() => isLoading() && <em>Loading…</em>}
      {count}
      {() => count() + 1}
    </p>
  );
}
```

Tracks signals from `signal`, `computed`, `useSignal`, `useComputed` and
`useMemo`, the accessor `useState`, `useReducer` and `createResource` return
first, and the getter fields of `useSWR`, `useFetch`, `useQuery` and
`useInfiniteQuery`. A name where it is declared, destructured or exported is not
a read and is not reported. `what/signal-call-in-jsx` reports the condition case
in JSX (`{isLoading && …}`, `{open ? … : …}`) with the same code; the `compiler`
preset turns it off and keeps this rule.

### `what/no-signal-read-in-effect-deps`

`useEffect(fn, deps)` re-runs when an accessor listed in `deps` changes. A signal
read there (`count()`) is the value at setup, which never changes in a component
that runs once, so the effect never re-runs for it; the runtime reports the same
mistake as `ERR_EFFECT_DEP_NOT_FUNCTION`. The fix replaces `count()` with
`count`. Tracks the accessors `useState`, `useReducer` and `useMemo` return too.

<!-- snippet: bad lint=ERR_EFFECT_DEP_NOT_FUNCTION -->
```jsx
import { useState, useEffect } from 'what-framework';

function Title() {
  const [count] = useState(0);
  useEffect(() => { document.title = `Count: ${count()}`; }, [count()]);
  return null;
}
```

```jsx
import { useState, useEffect } from 'what-framework';

function Title() {
  const [count] = useState(0);
  useEffect(() => { document.title = `Count: ${count()}`; }, [count]);
  // or no array at all: useEffect tracks the signals it reads
  useEffect(() => { document.title = `Count: ${count()}`; });
  return null;
}
```

### `what/reactive-jsx-children`

Without the What compiler, JSX becomes `h()` calls, and a signal read as a JSX
child (`{count()}`) is evaluated once, when the component runs: the text never
updates. The rule flags such a read; it reports this component:

```jsx
import { signal } from 'what-framework';

const count = signal(0, 'count');

function Count() {
  return <p>{count()}</p>;
}
```

Without the compiler, wrap the read in a function, which becomes a binding that
updates:

```jsx
import { signal } from 'what-framework';

const count = signal(0, 'count');

function Count() {
  return <p>{() => count()}</p>;
}
```

Off in the `compiler` preset, and silenced by the rule's `{ hasCompiler: true }`
option: the compiler turns `{count()}` into a binding itself.

### `what/no-signal-write-in-render`

Flags a signal write that runs while a component renders: in its body, or in
a callback that runs right there (an IIFE, `untrack()`, `batch()`, an array
method). A write in an event handler (inline or named), an effect, `onMount`
or a store action runs later and is fine (`ERR_SIGNAL_WRITE_IN_RENDER`).

<!-- snippet: bad lint=ERR_SIGNAL_WRITE_IN_RENDER -->
```jsx
import { signal } from 'what-framework';

const count = signal(0, 'count');

function App() {
  count.set(5); // runs while App renders
  return <p>{count()}</p>;
}
```

```jsx
import { signal, onMount } from 'what-framework';

const count = signal(0, 'count');

function App() {
  onMount(() => count.set(5));
  return <p>{count()}</p>;
}
```

### `what/no-set-in-computed`

A `computed()` that writes a signal can loop, since the write can make it
evaluate again (`ERR_SIGNAL_WRITE_IN_COMPUTED`):

<!-- snippet: bad lint=ERR_SIGNAL_WRITE_IN_COMPUTED -->
```js
import { signal, computed } from 'what-framework';

const count = signal(1, 'count');
const label = signal('', 'label');
const doubled = computed(() => {
  label.set(`doubled: ${count() * 2}`);
  return count() * 2;
});
```

Derive the second value too:

```js
import { signal, computed } from 'what-framework';

const count = signal(1, 'count');
const doubled = computed(() => count() * 2);
const label = computed(() => `doubled: ${doubled()}`);
```

### `what/no-camelcase-events`

Enforces lowercase event handler names (`onclick` instead of `onClick`) in JSX
written without the compiler, where props reach the DOM as written and DOM
event properties are lowercase. It reports this button:

```jsx
function save() {}

function SaveButton() {
  return <button onClick={save}>Save</button>;
}
```

Without the compiler, write the DOM name:

```jsx
function save() {}

function SaveButton() {
  return <button onclick={save}>Save</button>;
}
```

Off in the `compiler` preset: the compiler normalizes `onClick` itself.

### `what/no-h-in-user-code`

Warns on an import of `h` from `what-framework` or `what-core`, and on calls
to it: write JSX, which what-compiler turns into templates instead of `h()`
calls. A project that authors with `h()` on purpose (create-what's fullstack
template) turns it off.

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
({
  'what/no-signal-read-in-effect-deps': 'warn',
  'what/reactive-jsx-children': 'warn',
  'what/no-signal-write-in-render': 'warn',
  'what/no-camelcase-events': 'warn',
  'what/no-uncalled-signals': 'warn',
  'what/prefer-set': 'off',
  'what/no-h-in-user-code': 'warn',
  'what/signal-call-in-jsx': 'warn',
  'what/no-set-in-computed': 'error',
  'what/no-moved-imports': 'error',
  'what/no-effect-self-write': 'error',
  'what/effect-cleanup': 'warn',
  'what/no-unsafe-innerhtml': 'warn',
  'what/signal-debug-name': 'off',
  'what/prefer-computed': 'off',
})
```

### strict

```js
({
  'what/no-signal-read-in-effect-deps': 'error',
  'what/reactive-jsx-children': 'error',
  'what/no-signal-write-in-render': 'error',
  'what/no-camelcase-events': 'error',
  'what/no-uncalled-signals': 'error',
  'what/prefer-set': 'warn',
  'what/no-h-in-user-code': 'error',
  'what/signal-call-in-jsx': 'error',
  'what/no-set-in-computed': 'error',
  'what/no-moved-imports': 'error',
  'what/no-effect-self-write': 'error',
  'what/effect-cleanup': 'error',
  'what/no-unsafe-innerhtml': 'error',
  'what/signal-debug-name': 'warn',
  'what/prefer-computed': 'warn',
})
```

### compiler

```js
({
  'what/no-signal-read-in-effect-deps': 'warn',
  'what/reactive-jsx-children': 'off',       // compiler handles reactive wrapping
  'what/no-signal-write-in-render': 'warn',
  'what/no-camelcase-events': 'off',          // compiler normalizes events
  'what/no-uncalled-signals': 'warn',
  'what/prefer-set': 'off',
  'what/no-h-in-user-code': 'warn',
  'what/signal-call-in-jsx': 'off',
  'what/no-set-in-computed': 'error',
  'what/no-moved-imports': 'error',
  'what/no-effect-self-write': 'error',
  'what/effect-cleanup': 'warn',
  'what/no-unsafe-innerhtml': 'warn',
  'what/signal-debug-name': 'off',
  'what/prefer-computed': 'off',
})
```

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
