let currentEffect = null;
let batchDepth = 0;
let pendingEffects = new Set();
export function signal(initial) {
let value = initial;
const subs = new Set();
function read() {
if (currentEffect) {
subs.add(currentEffect);
currentEffect.deps.add(subs); 
}
return value;
}
read.set = (next) => {
const nextVal = typeof next === 'function' ? next(value) : next;
if (Object.is(value, nextVal)) return;
value = nextVal;
notify(subs);
};
read.peek = () => value;
read.subscribe = (fn) => {
return effect(() => fn(read()));
};
read._signal = true;
return read;
}
export function computed(fn) {
let value, dirty = true;
const subs = new Set();
const inner = _createEffect(() => {
value = fn();
dirty = false;
notify(subs);
}, { lazy: true });
function read() {
if (currentEffect) {
subs.add(currentEffect);
currentEffect.deps.add(subs);
}
if (dirty) _runEffect(inner);
return value;
}
inner._onNotify = () => { dirty = true; };
read._signal = true;
read.peek = () => {
if (dirty) _runEffect(inner);
return value;
};
return read;
}
export function effect(fn) {
const e = _createEffect(fn);
_runEffect(e);
return () => _disposeEffect(e);
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
function _createEffect(fn, opts = {}) {
return {
fn,
deps: new Set(),     
lazy: opts.lazy || false,
_onNotify: null,
disposed: false,
};
}
function _runEffect(e) {
if (e.disposed) return;
cleanup(e);
const prev = currentEffect;
currentEffect = e;
try {
e.fn();
} finally {
currentEffect = prev;
}
}
function _disposeEffect(e) {
e.disposed = true;
cleanup(e);
}
function cleanup(e) {
for (const dep of e.deps) dep.delete(e);
e.deps.clear();
}
function notify(subs) {
const snapshot = [...subs];
for (const e of snapshot) {
if (e.disposed) continue;
if (e._onNotify) {
e._onNotify();
if (batchDepth > 0) pendingEffects.add(e);
continue;
}
if (batchDepth > 0) {
pendingEffects.add(e);
} else {
_runEffect(e);
}
}
}
function flush() {
const effects = [...pendingEffects];
pendingEffects.clear();
for (const e of effects) {
if (!e.disposed && !e._onNotify) _runEffect(e);
}
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