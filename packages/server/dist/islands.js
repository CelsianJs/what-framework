import { mount, signal, batch } from 'what-core';
const islandRegistry = new Map();
const hydratedIslands = new Set();
const hydrationQueue = [];
let isProcessingQueue = false;
const sharedStores = new Map();
export function createIslandStore(name, initialState) {
if (sharedStores.has(name)) {
return sharedStores.get(name);
}
const store = {};
const signals = {};
for (const [key, value] of Object.entries(initialState)) {
signals[key] = signal(value);
Object.defineProperty(store, key, {
get: () => signals[key](),
set: (val) => signals[key].set(val),
enumerable: true,
});
}
store._signals = signals;
store._subscribe = (key, fn) => {
if (signals[key]) {
return signals[key].subscribe(fn);
}
};
store._batch = (fn) => batch(fn);
store._getSnapshot = () => {
const snapshot = {};
for (const [key, sig] of Object.entries(signals)) {
snapshot[key] = sig.peek();
}
return snapshot;
};
store._hydrate = (data) => {
batch(() => {
for (const [key, value] of Object.entries(data)) {
if (signals[key]) {
signals[key].set(value);
}
}
});
};
sharedStores.set(name, store);
return store;
}
export function useIslandStore(name, fallbackInitial = {}) {
if (sharedStores.has(name)) {
return sharedStores.get(name);
}
return createIslandStore(name, fallbackInitial);
}
export function serializeIslandStores() {
const data = {};
for (const [name, store] of sharedStores) {
data[name] = store._getSnapshot();
}
return JSON.stringify(data);
}
export function hydrateIslandStores(serialized) {
try {
const data = typeof serialized === 'string' ? JSON.parse(serialized) : serialized;
for (const [name, storeData] of Object.entries(data)) {
const store = useIslandStore(name, storeData);
store._hydrate(storeData);
}
} catch (e) {
console.warn('[what] Failed to hydrate island stores:', e);
}
}
export function island(name, loader, opts = {}) {
islandRegistry.set(name, {
loader,  
mode: opts.mode || 'idle',
media: opts.media || null,
priority: opts.priority || 0, 
stores: opts.stores || [],    
});
}
export function Island({ name, props = {}, children, mode, priority, stores }) {
const entry = islandRegistry.get(name);
const resolvedMode = mode || entry?.mode || 'idle';
const resolvedPriority = priority ?? entry?.priority ?? 0;
const resolvedStores = stores || entry?.stores || [];
return {
tag: 'div',
props: {
'data-island': name,
'data-island-mode': resolvedMode,
'data-island-props': JSON.stringify(props),
'data-island-priority': resolvedPriority,
'data-island-stores': JSON.stringify(resolvedStores),
},
children: children || [],
key: null,
_vnode: true,
};
}
function enqueueHydration(task) {
let inserted = false;
for (let i = 0; i < hydrationQueue.length; i++) {
if (task.priority > hydrationQueue[i].priority) {
hydrationQueue.splice(i, 0, task);
inserted = true;
break;
}
}
if (!inserted) {
hydrationQueue.push(task);
}
processQueue();
}
function processQueue() {
if (isProcessingQueue || hydrationQueue.length === 0) return;
isProcessingQueue = true;
const task = hydrationQueue.shift();
Promise.resolve(task.hydrate())
.catch(e => console.error('[what] Island hydration failed:', task.name, e))
.finally(() => {
isProcessingQueue = false;
queueMicrotask(processQueue);
});
}
export function boostIslandPriority(name, newPriority = 100) {
for (const task of hydrationQueue) {
if (task.name === name) {
task.priority = newPriority;
hydrationQueue.sort((a, b) => b.priority - a.priority);
break;
}
}
}
export function hydrateIslands() {
const storeScript = document.querySelector('script[data-island-stores]');
if (storeScript) {
hydrateIslandStores(storeScript.textContent);
}
const islands = document.querySelectorAll('[data-island]');
for (const el of islands) {
const name = el.dataset.island;
const mode = el.dataset.islandMode || 'idle';
const props = JSON.parse(el.dataset.islandProps || '{}');
const priority = parseInt(el.dataset.islandPriority || '0', 10);
const stores = JSON.parse(el.dataset.islandStores || '[]');
const entry = islandRegistry.get(name);
if (!entry) {
console.warn(`[what] Island "${name}" not registered`);
continue;
}
if (hydratedIslands.has(el)) continue;
scheduleHydration(el, entry, props, mode, priority, name, stores);
}
}
function scheduleHydration(el, entry, props, mode, priority, name, stores) {
const hydrate = async () => {
if (hydratedIslands.has(el)) return;
hydratedIslands.add(el);
const mod = await entry.loader();
const Component = mod.default || mod;
const storeProps = {};
for (const storeName of stores) {
storeProps[storeName] = useIslandStore(storeName);
}
mount(Component({ ...props, ...storeProps }), el);
el.removeAttribute('data-island');
el.removeAttribute('data-island-mode');
el.removeAttribute('data-island-props');
el.removeAttribute('data-island-priority');
el.removeAttribute('data-island-stores');
el.dispatchEvent(new CustomEvent('island:hydrated', {
bubbles: true,
detail: { name, mode },
}));
};
switch (mode) {
case 'load':
enqueueHydration({ name, priority: priority + 1000, hydrate });
break;
case 'idle':
if ('requestIdleCallback' in window) {
requestIdleCallback(() => {
enqueueHydration({ name, priority, hydrate });
});
} else {
setTimeout(() => {
enqueueHydration({ name, priority, hydrate });
}, 200);
}
break;
case 'visible': {
const observer = new IntersectionObserver((entries, obs) => {
for (const entry of entries) {
if (entry.isIntersecting) {
obs.disconnect();
enqueueHydration({ name, priority, hydrate });
break;
}
}
}, { rootMargin: '200px' });
observer.observe(el);
break;
}
case 'media': {
const mq = window.matchMedia(entry.media || '(max-width: 768px)');
if (mq.matches) {
enqueueHydration({ name, priority, hydrate });
} else {
mq.addEventListener('change', (e) => {
if (e.matches) {
enqueueHydration({ name, priority, hydrate });
}
}, { once: true });
}
break;
}
case 'action': {
const events = ['click', 'focus', 'mouseover', 'touchstart'];
const handler = () => {
events.forEach(e => el.removeEventListener(e, handler));
enqueueHydration({ name, priority: priority + 500, hydrate });
};
events.forEach(e => el.addEventListener(e, handler, { once: true, passive: true }));
break;
}
case 'static':
break;
default:
enqueueHydration({ name, priority, hydrate });
}
}
export function autoIslands(registry) {
for (const [name, config] of Object.entries(registry)) {
island(name, config.loader || config, {
mode: config.mode || 'idle',
media: config.media,
priority: config.priority || 0,
stores: config.stores || [],
});
}
if (typeof document !== 'undefined') {
if (document.readyState === 'loading') {
document.addEventListener('DOMContentLoaded', hydrateIslands);
} else {
hydrateIslands();
}
}
}
export function enhance(selector, handler) {
if (typeof document === 'undefined') return;
const elements = document.querySelectorAll(selector);
for (const el of elements) {
if (el.dataset.enhanced) continue;
el.dataset.enhanced = 'true';
handler(el);
}
}
export function enhanceForms(selector = 'form[data-enhance]') {
enhance(selector, (form) => {
form.addEventListener('submit', async (e) => {
e.preventDefault();
const formData = new FormData(form);
const method = form.method.toUpperCase() || 'POST';
const action = form.action || location.href;
try {
const response = await fetch(action, {
method,
body: method === 'GET' ? undefined : formData,
headers: {
'X-Requested-With': 'XMLHttpRequest',
},
});
form.dispatchEvent(new CustomEvent('form:response', {
bubbles: true,
detail: { response, ok: response.ok },
}));
} catch (error) {
form.dispatchEvent(new CustomEvent('form:error', {
bubbles: true,
detail: { error },
}));
}
});
});
}
export function getIslandStatus() {
const status = {
registered: [...islandRegistry.keys()],
hydrated: hydratedIslands.size,
pending: hydrationQueue.length,
queue: hydrationQueue.map(t => ({ name: t.name, priority: t.priority })),
stores: [...sharedStores.keys()],
};
return status;
}