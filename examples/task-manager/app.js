// Task Manager — What Framework Example App
// Demonstrates: createStore, derived, useState, useSignal, useEffect, useRef,
// useMemo, h(), mount, batch, For, Show, spring animation, localStorage

import {
  h, mount, batch,
  createStore, derived,
  useState, useSignal, useEffect, useRef, useMemo,
  spring,
  cls,
} from '../../packages/core/src/index.js';

// ─── Store ────────────────────────────────────────────────────
// Global state with derived computeds and actions using `this`

const STORAGE_KEY = 'what-tasks';

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

const useTaskStore = createStore({
  tasks: loadTasks(),
  filter: 'all', // 'all' | 'active' | 'completed'

  // Derived computeds
  activeCount: derived(s => s.tasks.filter(t => !t.done).length),
  completedCount: derived(s => s.tasks.filter(t => t.done).length),
  filteredTasks: derived(s => {
    if (s.filter === 'active') return s.tasks.filter(t => !t.done);
    if (s.filter === 'completed') return s.tasks.filter(t => t.done);
    return s.tasks;
  }),

  // Actions — use `this` (proxy-bound)
  addTask(text) {
    this.tasks = [
      { id: Date.now(), text, done: false, createdAt: new Date().toISOString() },
      ...this.tasks,
    ];
    this._save();
  },
  toggleTask(id) {
    this.tasks = this.tasks.map(t =>
      t.id === id ? { ...t, done: !t.done } : t
    );
    this._save();
  },
  removeTask(id) {
    this.tasks = this.tasks.filter(t => t.id !== id);
    this._save();
  },
  editTask(id, text) {
    this.tasks = this.tasks.map(t =>
      t.id === id ? { ...t, text } : t
    );
    this._save();
  },
  clearCompleted() {
    this.tasks = this.tasks.filter(t => !t.done);
    this._save();
  },
  setFilter(f) {
    this.filter = f;
  },
  _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tasks)); } catch {}
  },
});

// ─── Theme Toggle ─────────────────────────────────────────────

function ThemeToggle() {
  const [dark, setDark] = useState(
    typeof window !== 'undefined' && document.documentElement.dataset.theme === 'dark'
  );

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : '';
  }, [dark]);

  return h('button', {
    class: 'theme-toggle',
    onClick: () => setDark(d => !d),
    title: dark ? 'Switch to light mode' : 'Switch to dark mode',
  }, dark ? '\u2600' : '\u263E');
}

// ─── Task Input ───────────────────────────────────────────────

function TaskInput() {
  const [text, setText] = useState('');
  const inputRef = useRef(null);
  const store = useTaskStore();

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    store.addTask(trimmed);
    setText('');
    inputRef.current?.focus();
  };

  return h('div', { class: 'task-input-wrapper' },
    h('input', {
      ref: inputRef,
      type: 'text',
      class: 'task-input',
      placeholder: 'What needs to be done?',
      value: text,
      onInput: e => setText(e.target.value),
      onKeydown: e => e.key === 'Enter' && submit(),
    }),
    h('button', {
      class: 'task-input-btn',
      onClick: submit,
      disabled: !text.trim(),
    }, '+'),
  );
}

// ─── Single Task ──────────────────────────────────────────────

function TaskItem({ task }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(task.text);
  const editRef = useRef(null);
  const store = useTaskStore();

  // Persist with useRef to avoid recreating
  const springRef = useRef(null);
  if (!springRef.current) {
    springRef.current = spring(1, { stiffness: 300, damping: 25 });
  }
  const scale = springRef.current;

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editing]);

  const saveEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== task.text) {
      store.editTask(task.id, trimmed);
    } else {
      setEditText(task.text);
    }
    setEditing(false);
  };

  const handleToggle = () => {
    scale.snap(0.95);
    scale.set(1);
    store.toggleTask(task.id);
  };

  const timeAgo = useMemo(() => {
    const diff = Date.now() - new Date(task.createdAt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }, [task.createdAt]);

  return h('div', {
    class: cls('task-item', task.done && 'done'),
    style: `transform: scale(${scale.current()})`,
  },
    // Checkbox
    h('button', {
      class: cls('task-checkbox', task.done && 'checked'),
      onClick: handleToggle,
      'aria-label': task.done ? 'Mark incomplete' : 'Mark complete',
    }, task.done ? '\u2713' : ''),

    // Content
    editing
      ? h('input', {
          ref: editRef,
          class: 'task-edit-input',
          value: editText,
          onInput: e => setEditText(e.target.value),
          onKeydown: e => {
            if (e.key === 'Enter') saveEdit();
            if (e.key === 'Escape') { setEditText(task.text); setEditing(false); }
          },
          onBlur: saveEdit,
        })
      : h('div', { class: 'task-content', onDblclick: () => setEditing(true) },
          h('span', { class: 'task-text' }, task.text),
          h('span', { class: 'task-time' }, timeAgo),
        ),

    // Delete button
    h('button', {
      class: 'task-delete',
      onClick: () => store.removeTask(task.id),
      'aria-label': 'Delete task',
    }, '\u00D7'),
  );
}

// ─── Filter Bar ───────────────────────────────────────────────

function FilterBar() {
  const store = useTaskStore();

  const filters = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'completed', label: 'Done' },
  ];

  return h('div', { class: 'filter-bar' },
    h('span', { class: 'filter-count' },
      store.activeCount, ' item', store.activeCount !== 1 ? 's' : '', ' left',
    ),
    h('div', { class: 'filter-buttons' },
      ...filters.map(f =>
        h('button', {
          key: f.key,
          class: cls('filter-btn', store.filter === f.key && 'active'),
          onClick: () => store.setFilter(f.key),
        }, f.label),
      ),
    ),
    store.completedCount > 0
      ? h('button', {
          class: 'clear-btn',
          onClick: () => store.clearCompleted(),
        }, 'Clear done')
      : null,
  );
}

// ─── Empty State ──────────────────────────────────────────────

function EmptyState({ filter }) {
  const messages = {
    all: 'No tasks yet. Add one above!',
    active: 'No active tasks. Nice work!',
    completed: 'No completed tasks yet.',
  };

  return h('div', { class: 'empty-state' },
    h('div', { class: 'empty-icon' }, '\u2714'),
    h('p', null, messages[filter] || messages.all),
  );
}

// ─── App ──────────────────────────────────────────────────────

function App() {
  const store = useTaskStore();

  return h('div', { class: 'app' },
    // Header
    h('header', { class: 'app-header' },
      h('div', null,
        h('h1', { class: 'app-title' }, 'Tasks'),
        h('p', { class: 'app-subtitle' },
          store.tasks.length, ' total \u00B7 ',
          store.completedCount, ' done',
        ),
      ),
      h(ThemeToggle),
    ),

    // Input
    h(TaskInput),

    // Filter bar (only show when there are tasks)
    store.tasks.length > 0
      ? h(FilterBar)
      : null,

    // Task list
    h('div', { class: 'task-list' },
      store.filteredTasks.length > 0
        ? store.filteredTasks.map(task =>
            h(TaskItem, { key: task.id, task }),
          )
        : store.tasks.length > 0
          ? h(EmptyState, { filter: store.filter })
          : h(EmptyState, { filter: 'all' }),
    ),

    // Footer
    h('footer', { class: 'app-footer' },
      'Built with ',
      h('a', { href: 'https://github.com/zvndev/what-fw', target: '_blank' }, 'What Framework'),
      ' \u00B7 Tasks persist in localStorage',
    ),
  );
}

// ─── Styles ───────────────────────────────────────────────────

const styleEl = document.createElement('style');
styleEl.textContent = `
  .app { display: flex; flex-direction: column; gap: 16px; }
  .app-header { display: flex; justify-content: space-between; align-items: flex-start; }
  .app-title { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
  .app-subtitle { font-size: 13px; color: var(--text-muted); margin-top: 2px; }
  .theme-toggle {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 6px 10px; font-size: 18px; cursor: pointer; color: var(--text);
    transition: background 0.15s;
  }
  .theme-toggle:hover { background: var(--border); }

  .task-input-wrapper {
    display: flex; gap: 8px;
  }
  .task-input {
    flex: 1; padding: 10px 14px; font-size: 15px;
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface); color: var(--text);
    outline: none; transition: border-color 0.15s;
  }
  .task-input:focus { border-color: var(--primary); }
  .task-input::placeholder { color: var(--text-faint); }
  .task-input-btn {
    padding: 0 16px; font-size: 20px; font-weight: 600;
    background: var(--primary); color: #fff; border: none; border-radius: var(--radius);
    cursor: pointer; transition: background 0.15s;
  }
  .task-input-btn:hover:not(:disabled) { background: var(--primary-hover); }
  .task-input-btn:disabled { opacity: 0.4; cursor: default; }

  .filter-bar {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 8px 0; border-bottom: 1px solid var(--border);
  }
  .filter-count { font-size: 13px; color: var(--text-muted); }
  .filter-buttons { display: flex; gap: 4px; margin-left: auto; }
  .filter-btn {
    padding: 4px 10px; font-size: 12px; border: 1px solid var(--border);
    border-radius: 999px; background: transparent; color: var(--text-muted);
    cursor: pointer; transition: all 0.15s;
  }
  .filter-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); }
  .filter-btn:hover:not(.active) { border-color: var(--text-muted); }
  .clear-btn {
    padding: 4px 10px; font-size: 12px; border: none; background: transparent;
    color: var(--danger); cursor: pointer;
  }
  .clear-btn:hover { text-decoration: underline; }

  .task-list { display: flex; flex-direction: column; gap: 4px; }
  .task-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; background: var(--surface); border-radius: var(--radius);
    box-shadow: var(--shadow); transition: opacity 0.2s;
  }
  .task-item.done { opacity: 0.6; }
  .task-item.done .task-text { text-decoration: line-through; color: var(--text-muted); }

  .task-checkbox {
    width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0;
    border: 2px solid var(--border); background: transparent;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; cursor: pointer; color: transparent;
    transition: all 0.15s;
  }
  .task-checkbox.checked {
    background: var(--success); border-color: var(--success); color: #fff;
  }

  .task-content {
    flex: 1; min-width: 0; cursor: text;
    display: flex; flex-direction: column; gap: 2px;
  }
  .task-text { font-size: 14px; word-break: break-word; }
  .task-time { font-size: 11px; color: var(--text-faint); }

  .task-edit-input {
    flex: 1; padding: 4px 8px; font-size: 14px;
    border: 1px solid var(--primary); border-radius: 4px;
    background: var(--surface); color: var(--text); outline: none;
  }

  .task-delete {
    opacity: 0; width: 24px; height: 24px; border: none; background: transparent;
    color: var(--danger); font-size: 18px; cursor: pointer; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    transition: opacity 0.15s, background 0.15s;
  }
  .task-item:hover .task-delete { opacity: 1; }
  .task-delete:hover { background: rgba(239,68,68,0.1); }

  .empty-state {
    text-align: center; padding: 40px 20px; color: var(--text-muted);
  }
  .empty-icon { font-size: 32px; margin-bottom: 8px; opacity: 0.3; }

  .app-footer {
    text-align: center; font-size: 12px; color: var(--text-faint);
    padding-top: 16px; border-top: 1px solid var(--border);
  }
  .app-footer a { color: var(--primary); text-decoration: none; }
  .app-footer a:hover { text-decoration: underline; }
`;
document.head.appendChild(styleEl);

// ─── Mount ────────────────────────────────────────────────────

mount(h(App), document.getElementById('app'));
