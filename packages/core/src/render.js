// What Framework - Fine-Grained Rendering Primitives
// Solid-style rendering: components run once, signals create individual DOM effects.
// No VDOM diffing — direct DOM manipulation with surgical signal-driven updates.

import { effect, untrack, createRoot, _createItemScope, signal, __DEV__ } from './reactive.js';
import { createDOM, disposeTree, getCurrentComponent, getComponentStack, _setSelectValue } from './dom.js';
export { effect, untrack };

// --- Generic text insertion hook ---
// External text engines (e.g., what-text) register a callback here via
// _setTextInsertHook(). When null (default), zero cost — no module loaded,
// no branch taken. The hook receives (parentElement, textString) on every
// dynamic text insertion and update.
let _onTextInsert = null;

export function _setTextInsertHook(fn) {
  _onTextInsert = typeof fn === 'function' ? fn : null;
}

// --- _$createComponent(Component, props, children) ---
// Internal compiler target for component instantiation. The compiler emits calls
// to this function instead of h() — keeping h() out of compiled output entirely.
// Merges children into props and delegates to createDOM which calls createComponent.

export function _$createComponent(Component, props, children) {
  if (children && children.length > 0) {
    const mergedChildren = children.length === 1 ? children[0] : children;
    // Mutate props in place when possible to avoid object spread allocation.
    // Compiled output creates a fresh props object per call, so mutation is safe.
    if (props) {
      props.children = mergedChildren;
    } else {
      props = { children: mergedChildren };
    }
  }
  // Build a VNode-like object and pass to createDOM which handles component execution
  return createDOM({ tag: Component, props: props || {}, children: children || [], key: null, _vnode: true });
}

// --- URL Sanitization for DOM attributes ---
// Rejects javascript:, data:, vbscript: protocols (case-insensitive, trimmed).

const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'formAction']);

function isSafeUrl(url) {
  if (typeof url !== 'string') return true; // non-string values are not URL-injection risks
  const normalized = url.trim().replace(/[\s\x00-\x1f]/g, '').toLowerCase();
  if (normalized.startsWith('javascript:')) return false;
  if (normalized.startsWith('data:')) return false;
  if (normalized.startsWith('vbscript:')) return false;
  return true;
}

// --- template(html) ---
// Pre-parse HTML string into a <template> element. Returns a factory function
// that clones the DOM tree via cloneNode(true) — 2-5x faster than createElement chains.
// INTERNAL: Used by the compiler. Not intended for direct use by application code.
// Exported as both `template` (for compiler output) and `_template` (to signal internal use).

// Table child elements that need special parent wrapping for innerHTML parsing.
// Browsers auto-correct bare <tr>, <td>, etc. when orphaned — wrapping prevents silent drops.
const TABLE_WRAPPERS = {
  tr:       { depth: 2, wrap: '<table><tbody>',        unwrap: '</tbody></table>' },
  td:       { depth: 3, wrap: '<table><tbody><tr>',     unwrap: '</tr></tbody></table>' },
  th:       { depth: 3, wrap: '<table><tbody><tr>',     unwrap: '</tr></tbody></table>' },
  thead:    { depth: 1, wrap: '<table>',               unwrap: '</table>' },
  tbody:    { depth: 1, wrap: '<table>',               unwrap: '</table>' },
  tfoot:    { depth: 1, wrap: '<table>',               unwrap: '</table>' },
  colgroup: { depth: 1, wrap: '<table>',               unwrap: '</table>' },
  col:      { depth: 1, wrap: '<table>',               unwrap: '</table>' },
  caption:  { depth: 1, wrap: '<table>',               unwrap: '</table>' },
};

// SVG element tags that must be created in an SVG namespace context.
const SVG_ELEMENTS = new Set([
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
  'g', 'defs', 'use', 'text', 'tspan', 'foreignObject', 'clipPath', 'mask',
  'pattern', 'linearGradient', 'radialGradient', 'stop', 'marker', 'symbol',
  'image', 'animate', 'animateTransform', 'animateMotion', 'set',
  'filter', 'feGaussianBlur', 'feOffset', 'feMerge', 'feMergeNode',
  'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite',
  'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap',
  'feFlood', 'feImage', 'feMorphology', 'feSpecularLighting',
  'feTile', 'feTurbulence', 'feDistantLight', 'fePointLight', 'feSpotLight',
]);

function getLeadingTag(html) {
  const m = html.match(/^<([a-zA-Z][a-zA-Z0-9]*)/);
  return m ? m[1] : '';
}

// Internal implementation — no warnings. Used by compiler via _$template.
function _$templateImpl(html) {
  const trimmed = html.trim();
  const tag = getLeadingTag(trimmed);

  // SVG namespace: parse inside an SVG container then extract
  if (SVG_ELEMENTS.has(tag)) {
    return svgTemplate(trimmed);
  }

  // Table element wrapping: parse inside proper table parent then extract
  const tableInfo = TABLE_WRAPPERS[tag];
  if (tableInfo) {
    const t = document.createElement('template');
    t.innerHTML = tableInfo.wrap + trimmed + tableInfo.unwrap;
    // Pre-navigate to the target element once — avoids per-clone traversal.
    let target = t.content.firstChild;
    for (let i = 0; i < tableInfo.depth; i++) target = target.firstChild;
    return () => target.cloneNode(true);
  }

  const t = document.createElement('template');
  t.innerHTML = trimmed;
  return () => t.content.firstChild.cloneNode(true);
}

// Public export — warns in dev mode that this is a compiler internal.
// Application code should use JSX, which the compiler transforms into _$template calls.
let _templateWarned = false;
export function template(html) {
  if (__DEV__ && !_templateWarned) {
    _templateWarned = true;
    console.warn(
      '[what] template() is a compiler internal. Use JSX instead. ' +
      'Direct calls with user input can lead to XSS vulnerabilities.'
    );
  }
  return _$templateImpl(html);
}

// Compiler-internal alias — preferred name for compiled output (no warning)
export { _$templateImpl as _$template };

// Legacy alias kept for backwards compat
export { template as _template };

// --- svgTemplate(html) ---
// Parse SVG content inside an SVG namespace container. Without this, innerHTML on a
// <template> element creates HTML-namespace nodes, making SVG elements invisible.
// If the HTML is a complete <svg> tag, it is parsed inside a temporary <div> so the
// browser uses the correct SVG namespace. For inner SVG elements (path, circle, etc.),
// they are wrapped in an <svg> container for parsing and then extracted.

export function svgTemplate(html) {
  const trimmed = html.trim();
  const tag = getLeadingTag(trimmed);

  if (tag === 'svg') {
    // Complete <svg> element — parse in a div (browsers handle the namespace)
    const t = document.createElement('template');
    t.innerHTML = trimmed;
    return () => t.content.firstChild.cloneNode(true);
  }

  // Inner SVG element (path, circle, g, etc.) — wrap in <svg> for namespace context
  const t = document.createElement('template');
  t.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${trimmed}</svg>`;
  return () => t.content.firstChild.firstChild.cloneNode(true);
}

// --- insert(parent, child, marker?) ---
// Reactive child insertion. Handles all child types:
// - string/number → text node
// - function → effect that updates text node reactively
// - DOM node → append directly
// - array → insert each element

export function insert(parent, child, marker) {
  // mapArray inserter: self-managing reactive list with its own effect
  if (typeof child === 'function' && child._mapArray) {
    return child(parent, marker || null);
  }

  if (typeof child === 'function') {
    // Fast path: if the first evaluation returns a string/number, optimistically
    // create a text node for direct updates. If the value type changes later
    // (e.g., text -> vnode), fall back to full reconcileInsert.
    const first = child();
    const t = typeof first;
    if (t === 'string' || t === 'number') {
      const textNode = document.createTextNode(String(first));
      const m = marker || null;
      if (m) parent.insertBefore(textNode, m);
      else parent.appendChild(textNode);
      if (_onTextInsert) _onTextInsert(parent, String(first));
      let current = textNode;
      let isTextFastPath = true;
      effect(() => {
        const val = child();
        const vt = typeof val;
        if (isTextFastPath && (vt === 'string' || vt === 'number')) {
          // Fast path: still text — update data directly (no allocations)
          const str = String(val);
          if (textNode.data !== str) textNode.data = str;
          if (_onTextInsert) _onTextInsert(parent, str);
        } else {
          // Type changed — fall back to full reconcile
          isTextFastPath = false;
          current = reconcileInsert(parent, val, current, m);
        }
      });
      return textNode;
    }
    // General path for non-text reactive children (first value was null/vnode/array).
    // Let the effect handle both the initial insert and subsequent updates to avoid
    // double-evaluating child() (which would create components twice on mount).
    let current = null;
    effect(() => {
      current = reconcileInsert(parent, child(), current, marker || null);
    });
    return current;
  }

  // Static text: create text node directly, skip reconcileInsert overhead
  if (typeof child === 'string' || typeof child === 'number') {
    const textNode = document.createTextNode(String(child));
    if (marker) parent.insertBefore(textNode, marker);
    else parent.appendChild(textNode);
    return textNode;
  }

  // Static DOM node: insert directly, skip reconcileInsert overhead
  if (child != null && typeof child === 'object' && child.nodeType > 0) {
    if (marker) parent.insertBefore(child, marker);
    else parent.appendChild(child);
    return child;
  }

  return reconcileInsert(parent, child, null, marker || null);
}

function isDomNode(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof Node !== 'undefined' && value instanceof Node) return true;
  return typeof value.nodeType === 'number' && typeof value.nodeName === 'string';
}

function isVNode(value) {
  return !!value && typeof value === 'object' && (value._vnode === true || 'tag' in value);
}

// Check if parent is an SVG element. Cached typeof check avoids repeated lookups.
const _hasSVGElement = typeof SVGElement !== 'undefined';
function isSvgParent(parent) {
  return _hasSVGElement
    && parent instanceof SVGElement
    && parent.tagName !== 'foreignObject';
}

function asNodeArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function valuesToNodes(value, parent, out) {
  if (value == null || typeof value === 'boolean') return out;

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      valuesToNodes(value[i], parent, out);
    }
    return out;
  }

  // Resolve function values (reactive accessors passed through props)
  if (typeof value === 'function') {
    valuesToNodes(value(), parent, out);
    return out;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    out.push(document.createTextNode(String(value)));
    return out;
  }

  if (isDomNode(value)) {
    // DocumentFragments lose their children on DOM insertion, making them
    // untrackable for reconciliation. Flatten to child nodes instead.
    if (value.nodeType === 11 && value.childNodes.length > 0) {
      const children = Array.from(value.childNodes);
      for (let i = 0; i < children.length; i++) {
        out.push(children[i]);
      }
    } else {
      out.push(value);
    }
    return out;
  }

  if (isVNode(value)) {
    out.push(createDOM(value, parent, isSvgParent(parent)));
    return out;
  }

  out.push(document.createTextNode(String(value)));
  return out;
}

function sameNodeArray(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function reconcileInsert(parent, value, current, marker) {
  // Guard: parent must be a node that supports child operations.
  // This catches cases where a stale DOM reference (e.g., a comment node from
  // shifted childNodes indices) is mistakenly passed as the parent.
  if (!parent || typeof parent.insertBefore !== 'function') {
    if (__DEV__) {
      console.warn('[what] reconcileInsert called with invalid parent:', parent);
    }
    return current;
  }

  const targetMarker = marker || null;

  if (value == null || typeof value === 'boolean') {
    const oldNodes = asNodeArray(current);
    for (let i = 0; i < oldNodes.length; i++) {
      const oldNode = oldNodes[i];
      if (oldNode.parentNode === parent) {
        disposeTree(oldNode);
        parent.removeChild(oldNode);
      }
    }
    return null;
  }

  if ((typeof value === 'string' || typeof value === 'number')
      && current && !Array.isArray(current) && current.nodeType === 3) {
    const text = String(value);
    if (current.data !== text) current.data = text;
    return current;
  }

  // Fast path: single DOM node value with single current node — skip array allocations
  if (typeof value === 'object' && value !== null && value.nodeType > 0 && !Array.isArray(value)) {
    if (value === current) return current;
    if (current && !Array.isArray(current) && current.nodeType > 0) {
      // Replace single node with single node
      if (current.parentNode === parent) {
        disposeTree(current);
        parent.replaceChild(value, current);
      } else {
        if (targetMarker) parent.insertBefore(value, targetMarker);
        else parent.appendChild(value);
      }
      return value;
    }
  }

  const newNodes = valuesToNodes(value, parent, []);
  const oldNodes = asNodeArray(current);

  if (sameNodeArray(oldNodes, newNodes)) {
    return current;
  }

  // Remove old nodes not in the new set. For small arrays (typical case),
  // linear scan is faster than Set allocation + hashing.
  const newLen = newNodes.length;
  for (let i = 0; i < oldNodes.length; i++) {
    const oldNode = oldNodes[i];
    if (oldNode.parentNode !== parent) continue;
    let found = false;
    for (let j = 0; j < newLen; j++) {
      if (newNodes[j] === oldNode) { found = true; break; }
    }
    if (!found) {
      disposeTree(oldNode);
      parent.removeChild(oldNode);
    }
  }

  let ref = targetMarker;
  for (let i = newNodes.length - 1; i >= 0; i--) {
    const node = newNodes[i];
    if (node.parentNode !== parent || node.nextSibling !== ref) {
      // Guard against stale ref from nested reconciliation
      if (ref && ref.parentNode !== parent) ref = null;
      if (ref) parent.insertBefore(node, ref);
      else parent.appendChild(node);
    }
    ref = node;
  }

  if (newNodes.length === 0) return null;
  return newNodes.length === 1 ? newNodes[0] : newNodes;
}

// --- mapArray(source, mapFn, options?) ---
// Reactive list rendering with per-item scopes.
// Unkeyed: tracks items by reference. Keyed: tracks by key function.
// With key + raw: mapFn receives (item, index) — raw item value. Items identified by key for
//   efficient DOM reuse/moves. Use when items have per-field signals (no wrapper needed).
// With key (no raw): mapFn receives (itemAccessor, index) — accessor is a signal getter.
//   When item reference changes but key persists, the signal updates in place.
// Without key: mapFn receives (item, index) — raw item value. New reference = new row.

export function mapArray(source, mapFn, options) {
  const keyFn = options?.key;
  const raw = options?.raw || false;

  const inserter = (parent, marker) => {
    let items = [];
    let mappedNodes = [];
    let disposeFns = [];
    // Keyed mode state: key → { itemSignal }. Null for raw/unkeyed modes.
    let keyedState = keyFn && !raw ? new Map() : null;

    const endMarker = document.createComment('/list');
    parent.insertBefore(endMarker, marker || null);

    effect(() => {
      const newItems = source() || [];
      if (keyFn) {
        reconcileKeyed(parent, endMarker, items, newItems, mappedNodes, disposeFns, mapFn, keyFn, keyedState);
      } else {
        reconcileList(parent, endMarker, items, newItems, mappedNodes, disposeFns, mapFn);
      }
      // Save a snapshot of items for next diff. Use slice() to defend against
      // in-place mutation, but skip for empty arrays (common clear case).
      items = newItems.length > 0 ? newItems.slice() : newItems;
    });

    return endMarker;
  };
  inserter._mapArray = true;
  return inserter;
}

function reconcileList(parent, endMarker, oldItems, newItems, mappedNodes, disposeFns, mapFn) {
  const newLen = newItems.length;
  const oldLen = oldItems.length;

  if (newLen === 0) {
    // Fast path: clear all — dispose reactive scopes first (handles effects/cleanups),
    // then remove DOM nodes. createRoot disposal handles all tracked effects; we only
    // need disposeTree for nodes with additional reactive bindings outside createRoot.
    if (oldLen > 0) {
      for (let i = 0; i < oldLen; i++) {
        if (disposeFns[i]) disposeFns[i]();
      }
      for (let i = oldLen - 1; i >= 0; i--) {
        const node = mappedNodes[i];
        if (node) {
          // Only walk subtree if the node has reactive state not tracked by createRoot
          if (node._componentCtx || node._dispose || node._propEffects) {
            disposeTree(node);
          }
          if (node.parentNode === parent) parent.removeChild(node);
        }
      }
      mappedNodes.length = 0;
      disposeFns.length = 0;
    }
    return;
  }

  if (oldLen === 0) {
    // Fast path: all new
    const frag = document.createDocumentFragment();
    for (let i = 0; i < newLen; i++) {
      const item = newItems[i];
      const node = _createItemScope(dispose => {
        disposeFns[i] = dispose;
        return mapFn(item, i);
      });
      mappedNodes[i] = node;
      frag.appendChild(node);
    }
    parent.insertBefore(frag, endMarker);
    return;
  }

  // --- Common prefix/suffix skip ---
  let start = 0;
  const minLen = Math.min(oldLen, newLen);
  while (start < minLen && oldItems[start] === newItems[start]) start++;

  // If everything matches and same length, nothing changed
  if (start === oldLen && start === newLen) return;

  let oldEnd = oldLen - 1;
  let newEnd = newLen - 1;
  while (oldEnd >= start && newEnd >= start && oldItems[oldEnd] === newItems[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  // Copy prefix/suffix into output arrays
  const newMapped = new Array(newLen);
  const newDispose = new Array(newLen);
  for (let i = 0; i < start; i++) {
    newMapped[i] = mappedNodes[i];
    newDispose[i] = disposeFns[i];
  }
  for (let i = newEnd + 1; i < newLen; i++) {
    // Suffix items: same item, possibly different index offset
    const oldI = oldEnd + 1 + (i - newEnd - 1);
    newMapped[i] = mappedNodes[oldI];
    newDispose[i] = disposeFns[oldI];
  }

  // Only reconcile the middle section: start..newEnd (new) vs start..oldEnd (old)
  const midNewLen = newEnd - start + 1;
  const midOldLen = oldEnd - start + 1;

  if (midNewLen === 0) {
    // Only removals in the middle
    for (let i = start; i <= oldEnd; i++) {
      disposeFns[i]?.();
      if (mappedNodes[i]?.parentNode) mappedNodes[i].parentNode.removeChild(mappedNodes[i]);
    }
  } else if (midOldLen === 0) {
    // Only insertions in the middle
    const marker = start < newLen && newMapped[newEnd + 1] ? newMapped[newEnd + 1] : endMarker;
    const frag = document.createDocumentFragment();
    for (let i = start; i <= newEnd; i++) {
      const item = newItems[i];
      const idx = i;
      newMapped[i] = _createItemScope(dispose => {
        newDispose[idx] = dispose;
        return mapFn(item, idx);
      });
      frag.appendChild(newMapped[i]);
    }
    parent.insertBefore(frag, marker);
  } else {
    // General case: reconcile middle section with LIS
    _reconcileMiddle(parent, endMarker, oldItems, newItems, mappedNodes, disposeFns,
                     mapFn, start, oldEnd, newEnd, newMapped, newDispose);
  }

  // Update arrays in place
  mappedNodes.length = newLen;
  disposeFns.length = newLen;
  for (let i = 0; i < newLen; i++) {
    mappedNodes[i] = newMapped[i];
    disposeFns[i] = newDispose[i];
  }
}

function _reconcileMiddle(parent, endMarker, oldItems, newItems, mappedNodes, disposeFns,
                          mapFn, start, oldEnd, newEnd, newMapped, newDispose) {
  // Build index map only for the middle section
  const oldIdxMap = new Map();
  for (let i = start; i <= oldEnd; i++) {
    oldIdxMap.set(oldItems[i], i);
  }

  // Match old items to new positions, collect old indices for LIS
  const midLen = newEnd - start + 1;
  const oldIndices = new Int32Array(midLen); // -1 = new item
  oldIndices.fill(-1);

  for (let i = start; i <= newEnd; i++) {
    const oldIdx = oldIdxMap.get(newItems[i]);
    if (oldIdx !== undefined) {
      oldIdxMap.delete(newItems[i]);
      newMapped[i] = mappedNodes[oldIdx];
      newDispose[i] = disposeFns[oldIdx];
      oldIndices[i - start] = oldIdx;
    }
  }

  // Dispose removed items
  for (const [, oldIdx] of oldIdxMap) {
    disposeFns[oldIdx]?.();
    if (mappedNodes[oldIdx]?.parentNode) mappedNodes[oldIdx].parentNode.removeChild(mappedNodes[oldIdx]);
  }

  // Compute LIS on old indices of reused items
  // Build the sequence of old indices for reused items only
  const reusedCount = midLen - _countNeg1(oldIndices, midLen);

  // Use a bitfield (via Uint8Array) to mark LIS positions — avoids Set overhead
  const inLIS = new Uint8Array(midLen);

  if (reusedCount > 1) {
    const seq = new Int32Array(reusedCount);
    const seqToMid = new Int32Array(reusedCount); // maps seq index → mid index
    let k = 0;
    for (let i = 0; i < midLen; i++) {
      if (oldIndices[i] !== -1) {
        seq[k] = oldIndices[i];
        seqToMid[k] = i;
        k++;
      }
    }
    const lisResult = _lis(seq, reusedCount);
    for (let i = 0; i < lisResult.length; i++) {
      inLIS[seqToMid[lisResult[i]]] = 1;
    }
  } else if (reusedCount === 1) {
    // Single reused item is trivially in LIS
    for (let i = 0; i < midLen; i++) {
      if (oldIndices[i] !== -1) { inLIS[i] = 1; break; }
    }
  }

  // Create new items
  for (let i = start; i <= newEnd; i++) {
    if (!newMapped[i]) {
      const item = newItems[i];
      const idx = i;
      newMapped[i] = _createItemScope(dispose => {
        newDispose[idx] = dispose;
        return mapFn(item, idx);
      });
    }
  }

  // Position: work backwards from the item after newEnd (suffix start or endMarker)
  let nextSibling = newEnd + 1 < newMapped.length && newMapped[newEnd + 1]
    ? newMapped[newEnd + 1] : endMarker;

  for (let i = newEnd; i >= start; i--) {
    const mi = i - start;
    if (oldIndices[mi] === -1 || !inLIS[mi]) {
      // New item or moved item — insert
      // Guard against stale nextSibling from nested reconciliation
      if (nextSibling && nextSibling.parentNode !== parent) nextSibling = endMarker;
      parent.insertBefore(newMapped[i], nextSibling);
    }
    nextSibling = newMapped[i];
  }
}

function _countNeg1(arr, len) {
  let c = 0;
  for (let i = 0; i < len; i++) if (arr[i] === -1) c++;
  return c;
}

// Longest Increasing Subsequence — returns indices into the input array.
// O(n log n) using patience sorting. Uses typed arrays for performance.
function _lis(arr, len) {
  if (len === 0) return [];
  if (len === 1) return [0];

  const tails = new Int32Array(len); // indices into arr
  const predecessors = new Int32Array(len);
  let tailLen = 1;
  tails[0] = 0;
  predecessors[0] = -1;

  for (let i = 1; i < len; i++) {
    if (arr[i] > arr[tails[tailLen - 1]]) {
      predecessors[i] = tails[tailLen - 1];
      tails[tailLen++] = i;
    } else {
      let lo = 0, hi = tailLen - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[tails[mid]] < arr[i]) lo = mid + 1;
        else hi = mid;
      }
      tails[lo] = i;
      predecessors[i] = lo > 0 ? tails[lo - 1] : -1;
    }
  }

  const result = new Array(tailLen);
  let k = tails[tailLen - 1];
  for (let i = tailLen - 1; i >= 0; i--) {
    result[i] = k;
    k = predecessors[k];
  }
  return result;
}

// --- reconcileKeyed ---
// Keyed reconciliation: tracks items by key function, not by reference.
// When a key persists but its item reference changes, the item signal updates
// in place — no DOM node destruction/creation. Only effects reading the
// item accessor re-run (e.g., textContent update for changed label).
//
// Multi-node items: Components return DocumentFragments (c:start, content, c:end).
// We track each item via a start-marker comment. Moving/removing an item moves
// all nodes from its marker up to (but not including) the next item's marker.

function _createItemMarker() {
  return document.createComment('i');
}

// Collect all DOM nodes belonging to one item (from its marker to beforeEnd).
function _collectItemNodes(marker, beforeEnd) {
  const nodes = [];
  let n = marker;
  while (n && n !== beforeEnd) {
    nodes.push(n);
    n = n.nextSibling;
  }
  return nodes;
}

// Move all nodes for an item (starting at marker) before `ref` in `parent`.
function _moveItem(parent, marker, beforeEnd, ref) {
  let n = marker;
  while (n && n !== beforeEnd) {
    const next = n.nextSibling;
    parent.insertBefore(n, ref);
    n = next;
  }
}

// Remove all nodes for an item from the DOM.
function _removeItemNodes(parent, marker, beforeEnd) {
  let n = marker;
  while (n && n !== beforeEnd) {
    const next = n.nextSibling;
    if (n._componentCtx || n._dispose || n._propEffects) disposeTree(n);
    parent.removeChild(n);
    n = next;
  }
}

// Create a new item: wraps mapFn result in a marker + appends to target.
function _createKeyedItem(target, item, idx, keyFn, keyedState, mapFn, mappedArr, disposeArr, signal_) {
  let accessor;
  if (keyedState) {
    const key = keyFn(item);
    const itemSig = signal_(item);
    accessor = itemSig;
    keyedState.set(key, { itemSig });
  } else {
    accessor = item;
  }
  const marker = _createItemMarker();
  target.appendChild(marker);
  const result = _createItemScope(dispose => {
    disposeArr[idx] = dispose;
    return mapFn(accessor, idx);
  });
  // result may be a DocumentFragment or a single node
  target.appendChild(result);
  mappedArr[idx] = marker;
}

function reconcileKeyed(parent, endMarker, oldItems, newItems, mappedNodes, disposeFns, mapFn, keyFn, keyedState) {
  const newLen = newItems.length;
  const oldLen = oldItems.length;

  // --- Fast path: clear all ---
  if (newLen === 0) {
    if (oldLen > 0) {
      for (let i = 0; i < oldLen; i++) {
        if (disposeFns[i]) disposeFns[i]();
      }
      // Remove all nodes between first item marker and endMarker
      if (mappedNodes[0]) {
        _removeItemNodes(parent, mappedNodes[0], endMarker);
      }
      mappedNodes.length = 0;
      disposeFns.length = 0;
      if (keyedState) keyedState.clear();
    }
    return;
  }

  // --- Fast path: all new ---
  if (oldLen === 0) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < newLen; i++) {
      _createKeyedItem(frag, newItems[i], i, keyFn, keyedState, mapFn, mappedNodes, disposeFns, signal);
    }
    parent.insertBefore(frag, endMarker);
    return;
  }

  // --- Common prefix: skip matching keys at the start ---
  let start = 0;
  const minLen = Math.min(oldLen, newLen);
  while (start < minLen) {
    if (oldItems[start] === newItems[start]) { start++; continue; }
    const oldKey = keyFn(oldItems[start]);
    const newKey = keyFn(newItems[start]);
    if (oldKey !== newKey) break;
    if (keyedState) keyedState.get(oldKey).itemSig.set(newItems[start]);
    start++;
  }

  // --- Common suffix: skip matching keys at the end ---
  let oldEnd = oldLen - 1;
  let newEnd = newLen - 1;
  while (oldEnd >= start && newEnd >= start) {
    if (oldItems[oldEnd] === newItems[newEnd]) { oldEnd--; newEnd--; continue; }
    const oldKey = keyFn(oldItems[oldEnd]);
    const newKey = keyFn(newItems[newEnd]);
    if (oldKey !== newKey) break;
    if (keyedState) keyedState.get(oldKey).itemSig.set(newItems[newEnd]);
    oldEnd--;
    newEnd--;
  }

  if (start > oldEnd && start > newEnd) return;

  const newMapped = new Array(newLen);
  const newDispose = new Array(newLen);
  for (let i = 0; i < start; i++) {
    newMapped[i] = mappedNodes[i];
    newDispose[i] = disposeFns[i];
  }
  for (let i = newEnd + 1; i < newLen; i++) {
    const oldI = oldEnd + 1 + (i - newEnd - 1);
    newMapped[i] = mappedNodes[oldI];
    newDispose[i] = disposeFns[oldI];
  }

  const midNewLen = newEnd - start + 1;
  const midOldLen = oldEnd - start + 1;

  // --- Only additions in middle ---
  if (midOldLen === 0) {
    const ref = newEnd + 1 < newLen && newMapped[newEnd + 1] ? newMapped[newEnd + 1] : endMarker;
    const frag = document.createDocumentFragment();
    for (let i = start; i <= newEnd; i++) {
      _createKeyedItem(frag, newItems[i], i, keyFn, keyedState, mapFn, newMapped, newDispose, signal);
    }
    parent.insertBefore(frag, ref);
    _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen);
    return;
  }

  // --- Only removals in middle ---
  if (midNewLen === 0) {
    for (let i = start; i <= oldEnd; i++) {
      disposeFns[i]?.();
      // Compute the range boundary from the live DOM. Sibling markers in
      // mappedNodes may have been detached by earlier iterations of this loop;
      // walking the DOM finds the next surviving item marker (or endMarker).
      const rangeEnd = _findNextMarkerAfter(parent, mappedNodes[i], mappedNodes, i, endMarker);
      _removeItemNodes(parent, mappedNodes[i], rangeEnd);
      if (keyedState) keyedState.delete(keyFn(oldItems[i]));
    }
    _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen);
    return;
  }

  // --- Fast paths for common small-move cases ---
  // Detect swap (2 mismatches) or single-move (contiguous shift) cheaply
  // before falling through to the expensive LIS + backward-walk general case.

  if (midNewLen === midOldLen && midNewLen >= 2 && midNewLen <= Math.max(midOldLen, 200)) {
    // Count positions where keys differ
    let mismatchCount = 0;
    let mm1 = -1, mm2 = -1; // first two mismatch indices (relative to start)
    for (let i = 0; i < midNewLen && mismatchCount <= 4; i++) {
      const oldKey = keyFn(oldItems[start + i]);
      const newKey = keyFn(newItems[start + i]);
      if (oldKey !== newKey) {
        if (mismatchCount === 0) mm1 = i;
        else if (mismatchCount === 1) mm2 = i;
        mismatchCount++;
      }
    }

    // --- Fast path A: Pure swap (exactly 2 key mismatches, keys exchanged) ---
    if (mismatchCount === 2) {
      const i1 = start + mm1, i2 = start + mm2;
      const oldKey1 = keyFn(oldItems[i1]), oldKey2 = keyFn(oldItems[i2]);
      const newKey1 = keyFn(newItems[i1]), newKey2 = keyFn(newItems[i2]);

      if (oldKey1 === newKey2 && oldKey2 === newKey1) {
        // Confirmed swap. Move item at i2's DOM position before item at i1's position,
        // then move i1's nodes to where i2 was.
        for (let i = 0; i < start; i++) {
          newMapped[i] = mappedNodes[i];
          newDispose[i] = disposeFns[i];
        }
        for (let i = start; i <= newEnd; i++) {
          newMapped[i] = mappedNodes[i];
          newDispose[i] = disposeFns[i];
        }
        for (let i = newEnd + 1; i < newLen; i++) {
          const oldI = oldEnd + 1 + (i - newEnd - 1);
          newMapped[i] = mappedNodes[oldI];
          newDispose[i] = disposeFns[oldI];
        }

        // Swap mapped entries
        const tmpM = newMapped[i1]; newMapped[i1] = newMapped[i2]; newMapped[i2] = tmpM;
        const tmpD = newDispose[i1]; newDispose[i1] = newDispose[i2]; newDispose[i2] = tmpD;

        // Update keyed state signals if item references differ
        if (keyedState) {
          if (newItems[i1] !== oldItems[i1]) {
            const k = keyFn(newItems[i1]);
            const entry = keyedState.get(k);
            if (entry) entry.itemSig.set(newItems[i1]);
          }
          if (newItems[i2] !== oldItems[i2]) {
            const k = keyFn(newItems[i2]);
            const entry = keyedState.get(k);
            if (entry) entry.itemSig.set(newItems[i2]);
          }
        }

        // DOM moves: move i2's nodes before i1's marker, then move i1's old nodes to i2's spot.
        // We need a reference point for where i2 was.
        const marker1 = newMapped[i1]; // was mappedNodes[i2] — the marker for the item now at i1
        const marker2 = newMapped[i2]; // was mappedNodes[i1] — the marker for the item now at i2
        const end1 = _findNextMarkerAfter(parent, mappedNodes[i1], mappedNodes, i1, endMarker);
        const end2 = _findNextMarkerAfter(parent, mappedNodes[i2], mappedNodes, i2, endMarker);

        // Insert a temporary placeholder at i2's original position
        const placeholder = document.createComment('tmp');
        parent.insertBefore(placeholder, mappedNodes[i2]);

        // Move i2's nodes to before i1's current position
        _moveItem(parent, mappedNodes[i2], end2, mappedNodes[i1]);
        // Move i1's nodes to where i2 was (before placeholder)
        _moveItem(parent, mappedNodes[i1], end1, placeholder);
        // Remove placeholder
        parent.removeChild(placeholder);

        _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen);
        return;
      }
    }

    // --- Fast path B: Single item relocated ---
    // One item removed from position `from` and inserted at position `to`,
    // everything between shifted by one.
    if (mismatchCount >= 2 && mismatchCount <= midNewLen) {
      // Try to detect single-move pattern:
      // If we remove element at `from` in old and insert at `to` in new,
      // the rest should match.
      // Forward move: old[from] = new[to], old[from+1..to] = new[from..to-1]
      // Backward move: old[from] = new[to], old[to..from-1] = new[to+1..from]

      const fromRel = mm1; // first mismatch - the moved item was here in old OR went here in new
      let movedKey = null;
      let fromAbs = -1, toAbs = -1;
      let isMove = false;

      // Check forward move: item at old[start+fromRel] moved later
      const candidateKey = keyFn(oldItems[start + fromRel]);
      // Find where this key ended up in new
      let destRel = -1;
      for (let i = fromRel; i < midNewLen; i++) {
        if (keyFn(newItems[start + i]) === candidateKey) { destRel = i; break; }
      }
      if (destRel > fromRel) {
        // Verify: old[fromRel+1..destRel] should match new[fromRel..destRel-1]
        let match = true;
        for (let i = fromRel; i < destRel; i++) {
          if (keyFn(oldItems[start + i + 1]) !== keyFn(newItems[start + i])) { match = false; break; }
        }
        if (match) {
          // And everything after destRel should be the same
          let afterMatch = true;
          for (let i = destRel + 1; i < midNewLen; i++) {
            if (keyFn(oldItems[start + i]) !== keyFn(newItems[start + i])) { afterMatch = false; break; }
          }
          if (afterMatch) {
            isMove = true;
            fromAbs = start + fromRel;
            toAbs = start + destRel;
            movedKey = candidateKey;
          }
        }
      }

      if (!isMove) {
        // Check backward move: item from later in old moved to start+fromRel in new
        const candidateKey2 = keyFn(newItems[start + fromRel]);
        let srcRel = -1;
        for (let i = fromRel; i < midOldLen; i++) {
          if (keyFn(oldItems[start + i]) === candidateKey2) { srcRel = i; break; }
        }
        if (srcRel > fromRel) {
          // Verify: old[fromRel..srcRel-1] should match new[fromRel+1..srcRel]
          let match = true;
          for (let i = fromRel; i < srcRel; i++) {
            if (keyFn(oldItems[start + i]) !== keyFn(newItems[start + i + 1])) { match = false; break; }
          }
          if (match) {
            let afterMatch = true;
            for (let i = srcRel + 1; i < midNewLen; i++) {
              if (keyFn(oldItems[start + i]) !== keyFn(newItems[start + i])) { afterMatch = false; break; }
            }
            if (afterMatch) {
              isMove = true;
              fromAbs = start + srcRel;
              toAbs = start + fromRel;
              movedKey = candidateKey2;
            }
          }
        }
      }

      if (isMove) {
        // Copy all mapped/dispose to new arrays
        for (let i = start; i <= oldEnd; i++) {
          newMapped[i] = mappedNodes[i];
          newDispose[i] = disposeFns[i];
        }

        // Shift entries in newMapped/newDispose to reflect the move
        const movedMarker = newMapped[fromAbs];
        const movedDispose = newDispose[fromAbs];

        if (fromAbs < toAbs) {
          // Forward move: shift [from+1..to] left by 1
          for (let i = fromAbs; i < toAbs; i++) {
            newMapped[i] = newMapped[i + 1];
            newDispose[i] = newDispose[i + 1];
          }
        } else {
          // Backward move: shift [to..from-1] right by 1
          for (let i = fromAbs; i > toAbs; i--) {
            newMapped[i] = newMapped[i - 1];
            newDispose[i] = newDispose[i - 1];
          }
        }
        newMapped[toAbs] = movedMarker;
        newDispose[toAbs] = movedDispose;

        // Update keyed state signals for items whose references changed
        if (keyedState) {
          for (let i = start; i <= newEnd; i++) {
            const key = keyFn(newItems[i]);
            if (newItems[i] !== oldItems[i]) {
              // Only look up oldItems[i] by key if index is in old range
              const entry = keyedState.get(key);
              if (entry) entry.itemSig.set(newItems[i]);
            }
          }
        }

        // Single DOM move: move the item's nodes to its new position
        const movedEnd = _findNextMarkerAfter(parent, movedMarker, mappedNodes, fromAbs, endMarker);
        // Find the reference node: the marker of the item that should come AFTER the moved item
        let ref;
        if (toAbs + 1 < newLen) {
          ref = newMapped[toAbs + 1];
        } else {
          ref = endMarker;
        }
        // For suffix items, use the actual mapped marker
        if (toAbs >= newEnd + 1 || (ref && ref.parentNode !== parent)) {
          ref = endMarker;
        }
        _moveItem(parent, movedMarker, movedEnd, ref);

        _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen);
        return;
      }
    }
  }

  // --- General case: reconcile middle section ---
  const oldKeyMap = new Map();
  for (let i = start; i <= oldEnd; i++) {
    oldKeyMap.set(keyFn(oldItems[i]), i);
  }

  const oldIndices = new Int32Array(midNewLen);
  oldIndices.fill(-1);

  for (let i = start; i <= newEnd; i++) {
    const key = keyFn(newItems[i]);
    const oldIdx = oldKeyMap.get(key);
    if (oldIdx !== undefined) {
      oldKeyMap.delete(key);
      newMapped[i] = mappedNodes[oldIdx];
      newDispose[i] = disposeFns[oldIdx];
      oldIndices[i - start] = oldIdx;
      if (keyedState && newItems[i] !== oldItems[oldIdx]) {
        keyedState.get(key).itemSig.set(newItems[i]);
      }
    }
  }

  // Dispose removed items (iterate in reverse to avoid shifting boundaries)
  const removedIndices = [...oldKeyMap.values()].sort((a, b) => b - a);
  for (const oldIdx of removedIndices) {
    disposeFns[oldIdx]?.();
    // Compute the range boundary from the live DOM. Adjacent removals can
    // detach mappedNodes[oldIdx + 1] before we get here, so we cannot trust
    // that reference — walk the DOM to find the next surviving item marker.
    const rangeEnd = _findNextMarkerAfter(parent, mappedNodes[oldIdx], mappedNodes, oldIdx, endMarker);
    _removeItemNodes(parent, mappedNodes[oldIdx], rangeEnd);
    if (keyedState) keyedState.delete(keyFn(oldItems[oldIdx]));
  }

  // Create new items (into a detached fragment, then positioned below)
  for (let i = start; i <= newEnd; i++) {
    if (!newMapped[i]) {
      const frag = document.createDocumentFragment();
      _createKeyedItem(frag, newItems[i], i, keyFn, keyedState, mapFn, newMapped, newDispose, signal);
      // Leave in frag for now — will be positioned in the move pass
      newMapped[i]._frag = frag;
    }
  }

  // Position using LIS
  let reusedCount = 0;
  let alreadySorted = true;
  let lastOldIdx = -1;
  for (let i = 0; i < midNewLen; i++) {
    if (oldIndices[i] !== -1) {
      reusedCount++;
      if (oldIndices[i] <= lastOldIdx) alreadySorted = false;
      lastOldIdx = oldIndices[i];
    }
  }

  const inLIS = new Uint8Array(midNewLen);

  if (alreadySorted) {
    for (let i = 0; i < midNewLen; i++) {
      if (oldIndices[i] !== -1) inLIS[i] = 1;
    }
  } else if (reusedCount > 1) {
    const seq = new Int32Array(reusedCount);
    const seqToMid = new Int32Array(reusedCount);
    let k = 0;
    for (let i = 0; i < midNewLen; i++) {
      if (oldIndices[i] !== -1) {
        seq[k] = oldIndices[i];
        seqToMid[k] = i;
        k++;
      }
    }
    const lisResult = _lis(seq, reusedCount);
    for (let i = 0; i < lisResult.length; i++) {
      inLIS[seqToMid[lisResult[i]]] = 1;
    }
  } else if (reusedCount === 1) {
    for (let i = 0; i < midNewLen; i++) {
      if (oldIndices[i] !== -1) { inLIS[i] = 1; break; }
    }
  }

  // Position: work backwards, move items not in LIS
  // For existing items: move all nodes from marker to next-item boundary.
  // For new items: insert from their detached fragment.
  // We rebuild the output array to reflect final positions.
  _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen);

  // Start ref at the first suffix item's marker (not endMarker) so moved items
  // land before the suffix, not after it.
  let ref = newEnd + 1 < newLen && mappedNodes[newEnd + 1]
    ? mappedNodes[newEnd + 1] : endMarker;
  for (let i = newEnd; i >= start; i--) {
    const mi = i - start;
    const marker = mappedNodes[i];

    if (oldIndices[mi] === -1) {
      // New item — insert from detached fragment
      if (marker._frag) {
        parent.insertBefore(marker._frag, ref);
        delete marker._frag;
      }
    } else if (!inLIS[mi]) {
      // Existing item not in LIS — move all its nodes
      const nextItemMarker = _findNextMarkerAfter(parent, marker, mappedNodes, i, endMarker);
      _moveItem(parent, marker, nextItemMarker, ref);
    }
    ref = marker;
  }
}

// TODO(perf): cache item end boundary on marker if large keyed reorders show O(n²) hot paths.
// Find the boundary end for an item's nodes in the current DOM.
// Walks from the marker's nextSibling until we hit another item's marker or endMarker.
function _findNextMarkerAfter(parent, marker, mappedNodes, idx, endMarker) {
  // The item's nodes end at the next sibling that is either:
  // - another item's marker comment (data === 'i')
  // - the list endMarker (data === '/list')
  let n = marker.nextSibling;
  while (n && n !== endMarker) {
    if (n.nodeType === 8 && n.data === 'i') return n;
    n = n.nextSibling;
  }
  return endMarker;
}

function _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen) {
  mappedNodes.length = newLen;
  disposeFns.length = newLen;
  for (let i = 0; i < newLen; i++) {
    mappedNodes[i] = newMapped[i];
    disposeFns[i] = newDispose[i];
  }
}

// --- spread(el, props) ---
// Fine-grained prop effects. Function props create individual effects.
// Event props use direct assignment.

export function spread(el, props) {
  for (const key in props) {
    const value = props[key];

    if (key.startsWith('on') && key.length > 2) {
      // Event handler — direct assignment. Use $$name for delegated events.
      const event = key.slice(2).toLowerCase();
      el.addEventListener(event, value);
      continue;
    }

    if (typeof value === 'function' && !key.startsWith('on')) {
      // Reactive prop — create micro-effect. The disposer must be registered
      // on el._propEffects so disposeTree() (dom.js) tears it down when the
      // element unmounts; otherwise the effect keeps firing on signal writes
      // for a detached element. Mirror the setProp() pattern.
      if (!el._propEffects) el._propEffects = {};
      // If a previous spread/setProp already registered an effect for this
      // key, dispose it first to avoid double-tracking.
      if (el._propEffects[key]) {
        try { el._propEffects[key](); } catch (e) { /* already disposed */ }
      }
      if (key === 'class' || key === 'className') {
        el._propEffects[key] = effect(() => {
          const cls = value() || '';
          if (_hasSVGElement && el instanceof SVGElement) el.setAttribute('class', cls);
          else el.className = cls;
        });
      } else if (key === 'style' && typeof value() === 'object') {
        el._propEffects[key] = effect(() => {
          const styles = value();
          for (const prop in styles) {
            el.style[prop] = styles[prop] ?? '';
          }
        });
      } else {
        el._propEffects[key] = effect(() => { setProp(el, key, value()); });
      }
    } else {
      // Static prop
      setProp(el, key, value);
    }
  }
}

// NOTE: this is the fine-grained-compiler path's setProp. A second
// implementation lives in dom.js (h()/diff path). See the longer note above
// the dom.js version. Key differences vs. dom.js setProp:
//   - assumes events are handled by the compiler (delegation or direct
//     addEventListener) — no el._events bookkeeping here.
//   - sanitizes URL attributes (href/src) against javascript: protocol.
//   - enforces innerHTML must be { __html: ... } — plain strings are warned.
// Both share the el._propEffects[key] disposer convention so disposeTree()
// can tear down reactive prop effects on unmount.
export function setProp(el, key, value) {
  // Ref handling — assign element to ref object/callback (defense in depth)
  if (key === 'ref') {
    if (typeof value === 'function') value(el);
    else if (value && typeof value === 'object') value.current = el;
    return;
  }

  // Key prop — no-op, WhatFW has no virtual DOM (defense in depth, issue #6)
  if (key === 'key') return;

  // Reactive accessor: function values on non-event props are treated as
  // reactive getters. Wrap in an effect so the prop auto-updates. Track the
  // disposer on el._propEffects so disposeTree() tears it down on unmount —
  // mirrors the pattern in dom.js setProp / spread().
  if (typeof value === 'function' && !key.startsWith('on')) {
    if (!el._propEffects) el._propEffects = {};
    if (el._propEffects[key]) {
      try { el._propEffects[key](); } catch (e) { /* already disposed */ }
    }
    el._propEffects[key] = effect(() => setProp(el, key, value()));
    return;
  }

  // Sanitize URL attributes — reject dangerous protocols
  if (URL_ATTRS.has(key) || URL_ATTRS.has(key.toLowerCase())) {
    if (!isSafeUrl(value)) {
      if (typeof console !== 'undefined') {
        console.warn(`[what] Blocked unsafe URL in "${key}" attribute: ${value}`);
      }
      return;
    }
  }

  const isSvg = _hasSVGElement && el instanceof SVGElement;

  if (key === 'class' || key === 'className') {
    if (isSvg) {
      el.setAttribute('class', value || '');
    } else {
      el.className = value || '';
    }
  } else if (key === 'dangerouslySetInnerHTML') {
    const html = value?.__html ?? '';
    if (typeof __DEV__ !== 'undefined' && __DEV__ && typeof html === 'string' && /(<script|onerror\s*=|onload\s*=|javascript:)/i.test(html)) {
      console.warn('[what] dangerouslySetInnerHTML contains potential XSS vectors. Ensure content is sanitized.');
    }
    el.innerHTML = html;
  } else if (key === 'innerHTML') {
    if (value && typeof value === 'object' && '__html' in value) {
      const html = value.__html ?? '';
      if (typeof __DEV__ !== 'undefined' && __DEV__ && typeof html === 'string' && /(<script|onerror\s*=|onload\s*=|javascript:)/i.test(html)) {
        console.warn('[what] dangerouslySetInnerHTML contains potential XSS vectors. Ensure content is sanitized.');
      }
      el.innerHTML = html;
    } else {
      if (typeof console !== 'undefined' && value != null && value !== '') {
        console.warn(
          '[what] Plain string innerHTML is not allowed. Use { __html: "..." } or dangerouslySetInnerHTML={{ __html: "..." }} instead.'
        );
      }
    }
  } else if (key === 'style') {
    if (typeof value === 'string') {
      el.style.cssText = value;
    } else if (typeof value === 'object') {
      for (const prop in value) {
        el.style[prop] = value[prop] ?? '';
      }
    }
  } else if (key.startsWith('data-') || key.startsWith('aria-')) {
    el.setAttribute(key, value);
  } else if (typeof value === 'boolean') {
    if (value) el.setAttribute(key, '');
    else el.removeAttribute(key);
  } else if (isSvg) {
    el.setAttribute(key, value);
  } else if (key === 'value' && el.tagName === 'SELECT') {
    _setSelectValue(el, value);
  } else if (key in el) {
    el[key] = value;
  } else {
    el.setAttribute(key, value);
  }
}

// --- delegateEvents(eventNames) ---
// Event delegation: common events handled at document level.
// Handlers stored as el.$$click, el.$$input, etc.
// Single listener per event type on document — reduces listener count from N to 1.

const delegatedEvents = new Set();

export function delegateEvents(eventNames) {
  for (const name of eventNames) {
    if (delegatedEvents.has(name)) continue;
    delegatedEvents.add(name);

    document.addEventListener(name, (e) => {
      let node = e.target;
      const key = '$$' + name;

      // Walk up the DOM tree looking for handlers
      while (node) {
        const handler = node[key];
        if (handler) {
          handler(e);
          if (e.cancelBubble) return;
        }
        node = node.parentNode;
      }
    });
  }
}

// --- addEventListener helper for non-delegated events ---
export function on(el, event, handler) {
  el.addEventListener(event, handler);
  return () => el.removeEventListener(event, handler);
}

// --- className helper for conditional classes ---
export function classList(el, classes) {
  effect(() => {
    for (const name in classes) {
      const value = typeof classes[name] === 'function' ? classes[name]() : classes[name];
      el.classList.toggle(name, !!value);
    }
  });
}

// =========================================================================
// DOM Hydration
// =========================================================================
// Reuses server-rendered DOM instead of creating new nodes.
// After hydration is complete, switches to normal rendering for updates.

let _isHydrating = false;
let _hydrationCursor = null;

export function isHydrating() {
  return _isHydrating;
}

/**
 * hydrate(vnode, container)
 * Walk existing DOM nodes in `container`, match them against the vnode tree,
 * attach reactive bindings, and skip cloneNode. Once done, switch to normal rendering.
 */
export function hydrate(vnode, container) {
  _isHydrating = true;
  _hydrationCursor = { parent: container, index: 0 };

  try {
    const result = hydrateNode(vnode, container);
    return result;
  } finally {
    _isHydrating = false;
    _hydrationCursor = null;
  }
}

/**
 * Claim the next DOM node from the hydration cursor.
 * Returns the existing DOM node or null if none available.
 */
function claimNode(parent) {
  const children = parent.childNodes;
  while (_hydrationCursor.index < children.length) {
    const node = children[_hydrationCursor.index];
    // Skip hydration comment markers
    if (node.nodeType === 8) { // Comment node
      const text = node.textContent;
      if (text === '$' || text === '/$' || text === '[]' || text === '/[]') {
        _hydrationCursor.index++;
        continue;
      }
    }
    _hydrationCursor.index++;
    return node;
  }
  return null;
}

function isDevMode() {
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
}

function hydrateNode(vnode, parent) {
  if (vnode == null || typeof vnode === 'boolean') {
    return null;
  }

  // Text node
  if (typeof vnode === 'string' || typeof vnode === 'number') {
    const existing = claimNode(parent);
    const text = String(vnode);

    if (existing && existing.nodeType === 3) {
      // Reuse text node — check for mismatch in dev
      if (isDevMode() && existing.textContent !== text) {
        console.warn(
          `[what] Hydration mismatch: expected text "${text}", got "${existing.textContent}"`
        );
        existing.textContent = text;
      }
      return existing;
    }

    // Mismatch: expected text node, got element or nothing
    if (isDevMode()) {
      console.warn(
        `[what] Hydration mismatch: expected text node "${text}", got ${existing ? existing.nodeName : 'nothing'}. Falling back to client render.`
      );
    }
    const textNode = document.createTextNode(text);
    if (existing) {
      parent.replaceChild(textNode, existing);
    } else {
      parent.appendChild(textNode);
    }
    return textNode;
  }

  // Reactive function child — attach effect to existing node
  if (typeof vnode === 'function') {
    // Unwrap to get the initial value for hydration
    const initialValue = vnode();
    let current = hydrateNode(initialValue, parent);

    // Set up reactive effect for future updates (normal rendering path)
    effect(() => {
      const value = vnode();
      // After hydration, this runs as normal insert
      if (!_isHydrating) {
        current = reconcileInsert(parent, value, current, null);
      }
    });
    return current;
  }

  // Array — hydrate each child
  if (Array.isArray(vnode)) {
    const nodes = [];
    for (const child of vnode) {
      const node = hydrateNode(child, parent);
      if (node) nodes.push(node);
    }
    return nodes.length === 1 ? nodes[0] : nodes;
  }

  // VNode — component or element
  if (typeof vnode === 'object' && vnode._vnode) {
    // Component — route through component context so hooks work during hydration
    if (typeof vnode.tag === 'function') {
      const componentStack = getComponentStack();
      const Component = vnode.tag;
      const props = vnode.props || {};
      const children = vnode.children || [];

      // Set up component context (mirrors createComponent in dom.js)
      const ctx = {
        hooks: [],
        hookIndex: 0,
        effects: [],
        cleanups: [],
        mounted: false,
        disposed: false,
        Component,
        _parentCtx: componentStack[componentStack.length - 1] || null,
        _errorBoundary: null,
      };

      // Push context so hooks can access it
      componentStack.push(ctx);

      let result;
      try {
        const propsChildren = children.length === 0 ? undefined
          : children.length === 1 ? children[0] : children;
        result = Component({ ...props, children: propsChildren });
      } catch (error) {
        componentStack.pop();
        console.error('[what] Error in component during hydration:', Component.name || 'Anonymous', error);
        return null;
      }

      componentStack.pop();
      ctx.mounted = true;

      // Run onMount callbacks after hydration
      if (ctx._mountCallbacks) {
        queueMicrotask(() => {
          if (ctx.disposed) return;
          for (const fn of ctx._mountCallbacks) {
            try { fn(); } catch (e) { console.error('[what] onMount error:', e); }
          }
        });
      }

      return hydrateNode(result, parent);
    }

    // Element — claim existing DOM element
    const existing = claimNode(parent);
    const expectedTag = vnode.tag.toUpperCase();

    if (existing && existing.nodeType === 1 && existing.nodeName === expectedTag) {
      // Match! Reuse this element. Apply props/bindings.
      hydrateElementProps(existing, vnode.props || {});

      // Hydrate children
      const savedCursor = _hydrationCursor;
      _hydrationCursor = { parent: existing, index: 0 };

      const rawInner = vnode.props?.dangerouslySetInnerHTML?.__html;
      if (rawInner == null) {
        for (const child of vnode.children) {
          hydrateNode(child, existing);
        }
      }

      _hydrationCursor = savedCursor;
      return existing;
    }

    // Mismatch — fall back to client render for this subtree
    if (isDevMode()) {
      console.warn(
        `[what] Hydration mismatch: expected <${vnode.tag}>, got ${existing ? existing.nodeName : 'nothing'}. Falling back to client render.`
      );
    }

    // Create the element from scratch
    const newEl = document.createElement(vnode.tag);
    for (const key in vnode.props || {}) {
      if (key === 'children' || key === 'key') continue;
      setProp(newEl, key, vnode.props[key]);
    }
    for (const child of vnode.children) {
      reconcileInsert(newEl, child, null, null);
    }
    if (existing) {
      parent.replaceChild(newEl, existing);
    } else {
      parent.appendChild(newEl);
    }
    return newEl;
  }

  // DOM node — use directly
  if (isDomNode(vnode)) {
    return vnode;
  }

  // Fallback — create text node
  const textNode = document.createTextNode(String(vnode));
  parent.appendChild(textNode);
  return textNode;
}

/**
 * Apply props to an existing hydrated element.
 * Attaches event handlers and reactive bindings without re-creating the element.
 */
function hydrateElementProps(el, props) {
  for (const key in props) {
    if (key === 'children' || key === 'key' || key === 'ref') continue;
    if (key === 'dangerouslySetInnerHTML' || key === 'innerHTML') continue;

    const value = props[key];

    // Event handlers — always attach (they don't exist in SSR HTML)
    if (key.startsWith('on') && key.length > 2) {
      const event = key.slice(2).toLowerCase();
      el.addEventListener(event, value);
      continue;
    }

    // Delegated events ($$click etc.)
    if (key.startsWith('$$')) {
      el[key] = value;
      continue;
    }

    // Reactive props — set up effects
    if (typeof value === 'function' && !key.startsWith('on')) {
      if (key === 'class' || key === 'className') {
        effect(() => { el.className = value() || ''; });
      } else if (key === 'style' && typeof value() === 'object') {
        effect(() => {
          const styles = value();
          for (const prop in styles) {
            el.style[prop] = styles[prop] ?? '';
          }
        });
      } else {
        effect(() => { setProp(el, key, value()); });
      }
      continue;
    }

    // Static props — skip attributes already set from SSR
    // Only attach non-serializable props or ones that may differ
    if (key === 'data-hk') continue;
  }
}
