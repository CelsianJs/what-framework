import { createMemo, createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';

function App() {
  const [todos, setTodos] = createSignal([]);
  const [filter, setFilter] = createSignal('all');

  const visible = createMemo(() => todos().filter(todo =>
    filter() === 'all' || todo.done() === (filter() === 'done')
  ));
  const remaining = createMemo(() => todos().filter(todo => !todo.done()).length);
  const add = event => {
    event.preventDefault();
    const input = event.currentTarget.elements.title;
    const title = input.value.trim();
    if (!title) return;
    const [done, setDone] = createSignal(false);
    const todo = { title, done, setDone };
    setTodos(items => [...items, todo]);
    input.value = '';
  };
  const remove = item => setTodos(items => items.filter(todo => todo !== item));

  return (
    <main>
      <h1>Todo</h1>
      <form onSubmit={add}>
        <input name="title" aria-label="New todo" />
        <button type="submit">Add</button>
      </form>
      <nav aria-label="Filter">
        <button type="button" onClick={() => setFilter('all')}>All</button>
        <button type="button" onClick={() => setFilter('active')}>Active</button>
        <button type="button" onClick={() => setFilter('done')}>Done</button>
      </nav>
      <p>{remaining()} left</p>
      <ul>
        <For each={visible()}>{todo => (
          <li>
            <label><input type="checkbox" checked={todo.done()} onChange={event => todo.setDone(event.currentTarget.checked)} />{todo.title}</label>
            <button type="button" onClick={() => remove(todo)}>Remove</button>
          </li>
        )}</For>
      </ul>
    </main>
  );
}

render(() => <App />, document.getElementById('app'));
