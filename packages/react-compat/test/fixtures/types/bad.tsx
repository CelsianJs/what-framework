// Invalid what-react usage. Proves the types are not blanket `any`:
// a string passed to a typed event handler must error (TS2322).
import { useState } from 'what-react';

export function Broken() {
  const [n, setN] = useState(0);
  // onClick is typed as an EventHandler — a string is not assignable.
  return (
    <button onClick={'not a function'}>
      {n}
      <span onClick={() => setN(n + 1)} />
    </button>
  );
}
