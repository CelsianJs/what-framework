import { mount, useSignal, cls } from 'what-framework';

function App() {
  const camel = useSignal(0);
  const lower = useSignal(0);
  const compact = useSignal(false);

  return (
    <main className="app-shell">
      <h1>App 07: Event Casing + Styling</h1>
      <p>Both event casings work; styling uses CSS states plus optional inline style object.</p>

      <div className="row">
        <button onClick={() => camel.set((v) => v + 1)}>onClick: {camel()}</button>
        <button onclick={() => lower(lower() + 1)}>onclick: {lower()}</button>
      </div>

      <label className="row">
        <input
          type="checkbox"
          checked={compact()}
          onInput={(e) => compact(e.target.checked)}
        />
        Compact cards
      </label>

      <section className="cards">
        {[1, 2, 3, 4].map((n) => (
          <article
            key={n}
            className={cls('card', compact() && 'compact')}
            style={{ transform: `translateY(${(camel() + lower()) % 6}px)` }}
          >
            Card {n}
          </article>
        ))}
      </section>
    </main>
  );
}

mount(<App />, '#app');
