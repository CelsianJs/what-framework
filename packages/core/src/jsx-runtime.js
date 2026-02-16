// What Framework — JSX Automatic Runtime
// Used by: jsxImportSource: "what-framework" (or "what-core")
// Vite/esbuild import this automatically when using the "react-jsx" transform.

import { h, Fragment } from './h.js';

export { Fragment };

// Automatic JSX transform signature: jsx(type, { children, ...props }, key)
// What's h() signature: h(type, props, ...children)
export function jsx(type, props, key) {
  if (props == null) return h(type, null);
  const { children, ...rest } = props;
  if (key !== undefined) rest.key = key;
  if (children === undefined) return h(type, rest);
  if (Array.isArray(children)) return h(type, rest, ...children);
  return h(type, rest, children);
}

// jsxs = jsx for static children (multiple). Same behavior for What.
export const jsxs = jsx;
