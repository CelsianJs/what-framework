/**
 * what-react/runtime — React-semantics renderer for compat components.
 *
 * What's core model is run-once + signals: components execute a single time and
 * hooks return signal ACCESSORS. Real React library code expects VALUES from
 * hooks and a re-render cycle (`const [count, setCount] = useState(0)` where
 * `count` is a number). This runtime provides those semantics WITHOUT touching
 * what-core:
 *
 * - Every component created through what-react's createElement/jsx-runtime is
 *   rendered by THIS runtime: per-instance hook state, value-returning hooks,
 *   and re-execution of the component function on state change.
 * - Re-render output is reconciled against the previous VNode tree (keyed,
 *   type-matched diff) so DOM elements and child component instances are
 *   PRESERVED across re-renders — focus, input state, and child hook state
 *   survive, like React.
 * - Granularity: only the instance whose state changed re-renders (plus its
 *   descendants via the normal React render cascade). Sibling/parent trees are
 *   untouched.
 * - What's own components are NOT handled here. Any vnode not created by
 *   what-react's createElement (no `_compat` flag / bridge tag) is delegated
 *   verbatim to what-core's renderer as an opaque subtree, so native What
 *   components keep their run-once + signal semantics inside compat trees.
 * - Compat components embedded in native What trees work through getBridge():
 *   a What component wrapper that mounts this runtime and cleans up via
 *   onCleanup.
 *
 * Known limitations (see REACT-COMPAT.md):
 * - SSR of compat components is not supported (browser/jsdom only).
 * - Suspense is minimal: fallback swap on thrown thenables (lazy(), use()).
 *   Suspended subtrees are unmounted while the fallback shows (state is lost),
 *   unlike React 18's Offscreen-preserving behavior.
 * - Errors thrown inside effects are logged, not routed to error boundaries.
 */

import { h, untrack, effect, runWithOwner, getOwner, mount as whatMount, onCleanup as whatOnCleanup } from 'what-core';
import { isVNode, _contextOf, isHydrating, _claimRegion, _afterWalk, _devHoldsState } from 'what-core/internal';
import { _$outside } from 'what-core/render';

/**
 * The key a native What subtree finds its compat host under (what-core
 * context): the compat instance it renders inside, set by a native component
 * that a React tree renders (mixed.js). A React island or a bridged compat
 * component created in that subtree takes the host as its parent, so React
 * context, Suspense and error boundaries reach across the native layer.
 */
export const HOST = Symbol.for('what-react.host');

/** The compat instance the current native code renders inside, or null. */
export function _hostInstance() {
  const map = _contextOf(HOST);
  return map === null ? null : map.get(HOST) ?? null;
}

// ---- VNode kinds ----
const KIND_HOLE = 0;      // null / undefined / boolean — placeholder comment (slot stability)
const KIND_TEXT = 1;      // string / number
const KIND_ELEMENT = 2;   // vnode with string tag
const KIND_COMPONENT = 3; // vnode created by what-react createElement (function type)
const KIND_OPAQUE = 4;    // What-native vnode / reactive function / raw DOM node → core renderer
const KIND_PORTAL = 5;    // '__portal' vnode (ReactDOM.createPortal)

const EMPTY_OBJ = {};

// =====================================================================
// Hook dispatcher state
// =====================================================================

/** @type {WhatCompatInstance | null} */
let currentInstance = null;

export function _getCurrentInstance() {
  return currentInstance;
}

/** @returns {WhatCompatInstance} */
export function _requireInstance(hookName) {
  if (!currentInstance) {
    // ERROR_CODES.HOOK_OUTSIDE_RENDER
    throw Object.assign(
      new Error(
        `[what-react] ${hookName}() called outside of a component render. ` +
        `Hooks can only be called while a what-react component is rendering. ` +
        `In an app that mixes native What and React files, a React hook runs only in a React file: ` +
        `a file is one when it imports react, calls a hook it imports from a React package, ` +
        `starts with /** @jsxImportSource react */, or matches reactCompat({ react }) (MIXED.md). ` +
        `If this happens inside a React library, make sure ALL react imports are ` +
        `aliased to what-react (one module instance) — see the reactCompat() vite plugin.`
      ),
      { code: 'ERR_HOOK_OUTSIDE_RENDER' },
    );
  }
  return currentInstance;
}

/**
 * Run `fn` (native What code: a native component a React tree mounts) as no
 * component's render, so a React hook called there fails as it would outside
 * every render instead of using the instance that is rendering.
 */
export function _outsideRender(fn) {
  const prev = currentInstance;
  currentInstance = null;
  try {
    return fn();
  } finally {
    currentInstance = prev;
  }
}

export function _getHookSlot(inst) {
  const i = inst.hookIndex++;
  let slot = inst.hooks[i];
  if (slot === undefined) {
    slot = inst.hooks[i] = {};
  }
  return slot;
}

// =====================================================================
// Scheduler — batched re-renders with infinite-loop guard
// =====================================================================

const dirtyQueue = new Set();
let flushScheduled = false;

export function scheduleUpdate(inst) {
  if (!inst || inst.unmounted) return;
  if (currentInstance === inst) {
    // Render-phase update (setState during render of the same component):
    // re-run the component function before committing, like React.
    inst._renderPhaseUpdate = true;
    return;
  }
  if (inst._server) return;
  dirtyQueue.add(inst);
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flushUpdates);
  }
}

export function flushUpdates() {
  flushScheduled = false;
  let cycles = 0;
  for (;;) {
    // React runs the last commit's passive effects before it renders again:
    // an effect never sees a later render's values first, and what it
    // registered (a listener, a layer in a registry) is in place before a
    // render reads it.
    _flushPendingPassive();
    if (dirtyQueue.size === 0) break;
    if (++cycles > 100) {
      dirtyQueue.clear();
      console.error('[what-react] Update loop guard tripped: more than 100 render cycles in one flush. Possible infinite re-render loop.');
      break;
    }
    // Parents before children: a parent re-render may update child props,
    // making a separately-queued child render redundant.
    const batch = [...dirtyQueue].sort((a, b) => a.depth - b.depth);
    runInCommit(() => {
      for (const inst of batch) {
        if (dirtyQueue.has(inst) && !inst.unmounted) {
          const insertionFrom = insertionQueue.length;
          const layoutFrom = layoutQueue.length;
          const passiveFrom = passiveQueue.length;
          renderInstance(inst);
          childEffectsFirst(insertionQueue, insertionFrom, inst);
          childEffectsFirst(layoutQueue, layoutFrom, inst);
          childEffectsFirst(passiveQueue, passiveFrom, inst);
        }
      }
    });
    // Layout effects ran on commit exit — they may have queued more updates.
  }
}

// A commit runs a component's effects after its descendants' (React's
// order), also when both were re-rendered on their own in one batch: the
// parent rendered first and did not reach the child (a store subscription
// re-rendered each), so the child's effects, queued from `from` on, move in
// front of the first effect of one of its ancestors.
function childEffectsFirst(queue, from, inst) {
  if (from === 0 || queue.length === from) return;
  let at = -1;
  for (let i = 0; i < from && at === -1; i++) {
    const other = queue[i].inst;
    for (let p = inst.parent; p != null && p.depth >= other.depth; p = p.parent) {
      if (p === other) { at = i; break; }
    }
  }
  if (at === -1) return;
  const moved = queue.splice(from);
  queue.splice(at, 0, ...moved);
}

// =====================================================================
// Commit phase — effect queues (child-first order, layout sync / passive async)
// =====================================================================

// What kind of effect a hook slot holds (slot._effect), which decides when
// its cleanup runs as the component unmounts.
export const EFFECT_INSERTION = 1;
export const EFFECT_LAYOUT = 2;
export const EFFECT_PASSIVE = 3;

let commitDepth = 0;
/** Effect queues being flushed: an effect is running. */
let effectDepth = 0;
const refQueue = [];
const insertionQueue = [];
const layoutQueue = [];
const passiveQueue = [];
/** @type {Array<() => void>} The passive cleanups of components this commit removed. */
const unmountedPassive = [];
let passiveScheduled = false;

export function runInCommit(fn) {
  commitDepth++;
  try {
    return fn();
  } finally {
    commitDepth--;
    if (commitDepth === 0) {
      // React's commit order: insertion effects (a CSS-in-JS library writes
      // its rules before anything reads layout), then refs (the DOM is in
      // the document), then layout effects, all synchronously; passive
      // effects later.
      if (mirrors.size > 0) syncMirrors();
      flushInsertionQueue();
      flushRefQueue();
      flushEffectQueue(layoutQueue);
      if ((passiveQueue.length > 0 || unmountedPassive.length > 0) && !passiveScheduled) {
        passiveScheduled = true;
        queueMicrotask(_flushPassive);
      }
    }
  }
}

function flushRefQueue() {
  effectDepth++;
  try {
    while (refQueue.length > 0) {
      const entry = refQueue.shift();
      if (entry.focus === true) {
        // autoFocus: React focuses the element when it mounts.
        if (entry.el.isConnected) {
          try { entry.el.focus(); } catch { /* not focusable */ }
        }
        continue;
      }
      // Skip if the element was already unmounted (ref nulled) or ref swapped.
      if (entry.rn.ref !== entry.ref) continue;
      try {
        attachRef(entry.rn, entry.ref, entry.el);
      } catch (e) {
        console.error('[what-react] ref error:', e);
      }
    }
  } finally {
    effectDepth--;
  }
}

export function _flushPassive() {
  passiveScheduled = false;
  flushPassiveEffects();
}

// The passive effects still waiting from earlier commits, run before a new
// render starts. Not from inside an effect (an effect that calls flushSync):
// the effects queued after it wait for it to return.
let flushingPassive = false;
function _flushPendingPassive() {
  if (flushingPassive || (passiveQueue.length === 0 && unmountedPassive.length === 0)) return;
  flushingPassive = true;
  try { flushPassiveEffects(); } finally { flushingPassive = false; }
}

// React's passive phase: the cleanups of the components the commit removed,
// then the cleanups of the effects that run again, then the effects.
function flushPassiveEffects() {
  flushUnmountedPassive();
  flushEffectQueue(passiveQueue);
}

function flushUnmountedPassive() {
  if (unmountedPassive.length === 0) return;
  effectDepth++;
  try {
    while (unmountedPassive.length > 0) {
      const batch = unmountedPassive.splice(0);
      for (let i = 0; i < batch.length; i++) {
        try { batch[i](); } catch (e) { console.error('[what-react] effect cleanup error:', e); }
      }
    }
  } finally {
    effectDepth--;
  }
}

// One phase of a commit (layout or passive), in React's two passes: every
// cleanup of the effects that run again, then every effect. Both in queue
// order, which is children before parents.
function flushEffectQueue(queue) {
  if (queue.length === 0) return;
  effectDepth++;
  try {
    while (queue.length > 0) {
      const batch = queue.splice(0);
      for (let i = 0; i < batch.length; i++) {
        const entry = batch[i];
        // An unmounted component's cleanups ran as it unmounted.
        if (entry.inst.unmounted) continue;
        const cleanup = entry.slot.cleanup;
        if (cleanup) {
          entry.slot.cleanup = null;
          try { cleanup(); } catch (e) { console.error('[what-react] effect cleanup error:', e); }
        }
      }
      for (let i = 0; i < batch.length; i++) {
        const entry = batch[i];
        // Cleared here, not above: a render between the two passes (a cleanup
        // that calls flushSync) replaces this entry's function, not queues a second.
        entry.slot._pending = null;
        if (entry.inst.unmounted) continue;
        try {
          const result = entry.fn();
          if (typeof result === 'function') entry.slot.cleanup = result;
        } catch (e) {
          effectError(entry.inst, e);
        }
      }
    }
  } finally {
    effectDepth--;
  }
}

// Insertion effects: React runs them in the mutation phase, component by
// component (a component's cleanup, then its effect), children first, before
// any ref attaches or layout effect runs.
function flushInsertionQueue() {
  if (insertionQueue.length === 0) return;
  effectDepth++;
  try {
    while (insertionQueue.length > 0) {
      const entry = insertionQueue.shift();
      const slot = entry.slot;
      slot._pending = null;
      if (entry.inst.unmounted) continue;
      if (slot.cleanup) {
        const cleanup = slot.cleanup;
        slot.cleanup = null;
        try { cleanup(); } catch (e) { console.error('[what-react] effect cleanup error:', e); }
      }
      try {
        const result = entry.fn();
        if (typeof result === 'function') slot.cleanup = result;
      } catch (e) {
        effectError(entry.inst, e);
      }
    }
  } finally {
    effectDepth--;
  }
}

// An error thrown by an effect goes to the nearest error boundary above the
// component, as a render error does; with none, it is logged.
function effectError(inst, error) {
  let handler = inst.parent;
  while (handler && !handler._errorHandler) handler = handler.parent;
  if (handler) {
    try { handler._errorHandler(error, inst); return; } catch (e) { error = e; }
  }
  console.error('[what-react] effect error:', error);
}

/**
 * The component stack of `inst` for componentDidCatch: one line per component
 * from `inst` up to the root, in React's format ("\n    at Name"). Host
 * elements are not listed, and there are no source locations.
 */
export function _componentStack(inst) {
  let stack = '';
  for (let p = inst; p != null; p = p.parent) {
    const type = p.type;
    if (type == null || type._hidden === true) continue;
    const name = type.displayName || type.name;
    if (name) stack += '\n    at ' + name;
  }
  return stack;
}

// Hooks push pending effects here; renderInstance moves them to the global
// queues AFTER the subtree commit so children's effects run before the parent's
// (React ordering).
export function _pushInsertion(inst, slot, fn) {
  _pushEffect(inst._pendingInsertion, inst, slot, fn);
}

export function _pushLayout(inst, slot, fn) {
  _pushEffect(inst._pendingLayout, inst, slot, fn);
}

export function _pushPassive(inst, slot, fn) {
  _pushEffect(inst._pendingPassive, inst, slot, fn);
}

function _pushEffect(pendingArr, inst, slot, fn) {
  // If a pending entry for this slot hasn't run yet (render-phase re-render,
  // or rapid double render), replace its fn instead of double-queueing.
  if (slot._pending) {
    slot._pending.fn = fn;
    return;
  }
  const entry = { inst, slot, fn };
  slot._pending = entry;
  pendingArr.push(entry);
}

// The effects a render queued and will not run (it threw, or suspended):
// their slots are as before the render, so the next one queues them again.
function dropPending(inst) {
  dropEntries(inst._pendingInsertion);
  dropEntries(inst._pendingLayout);
  dropEntries(inst._pendingPassive);
}

function dropEntries(entries) {
  for (let i = 0; i < entries.length; i++) {
    const slot = entries[i].slot;
    slot._pending = null;
    slot.deps = undefined;
    if (slot.subscribe !== undefined) slot.subscribe = undefined;
  }
  entries.length = 0;
}

// Drain everything synchronously — used by act() and flushSync().
export function _drainAll() {
  let guard = 0;
  while ((dirtyQueue.size > 0 || layoutQueue.length > 0 || passiveQueue.length > 0 || unmountedPassive.length > 0) && ++guard < 100) {
    flushUpdates();
    flushEffectQueue(layoutQueue);
    _flushPassive();
  }
  if (restoring.length > 0) restoreFields();
}

// =====================================================================
// VNode classification & normalization
// =====================================================================

function kindOf(v) {
  if (v == null || typeof v === 'boolean') return KIND_HOLE;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'bigint') return KIND_TEXT;
  if (t === 'function') return KIND_OPAQUE; // reactive accessor (What interop)
  if (t === 'object') {
    if (isVNode(v)) {
      const tag = v.tag;
      if (typeof tag === 'string') {
        if (tag === '__portal') return KIND_PORTAL;
        // What-internal boundary tags — let core handle them
        if (tag === '__suspense' || tag === '__errorBoundary') return KIND_OPAQUE;
        return KIND_ELEMENT;
      }
      if (typeof tag === 'function') {
        return (/** @type {any} */ (tag)._compatType || /** @type {any} */ (v)._compat) ? KIND_COMPONENT : KIND_OPAQUE;
      }
      return KIND_OPAQUE;
    }
    if (typeof v.nodeType === 'number') return KIND_OPAQUE; // raw DOM node
  }
  return KIND_TEXT; // last resort: stringify
}

// A child list as the reconciler takes it: the values in document order with
// holes kept (null/false/true → null), and for each one its slot, the
// identity React matches children by. In its own list a child is found by
// its key when it has one and by its index otherwise, and a nested array is a
// list of its own (React gives it a fragment), so:
//   - an unkeyed child keeps its slot whatever happens around it: a keyed
//     sibling that comes or goes, a neighbouring `.map()` list that grows;
//   - a keyed child is found again wherever it moved inside its list.
// Slots: the index for a top-level unkeyed child, '$key' for a keyed one,
// and the same behind the list's own slot ('2:0', '2:$key') in a nested array.
export function normalizeChildren(value) {
  const out = [];
  /** @type {Array<number | string>} */
  const slots = [];
  /** @type {any} */ (out).slots = slots;
  if (Array.isArray(value)) pushChildren(value, null, out, slots);
  else {
    out.push(value == null || typeof value === 'boolean' ? null : value);
    slots.push(0);
  }
  return out;
}

function pushChildren(list, prefix, out, slots) {
  for (let i = 0; i < list.length; i++) {
    const child = list[i];
    if (Array.isArray(child)) {
      pushChildren(child, prefix === null ? i + ':' : prefix + i + ':', out, slots);
      continue;
    }
    if (child == null || typeof child === 'boolean') {
      out.push(null);
      slots.push(prefix === null ? i : prefix + i);
      continue;
    }
    out.push(child);
    const key = typeof child === 'object' && child.key != null && isVNode(child) ? child.key : null;
    if (key !== null) slots.push(prefix === null ? '$' + key : prefix + '$' + key);
    else slots.push(prefix === null ? i : prefix + i);
  }
}

function canPatch(rn, v, kind) {
  if (rn.kind !== kind) return false;
  switch (kind) {
    case KIND_HOLE:
    case KIND_TEXT:
      return true;
    case KIND_ELEMENT:
      return rn.vnode.tag === v.tag;
    case KIND_COMPONENT:
      return rn.bridge === v.tag;
    case KIND_PORTAL:
      return true; // container change handled in patchPortal
    case KIND_OPAQUE: {
      if (rn.vnode === v) return true;
      // Native What vnodes / reactive function children are recreated on every
      // compat re-render, but the mounted run-once instance must be KEPT:
      // What semantics route reactivity through signals, not vnode identity.
      // Same function tag (or both reactive functions) at the same slot →
      // keep the existing subtree. New plain-value props passed from compat
      // parents to What components will NOT propagate (pass signals instead).
      if (typeof v === 'function' && typeof rn.vnode === 'function') return true;
      if (
        isVNode(v) && isVNode(rn.vnode) &&
        typeof v.tag === 'function' && rn.vnode.tag === v.tag &&
        (v.key ?? null) === rn.key
      ) return true;
      return false;
    }
  }
  return false;
}

// =====================================================================
// Reconciler — mount / patch / unmount
// =====================================================================

/**
 * Diff a list of previously-rendered RNodes against new child values.
 * Returns the new RNode list. DOM is inserted into parentDom before `anchor`.
 *
 * - A child matches the old node in its slot (normalizeChildren: its key or
 *   index within its own list) when the type is the same; otherwise the old
 *   node unmounts and a new one mounts, like React's replace.
 * - Pass 1 runs left-to-right (render/effect order matches React),
 *   mounting fresh nodes into detached fragments.
 * - Pass 3 walks right-to-left placing new nodes, and moving a kept node
 *   only when the list's own order changed (React's rule: it now stands
 *   after a node that used to follow it). Where a kept node sits among nodes
 *   this list does not own is never corrected: a portal's container holds
 *   other portals' nodes and nodes a library appended, and re-inserting a
 *   kept node to "fix" its place blurs the focused element inside it and
 *   restarts its animations.
 */
export function patchChildren(parentDom, old, newValues, anchor, svg, owner) {
  /** @type {Array<number | string> | undefined} */
  const slots = /** @type {any} */ (newValues).slots;
  /** @type {Map<number | string, any> | null} */
  let bySlot = null;
  if (old.length > 0) {
    bySlot = new Map();
    for (let i = 0; i < old.length; i++) {
      const rn = old[i];
      rn._i = i;
      // A duplicate key keeps the first; the others mount again.
      if (!bySlot.has(rn.slot)) bySlot.set(rn.slot, rn);
    }
  }

  const kept = new Set(); // matched old rnodes (stay mounted)
  let lastPlaced = -1; // the highest old index among the kept nodes so far
  const result = new Array(newValues.length);

  // --- Pass 1: match + patch, or mount into detached fragment ---
  for (let i = 0; i < newValues.length; i++) {
    const v = newValues[i];
    const kind = kindOf(v);
    const slot = slots !== undefined ? slots[i] : i;
    /** @type {any} */
    let match = null;
    if (bySlot !== null) {
      const cand = bySlot.get(slot);
      if (cand !== undefined && !kept.has(cand) && canPatch(cand, v, kind)) match = cand;
    }

    if (match) {
      kept.add(match);
      if (match._i < lastPlaced) match._move = true;
      else lastPlaced = match._i;
      result[i] = patchRNode(match, v, kind, parentDom, svg, owner);
    } else {
      const frag = document.createDocumentFragment();
      const rn = mountRNode(v, kind, frag, svg, owner);
      rn._pendingFrag = frag;
      rn.slot = slot;
      result[i] = rn;
    }
  }

  // --- Pass 2: unmount old nodes that weren't kept ---
  for (let i = 0; i < old.length; i++) {
    const rn = old[i];
    if (!kept.has(rn)) unmountRNode(rn, true);
  }

  // --- Pass 3: position (right-to-left, moving anchor) ---
  let ref = anchor; // insert before this node; null = append at end
  for (let i = result.length - 1; i >= 0; i--) {
    const rn = result[i];
    if (rn._pendingFrag) {
      parentDom.insertBefore(rn._pendingFrag, ref);
      rn._pendingFrag = null;
      const first = firstDomNode(rn);
      if (first) ref = first;
    } else {
      const nodes = domNodesOf(rn);
      if (nodes.length > 0) {
        if (rn._move === true || nodes[0].parentNode !== parentDom) {
          for (let n = 0; n < nodes.length; n++) parentDom.insertBefore(nodes[n], ref);
        }
        ref = nodes[0];
      }
      rn._move = false;
    }
  }

  return result;
}

// The top-level DOM nodes `rn` owns, in tree order. A component's are its
// two markers and what its output owns, found through the rendered tree and
// never by walking siblings between the markers: a library may have moved one
// of its elements (cmdk sorts its items in the DOM), and what a library
// inserted between the markers is not the component's. React finds host
// nodes the same way, through the fiber tree.
function domNodesOf(rn, out = []) {
  switch (rn.kind) {
    case KIND_HOLE:
    case KIND_TEXT:
    case KIND_ELEMENT:
    case KIND_PORTAL:
      if (rn.dom) out.push(rn.dom);
      return out;
    case KIND_COMPONENT: {
      out.push(rn.start);
      const rendered = rn.inst.rendered;
      for (let i = 0; i < rendered.length; i++) domNodesOf(rendered[i], out);
      out.push(rn.end);
      return out;
    }
    case KIND_OPAQUE: {
      // what-core's nodes: everything between the markers.
      let n = rn.start;
      const end = rn.end;
      while (n) {
        out.push(n);
        if (n === end) break;
        n = n.nextSibling;
      }
      return out;
    }
  }
  return out;
}

function removeNodes(nodes) {
  for (let i = 0; i < nodes.length; i++) {
    const parent = nodes[i].parentNode;
    if (parent) parent.removeChild(nodes[i]);
  }
}

function firstDomNode(rn) {
  switch (rn.kind) {
    case KIND_COMPONENT:
    case KIND_OPAQUE:
      return rn.start;
    default:
      return rn.dom || null;
  }
}

// ---- Mount ----

function mountRNode(v, kind, container, svg, owner) {
  switch (kind) {
    case KIND_HOLE: {
      const dom = document.createComment('w:h');
      container.appendChild(dom);
      return { kind, vnode: v, key: null, dom };
    }
    case KIND_TEXT: {
      const text = typeof v === 'string' ? v : String(v);
      const dom = document.createTextNode(text);
      container.appendChild(dom);
      return { kind, vnode: v, key: null, dom, text };
    }
    case KIND_ELEMENT:
      return mountElement(v, container, svg, owner);
    case KIND_COMPONENT:
      return mountComponent(v, container, svg, owner);
    case KIND_PORTAL:
      return mountPortal(v, container, owner);
    case KIND_OPAQUE:
      return mountOpaque(v, container);
  }
  return { kind: KIND_HOLE, vnode: v, key: null, dom: container.appendChild(document.createComment('w:h')) };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

// A portal target may live inside an <svg> (recharts 3.x z-index layers are
// SVG <g> portal targets). Children portaled into an SVG container must be
// created in the SVG namespace, not HTML.
function targetSvg(target) {
  return !!target && target.namespaceURI === SVG_NS && target.tagName !== 'foreignObject';
}

// camelCase React SVG prop → correct kebab/colon SVG attribute name.
// Covers the presentation/text/clip attributes charting libs (recharts) emit.
export const SVG_ATTR_MAP = {
  strokeWidth: 'stroke-width', strokeDasharray: 'stroke-dasharray',
  strokeDashoffset: 'stroke-dashoffset', strokeLinecap: 'stroke-linecap',
  strokeLinejoin: 'stroke-linejoin', strokeMiterlimit: 'stroke-miterlimit',
  strokeOpacity: 'stroke-opacity', fillOpacity: 'fill-opacity',
  fillRule: 'fill-rule', clipPath: 'clip-path', clipRule: 'clip-rule',
  stopColor: 'stop-color', stopOpacity: 'stop-opacity',
  textAnchor: 'text-anchor', dominantBaseline: 'dominant-baseline',
  alignmentBaseline: 'alignment-baseline', baselineShift: 'baseline-shift',
  colorInterpolation: 'color-interpolation',
  colorInterpolationFilters: 'color-interpolation-filters',
  floodColor: 'flood-color', floodOpacity: 'flood-opacity',
  letterSpacing: 'letter-spacing', wordSpacing: 'word-spacing',
  pointerEvents: 'pointer-events', shapeRendering: 'shape-rendering',
  vectorEffect: 'vector-effect', paintOrder: 'paint-order',
  markerStart: 'marker-start', markerMid: 'marker-mid', markerEnd: 'marker-end',
  // Font + rendering attrs recharts emits on <text>/axis/tick/legend elements.
  fontSize: 'font-size', fontFamily: 'font-family', fontWeight: 'font-weight',
  fontStyle: 'font-style', fontVariant: 'font-variant', fontStretch: 'font-stretch',
  textRendering: 'text-rendering', imageRendering: 'image-rendering',
  writingMode: 'writing-mode', lightingColor: 'lighting-color',
  // SVG keeps an attribute's case, and only lowercase `tabindex` makes an SVG
  // element focusable (recharts' surface takes tabIndex).
  tabIndex: 'tabindex',
};

function mountElement(v, container, svg, owner) {
  const tag = v.tag;
  // `svg` is the host mode: false (HTML), true (inside an <svg>), or the
  // mirror of a portal into a document that is not the DOM's (below).
  const mirror = typeof svg === 'object' && svg !== null ? svg : null;
  const childSvg = mirror !== null ? mirror : (svg || tag === 'svg') && tag !== 'foreignObject';
  const isSvgEl = mirror === null && (svg || tag === 'svg');
  const el = isSvgEl ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (mirror !== null) el._compatMirror = mirror.doc.createElement(tag);
  const props = v.props || EMPTY_OBJ;

  // 'type' must be applied before 'value' on inputs (and before onChange
  // normalization picks the native event).
  if (props.type !== undefined) setProperty(el, 'type', props.type, undefined, isSvgEl);
  let value, checked, hasValue = false, hasChecked = false;
  for (const name in props) {
    if (name === 'children' || name === 'key' || name === 'ref' || name === 'type') continue;
    if (name === 'value') { value = props[name]; hasValue = true; continue; }
    if (name === 'checked') { checked = props[name]; hasChecked = true; continue; }
    setProperty(el, name, props[name], undefined, isSvgEl);
  }

  const rn = {
    kind: KIND_ELEMENT, vnode: v, key: v.key ?? null, dom: el,
    children: /** @type {any[]} */ ([]), ref: props.ref || null,
  };

  // Children
  const kids = normalizeChildren(v.children !== undefined ? v.children : props.children);
  rn.children = patchChildren(el, [], kids, null, childSvg, owner);

  // Controlled props after children (e.g. <select> options must exist)
  if (hasValue) setProperty(el, 'value', value, undefined, isSvgEl);
  if (hasChecked) setProperty(el, 'checked', checked, undefined, isSvgEl);
  if (!isSvgEl) {
    if (tag === 'input' || tag === 'textarea') trackField(el);
    else if (tag === 'select' && value == null) resetSelect(el, props.defaultValue);
  }

  // Refs attach at commit exit — AFTER the element is inserted into the live
  // DOM — so ref callbacks that measure layout (getBoundingClientRect etc.)
  // see real geometry, like React.
  if (props.autoFocus === true) refQueue.push({ focus: true, el });
  if (rn.ref) refQueue.push({ rn, ref: rn.ref, el });

  container.appendChild(el);
  return rn;
}

function mountComponent(v, container, svg, owner) {
  const tag = v.tag;
  const renderFn = (typeof tag === 'function' && tag._compatType) ? tag._compatType : tag;
  const start = document.createComment('w$');
  const end = document.createComment('/w$');
  container.appendChild(start);
  container.appendChild(end);

  const inst = newInstance(renderFn, v.props || EMPTY_OBJ, v.key ?? null, owner, start, end, svg);

  const rn = {
    kind: KIND_COMPONENT, vnode: v, key: inst.key,
    bridge: tag, inst, start, end,
  };

  renderInstance(inst);
  return rn;
}

function newInstance(type, props, key, parent, start, end, svg) {
  return {
    type,
    props,
    key,
    hooks: [],
    hookIndex: 0,
    parent,
    depth: parent ? parent.depth + 1 : 0,
    start, end, svg,
    rendered: [],
    unmounted: false,
    _renderPhaseUpdate: false,
    _pendingInsertion: [],
    _pendingLayout: [],
    _pendingPassive: [],
    _guardStart: 0,
    _guardCount: 0,
    _track: null,
    _dispose: null,
    // The What owner native components rendered below this instance are
    // created under (an island's: where the island stands in native code).
    _nativeOwner: undefined,
  };
}

function mountPortal(v, container, owner) {
  const dom = document.createComment('w:portal');
  container.appendChild(dom);
  const target = v.props && v.props.container;
  const rn = { kind: KIND_PORTAL, vnode: v, key: v.key ?? null, dom, container: target || null, children: /** @type {any[]} */ ([]) };
  if (!target) {
    console.warn('[what-react] createPortal: target container not found');
    return rn;
  }
  if (isForeignHost(target)) {
    rn.mirror = createMirror(target);
    rn.children = patchChildren(rn.mirror.shadow, [], normalizeChildren(v.children), null, rn.mirror, owner);
    return rn;
  }
  registerPortal(rn);
  rn.children = patchChildren(target, [], normalizeChildren(v.children), null, targetSvg(target), owner);
  return rn;
}

// ---- Portals into a document that is not the DOM's ----
// A library can keep a document of its own (plain objects with appendChild,
// insertBefore, removeChild and createElement) and render a portal into it to
// read a tree of elements back: react-aria-components builds its collections
// (the items of a ListBox, a Menu, a Table) this way. This reconciler works on
// DOM nodes and places comment markers, so such a portal renders into a
// detached DOM element, its shadow, where each element also makes its twin
// in the library's document (`el._compatMirror`); when a commit has changed
// the shadow, the twins are put in the same order under the library's nodes,
// before refs attach (a ref there gets the twin).

/** @type {Set<{ doc: any, target: any, shadow: Element, observer: MutationObserver | null }>} */
const mirrors = new Set();

function isForeignHost(target) {
  if (target == null || typeof target.insertBefore !== 'function') return false;
  const doc = target.nodeType === 9 ? target : target.ownerDocument;
  // A real document says so in any realm (an iframe's included).
  return doc == null || !/Document\]$/.test(Object.prototype.toString.call(doc));
}

function createMirror(target) {
  const shadow = document.createElement('div');
  const doc = target.ownerDocument || target;
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => {}) : null;
  if (observer !== null) observer.observe(shadow, { childList: true, subtree: true });
  const mirror = { doc, target, shadow, observer };
  mirrors.add(mirror);
  return mirror;
}

function syncMirrors() {
  for (const mirror of mirrors) {
    // No observer (a test DOM without one): compare every time.
    if (mirror.observer !== null && mirror.observer.takeRecords().length === 0) continue;
    syncMirror(mirror.shadow, mirror.target);
  }
}

// Put the twins of `real`'s element children under `host`, in their order.
function syncMirror(real, host) {
  let at = host.firstChild;
  for (let child = real.firstChild; child !== null; child = child.nextSibling) {
    const twin = child._compatMirror;
    if (twin === undefined) continue; // a marker
    if (at === twin) at = at.nextSibling;
    else host.insertBefore(twin, at);
    syncMirror(child, twin);
  }
  while (at != null) {
    const next = at.nextSibling;
    host.removeChild(at);
    at = next;
  }
}

function disposeMirror(mirror) {
  syncMirror(mirror.shadow, mirror.target);
  if (mirror.observer !== null) mirror.observer.disconnect();
  mirrors.delete(mirror);
}

// Opaque subtree: delegate to what-core's renderer. We mount into a detached
// fragment via core's public mount() (which returns a disposer), move the
// nodes inline between our own markers, and on unmount move them BACK into the
// holder fragment, so core's disposer, which disposes the tree's root and
// empties its container, removes them too.
function mountOpaque(v, container) {
  const start = document.createComment('w:o');
  const end = document.createComment('/w:o');
  container.appendChild(start);

  /** @type {(() => void) | null} */
  let dispose = null;
  /** @type {DocumentFragment | null} */
  let holder = null;
  if (typeof v === 'object' && typeof v.nodeType === 'number') {
    // Raw DOM node — insert as-is, caller owns its lifecycle.
    container.appendChild(v);
  } else {
    holder = document.createDocumentFragment();
    try {
      dispose = whatMount(v, holder);
    } catch (e) {
      console.error('[what-react] Failed to render What-native child:', e);
    }
    container.appendChild(holder); // moves rendered nodes inline
  }
  container.appendChild(end);

  return {
    kind: KIND_OPAQUE, vnode: v, key: null, start, end,
    dispose: dispose && (() => {
      // Move everything between the markers back into the holder, which
      // core's disposer empties after disposing the tree's root.
      let n = start.nextSibling;
      while (n && n !== end) {
        const next = n.nextSibling;
        /** @type {DocumentFragment} */ (holder).appendChild(n);
        n = next;
      }
      try { dispose(); } catch { /* already disposed */ }
    }),
  };
}

// ---- Patch ----

function patchRNode(rn, v, kind, parentDom, svg, owner) {
  switch (kind) {
    case KIND_HOLE:
      rn.vnode = v;
      return rn;
    case KIND_TEXT: {
      const text = typeof v === 'string' ? v : String(v);
      if (rn.text !== text) {
        rn.text = text;
        rn.dom.data = text;
      }
      rn.vnode = v;
      return rn;
    }
    case KIND_ELEMENT:
      return patchElement(rn, v, svg, owner);
    case KIND_COMPONENT:
      return patchComponent(rn, v);
    case KIND_PORTAL:
      return patchPortal(rn, v, owner);
    case KIND_OPAQUE:
      // identity-matched — nothing to do
      rn.vnode = v;
      return rn;
  }
  return rn;
}

function patchElement(rn, v, svg, owner) {
  const el = rn.dom;
  const oldProps = (rn.vnode && rn.vnode.props) || EMPTY_OBJ;
  const newProps = v.props || EMPTY_OBJ;
  const mirror = typeof svg === 'object' && svg !== null ? svg : null;
  const isSvgEl = mirror === null && (svg || v.tag === 'svg');
  const childSvg = mirror !== null ? mirror : (svg || v.tag === 'svg') && v.tag !== 'foreignObject';

  if (oldProps !== newProps) {
    // Removed props
    for (const name in oldProps) {
      if (name === 'children' || name === 'key' || name === 'ref') continue;
      if (!(name in newProps)) setProperty(el, name, null, oldProps[name], isSvgEl);
    }
    // Changed props (value/checked re-asserted after children)
    let value, checked, hasValue = false, hasChecked = false;
    for (const name in newProps) {
      if (name === 'children' || name === 'key' || name === 'ref') continue;
      if (name === 'value') { value = newProps[name]; hasValue = true; continue; }
      if (name === 'checked') { checked = newProps[name]; hasChecked = true; continue; }
      if (oldProps[name] !== newProps[name]) {
        setProperty(el, name, newProps[name], oldProps[name], isSvgEl);
      }
    }

    // An uncontrolled select that had no options yet (they load later).
    const emptySelect = v.tag === 'select' && value == null && el.options !== undefined && el.options.length === 0;

    // Children
    const kids = normalizeChildren(v.children !== undefined ? v.children : newProps.children);
    rn.children = patchChildren(el, rn.children, kids, null, childSvg, owner);

    if (hasValue) setProperty(el, 'value', value, oldProps.value, isSvgEl);
    if (hasChecked) setProperty(el, 'checked', checked, oldProps.checked, isSvgEl);
    if (emptySelect && el.options.length > 0) resetSelect(el, null);

    // Refs
    const newRef = newProps.ref || null;
    if (rn.ref !== newRef) {
      if (rn.ref) detachRef(rn, rn.ref);
      if (newRef) attachRef(rn, newRef, el);
      rn.ref = newRef;
    }
  } else {
    // Same props object — still recurse children (descendant components may
    // need the render cascade; bailouts happen at component level).
    const kids = normalizeChildren(v.children !== undefined ? v.children : newProps.children);
    rn.children = patchChildren(el, rn.children, kids, null, childSvg, owner);
  }

  rn.vnode = v;
  return rn;
}

function patchComponent(rn, v) {
  const inst = rn.inst;
  const newProps = v.props || EMPTY_OBJ;
  const oldVnode = rn.vnode;
  rn.vnode = v;

  const selfDirty = dirtyQueue.has(inst);

  // Identical element bailout (same vnode object, no pending self update) —
  // context consumers below still update via their own subscriptions.
  if (!selfDirty && oldVnode === v && inst.props === newProps) {
    return rn;
  }

  // React.memo: skip re-render when props compare equal.
  const compare = inst.type._memoCompare;
  if (!selfDirty && compare && compare(inst.props, newProps)) {
    inst.props = newProps;
    return rn;
  }

  inst.props = newProps;
  renderInstance(inst);
  return rn;
}

function patchPortal(rn, v, owner) {
  const target = v.props && v.props.container;
  if (target === rn.container && rn.mirror !== undefined) {
    rn.children = patchChildren(rn.mirror.shadow, rn.children, normalizeChildren(v.children), null, rn.mirror, owner);
  } else if (target === rn.container) {
    if (target) {
      rn.children = patchChildren(target, rn.children, normalizeChildren(v.children), null, targetSvg(target), owner);
    }
  } else {
    teardown(rn); // its children leave the old container
    rn.container = target || null;
    if (target && isForeignHost(target)) {
      rn.mirror = createMirror(target);
      rn.children = patchChildren(rn.mirror.shadow, [], normalizeChildren(v.children), null, rn.mirror, owner);
      rn.vnode = v;
      return rn;
    }
    if (target) registerPortal(rn);
    rn.children = target
      ? patchChildren(target, [], normalizeChildren(v.children), null, targetSvg(target), owner)
      : [];
  }
  rn.vnode = v;
  return rn;
}

// ---- Unmount ----
// React's order for a subtree a commit removes: parents first. A component's
// insertion and layout cleanups run before its children's, an element's ref
// detaches before the cleanups below it, and all of it happens before the
// subtree's nodes leave the document (a cleanup may still read layout). The
// passive cleanups run later, in the same order, with the commit's other
// passive effects (unmountedPassive).

export function unmountRNode(rn, removeDom) {
  switch (rn.kind) {
    case KIND_HOLE:
    case KIND_TEXT:
      if (removeDom && rn.dom.parentNode) rn.dom.parentNode.removeChild(rn.dom);
      return;
    case KIND_ELEMENT:
      teardown(rn);
      if (removeDom && rn.dom.parentNode) rn.dom.parentNode.removeChild(rn.dom);
      return;
    case KIND_COMPONENT: {
      // Its nodes are listed before the unmount empties the tree.
      const nodes = removeDom ? domNodesOf(rn) : null;
      teardown(rn);
      if (nodes !== null) removeNodes(nodes);
      return;
    }
    case KIND_PORTAL:
      teardown(rn);
      if (removeDom && rn.dom.parentNode) rn.dom.parentNode.removeChild(rn.dom);
      return;
    case KIND_OPAQUE:
      teardown(rn);
      if (removeDom) removeRange(rn.start, rn.end);
      return;
  }
}

// Everything unmounting `rn` does except removing its own nodes from their
// parent: cleanups and ref detaches, top down.
function teardown(rn) {
  switch (rn.kind) {
    case KIND_ELEMENT: {
      if (rn.ref) {
        try { detachRef(rn, rn.ref); } catch (e) { console.error('[what-react] ref cleanup error:', e); }
        rn.ref = null; // invalidates any queued mount-time ref entry
      }
      const children = rn.children;
      for (let i = 0; i < children.length; i++) teardown(children[i]);
      return;
    }
    case KIND_COMPONENT:
      teardownInstance(rn.inst);
      return;
    case KIND_PORTAL: {
      // Its children stand in another container: they are removed here.
      const children = rn.children;
      const nodes = [];
      for (let i = 0; i < children.length; i++) domNodesOf(children[i], nodes);
      for (let i = 0; i < children.length; i++) teardown(children[i]);
      removeNodes(nodes);
      unregisterPortal(rn);
      if (rn.mirror !== undefined) { disposeMirror(rn.mirror); rn.mirror = undefined; }
      return;
    }
    case KIND_OPAQUE:
      if (rn.dispose) rn.dispose();
      return;
  }
}

function teardownInstance(inst) {
  if (inst.unmounted) return;
  inst.unmounted = true;
  dirtyQueue.delete(inst);
  if (inst._track != null) {
    const stop = inst._track;
    inst._track = null;
    stop();
  }

  // Its own insertion and layout cleanups (useSyncExternalStore's
  // subscription is one), in hook order; the passive ones are queued.
  const hooks = inst.hooks;
  for (let i = 0; i < hooks.length; i++) {
    const slot = hooks[i];
    if (slot === undefined || slot._effect === undefined || !slot.cleanup) continue;
    const cleanup = slot.cleanup;
    slot.cleanup = null;
    if (slot._effect === EFFECT_PASSIVE) unmountedPassive.push(cleanup);
    else {
      try { cleanup(); } catch (e) { console.error('[what-react] effect cleanup error:', e); }
    }
  }

  // Then its children's.
  const rendered = inst.rendered;
  for (let i = 0; i < rendered.length; i++) teardown(rendered[i]);
  inst.rendered = [];

  // What a component owns outside the compat tree (a native component's
  // What root, mixed.js).
  if (inst._dispose != null) {
    const dispose = inst._dispose;
    inst._dispose = null;
    try { dispose(); } catch (e) { console.error('[what-react] cleanup error:', e); }
  }

  // Context unsubscriptions.
  if (inst._ctxDeps) {
    for (const [provider, context] of inst._ctxDeps) {
      const subs = provider._ctxSubs && provider._ctxSubs.get(context);
      if (subs) subs.delete(inst);
    }
    inst._ctxDeps = null;
  }
}

/**
 * Run the passive cleanups of what was just unmounted, now: when a root or
 * an island goes (React flushes a synchronous unmount's passive effects
 * before it returns), not in the middle of a commit, whose passive phase
 * runs them.
 */
export function _flushUnmounted() {
  if (commitDepth === 0 && effectDepth === 0) flushUnmountedPassive();
}

function removeRange(start, end) {
  const parent = start.parentNode;
  if (!parent) return;
  let n = start;
  while (n) {
    const next = n.nextSibling;
    parent.removeChild(n);
    if (n === end) break;
    n = next;
  }
}

// =====================================================================
// Render — execute a component function with hook dispatcher + reconcile
// =====================================================================

export function renderInstance(inst) {
  if (inst.unmounted) return;
  dirtyQueue.delete(inst);

  // Time-window loop guard (independent of the flush-cycle guard): protects
  // against effect→setState→effect chains across microtasks.
  const now = Date.now();
  if (now - inst._guardStart > 200) {
    inst._guardStart = now;
    inst._guardCount = 0;
  }
  if (++inst._guardCount > 250) {
    if (inst._guardCount === 251) {
      console.error(`[what-react] Too many re-renders for <${inst.type.displayName || inst.type.name || 'Anonymous'}> (>250 in 200ms). Possible infinite loop — skipping renders.`);
    }
    return;
  }

  let out;
  let renderPhaseLoops = 0;
  do {
    inst._renderPhaseUpdate = false;
    inst.hookIndex = 0;
    const prev = currentInstance;
    currentInstance = inst;
    try {
      out = renderTracked(inst);
    } catch (err) {
      currentInstance = prev;
      dropPending(inst);
      handleRenderError(inst, err, false);
      return;
    }
    currentInstance = prev;
    if (++renderPhaseLoops > 25) {
      console.error('[what-react] Too many render-phase updates (setState during render). Possible loop.');
      break;
    }
  } while (inst._renderPhaseUpdate);

  const parentDom = inst.end.parentNode;
  try {
    inst.rendered = patchChildren(parentDom, inst.rendered, normalizeChildren(out), inst.end, inst.svg, inst);
  } catch (err) {
    // Subtree commit failed (a descendant threw). Reset this instance's output
    // and route the error/suspension. Cleanups of partially-mounted children
    // may not run — documented limitation.
    removeRangeContents(inst.start, inst.end);
    inst.rendered = [];
    dropPending(inst);
    handleRenderError(inst, err, true);
    return;
  }

  // Queue own effects after the subtree's (children queued theirs during patch).
  for (const e of inst._pendingInsertion) insertionQueue.push(e);
  inst._pendingInsertion.length = 0;
  for (const e of inst._pendingLayout) layoutQueue.push(e);
  inst._pendingLayout.length = 0;
  for (const e of inst._pendingPassive) passiveQueue.push(e);
  inst._pendingPassive.length = 0;
}

// A render reads What signals under a tracker of its own, never an enclosing
// what-core effect: a signal a component reads while it renders (a native
// value in an island's props, a render prop written in a native file, a
// signal read in a React file) schedules a re-render of that instance, the
// way a state change does. The tracker belongs to no owner, so nothing but
// the next render or the unmount disposes it. One that read nothing keeps
// nothing (what-core releases an effect with no dependencies).
const NOT_THROWN = {};

function renderTracked(inst) {
  const prev = inst._track;
  if (prev != null) {
    inst._track = null;
    prev();
  }
  let out;
  let thrown = NOT_THROWN;
  let first = true;
  const stop = runWithOwner(null, () => effect(() => {
    if (first) {
      first = false;
      // Caught here, not by the effect: the render's error (a thrown thenable
      // included) goes to the compat boundaries, never to what-core's.
      try { out = inst.type(inst.props); } catch (err) { thrown = err; }
    } else if (!inst.unmounted) {
      scheduleUpdate(inst);
    }
  }));
  if (thrown !== NOT_THROWN) {
    stop();
    throw thrown;
  }
  inst._track = stop;
  return out;
}

function removeRangeContents(start, end) {
  const parent = start.parentNode;
  if (!parent) return;
  let n = start.nextSibling;
  while (n && n !== end) {
    const next = n.nextSibling;
    parent.removeChild(n);
    n = next;
  }
}

function handleRenderError(inst, err, fromChildren) {
  // Suspense: thrown thenable (lazy components, use(promise)).
  if (err !== null && typeof err === 'object' && typeof err.then === 'function') {
    let boundary = fromChildren ? inst : inst.parent;
    while (boundary && !boundary._isSuspense) boundary = boundary.parent;
    if (boundary) {
      // The component that threw renders again when the boundary wakes.
      if (!fromChildren) (boundary._suspended || (boundary._suspended = new Set())).add(inst);
      boundary._suspendCount = (boundary._suspendCount || 0) + 1;
      if (boundary._suspendCount === 1) {
        // Content already on screen stays mounted, hidden behind the
        // fallback, so its state survives (React does the same). On a first
        // mount nothing has been shown yet: the fallback takes its place.
        boundary._keepPrimary = boundary._primaryShown === true;
        scheduleUpdate(boundary);
      }
      const wake = () => {
        if (--boundary._suspendCount > 0 || boundary.unmounted) return;
        const waiting = boundary._suspended;
        boundary._suspended = null;
        scheduleUpdate(boundary);
        if (waiting) for (const suspended of waiting) scheduleUpdate(suspended);
      };
      err.then(wake, wake);
      return;
    }
    err = new Error('[what-react] A component suspended but no <Suspense> boundary was found above it.');
  }

  // Error boundaries (class components with componentDidCatch / getDerivedStateFromError).
  let handler = fromChildren ? inst : inst.parent;
  while (handler && !handler._errorHandler) handler = handler.parent;
  if (handler) {
    handler._errorHandler(err, inst);
    return;
  }
  throw err;
}

/**
 * Hide or show what `inst` rendered, without unmounting it: a <Suspense>
 * whose content suspended after it was shown (index.js). Elements get
 * `display: none !important` (their own inline display comes back after),
 * text nodes are emptied.
 */
export function _setRangeHidden(inst, hidden) {
  if (!inst.start) return;
  for (let n = inst.start.nextSibling; n && n !== inst.end; n = n.nextSibling) {
    if (n.nodeType === 1 && n.style) {
      if (hidden) {
        if (n._compatDisplay === undefined) {
          n._compatDisplay = [n.style.getPropertyValue('display'), n.style.getPropertyPriority('display')];
          n.style.setProperty('display', 'none', 'important');
        }
      } else if (n._compatDisplay !== undefined) {
        const [value, priority] = n._compatDisplay;
        n._compatDisplay = undefined;
        if (value) n.style.setProperty('display', value, priority);
        else n.style.removeProperty('display');
      }
    } else if (n.nodeType === 3) {
      if (hidden) {
        if (n._compatText === undefined) { n._compatText = n.data; n.data = ''; }
      } else if (n._compatText !== undefined) {
        n.data = n._compatText;
        n._compatText = undefined;
      }
    }
  }
}

// =====================================================================
// Roots — entry points used by react-compat's ReactDOM implementation
// =====================================================================

export function mountRoot(element, container) {
  const isSvg = typeof SVGElement !== 'undefined' && container instanceof SVGElement;
  const rns = runInCommit(() => patchChildren(container, [], normalizeChildren(element), null, isSvg, null));
  return { container, rns };
}

export function patchRoot(root, element) {
  _flushPendingPassive();
  const isSvg = typeof SVGElement !== 'undefined' && root.container instanceof SVGElement;
  root.rns = runInCommit(() => patchChildren(root.container, root.rns, normalizeChildren(element), null, isSvg, null));
  return root;
}

export function unmountRoot(root) {
  runInCommit(() => {
    for (const rn of root.rns) unmountRNode(rn, true);
    root.rns = [];
  });
  _flushUnmounted();
}

// =====================================================================
// Islands — a React tree that native What code places
// =====================================================================

/**
 * Mount `view` (a function returning what-react elements) as a compat root
 * instance between two markers in `container`. The instance renders `view`
 * like a component body: every signal `view` reads while it builds the
 * elements (a native value in a prop) schedules a re-render, which reconciles
 * against the last one, so React state below survives. `parent` is the compat
 * instance the island stands inside (React context, Suspense and error
 * boundaries reach through it), `nativeOwner` the What owner where it stands
 * (native components below it are created under that owner).
 */
export function mountIsland(view, container, parent, nativeOwner, svg, deferred) {
  const start = document.createComment('w$');
  const end = document.createComment('/w$');
  container.appendChild(start);
  container.appendChild(end);
  const inst = newInstance(view, EMPTY_OBJ, null, parent, start, end, !!svg);
  inst._nativeOwner = nativeOwner;
  // While a server page hydrates, the island is two markers until the walk
  // is over: the server wrote nothing for it, so there is nothing to claim.
  if (deferred) queueMicrotask(() => { if (!inst.unmounted) runInCommit(() => renderInstance(inst)); });
  else runInCommit(() => renderInstance(inst));
  return inst;
}

/**
 * Hydrating a page whose server rendered the island (server.js): the
 * server's region markers become the island's own, and once the walk is
 * done the server's HTML between them is replaced by the client's render of
 * the same elements, in one step, before the page paints again.
 */
export function adoptIsland(view, start, end, parent, nativeOwner, svg) {
  const inst = newInstance(view, EMPTY_OBJ, null, parent, start, end, !!svg);
  inst._nativeOwner = nativeOwner;
  const mount = () => {
    if (inst.unmounted || end.parentNode === null) return;
    removeRangeContents(start, end);
    runInCommit(() => renderInstance(inst));
  };
  if (!_afterWalk(mount)) queueMicrotask(mount);
  return inst;
}

/** Unmount an island's instance. Its DOM belongs to the native code that placed it. */
export function unmountIsland(inst) {
  runInCommit(() => teardownInstance(inst));
  _flushUnmounted();
}

/**
 * A native component body's half of an island: mount `view` here, under the
 * current What owner, and unmount it with that owner. Returns the fragment to
 * place.
 */
export function _island(view, svg) {
  // Its React state lives in React: rebuilding the island loses it.
  _devHoldsState();
  const parent = _hostInstance();
  const owner = getOwner();
  const hydrating = isHydrating();
  if (hydrating) {
    // The server rendered the island (server.js) between brackets: they are
    // the island's, whole, and the walk goes on after them.
    const region = _claimRegion();
    if (region !== null) {
      const adopted = adoptIsland(view, region[0], region[1], parent, owner, svg);
      whatOnCleanup(() => unmountIsland(adopted));
      return null;
    }
  }
  const frag = document.createDocumentFragment();
  const inst = untrack(() => mountIsland(view, frag, parent, owner, svg, hydrating));
  whatOnCleanup(() => unmountIsland(inst));
  // Built on the client where the server rendered nothing: placed, not claimed.
  return hydrating ? _$outside(() => frag) : frag;
}

// =====================================================================
// Server — one render pass per component, for a React island's HTML
// =====================================================================

/**
 * A compat instance for a server render: hooks get their initial values,
 * effects are queued and never run, and nothing schedules a re-render.
 */
export function _serverInstance(type, props, parent) {
  const inst = newInstance(type, props || EMPTY_OBJ, null, parent, null, null, false);
  inst._server = true;
  return inst;
}

/** Render `inst` once on the server (a setState during render renders again, as React does). */
export function _renderOnServer(inst) {
  let out;
  let loops = 0;
  do {
    inst._renderPhaseUpdate = false;
    inst.hookIndex = 0;
    const prev = currentInstance;
    currentInstance = inst;
    try {
      out = untrack(() => inst.type(inst.props));
    } finally {
      currentInstance = prev;
    }
  } while (inst._renderPhaseUpdate && ++loops < 25);
  return out;
}

// =====================================================================
// Bridge — a compat element that native What code renders as a vnode
// =====================================================================

const bridgeCache = new WeakMap();

/**
 * Returns a What-native component wrapper for a React component function.
 * what-react's createElement uses this as the vnode tag so that:
 * - core's renderer (whatMount / native What trees) can render compat
 *   components by calling the bridge as a regular run-once component,
 * - THIS runtime recognizes compat vnodes via tag._compatType and renders
 *   them natively (the bridge is never called inside compat trees).
 *
 * The bridge is an island: its element is rebuilt from core's props on each
 * render, so a prop that is a getter (compiled JSX's live props) stays live,
 * and it takes the compat host it stands in as its parent.
 */
export function getBridge(renderFn) {
  let bridge = bridgeCache.get(renderFn);
  if (bridge) return bridge;

  bridge = function CompatBridge(coreProps) {
    return _island(() => {
      const props = {};
      for (const key in coreProps) props[key] = coreProps[key];
      return Object.assign(h(bridge, props), { type: renderFn, _compat: true });
    }, false);
  };
  bridge._compatType = renderFn;
  bridge.displayName = renderFn.displayName || renderFn.name || 'CompatBridge';

  bridgeCache.set(renderFn, bridge);
  return bridge;
}

// =====================================================================
// DOM props — React prop semantics (className, style px, onChange→input, ...)
// =====================================================================

// A callback ref may return a cleanup function (React 19): it is called when
// the ref detaches, in place of the call with null.
function attachRef(rn, ref, el) {
  rn._refAttached = true;
  // In a mirrored portal the element the library knows is its own document's.
  if (el != null && el._compatMirror !== undefined) el = el._compatMirror;
  if (typeof ref === 'function') {
    const cleanup = ref(el);
    rn._refCleanup = typeof cleanup === 'function' ? cleanup : null;
  } else if (ref && typeof ref === 'object') ref.current = el;
}

function detachRef(rn, ref) {
  // Never attached: unmounted in the commit that mounted it.
  if (rn._refAttached !== true) return;
  rn._refAttached = false;
  if (typeof ref === 'function') {
    const cleanup = rn._refCleanup;
    rn._refCleanup = null;
    if (cleanup) cleanup();
    else ref(null);
  } else if (ref && typeof ref === 'object') ref.current = null;
}

// preact's unitless-CSS-property test
export const IS_NON_DIMENSIONAL = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;

function setStyleValue(style, key, value) {
  if (key[0] === '-') {
    style.setProperty(key, value == null ? '' : value);
  } else if (value == null) {
    style[key] = '';
  } else if (typeof value === 'number' && !IS_NON_DIMENSIONAL.test(key)) {
    style[key] = value + 'px';
  } else {
    style[key] = value;
  }
}

function setStyle(el, value, oldValue) {
  if (typeof value === 'string') {
    el.style.cssText = value;
    return;
  }
  if (typeof oldValue === 'string') {
    el.style.cssText = '';
    oldValue = null;
  }
  if (oldValue && typeof oldValue === 'object') {
    for (const k in oldValue) {
      if (!(value && k in value)) setStyleValue(el.style, k, '');
    }
  }
  if (value && typeof value === 'object') {
    for (const k in value) {
      if (!oldValue || oldValue[k] !== value[k]) setStyleValue(el.style, k, value[k]);
    }
  }
}

// React's onChange fires per keystroke — native 'input' for text-like controls.
function changeEventFor(el) {
  const tag = el.tagName;
  if (tag === 'SELECT') return 'change';
  if (tag === 'TEXTAREA') return 'input';
  if (tag === 'INPUT') {
    const t = el.type;
    if (t === 'checkbox' || t === 'radio' || t === 'file') return 'change';
    return 'input';
  }
  return 'change';
}

function isCheckable(el) {
  return el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio');
}

// ---- What a field showed last ----
// React fires onChange when a field's value is not the one it last saw: an
// `input` event that changed nothing fires none, and the `change` a text
// field sends when it loses focus fires none after the `input` that reported
// the edit. Each input and textarea therefore carries the value last seen
// (`_compatSeen`: its `value`, or `checked` for a checkbox or radio), read at
// mount and at each change event. React tracks the same way.
//
// A write through the element's own `value`/`checked` property (a script's
// `input.value = 'x'`) is noticed: the property is shadowed on the element.
// React counts such a write as seen, so an event that follows it fires no
// onChange there (tests reach for the prototype's setter to get around it);
// here the next event counts as a change, since the script changed the
// field. what-react's own writes go to the prototype's setter (writeField).

/** @type {WeakMap<object, Record<string, { field: string, set: Function, own: PropertyDescriptor } | null>>} */
const fieldAccessors = new WeakMap();

function accessorFor(el, field) {
  const proto = Object.getPrototypeOf(el);
  let byField = fieldAccessors.get(proto);
  if (byField === undefined) fieldAccessors.set(proto, byField = {});
  let accessor = byField[field];
  if (accessor === undefined) {
    const native = Object.getOwnPropertyDescriptor(proto, field);
    if (native === undefined || typeof native.get !== 'function' || typeof native.set !== 'function') accessor = null;
    else {
      const { get, set } = native;
      accessor = {
        field,
        set,
        own: {
          configurable: true,
          enumerable: native.enumerable,
          /** @this {any} */
          get() { return get.call(this); },
          /** @this {any} */
          set(value) {
            this._compatSeen = '' + value;
            this._compatWritten = true;
            set.call(this, value);
          },
        },
      };
    }
    byField[field] = accessor;
  }
  return accessor;
}

let resetsListened = false;

// Called once for an input or a textarea, when it has mounted with its props.
function trackField(el) {
  const field = isCheckable(el) ? 'checked' : 'value';
  // Shadowed already (by a library, or by React in a page that has both).
  if (Object.prototype.hasOwnProperty.call(el, field)) return;
  const accessor = accessorFor(el, field);
  if (accessor === null) return;
  el._compatSeen = '' + el[field];
  el._compatWritten = false;
  el._compatTrack = accessor;
  Object.defineProperty(el, field, accessor.own);
  if (!resetsListened && typeof document !== 'undefined') {
    resetsListened = true;
    // form.reset() changes its fields without a write or an event.
    document.addEventListener('reset', (e) => {
      const fields = e.target && /** @type {any} */ (e.target).elements;
      if (fields == null) return;
      for (let i = 0; i < fields.length; i++) if (fields[i]._compatTrack !== undefined) fields[i]._compatWritten = true;
    }, true);
  }
}

// Write a field's `value` or `checked` as what-react's own write: seen, and
// not a script's.
function writeField(el, field, value) {
  const accessor = el._compatTrack;
  if (accessor !== undefined && accessor.field === field) {
    el._compatSeen = '' + value;
    accessor.set.call(el, value);
  } else {
    el[field] = value;
  }
}

function fieldChanged(el, checkable) {
  if (el._compatTrack === undefined) return true;
  const now = checkable ? (el.checked ? 'true' : 'false') : el.value;
  if (el._compatWritten === true) el._compatWritten = false;
  else if (now === el._compatSeen) return false;
  el._compatSeen = now;
  // The browser unchecked the rest of its group without a write or an event.
  if (checkable && el.type === 'radio' && el.checked) {
    const group = radioGroup(el);
    for (let i = 0; i < group.length; i++) {
      if (group[i] !== el && group[i]._compatTrack !== undefined) group[i]._compatSeen = group[i].checked ? 'true' : 'false';
    }
  }
  return true;
}

// The radio buttons that share `el`'s name and form (el included).
function radioGroup(el) {
  const name = el.name;
  if (!name) return [el];
  let root = el;
  while (root.parentNode) root = root.parentNode;
  if (typeof root.querySelectorAll !== 'function') return [el];
  const group = [];
  const radios = root.querySelectorAll('input[type="radio"]');
  for (let i = 0; i < radios.length; i++) {
    if (radios[i].name === name && radios[i].form === el.form) group.push(radios[i]);
  }
  return group;
}

// Whether a native event is React's change event for its target, decided
// once per event: `input` (or `change`) on a text field whose value is new,
// `change` on a checkbox or radio whose state is new, and every `change` on
// a select, a file input or an element that is no form field (a custom
// element's). An `input` event from a contenteditable is not one.
function isReactChange(native) {
  let is = native._compatChange;
  if (is !== undefined) return is;
  is = false;
  const target = native.target;
  if (target != null && target.nodeType === 1) {
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      const kind = target.type;
      if (kind === 'file') is = native.type === 'change';
      else if (kind === 'checkbox' || kind === 'radio') is = native.type === 'change' && fieldChanged(target, true);
      else is = fieldChanged(target, false);
    } else {
      is = native.type === 'change';
    }
  }
  try { native._compatChange = is; } catch { /* a frozen event: decided per call */ }
  return is;
}

// What a React handler is handed: a synthetic event, a plain object with the
// native event's fields as its own properties and React's methods. Libraries
// treat it as one: they copy it (`{ ...event }`, which takes own properties
// only and would leave a DOM event's `key`, `target` and `clientX` behind),
// call `isPropagationStopped()` and `persist()`, and read `nativeEvent`. One
// object per native event and React type, as in React: onInput and onChange
// on one `input` event each get their own, and a handler that keeps its
// event still reads the type it was called with.
function syntheticEvent(native, type) {
  let byType = native._compatSynthetic;
  if (byType !== undefined) {
    const made = byType[type];
    if (made !== undefined) return made;
  }
  const event = {};
  // DOM event fields are enumerable accessors on the prototypes: for-in sees them.
  for (const key in native) {
    const value = native[key];
    if (typeof value !== 'function') event[key] = value;
  }
  event.type = type;
  event.currentTarget = null;
  event.nativeEvent = native;
  event.preventDefault = function () { this.defaultPrevented = true; native.preventDefault(); };
  event.stopPropagation = function () { native.stopPropagation(); };
  event.isDefaultPrevented = function () { return native.defaultPrevented; };
  // The browser sets cancelBubble when stopPropagation() is called.
  event.isPropagationStopped = function () { return native.cancelBubble === true; };
  event.persist = noop;
  event.isPersistent = returnTrue;
  if (typeof native.getModifierState === 'function') event.getModifierState = (key) => native.getModifierState(key);
  if (byType === undefined) {
    byType = {};
    try { native._compatSynthetic = byType; } catch { /* a frozen event: one object per call */ }
  }
  byType[type] = event;
  return event;
}

function returnTrue() { return true; }

// The type React reports for a native event it listens to under another name.
const REACT_TYPE = { focusin: 'focus', focusout: 'blur' };

// Call one handler: `prop` is the React prop it came in as (onChange reports
// the type `change` whatever native event carried it), `currentTarget` the
// element it is on, for the length of the call (React nulls it after).
function callHandler(handler, native, currentTarget, prop) {
  const event = syntheticEvent(native, prop === 'onChange' ? 'change' : (REACT_TYPE[native.type] || native.type));
  event.currentTarget = currentTarget;
  event.defaultPrevented = native.defaultPrevented;
  try {
    return handler(event);
  } finally {
    event.currentTarget = null;
  }
}

// An element's handlers for one native event, by the React prop that set
// them: `onInput` and `onChange` both listen to `input` on a text field, and
// each keeps its own handler (a library passes `onInput={undefined}` next to
// its `onChange`). React calls onChange after the others, and only when the
// event changed its target's value.
function callHandlers(handlers, e, currentTarget) {
  for (const prop in handlers) {
    if (prop !== 'onChange') callHandler(handlers[prop], e, currentTarget, prop);
  }
  if (handlers.onChange !== undefined && isReactChange(e)) callHandler(handlers.onChange, e, currentTarget, 'onChange');
}

/** @this {any} */
function eventProxy(e) {
  const handlers = this._compatListeners && this._compatListeners[e.type];
  if (handlers) callHandlers(handlers, e, this);
  if (e.cancelBubble === true) afterStopped(e);
}

/** @this {any} */
function eventProxyCapture(e) {
  const handlers = this._compatListenersCapture && this._compatListenersCapture[e.type];
  if (handlers) callHandlers(handlers, e, this);
  // On the target itself the bubble handlers still run after a stop.
  if (e.cancelBubble === true && !(e.target === this && this._compatListeners && this._compatListeners[e.type])) afterStopped(e);
}

// A React handler stopped the event: it reaches no listener further on, so
// what waits for the end of its dispatch happens here. React does both after
// its handlers ran, stopped or not.
function afterStopped(e) {
  const type = e.type;
  if (type === 'submit') runFormAction(e);
  else if (type === 'input' || type === 'change') {
    // A handler above the field stopped the event before the field heard it.
    const target = e.target;
    if (target != null && target._compatControlled === true && (type === 'change' || changeEventFor(target) === 'input')) restoring.push(target);
    if (restoring.length > 0) restoreFields();
  }
}

// ---- Form actions ----
// React runs a form's function action after the submit event's handlers,
// unless one of them called preventDefault(); a handler that only stops
// propagation does not keep it from running. Here it runs when the event
// reaches the document, or where a React handler stopped it (afterStopped).
// A listener that is not React's and stops the event below the document
// still keeps the action from running.

let submitsListened = false;
/** @type {((form: any, action: Function, data: FormData) => void) | null} */
let formActionRunner = null;

/** hooks.js installs how an action runs (inside a transition, with the form's status). */
export function _setFormActionRunner(runner) {
  formActionRunner = runner;
}

function runFormAction(e) {
  if (e._compatActionRun === true) return;
  const form = /** @type {any} */ (e.target);
  if (form == null || form.tagName !== 'FORM') return;
  try { e._compatActionRun = true; } catch { /* a frozen event */ }
  if (e.defaultPrevented) return;
  const submitter = /** @type {any} */ (e).submitter;
  const action = submitter && typeof submitter._compatAction === 'function' ? submitter._compatAction : form._compatAction;
  if (typeof action !== 'function' || formActionRunner === null) return;
  e.preventDefault();
  let data;
  try { data = submitter ? new FormData(form, submitter) : new FormData(form); } catch { data = new FormData(form); }
  formActionRunner(form, action, data);
}

function listenForSubmits() {
  if (submitsListened || typeof document === 'undefined') return;
  submitsListened = true;
  document.addEventListener('submit', runFormAction);
}

// ---- Events through portals ----
// In React an event inside a portal goes on through the portal's React
// parents: a press in a popover rendered into <body> from inside a dialog
// reaches the dialog's handlers, although the dialog is not its DOM ancestor.
// Dismissable layers, click-away listeners and focus scopes are built on it.
// Handlers here are native listeners on their elements, which the browser
// calls along the DOM path only; two document listeners per event type call
// the rest of the React path: the capture one first of all (outermost React
// parent first), the bubble one last of all (innermost first).

/** @type {WeakMap<Node, Set<any>>} portal container → the portals rendered into it */
const portalsIn = new WeakMap();
let portalCount = 0;
let everPortal = false;
/** The native event types some element has a React handler for. */
const usedEvents = new Set();

function registerPortal(rn) {
  let set = portalsIn.get(rn.container);
  if (set === undefined) portalsIn.set(rn.container, set = new Set());
  set.add(rn);
  rn._registered = true;
  portalCount++;
  if (!everPortal) {
    everPortal = true;
    for (const type of usedEvents) bridgeEvent(type);
  }
}

function unregisterPortal(rn) {
  if (rn._registered !== true) return;
  rn._registered = false;
  const set = portalsIn.get(rn.container);
  if (set !== undefined) set.delete(rn);
  portalCount--;
}

function bridgeEvent(type) {
  if (typeof document === 'undefined') return;
  document.addEventListener(type, bridgeCapture, true);
  document.addEventListener(type, bridgeBubble, false);
}

// The portal whose children include `node`, a child of `container`.
function portalOwning(container, node) {
  const set = portalsIn.get(container);
  if (set === undefined || set.size === 0) return null;
  for (const rn of set) {
    for (let i = 0; i < rn.children.length; i++) {
      const nodes = domNodesOf(rn.children[i]);
      for (let n = 0; n < nodes.length; n++) if (nodes[n] === node) return rn;
    }
  }
  return null;
}

// The elements a React event at `target` passes that are not its DOM
// ancestors: the React parents of every portal it is inside, innermost
// first. Null when the target is in no portal.
function reactPathOutside(target) {
  /** @type {any[] | null} */
  let path = null;
  let node = target;
  while (node != null) {
    const parent = node.parentNode;
    if (parent == null) break;
    const portal = portalOwning(parent, node);
    if (portal !== null) {
      if (path === null) path = [];
      node = portal.dom; // the portal's place in its React parent
      continue;
    }
    if (path !== null && parent.nodeType === 1 && !parent.contains(target)) path.push(parent);
    node = parent;
  }
  return path;
}

function bridgeCapture(e) {
  if (portalCount === 0 || e.target == null || typeof e.target.nodeType !== 'number') return;
  const path = reactPathOutside(e.target);
  if (path === null) return;
  e._reactPath = path;
  for (let i = path.length - 1; i >= 0; i--) {
    const handlers = path[i]._compatListenersCapture && path[i]._compatListenersCapture[e.type];
    if (handlers) {
      callHandlers(handlers, e, path[i]);
      if (e.cancelBubble) { afterStopped(e); return; }
    }
  }
}

function bridgeBubble(e) {
  const path = e._reactPath;
  if (path === undefined || !e.bubbles) return;
  for (let i = 0; i < path.length; i++) {
    const handlers = path[i]._compatListeners && path[i]._compatListeners[e.type];
    if (handlers) {
      callHandlers(handlers, e, path[i]);
      if (e.cancelBubble) { afterStopped(e); return; }
    }
  }
}

function noop() {}

function setEvent(el, name, value) {
  let base = name.slice(2);
  let useCapture = false;
  if (base.endsWith('Capture')) {
    useCapture = true;
    base = base.slice(0, -7);
  }
  // The prop the handler came in as, without its Capture suffix.
  const prop = 'on' + base;
  let event = base.toLowerCase();
  if (event === 'change') {
    // React's change event: `change` for a select, a checkbox, a radio and a
    // file input. For a text field `input`, and `change` too, which reports
    // an edit no `input` event did (isReactChange lets one of them through).
    // An element that is no field hears both from the fields inside it.
    const own = changeEventFor(el);
    const tag = el.tagName;
    if (own === 'input' || (tag !== 'INPUT' && tag !== 'SELECT')) listen(el, 'input', prop, value, useCapture);
    listen(el, 'change', prop, value, useCapture);
    return;
  }
  if (event === 'doubleclick') event = 'dblclick';
  else if (event === 'focus') event = 'focusin';   // React synthetic focus bubbles
  else if (event === 'blur') event = 'focusout';
  listen(el, event, prop, value, useCapture);
}

// Set or remove the handler the React prop `prop` has for the native `event`.
function listen(el, event, prop, value, useCapture) {
  const store = useCapture
    ? (el._compatListenersCapture || (el._compatListenersCapture = {}))
    : (el._compatListeners || (el._compatListeners = {}));
  const proxy = useCapture ? eventProxyCapture : eventProxy;
  let handlers = store[event];
  if (typeof value === 'function') {
    if (handlers === undefined) {
      handlers = store[event] = {};
      if (!usedEvents.has(event)) {
        usedEvents.add(event);
        if (everPortal) bridgeEvent(event);
      }
      el.addEventListener(event, proxy, useCapture);
    }
    handlers[prop] = value;
  } else if (handlers !== undefined && handlers[prop] !== undefined) {
    delete handlers[prop];
    let left = false;
    for (const _ in handlers) { left = true; break; }
    if (!left) {
      delete store[event];
      el.removeEventListener(event, proxy, useCapture);
    }
  }
}

// ---- Controlled fields ----
// A controlled field shows its prop, whatever the user did: when no handler
// takes the edit (it validates and returns, or there is none), React puts the
// field back, at the end of the event's dispatch, after rendering what the
// handlers set. Handlers here are native listeners, so "the end" is found
// three ways: a listener on the window, which the event reaches last; the
// React handler that stopped the event (afterStopped); and, for an event
// that reaches neither (one that does not bubble, or that a listener that is
// not React's stopped), a microtask, or a timer when the browser is still
// dispatching the event at that microtask.

/** The controlled fields whose change event is being dispatched. */
const restoring = [];
let restoreQueued = false;
let restoreTimer = false;
/** @type {WeakMap<object, Set<string>>} window (or document) → the event types it listens to for restores */
const restoreListeners = new WeakMap();

// A capture listener on the field itself: it runs before the field's handlers
// and its ancestors', whenever they were added.
/** @this {any} */
function fieldEvent(e) {
  restoring.push(this);
  if (restoreQueued) return;
  restoreQueued = true;
  queueMicrotask(() => {
    restoreQueued = false;
    if (restoring.length === 0) return;
    // The dispatch is over (a script dispatched it), or goes no further.
    if (e.eventPhase === 0 || e.cancelBubble === true) restoreFields();
    else if (!restoreTimer) {
      restoreTimer = true;
      setTimeout(() => { restoreTimer = false; restoreFields(); }, 0);
    }
  });
}

function controlField(el) {
  if (el._compatControlled === true || typeof el.addEventListener !== 'function') return;
  el._compatControlled = true;
  // The events React's onChange listens to for this field. A checkbox fires
  // `input` first: putting `checked` back then would hide the user's click
  // from the handler on `change`.
  if (changeEventFor(el) === 'input') watchField(el, 'input');
  watchField(el, 'change');
}

function watchField(el, type) {
  el.addEventListener(type, fieldEvent, true);
  const doc = el.ownerDocument;
  const end = (doc && doc.defaultView) || doc;
  if (end == null || typeof end.addEventListener !== 'function') return;
  let types = restoreListeners.get(end);
  if (types === undefined) restoreListeners.set(end, types = new Set());
  if (types.has(type)) return;
  types.add(type);
  end.addEventListener(type, restoreFields);
}

function restoreFields() {
  if (restoring.length === 0) return;
  // Not in the middle of a render or a commit (a field event an effect
  // dispatched): once it is done.
  if (currentInstance !== null || commitDepth > 0 || effectDepth > 0) {
    if (!restoreQueued) {
      restoreQueued = true;
      queueMicrotask(() => { restoreQueued = false; restoreFields(); });
    }
    return;
  }
  // What the handlers set renders first: a field whose edit was taken
  // already shows its new prop.
  if (dirtyQueue.size > 0) flushUpdates();
  const fields = restoring.splice(0);
  for (let i = 0; i < fields.length; i++) restoreField(fields[i]);
}

function restoreField(el) {
  const value = el._compatValue;
  if (value != null) {
    if (el.tagName === 'SELECT') setSelectValue(el, value, false);
    else writeValue(el, value);
  }
  const checked = el._compatChecked;
  if (checked != null) {
    const on = !!checked;
    if (el.checked !== on) writeField(el, 'checked', on);
    if (el.type === 'radio') {
      // The click unchecked the rest of its group: each controlled member
      // shows its prop again, and all of them are seen as they now stand.
      const group = radioGroup(el);
      for (let i = 0; i < group.length; i++) {
        const other = group[i];
        if (other === el) continue;
        if (other._compatChecked != null && other.checked !== !!other._compatChecked) writeField(other, 'checked', !!other._compatChecked);
        else if (other._compatTrack !== undefined) other._compatSeen = other.checked ? 'true' : 'false';
      }
    }
  }
}

// An input's or a textarea's value, written only when it differs (a write
// moves the caret to the end).
function writeValue(el, value) {
  const str = String(value);
  if (el.type === 'number') {
    // React's rule: "1." and "1.0" stand for the prop 1 while the user types
    // (a loose comparison, on purpose).
    if ((value === 0 && el.value === '') || el.value != value) writeField(el, 'value', str);
  } else if (el.value !== str) {
    writeField(el, 'value', str);
  }
}

// A select's options as its value (or default value) says: for `multiple`
// every option whose value is in the array; otherwise the first option with
// the value, or, when none has it, the first that is not disabled.
function setSelectValue(el, value, asDefault) {
  const options = el.options;
  if (el.multiple) {
    const wanted = new Set();
    if (Array.isArray(value)) for (let i = 0; i < value.length; i++) wanted.add(String(value[i]));
    else wanted.add(String(value));
    for (let i = 0; i < options.length; i++) {
      const on = wanted.has(options[i].value);
      if (options[i].selected !== on) options[i].selected = on;
      if (on && asDefault) options[i].defaultSelected = true;
    }
    return;
  }
  const str = String(value);
  /** @type {any} */
  let fallback = null;
  for (let i = 0; i < options.length; i++) {
    const option = options[i];
    if (option.value === str) {
      if (!option.selected) option.selected = true;
      if (asDefault) option.defaultSelected = true;
      return;
    }
    if (fallback === null && !option.disabled) fallback = option;
  }
  if (fallback !== null && !fallback.selected) fallback.selected = true;
}

// An uncontrolled select as the browser shows one whose options were added
// in order: the reconciler inserts new children last to first, and a select
// takes the first option it is given as its selection. Its `defaultValue`
// decides, or the last option marked `selected`, or the first that is not
// disabled. A listbox (multiple, or a size above 1) selects nothing by itself.
function resetSelect(el, defaultValue) {
  if (defaultValue != null) { setSelectValue(el, defaultValue, true); return; }
  if (el.multiple || el.size > 1) return;
  const options = el.options;
  /** @type {any} */
  let pick = null;
  for (let i = options.length - 1; i >= 0 && pick === null; i--) {
    if (options[i]._compatSelected === true || options[i].defaultSelected) pick = options[i];
  }
  for (let i = 0; i < options.length && pick === null; i++) {
    const parent = options[i].parentNode;
    if (!options[i].disabled && !(parent && parent.tagName === 'OPTGROUP' && parent.disabled)) pick = options[i];
  }
  if (pick !== null && !pick.selected) pick.selected = true;
}

function setValueProp(el, value, oldValue) {
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    el._compatValue = value;
    // Null or undefined: not controlled. A field that was keeps what it
    // shows (React leaves the DOM value when a field becomes uncontrolled).
    if (value == null) {
      if (oldValue != null && tag === 'INPUT' && (el.type === 'submit' || el.type === 'reset')) el.removeAttribute('value');
      return;
    }
    controlField(el);
    if (tag === 'SELECT') setSelectValue(el, value, false);
    else writeValue(el, value);
    return;
  }
  // Any other element (an option, a button, a progress bar, a list item):
  // `value` is an ordinary attribute. A custom element takes it as it is.
  if (value == null) {
    if (oldValue != null) el.removeAttribute('value');
    return;
  }
  if (tag.indexOf('-') !== -1 && 'value' in el) { el.value = value; return; }
  const str = String(value);
  if ('value' in el) {
    if (el.value !== str || !el.hasAttribute('value')) el.value = str;
  } else {
    el.setAttribute('value', str);
  }
}

export function setProperty(el, name, value, oldValue, svg) {
  if (name === 'children' || name === 'key' || name === 'ref') return;

  if (name === 'class' || name === 'className') {
    if (svg) el.setAttribute('class', value || '');
    else el.className = value || '';
    return;
  }
  if (name === 'htmlFor' || name === 'for') {
    if (value == null) el.removeAttribute('for');
    else el.setAttribute('for', value);
    return;
  }
  if (name === 'style') {
    setStyle(el, value, oldValue);
    return;
  }
  if (name[0] === 'o' && name[1] === 'n' && name.length > 2) {
    setEvent(el, name, value);
    return;
  }
  // Focused when it mounts (mountElement), never written as an attribute.
  if (name === 'autoFocus') return;
  // React 19: a function as a form's `action` (or a button's `formAction`)
  // runs on submit with the form's data, in a transition.
  if ((name === 'action' || name === 'formAction') && (typeof value === 'function' || typeof oldValue === 'function')) {
    el._compatAction = typeof value === 'function' ? value : null;
    if (typeof value === 'function') {
      listenForSubmits();
      el.removeAttribute(name);
      return;
    }
  }
  if (name === 'dangerouslySetInnerHTML') {
    el.innerHTML = (value && value.__html) || '';
    return;
  }
  if (name === 'value') {
    setValueProp(el, value, oldValue);
    return;
  }
  if (name === 'checked' && el.tagName === 'INPUT') {
    el._compatChecked = value;
    // Null or undefined: not controlled, and a box that was keeps its state.
    if (value == null) return;
    controlField(el);
    if (el.checked !== !!value) writeField(el, 'checked', !!value);
    return;
  }
  // An option's own `selected`: its select reads it once the options are in (resetSelect).
  if (name === 'selected' && el.tagName === 'OPTION') el._compatSelected = value === true;
  if (name === 'defaultValue') {
    if ('defaultValue' in el) el.defaultValue = value == null ? '' : value;
    return;
  }
  if (name === 'defaultChecked') {
    el.defaultChecked = !!value;
    return;
  }
  if (name.startsWith('data-') || name.startsWith('aria-')) {
    // React writes a boolean here as its text: aria-pressed={false} is the
    // attribute "false" (a state), never a missing attribute.
    if (value == null || typeof value === 'function' || typeof value === 'symbol') el.removeAttribute(name);
    else el.setAttribute(name, value);
    return;
  }

  if (svg) {
    if (name === 'xlinkHref') {
      el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', value);
      return;
    }
    // React accepts camelCase SVG presentation props (strokeWidth, fontSize, …)
    // and the spec expects kebab-case attribute names. Unlike HTML elements,
    // SVG-namespaced elements preserve the exact case passed to setAttribute —
    // so "strokeWidth" stays "strokeWidth", not "strokewidth". That camelCase
    // name is not a valid SVG presentation attribute, so the renderer silently
    // ignores it. Map the known ones to their correct kebab-case equivalents.
    const mapped = SVG_ATTR_MAP[name];
    const attr = mapped || name;
    if (value == null || value === false) el.removeAttribute(attr);
    else el.setAttribute(attr, value === true ? '' : value);
    return;
  }

  // A prop that is null or undefined is left out, as React leaves it out. It
  // is never written as '': the DOM reads that as 0 for maxLength (a field
  // that takes no text), as a link to this page for href, as focusable for
  // tabIndex, as a 0-pixel canvas for width. One that was set is taken back.
  if (value == null) {
    if (oldValue != null) {
      try { if (typeof el[name] === 'boolean') el[name] = false; } catch { /* read-only */ }
      el.removeAttribute(name);
    }
    return;
  }

  // Property when available, attribute otherwise.
  if (name !== 'list' && name !== 'form' && name !== 'tagName' && name !== 'download' && name in el) {
    try {
      el[name] = value;
      return;
    } catch { /* read-only property — fall through to attribute */ }
  }
  if (value == null || value === false) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? '' : value);
}
