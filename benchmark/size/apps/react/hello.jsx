import { useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <h1>Hello</h1>
      <button type="button" onClick={() => setCount(n => n + 1)}>Count: {count}</button>
    </main>
  );
}

createRoot(document.getElementById('app')).render(<App />);
