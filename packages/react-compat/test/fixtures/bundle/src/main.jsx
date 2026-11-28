// A compat app with nothing else in it: no h(), no kit, no other vnode
// producer. JSX goes through what-react's runtime and What's mount() renders
// the result, so the bundle has core's vnode renderer only if what-react's
// own vnodes bring it in.
import { mount, signal } from 'what-framework';
import { useState, useEffect, useSyncExternalStore } from 'react';

// A store reached the way React state libraries reach React.
const listeners = new Set();
let bears = 0;
const store = {
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  read: () => bears,
  add() {
    bears += 1;
    for (const listener of listeners) listener();
  },
};

const count = signal(0, 'count');

function Bears() {
  const n = useSyncExternalStore(store.subscribe, store.read);
  return <p id="bears">{n} bears</p>;
}

function Clicks() {
  const [clicks, setClicks] = useState(0);
  useEffect(() => () => window.__log.push('Clicks unmounted'), []);
  return <button id="clicks" onClick={() => setClicks((c) => c + 1)}>clicks {clicks}</button>;
}

function App() {
  return (
    <main>
      <output id="count">{() => count()}</output>
      <button id="inc" onClick={() => count((c) => c + 1)}>+</button>
      <button id="add" onClick={store.add}>add bear</button>
      <Bears />
      <Clicks />
    </main>
  );
}

window.__log = [];
window.__unmount = mount(<App />, '#app');
