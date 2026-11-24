/**
 * what-react/jsx-runtime — JSX automatic runtime
 *
 * When React libraries are compiled with the automatic JSX runtime,
 * they import jsx/jsxs from 'react/jsx-runtime' instead of calling
 * React.createElement. This module provides those functions.
 */

import { _element } from './index.js';
import { Fragment } from 'what-core';

export { Fragment };

// The automatic runtime hands the children over in props, where React keeps
// them: the element takes the props as they are.
export function jsx(type, props, key) {
  if (props == null) props = {};
  if (key !== undefined) props = { ...props, key };
  return _element(type, props);
}

// jsxs is the same as jsx — React uses it for static children optimization
// but we don't need that distinction
export const jsxs = jsx;

// Development version
export const jsxDEV = jsx;
