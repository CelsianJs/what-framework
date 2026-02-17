import { h } from './h.js';
import { signal, effect, untrack, __DEV__ } from './reactive.js';
export function memo(Component, areEqual) {
const compare = areEqual || shallowEqual;
function MemoWrapper(props) {
const ctx = _getCurrentComponent?.();
if (ctx && ctx._memoResult !== undefined) {
if (props === ctx._memoPropsRef) {
} else if (compare(ctx._memoProps, props)) {
ctx._memoPropsRef = props;
return ctx._memoResult;
}
}
if (ctx) {
ctx._memoPropsRef = props;
ctx._memoProps = { ...props };
}
const result = Component(props);
if (ctx) ctx._memoResult = result;
return result;
}
MemoWrapper.displayName = `Memo(${Component.name || 'Anonymous'})`;
return MemoWrapper;
}
let _getCurrentComponent = null;
export function _injectGetCurrentComponent(fn) { _getCurrentComponent = fn; }
function shallowEqual(a, b) {
if (a === b) return true;
const keysA = Object.keys(a);
const keysB = Object.keys(b);
if (keysA.length !== keysB.length) return false;
for (const key of keysA) {
if (!Object.is(a[key], b[key])) return false;
}
return true;
}
export function lazy(loader) {
let Component = null;
let loadPromise = null;
let loadError = null;
const listeners = new Set();
function LazyWrapper(props) {
if (loadError) throw loadError;
if (Component) return h(Component, props);
if (!loadPromise) {
loadPromise = loader()
.then(mod => {
Component = mod.default || mod;
listeners.forEach(fn => fn());
listeners.clear();
})
.catch(err => { loadError = err; });
}
throw loadPromise;
}
LazyWrapper.displayName = 'Lazy';
LazyWrapper._lazy = true;
LazyWrapper._onLoad = (fn) => {
if (Component) fn();
else listeners.add(fn);
};
return LazyWrapper;
}
export function Suspense({ fallback, children }) {
const loading = signal(false);
const pendingPromises = new Set();
const boundary = {
_suspense: true,
onSuspend(promise) {
loading.set(true);
pendingPromises.add(promise);
promise.finally(() => {
pendingPromises.delete(promise);
if (pendingPromises.size === 0) {
loading.set(false);
}
});
},
};
return {
tag: '__suspense',
props: { boundary, fallback, loading },
children: Array.isArray(children) ? children : [children],
_vnode: true,
};
}
export function ErrorBoundary({ fallback, children, onError }) {
const errorState = signal(null);
const handleError = (error) => {
errorState.set(error);
if (onError) {
try {
onError(error);
} catch (e) {
console.error('Error in onError handler:', e);
}
}
};
const reset = () => errorState.set(null);
return {
tag: '__errorBoundary',
props: { errorState, handleError, fallback, reset },
children: Array.isArray(children) ? children : [children],
_vnode: true,
};
}
export function reportError(error, startCtx) {
let ctx = startCtx || _getCurrentComponent?.();
while (ctx) {
if (ctx._errorBoundary) {
ctx._errorBoundary(error);
return true;
}
ctx = ctx._parentCtx;
}
return false;
}
export function Show({ when, fallback = null, children }) {
const condition = typeof when === 'function' ? when() : when;
return condition ? children : fallback;
}
export function For({ each, fallback = null, children }) {
const list = typeof each === 'function' ? each() : each;
if (!list || list.length === 0) return fallback;
const renderFn = Array.isArray(children) ? children[0] : children;
if (typeof renderFn !== 'function') {
console.warn('[what] For: children must be a render function, e.g. <For each={items}>{(item) => ...}</For>');
return fallback;
}
return list.map((item, index) => {
const vnode = renderFn(item, index);
if (vnode && typeof vnode === 'object' && vnode.key == null) {
if (item != null && typeof item === 'object') {
if (item.id != null) vnode.key = item.id;
else if (item.key != null) vnode.key = item.key;
} else if (typeof item === 'string' || typeof item === 'number') {
vnode.key = item;
}
}
return vnode;
});
}
export function Switch({ fallback = null, children }) {
const kids = Array.isArray(children) ? children : [children];
for (const child of kids) {
if (child && child.tag === Match) {
const condition = typeof child.props.when === 'function'
? child.props.when()
: child.props.when;
if (condition) {
return child.children;
}
}
}
return fallback;
}
export function Match({ when, children }) {
return { tag: Match, props: { when }, children, _vnode: true };
}
export function Island({ component: Component, mode, mediaQuery, ...props }) {
const placeholder = h('div', { 'data-island': Component.name || 'Island', 'data-hydrate': mode });
const wrapper = signal(null);
const hydrated = signal(false);
function doHydrate() {
if (hydrated()) return;
hydrated.set(true);
wrapper.set(h(Component, props));
}
function scheduleHydration(el) {
switch (mode) {
case 'load':
queueMicrotask(doHydrate);
break;
case 'idle':
if (typeof requestIdleCallback !== 'undefined') {
requestIdleCallback(doHydrate);
} else {
setTimeout(doHydrate, 200);
}
break;
case 'visible': {
const observer = new IntersectionObserver((entries) => {
if (entries[0].isIntersecting) {
observer.disconnect();
doHydrate();
}
});
observer.observe(el);
break;
}
case 'interaction': {
const hydrate = () => {
el.removeEventListener('click', hydrate);
el.removeEventListener('focus', hydrate);
el.removeEventListener('mouseenter', hydrate);
doHydrate();
};
el.addEventListener('click', hydrate, { once: true });
el.addEventListener('focus', hydrate, { once: true });
el.addEventListener('mouseenter', hydrate, { once: true });
break;
}
case 'media': {
if (!mediaQuery) { doHydrate(); break; }
const mq = window.matchMedia(mediaQuery);
if (mq.matches) {
queueMicrotask(doHydrate);
} else {
const checkMedia = () => {
if (mq.matches) {
mq.removeEventListener('change', checkMedia);
doHydrate();
}
};
mq.addEventListener('change', checkMedia);
}
break;
}
default:
queueMicrotask(doHydrate);
}
}
const refCallback = (el) => {
if (el) scheduleHydration(el);
};
return h('div', { 'data-island': Component.name || 'Island', 'data-hydrate': mode, ref: refCallback },
hydrated() ? wrapper() : null
);
}