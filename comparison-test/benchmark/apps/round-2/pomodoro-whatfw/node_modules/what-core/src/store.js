// What Framework - Store
// Lightweight global state management. Signal-based, type-safe, ergonomic.
// Like Zustand meets signals — define a store, use it anywhere.

import { signal, computed, batch, __DEV__ } from './reactive.js';

// --- storeComputed ---
// Marker wrapper to explicitly tag a function as a computed in createStore.
// Without this, createStore can't distinguish computed(state => ...) from action(item => ...).
//
// Usage:
//   const useCounter = createStore({
//     count: 0,
//     doubled: storeComputed(state => state.count * 2),
//     addItem(item) { /* this is an action */ },
//   });

export function derived(fn) {
  fn._storeComputed = true;
  return fn;
}

// Deprecated alias — use derived() instead
let _storeComputedWarned = false;
export function storeComputed(fn) {
  if (!_storeComputedWarned) {
    _storeComputedWarned = true;
    console.warn('[what] storeComputed() is deprecated. Use derived() instead.');
  }
  return derived(fn);
}

// --- createStore ---
// Creates a reactive store with actions. Each key becomes a signal.
//
// Usage:
//   const useCounter = createStore({
//     count: 0,
//     doubled: storeComputed(state => state.count * 2),  // computed
//     increment() { this.count++; },                      // action
//     decrement() { this.count--; },
//     addItem(item) { this.items.push(item); },           // action (not confused with computed)
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
  // Use explicit _storeComputed marker instead of function.length heuristic
  for (const [key, value] of Object.entries(definition)) {
    if (typeof value === 'function' && value._storeComputed) {
      if (__DEV__ && value.length === 0) {
        console.warn(
          `[what] derived() for "${key}" should accept the state parameter, e.g. derived(state => ...).`
        );
      }
      // Computed: explicitly marked with storeComputed()
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

  // Build action functions bound to signals
  for (const [key, fn] of Object.entries(actions)) {
    actions[key] = (...args) => {
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

// --- Simple atom --- [DEPRECATED: use signal() directly]
let _atomWarned = false;
export function atom(initial) {
  if (!_atomWarned) {
    _atomWarned = true;
    console.warn('[what] atom() is deprecated. Use signal() directly instead.');
  }
  return signal(initial);
}
