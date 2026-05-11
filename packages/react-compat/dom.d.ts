import type { ReactNode } from './index.js';

export interface Root {
  render(element: ReactNode): void;
  unmount(): void;
}

export function createRoot(container: Element | DocumentFragment): Root;
export function hydrateRoot(container: Element | DocumentFragment, initialChildren: ReactNode): Root;
export function render(element: ReactNode, container: Element | DocumentFragment, callback?: () => void): Root;
export function unmountComponentAtNode(container: Element | DocumentFragment): boolean;
export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | number | null): any;
export function flushSync<T = void>(fn?: () => T): T | void;
export function findDOMNode(component: any): Element | Text | null;
export function unstable_batchedUpdates<T = void>(fn: () => T): T | void;
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
  version: typeof version;
};

export default ReactDOM;
