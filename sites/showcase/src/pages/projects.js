// Projects — showcases: createStore, spring, batch, For, Show, Switch, effect, announce
import {
  h, useState, useEffect, useRef, useMemo,
  signal, computed, batch,
  spring,
  announce,
} from 'what-framework';
import { useAppStore } from '../app.js';
import { TASKS, PEOPLE } from '../data.js';

const COLUMNS = [
  { id: 'todo', label: 'To Do', color: 'var(--text-muted)', dot: '#63636e' },
  { id: 'progress', label: 'In Progress', color: 'var(--info)', dot: '#3b82f6' },
  { id: 'review', label: 'In Review', color: 'var(--warning)', dot: '#f59e0b' },
  { id: 'done', label: 'Done', color: 'var(--success)', dot: '#22c55e' },
];

function getAssignee(id) {
  return PEOPLE.find(p => p.id === id) || { initials: '?', avatar: '#666' };
}

// ─── Add Task Modal ───
function AddTaskForm({ column, onAdd, onClose }) {
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState('feature');
  const inputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  const submit = () => {
    if (!title.trim()) return;
    onAdd({
      id: 't' + Date.now(),
      title: title.trim(),
      status: column,
      tag,
      assignee: 1,
      project: 'p1',
      priority: 'medium',
    });
    setTitle('');
    onClose();
  };

  return h('div', {
    style: {
      padding: '12px',
      background: 'var(--bg-surface)',
      border: '1px solid var(--accent)',
      borderRadius: 'var(--radius)',
      marginBottom: '8px',
    },
  },
    h('input', {
      ref: inputRef,
      class: 'form-input',
      placeholder: 'Task title...',
      value: title,
      onInput: (e) => setTitle(e.target.value),
      onKeyDown: (e) => {
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') onClose();
      },
      style: { marginBottom: '8px' },
    }),
    h('div', { class: 'flex items-center gap-2' },
      ...['feature', 'bug', 'design', 'chore'].map(t =>
        h('button', {
          class: `kanban-tag ${t}`,
          style: `cursor: pointer; outline: ${tag === t ? '2px solid var(--accent)' : 'none'}; outline-offset: 2px;`,
          onClick: () => setTag(t),
        }, t),
      ),
      h('div', { style: 'flex: 1' }),
      h('button', { class: 'btn btn-sm', onClick: onClose }, 'Cancel'),
      h('button', { class: 'btn btn-primary btn-sm', onClick: submit }, 'Add'),
    ),
  );
}

// ─── Kanban Card ───
function KanbanCard({ task, onMove }) {
  const assignee = getAssignee(task.assignee);
  const dragRef = useRef(null);
  const scaleRef = useRef(null);
  if (!dragRef.current) dragRef.current = spring(0, { stiffness: 300, damping: 25 });
  if (!scaleRef.current) scaleRef.current = spring(1, { stiffness: 200, damping: 20 });
  const dragOffset = dragRef.current;
  const scaleVal = scaleRef.current;
  const [isDragging, setIsDragging] = useState(false);

  return h('div', {
    class: `kanban-card${isDragging ? ' dragging' : ''}`,
    style: { transform: `translateX(${dragOffset.current()}px) scale(${scaleVal.current()})` },
    draggable: true,
    onDragStart: (e) => {
      setIsDragging(true);
      scaleVal.set(1.04);
      e.dataTransfer.setData('text/plain', task.id);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => {
      setIsDragging(false);
      scaleVal.set(1);
      dragOffset.set(0);
    },
  },
    h('div', { class: 'kanban-card-title' }, task.title),
    h('div', { class: 'kanban-card-meta' },
      h('span', { class: `kanban-tag ${task.tag}` }, task.tag),
      h('div', {
        class: 'kanban-assignee',
        style: `background: ${assignee.avatar}`,
        title: assignee.name || 'Unknown',
      }, assignee.initials),
    ),
  );
}

// ─── Kanban Column ───
function KanbanColumn({ column, tasks, onAdd, onDrop }) {
  const [showForm, setShowForm] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  return h('div', { class: 'kanban-column' },
    h('div', { class: 'kanban-column-header' },
      h('div', { class: 'kanban-column-dot', style: `background: ${column.dot}` }),
      h('span', { class: 'kanban-column-title' }, column.label),
      h('span', { class: 'kanban-column-count' }, tasks.length),
    ),
    h('div', {
      class: 'kanban-cards',
      style: dragOver ? 'border-color: var(--accent); background: var(--accent-dim);' : '',
      onDragOver: (e) => { e.preventDefault(); setDragOver(true); },
      onDragLeave: () => setDragOver(false),
      onDrop: (e) => {
        e.preventDefault();
        setDragOver(false);
        const taskId = e.dataTransfer.getData('text/plain');
        if (taskId) onDrop(taskId, column.id);
      },
    },
      showForm
        ? h(AddTaskForm, {
            column: column.id,
            onAdd,
            onClose: () => setShowForm(false),
          })
        : null,
      ...tasks.map(task =>
        h(KanbanCard, { key: task.id, task }),
      ),
      !showForm
        ? h('button', {
            class: 'kanban-add-btn',
            onClick: () => setShowForm(true),
          }, '+ Add task')
        : null,
    ),
  );
}

// ─── Projects Page ───
export function Projects() {
  const store = useAppStore();
  const [tasks, setTasks] = useState([...TASKS]);
  const [filter, setFilter] = useState('all');

  const filteredTasks = useMemo(() => {
    if (filter === 'all') return tasks;
    return tasks.filter(t => t.tag === filter);
  }, [tasks, filter]);

  const tasksByColumn = (colId) => {
    return filteredTasks.filter(t => t.status === colId);
  };

  const addTask = (task) => {
    setTasks(prev => [...prev, task]);
    store.addNotification(`Task "${task.title}" created`, 'success');
  };

  const moveTask = (taskId, toColumn) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: toColumn } : t
    ));
    const task = tasks.find(t => t.id === taskId);
    if (task) {
      const col = COLUMNS.find(c => c.id === toColumn);
      store.addNotification(`"${task.title}" moved to ${col?.label}`, 'info');
    }
  };

  return h('div', null,
    // Toolbar
    h('div', { class: 'flex items-center justify-between mb-4' },
      h('div', { class: 'flex gap-2' },
        ...['all', 'feature', 'bug', 'design', 'chore'].map(f =>
          h('button', {
            class: `btn btn-sm${filter === f ? ' btn-primary' : ''}`,
            onClick: () => setFilter(f),
          }, f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)),
        ),
      ),
      h('span', { class: 'text-muted text-sm' },
        `${filteredTasks.length} tasks`,
      ),
    ),

    // Kanban Board
    h('div', { class: 'kanban-board' },
      ...COLUMNS.map(col =>
        h(KanbanColumn, {
          key: col.id,
          column: col,
          tasks: tasksByColumn(col.id),
          onAdd: addTask,
          onDrop: moveTask,
        }),
      ),
    ),
  );
}
