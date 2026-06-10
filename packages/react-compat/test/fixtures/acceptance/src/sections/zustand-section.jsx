import { create } from 'zustand';

const useCounter = create((set) => ({
  count: 1,
  inc: () => set((s) => ({ count: s.count + 1 })),
}));

export function ZustandSection() {
  const count = useCounter((s) => s.count);
  const inc = useCounter((s) => s.inc);
  return (
    <section id="zustand-section">
      <h2>2. zustand</h2>
      <div>
        count: <output id="z-count">{count}</output> · doubled:{' '}
        <output id="z-doubled">{count * 2}</output>
      </div>
      <button id="z-inc" onClick={inc}>increment</button>
    </section>
  );
}
