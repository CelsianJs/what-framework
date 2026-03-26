import { effect, batch, untrack, signal, __DEV__, __devtools } from './reactive.js';
import { reportError, _injectGetCurrentComponent, shallowEqual } from './components.js';
import { _setComponentRef } from './helpers.js';
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
if (ctx.cleanups) {
for (const cleanup of ctx.cleanups) {
try { cleanup(); } catch (e) { console.error('[what] cleanup error:', e); }
}
}
if (ctx.effects) {
for (const dispose of ctx.effects) {
try { dispose(); } catch (e) {  }
}
}
if (ctx.hooks) {
for (const hook of ctx.hooks) {
if (hook && typeof hook.cleanup === 'function') {
try { hook.cleanup(); } catch (e) { console.error('[what] hook cleanup error:', e); }
}
}
}
if (ctx._cleanupCallbacks) {
for (const fn of ctx._cleanupCallbacks) {
try { fn(); } catch (e) { console.error('[what] onCleanup error:', e); }
}
}
if (__DEV__ && __devtools?.onComponentUnmount) __devtools.onComponentUnmount(ctx);
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
if (node._propEffects) {
for (const key in node._propEffects) {
try { node._propEffects[key](); } catch (e) {  }
}
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
const container = document.createDocumentFragment ? document.createElement('span') : document.createElement('span');
container.style.display = 'contents';
let currentNodes = [];
const dispose = effect(() => {
const val = vnode();
const vnodes = (val == null || val === false || val === true)
? []
: Array.isArray(val) ? val : [val];
for (const old of currentNodes) {
disposeTree(old);
if (old.parentNode === container) container.removeChild(old);
}
currentNodes = [];
for (const v of vnodes) {
const node = createDOM(v, container, parent?._isSvg);
if (node) {
container.appendChild(node);
currentNodes.push(node);
}
}
});
container._dispose = dispose;
return container;
}
if (Array.isArray(vnode)) {
const frag = document.createDocumentFragment();
for (const child of vnode) {
const node = createDOM(child, parent, isSvg);
if (node) frag.appendChild(node);
}
return frag;
}
if (isVNode(vnode) && typeof vnode.tag === 'function') {
return createComponent(vnode, parent, isSvg);
}
if (isVNode(vnode)) {
return createElementFromVNode(vnode, parent, isSvg);
}
return document.createTextNode(String(vnode));
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
let { tag: Component, props, children } = vnode;
if (typeof Component === 'function' &&
(Component.prototype?.isReactComponent || Component.prototype?.render)) {
const ClassComp = Component;
Component = function ClassComponentBridge(props) {
const instance = new ClassComp(props);
return instance.render();
};
Component.displayName = ClassComp.displayName || ClassComp.name || 'ClassComponent';
}
if (Component === '__errorBoundary' || vnode.tag === '__errorBoundary') {
return createErrorBoundary(vnode, parent);
}
if (Component === '__suspense' || vnode.tag === '__suspense') {
return createSuspenseBoundary(vnode, parent);
}
if (Component === '__portal' || vnode.tag === '__portal') {
return createPortalDOM(vnode, parent);
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
const container = document.createElement('span');
container.style.display = 'contents';
container._componentCtx = ctx;
container._isSvg = !!isSvg;
ctx._wrapper = container;
mountedComponents.add(ctx);
if (__DEV__ && __devtools?.onComponentMount) __devtools.onComponentMount(ctx);
const propsChildren = children.length === 0 ? undefined : children.length === 1 ? children[0] : children;
const propsSignal = signal({ ...props, children: propsChildren });
ctx._propsSignal = propsSignal;
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
return container;
}
componentStack.pop();
ctx.mounted = true;
if (ctx._mountCallbacks) {
queueMicrotask(() => {
if (ctx.disposed) return;
for (const fn of ctx._mountCallbacks) {
try { fn(); } catch (e) { console.error('[what] onMount error:', e); }
}
});
}
const vnodes = Array.isArray(result) ? result : [result];
for (const v of vnodes) {
const node = createDOM(v, container, isSvg);
if (node) container.appendChild(node);
}
container._vnode = vnode;
return container;
}
function createErrorBoundary(vnode, parent) {
const { errorState, handleError, fallback, reset } = vnode.props;
const children = vnode.children;
const wrapper = document.createElement('span');
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
while (wrapper.firstChild) {
disposeTree(wrapper.firstChild);
wrapper.removeChild(wrapper.firstChild);
}
let vnodes;
if (error) {
vnodes = typeof fallback === 'function' ? [fallback({ error, reset })] : [fallback];
} else {
vnodes = children;
}
vnodes = Array.isArray(vnodes) ? vnodes : [vnodes];
for (const v of vnodes) {
const node = createDOM(v, wrapper);
if (node) wrapper.appendChild(node);
}
componentStack.pop();
});
boundaryCtx.effects.push(dispose);
return wrapper;
}
function createSuspenseBoundary(vnode, parent) {
const { boundary, fallback, loading } = vnode.props;
const children = vnode.children;
const wrapper = document.createElement('span');
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
componentStack.push(boundaryCtx);
while (wrapper.firstChild) {
disposeTree(wrapper.firstChild);
wrapper.removeChild(wrapper.firstChild);
}
for (const v of normalized) {
const node = createDOM(v, wrapper);
if (node) wrapper.appendChild(node);
}
componentStack.pop();
});
boundaryCtx.effects.push(dispose);
return wrapper;
}
function createPortalDOM(vnode, parent) {
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
function createElementFromVNode(vnode, parent, isSvg) {
const { tag, props, children } = vnode;
const svgContext = isSvg || SVG_ELEMENTS.has(tag);
const el = svgContext
? document.createElementNS(SVG_NS, tag)
: document.createElement(tag);
if (props) {
applyProps(el, props, {}, svgContext);
}
for (const child of children) {
const node = createDOM(child, el, svgContext && tag !== 'foreignObject');
if (node) el.appendChild(node);
}
el._vnode = vnode;
return el;
}
function applyProps(el, newProps, oldProps, isSvg) {
newProps = newProps || {};
oldProps = oldProps || {};
for (const key in newProps) {
if (key === 'key' || key === 'children') continue;
if (key === 'ref') {
if (typeof newProps.ref === 'function') newProps.ref(el);
else if (newProps.ref) newProps.ref.current = el;
continue;
}
setProp(el, key, newProps[key], isSvg);
}
}
function setProp(el, key, value, isSvg) {
if (typeof value === 'function' && !(key.startsWith('on') && key.length > 2) && key !== 'ref') {
if (!el._propEffects) el._propEffects = {};
if (el._propEffects[key]) {
try { el._propEffects[key](); } catch (e) {  }
}
el._propEffects[key] = effect(() => {
const resolved = value();
setProp(el, key, resolved, isSvg);
});
return;
}
if (key.startsWith('on') && key.length > 2) {
let eventName = key.slice(2);
let useCapture = false;
if (eventName.endsWith('Capture')) {
eventName = eventName.slice(0, -7);
useCapture = true;
}
const event = eventName.toLowerCase();
const storageKey = useCapture ? event + '_capture' : event;
const old = el._events?.[storageKey];
if (old && old._original === value) return;
if (old) el.removeEventListener(event, old, useCapture);
if (value == null) return;
if (!el._events) el._events = {};
const wrappedHandler = (e) => {
if (!e.nativeEvent) e.nativeEvent = e;
return untrack(() => value(e));
};
wrappedHandler._original = value;
el._events[storageKey] = wrappedHandler;
const eventOpts = value._eventOpts;
el.addEventListener(event, wrappedHandler, eventOpts || useCapture || undefined);
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