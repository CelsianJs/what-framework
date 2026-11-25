// what-react/mixed: native What components and React components in one app
// (MIXED.md).
//
// Referencing this module (add `/// <reference types="what-react/mixed" />`
// to src/vite-env.d.ts) also widens What's JSX types for a mixed app: a
// React component of an npm package (a function returning ReactNode, a
// forwardRef or memo object, a class) is a valid tag in a native file, and
// JSX written inside its tag fits its `children: ReactNode`. A native-only app
// does not reference it and keeps What's stricter component types.

import type { FunctionComponent, ReactElement } from './index.js';

export { createElement, Fragment } from './index.js';

declare module 'what-core/jsx-runtime' {
  namespace JSX {
    interface ForeignElement {
      type: any;
      key: any;
    }
    interface ForeignComponents {
      react: ((props: never) => unknown) | (abstract new (props: never) => unknown);
    }
  }
}

/**
 * A React element tree placed by native code (what the Vite plugin compiles a
 * React tag in a native file to). `view` returns what-react elements and is
 * called again whenever a signal it read changes.
 */
export function ReactIsland(props: { view: () => ReactElement | null; svg?: boolean }): any;

/**
 * The React component that renders the native What component `component`:
 * it runs once and keeps its state, and each React render hands it the new
 * prop values as live props.
 */
export function native<P>(component: (props: P) => any): FunctionComponent<P>;

/** `native()` for an import, read when the element renders. */
export function nativeRef<P>(get: () => (props: P) => any, name?: string): FunctionComponent<P>;

/**
 * Hydrate React islands by adopting the server's HTML from now on: an island
 * takes the elements and text the server rendered for it instead of building
 * them again. what-react's Vite plugin calls it in the modules what-compiler
 * compiles for hydration; call it yourself, before hydrate(), in a build
 * without the plugin.
 */
export function _hydrateIslands(): void;
