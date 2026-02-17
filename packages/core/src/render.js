// What Framework - Fine-Grained Rendering Primitives
// Solid-style rendering: components run once, signals create individual DOM effects.
// No VDOM diffing — direct DOM manipulation with surgical signal-driven updates.

import { effect, untrack, createRoot, signal } from './reactive.js';

// --- template(html) ---
// Pre-parse HTML string into a <template> element. Returns a factory function
// that clones the DOM tree via cloneNode(true) — 2-5x faster than createElement chains.

export function template(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return () => t.content.firstChild.cloneNode(true);
}

// --- insert(parent, child, marker?) ---
// Reactive child insertion. Handles all child types:
// - string/number → text node
// - function → effect that updates text node reactively
// - DOM node → append directly
// - array → insert each element

export function insert(parent, child, marker) {
  if (child == null || typeof child === 'boolean') return;

  if (typeof child === 'string' || typeof child === 'number') {
    const textNode = document.createTextNode(String(child));
    parent.insertBefore(textNode, marker || null);
    return textNode;
  }

  if (typeof child === 'function') {
    // Reactive expression — create micro-effect
    let currentNode = document.createTextNode('');
    parent.insertBefore(currentNode, marker || null);

    effect(() => {
      const value = child();
      if (value instanceof Node) {
        // Function returned a DOM node — replace text node with it
        if (currentNode !== value) {
          parent.replaceChild(value, currentNode);
          currentNode = value;
        }
      } else if (Array.isArray(value)) {
        // Function returned array — handle dynamic lists
        _insertArray(parent, value, currentNode, marker);
      } else {
        // Primitive — update text content
        const text = value == null || typeof value === 'boolean' ? '' : String(value);
        if (currentNode.nodeType === 3) {
          if (currentNode.textContent !== text) currentNode.textContent = text;
        } else {
          const textNode = document.createTextNode(text);
          parent.replaceChild(textNode, currentNode);
          currentNode = textNode;
        }
      }
    });

    return currentNode;
  }

  if (child instanceof Node) {
    parent.insertBefore(child, marker || null);
    return child;
  }

  if (Array.isArray(child)) {
    const nodes = [];
    for (let i = 0; i < child.length; i++) {
      const node = insert(parent, child[i], marker);
      if (node) nodes.push(node);
    }
    return nodes;
  }
}

function _insertArray(parent, arr, currentNode, marker) {
  // Simple case: replace placeholder with array nodes
  const frag = document.createDocumentFragment();
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] instanceof Node) {
      frag.appendChild(arr[i]);
    } else if (arr[i] != null && typeof arr[i] !== 'boolean') {
      frag.appendChild(document.createTextNode(String(arr[i])));
    }
  }
  parent.replaceChild(frag, currentNode);
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

  return (parent, marker) => {
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
      items = newItems.slice();
    });

    return endMarker;
  };
}

function reconcileList(parent, endMarker, oldItems, newItems, mappedNodes, disposeFns, mapFn) {
  const newLen = newItems.length;
  const oldLen = oldItems.length;

  if (newLen === 0) {
    // Fast path: clear all
    if (oldLen > 0) {
      for (let i = 0; i < oldLen; i++) disposeFns[i]?.();
      parent.textContent = '';
      parent.appendChild(endMarker);
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
      const node = createRoot(dispose => {
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
      newMapped[i] = createRoot(dispose => {
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
      newMapped[i] = createRoot(dispose => {
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

function reconcileKeyed(parent, endMarker, oldItems, newItems, mappedNodes, disposeFns, mapFn, keyFn, keyedState) {
  const newLen = newItems.length;
  const oldLen = oldItems.length;

  // --- Fast path: clear all ---
  if (newLen === 0) {
    if (oldLen > 0) {
      // Skip individual disposal: per-row effects only subscribe to their item signal,
      // which is also being discarded. Both become unreachable → GC collects them.
      // Bulk DOM removal: clear parent, re-add marker.
      parent.textContent = '';
      parent.appendChild(endMarker);
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
      const item = newItems[i];
      const idx = i;
      let accessor;
      if (keyedState) {
        const key = keyFn(item);
        const itemSig = signal(item);
        accessor = itemSig;
        keyedState.set(key, { itemSig });
      } else {
        accessor = item; // raw mode: pass item directly
      }
      const node = createRoot(dispose => {
        disposeFns[idx] = dispose;
        return mapFn(accessor, idx);
      });
      mappedNodes[i] = node;
      frag.appendChild(node);
    }
    parent.insertBefore(frag, endMarker);
    return;
  }

  // --- Common prefix: skip matching keys at the start ---
  let start = 0;
  const minLen = Math.min(oldLen, newLen);
  while (start < minLen) {
    // Fast path: same reference → same key, no update needed
    if (oldItems[start] === newItems[start]) { start++; continue; }
    const oldKey = keyFn(oldItems[start]);
    const newKey = keyFn(newItems[start]);
    if (oldKey !== newKey) break;
    // Key matches but reference changed — update signal (non-raw mode only)
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

  // If everything matched, nothing to do
  if (start > oldEnd && start > newEnd) {
    // Just copy existing mappings to output
    return;
  }

  // Copy prefix/suffix into output arrays
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
    const marker = newEnd + 1 < newLen && newMapped[newEnd + 1] ? newMapped[newEnd + 1] : endMarker;
    const frag = document.createDocumentFragment();
    for (let i = start; i <= newEnd; i++) {
      const item = newItems[i];
      const idx = i;
      let accessor;
      if (keyedState) {
        const key = keyFn(item);
        const itemSig = signal(item);
        accessor = itemSig;
        keyedState.set(key, { itemSig });
      } else {
        accessor = item;
      }
      newMapped[i] = createRoot(dispose => {
        newDispose[idx] = dispose;
        return mapFn(accessor, idx);
      });
      frag.appendChild(newMapped[i]);
    }
    parent.insertBefore(frag, marker);
    _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen);
    return;
  }

  // --- Only removals in middle ---
  if (midNewLen === 0) {
    for (let i = start; i <= oldEnd; i++) {
      disposeFns[i]?.();
      if (mappedNodes[i]?.parentNode) parent.removeChild(mappedNodes[i]);
      if (keyedState) keyedState.delete(keyFn(oldItems[i]));
    }
    _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen);
    return;
  }

  // --- General case: reconcile middle section ---
  // Build old key → old index map for middle section only
  const oldKeyMap = new Map();
  for (let i = start; i <= oldEnd; i++) {
    oldKeyMap.set(keyFn(oldItems[i]), i);
  }

  const oldIndices = new Int32Array(midNewLen);
  oldIndices.fill(-1);

  // Match by key
  for (let i = start; i <= newEnd; i++) {
    const key = keyFn(newItems[i]);
    const oldIdx = oldKeyMap.get(key);
    if (oldIdx !== undefined) {
      oldKeyMap.delete(key);
      newMapped[i] = mappedNodes[oldIdx];
      newDispose[i] = disposeFns[oldIdx];
      oldIndices[i - start] = oldIdx;
      // Update item signal if reference changed (non-raw mode only)
      if (keyedState && newItems[i] !== oldItems[oldIdx]) {
        keyedState.get(key).itemSig.set(newItems[i]);
      }
    }
  }

  // Dispose removed items
  for (const [key, oldIdx] of oldKeyMap) {
    disposeFns[oldIdx]?.();
    if (mappedNodes[oldIdx]?.parentNode) parent.removeChild(mappedNodes[oldIdx]);
    if (keyedState) keyedState.delete(key);
  }

  // Create new items
  for (let i = start; i <= newEnd; i++) {
    if (!newMapped[i]) {
      const item = newItems[i];
      const idx = i;
      let accessor;
      if (keyedState) {
        const key = keyFn(item);
        const itemSig = signal(item);
        accessor = itemSig;
        keyedState.set(key, { itemSig });
      } else {
        accessor = item;
      }
      newMapped[i] = createRoot(dispose => {
        newDispose[idx] = dispose;
        return mapFn(accessor, idx);
      });
    }
  }

  // Position using LIS
  // First check: are reused items already in order? (common for update-in-place)
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
    // All reused items are in order — mark all as in LIS (no moves needed)
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

  // Position: work backwards, insert items not in LIS
  let nextSibling = newEnd + 1 < newMapped.length && newMapped[newEnd + 1]
    ? newMapped[newEnd + 1] : endMarker;

  for (let i = newEnd; i >= start; i--) {
    const mi = i - start;
    if (oldIndices[mi] === -1 || !inLIS[mi]) {
      parent.insertBefore(newMapped[i], nextSibling);
    }
    nextSibling = newMapped[i];
  }

  _copyBack(mappedNodes, disposeFns, newMapped, newDispose, newLen);
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
      // Reactive prop — create micro-effect
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
        effect(() => { setPropDirect(el, key, value()); });
      }
    } else {
      // Static prop
      setPropDirect(el, key, value);
    }
  }
}

function setPropDirect(el, key, value) {
  if (key === 'class' || key === 'className') {
    el.className = value || '';
  } else if (key === 'dangerouslySetInnerHTML') {
    el.innerHTML = value?.__html ?? '';
  } else if (key === 'innerHTML') {
    if (value && typeof value === 'object' && '__html' in value) {
      el.innerHTML = value.__html ?? '';
    } else {
      el.innerHTML = value ?? '';
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
