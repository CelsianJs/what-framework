// what-react/dom — react-dom compatible surface (src/dom.js).
// Alias `react-dom` → `what-react/dom` to run React libraries that render.

import type { ReactNode } from './index.js';

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

export interface FormStatus {
  pending: boolean;
  data: FormData | null;
  method: string | null;
  action: ((formData: FormData) => void | Promise<void>) | null;
}
/** The status of the <form> this component is inside, while its function `action` runs. */
export function useFormStatus(): FormStatus;
/** React 18's name for useActionState. */
export function useFormState<S, P>(
  action: (state: Awaited<S>, payload: P) => S | Promise<S>,
  initialState: Awaited<S>,
  permalink?: string,
): [state: Awaited<S>, dispatch: (payload: P) => void, isPending: boolean];
export function requestFormReset(form: HTMLFormElement): void;
// Resource hints. React writes <link> tags for these; here they do nothing.
export function preload(href: string, options?: object): void;
export function preloadModule(href: string, options?: object): void;
export function preinit(href: string, options?: object): void;
export function preinitModule(href: string, options?: object): void;
export function preconnect(href: string, options?: object): void;
export function prefetchDNS(href: string): void;

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
  useFormStatus: typeof useFormStatus;
  useFormState: typeof useFormState;
  requestFormReset: typeof requestFormReset;
  preload: typeof preload;
  preloadModule: typeof preloadModule;
  preinit: typeof preinit;
  preinitModule: typeof preinitModule;
  preconnect: typeof preconnect;
  prefetchDNS: typeof prefetchDNS;
  version: string;
};
export default ReactDOM;
