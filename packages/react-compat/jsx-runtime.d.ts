import type { ReactElement, ReactNode } from './index.js';
export { Fragment } from './index.js';

export function jsx(type: any, props: any, key?: string | number): ReactElement;
export function jsxs(type: any, props: any, key?: string | number): ReactElement;
export function jsxDEV(type: any, props: any, key?: string | number, isStaticChildren?: boolean, source?: any, self?: any): ReactElement;

export namespace JSX {
  type Element = ReactElement;
  interface ElementChildrenAttribute { children: {}; }
  interface IntrinsicElements { [elemName: string]: any; }
  interface IntrinsicAttributes { key?: string | number; children?: ReactNode; ref?: any; }
}
