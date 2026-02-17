import { effect, batch, untrack, signal } from './reactive.js';
import { reportError, _injectGetCurrentComponent } from './components.js';
import { _setComponentRef } from './helpers.js';
if (typeof customElements !== 'undefined' && !customElements.get('what-c')) {
customElements.define('what-c', class extends HTMLElement {
connectedCallback() {
this.style.display = 'contents';
}
});
}
const SVG_ELEMENTS = new Set([
'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
'g', 'defs', 'use', 'symbol', 'clipPath', 'mask', 'pattern', 'image',
'text', 'tspan', 'textPath', 'foreignObject', 'linearGradient', 'radialGradient', 'stop',
'marker', 'animate', 'animateTransform', 'animateMotion', 'set', 'filter',
'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
'feDiffuseLighting', 'feDisplacementMap', 'feFlood', 'feGaussianBlur', 'feImage',
'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'feSpecularLighting',
'feTile', 'feTurbulence',
]);
const SVG_NS = 'http://www.w3.org/2000/svg';
const mountedComponents = new Set();
function isDomNode(value) {
if (!value || typeof value !== 'object') return false;
if (typeof Node !== 'undefined' && value instanceof Node) return true;
return typeof value.nodeType === 'number' && typeof value.nodeName === 'string';
}
function isVNode(value) {
return !!value && typeof value === 'object' && (value._vnode === true || 'tag' in value);
}
function disposeComponent(ctx) {
if (ctx.disposed) return;
ctx.disposed = true;
for (const hook of ctx.hooks) {
if (hook && typeof hook === 'object' && 'cleanup' in hook && hook.cleanup) {
try { hook.cleanup(); } catch (e) { console.error('[what] cleanup error:', e); }
}
}
if (ctx._cleanupCallbacks) {
for (const fn of ctx._cleanupCallbacks) {
try { fn(); } catch (e) { console.error('[what] onCleanup error:', e); }
}
}
for (const dispose of ctx.effects) {
try { dispose(); } catch (e) {  }
}
mountedComponents.delete(ctx);
}
export function disposeTree(node) {
if (!node) return;
if (node._componentCtx) {
disposeComponent(node._componentCtx);
}
if (node._dispose) {
try { node._dispose(); } catch (e) {  }
}
if (node.childNodes) {
for (const child of node.childNodes) {
disposeTree(child);
}
}
}
export function mount(vnode, container) {
if (typeof container === 'string') {
container = document.querySelector(container);
}
disposeTree(container); 
container.textContent = '';
const node = createDOM(vnode, container);
if (node) container.appendChild(node);
return () => {
disposeTree(container);
container.textContent = '';
};
}
export function createDOM(vnode, parent, isSvg) {
if (vnode == null || vnode === false || vnode === true) {
return document.createComment('');
}
if (typeof vnode === 'string' || typeof vnode === 'number') {
return document.createTextNode(String(vnode));
}
if (isDomNode(vnode)) {
return vnode;
}
if (typeof vnode === 'function') {
const wrapper = document.createElement('what-c');
let mounted = false;
const dispose = effect(() => {
const val = vnode();
const vnodes = (val == null || val === false || val === true)
? []
: Array.isArray(val) ? val : [val];
if (!mounted) {
mounted = true;
for (const v of vnodes) {
const node = createDOM(v, wrapper, parent?._isSvg);
if (node) wrapper.appendChild(node);
}
} else {
reconcileChildren(wrapper, vnodes);
}
});
wrapper._dispose = dispose;
return wrapper;
}
if (Array.isArray(vnode)) {
const frag = document.createDocumentFragment();
for (const child of vnode) {
const node = createDOM(child, parent, isSvg);
if (node) frag.appendChild(node);
}
return frag;
}
if (!isVNode(vnode)) {
return document.createTextNode(String(vnode));
}
if (typeof vnode.tag === 'function') {
return createComponent(vnode, parent, isSvg);
}
const svgContext = isSvg || vnode.tag === 'svg' || SVG_ELEMENTS.has(vnode.tag);
const el = svgContext
? document.createElementNS(SVG_NS, vnode.tag)
: document.createElement(vnode.tag);
applyProps(el, vnode.props, {}, svgContext);
const hasRawHtml = vnode.props && (
Object.prototype.hasOwnProperty.call(vnode.props, 'dangerouslySetInnerHTML') ||
Object.prototype.hasOwnProperty.call(vnode.props, 'innerHTML')
);
if (!hasRawHtml) {
for (const child of vnode.children) {
const node = createDOM(child, el, svgContext && vnode.tag !== 'foreignObject');
if (node) el.appendChild(node);
}
}
el._vnode = vnode;
return el;
}
const componentStack = [];
export function getCurrentComponent() {
return componentStack[componentStack.length - 1];
}
_injectGetCurrentComponent(getCurrentComponent);
_setComponentRef(getCurrentComponent);
export function getComponentStack() {
return componentStack;
}
function createComponent(vnode, parent, isSvg) {
const { tag: Component, props, children } = vnode;
if (Component === '__errorBoundary' || vnode.tag === '__errorBoundary') {
return createErrorBoundary(vnode, parent);
}
if (Component === '__suspense' || vnode.tag === '__suspense') {
return createSuspenseBoundary(vnode, parent);
}
if (Component === '__portal' || vnode.tag === '__portal') {
return createPortal(vnode, parent);
}
const ctx = {
hooks: [],
hookIndex: 0,
effects: [],
cleanups: [],
mounted: false,
disposed: false,
Component, 
_parentCtx: componentStack[componentStack.length - 1] || null,
_errorBoundary: (() => {
let p = componentStack[componentStack.length - 1];
while (p) {
if (p._errorBoundary) return p._errorBoundary;
p = p._parentCtx;
}
return null;
})()
};
let wrapper;
if (isSvg) {
wrapper = document.createElementNS(SVG_NS, 'g');
} else {
wrapper = document.createElement('what-c');
}
wrapper._componentCtx = ctx;
wrapper._isSvg = !!isSvg;
ctx._wrapper = wrapper;
mountedComponents.add(ctx);
const propsSignal = signal({ ...props, children });
ctx._propsSignal = propsSignal;
const dispose = effect(() => {
if (ctx.disposed) return;
ctx.hookIndex = 0;
componentStack.push(ctx);
let result;
try {
result = Component(propsSignal());
} catch (error) {
componentStack.pop();
if (!reportError(error, ctx)) {
console.error('[what] Uncaught error in component:', Component.name || 'Anonymous', error);
throw error;
}
return;
}
componentStack.pop();
const vnodes = Array.isArray(result) ? result : [result];
if (!ctx.mounted) {
ctx.mounted = true;
if (ctx._mountCallbacks) {
queueMicrotask(() => {
if (ctx.disposed) return;
for (const fn of ctx._mountCallbacks) {
try { fn(); } catch (e) { console.error('[what] onMount error:', e); }
}
});
}
for (const v of vnodes) {
const node = createDOM(v, wrapper, isSvg);
if (node) wrapper.appendChild(node);
}
} else {
reconcileChildren(wrapper, vnodes);
}
});
ctx.effects.push(dispose);
wrapper._vnode = vnode; 
return wrapper;
}
function createErrorBoundary(vnode, parent) {
const { errorState, handleError, fallback, reset } = vnode.props;
const children = vnode.children;
const wrapper = document.createElement('what-c');
wrapper.style.display = 'contents';
const boundaryCtx = {
hooks: [], hookIndex: 0, effects: [], cleanups: [],
mounted: false, disposed: false,
_parentCtx: componentStack[componentStack.length - 1] || null,
_errorBoundary: handleError,
};
wrapper._componentCtx = boundaryCtx;
const dispose = effect(() => {
const error = errorState();
componentStack.push(boundaryCtx);
let vnodes;
if (error) {
vnodes = typeof fallback === 'function' ? [fallback({ error, reset })] : [fallback];
} else {
vnodes = children;
}
componentStack.pop();
vnodes = Array.isArray(vnodes) ? vnodes : [vnodes];
if (wrapper.childNodes.length === 0) {
for (const v of vnodes) {
const node = createDOM(v, wrapper);
if (node) wrapper.appendChild(node);
}
} else {
reconcileChildren(wrapper, vnodes);
}
});
boundaryCtx.effects.push(dispose);
return wrapper;
}
function createSuspenseBoundary(vnode, parent) {
const { boundary, fallback, loading } = vnode.props;
const children = vnode.children;
const wrapper = document.createElement('what-c');
wrapper.style.display = 'contents';
const boundaryCtx = {
hooks: [], hookIndex: 0, effects: [], cleanups: [],
mounted: false, disposed: false,
_parentCtx: componentStack[componentStack.length - 1] || null,
};
wrapper._componentCtx = boundaryCtx;
const dispose = effect(() => {
const isLoading = loading();
const vnodes = isLoading ? [fallback] : children;
const normalized = Array.isArray(vnodes) ? vnodes : [vnodes];
if (wrapper.childNodes.length === 0) {
for (const v of normalized) {
const node = createDOM(v, wrapper);
if (node) wrapper.appendChild(node);
}
} else {
reconcileChildren(wrapper, normalized);
}
});
boundaryCtx.effects.push(dispose);
return wrapper;
}
function createPortal(vnode, parent) {
const { container } = vnode.props;
const children = vnode.children;
if (!container) {
console.warn('[what] Portal: target container not found');
return document.createComment('portal:empty');
}
const portalCtx = {
hooks: [], hookIndex: 0, effects: [], cleanups: [],
mounted: false, disposed: false,
_parentCtx: componentStack[componentStack.length - 1] || null,
};
const placeholder = document.createComment('portal');
placeholder._componentCtx = portalCtx;
const portalNodes = [];
for (const child of children) {
const node = createDOM(child, container);
if (node) {
container.appendChild(node);
portalNodes.push(node);
}
}
portalCtx._cleanupCallbacks = [() => {
for (const node of portalNodes) {
disposeTree(node);
if (node.parentNode) node.parentNode.removeChild(node);
}
}];
return placeholder;
}
function reconcile(parent, oldNodes, newVNodes, beforeMarker) {
if (!parent) return;
const hasKeys = newVNodes.some(v => v && typeof v === 'object' && v.key != null);
if (hasKeys) {
reconcileKeyed(parent, oldNodes, newVNodes, beforeMarker);
} else {
reconcileUnkeyed(parent, oldNodes, newVNodes, beforeMarker);
}
}
function reconcileUnkeyed(parent, oldNodes, newVNodes, beforeMarker) {
const maxLen = Math.max(oldNodes.length, newVNodes.length);
const newNodes = [];
for (let i = 0; i < maxLen; i++) {
const oldNode = oldNodes[i];
const newVNode = newVNodes[i];
if (i >= newVNodes.length) {
if (oldNode && oldNode.parentNode) {
disposeTree(oldNode);
oldNode.parentNode.removeChild(oldNode);
}
continue;
}
if (i >= oldNodes.length) {
const node = createDOM(newVNode, parent);
if (node) {
const ref = getInsertionRef(oldNodes, beforeMarker);
parent.insertBefore(node, ref);
newNodes.push(node);
}
continue;
}
const patched = patchNode(parent, oldNode, newVNode);
newNodes.push(patched);
}
oldNodes.length = 0;
oldNodes.push(...newNodes);
}
function reconcileKeyed(parent, oldNodes, newVNodes, beforeMarker) {
const oldKeyMap = new Map();
for (let i = 0; i < oldNodes.length; i++) {
const node = oldNodes[i];
const key = node._vnode?.key;
if (key != null) {
oldKeyMap.set(key, { node, index: i });
}
}
const newNodes = [];
const newLen = newVNodes.length;
const sources = new Array(newLen).fill(-1); 
const reused = new Set();
for (let i = 0; i < newLen; i++) {
const vnode = newVNodes[i];
const key = vnode?.key;
if (key != null && oldKeyMap.has(key)) {
const { node: oldNode, index: oldIndex } = oldKeyMap.get(key);
sources[i] = oldIndex;
reused.add(oldIndex);
}
}
for (let i = 0; i < oldNodes.length; i++) {
if (!reused.has(i) && oldNodes[i]?.parentNode) {
disposeTree(oldNodes[i]);
oldNodes[i].parentNode.removeChild(oldNodes[i]);
}
}
const filtered = [];
const filteredToOriginal = [];
for (let j = 0; j < sources.length; j++) {
if (sources[j] !== -1) {
filteredToOriginal.push(j);
filtered.push(sources[j]);
}
}
const lis = longestIncreasingSubsequence(filtered);
const lisSet = new Set(lis.map(i => filteredToOriginal[i]));
let lastInserted = beforeMarker?.nextSibling || null;
for (let i = newLen - 1; i >= 0; i--) {
const vnode = newVNodes[i];
const key = vnode?.key;
const oldEntry = key != null ? oldKeyMap.get(key) : null;
if (oldEntry && sources[i] !== -1) {
const oldNode = oldEntry.node;
const patched = patchNode(parent, oldNode, vnode);
newNodes[i] = patched;
if (!lisSet.has(i) && patched.parentNode) {
parent.insertBefore(patched, lastInserted);
}
lastInserted = patched;
} else {
const node = createDOM(vnode, parent);
if (node) {
parent.insertBefore(node, lastInserted);
lastInserted = node;
}
newNodes[i] = node;
}
}
oldNodes.length = 0;
oldNodes.push(...newNodes.filter(Boolean));
}
function longestIncreasingSubsequence(arr) {
if (arr.length === 0) return [];
const n = arr.length;
const dp = new Array(n).fill(1);      
const parent = new Array(n).fill(-1); 
const tails = [0];                     
for (let i = 1; i < n; i++) {
if (arr[i] > arr[tails[tails.length - 1]]) {
parent[i] = tails[tails.length - 1];
tails.push(i);
} else {
let lo = 0, hi = tails.length - 1;
while (lo < hi) {
const mid = (lo + hi) >> 1;
if (arr[tails[mid]] < arr[i]) lo = mid + 1;
else hi = mid;
}
if (arr[i] < arr[tails[lo]]) {
if (lo > 0) parent[i] = tails[lo - 1];
tails[lo] = i;
}
}
}
const result = [];
let k = tails[tails.length - 1];
while (k !== -1) {
result.push(k);
k = parent[k];
}
return result.reverse();
}
function getInsertionRef(nodes, marker) {
if (nodes.length > 0) {
const last = nodes[nodes.length - 1];
return last.nextSibling;
}
return marker ? marker.nextSibling : null;
}
function cleanupArrayMarkers(parent, startMarker) {
const endMarker = startMarker._arrayEnd;
if (!endMarker) return null;
let node = startMarker.nextSibling;
while (node && node !== endMarker) {
const next = node.nextSibling;
disposeTree(node);
parent.removeChild(node);
node = next;
}
if (endMarker.parentNode) parent.removeChild(endMarker);
return startMarker;
}
function patchNode(parent, domNode, vnode) {
if (vnode == null || vnode === false || vnode === true) {
if (domNode && domNode.nodeType === 8 && domNode._arrayEnd) {
cleanupArrayMarkers(parent, domNode);
const placeholder = document.createComment('');
parent.replaceChild(placeholder, domNode);
return placeholder;
}
if (domNode && domNode.nodeType === 8 && !domNode._componentCtx) {
return domNode; 
}
const placeholder = document.createComment('');
if (domNode && domNode.parentNode) {
disposeTree(domNode);
parent.replaceChild(placeholder, domNode);
}
return placeholder;
}
if (typeof vnode === 'function') {
const wrapper = document.createElement('what-c');
let mounted = false;
const dispose = effect(() => {
const val = vnode();
const vnodes = (val == null || val === false || val === true)
? []
: Array.isArray(val) ? val : [val];
if (!mounted) {
mounted = true;
for (const v of vnodes) {
const node = createDOM(v, wrapper);
if (node) wrapper.appendChild(node);
}
} else {
reconcileChildren(wrapper, vnodes);
}
});
wrapper._dispose = dispose;
if (domNode && domNode.parentNode) {
disposeTree(domNode);
parent.replaceChild(wrapper, domNode);
}
return wrapper;
}
if (isDomNode(vnode)) {
if (domNode === vnode) return domNode;
if (domNode && domNode.parentNode) {
disposeTree(domNode);
parent.replaceChild(vnode, domNode);
}
return vnode;
}
if (typeof vnode === 'string' || typeof vnode === 'number') {
const text = String(vnode);
if (domNode && domNode.nodeType === 8 && domNode._arrayEnd) {
cleanupArrayMarkers(parent, domNode);
const newNode = document.createTextNode(text);
parent.replaceChild(newNode, domNode);
return newNode;
}
if (domNode.nodeType === 3) {
if (domNode.textContent !== text) domNode.textContent = text;
return domNode;
}
const newNode = document.createTextNode(text);
disposeTree(domNode);
parent.replaceChild(newNode, domNode);
return newNode;
}
if (Array.isArray(vnode)) {
if (domNode && domNode.nodeType === 8 && domNode._arrayEnd) {
const endMarker = domNode._arrayEnd;
const oldChildren = [];
let node = domNode.nextSibling;
while (node && node !== endMarker) {
oldChildren.push(node);
node = node.nextSibling;
}
const maxLen = Math.max(oldChildren.length, vnode.length);
for (let i = 0; i < maxLen; i++) {
if (i >= vnode.length) {
if (oldChildren[i]?.parentNode) {
disposeTree(oldChildren[i]);
parent.removeChild(oldChildren[i]);
}
} else if (i >= oldChildren.length) {
const newNode = createDOM(vnode[i], parent);
if (newNode) parent.insertBefore(newNode, endMarker);
} else {
patchNode(parent, oldChildren[i], vnode[i]);
}
}
return domNode;
}
const startMarker = document.createComment('[');
const endMarker = document.createComment(']');
disposeTree(domNode);
parent.replaceChild(endMarker, domNode);
parent.insertBefore(startMarker, endMarker);
for (const v of vnode) {
const node = createDOM(v, parent);
if (node) parent.insertBefore(node, endMarker);
}
startMarker._arrayEnd = endMarker;
return startMarker;
}
if (!isVNode(vnode)) {
const text = String(vnode);
if (domNode.nodeType === 3) {
if (domNode.textContent !== text) domNode.textContent = text;
return domNode;
}
const newNode = document.createTextNode(text);
disposeTree(domNode);
parent.replaceChild(newNode, domNode);
return newNode;
}
if (typeof vnode.tag === 'function') {
if (domNode._componentCtx && !domNode._componentCtx.disposed
&& domNode._componentCtx.Component === vnode.tag) {
domNode._componentCtx._propsSignal.set({ ...vnode.props, children: vnode.children });
domNode._vnode = vnode; 
return domNode;
}
disposeTree(domNode);
const node = createComponent(vnode, parent);
parent.replaceChild(node, domNode);
return node;
}
if (domNode.nodeType === 1 && domNode.tagName.toLowerCase() === vnode.tag) {
const oldProps = domNode._vnode?.props || {};
const nextProps = vnode.props || {};
const hadRawHtml = Object.prototype.hasOwnProperty.call(oldProps, 'dangerouslySetInnerHTML')
|| Object.prototype.hasOwnProperty.call(oldProps, 'innerHTML');
const hasRawHtml = Object.prototype.hasOwnProperty.call(nextProps, 'dangerouslySetInnerHTML')
|| Object.prototype.hasOwnProperty.call(nextProps, 'innerHTML');
if (hasRawHtml && !hadRawHtml) {
for (const child of Array.from(domNode.childNodes)) {
disposeTree(child);
}
}
applyProps(domNode, nextProps, oldProps);
if (!hasRawHtml) {
reconcileChildren(domNode, vnode.children);
}
domNode._vnode = vnode;
return domNode;
}
const newNode = createDOM(vnode, parent);
disposeTree(domNode);
parent.replaceChild(newNode, domNode);
return newNode;
}
function reconcileChildren(parent, newChildVNodes) {
const oldChildren = Array.from(parent.childNodes);
const hasKeys = newChildVNodes.some(v => v && typeof v === 'object' && v.key != null);
if (hasKeys) {
reconcileKeyed(parent, oldChildren, newChildVNodes, null);
} else {
const maxLen = Math.max(oldChildren.length, newChildVNodes.length);
for (let i = 0; i < maxLen; i++) {
if (i >= newChildVNodes.length) {
if (oldChildren[i]?.parentNode) {
disposeTree(oldChildren[i]);
parent.removeChild(oldChildren[i]);
}
continue;
}
if (i >= oldChildren.length) {
const node = createDOM(newChildVNodes[i], parent);
if (node) parent.appendChild(node);
continue;
}
patchNode(parent, oldChildren[i], newChildVNodes[i]);
}
}
}
function applyProps(el, newProps, oldProps, isSvg) {
newProps = newProps || {};
oldProps = oldProps || {};
for (const key in oldProps) {
if (key === 'key' || key === 'ref' || key === 'children') continue;
if (!(key in newProps)) {
removeProp(el, key, oldProps[key]);
}
}
for (const key in newProps) {
if (key === 'key' || key === 'ref' || key === 'children') continue;
if (newProps[key] !== oldProps[key]) {
setProp(el, key, newProps[key], isSvg);
}
}
if (newProps.ref && newProps.ref !== oldProps.ref) {
if (typeof newProps.ref === 'function') newProps.ref(el);
else newProps.ref.current = el;
}
}
function setProp(el, key, value, isSvg) {
if (key.startsWith('on') && key.length > 2) {
const event = key.slice(2).toLowerCase();
const old = el._events?.[event];
if (old && old._original === value) return;
if (old) el.removeEventListener(event, old);
if (!el._events) el._events = {};
const wrappedHandler = (e) => untrack(() => value(e));
wrappedHandler._original = value;
el._events[event] = wrappedHandler;
const eventOpts = value._eventOpts;
el.addEventListener(event, wrappedHandler, eventOpts || undefined);
return;
}
if (key === 'className' || key === 'class') {
if (isSvg) {
el.setAttribute('class', value || '');
} else {
el.className = value || '';
}
return;
}
if (key === 'style') {
if (typeof value === 'string') {
el.style.cssText = value;
el._prevStyle = null;
} else if (typeof value === 'object') {
const oldStyle = el._prevStyle || {};
for (const prop in oldStyle) {
if (!(prop in value)) el.style[prop] = '';
}
for (const prop in value) {
el.style[prop] = value[prop] ?? '';
}
el._prevStyle = { ...value };
}
return;
}
if (key === 'dangerouslySetInnerHTML') {
el.innerHTML = value?.__html ?? '';
return;
}
if (key === 'innerHTML') {
if (value && typeof value === 'object' && '__html' in value) {
el.innerHTML = value.__html ?? '';
} else {
el.innerHTML = value ?? '';
}
return;
}
if (typeof value === 'boolean') {
if (value) el.setAttribute(key, '');
else el.removeAttribute(key);
return;
}
if (key.startsWith('data-') || key.startsWith('aria-')) {
el.setAttribute(key, value);
return;
}
if (isSvg) {
if (value === false || value == null) {
el.removeAttribute(key);
} else {
el.setAttribute(key, value === true ? '' : String(value));
}
return;
}
if (key in el) {
el[key] = value;
} else {
el.setAttribute(key, value);
}
}
function removeProp(el, key, oldValue) {
if (key.startsWith('on') && key.length > 2) {
const event = key.slice(2).toLowerCase();
if (el._events?.[event]) {
el.removeEventListener(event, el._events[event]);
delete el._events[event];
}
return;
}
if (key === 'className' || key === 'class') {
el.className = '';
return;
}
if (key === 'style') {
el.style.cssText = '';
el._prevStyle = null;
return;
}
if (key === 'dangerouslySetInnerHTML' || key === 'innerHTML') {
el.innerHTML = '';
return;
}
el.removeAttribute(key);
}