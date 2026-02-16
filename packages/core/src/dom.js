// What Framework - DOM Reconciler
// Surgical DOM updates. Diff props, diff children, patch only what changed.
// Components use <what-c> wrapper elements (display:contents) for clean reconciliation.
// No virtual DOM tree kept in memory — we diff against the live DOM.

import { effect, batch, untrack, signal } from './reactive.js';
import { reportError, _injectGetCurrentComponent } from './components.js';
import { _setComponentRef } from './helpers.js';

// Register <what-c> custom element to prevent flash of unstyled content
// Note: style is set in connectedCallback (not constructor) to comply with custom element spec
if (typeof customElements !== 'undefined' && !customElements.get('what-c')) {
  customElements.define('what-c', class extends HTMLElement {
    connectedCallback() {
      this.style.display = 'contents';
    }
  });
}

// SVG elements that need namespace
const SVG_ELEMENTS = new Set([
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
  'g', 'defs', 'use', 'symbol', 'clipPath', 'mask', 'pattern', 'image',
  'text', 'tspan', 'textPath', 'foreignObject', 'linearGradient', 'radialGradient', 'stop',
  'marker', 'animate', 'animateTransform', 'animateMotion', 'set', 'filter',
  'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
  'feDiffuseLighting', 'feDisplacementMap', 'feFlood', 'feGaussianBlur', 'feImage',
  'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'feSpecularLighting',
  'feTile', 'feTurbulence',
]);
const SVG_NS = 'http://www.w3.org/2000/svg';

// Track all mounted component contexts for disposal
const mountedComponents = new Set();

// Dispose a component: run effect cleanups, hook cleanups, onCleanup callbacks
function disposeComponent(ctx) {
  if (ctx.disposed) return;
  ctx.disposed = true;

  // Run useEffect cleanup functions
  for (const hook of ctx.hooks) {
    if (hook && typeof hook === 'object' && 'cleanup' in hook && hook.cleanup) {
      try { hook.cleanup(); } catch (e) { console.error('[what] cleanup error:', e); }
    }
  }

  // Run onCleanup callbacks
  if (ctx._cleanupCallbacks) {
    for (const fn of ctx._cleanupCallbacks) {
      try { fn(); } catch (e) { console.error('[what] onCleanup error:', e); }
    }
  }

  // Dispose reactive effects
  for (const dispose of ctx.effects) {
    try { dispose(); } catch (e) { /* effect already disposed */ }
  }

  mountedComponents.delete(ctx);
}

// Dispose all components attached to a DOM subtree
function disposeTree(node) {
  if (!node) return;
  if (node._componentCtx) {
    disposeComponent(node._componentCtx);
  }
  if (node.childNodes) {
    for (const child of node.childNodes) {
      disposeTree(child);
    }
  }
}

// Mount a component tree into a DOM container
export function mount(vnode, container) {
  if (typeof container === 'string') {
    container = document.querySelector(container);
  }
  disposeTree(container); // Clean up any previous mount
  container.textContent = '';
  const node = createDOM(vnode, container);
  if (node) container.appendChild(node);
  return () => {
    disposeTree(container);
    container.textContent = '';
  };
}

// --- Create DOM from VNode ---

function createDOM(vnode, parent, isSvg) {
  // Null/false/true → placeholder comment (preserves child indices for reconciliation)
  if (vnode == null || vnode === false || vnode === true) {
    return document.createComment('');
  }

  // Text
  if (typeof vnode === 'string' || typeof vnode === 'number') {
    return document.createTextNode(String(vnode));
  }

  // Reactive function child — creates a text node that updates fine-grained
  if (typeof vnode === 'function') {
    const textNode = document.createTextNode('');
    effect(() => {
      const val = vnode();
      // If the function returns a vnode, we can't upgrade a text node to an element.
      // For now, stringify the result. Component-level re-render handles complex cases.
      textNode.textContent = (val == null || val === false || val === true) ? '' : String(val);
    });
    return textNode;
  }

  // Array (fragment)
  if (Array.isArray(vnode)) {
    const frag = document.createDocumentFragment();
    for (const child of vnode) {
      const node = createDOM(child, parent, isSvg);
      if (node) frag.appendChild(node);
    }
    return frag;
  }

  // Component
  if (typeof vnode.tag === 'function') {
    return createComponent(vnode, parent, isSvg);
  }

  // Detect SVG context: either we're already in SVG, or this tag is an SVG element
  const svgContext = isSvg || vnode.tag === 'svg' || SVG_ELEMENTS.has(vnode.tag);

  // HTML or SVG Element
  const el = svgContext
    ? document.createElementNS(SVG_NS, vnode.tag)
    : document.createElement(vnode.tag);

  applyProps(el, vnode.props, {}, svgContext);
  for (const child of vnode.children) {
    const node = createDOM(child, el, svgContext && vnode.tag !== 'foreignObject');
    if (node) el.appendChild(node);
  }

  // Store vnode on element for diffing
  el._vnode = vnode;
  return el;
}

// --- Component Rendering ---

const componentStack = [];

export function getCurrentComponent() {
  return componentStack[componentStack.length - 1];
}

// Inject into components.js and helpers.js to avoid circular imports
_injectGetCurrentComponent(getCurrentComponent);
_setComponentRef(getCurrentComponent);

export function getComponentStack() {
  return componentStack;
}

function createComponent(vnode, parent, isSvg) {
  const { tag: Component, props, children } = vnode;

  // Handle special boundary components
  if (Component === '__errorBoundary' || vnode.tag === '__errorBoundary') {
    return createErrorBoundary(vnode, parent);
  }
  if (Component === '__suspense' || vnode.tag === '__suspense') {
    return createSuspenseBoundary(vnode, parent);
  }
  if (Component === '__portal' || vnode.tag === '__portal') {
    return createPortal(vnode, parent);
  }

  // Component context for hooks
  const ctx = {
    hooks: [],
    hookIndex: 0,
    effects: [],
    cleanups: [],
    mounted: false,
    disposed: false,
    Component, // Store for identity check in patchNode
    _parentCtx: componentStack[componentStack.length - 1] || null,
    // Inherit error boundary from parent context chain
    _errorBoundary: (() => {
      let p = componentStack[componentStack.length - 1];
      while (p) {
        if (p._errorBoundary) return p._errorBoundary;
        p = p._parentCtx;
      }
      return null;
    })()
  };

  // Wrapper element: <what-c display:contents> for HTML, <g> for SVG
  // Note: <what-c> custom element sets display:contents in its constructor
  let wrapper;
  if (isSvg) {
    wrapper = document.createElementNS(SVG_NS, 'g');
  } else {
    wrapper = document.createElement('what-c');
  }
  wrapper._componentCtx = ctx;
  wrapper._isSvg = !!isSvg;
  ctx._wrapper = wrapper;

  // Track for disposal
  mountedComponents.add(ctx);

  // Props signal for reactive updates from parent
  const propsSignal = signal({ ...props, children });
  ctx._propsSignal = propsSignal;

  // Reactive render: re-renders when signals used inside change
  const dispose = effect(() => {
    if (ctx.disposed) return;
    ctx.hookIndex = 0;

    componentStack.push(ctx);

    let result;
    try {
      result = Component(propsSignal());
    } catch (error) {
      componentStack.pop();
      if (!reportError(error, ctx)) {
        console.error('[what] Uncaught error in component:', Component.name || 'Anonymous', error);
        throw error;
      }
      return;
    }

    componentStack.pop();

    const vnodes = Array.isArray(result) ? result : [result];

    if (!ctx.mounted) {
      // Initial mount
      ctx.mounted = true;

      // Run onMount callbacks after DOM is ready
      if (ctx._mountCallbacks) {
        queueMicrotask(() => {
          if (ctx.disposed) return;
          for (const fn of ctx._mountCallbacks) {
            try { fn(); } catch (e) { console.error('[what] onMount error:', e); }
          }
        });
      }

      for (const v of vnodes) {
        const node = createDOM(v, wrapper, isSvg);
        if (node) wrapper.appendChild(node);
      }
    } else {
      // Update: reconcile children inside wrapper
      reconcileChildren(wrapper, vnodes);
    }
  });

  ctx.effects.push(dispose);
  return wrapper;
}

// Error boundary component handler
function createErrorBoundary(vnode, parent) {
  const { errorState, handleError, fallback, reset } = vnode.props;
  const children = vnode.children;

  const wrapper = document.createElement('what-c');
  wrapper.style.display = 'contents';

  // Create a boundary context so child components can find this boundary via _parentCtx chain
  const boundaryCtx = {
    hooks: [], hookIndex: 0, effects: [], cleanups: [],
    mounted: false, disposed: false,
    _parentCtx: componentStack[componentStack.length - 1] || null,
    _errorBoundary: handleError,
  };
  wrapper._componentCtx = boundaryCtx;

  const dispose = effect(() => {
    const error = errorState();

    // Push boundary context so child components inherit _errorBoundary via _parentCtx
    componentStack.push(boundaryCtx);

    let vnodes;
    if (error) {
      vnodes = typeof fallback === 'function' ? [fallback({ error, reset })] : [fallback];
    } else {
      vnodes = children;
    }

    componentStack.pop();
    vnodes = Array.isArray(vnodes) ? vnodes : [vnodes];

    if (wrapper.childNodes.length === 0) {
      for (const v of vnodes) {
        const node = createDOM(v, wrapper);
        if (node) wrapper.appendChild(node);
      }
    } else {
      reconcileChildren(wrapper, vnodes);
    }
  });

  boundaryCtx.effects.push(dispose);
  return wrapper;
}

// Suspense boundary component handler
function createSuspenseBoundary(vnode, parent) {
  const { boundary, fallback, loading } = vnode.props;
  const children = vnode.children;

  const wrapper = document.createElement('what-c');
  wrapper.style.display = 'contents';

  // Create a boundary context to store the dispose function for cleanup
  const boundaryCtx = {
    hooks: [], hookIndex: 0, effects: [], cleanups: [],
    mounted: false, disposed: false,
    _parentCtx: componentStack[componentStack.length - 1] || null,
  };
  wrapper._componentCtx = boundaryCtx;

  const dispose = effect(() => {
    const isLoading = loading();
    const vnodes = isLoading ? [fallback] : children;
    const normalized = Array.isArray(vnodes) ? vnodes : [vnodes];

    if (wrapper.childNodes.length === 0) {
      for (const v of normalized) {
        const node = createDOM(v, wrapper);
        if (node) wrapper.appendChild(node);
      }
    } else {
      reconcileChildren(wrapper, normalized);
    }
  });

  boundaryCtx.effects.push(dispose);
  return wrapper;
}

// Portal component handler — renders children into a different DOM container
function createPortal(vnode, parent) {
  const { container } = vnode.props;
  const children = vnode.children;

  if (!container) {
    console.warn('[what] Portal: target container not found');
    return document.createComment('portal:empty');
  }

  // Create a boundary context for cleanup
  const portalCtx = {
    hooks: [], hookIndex: 0, effects: [], cleanups: [],
    mounted: false, disposed: false,
    _parentCtx: componentStack[componentStack.length - 1] || null,
  };

  // Placeholder in the original tree for reconciliation
  const placeholder = document.createComment('portal');
  placeholder._componentCtx = portalCtx;

  // Render children into the target container
  const portalNodes = [];
  for (const child of children) {
    const node = createDOM(child, container);
    if (node) {
      container.appendChild(node);
      portalNodes.push(node);
    }
  }

  // Register cleanup to remove portal nodes when placeholder is disposed
  portalCtx._cleanupCallbacks = [() => {
    for (const node of portalNodes) {
      disposeTree(node);
      if (node.parentNode) node.parentNode.removeChild(node);
    }
  }];

  return placeholder;
}

// --- Reconciliation ---
// Diff old DOM nodes against new VNodes, patch in place.
// Uses keyed reconciliation with LIS (Longest Increasing Subsequence) for minimal DOM moves.

function reconcile(parent, oldNodes, newVNodes, beforeMarker) {
  if (!parent) return;

  const hasKeys = newVNodes.some(v => v && typeof v === 'object' && v.key != null);

  if (hasKeys) {
    reconcileKeyed(parent, oldNodes, newVNodes, beforeMarker);
  } else {
    reconcileUnkeyed(parent, oldNodes, newVNodes, beforeMarker);
  }
}

// Unkeyed reconciliation (index-based, fast for static lists)
function reconcileUnkeyed(parent, oldNodes, newVNodes, beforeMarker) {
  const maxLen = Math.max(oldNodes.length, newVNodes.length);
  const newNodes = [];

  for (let i = 0; i < maxLen; i++) {
    const oldNode = oldNodes[i];
    const newVNode = newVNodes[i];

    if (i >= newVNodes.length) {
      // Remove extra old nodes
      if (oldNode && oldNode.parentNode) {
        disposeTree(oldNode);
        oldNode.parentNode.removeChild(oldNode);
      }
      continue;
    }

    if (i >= oldNodes.length) {
      // Append new nodes
      const node = createDOM(newVNode, parent);
      if (node) {
        const ref = getInsertionRef(oldNodes, beforeMarker);
        parent.insertBefore(node, ref);
        newNodes.push(node);
      }
      continue;
    }

    // Patch existing node
    const patched = patchNode(parent, oldNode, newVNode);
    newNodes.push(patched);
  }

  // Update the reference array
  oldNodes.length = 0;
  oldNodes.push(...newNodes);
}

// Keyed reconciliation with LIS algorithm for O(n log n) minimal moves
function reconcileKeyed(parent, oldNodes, newVNodes, beforeMarker) {
  // Build old key -> { node, index } map
  const oldKeyMap = new Map();
  for (let i = 0; i < oldNodes.length; i++) {
    const node = oldNodes[i];
    const key = node._vnode?.key;
    if (key != null) {
      oldKeyMap.set(key, { node, index: i });
    }
  }

  const newNodes = [];
  const newLen = newVNodes.length;

  // First pass: match keys and find reusable nodes
  const sources = new Array(newLen).fill(-1); // Maps new index to old index
  const reused = new Set();

  for (let i = 0; i < newLen; i++) {
    const vnode = newVNodes[i];
    const key = vnode?.key;
    if (key != null && oldKeyMap.has(key)) {
      const { node: oldNode, index: oldIndex } = oldKeyMap.get(key);
      sources[i] = oldIndex;
      reused.add(oldIndex);
    }
  }

  // Remove nodes that aren't reused
  for (let i = 0; i < oldNodes.length; i++) {
    if (!reused.has(i) && oldNodes[i]?.parentNode) {
      disposeTree(oldNodes[i]);
      oldNodes[i].parentNode.removeChild(oldNodes[i]);
    }
  }

  // Find LIS (Longest Increasing Subsequence) of old indices.
  // The LIS tells us which reused nodes are already in correct relative order
  // and don't need to be moved. Only nodes NOT in the LIS need DOM moves.
  //
  // Step 1: Filter out -1 entries (new nodes with no old counterpart).
  // Step 2: Compute LIS on the filtered array. Result: indices into the filtered array.
  // Step 3: Map filtered-array indices back to original sources[] indices (new-VNode indices).
  //   For each LIS index `lis[i]`, we find the `lis[i]`-th non-negative entry in sources[]
  //   and return its position in the original sources array.
  // Build filteredToOriginal map in one O(n) pass instead of O(n²) nested loop
  const filtered = [];
  const filteredToOriginal = [];
  for (let j = 0; j < sources.length; j++) {
    if (sources[j] !== -1) {
      filteredToOriginal.push(j);
      filtered.push(sources[j]);
    }
  }
  const lis = longestIncreasingSubsequence(filtered);
  const lisSet = new Set(lis.map(i => filteredToOriginal[i]));

  // Build new nodes array and move/create as needed
  let lastInserted = beforeMarker?.nextSibling || null;

  // Process in reverse order for correct insertion
  for (let i = newLen - 1; i >= 0; i--) {
    const vnode = newVNodes[i];
    const key = vnode?.key;
    const oldEntry = key != null ? oldKeyMap.get(key) : null;

    if (oldEntry && sources[i] !== -1) {
      // Reuse existing node
      const oldNode = oldEntry.node;
      // Patch props/children
      const patched = patchNode(parent, oldNode, vnode);
      newNodes[i] = patched;

      // Move if not in LIS
      if (!lisSet.has(i) && patched.parentNode) {
        parent.insertBefore(patched, lastInserted);
      }
      lastInserted = patched;
    } else {
      // Create new node
      const node = createDOM(vnode, parent);
      if (node) {
        parent.insertBefore(node, lastInserted);
        lastInserted = node;
      }
      newNodes[i] = node;
    }
  }

  // Update the reference array
  oldNodes.length = 0;
  oldNodes.push(...newNodes.filter(Boolean));
}

// Longest Increasing Subsequence - O(n log n)
// Returns indices of elements that form the LIS
function longestIncreasingSubsequence(arr) {
  if (arr.length === 0) return [];

  const n = arr.length;
  const dp = new Array(n).fill(1);      // Length of LIS ending at i
  const parent = new Array(n).fill(-1); // Parent index for reconstruction
  const tails = [0];                     // Indices of smallest tail elements

  for (let i = 1; i < n; i++) {
    if (arr[i] > arr[tails[tails.length - 1]]) {
      parent[i] = tails[tails.length - 1];
      tails.push(i);
    } else {
      // Binary search for the smallest element >= arr[i]
      let lo = 0, hi = tails.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[tails[mid]] < arr[i]) lo = mid + 1;
        else hi = mid;
      }
      if (arr[i] < arr[tails[lo]]) {
        if (lo > 0) parent[i] = tails[lo - 1];
        tails[lo] = i;
      }
    }
  }

  // Reconstruct LIS
  const result = [];
  let k = tails[tails.length - 1];
  while (k !== -1) {
    result.push(k);
    k = parent[k];
  }
  return result.reverse();
}

function getInsertionRef(nodes, marker) {
  if (nodes.length > 0) {
    const last = nodes[nodes.length - 1];
    return last.nextSibling;
  }
  return marker ? marker.nextSibling : null;
}

// Helper: clean up array marker range (startMarker .. endMarker) and return a clean replacement node
function cleanupArrayMarkers(parent, startMarker) {
  const endMarker = startMarker._arrayEnd;
  if (!endMarker) return null;
  // Remove all nodes between start and end markers
  let node = startMarker.nextSibling;
  while (node && node !== endMarker) {
    const next = node.nextSibling;
    disposeTree(node);
    parent.removeChild(node);
    node = next;
  }
  // Remove end marker
  if (endMarker.parentNode) parent.removeChild(endMarker);
  return startMarker;
}

function patchNode(parent, domNode, vnode) {
  // Null/removed → keep placeholder or replace with one
  if (vnode == null || vnode === false || vnode === true) {
    // Handle array marker cleanup
    if (domNode && domNode.nodeType === 8 && domNode._arrayEnd) {
      cleanupArrayMarkers(parent, domNode);
      const placeholder = document.createComment('');
      parent.replaceChild(placeholder, domNode);
      return placeholder;
    }
    if (domNode && domNode.nodeType === 8 && !domNode._componentCtx) {
      return domNode; // already a placeholder comment
    }
    const placeholder = document.createComment('');
    if (domNode && domNode.parentNode) {
      disposeTree(domNode);
      parent.replaceChild(placeholder, domNode);
    }
    return placeholder;
  }

  // Reactive function child — replace whatever's there with a reactive text node
  if (typeof vnode === 'function') {
    const textNode = document.createTextNode('');
    effect(() => {
      const val = vnode();
      textNode.textContent = (val == null || val === false || val === true) ? '' : String(val);
    });
    if (domNode && domNode.parentNode) {
      disposeTree(domNode);
      parent.replaceChild(textNode, domNode);
    }
    return textNode;
  }

  // Text
  if (typeof vnode === 'string' || typeof vnode === 'number') {
    const text = String(vnode);
    // Clean up array markers if transitioning from array to text
    if (domNode && domNode.nodeType === 8 && domNode._arrayEnd) {
      cleanupArrayMarkers(parent, domNode);
      const newNode = document.createTextNode(text);
      parent.replaceChild(newNode, domNode);
      return newNode;
    }
    if (domNode.nodeType === 3) {
      if (domNode.textContent !== text) domNode.textContent = text;
      return domNode;
    }
    const newNode = document.createTextNode(text);
    disposeTree(domNode);
    parent.replaceChild(newNode, domNode);
    return newNode;
  }

  // Array — use marker comments to bracket the range (DocumentFragment empties on append)
  if (Array.isArray(vnode)) {
    // If domNode is already an array marker, reconcile contents in place
    if (domNode && domNode.nodeType === 8 && domNode._arrayEnd) {
      const endMarker = domNode._arrayEnd;
      // Collect existing children between markers
      const oldChildren = [];
      let node = domNode.nextSibling;
      while (node && node !== endMarker) {
        oldChildren.push(node);
        node = node.nextSibling;
      }
      // Reconcile the array contents
      const maxLen = Math.max(oldChildren.length, vnode.length);
      for (let i = 0; i < maxLen; i++) {
        if (i >= vnode.length) {
          // Remove extra old nodes
          if (oldChildren[i]?.parentNode) {
            disposeTree(oldChildren[i]);
            parent.removeChild(oldChildren[i]);
          }
        } else if (i >= oldChildren.length) {
          // Append new nodes before end marker
          const newNode = createDOM(vnode[i], parent);
          if (newNode) parent.insertBefore(newNode, endMarker);
        } else {
          // Patch existing
          patchNode(parent, oldChildren[i], vnode[i]);
        }
      }
      return domNode;
    }
    // Fresh array: create markers
    const startMarker = document.createComment('[');
    const endMarker = document.createComment(']');
    disposeTree(domNode);
    parent.replaceChild(endMarker, domNode);
    parent.insertBefore(startMarker, endMarker);
    for (const v of vnode) {
      const node = createDOM(v, parent);
      if (node) parent.insertBefore(node, endMarker);
    }
    startMarker._arrayEnd = endMarker;
    return startMarker;
  }

  // Component
  if (typeof vnode.tag === 'function') {
    // Check if old node is a component wrapper for the same component
    if (domNode._componentCtx && !domNode._componentCtx.disposed
        && domNode._componentCtx.Component === vnode.tag) {
      // Same component — update props reactively, let its effect re-render
      domNode._componentCtx._propsSignal.set({ ...vnode.props, children: vnode.children });
      return domNode;
    }
    // Different component or not a component — dispose old, create new
    disposeTree(domNode);
    const node = createComponent(vnode, parent);
    parent.replaceChild(node, domNode);
    return node;
  }

  // Element: same tag? Patch props + children
  if (domNode.nodeType === 1 && domNode.tagName.toLowerCase() === vnode.tag) {
    const oldProps = domNode._vnode?.props || {};
    applyProps(domNode, vnode.props, oldProps);
    reconcileChildren(domNode, vnode.children);
    domNode._vnode = vnode;
    return domNode;
  }

  // Different tag: replace entirely
  const newNode = createDOM(vnode, parent);
  disposeTree(domNode);
  parent.replaceChild(newNode, domNode);
  return newNode;
}

function reconcileChildren(parent, newChildVNodes) {
  const oldChildren = Array.from(parent.childNodes);

  // Check for keyed children
  const hasKeys = newChildVNodes.some(v => v && typeof v === 'object' && v.key != null);

  if (hasKeys) {
    // Use keyed reconciliation
    reconcileKeyed(parent, oldChildren, newChildVNodes, null);
  } else {
    // Unkeyed reconciliation
    const maxLen = Math.max(oldChildren.length, newChildVNodes.length);

    for (let i = 0; i < maxLen; i++) {
      if (i >= newChildVNodes.length) {
        // Remove extra
        if (oldChildren[i]?.parentNode) {
          disposeTree(oldChildren[i]);
          parent.removeChild(oldChildren[i]);
        }
        continue;
      }

      if (i >= oldChildren.length) {
        // Append new
        const node = createDOM(newChildVNodes[i], parent);
        if (node) parent.appendChild(node);
        continue;
      }

      patchNode(parent, oldChildren[i], newChildVNodes[i]);
    }
  }
}

// --- Prop Diffing ---
// Only touch DOM for props that actually changed.

function applyProps(el, newProps, oldProps, isSvg) {
  newProps = newProps || {};
  oldProps = oldProps || {};

  // Remove old props not in new
  for (const key in oldProps) {
    if (key === 'key' || key === 'ref' || key === 'children') continue;
    if (!(key in newProps)) {
      removeProp(el, key, oldProps[key]);
    }
  }

  // Set new/changed props
  for (const key in newProps) {
    if (key === 'key' || key === 'ref' || key === 'children') continue;
    if (newProps[key] !== oldProps[key]) {
      setProp(el, key, newProps[key], isSvg);
    }
  }

  // Handle ref
  if (newProps.ref && newProps.ref !== oldProps.ref) {
    if (typeof newProps.ref === 'function') newProps.ref(el);
    else newProps.ref.current = el;
  }
}

function setProp(el, key, value, isSvg) {
  // Event handlers: onClick -> click
  // Wrap in untrack so signal reads in handlers don't create subscriptions
  if (key.startsWith('on') && key.length > 2) {
    const event = key.slice(2).toLowerCase();
    // Store handler for removal
    const old = el._events?.[event];
    // Skip re-wrapping if same handler function
    if (old && old._original === value) return;
    if (old) el.removeEventListener(event, old);
    if (!el._events) el._events = {};
    // Wrap handler to untrack signal reads
    const wrappedHandler = (e) => untrack(() => value(e));
    wrappedHandler._original = value;
    el._events[event] = wrappedHandler;
    // Check for _eventOpts (once/capture/passive from compiler)
    const eventOpts = value._eventOpts;
    el.addEventListener(event, wrappedHandler, eventOpts || undefined);
    return;
  }

  // className / class
  if (key === 'className' || key === 'class') {
    if (isSvg) {
      el.setAttribute('class', value || '');
    } else {
      el.className = value || '';
    }
    return;
  }

  // Style object — track previous style to remove stale properties
  if (key === 'style') {
    if (typeof value === 'string') {
      el.style.cssText = value;
      el._prevStyle = null;
    } else if (typeof value === 'object') {
      // Remove old style properties not in new style
      const oldStyle = el._prevStyle || {};
      for (const prop in oldStyle) {
        if (!(prop in value)) el.style[prop] = '';
      }
      for (const prop in value) {
        el.style[prop] = value[prop] ?? '';
      }
      el._prevStyle = { ...value };
    }
    return;
  }

  // dangerouslySetInnerHTML
  if (key === 'dangerouslySetInnerHTML') {
    el.innerHTML = value.__html;
    return;
  }

  // Boolean attributes
  if (typeof value === 'boolean') {
    if (value) el.setAttribute(key, '');
    else el.removeAttribute(key);
    return;
  }

  // data-* and aria-* as attributes
  if (key.startsWith('data-') || key.startsWith('aria-')) {
    el.setAttribute(key, value);
    return;
  }

  // SVG: always use setAttribute (SVG properties don't work as DOM properties)
  if (isSvg) {
    if (value === false || value == null) {
      el.removeAttribute(key);
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
    return;
  }

  // Default: set as property if it exists, otherwise attribute
  if (key in el) {
    el[key] = value;
  } else {
    el.setAttribute(key, value);
  }
}

function removeProp(el, key, oldValue) {
  if (key.startsWith('on') && key.length > 2) {
    const event = key.slice(2).toLowerCase();
    if (el._events?.[event]) {
      el.removeEventListener(event, el._events[event]);
      delete el._events[event];
    }
    return;
  }

  if (key === 'className' || key === 'class') {
    el.className = '';
    return;
  }

  if (key === 'style') {
    el.style.cssText = '';
    el._prevStyle = null;
    return;
  }

  el.removeAttribute(key);
}
