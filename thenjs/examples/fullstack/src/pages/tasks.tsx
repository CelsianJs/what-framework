// Tasks page — client-rendered for full interactivity
export const page = { mode: 'client' };

export default function Tasks() {
  return (
    <div>
      <header style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
        <div>
          <h1 style="font-size: 24px; font-weight: 700;">Tasks</h1>
          <p style="color: var(--muted); font-size: 14px; margin-top: 4px;">Manage your task board</p>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span id="live-indicator" style="width: 8px; height: 8px; border-radius: 50%; background: var(--done);"></span>
          <span style="font-size: 12px; color: var(--muted);">Live</span>
        </div>
      </header>

      <div id="add-task" style="background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 24px; display: flex; gap: 12px;">
        <input id="task-title" type="text" placeholder="Add a new task..."
          style="flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 16px; color: var(--text); font-size: 14px; outline: none; font-family: inherit;" />
        <select id="task-priority"
          style="background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px; color: var(--text); font-size: 13px; outline: none; font-family: inherit;">
          <option value="low">Low</option>
          <option value="medium" selected>Medium</option>
          <option value="high">High</option>
        </select>
        <button id="add-btn"
          style="background: var(--accent); color: #000; border: none; border-radius: 8px; padding: 10px 20px; font-weight: 600; font-size: 14px; cursor: pointer; font-family: inherit;">
          Add
        </button>
      </div>

      <div id="filters" style="display: flex; gap: 8px; margin-bottom: 16px;"></div>
      <div id="task-list" style="display: flex; flex-direction: column; gap: 8px;"></div>

      <script>{`
        // Client-side task management using vanilla JS
        // In production, this would use What Framework's signal() system
        let currentFilter = 'all';
        let tasks = [];

        const API = '';  // Same origin — ThenJS handles routing

        async function loadTasks() {
          try {
            const res = await fetch('/api/tasks');
            const data = await res.json();
            tasks = data.tasks || [];
          } catch {
            tasks = [
              { id: '1', title: 'Set up project', status: 'done', priority: 'high', createdAt: Date.now() },
              { id: '2', title: 'Build features', status: 'in-progress', priority: 'high', createdAt: Date.now() },
              { id: '3', title: 'Write tests', status: 'todo', priority: 'medium', createdAt: Date.now() },
            ];
          }
          render();
        }

        async function addTask() {
          const title = document.getElementById('task-title').value.trim();
          const priority = document.getElementById('task-priority').value;
          if (!title) return;

          try {
            await fetch('/api/tasks', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ title, priority }),
            });
          } catch {
            tasks.push({ id: crypto.randomUUID(), title, status: 'todo', priority, createdAt: Date.now() });
          }
          document.getElementById('task-title').value = '';
          await loadTasks();
        }

        async function updateStatus(id, status) {
          try {
            await fetch('/api/tasks/' + id, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ status }),
            });
          } catch {
            tasks = tasks.map(t => t.id === id ? { ...t, status } : t);
          }
          await loadTasks();
        }

        async function deleteTask(id) {
          try { await fetch('/api/tasks/' + id, { method: 'DELETE' }); } catch {}
          await loadTasks();
        }

        function render() {
          const filtered = currentFilter === 'all' ? tasks : tasks.filter(t => t.status === currentFilter);
          const colors = { high: '#ef4444', medium: '#f59e0b', low: '#64748b' };
          const statusColors = { todo: '#ef4444', 'in-progress': '#3b82f6', done: '#22c55e' };
          const nextStatus = { todo: 'in-progress', 'in-progress': 'done', done: 'todo' };

          // Filters
          const filterContainer = document.getElementById('filters');
          filterContainer.innerHTML = ['all', 'todo', 'in-progress', 'done'].map(f => {
            const active = f === currentFilter;
            return '<button onclick="setFilter(\\'' + f + '\\')" style="padding:8px 16px;border-radius:6px;border:1px solid ' +
              (active ? 'var(--accent)' : 'var(--border)') + ';background:' + (active ? 'var(--accent)' : 'transparent') +
              ';color:' + (active ? '#000' : 'var(--muted)') + ';font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;">' +
              f.replace('-', ' ') + '</button>';
          }).join('');

          // Tasks
          const list = document.getElementById('task-list');
          if (filtered.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:48px;color:var(--muted);">No tasks</div>';
            return;
          }
          list.innerHTML = filtered.map(t => {
            const sc = statusColors[t.status] || '#64748b';
            return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px 20px;display:flex;align-items:center;gap:16px;border-left:3px solid ' + sc + ';">' +
              '<button onclick="updateStatus(\\'' + t.id + '\\',\\'' + nextStatus[t.status] + '\\')" style="width:24px;height:24px;border-radius:50%;border:2px solid ' + sc + ';background:' + (t.status === 'done' ? sc : 'transparent') + ';cursor:pointer;color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center;">' + (t.status === 'done' ? '\\u2713' : '') + '</button>' +
              '<div style="flex:1;">' +
                '<div style="font-size:15px;font-weight:500;' + (t.status === 'done' ? 'text-decoration:line-through;opacity:0.5;' : '') + '">' + t.title + '</div>' +
                '<div style="display:flex;gap:8px;margin-top:6px;">' +
                  '<span style="font-size:11px;padding:2px 8px;border-radius:4px;background:' + colors[t.priority] + '22;color:' + colors[t.priority] + ';font-weight:500;">' + t.priority + '</span>' +
                '</div>' +
              '</div>' +
              '<button onclick="deleteTask(\\'' + t.id + '\\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;padding:4px 8px;">&times;</button>' +
            '</div>';
          }).join('');
        }

        window.setFilter = (f) => { currentFilter = f; render(); };
        window.updateStatus = updateStatus;
        window.deleteTask = deleteTask;

        document.getElementById('add-btn').addEventListener('click', addTask);
        document.getElementById('task-title').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') addTask();
        });

        loadTasks();
      `}</script>
    </div>
  );
}
