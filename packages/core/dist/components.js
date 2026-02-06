import { h } from './h.js';
export function memo(Component, areEqual) {
const compare = areEqual || shallowEqual;
let prevProps = null;
let prevResult = null;
function MemoWrapper(props) {
if (prevProps && compare(prevProps, props)) {
return prevResult;
}
prevProps = { ...props };
prevResult = Component(props);
return prevResult;
}
MemoWrapper.displayName = `Memo(${Component.name || 'Anonymous'})`;
return MemoWrapper;
}
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
let promise = null;
let error = null;
function LazyWrapper(props) {
if (error) throw error;
if (Component) return h(Component, props);
if (!promise) {
promise = loader()
.then(mod => { Component = mod.default || mod; })
.catch(err => { error = err; });
}
throw promise; 
}
LazyWrapper.displayName = 'Lazy';
return LazyWrapper;
}
export function Suspense({ fallback, children }) {
try {
return children;
} catch (thrown) {
if (thrown instanceof Promise) {
thrown.then(() => {
});
return fallback;
}
throw thrown;
}
}
export function ErrorBoundary({ fallback, children }) {
try {
return children;
} catch (err) {
if (typeof fallback === 'function') return fallback({ error: err });
return fallback;
}
}