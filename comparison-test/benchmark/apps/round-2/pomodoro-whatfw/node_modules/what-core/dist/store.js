import { signal, computed, batch, __DEV__ } from './reactive.js';
export function derived(fn) {
fn._storeComputed = true;
return fn;
}
let _storeComputedWarned = false;
export function storeComputed(fn) {
if (!_storeComputedWarned) {
_storeComputedWarned = true;
console.warn('[what] storeComputed() is deprecated. Use derived() instead.');
}
return derived(fn);
}
export function createStore(definition) {
const signals = {};
const computeds = {};
const actions = {};
const state = {};
for (const [key, value] of Object.entries(definition)) {
if (typeof value === 'function' && value._storeComputed) {
if (__DEV__ && value.length === 0) {
console.warn(
`[what] derived() for "${key}" should accept the state parameter, e.g. derived(state => ...).`
);
}
computeds[key] = value;
} else if (typeof value === 'function') {
actions[key] = value;
} else {
signals[key] = signal(value);
}
}
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
let _atomWarned = false;
export function atom(initial) {
if (!_atomWarned) {
_atomWarned = true;
console.warn('[what] atom() is deprecated. Use signal() directly instead.');
}
return signal(initial);
}