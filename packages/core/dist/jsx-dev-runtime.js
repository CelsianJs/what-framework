import {
  Fragment,
  h
} from "./chunk-AZP2EOGX.js";

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
