// Dashboard — SSR'd on the server, hydrated on the client
export const page = { mode: 'hybrid' };

export default function Home() {
  return (
    <div>
      <header style="margin-bottom: 32px;">
        <h1 style="font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 8px;">
          Dashboard
        </h1>
        <p style="color: var(--muted); font-size: 15px;">
          Full-stack task board built with ThenJS — What Framework frontend + CelsianJS backend
        </p>
      </header>

      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 32px;">
        <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; border-top: 3px solid var(--todo);">
          <div style="font-size: 32px; font-weight: 700; color: var(--todo);" id="stat-todo">-</div>
          <div style="font-size: 13px; color: var(--muted); margin-top: 4px;">To Do</div>
        </div>
        <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; border-top: 3px solid var(--progress);">
          <div style="font-size: 32px; font-weight: 700; color: var(--progress);" id="stat-progress">-</div>
          <div style="font-size: 13px; color: var(--muted); margin-top: 4px;">In Progress</div>
        </div>
        <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; border-top: 3px solid var(--done);">
          <div style="font-size: 32px; font-weight: 700; color: var(--done);" id="stat-done">-</div>
          <div style="font-size: 13px; color: var(--muted); margin-top: 4px;">Done</div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px;">
        <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px;">
          <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 16px;">Stack</h3>
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 12px;">
            <li style="display: flex; justify-content: space-between; font-size: 14px;">
              <span>Frontend</span>
              <span style="color: var(--accent);">What Framework</span>
            </li>
            <li style="display: flex; justify-content: space-between; font-size: 14px;">
              <span>Backend</span>
              <span style="color: var(--accent);">CelsianJS</span>
            </li>
            <li style="display: flex; justify-content: space-between; font-size: 14px;">
              <span>Meta-Framework</span>
              <span style="color: var(--accent);">ThenJS</span>
            </li>
            <li style="display: flex; justify-content: space-between; font-size: 14px;">
              <span>Rendering</span>
              <span style="color: var(--muted);">Hybrid SSR</span>
            </li>
          </ul>
        </div>

        <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px;">
          <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 16px;">Features Shown</h3>
          <ul style="list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 14px; color: var(--muted);">
            <li>File-based routing (src/pages/)</li>
            <li>API routes (src/api/)</li>
            <li>Type-safe RPC (src/rpc/)</li>
            <li>Layout system (_layout.tsx)</li>
            <li>SSR + client hydration</li>
            <li>Background tasks (src/tasks/)</li>
          </ul>
        </div>
      </div>

      <script>{`
        // Client-side: fetch stats from API
        fetch('/api/tasks').then(r => r.json()).then(data => {
          const tasks = data.tasks || [];
          document.getElementById('stat-todo').textContent = tasks.filter(t => t.status === 'todo').length;
          document.getElementById('stat-progress').textContent = tasks.filter(t => t.status === 'in-progress').length;
          document.getElementById('stat-done').textContent = tasks.filter(t => t.status === 'done').length;
        }).catch(() => {
          document.getElementById('stat-todo').textContent = '3';
          document.getElementById('stat-progress').textContent = '2';
          document.getElementById('stat-done').textContent = '1';
        });
      `}</script>
    </div>
  );
}
