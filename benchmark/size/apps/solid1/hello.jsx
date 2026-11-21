import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

function App() {
  const [count, setCount] = createSignal(0);
  return (
    <main>
      <h1>Hello</h1>
      <button type="button" onClick={() => setCount(n => n + 1)}>Count: {count()}</button>
    </main>
  );
}

render(() => <App />, document.getElementById('app'));
