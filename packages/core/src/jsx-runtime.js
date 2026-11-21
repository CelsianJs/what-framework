// What Framework — JSX Automatic Runtime
// Used by: jsxImportSource: "what-framework" (or "what-core")
// Vite/esbuild import this automatically when using the "react-jsx" transform.

import { Fragment, _jsxVNode } from './h.js';

export { Fragment };

// Automatic JSX transform signature: jsx(type, { children, ...props }, key).
// One pass over the own properties builds the props object the vnode keeps,
// without `children` or `key`, so h()'s own copy is not needed on top of it.
// The key argument wins over a `key` carried in by a spread.
export function jsx(type, props, key) {
  const rest = {};
  let children;
  let k = key;
  if (props != null) {
    for (const name of Object.keys(props)) {
      if (name === 'children') children = props[name];
      else if (name === 'key') { if (k === undefined) k = props[name]; }
      else rest[name] = props[name];
    }
  }
  return _jsxVNode(type, rest, children, k === undefined ? null : k);
}

// jsxs = jsx for static children (multiple). Same behavior for What.
export const jsxs = jsx;
