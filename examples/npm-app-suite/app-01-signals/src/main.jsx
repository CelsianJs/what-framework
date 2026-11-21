import { mount, useSignal, batch } from 'what-framework';

function App() {
  const count = useSignal(0);
  const step = useSignal(1);
  const history = useSignal([{ id: 0, value: 0 }]);
  let nextEntryId = 1;

  function applyDelta(delta) {
    batch(() => {
      const next = count() + delta * step();
      count(next);
      history([...history(), { id: nextEntryId++, value: next }].slice(-8));
    });
  }

  return (
    <main className="app-shell">
      <h1>App 01: Signals</h1>
      <p>Signal reads/writes, callable setter compatibility, and batched updates.</p>

      <label className="row">
        Step: <strong>{step()}</strong>
        <input
          type="range"
          min="1"
          max="5"
          value={step()}
          onInput={(e) => step(Number(e.target.value))}
        />
      </label>

      <section className="row">
        <button onClick={() => applyDelta(-1)}>-</button>
        <output>{count()}</output>
        <button onClick={() => applyDelta(1)}>+</button>
      </section>

      <h2>Recent Values</h2>
      <ul>
        {history().map((entry) => (
          <li key={entry.id}>{entry.value}</li>
        ))}
      </ul>
    </main>
  );
}

mount(<App />, '#app');
