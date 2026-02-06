import { h, useState, useSignal, useEffect, useRef, useMemo, useReducer, signal, computed, batch } from '@what/core';

// --- Counter Demo ---
function Counter() {
  const [count, setCount] = useState(0);
  const doubled = useMemo(() => count * 2, [count]);

  return h('div', { class: 'counter-demo' },
    h('h3', null, 'Counter with Computed'),
    h('div', { class: 'counter-controls' },
      h('button', { onClick: () => setCount(c => c - 1) }, '\u2212'),
      h('span', { class: 'counter-value' }, count),
      h('button', { onClick: () => setCount(c => c + 1) }, '+'),
    ),
    h('p', { style: 'margin-top:1rem;color:var(--muted)' }, 'Doubled: ', doubled),
  );
}

// --- Todo List Demo ---
function TodoList() {
  const [todos, setTodos] = useState([]);
  const [input, setInput] = useState('');
  const inputRef = useRef(null);

  const remaining = useMemo(
    () => todos.filter(t => !t.done).length,
    [todos]
  );

  const addTodo = () => {
    if (!input.trim()) return;
    setTodos(prev => [...prev, { id: Date.now(), text: input.trim(), done: false }]);
    setInput('');
  };

  const toggle = (id) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  const remove = (id) => {
    setTodos(prev => prev.filter(t => t.id !== id));
  };

  return h('div', { class: 'todo-demo' },
    h('h3', null, 'Todo List'),
    h('div', { class: 'todo-input' },
      h('input', {
        ref: inputRef,
        value: input,
        placeholder: 'Add a todo...',
        onInput: (e) => setInput(e.target.value),
        onKeydown: (e) => e.key === 'Enter' && addTodo(),
      }),
      h('button', { onClick: addTodo }, 'Add'),
    ),
    h('ul', { class: 'todo-list' },
      ...todos.map(todo =>
        h('li', { key: todo.id, class: `todo-item${todo.done ? ' done' : ''}` },
          h('input', {
            type: 'checkbox',
            checked: todo.done,
            onChange: () => toggle(todo.id),
          }),
          h('span', null, todo.text),
          h('button', { onClick: () => remove(todo.id) }, 'remove'),
        )
      ),
    ),
    todos.length > 0
      ? h('p', { class: 'todo-stats' }, `${remaining} remaining of ${todos.length} total`)
      : h('p', { class: 'todo-stats' }, 'No todos yet. Add one above!'),
  );
}

// --- Timer Demo ---
function Timer() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setSeconds(s => s + 1);
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  const formatted = useMemo(() => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, [seconds]);

  return h('div', { class: 'counter-demo' },
    h('h3', null, 'Timer'),
    h('span', { class: 'counter-value' }, formatted),
    h('div', { style: 'display:flex;gap:0.5rem;justify-content:center;margin-top:1rem' },
      h('button', { class: 'btn btn-primary', onClick: () => setRunning(r => !r) },
        running ? 'Pause' : 'Start',
      ),
      h('button', { class: 'btn btn-outline', onClick: () => { setRunning(false); setSeconds(0); } },
        'Reset',
      ),
    ),
  );
}

// --- Reducer Demo ---
function ReducerDemo() {
  function reducer(state, action) {
    switch (action.type) {
      case 'increment': return { count: state.count + 1 };
      case 'decrement': return { count: state.count - 1 };
      case 'reset': return { count: 0 };
      default: return state;
    }
  }

  const [state, dispatch] = useReducer(reducer, { count: 0 });

  return h('div', { class: 'counter-demo' },
    h('h3', null, 'useReducer'),
    h('div', { class: 'counter-controls' },
      h('button', { onClick: () => dispatch({ type: 'decrement' }) }, '\u2212'),
      h('span', { class: 'counter-value' }, state.count),
      h('button', { onClick: () => dispatch({ type: 'increment' }) }, '+'),
    ),
    h('button', {
      class: 'btn btn-outline',
      style: 'margin-top:1rem',
      onClick: () => dispatch({ type: 'reset' }),
    }, 'Reset'),
  );
}

// --- Main Demos Page ---
export function Demos() {
  return h('div', null,
    h('h1', null, 'Interactive Demos'),
    h('p', { style: 'color:var(--muted);margin-bottom:2rem' },
      'Each demo showcases a different feature of the What framework. All state is local, all updates are surgical.'
    ),

    h('div', { class: 'section' },
      h('h2', null, 'Signals + useState'),
      h(Counter),
    ),

    h('div', { class: 'section' },
      h('h2', null, 'Stateful List'),
      h(TodoList),
    ),

    h('div', { class: 'section' },
      h('h2', null, 'Effects + Refs'),
      h(Timer),
    ),

    h('div', { class: 'section' },
      h('h2', null, 'useReducer'),
      h(ReducerDemo),
    ),
  );
}
