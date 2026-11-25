/**
 * what-react hydration: a React island takes the server's HTML for its own.
 *
 * what-core's hydration walk hands each island the region the server wrote
 * for it (render.js _claimRegion, runtime.js adoptIsland). Once the walk is
 * done, the island renders as it would in the browser, but every element and
 * text node it mounts is the server's node at that place: the reconciler's
 * mount (runtime.js mountRNode) asks claimNode() first. Nothing is created,
 * moved or removed where the client renders what the server did, so focus,
 * typed text, scroll positions, a playing video and a loaded image stay. Event
 * handlers and refs attach to the server's nodes, and effects run after, as
 * the commit runs them.
 *
 * React's rules, where they can be seen (react-dom 19.3.1):
 * - An attribute the server wrote is kept when it is the client's. One that
 *   differs, or that the client does not render, is reported and takes the
 *   client's value (React keeps the server's and warns in development).
 * - A text that differs is reported and takes the client's text, in place
 *   (React renders the whole root again). suppressHydrationWarning on an
 *   element keeps its own attributes and text as the server wrote them,
 *   unreported (React's rule).
 * - A form field keeps what the user did to it before hydration: its value
 *   is not written, the value it shows is the one seen, and its default is
 *   the client's (React's initInput). A textarea keeps typed text too (React
 *   puts its default back when that is not empty).
 * - An element of another tag, a missing node and a node the client does not
 *   render are rendered by the client in place of the server's, and reported;
 *   each report is one ERR_HYDRATION_MISMATCH per element, with what-core's
 *   record, also handed to hydrate()'s onHydrationError. React renders the
 *   whole root again. A form and a button keep nodes the client does not
 *   render, unreported, as React keeps them (a password manager's).
 * - useId gives the server's ids (server.js islandId), useSyncExternalStore
 *   reads the server snapshot while the island hydrates (and renders again
 *   when the client's differs), a portal renders in the browser.
 * - A <Suspense> whose fallback the server wrote renders afresh in the
 *   browser, as React does.
 *
 * What native What renders inside an island (a native component, a What
 * vnode, an accessor) is built again in place of the server's bracketed
 * nodes: only what React renders is adopted.
 *
 * Installed by the hydrating entry (mixed.js _hydrateIslands): a page that
 * never hydrates does not carry this module.
 */

import { reportDiagnostic, _currentOwnerPath, isVNode, __DEV__ } from 'what-core/internal';
import * as coreRender from 'what-core/render';
import { _$createComponent, _$hcreateComponent } from 'what-core/render';
import { Suspense } from './index.js';
import { _islandIds } from './hooks.js';
import { idsOf, islandId, styleText, RENAMED } from './server.js';
import {
  KIND_TEXT, KIND_ELEMENT, KIND_COMPONENT, KIND_OPAQUE, KIND_PORTAL, NO_RNODES, TEXTAREA_KIDS, SVG_NS, SVG_ATTR_MAP,
  claim, _setClaim, _setAdopter, _setNativeBuilder, mountRNode, mountComponent, mountChildren, flatten, flatIds, flatLists,
  onlyText, setText, setProperty, trackField, controlField, refQueue, runInCommit, renderInstance, unmountRNode,
} from './runtime.js';

// The onHydrationError hook of the hydrate() walking now (what-core
// render.js): what a hydration that runs after the walk reports to. Not in
// what-core's declarations.
const hydrationErrorHook = /** @type {{ _hydrationErrorHook: () => ((info: object) => void) | null }} */ (/** @type {unknown} */ (coreRender))._hydrationErrorHook;
// A hydration walk over a range of the server's nodes (render.js
// _hydrateRange): with it, a native component inside an island hydrates in
// its bracket; without, it is built again there. This what-core has none, so
// it is null here; the what-core change that adds it (core-hydrate-range)
// comes with the one-line import that sets it.
/** @type {((open: Comment, close: Comment, fn: () => unknown, onError?: any) => unknown) | null} */
const hydrateRange = null;

/** @internal Whether a native component inside an island hydrates in its bracket (tests). */
export const adoptsNative = hydrateRange !== null;

let installed = false;

/** Islands adopt the server's HTML from now on (mixed.js _hydrateIslands). */
export function installIslandHydration() {
  if (installed) return;
  installed = true;
  _setAdopter(adopt);
  _islandIds(islandId);
  if (hydrateRange !== null) _setNativeBuilder(buildNative);
}

// During the walk: what the island needs from it (the walk's error hook, its
// owner path for useId), and what renders it once the walk is done.
function adopt(inst, start, end) {
  const onError = hydrationErrorHook();
  const ownerPath = _currentOwnerPath();
  if (ownerPath !== undefined) inst._ids = idsOf(ownerPath);
  return () => {
    if (inst.unmounted || end.parentNode === null) return;
    claimIsland(inst, start, end, onError, ownerPath === undefined ? null : ownerPath);
  };
}

// ---- The cursor ----
// Where the claim stands: the element it claims in (p), the next server node
// (n; null at the element's end), where its region ends (e: the island's or
// a <Suspense>'s closing marker, else null), whether the element said
// suppressHydrationWarning (s), and the <Suspense> being hydrated around it
// (r: see claimSuspense).
/** @type {{ p: any, n: any, e: any, s: boolean, r: any } | null} */
let cur = null;
/** @type {any[]} */
const outer = [];
// One island's claim: where reports go, which regions reported already (one
// report each), the island's owner path and root.
/** @type {any} */
let session = null;

function claimIsland(inst, start, end, onError, ownerPath) {
  const saved = session;
  const savedCur = cur;
  const depth = outer.length;
  const claiming = claim;
  session = { onError, reported: new WeakSet(), ownerPath, island: inst };
  cur = { p: end.parentNode, n: start.nextSibling, e: end, s: false, r: undefined };
  runInCommit(() => {
    _setClaim(claimNode);
    try {
      renderInstance(inst);
      finish(cur, '');
    } finally {
      _setClaim(claiming);
      cur = savedCur;
      outer.length = depth;
      session = saved;
    }
  });
}

// Run `fn` (a mount) with no claim: what it builds is new.
function built(fn) {
  const claiming = claim;
  _setClaim(null);
  try {
    return fn();
  } finally {
    _setClaim(claiming);
  }
}

function enter(p, n, e, s, r) {
  outer.push(cur);
  cur = { p, n, e, s, r };
}

function leave() {
  cur = outer.pop();
}

// The separator a hydratable server render writes between two texts
// (server.js): <!--$--><!--/$-->.
function isSeparator(n) {
  if (n.nodeType !== 8 || n.data !== '$') return false;
  const close = n.nextSibling;
  return close !== null && close.nodeType === 8 && close.data === '/$';
}

// A node a claim passes: a separator (its <!--$-->, whose <!--/$--> is
// passed with it) or an empty text, which only the client makes (the HTML
// parser makes none).
function passed(n) {
  return n.nodeType === 3 ? n.data === '' : isSeparator(n);
}

function past(n, c) {
  while (n !== null && n !== c.e && passed(n)) n = n.nodeType === 3 ? n.nextSibling : n.nextSibling.nextSibling;
  return n === c.e ? null : n;
}

// The next server node a text or an element claims, past separators; null at
// the end of the region.
function at(c) {
  const n = past(c.n, c);
  c.n = n === null ? c.e : n;
  return n;
}

// The node after `n` past separators, in the cursor's region.
function after(c, n) {
  return past(n.nextSibling, c);
}

// ---- The claim ----

/**
 * runtime.js mountRNode, while an island claims: the rendered node for `v`,
 * on the server's node at the cursor; null to mount it as always (a hole, a
 * component, a node mounted anywhere but at the cursor: a portal's
 * container, a node built off the document).
 */
function claimNode(v, kind, parentDom, before, svg, owner, into) {
  // runtime.js handleRenderError: `v`, a thenable, suspended a component
  // under the boundary `parentDom`.
  if (kind < 0) return suspended(v, parentDom);
  const c = cur;
  if (c === null || parentDom !== c.p) return null;
  const r = c.r;
  if (r !== undefined) {
    // The <Suspense> being hydrated around it: its first child names it, and
    // once something in it suspended, the rest of it is built off the page
    // and let go (it hydrates later).
    if (r.inst === null && owner != null && owner.type === Suspense) r.inst = owner;
    if (r.dead && kind !== KIND_COMPONENT) return built(() => mountRNode(v, kind, null, null, svg, owner, into));
  }
  switch (kind) {
    case KIND_TEXT:
      return claimText(c, v, typeof v === 'string' ? v : String(v), owner);
    case KIND_ELEMENT:
      return claimElement(c, v, svg, owner);
    case KIND_COMPONENT: {
      const type = /** @type {any} */ (v.tag)._compatType || v.tag;
      if (type === Suspense) return claimSuspense(c, v, svg, owner, into);
      if (type._whatNative !== undefined) return claimNative(c, v, svg, owner, into);
      return null;
    }
    case KIND_OPAQUE:
      if (typeof v === 'object' && typeof v.nodeType === 'number') {
        // A native component that hydrated in its bracket (buildNative): the
        // bracket holds its nodes, as mountOpaque's markers hold them.
        const close = claimedNative.get(v);
        if (close !== undefined && v.parentNode === c.p) return { kind: KIND_OPAQUE, vnode: v, key: null, start: v, end: close, id: 0, list: null, dispose: null };
        // Any other raw DOM node: the server rendered nothing for it.
        return built(() => mountRNode(v, kind, c.p, c.n, svg, owner, into));
      }
      return rebuild(c, () => mountRNode(v, kind, c.p, c.n, svg, owner, into), owner);
    case KIND_PORTAL:
      // Rendered nothing on the server: its children mount in its container.
      return built(() => mountRNode(v, kind, parentDom, c.n, svg, owner, into));
  }
  return null;
}

// ---- Native What inside an island ----

// The bracket the native component being built now hydrates in (claimNative),
// and the brackets native components hydrated in, by their opening marker.
/** @type {any[] | null} */
let nativeRegion = null;
/** @type {WeakMap<Comment, Comment>} */
const claimedNative = new WeakMap();

// A native component a React tree renders (mixed.js native()), which the
// server rendered in a bracket of its own: with a what-core that walks a
// range, it hydrates there, as native code does under hydrate(); the React
// parent adopts the nodes it claimed. One handed React elements (children, a
// slot prop) places them through what-react, which cannot claim inside a
// native walk yet: built again, as is everything without that what-core.
function claimNative(c, v, svg, owner, into) {
  const region = hydrateRange === null || handsElements(v.props) ? null : regionAt(c);
  if (region === null || region[0].data !== '[]') return rebuild(c, () => mountComponent(v, c.p, c.n, svg, owner, into), owner);
  c.n = region[1].nextSibling;
  nativeRegion = region;
  try {
    return mountComponent(v, c.p, region[1], svg, owner, into);
  } finally {
    nativeRegion = null;
  }
}

// runtime.js _nativeBuilder: build the native component `Comp`, in the walk of
// its bracket when one is waiting for it. Its output is then the bracket's
// opening marker, which its React parent adopts with the nodes up to the
// closing one, whatever the component returned (nodes, a list, an accessor).
function buildNative(Comp, props) {
  const region = nativeRegion;
  if (region === null) return _$createComponent(Comp, props, null);
  nativeRegion = null;
  /** @type {Function} */ (hydrateRange)(region[0], region[1], () => _$hcreateComponent(Comp, props, null), session.onError);
  claimedNative.set(region[0], region[1]);
  return region[0];
}

// Whether props hand React elements over (mixed.js isRich).
function handsElements(props) {
  for (const key in props) if (key !== 'key' && key !== 'ref' && holdsElement(props[key])) return true;
  return false;
}

function holdsElement(value) {
  if (value == null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(holdsElement);
  return isVNode(value) || typeof value.nodeType === 'number';
}

// What native What renders inside the island (a native component, a What
// vnode, an accessor, a What boundary), which the server bracketed: built
// again in place of the server's nodes for it.
function rebuild(c, mount, owner) {
  const region = regionAt(c);
  if (region === null) report(c, 'marker', 'native What content', describe(c.n === c.e ? null : c.n), c.n || c.p, owner);
  else {
    c.n = region[1].nextSibling;
    removeRegion(region[0], region[1]);
  }
  return built(mount);
}

// The closing marker of each opening one a hydratable render writes.
const CLOSE = { '$': '/$', '[]': '/[]', 'b': '/b', 'b!': '/b' };

// The marked region at the cursor ([open, close], markers included), or null.
function regionAt(c) {
  const open = c.n;
  if (open === null || open === c.e || open.nodeType !== 8) return null;
  const close = CLOSE[open.data];
  if (close === undefined) return null;
  let depth = 0;
  for (let x = open.nextSibling; x !== null && x !== c.e; x = x.nextSibling) {
    if (x.nodeType !== 8) continue;
    const d = x.data;
    if (d === open.data || (close === '/b' && (d === 'b' || d === 'b!'))) depth++;
    else if (d === close) {
      if (depth === 0) return [open, x];
      depth--;
    }
  }
  return null;
}

function removeRegion(open, close) {
  for (let x = open; ;) {
    const next = x.nextSibling;
    x.remove();
    if (x === close) return;
    x = next;
  }
}

// ---- Text ----

// HTML reads \r\n and \r as \n, and drops NUL: a text compares as the
// browser keeps it (React's normalizeMarkupForTextOrAttribute).
function normal(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\u0000|�/g, '');
}

function sameText(a, b) {
  return a === b || normal(a) === normal(b);
}

function textNode(v, dom, text) {
  return { kind: KIND_TEXT, vnode: v, key: null, dom, id: 0, list: null, text };
}

function claimText(c, v, text, owner) {
  // The server writes nothing for an empty text: it is made, as a client render makes it.
  if (text === '') return placeText(c, v, text);
  let n = at(c);
  if (n !== null && n.nodeType !== 3) {
    // A node the client does not render, before the text it does.
    const next = after(c, n);
    if (next !== null && next.nodeType === 3 && next.data.startsWith(text)) {
      report(c, 'extra-nodes', 'nothing', describe(n), n, owner);
      n.remove();
      c.n = next;
      n = next;
    }
  }
  if (n === null || n.nodeType !== 3) {
    report(c, n === null ? 'missing' : n.nodeType === 8 ? 'marker' : 'tag', JSON.stringify(short(text)), describe(n), n || c.p, owner);
    return placeText(c, v, text);
  }
  const data = n.data;
  if (sameText(data, text)) {
    c.n = n.nextSibling;
    return textNode(v, n, text);
  }
  // The parser read this text and the next one as one node: the server wrote
  // no separator between them (a plain renderToString). It is split there.
  if (data.length > text.length && data.startsWith(text)) {
    c.n = n.splitText(text.length);
    return textNode(v, n, text);
  }
  if (!c.s) {
    report(c, 'text', JSON.stringify(short(text)), describe(n), n, owner);
    n.data = text;
  }
  c.n = n.nextSibling;
  return textNode(v, n, text);
}

function placeText(c, v, text) {
  const dom = document.createTextNode(text);
  c.p.insertBefore(dom, c.n);
  return textNode(v, dom, text);
}

// ---- Elements ----

// Whether the server node `n` is the client's element `tag`.
function isElement(n, tag, svg) {
  if (n === null || n.nodeType !== 1 || (n.namespaceURI === SVG_NS) !== svg) return false;
  return n.localName === tag || (!svg && n.localName === tag.toLowerCase());
}

const NOT_ATTRIBUTES = new Set(['children', 'key', 'ref', 'suppressHydrationWarning', 'suppressContentEditableWarning', 'dangerouslySetInnerHTML', 'autoFocus']);
// The props a field's state is in, written as React writes them while it hydrates (claimField).
const FIELD_STATE = new Set(['value', 'checked', 'defaultValue', 'defaultChecked']);

function claimElement(c, v, svg, owner) {
  const tag = v.tag;
  const isSvg = svg === true || tag === 'svg';
  let el = at(c);
  if (!isElement(el, tag, isSvg)) {
    const next = el === null ? null : after(c, el);
    if (el !== null && isElement(next, tag, isSvg)) {
      // A node the client does not render, before the element it does.
      report(c, 'extra-nodes', 'nothing', describe(el), el, owner);
      el.remove();
      c.n = next;
      el = next;
    } else {
      return replace(c, v, svg, owner, el);
    }
  }
  c.n = el.nextSibling;

  const props = v.props || NO_PROPS;
  const suppress = props.suppressHydrationWarning === true;
  const childSvg = isSvg && tag !== 'foreignObject';
  const field = !isSvg && (tag === 'input' || tag === 'textarea' || tag === 'select');
  claimAttributes(c, el, tag, props, isSvg, field, suppress, owner);

  const rn = {
    kind: KIND_ELEMENT, vnode: v, key: v.key ?? null, dom: el, id: 0, list: null,
    children: NO_RNODES, ref: props.ref || null,
    /** @type {string | null} */
    text: null,
  };

  const raw = v.children !== undefined ? v.children : props.children;
  if (props.dangerouslySetInnerHTML != null) {
    // The server's content stands: raw HTML is the server's (React compares
    // it in development only).
  } else if (tag === 'noscript') {
    // To the browser the server's content is text, which stays; React
    // hydrates none of it. Its children are built off the page, so a later
    // render patches them there instead of mounting them.
    const kids = flatten(raw);
    if (kids.length > 0) rn.children = built(() => mountChildren(null, kids, flatIds, flatLists, 0, kids.length, new Array(kids.length), null, false, owner, rn));
  } else if (tag === 'textarea' && !isSvg && (raw == null || onlyText(raw) !== null || (Array.isArray(raw) && raw.length === 0))) {
    // Its children were its default value (claimField).
    rn.children = TEXTAREA_KIDS;
  } else {
    const text = onlyText(raw);
    if (text !== null) {
      rn.text = text;
      // React compares an element's text content: markup that shows the
      // same text passes.
      if (!sameText(el.textContent, text) && !suppress) {
        report(c, 'text', JSON.stringify(short(text)), describe(el.firstChild), el.firstChild || el, owner);
        setText(el, text);
      }
    } else {
      const kids = flatten(raw);
      const ids = flatIds;
      const lists = flatLists;
      enter(el, el.firstChild, null, suppress, c.r);
      try {
        if (kids.length > 0) rn.children = mountChildren(el, kids, ids, lists, 0, kids.length, new Array(kids.length), null, childSvg, owner, rn);
        finish(cur, tag, owner);
      } finally {
        leave();
      }
    }
  }

  if (field) claimField(c, el, tag, props, suppress, owner);
  if (rn.ref) refQueue.push({ rn, ref: rn.ref, el });
  return rn;
}

const NO_PROPS = {};

// The client's element in place of the server's node `found` (another tag, a
// text, a marker, or nothing), built as a client render builds it.
function replace(c, v, svg, owner, found) {
  const kind = found === null ? 'missing' : found.nodeType === 8 ? 'marker' : found.nodeType === 3 ? 'text' : 'tag';
  report(c, kind, `<${v.tag}>`, describe(found), found || c.p, owner);
  const rn = built(() => mountRNode(v, KIND_ELEMENT, null, null, svg, owner, null));
  if (found !== null && (found.nodeType === 1 || found.nodeType === 3)) {
    c.n = found.nextSibling;
    c.p.replaceChild(rn.dom, found);
  } else {
    c.p.insertBefore(rn.dom, c.n);
  }
  return rn;
}

// The nodes left in the cursor's region once the client's have claimed
// theirs are the server's only: reported, and removed (a form and a button
// keep them, as React keeps them).
function finish(c, tag, owner) {
  const n = at(c);
  if (n === null || tag === 'form' || tag === 'button') return;
  report(c, 'extra-nodes', 'nothing', describe(n), n, owner);
  for (let x = n; x !== null && x !== c.e;) {
    const next = x.nextSibling;
    x.remove();
    x = next;
  }
  c.n = c.e;
}

// ---- Attributes ----

// The attribute a prop writes.
function attrName(name, svg) {
  if (name === 'className' || name === 'class') return 'class';
  if (name === 'htmlFor') return 'for';
  if (svg) return name === 'xlinkHref' ? 'xlink:href' : SVG_ATTR_MAP[name] || name;
  return RENAMED[name] || name;
}

// Whether the server's attribute for `name` is what the client's prop writes
// (runtime.js setProperty).
function attrMatches(el, name, value, svg) {
  const current = el.getAttribute(attrName(name, svg));
  if (name === 'style') {
    const want = value == null ? '' : typeof value === 'object' ? styleText(value) : String(value);
    return (current ?? '') === want;
  }
  if (name === 'className' || name === 'class') return (current ?? '') === (value == null || value === false ? '' : String(value));
  if (value == null) return current === null;
  const aria = name.startsWith('data-') || name.startsWith('aria-');
  if (aria) return current === String(value);
  // A property the element reads as a boolean (disabled, hidden, draggable):
  // the client writes the property.
  if (!svg && name !== 'value' && name in el && typeof el[name] === 'boolean') return el[name] === !!value;
  if (value === true) return current !== null;
  if (value === false) return current === null;
  return current === String(value);
}

// Every prop of the claimed element `el` as a client render writes it, where
// the server's attribute is not already that: handlers attached, refs and the
// field state left to the caller, a differing attribute reported and written,
// a server attribute no prop writes reported and removed.
function claimAttributes(c, el, tag, props, svg, field, suppress, owner) {
  const custom = !svg && tag.includes('-');
  for (const name in props) {
    if (NOT_ATTRIBUTES.has(name)) continue;
    const value = props[name];
    if (field && FIELD_STATE.has(name)) continue;
    if ((name[0] === 'o' && name[1] === 'n' && name.length > 2) || ((name === 'action' || name === 'formAction') && typeof value === 'function')) {
      setProperty(el, name, value, undefined, svg);
      continue;
    }
    if (typeof value === 'function' || typeof value === 'symbol') continue;
    if (name === 'selected' && tag === 'option') {
      // Its select keeps the option the server or the user selected.
      el._compatSelected = value === true;
      continue;
    }
    // A property with no attribute of its own (a custom element's, a
    // checkbox's indeterminate): written when it differs, as a client render writes it.
    if ((custom && name in el) || name === 'indeterminate') {
      if (el[name] !== value) setProperty(el, name, value, undefined, svg);
      continue;
    }
    if (attrMatches(el, name, value, svg)) continue;
    if (!suppress) {
      const attr = attrName(name, svg);
      report(c, 'attribute', value == null ? `no ${attr}` : `${attr}="${short(String(name === 'style' && typeof value === 'object' ? styleText(value) : value))}"`, describeAttr(el, attr), el, owner);
      if (value == null) el.removeAttribute(attr);
      else {
        if (name === 'style') el.removeAttribute('style');
        setProperty(el, name, value, undefined, svg);
      }
    }
  }
  // The server's attributes that no prop writes.
  if (!suppress && el.hasAttributes()) {
    for (const attr of el.getAttributeNames()) {
      // The server marks the option its select's value chose (React's too).
      if (rendersAttr(props, attr, svg) || (attr === 'selected' && tag === 'option')) continue;
      report(c, 'attribute', `no ${attr}`, describeAttr(el, attr), el, owner);
      el.removeAttribute(attr);
    }
  }
}

function rendersAttr(props, attr, svg) {
  const name = svg ? attr : attr.toLowerCase();
  for (const key in props) {
    if (NOT_ATTRIBUTES.has(key) && key !== 'autoFocus') continue;
    const value = props[key];
    if (value == null || typeof value === 'function' || typeof value === 'symbol') continue;
    // false writes no attribute, except data-* and aria-*, where it is the text "false".
    if (value === false && !key.startsWith('data-') && !key.startsWith('aria-')) continue;
    const written = key === 'defaultValue' ? 'value' : key === 'defaultChecked' ? 'checked' : attrName(key, svg);
    if ((svg ? written : written.toLowerCase()) === name) return true;
  }
  return false;
}

function describeAttr(el, attr) {
  const value = el.getAttribute(attr);
  return value === null ? `no ${attr}` : `${attr}="${short(value)}"`;
}

// ---- Fields ----

// A form field's state as React writes it while it hydrates (initInput,
// initTextarea): what the user typed, checked or chose before hydration stays
// (the value is not written; the field's tracker sees what it shows), and
// its default is the client's.
function claimField(c, el, tag, props, suppress, owner) {
  const value = props.value;
  if ('value' in props) el._compatValue = value;
  if (value != null) controlField(el);
  if (tag === 'select') return;
  let def = value ?? props.defaultValue;
  if (tag === 'textarea' && def == null) def = onlyText(props.children);
  if (def != null || tag === 'textarea') {
    const text = def == null ? '' : String(def);
    if (el.defaultValue !== text) {
      if (!suppress) report(c, 'attribute', tag === 'textarea' ? JSON.stringify(short(text)) : `value="${short(text)}"`, tag === 'textarea' ? JSON.stringify(short(el.defaultValue)) : describeAttr(el, 'value'), el, owner);
      el.defaultValue = text;
    }
  }
  if (tag === 'input') {
    const checked = props.checked;
    if ('checked' in props) el._compatChecked = checked;
    if (checked != null) controlField(el);
    const on = checked ?? props.defaultChecked;
    if (on != null && el.defaultChecked !== !!on) {
      if (!suppress) report(c, 'attribute', on ? 'checked' : 'no checked', on ? 'no checked' : 'checked', el, owner);
      // The box shows what the user left it at.
      const shown = el.checked;
      el.defaultChecked = !!on;
      el.checked = shown;
    }
  }
  trackField(el);
}

// ---- <Suspense> ----

// A <Suspense> the server rendered: its content between the markers a
// hydratable render writes (<!--[]-->…<!--/[]-->) is claimed by what the
// browser renders in it; a fallback the server wrote (in a <!--$--> region)
// is rendered afresh, as React renders such a boundary on the client.
//
// When something in the content suspends while it hydrates, the boundary
// keeps the server's HTML as it is, shows no fallback, and hydrates once the
// promise settles, as React's does: what of it had rendered is let go
// (dehydrate), and the server's nodes stand for it until then. Should it
// render again on the client before that (new props), they go, and it
// renders as any boundary does.
function claimSuspense(c, v, svg, owner, into) {
  const region = regionAt(c);
  if (region === null) return null;
  const [open, close] = region;
  if (open.data === '$') {
    c.n = close.nextSibling;
    removeRegion(open, close);
    return built(() => mountComponent(v, c.p, c.n, svg, owner, into));
  }
  if (open.data !== '[]') return null;
  const boundary = { open, close, inst: null, dead: false, waiting: false, s: c.s, session };
  enter(c.p, open.nextSibling, close, c.s, boundary);
  try {
    const rn = mountComponent(v, c.p, close, svg, owner, into);
    if (boundary.dead) dehydrate(boundary, rn.inst);
    else finish(cur, '', owner);
    return rn;
  } finally {
    leave();
    c.n = close.nextSibling;
  }
}

// runtime.js handleRenderError, while an island claims: a component under
// the boundary `inst` suspended. Taken (non-null) when that boundary is the
// one being hydrated here.
function suspended(thenable, inst) {
  const r = cur !== null ? cur.r : undefined;
  if (r === undefined || r.inst !== inst) return null;
  r.dead = true;
  if (!r.waiting) {
    r.waiting = true;
    const wake = () => rehydrate(r);
    thenable.then(wake, wake);
  }
  return r;
}

function dehydrate(boundary, inst) {
  boundary.inst = inst;
  const rendered = inst.rendered;
  for (let i = 0; i < rendered.length; i++) unmountRNode(rendered[i], false);
  // The server's nodes, as one opaque node: placed and removed as the
  // boundary's own, and replaced by what it renders next on the client.
  inst.rendered = [{ kind: KIND_OPAQUE, vnode: null, key: null, start: boundary.open, end: boundary.close, id: 0, list: null, dispose: null }];
}

// The promise a dehydrated boundary waited for settled: it renders over the
// server's nodes, between their markers, as an island does.
function rehydrate(boundary) {
  const inst = boundary.inst;
  if (inst === null || inst.unmounted || boundary.close.parentNode === null) return;
  const rendered = inst.rendered;
  if (rendered.length !== 1 || rendered[0].start !== boundary.open) return; // it rendered on the client since
  boundary.dead = false;
  boundary.waiting = false;
  const saved = session;
  const savedCur = cur;
  const depth = outer.length;
  session = boundary.session;
  cur = { p: boundary.close.parentNode, n: boundary.open.nextSibling, e: boundary.close, s: boundary.s, r: boundary };
  inst.rendered = NO_RNODES;
  inst.start = boundary.open;
  inst.end = boundary.close;
  const claiming = claim;
  runInCommit(() => {
    _setClaim(claimNode);
    try {
      renderInstance(inst);
      if (boundary.dead) dehydrate(boundary, inst);
      else finish(cur, '', inst);
    } finally {
      _setClaim(claiming);
      inst.start = null;
      inst.end = null;
      cur = savedCur;
      outer.length = depth;
      session = saved;
    }
  });
}

// ---- Reports ----

// One ERR_HYDRATION_MISMATCH per region (an element, or the island's own),
// with what-core's record: in development as a diagnostic, in every build to
// hydrate()'s onHydrationError.
function report(c, kind, expected, found, node, owner) {
  const s = session;
  const region = c.e !== null ? c.e : c.p;
  if (s.reported.has(region)) return;
  s.reported.add(region);
  if (!__DEV__ && s.onError === null) return;
  const info = { kind, component: componentName(owner), ownerPath: s.ownerPath, path: domPath(node), expected, found, recovery: 'client-render' };
  if (__DEV__) {
    reportDiagnostic('ERR_HYDRATION_MISMATCH', {
      data: info,
      subject: { kind: 'hydration', id: `${info.ownerPath ?? 'root'}|${info.path}|${kind}`, name: info.component },
    });
  }
  if (s.onError !== null) s.onError(info);
}

function componentName(inst) {
  for (let p = inst; p != null; p = p.parent) {
    if (p._ids !== undefined) break;
    const type = p.type;
    const name = type && (type.displayName || type.name);
    if (name) return name;
  }
  return 'ReactIsland';
}

function describe(node) {
  if (node == null) return 'nothing';
  if (node.nodeType === 3) return JSON.stringify(short(node.data));
  if (node.nodeType === 8) return `<!--${short(node.data)}-->`;
  if (node.nodeType !== 1) return node.nodeName;
  let open = '<' + node.localName;
  const id = node.getAttribute('id');
  const cls = node.getAttribute('class');
  if (id) open += ` id="${short(id)}"`;
  if (cls) open += ` class="${short(cls)}"`;
  return open + '>';
}

function short(text) {
  return text.length > 40 ? text.slice(0, 37) + '...' : text;
}

// The node's place in the page: `main>ul>li[1]` (an index counts the earlier
// siblings with the same tag).
function domPath(node) {
  const parts = [];
  for (let n = node; n != null && n.nodeType !== 9 && n !== document.body; n = n.parentNode) {
    if (n.nodeType !== 1) {
      parts.push(n.nodeType === 3 ? '#text' : '#comment');
      continue;
    }
    let index = 0;
    for (let s = n.previousElementSibling; s !== null; s = s.previousElementSibling) {
      if (s.localName === n.localName) index++;
    }
    parts.push(index ? `${n.localName}[${index}]` : n.localName);
  }
  return parts.reverse().join('>');
}
