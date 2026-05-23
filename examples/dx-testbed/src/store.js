import { signal, computed, batch } from 'what-framework';

export const todos = signal([], 'todos');
export const filter = signal('all', 'filter');
export const newText = signal('', 'newText');

export const filteredTodos = computed(() => {
  const f = filter();
  const all = todos();
  if (f === 'all') return all;
  if (f === 'active') return all.filter(t => !t.done);
  return all.filter(t => t.done);
});

export const counts = computed(() => {
  const all = todos();
  return {
    total: all.length,
    active: all.filter(t => !t.done).length,
    done: all.filter(t => t.done).length,
  };
});

let nextId = 1;

export function addTodo() {
  const text = newText().trim();
  if (!text) return;
  todos(prev => [...prev, { id: nextId++, text, done: false }]);
  newText('');
}

export function toggleTodo(id) {
  todos(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
}

export function removeTodo(id) {
  todos(prev => prev.filter(t => t.id !== id));
}

export function clearDone() {
  todos(prev => prev.filter(t => !t.done));
}
