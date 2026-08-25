// What Framework - Fine-Grained Rendering Primitives
// Solid-style rendering: components run once, signals create individual DOM effects.
// No VDOM diffing — direct DOM manipulation with surgical signal-driven updates.

import { effect, untrack, _createItemScope, signal, memo, __DEV__ } from './reactive.js';
import { __resetIdCounter } from './a11y.js';
import { createDOM, disposeTree, getComponentStack, addHydrationDisposer, addHydratedComponent, _setSelectValue, _isUnsafeAttr, _isEventProp, _installLazyChildren, _handleNavigationSignal } from './dom.js';
import { _injectIslandRuntime, reportError } from './components.js';
export { effect, untrack };
// Re-export memo for compiled output (branch memoization: the compiler emits
// _$memo(() => cond) so conditional branches only re-create DOM when the
// condition value actually changes, not on every dependency write).
export { memo };

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
  // Deferred children (compiled JSX): the compiler passes a zero-arg factory
  // when children contain elements, so their DOM is not built before this
  // component runs. Pass it along marked; createComponent decides how the
  // component sees it. h() and the JSX runtime pass arrays and take the path
  // below unchanged.
  if (typeof children === 'function') {
    const lazy = () => {
      const kids = children();
      return kids.length === 1 ? kids[0] : kids;
    };
    lazy._lazyChildren = true;
    if (!props) props = {};
    Object.defineProperty(props, '_$lazyChildren', { value: lazy, configurable: true });
    return createDOM({ tag: Component, props, children: [], key: null, _vnode: true });
  }
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
    let target = /** @type {Node} */ (t.content.firstChild);
    for (let i = 0; i < tableInfo.depth; i++) target = /** @type {Node} */ (target.firstChild);
    return () => target.cloneNode(true);
  }

  const t = document.createElement('template');
  t.innerHTML = trimmed;

  // The compiler emits exactly one root element per template. If the parser
  // handed back more than one top-level node it restructured the markup, which
  // it does silently for invalid nesting: `<p>a<div>b</div>c</p>` becomes
  // `<p>a</p><div>b</div>c<p></p>`, four nodes instead of one. Compiled output
  // then walks firstChild/nextSibling over a tree that no longer matches the
  // source and dies on `Cannot read properties of null (reading 'firstChild')`,
  // pointing at generated code with no hint of the cause. Say what happened
  // instead. Dev-only: in production the markup is already known-good, and this
  // is on the hot path.
  if (__DEV__ && t.content.childNodes.length !== 1) {
    const inner = /** @type {Element | null} */ (
      [...t.content.childNodes].find((n, i) => i > 0 && n.nodeType === 1)
    );
    throw Object.assign(
      new Error(
        `[what] <${tag}> cannot contain <${inner ? inner.nodeName.toLowerCase() : 'that element'}>: ` +
        'the HTML parser closed the outer tag early, so the rendered tree does not match your JSX.',
      ),
      { code: 'ERR_INVALID_HTML_NESTING' },
    );
  }

  return () => /** @type {Node} */ (t.content.firstChild).cloneNode(true);
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
    return () => /** @type {Node} */ (t.content.firstChild).cloneNode(true);
  }

  // Inner SVG element (path, circle, g, etc.) — wrap in <svg> for namespace context
  const t = document.createElement('template');
  t.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${trimmed}</svg>`;
  return () => /** @type {Node} */ (/** @type {Node} */ (t.content.firstChild).firstChild).cloneNode(true);
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

  // Deferred component children: realize once, no reactive wrapper.
  if (typeof child === 'function' && child._lazyChildren) {
    return insert(parent, child(), marker);
  }

  if (typeof child === 'function') {
    // Single-evaluation mount: child() is evaluated exactly ONCE at mount,
    // inside the effect (so signal reads are tracked). The first run decides
    // between the text fast path (direct textNode.data updates, zero
    // allocations) and the general reconcile path. Previously the first
    // evaluation happened outside the effect to pick the path, then the
    // effect's first run re-evaluated child() — creating components twice
    // on mount for non-text children. (SPRINT v0.11 C3)
    const m = marker || null;
    let current = null;
    let textNode = null; // non-null while on the text fast path
    let mounted = false;
    // Capture the owning component at CREATION time. See the identical capture
    // in createDOM's reactive branch (dom.js): this effect re-runs long after
    // the synchronous render that created it, when the component stack is
    // empty, so everything it builds on a re-run got parentCtx = null and the
    // owner chain was severed. useContext then fell through to the context
    // DEFAULT, and an ErrorBoundary stopped catching throws from components
    // created by an inner region. Both work on first paint and only break once
    // the app is interactive, which is why nothing caught it.
    //
    // dom.js was given this fix; this path, the one the COMPILER emits for
    // every `{() => ...}`, was not. So it was broken for exactly the users on
    // the recommended build setup.
    const owner = captureOwner();
    effect(() => withOwner(owner, () => {
      const val = child();
      const vt = typeof val;
      if (!mounted) {
        // First run — mount
        mounted = true;
        if (vt === 'string' || vt === 'number') {
          textNode = document.createTextNode(String(val));
          if (m) parent.insertBefore(textNode, m);
          else parent.appendChild(textNode);
          if (_onTextInsert) _onTextInsert(parent, String(val));
          current = textNode;
        } else {
          current = reconcileInsert(parent, val, null, m);
        }
        return;
      }
      if (textNode !== null && (vt === 'string' || vt === 'number')) {
        // Fast path: still text — update data directly (no allocations)
        const str = String(val);
        if (textNode.data !== str) textNode.data = str;
        if (_onTextInsert) _onTextInsert(parent, str);
        return;
      }
      // Type changed (or never was text) — full reconcile
      textNode = null;
      current = reconcileInsert(parent, val, current, m);
    }));
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

// --- Owner capture for effects that outlive their render ---
//
// A reactive region's effect re-runs long after the synchronous render that
// created it, when the component stack has unwound. Anything it builds then has
// no owning component, which severs the chain that useContext and the
// ErrorBoundary / Suspense lookups both walk. Capturing the owner at creation
// and re-pushing it for the duration of each re-run restores it.

function captureOwner() {
  const stack = getComponentStack();
  return stack[stack.length - 1] || null;
}

function withOwner(owner, fn) {
  const stack = getComponentStack();
  // Already on top during the initial synchronous run; only re-push when the
  // stack has since unwound.
  const restore = owner !== null && stack[stack.length - 1] !== owner;
  if (restore) stack.push(owner);
  try {
    return fn();
  } finally {
    if (restore) stack.pop();
  }
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

  // Reactive thunks passed through as component children / props.
  //
  // The compiler lowers a multi-child component to an ARRAY of children, e.g.
  // `<Card><Sib/>{() => x()}</Card>` -> `_$createComponent(Card, null, [<Sib/>, () => x()])`.
  // Rendering `{props.children}` then emits `_$insert(el, props.children)`; a
  // plain array child skips insert()'s function/effect branch and lands here.
  // Resolving the thunk eagerly (`value()`) captured a one-time snapshot with no
  // reactive subscription, so the child rendered once and never updated.
  //
  // Route it through createDOM instead — its reactive fn-child path installs a
  // dedicated effect between stable comment markers, exactly like a thunk that
  // is the direct child of an intrinsic element. createDOM returns a
  // DocumentFragment (start marker, initial content, end marker); we flatten it
  // to its child nodes here — same reasoning as the isVNode/isDomNode fragment
  // handling below — so a later reconcile can still track and remove them. This
  // keeps event handlers and manually-called render props untouched: only
  // functions that actually flow into a render (child) position reach
  // valuesToNodes.
  //
  // mapArray inserters (`value._mapArray`) are also functions — createDOM
  // special-cases them, so they are handled correctly here too.
  if (typeof value === 'function') {
    const node = createDOM(value, parent, isSvgParent(parent));
    if (node && node.nodeType === 11 /* DOCUMENT_FRAGMENT_NODE */) {
      const kids = Array.from(node.childNodes);
      for (let i = 0; i < kids.length; i++) out.push(kids[i]);
    } else if (node) {
      out.push(node);
    }
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
    const node = createDOM(value, parent, isSvgParent(parent));
    // A component (or array) realizes to a DocumentFragment whose children are
    // absorbed into the DOM when inserted, leaving the fragment empty. Track the
    // individual children instead of the fragment so a later reconcile can find
    // and remove them — otherwise swapping one component subtree for another
    // (e.g. a router page change under a persistent layout) orphans the old
    // nodes. Mirrors the reactive fn-child path in dom.js (createDOM).
    if (node && node.nodeType === 11 /* DOCUMENT_FRAGMENT_NODE */) {
      if (node.childNodes.length === 0) {
        out.push(node);
      } else {
        const kids = Array.from(node.childNodes);
        for (let i = 0; i < kids.length; i++) out.push(kids[i]);
      }
    } else if (node) {
      out.push(node);
    }
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

  // Fast path: single DOM node value with single current node — skip array allocations.
  //
  // DocumentFragments (nodeType 11) are deliberately EXCLUDED on both sides. A
  // component realizes to a fragment `[<!--c:start-->, ...content, <!--c:end-->]`;
  // inserting a fragment absorbs its children into the DOM and leaves the fragment
  // empty. If the fast path stored that emptied fragment as `current`, it would
  // lose the reference to the real inserted nodes, so the next switch away could
  // not remove them and copies would stack (the "doubled empty-state" bug). Route
  // fragments through valuesToNodes below, which flattens them to their child
  // nodes and tracks each one for correct removal on the next reconcile.
  if (typeof value === 'object' && value !== null && value.nodeType > 0
      && value.nodeType !== 11 && !Array.isArray(value)) {
    if (value === current) return current;
    if (current && !Array.isArray(current) && current.nodeType > 0 && current.nodeType !== 11) {
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
      // Resolve the LIVE parent from the end marker each run. When this inserter
      // is mounted at a fragment-as-root (`<>{items().map(...)}</>`), createDOM
      // calls it against a throwaway DocumentFragment which is then appended to
      // the real container — the marker (and existing rows) move with it, so the
      // captured `parent` goes stale. endMarker.parentNode always reflects where
      // the list currently lives. Falls back to the captured parent pre-mount.
      const liveParent = endMarker.parentNode || parent;
      if (keyFn) {
        reconcileKeyed(liveParent, endMarker, items, newItems, mappedNodes, disposeFns, mapFn, keyFn, keyedState);
      } else {
        reconcileList(liveParent, endMarker, items, newItems, mappedNodes, disposeFns, mapFn);
      }
      // Save a snapshot of items for next diff. Use slice() to defend against
      // in-place mutation, but skip for empty arrays (common clear case).
      items = newItems.length > 0 ? newItems.slice() : newItems;
    });

    return endMarker;
  };
  inserter._mapArray = true;
  // The server has no DOM to insert into, so it cannot call the inserter at all.
  // Without these it fell through to the generic reactive-child branch, which
  // calls the value with no arguments: `parent` was undefined, the insertBefore
  // threw, SSR swallowed it, and every compiled keyed list rendered as an EMPTY
  // container. Exposing the inputs lets the server produce the same rows the
  // client will, in the same order, without touching a DOM.
  inserter._mapArraySource = source;
  inserter._mapArrayFn = mapFn;
  inserter._mapArrayKeyed = !!keyFn && !raw;
  return inserter;
}

/**
 * Render a mapArray inserter's rows without a DOM. Server-side only.
 *
 * Mirrors the item protocol reconcileKeyed/reconcileList use, because a row
 * built here is hydrated by one built there: keyed non-raw mode hands the mapFn
 * a signal ACCESSOR (so `item()` works), every other mode hands it the raw item.
 * Getting this wrong produces server HTML that differs from the client's on
 * every row.
 */
export function _mapArrayToArray(inserter) {
  const items = inserter._mapArraySource() || [];
  const mapFn = inserter._mapArrayFn;
  const keyed = inserter._mapArrayKeyed;
  return items.map((item, index) => (
    keyed ? mapFn(() => item, index) : mapFn(item, index)
  ));
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
          // disposeTree walks the subtree for nested component contexts
          // (c:start comments) and reactive bindings that the item-scope
          // dispose above does not cover. (AUDIT C5)
          disposeTree(node);
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
      if (mappedNodes[i]) disposeTree(mappedNodes[i]); // dispose nested component ctx (AUDIT C5)
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
    if (mappedNodes[oldIdx]) disposeTree(mappedNodes[oldIdx]); // dispose nested component ctx (AUDIT C5)
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
    // Always disposeTree: a component's context lives on its `c:start` comment
    // (nodeType 8, via _commentCtxMap) which carries none of the gate flags
    // below, so the old `_componentCtx || _dispose || _propEffects` guard
    // leaked every component's effects/cleanups/onCleanup/listeners on removal.
    // disposeTree is internally cheap-guarded and idempotent. (AUDIT C5)
    disposeTree(n);
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

        // DOM moves: swap the two items' DOM ranges.
        // Adjacent swaps need special handling because moving item2 before
        // item1 invalidates the pre-computed end boundary for item1 (it was
        // item2's marker, which has now moved). For adjacent items, a single
        // _moveItem suffices. For non-adjacent items, we recompute end1 after
        // the first move.
        const isAdjacent = (i2 === i1 + 1) || (i1 === i2 + 1);
        const lo = Math.min(i1, i2), hi = Math.max(i1, i2);

        if (isAdjacent) {
          // Adjacent: just move the later item's nodes before the earlier item's marker.
          const endHi = _findNextMarkerAfter(parent, mappedNodes[hi], mappedNodes, hi, endMarker);
          _moveItem(parent, mappedNodes[hi], endHi, mappedNodes[lo]);
        } else {
          // Non-adjacent: use a placeholder to remember i2's position, then
          // recompute end1 after the first move (since DOM has changed).
          const end2 = _findNextMarkerAfter(parent, mappedNodes[i2], mappedNodes, i2, endMarker);

          const placeholder = document.createComment('tmp');
          parent.insertBefore(placeholder, mappedNodes[i2]);

          // Move i2's nodes to before i1's current position
          _moveItem(parent, mappedNodes[i2], end2, mappedNodes[i1]);
          // Recompute end1 — the DOM has changed, so the pre-move boundary is stale
          const end1 = _findNextMarkerAfter(parent, mappedNodes[i1], mappedNodes, i1, endMarker);
          // Move i1's nodes to where i2 was (before placeholder)
          _moveItem(parent, mappedNodes[i1], end1, placeholder);
          parent.removeChild(placeholder);
        }

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

    // Ref — the element, not a reactive getter.
    //
    // This is the one prop whose FUNCTION form is a callback taking the element
    // rather than an accessor returning a value, which is exactly why the other
    // two call sites special-case it before the reactive-prop test (setProp
    // below, and applyProps in dom.js). Spread did not, so a function ref fell
    // into the reactive branch and was invoked as `value()` with NO ARGUMENT.
    // Every `{...register('email')}`-shaped API broke in silence on the
    // compiled path: the ref saw `undefined`, guarded, and returned, so no
    // element was ever registered and nothing threw to say so.
    if (key === 'ref') {
      if (typeof value === 'function') value(el);
      else if (value && typeof value === 'object') value.current = el;
      continue;
    }

    if (_isEventProp(key)) {
      // Event handler — direct assignment. Use $$name for delegated events.
      if (typeof value !== 'function') continue;
      const event = key.slice(2).toLowerCase();
      el.addEventListener(event, value);
      continue;
    }

    if (typeof value === 'function' && !_isEventProp(key)) {
      // Reactive prop — create micro-effect. The disposer must be registered
      // on el._propEffects so disposeTree() (dom.js) tears it down when the
      // element unmounts; otherwise the effect keeps firing on signal writes
      // for a detached element. Mirror the setProp() pattern.
      if (!el._propEffects) el._propEffects = {};
      // If a previous spread/setProp already registered an effect for this
      // key, dispose it first to avoid double-tracking.
      if (el._propEffects[key]) {
        try { el._propEffects[key](); } catch { /* already disposed */ }
      }
      if (key === 'class' || key === 'className') {
        el._propEffects[key] = effect(() => {
          const cls = value() || '';
          if (_hasSVGElement && el instanceof SVGElement) el.setAttribute('class', cls);
          else el.className = cls;
        });
      } else if (key === 'style' && typeof value() === 'object') {
        // Route through setStyle so stale object keys are cleared between
        // re-evaluations (el._lastStyleObj diffing).
        el._propEffects[key] = effect(() => { setStyle(el, value()); });
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
  if (typeof value === 'function' && !_isEventProp(key)) {
    if (!el._propEffects) el._propEffects = {};
    if (el._propEffects[key]) {
      try { el._propEffects[key](); } catch { /* already disposed */ }
    }
    el._propEffects[key] = effect(() => setProp(el, key, value()));
    return;
  }

  if (_isEventProp(key)) return;

  // Sanitize URL attributes: reject dangerous protocols and srcdoc
  if (_isUnsafeAttr(key, value)) {
    if (typeof console !== 'undefined') {
      console.warn(`[what] Blocked unsafe URL in "${key}" attribute:`, value);
    }
    return;
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
    // Delegate to setStyle so the object form clears stale keys (el._lastStyleObj).
    setStyle(el, value);
  } else if (value == null) {
    // null / undefined — attribute must be ABSENT (React/Solid semantics), not
    // stringified to "undefined"/"null". Caught before the data-*/aria-*, SVG
    // and property-reflected branches. Reflected props (e.g. el.title) are reset
    // first so removeAttribute() clears both the attribute and the property.
    if (key in el) {
      try { el[key] = ''; } catch { /* read-only reflected prop */ }
    }
    el.removeAttribute(key);
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

// --- Specialized attribute setters (SPRINT v0.11 C2) ---
// The compiler statically knows most attribute names, so it emits direct calls
// to these monomorphic helpers instead of routing everything through the
// generic setProp() dispatcher (which re-checks ref/key/url/class/style/...
// string-compares on every reactive update). setProp() remains the target for
// spreads, URL attributes (href/src/action — sanitization lives there) and any
// name the compiler can't classify.
//
// Function values are reactive ACCESSORS (e.g. `value={() => user().name}`),
// exactly like setProp treats them: wrap in an effect that re-applies the
// resolved value, with the disposer registered on el._propEffects so
// disposeTree() tears it down on unmount.

function _wrapPropAccessor(el, key, accessor, apply) {
  if (!el._propEffects) el._propEffects = {};
  if (el._propEffects[key]) {
    try { el._propEffects[key](); } catch { /* already disposed */ }
  }
  el._propEffects[key] = effect(() => apply(el, accessor()));
}

// class / className — hottest dynamic attribute in real apps.
export function setClass(el, value) {
  if (typeof value === 'function') return _wrapPropAccessor(el, 'class', value, setClass);
  if (_hasSVGElement && el instanceof SVGElement) {
    el.setAttribute('class', value || '');
  } else {
    el.className = value || '';
  }
}

// style — string (cssText) or object form.
export function setStyle(el, value) {
  if (typeof value === 'function') return _wrapPropAccessor(el, 'style', value, setStyle);
  if (typeof value === 'string') {
    el.style.cssText = value;
    // cssText fully replaces inline styles — drop any tracked object so a later
    // object form starts clean rather than diffing against stale keys.
    el._lastStyleObj = null;
  } else if (value && typeof value === 'object') {
    const style = el.style;
    // Clear properties present in the previously-applied object but absent from
    // the new one. Without this, `style={() => cond() ? {color, fontWeight} :
    // {color}}` would leave fontWeight set after flipping to the second object.
    const prev = el._lastStyleObj;
    if (prev) {
      for (const prop in prev) {
        if (!(prop in value)) style[prop] = '';
      }
    }
    for (const prop in value) {
      style[prop] = value[prop] ?? '';
    }
    el._lastStyleObj = value;
  } else if (value == null) {
    el.style.cssText = '';
    el._lastStyleObj = null;
  }
}

// Plain attribute set — used for data-*/aria-* (statically recognizable).
// null/undefined removes the attribute (previously setProp stringified them
// to "null"/"undefined" — removal is the correct semantic). Booleans are
// stringified ("true"/"false") because aria-* boolean strings are meaningful.
export function setAttr(el, name, value) {
  if (typeof value === 'function') {
    return _wrapPropAccessor(el, name, value, (e2, v) => setAttr(e2, name, v));
  }
  if (value == null) el.removeAttribute(name);
  else el.setAttribute(name, value);
}

// value — controlled-input property set. <select> keeps multi/deferred-option
// handling; other elements get a guarded property write (the !== guard avoids
// resetting the caret position in focused inputs on unrelated re-runs).
export function setValue(el, value) {
  if (typeof value === 'function') return _wrapPropAccessor(el, 'value', value, setValue);
  if (el.tagName === 'SELECT') {
    _setSelectValue(el, value);
    return;
  }
  const str = value == null ? '' : String(value);
  if (el.value !== str) el.value = str;
}

// checked — live property write (matches bind:checked). The old generic path
// used setAttribute('checked'), which only sets the DEFAULT-checked state and
// stops reflecting once the user has toggled the input.
export function setChecked(el, value) {
  if (typeof value === 'function') return _wrapPropAccessor(el, 'checked', value, setChecked);
  el.checked = !!value;
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

      // Shim e.currentTarget so handlers see the element the (virtual) listener
      // is attached to — not `document` — during the ancestor walk. Mirrors
      // Solid's delegation shim. configurable so nested dispatch can redefine.
      // (SPRINT v0.11 C9)
      Object.defineProperty(e, 'currentTarget', {
        configurable: true,
        get() { return node || document; },
      });

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
  // Restart the useId sequence so the client reproduces the server's ids rather
  // than continuing past them. The server allocates from a render-scoped counter
  // starting at 1; without this reset any client-side useId call made before
  // hydration would shift every id and break the `for`/`aria-labelledby`
  // relationships the primitive exists to create.
  __resetIdCounter();
  _hydrationCursor = { parent: container, index: 0 };

  try {
    const result = hydrateNode(vnode, container);
    // Same trim as every nested element, with one exclusion. A dedicated root
    // element holds nothing but the app, so anything the walk did not claim is
    // stranded server markup. <body> and <html> are different: they also hold
    // the script tags, the hydration payload and whatever the host page put
    // there, none of which the walk claims and none of which may be removed.
    // An app that hydrates into <body> keeps the old behavior.
    if (container !== document.body && container !== document.documentElement) {
      trimUnclaimed(container);
    }
    return result;
  } finally {
    _isHydrating = false;
    _hydrationCursor = null;
  }
}

/**
 * Drop server-rendered nodes that the client's walk never claimed.
 *
 * Everything from the cursor to the end of `parent` is content the server
 * produced and the client tree has no child for. Nothing references it, no
 * effect owns it, and no later update can ever reach it: it is stranded markup
 * that simply stays on screen.
 *
 * The case that makes this necessary is a reactive region that is empty on the
 * client and was NOT empty on the server. An empty region deliberately claims
 * nothing (claiming took the following sibling and destroyed it, cascading a
 * warn-and-recreate through the rest of the parent), so the element the server
 * rendered in its place has nothing to remove it. A cart badge the server drew
 * for a signed-in visitor stayed visible to a signed-out one, underneath the
 * region that was supposed to have replaced it.
 *
 * The two halves are what make each other safe: the walk never destroys a node
 * it is unsure about, and this removes what the finished walk proves is unused.
 */
function trimUnclaimed(parent) {
  if (!_hydrationCursor || _hydrationCursor.parent !== parent) return;
  while (parent.childNodes.length > _hydrationCursor.index) {
    const node = parent.lastChild;
    disposeTree(node);
    parent.removeChild(node);
  }
}

/**
 * Comment markers that belong to the machinery, not to the page.
 *
 * '$' / '/$' and '[]' / '/[]' come from the server's hydratable output. The
 * rest are planted by the hydration walk itself as it goes: 'fn' / '/fn' bound
 * a reactive region (the function branch of hydrateNode), 'eb:*' and 'sb:*'
 * bound an <ErrorBoundary> or a <Suspense> (hydrateBoundary), and 'portal' /
 * 'portal:empty' are a <Portal>'s placeholder.
 *
 * In every case the cursor is advanced past the marker at the moment it goes
 * in, so a later sibling REACHING one means the cursor has desynced. Skipping
 * is what keeps that desync from turning destructive. No vnode form in this
 * framework produces a comment node, so the element and text branches treat a
 * claimed comment as a mismatch and replaceChild() it away: a sibling that
 * claimed a region's end marker would delete the marker, leave the region
 * unterminated, and send its next update walking off the end of the parent.
 * Losing one node's reuse is a scratch; losing a marker is fatal to the region.
 */
const _HYDRATION_MARKERS = new Set([
  '$', '/$', '[]', '/[]',
  'fn', '/fn',
  'eb:start', 'eb:end',
  'sb:start', 'sb:end',
  'portal', 'portal:empty',
]);

function _isHydrationMarker(node) {
  return node.nodeType === 8 && _HYDRATION_MARKERS.has(node.textContent);
}

/**
 * Claim the next DOM node from the hydration cursor.
 * Returns the existing DOM node or null if none available.
 */
function claimNode(parent) {
  const children = parent.childNodes;
  while (_hydrationCursor.index < children.length) {
    const node = children[_hydrationCursor.index];
    if (_isHydrationMarker(node)) {
      _hydrationCursor.index++;
      continue;
    }
    _hydrationCursor.index++;
    return node;
  }
  return null;
}

/**
 * What claimNode would return next, without consuming it.
 *
 * Used by the branches that must decide whether the server left something
 * REUSABLE here before they commit to taking it. Claiming first and putting it
 * back is not possible: claiming is what advances the walk.
 */
function peekNode(parent) {
  if (!_hydrationCursor || _hydrationCursor.parent !== parent) return null;
  const children = parent.childNodes;
  for (let i = _hydrationCursor.index; i < children.length; i++) {
    const node = children[i];
    if (_isHydrationMarker(node)) continue;
    return node;
  }
  return null;
}

/**
 * Put a client-created node in at the cursor and advance past it.
 *
 * The mismatch fallbacks used to appendChild here, which puts the node at the
 * END of the parent rather than at the position being hydrated, and left the
 * cursor pointing AT it. Inside a reactive region that was fatal: the region's
 * end marker is placed at the cursor, so it landed BEFORE the content, the
 * region owned nothing, and it could never remove or replace what it had just
 * rendered. A `<Show>` whose server arm produced nothing showed its client arm
 * once and then ignored the signal forever.
 */
function insertAtCursor(parent, node) {
  if (_hydrationCursor && _hydrationCursor.parent === parent) {
    parent.insertBefore(node, parent.childNodes[_hydrationCursor.index] || null);
    _hydrationCursor.index++;
  } else {
    parent.appendChild(node);
  }
  return node;
}

// Warnings only. Never gate a DOM CORRECTION on this: see the text branch below.
//
// This used to test `process.env.NODE_ENV` directly, which is unreachable in a
// browser (there is no `process`), so hydration warnings could not fire in the
// one environment where hydration actually runs. __DEV__ resolves the same
// question across every environment, including a buildless browser app that
// opts in with globalThis.__WHAT_DEV__.
function isDevMode() {
  return __DEV__;
}

function hydrateNode(vnode, parent) {
  if (vnode == null || typeof vnode === 'boolean') {
    return null;
  }

  // Text node
  if (typeof vnode === 'string' || typeof vnode === 'number') {
    const text = String(vnode);

    // An empty string never DESTROYS anything to claim it.
    //
    // HTML cannot serialize an empty text node, so a reactive child that was
    // empty on the server emitted nothing at all. Claiming unconditionally took
    // the next sibling, saw an element where it wanted text, and replaced that
    // element with an empty text node: the server's real markup was destroyed,
    // every following sibling shifted, and a warn-and-recreate cascaded through
    // the rest of the parent. `{() => error()}` next to anything hit it.
    //
    // But refusing to claim ANYTHING was the opposite error. When the server
    // rendered real text here and the client now evaluates to '', the server's
    // text is exactly what has to be cleared. Skipping it left the stale value
    // on screen and then rendered the next value ALONGSIDE it ("9 items3
    // items"), because the region had adopted an empty node of its own while
    // the server's text sat outside it.
    //
    // So: claim a text node if one is there (the client value wins, same as
    // below), and claim nothing otherwise. The empty and non-empty cases now
    // differ only in refusing to consume a NON-text node.
    if (text === '') {
      const reusable = peekNode(parent);
      if (reusable && reusable.nodeType === 3) {
        claimNode(parent);
        reusable.textContent = '';
        return reusable;
      }
      return insertAtCursor(parent, document.createTextNode(''));
    }

    const existing = claimNode(parent);

    if (existing && existing.nodeType === 3) {
      // Reuse the text node, but the CLIENT value wins.
      //
      // Correcting the DOM used to sit inside the dev-only branch, and dev mode
      // was decided by `process.env.NODE_ENV`, which no browser has. The result
      // was that in every real browser a differing value was silently discarded
      // and the server's text stayed on screen until some later write happened
      // to touch that node. Any state the server cannot know (a cart restored
      // from localStorage, a saved theme, a relative timestamp) rendered stale
      // and looked like a broken store rather than a hydration bug.
      //
      // The correction is unconditional now. Only the warning is dev-gated.
      if (existing.textContent !== text) {
        if (isDevMode()) {
          console.warn(
            `[what] Hydration mismatch: expected text "${text}", got "${existing.textContent}"`
          );
        }
        existing.textContent = text;
      }
      return existing;
    }

    // Mismatch: expected text node, got element or nothing.
    if (isDevMode()) {
      console.warn(
        `[what] Hydration mismatch: expected text node "${text}", got ${existing ? existing.nodeName : 'nothing'}. Falling back to client render.`
      );
    }
    const textNode = document.createTextNode(text);
    if (existing) {
      parent.replaceChild(textNode, existing);
    } else {
      insertAtCursor(parent, textNode);
    }
    return textNode;
  }

  // Deferred component children: realize once, then hydrate the result
  if (typeof vnode === 'function' && vnode._lazyChildren) {
    return hydrateNode(vnode(), parent);
  }

  // Compiled keyed list. `.map()` with a key prop, and `<For>`, lower to a
  // mapArray INSERTER, which is a function taking (parent, marker) rather than a
  // thunk returning a value. The generic reactive branch below called it with no
  // arguments, so it threw on `parent.insertBefore` and the exception escaped
  // hydrate(): the whole page stopped hydrating and stayed inert. That is the
  // ordinary shape for a compiled app whose server HTML came from an uncompiled
  // render, which is exactly what the fullstack template produces.
  //
  // The list builds its own rows rather than claiming the server's. That is a
  // missed reuse, not a correctness problem: the inserter owns its end marker
  // and its effect from here on, and the server's rows are left unclaimed, so
  // trimUnclaimed removes them once the walk finishes. Claiming them properly
  // needs the list's own boundary markers in the server HTML, which is the same
  // thing reactive regions need and is tracked for 0.13.0.
  if (typeof vnode === 'function' && vnode._mapArray) {
    const cursorInParent = !!(_hydrationCursor && _hydrationCursor.parent === parent);
    const anchor = cursorInParent ? (parent.childNodes[_hydrationCursor.index] || null) : null;
    const endMarker = vnode(parent, anchor);
    if (cursorInParent) {
      const index = Array.prototype.indexOf.call(parent.childNodes, endMarker);
      if (index >= 0) _hydrationCursor.index = index + 1;
    }
    return endMarker;
  }

  // Reactive function child: attach an effect to the existing nodes
  if (typeof vnode === 'function') {
    // Bound the region with the same comment markers the client render path
    // uses (see the reactive-function branch of createDOM in dom.js). Hydration
    // used to create none, and paid for it twice on the first update:
    //
    //   - reconcileInsert was handed a null marker, so it had no insertion
    //     point and appended to the END of the parent. A hydrated <Show> that
    //     flipped arms jumped to the bottom of its container, because a
    //     component realizes to a DocumentFragment and fragments deliberately
    //     skip the replace-in-place fast path.
    //   - the effect's disposer was attached to the CONTENT node, so removing
    //     that content disposed the effect. The region then stopped reacting
    //     entirely: a <Show> broke position on its first flip and went dead on
    //     its second.
    //
    // Markers are stable nodes that outlive every value the region ever holds,
    // which is exactly why the client path has them. Client-only rendering was
    // always correct here; only the SSR path was missing them.
    //
    // The start marker goes in BEFORE the value is hydrated, at the slot the
    // cursor is pointing at. Anchoring afterwards to the first content node was
    // wrong in two ways that both showed up as content in the wrong place:
    //
    //   - a value of null/false/undefined claims no node, so there was no anchor
    //     and both markers were appended to the END of the parent. `<Show>` with
    //     no fallback, or `{cond && <X/>}`, permanently lost its position: the
    //     content appeared below every following sibling once it filled in.
    //   - a NESTED region hydrates while we are still inside this one and
    //     inserts its own markers around the content first. Anchoring to the
    //     content then put the outer start marker INSIDE the inner pair, so the
    //     regions interleaved instead of nesting. Switching the outer arm
    //     removed the content but neither the inner markers nor the inner
    //     effect, which kept rendering into a region that was switched off and
    //     duplicated it when the outer arm came back. `<Show>` wrapping
    //     `<Show>` or `<For>` is the canonical shape, not an exotic one.
    //
    // Opening the region first makes both cases fall out: everything the value
    // hydrates lands after the start marker, and the end marker closes at
    // wherever the cursor ends up.
    const cursorInParent = !!(_hydrationCursor && _hydrationCursor.parent === parent);
    const startMarker = document.createComment('fn');
    const endMarker = document.createComment('/fn');

    if (cursorInParent) {
      parent.insertBefore(startMarker, parent.childNodes[_hydrationCursor.index] || null);
      _hydrationCursor.index++;
    } else {
      parent.appendChild(startMarker);
    }

    // Hydrate the value for its side effects: it claims the server's nodes and,
    // if it contains a nested region, inserts that region's markers. What it
    // RETURNS is deliberately ignored, because it is not the region's contents:
    // a nested region's markers are not in it. The tracked set is read back from
    // the DOM below, between the markers, which is the actual boundary.
    hydrateNode(vnode(), parent);

    if (cursorInParent) {
      parent.insertBefore(endMarker, parent.childNodes[_hydrationCursor.index] || null);
      _hydrationCursor.index++;
    } else {
      parent.appendChild(endMarker);
    }

    // The region owns EVERYTHING between its markers, not just the nodes its own
    // value produced. A nested region leaves its markers in here too, and those
    // markers carry the disposer for the nested effect.
    //
    // Tracking only the value's own nodes meant that switching this region off
    // removed the visible content and left the inner markers and the inner
    // effect behind. The orphaned effect kept rendering into a region that was
    // switched off, and its output reappeared, doubled, when this region came
    // back. Collecting from the DOM is also more honest than reasoning about
    // what hydrateNode returned: the markers are the boundary, so whatever sits
    // between them is the content.
    const owned = [];
    for (let node = startMarker.nextSibling; node && node !== endMarker; node = node.nextSibling) {
      owned.push(node);
    }
    let current = owned.length === 0 ? null : (owned.length === 1 ? owned[0] : owned);

    // Set up reactive effect for future updates (normal rendering path).
    // The owner is captured for the same reason as in insert() and createDOM:
    // every re-run happens with the component stack unwound.
    const owner = captureOwner();
    const dispose = effect(() => withOwner(owner, () => {
      const value = vnode();
      // After hydration, this runs as normal insert
      if (!_isHydrating) {
        current = reconcileInsert(endMarker.parentNode || parent, value, current, endMarker);
      }
    }));

    // The disposer is now reachable from three places (either marker via
    // disposeTree, and the hydration disposer registry), which is deliberate:
    // whichever one the teardown happens to walk, the effect dies. It must
    // therefore be idempotent, or a tree disposed through more than one route
    // decrements the live-effect count once per route.
    let disposed = false;
    const disposeOnce = () => {
      if (disposed) return;
      disposed = true;
      dispose();
    };

    startMarker._dispose = disposeOnce;
    endMarker._dispose = disposeOnce;
    addHydrationDisposer(startMarker, disposeOnce);
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
      let endChildrenPass = null;
      try {
        // Same children protocol as createComponent: compiled JSX passes a
        // factory on _$lazyChildren rather than a built children array.
        const merged = { ...props };
        if (props._$lazyChildren) {
          endChildrenPass = _installLazyChildren(Component, merged, props._$lazyChildren);
        } else {
          merged.children = children.length === 0 ? props.children
            : children.length === 1 ? children[0] : children;
        }
        result = Component(merged);
        if (endChildrenPass) endChildrenPass();
      } catch (error) {
        componentStack.pop();
        // Same classification as createComponent, and it has to be the same or
        // the two paths disagree about what a throw MEANS:
        //
        //   - a navigation signal carries its own handler and is not a failure.
        //   - a thrown thenable is a SUSPENSION. It is how lazy() says "my
        //     chunk has not landed yet", and during hydration that is not an
        //     edge case but the normal one: on a real first load the dynamic
        //     import is still in flight when hydrate() runs. Logging it and
        //     returning null left `loading` unflipped, so the <Suspense> region
        //     came out EMPTY, the server's fallback markup was left unclaimed
        //     and then trimmed, and the chunk resolving re-rendered nothing.
        //     The boundary sat permanently blank, which is the one outcome
        //     Suspense exists to prevent.
        //   - anything else is a real error and belongs to the nearest
        //     <ErrorBoundary>, exactly as in a client-only render.
        //
        // Unlike createComponent this never RE-THROWS when nothing handles it.
        // An exception escaping here escapes hydrate() itself and the rest of
        // the page never hydrates at all; whatever this component was, its
        // siblings are still recoverable.
        if (!_handleNavigationSignal(error)
            && !(error && typeof error.then === 'function' && suspendDuringHydration(error, ctx))
            && !reportError(error, ctx)) {
          console.error('[what] Error in component during hydration:', Component.name || 'Anonymous', error);
        }
        return null;
      }

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

      // ctx stays on the stack while the result is hydrated so a child's
      // useContext / error-boundary lookup resolves to this component, matching
      // createComponent in dom.js.
      try {
        const node = hydrateNode(result, parent);
        // No comment markers exist for a COMPONENT on this path, so the ctx has
        // to hang off some node that disposeTree will reach, or it leaks.
        //
        // Anchoring it to the first node the component produced is only valid
        // when that node is stable. If the component's root is a reactive
        // region, that node is the region's current CONTENT, and the region
        // replaces it on the very first update: disposeTree then ran over it and
        // took the whole component context with it. Every effect, cleanup and
        // onCleanup the component owns died the first time its own root
        // re-rendered, which is the same create-outside/dispose-inside-an-effect
        // shape the region markers exist to prevent.
        //
        // A region root falls back to the parent element instead. That disposes
        // later than ideal (when the parent goes, not when the component does),
        // and disposing late is strictly better than disposing while mounted.
        //
        // A boundary root needs no case here: hydrateBoundary returns its start
        // MARKER rather than its contents, and a marker is stable by
        // construction.
        const rootIsRegion = typeof result === 'function'
          || (Array.isArray(result) && result.some((child) => typeof child === 'function'));
        const first = Array.isArray(node) ? node[0] : node;
        const anchor = (!rootIsRegion && first && first.nodeType) ? first : parent;
        addHydratedComponent(anchor, ctx);
        return node;
      } finally {
        componentStack.pop();
      }
    }

    // Boundary marker tags — NOT elements, and never rendered as themselves.
    //
    // <ErrorBoundary>, <Suspense> and <Portal> each return one of these instead
    // of a DOM tag, and every other render path routes them to a boundary
    // handler rather than to createElement (dom.js createDOM, and the same
    // three tags in the server's renderer). Hydration was the one path with no
    // branch for them, so a marker tag fell through to the ELEMENT branch below
    // and went looking for a `<__errorBoundary>` element in the server HTML.
    // What it found was the first node of the boundary's OWN subtree, which it
    // warned about and destroyed:
    //
    //   server:  <div id="x"><p>INNER</p></div>
    //   client:  <div id="x"><!--eb:start--></div>
    //
    // One <ErrorBoundary> anywhere in a server-rendered page blanked everything
    // under it. The construct whose entire job is to contain a failure was
    // itself the failure.
    if (vnode.tag === '__errorBoundary') {
      const { errorState, fallback, reset, handleError } = vnode.props;
      return hydrateBoundary(vnode, parent, {
        startText: 'eb:start',
        endText: 'eb:end',
        ctxExtras: { _errorBoundary: handleError },
        state: errorState,
        contentFor: (error) => {
          if (!error) return vnode.children || [];
          return typeof fallback === 'function' ? fallback({ error, reset }) : fallback;
        },
      });
    }

    if (vnode.tag === '__suspense') {
      const { boundary, fallback, loading } = vnode.props;
      return hydrateBoundary(vnode, parent, {
        startText: 'sb:start',
        endText: 'sb:end',
        ctxExtras: { _suspenseBoundary: boundary },
        state: loading,
        contentFor: (isLoading) => (isLoading ? fallback : (vnode.children || [])),
      });
    }

    // <Portal> renders NOTHING on the server, by the same decision that makes
    // Portal() return null when there is no document: its content belongs to a
    // container somewhere else on the page, not to this position. So there is
    // no server markup here to claim and the portal mounts client-side exactly
    // as it does in a client-only render.
    //
    // The element branch did the opposite. It CLAIMED the next node, which is
    // the server's next real sibling, warned about a mismatch that never
    // existed, and replaced that sibling with the portal's placeholder comment.
    // The claimed node was destroyed and everything after it shifted, so a
    // portal in the middle of a server-rendered list cost every node behind it:
    // a modal host declared before the page content rebuilt the entire page.
    if (vnode.tag === '__portal') {
      const placeholder = createDOM(vnode, parent);
      return placeholder ? insertAtCursor(parent, placeholder) : null;
    }

    // Element — claim existing DOM element
    //
    // The comparison is case-INSENSITIVE. `nodeName` is uppercased for HTML
    // elements but case-preserved for everything else, so an SVG element's
    // nodeName is 'svg' and could never equal `tag.toUpperCase()`. Every inline
    // SVG on a server-rendered page therefore failed to match, warned
    // "expected <svg>, got svg", and was destroyed and rebuilt: with
    // document.createElement, in the HTML namespace, which does not render as
    // SVG at all. Icons, logos and charts went blank on hydration.
    const existing = claimNode(parent);
    const expectedTag = vnode.tag.toLowerCase();

    if (existing && existing.nodeType === 1 && existing.nodeName.toLowerCase() === expectedTag) {
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
        // Only when the client tree actually declares children here.
        //
        // An element the client says is EMPTY is not the same claim as "the
        // server's content is stale". An island is the counter-example that
        // matters: it renders a bare host element and fills it in later, when
        // its trigger fires, from the server HTML still sitting inside it.
        // Trimming on an empty child list threw that content away and the
        // island rebuilt it from scratch, which is the exact opposite of what
        // an island is for (a `mode: 'static'` island, which never hydrates at
        // all, simply lost its content).
        //
        // dangerouslySetInnerHTML is excluded above for the same reason: the
        // cursor never walks that subtree, so nothing in it is ever claimed.
        if (vnode.children.length > 0) trimUnclaimed(existing);
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

    // Create the element from scratch, through the same path a client-only
    // render uses. The hand-rolled version here called document.createElement
    // and setProp with no SVG context, so a rebuilt <svg> landed in the XHTML
    // namespace and rendered as nothing at all, and its attributes were set as
    // properties rather than attributes. Falling back to a client render has to
    // mean the client render, not an approximation of it.
    const newEl = createDOM(vnode, parent, isSvgParent(parent));
    if (existing) {
      parent.replaceChild(newEl, existing);
    } else {
      insertAtCursor(parent, newEl);
    }
    return newEl;
  }

  // DOM node — use directly
  if (isDomNode(vnode)) {
    return vnode;
  }

  // Fallback — create text node
  return insertAtCursor(parent, document.createTextNode(String(vnode)));
}

/**
 * Hand a thrown thenable to the nearest <Suspense> above `ctx`.
 *
 * The twin of the private `suspend()` in dom.js: the same walk up the same
 * `_parentCtx` chain to the same `_suspenseBoundary`. It is written out again
 * rather than shared because dom.js keeps its copy module-private, and the two
 * halves it depends on (the chain, and the boundary's onSuspend) are fixed
 * shapes that createSuspenseBoundary and hydrateBoundary both build.
 *
 * Returns false when nothing above can take the suspension, which makes the
 * thenable an ordinary unhandled error again.
 */
function suspendDuringHydration(promise, ctx) {
  for (let c = ctx; c; c = c._parentCtx) {
    if (c._suspenseBoundary) {
      c._suspenseBoundary.onSuspend(promise);
      return true;
    }
  }
  return false;
}

/**
 * Evidence that the node the cursor is parked on is NOT the one `vnode` would
 * have produced on the server.
 *
 * A boundary's region has no delimiter in the server's bytes, so "the markup
 * here belongs to this boundary" can never be PROVEN from the client. It can
 * sometimes be refuted, and a refutation is all claimServerArm needs: a plain
 * element or text vnode names exactly the node it wants, so a <p> facing a
 * <footer> is a boundary reaching past its own region into its next sibling.
 *
 * Anything else — a component, a thunk, a nested boundary marker — cannot
 * answer without being run, and "cannot tell" is deliberately NOT a refutation.
 * Refusing there would give up the reuse for `fallback={() => <ErrorMessage />}`,
 * which is the shape most apps actually write.
 */
function contradictsServerNode(vnode, node) {
  if (typeof vnode === 'string' || typeof vnode === 'number') return node.nodeType !== 3;
  if (vnode && vnode._vnode && typeof vnode.tag === 'string') {
    return node.nodeType !== 1 || node.nodeName.toLowerCase() !== vnode.tag.toLowerCase();
  }
  return false;
}

/**
 * Claim the server's markup for a boundary's FALLBACK, when the server rendered
 * the fallback too.
 *
 * A child that throws during SSR is caught by the server's own boundary branch
 * (packages/server/src/index.js), so the response carries the fallback and NOT
 * the children. The same child throws again while hydrating, which flips the
 * boundary's signal — but by then hydrateBoundary has already walked the happy
 * arm, and the happy arm does not match a byte of what the server sent. The
 * fallback markup went unclaimed, the boundary's effect built a second copy of
 * it, and the first copy was trimmed: the server rendered the fallback and the
 * client threw it away and rebuilt it.
 *
 * What makes this recoverable is that a child which throws before producing
 * anything claims NOTHING, so the cursor is still parked exactly where the
 * server's markup for this boundary starts and nothing in the region has been
 * written over. Then the fallback can hydrate against it like ordinary markup.
 *
 * The refusals matter as much as the claim, because the region's extent is not
 * knowable from the client (see contradictsServerNode):
 *
 *   - the failed arm produced something first, so the cursor has moved and
 *     whatever it moved over has already been claimed or replaced. A child
 *     ahead of the thrower is the ordinary case here: it claims the server's
 *     fallback node, calls it a mismatch, and destroys it before the boundary
 *     ever learns an error happened. Nothing left to reuse.
 *   - the server left nothing at this position at all. The node at the cursor
 *     then belongs to the boundary's next SIBLING, and claiming it would be the
 *     <Portal> failure again: a boundary eating the footer behind it.
 *   - the node that is there openly disagrees with the fallback's root.
 *
 * Every refusal falls back to the boundary's effect rebuilding the region,
 * which is what this whole path did before and is always correct — a lost
 * reuse, not a lost node.
 *
 * `getContent` is a thunk rather than a value so the refusals above cost
 * nothing: on a refusal the effect is the one that builds the fallback, and
 * running a user's `fallback={({ error }) => ...}` twice per catch to throw the
 * first result away is a side effect this has no business causing.
 *
 * Returns true when the region now holds the fallback.
 */
function claimServerArm(parent, regionStart, getContent) {
  // No cursor in this parent means nothing here was being claimed from the
  // server in the first place.
  if (regionStart < 0 || !_hydrationCursor || _hydrationCursor.parent !== parent) return false;

  // The failed arm has to have produced NOTHING. Any movement of the cursor is
  // a node this region has already committed to, claimed or created.
  if (_hydrationCursor.index !== regionStart) return false;

  // Nothing at this position means there is nothing to reuse. Asked first
  // because it is the only question answerable without building the fallback.
  const candidate = peekNode(parent);
  if (!candidate) return false;

  const content = getContent();
  const vnodes = Array.isArray(content) ? content : [content];
  const root = vnodes.find((v) => v != null && typeof v !== 'boolean');

  // A fallback that renders nothing wants an empty region, and an empty region
  // is what it already has. Claimed, with nothing to claim — and `candidate` is
  // left for whoever it really belongs to.
  if (root === undefined) return true;

  if (contradictsServerNode(root, candidate)) return false;

  for (const v of vnodes) hydrateNode(v, parent);
  return true;
}

/**
 * Hydrate an <ErrorBoundary> or a <Suspense>.
 *
 * The two are the same machine with a different signal: a marked region whose
 * contents are the children while the signal is falsy and the fallback once it
 * is not. The client builds both with createErrorBoundary / createSuspenseBoundary
 * in dom.js, and this is the hydrating twin of those two functions.
 *
 * Three things have to be true when this returns, and each was a separate bug:
 *
 *   - the server's markup is still on screen. The children hydrate against it
 *     in place; nothing is rebuilt.
 *   - the boundary's context is on the component stack while those children
 *     hydrate. reportError and suspend() both find their boundary by walking
 *     `_parentCtx` up from the component that threw, so a boundary missing from
 *     that chain catches nothing: the error escapes to the console and the page
 *     dies exactly as it would with no boundary at all.
 *   - the region is owned by an effect from here on, bounded by real comment
 *     markers. Without the markers there is no insertion point and no stable
 *     node to hang the disposer on, which is the same pair of failures the
 *     reactive-region branch documents above.
 *
 * The first effect run is the subtle one. It must NOT rebuild what hydration
 * just claimed, or hydrating a boundary would be indistinguishable from
 * client-rendering it. But it cannot skip unconditionally either: a child that
 * threw or suspended WHILE hydrating flipped the signal before this effect
 * existed, and in that case the markup between the markers may be the wrong arm
 * and has to be replaced.
 *
 * "May be", not "is", and that is the whole of claimServerArm below. When a
 * child throws during the SERVER render the server catches it too and puts the
 * FALLBACK in the HTML, so the two sides agree on the arm and the fallback is
 * ordinary server markup that hydration should claim like any other. Hydrating
 * the happy arm first and then rebuilding on the flipped signal threw that
 * markup away and built a second copy of it, which is exactly the
 * destroy-and-rebuild these markers exist to stop.
 */
function hydrateBoundary(vnode, parent, { startText, endText, ctxExtras, state, contentFor }) {
  const children = vnode.children || [];
  const cursorInParent = !!(_hydrationCursor && _hydrationCursor.parent === parent);
  const startComment = document.createComment(startText);
  const endComment = document.createComment(endText);

  // Same shape as the contexts the client boundaries build, for the same
  // reasons: `_parentCtx` keeps useContext resolving through the boundary, and
  // the marker references let a teardown find the region from the context.
  const boundaryCtx = {
    hooks: [],
    hookIndex: 0,
    effects: [],
    cleanups: [],
    mounted: false,
    disposed: false,
    _parentCtx: captureOwner(),
    _startComment: startComment,
    _endComment: endComment,
    ...ctxExtras,
  };

  // Open the region at the slot the cursor points at, before anything is
  // hydrated into it, so everything the children claim lands inside the pair.
  // (Anchoring the markers afterwards to whatever the children produced is
  // wrong for a boundary that produced nothing, and interleaves nested regions
  // instead of nesting them. See the reactive-region branch.)
  if (cursorInParent) {
    parent.insertBefore(startComment, parent.childNodes[_hydrationCursor.index] || null);
    _hydrationCursor.index++;
  } else {
    parent.appendChild(startComment);
  }

  // Where the region's content begins, in cursor terms. The start marker has
  // already consumed its slot, so this is the index the server's first node for
  // this boundary sits at. claimServerArm needs it to tell "the failed arm
  // touched nothing" from "the failed arm got part way in".
  const regionStart = cursorInParent ? _hydrationCursor.index : -1;

  const stack = getComponentStack();
  stack.push(boundaryCtx);
  try {
    for (const child of children) {
      hydrateNode(child, parent);
    }
  } finally {
    stack.pop();
  }

  // Which arm the boundary is on now that its children have run.
  //
  // Read UNTRACKED. This is the hydration walk, not the effect below, and a
  // hydrate() reached from inside somebody else's effect would otherwise hand
  // that effect a subscription to this boundary's private error/loading signal:
  // an unrelated region upstream would re-render every time a boundary caught.
  const armAfterWalk = untrack(state);

  // Whether the markup between the markers is already the arm `armAfterWalk`
  // names. True by construction when nothing flipped the signal (the walk just
  // claimed the children the server rendered), and true again when the fallback
  // below is claimed in place.
  let regionHoldsArm = !armAfterWalk;

  if (armAfterWalk) {
    // Same re-push as the rebuild in the effect, for the same reason: a
    // fallback that renders a component of its own must see the boundary in its
    // parent chain, and contentFor is what runs that fallback.
    stack.push(boundaryCtx);
    try {
      regionHoldsArm = claimServerArm(parent, regionStart, () => contentFor(armAfterWalk));
    } finally {
      stack.pop();
    }
  }

  if (cursorInParent) {
    parent.insertBefore(endComment, parent.childNodes[_hydrationCursor.index] || null);
    _hydrationCursor.index++;
  } else {
    parent.appendChild(endComment);
  }

  let claimedFromServer = true;
  // Generation guard, carried over from createSuspenseBoundary in dom.js, where
  // it exists because a child suspending mid-rebuild flips the state signal from
  // inside the loop below: if that re-entered the effect, the inner run would
  // replace the region and the outer run would then append the rest of the arm
  // it was already committed to, putting both arms on screen at once.
  //
  // It is honest to say this is currently UNREACHABLE and kept for parity. An
  // effect cannot re-enter itself here: reactive.js's notify() only executes
  // subscribers at notifyDepth 0 and queues them otherwise, so a write made
  // during an effect's own run is always drained after that run returns. Every
  // shape tried against it (two- and three-deep lazy waterfalls, and a staged
  // suspender behind a signal so the effect was auto-promoted to _stable and
  // therefore running INLINE) came back with a nesting depth of 1.
  //
  // Keeping it costs four lines and removes a way for the two boundary
  // implementations to disagree. The invariant it leans on lives in another
  // module and is not part of any contract this one can see.
  let generation = 0;
  const dispose = effect(() => {
    const current = state();

    if (claimedFromServer) {
      claimedFromServer = false;
      // The region already holds the arm this run would build: either the
      // children the server rendered and the walk claimed (the normal case), or
      // the fallback claimed in place by claimServerArm. The markup already
      // there IS the answer, so leave it alone.
      if (regionHoldsArm && current === armAfterWalk) return;
    }

    const host = startComment.parentNode;
    if (!host) return; // region detached before this run; nothing to update

    const gen = ++generation;

    // Same teardown as the client boundaries: everything between the markers
    // goes, disposed first so nested effects and component contexts die with
    // the nodes rather than outliving them.
    while (startComment.nextSibling && startComment.nextSibling !== endComment) {
      const old = startComment.nextSibling;
      disposeTree(old);
      host.removeChild(old);
    }

    // Re-push the boundary for the rebuild. This effect re-runs long after the
    // hydration walk has unwound the stack, and anything built with an empty
    // stack gets `parentCtx = null`: a fallback that itself contains a
    // component would sit outside every context it was written inside.
    stack.push(boundaryCtx);
    try {
      const content = contentFor(current);
      const vnodes = Array.isArray(content) ? content : [content];
      for (const v of vnodes) {
        const node = createDOM(v, host);
        if (gen !== generation) {
          // A newer run already rebuilt the region. Whatever this node is, it
          // belongs to a superseded arm: dispose it rather than insert it
          // alongside the arm that won.
          if (node) disposeTree(node);
          break;
        }
        // endComment can be gone if that newer run tore the region down.
        if (!node) continue;
        if (endComment.parentNode) endComment.parentNode.insertBefore(node, endComment);
        else disposeTree(node);
      }
    } finally {
      stack.pop();
    }
  });

  // Put the cursor back where the END MARKER actually ended up.
  //
  // The effect above runs SYNCHRONOUSLY, and when the state was already truthy
  // it has just removed R nodes from the region and inserted I of its own. The
  // cursor was fixed at endComment+1 a few lines earlier and knows nothing
  // about that, so it is off by (R - I) and the rest of the walk pays:
  //
  //   - drifting forward SKIPS the boundary's next server sibling, which then
  //     warns "got nothing" and is rendered a SECOND time. A page with a
  //     boundary above the footer got two footers.
  //   - drifting backward makes that sibling claim a node it must not, which
  //     before the marker skip list above meant claiming the boundary's own
  //     end marker and replaceChild()ing it away.
  //
  // Re-reading the marker's real index is the same re-sync the _mapArray branch
  // does, and for the same reason: once something has moved nodes behind the
  // walk's back, the only trustworthy answer to "where is the cursor now" is
  // where the marker physically is.
  if (cursorInParent && _hydrationCursor && _hydrationCursor.parent === parent) {
    const endIndex = Array.prototype.indexOf.call(parent.childNodes, endComment);
    if (endIndex >= 0) _hydrationCursor.index = endIndex + 1;
  }

  boundaryCtx.effects.push(dispose);
  // The client registers a boundary context in dom.js's comment->ctx WeakMap;
  // the hydration disposer registry is the same idea reached from out here, and
  // disposeTree walks both. Registered on BOTH markers, matching the
  // reactive-region branch: whichever one a teardown happens to walk, the
  // boundary dies. disposeComponent latches on ctx.disposed, so being reached
  // twice is harmless.
  addHydratedComponent(startComment, boundaryCtx);
  addHydratedComponent(endComment, boundaryCtx);

  // The START MARKER is the boundary's node, not its current contents.
  //
  // This matches the client exactly: createErrorBoundary returns a fragment
  // whose first node is that same start comment. It also matters for whoever
  // hydrated us. A component anchors its context to the first node its output
  // produced, and the contents of a boundary are the one thing that is
  // guaranteed to be replaced later, so returning them handed the enclosing
  // component a self-destructing anchor: the boundary catching an error
  // disposed the very component that wrapped the boundary. The markers outlive
  // every value the region holds, which is what an anchor has to do.
  return startComment;
}

/**
 * Apply props to an existing hydrated element.
 * Attaches event handlers and reactive bindings without re-creating the element.
 */
function hydrateElementProps(el, props) {
  for (const key in props) {
    if (key === 'children' || key === 'key') continue;
    if (key === 'dangerouslySetInnerHTML' || key === 'innerHTML') continue;

    // Refs must fire on the hydration path too. Skipping them meant every
    // component that reaches for its own DOM node through a ref got nothing
    // under SSR while working fine in a client-only render, which is the
    // hardest class of bug to find: it only reproduces in production.
    if (key === 'ref') {
      const ref = props.ref;
      if (typeof ref === 'function') ref(el);
      else if (ref && typeof ref === 'object') ref.current = el;
      continue;
    }

    const value = props[key];

    // Event handlers — always attach (they don't exist in SSR HTML)
    if (_isEventProp(key)) {
      if (typeof value !== 'function') continue;
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
    if (typeof value === 'function' && !_isEventProp(key)) {
      if (key === 'class' || key === 'className') {
        effect(() => { el.className = value() || ''; });
      } else if (key === 'style' && typeof value() === 'object') {
        // Route through setStyle so stale object keys are cleared (el._lastStyleObj).
        effect(() => { setStyle(el, value()); });
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

// Islands hydrate themselves against their own DOM element, which needs both the
// hydration walker and the insert path. components.js is upstream of this module
// (render -> dom -> components), so the renderers are handed down rather than
// imported back up, matching _injectGetCurrentComponent.
_injectIslandRuntime({ hydrate, insert });
