export const __DEV__ = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production' || true;
let currentEffect = null;
let currentRoot = null;
let batchDepth = 0;
let pendingEffects = [];
export function signal(initial) {
let value = initial;
const subs = new Set();
function sig(...args) {
if (args.length === 0) {
if (currentEffect) {
subs.add(currentEffect);
currentEffect.deps.push(subs);
}
return value;
}
const nextVal = typeof args[0] === 'function' ? args[0](value) : args[0];
if (Object.is(value, nextVal)) return;
value = nextVal;
notify(subs);
}
sig.set = (next) => {
const nextVal = typeof next === 'function' ? next(value) : next;
if (Object.is(value, nextVal)) return;
value = nextVal;
notify(subs);
};
sig.peek = () => value;
sig.subscribe = (fn) => {
return effect(() => fn(sig()));
};
sig._signal = true;
return sig;
}
export function computed(fn) {
let value, dirty = true;
const subs = new Set();
const inner = _createEffect(() => {
value = fn();
dirty = false;
}, true);
function read() {
if (currentEffect) {
subs.add(currentEffect);
currentEffect.deps.push(subs);
}
if (dirty) _runEffect(inner);
return value;
}
inner._onNotify = () => {
dirty = true;
notify(subs);
};
read._signal = true;
read.peek = () => {
if (dirty) _runEffect(inner);
return value;
};
return read;
}
export function effect(fn, opts) {
const e = _createEffect(fn);
const prev = currentEffect;
currentEffect = e;
try {
const result = e.fn();
if (typeof result === 'function') e._cleanup = result;
} finally {
currentEffect = prev;
}
if (opts?.stable) e._stable = true;
const dispose = () => _disposeEffect(e);
if (currentRoot) {
currentRoot.disposals.push(dispose);
}
return dispose;
}
export function batch(fn) {
batchDepth++;
try {
fn();
} finally {
batchDepth--;
if (batchDepth === 0) flush();
}
}
function _createEffect(fn, lazy) {
return {
fn,
deps: [],            
lazy: lazy || false,
_onNotify: null,
disposed: false,
_pending: false,
_stable: false,      
};
}
function _runEffect(e) {
if (e.disposed) return;
if (e._stable) {
if (e._cleanup) {
try { e._cleanup(); } catch (err) {
if (__DEV__) console.warn('[what] Error in effect cleanup:', err);
}
e._cleanup = null;
}
const prev = currentEffect;
currentEffect = null; 
try {
const result = e.fn();
if (typeof result === 'function') e._cleanup = result;
} finally {
currentEffect = prev;
}
return;
}
cleanup(e);
if (e._cleanup) {
try { e._cleanup(); } catch (err) {
if (__DEV__) console.warn('[what] Error in effect cleanup:', err);
}
e._cleanup = null;
}
const prev = currentEffect;
currentEffect = e;
try {
const result = e.fn();
if (typeof result === 'function') {
e._cleanup = result;
}
} finally {
currentEffect = prev;
}
}
function _disposeEffect(e) {
e.disposed = true;
cleanup(e);
if (e._cleanup) {
try { e._cleanup(); } catch (err) {
if (__DEV__) console.warn('[what] Error in effect cleanup on dispose:', err);
}
e._cleanup = null;
}
}
function cleanup(e) {
const deps = e.deps;
for (let i = 0; i < deps.length; i++) deps[i].delete(e);
deps.length = 0;
}
function notify(subs) {
for (const e of subs) {
if (e.disposed) continue;
if (e._onNotify) {
e._onNotify();
} else if (batchDepth === 0 && e._stable) {
const prev = currentEffect;
currentEffect = null;
try {
const result = e.fn();
if (typeof result === 'function') {
if (e._cleanup) try { e._cleanup(); } catch (err) {}
e._cleanup = result;
}
} catch (err) {
if (__DEV__) console.warn('[what] Error in stable effect:', err);
} finally {
currentEffect = prev;
}
} else if (!e._pending) {
e._pending = true;
pendingEffects.push(e);
}
}
if (batchDepth === 0 && pendingEffects.length > 0) scheduleMicrotask();
}
let microtaskScheduled = false;
function scheduleMicrotask() {
if (!microtaskScheduled) {
microtaskScheduled = true;
queueMicrotask(() => {
microtaskScheduled = false;
flush();
});
}
}
function flush() {
let iterations = 0;
while (pendingEffects.length > 0 && iterations < 100) {
const batch = pendingEffects;
pendingEffects = [];
for (let i = 0; i < batch.length; i++) {
const e = batch[i];
e._pending = false;
if (!e.disposed && !e._onNotify) _runEffect(e);
}
iterations++;
}
if (iterations >= 100) {
if (__DEV__) {
const remaining = pendingEffects.slice(0, 3);
const effectNames = remaining.map(e => e.fn?.name || e.fn?.toString().slice(0, 60) || '(anonymous)');
console.warn(
`[what] Possible infinite effect loop detected (100 iterations). ` +
`Likely cause: an effect writes to a signal it also reads, creating a cycle. ` +
`Use untrack() to read signals without subscribing. ` +
`Looping effects: ${effectNames.join(', ')}`
);
} else {
console.warn('[what] Possible infinite effect loop detected');
}
for (let i = 0; i < pendingEffects.length; i++) pendingEffects[i]._pending = false;
pendingEffects.length = 0;
}
}
export function memo(fn) {
let value;
const subs = new Set();
const e = _createEffect(() => {
const next = fn();
if (!Object.is(value, next)) {
value = next;
notify(subs);
}
});
_runEffect(e);
if (currentRoot) {
currentRoot.disposals.push(() => _disposeEffect(e));
}
function read() {
if (currentEffect) {
subs.add(currentEffect);
currentEffect.deps.push(subs);
}
return value;
}
read._signal = true;
read.peek = () => value;
return read;
}
export function flushSync() {
microtaskScheduled = false;
flush();
}
export function untrack(fn) {
const prev = currentEffect;
currentEffect = null;
try {
return fn();
} finally {
currentEffect = prev;
}
}
export function createRoot(fn) {
const prevRoot = currentRoot;
const root = { disposals: [], owner: currentRoot };
currentRoot = root;
try {
const dispose = () => {
for (let i = root.disposals.length - 1; i >= 0; i--) {
root.disposals[i]();
}
root.disposals.length = 0;
};
return fn(dispose);
} finally {
currentRoot = prevRoot;
}
}