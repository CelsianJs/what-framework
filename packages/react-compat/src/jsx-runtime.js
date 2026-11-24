/**
 * what-react/jsx-runtime — JSX automatic runtime
 *
 * When React libraries are compiled with the automatic JSX runtime,
 * they import jsx/jsxs from 'react/jsx-runtime' instead of calling
 * React.createElement. This module provides those functions.
 */

import { _element, Fragment } from './index.js';

export { Fragment };

// The automatic runtime hands the children over in props, where React keeps
// them: the element takes the props as they are.
export function jsx(type, props, key) {
  if (props == null) props = {};
  // The key is the element's, not a prop: the props go on as they are, with
  // no copy to carry it. (Props that hold a `key` of their own, from a call
  // written by hand, are handled as createElement handles them.)
  if (key === undefined || props.key !== undefined || typeof key === 'function') {
    if (key !== undefined) props = { ...props, key };
    return _element(type, props, undefined);
  }
  return _element(type, props, key);
}

// jsxs is the same as jsx — React uses it for static children optimization
// but we don't need that distinction
export const jsxs = jsx;

// Development version
export const jsxDEV = jsx;
