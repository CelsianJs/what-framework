// TodoMVC — Main App Component
// Demonstrates: useSignal, useComputed, useEffect, mapArray,
// fine-grained rendering, signal-based reactivity, hash routing

import { mount, useSignal, mapArray } from 'what-framework';
import { useTodoStore } from './store.js';
import { TodoItem } from './todo-item.jsx';
import { Footer } from './footer.jsx';

function App() {
  const store = useTodoStore();
  const newTodo = useSignal('');

  function handleNewTodoKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const title = newTodo().trim();
    if (title) {
      store.addTodo(title);
      newTodo.set('');
    }
  }

  return (
    <div>
      <section class="todoapp">
        <header class="header">
          <h1>todos</h1>
          <input
            class="new-todo"
            placeholder="What needs to be done?"
            value={newTodo}
            onInput={(e) => newTodo.set(e.target.value)}
            onKeyDown={handleNewTodoKeyDown}
            autofocus
          />
        </header>

        {() => store.todos().length > 0 ? (
          <section class="main">
            <input
              id="toggle-all"
              class="toggle-all"
              type="checkbox"
              checked={store.allCompleted}
              onChange={store.toggleAll}
            />
            <label for="toggle-all">Mark all as complete</label>
            <ul class="todo-list">
              {() => store.filteredTodos().map(todo => (
                <TodoItem
                  key={todo.id}
                  todo={todo}
                  onToggle={store.toggleTodo}
                  onDestroy={store.removeTodo}
                  onEdit={store.editTodo}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {() => store.todos().length > 0 ? (
          <Footer
            activeCount={store.activeCount}
            completedCount={store.completedCount}
            filter={store.filter}
            onClearCompleted={store.clearCompleted}
          />
        ) : null}
      </section>
      <footer class="info">
        <p>Double-click to edit a todo</p>
        <p>Built with <a href="https://github.com/CelsianJs/what-framework">What Framework</a></p>
      </footer>
    </div>
  );
}

mount(<App />, '#app');
