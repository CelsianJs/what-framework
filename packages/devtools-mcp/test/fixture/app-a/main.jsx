// The review's app A, one seeded bug per finding. The devtools bootstrap is
// injected before this module, so everything here is observed from the start.
import { signal, effect, createStore, useState, mount, batch, Show } from 'what-framework';
import { useForm } from 'what-framework/form';
import { beforeNavigate, route } from 'what-framework/router';

const todo = createStore({
  items: [{ id: 1, title: 'First' }, { id: 2, title: 'Second' }],
  add(title) { this.items = [...this.items, { id: this.items.length + 1, title }]; },
})();
const title = signal('Todos', 'displayTitle');
// Seeded: an uncalled signal at module scope (ERR_MISSING_SIGNAL_READ at startup).
const label = `Title: ${title}`;
const sample = signal(null, 'sample');
const refresh = signal(0, 'refresh');
const testLarge = signal(Array.from({ length: 105 }, (_, i) => i), 'testLarge');
const circ = {}; circ.self = circ;
const circular = signal(circ, 'circular');
const startup = signal(0, 'startup');
const source = signal('', 'source');
const derived = signal(0, 'derivedLength');
const tick = signal(0, 'selfLoop');
const startLoop = signal(false, 'startLoop');

// Seeded: an effect that throws during startup, before the bridge connects.
effect(function startupEffect() {
  if (startup()) throw new Error('Startup todo effect failed before MCP connection');
});
startup(1);

// Writer attribution: this effect is the writer of derivedLength.
effect(function syncLength() { derived(source().length); });

// Seeded: an effect that reads and writes the same signal.
effect(function selfWritingEffect() {
  if (startLoop()) tick(tick() + 1);
});

// A guard that holds the router for a while, so the URL changes before the view.
beforeNavigate(async () => {
  await new Promise((resolve) => setTimeout(resolve, 120));
  return true;
});

window.review = {
  current: () => ({ sample: sample(), refresh: refresh(), tick: tick(), items: todo.items.length, circular: circular(), last: testLarge().at(-1) }),
};

function TodoForm() {
  const form = useForm({ defaultValues: { name: 'new task' } });
  const field = form.register('name');
  return <form id="add-form" onSubmit={form.handleSubmit((values) => todo.add(values.name))}>
    <input {...field} />
    <button type="button" id="wrong" onClick={() => field.oninput()}>Wrong handler</button>
  </form>;
}

function HookButton() {
  // Seeded: a hook called in an event handler (thrown, ERR_HOOK_OUTSIDE_COMPONENT).
  return <button id="hook" onClick={() => useState(0)}>Hook outside</button>;
}

function Archive() { return <h2>Archive</h2>; }

function App() {
  return <main>
    <h1>{label}</h1>
    <p id="refresh">{refresh()}</p>
    <p id="sample">{() => JSON.stringify(sample())}</p>
    <Show when={() => route.path === '/archive'} fallback={<h2>Todos</h2>}><Archive /></Show>
    <TodoForm /><HookButton />
    <button id="many" onClick={() => { for (let i = 0; i < 110; i++) signal(i, 'bulk' + i); }}>Create signals</button>
    <button id="diagnostic-flood" onClick={() => { for (let i = 0; i < 505; i++) String(signal(i, 'warning' + i)); }}>Flood diagnostics</button>
    <button id="flood" onClick={() => batch(() => { for (let i = 1; i <= 50; i++) refresh(refresh.peek() + 1); })}>Flood writes</button>
  </main>;
}
mount(<App />, '#app');
