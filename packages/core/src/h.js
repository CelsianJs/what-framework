// What Framework - Element Descriptors
// Minimal element descriptor objects. No classes, no fibers, just plain objects.

// h(tag, props, ...children) -> VNode
// h(Component, props, ...children) -> VNode
// VNode = { tag, props, children, key }

const EMPTY_OBJ = Object.create(null);
const EMPTY_ARR = [];

export function h(tag, props) {
  props = props || EMPTY_OBJ;
  // Collect children from arguments[2..n] without rest args — avoids array allocation
  // when there are 0-1 children (common case: leaf elements, text nodes).
  const argLen = arguments.length;
  let flat;
  if (argLen <= 2) {
    flat = EMPTY_ARR;
  } else if (argLen === 3) {
    flat = _flattenSingle(arguments[2]);
  } else {
    // Multiple children: flatten all arguments from position 2 onward
    const out = [];
    for (let i = 2; i < argLen; i++) {
      _flattenInto(arguments[i], out);
    }
    flat = out;
  }

  const key = props.key ?? null;

  // Strip key from props passed to component/element
  if (props.key !== undefined) {
    props = { ...props };
    delete props.key;
  }

  return { tag, props, children: flat, key, _vnode: true };
}

// Fragment — just returns children
export function Fragment({ children }) {
  return children;
}

// Fast path for single child (most common case)
function _flattenSingle(child) {
  if (child == null || child === false || child === true) return EMPTY_ARR;
  if (Array.isArray(child)) {
    const out = [];
    _flattenInto(child, out);
    return out;
  }
  if (typeof child === 'object' && child._vnode) return [child];
  if (typeof child === 'function') return [child];
  return [String(child)];
}

// Flatten a child (or array of children) into the output array
function _flattenInto(child, out) {
  if (child == null || child === false || child === true) return;
  if (Array.isArray(child)) {
    for (let i = 0; i < child.length; i++) {
      _flattenInto(child[i], out);
    }
  } else if (typeof child === 'object' && child._vnode) {
    out.push(child);
  } else if (typeof child === 'function') {
    out.push(child);
  } else {
    out.push(String(child));
  }
}

// JSX-like tagged template alternative (no build step needed)
// html`<div class="foo">${content}</div>`
// Uses a simple parser, not full HTML — good enough for most cases.

export function html(strings, ...values) {
  const src = strings.reduce((acc, str, i) =>
    acc + str + (i < values.length ? `\x00${i}\x00` : ''), '');
  return parseTemplate(src, values);
}

function parseTemplate(src, values) {
  // Lightweight tagged template parser
  // Supports: <tag attr="val">, <tag ...${spread}>, ${children}, self-closing
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
    // Text or interpolation
    const result = parseText(src, i, values);
    if (result.text) nodes.push(result.text);
    i = result.end;
  }

  return nodes.length === 1 ? nodes[0] : nodes;
}

function parseElement(src, start, values) {
  // Opening tag
  const openMatch = src.slice(start).match(/^<([a-zA-Z][a-zA-Z0-9-]*|[A-Z]\w*)/);
  if (!openMatch) return null;

  const tag = openMatch[1];
  let i = start + openMatch[0].length;
  const props = {};

  // Parse attributes
  while (i < src.length) {
    // Skip whitespace
    while (i < src.length && /\s/.test(src[i])) i++;

    // Self-closing or end of opening tag
    if (src.slice(i, i + 2) === '/>') {
      return { node: h(tag, Object.keys(props).length ? props : null), end: i + 2 };
    }
    if (src[i] === '>') {
      i++;
      break;
    }

    // Spread: ...${obj}
    if (src.slice(i, i + 3) === '...') {
      const placeholder = src.slice(i + 3).match(/^\x00(\d+)\x00/);
      if (placeholder) {
        Object.assign(props, values[Number(placeholder[1])]);
        i += 3 + placeholder[0].length;
        continue;
      }
    }

    // Attribute: name=${val} or name="val" or name
    const attrMatch = src.slice(i).match(/^([a-zA-Z_@:][a-zA-Z0-9_:.-]*)/);
    if (!attrMatch) break;

    const attrName = attrMatch[1];
    i += attrMatch[0].length;

    // Skip whitespace around =
    while (i < src.length && /\s/.test(src[i])) i++;

    if (src[i] === '=') {
      i++;
      while (i < src.length && /\s/.test(src[i])) i++;

      // Value is a placeholder
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
        i++; // closing quote
        props[attrName] = val;
      }
    } else {
      props[attrName] = true;
    }
  }

  // Parse children until closing tag
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
