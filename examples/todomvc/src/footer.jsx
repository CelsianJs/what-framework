// Footer — Filter links + item count + clear completed
// Demonstrates: useComputed, conditional rendering, signal-driven class toggling

export function Footer({ activeCount, completedCount, filter, onClearCompleted }) {
  return (
    <footer class="footer">
      <span class="todo-count">
        <strong>{activeCount}</strong>
        {() => activeCount() === 1 ? ' item left' : ' items left'}
      </span>
      <ul class="filters">
        <li>
          <a
            class={() => filter() === 'all' ? 'selected' : ''}
            href="#/"
          >All</a>
        </li>
        {' '}
        <li>
          <a
            class={() => filter() === 'active' ? 'selected' : ''}
            href="#/active"
          >Active</a>
        </li>
        {' '}
        <li>
          <a
            class={() => filter() === 'completed' ? 'selected' : ''}
            href="#/completed"
          >Completed</a>
        </li>
      </ul>
      {() => completedCount() > 0 ? (
        <button class="clear-completed" onClick={onClearCompleted}>
          Clear completed
        </button>
      ) : null}
    </footer>
  );
}
