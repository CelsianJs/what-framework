/**
 * what-react/dom — ReactDOM compatibility layer
 *
 * Renders through what-react's compat runtime (React semantics: re-renders,
 * keyed reconciliation, value hooks). Native What vnodes inside the tree are
 * delegated to what-core automatically by the runtime.
 */

import {
  mountRoot,
  patchRoot,
  unmountRoot,
  flushUpdates,
  _flushPassive,
} from './runtime.js';

// ---- createRoot (React 18) ----

export function createRoot(container) {
  let root = null;

  return {
    render(element) {
      if (root) {
        patchRoot(root, element);
      } else {
        container.textContent = '';
        root = mountRoot(element, container);
      }
    },
    unmount() {
      if (root) {
        unmountRoot(root);
        root = null;
      }
      container.textContent = '';
    },
  };
}

// ---- hydrateRoot ----
// No true hydration — replaces server-rendered content with a fresh mount.

export function hydrateRoot(container, initialChildren) {
  const root = createRoot(container);
  root.render(initialChildren);
  return root;
}

// ---- render (React 17 legacy) ----

const legacyRoots = new WeakMap();

export function render(element, container, callback) {
  let root = legacyRoots.get(container);
  if (!root) {
    root = createRoot(container);
    legacyRoots.set(container, root);
  }
  root.render(element);
  if (callback) queueMicrotask(callback);
  return root;
}

// ---- unmountComponentAtNode (React 17 legacy) ----

export function unmountComponentAtNode(container) {
  const root = legacyRoots.get(container);
  if (root) {
    root.unmount();
    legacyRoots.delete(container);
    return true;
  }
  container.innerHTML = '';
  return true;
}

// ---- createPortal ----
// The compat runtime recognizes '__portal' vnodes and renders children into
// the target container while keeping context/ownership from the React tree.

export function createPortal(children, container, key) {
  return {
    tag: '__portal',
    type: '__portal',
    props: { container, key },
    children: Array.isArray(children) ? children : [children],
    key: key ?? null,
    _vnode: true,
    _compat: true,
  };
}

// ---- flushSync ----

export function flushSync(fn) {
  let result;
  if (fn) result = fn();
  flushUpdates();
  _flushPassive();
  flushUpdates();
  return result;
}

// ---- findDOMNode (deprecated but needed for legacy packages) ----

export function findDOMNode(component) {
  if (component == null) return null;
  if (typeof Element !== 'undefined' && component instanceof Element) return component;
  if (component._domNode) return component._domNode;
  if (component._ref && component._ref.current instanceof Element) return component._ref.current;
  return null;
}

// ---- batching ----

export function unstable_batchedUpdates(fn) {
  const result = fn();
  flushUpdates();
  return result;
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
