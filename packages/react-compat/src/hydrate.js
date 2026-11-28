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
import { _$createComponent, _$hcreateComponent, _hydrateRange } from 'what-core/render';
import { Suspense } from './index.js';
import { _islandIds } from './hooks.js';
import { idsOf, islandId, boundaryIds, apart, idsMark, idsBack, styleText, attrOf, attrName } from './markup.js';
import {
  KIND_TEXT, KIND_ELEMENT, KIND_COMPONENT, KIND_OPAQUE, KIND_PORTAL, NO_RNODES, TEXTAREA_KIDS, SVG_NS, MATH_NS, MATH, _inert,
  claim, _setClaim, _setAdopter, _setNativeBuilder, mountRNode, mountComponent, mountPortal, mountChildren, flatten, flatIds, flatLists,
  onlyText, setText, setProperty, trackField, controlField, insertionQueue, layoutQueue, passiveQueue, formActionRunner,
  runInCommit, renderInstance, unmountRNode,
} from './runtime.js';

// The onHydrationError hook of the hydrate() walking now (what-core
// render.js): what a hydration that runs after the walk reports to. Not in
// what-core's declarations.
const hydrationErrorHook = /** @type {{ _hydrationErrorHook: () => ((info: object) => void) | null }} */ (/** @type {unknown} */ (coreRender))._hydrationErrorHook;
// A hydration walk over a range of the server's nodes (render.js
// _hydrateRange): a native component inside an island hydrates in its bracket.
/** @type {((open: Comment, close: Comment, fn: () => unknown, onError?: any) => unknown) | null} */
const hydrateRange = _hydrateRange;

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
    replaySubmits();
  };
}

// ---- A form submitted before hydration ----
// What the server's capture script kept (server.js FORM_GUARD): each submit
// whose form (or submitter) has its function action now runs it with the
// data it was submitted with, as React replays it; the others wait for their
// island (or <Suspense>) to hydrate.
function replaySubmits() {
  const queue = typeof document !== 'undefined' ? /** @type {any} */ (document).$$whatForms : undefined;
  if (!Array.isArray(queue) || queue.length === 0 || formActionRunner === null) return;
  for (let i = 0; i < queue.length;) {
    const form = queue[i];
    const submitter = queue[i + 1];
    const action = submitter && typeof submitter._compatAction === 'function' ? submitter._compatAction : form._compatAction;
    if (typeof action !== 'function' || !form.isConnected) {
      i += 3;
      continue;
    }
    const data = queue[i + 2];
    queue.splice(i, 3);
    formActionRunner(form, action, data);
  }
}

// ---- The cursor ----
// Where the claim stands: the element it claims in (p), the next server node
// (n; null at the element's end), where its region ends (e: the island's or
// a <Suspense>'s closing marker, else null), whether the element said
// suppressHydrationWarning (s), the <Suspense> being hydrated around it
// (r: see claimSuspense), whether what the client renders there differs
// from the server's in structure (d: see differs), and its reports (q).
/** @type {{ p: any, n: any, e: any, s: boolean, r: any, d: boolean, q: any[] | null } | null} */
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
  session = { onError, reported: new WeakMap(), ownerPath, island: inst };
  cur = { p: end.parentNode, n: start.nextSibling, e: end, s: false, r: undefined, d: false, q: null };
  runInCommit(() => {
    const marks = queued();
    const ids = idsMark(inst);
    let thrown = NOT_THROWN;
    let differed = false;
    _setClaim(claimNode);
    try {
      renderInstance(inst);
      const top = /** @type {NonNullable<typeof cur>} */ (cur);
      finish(top, '');
      differed = top.d;
      send(top);
    } catch (error) {
      thrown = error;
    } finally {
      _setClaim(claiming);
      cur = savedCur;
      outer.length = depth;
      session = saved;
    }
    if (thrown !== NOT_THROWN) recoverIsland(inst, start, end, thrown, marks, onError, ownerPath);
    else if (differed) renderAgain(inst, start, end, marks, ids);
  });
}

// ---- An island that throws while it hydrates ----
// One island's error stays in that island: the walk, the other islands and
// the native page hydrate as if it were not there. What its render did to
// the server's HTML goes, with every ref and effect the render queued (none
// runs), and it renders again in the browser, as React renders a root again
// when hydrating it threw. Should that throw too, the island is left empty,
// as React unmounts a root whose render throws: the server's HTML of a
// component that cannot render in the browser would look live and do
// nothing. Either way the error is reported (console.error in every build,
// as React's reportError, and hydrate()'s onHydrationError with kind
// `error`). An error boundary above it (in a React tree around the island)
// catches it first, as always.

const NOT_THROWN = {};

// How long each effect queue of the commit is now.
function queued() {
  return [insertionQueue.length, layoutQueue.length, passiveQueue.length];
}

// What a render that threw queued after `marks` never runs.
function drop(marks) {
  insertionQueue.length = marks[0];
  layoutQueue.length = marks[1];
  passiveQueue.length = marks[2];
}

// The island `inst` (or a <Suspense> it hydrates) holds nothing: what it
// rendered unmounts, and the nodes between its markers go.
function empty(inst, start, end) {
  const rendered = inst.rendered;
  inst.rendered = NO_RNODES;
  for (let i = 0; i < rendered.length; i++) unmountRNode(rendered[i], false);
  for (let x = start.nextSibling; x !== null && x !== end;) {
    const next = x.nextSibling;
    x.remove();
    x = next;
  }
}

function recoverIsland(inst, start, end, error, marks, onError, ownerPath) {
  drop(marks);
  empty(inst, start, end);
  let recovered = true;
  if (!inst.unmounted) {
    try {
      // A client render: what it reads is the browser's (useSyncExternalStore's own snapshot).
      withClaim(null, () => renderInstance(inst));
    } catch (again) {
      drop(marks);
      empty(inst, start, end);
      error = again;
      recovered = false;
    }
  }
  thrownWhileHydrating(error, recovered, onError, ownerPath, end);
}

function thrownWhileHydrating(error, recovered, onError, ownerPath, at) {
  console.error(`[what-react] A React island threw while it hydrated, so ${recovered ? 'it was rendered again in the browser' : 'it renders nothing'}:`, error);
  if (onError !== null) {
    onError({
      kind: 'error', component: 'ReactIsland', ownerPath, path: domPath(at.parentNode),
      expected: 'a render', found: String(error && error.message !== undefined ? error.message : error),
      recovery: recovered ? 'client-render' : 'none', error,
    });
  }
}

// Run `fn` (a mount) claiming nothing: what it builds is new. It is still
// part of the island's hydrating render (fresh): useSyncExternalStore reads
// the server snapshot in it as in what is claimed around it, so the two
// agree in one commit.
function built(fn) {
  return withClaim(fresh, fn);
}

function withClaim(fn, mount) {
  const claiming = claim;
  _setClaim(fn);
  try {
    return mount();
  } finally {
    _setClaim(claiming);
  }
}

// runtime.js mountRNode while a hydrating island builds something new: null
// (mounted as always), except for what names ids. A <Suspense> takes its id
// as it does where it is claimed (claimSuspense), and a portal's content is
// numbered apart (server.js useId).
function fresh(v, kind, parentDom, before, svg, owner, into) {
  if (kind === KIND_PORTAL) return apart(owner, 'P', () => mountPortal(v, parentDom, before, owner, into));
  if (kind !== KIND_COMPONENT || (/** @type {any} */ (v.tag)._compatType || v.tag) !== Suspense) return null;
  const rn = mountComponent(v, parentDom, before, svg, owner, into);
  boundaryIds(rn.inst);
  return rn;
}

function enter(p, n, e, s, r) {
  outer.push(cur);
  cur = { p, n, e, s, r, d: false, q: null };
}

function leave() {
  const inner = cur;
  cur = outer.pop();
  pass(inner, cur);
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
  // The rest of a region whose structure differs: built off the page, and
  // rendered again with the whole region (differs).
  if (c.d) return built(() => mountRNode(v, kind, null, null, svg, owner, into));
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
      return built(() => fresh(v, kind, parentDom, c.n, svg, owner, into));
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
  // No bracket: the server rendered something else here (differs).
  if (region === null) differs(c, 'marker', 'native What content', describe(c.n === c.e ? null : c.n), c.n || c.p, owner);
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
  const n = at(c);
  if (n === null || n.nodeType !== 3) {
    // A node the client does not render where it renders a text (before
    // the text: extra-nodes), or none.
    const next = n === null ? null : past(n.nextSibling, c);
    const kind = n === null ? 'missing' : next !== null && next.nodeType === 3 && next.data.startsWith(text) ? 'extra-nodes' : n.nodeType === 8 ? 'marker' : 'tag';
    differs(c, kind, kind === 'extra-nodes' ? 'nothing' : JSON.stringify(short(text)), describe(n), n || c.p, owner);
    return textNode(v, document.createTextNode(text), text);
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

const HTML_NS = 'http://www.w3.org/1999/xhtml';

// Whether the server node `n` is the client's element `tag`, in the
// namespace `ns` (the HTML parser put it in the one it is in).
function isElement(n, tag, ns) {
  if (n === null || n.nodeType !== 1 || n.namespaceURI !== ns) return false;
  return n.localName === tag || (ns === HTML_NS && n.localName === tag.toLowerCase());
}

const NOT_ATTRIBUTES = new Set(['children', 'key', 'ref', 'suppressHydrationWarning', 'suppressContentEditableWarning', 'dangerouslySetInnerHTML', 'autoFocus']);
// The props a field's state is in, written as React writes them while it hydrates (claimField).
const FIELD_STATE = new Set(['value', 'checked', 'defaultValue', 'defaultChecked']);

function claimElement(c, v, svg, owner) {
  const tag = v.tag;
  // Its namespace, as the client creates it (runtime.js mountElement).
  const isSvg = svg === true || (svg !== MATH && tag === 'svg');
  const isMath = !isSvg && (svg === MATH || tag === 'math');
  const ns = isSvg ? SVG_NS : isMath ? MATH_NS : HTML_NS;
  const el = at(c);
  if (!isElement(el, tag, ns)) {
    // Another node (another tag, a text, a marker; before the element:
    // extra-nodes), or none.
    const kind = el === null ? 'missing' : isElement(past(el.nextSibling, c), tag, ns) ? 'extra-nodes' : el.nodeType === 8 ? 'marker' : el.nodeType === 3 ? 'text' : 'tag';
    differs(c, kind, kind === 'extra-nodes' ? 'nothing' : `<${v.tag}>`, describe(el), el || c.p, owner);
    return built(() => mountRNode(v, KIND_ELEMENT, null, null, svg, owner, null));
  }
  c.n = el.nextSibling;

  const props = v.props || NO_PROPS;
  const suppress = props.suppressHydrationWarning === true;
  const childSvg = isSvg ? tag !== 'foreignObject' : isMath ? MATH : false;
  const field = ns === HTML_NS && (tag === 'input' || tag === 'textarea' || tag === 'select');
  claimAttributes(c, el, tag, props, isSvg, field, suppress, owner);

  const rn = {
    kind: KIND_ELEMENT, vnode: v, key: v.key ?? null, dom: el, id: 0, list: null,
    children: NO_RNODES, ref: props.ref || null,
    /** @type {string | null} */
    text: null,
  };

  const raw = v.children !== undefined ? v.children : props.children;
  // The HTML parser puts what a <template> holds in its content fragment,
  // which a client render leaves empty: its children are the element's own
  // (runtime.js mountElement, as React DOM appends them). The server's
  // content goes, and the children are rendered as a client render renders
  // them; React renders the root again there. Raw HTML is the content's in
  // both (an innerHTML write fills it), and stays.
  if (tag === 'template' && ns === HTML_NS && props.dangerouslySetInnerHTML == null && el.content != null) el.content.textContent = '';
  if (props.dangerouslySetInnerHTML != null) {
    // The server's content stands: raw HTML is the server's. In development
    // one that differs is reported, as React warns (it compares the HTML as
    // the browser reads it).
    if (__DEV__ && !suppress) {
      const html = props.dangerouslySetInnerHTML.__html;
      const want = html == null ? '' : readAs(el, String(html));
      if (el.innerHTML !== want) report(c, 'attribute', `innerHTML ${JSON.stringify(short(want))}`, `innerHTML ${JSON.stringify(short(el.innerHTML))}`, el, owner, 'none');
    }
  } else if (tag === 'noscript') {
    // To the browser the server's content is text, which stays. What it
    // holds is not rendered in the browser at all, as in React (runtime.js
    // mountElement): no component in it renders or runs an effect.
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
      const marks = queued();
      const idMark = idsMark(owner);
      let differed = false;
      enter(el, el.firstChild, null, suppress, c.r);
      try {
        if (kids.length > 0) rn.children = mountChildren(el, kids, ids, lists, 0, kids.length, new Array(kids.length), null, childSvg, owner, rn);
        const inner = /** @type {NonNullable<typeof cur>} */ (cur);
        finish(inner, tag, owner);
        differed = inner.d;
      } finally {
        leave();
      }
      if (differed) {
        // Its children differ from the server's in structure: rendered again
        // by the client, all of them (differs).
        forget(rn.children, marks, idMark);
        el.textContent = '';
        rn.children = built(() => mountChildren(el, kids, ids, lists, 0, kids.length, new Array(kids.length), null, childSvg, owner, rn));
      }
    }
  }

  if (field) claimField(c, el, tag, props, suppress, owner);
  if (rn.ref) layoutQueue.push({ rn, ref: rn.ref, el, inst: owner });
  return rn;
}

const NO_PROPS = {};

// `html` as the browser reads it in an element like `el`.
function readAs(el, html) {
  const probe = el.namespaceURI !== HTML_NS ? document.createElementNS(el.namespaceURI, el.localName) : document.createElement(el.localName);
  probe.innerHTML = html;
  return probe.innerHTML;
}

// ---- Structure ----
// Where what the client renders in an element (or at the top of an island or
// a <Suspense>) differs from the server's in structure (a node the client
// does not render, one the server did not, another tag), nothing of that
// region is mended by position: one report, the rest of it is built off the
// page, and once it has rendered, the client renders all of it again in
// place of the server's nodes (claimElement, renderAgain), as React renders
// a boundary again. So no node's state (typed text, focus, a scroll
// position, an open <details>, a playing video) ends up in another item's
// node. A text or an attribute that differs is mended where it is.

function differs(c, kind, expected, found, node, owner) {
  if (c.d) return;
  c.d = true;
  // What this region reported so far is about nodes that go.
  c.q = null;
  report(c, kind, expected, found, node, owner);
}

// What a render that is rendered again did goes: its rendered nodes unmount,
// no ref or effect it queued runs, and the ids it took are given again.
function forget(rendered, marks, idMark) {
  drop(marks);
  for (let i = 0; i < rendered.length; i++) unmountRNode(rendered[i], false);
  idsBack(idMark);
}

// An island, or a <Suspense> it hydrates (start and end: its markers), whose
// structure differs at its top: rendered again by the client between its
// markers, still as part of the hydrating render (built).
function renderAgain(inst, start, end, marks, idMark) {
  const rendered = inst.rendered;
  inst.rendered = NO_RNODES;
  forget(rendered, marks, idMark);
  empty(inst, start, end);
  const own = inst.start;
  inst.start = start;
  inst.end = end;
  built(() => renderInstance(inst));
  if (own === null) inst.start = inst.end = null;
}

// The nodes left in the cursor's region once the client's have claimed
// theirs are the server's only: a difference in structure (a form and a
// button keep them, unreported, as React keeps them).
function finish(c, tag, owner) {
  const n = at(c);
  if (n === null || tag === 'form' || tag === 'button') return;
  differs(c, 'extra-nodes', 'nothing', describe(n), n, owner);
}

// ---- Attributes ----

// Whether the server's attribute for the prop `name` is what the server
// writes for the client's value (server.js attrOf: both sides render the same
// props, so the same attributes).
function attrMatches(el, tag, name, value, svg) {
  if (name === 'style') {
    const want = value == null ? '' : typeof value === 'object' ? styleText(value) : String(value);
    return (el.getAttribute('style') ?? '') === want;
  }
  const want = attrOf(name, value, tag, svg);
  const current = el.getAttribute(want !== null ? want[0] : attrName(name, svg));
  if (want === null) return current === null;
  return want[1] === true ? current !== null : current === want[1];
}

// Every prop of the claimed element `el` as a client render writes it, where
// the server's attribute is not already that: handlers attached, refs and the
// field state left to the caller, a differing attribute reported and written.
// A server attribute no prop writes (one an extension added: data-gramm, a
// password manager's autocomplete) is reported and kept, as React keeps it.
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
    if (attrMatches(el, tag, name, value, svg)) continue;
    if (!suppress) {
      const want = name === 'style' ? null : attrOf(name, value, tag, svg);
      const attr = want !== null ? want[0] : attrName(name, svg);
      const text = name === 'style' ? (typeof value === 'object' && value !== null ? styleText(value) : String(value ?? '')) : want === null ? null : want[1] === true ? '' : want[1];
      report(c, 'attribute', text === null ? `no ${attr}` : `${attr}="${short(text)}"`, describeAttr(el, attr), el, owner);
      if (value == null) el.removeAttribute(attr);
      else {
        if (name === 'style') el.removeAttribute('style');
        setProperty(el, name, value, undefined, svg);
        // An enumerated one (spellCheck={false}) is its text, as React writes it.
        if (want !== null && typeof want[1] === 'string' && el.getAttribute(attr) !== want[1]) el.setAttribute(attr, want[1]);
      }
    }
  }
  // The server's attributes that no prop writes: kept.
  if (!suppress && el.hasAttributes()) {
    const written = writtenAttrs(props, tag, svg);
    for (const attr of el.getAttributeNames()) {
      // The server marks the option its select's value chose (React's too).
      if (written.has(svg ? attr : attr.toLowerCase()) || (attr === 'selected' && tag === 'option')) continue;
      report(c, 'attribute', `no ${attr}`, describeAttr(el, attr), el, owner, 'none');
    }
  }
}

// The attributes the server writes for `props` (lower case for HTML).
function writtenAttrs(props, tag, svg) {
  const out = new Set();
  for (const key in props) {
    const value = props[key];
    if (value == null || (NOT_ATTRIBUTES.has(key) && key !== 'autoFocus')) continue;
    /** @type {string | null} */
    let name = null;
    if (key === 'style') name = typeof value === 'object' && styleText(value) === '' ? null : 'style';
    else if (key === 'value' || key === 'defaultValue') name = typeof value === 'function' ? null : 'value';
    else if (key === 'checked' || key === 'defaultChecked') name = value ? 'checked' : null;
    else {
      const attr = attrOf(key, value, tag, svg);
      if (attr !== null) name = attr[0];
    }
    if (name !== null) out.add(svg ? name : name.toLowerCase());
  }
  return out;
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
  if (tag === 'select') {
    el._compatField = true;
    return;
  }
  let def = value ?? props.defaultValue;
  if (tag === 'textarea') {
    if (def == null) def = onlyText(props.children);
    // A controlled one shows its value, as React's does once it hydrates;
    // an uncontrolled one keeps what the user typed (React puts its default
    // back).
    else if (value != null && el.value !== String(value)) el.value = String(value);
  }
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
    return built(() => fresh(v, KIND_COMPONENT, c.p, c.n, svg, owner, into));
  }
  if (open.data !== '[]') return null;
  const boundary = { open, close, inst: null, dead: false, waiting: false, s: c.s, session };
  const marks = queued();
  enter(c.p, open.nextSibling, close, c.s, boundary);
  let rn;
  let differed = false;
  try {
    rn = mountComponent(v, c.p, close, svg, owner, into);
    // It names its ids as the server's did, whatever its content did (server.js useId).
    boundaryIds(rn.inst);
    if (boundary.dead) dehydrate(boundary, rn.inst, marks);
    else {
      const inner = /** @type {NonNullable<typeof cur>} */ (cur);
      finish(inner, '', owner);
      differed = inner.d;
    }
  } finally {
    leave();
    c.n = close.nextSibling;
  }
  if (differed) renderAgain(rn.inst, open, close, marks, idsMark(rn.inst, 0));
  return rn;
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

// What the content rendered before it suspended was not committed, as in
// React: none of its refs, effects or focus (queued after `marks`) runs, and
// the server's elements it claimed keep no React handler, controlled field
// or form action (runtime.js _inert) until the boundary hydrates.
function dehydrate(boundary, inst, marks) {
  boundary.inst = inst;
  drop(marks);
  const rendered = inst.rendered;
  for (let i = 0; i < rendered.length; i++) unmountRNode(rendered[i], false);
  for (let x = boundary.open.nextSibling; x !== null && x !== boundary.close; x = x.nextSibling) {
    if (x.nodeType !== 1) continue;
    _inert(x);
    for (const el of x.querySelectorAll('*')) _inert(el);
  }
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
  cur = { p: boundary.close.parentNode, n: boundary.open.nextSibling, e: boundary.close, s: boundary.s, r: boundary, d: false, q: null };
  inst.rendered = NO_RNODES;
  inst.start = boundary.open;
  inst.end = boundary.close;
  // Its content numbers its ids from the start again, as the server's did:
  // what of it rendered before it suspended has gone (dehydrate).
  if (inst._ids) inst._ids.n = 0;
  const claiming = claim;
  runInCommit(() => {
    const marks = queued();
    let thrown = NOT_THROWN;
    _setClaim(claimNode);
    let differed = false;
    const top = /** @type {NonNullable<typeof cur>} */ (cur);
    try {
      renderInstance(inst);
      if (boundary.dead) dehydrate(boundary, inst, marks);
      else {
        finish(top, '', inst);
        differed = top.d;
      }
      send(top);
    } catch (error) {
      thrown = error;
    } finally {
      _setClaim(claiming);
      cur = savedCur;
      outer.length = depth;
      session = saved;
    }
    // It threw (no error boundary above took it): rendered again in the
    // browser between its markers, as an island is (recoverIsland).
    if (thrown !== NOT_THROWN) recoverIsland(inst, boundary.open, boundary.close, thrown, marks, boundary.session.onError, boundary.session.ownerPath);
    else if (differed) renderAgain(inst, boundary.open, boundary.close, marks, idsMark(inst, 0));
    inst.start = null;
    inst.end = null;
  });
  replaySubmits();
}

// ---- Reports ----

// One ERR_HYDRATION_MISMATCH per element and kind (an element's attributes,
// its text, its children's structure), with what-core's record: in
// development as a diagnostic, in every build to hydrate()'s
// onHydrationError. A report waits in its region's cursor until the island's
// claim is done (send): what was reported inside a region whose children
// are rendered again is the attempt's, and goes with it (differs).
function report(c, kind, expected, found, node, owner, recovery = 'client-render') {
  const s = session;
  if (!__DEV__ && s.onError === null) return;
  // The element it is about: an attribute's or a text's own, else the region's.
  const at = kind === 'attribute' ? node : kind === 'text' ? (node.nodeType === 1 ? node : node.parentNode) : c.e !== null ? c.e : c.p;
  const kinds = s.reported.get(at);
  if (kinds !== undefined && kinds.includes(kind)) return;
  s.reported.set(at, kinds === undefined ? [kind] : kinds.concat(kind));
  const info = { kind, component: componentName(owner, s.island), ownerPath: s.ownerPath, path: domPath(node), expected, found, recovery };
  (c.q || (c.q = [])).push(info);
}

// A region's reports go to the one around it as its claim ends (leave).
function pass(inner, c) {
  if (inner.q !== null) {
    if (c.q === null) c.q = inner.q;
    else c.q.push(...inner.q);
  }
}

// The island's claim is done: what it reported goes out.
function send(c) {
  const list = c.q;
  c.q = null;
  if (list === null) return;
  const s = session;
  for (const info of list) {
    if (__DEV__) {
      reportDiagnostic('ERR_HYDRATION_MISMATCH', {
        data: info,
        subject: { kind: 'hydration', id: `${info.ownerPath ?? 'root'}|${info.path}|${info.kind}`, name: info.component },
      });
    }
    if (s.onError !== null) s.onError(info);
  }
}

function componentName(inst, island) {
  for (let p = inst; p != null; p = p.parent) {
    if (p === island) break;
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
