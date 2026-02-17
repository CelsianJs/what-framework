const EMPTY_OBJ = {};
const EMPTY_ARR = [];
export function h(tag, props, ...children) {
props = props || EMPTY_OBJ;
const flat = flattenChildren(children);
const key = props.key ?? null;
if (props.key !== undefined) {
props = { ...props };
delete props.key;
}
return { tag, props, children: flat, key, _vnode: true };
}
export function Fragment({ children }) {
return children;
}
function flattenChildren(children) {
const out = [];
for (let i = 0; i < children.length; i++) {
const child = children[i];
if (child == null || child === false || child === true) continue;
if (Array.isArray(child)) {
out.push(...flattenChildren(child));
} else if (typeof child === 'object' && child._vnode) {
out.push(child);
} else if (typeof child === 'function') {
out.push(child);
} else {
out.push(String(child));
}
}
return out;
}
export function html(strings, ...values) {
const src = strings.reduce((acc, str, i) =>
acc + str + (i < values.length ? `\x00${i}\x00` : ''), '');
return parseTemplate(src, values);
}
function parseTemplate(src, values) {
src = src.trim();
const nodes = [];
let i = 0;
while (i < src.length) {
if (src[i] === '<') {
const result = parseElement(src, i, values);
if (result) {
nodes.push(result.node);
i = result.end;
continue;
}
}
const result = parseText(src, i, values);
if (result.text) nodes.push(result.text);
i = result.end;
}
return nodes.length === 1 ? nodes[0] : nodes;
}
function parseElement(src, start, values) {
const openMatch = src.slice(start).match(/^<([a-zA-Z][a-zA-Z0-9-]*|[A-Z]\w*)/);
if (!openMatch) return null;
const tag = openMatch[1];
let i = start + openMatch[0].length;
const props = {};
while (i < src.length) {
while (i < src.length && /\s/.test(src[i])) i++;
if (src.slice(i, i + 2) === '/>') {
return { node: h(tag, Object.keys(props).length ? props : null), end: i + 2 };
}
if (src[i] === '>') {
i++;
break;
}
if (src.slice(i, i + 3) === '...') {
const placeholder = src.slice(i + 3).match(/^\x00(\d+)\x00/);
if (placeholder) {
Object.assign(props, values[Number(placeholder[1])]);
i += 3 + placeholder[0].length;
continue;
}
}
const attrMatch = src.slice(i).match(/^([a-zA-Z_@:][a-zA-Z0-9_:.-]*)/);
if (!attrMatch) break;
const attrName = attrMatch[1];
i += attrMatch[0].length;
while (i < src.length && /\s/.test(src[i])) i++;
if (src[i] === '=') {
i++;
while (i < src.length && /\s/.test(src[i])) i++;
const ph = src.slice(i).match(/^\x00(\d+)\x00/);
if (ph) {
props[attrName] = values[Number(ph[1])];
i += ph[0].length;
} else if (src[i] === '"' || src[i] === "'") {
const q = src[i];
i++;
let val = '';
while (i < src.length && src[i] !== q) {
const tph = src.slice(i).match(/^\x00(\d+)\x00/);
if (tph) {
val += String(values[Number(tph[1])]);
i += tph[0].length;
} else {
val += src[i];
i++;
}
}
i++; 
props[attrName] = val;
}
} else {
props[attrName] = true;
}
}
const children = [];
const closeTag = `</${tag}>`;
while (i < src.length) {
if (src.slice(i, i + closeTag.length) === closeTag) {
i += closeTag.length;
break;
}
if (src[i] === '<') {
const child = parseElement(src, i, values);
if (child) {
children.push(child.node);
i = child.end;
continue;
}
}
const text = parseText(src, i, values);
if (text.text != null) children.push(text.text);
i = text.end;
}
return {
node: h(tag, Object.keys(props).length ? props : null, ...children),
end: i,
};
}
function parseText(src, start, values) {
let i = start;
let text = '';
while (i < src.length && src[i] !== '<') {
const ph = src.slice(i).match(/^\x00(\d+)\x00/);
if (ph) {
if (text.trim()) {
return { text: text.trim(), end: i };
}
return { text: values[Number(ph[1])], end: i + ph[0].length };
}
text += src[i];
i++;
}
return { text: text.trim() || null, end: i };
}