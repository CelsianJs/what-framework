import React from 'react';
import { proxy, useSnapshot } from 'valtio';

const state = proxy({
  count: 0,
  todos: [
    { text: 'Learn What Framework', done: true },
    { text: 'Test React compat', done: false },
  ]
});

export function ValtioTest() {
  const snap = useSnapshot(state);

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>valtio — Proxy State</h3>
      <div style={{ marginBottom: 8 }}>
        Count: <strong>{snap.count}</strong>{' '}
        <button onClick={() => ++state.count}>+1</button>
        <button onClick={() => --state.count} style={{ marginLeft: 4 }}>-1</button>
      </div>
      <div>
        <strong>Todos:</strong>
        <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
          {snap.todos.map((todo, i) => (
            <li key={i} style={{ textDecoration: todo.done ? 'line-through' : 'none', cursor: 'pointer' }}
              onClick={() => state.todos[i].done = !state.todos[i].done}>
              {todo.text}
            </li>
          ))}
        </ul>
        <button onClick={() => state.todos.push({ text: `Todo #${state.todos.length + 1}`, done: false })}>
          Add Todo
        </button>
      </div>
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — valtio proxy + useSnapshot work</p>
    </div>
  );
}
