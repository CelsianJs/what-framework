// Root layout — wraps all pages in this directory
// _layout.jsx files are auto-detected by the file router.
// The matched page renders as {children}.

import { Link } from 'what-framework/router';

export default function RootLayout({ children }) {
  return (
    <div class="layout">
      <header class="header">
        <Link href="/" class="logo">Contacts</Link>
        <nav class="nav">
          <Link href="/" activeClass="nav-active">Home</Link>
          <Link href="/add" activeClass="nav-active">Add</Link>
          <Link href="/about" activeClass="nav-active">About</Link>
        </nav>
      </header>
      <main class="main">{children}</main>
      <Style />
    </div>
  );
}

function Style() {
  return (
    <style>{`
      .layout { display: flex; flex-direction: column; min-height: 100vh; }
      .header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 0; border-bottom: 1px solid var(--border); margin-bottom: 24px;
      }
      .logo { font-size: 20px; font-weight: 700; text-decoration: none; color: var(--text); }
      .nav { display: flex; gap: 4px; }
      .nav a {
        padding: 6px 14px; border-radius: 6px; text-decoration: none;
        font-size: 14px; font-weight: 500; color: var(--text-muted);
        transition: all 0.15s;
      }
      .nav a:hover { background: var(--border); color: var(--text); }
      .nav a.nav-active { background: var(--primary); color: #fff; }
      .main { flex: 1; }
    `}</style>
  );
}
