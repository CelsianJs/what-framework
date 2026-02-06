// What Framework - Store
// Lightweight global state management. Signal-based, type-safe, ergonomic.
// Like Zustand meets signals — define a store, use it anywhere.

import { signal, computed, batch } from './reactive.js';

// --- createStore ---
// Creates a reactive store with actions. Each key becomes a signal.
//
// Usage:
//   const useCounter = createStore({
//     count: 0,
//     doubled: (state) => state.count * 2,  // computed
//     increment() { this.count++; },         // action
//     decrement() { this.count--; },
//   });
//
//   function Counter() {
//     const { count, doubled, increment } = useCounter();
//     return h('div', null, count, ' / ', doubled, h('button', { onClick: increment }, '+'));
//   }

export function createStore(definition) {
  const signals = {};
  const computeds = {};
  const actions = {};
  const state = {};

  // Separate state, computeds, and actions
  for (const [key, value] of Object.entries(definition)) {
    if (typeof value === 'function' && value.length > 0 && key !== 'constructor') {
      // Computed: function that takes state
      computeds[key] = value;
    } else if (typeof value === 'function') {
      // Action: function with no args that uses `this`
      actions[key] = value;
    } else {
      // State: initial value
      signals[key] = signal(value);
    }
  }

  // Build computed signals
  for (const [key, fn] of Object.entries(computeds)) {
    const proxy = new Proxy({}, {
      get(_, prop) {
        if (signals[prop]) return signals[prop]();
        if (computeds[prop]) return computeds[prop]();
        return undefined;
      },
    });
    computeds[key] = computed(() => fn(proxy));
  }

  // Build action functions bound to signals
  for (const [key, fn] of Object.entries(actions)) {
    actions[key] = (...args) => {
      batch(() => {
        const proxy = new Proxy({}, {
          get(_, prop) {
            if (signals[prop]) return signals[prop].peek();
            return undefined;
          },
          set(_, prop, val) {
            if (signals[prop]) signals[prop].set(val);
            return true;
          },
        });
        fn.apply(proxy, args);
      });
    };
  }

  // Return a hook-like function
  return function useStore() {
    const result = {};
    for (const [key, s] of Object.entries(signals)) {
      Object.defineProperty(result, key, { get: () => s(), enumerable: true });
    }
    for (const [key, c] of Object.entries(computeds)) {
      Object.defineProperty(result, key, { get: () => c(), enumerable: true });
    }
    for (const [key, fn] of Object.entries(actions)) {
      result[key] = fn;
    }
    return result;
  };
}

// --- Simple atom ---
// Even simpler: a single reactive value accessible globally.
//
// const count = atom(0);
// count();       // read
// count.set(5);  // write

export function atom(initial) {
  return signal(initial);
}
