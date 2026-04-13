import { Link } from 'what-framework/router';

export function Layout({ children }) {
  return (
    <div class="layout">
      {/* Navigation */}
      <nav class="nav">
        <div class="nav-inner">
          <Link href="/" class="nav-logo">What</Link>
          <div class="nav-links">
            <Link href="/" class="nav-link">Home</Link>
            <Link href="/demos" class="nav-link">Demos</Link>
            <Link href="/islands" class="nav-link">Islands</Link>
            <Link href="/bench" class="nav-link">Benchmarks</Link>
            <Link href="/docs" class="nav-link">Docs</Link>
            <a
              href="https://github.com/CelsianJs/what-framework"
              class="nav-cta"
              target="_blank"
              rel="noopener"
            >GitHub</a>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main class="content">
        <div class="container">{children}</div>
      </main>

      {/* Footer */}
      <footer class="footer-simple">
        <p>What Framework v0.1.0 — Fine-grained rendering, the closest to vanilla JS</p>
      </footer>
    </div>
  );
}
