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
 * What differs from React is listed under "Known limitations" in
 * REACT-COMPAT.md: rendering is synchronous and render and commit are one
 * pass, a server render exists only for React islands in mixed mode
 * (server.js, and hydrate.js, which adopts that HTML in the browser), and a
 * React island's top-level output holds its place with a comment when it
 * renders no node.
 */

import { untrack, effect, runWithOwner, getOwner, mount as whatMount, onCleanup as whatOnCleanup } from 'what-core';
import { isVNode, _contextOf, isHydrating, _claimRegion, _afterWalk, _devHoldsState, __DEV__ } from 'what-core/internal';
import { _$outside, _$componentVNode } from 'what-core/render';

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
export const KIND_HOLE = 0;      // null / undefined / boolean / '': keeps its slot, no DOM node (see mountHole)
export const KIND_TEXT = 1;      // string / number
export const KIND_ELEMENT = 2;   // vnode with string tag
export const KIND_COMPONENT = 3; // vnode created by what-react createElement (function type)
export const KIND_OPAQUE = 4;    // What-native vnode / reactive function / raw DOM node → core renderer
export const KIND_PORTAL = 5;    // '__portal' vnode (ReactDOM.createPortal)

const EMPTY_OBJ = {};
const NO_CHILDREN = [];

// ---- Elements ----

/**
 * The vnode for an element of `tag` with `props`, as what-core's h(tag, props)
 * makes it: the key, unless it is a function that is not a signal (a prop
 * then, as <For key={fn}> has it), is the vnode's and not a prop. Made by
 * what-core's unbuilt component call (_$componentVNode) instead of h(): h()
 * installs what-core's vnode renderer, which only native What code needs, so
 * a React app that has none does not carry it. The caller sets `children`.
 */
export function _vnodeOf(tag, props) {
  const key = props.key;
  if (key === undefined || (typeof key === 'function' && key._signal !== true)) return _$componentVNode(tag, props, NO_CHILDREN);
  const { key: _key, ...rest } = props;
  const vnode = /** @type {any} */ (_$componentVNode(tag, rest, NO_CHILDREN));
  vnode.key = key;
  return vnode;
}

// A React element can still reach what-core's renderer in an app without
// native What code: a function child (a What accessor) is handed to
// what-core (mountOpaque), and what it returns may be an element. With no
// renderer of what-core's in the program, a vnode renders through the one it
// carries (`_$r`, render.js valuesToNodes): here, as an island of its own,
// under React's rules. Where native code installed what-core's renderer, that
// one renders it, as a native What tree renders a React element (a component
// through its bridge, getBridge below). A mixed app installs this renderer as
// what-core's own (mixed.js), with keyed rows of its own for a hole's arrays.
/** @internal mixed.js */
export const _vnodeIsland = (/** @type {any} */ vnode, /** @type {any} */ _parent, /** @type {any} */ isSvg) => _island(() => vnode, isSvg === true);

{
  const proto = Object.getPrototypeOf(_$componentVNode(null, EMPTY_OBJ, NO_CHILDREN));
  if (proto._$r === undefined) proto._$r = _vnodeIsland;
}

/**
 * The `mount` a createPortal() vnode carries (dom.js): what-core's renderer
 * calls it where the portal stands in a native What tree, and the portal
 * renders as an island there.
 * @param {any} vnode
 */
export function _portalMount(vnode) {
  return _island(() => vnode, false);
}

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
    // ERROR_CODES.HOOK_OUTSIDE_RENDER. The explanation is development's; a
    // production build says the first sentence (what-core's catalogue has
    // the fix under the code).
    throw Object.assign(
      new Error(
        `[what-react] ${hookName}() called outside of a component render.` + (__DEV__ ? ' ' +
        `Hooks can only be called while a what-react component is rendering. ` +
        `In an app that mixes native What and React files, a React hook runs only in a React file: ` +
        `a file is one when it imports react, calls a hook it imports from a React package, ` +
        `starts with /** @jsxImportSource react */, or matches reactCompat({ react }) (MIXED.md). ` +
        `If this happens inside a React library, make sure ALL react imports are ` +
        `aliased to what-react (one module instance) — see the reactCompat() vite plugin.` : '')
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
  const hooks = inst.hooks !== null ? inst.hooks : (inst.hooks = []);
  const i = inst.hookIndex++;
  let slot = hooks[i];
  if (slot === undefined) {
    slot = hooks[i] = {};
  }
  return slot;
}

// =====================================================================
// Scheduler — batched re-renders with an update-loop guard
// =====================================================================

const dirtyQueue = new Set();
let flushScheduled = false;

// ---- Update-loop guard ----
// A component that sets state every time it renders (in an effect with no
// dependencies, say) never settles, and rendering here is synchronous: left
// alone, the loop holds the page's thread for good. The guard gives the
// thread back without ever skipping a render that was asked for, so the
// screen is never left behind the state. Two shapes of loop, two answers:
//
// - Inside one flush (an effect sets state, the loop below renders again):
//   after CYCLE_LIMIT render cycles the loop is ended. What is queued renders
//   one last time, and from then until the event loop has turned the
//   components that were queued take no further state update: the update is
//   refused, so the state does not move either, and the screen shows it as
//   it stands. (React throws after 50 nested updates.) An update that cannot
//   be refused where it is made (an external store, a context, a signal: the
//   value lives outside the component) is rendered once the event loop has
//   turned.
// - From flush to flush with no turn of the event loop between them (an
//   effect resolves a promise that sets state): after CHAIN_LIMIT flushes
//   started from microtasks, rendering waits for the event loop to turn and
//   then goes on. Nothing is refused: a long chain that does end (a stream
//   read in a loop) ends with its last state on the screen, and one that
//   never ends leaves the page responsive, as it is in React, whose
//   scheduler yields the same way.
//
// A microtask cannot see whether the event loop turned, so after PROBE_AT
// chained flushes a message is posted to this module; when it arrives the
// loop has turned and the count starts again. Updates made in separate tasks
// (a click each, however fast they come) are therefore never taken for a
// loop, whatever the clock says.
const CYCLE_LIMIT = 100;
const CHAIN_LIMIT = 1000;
const PROBE_AT = 50;
let chained = 0;
let probing = false;
/** @type {(() => void) | null} */
let postProbe = null;
/** The instances that take no update until the event loop turns. */
const stuck = [];
let releaseScheduled = false;
/** Rendering waits for the event loop to turn (a chain of flushes that did not let it). */
let yielding = false;

function eventLoopTurned() {
  probing = false;
  chained = 0;
}

function probe() {
  probing = true;
  if (postProbe === null) {
    if (typeof MessageChannel === 'function') {
      const channel = new MessageChannel();
      channel.port1.onmessage = eventLoopTurned;
      // Node: the port must not keep the process alive.
      const port = /** @type {any} */ (channel.port1);
      if (typeof port.unref === 'function') port.unref();
      postProbe = () => channel.port2.postMessage(null);
    } else {
      postProbe = () => { setTimeout(eventLoopTurned, 0); };
    }
  }
  postProbe();
}

/** The first component queued that the guard has not reported yet, marked reported; '' when all were. */
function unreported() {
  let name = '';
  for (const inst of dirtyQueue) {
    if (inst._loopReported === true) continue;
    inst._loopReported = true;
    if (name === '') name = inst.type.displayName || inst.type.name || 'Anonymous';
  }
  return name;
}

// The loop ends with the render of what is queued now.
function stopLoop() {
  for (const inst of dirtyQueue) {
    if (inst._stuck === true) continue;
    inst._stuck = true;
    stuck.push(inst);
  }
  const name = unreported();
  if (name !== '') {
    // (The explanation is development's, as for the hook error above.)
    console.error(`[what-react] Too many re-renders for <${name}>` + (__DEV__ ? ': it sets state every time it renders (an effect with no dependencies?). Possible infinite loop. Its updates are refused until the page gets a turn.' : '.'));
  }
  if (!releaseScheduled) {
    releaseScheduled = true;
    setTimeout(releaseStuck, 0);
  }
}

function releaseStuck() {
  releaseScheduled = false;
  chained = 0;
  const released = stuck.splice(0);
  for (let i = 0; i < released.length; i++) {
    const inst = released[i];
    inst._stuck = false;
    if (inst._refused === true) {
      inst._refused = false;
      scheduleUpdate(inst);
    }
  }
}

/** Whether `inst` takes no state update now (the loop guard stopped it). */
export function _isStuck(inst) {
  return inst._stuck === true && currentInstance !== inst;
}

// The flush a state update scheduled, from a microtask.
function scheduledFlush() {
  if (yielding) {
    // Rendering waits for the event loop (below): what was queued stays queued.
    flushScheduled = true;
    return;
  }
  if (dirtyQueue.size > 0) {
    if (++chained >= PROBE_AT && !probing) probe();
    if (chained > CHAIN_LIMIT) {
      const name = unreported();
      if (name !== '') {
        console.error(`[what-react] <${name}> has rendered ${CHAIN_LIMIT} times in a row` + (__DEV__ ? ' without the page getting a turn (state set from a promise, in an effect that runs every time?). Possible infinite loop. Rendering goes on once the page had its turn; no update is lost.' : '.'));
      }
      yielding = true;
      flushScheduled = true;
      setTimeout(() => {
        yielding = false;
        chained = 0;
        flushUpdates();
      }, 0);
      return;
    }
  }
  flushUpdates();
}

export function scheduleUpdate(inst) {
  if (!inst || inst.unmounted) return;
  if (currentInstance === inst) {
    // Render-phase update (setState during render of the same component):
    // re-run the component function before committing, like React.
    inst._renderPhaseUpdate = true;
    return;
  }
  if (inst._server) return;
  if (inst._stuck === true) {
    // Rendered once the event loop has turned (releaseStuck).
    inst._refused = true;
    return;
  }
  dirtyQueue.add(inst);
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(scheduledFlush);
  }
}

/** Render everything queued. False when the update-loop guard ended it. */
/** @internal What a commit outside a render queued renders now (mixed.js: a hole's commit takes in its error and Suspense fallbacks, as React's does). */
export function _flushQueued() {
  if (dirtyQueue.size > 0 && _canFlushSynchronously()) flushUpdates();
}

export function flushUpdates() {
  flushScheduled = false;
  let cycles = 0;
  let tripped = false;
  for (;;) {
    // React runs the last commit's passive effects before it renders again:
    // an effect never sees a later render's values first, and what it
    // registered (a listener, a layer in a registry) is in place before a
    // render reads it.
    _flushPendingPassive();
    if (dirtyQueue.size === 0) return !tripped;
    if (++cycles > CYCLE_LIMIT) {
      // What is queued renders below, and takes no update after that.
      tripped = true;
      stopLoop();
    }
    // Parents before children: a parent re-render may update child props,
    // making a separately-queued child render redundant.
    /** @type {any[]} */
    let batch;
    if (dirtyQueue.size === 1) {
      batch = [];
      for (const inst of dirtyQueue) batch.push(inst);
    } else {
      batch = [...dirtyQueue].sort((a, b) => a.depth - b.depth);
    }
    commitDepth++;
    try {
      for (let i = 0; i < batch.length; i++) {
        const inst = batch[i];
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
    } finally {
      exitCommit();
    }
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
    if (other == null) continue; // a ref of an element no component rendered
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
export const insertionQueue = [];
/** The layout phase: host elements' refs (and autoFocus) and components' layout effects, child first. */
export const layoutQueue = [];
export const passiveQueue = [];
/** @type {Array<() => void>} The passive cleanups of components this commit removed. */
const unmountedPassive = [];
let passiveScheduled = false;

/**
 * Whether flushSync() may render now: not while a component renders, a
 * commit runs or its effects run (React defers it then, and warns). A flush
 * started there would start a render loop of its own on each nested call,
 * past the guard that ends an update loop.
 */
export function _canFlushSynchronously() {
  return currentInstance === null && commitDepth === 0 && effectDepth === 0;
}

export function runInCommit(fn) {
  commitDepth++;
  try {
    return fn();
  } finally {
    exitCommit();
  }
}

function exitCommit() {
  if (--commitDepth !== 0) return;
  // React's commit order: insertion effects (a CSS-in-JS library writes
  // its rules before anything reads layout), then the layout phase (the DOM
  // is in the document): each element's ref and each component's layout
  // effects in one pass, children first, all synchronously; passive effects
  // later.
  if (mirrors.size > 0) syncMirrors();
  flushInsertionQueue();
  flushEffectQueue(layoutQueue);
  if ((passiveQueue.length > 0 || unmountedPassive.length > 0) && !passiveScheduled) {
    passiveScheduled = true;
    queueMicrotask(_flushPassive);
  }
}

// A host element's entry in the layout phase: its ref attaches (unless the
// element was unmounted, ref nulled, or the ref swapped), or, for autoFocus,
// it takes the focus as React gives it when it mounts.
function commitRef(entry) {
  if (entry.focus === true) {
    if (entry.el.isConnected) {
      try { entry.el.focus(); } catch { /* not focusable */ }
    }
    return;
  }
  if (entry.rn.ref !== entry.ref) return;
  try {
    attachRef(entry.rn, entry.ref, entry.el);
  } catch (e) {
    console.error('[what-react] ref error:', e);
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
export function _flushPendingPassive() {
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
        // An unmounted component's cleanups ran as it unmounted; a ref has none.
        if (entry.slot === undefined || entry.inst.unmounted) continue;
        const cleanup = entry.slot.cleanup;
        if (cleanup) {
          entry.slot.cleanup = null;
          try { cleanup(); } catch (e) { console.error('[what-react] effect cleanup error:', e); }
        }
      }
      for (let i = 0; i < batch.length; i++) {
        const entry = batch[i];
        if (entry.slot === undefined) {
          commitRef(entry);
          continue;
        }
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
  _pushEffect(inst._pendingInsertion || (inst._pendingInsertion = []), inst, slot, fn);
}

export function _pushLayout(inst, slot, fn) {
  _pushEffect(inst._pendingLayout || (inst._pendingLayout = []), inst, slot, fn);
}

export function _pushPassive(inst, slot, fn) {
  _pushEffect(inst._pendingPassive || (inst._pendingPassive = []), inst, slot, fn);
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
  if (entries === null) return;
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
    // An update loop: the guard ended it.
    if (!flushUpdates()) break;
    flushEffectQueue(layoutQueue);
    _flushPassive();
  }
  if (restoring.length > 0) restoreFields();
}

// =====================================================================
// VNode classification & normalization
// =====================================================================

function kindOf(v) {
  // An empty string is no child to React (it makes no text node for one).
  if (v == null || typeof v === 'boolean' || v === '') return KIND_HOLE;
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

// ---- Child lists ----
// A child is found again by its place in its own list: by its key when it
// has one, by its index otherwise, and a nested array is a list of its own
// (React gives it a fragment), so:
//   - an unkeyed child keeps its place whatever happens around it: a keyed
//     sibling that comes or goes, a neighbouring `.map()` list that grows;
//   - a keyed child is found again wherever it moved inside its list.
// The reconciler takes a child list flat, in document order, holes kept, and
// for each child two values that together are that place: its `id` (the key
// as a string, or the index as a number) and its `list` (null at the top
// level, '2:' for a child of the array at index 2, '2:0:' one level down).

/**
 * The lists the children flatten() returned are in, or null when all are at the top level. Read at once.
 * @type {Array<string | null> | null}
 */
export let flatLists = null;
/**
 * Their ids, or null: the top-level children as they were given, each one's id its key or its index.
 * @type {Array<number | string> | null}
 */
export let flatIds = null;

/** @type {string[]} */
const LIST_NAMES = [];

// The name of the list at index `i` of the list `list`. One string per index
// at the top level, so two renders name a list with the same string.
function listName(list, i) {
  if (list !== null) return list + i + ':';
  return LIST_NAMES[i] || (LIST_NAMES[i] = i + ':');
}

function keyOfChild(child) {
  if (typeof child === 'object' && child !== null && child.key != null && isVNode(child)) {
    const key = child.key;
    return typeof key === 'string' ? key : '' + key;
  }
  return null;
}

// The id of a child of kind `kind` at index `i` of its list.
function idOf(v, kind, i) {
  if (kind >= KIND_ELEMENT && typeof v === 'object' && v.key != null && (kind !== KIND_OPAQUE || isVNode(v))) {
    const key = v.key;
    return typeof key === 'string' ? key : '' + key;
  }
  return i;
}

/**
 * `value` (what a component returned, an element's children) as a flat list.
 * An array with no array inside it is returned as it is, with no ids: that
 * is every list of rows and nearly every element's children, and nothing is
 * copied for them.
 */
export function flatten(value) {
  flatIds = null;
  flatLists = null;
  if (!Array.isArray(value)) return [value];
  for (let i = 0; i < value.length; i++) {
    if (Array.isArray(value[i])) {
      const out = [];
      const ids = [];
      const lists = [];
      pushFlat(value, null, out, ids, lists);
      flatIds = ids;
      flatLists = lists;
      return out;
    }
  }
  return value;
}

function pushFlat(list, name, out, ids, lists) {
  for (let i = 0; i < list.length; i++) {
    const child = list[i];
    if (Array.isArray(child)) {
      pushFlat(child, listName(name, i), out, ids, lists);
      continue;
    }
    out.push(child);
    lists.push(name);
    const key = keyOfChild(child);
    ids.push(key !== null ? key : i);
  }
}

// A place as one value, for a map: at the top level an index as it is and a
// key behind '$' (a key that reads like a nested list's place, '0:0', is not
// that place), and behind the list's name inside one.
function slotOf(list, id) {
  if (list === null) return typeof id === 'string' ? '$' + id : id;
  return typeof id === 'number' ? list + id : list + '$' + id;
}

/**
 * A child list with a name for each child's place (`slots`), for code that
 * keys something of its own by it (mixed.js, a placeholder per child): the
 * index for a top-level unkeyed child, '$key' for a keyed one, and the same
 * behind the list's name ('2:0', '2:$key') in a nested array. Holes are null.
 */
export function normalizeChildren(value) {
  const out = [];
  /** @type {Array<number | string>} */
  const slots = [];
  /** @type {any} */ (out).slots = slots;
  if (Array.isArray(value)) pushChildren(value, null, out, slots);
  else if (value == null || typeof value === 'boolean') {
    out.push(null);
    slots.push(0);
  } else {
    out.push(value);
    // A lone child is found by its key too: `return <Form key={user} />`
    // (a component's whole output, a Fragment's only child) mounts a new
    // Form when the key changes, which is how React code resets state.
    slots.push(typeof value === 'object' && value.key != null && isVNode(value) ? '$' + value.key : 0);
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

/** @type {any[]} What an element with no child rnodes holds. Never written to. */
export const NO_RNODES = [];
/** @type {any[]} What a textarea holds: its children were its default value (mountTextarea). Never written to. */
export const TEXTAREA_KIDS = [];
/** The output of a component that returned an empty list: one hole (see renderOutput). */
const HOLE_KIDS = [null];

/**
 * Reconcile the rendered nodes `old` with the child list `value` inside
 * `parentDom`, new nodes going before `anchor` (null: at the end). Returns
 * the new list of rendered nodes. `into` is what holds the list (see
 * placeFromSiblings): a root (`{ container, rns }`), a slot
 * (`{ end, rns }`, mixed.js), or a portal's or an element's rendered node.
 */
export function patchChildren(parentDom, old, value, anchor, svg, owner, into) {
  const kids = flatten(value);
  return reconcile(parentDom, old, kids, flatIds, flatLists, anchor, svg, owner, null, into);
}

/**
 * Diff the rendered nodes `old` against the flat child list `kids`.
 *
 * - A child matches the old node in its place (its `id` in its `list`) when
 *   the type is the same; otherwise the old node unmounts and a new one
 *   mounts, like React's replace.
 * - Children render left to right (render and effect order match React's),
 *   and every child of the list has rendered before a removed one is cleaned
 *   up and taken out.
 * - A list that kept its places is patched where it stands: nothing is
 *   looked up, no DOM node is read or moved. So is everything before and
 *   after the part of a list that changed.
 * - A new node is built in full before it enters the document, and enters it
 *   once. In a list that had nothing it goes straight to its place; among
 *   kept nodes it is placed after the whole list has rendered, right to left.
 * - A kept node is moved only when the list's own order changed (React's
 *   rule: it now stands after a node that used to follow it). Where a kept
 *   node sits among nodes this list does not own is never corrected: a
 *   portal's container holds other portals' nodes and nodes a library
 *   appended, and re-inserting a kept node to "fix" its place blurs the
 *   focused element inside it and restarts its animations.
 *
 * `inst`: the component whose output this is, when its place is not given
 * (a component has no markers: its place is where its own nodes are, or
 * where what follows it is); then `parentDom` and `anchor` are found from
 * `old` if a node has to be placed. `into`: what holds the list (the
 * component, an element's or a portal's rendered node, a root, a slot), which
 * every component mounted here keeps to find its place by (placeOf).
 */
function reconcile(parentDom, old, kids, ids, lists, anchor, svg, owner, inst, into) {
  const oldLen = old.length;
  const newLen = kids.length;
  const result = new Array(newLen);
  if (oldLen === 0) return mountChildren(parentDom, kids, ids, lists, 0, newLen, result, anchor, svg, owner, into);

  // --- The start of the list that kept its places: patched where it stands ---
  let start = 0;
  const min = oldLen < newLen ? oldLen : newLen;
  while (start < min) {
    const v = kids[start];
    const kind = kindOf(v);
    const rn = old[start];
    if (!stays(rn, v, kind, ids, lists, start)) break;
    result[start] = patchRNode(rn, v, kind, svg, owner);
    start++;
  }
  if (start === oldLen) {
    if (start === newLen) return result;
    // Everything stayed, and children were added after it.
    if (inst !== null) {
      placeOf(inst, result, start);
      parentDom = placeParent;
      anchor = placeAnchor;
    }
    return mountChildren(parentDom, kids, ids, lists, start, newLen, result, anchor, svg, owner, into);
  }

  // --- The end of the list that kept its places (found now, patched in turn) ---
  let oldEnd = oldLen;
  let newEnd = newLen;
  while (oldEnd > start && newEnd > start) {
    const at = newEnd - 1;
    const v = kids[at];
    const kind = kindOf(v);
    const rn = old[oldEnd - 1];
    if (!stays(rn, v, kind, ids, lists, at)) break;
    oldEnd--;
    newEnd--;
  }

  if (newEnd === start) {
    // Children left, and nothing else changed.
    patchTail(old, oldEnd, kids, newEnd, result, svg, owner);
    for (let i = start; i < oldEnd; i++) unmountRNode(old[i], true);
    return result;
  }

  if (oldEnd === start) {
    // Children came, before the end that stayed: they go in front of its
    // first node in the list's element (a hole or a portal has none, and a
    // library may have taken one elsewhere: the next one's).
    const ref = firstDomNodeFrom(old, oldEnd, parentDom);
    const at = ref !== null ? ref.parentNode : null;
    if (at !== null && (inst !== null || at === parentDom)) {
      mountChildren(at, kids, ids, lists, start, newEnd, result, ref, svg, owner, into);
      patchTail(old, oldEnd, kids, newEnd, result, svg, owner);
      return result;
    }
  }

  // --- The middle: children came, left or moved ---
  /** @type {Map<number | string, any>} */
  const byPlace = new Map();
  for (let i = start; i < oldEnd; i++) {
    const rn = old[i];
    rn._i = i;
    rn._kept = false;
    // A duplicate key keeps the first; the others mount again.
    const place = slotOf(rn.list, rn.id);
    if (!byPlace.has(place)) byPlace.set(place, rn);
  }
  let lastPlaced = -1; // the highest old index among the kept nodes so far
  for (let i = start; i < newEnd; i++) {
    const v = kids[i];
    const kind = kindOf(v);
    const id = ids !== null ? ids[i] : idOf(v, kind, i);
    const list = lists !== null ? lists[i] : null;
    const match = byPlace.get(slotOf(list, id));
    if (match !== undefined && match._kept !== true && canPatch(match, v, kind)) {
      match._kept = true;
      if (match._i < lastPlaced) match._move = true;
      else lastPlaced = match._i;
      result[i] = patchRNode(match, v, kind, svg, owner);
    } else {
      // Built whole, outside the document; placed below.
      const rn = mountRNode(v, kind, null, null, svg, owner, into);
      rn.id = id;
      rn.list = list;
      rn._i = -1;
      result[i] = rn;
    }
  }
  patchTail(old, oldEnd, kids, newEnd, result, svg, owner);

  // Where the middle ends: at the first node of the end that stayed, or
  // where the list ends. Read while the nodes that leave are still there.
  let ref = anchor;
  if (inst !== null) {
    placeOf(inst, old, oldLen);
    parentDom = placeParent;
    ref = placeAnchor;
  }
  if (newEnd < newLen) {
    const first = firstDomNodeFrom(result, newEnd, parentDom);
    if (first !== null) ref = first;
  }

  for (let i = start; i < oldEnd; i++) {
    if (old[i]._kept !== true) unmountRNode(old[i], true);
  }

  if (parentDom === null) return result; // not in a document (its own nodes were taken out)
  // A cleanup may have taken out a node this list does not own.
  if (ref !== null && ref.parentNode !== parentDom) ref = anchor !== null && anchor.parentNode === parentDom ? anchor : null;

  for (let i = newEnd - 1; i >= start; i--) {
    const rn = result[i];
    let first = firstDomNode(rn);
    if (rn._i === -1 || rn._move === true || (first !== null && first.parentNode !== parentDom)) {
      rn._move = false;
      placeRNode(rn, parentDom, ref);
      first = firstDomNode(rn);
    }
    if (first !== null) ref = first;
  }
  return result;
}

// Whether the rendered node `rn` is the child `v` at index `i` of the list:
// in the same place, and of a type it can be patched to.
function stays(rn, v, kind, ids, lists, i) {
  if (ids !== null) {
    if (rn.id !== ids[i] || rn.list !== /** @type {any[]} */ (lists)[i]) return false;
  } else {
    if (rn.list !== null) return false;
    const key = kind >= KIND_ELEMENT && typeof v === 'object' ? v.key : null;
    if (key == null) {
      if (rn.id !== i) return false;
    } else if (rn.key !== key && rn.id !== idOf(v, kind, i)) {
      // (The key it was mounted with, as it was given, is compared first:
      // a row that stayed is found without making a string of its key.)
      return false;
    }
  }
  return canPatch(rn, v, kind);
}

// Patch the end of a list that kept its places: old[oldFrom..] are kids[newFrom..].
function patchTail(old, oldFrom, kids, newFrom, result, svg, owner) {
  for (let i = oldFrom, at = newFrom; i < old.length; i++, at++) {
    const v = kids[at];
    result[at] = patchRNode(old[i], v, kindOf(v), svg, owner);
  }
}

// Mount kids[from..to) into `parentDom` before `before`, each in its place
// as it is made (`parentDom` null: outside the document, to be placed).
export function mountChildren(parentDom, kids, ids, lists, from, to, result, before, svg, owner, into) {
  let i = from;
  try {
    for (; i < to; i++) {
      const v = kids[i];
      const kind = kindOf(v);
      const rn = mountRNode(v, kind, parentDom, before, svg, owner, into);
      rn.id = ids !== null ? ids[i] : idOf(v, kind, i);
      if (lists !== null) rn.list = lists[i];
      result[i] = rn;
    }
  } catch (err) {
    // A child threw as it mounted: what this list placed before it leaves
    // with it (the component above resets its output, renderOutput).
    if (parentDom !== null) {
      for (let j = from; j < i; j++) removeNodes(domNodesOf(result[j]));
    }
    throw err;
  }
  return result;
}

/** Where a component's nodes are: set by placeOf(). */
/** @type {any} */
let placeParent = null;
/** @type {any} */
let placeAnchor = null;

// The place of a component without markers, from the nodes it owns: the
// parent of its last node, and the node after it. `rns[0..count)` are its
// rendered nodes. A node a library took elsewhere or out of the document
// does not decide (the element the component was mounted in does, when that
// is known). With no node of its own in place (it renders nothing, a portal,
// or a library removed what it rendered), its place is found from what
// follows it, as React finds it.
function placeOf(inst, rns, count) {
  const host = inst._host;
  for (let i = count - 1; i >= 0; i--) {
    const node = lastDomNode(rns[i]);
    if (node === null) continue;
    const parent = node.parentNode;
    if (parent !== null && (host === null || parent === host)) {
      placeParent = parent;
      placeAnchor = node.nextSibling;
      return;
    }
  }
  placeFromSiblings(inst);
}

// What `child` (a component instance, or a portal's rendered node) stands
// in: up through what holds each list (`_in`) to the first that is not a
// component without markers. That one is the place: an element's rendered
// node (its element), a portal's (its container; with `through`, where the
// portal itself stands, for an event's React path), a root (its container),
// a slot (mixed.js) or an island with markers (its end marker). An island
// without markers is where its nodes are. Sets placeParent (null when no
// place is known: a React island whose every node a library removed) and
// placeAnchor (the end marker, else null).
function hostOf(child, through) {
  /** @type {any} */
  let into = child._in;
  while (into != null && (into.end === null || (through && into.kind === KIND_PORTAL && into.dom === null))) {
    child = into;
    into = into._in;
  }
  if (into == null) {
    placeParent = _hostParent(child);
    placeAnchor = null;
    return;
  }
  const end = into.end != null ? into.end : null;
  placeAnchor = end;
  placeParent = into.kind === KIND_ELEMENT ? into.dom
    : into.kind === KIND_PORTAL ? (through ? into.dom.parentNode : into.mirror !== undefined ? into.mirror.shadow : into.container)
    : end !== null ? end.parentNode : into.container;
}

// React's getHostSibling: a component with no node in place goes before the
// first node of what follows it in the tree, inside the element that holds
// it: from the innermost list out to that element (or range), the first
// node after the component's entry that stands in it; else the element's
// (or the range's) end.
function placeFromSiblings(inst) {
  hostOf(inst, false);
  const parent = placeParent;
  /** @type {any} */
  let child = inst;
  /** @type {any} */
  let into = inst._in;
  for (; parent != null && into != null; child = into, into = into._in) {
    const list = into.kind !== undefined ? into.children : into.rns || into.rendered;
    let j = 0;
    while (j < list.length && list[j].inst !== child) j++;
    while (++j < list.length) {
      const node = firstDomNode(list[j]);
      if (node !== null && node.parentNode === parent) { placeAnchor = node; return; }
    }
    if (into.end !== null) return;
  }
}

// The first DOM node of rns[from..] that stands in `parent` (any parent
// when null), skipping what has none (a hole, a portal).
function firstDomNodeFrom(rns, from, parent) {
  for (let i = from; i < rns.length; i++) {
    const node = firstDomNode(rns[i]);
    if (node !== null && (parent === null || node.parentNode === parent)) return node;
  }
  return null;
}

// The top-level DOM nodes `rn` owns, in tree order. A component's are what
// its output owns, found through the rendered tree and never by walking
// siblings: a library may have moved one of its elements (cmdk sorts its
// items in the DOM), and what a library inserted next to them is not the
// component's. React finds host nodes the same way, through the fiber tree.
function domNodesOf(rn, out = []) {
  switch (rn.kind) {
    case KIND_HOLE:
    case KIND_TEXT:
    case KIND_ELEMENT:
    case KIND_PORTAL:
      if (rn.dom) out.push(rn.dom);
      return out;
    case KIND_COMPONENT: {
      const rendered = rn.inst.rendered;
      for (let i = 0; i < rendered.length; i++) domNodesOf(rendered[i], out);
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

/** The top-level DOM nodes of what `inst` rendered (dom.js findDOMNode, Suspense). */
export function _domNodes(inst) {
  const out = [];
  if (inst.start != null) {
    // An island with markers: what stands between them.
    for (let n = inst.start.nextSibling; n && n !== inst.end; n = n.nextSibling) out.push(n);
    return out;
  }
  const rendered = inst.rendered;
  for (let i = 0; i < rendered.length; i++) domNodesOf(rendered[i], out);
  return out;
}

/** The DOM node `inst`'s output stands in, or null before it is in one (hooks.js useFormStatus). */
export function _hostParent(inst) {
  if (inst.end != null) return inst.end.parentNode;
  const rendered = inst.rendered;
  for (let i = 0; i < rendered.length; i++) {
    const node = firstDomNode(rendered[i]);
    if (node !== null && node.parentNode !== null) return node.parentNode;
  }
  // No node of its own in the document: where it stands in its parent's.
  if (inst._in != null) {
    hostOf(inst, false);
    return placeParent;
  }
  return inst._host;
}

function removeNodes(nodes) {
  for (let i = 0; i < nodes.length; i++) nodes[i].remove();
}

function firstDomNode(rn) {
  switch (rn.kind) {
    case KIND_COMPONENT: {
      const rendered = rn.inst.rendered;
      for (let i = 0; i < rendered.length; i++) {
        const node = firstDomNode(rendered[i]);
        if (node !== null) return node;
      }
      return null;
    }
    case KIND_OPAQUE:
      return rn.start;
    default:
      return rn.dom || null;
  }
}

function lastDomNode(rn) {
  switch (rn.kind) {
    case KIND_COMPONENT: {
      const rendered = rn.inst.rendered;
      for (let i = rendered.length - 1; i >= 0; i--) {
        const node = lastDomNode(rendered[i]);
        if (node !== null) return node;
      }
      return null;
    }
    case KIND_OPAQUE:
      return rn.end;
    default:
      return rn.dom || null;
  }
}

// Put the top-level nodes of `rn` into `parentDom` before `ref`, in order.
function placeRNode(rn, parentDom, ref) {
  switch (rn.kind) {
    case KIND_COMPONENT: {
      const rendered = rn.inst.rendered;
      for (let i = 0; i < rendered.length; i++) placeRNode(rendered[i], parentDom, ref);
      return;
    }
    case KIND_OPAQUE: {
      let n = rn.start;
      const end = rn.end;
      while (n) {
        const next = n.nextSibling;
        parentDom.insertBefore(n, ref);
        if (n === end) break;
        n = next;
      }
      return;
    }
    default:
      if (rn.dom) parentDom.insertBefore(rn.dom, ref);
  }
}

// ---- Mount ----
// A node is made at its place: in `parentDom` before `before` (null: at the
// end). With `parentDom` null it is made outside the document and placed by
// the list it belongs to (placeRNode), once the list knows where.

/**
 * While an island renders over the server's HTML (hydrate.js): what mounts
 * a node instead, taking the server's node at its place; it returns null for
 * a node it leaves to the mount below. Called with kind -1 when a component
 * under a <Suspense> suspends (handleRenderError). Null at any other time.
 * @type {((v: any, kind: number, parentDom: any, before?: any, svg?: any, owner?: any, into?: any) => any) | null}
 */
export let claim = null;

/**
 * @internal hydrate.js: start (a function) or end (null) an island's
 * claiming render. While it runs, useSyncExternalStore reads the server
 * snapshot (hooks.js).
 */
export function _setClaim(fn) {
  claim = fn;
}

export function mountRNode(v, kind, parentDom, before, svg, owner, into) {
  if (claim !== null) {
    const claimed = claim(v, kind, parentDom, before, svg, owner, into);
    if (claimed !== null) return claimed;
  }
  switch (kind) {
    case KIND_TEXT: {
      const text = typeof v === 'string' ? v : String(v);
      const dom = document.createTextNode(text);
      if (parentDom !== null) parentDom.insertBefore(dom, before);
      return { kind, vnode: v, key: null, dom, id: 0, list: null, text };
    }
    case KIND_ELEMENT:
      return mountElement(v, parentDom, before, svg, owner);
    case KIND_COMPONENT:
      return mountComponent(v, parentDom, before, svg, owner, into);
    case KIND_PORTAL:
      return mountPortal(v, parentDom, before, owner, into);
    case KIND_OPAQUE:
      return mountOpaque(v, parentDom, before);
  }
  return mountHole(v, parentDom, before, into);
}

// A hole (null, undefined, a boolean) keeps its slot in the list and, as in
// React, puts no node in the document: what is placed in it later finds its
// place from what follows it (placeFromSiblings). One exception: at the top
// of a React island without markers (`into._top`: the island, or a component
// that is all or part of its output), where nothing follows inside React and
// the native code around the island holds no place for it, a hole is a
// comment, so the island always has a node to be found by.
function mountHole(v, parentDom, before, into) {
  return { kind: KIND_HOLE, vnode: v, key: null, dom: topComment(into, 'w:h', parentDom, before), id: 0, list: null };
}

// The comment a hole or a portal is at the top of an island, else null.
function topComment(into, text, parentDom, before) {
  if (into == null || into._top !== true) return null;
  const dom = document.createComment(text);
  if (parentDom !== null) parentDom.insertBefore(dom, before);
  return dom;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const MATH_NS = 'http://www.w3.org/1998/Math/MathML';

// The host mode an element's children are created in (the `svg` argument
// that mounting and patching carry): false (HTML), true (SVG), MATH (inside
// a <math>: MathML), or the mirror of a portal into a document that is not
// the DOM's (mountElement). As React decides it (getChildNamespace): <svg>
// starts SVG and <math> MathML from HTML, an SVG <foreignObject>'s children
// are HTML again, and the rest keeps the mode it is in.
export const MATH = 'math';

// The namespace the element `tag` is created in, in host mode `mode` (not
// a mirror): SVG_NS, MATH_NS, or null for HTML.
function nsIn(mode, tag) {
  return mode === true || (mode !== MATH && tag === 'svg') ? SVG_NS : mode === MATH || tag === 'math' ? MATH_NS : null;
}

// A portal target may live inside an <svg> (recharts 3.x z-index layers are
// SVG <g> portal targets) or a <math>: what is portaled into it is created in
// its namespace, not HTML's.
function targetMode(target) {
  if (!target) return false;
  const ns = target.namespaceURI;
  return ns === SVG_NS ? target.tagName !== 'foreignObject' : ns === MATH_NS && MATH;
}

// camelCase React SVG prop → correct kebab/colon SVG attribute name.
// Covers the presentation/text/clip attributes charting libs (recharts) emit,
// and the font and rendering attributes recharts puts on <text>, axes, ticks
// and legends: each is its camelCase name in kebab case. SVG keeps an
// attribute's case, and only lowercase `tabindex` makes an SVG element
// focusable (recharts' surface takes tabIndex).
/** @type {Record<string, string>} */
export const SVG_ATTR_MAP = { tabIndex: 'tabindex' };
for (const name of ('strokeWidth strokeDasharray strokeDashoffset strokeLinecap strokeLinejoin strokeMiterlimit strokeOpacity fillOpacity fillRule clipPath clipRule stopColor stopOpacity textAnchor dominantBaseline alignmentBaseline baselineShift colorInterpolation colorInterpolationFilters floodColor floodOpacity letterSpacing wordSpacing pointerEvents shapeRendering vectorEffect paintOrder markerStart markerMid markerEnd fontSize fontFamily fontWeight fontStyle fontVariant fontStretch textRendering imageRendering writingMode lightingColor').split(' ')) {
  SVG_ATTR_MAP[name] = name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

// The text of an element whose children are one string or number, or null.
// Such an element holds its text as its content and no rendered node for it,
// as React does: one DOM call writes it.
export function onlyText(kids) {
  let only = kids;
  if (Array.isArray(kids)) {
    if (kids.length !== 1) return null;
    only = kids[0];
  }
  if (typeof only === 'string') return only;
  return typeof only === 'number' ? '' + only : null;
}

// Change an element's text content: the text node it has is kept when it is
// all the element holds and the text is not empty (React's setTextContent;
// an empty text leaves no node).
export function setText(el, text) {
  const first = el.firstChild;
  if (text !== '' && first !== null && first.nodeType === 3 && first.nextSibling === null) first.data = text;
  else el.textContent = text;
}

function mountElement(v, parentDom, before, svg, owner) {
  const tag = v.tag;
  // `svg` is the host mode (MATH above): false, true, MATH, or the mirror of
  // a portal into a document that is not the DOM's (below).
  const mirror = typeof svg === 'object' && svg !== null ? svg : null;
  const ns = mirror !== null ? null : nsIn(svg, tag);
  const isSvgEl = ns === SVG_NS;
  const childSvg = mirror !== null ? mirror : isSvgEl ? tag !== 'foreignObject' : ns !== null && MATH;
  const el = ns !== null ? document.createElementNS(ns, tag) : document.createElement(tag);
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
    kind: KIND_ELEMENT, vnode: v, key: v.key ?? null, dom: el, id: 0, list: null,
    children: NO_RNODES, ref: props.ref || null,
    /** @type {string | null} Its text, when its children are one string or number. */
    text: null,
  };

  // Children: into the element, in order, before the element is placed.
  const raw = v.children !== undefined ? v.children : props.children;
  const text = onlyText(raw);
  if (text !== null) {
    rn.text = text;
    if (text !== '') el.textContent = text;
  } else if (tag !== 'noscript') {
    // (What a <noscript> holds is never rendered in the browser, as in React.)
    const kids = flatten(raw);
    if (kids.length > 0) rn.children = mountChildren(el, kids, flatIds, flatLists, 0, kids.length, new Array(kids.length), null, childSvg, owner, rn);
  }

  // Controlled props after children (e.g. <select> options must exist)
  if (hasValue) setProperty(el, 'value', value, undefined, isSvgEl);
  if (hasChecked) setProperty(el, 'checked', checked, undefined, isSvgEl);
  if (ns === null) {
    if (tag === 'input') trackField(el);
    else if (tag === 'textarea') {
      mountTextarea(rn, el, value);
      trackField(el);
    } else if (tag === 'select' && value == null) resetSelect(el, props.defaultValue);
  }

  // Refs attach at commit exit — AFTER the element is inserted into the live
  // DOM — so ref callbacks that measure layout (getBoundingClientRect etc.)
  // see real geometry, like React.
  if (props.autoFocus === true) layoutQueue.push({ focus: true, el, inst: owner });
  if (rn.ref) layoutQueue.push({ rn, ref: rn.ref, el, inst: owner });

  if (parentDom !== null) parentDom.insertBefore(el, before);
  return rn;
}

// React reads a textarea's children once, as its default value, and writes
// its value, so the user's text is the field's own from then on: children
// that change later are not rendered (patchTextarea).
function mountTextarea(rn, el, value) {
  if (rn.children !== NO_RNODES) return; // element children: not React's textarea
  rn.text = null;
  rn.children = TEXTAREA_KIDS;
  if (value == null && el.textContent !== '') el.value = el.textContent;
}

// A textarea that renders again: React's updateTextarea. Its children are
// left alone, and an uncontrolled one without `defaultValue` gets the
// default value '' (what form.reset() goes back to), as in React 19; what it
// shows does not change.
function patchTextarea(el, props) {
  if (props.value == null && props.defaultValue == null && el.defaultValue !== '') el.defaultValue = '';
}

// A component has no nodes of its own: what it renders stands where the
// component stands, and its place is found from those nodes, or from what
// follows it when it has none (placeOf). It always renders at least one
// rendered node (an empty output is a hole), so it has an entry in its list.
export function mountComponent(v, parentDom, before, svg, owner, into) {
  const tag = v.tag;
  const renderFn = (typeof tag === 'function' && tag._compatType) ? tag._compatType : tag;
  const inst = newInstance(renderFn, v.props || EMPTY_OBJ, v.key ?? null, owner, null, null, svg);
  // The element it stands in, when it is mounted into one (a fragment is
  // only where it is built), and what holds its entry.
  if (parentDom !== null && parentDom.nodeType === 1) inst._host = parentDom;
  inst._in = into;
  inst._top = into != null && into._top === true;
  const rn = { kind: KIND_COMPONENT, vnode: v, key: inst.key, bridge: tag, inst, id: 0, list: null };
  renderOutput(inst, parentDom, before, true);
  return rn;
}

function newInstance(type, props, key, parent, start, end, svg) {
  return {
    type,
    props,
    key,
    /** @type {any[] | null} Its hook slots, made by the first hook. */
    hooks: null,
    hookIndex: 0,
    parent,
    depth: parent ? parent.depth + 1 : 0,
    // Its markers, for an island a hydrating page holds a place for (the
    // server's, or two of its own until the walk is over); null otherwise.
    start, end, svg,
    /** @type {any} The element its output stands in, when known (placeOf). */
    _host: null,
    /** @type {any} What holds its entry: a component, an element's or a portal's rendered node, a root, a slot (placeFromSiblings). */
    _in: null,
    /** Its output is all or part of the top of a React island without markers (mountHole). */
    _top: false,
    rendered: NO_RNODES,
    unmounted: false,
    _renderPhaseUpdate: false,
    /** @type {any[] | null} The effects a render queued, until its subtree has committed. */
    _pendingInsertion: null,
    /** @type {any[] | null} */
    _pendingLayout: null,
    /** @type {any[] | null} */
    _pendingPassive: null,
    _track: null,
    /** @type {(() => void) | null} What a signal read by a render calls (renderTracked). */
    _tracker: null,
    _dispose: null,
    // The What owner native components rendered below this instance are
    // created under (an island's: where the island stands in native code).
    _nativeOwner: undefined,
  };
}

// A portal puts no node where it stands (a comment only at the top of an
// island, as a hole does): its children are in its container.
export function mountPortal(v, parentDom, before, owner, into) {
  const target = v.props && v.props.container;
  const rn = { kind: KIND_PORTAL, vnode: v, key: v.key ?? null, dom: topComment(into, 'w:portal', parentDom, before), id: 0, list: null, container: target || null, children: NO_RNODES, _in: into };
  if (!target) {
    console.warn('[what-react] createPortal: target container not found');
    return rn;
  }
  if (isForeignHost(target)) {
    rn.mirror = createMirror(target);
    rn.children = patchChildren(rn.mirror.shadow, NO_RNODES, v.children, null, rn.mirror, owner, rn);
    return rn;
  }
  registerPortal(rn);
  rn.children = patchChildren(target, NO_RNODES, v.children, null, targetMode(target), owner, rn);
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
function mountOpaque(v, parentDom, before) {
  const start = document.createComment('w:o');
  const end = document.createComment('/w:o');
  // Several nodes: outside the document they stand in a fragment, which the
  // list that places them empties (placeRNode).
  const into = parentDom !== null ? parentDom : document.createDocumentFragment();
  into.insertBefore(start, before);

  /** @type {(() => void) | null} */
  let dispose = null;
  /** @type {DocumentFragment | null} */
  let holder = null;
  if (typeof v === 'object' && typeof v.nodeType === 'number') {
    // Raw DOM node — insert as-is, caller owns its lifecycle.
    into.insertBefore(v, before);
  } else {
    holder = document.createDocumentFragment();
    try {
      dispose = whatMount(v, holder);
    } catch (e) {
      console.error('[what-react] Failed to render What-native child:', e);
    }
    into.insertBefore(holder, before); // moves rendered nodes inline
  }
  into.insertBefore(end, before);

  return {
    kind: KIND_OPAQUE, vnode: v, key: null, start, end, id: 0, list: null,
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

function patchRNode(rn, v, kind, svg, owner) {
  switch (kind) {
    case KIND_ELEMENT:
      return patchElement(rn, v, svg, owner);
    case KIND_COMPONENT:
      return patchComponent(rn, v);
    case KIND_TEXT: {
      const text = typeof v === 'string' ? v : String(v);
      if (rn.text !== text) {
        rn.text = text;
        rn.dom.data = text;
      }
      rn.vnode = v;
      return rn;
    }
    case KIND_PORTAL:
      return patchPortal(rn, v, owner);
  }
  // A hole, or an opaque node (matched by identity): nothing to do.
  rn.vnode = v;
  return rn;
}

function patchElement(rn, v, svg, owner) {
  const el = rn.dom;
  const oldProps = (rn.vnode && rn.vnode.props) || EMPTY_OBJ;
  const newProps = v.props || EMPTY_OBJ;
  const mirror = typeof svg === 'object' && svg !== null ? svg : null;
  const ns = mirror !== null ? null : nsIn(svg, v.tag);
  const isSvgEl = ns === SVG_NS;
  const childSvg = mirror !== null ? mirror : isSvgEl ? v.tag !== 'foreignObject' : ns !== null && MATH;

  if (oldProps !== newProps) {
    // Removed props
    for (const name in oldProps) {
      if (name === 'children' || name === 'key' || name === 'ref') continue;
      if (!(name in newProps)) setProperty(el, name, null, oldProps[name], isSvgEl);
    }
    // Changed props (value/checked re-asserted after children)
    let value, checked, hasValue = false, hasChecked = false;
    for (const name in newProps) {
      const next = newProps[name];
      if (name === 'value') { value = next; hasValue = true; continue; }
      if (name === 'checked') { checked = next; hasChecked = true; continue; }
      if (oldProps[name] !== next && name !== 'children' && name !== 'key' && name !== 'ref') {
        setProperty(el, name, next, oldProps[name], isSvgEl);
      }
    }

    // An uncontrolled select that had no options yet (they load later).
    const emptySelect = v.tag === 'select' && value == null && el.options !== undefined && el.options.length === 0;

    patchElementChildren(rn, v, newProps, childSvg, owner);

    if (hasValue) setProperty(el, 'value', value, oldProps.value, isSvgEl);
    if (hasChecked) setProperty(el, 'checked', checked, oldProps.checked, isSvgEl);
    if (emptySelect && el.options.length > 0) resetSelect(el, null);

    // Refs
    const newRef = newProps.ref || null;
    if (rn.ref !== newRef) {
      // The old one now, the new one in the layout phase (React's mutation and layout phases).
      if (rn.ref) detachRef(rn, rn.ref);
      if (newRef) layoutQueue.push({ rn, ref: newRef, el, inst: owner });
      rn.ref = newRef;
    }
  } else {
    // Same props object — still recurse children (descendant components may
    // need the render cascade; bailouts happen at component level).
    patchElementChildren(rn, v, newProps, childSvg, owner);
  }

  rn.vnode = v;
  return rn;
}

function patchElementChildren(rn, v, props, childSvg, owner) {
  const el = rn.dom;
  const raw = v.children !== undefined ? v.children : props.children;
  const text = onlyText(raw);
  if (text !== null) {
    if (rn.text === null) {
      const children = rn.children;
      if (children === TEXTAREA_KIDS) { patchTextarea(el, props); return; }
      // It held rendered nodes: they leave, the text is its content.
      if (children.length > 0) {
        for (let i = 0; i < children.length; i++) unmountRNode(children[i], true);
        rn.children = NO_RNODES;
      }
      rn.text = text;
      if (text !== '' || el.firstChild !== null) setText(el, text);
    } else if (rn.text !== text) {
      rn.text = text;
      setText(el, text);
    }
    return;
  }
  if (rn.text !== null) {
    // The text leaves; HTML that took its place (setProperty) stays.
    if (rn.text !== '' && props.dangerouslySetInnerHTML == null) el.textContent = '';
    rn.text = null;
  }
  if (v.tag === 'noscript') return;
  const kids = flatten(raw);
  if (kids.length === 0 && rn.children.length === 0) {
    if (rn.children === TEXTAREA_KIDS) patchTextarea(el, props);
    return;
  }
  rn.children = reconcile(el, rn.children, kids, flatIds, flatLists, null, childSvg, owner, null, rn);
}

function patchComponent(rn, v) {
  const inst = rn.inst;
  const newProps = v.props || EMPTY_OBJ;
  const oldVnode = rn.vnode;
  rn.vnode = v;

  const selfDirty = dirtyQueue.size > 0 && dirtyQueue.has(inst);

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
  renderOutput(inst, null, null, false);
  return rn;
}

function patchPortal(rn, v, owner) {
  const target = v.props && v.props.container;
  if (target === rn.container && rn.mirror !== undefined) {
    rn.children = patchChildren(rn.mirror.shadow, rn.children, v.children, null, rn.mirror, owner, rn);
  } else if (target === rn.container) {
    if (target) {
      rn.children = patchChildren(target, rn.children, v.children, null, targetMode(target), owner, rn);
    }
  } else {
    teardown(rn); // its children leave the old container
    rn.container = target || null;
    if (target && isForeignHost(target)) {
      rn.mirror = createMirror(target);
      rn.children = patchChildren(rn.mirror.shadow, NO_RNODES, v.children, null, rn.mirror, owner, rn);
      rn.vnode = v;
      return rn;
    }
    if (target) registerPortal(rn);
    rn.children = target
      ? patchChildren(target, NO_RNODES, v.children, null, targetMode(target), owner, rn)
      : NO_RNODES;
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
      // A hole has a node only at the top of an island (mountHole).
      if (removeDom && rn.dom !== null) rn.dom.remove();
      return;
    case KIND_TEXT:
      if (removeDom) rn.dom.remove();
      return;
    case KIND_ELEMENT:
      teardown(rn);
      if (removeDom) rn.dom.remove();
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
      if (removeDom && rn.dom !== null) rn.dom.remove();
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
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        // Text and holes have nothing to clean up.
        if (child.kind >= KIND_ELEMENT) teardown(child);
      }
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
  if (dirtyQueue.size > 0) dirtyQueue.delete(inst);
  if (inst._track != null) {
    const stop = inst._track;
    inst._track = null;
    stop();
  }

  // Its own insertion and layout cleanups (useSyncExternalStore's
  // subscription is one), in hook order; the passive ones are queued.
  const hooks = inst.hooks;
  if (hooks !== null) {
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
  }

  // Then its children's.
  const rendered = inst.rendered;
  for (let i = 0; i < rendered.length; i++) teardown(rendered[i]);
  inst.rendered = NO_RNODES;

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

// React renders a component again at most 25 times for the state it sets
// while it renders, then throws this; an error boundary catches it.
const RE_RENDER_LIMIT = 25;

function tooManyReRenders() {
  return new Error('Too many re-renders. React limits the number of renders to prevent an infinite loop.');
}

/** Render a mounted component again and reconcile its output where it stands. */
export function renderInstance(inst) {
  renderOutput(inst, null, null, false);
}

// Run `inst`'s component function and commit what it returned. `mounting`:
// its first render, into `parentDom` before `before` (`parentDom` null:
// outside the document, for the list that mounts it to place).
function renderOutput(inst, parentDom, before, mounting) {
  if (inst.unmounted) return;
  if (!mounting && dirtyQueue.size > 0) dirtyQueue.delete(inst);

  let out;
  // Renders again while it sets its own state as it renders (React's render
  // phase updates), as many times as React does before it gives up.
  let reRenders = 0;
  do {
    inst._renderPhaseUpdate = false;
    inst.hookIndex = 0;
    const prev = currentInstance;
    currentInstance = inst;
    try {
      if (reRenders > RE_RENDER_LIMIT) throw tooManyReRenders();
      out = renderTracked(inst);
    } catch (err) {
      currentInstance = prev;
      dropPending(inst);
      // A component that never rendered still needs an entry to stand at.
      if (mounting && inst.end === null) inst.rendered = [mountHole(null, parentDom, before, inst)];
      handleRenderError(inst, err, false);
      return;
    }
    currentInstance = prev;
    reRenders++;
  } while (inst._renderPhaseUpdate);

  try {
    let kids = flatten(out);
    let ids = flatIds;
    let lists = flatLists;
    const end = inst.end;
    if (end !== null) {
      // An island with markers: between them.
      inst.rendered = reconcile(end.parentNode, inst.rendered, kids, ids, lists, end, inst.svg, inst, null, inst);
    } else {
      // A component that renders nothing renders a hole: it keeps an entry.
      if (kids.length === 0) { kids = HOLE_KIDS; ids = null; lists = null; }
      inst.rendered = mounting
        ? mountChildren(parentDom, kids, ids, lists, 0, kids.length, new Array(kids.length), before, inst.svg, inst, inst)
        : reconcile(null, inst.rendered, kids, ids, lists, null, inst.svg, inst, inst, inst);
    }
  } catch (err) {
    // Subtree commit failed (a descendant threw). Reset this instance's output
    // and route the error/suspension. Cleanups of partially-mounted children
    // may not run — documented limitation.
    resetOutput(inst, parentDom, before, mounting);
    dropPending(inst);
    handleRenderError(inst, err, true);
    return;
  }

  // Queue own effects after the subtree's (children queued theirs during patch).
  let pending = inst._pendingInsertion;
  if (pending !== null && pending.length > 0) {
    for (let i = 0; i < pending.length; i++) insertionQueue.push(pending[i]);
    pending.length = 0;
  }
  pending = inst._pendingLayout;
  if (pending !== null && pending.length > 0) {
    for (let i = 0; i < pending.length; i++) layoutQueue.push(pending[i]);
    pending.length = 0;
  }
  pending = inst._pendingPassive;
  if (pending !== null && pending.length > 0) {
    for (let i = 0; i < pending.length; i++) passiveQueue.push(pending[i]);
    pending.length = 0;
  }
}

// What `inst` rendered goes, and a hole stands where it stood, so the
// component keeps its entry for the render that follows (a boundary's
// fallback, the content once it has loaded).
function resetOutput(inst, parentDom, before, mounting) {
  if (inst.end !== null) {
    removeRangeContents(inst.start, inst.end);
    inst.rendered = NO_RNODES;
    return;
  }
  if (mounting) {
    // What the failed mount had placed went with it (mountChildren).
    inst.rendered = [mountHole(null, parentDom, before, inst)];
    return;
  }
  const nodes = _domNodes(inst);
  const hole = mountHole(null, null, null, inst);
  if (hole.dom !== null) {
    for (let i = 0; i < nodes.length; i++) {
      const parent = nodes[i].parentNode;
      if (parent !== null) { parent.insertBefore(hole.dom, nodes[i]); break; }
    }
  }
  removeNodes(nodes);
  inst.rendered = [hole];
}

// A render reads What signals under a tracker of its own, never an enclosing
// what-core effect: a signal a component reads while it renders (a native
// value in an island's props, a render prop written in a native file, a
// signal read in a React file) schedules a re-render of that instance, the
// way a state change does. The tracker belongs to no owner, so nothing but
// the next render or the unmount disposes it. One that read nothing keeps
// nothing (what-core releases an effect with no dependencies).
const NOT_THROWN = {};
// The render in progress, for the tracker's first run (no closure per render).
let trackFirst = false;
let trackOut;
let trackThrown = NOT_THROWN;
/** @type {any} */
let trackInst = null;

function startTracker() {
  return effect(trackInst._tracker);
}

function makeTracker(inst) {
  return () => {
    if (trackFirst) {
      trackFirst = false;
      // Caught here, not by the effect: the render's error (a thrown thenable
      // included) goes to the compat boundaries, never to what-core's.
      try { trackOut = inst.type(inst.props); } catch (err) { trackThrown = err; }
    } else if (!inst.unmounted) {
      scheduleUpdate(inst);
    }
  };
}

function renderTracked(inst) {
  const prev = inst._track;
  if (prev != null) {
    inst._track = null;
    prev();
  }
  if (inst._tracker === null) inst._tracker = makeTracker(inst);
  trackFirst = true;
  trackInst = inst;
  const stop = runWithOwner(null, startTracker);
  trackInst = null;
  const out = trackOut;
  trackOut = undefined;
  if (trackThrown !== NOT_THROWN) {
    const thrown = trackThrown;
    trackThrown = NOT_THROWN;
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
      // A boundary an island is hydrating keeps the server's HTML while it
      // waits, as React's does (hydrate.js).
      if (claim !== null && claim(err, -1, boundary) !== null) return;
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
  const nodes = _domNodes(inst);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
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
  // The root holds its list: a component at its top finds its place in it.
  const root = { container, rns: NO_RNODES };
  root.rns = runInCommit(() => patchChildren(container, NO_RNODES, element, null, isSvg, null, root));
  return root;
}

export function patchRoot(root, element) {
  _flushPendingPassive();
  const isSvg = typeof SVGElement !== 'undefined' && root.container instanceof SVGElement;
  root.rns = runInCommit(() => patchChildren(root.container, root.rns, element, null, isSvg, null, root));
  return root;
}

export function unmountRoot(root) {
  runInCommit(() => {
    for (const rn of root.rns) unmountRNode(rn, true);
    root.rns = NO_RNODES;
  });
  _flushUnmounted();
}

// =====================================================================
// Islands — a React tree that native What code places
// =====================================================================

/**
 * Mount `view` (a function returning what-react elements) as a compat root
 * instance in `container`. The instance renders `view` like a component
 * body: every signal `view` reads while it builds the elements (a native
 * value in a prop) schedules a re-render, which reconciles against the last
 * one, so React state below survives. `parent` is the compat instance the
 * island stands inside (React context, Suspense and error boundaries reach
 * through it), `nativeOwner` the What owner where it stands (native
 * components below it are created under that owner).
 *
 * Like a component, the island has no markers: its place is where its nodes
 * are, and it always has one (at its top a hole or a portal is a comment,
 * mountHole). A deferred island has none yet, so it holds its place with two
 * markers of its own.
 */
export function mountIsland(view, container, parent, nativeOwner, svg, deferred) {
  if (!deferred) {
    const inst = newInstance(view, EMPTY_OBJ, null, parent, null, null, !!svg);
    inst._nativeOwner = nativeOwner;
    inst._top = true;
    runInCommit(() => renderOutput(inst, container, null, true));
    return inst;
  }
  const start = document.createComment('w$');
  const end = document.createComment('/w$');
  container.appendChild(start);
  container.appendChild(end);
  const inst = newInstance(view, EMPTY_OBJ, null, parent, start, end, !!svg);
  inst._nativeOwner = nativeOwner;
  // While a server page hydrates, the island is two markers until the walk
  // is over: the server wrote nothing for it, so there is nothing to claim.
  queueMicrotask(() => { if (!inst.unmounted) runInCommit(() => renderInstance(inst)); });
  return inst;
}

/**
 * How an island takes the server's HTML for its own, once a hydrating entry
 * installed it (hydrate.js, `_hydrateIslands()` in mixed.js): called during
 * the walk, it returns what renders the island over that HTML once the walk
 * is done. Null in a page that does not hydrate islands.
 * @type {((inst: any, start: Comment, end: Comment) => () => void) | null}
 */
let adopter = null;

/** @internal hydrate.js */
export function _setAdopter(fn) {
  adopter = fn;
}

/**
 * How a native component a React tree renders is built (mixed.js
 * createLeaf), once hydrate.js installed it: in a hydration walk of the
 * server's nodes for it, while an island adopts them. Null: what-core builds it.
 * @type {((Comp: any, props: any) => any) | null}
 */
export let _nativeBuilder = null;

/** @internal hydrate.js */
export function _setNativeBuilder(fn) {
  _nativeBuilder = fn;
}

/**
 * Hydrating a page whose server rendered the island (server.js): the
 * server's region markers become the island's own. Once the walk is done the
 * island renders over the server's HTML between them, taking its nodes
 * (hydrate.js); without that installed, the client's render replaces the
 * server's HTML, in one step, before the page paints again.
 */
export function adoptIsland(view, start, end, parent, nativeOwner, svg) {
  const inst = newInstance(view, EMPTY_OBJ, null, parent, start, end, !!svg);
  inst._nativeOwner = nativeOwner;
  const mount = adopter !== null ? adopter(inst, start, end) : () => {
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
 * How an island is placed while a page hydrates (_claimIsland below), once the
 * hydrating entry installed it (mixed.js _claimIslands, which
 * _hydrateIslands calls): what-react's Vite plugin adds the call to every
 * module what-compiler compiles for hydration, so a client build that only
 * mounts does not carry it.
 * @type {((view: any, svg: boolean, parent: any, owner: any) => any) | null}
 */
let islandClaim = null;

/** @internal mixed.js */
export function _setIslandClaim(fn) {
  islandClaim = fn;
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
  if (islandClaim !== null) {
    const claimed = islandClaim(view, svg, parent, owner);
    if (claimed !== undefined) return claimed;
  } else if (__DEV__ && isHydrating()) {
    console.warn('[what-react] A React island is hydrating without its hydration installed, so it is built again instead of claiming the server\'s HTML. what-react\'s Vite plugin installs it; a build without the plugin imports what-react/hydrate-islands (or what-react/claim-islands, to hydrate without adopting the server\'s HTML) before hydrate().');
  }
  const frag = document.createDocumentFragment();
  const inst = untrack(() => mountIsland(view, frag, parent, owner, svg, false));
  whatOnCleanup(() => unmountIsland(inst));
  return frag;
}

/**
 * An island while a page hydrates, or undefined when none does. The server
 * rendered it (server.js) between brackets: they are the island's, whole,
 * and the walk goes on after them. Where the server rendered nothing, the
 * island is built on the client and placed, not claimed.
 * @internal mixed.js _claimIslands
 */
export function _claimIsland(view, svg, parent, owner) {
  if (!isHydrating()) return undefined;
  const region = _claimRegion();
  if (region !== null) {
    const adopted = adoptIsland(view, region[0], region[1], parent, owner, svg);
    whatOnCleanup(() => {
      unmountIsland(adopted);
      // What the native code around the island knows of it is the nodes
      // the server wrote, recorded during the walk; the island's client
      // render took their place after it. So the island takes its own
      // nodes out, while its brackets are still in the page (the native
      // code removes those).
      if (region[1].parentNode !== null && region[1].parentNode === region[0].parentNode) removeRangeContents(region[0], region[1]);
    });
    return null;
  }
  const frag = document.createDocumentFragment();
  const inst = untrack(() => mountIsland(view, frag, parent, owner, svg, true));
  whatOnCleanup(() => unmountIsland(inst));
  return _$outside(() => frag);
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

/** Render `inst` once on the server (a setState during render renders again, as React does, and too many times throws). */
export function _renderOnServer(inst) {
  let out;
  let reRenders = 0;
  do {
    if (reRenders++ > RE_RENDER_LIMIT) throw tooManyReRenders();
    inst._renderPhaseUpdate = false;
    inst.hookIndex = 0;
    const prev = currentInstance;
    currentInstance = inst;
    try {
      out = untrack(() => inst.type(inst.props));
    } finally {
      currentInstance = prev;
    }
  } while (inst._renderPhaseUpdate);
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
      return Object.assign(_vnodeOf(bridge, props), { type: renderFn, _compat: true });
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
export function trackField(el) {
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
//
// The fields are copied when the event is made, except the four the browser
// can only answer by laying the page out (`offsetX`, `offsetY`, `layerX`,
// `layerY`): those are read from the native event when a handler asks, so an
// event whose handlers never ask forces no layout. React's synthetic event
// has no such fields at all (`e.nativeEvent.offsetX` is the React idiom), so
// they are getters on the prototype and a copy leaves them out, as it leaves
// out React's methods.
/** @this {any} */
function SyntheticEvent(native, type) {
  this.nativeEvent = native;
  this.type = type;
  this.currentTarget = null;
  this.defaultPrevented = native.defaultPrevented;
}

SyntheticEvent.prototype = {
  constructor: SyntheticEvent,
  preventDefault() { this.defaultPrevented = true; this.nativeEvent.preventDefault(); },
  stopPropagation() { this.nativeEvent.stopPropagation(); },
  isDefaultPrevented() { return this.nativeEvent.defaultPrevented; },
  // The browser sets cancelBubble when stopPropagation() is called.
  isPropagationStopped() { return this.nativeEvent.cancelBubble === true; },
  persist() {},
  isPersistent() { return true; },
  getModifierState(key) {
    const native = this.nativeEvent;
    return typeof native.getModifierState === 'function' ? native.getModifierState(key) : false;
  },
};

for (const field of ['offsetX', 'offsetY', 'layerX', 'layerY']) {
  Object.defineProperty(SyntheticEvent.prototype, field, {
    configurable: true,
    /** @this {any} */
    get() { return this.nativeEvent[field]; },
    /** @this {any} */
    set(value) { Object.defineProperty(this, field, { value, writable: true, enumerable: true, configurable: true }); },
  });
}

// What a synthetic event sets itself, or reads late (above).
const NOT_COPIED = new Set(['type', 'currentTarget', 'defaultPrevented', 'nativeEvent', 'offsetX', 'offsetY', 'layerX', 'layerY']);

/**
 * The fields a native event's prototypes declare (enumerable accessors and
 * constants: for-in sees them), once per prototype.
 * @type {WeakMap<object, string[]>}
 */
const eventFields = new WeakMap();

function fieldsOf(native) {
  const proto = Object.getPrototypeOf(native);
  let fields = eventFields.get(proto);
  if (fields === undefined) {
    fields = [];
    for (const key in native) {
      if (NOT_COPIED.has(key) || Object.prototype.hasOwnProperty.call(native, key)) continue;
      if (typeof native[key] !== 'function') fields.push(key);
    }
    eventFields.set(proto, fields);
  }
  return fields;
}

function syntheticEvent(native, type) {
  let byType = native._compatSynthetic;
  if (byType !== undefined) {
    const made = byType[type];
    if (made !== undefined) return made;
  }
  const event = new SyntheticEvent(native, type);
  const fields = fieldsOf(native);
  for (let i = 0; i < fields.length; i++) event[fields[i]] = native[fields[i]];
  // The event's own properties: `isTrusted`, and what a script put on it (a
  // test's `dataTransfer` on an event jsdom has no class for).
  const own = Object.keys(native);
  for (let i = 0; i < own.length; i++) {
    const key = own[i];
    // What this runtime keeps on the native event is not the event's.
    if (NOT_COPIED.has(key) || key.startsWith('_compat') || key === '_reactPath') continue;
    const value = native[key];
    if (typeof value !== 'function') event[key] = value;
  }
  if (byType === undefined) {
    byType = {};
    try { native._compatSynthetic = byType; } catch { /* a frozen event: one object per call */ }
  }
  byType[type] = event;
  return event;
}

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
export let formActionRunner = null;

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
      // On from where the portal stands in its React parent.
      if (portal.dom !== null) node = portal.dom;
      else {
        hostOf(portal, true);
        node = placeParent;
        if (node != null && node.nodeType === 1 && !node.contains(target)) path.push(node);
      }
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

export function controlField(el) {
  if (el._compatControlled === true || typeof el.addEventListener !== 'function') return;
  el._compatControlled = true;
  // The events React's onChange listens to for this field. A checkbox fires
  // `input` first: putting `checked` back then would hide the user's click
  // from the handler on `change`.
  if (changeEventFor(el) === 'input') watchField(el, 'input');
  watchField(el, 'change');
}

/**
 * @internal hydrate.js: what a claim gave a server element that stays in the
 * page without being committed (a <Suspense> whose content suspended while it
 * hydrated keeps the server's nodes as they are until it hydrates, as React's
 * does): its React handlers, the putting back of a controlled field, the
 * tracking of a field's value and a form's action. Until the boundary
 * hydrates, the element does what the server's HTML does.
 */
export function _inert(el) {
  const own = el._compatListeners;
  if (own !== undefined) {
    for (const event in own) el.removeEventListener(event, eventProxy, false);
    el._compatListeners = undefined;
  }
  const capture = el._compatListenersCapture;
  if (capture !== undefined) {
    for (const event in capture) el.removeEventListener(event, eventProxyCapture, true);
    el._compatListenersCapture = undefined;
  }
  if (el._compatControlled === true) {
    el.removeEventListener('input', fieldEvent, true);
    el.removeEventListener('change', fieldEvent, true);
    el._compatControlled = false;
  }
  const track = el._compatTrack;
  if (track !== undefined) {
    delete el[track.field];
    el._compatTrack = undefined;
  }
  if (typeof el._compatAction === 'function') el._compatAction = null;
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
    // Written when its string changed: React compares them.
    const html = (value && value.__html) || '';
    if (oldValue == null || html !== (oldValue.__html || '')) el.innerHTML = html;
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
