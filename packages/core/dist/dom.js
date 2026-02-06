import { effect, batch, untrack } from './reactive.js';
export function mount(vnode, container) {
if (typeof container === 'string') {
container = document.querySelector(container);
}
container.textContent = '';
const node = createDOM(vnode, container);
if (node) container.appendChild(node);
return () => {
container.textContent = '';
};
}
function createDOM(vnode, parent) {
if (vnode == null || vnode === false || vnode === true) return null;
if (typeof vnode === 'string' || typeof vnode === 'number') {
return document.createTextNode(String(vnode));
}
if (Array.isArray(vnode)) {
const frag = document.createDocumentFragment();
for (const child of vnode) {
const node = createDOM(child, parent);
if (node) frag.appendChild(node);
}
return frag;
}
if (typeof vnode.tag === 'function') {
return createComponent(vnode, parent);
}
const el = document.createElement(vnode.tag);
applyProps(el, vnode.props, {});
for (const child of vnode.children) {
const node = createDOM(child, el);
if (node) el.appendChild(node);
}
el._vnode = vnode;
return el;
}
const componentStack = [];
export function getCurrentComponent() {
return componentStack[componentStack.length - 1];
}
function createComponent(vnode, parent) {
const { tag: Component, props, children } = vnode;
const ctx = {
hooks: [],
hookIndex: 0,
effects: [],
cleanups: [],
mounted: false,
disposed: false,
};
const marker = document.createComment(`w:${Component.name || 'anon'}`);
let currentNodes = [];
const dispose = effect(() => {
if (ctx.disposed) return;
ctx.hookIndex = 0;
componentStack.push(ctx);
const result = Component({ ...props, children });
componentStack.pop();
const vnodes = Array.isArray(result) ? result : [result];
if (!ctx.mounted) {
ctx.mounted = true;
for (const v of vnodes) {
const node = createDOM(v, parent);
if (node) {
currentNodes.push(node);
}
}
} else {
reconcile(marker.parentNode, currentNodes, vnodes, marker);
}
});
ctx.effects.push(dispose);
const frag = document.createDocumentFragment();
frag.appendChild(marker);
for (const node of currentNodes) {
frag.appendChild(node);
}
return frag;
}
function reconcile(parent, oldNodes, newVNodes, beforeMarker) {
if (!parent) return;
const maxLen = Math.max(oldNodes.length, newVNodes.length);
const newNodes = [];
for (let i = 0; i < maxLen; i++) {
const oldNode = oldNodes[i];
const newVNode = newVNodes[i];
if (i >= newVNodes.length) {
if (oldNode && oldNode.parentNode) {
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
function getInsertionRef(nodes, marker) {
if (nodes.length > 0) {
const last = nodes[nodes.length - 1];
return last.nextSibling;
}
return marker ? marker.nextSibling : null;
}
function patchNode(parent, domNode, vnode) {
if (vnode == null || vnode === false || vnode === true) {
if (domNode && domNode.parentNode) domNode.parentNode.removeChild(domNode);
return null;
}
if (typeof vnode === 'string' || typeof vnode === 'number') {
const text = String(vnode);
if (domNode.nodeType === 3) {
if (domNode.textContent !== text) domNode.textContent = text;
return domNode;
}
const newNode = document.createTextNode(text);
parent.replaceChild(newNode, domNode);
return newNode;
}
if (Array.isArray(vnode)) {
const frag = document.createDocumentFragment();
for (const v of vnode) {
const node = createDOM(v, parent);
if (node) frag.appendChild(node);
}
parent.replaceChild(frag, domNode);
return frag;
}
if (typeof vnode.tag === 'function') {
const node = createComponent(vnode, parent);
parent.replaceChild(node, domNode);
return node;
}
if (domNode.nodeType === 1 && domNode.tagName.toLowerCase() === vnode.tag) {
const oldProps = domNode._vnode?.props || {};
applyProps(domNode, vnode.props, oldProps);
reconcileChildren(domNode, vnode.children);
domNode._vnode = vnode;
return domNode;
}
const newNode = createDOM(vnode, parent);
parent.replaceChild(newNode, domNode);
return newNode;
}
function reconcileChildren(parent, newChildVNodes) {
const oldChildren = Array.from(parent.childNodes);
const maxLen = Math.max(oldChildren.length, newChildVNodes.length);
for (let i = 0; i < maxLen; i++) {
if (i >= newChildVNodes.length) {
if (oldChildren[i]?.parentNode) {
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
function applyProps(el, newProps, oldProps) {
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
setProp(el, key, newProps[key]);
}
}
if (newProps.ref && newProps.ref !== oldProps.ref) {
if (typeof newProps.ref === 'function') newProps.ref(el);
else newProps.ref.current = el;
}
}
function setProp(el, key, value) {
if (key.startsWith('on') && key.length > 2) {
const event = key.slice(2).toLowerCase();
const old = el._events?.[event];
if (old) el.removeEventListener(event, old);
if (!el._events) el._events = {};
el._events[event] = value;
el.addEventListener(event, value);
return;
}
if (key === 'className' || key === 'class') {
el.className = value || '';
return;
}
if (key === 'style') {
if (typeof value === 'string') {
el.style.cssText = value;
} else if (typeof value === 'object') {
for (const prop in value) {
el.style[prop] = value[prop] ?? '';
}
}
return;
}
if (key === 'dangerouslySetInnerHTML') {
el.innerHTML = value.__html;
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
return;
}
el.removeAttribute(key);
}