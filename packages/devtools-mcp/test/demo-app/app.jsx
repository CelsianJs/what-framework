import * as core from 'what-core';
import { signal, effect, computed, batch, onMount, h, mount } from 'what-core';
import { installDevTools } from 'what-devtools';
import { connectDevToolsMCP } from '../../src/client.js';

// Install devtools first — pass core module for synchronous hook wiring
installDevTools(core);

// Connect to MCP bridge with auth token (injected by Vite define in e2e tests)
const bridgeToken = typeof __BRIDGE_AUTH_TOKEN__ !== 'undefined' ? __BRIDGE_AUTH_TOKEN__ : '';
connectDevToolsMCP({ port: typeof __BRIDGE_PORT__ !== 'undefined' ? __BRIDGE_PORT__ : 9229, token: bridgeToken });

// ============================================================
// Shared State (signals)
// ============================================================
const tasks = signal([], 'tasks');
const searchQuery = signal('', 'searchQuery');
const filterStatus = signal('all', 'filterStatus'); // all, active, completed
const sortBy = signal('date', 'sortBy'); // date, priority, status
const theme = signal('light', 'theme');
const formError = signal('', 'formError');

// ============================================================
// Derived State (computed)
// ============================================================
const filteredTasks = computed(() => {
  let list = tasks();
  const query = searchQuery().toLowerCase();
  const status = filterStatus();

  if (query) {
    list = list.filter(t => t.title.toLowerCase().includes(query));
  }
  if (status === 'active') {
    list = list.filter(t => !t.completed);
  } else if (status === 'completed') {
    list = list.filter(t => t.completed);
  }

  const sort = sortBy();
  if (sort === 'priority') {
    list = [...list].sort((a, b) => b.priority - a.priority);
  } else if (sort === 'status') {
    list = [...list].sort((a, b) => a.completed - b.completed);
  } else {
    list = [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  return list;
}, 'filteredTasks');

const stats = computed(() => {
  const all = tasks();
  const active = all.filter(t => !t.completed).length;
  const completed = all.filter(t => t.completed).length;
  const overdue = all.filter(t => {
    if (t.completed) return false;
    if (!t.dueDate) return false;
    return new Date(t.dueDate) < new Date();
  }).length;
  return { total: all.length, active, completed, overdue };
}, 'stats');

// ============================================================
// Effects
// ============================================================

// Persist to localStorage
effect(() => {
  const current = tasks();
  if (current.length > 0) {
    try { localStorage.setItem('taskboard-tasks', JSON.stringify(current)); } catch {}
  }
}, 'persistTasks');

// Apply theme to document
effect(() => {
  const t = theme();
  document.documentElement.setAttribute('data-theme', t);
}, 'applyTheme');

// ============================================================
// Seed Data
// ============================================================
const seedData = [
  { id: 1, title: 'Design landing page', completed: false, priority: 3, createdAt: '2026-03-25', dueDate: '2026-03-28' },
  { id: 2, title: 'Write API documentation', completed: true, priority: 2, createdAt: '2026-03-24', dueDate: '2026-03-26' },
  { id: 3, title: 'Fix login bug', completed: false, priority: 5, createdAt: '2026-03-26', dueDate: '2026-03-27' },
  { id: 4, title: 'Deploy to production', completed: false, priority: 4, createdAt: '2026-03-26', dueDate: '2026-03-30' },
  { id: 5, title: 'Add dark mode support', completed: true, priority: 1, createdAt: '2026-03-23', dueDate: null },
  { id: 6, title: 'Review pull requests', completed: false, priority: 3, createdAt: '2026-03-27', dueDate: '2026-03-28' },
  { id: 7, title: 'Update dependencies', completed: false, priority: 2, createdAt: '2026-03-27', dueDate: null },
  { id: 8, title: 'Write unit tests', completed: false, priority: 4, createdAt: '2026-03-26', dueDate: '2026-03-29' },
];

// Initialize with localStorage or seed data
try {
  const stored = localStorage.getItem('taskboard-tasks');
  if (stored) tasks(JSON.parse(stored));
  else tasks(seedData);
} catch {
  tasks(seedData);
}

// ============================================================
// Actions
// ============================================================
function addTask(title, priority = 3, dueDate = null) {
  if (!title.trim()) {
    formError('Task title cannot be empty');
    return;
  }
  formError('');
  const newTask = {
    id: Date.now(),
    title: title.trim(),
    completed: false,
    priority,
    createdAt: new Date().toISOString().split('T')[0],
    dueDate,
  };
  tasks(prev => [...prev, newTask]);
}

function toggleTask(id) {
  tasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
}

function deleteTask(id) {
  tasks(prev => prev.filter(t => t.id !== id));
}

// ============================================================
// Components
// ============================================================

function Header() {
  return h('header', { style: 'display:flex;justify-content:space-between;align-items:center;padding:16px 24px;border-bottom:1px solid var(--border);' },
    h('div', {},
      h('h1', { style: 'margin:0;font-size:24px;' }, 'TaskBoard'),
      h('p', { style: 'margin:4px 0 0;opacity:0.6;font-size:14px;' }, () => `${stats().active} active tasks`),
    ),
    h('div', { style: 'display:flex;gap:12px;align-items:center;' },
      h('input', {
        type: 'search',
        placeholder: 'Search tasks...',
        value: () => searchQuery(),
        oninput: (e) => searchQuery(e.target.value),
        style: 'padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text);',
      }),
      h('button', {
        onclick: () => theme(t => t === 'light' ? 'dark' : 'light'),
        style: 'padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text);cursor:pointer;',
        'aria-label': 'Toggle theme',
      }, () => theme() === 'light' ? '\u{1F319}' : '\u{2600}\u{FE0F}'),
    ),
  );
}

function Stats() {
  return h('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px 24px;' },
    h('div', { style: 'padding:16px;border-radius:8px;background:var(--bg-card);border:1px solid var(--border);' },
      h('div', { style: 'font-size:24px;font-weight:700;' }, () => `${stats().total}`),
      h('div', { style: 'font-size:12px;opacity:0.6;' }, 'Total'),
    ),
    h('div', { style: 'padding:16px;border-radius:8px;background:var(--bg-card);border:1px solid var(--border);' },
      h('div', { style: 'font-size:24px;font-weight:700;color:#3b82f6;' }, () => `${stats().active}`),
      h('div', { style: 'font-size:12px;opacity:0.6;' }, 'Active'),
    ),
    h('div', { style: 'padding:16px;border-radius:8px;background:var(--bg-card);border:1px solid var(--border);' },
      h('div', { style: 'font-size:24px;font-weight:700;color:#22c55e;' }, () => `${stats().completed}`),
      h('div', { style: 'font-size:12px;opacity:0.6;' }, 'Completed'),
    ),
    h('div', { style: 'padding:16px;border-radius:8px;background:var(--bg-card);border:1px solid var(--border);' },
      h('div', { style: 'font-size:24px;font-weight:700;color:#ef4444;' }, () => `${stats().overdue}`),
      h('div', { style: 'font-size:12px;opacity:0.6;' }, 'Overdue'),
    ),
  );
}

function FilterBar() {
  return h('div', { style: 'display:flex;gap:8px;padding:0 24px;align-items:center;' },
    h('div', { style: 'display:flex;gap:4px;' },
      ...['all', 'active', 'completed'].map(status =>
        h('button', {
          onclick: () => filterStatus(status),
          style: () => `padding:6px 14px;border-radius:6px;border:1px solid var(--border);cursor:pointer;font-size:13px;${
            filterStatus() === status ? 'background:var(--accent);color:white;border-color:var(--accent);' : 'background:var(--bg-input);color:var(--text);'
          }`,
        }, status.charAt(0).toUpperCase() + status.slice(1)),
      ),
    ),
    h('div', { style: 'margin-left:auto;' },
      h('select', {
        onchange: (e) => sortBy(e.target.value),
        style: 'padding:6px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-input);color:var(--text);',
      },
        h('option', { value: 'date' }, 'Sort by Date'),
        h('option', { value: 'priority' }, 'Sort by Priority'),
        h('option', { value: 'status' }, 'Sort by Status'),
      ),
    ),
  );
}

function TaskItem({ task }) {
  const isOverdue = !task.completed && task.dueDate && new Date(task.dueDate) < new Date();

  return h('div', {
    style: () => `display:flex;align-items:center;padding:12px 24px;border-bottom:1px solid var(--border);${task.completed ? 'opacity:0.5;' : ''}`,
  },
    h('input', {
      type: 'checkbox',
      checked: task.completed,
      onchange: () => toggleTask(task.id),
      style: 'margin-right:12px;cursor:pointer;width:18px;height:18px;',
    }),
    h('div', { style: 'flex:1;' },
      h('div', { style: `font-weight:500;${task.completed ? 'text-decoration:line-through;' : ''}` }, task.title),
      h('div', { style: 'font-size:12px;opacity:0.5;margin-top:2px;' },
        `Priority: ${'\u2605'.repeat(task.priority)}${'\u2606'.repeat(5 - task.priority)}`,
        task.dueDate ? ` \u00B7 Due: ${task.dueDate}` : '',
        isOverdue ? ' \u00B7 OVERDUE' : '',
      ),
    ),
    h('button', {
      onclick: () => deleteTask(task.id),
      style: 'padding:4px 8px;border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:16px;',
      'aria-label': `Delete ${task.title}`,
    }, '\u00D7'),
  );
}

function TaskList() {
  return h('div', { style: 'margin-top:12px;' },
    () => {
      const items = filteredTasks();
      if (items.length === 0) {
        return h('div', { style: 'padding:40px;text-align:center;opacity:0.5;' }, 'No tasks found');
      }
      return h('div', {},
        ...items.map(task => h(TaskItem, { task, key: task.id })),
      );
    },
  );
}

function TaskForm() {
  const inputRef = signal(null, 'formInputRef');

  function handleSubmit(e) {
    e.preventDefault();
    const input = inputRef();
    if (input) {
      addTask(input.value);
      input.value = '';
    }
  }

  return h('form', { onsubmit: handleSubmit, style: 'display:flex;gap:8px;padding:16px 24px;' },
    h('input', {
      type: 'text',
      placeholder: 'Add a new task...',
      ref: (el) => inputRef(el),
      style: 'flex:1;padding:10px 14px;border:1px solid var(--border);border-radius:8px;background:var(--bg-input);color:var(--text);font-size:14px;',
    }),
    h('button', {
      type: 'submit',
      style: 'padding:10px 20px;background:var(--accent);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;',
    }, 'Add Task'),
    () => formError() ? h('div', { style: 'color:#ef4444;font-size:13px;padding:4px 0;' }, formError()) : null,
  );
}

function App() {
  return h('div', {
    id: 'app-root',
    style: 'max-width:720px;margin:0 auto;min-height:100vh;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,sans-serif;',
  },
    h(Header, {}),
    h(Stats, {}),
    h(TaskForm, {}),
    h(FilterBar, {}),
    h(TaskList, {}),
  );
}

// Mount
mount(h(App, {}), '#app');
