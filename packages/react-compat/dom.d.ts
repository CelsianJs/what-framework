// what-react/dom — react-dom compatible surface (src/dom.js).
// Alias `react-dom` → `what-react/dom` to run React libraries that render.

import type { ReactNode } from './index';

export interface Root {
  render(children: ReactNode): void;
  unmount(): void;
}

export function createRoot(container: Element | DocumentFragment): Root;
export function hydrateRoot(
  container: Element | DocumentFragment,
  initialChildren: ReactNode,
): Root;

export function render(
  element: ReactNode,
  container: Element | DocumentFragment,
  callback?: () => void,
): void;

export function unmountComponentAtNode(
  container: Element | DocumentFragment,
): boolean;

export function createPortal(
  children: ReactNode,
  container: Element | DocumentFragment,
  key?: string | null,
): ReactNode;

export function flushSync<R>(fn: () => R): R;

export function findDOMNode(
  component: unknown,
): Element | Text | null;

export function unstable_batchedUpdates<A, R>(
  fn: (arg: A) => R,
  arg?: A,
): R;

export const version: string;

declare const ReactDOM: {
  createRoot: typeof createRoot;
  hydrateRoot: typeof hydrateRoot;
  render: typeof render;
  unmountComponentAtNode: typeof unmountComponentAtNode;
  createPortal: typeof createPortal;
  flushSync: typeof flushSync;
  findDOMNode: typeof findDOMNode;
  unstable_batchedUpdates: typeof unstable_batchedUpdates;
  version: string;
};
export default ReactDOM;
