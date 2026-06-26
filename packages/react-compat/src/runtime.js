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

import { untrack, mount as whatMount, onCleanup as whatOnCleanup } from 'what-core';

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

let currentInstance = null;

export function _getCurrentInstance() {
  return currentInstance;
}

export function _requireInstance(hookName) {
  if (!currentInstance) {
    throw new Error(
      `[what-react] ${hookName}() called outside of a component render. ` +
      `Hooks can only be called while a what-react component is rendering. ` +
      `If this happens inside a React library, make sure ALL react imports are ` +
      `aliased to what-react (one module instance) — see the reactCompat() vite plugin.`
    );
  }
  return currentInstance;
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
  dirtyQueue.add(inst);
  if (!flushScheduled) {
    flushScheduled = true;
    queueMicrotask(flushUpdates);
  }
}

export function flushUpdates() {
  flushScheduled = false;
  let cycles = 0;
  while (dirtyQueue.size > 0) {
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
          renderInstance(inst);
        }
      }
    });
    // Layout effects ran on commit exit — they may have queued more updates.
  }
}

// =====================================================================
// Commit phase — effect queues (child-first order, layout sync / passive async)
// =====================================================================

let commitDepth = 0;
const refQueue = [];
const layoutQueue = [];
const passiveQueue = [];
let passiveScheduled = false;

export function runInCommit(fn) {
  commitDepth++;
  try {
    return fn();
  } finally {
    commitDepth--;
    if (commitDepth === 0) {
      // React commit order: attach refs (after DOM insertion), then layout
      // effects synchronously, then passive effects asynchronously.
      flushRefQueue();
      flushEffectQueue(layoutQueue);
      if (passiveQueue.length > 0 && !passiveScheduled) {
        passiveScheduled = true;
        queueMicrotask(_flushPassive);
      }
    }
  }
}

function flushRefQueue() {
  while (refQueue.length > 0) {
    const entry = refQueue.shift();
    // Skip if the element was already unmounted (ref nulled) or ref swapped.
    if (entry.rn.ref !== entry.ref) continue;
    try {
      applyRef(entry.ref, entry.el);
    } catch (e) {
      console.error('[what-react] ref error:', e);
    }
  }
}

export function _flushPassive() {
  passiveScheduled = false;
  flushEffectQueue(passiveQueue);
}

function flushEffectQueue(queue) {
  while (queue.length > 0) {
    const entry = queue.shift();
    const slot = entry.slot;
    slot._pending = null;
    if (entry.inst.unmounted) continue;
    if (slot.cleanup) {
      try { slot.cleanup(); } catch (e) { console.error('[what-react] effect cleanup error:', e); }
      slot.cleanup = null;
    }
    try {
      const result = entry.fn();
      if (typeof result === 'function') slot.cleanup = result;
    } catch (e) {
      console.error('[what-react] effect error:', e);
    }
  }
}

// Hooks push pending effects here; renderInstance moves them to the global
// queues AFTER the subtree commit so children's effects run before the parent's
// (React ordering).
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

// Drain everything synchronously — used by act() and flushSync().
export function _drainAll() {
  let guard = 0;
  while ((dirtyQueue.size > 0 || layoutQueue.length > 0 || passiveQueue.length > 0) && ++guard < 100) {
    flushUpdates();
    flushEffectQueue(layoutQueue);
    _flushPassive();
  }
}

// =====================================================================
// VNode classification & normalization
// =====================================================================

function isVNodeLike(v) {
  return v !== null && typeof v === 'object' && (v._vnode === true || 'tag' in v);
}

function kindOf(v) {
  if (v == null || typeof v === 'boolean') return KIND_HOLE;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'bigint') return KIND_TEXT;
  if (t === 'function') return KIND_OPAQUE; // reactive accessor (What interop)
  if (t === 'object') {
    if (isVNodeLike(v)) {
      const tag = v.tag;
      if (typeof tag === 'string') {
        if (tag === '__portal') return KIND_PORTAL;
        // What-internal boundary tags — let core handle them
        if (tag === '__suspense' || tag === '__errorBoundary') return KIND_OPAQUE;
        return KIND_ELEMENT;
      }
      if (typeof tag === 'function') {
        return (tag._compatType || v._compat) ? KIND_COMPONENT : KIND_OPAQUE;
      }
      return KIND_OPAQUE;
    }
    if (typeof v.nodeType === 'number') return KIND_OPAQUE; // raw DOM node
  }
  return KIND_TEXT; // last resort: stringify
}

// Flatten arrays, keep holes (null/false/true → null) so child slot positions
// stay stable across conditional renders — React semantics.
export function normalizeChildren(value, out) {
  if (out === undefined) out = [];
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) normalizeChildren(value[i], out);
    return out;
  }
  if (value == null || typeof value === 'boolean') {
    out.push(null);
    return out;
  }
  out.push(value);
  return out;
}

function keyOf(v, kind) {
  if ((kind === KIND_ELEMENT || kind === KIND_COMPONENT || kind === KIND_PORTAL) && v.key != null) return v.key;
  return null;
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
        isVNodeLike(v) && isVNodeLike(rn.vnode) &&
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
 * - Keyed children match by (key, type).
 * - Unkeyed children match positionally among unkeyed siblings; a type
 *   mismatch consumes the slot (unmount + mount), like React's replace.
 * - Pass 1 runs left-to-right (render/effect order matches React),
 *   mounting fresh nodes into detached fragments.
 * - Pass 3 walks right-to-left fixing DOM positions with a moving anchor.
 */
export function patchChildren(parentDom, old, newValues, anchor, svg, owner) {
  let keyed = null;
  const unkeyed = [];
  for (let i = 0; i < old.length; i++) {
    const rn = old[i];
    if (rn.key != null) {
      if (keyed === null) keyed = new Map();
      if (!keyed.has(rn.key)) keyed.set(rn.key, rn);
      else unkeyed.push(rn); // duplicate key — fall back to positional
    } else {
      unkeyed.push(rn);
    }
  }

  const kept = new Set();     // matched old rnodes (stay mounted)
  const consumed = new Set(); // old rnodes whose slot was taken (unmount)
  let ui = 0;
  const result = new Array(newValues.length);

  // --- Pass 1: match + patch, or mount into detached fragment ---
  for (let i = 0; i < newValues.length; i++) {
    const v = newValues[i];
    const kind = kindOf(v);
    const key = keyOf(v, kind);
    let match = null;

    if (key != null) {
      const cand = keyed !== null ? keyed.get(key) : undefined;
      if (cand && !kept.has(cand) && !consumed.has(cand) && canPatch(cand, v, kind)) {
        match = cand;
      }
    } else {
      while (ui < unkeyed.length && (kept.has(unkeyed[ui]) || consumed.has(unkeyed[ui]))) ui++;
      const cand = unkeyed[ui];
      if (cand !== undefined) {
        if (canPatch(cand, v, kind)) {
          match = cand;
        } else {
          consumed.add(cand); // replace-in-slot
        }
        ui++;
      }
    }

    if (match) {
      kept.add(match);
      result[i] = patchRNode(match, v, kind, parentDom, svg, owner);
    } else {
      const frag = document.createDocumentFragment();
      const rn = mountRNode(v, kind, frag, svg, owner);
      rn._pendingFrag = frag;
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
        const last = nodes[nodes.length - 1];
        if (last.nextSibling !== ref || nodes[0].parentNode !== parentDom) {
          for (let n = 0; n < nodes.length; n++) parentDom.insertBefore(nodes[n], ref);
        }
        ref = nodes[0];
      }
    }
  }

  return result;
}

function domNodesOf(rn) {
  switch (rn.kind) {
    case KIND_HOLE:
    case KIND_TEXT:
    case KIND_ELEMENT:
    case KIND_PORTAL:
      return rn.dom ? [rn.dom] : [];
    case KIND_COMPONENT:
    case KIND_OPAQUE: {
      const nodes = [];
      let n = rn.start;
      const end = rn.end;
      while (n) {
        nodes.push(n);
        if (n === end) break;
        n = n.nextSibling;
      }
      return nodes;
    }
  }
  return [];
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
const SVG_ATTR_MAP = {
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
};

function mountElement(v, container, svg, owner) {
  const tag = v.tag;
  const childSvg = (svg || tag === 'svg') && tag !== 'foreignObject';
  const isSvgEl = svg || tag === 'svg';
  const el = isSvgEl ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
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
    children: [], ref: props.ref || null,
  };

  // Children
  const kids = normalizeChildren(v.children !== undefined ? v.children : props.children);
  rn.children = patchChildren(el, [], kids, null, childSvg, owner);

  // Controlled props after children (e.g. <select> options must exist)
  if (hasValue) setProperty(el, 'value', value, undefined, isSvgEl);
  if (hasChecked) setProperty(el, 'checked', checked, undefined, isSvgEl);

  // Refs attach at commit exit — AFTER the element is inserted into the live
  // DOM — so ref callbacks that measure layout (getBoundingClientRect etc.)
  // see real geometry, like React.
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

  const inst = {
    type: renderFn,
    props: v.props || EMPTY_OBJ,
    key: v.key ?? null,
    hooks: [],
    hookIndex: 0,
    parent: owner,
    depth: owner ? owner.depth + 1 : 0,
    start, end, svg,
    rendered: [],
    unmounted: false,
    _renderPhaseUpdate: false,
    _pendingLayout: [],
    _pendingPassive: [],
    _guardStart: 0,
    _guardCount: 0,
  };

  const rn = {
    kind: KIND_COMPONENT, vnode: v, key: inst.key,
    bridge: tag, inst, start, end,
  };

  renderInstance(inst);
  return rn;
}

function mountPortal(v, container, owner) {
  const dom = document.createComment('w:portal');
  container.appendChild(dom);
  const target = v.props && v.props.container;
  const rn = { kind: KIND_PORTAL, vnode: v, key: v.key ?? null, dom, container: target || null, children: [] };
  if (!target) {
    console.warn('[what-react] createPortal: target container not found');
    return rn;
  }
  rn.children = patchChildren(target, [], normalizeChildren(v.children), null, targetSvg(target), owner);
  return rn;
}

// Opaque subtree: delegate to what-core's renderer. We mount into a detached
// fragment via core's public mount() (which returns a disposer), move the
// nodes inline between our own markers, and on unmount move them BACK into the
// holder fragment so core's disposer can run full disposeTree cleanup.
function mountOpaque(v, container) {
  const start = document.createComment('w:o');
  const end = document.createComment('/w:o');
  container.appendChild(start);

  let dispose = null;
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
      // Move everything between the markers back into the holder so core's
      // disposer (disposeTree + clear) tears down effects/components fully.
      let n = start.nextSibling;
      while (n && n !== end) {
        const next = n.nextSibling;
        holder.appendChild(n);
        n = next;
      }
      try { dispose(); } catch (e) { /* already disposed */ }
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
  const isSvgEl = svg || v.tag === 'svg';
  const childSvg = (svg || v.tag === 'svg') && v.tag !== 'foreignObject';

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

    // Children
    const kids = normalizeChildren(v.children !== undefined ? v.children : newProps.children);
    rn.children = patchChildren(el, rn.children, kids, null, childSvg, owner);

    if (hasValue) setProperty(el, 'value', value, oldProps.value, isSvgEl);
    if (hasChecked) setProperty(el, 'checked', checked, oldProps.checked, isSvgEl);

    // Refs
    const newRef = newProps.ref || null;
    if (rn.ref !== newRef) {
      if (rn.ref) applyRef(rn.ref, null);
      if (newRef) applyRef(newRef, el);
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
  if (target === rn.container) {
    if (target) {
      rn.children = patchChildren(target, rn.children, normalizeChildren(v.children), null, targetSvg(target), owner);
    }
  } else {
    for (const child of rn.children) unmountRNode(child, true);
    rn.container = target || null;
    rn.children = target
      ? patchChildren(target, [], normalizeChildren(v.children), null, targetSvg(target), owner)
      : [];
  }
  rn.vnode = v;
  return rn;
}

// ---- Unmount ----

export function unmountRNode(rn, removeDom) {
  switch (rn.kind) {
    case KIND_HOLE:
    case KIND_TEXT:
      if (removeDom && rn.dom.parentNode) rn.dom.parentNode.removeChild(rn.dom);
      return;
    case KIND_ELEMENT: {
      for (const child of rn.children) unmountRNode(child, false);
      if (rn.ref) {
        try { applyRef(rn.ref, null); } catch (e) { console.error('[what-react] ref cleanup error:', e); }
        rn.ref = null; // invalidates any queued mount-time ref entry
      }
      if (removeDom && rn.dom.parentNode) rn.dom.parentNode.removeChild(rn.dom);
      return;
    }
    case KIND_COMPONENT: {
      unmountInstance(rn.inst);
      if (removeDom) removeRange(rn.start, rn.end);
      return;
    }
    case KIND_PORTAL: {
      for (const child of rn.children) unmountRNode(child, true); // other container
      if (removeDom && rn.dom.parentNode) rn.dom.parentNode.removeChild(rn.dom);
      return;
    }
    case KIND_OPAQUE: {
      if (rn.dispose) rn.dispose();
      if (removeDom) removeRange(rn.start, rn.end);
      return;
    }
  }
}

function unmountInstance(inst) {
  if (inst.unmounted) return;
  inst.unmounted = true;
  dirtyQueue.delete(inst);

  // Children first (React effect-cleanup order is bottom-up).
  for (const child of inst.rendered) unmountRNode(child, false);
  inst.rendered = [];

  // Hook cleanups (useEffect / useLayoutEffect / useSyncExternalStore subs).
  for (const slot of inst.hooks) {
    if (slot && slot._isEffect && slot.cleanup) {
      try { slot.cleanup(); } catch (e) { console.error('[what-react] effect cleanup error:', e); }
      slot.cleanup = null;
    }
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
      // untrack(): signal reads inside React components must not subscribe
      // to any enclosing what-core effect.
      out = untrack(() => inst.type(inst.props));
    } catch (err) {
      currentInstance = prev;
      inst._pendingLayout.length = 0;
      inst._pendingPassive.length = 0;
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
    inst._pendingLayout.length = 0;
    inst._pendingPassive.length = 0;
    handleRenderError(inst, err, true);
    return;
  }

  // Queue own effects after the subtree's (children queued theirs during patch).
  for (const e of inst._pendingLayout) layoutQueue.push(e);
  inst._pendingLayout.length = 0;
  for (const e of inst._pendingPassive) passiveQueue.push(e);
  inst._pendingPassive.length = 0;
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
      boundary._suspendCount = (boundary._suspendCount || 0) + 1;
      scheduleUpdate(boundary);
      const wake = () => {
        boundary._suspendCount--;
        if (!boundary.unmounted) scheduleUpdate(boundary);
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
    handler._errorHandler(err);
    return;
  }
  throw err;
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
  const isSvg = typeof SVGElement !== 'undefined' && root.container instanceof SVGElement;
  root.rns = runInCommit(() => patchChildren(root.container, root.rns, normalizeChildren(element), null, isSvg, null));
  return root;
}

export function unmountRoot(root) {
  runInCommit(() => {
    for (const rn of root.rns) unmountRNode(rn, true);
    root.rns = [];
  });
}

// =====================================================================
// Bridge — render a compat component from inside a native What tree
// =====================================================================

const bridgeCache = new WeakMap();

/**
 * Returns a What-native component wrapper for a React component function.
 * what-react's createElement uses this as the vnode tag so that:
 * - core's renderer (whatMount / native What trees) can render compat
 *   components by calling the bridge as a regular run-once component,
 * - THIS runtime recognizes compat vnodes via tag._compatType and renders
 *   them natively (the bridge is never called inside compat trees).
 */
export function getBridge(renderFn) {
  let bridge = bridgeCache.get(renderFn);
  if (bridge) return bridge;

  bridge = function CompatBridge(coreProps) {
    // Snapshot core's reactive props proxy into a plain object.
    const props = Object.assign({}, coreProps);
    const vnode = {
      tag: bridge, type: renderFn, props,
      children: [], key: null, _vnode: true, _compat: true,
    };
    const frag = document.createDocumentFragment();
    const rn = runInCommit(() => mountRNode(vnode, KIND_COMPONENT, frag, false, null));
    try {
      whatOnCleanup(() => unmountRNode(rn, false));
    } catch (e) {
      // Not inside a core component (unusual) — leak-free unmount unavailable.
    }
    return frag;
  };
  bridge._compatType = renderFn;
  bridge.displayName = renderFn.displayName || renderFn.name || 'CompatBridge';

  bridgeCache.set(renderFn, bridge);
  return bridge;
}

// =====================================================================
// DOM props — React prop semantics (className, style px, onChange→input, ...)
// =====================================================================

function applyRef(ref, value) {
  if (typeof ref === 'function') ref(value);
  else if (ref && typeof ref === 'object') ref.current = value;
}

// preact's unitless-CSS-property test
const IS_NON_DIMENSIONAL = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;

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

function eventProxy(e) {
  if (!e.nativeEvent) e.nativeEvent = e;
  if (!e.persist) e.persist = noop;
  const handler = this._compatListeners && this._compatListeners[e.type];
  if (handler) return handler(e);
}

function eventProxyCapture(e) {
  if (!e.nativeEvent) e.nativeEvent = e;
  if (!e.persist) e.persist = noop;
  const handler = this._compatListenersCapture && this._compatListenersCapture[e.type];
  if (handler) return handler(e);
}

function noop() {}

function setEvent(el, name, value) {
  let base = name.slice(2);
  let useCapture = false;
  if (base.endsWith('Capture')) {
    useCapture = true;
    base = base.slice(0, -7);
  }
  let event = base.toLowerCase();
  if (event === 'doubleclick') event = 'dblclick';
  else if (event === 'change') event = changeEventFor(el);
  else if (event === 'focus') event = 'focusin';   // React synthetic focus bubbles
  else if (event === 'blur') event = 'focusout';

  const store = useCapture
    ? (el._compatListenersCapture || (el._compatListenersCapture = {}))
    : (el._compatListeners || (el._compatListeners = {}));
  const proxy = useCapture ? eventProxyCapture : eventProxy;
  const had = store[event];
  if (value) {
    store[event] = value;
    if (!had) el.addEventListener(event, proxy, useCapture);
  } else if (had) {
    delete store[event];
    el.removeEventListener(event, proxy, useCapture);
  }
}

function setValueProp(el, value) {
  if (el.tagName === 'SELECT') {
    const str = value == null ? '' : String(value);
    el.value = str;
    if (el.value !== str) {
      queueMicrotask(() => { el.value = str; });
    }
    return;
  }
  const str = value == null ? '' : String(value);
  if (el.value !== str) el.value = str; // guard preserves caret position
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
  if (name === 'dangerouslySetInnerHTML') {
    el.innerHTML = (value && value.__html) || '';
    return;
  }
  if (name === 'value') {
    setValueProp(el, value);
    return;
  }
  if (name === 'checked') {
    el.checked = !!value;
    return;
  }
  if (name === 'defaultValue') {
    if ('defaultValue' in el) el.defaultValue = value == null ? '' : value;
    return;
  }
  if (name === 'defaultChecked') {
    el.defaultChecked = !!value;
    return;
  }
  if (name.startsWith('data-') || name.startsWith('aria-')) {
    if (value == null || value === false) el.removeAttribute(name);
    else el.setAttribute(name, value === true ? 'true' : value);
    return;
  }

  if (svg) {
    if (name === 'xlinkHref') {
      el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', value);
      return;
    }
    // React accepts camelCase SVG presentation props (strokeWidth, fillOpacity,
    // clipPath, …) and emits the correct kebab-case SVG attribute. The DOM
    // lowercases unknown attribute names (strokeWidth → "strokewidth"), which
    // is an INVALID attribute the SVG renderer ignores. Map the common ones.
    const mapped = SVG_ATTR_MAP[name];
    const attr = mapped || name;
    if (value == null || value === false) el.removeAttribute(attr);
    else el.setAttribute(attr, value === true ? '' : value);
    return;
  }

  // Property when available, attribute otherwise.
  if (name !== 'list' && name !== 'form' && name !== 'tagName' && name !== 'download' && name in el) {
    try {
      el[name] = value == null ? '' : value;
      return;
    } catch (e) { /* read-only property — fall through to attribute */ }
  }
  if (value == null || value === false) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? '' : value);
}
