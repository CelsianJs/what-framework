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

import { isHydrating, _resumeBoundary } from './render.js';
import { getCurrentComponent } from './dom.js';
import { _currentComponent, _installSeedOps, __DEV__ } from './reactive.js';
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
  _roots = null;
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

/**
 * Give a component frame its owner path. `parent` is the frame it renders
 * under (null at the root); `root` is the object that counts root-level
 * components (the render context on the server). Server renderers call this
 * once per frame, in creation order.
 */
export function _assignOwnerPath(frame, parent, root) {
  const holder = parent || root;
  const index = holder._ownerChildren || 0;
  holder._ownerChildren = index + 1;
  frame._ownerPath = formatId(parent ? parent._ownerPath || '' : '', index);
}

/** The owner path of the component frame running now, or undefined outside one. */
export function _currentOwnerPath() {
  const frame = getCurrentComponent();
  return frame ? frame._ownerPath : undefined;
}

/** The owner key for the next keyless resource created in `frame` (or at the root). */
export function _nextOwnerKey(frame, root) {
  const holder = frame || root;
  const index = holder._ownerResources || 0;
  holder._ownerResources = index + 1;
  return `${frame ? frame._ownerPath || '' : ''}:${index}`;
}

// --- Adopting keyless values while hydrating ---
//
// The client numbers its component contexts the way the server numbered its
// frames, and a keyless resource looks its own owner key up. Nothing is taken
// by position, so a component the other side does not have (a <Portal>'s
// content, a client-only widget, a branch that differs) can only miss, never
// hand its value to a neighbour.
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

/** @type {Map<any, { _ownerPath: string, _ownerChildren: number }> | null} */
let _roots = null;

// The counter for the root-level components hydrated into `container`. One
// per container for the synchronous run of hydrate() calls; a later hydrate()
// of the same container counts again.
function rootFor(container) {
  if (_roots === null) {
    _roots = new Map();
    queueMicrotask(() => { _roots = null; });
  }
  let root = _roots.get(container);
  if (root === undefined) {
    root = { _ownerPath: anchorPath(container), _ownerChildren: 0 };
    _roots.set(container, root);
  }
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
 * context, right after creating it, with the DOM node the component hydrates
 * into.
 *
 * The parent is the nearest component owner above it (boundaries, effects
 * and list rows are owners without a `Component` and are skipped). A component built fresh while
 * hydrating (a compiled component, a mismatch's client render) has no owner
 * path, so nothing under it is numbered from the server's: it fetches.
 */
export function _assignHydrationOwnerPath(ctx, container) {
  if (!isHydrating()) return;
  let parent = ctx.owner;
  while (parent && parent.Component === undefined) parent = parent.owner;
  if (parent && parent._ownerPath === undefined) {
    ctx._ownerPath = UNANCHORED;
    return;
  }
  _assignOwnerPath(ctx, parent || rootFor(container), null);
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

/** @internal A server render or a hydration is starting: async values take part in the channel. */
export function _installSeeding() {
  seeder = seedFor;
  _installSeedOps();
}

/**
 * @internal Where an async value made now starts from (see seedFor), or null.
 * @param {unknown} key
 * @param {boolean} track whether an adopted value's function runs once to learn what it reads
 */
export function _seedFor(key, track) {
  return seeder === null ? null : seeder(key, track);
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
