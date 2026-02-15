// About — static page with framework info
// Demonstrates: simple component, external links

// This page has no interactivity — it could be pre-rendered at build time
export const page = {
  mode: 'static',
};

export default function About() {
  return (
    <div class="about">
      <h2 class="page-title">About</h2>
      <p>
        This is a starter app built with{' '}
        <a href="https://github.com/nicholasgriffintn/what-fw" target="_blank">What Framework</a>.
      </p>
      <p>
        It demonstrates signals, stores, routing, forms, and component patterns.
      </p>

      <h3 class="section-title">Stack</h3>
      <ul class="feature-list">
        <li><strong>what-framework</strong> — signals, stores, components</li>
        <li><strong>what-router</strong> — client-side routing with Link</li>
        <li><strong>what-compiler</strong> — JSX to h() via Vite plugin</li>
      </ul>

      <h3 class="section-title">Patterns Used</h3>
      <ul class="feature-list">
        <li>Global store with <code>createStore</code> + <code>derived</code></li>
        <li>Local state with <code>useState</code></li>
        <li>Routing with <code>Router</code>, <code>Link</code>, <code>navigate</code></li>
        <li>Shared layout component wrapping all routes</li>
        <li>localStorage persistence in store actions</li>
      </ul>

      <Style />
    </div>
  );
}

function Style() {
  return (
    <style>{`
      .about { max-width: 600px; }
      .about p { margin-bottom: 12px; color: var(--text-muted); line-height: 1.7; }
      .about a { color: var(--primary); text-decoration: none; }
      .about a:hover { text-decoration: underline; }
      .page-title { font-size: 22px; font-weight: 700; margin-bottom: 16px; }
      .section-title { font-size: 16px; font-weight: 600; margin: 20px 0 8px; }
      .feature-list {
        list-style: none; display: flex; flex-direction: column; gap: 6px;
      }
      .feature-list li {
        padding: 8px 12px; background: var(--surface);
        border: 1px solid var(--border); border-radius: var(--radius);
        font-size: 14px;
      }
      .feature-list code {
        background: var(--bg); padding: 1px 4px; border-radius: 3px;
        font-size: 13px;
      }
    `}</style>
  );
}
