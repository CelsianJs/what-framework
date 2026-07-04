// what-react/jsx-dev-runtime — development JSX runtime type definitions.
// Mirrors jsx-runtime.d.ts; TS uses this under "jsx": "react-jsxdev".

import type { ReactElement, Key } from './index';

export { Fragment } from './index';
export { JSX } from './jsx-runtime';

export function jsx(type: any, props: any, key?: Key): ReactElement;
export function jsxs(type: any, props: any, key?: Key): ReactElement;
export function jsxDEV(
  type: any,
  props: any,
  key?: Key,
  isStaticChildren?: boolean,
  source?: unknown,
  self?: unknown,
): ReactElement;
