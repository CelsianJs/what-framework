// A React file: it imports react. It renders a native component (Counter).
import { useState } from 'react';
import { Counter } from './Counter.jsx';

export function OldBadge({ n, onPick, children }) {
  const [c, setC] = useState(0);
  return (
    <div>
      <button id="ob" onClick={() => setC(c + 1)}>n{n} c{c}</button>
      <button id="pick" onClick={onPick}>pick</button>
      {children}
      <Counter label={`badge ${c} n${n}`} />
    </div>
  );
}
