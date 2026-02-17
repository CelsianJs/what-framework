import { batch, useComputed, useEffect, useSignal } from 'what-framework';

export const page = {
  mode: 'client',
};

export default function SignalsPage() {
  const count = useSignal(0);
  const step = useSignal(1);
  const history = useSignal([0]);

  const doubled = useComputed(() => count() * 2);
  const parity = useComputed(() => (count() % 2 === 0 ? 'even' : 'odd'));
  const accent = useComputed(() => (count() >= 0 ? '#0f766e' : '#be123c'));

  useEffect(() => {
    history.set((prev) => [...prev.slice(-6), count()]);
  }, [count()]);

  const increment = () => count(count() + step());
  const decrement = () => count(count() - step());

  const resetBoth = () => {
    batch(() => {
      count(0);
      step(1);
      history([0]);
    });
  };

  return (
    <section>
      <h1 class="page-title">Signals and computed values</h1>
      <p class="lead">Uses <code>useSignal</code>, <code>useComputed</code>, <code>useEffect</code>, and <code>batch</code>.</p>

      <div class="card" style={{ borderColor: accent() }}>
        <p><strong>Count:</strong> {count()}</p>
        <p><strong>Doubled:</strong> {doubled()}</p>
        <p><strong>Parity:</strong> <span class="badge">{parity()}</span></p>

        <label class="field">
          <span>Step size</span>
          <input
            class="text-input"
            type="number"
            min="1"
            value={step()}
            onInput={(e) => step(Number(e.target.value || 1))}
          />
        </label>

        <div class="button-row">
          <button class="btn" onClick={decrement}>- step</button>
          <button class="btn btn-primary" onClick={increment}>+ step</button>
          <button class="btn" onClick={resetBoth}>Reset</button>
        </div>

        <p class="small-note">Recent values: {history().join(' → ')}</p>
      </div>
    </section>
  );
}
