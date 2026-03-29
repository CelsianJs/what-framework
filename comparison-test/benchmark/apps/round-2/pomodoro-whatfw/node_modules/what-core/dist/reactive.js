export const __DEV__ = typeof process !== 'undefined'
? process.env?.NODE_ENV !== 'production'
: true;
export let __devtools = null;
export function __setDevToolsHooks(hooks) {
if (__DEV__) __devtools = hooks;
}
let currentEffect = null;
let currentRoot = null;
let currentOwner = null;  
let batchDepth = 0;
let pendingEffects = [];
const subSetOwner = new WeakMap();
const NEEDS_UPSTREAM = Symbol('needs_upstream');
let iterativeEvalStack = null;  
export function signal(initial, debugName) {
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
if (__DEV__ && __devtools) __devtools.onSignalUpdate(sig);
notify(subs);
}
sig.set = (next) => {
const nextVal = typeof next === 'function' ? next(value) : next;
if (Object.is(value, nextVal)) return;
value = nextVal;
if (__DEV__ && __devtools) __devtools.onSignalUpdate(sig);
notify(subs);
};
sig.peek = () => value;
sig.subscribe = (fn) => {
return effect(() => fn(sig()));
};
sig._signal = true;
if (__DEV__) {
sig._subs = subs;
if (debugName) sig._debugName = debugName;
}
if (__DEV__ && __devtools) __devtools.onSignalCreate(sig);
return sig;
}
export function computed(fn) {
let value, dirty = true;
const subs = new Set();
const inner = _createEffect(() => {
value = fn();
dirty = false;
}, true);
inner._level = 1;
inner._computed = true;
inner._computedSubs = subs;
subSetOwner.set(subs, inner);
inner._markDirty = () => { dirty = true; };
inner._isDirty = () => dirty;
function read() {
if (currentEffect) {
subs.add(currentEffect);
currentEffect.deps.push(subs);
}
if (dirty) _evaluateComputed(inner);
return value;
}
inner._onNotify = () => {
dirty = true;
notify(subs);
};
read._signal = true;
read.peek = () => {
if (dirty) _evaluateComputed(inner);
return value;
};
return read;
}
function _evaluateComputed(computedEffect) {
if (iterativeEvalStack !== null) {
iterativeEvalStack.push(computedEffect);
throw NEEDS_UPSTREAM;
}
const stack = [computedEffect];
iterativeEvalStack = stack;
try {
while (stack.length > 0) {
const current = stack[stack.length - 1];
if (!current._isDirty || !current._isDirty()) {
stack.pop();
continue;
}
try {
_runEffect(current);
_updateLevel(current);
stack.pop(); 
} catch (err) {
if (err === NEEDS_UPSTREAM) {
current._markDirty();
} else {
throw err; 
}
}
}
} finally {
iterativeEvalStack = null;
}
}
function _updateLevel(e) {
let maxDepLevel = 0;
for (let i = 0; i < e.deps.length; i++) {
const owner = subSetOwner.get(e.deps[i]);
const depLevel = owner ? owner._level : 0;
if (depLevel > maxDepLevel) maxDepLevel = depLevel;
}
e._level = maxDepLevel + 1;
}
export function effect(fn, opts) {
const e = _createEffect(fn);
e._level = 1;
const prev = currentEffect;
currentEffect = e;
try {
const result = e.fn();
if (typeof result === 'function') e._cleanup = result;
} finally {
currentEffect = prev;
}
_updateEffectLevel(e);
if (opts?.stable) e._stable = true;
const dispose = () => _disposeEffect(e);
if (currentRoot) {
currentRoot.disposals.push(dispose);
}
return dispose;
}
function _updateEffectLevel(e) {
let maxDepLevel = 0;
for (let i = 0; i < e.deps.length; i++) {
const owner = subSetOwner.get(e.deps[i]);
const depLevel = owner ? owner._level : 0;
if (depLevel > maxDepLevel) maxDepLevel = depLevel;
}
e._level = maxDepLevel + 1;
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
const e = {
fn,
deps: [],            
lazy: lazy || false,
_onNotify: null,
disposed: false,
_pending: false,
_stable: false,      
_level: 0,           
_computed: false,     
_computedSubs: null,  
_isDirty: null,       
_markDirty: null,     
};
if (__DEV__ && __devtools) __devtools.onEffectCreate(e);
return e;
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
} catch (err) {
if (__devtools?.onError) __devtools.onError(err, { type: 'effect', effect: e });
if (__DEV__) console.warn('[what] Error in stable effect:', err);
} finally {
currentEffect = prev;
}
if (__DEV__ && __devtools?.onEffectRun) __devtools.onEffectRun(e);
return;
}
cleanup(e);
if (e._cleanup) {
try { e._cleanup(); } catch (err) {
if (__devtools?.onError) __devtools.onError(err, { type: 'effect-cleanup', effect: e });
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
} catch (err) {
if (err === NEEDS_UPSTREAM) throw err; 
if (__devtools?.onError) __devtools.onError(err, { type: 'effect', effect: e });
throw err;
} finally {
currentEffect = prev;
}
if (__DEV__ && __devtools?.onEffectRun) __devtools.onEffectRun(e);
}
function _disposeEffect(e) {
e.disposed = true;
if (__DEV__ && __devtools) __devtools.onEffectDispose(e);
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
let notifyQueue = null;  
function notify(subs) {
const isOutermost = notifyQueue === null;
if (isOutermost) notifyQueue = [];
notifyQueue.push(subs);
if (!isOutermost) return; 
try {
while (notifyQueue.length > 0) {
const currentSubs = notifyQueue.shift();
for (const e of currentSubs) {
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
if (__devtools?.onError) __devtools.onError(err, { type: 'effect', effect: e });
if (__DEV__) console.warn('[what] Error in stable effect:', err);
} finally {
currentEffect = prev;
}
} else if (!e._pending) {
e._pending = true;
pendingEffects.push(e);
}
}
}
} finally {
notifyQueue = null;
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
while (pendingEffects.length > 0 && iterations < 25) {
const batch = pendingEffects;
pendingEffects = [];
batch.sort((a, b) => a._level - b._level);
for (let i = 0; i < batch.length; i++) {
const e = batch[i];
e._pending = false;
if (!e.disposed && !e._onNotify) {
_runEffect(e);
if (!e._computed) _updateEffectLevel(e);
}
}
iterations++;
}
if (iterations >= 25) {
if (__DEV__) {
const remaining = pendingEffects.slice(0, 3);
const effectNames = remaining.map(e => e.fn?.name || e.fn?.toString().slice(0, 60) || '(anonymous)');
console.warn(
`[what] Possible infinite effect loop detected (25 iterations). ` +
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
e._level = 1;
_runEffect(e);
_updateEffectLevel(e);
subSetOwner.set(subs, e);
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
export function getOwner() {
return currentOwner;
}
export function runWithOwner(owner, fn) {
const prev = currentOwner;
const prevRoot = currentRoot;
currentOwner = owner;
currentRoot = owner;
try {
return fn();
} finally {
currentOwner = prev;
currentRoot = prevRoot;
}
}
export function createRoot(fn) {
const prevRoot = currentRoot;
const prevOwner = currentOwner;
const root = {
disposals: [],
owner: currentOwner,     
children: [],            
_disposed: false,
};
if (currentOwner) {
currentOwner.children.push(root);
}
currentRoot = root;
currentOwner = root;
try {
const dispose = () => {
if (root._disposed) return;
root._disposed = true;
for (let i = root.children.length - 1; i >= 0; i--) {
_disposeRoot(root.children[i]);
}
root.children.length = 0;
for (let i = root.disposals.length - 1; i >= 0; i--) {
root.disposals[i]();
}
root.disposals.length = 0;
if (root.owner) {
const idx = root.owner.children.indexOf(root);
if (idx >= 0) root.owner.children.splice(idx, 1);
}
};
return fn(dispose);
} finally {
currentRoot = prevRoot;
currentOwner = prevOwner;
}
}
function _disposeRoot(root) {
if (root._disposed) return;
root._disposed = true;
for (let i = root.children.length - 1; i >= 0; i--) {
_disposeRoot(root.children[i]);
}
root.children.length = 0;
for (let i = root.disposals.length - 1; i >= 0; i--) {
root.disposals[i]();
}
root.disposals.length = 0;
}
export function onCleanup(fn) {
if (currentRoot) {
currentRoot.disposals.push(fn);
}
}