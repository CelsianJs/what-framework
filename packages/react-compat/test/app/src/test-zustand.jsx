/**
 * Test: Zustand store used inside a What Framework component
 *
 * Zustand uses useSyncExternalStore internally.
 * If this works, basic React hook compat is solid.
 */
import { create } from 'zustand';

// Create a Zustand store — this calls React.useSyncExternalStore internally
const useCountStore = create((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
  decrement: () => set((state) => ({ count: state.count - 1 })),
  reset: () => set({ count: 0 }),
}));

export function ZustandTest() {
  const count = useCountStore((state) => state.count);
  const increment = useCountStore((state) => state.increment);
  const decrement = useCountStore((state) => state.decrement);
  const reset = useCountStore((state) => state.reset);

  return (
    <div>
      <p>Count: <strong id="zustand-count">{count}</strong></p>
      <button onclick={increment}>+</button>
      <button onclick={decrement}>-</button>
      <button onclick={reset}>Reset</button>
      <p style="color: green;" id="zustand-status">Zustand loaded OK</p>
    </div>
  );
}
