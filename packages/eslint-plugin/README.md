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
| `what.configs.compiler` | For projects compiled with what-compiler, as a create-what SPA is: turns off the rules the compiler makes unnecessary (`reactive-jsx-children`, `signal-call-in-jsx`) and the read-once rules it reports itself at build time (`no-prop-read-once`, `no-state-read-once`, `no-cleanup-reads-live`), and declares `For`, `Show`, `Switch` and `Match` as globals, since the compiler lowers them without an import |
| `what.configs.recommended` | For JSX without the compiler (the automatic runtime, as the islands template uses) and `h()` code: most rules warn; `no-moved-imports`, `no-effect-self-write` and `no-set-in-computed` are errors |
| `what.configs.strict` | Every rule `recommended` turns on, as an error, plus `prefer-set` and `signal-debug-name` as warnings |

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

### `what/signal-debug-name`

A hint, off except in `strict`: a module-scope `signal()` without a debug name
shows as `signal_N` in devtools.

### `what/prefer-computed`

A warning in every preset: an effect whose only job is to write one signal is
a derived value. `computed()` says so directly, evaluates lazily and cannot
loop.

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
`useMemo`, the accessor `useState`, `useReducer`, `createResource`,
`useTransition` (its `isPending`) and `useOptimistic` (the optimistic value)
return first, and the getter fields of `useSWR`, `useFetch`, `useQuery` and
`useInfiniteQuery`. `memo` is React's component memo and returns a component.
A method of a signal (`count.set(…)`, `count.peek()`, an async computed's
`users.pending()`) is not a read. A name where it is declared, destructured or
exported is not a read and is not reported, and neither is a variable of
another scope that shares a signal's name (`const idx = current()` in one
component, `const idx = useSignal(0)` in another). `what/signal-call-in-jsx` reports the condition case
in JSX (`{isLoading && …}`, `{open ? … : …}`) with the same code; the `compiler`
preset turns it off and keeps this rule.

State stored or sent as data is reported too, where its value is what is used:
in an object or array literal written to a state setter, as an argument of a
function that reads values (`JSON.stringify`, `String`, `console.log`,
`localStorage.setItem`), nested anywhere in such an argument, and in an array
literal joined into text. The object holds the function, and `JSON.stringify`
drops it:

<!-- snippet: bad lint=ERR_MISSING_SIGNAL_READ -->
```jsx
import { useState } from 'what-framework';

function Signup() {
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(null);
  const save = () => {
    setSubmitted({ name });
    fetch('/api/signup', { method: 'POST', body: JSON.stringify({ name }) });
  };
  return <form onSubmit={save}><input value={name} onInput={(e) => setName(e.target.value)} /></form>;
}
```

Each report carries a suggestion that adds the call (`{ name: name() }`). Only
state a What hook or primitive made, imported from what-framework or
what-core, is reported in these places (React's `useState` in a what-react file
returns a value), and handing the accessor on is left alone: a prop
(`<Field value={name} />`), a dependency array, `untrack(name)`,
`computed(name)`, a custom hook, or an object you keep.

### `what/no-state-read-once`, `what/no-prop-read-once`, `what/no-cleanup-reads-live`

A component runs once, so what its body reads outside JSX and outside a
function is read once, where React reads it again on every render.
what-compiler reports these shapes at build time (`ERR_STATE_READ_ONCE`,
`ERR_PROP_READ_ONCE`, `ERR_CLEANUP_READS_LIVE`); these rules report them where
the compiler does not build, in JSX on the automatic runtime (the islands
template) and in `h()` code, so `recommended` and `strict` turn them on and
`compiler` leaves them to the compiler:

- `no-state-read-once`: a return decided by the component's own state, or a
  value derived from it in the body and shown in JSX.
- `no-prop-read-once`: a return decided by a prop.
- `no-cleanup-reads-live`: a `useEffect` cleanup that reads a prop or state
  its run also reads, in an effect that runs again; the cleanup sees the new
  value.

<!-- snippet: bad lint=ERR_STATE_READ_ONCE -->
```jsx
import { useState, useEffect } from 'what-framework';

export function Users() {
  const [loading, setLoading] = useState(true);
  useEffect(() => { setTimeout(() => setLoading(false), 100); }, []);
  if (loading()) return <p>Loading…</p>;
  return <ul />;
}
```

<!-- snippet: bad lint=ERR_CLEANUP_READS_LIVE -->
```jsx
import { useEffect } from 'what-framework';

export function Room(props) {
  useEffect(() => {
    connect(props.room);
    return () => disconnect(props.room);
  });
  return <p>{() => props.room}</p>;
}
```

Branch where it renders, `<>{() => (loading() ? <p>Loading…</p> : <ul />)}</>`
or `<Show when={() => !loading()} fallback={<p>Loading…</p>}>`; keep the value
the effect's run used in a local for its cleanup. State is what a What hook or
primitive returns, imported from what-framework or what-core; a read inside a
function (`untrack(() => count())`, a handler) is not reported, and a React
file (one that imports `react`) is not checked.

### `what/no-async-component`

A component written as an `async function` (React Server Components' habit)
returns a promise. What's components run once and synchronously, so it renders
the promise's text, even under `<Suspense>` (`ERR_ASYNC_COMPONENT`, which the
runtime also reports):

<!-- snippet: bad lint=ERR_ASYNC_COMPONENT -->
```jsx
async function Profile(props) {
  const res = await fetch('/api/users/' + props.id);
  const user = await res.json();
  return <h1>{user.name}</h1>;
}
```

Make the data an async value and read it in JSX, where a binding waits for it
and a `<Suspense>` above shows its fallback:

```jsx
import { computed, Suspense } from 'what-framework';

function Profile(props) {
  const user = computed(({ signal }) => fetch('/api/users/' + props.id, { signal }).then((r) => r.json()));
  return <h1>{user().name}</h1>;
}

export function Page() {
  return <Suspense fallback={<p>Loading…</p>}><Profile id={1} /></Suspense>;
}
```

### `what/no-promise-in-usememo`

`useMemo` keeps what its function returns, as React's does, so a function that
returns a promise gives its readers the promise (`ERR_ASYNC_MEMO`, which the
runtime also reports):

<!-- snippet: bad lint=ERR_ASYNC_MEMO -->
```jsx
import { useMemo, signal } from 'what-framework';

const id = signal(1);

function Profile() {
  const user = useMemo(() => fetch('/api/users/' + id()).then((r) => r.json()));
  return <h1>{user().name}</h1>;
}
```

An async value is `computed()` (or `useComputed()`). The rule sees a promise
where the source shows one: an `async` function, `fetch(…)`, `.then(…)`,
`new Promise(…)`, `Promise.all(…)`; a call to another function that returns
one is the runtime's to report.

### `what/no-optimistic-snapshot`

`useOptimistic(state, update)` takes the state as an accessor. A component runs
once, so `useOptimistic(likes(), …)` is the value read when it ran, and the
optimistic value never sees the real one change. The fix (`eslint --fix`)
passes the accessor:

```jsx
import { useState, useOptimistic, startTransition } from 'what-framework';

function Likes() {
  const [likes, setLikes] = useState(0);
  const [shown, addLike] = useOptimistic(likes, (n, delta) => n + delta);
  const like = () => startTransition(async () => {
    addLike(1);
    await Promise.resolve();
    startTransition(() => setLikes((n) => n + 1));
  });
  return <button onClick={like}>{shown()}</button>;
}
```

### `what/prefer-async-computed`

`computed(fn)` starts an async value when it is created if `fn` is an `async`
function or takes `{ signal }`. A plain function that returns a promise shows
it is async only when it runs, so it starts on its first read, and two read in
turn by one binding load one after the other. The rule reports a plain function
whose source returns a promise (`fetch(…)`, `.then(…)`, `new Promise(…)`);
`eslint --fix` makes an arrow function `async`. Either form starts at once:

```jsx
import { computed } from 'what-framework';

const user = computed(async () => (await fetch('/api/user')).json());
const posts = computed(({ signal }) => fetch('/api/posts', { signal }).then((r) => r.json()));
```

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

Flags a signal write that runs while a component renders: in its body, in a
callback that runs right there (an IIFE, `untrack()`, `batch()`, an array
method), or in render code in its JSX (a function child `{() => ...}`, or a
host element's attribute function that is not an event handler or a ref),
which also runs again whenever what it reads changes. A write in an event
handler (inline or named), an effect, `onMount` or a store action runs later
and is fine (`ERR_SIGNAL_WRITE_IN_RENDER`).

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

Asks for the DOM's lowercase event names (`onclick` instead of `onClick`), for
a codebase that prefers them. Off in every preset: What's runtime takes React's
names in every JSX pipeline, h(), the automatic runtime (`jsxImportSource`) and
compiled JSX alike, so `<button onClick={save}>` listens for `click`,
`onDoubleClick` for `dblclick` and `onChange` for `input` and `change`. Turned
on, it reports this button:

```jsx
function save() {}

function SaveButton() {
  return <button onClick={save}>Save</button>;
}
```

and its fix writes the DOM name:

```jsx
function save() {}

function SaveButton() {
  return <button onclick={save}>Save</button>;
}
```

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
  'what/no-camelcase-events': 'off',          // the runtime takes onClick as well as onclick
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
  'what/prefer-computed': 'warn',
  'what/no-async-component': 'warn',
  'what/no-promise-in-usememo': 'warn',
  'what/no-optimistic-snapshot': 'warn',
  'what/prefer-async-computed': 'warn',
  'what/no-prop-read-once': 'warn',
  'what/no-state-read-once': 'warn',
  'what/no-cleanup-reads-live': 'warn',
})
```

### strict

```js
({
  'what/no-signal-read-in-effect-deps': 'error',
  'what/reactive-jsx-children': 'error',
  'what/no-signal-write-in-render': 'error',
  'what/no-camelcase-events': 'off',          // the runtime takes onClick as well as onclick
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
  'what/no-async-component': 'error',
  'what/no-promise-in-usememo': 'error',
  'what/no-optimistic-snapshot': 'error',
  'what/prefer-async-computed': 'error',
  'what/no-prop-read-once': 'error',
  'what/no-state-read-once': 'error',
  'what/no-cleanup-reads-live': 'error',
})
```

### compiler

```js
({
  'what/no-signal-read-in-effect-deps': 'warn',
  'what/reactive-jsx-children': 'off',       // compiler handles reactive wrapping
  'what/no-signal-write-in-render': 'warn',
  'what/no-camelcase-events': 'off',          // the runtime takes onClick as well as onclick
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
  'what/prefer-computed': 'warn',
  'what/no-async-component': 'warn',
  'what/no-promise-in-usememo': 'warn',
  'what/no-optimistic-snapshot': 'warn',
  'what/prefer-async-computed': 'warn',
  'what/no-prop-read-once': 'off',  // what-compiler reports these at build time
  'what/no-state-read-once': 'off',
  'what/no-cleanup-reads-live': 'off',
})
```

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
