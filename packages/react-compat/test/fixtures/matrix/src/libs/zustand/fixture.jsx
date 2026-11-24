import { useRef } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { persist, subscribeWithSelector } from 'zustand/middleware';

const useStore = create(subscribeWithSelector((set) => ({
  count: 0,
  todos: ['a'],
  inc: () => set((s) => ({ count: s.count + 1 })),
  add: (todo) => set((s) => ({ todos: [...s.todos, todo] })),
})));
const usePref = create(persist((set) => ({ dark: false, toggle: () => set((s) => ({ dark: !s.dark })) }), { name: 'z-pref' }));
window.zStore = useStore;

function Count() {
  const renders = useRef(0);
  renders.current++;
  const count = useStore((s) => s.count);
  return <p id="z-count" data-renders={renders.current}>{count}</p>;
}

function Todos() {
  const renders = useRef(0);
  renders.current++;
  const { todos, add } = useStore(useShallow((s) => ({ todos: s.todos, add: s.add })));
  return (
    <div>
      <span id="z-todos" data-renders={renders.current}>{todos.join(',')}</span>
      <button id="z-add" onClick={() => add('t' + todos.length)}>add</button>
    </div>
  );
}

function Pref() {
  const dark = usePref((s) => s.dark);
  const toggle = usePref((s) => s.toggle);
  return <button id="z-pref" onClick={toggle}>{dark ? 'dark' : 'light'}</button>;
}

export default function Fixture() {
  const inc = useStore((s) => s.inc);
  return (
    <div>
      <Count />
      <Todos />
      <Pref />
      <button id="z-inc" onClick={inc}>inc</button>
    </div>
  );
}
