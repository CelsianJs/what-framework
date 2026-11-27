// Native components that React components render: each runs once, reads its
// props live, and finds the What context around the island.
import { signal, useContext, onCleanup } from 'what-framework';
import { DeskContext } from './context.js';
import { probes } from './probes.js';

export function DeskBadge(props) {
  probes.native.built++;
  onCleanup(() => { probes.native.disposed++; });
  const desk = useContext(DeskContext);
  return <span class="badge" data-desk-badge>{desk.desk} · {desk.trader()} · {props.label}</span>;
}

export function NativeNote() {
  probes.native.built++;
  onCleanup(() => { probes.native.disposed++; });
  const clicks = signal(0);
  return (
    <p class="note" data-native-note>
      <button type="button" data-native-note-btn onClick={() => clicks(clicks() + 1)}>noted {clicks()}</button>
    </p>
  );
}

// A native field placed inside a React <form onChange>.
export function NativeField(props) {
  return <input data-native-in-react placeholder="native field" onInput={(e) => props.onType(e.target.value)} />;
}
