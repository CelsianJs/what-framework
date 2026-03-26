// Pulse Board — What Framework Starter
// Demonstrates: signals, computed, batch, useSignal, useEffect,
// useRef, useMemo, JSX components, data fetching, SSE

import {
  mount, batch,
  useSignal, useComputed, useEffect, useRef, useMemo,
} from 'what-framework';

// --- Signals (module-level reactive state) ---
const tasks = useSignal([]);
const filter = useSignal('all'); // 'all' | 'todo' | 'in-progress' | 'done'
const newTitle = useSignal('');
const newPriority = useSignal('medium');
const isConnected = useSignal(false);
const liveEvents = useSignal([]);

// --- Computed ---
const filteredTasks = useComputed(() => {
  const f = filter();
  const all = tasks();
  if (f === 'all') return all;
  return all.filter(t => t.status === f);
});

const stats = useComputed(() => {
  const all = tasks();
  return {
    total: all.length,
    todo: all.filter(t => t.status === 'todo').length,
    inProgress: all.filter(t => t.status === 'in-progress').length,
    done: all.filter(t => t.status === 'done').length,
  };
});

// --- API (connects to CelsianJS Pulse backend) ---
const API = 'http://localhost:4000';

async function fetchTasks() {
  try {
    const res = await fetch(`${API}/api/tasks`);
    const data = await res.json();
    tasks.set(data.tasks || []);
  } catch {
    // API not available — use demo data
    tasks.set([
      { id: '1', title: 'Set up the backend', status: 'done', priority: 'high', createdAt: Date.now() - 3600000, updatedAt: Date.now() },
      { id: '2', title: 'Build What Framework UI', status: 'in-progress', priority: 'high', createdAt: Date.now() - 1800000, updatedAt: Date.now() },
      { id: '3', title: 'Connect SSE live updates', status: 'todo', priority: 'medium', createdAt: Date.now() - 900000, updatedAt: Date.now() },
      { id: '4', title: 'Deploy to production', status: 'todo', priority: 'low', createdAt: Date.now(), updatedAt: Date.now() },
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

// --- SSE Connection ---
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

// --- Components ---

function StatCard({ label, value, color }) {
  return (
    <div style={`background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;text-align:center;border-top:3px solid ${color}`}>
      <div style={`font-size:32px;font-weight:700;color:${color}`}>{String(value)}</div>
      <div style="font-size:13px;color:var(--text-muted);margin-top:4px">{label}</div>
    </div>
  );
}

function Header() {
  return (
    <header style="margin-bottom: 32px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
        <div>
          <h1 style="font-size:28px;font-weight:700;letter-spacing:-0.02em">Pulse Board</h1>
          <p style="color:var(--text-muted);font-size:14px;margin-top:4px">Built with What Framework + CelsianJS</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style={() => `width:8px;height:8px;border-radius:50%;background:${isConnected() ? 'var(--done)' : 'var(--todo)'}`} />
          <span style="font-size:12px;color:var(--text-muted)">{() => isConnected() ? 'Live' : 'Offline'}</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">
        {() => {
          const s = stats();
          return (
            <>
              <StatCard label="Total" value={s.total} color="#64748b" />
              <StatCard label="To Do" value={s.todo} color="#ef4444" />
              <StatCard label="In Progress" value={s.inProgress} color="#3b82f6" />
              <StatCard label="Done" value={s.done} color="#22c55e" />
            </>
          );
        }}
      </div>
    </header>
  );
}

function AddTask() {
  return (
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:24px;display:flex;gap:12px;align-items:center">
      <input
        type="text"
        placeholder="Add a new task..."
        value={newTitle}
        onInput={(e) => newTitle.set(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') createTask(); }}
        style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px 16px;color:var(--text);font-size:14px;outline:none;font-family:var(--font)"
      />
      <select
        value={newPriority}
        onChange={(e) => newPriority.set(e.target.value)}
        style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;color:var(--text);font-size:13px;outline:none;font-family:var(--font)"
      >
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
      <button
        onClick={createTask}
        style="background:var(--accent);color:#000;border:none;border-radius:8px;padding:12px 24px;font-weight:600;font-size:14px;cursor:pointer;font-family:var(--font);white-space:nowrap"
      >Add Task</button>
    </div>
  );
}

function FilterBar() {
  const buttons = [
    { label: 'All', value: 'all' },
    { label: 'To Do', value: 'todo' },
    { label: 'In Progress', value: 'in-progress' },
    { label: 'Done', value: 'done' },
  ];

  return (
    <div style="display:flex;gap:8px;margin-bottom:16px">
      {buttons.map(btn => (
        <button
          onClick={() => filter.set(btn.value)}
          style={() => `padding:8px 16px;border-radius:6px;border:1px solid ${filter() === btn.value ? 'var(--accent)' : 'var(--border)'};background:${filter() === btn.value ? 'var(--accent)' : 'transparent'};color:${filter() === btn.value ? '#000' : 'var(--text-muted)'};font-size:13px;font-weight:500;cursor:pointer;font-family:var(--font)`}
        >{btn.label}</button>
      ))}
    </div>
  );
}

function TaskCard({ task }) {
  const priorityColor = { high: '#ef4444', medium: '#f59e0b', low: '#64748b' };
  const statusColor = { todo: 'var(--todo)', 'in-progress': 'var(--progress)', done: 'var(--done)' };
  const nextStatus = { todo: 'in-progress', 'in-progress': 'done', done: 'todo' };

  return (
    <div style={`background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:16px;transition:border-color 0.15s;border-left:3px solid ${statusColor[task.status]}`}>
      <button
        onClick={() => updateStatus(task.id, nextStatus[task.status])}
        title={`Move to ${nextStatus[task.status]}`}
        style={`width:24px;height:24px;border-radius:50%;border:2px solid ${statusColor[task.status]};background:${task.status === 'done' ? statusColor[task.status] : 'transparent'};cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px`}
      >{task.status === 'done' ? '\u2713' : ''}</button>
      <div style="flex:1;min-width:0">
        <div style={`font-size:15px;font-weight:500;${task.status === 'done' ? 'text-decoration:line-through;opacity:0.5' : ''}`}>
          {task.title}
        </div>
        <div style="display:flex;gap:8px;margin-top:6px">
          <span style={`font-size:11px;padding:2px 8px;border-radius:4px;background:${priorityColor[task.priority]}22;color:${priorityColor[task.priority]};font-weight:500`}>
            {task.priority}
          </span>
          <span style="font-size:11px;color:var(--text-muted)">
            {new Date(task.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>
      <button
        onClick={() => deleteTask(task.id)}
        style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:4px 8px;opacity:0.5;transition:opacity 0.15s"
      >{'\u00d7'}</button>
    </div>
  );
}

function TaskList() {
  return (
    <div>
      {() => {
        const items = filteredTasks();
        if (items.length === 0) {
          return (
            <div style="text-align:center;padding:48px;color:var(--text-muted);font-size:14px">
              {filter() === 'all' ? 'No tasks yet. Add one above!' : `No ${filter()} tasks.`}
            </div>
          );
        }
        return (
          <div style="display:flex;flex-direction:column;gap:8px">
            {items.map(task => <TaskCard key={task.id} task={task} />)}
          </div>
        );
      }}
    </div>
  );
}

function LiveFeed() {
  return (
    <div>
      {() => {
        const events = liveEvents();
        if (events.length === 0) return null;
        return (
          <div style="margin-top:32px">
            <h3 style="font-size:14px;font-weight:600;color:var(--text-muted);margin-bottom:12px;text-transform:uppercase;letter-spacing:0.05em">Live Feed</h3>
            <div style="display:flex;flex-direction:column;gap:4px">
              {events.map(ev => (
                <div style="font-size:12px;color:var(--text-muted);padding:6px 12px;background:var(--surface);border-radius:6px;display:flex;justify-content:space-between">
                  <span>{`${ev.type}: ${ev.data.title || ev.data.id || '...'}`}</span>
                  <span style="opacity:0.5">{new Date(ev.time).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        );
      }}
    </div>
  );
}

function App() {
  return (
    <div>
      <Header />
      <AddTask />
      <FilterBar />
      <TaskList />
      <LiveFeed />
      <footer style="margin-top:48px;padding-top:24px;border-top:1px solid var(--border);text-align:center;color:var(--text-muted);font-size:12px">
        Built with What Framework — signals-based reactivity, zero virtual DOM
      </footer>
    </div>
  );
}

// --- Init ---
fetchTasks();
connectSSE();
mount(<App />, '#app');
