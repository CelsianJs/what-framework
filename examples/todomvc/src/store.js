// TodoMVC Store — Signal-based reactive state
// Demonstrates: useSignal, useComputed, useEffect, batch

import { useSignal, useComputed, useEffect, batch } from 'what-framework';

const STORAGE_KEY = 'what-todomvc';

function loadTodos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTodos(todos) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  } catch {
    // localStorage may be unavailable
  }
}

let nextId = Date.now();

export function useTodoStore() {
  const todos = useSignal(loadTodos());
  const filter = useSignal('all'); // 'all' | 'active' | 'completed'

  // Derived state via useComputed
  const activeCount = useComputed(() =>
    todos().filter(t => !t.completed).length
  );

  const completedCount = useComputed(() =>
    todos().filter(t => t.completed).length
  );

  const filteredTodos = useComputed(() => {
    const f = filter();
    const list = todos();
    if (f === 'active') return list.filter(t => !t.completed);
    if (f === 'completed') return list.filter(t => t.completed);
    return list;
  });

  const allCompleted = useComputed(() => {
    const list = todos();
    return list.length > 0 && list.every(t => t.completed);
  });

  // Persist to localStorage whenever todos change
  useEffect(() => {
    saveTodos(todos());
  });

  // Hash-based routing for filter state
  useEffect(() => {
    function onHashChange() {
      const hash = window.location.hash;
      if (hash === '#/active') filter.set('active');
      else if (hash === '#/completed') filter.set('completed');
      else filter.set('all');
    }

    // Read initial hash
    onHashChange();

    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Actions
  function addTodo(title) {
    const trimmed = title.trim();
    if (!trimmed) return;
    todos.set(prev => [
      ...prev,
      { id: nextId++, title: trimmed, completed: false },
    ]);
  }

  function removeTodo(id) {
    todos.set(prev => prev.filter(t => t.id !== id));
  }

  function toggleTodo(id) {
    todos.set(prev =>
      prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t)
    );
  }

  function editTodo(id, title) {
    const trimmed = title.trim();
    if (!trimmed) {
      removeTodo(id);
      return;
    }
    todos.set(prev =>
      prev.map(t => t.id === id ? { ...t, title: trimmed } : t)
    );
  }

  function toggleAll() {
    const allDone = allCompleted();
    todos.set(prev =>
      prev.map(t => ({ ...t, completed: !allDone }))
    );
  }

  function clearCompleted() {
    todos.set(prev => prev.filter(t => !t.completed));
  }

  function setFilter(f) {
    filter.set(f);
    window.location.hash = f === 'all' ? '#/' : `#/${f}`;
  }

  return {
    todos,
    filter,
    activeCount,
    completedCount,
    filteredTodos,
    allCompleted,
    addTodo,
    removeTodo,
    toggleTodo,
    editTodo,
    toggleAll,
    clearCompleted,
    setFilter,
  };
}
