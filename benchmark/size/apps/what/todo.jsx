import { computed, mount, signal } from 'what-framework';

function App() {
  const todos = signal([]);
  const filter = signal('all');
  let nextId = 0;

  const visible = computed(() => todos().filter(todo =>
    filter() === 'all' || todo.done() === (filter() === 'done')
  ));
  const remaining = computed(() => todos().filter(todo => !todo.done()).length);
  const add = event => {
    event.preventDefault();
    const input = event.currentTarget.elements.title;
    const title = input.value.trim();
    if (!title) return;
    const todo = { id: nextId++, title, done: signal(false) };
    todos(items => [...items, todo]);
    input.value = '';
  };
  const remove = id => todos(items => items.filter(todo => todo.id !== id));

  return (
    <main>
      <h1>Todo</h1>
      <form onsubmit={add}>
        <input name="title" aria-label="New todo" />
        <button type="submit">Add</button>
      </form>
      <nav aria-label="Filter">
        <button type="button" onclick={() => filter('all')}>All</button>
        <button type="button" onclick={() => filter('active')}>Active</button>
        <button type="button" onclick={() => filter('done')}>Done</button>
      </nav>
      <p>{remaining()} left</p>
      <ul>
        {visible().map(todo => (
          <li key={todo.id}>
            <label><input type="checkbox" checked={todo.done()} onchange={event => todo.done(event.currentTarget.checked)} />{todo.title}</label>
            <button type="button" onclick={() => remove(todo.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </main>
  );
}

mount(<App />, document.getElementById('app'));
