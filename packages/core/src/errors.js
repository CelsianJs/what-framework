// What Framework - Structured Error System
// Agent-first error reporting with actionable codes, suggestions, and JSON output.
// Every error tells an AI agent exactly what went wrong and how to fix it.
//
// Import-free on purpose: diagnostics.js and the engine both depend on this
// catalogue, and anything it imported would sit in their import graph.

// --- Error Codes ---
// Each code maps to a specific, well-documented mistake pattern.

export const ERROR_CODES = {
  INFINITE_EFFECT: {
    code: 'ERR_INFINITE_EFFECT',
    severity: 'error',
    template: 'Effect "{{effectName}}" was stopped after {{rounds}} re-runs in one flush: it keeps re-triggering itself, likely an infinite loop.',
    suggestion: 'An effect is writing to a signal it also reads, creating a cycle. Use untrack() to read the signal without subscribing, or restructure so the write and read are in separate effects.',
    codeExample: `const count = signal(0);

// Bad — reads and writes count, creating a cycle:
effect(() => { count(count() + 1); });

// Good — use untrack() so the read doesn't subscribe:
effect(() => { count(untrack(count) + 1); });

// Better — split into separate logic:
const doubled = computed(() => count() * 2);`,
  },

  COMPUTED_CYCLE: {
    code: 'ERR_COMPUTED_CYCLE',
    severity: 'error',
    template: 'Computed "{{name}}" reads its own value, directly or through computeds that read it.',
    suggestion: 'A computed cannot depend on itself. Find which computed it reads that reads it back, and move the input they share into a signal or computed of its own that both read. A value that has to build on its own previous value is state: keep it in a signal and write it from an effect.',
    codeExample: `// Bad - total reads itself through average:
const average = computed(() => total() / items().length);
const total = computed(() => average() * items().length + shipping());

// Good - both read the inputs, never each other:
const subtotal = computed(() => items().reduce((sum, item) => sum + item.price, 0));
const total = computed(() => subtotal() + shipping());
const average = computed(() => subtotal() / items().length);

// Good - a running value keeps its previous value in a signal:
const spent = signal(0);
effect(() => { const price = lastPurchase(); spent((previous) => previous + price); });`,
  },

  SIGNAL_WRITE_IN_COMPUTED: {
    code: 'ERR_SIGNAL_WRITE_IN_COMPUTED',
    severity: 'warning',
    template: 'Computed "{{computedName}}" wrote signal "{{signalName}}". A computed only derives a value; a write from it runs again on every recomputation and can loop.',
    suggestion: 'A computed runs lazily, whenever it is read after an input changed, so a write inside it happens an unpredictable number of times and can re-trigger its own readers. Derive the second value as a computed of its own, or make the write in an effect or an event handler.',
    codeExample: `// Bad - the computed writes count:
const count = signal(0);
const total = computed(() => {
  count(items().length);
  return items().reduce((sum, item) => sum + item.price, 0);
});

// Good - each derived value is its own computed:
const count = computed(() => items().length);
const total = computed(() => items().reduce((sum, item) => sum + item.price, 0));`,
  },

  NESTED_FLUSH_SYNC: {
    code: 'ERR_NESTED_FLUSH_SYNC',
    severity: 'warning',
    template: 'flushSync() was called while {{context}} was running, so it did nothing: the effects it would run already run when the current flush reaches them.',
    suggestion: 'flushSync() runs queued effects immediately, which is only safe when no effect, computed or flush is running; inside one it returns without running anything. Call it from an event handler, onMount or test code, or drop it: effects queued during an effect run later in the same flush.',
    codeExample: `// Bad - inside an effect, flushSync() does nothing:
effect(() => {
  width(container().offsetWidth);
  flushSync();
  layout();
});

// Good - flush from the handler that made the write:
button.addEventListener('click', () => {
  open(true);
  flushSync();
  panel.focus();
});`,
  },

  MISSING_SIGNAL_READ: {
    code: 'ERR_MISSING_SIGNAL_READ',
    severity: 'warning',
    template: 'Signal "{{signalName}}" was converted to a string without being called, so the function\'s source text was used instead of its value.',
    suggestion: 'Signals are functions, and so are the accessors useState, useReducer and useMemo return and computed() creates. Call them to read: count() not count, in a template literal (`${count()}`), in arithmetic (`count() + 1`) and in a comparison (`count() > 5`). On its own as a JSX child or attribute value (`<span>{count}</span>`) an accessor is a live binding and needs no call. Development renders exactly what production renders here, so the broken text you see is the bug.',
    codeExample: `// Bad - the accessor itself is converted:
const [count, setCount] = useState(3);
const label = \`Total: \${count}\`;   // "Total: function sig(next) {..."
if (count > 5) {}                  // compares the function's text: always false

// Good - call it:
const label = \`Total: \${count()}\`;  // "Total: 3"
if (count() > 5) {}`,
  },

  HYDRATION_MISMATCH: {
    code: 'ERR_HYDRATION_MISMATCH',
    severity: 'error',
    template: 'Hydration mismatch ({{kind}}) in <{{component}}> at {{path}}: the server rendered {{found}} where the client renders {{expected}}. Recovery: {{recovery}}.',
    suggestion: 'hydrate() adopts the server\'s DOM only where the client renders the same thing. Here it does not, so that region was rendered on the client instead (a component\'s key mismatch only reports: the markup itself matched). The usual cause is a value the server cannot know or computes differently: Date.now(), Math.random(), typeof window, localStorage, the viewport, a locale. Render the same value on both sides during hydration and change it in onMount(), or send it with the page (a loader, a keyed resource). Each report carries the record { kind, component, ownerPath, path, expected, found, recovery } (the diagnostic\'s data in development, the argument of hydrate()\'s onHydrationError option in every build): kind is tag, text, missing, extra-nodes, marker, key (a component\'s data-hk, or a keyed list whose server rows have other keys, or keys in another order, or keys hydration cannot compare (anything but strings and finite numbers): expected and found list them), shadow-root (an element hosting a declarative shadow root, which a client render never makes: the element is replaced), prebuilt (JSX the client built before the walk reached its place: in a variable, read by a component that inspects it, or given to an h() component; it takes the server\'s place, and what the user changed in a form control there is kept), not-hydratable, or attribute (development only, and the diagnostic only: an attribute the server wrote otherwise than the client\'s first write, or that only one side wrote; the record also carries `attribute`, its name; the client\'s value is written, recovery client-value; a boolean attribute present on both sides and style declarations the DOM reads as the same are equal, class tokens in another order and a URL written otherwise are not); component and ownerPath name the component and its owner path (its data-hk); path is the DOM path under the hydrate() container; expected and found describe the client\'s and the server\'s node; recovery is client-render, move (a keyed list: each server row was taken as the row of its own key and moved into the client\'s order; a row is never given to another key, so what was typed in it stays with its key), or none for a component\'s key mismatch. kind not-hydratable means hydrate() was handed DOM already built, reported once: compiled JSX adopts server markup only when compiled for hydration (what-compiler\'s hydratable option, which the Vite plugin sets when the project renders on the server), and DOM made by hand in a component body is replaced the same way (create it in onMount).',
    codeExample: `// Bad — the client renders a value the server could not know:
import { h, hydrate } from 'what-framework';

function Width() {
  return h('p', {}, \`\${window.innerWidth}px\`);
}

const page = document.createElement('main');
page.innerHTML = '<p>1280px</p>'; // what the server sent
document.body.append(page);
hydrate(h(Width), page, { onHydrationError: (record) => console.log(record) });
// { kind: 'text', component: 'Width', ownerPath: '~0', path: 'p>#text',
//   expected: '"1024px"', found: '"1280px"', recovery: 'client-render' }

// Good — the same on both sides, corrected after hydration:
function Width() {
  const width = signal(0);
  onMount(() => width(window.innerWidth));
  return <p>{width()}px</p>;
}`,
  },

  HYDRATION_OWNER_MISMATCH: {
    code: 'ERR_HYDRATION_OWNER_MISMATCH',
    severity: 'warning',
    template: 'A keyless resource or async value at owner path {{path}} was rendered by <{{server}}> on the server and <{{client}}> on the client, so it fetches instead of adopting the server value.',
    suggestion: 'While hydrating, a keyless createResource() or async computed() takes the value the server rendered with by its position in the tree (its owner path), and in development only when the component at that position is the same one on both sides. Here it is not: a component exists on one side only (a branch on isServerRender(), typeof window, localStorage or a feature flag) and moved its neighbours. In development the value fetches again; a production build cannot compare names, since its bundle renames every function, so there the component at this position takes the value the server rendered for the other one. Render the same components on both sides during hydration (decide client-only content in onMount), wrap the one-sided branch in a component that exists on both sides, or give the resource a key, which is adopted by that key wherever it is.',
    codeExample: `// Bad — a branch that exists only on the client moves its siblings:
<div>{showChat() && <ChatWidget />}<Account /></div>

// Good — the same component on both sides; the widget decides after mount:
<div><ChatSlot /><Account /></div>

// Good — a keyed resource is adopted by its key, wherever it is:
const [account] = createResource(loadAccount, { key: 'account' });`,
  },

  ORPHAN_EFFECT: {
    code: 'ERR_ORPHAN_EFFECT',
    severity: 'warning',
    template: 'Effect "{{effectName}}" was created after an await, where no owner is current: nothing will dispose it when the component that started the async work goes away.',
    suggestion: 'Work created after an `await` belongs to no owner. Read getOwner() before the await and create the effect inside runWithOwner(owner, ...), so it is disposed with the component (or with the effect run) that started the work; or create it before the await.',
    codeExample: `// Bad — the effect outlives the component:
onMount(async () => {
  const user = await loadUser();
  effect(() => console.log(user.name, count()));
});

// Good — attach the work to the owner that started it:
onMount(async () => {
  const owner = getOwner();
  const user = await loadUser();
  runWithOwner(owner, () => {
    effect(() => console.log(user.name, count()));
  });
});`,
  },

  REBUILT_COMPONENT: {
    code: 'ERR_REBUILT_COMPONENT',
    severity: 'warning',
    template: 'A reactive region rebuilt <{{component}}> when it ran again, and the state <{{component}}> held is gone: "{{region}}" builds everything it returns anew on every run.',
    suggestion: 'Write the branches as a JSX ternary or <Show> (<Switch>/<Match> for more than two), and read the changing value where the component takes it: `<Panel data={query.data()} />`, with a computed() for a derived value. The compiler then builds <Panel> once and updates its props in place. A block function child (`{() => { const d = q(); if (!d) return ...; return <Panel data={d} />; }}`) runs again whenever anything it read changes, and rebuilds what it returns.',
    codeExample: `// Bad — the region runs again on every refetch and rebuilds <Chart>:
<div>{() => {
  if (query.isLoading()) return <Spinner />;
  const counts = countByKind(query.data());
  return <Chart counts={counts} />;
}}</div>

// Good — <Chart> is built once; its counts follow the data:
const counts = computed(() => countByKind(query.data()));
<div>
  <Show when={!query.isLoading()} fallback={<Spinner />}>
    <Chart counts={counts()} />
  </Show>
</div>`,
  },

  ASYNC_EFFECT: {
    code: 'ERR_ASYNC_EFFECT',
    severity: 'warning',
    template: 'Effect "{{effectName}}" is an async function. Only what it reads before its first await is tracked, the promise it returns is not a cleanup, and an older run can finish after a newer one and overwrite it.',
    suggestion: 'Fetch in an async computed instead: computed(async () => ...) is a value in the graph that supersedes older runs, aborts them and shows as pending, and an effect or binding that reads it runs when the value lands. Keep effects synchronous; if one must start async work, start it inside and keep the effect itself sync, returning a cleanup that cancels it.',
    codeExample: `// Bad — reads after the await are not tracked, and a slow old run can win:
useEffect(async () => {
  const res = await fetch('/api/users/' + id());
  user(await res.json());
});

// Good — an async computed: one value, newest run wins, older runs aborted:
function Profile() {
  const user = computed(async ({ signal }) => {
    const res = await fetch('/api/users/' + id(), { signal });
    return res.json();
  });
  return <h1>{user().name}</h1>;
}`,
  },

  PENDING_READ_UNTRACKED: {
    code: 'ERR_PENDING_READ_UNTRACKED',
    severity: 'warning',
    template: '{{call}} was read in a component body. The body runs once, so this reads the pending state once and it never changes on screen.',
    suggestion: 'Read pending state where it is tracked: in JSX (users.pending() is a zero-argument call the compiler wraps, so {users.pending() && <Spinner />} updates), or wrap the expression in a function: {() => isPending(() => users()) ? "Refreshing" : ""}. In an event handler, reading it once is what you want, and nothing is reported.',
    codeExample: `// Bad — read once when the component is created:
function Users() {
  const refreshing = users.pending();
  return <p>{refreshing ? 'Refreshing…' : ''}</p>;
}

// Good — read in JSX, where it is tracked:
function Users() {
  return <p>{users.pending() ? 'Refreshing…' : ''}</p>;
}`,
  },

  WRITE_AFTER_AWAIT: {
    code: 'ERR_WRITE_AFTER_AWAIT',
    severity: 'warning',
    template: 'Signal "{{signalName}}" was written outside a transition while the async function of a transition that also wrote it was still running: a write after an await is not part of the transition, so it shows before the transition commits.',
    suggestion: 'startTransition holds what the writes made synchronously inside its function reach. After an await, the function runs on its own and its writes are ordinary writes (as in React). Make the writes that belong to the commit before the first await, or wrap the later ones in startTransition again; data that arrives later belongs in an async computed, which the transition waits for.',
    codeExample: `// Bad — status('saved') shows at once, before the list commits:
startTransition(async () => {
  status('saving');
  await save(item);
  status('saved');
  await refresh(list);
});

// Good — the later write is a transition of its own:
startTransition(async () => {
  status('saving');
  await save(item);
  startTransition(() => status('saved'));
  await refresh(list);
});`,
  },

  ASYNC_WITHOUT_SUSPENSE: {
    code: 'ERR_ASYNC_WITHOUT_SUSPENSE',
    severity: 'warning',
    template: 'Component "{{component}}" suspended (lazy(), use() or a value that had not landed, read in its body) with no <Suspense> above it: it renders nothing until the promise settles.',
    suggestion: 'A component that suspends waits for its promise and then renders in place. With a <Suspense fallback> above it, the fallback shows meanwhile on first load. Wrap the part of the page that loads in <Suspense>, or read the async value in JSX instead of in the component body: a binding that reads it renders nothing until it lands, and is not a suspension.',
    codeExample: `// Bad — nothing on screen, and no fallback, until the chunk arrives:
mount(<Settings />, '#app');   // Settings = lazy(() => import('./Settings.jsx'))

// Good — a fallback while it loads:
mount(<Suspense fallback={<Spinner />}><Settings /></Suspense>, '#app');`,
  },

  ASYNC_READ_IN_BODY: {
    code: 'ERR_ASYNC_READ_IN_BODY',
    severity: 'error',
    template: 'Component "{{component}}" read an async value it made in its own body before the value landed: suspending would run it again, make the value again and fetch again, forever.',
    suggestion: 'A component body runs once; reading an async value there before it lands suspends the component, and running it again makes a new computed with a new fetch. Read the value in JSX, where a binding waits for it (and a <Suspense> shows its fallback), or make the computed outside the component (a parent, a module) and pass it in.',
    codeExample: `// Bad — read in the body that made it:
function Profile() {
  const user = computed(() => fetchUser());
  const name = user().name;
  return <h1>{name}</h1>;
}

// Good — read in JSX:
function Profile() {
  const user = computed(() => fetchUser());
  return <h1>{user().name}</h1>;
}`,
  },

  USE_UNCACHED_PROMISE: {
    code: 'ERR_USE_UNCACHED_PROMISE',
    severity: 'error',
    template: 'Component "{{component}}" keeps suspending on a new promise: use() received a promise made in the component body, which is new on every attempt, so it never finishes.',
    suggestion: 'A component that suspends on use(promise) runs again when the promise settles, and a promise created in its body is created again then. Pass use() a promise made outside the component (a prop, a module-level cache), or make the value an async computed, which is created once and suspends its readers until it lands.',
    codeExample: `// Bad — a new promise on every attempt:
function User(props) {
  const user = use(fetch('/api/users/' + props.id).then((r) => r.json()));
  return <h1>{user.name}</h1>;
}

// Good — an async computed, created once:
function User(props) {
  const user = computed(() => fetch('/api/users/' + props.id).then((r) => r.json()));
  return <h1>{user().name}</h1>;
}`,
  },

  OPTIMISTIC_OUTSIDE_TRANSITION: {
    code: 'ERR_OPTIMISTIC_OUTSIDE_TRANSITION',
    severity: 'warning',
    template: 'addOptimistic() was called outside a transition, so the optimistic value drops at once instead of lasting until the action finishes.',
    suggestion: 'An optimistic overlay lives as long as the transition it was added in. Call addOptimistic synchronously inside startTransition, before its first await (after an await the function is no longer inside the transition, as in React).',
    codeExample: `// Bad — added after an await, or in a plain handler:
const toggle = async (id) => {
  await save(id);
  addOptimistic(id);
};

// Good — added first, inside the transition:
const toggle = (id) => startTransition(async () => {
  addOptimistic(id);
  await save(id);
  await refresh(todos);
});`,
  },

  ASYNC_COMPONENT: {
    code: 'ERR_ASYNC_COMPONENT',
    severity: 'warning',
    template: 'Component "{{component}}" returned a promise: an async component renders as text.',
    suggestion: 'Components run once and synchronously, so an async one renders the promise\'s text, even under <Suspense>. Keep the component synchronous and make the data an async value: computed(async ({ signal }) => ...) made in the body or outside it, and read in JSX, where a binding waits for it to land and a <Suspense> above shows its fallback meanwhile. For a component whose code loads later, use lazy().',
    codeExample: `// Bad — an async component renders "[object Promise]":
async function Profile(props) {
  const user = await fetchUser(props.id);
  return <h1>{user.name}</h1>;
}

// Good — a synchronous component that reads an async value:
function Profile(props) {
  const user = computed(({ signal }) => fetchUser(props.id, { signal }));
  return <h1>{user().name}</h1>;
}`,
  },

  ASYNC_MEMO: {
    code: 'ERR_ASYNC_MEMO',
    severity: 'warning',
    template: 'useMemo() returned a promise; useMemo keeps it, so its readers get the promise.',
    suggestion: 'useMemo keeps what its function returns, as React\'s does. For a value that loads, use computed() or useComputed() instead: computed(async ({ signal }) => ...) is an async value, whose readers wait for it to land and which refetches when what it reads changes. Keep useMemo for values computed synchronously.',
    codeExample: `// Bad — user() is a promise:
const user = useMemo(() => fetch('/api/users/' + id()).then((r) => r.json()));

// Good — user() is the user once it has landed:
const user = computed(({ signal }) => fetch('/api/users/' + id(), { signal }).then((r) => r.json()));`,
  },

  SUSPEND_IN_TRANSITION: {
    code: 'ERR_SUSPEND_IN_TRANSITION',
    severity: 'warning',
    template: 'Component "{{component}}" suspended while a transition committed: its fallback shows.',
    suggestion: 'The component suspended on a promise (use() or a lazy() chunk), so its <Suspense> shows the fallback again. A transition holds async values, not components that suspend (React keeps the old content here). Make what the component waits for an async value of the state the transition writes, and read it in JSX: computed(async ({ signal }) => fetchTab(tab(), { signal })) is held by the transition, which keeps the old content on screen until the new value has landed. A lazy() chunk can be loaded before the transition (call its import() first), or read as an async value in its parent: computed(() => import("./Page.jsx")).',
    codeExample: `// Bad — React's tabs pattern: the fallback replaces the old tab:
function Panel(props) {
  const data = use(props.promise);
  return <p>{data.text}</p>;
}
<button onClick={() => startTransition(() => tab('b'))}>B</button>

// Good — the tab's data is an async value of the tab:
const data = computed(({ signal }) => fetchTab(tab(), { signal }));
function Panel() {
  return <p>{data().text}</p>;
}
<button onClick={() => startTransition(() => tab('b'))}>B</button>`,
  },

  SIGNAL_WRITE_IN_RENDER: {
    code: 'ERR_SIGNAL_WRITE_IN_RENDER',
    severity: 'error',
    template: 'Signal "{{signalName}}" written during render of component "{{component}}". This triggers re-execution.',
    suggestion: 'Move signal writes into event handlers, effects, or onMount(). The component body should only read signals, not write them.',
    codeExample: `const count = signal(0);

// Bad — write during render:
function Counter() {
  count(count() + 1);  // a side effect of rendering: every mount writes it
  return <span>{count()}</span>;
}

// Good — write in event handler:
function Counter() {
  return <button onclick={() => count(c => c + 1)}>{count()}</button>;
}`,
  },

  MISSING_CLEANUP: {
    code: 'ERR_MISSING_CLEANUP',
    severity: 'warning',
    template: 'Effect sets up "{{resource}}" but does not return a cleanup function.',
    suggestion: 'Effects that add event listeners, set timers, or open connections should return a cleanup function to prevent memory leaks.',
    codeExample: `// Bad — no cleanup:
effect(() => {
  window.addEventListener('resize', handler);
});

// Good — return cleanup:
effect(() => {
  window.addEventListener('resize', handler);
  return () => window.removeEventListener('resize', handler);
});`,
  },

  UNSAFE_INNERHTML: {
    code: 'ERR_UNSAFE_INNERHTML',
    severity: 'warning',
    template: 'innerHTML set on element without using the __html safety marker.',
    suggestion: 'Use the html tagged template literal or pass { __html: content } to mark innerHTML as intentional and reviewed.',
    codeExample: `// Bad — raw innerHTML (XSS risk):
<div innerHTML={userInput} />

// Good — explicit opt-in:
<div innerHTML={{ __html: sanitizedContent }} />

// Better — use the html template literal:
html\`<div>\${sanitizedContent}</div>\``,
  },

  MISSING_KEY: {
    code: 'ERR_MISSING_KEY',
    severity: 'warning',
    template: 'A .map() returns JSX without a key prop.',
    suggestion: 'Add a unique key prop to each item in a list. Use a stable identifier (like an ID), not the array index.',
    codeExample: `// Bad — no key:
<ul>{items().map(item => <li>{item.name}</li>)}</ul>

// Good — stable key:
<ul>{items().map(item => <li key={item.id}>{item.name}</li>)}</ul>`,
  },

  PROP_READ_ONCE: {
    code: 'ERR_PROP_READ_ONCE',
    severity: 'warning',
    template: 'Prop `{{name}}` is read once, when <{{component}}> runs: {{reason}}.',
    suggestion: 'what-compiler reads a destructured prop where it is used (`({ label }) => <b>{label}</b>` reads `props.label` in the binding), so it follows the parent\'s state as React re-renders with it, and a rest element keeps the props\' live values (`({ as: Tag, ...rest }) => <Tag {...rest} />`). It cannot when the binding is assigned again, its key is computed, it is destructured twice, its default reads a name of the component or calls something, its nested pattern holds a rest element or an array, or the pattern is declared with `var`. Two more shapes read a prop once: a component that decides what it returns from a prop (`return on ? <A /> : <B />`, `if (!open) return null`) decides once, so branch where it renders (`<>{() => (on ? <A /> : <B />)}</>` or `<Show when={…}>`; with h(), `() => (on ? h(A) : null)`); and props handed to a function that renders JSX as a value (`return mk({ value })`) are the values they had, so hand the props on (`mk(props)`) or render it as a component (`<Mk value={value} />`). The compiler reports each at build time (development builds); where it does not build (the islands template, h() code), eslint-plugin-what\'s no-prop-read-once reports the return decided by a prop. Read the prop where you use it (`props.size ?? \'md\'`), give the result a name of its own instead of assigning the prop, make a default a constant at module scope, or keep a value that must change in a signal.',
    codeExample: `// Bad - size is assigned again, so it is read once:
function Button({ size, ...rest }) {
  size = size ?? 'md';
  return <button class={'btn-' + size} {...rest} />;
}

// Bad - which element it returns is decided once:
function Status({ online }) {
  return online ? <b>online</b> : <i>offline</i>;
}

// Good - the default applies where size is read, and size follows the parent:
function Button({ size = 'md', ...rest }) {
  return <button class={'btn-' + size} {...rest} />;
}

// Good - a computed default, read where it is used:
function IconButton(props) {
  return <button class={'btn-' + (props.size ?? defaultSize())} />;
}

// Good - the branch is a reactive child, decided where it renders:
function Status({ online }) {
  return <>{() => (online ? <b>online</b> : <i>offline</i>)}</>;
}`,
  },

  STATE_READ_ONCE: {
    code: 'ERR_STATE_READ_ONCE',
    severity: 'warning',
    template: 'State `{{name}}` is read once in <{{component}}>: {{reason}}.',
    suggestion: 'A component runs once, so state it reads in its body, outside JSX and outside a function, is read once, where React reads it again on every render. Two shapes ported from React do something else, with no error: a component that decides what it returns from its state (`if (loading()) return <Spinner />`, `return open() ? <Dialog /> : null`) keeps the branch it took first, so branch where it renders (`<>{() => (loading() ? <Spinner /> : <List />)}</>` or `<Show when={…}>`); and a value derived from state in the body and shown in JSX (`const valid = name().length > 0` with `disabled={!valid}`) keeps its first value, so write the expression in the JSX (`disabled={name().length === 0}`) or derive it with `computed()` or `useMemo()` and call it there (`valid()`). State is the accessor a What hook or primitive returns (`useState`, `useReducer`, `useSignal`, `signal`, `computed`, `useMemo`, …). what-compiler reports both at build time (development builds), and eslint-plugin-what\'s no-state-read-once where the compiler does not build (the islands template, h() code). A read inside a function is not reported: `untrack(() => count())` keeps the first value on purpose.',
    codeExample: `import { useState, useEffect, useMemo } from 'what-framework';

// Bad - "Loading…" forever: the branch is decided once:
function Users() {
  const [loading, setLoading] = useState(true);
  useEffect(() => { load().then(() => setLoading(false)); }, []);
  if (loading()) return <p>Loading…</p>;
  return <ul>…</ul>;
}

// Bad - the button never enables: valid is computed once:
function Signup() {
  const [name, setName] = useState('');
  const valid = name().length > 0;
  return <button disabled={!valid}>Sign up</button>;
}

// Good - the branch is a reactive child:
function Users() {
  const [loading, setLoading] = useState(true);
  useEffect(() => { load().then(() => setLoading(false)); }, []);
  return <>{() => (loading() ? <p>Loading…</p> : <ul>…</ul>)}</>;
}

// Good - derived with useMemo, read where it is shown:
function Signup() {
  const [name, setName] = useState('');
  const valid = useMemo(() => name().length > 0);
  return <button disabled={!valid()}>Sign up</button>;
}`,
  },

  CLEANUP_READS_LIVE: {
    code: 'ERR_CLEANUP_READS_LIVE',
    severity: 'warning',
    template: 'The {{hook}} cleanup in <{{component}}> reads `{{name}}` when it runs, not the value its run used.',
    suggestion: 'A component runs once, so a prop or a state accessor read in an effect\'s cleanup is read when the cleanup runs: after the change that makes the effect run again. React\'s cleanup closes over the render that made it and sees the old value, so a cleanup that undoes what its run did with a prop (`join(roomId)`, then `leave(roomId)`) undoes it for the new value here, and the old one is never undone. Keep the value the run used in a local and use the local in the run and in the cleanup. On unmount, when nothing changed, both forms do the same. what-compiler reports it at build time (development builds) when the cleanup reads a prop or calls a state accessor that its run also reads, and the effect can run again (it has no `[]` dependency array); eslint-plugin-what\'s no-cleanup-reads-live reports the same where the compiler does not build (the islands template, h() code).',
    codeExample: `import { useEffect } from 'what-framework';

// Bad - when roomId changes, the cleanup leaves the new room:
function ChatRoom({ roomId }) {
  useEffect(() => {
    join(roomId);
    return () => leave(roomId);
  });
  return <h2>{roomId}</h2>;
}

// Good - the cleanup undoes what its run did:
function ChatRoom({ roomId }) {
  useEffect(() => {
    const room = roomId;
    join(room);
    return () => leave(room);
  });
  return <h2>{roomId}</h2>;
}`,
  },

  DUPLICATE_KEY: {
    code: 'ERR_DUPLICATE_KEY',
    severity: 'warning',
    template: 'A keyed list has more than one item with the key {{key}}.',
    suggestion: 'Every item with that key still gets a row of its own, and none is lost or leaked, but rows that share a key can only be told apart by their order: when the list is reordered, one item can be handed another item\'s DOM, focus and component state. Key each item by a value that is unique within the list, such as its id. A list of plain values that may repeat needs no key at all: an unkeyed list tracks each value by position among its equals.',
    codeExample: `// Bad — two todos can share a title:
{todos().map(todo => <li key={todo.title}>{todo.title}</li>)}

// Good — key by a unique id:
{todos().map(todo => <li key={todo.id}>{todo.title}</li>)}`,
  },

  SYMBOL_CHILD: {
    code: 'ERR_SYMBOL_CHILD',
    severity: 'warning',
    template: 'A Symbol ({{symbol}}) is a child of <{{component}}>, which renders nothing for it ({{path}}).',
    suggestion: 'A Symbol is not renderable. The server, the client and hydration all render nothing in its place, as for null, so the page shows a gap where a value was meant to be. The usual cause is a Symbol used as an enum value or a sentinel reaching JSX. Render a string for it instead: its description (sym.description), or a label looked up by it. Reported once for each component and Symbol, in development.',
    codeExample: `// Bad — a Symbol status renders nothing:
const OPEN = Symbol('open');
function Status() {
  const status = OPEN;
  return <span>{status}</span>; // an empty span
}

// Good — render a label for it:
const OPEN = Symbol('open');
const LABELS = { [OPEN]: 'Open' };
function Status() {
  const status = OPEN;
  return <span>{LABELS[status]}</span>;
}`,
  },

  ASYNC_MIDDLEWARE: {
    code: 'ERR_ASYNC_MIDDLEWARE',
    severity: 'error',
    template: '[what-router] Route middleware must be synchronous; received a promise or thenable.',
    suggestion: 'Return true or void to continue, false to deny access, or a redirect path synchronously. Promises and thenables fail closed: the protected component never mounts, and their results are not awaited or used to authorize navigation. For async authorization, wrap the route component with asyncGuard(check)(Component), optionally passing fallback and loading options to asyncGuard.',
    codeExample: `// Bad - an async middleware result cannot authorize a route:
const routes = [{ path: '/private', component: Component, middleware: [async () => check()] }];

// Good - the component wrapper waits for the authorization check:
const routes = [{ path: '/private', component: asyncGuard(check)(Component) }];

// Optional denial redirect and loading UI:
const Private = asyncGuard(check, { fallback: '/login', loading: Spinner })(Component);`,
  },

  UNSAFE_REDIRECT: {
    code: 'ERR_UNSAFE_REDIRECT',
    severity: 'error',
    template: '[what-router] redirect() refused an unsafe target: {{target}}',
    suggestion: 'redirect() accepts same-origin paths and http:, https:, mailto: or tel: URLs only. Protocol-relative ("//host"), backslash-smuggled and javascript:/data: targets are open-redirect vectors. Check a user-supplied target against an allowlist first.',
    codeExample: `// Bad - a user-controlled target can leave your origin:
redirect(query.next);

// Good - allowlist the target first:
redirect(ALLOWED.has(query.next) ? query.next : '/');`,
  },

  REDIRECT_NOT_CAUGHT: {
    code: 'ERR_REDIRECT_NOT_CAUGHT',
    severity: 'error',
    template: '[what-router] redirect to {{target}}',
    suggestion: 'redirect() is caught in route middleware and in a component body. From an event handler, a promise callback, a timer or a reactive thunk, call navigate(to) instead. If the call is inside a try/catch, rethrow anything whose name is RouterRedirect. On the server this signal escapes renderToString to its caller: read its `to` and emit a 302 rather than calling navigate().',
    codeExample: `// Bad - a reactive thunk re-runs outside the render the Router caught:
<div>{() => (loggedOut() ? redirect('/login') : <Dashboard />)}</div>

// Good - navigate() from a thunk or a handler:
<div>{() => (loggedOut() ? (navigate('/login'), null) : <Dashboard />)}</div>;
<button onclick={() => navigate('/login')}>Sign in</button>;

// On the server, catch it and answer with the redirect instead of navigating:
try { html = renderToString(<App />); }
catch (e) { if (e.name !== 'RouterRedirect') throw e; res.writeHead(302, { location: e.to }).end(); }`,
  },

  REDIRECT_CYCLE: {
    code: 'ERR_REDIRECT_CYCLE',
    severity: 'error',
    template: '[what-router] Redirect loop ({{kind}}): {{cycle}}. Guards of: {{guards}}.',
    suggestion: 'Route middleware sent the navigation round in a loop, so the router stopped it and showed the redirect-loop screen. The cycle lists each hop as the pattern of the route it matched, in order (never the URL itself: a path segment, a query or a fragment may carry what the visitor sent), and a hop no route matches as (no route); the guards are the patterns of the routes whose middleware or component redirected. Make each guard a fixed point for the state it redirects to: a guard must let its own target through (the login page must not redirect a logged-out user to itself or back), and two guards must not send each other the same state.',
    codeExample: `// Bad — a logged-in non-admin bounces between the two forever:
const routes = [
  { path: '/login', component: Login, middleware: [() => !isLoggedIn() || '/dashboard'] },
  { path: '/dashboard', component: Dashboard, middleware: [() => isAdmin() || '/login'] },
];

// Good — the dashboard's guard sends a logged-in non-admin somewhere that lets them in:
const routes = [
  { path: '/login', component: Login, middleware: [() => !isLoggedIn() || '/dashboard'] },
  { path: '/dashboard', component: Dashboard, middleware: [() => isAdmin() || (isLoggedIn() ? '/account' : '/login')] },
];`,
  },

  // --- Development checks in core ---
  // Raised through diagnostics.js report(), so they reach devtools, the MCP
  // bridge and what-framework/testing as coded events.

  HOOK_OUTSIDE_COMPONENT: {
    code: 'ERR_HOOK_OUTSIDE_COMPONENT',
    severity: 'error',
    template: '[what] {{hookName}}() can only be called inside a component function. Did you call it outside of a component or in an async callback? If you need reactive state outside a component, use signal() directly.',
    suggestion: 'A hook attaches its state to the component it belongs to, found through the current owner: the component body, or an effect, region or list row the component created. Code that runs later under no owner has no component: an event handler, a timer, anything after an await, module scope. What components run once, so call hooks at the top of the body, where each runs once. Outside a component use signal(), computed() and effect() directly; to use a context value in a callback, read it in the body and close over the result.',
    codeExample: `import { onMount, useState } from 'what-framework';

// Bad - after the await nothing owns the call:
function Profile() {
  onMount(async () => {
    await Promise.resolve();
    const [user, setUser] = useState(null);   // throws
  });
}

// Good - hooks at the top of the body, async work inside:
function Profile() {
  const [user, setUser] = useState(null);
  onMount(async () => setUser(await fetchUser()));
  return <p>{() => user()?.name}</p>;
}`,
  },

  EFFECT_DEP_NOT_FUNCTION: {
    code: 'ERR_EFFECT_DEP_NOT_FUNCTION',
    severity: 'warning',
    template: 'useEffect dependency at index {{index}} is a plain value, so the effect cannot re-run when it changes.',
    suggestion: 'A dependency array lists signals and computeds, which the effect reads to track them. A value in the array is read once when the component runs and never changes, so the effect never re-runs for it. Pass the signal itself, not its current value; for a prop or any other expression, a computed over it (useMemo(() => props.count)). Omitting the array tracks whatever the effect reads.',
    codeExample: `const [count, setCount] = useState(0);

// Bad - count() is read once, the array holds a number:
useEffect(() => save(count()), [count()]);

// Good - pass the signal:
useEffect(() => save(count()), [count]);

// Good - or let the effect track what it reads:
useEffect(() => save(count()));`,
  },

  EFFECT_DEP_NOT_SIGNAL: {
    code: 'ERR_EFFECT_DEP_NOT_SIGNAL',
    severity: 'warning',
    // Short: the agents' index (skills/what-diagnostics) has a size limit.
    template: 'useEffect dependency {{index}} is a function, never read.',
    suggestion: 'A function in a dependency array that is not a signal or a computed is never called, so the effect cannot re-run for what it reads. A dependency array re-runs the effect for the signals and computeds in it. Any other function is left alone: a deps array often holds setters and callbacks ([setCount], [load], [props.onClose]), and calling one to see what it reads would write state or start work on every run. If this one is a getter, list a computed over the same expression (useMemo(() => props.count)), or omit the array so the effect tracks what its callback reads. If it is a callback, leave it out: a component runs once, so a callback never changes. A function that takes arguments is never reported.',
    codeExample: `// Bad - the arrow is never called, so the effect runs once:
useEffect(() => save(props.count), [() => props.count]);

// Good - a computed is a signal:
const count = useMemo(() => props.count);
useEffect(() => save(count()), [count]);

// Good - or let the effect track what it reads:
useEffect(() => save(props.count));`,
  },

  CONTEXT_NOT_PROVIDED: {
    code: 'ERR_CONTEXT_NOT_PROVIDED',
    severity: 'warning',
    template: '{{context}} was read with no provider above the component and has no default value, so useContext returned undefined.',
    suggestion: 'createContext() called with no argument says the value must come from a provider. Render the reader inside <Ctx value={...}> (or <Ctx.Provider value={...}>), or pass createContext a default for the case with no provider. Set Ctx.displayName to name the context in this message.',
    codeExample: `const Theme = createContext();
Theme.displayName = 'Theme';

// Bad - no provider above <Toolbar>:
mount(<Toolbar />, '#app');

// Good - provide a value:
mount(<Theme value="dark"><Toolbar /></Theme>, '#app');

// Good - or give the context a default:
const Theme = createContext('light');`,
  },

  CLEANUP_WITHOUT_OWNER: {
    code: 'ERR_CLEANUP_WITHOUT_OWNER',
    severity: 'warning',
    template: 'onCleanup() was called outside a component and outside any reactive owner, so the cleanup never runs.',
    suggestion: 'onCleanup attaches to the component being rendered, or else to the reactive owner around the call: createRoot, a list row, a mount root, or the run of an effect. Code that runs later has none of these: an async callback after an await, a timer, an event handler. Register the cleanup while the component body runs, before anything awaits. For a subscription outside any component, create it inside createRoot and keep the dispose function it passes you.',
    codeExample: `// Bad - after the await nothing owns the call, so the cleanup never runs:
function Room({ id }) {
  onMount(async () => {
    const room = await joinRoom(id);
    onCleanup(() => room.leave());
  });
}

// Good - register the cleanup while the body runs, before anything awaits:
function Room({ id }) {
  const joined = joinRoom(id);
  onCleanup(() => joined.then((room) => room.leave()));
}`,
  },

  DERIVED_WITHOUT_STATE: {
    code: 'ERR_DERIVED_WITHOUT_STATE',
    severity: 'warning',
    template: 'derived() for "{{key}}" takes no parameter, so it cannot read the store state.',
    suggestion: 'createStore calls a derived function with the store state as its argument, and tracks the fields it reads through that argument. A function that declares no parameter reads nothing reactive and never updates.',
    codeExample: `import { createStore, derived } from 'what-framework';

// Bad - the function takes no state, so it never updates:
const useCounter = createStore({ count: 0, doubled: derived(() => 0) });

// Good:
const useCounter = createStore({ count: 0, doubled: derived(state => state.count * 2) });`,
  },

  FORM_HANDLER_WITHOUT_EVENT: {
    code: 'ERR_FORM_HANDLER_WITHOUT_EVENT',
    severity: 'warning',
    template: 'register("{{name}}") change handler was called without an event; the field was left unchanged.',
    suggestion: 'The handler register() returns reads the new value from event.target. Pass the DOM event through, or set the value directly with form.setValue(name, value).',
    codeExample: `// Bad - calls the handler with a value instead of an event:
const field = register('email');
field.onchange('a@b.co');

// Good:
<input {...register('email')} />
form.setValue('email', 'a@b.co');`,
  },

  FORM_RADIO_WITHOUT_VALUE: {
    code: 'ERR_FORM_RADIO_WITHOUT_VALUE',
    severity: 'warning',
    template: 'Radio for field "{{name}}" has no value, so it cannot record a choice.',
    suggestion: 'Radios in a group share one field that holds the selected option\'s value. A radio with no value attribute reports "on", which identifies nothing, so the registration ignores it. Give every radio a value.',
    codeExample: `// Bad:
<Radio name="size" register={register} />

// Good:
<Radio name="size" value="small" register={register} />;
<input type="radio" {...register('size', { type: 'radio', value: 'small' })} />;`,
  },

  FORM_RADIO_UNTYPED: {
    code: 'ERR_FORM_RADIO_UNTYPED',
    severity: 'warning',
    template: 'register("{{name}}") was spread onto a radio without { type: \'radio\' }, which overwrote the radio\'s value.',
    suggestion: 'A plain registration binds the input\'s value to the field, which for a radio replaces the option it stands for. Tell the registration it is a radio and which value it contributes, or use <Radio>.',
    codeExample: `// Bad:
<input type="radio" value="small" {...register('size')} />

// Good:
<input type="radio" {...register('size', { type: 'radio', value: 'small' })} />;
<Radio name="size" value="small" register={register} />;`,
  },

  STORAGE_FAILED: {
    code: 'ERR_STORAGE_FAILED',
    severity: 'warning',
    template: 'useLocalStorage("{{key}}") could not {{operation}} localStorage: {{reason}}.',
    suggestion: 'A write fails when the quota is exhausted or storage is disabled (private browsing); a read fails when the stored text is not valid JSON, usually because something else wrote that key. The signal keeps working in memory either way. Use a key no other code writes, and keep stored values small.',
    codeExample: `// Good - a namespaced key and a small value:
const theme = useLocalStorage('myapp:theme', 'light');`,
  },

  PORTAL_TARGET_MISSING: {
    code: 'ERR_PORTAL_TARGET_MISSING',
    severity: 'warning',
    template: '<Portal target="{{selector}}"> matched no element, so its children render nowhere.',
    suggestion: 'A string target is a CSS selector, looked up when the portal is built: the element has to be in the document by then. Leave `target` out to render into document.body, pass an element (a ref, document.getElementById), or put the container in the page before the component that holds the portal.',
    codeExample: `// Bad - #modal-root is not in the page:
<Portal target="#modal-root"><Dialog /></Portal>

// Good - no target renders into document.body:
<Portal><Dialog /></Portal>`,
  },

  MOUNT_TARGET_MISSING: {
    code: 'ERR_MOUNT_TARGET_MISSING',
    severity: 'error',
    template: '{{fn}}() got no container element.',
    suggestion: 'mount() and hydrate() render into an element that is in the page when they run: pass the element, or a CSS selector that matches one. The full-page document what-server renders (renderDocument, createRequestHandler, the scaffold) puts the route directly under <body> with no wrapper of its own, so its client hydrates document.body. Use a selector such as #app only where the page writes that element itself.',
    codeExample: `// Bad - the built-in document has no #app wrapper:
hydrate(<App />, document.getElementById('app'));

// Good - the built-in document:
hydrate(<App />, document.body);

// Good - a page that writes <div id="app"> itself:
hydrate(<App />, '#app');`,
  },

  // --- Outside core ---
  //
  // Every package in the workspace threw bare `new Error(...)` with good prose
  // and no code, so nothing downstream could branch on the failure and the
  // what_errors MCP tool could only ever enumerate core's own. The entries
  // below are the catalogue for the rest of the framework.
  //
  // These are catalogued here but NOT constructed here. A throw outside core
  // carries only its `code`; the suggestion and the worked example live once,
  // in this file, and are resolved from the code by classifyError() or by
  // reading ERROR_CODES directly.
  //
  // That split is a size decision, and it was measured. Importing
  // createWhatError() into what-server's client-shipped action surface retains
  // this whole catalogue through the bundler: esbuild took that surface from
  // 8.4 KB minified / 3.5 KB gzipped to 25.9 KB / 9.7 KB. Six kilobytes of
  // gzipped prose in every visitor's browser is the wrong trade for making
  // three server-side messages structured.
  //
  // The same rule keeps the packages that genuinely cannot import core honest:
  // what-isr never imports what-server, which is what keeps it usable from any
  // adapter; the compiler runs inside Babel at build time; the MCP server has
  // no framework dependency; and the CLI loads the project's runtime, not its
  // own. `scripts/check-error-codes.mjs` asserts every `ERR_*` literal thrown
  // anywhere under packages/*/src appears here, so nothing drifts.

  NO_SECURE_RANDOM: {
    code: 'ERR_NO_SECURE_RANDOM',
    severity: 'error',
    template: '[what] No secure random source available for CSRF token generation.',
    suggestion: 'Neither globalThis.crypto.getRandomValues nor node:crypto was reachable. On Node this means a build older than 18 or a bundler that stripped node:crypto; on an edge runtime it means the Web Crypto global was not provided. A CSRF token from Math.random is not a token, so this refuses rather than degrading.',
    codeExample: `// Node 18+ exposes Web Crypto globally; nothing to configure.
// If a bundler dropped it, restore the global before creating the server:
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;`,
  },

  PAYLOAD_TOO_LARGE: {
    code: 'ERR_PAYLOAD_TOO_LARGE',
    severity: 'error',
    template: 'A call over the {{limit}}-byte bodyLimit was refused.',
    suggestion: 'The action call\'s body (every field and file in it) was over the server\'s bodyLimit (1 MB by default), so the server answered 413 and ran nothing. The error carries `status` 413 and `limit`, the bytes allowed (none when a proxy or the platform answered the 413 itself: its message then says the server accepts less). Raise bodyLimit for uploads, check a file\'s size before the form is sent (setCustomValidity on the file input keeps the form and tells the visitor), and show the error in an <ErrorBoundary> around the component whose useActionState dispatched the action, which a throwing action reaches. Without JavaScript the visitor gets the server\'s 413 page, which names the limit.',
    codeExample: `// Good - refuse a file over the limit before the form is sent:
const MAX_UPLOAD = 1_000_000; // the server's bodyLimit, less room for the other fields
const avatar = <input type="file" name="avatar" onChange={(e) => {
  const file = e.target.files[0];
  e.target.setCustomValidity(file && file.size > MAX_UPLOAD ? 'Choose a file under 1 MB' : '');
}} />;

// Good - and the error reaches a boundary around the component whose
// useActionState dispatched the action:
const page = <ErrorBoundary fallback={({ error, reset }) => (
  <p role="alert">{error.code === 'ERR_PAYLOAD_TOO_LARGE' && error.limit !== undefined ? \`Too large: the limit is \${error.limit} bytes.\` : error.message}
    <button onClick={reset}>Try again</button></p>
)}>
  <Signup />
</ErrorBoundary>;`,
  },

  ACTION_FAILED: {
    code: 'ERR_ACTION_FAILED',
    severity: 'error',
    template: '{{message}}',
    suggestion: 'The server action rejected. The server refused the call or the action threw: `status` is the response\'s (403 for a CSRF check, 404 for an action it does not have, 400 for arguments it cannot read, 500 for a throw), and the message is the one the action threw, forwarded to the client by the action handler. Throw a typed error from the action and branch on its shape rather than parsing this string; a body over bodyLimit is ERR_PAYLOAD_TOO_LARGE.',
    codeExample: `// In the action, fail with something the client can read:
export const save = action(async (data) => {
  if (!data.email) throw Object.assign(new Error('Email required'), { field: 'email' });
});`,
  },

  STATIC_WRITE_ESCAPE: {
    code: 'ERR_STATIC_WRITE_ESCAPE',
    severity: 'error',
    template: '[what-server] Refusing to write outside outDir: {{path}}',
    suggestion: 'A route path resolved to a location outside the export directory, which a "../" segment in a route or a param can do. Sanitize the route path, or drop the route from the static export.',
    codeExample: `// Bad — a slug from the CMS such as '../../x' resolves outside outDir:
const docs = { path: '/docs/:slug', mode: 'static', component: Doc,
  getStaticPaths: () => ({ paths: slugs.map((slug) => ({ params: { slug } })) }) };

// Good — export only slugs that are one safe path segment:
const docs = { path: '/docs/:slug', mode: 'static', component: Doc,
  getStaticPaths: () => ({ paths: slugs.filter((s) => /^[a-z0-9-]+$/.test(s)).map((slug) => ({ params: { slug } })) }) };`,
  },

  INVALID_HTML_NESTING: {
    code: 'ERR_INVALID_HTML_NESTING',
    severity: 'error',
    template: '<{{parent}}> cannot contain <{{child}}>: the HTML parser closed the outer tag early, so the rendered tree does not match your JSX.',
    suggestion: 'The compiler turns each element into an HTML template string, and the browser parses it under real HTML rules. Some nestings are not expressible: <p> may only hold phrasing content, <a> may not hold another <a>, and a table section may not hold arbitrary elements. The parser silently reorders them, which leaves compiled output walking a tree that no longer matches your source. Change the outer tag (usually <p> to <div>) or move the child out.',
    codeExample: `// Bad — the parser closes <p> before <div>, producing four sibling nodes:
<p>Intro<div>{body()}</div>Outro</p>

// Good — a block container can hold block content:
<div class="prose">Intro<div>{body()}</div>Outro</div>;

// Good — or keep the paragraph and use phrasing content:
<p>Intro<span>{body()}</span>Outro</p>;`,
  },

  TEMPLATE_NAMESPACE: {
    code: 'ERR_TEMPLATE_NAMESPACE',
    severity: 'error',
    template: 'The compiled template for <{{tag}}> has no namespace flag, so its root would render as an unknown HTML element instead of SVG or MathML.',
    suggestion: 'what-compiler marks every template whose root is an SVG or MathML element other than <svg> and <math>, and the runtime parses it in that namespace; the runtime no longer guesses the namespace from the tag. A template without the mark comes from a what-compiler older than the runtime, usually a library that ships precompiled output. Compiler and runtime versions move together: recompile the module with the what-compiler release that matches what-framework, and have a library declare what-framework at its own minor version as a peer dependency.',
    codeExample: `// Bad — output of what-compiler 0.14, loaded by a newer runtime:
const _tmpl$0 = _$template("<circle r='1'></circle>");

// Good — the same component recompiled by the matching what-compiler:
const _tmpl$0 = _$template("<svg><circle r='1'></circle></svg>", 2);`,
  },

  COMPILER_RUNTIME_MISMATCH: {
    code: 'ERR_COMPILER_RUNTIME_MISMATCH',
    severity: 'error',
    template: 'what-compiler {{compiler}} cannot build for {{name}} {{version}} ({{file}}).',
    suggestion: 'what-compiler\'s output imports the runtime helpers of its own release, so a build needs what-compiler, what-framework and what-core of one release. npm refuses an install that mixes them (each declares the others as peers at its release), so a mixed install comes from one that skipped peer checks: --legacy-peer-deps, --force, or a package manager that only warns. what-compiler/vite and the Babel plugin check the installed versions before they compile and stop with this error. Move every What package to one release in one install, as step 1 of "Before you start" in UPGRADING.md says.',
    codeExample: `// Bad — the compiler upgraded alone, peer checks skipped:
//   npm install -D what-compiler@latest --legacy-peer-deps
//   what-compiler 0.15.0 beside what-framework 0.14.0: the build stops here

// Good — every What package in one install, at one release:
//   npm install what-framework@0.15.0 what-compiler@0.15.0`,
  },

  NO_VNODE_RENDERER: {
    code: 'ERR_NO_VNODE_RENDERER',
    severity: 'error',
    template: '{{what}} reached the compiled-JSX runtime, but no vnode renderer is installed.',
    suggestion: 'Compiled JSX builds DOM directly, so a program that only uses compiled JSX leaves the vnode renderer out of its bundle, and something handed the runtime a vnode anyway. The producers that make vnodes install the renderer as they do (h, Fragment and html from what-framework, the automatic JSX runtime, and the components that return vnodes: ErrorBoundary, Suspense, Portal, lazy, Island), so the vnode came from the compiled-JSX runtime itself: the form what-compiler gives JSX handed to hydrate(), passed somewhere else. Write the JSX where it is used. An object built by hand in the { tag, props, children } shape is not a vnode (vnodes carry a brand only those producers give) and renders as its text instead.',
    codeExample: `// Bad — the compiled form of <App /> for hydrate(), given to mount():
import { mount } from 'what-framework';
import { _$componentVNode } from 'what-framework/render';

const App = () => <p>Hello</p>;
mount(_$componentVNode(App, null, []), document.body);

// Good — mount the JSX itself, which the compiler builds directly:
import { mount } from 'what-framework';

const App = () => <p>Hello</p>;
mount(<App />, document.body);`,
  },

  INVALID_SSR_TAG: {
    code: 'ERR_INVALID_SSR_TAG',
    severity: 'error',
    template: '[what-server] Invalid tag name in SSR: "{{tag}}"',
    suggestion: 'A server renderer reached a vnode whose tag is neither an element name nor a component function: h() was given a tag built from data (one with a space, a quote or a "<" in it), or a value that is not a string or a function. Choose the tag from the ones you allow. A component that returns a plain object is not this error: an object that is not a vnode renders as its text.',
    codeExample: `// Bad — the tag is built from data, and is not an element name:
function Heading({ level }) {
  return h(\`h\${level} class="big"\`, {}, 'Title');
}

// Good — choose the tag from the ones you allow:
const TAGS = { 1: 'h1', 2: 'h2', 3: 'h3' };
function Heading({ level }) {
  return h(TAGS[level] || 'h2', { class: 'big' }, 'Title');
}`,
  },

  COMPILED_JSX_IN_SSR: {
    code: 'ERR_COMPILED_JSX_IN_SSR',
    severity: 'error',
    template: 'what-compiler client output cannot be server-rendered: {{file}}.',
    suggestion: 'what-compiler has two targets. Its client output lowers JSX to _$template() calls, which parse their markup with document.createElement() the first time a template is used, and to _$createComponent(), which builds DOM, so it has no server-rendered form. Its server target (generate: "ssr") lowers the same JSX to string templates that what-server renders. The Vite plugin compiles server transforms with the server target unless the project sets ssr: false, which is when this error is raised for a module that builds DOM; at render time it means a module compiled for the client reached a server renderer. Remove ssr: false, or author the view with h(), or compile it with the automatic JSX runtime (jsxImportSource: "what-framework").',
    codeExample: `// Bad — server transforms compiled as client output:
// vite.config.js: plugins: [what({ ssr: false })]  +  vite build --ssr
export function Page() { return <h1>Hi</h1>; }   // refused at build time

// Good — the default: server transforms use the server target:
// vite.config.js: plugins: [what()]
export function Page() { return <h1>Hi</h1>; }   // renders on the server

// Good — or h(), which renderToString understands:
import { h } from 'what-framework';
export function Title() { return h('h1', null, 'Hi'); }`,
  },

  FOREIGN_ENGINE_IN_SSR: {
    code: 'ERR_FOREIGN_ENGINE_IN_SSR',
    severity: 'error',
    template: 'An async value was made by a second copy of what-core during a server render.',
    suggestion: 'The page is server-rendered by one copy of what-core, and a component made a resource, a query or another async value with a different copy: usually a library that bundled what-framework into its own build instead of declaring it as a peer dependency. A second copy never joins the render, so its value would start over on every retry of the render and never reach the client; the render fails instead. Bundle one copy: mark what-framework (and what-core) external in the library\'s build and list it under peerDependencies, or dedupe the install (npm ls what-core shows each copy). Effects and computeds of a second copy are still owned by the render and disposed with it.',
    codeExample: `// Bad — a library's vite.config.js bundles what-framework into dist/index.js:
export default defineConfig({ build: { lib: { entry: 'src/index.js' } } });

// Good — the library leaves the framework to the app (and lists it in peerDependencies):
export default defineConfig({
  build: {
    lib: { entry: 'src/index.js' },
    rollupOptions: { external: [/^what-framework/, /^what-core/] },
  },
});`,
  },

  UNSAFE_STATIC_MARKUP: {
    code: 'ERR_UNSAFE_STATIC_MARKUP',
    severity: 'error',
    template: 'Refused unsafe static markup: {{message}}',
    suggestion: 'what-compiler writes static tags, attributes and text straight into markup (the DOM target\'s template strings, which the browser parses, and the server target\'s string templates), so it checks them when the module is compiled, by the same rules the runtime applies to a value on every path: a URL attribute (href, src, action, formaction, data, ping, xlink:href) must not use a javascript:, vbscript: or data: scheme, srcdoc and outerHTML are never written because escaping cannot make markup safe, innerHTML or dangerouslySetInnerHTML take { __html: trustedString }, never a string, the text of a <script> cannot contain "</" or "<!--" and that of a <style> cannot contain "</", and a tag cannot be a namespaced name such as <svg:rect>. The server target also checks that a tag or attribute name can be emitted verbatim. Fix the value in the source; a dynamic value is still checked at run time.',
    codeExample: `// Bad — each of these fails the build:
<a href="javascript:void 0">Open</a>;
<iframe srcdoc="<p>hi</p>" />;
<div innerHTML="<b>raw</b>" />;
<script>{"document.write('</p>')"}</script>;
<svg:rect />;

// Good:
<button type="button" onClick={open}>Open</button>;
<iframe src="/preview.html" />;
<div innerHTML={{ __html: trustedHtml }} />;
<script>{"document.write('<\\\\/p>')"}</script>;
<svg><rect /></svg>;`,
  },

  JSX_ISLAND_PROP: {
    code: 'ERR_JSX_ISLAND_PROP',
    severity: 'error',
    template: 'An island prop holds JSX: {{message}}',
    suggestion: 'An island\'s props are serialized to JSON so the browser can hydrate it, and markup is not data: JSX in a prop would arrive as an empty object, or as a plain object pretending to be an element. what-compiler refuses it on both targets. Pass the markup as a child of the island, which renders on the server and hydrates with it, or pass the data and build the markup inside the island. A function prop (a render prop) is fine: functions are left out of the JSON, and the island makes its own when it hydrates.',
    codeExample: `// Bad — the icon would reach the browser as {}:
<Chart client:load icon={<StarIcon />} />;

// Good — markup as a child:
<Chart client:load><StarIcon /></Chart>;

// Good — data, and the markup built inside the island:
<Chart client:load icon="star" />;`,
  },

  SSR_SUSPENSE_TIMEOUT: {
    code: 'ERR_SSR_SUSPENSE_TIMEOUT',
    severity: 'error',
    template: '[what-server] A resource was still pending after 12 attempts during streaming SSR.',
    suggestion: 'A resource or async component inside <Suspense> never settled while the page streamed, so the renderer stopped waiting for it. Make every fetcher resolve or reject, or give it a timeout so that it does. The boundary keeps its fallback in the streamed HTML, and the client renders the boundary itself.',
    codeExample: `// Bad — a fetch with no bound can leave the boundary waiting forever:
const [posts] = createResource(() => fetch(API).then((r) => r.json()));

// Good — a timeout, so the fetcher settles either way:
const [posts] = createResource(() =>
  fetch(API, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()));`,
  },

  LATE_REDIRECT: {
    code: 'ERR_LATE_REDIRECT',
    severity: 'error',
    template: '[what-server] redirect({{location}}) after the shell was sent needs an inline script, and this stream has noScripts.',
    suggestion: 'Once the shell is sent, the status line has gone out, so a redirect from a streamed boundary can only be made by an inline script that navigates. With noScripts the stream may not write one, and the redirect is dropped. Redirect from the loader, or from anything that runs before the shell is sent, so the response is a real 3xx; or allow the script with a nonce instead of noScripts.',
    codeExample: `// Bad — a redirect from inside a streamed <Suspense>, with noScripts:
function Account() {
  const [user] = createResource(loadUser);
  if (!user()) getResponse().redirect('/login');
  return <p>{() => user()?.name}</p>;
}
renderDocumentStream(page, req, { noScripts: true });

// Good — redirect from the loader, before the shell: a real 3xx:
export async function loader({ request, response }) {
  if (!(await loadSession(request))) response.redirect('/login', 302);
}

// Good — or let the stream write the one script, under a CSP nonce:
renderDocumentStream(page, req, { nonce });`,
  },

  SSR_UNSAFE_REDIRECT: {
    code: 'ERR_SSR_UNSAFE_REDIRECT',
    severity: 'warning',
    template: '[what-server] {{method}}: refusing unsafe redirect target {{target}}; redirecting to "/" instead. (ERR_SSR_UNSAFE_REDIRECT)',
    suggestion: 'A server response redirect(), from a loader\'s `response` or from getResponse(), takes a same-origin path only ("/account?tab=2"), by the same rule as the action handler\'s _redirect field. An absolute URL, "//host", "/\\host" or javascript: is refused, because a loader that redirects to request data (`?next=`) would otherwise be an open redirect; the response goes to "/" instead of failing the request. To send the visitor off the site on purpose, call redirectExternal(url), which takes an absolute http(s) URL.',
    codeExample: `// Bad — an absolute URL through redirect() is refused:
export function loader({ query, response }) {
  response.redirect(query.next);          // ?next=https://evil.example -> "/"
}

// Good — a local path from request data, checked by redirect() itself,
// and leaving the site explicitly:
export function loader({ query, response }) {
  if (query.billing) response.redirectExternal('https://billing.example.com/portal');
  else response.redirect(query.next ?? '/');   // "/account" is kept
}`,
  },

  SSR_INVALID_ID_PREFIX: {
    code: 'ERR_SSR_INVALID_ID_PREFIX',
    severity: 'error',
    template: '[what-server] idPrefix {{idPrefix}} is not a letter followed by letters, digits, "_" or "-".',
    suggestion: 'The streaming renderer writes idPrefix into element ids, comments and an inline script, so it is validated rather than escaped: a letter, then letters, digits, "_" or "-". It only needs to differ between streams on one page; every stream already adds a random part after it.',
    codeExample: `// Bad — characters that would end the attribute or the comment:
renderToStream(app, { idPrefix: 'side"bar' });

// Good:
renderToStream(app, { idPrefix: 'sidebar' });`,
  },

  SSR_LATE_HEAD: {
    code: 'ERR_SSR_LATE_HEAD',
    severity: 'warning',
    template: '[what-server] <Head> inside a streamed <Suspense> (boundary {{boundaryId}}) set head tags after the shell was sent.',
    suggestion: 'A streamed document sends its <head> with the shell. Tags a <Head> sets inside a <Suspense> that streams later travel with that boundary and are applied to document.head by script (or by applyStreamedBoundaries() with noScripts), so the page gets them, but the HTML <head> does not carry them and a crawler that runs no scripts does not see them. Set the title and meta from data the shell already has (the loader\'s), or render the route buffered (page.stream: false), to have them in the server HTML.',
    codeExample: `// Bad for crawlers — the title waits for a streamed resource:
function Post() {
  const [post] = createResource(loadPost, { key: 'post' });
  return <><Head title={post().title} /><h1>{post().title}</h1></>;
}

// Good — the loader has the title before the shell is sent:
export const loader = ({ params }) => loadPostMeta(params.id);
function Page({ loaderData }) {
  return <><Head title={loaderData.title} /><Suspense fallback="..."><Post /></Suspense></>;
}`,
  },

  FORM_ACTION_MISSING: {
    code: 'ERR_FORM_ACTION_MISSING',
    severity: 'error',
    template: '[what] <Form> requires an `action` prop: a server action, its id, or a function.',
    suggestion: 'Pass the server action itself, the string id it was registered under, or a client action such as the dispatch useActionState returns.',
    codeExample: `// Bad:
<Form method="post" />

// Good:
<Form action={save} />;
<Form action="save-user" />;`,
  },

  ISLAND_STORE_OUTSIDE_RENDER: {
    code: 'ERR_ISLAND_STORE_OUTSIDE_RENDER',
    severity: 'error',
    template: '[what-server] Island store "{{name}}" was accessed outside an active server render.',
    suggestion: 'A module-scoped island store resolves against the current request, so it can only be read or written from a component rendered by renderDocument/renderPage. Reading one at module scope, or from a background task, has no request to bind to.',
    codeExample: `// Bad — runs at import time, with no request in scope:
const count = cart.items.length;

// Good — read it inside a component the server is rendering:
function Cart() { return <span>{cart.items.length}</span>; }`,
  },

  QUERY_OUTSIDE_RENDER: {
    code: 'ERR_QUERY_OUTSIDE_RENDER',
    severity: 'warning',
    template: '[what] Server query cache used outside a render, loader or action.',
    suggestion: 'On the server, each render, loader and server action has a query cache of its own, so one request\'s data never answers another. Code outside them (module scope, a timer, a background task, or code after an await on a runtime without AsyncLocalStorage) has no request to bind to, and a cache every request shared would hand one user\'s data to the next. So prefetchQuery, setQueryData, getQueryData and query() there get an empty cache of their own. Call them in a loader, an action or a component the server renders. On an edge runtime, enable AsyncLocalStorage (Cloudflare Workers: the nodejs_compat flag).',
    codeExample: `// Bad: runs at import time, with no request in scope.
prefetchQuery(['config'], loadConfig);

// Good: in the loader, which runs in the request's render.
export async function loader() {
  await prefetchQuery(['config'], loadConfig);
  return null;
}`,
  },

  ISR_MISSING_CLIENT: {
    code: 'ERR_ISR_MISSING_CLIENT',
    severity: 'error',
    template: '[what-isr] createRedisStore requires { client }',
    suggestion: 'what-isr ships no Redis driver on purpose, so the client is injected. Pass an ioredis or node-redis instance (get/set/del/sadd/srem/smembers, optionally expire/scan/keys).',
    codeExample: `import Redis from 'ioredis';
const store = createRedisStore({ client: new Redis(process.env.REDIS_URL) });`,
  },

  ISR_VARY_UNRESOLVED: {
    code: 'ERR_ISR_VARY_UNRESOLVED',
    severity: 'error',
    template: '[what-isr] cannot build a cache key: `vary` is declared but could not be resolved against the request.',
    suggestion: 'A declared vary is a list of names that must be resolved against real request headers before it can be part of a key. Either pass the request headers alongside the declaration, or pass an already-resolved name -> value object. Guessing would cache one visitor page under another visitor key.',
    codeExample: `// Bad — a declaration with nothing to resolve it against:
cacheKey({ path, vary: ['cookie:session'] });

// Good — supply the headers:
cacheKey({ path, vary: ['cookie:session'], headers: request.headers });

// Good — or resolve it yourself:
cacheKey({ path, vary: { 'cookie:session': sessionId } });`,
  },

  ISR_VARY_NO_HEADERS: {
    code: 'ERR_ISR_VARY_NO_HEADERS',
    severity: 'error',
    template: '[what-isr] route declares `vary` but the adapter supplied no request headers; refusing to cache.',
    suggestion: 'The route varies its output per header, and the adapter called the engine without them. Caching anyway would serve one variant to every request. Forward the request headers from the adapter into the engine call.',
    codeExample: `// In the adapter, the route match carries the request headers:
await engine.handle({ ...routeMatch, headers: request.headers });`,
  },

  DUPLICATE_ACTION_ID: {
    code: 'ERR_DUPLICATE_ACTION_ID',
    severity: 'error',
    template: 'Duplicate server action ID "{{id}}".',
    suggestion: 'Action ids are the wire address of a server action, so two actions cannot share one. Ids derive from the file path and export name, so this usually means the same action is being registered twice, or an explicit id was reused.',
    codeExample: `import { action } from 'what-framework/server';

// Bad — two actions pinned to the same id:
export const save = action(fn, { id: 'save' });
export const store = action(fn, { id: 'save' });

// Good — let ids derive, or make them distinct:
import { action } from 'what-framework/server';
export const save = action(fn);
export const store = action(fn, { id: 'store-user' });`,
  },

  PAGE_NO_DEFAULT_EXPORT: {
    code: 'ERR_PAGE_NO_DEFAULT_EXPORT',
    severity: 'error',
    template: 'Page module has no default-exported component.',
    suggestion: 'A page file must default-export the component to render. A named export cannot be found by the file-router.',
    codeExample: `// Bad:
export function Home() { return <h1>Hi</h1>; }

// Good:
export default function Home() { return <h1>Hi</h1>; }`,
  },

  HOOK_OUTSIDE_RENDER: {
    code: 'ERR_HOOK_OUTSIDE_RENDER',
    severity: 'error',
    template: '[what-react] {{hookName}}() called outside of a component render.',
    suggestion: 'Hooks can only be called while a what-react component is rendering. When this happens inside a React library, the usual cause is two module instances: make sure every `react` and `react-dom` import is aliased to what-react by the reactCompat() vite plugin.',
    codeExample: `// vite.config.js
import { reactCompat } from 'what-react/vite';
export default { plugins: [reactCompat()] };`,
  },

  CLASS_COMPONENT_NOT_INSTALLED: {
    code: 'ERR_CLASS_COMPONENT_NOT_INSTALLED',
    severity: 'error',
    template: "[what-react] {{name}} is a class component, which this bundle cannot render: use what-react's Vite plugin, import 'what-react/class', or extend Component.",
    suggestion: "Class components come with what-react's Component and PureComponent, or with `what-react/class`. A class whose prototype is marked isReactComponent without extending Component (by hand, or by a library) needs the install. reactCompat() adds `import 'what-react/class'` to every module that has the marker; a build without the plugin (esbuild, another bundler) imports it once, in its entry.",
    codeExample: `// main.jsx, built without what-react's Vite plugin
import 'what-react/class';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';

createRoot(document.getElementById('app')).render(<App />);`,
  },

  CHILDREN_ONLY: {
    code: 'ERR_CHILDREN_ONLY',
    severity: 'error',
    template: 'React.Children.only expected to receive a single React element child.',
    suggestion: 'Children.only asserts exactly one element. Pass one child, or use Children.toArray/Children.map when the count can vary.',
    codeExample: `// Bad:
<Tooltip><span>a</span><span>b</span></Tooltip>

// Good:
<Tooltip><span>a</span></Tooltip>`,
  },

  USE_INVALID_ARG: {
    code: 'ERR_USE_INVALID_ARG',
    severity: 'error',
    template: '[what-react] use() expects a promise or a context.',
    suggestion: 'use() reads either a thenable or a context object. Anything else has nothing to suspend on or subscribe to. A promise read with use() must outlive the component: make it outside the component and pass it in, since one made in the body is a new promise every time the component runs.',
    codeExample: `// Good — a context, and a promise made outside the component:
function Profile({ userPromise }) {
  const theme = use(ThemeContext);
  const user = use(userPromise);
  return <p className={theme}>{user.name}</p>;
}`,
  },

  PRETEXT_NOT_INSTALLED: {
    code: 'ERR_PRETEXT_NOT_INSTALLED',
    severity: 'error',
    template: '[what-text] Failed to load @chenglou/pretext: {{message}}.',
    suggestion: 'what-text declares pretext as an optional peer so the package installs without it. Install it to use the text engine: npm install @chenglou/pretext',
    codeExample: `// Install the optional peer first: npm install @chenglou/pretext
// Then load it up front, so a missing install fails at startup:
import { ensurePretext } from 'what-text';
await ensurePretext();`,
  },

  MOVED_IMPORT: {
    code: 'ERR_MOVED_IMPORT',
    severity: 'error',
    template: '"{{name}}" is not exported by {{source}}. {{answer}}',
    suggestion: 'In 0.15 the root entry (what-framework, and what-core alike) kept the core API: the domain kits moved to subpaths such as what-framework/form and what-framework/ui, a few names were renamed, and some were removed. Each name has one answer, recorded in IMPORT_CHANGES (what-core/internal) and listed in UPGRADING.md. eslint --fix with eslint-plugin-what\'s no-moved-imports rule splits the import per destination; a removed name is left for you to replace as its answer says.',
    codeExample: `// Bad - useForm and Spinner left the root entry in 0.15:
import { signal, useForm, Spinner } from 'what-framework';

// Good:
import { signal } from 'what-framework';
import { useForm } from 'what-framework/form';
import { Spinner } from 'what-framework/ui';`,
  },

  // --- Fallbacks ---
  // classifyError() returns one of these when a raw Error does not match any
  // known pattern. They are catalogued so what_errors never reports a code an
  // agent cannot look up.

  RUNTIME: {
    code: 'ERR_RUNTIME',
    severity: 'error',
    template: '{{message}}',
    suggestion: 'An error surfaced that the framework could not classify, so the message is the original one verbatim. The stack, file and line on the error narrow it; if the same shape shows up repeatedly it is worth its own code here.',
    codeExample: `// Inspect the structured form rather than the string:
try { render(); } catch (e) { console.log(classifyError(e).toJSON()); }`,
  },

  UNKNOWN: {
    code: 'ERR_UNKNOWN',
    severity: 'error',
    template: 'Unknown error: {{errorCode}}',
    suggestion: 'createWhatError() was called with a code that is not in this catalogue. Check the spelling against ERROR_CODES, or add the entry.',
    codeExample: `import { createWhatError } from 'what-core/internal';

// Bad - not a catalogue key:
throw createWhatError('MISSING_KEYS');

// Good:
createWhatError('MISSING_KEY', { component: 'TodoList' });`,
  },

  UNKNOWN_TOOL: {
    code: 'ERR_UNKNOWN_TOOL',
    severity: 'error',
    template: 'Unknown tool: {{name}}.',
    suggestion: 'The MCP client called a tool this server does not expose. Call tools/list to enumerate what is available; a stale client cache is the usual cause.',
    codeExample: `// List what the server actually exposes (tools/list), with the MCP SDK client:
const { tools } = await client.listTools();`,
  },
};

// Reverse index: an error carries its full ERR_* code, and the catalogue is keyed
// by its short name.
//
// Built on first use, NOT at module load. A top-level `new Map(...)` over
// ERROR_CODES is a side effect that references the catalogue, which pins it
// into every bundle that imports what-core: it took the counter app from
// 6.4 KB gzipped to 12.1 KB and tripped check:size. Inside a function, a
// bundler that drops getErrorDefinition drops the catalogue with it.
/** @type {Map<string, any> | null} */
let _codeIndex = null;

/** Look up a catalogue entry by its `ERR_*` code. Returns undefined if unknown. */
export function getErrorDefinition(code) {
  if (_codeIndex === null) {
    _codeIndex = new Map(Object.values(ERROR_CODES).map((def) => [def.code, def]));
  }
  return _codeIndex.get(code);
}

// --- WhatError ---
// Structured error class with full context for agent consumption.

export class WhatError extends Error {
  // codeExample carries the bad/good pair from the error's ERROR_CODES entry.
  // Every entry above already had one; the class simply dropped it on the
  // floor, so the field the docs promise on the serialized error was never
  // there and `suggestion` had to carry the whole fix in prose. It matters more
  // here than in a framework aimed at humans: the audience reading toJSON() is
  // usually an agent, and a diff-shaped example is the part it can copy.
  //
  // The class never reads the catalogue: it is a root export that apps import
  // for `instanceof`, and a lookup here kept all of ERROR_CODES (about 14 KB
  // gzipped) in those bundles. createWhatError() and classifyError() fill
  // severity, suggestion and codeExample from the entry.
  /**
   * @param {object} init
   * @param {string} init.code
   * @param {'error' | 'warning'} [init.severity]
   * @param {string} [init.message]
   * @param {string} [init.suggestion]
   * @param {{ bad?: string, good?: string } | string} [init.codeExample]
   * @param {string} [init.file]
   * @param {number} [init.line]
   * @param {string} [init.component]
   * @param {string} [init.signal]
   * @param {string} [init.effect]
   */
  constructor({ code, severity, message, suggestion, codeExample, file, line, component, signal, effect }) {
    super(message);
    this.name = 'WhatError';
    this.code = code;
    this.severity = severity || 'error';
    this.suggestion = suggestion;
    this.codeExample = codeExample;
    this.file = file;
    this.line = line;
    this.component = component;
    this.signal = signal;
    this.effect = effect;
  }

  toJSON() {
    return {
      code: this.code,
      severity: this.severity,
      message: this.message,
      suggestion: this.suggestion,
      codeExample: this.codeExample,
      file: this.file,
      line: this.line,
      component: this.component,
      signal: this.signal,
      effect: this.effect,
    };
  }
}

// --- Error Factory ---
// Create WhatError instances from error codes with template interpolation.

export function createWhatError(errorCode, context = {}) {
  const def = typeof errorCode === 'string' ? ERROR_CODES[errorCode] : errorCode;
  if (!def) {
    return new WhatError({
      code: 'ERR_UNKNOWN',
      severity: /** @type {'error' | 'warning'} */ (ERROR_CODES.UNKNOWN.severity),
      message: `Unknown error: ${errorCode}`,
      suggestion: ERROR_CODES.UNKNOWN.suggestion,
      codeExample: ERROR_CODES.UNKNOWN.codeExample,
    });
  }

  // Interpolate template with context values
  let message = def.template;
  for (const [key, val] of Object.entries(context)) {
    message = message.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val));
  }
  // Clean up any unreplaced placeholders
  message = message.replace(/\{\{[^}]+\}\}/g, '(unknown)');

  return new WhatError({
    code: def.code,
    severity: def.severity,
    message,
    suggestion: def.suggestion,
    // Verbatim from the definition: codeExample is a worked bad/good pair, not
    // a template, so there is nothing in it to interpolate.
    codeExample: def.codeExample,
    file: context.file,
    line: context.line,
    component: context.component,
    signal: context.signal || context.signalName,
    effect: context.effect || context.effectName,
  });
}

// --- Error Classification ---
// Classify a raw Error into a structured WhatError if possible.

export function classifyError(err, context = {}) {
  const msg = err?.message || String(err);

  // An error the framework threw already says what it is. Every throw outside
  // core carries a `code` and nothing else — the suggestion and the worked
  // example live once, in ERROR_CODES — so resolving the code here is what
  // makes them reachable at all. Framework checks report through
  // diagnostics.js; nothing here guesses a code from message text, because a
  // guessed code sends an agent to the wrong fix.
  if (err && typeof err.code === 'string') {
    const def = getErrorDefinition(err.code);
    if (def) {
      return new WhatError({
        code: def.code,
        severity: def.severity,
        // The thrown message is the specific one; the template is generic.
        message: msg,
        suggestion: def.suggestion,
        codeExample: def.codeExample,
        file: context.file,
        line: context.line,
        component: context.component,
        signal: context.signal || context.signalName,
        effect: context.effect || context.effectName,
      });
    }
  }

  // Fallback — return a generic WhatError with the original message
  return new WhatError({
    code: 'ERR_RUNTIME',
    severity: /** @type {'error' | 'warning'} */ (ERROR_CODES.RUNTIME.severity),
    message: msg,
    suggestion: ERROR_CODES.RUNTIME.suggestion,
    codeExample: ERROR_CODES.RUNTIME.codeExample,
    ...context,
  });
}
