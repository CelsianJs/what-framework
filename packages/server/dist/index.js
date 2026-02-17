import { h } from 'what-core';
export function renderToString(vnode) {
if (vnode == null || vnode === false || vnode === true) return '';
if (typeof vnode === 'string' || typeof vnode === 'number') {
return escapeHtml(String(vnode));
}
if (Array.isArray(vnode)) {
return vnode.map(renderToString).join('');
}
if (typeof vnode.tag === 'function') {
const result = vnode.tag({ ...vnode.props, children: vnode.children });
return renderToString(result);
}
const { tag, props, children } = vnode;
const attrs = renderAttrs(props || {});
const open = `<${tag}${attrs}>`;
if (VOID_ELEMENTS.has(tag)) return open;
const rawInner = props?.dangerouslySetInnerHTML?.__html
?? props?.innerHTML?.__html
?? props?.innerHTML;
const inner = rawInner != null ? String(rawInner) : children.map(renderToString).join('');
return `${open}${inner}</${tag}>`;
}
export async function* renderToStream(vnode) {
if (vnode == null || vnode === false || vnode === true) return;
if (typeof vnode === 'string' || typeof vnode === 'number') {
yield escapeHtml(String(vnode));
return;
}
if (Array.isArray(vnode)) {
for (const child of vnode) {
yield* renderToStream(child);
}
return;
}
if (typeof vnode.tag === 'function') {
const result = vnode.tag({ ...vnode.props, children: vnode.children });
const resolved = result instanceof Promise ? await result : result;
yield* renderToStream(resolved);
return;
}
const { tag, props, children } = vnode;
const attrs = renderAttrs(props || {});
yield `<${tag}${attrs}>`;
if (!VOID_ELEMENTS.has(tag)) {
const rawInner = props?.dangerouslySetInnerHTML?.__html
?? props?.innerHTML?.__html
?? props?.innerHTML;
if (rawInner != null) {
yield String(rawInner);
} else {
for (const child of children) {
yield* renderToStream(child);
}
}
yield `</${tag}>`;
}
}
export function definePage(config) {
return {
mode: 'static',
...config,
};
}
export function generateStaticPage(page, data = {}) {
const vnode = page.component(data);
const html = renderToString(vnode);
const islands = page.islands || [];
return wrapDocument({
title: page.title || '',
meta: page.meta || {},
body: html,
islands,
scripts: page.mode === 'static' ? [] : page.scripts || [],
styles: page.styles || [],
mode: page.mode,
});
}
function wrapDocument({ title, meta, body, islands, scripts, styles, mode }) {
const metaTags = Object.entries(meta)
.map(([name, content]) => `<meta name="${name}" content="${escapeHtml(content)}">`)
.join('\n    ');
const styleTags = styles
.map(href => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
.join('\n    ');
const islandScript = islands.length > 0 ? `
<script type="module">
import { hydrateIslands } from '/@what/islands.js';
hydrateIslands();
</script>` : '';
const scriptTags = scripts
.map(src => `<script type="module" src="${escapeHtml(src)}"></script>`)
.join('\n    ');
const clientScript = mode === 'client' ? `
<script type="module" src="/@what/client.js"></script>` : '';
return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${metaTags}
<title>${escapeHtml(title)}</title>
${styleTags}
</head>
<body>
<div id="app">${body}</div>
${islandScript}
${scriptTags}
${clientScript}
</body>
</html>`;
}
export function server(Component) {
Component._server = true;
return Component;
}
function renderAttrs(props) {
let out = '';
for (const [key, val] of Object.entries(props)) {
if (key === 'key' || key === 'ref' || key === 'children' || key === 'dangerouslySetInnerHTML' || key === 'innerHTML') continue;
if (key.startsWith('on') && key.length > 2) continue; 
if (val === false || val == null) continue;
if (key === 'className' || key === 'class') {
out += ` class="${escapeHtml(String(val))}"`;
} else if (key === 'style' && typeof val === 'object') {
const css = Object.entries(val)
.map(([p, v]) => `${camelToKebab(p)}:${v}`)
.join(';');
out += ` style="${escapeHtml(css)}"`;
} else if (val === true) {
out += ` ${key}`;
} else {
out += ` ${key}="${escapeHtml(String(val))}"`;
}
}
return out;
}
function escapeHtml(str) {
return str
.replace(/&/g, '&amp;')
.replace(/</g, '&lt;')
.replace(/>/g, '&gt;')
.replace(/"/g, '&quot;');
}
function camelToKebab(str) {
return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}
const VOID_ELEMENTS = new Set([
'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
export {
action,
formAction,
useAction,
useFormAction,
useOptimistic,
useMutation,
onRevalidate,
invalidatePath,
handleActionRequest,
getRegisteredActions,
} from './actions.js';