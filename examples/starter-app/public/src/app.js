import { h, mount, signal, computed, batch, useState, useEffect, useRef, useMemo } from 'what-framework';

// ─── Signals ───
const tasks = signal([]);
const filter = signal('all'); // 'all' | 'todo' | 'in-progress' | 'done'
const newTitle = signal('');
const newPriority = signal('medium');
const isConnected = signal(false);
const liveEvents = signal([]);

// ─── Computed ───
const filteredTasks = computed(() => {
  const f = filter();
  const all = tasks();
  if (f === 'all') return all;
  return all.filter(t => t.status === f);
});

const stats = computed(() => {
  const all = tasks();
  return {
    total: all.length,
    todo: all.filter(t => t.status === 'todo').length,
    inProgress: all.filter(t => t.status === 'in-progress').length,
    done: all.filter(t => t.status === 'done').length,
  };
});

// ─── API (connects to CelsianJS Pulse backend) ───
const API = 'http://localhost:4000';

async function fetchTasks() {
  try {
    const res = await fetch(`${API}/api/tasks`);
    const data = await res.json();
    tasks.set(data.tasks || []);
  } catch {
    // API not available — use demo data
    tasks.set([
      { id: '1', title: 'Set up CelsianJS backend', status: 'done', priority: 'high', createdAt: Date.now() - 3600000, updatedAt: Date.now() },
      { id: '2', title: 'Build What Framework UI', status: 'in-progress', priority: 'high', createdAt: Date.now() - 1800000, updatedAt: Date.now() },
      { id: '3', title: 'Connect SSE live updates', status: 'todo', priority: 'medium', createdAt: Date.now() - 900000, updatedAt: Date.now() },
      { id: '4', title: 'Deploy with ThenJS', status: 'todo', priority: 'low', createdAt: Date.now(), updatedAt: Date.now() },
    ]);
  }
}

async function createTask() {
  const title = newTitle();
  if (!title.trim()) return;

  try {
    await fetch(`${API}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, priority: newPriority() }),
    });
    batch(() => {
      newTitle.set('');
      newPriority.set('medium');
    });
    await fetchTasks();
  } catch {
    // Offline mode — add locally
    const task = {
      id: crypto.randomUUID(),
      title,
      status: 'todo',
      priority: newPriority(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    tasks.set([...tasks(), task]);
    batch(() => {
      newTitle.set('');
      newPriority.set('medium');
    });
  }
}

async function updateStatus(id, status) {
  try {
    await fetch(`${API}/api/tasks/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await fetchTasks();
  } catch {
    tasks.set(tasks().map(t => t.id === id ? { ...t, status, updatedAt: Date.now() } : t));
  }
}

async function deleteTask(id) {
  try {
    await fetch(`${API}/api/tasks/${id}`, { method: 'DELETE' });
    await fetchTasks();
  } catch {
    tasks.set(tasks().filter(t => t.id !== id));
  }
}

// ─── SSE Connection ───
function connectSSE() {
  try {
    const source = new EventSource(`${API}/api/events`);
    source.addEventListener('connected', () => isConnected.set(true));
    source.addEventListener('task:created', (e) => {
      liveEvents.set([{ type: 'created', data: JSON.parse(e.data), time: Date.now() }, ...liveEvents().slice(0, 9)]);
      fetchTasks();
    });
    source.addEventListener('task:updated', (e) => {
      liveEvents.set([{ type: 'updated', data: JSON.parse(e.data), time: Date.now() }, ...liveEvents().slice(0, 9)]);
      fetchTasks();
    });
    source.addEventListener('task:deleted', (e) => {
      liveEvents.set([{ type: 'deleted', data: JSON.parse(e.data), time: Date.now() }, ...liveEvents().slice(0, 9)]);
      fetchTasks();
    });
    source.onerror = () => isConnected.set(false);
  } catch {
    isConnected.set(false);
  }
}

// ─── Components ───

function Header() {
  const s = stats();
  return h('header', { style: 'margin-bottom: 32px' }, [
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:24px' }, [
      h('div', {}, [
        h('h1', { style: 'font-size:28px;font-weight:700;letter-spacing:-0.02em' }, 'Pulse Board'),
        h('p', { style: 'color:var(--text-muted);font-size:14px;margin-top:4px' }, 'Built with What Framework + CelsianJS'),
      ]),
      h('div', { style: 'display:flex;align-items:center;gap:8px' }, [
        h('span', {
          style: `width:8px;height:8px;border-radius:50%;background:${isConnected() ? 'var(--done)' : 'var(--todo)'}`
        }),
        h('span', { style: 'font-size:12px;color:var(--text-muted)' }, isConnected() ? 'Live' : 'Offline'),
      ]),
    ]),
    h('div', { style: 'display:grid;grid-template-columns:repeat(4,1fr);gap:16px' }, [
      StatCard('Total', s.total, '#64748b'),
      StatCard('To Do', s.todo, '#ef4444'),
      StatCard('In Progress', s.inProgress, '#3b82f6'),
      StatCard('Done', s.done, '#22c55e'),
    ]),
  ]);
}

function StatCard(label, value, color) {
  return h('div', {
    style: `background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center;border-top:3px solid ${color}`
  }, [
    h('div', { style: `font-size:32px;font-weight:700;color:${color}` }, String(value)),
    h('div', { style: 'font-size:13px;color:var(--text-muted);margin-top:4px' }, label),
  ]);
}

function AddTask() {
  return h('div', {
    style: 'background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:24px;display:flex;gap:12px;align-items:center'
  }, [
    h('input', {
      type: 'text',
      placeholder: 'Add a new task...',
      value: newTitle(),
      onInput: (e) => newTitle.set(e.target.value),
      onKeyDown: (e) => { if (e.key === 'Enter') createTask(); },
      style: 'flex:1;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 16px;color:var(--text);font-size:14px;outline:none;font-family:var(--font)'
    }),
    h('select', {
      value: newPriority(),
      onChange: (e) => newPriority.set(e.target.value),
      style: 'background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;color:var(--text);font-size:13px;outline:none;font-family:var(--font)'
    }, [
      h('option', { value: 'low' }, 'Low'),
      h('option', { value: 'medium' }, 'Medium'),
      h('option', { value: 'high' }, 'High'),
    ]),
    h('button', {
      onClick: createTask,
      style: 'background:var(--accent);color:#000;border:none;border-radius:8px;padding:12px 24px;font-weight:600;font-size:14px;cursor:pointer;font-family:var(--font);white-space:nowrap'
    }, 'Add Task'),
  ]);
}

function FilterBar() {
  const f = filter();
  const btn = (label, value) => h('button', {
    onClick: () => filter.set(value),
    style: `padding:8px 16px;border-radius:6px;border:1px solid ${f === value ? 'var(--accent)' : 'var(--border)'};background:${f === value ? 'var(--accent)' : 'transparent'};color:${f === value ? '#000' : 'var(--text-muted)'};font-size:13px;font-weight:500;cursor:pointer;font-family:var(--font)`
  }, label);

  return h('div', { style: 'display:flex;gap:8px;margin-bottom:16px' }, [
    btn('All', 'all'),
    btn('To Do', 'todo'),
    btn('In Progress', 'in-progress'),
    btn('Done', 'done'),
  ]);
}

function TaskCard(task) {
  const priorityColor = { high: '#ef4444', medium: '#f59e0b', low: '#64748b' };
  const statusColor = { todo: 'var(--todo)', 'in-progress': 'var(--progress)', done: 'var(--done)' };
  const nextStatus = { todo: 'in-progress', 'in-progress': 'done', done: 'todo' };

  return h('div', {
    style: `background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:16px;transition:border-color 0.15s;border-left:3px solid ${statusColor[task.status]}`,
  }, [
    h('button', {
      onClick: () => updateStatus(task.id, nextStatus[task.status]),
      title: `Move to ${nextStatus[task.status]}`,
      style: `width:24px;height:24px;border-radius:50%;border:2px solid ${statusColor[task.status]};background:${task.status === 'done' ? statusColor[task.status] : 'transparent'};cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px`
    }, task.status === 'done' ? '\u2713' : ''),
    h('div', { style: 'flex:1;min-width:0' }, [
      h('div', {
        style: `font-size:15px;font-weight:500;${task.status === 'done' ? 'text-decoration:line-through;opacity:0.5' : ''}`
      }, task.title),
      h('div', { style: 'display:flex;gap:8px;margin-top:6px' }, [
        h('span', {
          style: `font-size:11px;padding:2px 8px;border-radius:4px;background:${priorityColor[task.priority]}22;color:${priorityColor[task.priority]};font-weight:500`
        }, task.priority),
        h('span', { style: 'font-size:11px;color:var(--text-muted)' },
          new Date(task.createdAt).toLocaleDateString()),
      ]),
    ]),
    h('button', {
      onClick: () => deleteTask(task.id),
      style: 'background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:4px 8px;opacity:0.5;transition:opacity 0.15s',
      onMouseOver: (e) => e.target.style.opacity = '1',
      onMouseOut: (e) => e.target.style.opacity = '0.5',
    }, '\u00d7'),
  ]);
}

function TaskList() {
  const items = filteredTasks();
  if (items.length === 0) {
    return h('div', {
      style: 'text-align:center;padding:48px;color:var(--text-muted);font-size:14px'
    }, filter() === 'all' ? 'No tasks yet. Add one above!' : `No ${filter()} tasks.`);
  }
  return h('div', { style: 'display:flex;flex-direction:column;gap:8px' },
    items.map(task => TaskCard(task))
  );
}

function LiveFeed() {
  const events = liveEvents();
  if (events.length === 0) return null;

  return h('div', { style: 'margin-top:32px' }, [
    h('h3', { style: 'font-size:14px;font-weight:600;color:var(--text-muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em' }, 'Live Feed'),
    h('div', { style: 'display:flex;flex-direction:column;gap:4px' },
      events.map(ev => h('div', {
        style: 'font-size:12px;color:var(--text-muted);padding:6px 12px;background:var(--surface);border-radius:6px;display:flex;justify-content:space-between'
      }, [
        h('span', {}, `${ev.type}: ${ev.data.title || ev.data.id || '...'}`),
        h('span', { style: 'opacity:0.5' }, new Date(ev.time).toLocaleTimeString()),
      ]))
    ),
  ]);
}

function App() {
  return h('div', {}, [
    Header(),
    AddTask(),
    FilterBar(),
    TaskList(),
    LiveFeed(),
    h('footer', { style: 'margin-top:48px;padding-top:24px;border-top:1px solid var(--border);text-align:center;color:var(--text-muted);font-size:12px' },
      'Built with What Framework \u2014 signals-based reactivity, zero virtual DOM'
    ),
  ]);
}

// ─── Init ───
fetchTasks();
connectSSE();
mount(h(App), '#app');
