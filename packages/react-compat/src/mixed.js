/**
 * what-react/mixed — native What components and React components in one tree.
 *
 * What the what-react Vite plugin compiles plain JSX to when an app mixes the
 * two (see MIXED.md):
 *
 * - In a native file, a JSX element whose tag comes from React (an npm
 *   package that depends on react, or a file of the app that imports react)
 *   becomes an island: `<ReactIsland view={() => createElement(...)} />`.
 *   Everything inside that element follows React's rules: props are values,
 *   built again whenever a signal they read changes, and the React tree is
 *   reconciled, so its state survives.
 * - A native component rendered inside a React tree (in an island, or in a
 *   file that imports react) becomes `createElement(native(Comp), props)`.
 *   It runs once, as native components do, and keeps its state; each React
 *   render hands it the new prop values, which it reads as live props.
 *
 * Context crosses both ways: a React tree inside a native component inside a
 * React tree finds the providers above it, and a native component inside a
 * React tree finds the What context of the native code around the island.
 */

import { h, signal, batch, untrack, getOwner, runWithOwner, createRoot, onCleanup } from 'what-core';
import { isVNode, _provide, __DEV__ } from 'what-core/internal';
import { _$createComponent, _installVNodeRuntime, _valuesToNodes, _$childrenChanged } from 'what-core/render';
import { createElement as element, Fragment } from './index.js';
import {
  HOST, _island, _claimIsland, _setIslandClaim, _getCurrentInstance, _outsideRender, runInCommit, patchChildren, normalizeChildren, unmountRNode, _flushUnmounted, _nativeBuilder,
  _vnodeIsland, renderInstance, _domNodes, _flushPendingPassive, _flushQueued,
} from './runtime.js';
import { serverIsland } from './server.js';
import { installIslandHydration } from './hydrate.js';

// A binding of this module's own, not a re-export: a React file imports it
// (what-react's plugin lowers its JSX to it), and with it keeps this module's
// install of the hole rows below, also where no native file renders a React
// tag.
export const createElement = element;
export { Fragment };

/**
 * Hydrating islands by adopting the server's HTML: an island takes the
 * elements and text the server rendered for it instead of building them
 * again (hydrate.js), so focus, typed text and whatever else hangs on those
 * nodes survive. The entry that hydrates a server-rendered page calls it
 * once, before hydrate(); what-react's Vite plugin adds the call to the
 * modules what-compiler compiles for hydration. A page that never hydrates
 * does not carry the code. Without it, an island renders in the browser and
 * replaces the server's HTML.
 */
export function _hydrateIslands() {
  installIslandHydration();
  _claimIslands();
}

/**
 * Hydrating islands without adopting the server's HTML: each island claims
 * the server's region for its own and renders over it in the browser. What
 * `reactCompat({ hydrateIslands: false })` installs; _hydrateIslands()
 * includes it. A page that only mounts does not carry the code.
 */
export function _claimIslands() {
  _setIslandClaim(_claimIsland);
}

// A hydrating page has what-core's vnode renderer: its walk claims with it a
// React element that native code placed in a hole (a value a React file
// made), which what-react's own elements do not install (runtime.js
// _vnodeOf). Holding what-core's vnode producer here keeps it in every page
// that hydrates.
/** @type {any} */ (_claimIslands)._vnode = h;

// =====================================================================
// React inside native
// =====================================================================

/**
 * A React element tree placed by native code. `view` returns what-react
 * elements; it is called again whenever a signal it read changes.
 * `svg` says the island stands inside an <svg> element.
 */
export function ReactIsland(props) {
  // On the server: the island's HTML (server.js). A client build does not
  // carry the server renderer (what-react's Vite plugin puts a stand-in for
  // server.js there, whose serverIsland renders nothing).
  const html = serverIsland(props.view);
  return html !== undefined ? html : _island(props.view, props.svg === true);
}

// React elements that native code places in a hole itself (a What component
// mapping an array to React elements, `{rows(order())}`) are reconciled as
// React reconciles a component's children: each array of the hole is a list
// of its own, a row is kept by its key (or, unkeyed, its place) and its type,
// and keeps its nodes, its state, the text typed in it and the focus, with its
// new props rendered into it. Two arrays of one hole (`{[rows(a), rows(b)]}`,
// a nested array, a list and an element beside it) never take each other's
// rows, a key that moves to another array mounts again, and a key repeated
// in one array keeps the first element's row while the others mount again on
// every run (runtime.js reconcile does the same; development warns as React
// does).
//
// what-core's regions hand a value to the keyed rows of its vnode renderer
// on every run (render.js region, `vnodeRows`). In a program with no renderer
// of what-core's (a client build whose native code makes no vnode), this
// module installs what-react's: a vnode renders as an island (runtime.js
// _vnodeIsland), and a value that holds a React element is placed by
// holeRows below, the rest by what-core. Where what-core's renderer is in the
// program (a page that hydrates, native code that makes a vnode) its own
// keyed rows keep such a list while the elements' props stay the same.
//
// Each run is a commit, in React's order: the passive effects earlier commits
// left run first; the rows render; a row whose key goes is unmounted (its
// layout cleanups and refs) and the nodes are placed in the page; then the
// refs and layout effects of what mounted or updated run, on nodes in the
// page; the passive effects are scheduled. What the commit queued (an error
// boundary's fallback, a Suspense boundary's) renders before the run
// returns, as React's commit takes them in. The next run takes only what
// this one placed. A top-level unkeyed fragment stands for its children, as
// React reads it. Rows inside an <svg> are SVG elements. Each island is a root under the owner the
// hole was created under, as what-core's keyed rows are: native code inside
// it finds the What context around the hole. Rows that move are moved node
// by node, which takes the focus from a moved element: the element in the
// hole that had it gets it back when the run is done, if the focus was left
// on nothing (the page's body) and the element is still in the page.
{
  const proto = Object.getPrototypeOf(element('i', null));
  if (proto._$r === _vnodeIsland) {
    _installVNodeRuntime(_vnodeIsland, (value, rows, svg, scope) => (rows !== null || hasElement(value) ? rows || holeRows(svg, scope) : null), undefined, undefined);
  }
}

// Whether `value` (a hole's value) holds a what-react element.
function hasElement(value) {
  if (Array.isArray(value)) return value.some(hasElement);
  return value != null && value._compat === true;
}

// The keyed rows of one hole. `update` places `value` before `marker`;
// `remove` takes everything out (the hole's value holds no React element).
function holeRows(svg, scope) {
  const end = document.createComment('/w$rows');
  /** @type {Map<string, any>} */
  let kept = new Map();
  /** @type {any[]} */
  let placed = [];
  const nodesOf = (list) => {
    const out = [];
    for (const n of list) {
      out.push(n);
      // A region's or list's nodes, as they stand now (dom.js _liveRegionNodes).
      const last = n._rangeEnd;
      if (last !== undefined) for (let m = n.nextSibling; m !== null; m = m.nextSibling) {
        out.push(m);
        if (m === last) break;
      }
    }
    return out;
  };
  const drop = () => {
    kept.forEach((entry) => {
      placed.push(..._domNodes(entry.inst));
      entry.dispose();
    });
  };
  return {
    update(host, marker, value) {
      if (end.parentNode !== host) host.insertBefore(end, marker);
      _flushPendingPassive();
      runInCommit(() => place(host, value));
      _flushQueued();
    },
    remove() {
      if (end.parentNode === null) return;
      runInCommit(() => place(end.parentNode, null));
      end.remove();
    },
  };

  function place(host, value) {
    if (value != null && value.type === Fragment && value.key == null) value = value.props.children;
    const inSvg = svg || (host.namespaceURI.endsWith('svg') && host.localName !== 'foreignObject');
    const focused = /** @type {any} */ (document.activeElement);
    const had = host.contains(focused) ? focused : null;
    /** @type {Map<string, any>} */
    const next = new Map();
    /** @type {any[]} */
    const out = [];
    const walk = (v, slot, i) => {
      if (Array.isArray(v)) {
        for (let j = 0; j < v.length; j++) walk(v[j], Array.isArray(v[j]) ? slot + j + '.' : slot, j);
        return;
      }
      if (v == null || v._compat !== true) {
        _valuesToNodes(v, host, out, inSvg);
        return;
      }
      const id = v.key != null ? slot + ':' + v.key : slot + '#' + i;
      if (next.has(id)) {
        if (__DEV__ && v.key != null) console.error(`[what-react] Encountered two children with the same key, \`${v.key}\`. Keys should be unique so that components maintain their identity across updates.`);
        out.push(.../** @type {any} */ (_vnodeIsland(v, host, inSvg)).childNodes);
        return;
      }
      let entry = kept.get(id);
      if (entry !== undefined && entry.type === v.type) {
        kept.delete(id);
        if (entry.vnode !== v) {
          entry.vnode = v;
          untrack(() => runInCommit(() => renderInstance(entry.inst)));
        }
        out.push(..._domNodes(entry.inst));
      } else {
        /** @type {any} */
        const made = (entry = { type: v.type, vnode: v });
        runWithOwner(scope, () => createRoot((dispose) => {
          made.dispose = dispose;
          // The island's view records its instance (it renders as that instance).
          out.push(.../** @type {any} */ (_island(() => ((made.inst = _getCurrentInstance()), made.vnode), inSvg)).childNodes);
        }));
      }
      next.set(id, entry);
    };
    walk(value, '', 0);
    // What this run did not take goes, unmounted and out of the page.
    drop();
    kept = next;
    const stays = new Set(out);
    for (const n of nodesOf(placed)) if (!stays.has(n) && n.parentNode === host) host.removeChild(n);
    let ref = end;
    for (let j = out.length - 1; j >= 0; j--) {
      const n = out[j];
      if (n.parentNode !== host || n.nextSibling !== ref) host.insertBefore(n, ref);
      ref = n;
    }
    placed = out;
    const now = document.activeElement;
    if (had !== null && (now === null || now === document.body) && had.isConnected) had.focus({ preventScroll: true });
    // A select whose options these are writes its value again.
    _$childrenChanged(host);
  }
}

// =====================================================================
// Native inside React
// =====================================================================

const nativeWrappers = new WeakMap();

/**
 * The React component that renders the native What component `Comp`. The
 * same function for the same component, so React keeps its instance.
 */
export function native(Comp) {
  let wrapper = nativeWrappers.get(Comp);
  if (wrapper === undefined) {
    wrapper = function NativeComponent(props) {
      return renderNative(_getCurrentInstance(), Comp, props);
    };
    wrapper.displayName = Comp.displayName || Comp.name || 'NativeComponent';
    wrapper._whatNative = Comp;
    nativeWrappers.set(Comp, wrapper);
  }
  return wrapper;
}

/**
 * `native()` for a component a React file imports: the import is read when
 * the element renders, never while the module is evaluated, so an import
 * cycle cannot hand over a binding that is not initialized yet.
 */
export function nativeRef(get, name) {
  const wrapper = function NativeComponent(props) {
    return renderNative(_getCurrentInstance(), get(), props);
  };
  wrapper.displayName = name || 'NativeComponent';
  wrapper._whatNative = true;
  wrapper._getNative = get;
  return wrapper;
}

function renderNative(inst, Comp, props) {
  let leaf = inst._leaf;
  if (leaf !== undefined && leaf.Comp === Comp && leaf.update(props)) return leaf.node;
  if (leaf !== undefined) {
    // Another component (a hot update), or a prop it never had: build it again.
    if (__DEV__ && leaf.Comp === Comp) {
      console.warn(`[what-react] <${Comp.displayName || Comp.name || 'Component'}> was rebuilt: a React parent passed it a prop it did not have when it mounted. Pass every prop from the first render (undefined is fine) to keep its state.`);
    }
    leaf.dispose();
  }
  leaf = inst._leaf = createLeaf(inst, Comp, props);
  inst._dispose = () => leaf.dispose();
  return leaf.node;
}

// Whether a value is something React renders (an element, a node, or a list
// holding one), which a native component has to place through React's
// reconciler to keep React state and context.
function isRich(value) {
  if (value == null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (isRich(value[i])) return true;
    return false;
  }
  return isVNode(value) || typeof value.nodeType === 'number';
}

// A function a native component should always call in its latest version (an
// event handler, an accessor), as opposed to a component it renders.
function isCallback(value) {
  return typeof value === 'function' && value._compatType === undefined && value.$$typeof === undefined
    && !(value.prototype != null && (value.prototype.isReactComponent || value.prototype.render));
}

function nativeOwnerOf(inst) {
  for (let p = inst; p != null; p = p.parent) {
    if (p._nativeOwner !== undefined) return p._nativeOwner;
  }
  return null;
}

/**
 * A native component mounted once for a compat instance. Its props object has
 * a getter per prop: a plain value reads a signal the next React render
 * writes; a callback is a stable function that calls the latest one; a React
 * element (children, a slot prop) is a placeholder the native component
 * places, filled by React's reconciler with the latest elements.
 *
 * Several children (an array holding an element) are an array with one
 * placeholder per child, so the native component can count them, index them
 * and place each where it wants. As h() hands children to a native
 * component, nested arrays are flattened and empty children (null, false)
 * are left out. Each placeholder is keyed by the child's place in React's
 * list (its key, or its index), so what-core keeps the placed ones when the
 * list changes, and React state inside them survives.
 */
function createLeaf(inst, Comp, first) {
  /** @type {Record<string, any>} */
  let current = first;
  const keys = new Set(Object.keys(first));
  /** @type {Map<string, any>} */
  const cells = new Map();
  /** @type {Map<string, any>} */
  const slots = new Map();
  /** @type {Map<string, { array: any[], slots: any[] }>} prop → its list of placeholders */
  const lists = new Map();
  /** @type {Map<string, Function>} */
  const callbacks = new Map();
  // No prototype: what-core takes such a props object as the component's own
  // and keeps its getters (render.js ownProps), as it does compiled JSX's.
  const live = Object.create(null);

  const shown = (key, value) => {
    if (isRich(value)) return Array.isArray(value) ? listFor(key, value).array : slotFor(key, value).vnode;
    if (lists.has(key)) dropList(key);
    if (isCallback(value)) {
      let call = callbacks.get(key);
      if (call === undefined) {
        /** @this {unknown} */
        call = function (...args) {
          const fn = current[key];
          return typeof fn === 'function' ? fn.apply(this, args) : undefined;
        };
        callbacks.set(key, call);
      }
      return call;
    }
    return value;
  };

  // `rowKey`: the key of a placeholder that is one of a list.
  const slotFor = (key, value, rowKey) => {
    let slot = slots.get(key);
    if (slot === undefined) {
      slot = { key, inst, value, mounts: new Set(), vnode: null };
      // CompatSlot returns its DOM, as a compiled component does. what-core's
      // declared Component type admits vnode children only, hence the cast.
      const Slot = /** @type {import('what-core').Component<{ slot: object }>} */ (/** @type {unknown} */ (CompatSlot));
      slot.vnode = rowKey === undefined ? h(Slot, { slot }) : h(Slot, { slot, key: rowKey });
      slots.set(key, slot);
    } else {
      slot.value = value;
    }
    return slot;
  };

  // The placeholders for a list of children. The same array as last time
  // when the list has the same children in the same places, so the native
  // component sees a change only when one came, went or moved.
  const listFor = (key, values) => {
    const flat = normalizeChildren(values);
    const ids = /** @type {Array<number | string>} */ (/** @type {any} */ (flat).slots);
    const array = [];
    const used = [];
    const seen = new Set();
    for (let i = 0; i < flat.length; i++) {
      if (flat[i] === null) continue;
      // A duplicate key gets a place of its own.
      let id = String(ids[i]);
      if (seen.has(id)) id += '#' + i;
      seen.add(id);
      const slot = slotFor(key + '\0' + id, flat[i], id);
      used.push(slot);
      array.push(slot.vnode);
    }
    const last = lists.get(key);
    if (last !== undefined) {
      let same = last.array.length === array.length;
      for (let i = 0; same && i < array.length; i++) same = last.array[i] === array[i];
      if (same) return last;
      // A child that left: its elements unmount now, with this render.
      const kept = new Set(used);
      for (const slot of last.slots) if (!kept.has(slot)) dropSlot(slot);
    }
    const list = { array, slots: used };
    lists.set(key, list);
    return list;
  };

  const dropSlot = (slot) => {
    slots.delete(slot.key);
    slot.value = null;
    for (const m of slot.mounts) patchSlot(slot, m);
  };

  const dropList = (key) => {
    const list = lists.get(key);
    if (list === undefined) return;
    lists.delete(key);
    for (const slot of list.slots) dropSlot(slot);
  };

  for (const key of keys) {
    const cell = signal(shown(key, first[key]));
    cells.set(key, cell);
    Object.defineProperty(live, key, { get: () => cell(), enumerable: true, configurable: true });
  }

  /** @type {(() => void) | null} */
  let dispose = null;
  const owner = nativeOwnerOf(inst.parent);
  const node = _outsideRender(() => untrack(() => runWithOwner(owner, () => createRoot((d) => {
    dispose = d;
    // The native subtree's compat host: React trees placed in it find their
    // context through this instance.
    _provide(HOST, inst);
    return _nativeBuilder !== null ? _nativeBuilder(Comp, live) : _$createComponent(Comp, live, null);
  }))));

  return {
    Comp,
    node,
    update(next) {
      for (const key in next) if (!keys.has(key)) return false;
      current = next;
      untrack(() => batch(() => {
        for (const key of keys) {
          const value = next[key];
          const cell = cells.get(key);
          if (isRich(value) && Array.isArray(value)) {
            const list = listFor(key, value);
            for (const slot of list.slots) for (const m of slot.mounts) patchSlot(slot, m);
            if (cell.peek() !== list.array) cell(() => list.array);
          } else if (isRich(value)) {
            if (lists.has(key)) dropList(key);
            const slot = slotFor(key, value);
            for (const m of slot.mounts) patchSlot(slot, m);
            if (cell.peek() !== slot.vnode) cell(() => slot.vnode);
          } else {
            const v = shown(key, value);
            cell(() => v);
          }
        }
      }));
      return true;
    },
    dispose() {
      const d = dispose;
      dispose = null;
      if (d !== null) d();
    },
  };
}

/**
 * Where a native component places React elements it was handed: the slot's
 * latest elements, reconciled in place, under the compat instance that
 * handed them over and the What owner where they are placed.
 */
function CompatSlot(props) {
  const slot = props.slot;
  const frag = document.createDocumentFragment();
  const start = document.createComment('w:s');
  const end = document.createComment('/w:s');
  frag.appendChild(start);
  frag.appendChild(end);
  // The elements' parent instance: the one that handed them over, seen from
  // where they are placed (native components below are created there).
  const parent = { parent: slot.inst, depth: slot.inst.depth + 1, _nativeOwner: getOwner() };
  // The slot holds its list between its markers: a component in it that
  // renders no node finds its place there (runtime.js placeFromSiblings).
  const m = { start, end, parent, rns: [] };
  m.rns = untrack(() => runInCommit(() => patchChildren(frag, [], normalizeChildren(slot.value), end, false, parent, m)));
  slot.mounts.add(m);
  onCleanup(() => {
    slot.mounts.delete(m);
    runInCommit(() => {
      for (const rn of m.rns) unmountRNode(rn, false);
      m.rns = [];
    });
    _flushUnmounted();
  });
  return frag;
}

function patchSlot(slot, m) {
  const parentDom = m.end.parentNode;
  if (parentDom === null) return;
  m.rns = patchChildren(parentDom, m.rns, normalizeChildren(slot.value), m.end, false, m.parent, m);
}
