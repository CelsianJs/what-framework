import { Suspense, useRef } from 'react';
import { atom, createStore, Provider, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { atomWithStorage, unwrap } from 'jotai/utils';

const countAtom = atom(0);
const doubledAtom = atom((get) => get(countAtom) * 2);
const nameAtom = atomWithStorage('j-name', 'ada');
const upperAtom = atom((get) => get(nameAtom).toUpperCase(), (_get, set, next) => set(nameAtom, next.toLowerCase()));
const idAtom = atom(1);
// An async atom: reading it suspends until the request lands.
const userAtom = atom(async (get) => {
  const id = get(idAtom);
  const res = await fetch(`/api/user?n=${id}`);
  return (await res.json()).items[0];
});
// unwrap: the async atom as a sync one, with the last value while it refetches.
const userUnwrapped = unwrap(userAtom, (prev) => prev ?? 'pending');
const store = createStore();
window.jStore = store;
window.jCount = countAtom;

function Counter() {
  const [count, setCount] = useAtom(countAtom);
  const doubled = useAtomValue(doubledAtom);
  return <button id="j-count" onClick={() => setCount((c) => c + 1)}>{count}/{doubled}</button>;
}

function Name() {
  const [upper, setUpper] = useAtom(upperAtom);
  const renders = useRef(0);
  renders.current++;
  return <input id="j-name" data-renders={renders.current} value={upper} onChange={(e) => setUpper(e.target.value)} />;
}

function User() {
  const user = useAtomValue(userAtom);
  return <span id="j-user">{user}</span>;
}

function UserState() {
  const value = useAtomValue(userUnwrapped);
  return <span id="j-loadable">{value}</span>;
}

function Next() {
  const setId = useSetAtom(idAtom);
  return <button id="j-next" onClick={() => setId((i) => i + 1)}>next</button>;
}

export default function Fixture() {
  return (
    <Provider store={store}>
      <Counter />
      <Name />
      <Suspense fallback={<span id="j-fallback">loading</span>}>
        <User />
      </Suspense>
      <UserState />
      <Next />
    </Provider>
  );
}
