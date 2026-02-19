/**
 * what-react/jsx-runtime — JSX automatic runtime
 *
 * When React libraries are compiled with the automatic JSX runtime,
 * they import jsx/jsxs from 'react/jsx-runtime' instead of calling
 * React.createElement. This module provides those functions.
 */

import { createElement } from './index.js';
import { Fragment } from 'what-core';

export { Fragment };

export function jsx(type, props, key) {
  if (key !== undefined) {
    props = { ...props, key };
  }

  // Extract children from props (automatic runtime puts children in props)
  const { children, ...rest } = props || {};

  if (children === undefined) {
    return createElement(type, rest);
  }

  if (Array.isArray(children)) {
    return createElement(type, rest, ...children);
  }

  return createElement(type, rest, children);
}

// jsxs is the same as jsx — React uses it for static children optimization
// but we don't need that distinction
export const jsxs = jsx;

// Development version
export const jsxDEV = jsx;
