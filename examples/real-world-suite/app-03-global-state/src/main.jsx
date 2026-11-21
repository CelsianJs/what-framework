import { mount, useSignal } from 'what-framework';
import { useTaskStore } from './store.js';

// --- AddTaskForm ---
// Uses useSignal for local draft state alongside the global store.
function AddTaskForm() {
  const store = useTaskStore();
  const title = useSignal('');
  const priority = useSignal('medium');

  function submit(e) {
    e.preventDefault();
    store.addTask(title(), priority());
    title('');
    priority('medium');
  }

  return (
    <form onSubmit={submit} className="add-task-form">
      <input
        data-testid="task-input"
        type="text"
        value={title()}
        onInput={(e) => title(e.target.value)}
        placeholder="What needs to be done?"
      />
      <select
        data-testid="priority-select"
        value={priority()}
        onChange={(e) => priority(e.target.value)}
      >
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
      <button data-testid="add-task-btn" type="submit">
        Add Task
      </button>
    </form>
  );
}

// --- Header ---
// Search input and filter/sort controls. Reads and writes to global store.
function Header() {
  const store = useTaskStore();

  return (
    <header className="header">
      <h1>Project Task Manager</h1>

      <input
        data-testid="search-input"
        type="text"
        className="search-input"
        value={() => store.searchQuery}
        onInput={(e) => store.setSearch(e.target.value)}
        placeholder="Search tasks..."
      />

      <div className="controls">
        <div className="filter-group">
          <span className="label">Filter:</span>
          <button
            data-testid="filter-all"
            className={() => (store.filter === 'all' ? 'active' : '')}
            onClick={() => store.setFilter('all')}
          >
            All
          </button>
          <button
            data-testid="filter-active"
            className={() => (store.filter === 'active' ? 'active' : '')}
            onClick={() => store.setFilter('active')}
          >
            Active
          </button>
          <button
            data-testid="filter-done"
            className={() => (store.filter === 'done' ? 'active' : '')}
            onClick={() => store.setFilter('done')}
          >
            Done
          </button>
        </div>

        <div className="sort-group">
          <span className="label">Sort:</span>
          <button
            data-testid="sort-date"
            className={() => (store.sortBy === 'date' ? 'active' : '')}
            onClick={() => store.setSort('date')}
          >
            Date
          </button>
          <button
            data-testid="sort-priority"
            className={() => (store.sortBy === 'priority' ? 'active' : '')}
            onClick={() => store.setSort('priority')}
          >
            Priority
          </button>
        </div>
      </div>
    </header>
  );
}

// --- TaskList ---
// Renders the filtered/sorted tasks from the store.
function TaskList() {
  const store = useTaskStore();

  return (
    <ul className="task-list">
      {() => store.filteredTasks.length === 0 && (
        <li className="empty-state">No tasks match your criteria.</li>
      )}
      {store.filteredTasks.map((task) => (
        <li
          key={task.id}
          data-testid={`task-item-${task.id}`}
          className={`task-item priority-${task.priority}${task.done ? ' done' : ''}`}
        >
          <input
            data-testid={`toggle-task-${task.id}`}
            type="checkbox"
            checked={task.done}
            onInput={() => store.toggleTask(task.id)}
          />
          <span className="task-title">{task.title}</span>
          <span className={`priority-badge ${task.priority}`}>{task.priority}</span>
          <button
            data-testid={`delete-task-${task.id}`}
            className="delete-btn"
            onClick={() => store.deleteTask(task.id)}
          >
            x
          </button>
        </li>
      ))}
    </ul>
  );
}

// --- Footer ---
// Shows task counts and a "Clear Completed" button. The component runs once,
// so counts is an accessor: reading store.taskCounts in the body would keep
// the first value forever.
function Footer() {
  const store = useTaskStore();
  const counts = () => store.taskCounts;

  return (
    <footer className="footer">
      <span data-testid="task-count">
        {counts().active} active / {counts().done} done / {counts().total} total
      </span>
      {counts().done > 0 && (
        <button
          data-testid="clear-completed-btn"
          className="clear-btn"
          onClick={() => store.clearCompleted()}
        >
          Clear Completed ({counts().done})
        </button>
      )}
    </footer>
  );
}

// --- App ---
function App() {
  return (
    <main className="app-shell">
      <Header />
      <AddTaskForm />
      <TaskList />
      <Footer />
    </main>
  );
}

mount(<App />, '#app');
