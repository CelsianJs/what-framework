import { mount, useSignal, createStore, derived } from 'what-framework';

const useTodos = createStore({
  todos: [
    { id: 1, text: 'Ship npm major cleanup', done: true },
    { id: 2, text: 'Review docs for consistency', done: false },
    { id: 3, text: 'Confirm benchmark gate', done: false },
  ],
  filter: 'all',
  remaining: derived((state) => state.todos.filter((t) => !t.done).length),
  visible: derived((state) => {
    if (state.filter === 'active') return state.todos.filter((t) => !t.done);
    if (state.filter === 'done') return state.todos.filter((t) => t.done);
    return state.todos;
  }),
  add(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.todos = [...this.todos, { id: Date.now(), text: trimmed, done: false }];
  },
  toggle(id) {
    this.todos = this.todos.map((todo) =>
      todo.id === id ? { ...todo, done: !todo.done } : todo
    );
  },
  setFilter(next) {
    this.filter = next;
  },
});

function App() {
  const draft = useSignal('');
  const store = useTodos();

  function submit(e) {
    e.preventDefault();
    store.add(draft());
    draft('');
  }

  return (
    <main className="app-shell">
      <h1>App 03: Store + Derived</h1>
      <p>Global-ish store ergonomics with derived selectors.</p>

      <form onSubmit={submit} className="row">
        <input
          value={draft()}
          onInput={(e) => draft(e.target.value)}
          placeholder="Add a todo"
        />
        <button type="submit">Add</button>
      </form>

      <nav className="row">
        <button className={store.filter === 'all' ? 'active' : ''} onClick={() => store.setFilter('all')}>All</button>
        <button className={store.filter === 'active' ? 'active' : ''} onClick={() => store.setFilter('active')}>Active</button>
        <button className={store.filter === 'done' ? 'active' : ''} onClick={() => store.setFilter('done')}>Done</button>
      </nav>

      <ul>
        {store.visible.map((todo) => (
          <li key={todo.id}>
            <label>
              <input
                type="checkbox"
                checked={todo.done}
                onInput={() => store.toggle(todo.id)}
              />
              <span className={todo.done ? 'done' : ''}>{todo.text}</span>
            </label>
          </li>
        ))}
      </ul>

      <footer>{store.remaining} remaining</footer>
    </main>
  );
}

mount(<App />, '#app');
