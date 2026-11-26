/**
 * what-react/dom — ReactDOM compatibility layer
 *
 * Renders through what-react's compat runtime (React semantics: re-renders,
 * keyed reconciliation, value hooks). Native What vnodes inside the tree are
 * delegated to what-core automatically by the runtime.
 */

import {
  _vnodeOf,
  _portalMount,
  mountRoot,
  patchRoot,
  unmountRoot,
  flushUpdates,
  _flushPassive,
  _domNodes,
  _canFlushSynchronously,
  _getCurrentInstance,
  _whenCommitted,
} from './runtime.js';
import { useFormStatus, useActionState, _islandIds } from './hooks.js';
import { createElement } from './index.js';

// ---- createRoot (React 18) ----

// A root renders into a DOM element; anything else is a coded error naming
// the function called, worded as mount() and hydrate() word it in
// development (what-core dom.js _mountTarget).
function rootContainer(container, fn) {
  if (container == null || typeof container.nodeType !== 'number') {
    throw Object.assign(new Error(`[what] ${fn}() got no container element: it was ${String(container)}`), { code: 'ERR_MOUNT_TARGET_MISSING' });
  }
  return container;
}

export function createRoot(container) {
  rootContainer(container, 'createRoot');
  /** @type {{ container: any, rns: any } | null} */
  let root = null;
  let unmounted = false;

  return {
    render(element) {
      // React's error #409, also while the unmount waits for a commit.
      if (unmounted) throw new Error('Cannot update an unmounted root.');
      if (root) {
        patchRoot(root, element);
      } else {
        container.textContent = '';
        root = mountRoot(element, container);
      }
    },
    // Asked for while a render, a commit or its effects run (a cleanup or
    // a ref that unmounts its own root, the first commit's included): once
    // they are done, as React does, with what the root holds then.
    unmount() {
      unmounted = true;
      _whenCommitted(() => {
        if (root) unmountRoot(root);
        root = null;
        container.textContent = '';
      });
    },
  };
}

// ---- hydrateRoot ----
// No hydration in full compat: the server's HTML (React's own server render,
// which writes what-react's islands' markers nowhere) is replaced by a client
// render. React's options that apply to that are honoured: identifierPrefix
// (useId gives React's client ids, `_<prefix>r_<n>_`) and
// onRecoverableError, called once, as React calls it when it renders a root
// again, when what the client rendered is not the server's HTML (comments
// aside).

let clientIds = 0;

function prefixedId(inst) {
  for (let p = inst; p != null; p = p.parent) {
    if (p._idPrefix !== undefined) return '_' + p._idPrefix + 'r_' + (clientIds++).toString(32) + '_';
  }
  return '';
}

function IdPrefix(props) {
  /** @type {any} */ (_getCurrentInstance())._idPrefix = props.prefix;
  return props.children;
}

const markup = (container) => container.innerHTML.replace(/<!--[\s\S]*?-->/g, '');

export function hydrateRoot(container, initialChildren, options) {
  const root = createRoot(rootContainer(container, 'hydrateRoot'));
  const prefix = options != null ? options.identifierPrefix : undefined;
  if (prefix != null) {
    _islandIds(prefixedId);
    const render = root.render;
    root.render = (element) => render(createElement(IdPrefix, { prefix: String(prefix) }, element));
  }
  const server = markup(container);
  root.render(initialChildren);
  const onRecoverableError = options != null ? options.onRecoverableError : undefined;
  if (typeof onRecoverableError === 'function' && markup(container) !== server) {
    onRecoverableError(new Error('Hydration failed because the server rendered HTML didn\'t match the client. As a result this tree will be regenerated on the client.'));
  }
  return root;
}

// ---- render (React 17 legacy) ----

const legacyRoots = new WeakMap();

export function render(element, container, callback) {
  let root = legacyRoots.get(rootContainer(container, 'render'));
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
// Where the portal reaches a native What tree, what-core's renderer calls its
// `mount`, which renders it as an island (runtime.js _portalMount), by this
// runtime and React's rules, as any React element there.

export function createPortal(children, container, key) {
  return Object.assign(_vnodeOf('__portal', { container, key, mount: _portalMount }), {
    type: '__portal',
    children: Array.isArray(children) ? children : [children],
    _compat: true,
  });
}

// ---- flushSync ----

export function flushSync(fn) {
  let result;
  if (fn) result = fn();
  // Inside a render, a commit or an effect: the update renders with the
  // flush already under way (React's rule), not in a flush of its own.
  if (!_canFlushSynchronously()) return result;
  flushUpdates();
  _flushPassive();
  flushUpdates();
  return result;
}

// ---- findDOMNode (deprecated but needed for legacy packages) ----

export function findDOMNode(component) {
  if (component == null) return null;
  if (typeof Element !== 'undefined' && component instanceof Element) return component;
  // A class component's instance: the first element or text it rendered.
  const inst = component._compatInst;
  if (inst) {
    const nodes = _domNodes(inst);
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === 1 || nodes[i].nodeType === 3) return nodes[i];
    }
    return null;
  }
  if (component._domNode) return component._domNode;
  if (component._ref && component._ref.current instanceof Element) return component._ref.current;
  return null;
}

// ---- batching ----

// Every update is batched already (one render per microtask flush), so this
// only runs `fn`, as React 18's does. It does not render before it returns:
// the code after the call still sees the DOM of the last commit.
export function unstable_batchedUpdates(fn, a) {
  return fn(a);
}

// ---- React 19: form status, form actions, resource hints ----

export { useFormStatus } from './hooks.js';
// React 18's name for useActionState.
export { useActionState as useFormState } from './hooks.js';

/** Reset a form's uncontrolled fields, as React does after a form action. */
export function requestFormReset(form) {
  if (form && typeof form.reset === 'function') form.reset();
}

// Resource hints: React writes <link> tags for these. They only tune loading,
// so here they do nothing.
export function preload() {}
export function preloadModule() {}
export function preinit() {}
export function preinitModule() {}
export function preconnect() {}
export function prefetchDNS() {}

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
  useFormStatus,
  useFormState: useActionState,
  requestFormReset,
  preload,
  preloadModule,
  preinit,
  preinitModule,
  preconnect,
  prefetchDNS,
  version,
};

export default ReactDOM;
