import { signal, effect, __DEV__ } from './reactive.js';
let _eachWarned = false;
export function each(list, fn, keyFn) {
if (!_eachWarned) {
_eachWarned = true;
console.warn('[what] each() is deprecated. Use the <For> component or Array.map() instead.');
}
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
let _getCurrentComponentRef = null;
export function _setComponentRef(fn) { _getCurrentComponentRef = fn; }
export function useMediaQuery(query) {
if (typeof window === 'undefined') return signal(false);
const mq = window.matchMedia(query);
const s = signal(mq.matches);
const handler = (e) => s.set(e.matches);
mq.addEventListener('change', handler);
const ctx = _getCurrentComponentRef?.();
if (ctx) {
ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
ctx._cleanupCallbacks.push(() => mq.removeEventListener('change', handler));
}
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
const dispose = effect(() => {
try {
localStorage.setItem(key, JSON.stringify(s()));
} catch (e) {
if (__DEV__) console.warn('[what] localStorage write failed (quota exceeded?):', e);
}
});
let storageHandler = null;
if (typeof window !== 'undefined') {
storageHandler = (e) => {
if (e.key === key && e.newValue !== null) {
try { s.set(JSON.parse(e.newValue)); } catch (err) {
if (__DEV__) console.warn('[what] localStorage parse failed:', err);
}
}
};
window.addEventListener('storage', storageHandler);
}
const ctx = _getCurrentComponentRef?.();
if (ctx) {
ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
ctx._cleanupCallbacks.push(() => {
dispose();
if (storageHandler) window.removeEventListener('storage', storageHandler);
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
export function useClickOutside(ref, handler) {
if (typeof document === 'undefined') return;
const listener = (e) => {
const el = ref.current || ref;
if (!el || el.contains(e.target)) return;
handler(e);
};
document.addEventListener('mousedown', listener);
document.addEventListener('touchstart', listener);
const ctx = _getCurrentComponentRef?.();
if (ctx) {
ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
ctx._cleanupCallbacks.push(() => {
document.removeEventListener('mousedown', listener);
document.removeEventListener('touchstart', listener);
});
}
}
export function transition(name, active) {
return {
class: active ? `${name}-enter ${name}-enter-active` : `${name}-leave ${name}-leave-active`,
};
}