import { signal, effect, computed, batch } from './reactive.js';
export function show(condition, vnode, fallback = null) {
return condition ? vnode : fallback;
}
export function each(list, fn, keyFn) {
if (!list || list.length === 0) return [];
return list.map((item, index) => {
const vnode = fn(item, index);
if (keyFn && vnode && typeof vnode === 'object') {
vnode.key = keyFn(item, index);
}
return vnode;
});
}
export function cls(...args) {
const classes = [];
for (const arg of args) {
if (!arg) continue;
if (typeof arg === 'string') {
classes.push(arg);
} else if (typeof arg === 'object') {
for (const [key, val] of Object.entries(arg)) {
if (val) classes.push(key);
}
}
}
return classes.join(' ');
}
export function style(obj) {
if (typeof obj === 'string') return obj;
return Object.entries(obj)
.filter(([, v]) => v != null && v !== '')
.map(([k, v]) => `${camelToKebab(k)}:${v}`)
.join(';');
}
function camelToKebab(str) {
return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}
export function debounce(fn, ms) {
let timer;
return (...args) => {
clearTimeout(timer);
timer = setTimeout(() => fn(...args), ms);
};
}
export function throttle(fn, ms) {
let last = 0;
return (...args) => {
const now = Date.now();
if (now - last >= ms) {
last = now;
fn(...args);
}
};
}
export function useMediaQuery(query) {
if (typeof window === 'undefined') return signal(false);
const mq = window.matchMedia(query);
const s = signal(mq.matches);
mq.addEventListener('change', (e) => s.set(e.matches));
return s;
}
export function useLocalStorage(key, initial) {
let stored;
try {
const raw = localStorage.getItem(key);
stored = raw !== null ? JSON.parse(raw) : initial;
} catch {
stored = initial;
}
const s = signal(stored);
effect(() => {
try {
localStorage.setItem(key, JSON.stringify(s()));
} catch {  }
});
if (typeof window !== 'undefined') {
window.addEventListener('storage', (e) => {
if (e.key === key && e.newValue !== null) {
try { s.set(JSON.parse(e.newValue)); } catch {}
}
});
}
return s;
}
export function Portal({ target, children }) {
if (typeof document === 'undefined') return null;
const container = typeof target === 'string'
? document.querySelector(target)
: target;
if (!container) return null;
return { tag: '__portal', props: { container }, children: Array.isArray(children) ? children : [children], _vnode: true };
}
export function transition(name, active) {
return {
class: active ? `${name}-enter ${name}-enter-active` : `${name}-leave ${name}-leave-active`,
};
}