// The hydration data channel: what the server rendered with, read back by the
// client so it can hydrate without fetching anything again.
//
// One format, one reader. A buffered page carries a single element
//
//   <script id="__what_data" type="application/json">PAYLOAD</script>
//
// and a streamed page carries that element in its shell plus one
//
//   <script type="application/json" data-what-data>PAYLOAD</script>
//
// per streamed boundary, sent before the boundary's content is swapped in.
// Every element is serialized with what-server's serializeState, so it is
// script-safe JSON that a strict CSP does not block and an agent can read.
// Only <script type="application/json"> elements are read: the page's own
// markup can carry any id or attribute (a heading slug, a user's profile
// anchor), but it cannot make a script element, so it cannot stand in for the
// payload. PAYLOAD holds any of:
//
//   loaderData    the page loader's result (shell only)
//   islandStores  island store snapshots
//   resources     { [key]: value } for resources created with a `key`
//   owned         { [ownerKey]: value } for keyless resources (see ownerKey)
//   owners        { [ownerPath]: componentName } for the components behind
//                 the `owned` keys
//   errors        { [key]: { message, code? } } for resources that failed
//   ownedErrors   { [ownerKey]: { message, code? } }
//   failed        { [boundaryId]: { message, code? } } for streamed boundaries
//                 the server could not render; their fallback stays and the
//                 client renders them itself
//   head          { [boundaryId]: { title?, meta?, link? } } <Head> tags a
//                 streamed boundary set after the shell (noScripts streams)
//
// Every read first merges the elements it has not seen yet, so data that
// arrives with a late boundary is found by the same lookups.

import { isHydrating, _resumeBoundary, _rowKeyDigest, _rowKeySalt, _installRowEntry } from './render.js';
import { getCurrentComponent } from './dom.js';
import { _currentComponent, _installSeedOps, _installStoreSeedOps, _serverStoreKey, __DEV__ } from './reactive.js';
import { getServerContext, isServerRender } from './server-context.js';
import { report } from './diagnostics.js';

/** @type {any} */
let _data;
/** @type {Set<Element> | null} */
let _merged = null;

const MAPS = ['resources', 'owned', 'owners', 'errors', 'ownedErrors', 'failed', 'islandStores', 'head'];

const DATA_ELEMENTS = 'script[type="application/json"]#__what_data, script[type="application/json"][data-what-data]';

// Only scan() calls this, once it has created _merged.
function mergeElement(el) {
  /** @type {Set<Element>} */ (_merged).add(el);
  let payload;
  try {
    payload = JSON.parse(el.textContent);
  } catch {
    return;
  }
  if (!payload || typeof payload !== 'object') return;
  if (_data === null) _data = {};
  if ('loaderData' in payload) _data.loaderData = payload.loaderData;
  for (const name of MAPS) {
    if (payload[name]) _data[name] = Object.assign(_data[name] || {}, payload[name]);
  }
}

function scan() {
  if (typeof document === 'undefined') return;
  if (_merged === null) {
    _merged = new Set();
    _data = null;
  }
  for (const el of document.querySelectorAll(DATA_ELEMENTS)) {
    if (!_merged.has(el)) mergeElement(el);
  }
}

function isDataElement(el) {
  return el.tagName === 'SCRIPT' && el.getAttribute('type') === 'application/json'
    && (el.id === '__what_data' || el.hasAttribute('data-what-data'));
}

/** The merged payload, or null when the page carries none. */
export function __readHydrationData() {
  if (typeof document === 'undefined') return null;
  scan();
  return _data;
}

/** Test/HMR hook: forget everything read so far; the next read parses again. */
export function __resetHydrationData() {
  _data = undefined;
  _merged = null;
}

export function getLoaderData() {
  const data = __readHydrationData();
  return data ? data.loaderData : undefined;
}

function lookup(map, key) {
  const data = __readHydrationData();
  return data && data[map] && Object.hasOwn(data[map], key) ? data[map][key] : undefined;
}

export function getResource(key) {
  return lookup('resources', key);
}

/** The server's error record for a keyed resource, or undefined. */
export function getResourceError(key) {
  return lookup('errors', key);
}

// --- Owner keys ---
//
// A keyless resource is named by where it was created: the owner path of its
// component plus its position among that component's keyless resources, e.g.
// "0A10:1". Owner paths name a component by its position in the component tree
// counted from the render root, so they do not depend on the order in which
// asynchronous work finished. That is what lets a streamed boundary that
// resolves late still produce the key the client computes in document order.
//
// The id format is adapted from Solid's formatId
// (packages/signals/src/core/owner.ts; MIT, Copyright (c) 2016-2026 Ryan
// Carniato): each step is the child index in base 36, prefixed with a letter
// giving its extra length when it needs more than one digit, so a path is
// unambiguous without separators.

function formatId(prefix, index) {
  const digits = index.toString(36);
  const extra = digits.length - 1;
  return prefix + (extra ? String.fromCharCode(64 + extra) : '') + digits;
}

// The step formatId wrote at `at` in `path`: its end and its index, or null.
function stepAt(path, at) {
  const c = path.charCodeAt(at);
  const extra = c >= 65 && c <= 90 ? c - 64 : 0;
  const start = extra ? at + 1 : at;
  const end = start + extra + 1;
  if (end > path.length) return null;
  const index = parseInt(path.slice(start, end), 36);
  return Number.isNaN(index) ? null : { end, index };
}

// The built-ins what-compiler lowers away (<Show>, <For>, <Switch>,
// <Match>: compiled JSX renders them as a conditional or a list, with no
// component of their own) take no step either when they run as components
// (h(), the JSX runtime), so a subtree has the same owner paths whichever way
// each side rendered it. Such a frame numbers its children as its parent's.
function holderOf(frame, root) {
  return frame === null ? root : frame._ownerHolder || frame;
}

/** The object that counts the children of `frame` (null: the root's). @internal */
export function _ownerCounter(frame, root) {
  return holderOf(frame, root);
}

/**
 * Give a component frame its owner path. `parent` is the frame it renders
 * under (null at the root); `root` is the object that counts root-level
 * components (the render context on the server). Server renderers call this
 * once per frame, in creation order. Returns whether the frame took a step
 * (false for a built-in the compiler lowers away), and so has a hydration key
 * of its own.
 *
 * Once an app defines a server action, it also gives the frame its place
 * among the keyed rows (placeInRow, below); `site` is the number
 * what-compiler gave the JSX that renders it, if any.
 */
export function _assignOwnerPath(frame, parent, root, site) {
  const holder = holderOf(parent, root);
  const prefix = parent ? parent._ownerPath || '' : '';
  if (frame.Component !== undefined && frame.Component._lowered === true) {
    frame._ownerPath = prefix;
    frame._ownerHolder = holder;
    if (placeRow !== null) placeRow(frame, parent, null, site);
    return false;
  }
  const index = holder._ownerChildren || 0;
  holder._ownerChildren = index + 1;
  frame._ownerPath = formatId(prefix, index);
  if (placeRow !== null) placeRow(frame, parent, holder, site);
  return true;
}

/** The owner path of the component frame running now, or undefined outside one. */
export function _currentOwnerPath() {
  const frame = getCurrentComponent();
  return frame ? frame._ownerPath : undefined;
}

/** The owner key for the next keyless resource created in `frame` (or at the root). */
export function _nextOwnerKey(frame, root) {
  const holder = holderOf(frame || null, root);
  const index = holder._ownerResources || 0;
  holder._ownerResources = index + 1;
  return `${frame ? frame._ownerPath || '' : ''}:${index}`;
}

// --- Keyed rows ---
//
// A useActionState of a server action has an identity its <Form> posts, and
// a form posted without JavaScript comes back to the instance of that
// identity alone. A render that answers the post is another render, of data
// that may have changed since (a teammate added a record above), so inside a
// keyed list the identity follows the row's key, as React's key path names
// an element: the keys of the keyed rows around the instance, outermost
// first, each with its list's place in the component that renders it and
// how many rows of that list had the same key before it, then the steps from
// the innermost row down to the instance's component, and its place among
// that component's. Outside keyed lists the steps start at the root.
//
// A keyed row is a member of an array (a reactive child's, a component's, a
// keyed list's rows) or of an element's children whose key is a string or a
// finite number: a `.map()` row with a `key`, a <For key> row, a vnode with
// a key. A key of any other kind (an object, a boolean, NaN) has no stable
// form from one render to the next, so its row is not a keyed row and the
// components in it count by position. The renderers enter each row as they
// reach it (_enterRow, _leaveRow), on the server and while hydrating alike,
// on the object that counts the components of the frame rendering it.
//
// A component's step, like a list's place, is where it stands, never how many
// components or lists came before it, so a component or a list that is in one
// render and not in the next moves no other: the child slots from the
// innermost row (or the frame's output) down to it, as the vnode renderers
// walk them (each member of an element's children or of an array that can
// hold a component or a list enters its index there: takesSlot in render.js
// and in what-server, _enterRow), then the number what-compiler gives the JSX
// that renders it, from where that is written in its source. A conditional
// child keeps its
// slot when it renders nothing, as an h() function child does (h() drops a
// `false` or `null` child, which so holds no slot). What still shares a place
// (one JSX site run more than once in a frame: a helper called twice, the
// rows of an unkeyed compiled list) is told apart by the order it takes the
// place in; a keyed list takes its place even when it is empty.
//
// The page carries no key: a key is written as its digest under the render's
// salt (_rowKeyDigest, as a keyed list's keys comment writes it), and the
// identity begins with that salt. The render that answers a post compares
// under the posted identity's salt, and the hydration of a page computes its
// identities under the page's, which the server writes into the page's data
// (what-server actions.js).

const isRowKey = (key) => typeof key === 'string' || (typeof key === 'number' && Number.isFinite(key));

// Installed with the keyed rows (_installRowKeys): placeInRow, and readRootRow
// for a hydration root. An app with no server action carries neither.
/** @type {((frame: any, parent: any, holder: any, site: number | undefined) => void) | null} */
let placeRow = null;
/** @type {((root: any, container: any) => void) | null} */
let rootRow = null;

// A frame's place among the keyed rows: `_rowIn`, the innermost keyed row
// around it, and `_rowPath`, its steps counted from that row; outside keyed
// rows, `_placePath`, its steps from the root. Its step is its place in the
// output of the frame rendering it (`holder`), from the start of the keyed
// row open there or of the output (placeOf), ending at `X`. A built-in the
// compiler lowers away (no `holder`) takes no step.
function placeInRow(frame, parent, holder, site) {
  const open = holder === null ? undefined : holder._row;
  const row = rowOf(open);
  // An island's content takes the place the root of the client's hydrate()
  // into the island takes (_currentRowPath): no slot, no compiled number.
  const step = holder === null ? '' : holder._islandHost === true ? placeOf(undefined, holder, undefined, 'X', frame._ownerPath)
    : placeOf(open, row !== undefined ? row : holder, site, 'X', frame._ownerPath);
  if (row !== undefined) {
    frame._rowIn = row;
    frame._rowPath = step;
  } else if (parent && parent._rowIn !== undefined) {
    frame._rowIn = parent._rowIn;
    frame._rowPath = parent._rowPath + step;
  } else {
    frame._placePath = (parent ? parent._placePath || '' : '') + step;
  }
}

// A frame's steps from the root outside keyed rows (placeInRow), or its
// owner path where it has none (no server action, an unanchored frame).
function stepsOf(frame) {
  const path = frame._ownerPath || '';
  return frame._placePath !== undefined && path[0] !== UNANCHORED ? frame._placePath : path;
}

// An island's root starts from the place its server wrote (_currentRowPath):
// the keyed rows around it, or outside them its steps from the root.
function readRootRow(root, container) {
  const row = root._ownerPath[0] !== UNANCHORED ? container.getAttribute('data-what-row') : null;
  if (row === null || !ROW_PATH.test(row)) return;
  if (row.includes('-')) {
    root._rowIn = { written: row };
    root._rowPath = '';
  } else {
    root._placePath = row;
  }
}

// What an island's data-what-row holds: digests, steps and the row marks
// between them (a row's lead ends at `-`, which no step writes).
const ROW_PATH = /^[0-9A-Za-z_.-]+$/;

// The innermost keyed row of what is open in a frame's output (`open`: the
// slot or row entered last, each slot holding the row around it).
const rowOf = (open) => (open !== undefined && open.slot !== undefined ? open.row : open);

/**
 * @internal A keyed row with key `key` of the list `list` begins in the
 * output of `frame` (undefined: the component running now; null: the root,
 * counted by `root`). `list` is an object the caller makes for one array or
 * one element's children (with `slot`, the number what-compiler gave a list
 * it lowered), and passes for each of its members with a key: the first
 * gives the list its place (Keyed rows above), and each the count of the rows
 * of the same key before it. A caller that enters only some of its rows
 * (compiled markup enters the rows it renders components in) gives the list
 * its rows' keys as `list.keys`, enters it once before the first row with no
 * key, and passes each row's place in `keys` as `index`; a compiled list
 * enters so even when it has no rows, so it takes its place. Returns what
 * _leaveRow puts back once the row is done. A key that is not a row key
 * (above) enters nothing, and the result is what is open there now. A null
 * `list` is a member that is no keyed row: with a number `key`, its index in
 * the element's children or the array being walked, it enters that slot (a
 * member that can hold a component or a list, takesSlot, holds them below it
 * there); with none, it enters nothing.
 */
export function _enterRow(frame, root, list, key, index) {
  const holder = holderOf(frame === undefined ? _currentComponent() : frame, root);
  const open = holder._row;
  if (list === null) {
    if (typeof key === 'number') holder._row = { up: open, slot: key, row: rowOf(open) };
    return open;
  }
  const outer = rowOf(open);
  list.place ??= placeOf(open, outer !== undefined ? outer : holder, list.slot, '', list);
  if (!isRowKey(key)) return open;
  let n;
  if (list.keys !== undefined) n = (list.counts ??= keyCounts(list.keys))[/** @type {number} */ (index)];
  else {
    const seen = list.seen ??= new Map();
    const id = keyId(key);
    n = seen.get(id) || 0;
    seen.set(id, n + 1);
  }
  let up = outer;
  let lead = '';
  if (outer === undefined) {
    up = holder._rowIn !== undefined ? holder._rowIn : null;
    lead = up !== null ? holder._rowPath : stepsOf(holder);
  }
  holder._row = { up, lead, list: list.place, key, n };
  return open;
}

// A place in `scope` (the innermost row, or the frame): the slots open from
// its start down to `open`, the compiled `number`, then `end` (`X` ends a
// component's step; a list's place is followed by its rows' keys). What
// takes a place another took before it in `scope` adds how many did; `who`
// taking it again (a component's retry, with its owner path) keeps its count.
// Each slot and number is formatId's (self-delimiting); `Z`, `Y` and `X`,
// which begin no step formatId writes, mark the number, the count and the end.
function placeOf(open, scope, number, end, who) {
  let place = '';
  for (let s = open; s !== undefined && s.slot !== undefined; s = s.up) place = formatId('', s.slot) + place;
  if (number != null) place += 'Z' + formatId('', number);
  place += end;
  const taken = scope._places ??= new Map();
  const seen = taken.get(place);
  let before = 0;
  if (seen === undefined) taken.set(place, [1, who]);
  else if (seen[1] === who) before = seen[0] - 1;
  else {
    before = seen[0]++;
    seen[1] = who;
  }
  return before === 0 ? place : place + 'Y' + formatId('', before);
}

const keyId = (key) => (typeof key === 'string' ? 's' : 'n') + key;

// For each key of `keys`, how many before it are the same row key.
function keyCounts(keys) {
  const seen = new Map();
  return keys.map((key) => {
    if (!isRowKey(key)) return 0;
    const id = keyId(key);
    const n = seen.get(id) || 0;
    seen.set(id, n + 1);
    return n;
  });
}

/** @internal The row _enterRow entered in `frame`'s output is done: `saved` is what it returned. */
export function _leaveRow(frame, root, saved) {
  holderOf(frame === undefined ? _currentComponent() : frame, root)._row = saved;
}

/**
 * @internal An app defines a server action: hydration enters keyed rows from
 * now on, as the server renderers always do, so its useActionState keys are
 * the server's (what-server action()).
 */
export function _installRowKeys() {
  placeRow = placeInRow;
  rootRow = readRootRow;
  _installRowEntry(_enterRow, _leaveRow);
}

/** @internal Whether keyed rows are installed (_installRowKeys): the server renderers enter slots (_enterRow) only then. */
export function _tracksRows() {
  return placeRow !== null;
}

// `row` and the rows around it, under `salt`. An island's root starts from
// the path its server wrote (_hydrationRoot). A list's place ends at `.`,
// which no step writes, before the key's fixed-length digest.
function rowPath(row, salt) {
  let path = '';
  for (let r = row; r !== null; r = r.up) {
    if (r.written !== undefined) return r.written + path;
    path = r.lead + '-' + r.list + '.' + _rowKeyDigest(r.key, salt) + formatId('', r.n) + path;
  }
  return path;
}

/**
 * @internal The component rendering now is an island's wrapper on the
 * server: the client hydrates the island's content as the root of a hydrate()
 * call of its own, so what the wrapper renders takes the place that root's
 * component takes there, with no slot and no compiled number (placeInRow).
 * what-server's Island (through _currentRowPath) and compiled JSX's
 * (components.js _$Island) both are.
 */
export function _islandHost() {
  const frame = _currentComponent();
  if (frame !== null) frame._islandHost = true;
}

/**
 * @internal The place of the component rendering now: the keyed rows around
 * it and its steps below the innermost, under `salt`, or outside keyed rows
 * its steps from the root; null when no server action placed it. An island
 * writes it as data-what-row, for the root it hydrates into to start from,
 * and the component asking is that island's wrapper (_islandHost).
 */
export function _currentRowPath(salt) {
  const frame = _currentComponent();
  if (frame === null || (frame._rowIn === undefined && frame._placePath === undefined)) return null;
  frame._islandHost = true;
  return frame._rowIn !== undefined ? rowPath(frame._rowIn, salt) + frame._rowPath : frame._placePath;
}

const SALT = /^[0-9A-Za-z_.]{11}$/;

/**
 * @internal The salt the render running now writes its keyed rows' digests
 * under: one per render context, a fresh one outside a render.
 */
export function _renderSalt() {
  const ctx = getServerContext();
  if (ctx === null) return _rowKeySalt();
  let salt = salts.get(ctx);
  if (salt === undefined) salts.set(ctx, salt = _rowKeySalt());
  return salt;
}

const salts = new WeakMap();

/** @internal The salt an action-state key (_actionStateKey) was made under, or null for one made under none. */
export function _actionKeySalt(key) {
  if (typeof key !== 'string' || key.charCodeAt(11) !== 47) return null;
  const salt = key.slice(0, 11);
  return SALT.test(salt) ? salt : null;
}

/**
 * @internal The identity of the server action's useActionState being made
 * now (Keyed rows above), as a function of the salt it is written under:
 * `key(salt)`. `key.salted` says whether it has keyed rows in it, and so
 * whether the salt matters; a key without one is its component's owner path
 * and its place among that component's. The same on the server and while
 * hydrating what the server rendered; under a salt that is not one, a key no
 * server render makes. Null in any other client render, or outside a
 * component.
 */
export function _actionStateKey() {
  const frame = _currentComponent();
  if (frame === null || frame._ownerPath === undefined || !(isServerRender() || isHydrating())) return null;
  const holder = holderOf(frame, null);
  const index = holder._ownerActions || 0;
  holder._ownerActions = index + 1;
  const positional = `${stepsOf(frame)}:${index}`;
  const row = frame._rowIn;
  if (row === undefined || positional[0] === UNANCHORED) {
    const key = () => positional;
    key.salted = false;
    return key;
  }
  const below = `${frame._rowPath}:${index}`;
  const key = (salt) => (typeof salt === 'string' && SALT.test(salt) ? `${salt}/${rowPath(row, salt)}${below}` : UNANCHORED + positional);
  key.salted = true;
  return key;
}

// --- Adopting keyless values while hydrating ---
//
// The client numbers its component contexts the way the server numbered its
// frames, and a keyless resource looks its own owner key up. Nothing is taken
// by position, so a component the other side does not have (a <Portal>'s
// content, a client-only widget, a branch that differs) can only miss, never
// hand its value to a neighbour.
//
// A component whose output starts with an element the server keyed takes its
// path from that key (the server put the innermost component's path there,
// and this component's is the step of it right after its parent's), so it
// finds its own values wherever the two sides' trees diverged before it: a
// branch only one side rendered, the children a boundary tried before its
// fallback. Its parent then counts on from there. A component with no key in
// front of it is numbered in order, which holds only while the walk has
// matched the server's structure: once it has not (a mismatch in the
// structure: an element of another tag, one missing or left over, a key that
// differs), or where the server rendered nothing at all, it is numbered under
// a prefix no server key has, so its resources fetch.
//
// Numbering starts from the right place only for a hydrate() root that is the
// server's render root, or that names the server owner path it starts at:
//
//   - a container whose direct children include the page's hydration data
//     element is where the server's render went (renderDocument writes the
//     payload into <body> after the page, a stream right after its shell), so
//     it counts from the root;
//   - a container with data-what-owner="PATH" (an island) counts from PATH;
//   - any other container (a second hydrate() root covering part of the page)
//     is numbered under a prefix no server key has, so its resources fetch.
//
// Position alone cannot tell two components apart when one side renders a
// component the other does not have in the same place. In development a value
// is adopted only when the server's component at that owner path has the
// client's component's name too (`owners`); otherwise the resource fetches and
// ERR_HYDRATION_OWNER_MISMATCH names both. A production client adopts by owner
// path alone: its bundle renames functions (minification), so no name could
// match, and a tree that renders differently on the two sides is the
// development check's to find, as hydration mismatches are. A resource given a
// `key` is adopted by that key everywhere.

const UNANCHORED = '~';
const OWNER_PATH = /^[0-9A-Za-z]*$/;

/**
 * The counter for the root-level components of one hydrate() call into
 * `container`: each call counts from the container's anchor again, and work
 * of that call that runs later (a boundary resuming) counts on it.
 * @internal
 */
export function _hydrationRoot(container) {
  const root = { _ownerPath: anchorPath(container), _ownerChildren: 0 };
  if (rootRow !== null) rootRow(root, container);
  return root;
}

function anchorPath(container) {
  if (!container || container.nodeType !== 1) return UNANCHORED;
  const owner = container.getAttribute('data-what-owner');
  if (owner !== null) return OWNER_PATH.test(owner) ? owner : UNANCHORED;
  for (let el = container.lastElementChild; el; el = el.previousElementSibling) {
    if (isDataElement(el)) return '';
  }
  return UNANCHORED;
}

/**
 * Give a client component context its owner path while hydrating; outside a
 * hydration it does nothing. The hydration walk calls it once per component
 * context, right after creating it, with its hydrate() call's root counter
 * (_hydrationRoot) and what the server has where the component's output
 * starts: the key of the element there (a string, '' for an element or text
 * with none), or null when the server rendered nothing more there. `ordered`
 * says whether the walk has matched the server's structure so far, and `site`
 * is the compiled JSX's number (_assignOwnerPath). Returns 0
 * for a built-in that takes no step (see _assignOwnerPath), 2 when the
 * server's key there cannot be this component's (it does not extend the
 * parent's path), else 1.
 *
 * The parent is the nearest component owner above it (boundaries, effects
 * and list rows are owners without a `Component` and are skipped). A
 * component built fresh while hydrating (a compiled component, a mismatch's
 * client render) has no owner path, so nothing under it is numbered from the
 * server's: it fetches.
 */
export function _assignHydrationOwnerPath(ctx, root, key, ordered, site) {
  if (!isHydrating()) return 1;
  let parent = ctx.owner;
  while (parent && parent.Component === undefined) parent = parent.owner;
  if (parent && parent._ownerPath === undefined) {
    ctx._ownerPath = UNANCHORED;
    return 1;
  }
  const frame = parent || root;
  if (!_assignOwnerPath(ctx, frame, null, site)) return 0;
  const prefix = frame._ownerPath;
  // Under a prefix no server key has, nothing is the server's.
  if (prefix[0] === UNANCHORED) return 1;
  const step = key && key.startsWith(prefix) ? stepAt(key, prefix.length) : null;
  if (step !== null) {
    ctx._ownerPath = key.slice(0, step.end);
    holderOf(frame, null)._ownerChildren = step.index + 1;
    return 1;
  }
  if (key !== '' || !ordered) ctx._ownerPath = UNANCHORED + ctx._ownerPath;
  return key ? 2 : 1;
}

function componentName(frame) {
  return (frame.Component && frame.Component.name) || '';
}

/**
 * While hydrating: the server's result for the next keyless resource of
 * `frame`, `{ value }` or `{ error }`, or undefined when there is none to
 * adopt. Every keyless resource calls this, adopted or not, so the next one in
 * the same component gets the next key.
 */
export function _adoptOwnedValue(frame) {
  if (!frame || frame._ownerPath === undefined || !isHydrating()) return undefined;
  const key = _nextOwnerKey(frame, null);
  const data = __readHydrationData();
  if (!data) return undefined;
  const failed = !!data.ownedErrors && Object.hasOwn(data.ownedErrors, key);
  if (!failed && !(data.owned && Object.hasOwn(data.owned, key))) return undefined;
  if (__DEV__) {
    const path = frame._ownerPath;
    const server = data.owners && Object.hasOwn(data.owners, path) ? data.owners[path] : null;
    const client = componentName(frame);
    if (server !== client) {
      report('ERR_HYDRATION_OWNER_MISMATCH', { data: { path, server: String(server), client } });
      return undefined;
    }
  }
  return failed ? { error: data.ownedErrors[key] } : { value: data.owned[key] };
}

// --- Async values in the channel ---
//
// An async value (computed(), createResource) asks where it starts from when it
// is made. Only a server render or a hydration can answer anything but
// "nowhere", so the answer is installed by the first of either to start
// (server-context.js, render.js hydrate()): an app that does neither does not
// carry it.

/** @type {typeof seedFor | null} */
let seeder = null;

/** @internal A hydration is starting: async values take part in the channel. */
export function _installSeeding() {
  seeder = seedFor;
  _installSeedOps();
}

/** @internal A server render is starting: async values take part in the channel, through its resource store. */
export function _installServerSeeding() {
  seeder = seedFor;
  _installStoreSeedOps();
}

/**
 * @internal Where an async value made now starts from (see seedFor), or null.
 * @param {unknown} key
 * @param {boolean} track whether an adopted value's function runs once to learn what it reads
 */
export function _seedFor(key, track) {
  if (seeder !== null) return seeder(key, track);
  // A server render another copy of what-core runs (this one is a library's
  // own engine) refuses the value: the store of a render that started says
  // so (server-context.js `refuse`).
  /** @type {any} */ (globalThis)[_serverStoreKey]?.refuse?.();
  return null;
}

// In a server render: the render's resource store, under `key` or, without
// one, the owner key of the component being rendered, so a retried render
// finds the run, and the client finds the value. While hydrating: the value
// (or error) the server rendered with, under the same owner key. Otherwise
// nothing. Every keyless value made in a component consumes one owner key on
// both sides, so the numbering matches.
function seedFor(key, track) {
  const keyed = key != null;
  if (isServerRender()) {
    const ctx = getServerContext();
    if (ctx === null) return null;
    const frame = _currentComponent();
    return {
      store: keyed ? ctx.resources : ctx.owned,
      key: keyed ? key : _nextOwnerKey(frame, ctx),
      owner: keyed ? undefined : (frame && frame.Component && frame.Component.name) || '',
    };
  }
  if (keyed || !isHydrating()) return null;
  const taken = _adoptOwnedValue(_currentComponent());
  if (taken === undefined) return null;
  return 'error' in taken ? { error: _errorFromRecord(taken.error), track } : { value: taken.value, track };
}

/** @internal A server error record as the Error the client exposes. */
export function _errorFromRecord(record) {
  const error = new Error(record && record.message ? record.message : 'Server error');
  if (record && record.code) /** @type {any} */ (error).code = record.code;
  return error;
}

// --- Streamed boundaries ---

function endMarker(placeholder) {
  const end = placeholder.id;
  for (let node = placeholder.nextSibling; node; node = node.nextSibling) {
    if (node.nodeType === 8 && node.data === end) return node;
  }
  return null;
}

function swapBoundary(placeholder, content, end) {
  for (let node = placeholder.nextSibling; node !== end;) {
    const next = node.nextSibling;
    node.remove();
    node = next;
  }
  end.remove();
  placeholder.replaceWith(content.content);
  content.remove();
}

/**
 * Swap in the content of the streamed boundary `placeholder` stands for when
 * the content is on the page but its swap has not run: a page whose inline
 * scripts did not run, or hydrate() reaching the boundary first. Returns
 * whether it did.
 */
export function _swapArrived(placeholder) {
  const id = placeholder.id.slice(3);
  if (!BOUNDARY_ID.test(id)) return false;
  const content = document.querySelector(`template[id="${id}"]`);
  const end = content && endMarker(placeholder);
  if (!end) return false;
  swapBoundary(placeholder, content, end);
  const data = __readHydrationData();
  if (data && data.head && Object.hasOwn(data.head, id)) applyLateHead(data.head[id]);
  return true;
}

const SAFE_HEAD_ATTR = /^[a-zA-Z_:][a-zA-Z0-9:._-]*$/;

// What what-server's boundary ids are made of (stream.js), and so what may go
// into a selector unescaped.
const BOUNDARY_ID = /^[A-Za-z][\w-]*$/;

function headElement(tag, attrs) {
  const el = document.createElement(tag);
  for (const key in attrs) {
    const value = attrs[key];
    if (value == null || value === false) continue;
    const name = key === 'httpEquiv' ? 'http-equiv' : key;
    if (SAFE_HEAD_ATTR.test(name) && !/^on./i.test(name)) el.setAttribute(name, String(value));
  }
  return el;
}

function putHeadElement(el, matches) {
  const head = document.head;
  if (matches) {
    for (let node = head.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === 1 && /** @type {Element} */ (node).tagName === el.tagName && matches(node)) {
        node.replaceWith(el);
        return;
      }
    }
  }
  head.appendChild(el);
}

/**
 * Apply the <Head> tags a streamed boundary set after the shell: the title,
 * and each meta or link, replacing the head element with the same dedup key as
 * head.js uses. Kept in step with HEAD_FUNCTION in what-server's stream.js.
 */
function applyLateHead(head) {
  if (head.title != null) document.title = head.title;
  for (const attrs of head.meta || []) {
    const by = attrs.name ? 'name' : attrs.property ? 'property' : attrs.httpEquiv ? 'http-equiv' : null;
    const value = String(attrs.name || attrs.property || attrs.httpEquiv);
    putHeadElement(headElement('meta', attrs), by && ((node) => node.getAttribute(by) === value));
  }
  for (const attrs of head.link || []) {
    const href = attrs.href == null ? null : String(attrs.href);
    putHeadElement(headElement('link', attrs),
      (node) => node.getAttribute('rel') === String(attrs.rel) && node.getAttribute('href') === href);
  }
}

/**
 * Settle every streamed boundary on the page, the work the inline scripts do
 * on a normal stream. A page streamed with what-server's `noScripts` option
 * carries no inline scripts, so its client entry calls this, before hydrating
 * or after; on any streamed page it is safe to call once the document has
 * loaded.
 *
 * A boundary whose content has arrived is swapped into place, and the <Head>
 * tags it set are applied. A placeholder with no content (the boundary failed,
 * or the stream was cut short) is removed with its end marker, and the
 * boundary's opening marker becomes <!--b!-->: the fallback stays as if the
 * server had rendered it, so hydration claims it as a fallback and the client
 * renders the boundary itself. A boundary that hydrated while it was waiting
 * hydrates its content now (render.js _resumeBoundary). A placeholder is a
 * <template id="pl-ID"> followed by its `<!--pl-ID-->` marker, and its content
 * a <template id="ID">: anything else on the page is left alone. Returns how
 * many boundaries it swapped.
 */
export function applyStreamedBoundaries() {
  if (typeof document === 'undefined') return 0;
  const data = __readHydrationData() || {};
  let count = 0;
  for (let progress = true; progress;) {
    progress = false;
    for (const placeholder of document.querySelectorAll('template[id^="pl-"]')) {
      const id = placeholder.id.slice(3);
      if (!BOUNDARY_ID.test(id)) continue;
      const content = document.querySelector(`template[id="${id}"]`);
      if (!content) continue;
      const end = endMarker(placeholder);
      if (!end) continue;
      swapBoundary(placeholder, content, end);
      if (data.head && Object.hasOwn(data.head, id)) applyLateHead(data.head[id]);
      _resumeBoundary(id);
      count++;
      progress = true;
    }
  }
  for (const placeholder of document.querySelectorAll('template[id^="pl-"]')) {
    const id = placeholder.id.slice(3);
    if (!BOUNDARY_ID.test(id)) continue;
    const end = endMarker(placeholder);
    if (!end) continue;
    const open = placeholder.previousSibling;
    if (open !== null && open.nodeType === 8 && /** @type {Comment} */ (open).data === 'b') /** @type {Comment} */ (open).data = 'b!';
    end.remove();
    placeholder.remove();
    _resumeBoundary(id);
  }
  return count;
}
