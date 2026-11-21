import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [todos, setTodos] = useState([]);
  const [filter, setFilter] = useState('all');
  const nextId = useRef(0);

  const visible = todos.filter(todo =>
    filter === 'all' || todo.done === (filter === 'done')
  );
  const remaining = todos.filter(todo => !todo.done).length;
  const add = event => {
    event.preventDefault();
    const input = event.currentTarget.elements.title;
    const title = input.value.trim();
    if (!title) return;
    const todo = { id: nextId.current++, title, done: false };
    setTodos(items => [...items, todo]);
    input.value = '';
  };
  const toggle = (id, done) => setTodos(items => items.map(todo => todo.id === id ? { ...todo, done } : todo));
  const remove = id => setTodos(items => items.filter(todo => todo.id !== id));

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
      <p>{remaining} left</p>
      <ul>
        {visible.map(todo => (
          <li key={todo.id}>
            <label><input type="checkbox" checked={todo.done} onChange={event => toggle(todo.id, event.currentTarget.checked)} />{todo.title}</label>
            <button type="button" onClick={() => remove(todo.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </main>
  );
}

createRoot(document.getElementById('app')).render(<App />);
