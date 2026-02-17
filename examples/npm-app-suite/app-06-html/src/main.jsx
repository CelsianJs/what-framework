import { mount, useSignal } from 'what-framework';

function App() {
  const count = useSignal(1);
  const mode = useSignal('inner');

  const htmlSnippet = () =>
    `<strong>Rendered count:</strong> <span style="color:#0f766e">${count()}</span>`;

  const svgSnippet = () =>
    `<circle cx="32" cy="32" r="24" fill="${count() % 2 ? '#2563eb' : '#16a34a'}"></circle>`;

  return (
    <main className="app-shell">
      <h1>App 06: HTML Injection Paths</h1>
      <p>Validates `innerHTML`, `dangerouslySetInnerHTML`, and SVG innerHTML behavior.</p>

      <div className="row">
        <button onClick={() => count.set((v) => v + 1)}>Increment</button>
        <button onClick={() => mode(mode() === 'inner' ? 'dangerous' : 'inner')}>
          Toggle Path ({mode()})
        </button>
      </div>

      {mode() === 'inner' ? (
        <section className="panel" innerHTML={htmlSnippet()} />
      ) : (
        <section className="panel" dangerouslySetInnerHTML={{ __html: htmlSnippet() }} />
      )}

      <svg className="swatch" width="64" height="64" viewBox="0 0 64 64" innerHTML={svgSnippet()} />
    </main>
  );
}

mount(<App />, '#app');
