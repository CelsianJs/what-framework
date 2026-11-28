// What Framework - Store
// Lightweight global state management. Signal-based, type-safe, ergonomic.
// Like Zustand meets signals — define a store, use it anywhere.

import { signal, computed, batch, __DEV__ } from './reactive.js';
import { report } from './diagnostics.js';

// --- derived ---
// Marker wrapper to explicitly tag a function as a computed in createStore.
// Without this, createStore can't distinguish computed(state => ...) from action(item => ...).
//
// Usage:
//   const useCounter = createStore({
//     count: 0,
//     doubled: derived(state => state.count * 2),
//     addItem(item) { /* this is an action */ },
//   });

export function derived(fn) {
  fn._storeComputed = true;
  return fn;
}

// --- createStore ---
// Creates a reactive store with actions. Each key becomes a signal.
//
// In an action, `this` reads the current state and derived values, and
// assigning a state key writes its signal. The assignment is what notifies: an
// in-place mutation such as `this.items.push(item)` changes the array but no
// reader re-runs, so assign a new value instead. An action runs as one batch
// and returns what the function returns.
//
// Usage:
//   const useCounter = createStore({
//     count: 0,
//     items: [],
//     doubled: derived(state => state.count * 2),        // computed
//     increment() { this.count++; },                      // action
//     addItem(item) { this.items = [...this.items, item]; },
//   });
//
//   function Counter() {
//     const counter = useCounter();
//     return h('div', null, () => counter.count, ' / ', () => counter.doubled,
//       h('button', { onClick: counter.increment }, '+'));
//   }

export function createStore(definition) {
  const signals = {};
  const computeds = {};
  const actions = {};

  // Separate state, computeds, and actions
  // Use explicit _storeComputed marker instead of function.length heuristic
  for (const [key, value] of Object.entries(definition)) {
    if (typeof value === 'function' && value._storeComputed) {
      if (__DEV__ && value.length === 0) {
        report('ERR_DERIVED_WITHOUT_STATE', { data: { key } });
      }
      // Computed: explicitly marked with derived()
      computeds[key] = value;
    } else if (typeof value === 'function') {
      // Action: any other function
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

  // Build action functions bound to signals.
  // Actions may return a value (e.g. `addItem(): newId`) — propagate it
  // through the batch() wrapper so callers can use the return value.
  for (const [key, fn] of Object.entries(actions)) {
    actions[key] = (...args) => {
      let result;
      batch(() => {
        const proxy = new Proxy({}, {
          get(_, prop) {
            if (signals[prop]) return signals[prop].peek();
            if (computeds[prop]) return computeds[prop].peek();
            if (actions[prop]) return actions[prop];
            return undefined;
          },
          set(_, prop, val) {
            if (signals[prop]) signals[prop].set(val);
            return true;
          },
        });
        result = fn.apply(proxy, args);
      });
      return result;
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
