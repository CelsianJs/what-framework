import { mount, useSignal, useComputed } from 'what-framework';

function App() {
  const items = useSignal([
    { id: 1, name: 'Keyboard', price: 90, qty: 1 },
    { id: 2, name: 'Mouse', price: 45, qty: 2 },
    { id: 3, name: 'Display', price: 210, qty: 1 },
  ]);
  const taxRate = useSignal(0.08);

  const subtotal = useComputed(() =>
    items().reduce((sum, item) => sum + item.price * item.qty, 0)
  );
  const tax = useComputed(() => subtotal() * taxRate());
  const total = useComputed(() => subtotal() + tax());

  function addQty(id) {
    items(items().map((item) =>
      item.id === id ? { ...item, qty: item.qty + 1 } : item
    ));
  }

  return (
    <main className="app-shell">
      <h1>App 02: Computed Totals</h1>
      <p>Derived totals update automatically from signal changes.</p>

      <label>
        Tax Rate: {(taxRate() * 100).toFixed(0)}%
        <input
          type="range"
          min="0"
          max="25"
          value={(taxRate() * 100).toFixed(0)}
          onInput={(e) => taxRate(Number(e.target.value) / 100)}
        />
      </label>

      <ul>
        {items().map((item) => (
          <li key={item.id}>
            <strong>{item.name}</strong>
            <span>${item.price}</span>
            <span>Qty: {item.qty}</span>
            <button onClick={() => addQty(item.id)}>+1</button>
          </li>
        ))}
      </ul>

      <section className="totals">
        <div>Subtotal: ${subtotal().toFixed(2)}</div>
        <div>Tax: ${tax().toFixed(2)}</div>
        <div><strong>Total: ${total().toFixed(2)}</strong></div>
      </section>
    </main>
  );
}

mount(<App />, '#app');
