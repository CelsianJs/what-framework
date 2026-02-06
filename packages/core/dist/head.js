const headState = {
title: null,
metas: new Map(),
links: new Map(),
};
export function Head({ title, meta, link, children }) {
if (typeof document === 'undefined') return null;
if (title) {
document.title = title;
headState.title = title;
}
if (meta) {
for (const attrs of (Array.isArray(meta) ? meta : [meta])) {
const key = attrs.name || attrs.property || attrs.httpEquiv || JSON.stringify(attrs);
setHeadTag('meta', key, attrs);
}
}
if (link) {
for (const attrs of (Array.isArray(link) ? link : [link])) {
const key = attrs.rel + (attrs.href || '');
setHeadTag('link', key, attrs);
}
}
return children || null;
}
function setHeadTag(tag, key, attrs) {
const existing = document.head.querySelector(`[data-what-head="${key}"]`);
if (existing) {
updateElement(existing, attrs);
return;
}
const el = document.createElement(tag);
el.setAttribute('data-what-head', key);
for (const [k, v] of Object.entries(attrs)) {
el.setAttribute(k, v);
}
document.head.appendChild(el);
}
function updateElement(el, attrs) {
for (const [k, v] of Object.entries(attrs)) {
if (el.getAttribute(k) !== v) {
el.setAttribute(k, v);
}
}
}
export function clearHead() {
const tags = document.head.querySelectorAll('[data-what-head]');
for (const tag of tags) tag.remove();
headState.metas.clear();
headState.links.clear();
}