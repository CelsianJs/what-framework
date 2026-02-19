/**
 * what-react/dom — ReactDOM compatibility layer
 *
 * Implements ReactDOM's public API using What's mount() and rendering.
 */

import { mount as whatMount, h, Fragment } from 'what-core';
import { flushSync as whatFlushSync } from 'what-core';

// ---- createRoot (React 18) ----

export function createRoot(container) {
  let unmount = null;

  return {
    render(element) {
      if (unmount) unmount();
      unmount = whatMount(element, container);
    },
    unmount() {
      if (unmount) {
        unmount();
        unmount = null;
      }
      container.innerHTML = '';
    },
  };
}

// ---- hydrateRoot ----
// Basic implementation — mounts fresh (true hydration would reuse existing DOM)

export function hydrateRoot(container, initialChildren) {
  const root = createRoot(container);
  root.render(initialChildren);
  return root;
}

// ---- render (React 17 legacy) ----

export function render(element, container, callback) {
  const root = createRoot(container);
  root.render(element);
  if (callback) queueMicrotask(callback);
  return root;
}

// ---- unmountComponentAtNode (React 17 legacy) ----

export function unmountComponentAtNode(container) {
  container.innerHTML = '';
  return true;
}

// ---- createPortal ----

export function createPortal(children, container, key) {
  // Create a vnode that the core reconciler recognizes as a portal.
  // Core's createDOM routes '__portal' tagged vnodes to the internal portal handler,
  // which renders children into the target container and returns a placeholder comment.
  const portal = {
    tag: '__portal',
    props: { container, key },
    children: Array.isArray(children) ? children : [children],
    key: key || null,
    _vnode: true,
  };

  return portal;
}

// ---- flushSync ----

export function flushSync(fn) {
  if (fn) fn();
  whatFlushSync();
}

// ---- findDOMNode (deprecated) ----

export function findDOMNode(component) {
  console.warn('[what-react] findDOMNode is deprecated.');
  return null;
}

// ---- batching ----

export function unstable_batchedUpdates(fn) {
  fn();
}

// ---- Version ----
export const version = '18.3.1';

// ---- Default export ----
const ReactDOM = {
  createRoot,
  hydrateRoot,
  render,
  unmountComponentAtNode,
  createPortal,
  flushSync,
  findDOMNode,
  unstable_batchedUpdates,
  version,
};

export default ReactDOM;
