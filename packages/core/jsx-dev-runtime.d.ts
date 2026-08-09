// What Framework — JSX dev-runtime type definitions.
// Re-exports the runtime types (including the JSX namespace) and adds jsxDEV,
// which the "react-jsxdev" transform emits in development builds.
import type { VNode } from './index.js';

export * from './jsx-runtime.js';

export function jsxDEV(
  type: any,
  props: any,
  key?: any,
  isStaticChildren?: boolean,
  source?: any,
  self?: any,
): VNode;
