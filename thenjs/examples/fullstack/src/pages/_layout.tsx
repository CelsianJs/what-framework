// Root layout — wraps all pages
export default function Layout({ children }: { children: any }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Pulse — ThenJS Full-Stack</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <style>{`
          :root {
            --bg: #0f172a;
            --surface: #1e293b;
            --border: #334155;
            --text: #f1f5f9;
            --muted: #94a3b8;
            --accent: #f59e0b;
            --todo: #ef4444;
            --progress: #3b82f6;
            --done: #22c55e;
          }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); }
          a { color: var(--accent); text-decoration: none; }
          a:hover { text-decoration: underline; }
          .container { max-width: 960px; margin: 0 auto; padding: 0 24px; }
          nav { background: var(--surface); border-bottom: 1px solid var(--border); padding: 16px 0; }
          nav .container { display: flex; justify-content: space-between; align-items: center; }
          nav .brand { font-size: 18px; font-weight: 700; color: var(--text); }
          nav .brand span { color: var(--accent); }
          nav .links { display: flex; gap: 24px; }
          nav .links a { color: var(--muted); font-size: 14px; font-weight: 500; }
          nav .links a:hover { color: var(--text); text-decoration: none; }
          main { padding: 32px 0; }
        `}</style>
      </head>
      <body>
        <nav>
          <div class="container">
            <a href="/" class="brand">Pulse<span>Board</span></a>
            <div class="links">
              <a href="/">Dashboard</a>
              <a href="/tasks">Tasks</a>
              <a href="/about">About</a>
            </div>
          </div>
        </nav>
        <main class="container">
          {children}
        </main>
      </body>
    </html>
  );
}
