// fixture.jsx as a native What page: each React component is an island of
// its own, and between the two counters stands one that throws while it
// hydrates (parts.jsx Boom). It must take down nothing but itself.
import { signal } from 'what-framework';
import { Boom, Counter, EdgeForm, NotDraggable } from './parts.jsx';

export default function Native() {
  const n = signal(0);
  return (
    <div>
      <NotDraggable />
      <Counter id="edge-good1" />
      <Boom />
      <Counter id="edge-good2" />
      <button id="edge-native-btn" onClick={() => n((x) => x + 1)}>more</button>
      <span id="edge-native">{n()}</span>
      <EdgeForm />
    </div>
  );
}
