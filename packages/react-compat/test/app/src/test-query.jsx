/**
 * Test: TanStack React Query inside What Framework
 *
 * React Query is the standard for server state management:
 * - QueryClient + QueryClientProvider (context)
 * - useQuery hook (useSyncExternalStore internally)
 * - Caching, refetching, stale-while-revalidate
 * - Mutation hooks
 * - Devtools integration
 */
import { useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: false,
    },
  },
});

// Fake API with delay
const fakeTodos = [
  { id: 1, title: 'Learn What Framework', done: true },
  { id: 2, title: 'Build React compat layer', done: true },
  { id: 3, title: 'Test with React Query', done: false },
  { id: 4, title: 'Ship to production', done: false },
];

let nextId = 5;

async function fetchTodos() {
  await new Promise((r) => setTimeout(r, 500));
  return [...fakeTodos];
}

async function addTodo(title) {
  await new Promise((r) => setTimeout(r, 300));
  const todo = { id: nextId++, title, done: false };
  fakeTodos.push(todo);
  return todo;
}

function TodoList() {
  const queryClient = useQueryClient();
  const [newTodo, setNewTodo] = useState('');

  const { data: todos, isLoading, error, isFetching } = useQuery({
    queryKey: ['todos'],
    queryFn: fetchTodos,
  });

  const mutation = useMutation({
    mutationFn: addTodo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] });
    },
  });

  const handleAdd = () => {
    if (newTodo.trim()) {
      mutation.mutate(newTodo.trim());
      setNewTodo('');
    }
  };

  if (isLoading) return <p>Loading todos...</p>;
  if (error) return <p style={{ color: 'red' }}>Error: {error.message}</p>;

  return (
    <div>
      <div style={{ marginBottom: '12px', display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={newTodo}
          oninput={(e) => setNewTodo(e.target.value)}
          onkeydown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="Add a todo..."
          style={{
            padding: '4px 8px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            flex: 1,
          }}
        />
        <button
          onclick={handleAdd}
          disabled={mutation.isPending}
          style={{
            padding: '4px 12px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            background: '#f5f5f5',
            cursor: 'pointer',
          }}
        >
          {mutation.isPending ? 'Adding...' : 'Add'}
        </button>
      </div>
      {isFetching && <p style={{ fontSize: '12px', color: '#888' }}>Refreshing...</p>}
      <ul style={{ padding: '0 0 0 20px', margin: 0 }}>
        {todos.map((todo) => (
          <li
            key={todo.id}
            style={{
              textDecoration: todo.done ? 'line-through' : 'none',
              color: todo.done ? '#999' : '#333',
              padding: '2px 0',
            }}
          >
            {todo.title}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function QueryTest() {
  return (
    <QueryClientProvider client={queryClient}>
      <TodoList />
      <p style={{ color: 'green' }} id="query-status">React Query loaded OK</p>
    </QueryClientProvider>
  );
}
