// What Framework — JSX Dev Runtime
// Same as jsx-runtime but used in development mode by Vite.

import { h, Fragment } from './h.js';

export { Fragment };

export function jsxDEV(type, props, key) {
  if (props == null) return h(type, null);
  const { children, ...rest } = props;
  if (key !== undefined) rest.key = key;
  if (children === undefined) return h(type, rest);
  if (Array.isArray(children)) return h(type, rest, ...children);
  return h(type, rest, children);
}

// Also export jsx/jsxs for compatibility — some bundlers use these even in dev
export const jsx = jsxDEV;
export const jsxs = jsxDEV;
