// packages/core/src/h.js
var EMPTY_OBJ = /* @__PURE__ */ Object.create(null);
var EMPTY_ARR = [];
function h(tag, props) {
  props = props || EMPTY_OBJ;
  const argLen = arguments.length;
  let flat;
  if (argLen <= 2) {
    flat = EMPTY_ARR;
  } else if (argLen === 3) {
    flat = _flattenSingle(arguments[2]);
  } else {
    const out = [];
    for (let i = 2; i < argLen; i++) {
      _flattenInto(arguments[i], out);
    }
    flat = out;
  }
  const key = props.key ?? null;
  if (props.key !== void 0) {
    props = { ...props };
    delete props.key;
  }
  return { tag, props, children: flat, key, _vnode: true };
}
function Fragment({ children }) {
  return children;
}
function _flattenSingle(child) {
  if (child == null || child === false || child === true) return EMPTY_ARR;
  if (Array.isArray(child)) {
    const out = [];
    _flattenInto(child, out);
    return out;
  }
  if (typeof child === "object") {
    if (child._vnode) return [child];
    if (typeof child.nodeType === "number") return [child];
  }
  if (typeof child === "function") return [child];
  return [String(child)];
}
function _flattenInto(child, out) {
  if (child == null || child === false || child === true) return;
  if (Array.isArray(child)) {
    for (let i = 0; i < child.length; i++) {
      _flattenInto(child[i], out);
    }
  } else if (typeof child === "object") {
    if (child._vnode) {
      out.push(child);
    } else if (typeof child.nodeType === "number") {
      out.push(child);
    } else {
      out.push(String(child));
    }
  } else if (typeof child === "function") {
    out.push(child);
  } else {
    out.push(String(child));
  }
}

// packages/core/src/jsx-dev-runtime.js
function jsxDEV(type, props, key) {
  if (props == null) return h(type, null);
  const { children, ...rest } = props;
  if (key !== void 0) rest.key = key;
  if (children === void 0) return h(type, rest);
  if (Array.isArray(children)) return h(type, rest, ...children);
  return h(type, rest, children);
}
var jsx = jsxDEV;
var jsxs = jsxDEV;
export {
  Fragment,
  jsx,
  jsxDEV,
  jsxs
};
//# sourceMappingURL=jsx-dev-runtime.js.map
