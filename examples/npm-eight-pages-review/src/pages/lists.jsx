import { For, Match, Show, Switch, useComputed, useSignal } from 'what-framework';

export const page = {
  mode: 'client',
};

export default function ListsPage() {
  const items = useSignal([
    { id: 1, label: 'Read API docs', done: false },
    { id: 2, label: 'Build page examples', done: true },
    { id: 3, label: 'Validate DX', done: false },
  ]);
  const nextLabel = useSignal('');

  const remaining = useComputed(() => items().filter((item) => !item.done).length);

  const addItem = () => {
    const label = nextLabel().trim();
    if (!label) return;

    const nextId = items().reduce((max, item) => Math.max(max, item.id), 0) + 1;
    items([...items(), { id: nextId, label, done: false }]);
    nextLabel('');
  };

  const toggleItem = (id) => {
    items(items().map((item) => (item.id === id ? { ...item, done: !item.done } : item)));
  };

  const removeItem = (id) => {
    items(items().filter((item) => item.id !== id));
  };

  return (
    <section>
      <h1 class="page-title">List rendering and conditional components</h1>
      <p class="lead">Uses <code>For</code>, <code>Show</code>, <code>Switch</code>, and <code>Match</code>.</p>

      <div class="card">
        <div class="button-row">
          <input
            class="text-input"
            placeholder="Add a todo"
            value={nextLabel()}
            onInput={(e) => nextLabel(e.target.value)}
          />
          <button class="btn btn-primary" onClick={addItem}>Add</button>
        </div>

        <p class="small-note">Remaining tasks: <strong>{remaining()}</strong></p>

        <Show when={items().length > 0} fallback={<p class="small-note">No items yet.</p>}>
          <ul class="stack-list">
            <For each={items()}>
              {(item) => (
                <li class="row" data-done={item.done ? 'true' : 'false'}>
                  <label class="row-main">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => toggleItem(item.id)}
                    />
                    <span>{item.label}</span>
                  </label>
                  <button class="btn btn-ghost" onClick={() => removeItem(item.id)}>Remove</button>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Switch fallback={<p class="small-note">Keep going.</p>}>
          <Match when={items().length > 0 && remaining() === 0}>
            <p class="success-note">All tasks complete.</p>
          </Match>
          <Match when={remaining() > 2}>
            <p class="warn-note">You still have multiple tasks open.</p>
          </Match>
        </Switch>
      </div>
    </section>
  );
}
