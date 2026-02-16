import { useSignal, useLocalStorage, effect, untrack } from 'what-framework';
import { useBoardStore } from './store/board';
import { Board } from './components/Board';

export function App() {
  const store = useBoardStore();
  const search = useSignal('');

  // Persist board state to localStorage
  const savedTasks = useLocalStorage('kanban-tasks', null);

  // On first render, restore saved tasks if available
  const saved = untrack(() => savedTasks());
  if (saved && Array.isArray(saved) && saved.length > 0) {
    store.setTasks(saved);
  }

  // Save tasks to localStorage whenever they change
  effect(() => {
    const tasks = store.tasks;
    const current = untrack(() => savedTasks());
    // Only write if tasks have actually changed from what's stored
    if (JSON.stringify(tasks) !== JSON.stringify(current)) {
      untrack(() => savedTasks(tasks));
    }
  });

  return (
    <div>
      <header style="margin-bottom: 2rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem;">
          <div>
            <h1 style="font-size: 1.75rem; font-weight: 700; color: #fff; margin-bottom: 0.25rem;">
              Kanban Board
            </h1>
            <p style="color: #737373; font-size: 0.875rem;">
              {() => `${store.taskCount} task${store.taskCount !== 1 ? 's' : ''} total`}
            </p>
          </div>
          <div style="position: relative;">
            <input
              type="text"
              placeholder="Search tasks..."
              value={search()}
              oninput={(e) => search(e.target.value)}
              style="
                background: #1a1a2e;
                border: 1px solid #2a2a3e;
                border-radius: 8px;
                padding: 0.625rem 1rem 0.625rem 2.25rem;
                color: #e5e5e5;
                font-size: 0.875rem;
                width: 280px;
                outline: none;
                transition: border-color 0.2s;
              "
              onfocus={(e) => { e.target.style.borderColor = '#6366f1'; }}
              onblur={(e) => { e.target.style.borderColor = '#2a2a3e'; }}
            />
            <span style="position: absolute; left: 0.75rem; top: 50%; transform: translateY(-50%); color: #737373; pointer-events: none; font-size: 0.875rem;">
              &#128269;
            </span>
          </div>
        </div>
      </header>
      <Board search={search} />
    </div>
  );
}
