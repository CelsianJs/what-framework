// What hydration has to get right beyond a clean match (MIXED.md, Server
// rendering): draggable={false}, a form submitted before the page hydrates,
// and (native.jsx) an island that throws while it hydrates beside two that do
// not. A React file: one tree.
import { useState } from 'react';
import { Counter, EdgeForm, NotDraggable } from './parts.jsx';

export default function Fixture() {
  const [n, setN] = useState(0);
  return (
    <div>
      <NotDraggable />
      <Counter id="edge-good1" />
      <Counter id="edge-good2" />
      <button id="edge-native-btn" onClick={() => setN(n + 1)}>more</button>
      <span id="edge-native">{n}</span>
      <EdgeForm />
    </div>
  );
}
