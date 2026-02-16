// About page — static, no server rendering needed
export const page = { mode: 'static' };

export default function About() {
  return (
    <div style="max-width: 640px;">
      <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 16px;">About This App</h1>

      <p style="color: var(--muted); line-height: 1.7; margin-bottom: 24px;">
        This is a full-stack example app built with <strong style="color: var(--text);">ThenJS</strong> —
        the meta-framework that combines What Framework (frontend) with CelsianJS (backend).
      </p>

      <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 16px;">File Structure</h3>
        <pre style="font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--muted); line-height: 1.8;">{`src/
├── pages/
│   ├── _layout.tsx     → Root layout (nav, styles)
│   ├── index.tsx       → Dashboard (hybrid SSR)
│   ├── tasks.tsx       → Task board (client-rendered)
│   └── about.tsx       → This page (static)
├── api/
│   ├── health.ts       → GET /api/health
│   └── tasks.ts        → CRUD /api/tasks
├── rpc/
│   └── index.ts        → Type-safe RPC procedures
└── tasks/
    └── cleanup.ts      → Cron: clean completed tasks`}</pre>
      </div>

      <div style="background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px;">
        <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 16px;">The Stack</h3>
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <div>
            <div style="font-weight: 600; margin-bottom: 4px;">What Framework</div>
            <div style="font-size: 14px; color: var(--muted);">Signals-based frontend. Fine-grained DOM updates, no virtual DOM. Components render at vanilla JS speed.</div>
          </div>
          <div>
            <div style="font-weight: 600; margin-bottom: 4px;">CelsianJS</div>
            <div style="font-size: 14px; color: var(--muted);">Backend runtime. Hook-based server, type-safe RPC, SSE, WebSockets, task queues, caching. Built on Web Standard APIs.</div>
          </div>
          <div>
            <div style="font-weight: 600; margin-bottom: 4px;">ThenJS</div>
            <div style="font-size: 14px; color: var(--muted);">Meta-framework. File-based routing, SSR, hybrid rendering, Vite integration, build tooling. Combines both into one DX.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
