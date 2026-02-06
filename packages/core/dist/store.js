import { signal, computed, batch } from './reactive.js';
export function createStore(definition) {
const signals = {};
const computeds = {};
const actions = {};
const state = {};
for (const [key, value] of Object.entries(definition)) {
if (typeof value === 'function' && value.length > 0 && key !== 'constructor') {
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
export function atom(initial) {
return signal(initial);
}