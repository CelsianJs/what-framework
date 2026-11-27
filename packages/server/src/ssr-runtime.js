// What Framework - Server: the runtime half of what-compiler's server target
// (`generate: "ssr"`).
//
// A JSX element compiles to one call, made where the JSX expression runs,
// exactly as h() is called there:
//
//   <li class={sel() === id ? 'on' : ''} title={label}>{name} <b>{count()}</b><Badge /></li>
//
//   const _tmpl$0 = _$ssrTemplate(['<li', '', '>', ' <b>', '</b>', '</li>'],
//     [['class', 'class'], ['plain', 'title'], null, null, null]);
//   _$ssr(_tmpl$0, () => sel() === id ? 'on' : '', label,
//     _$ssrText(name), () => count(), _$ssrComponent(Badge, null, []))
//
// Each hole is what h() would be handed in the same place, evaluated in the
// same order: a plain value is read now (and escaped now); what h() would get
// as a thunk, a reactive child or attribute, stays a thunk; a component stays
// a vnode. The result is Markup (below): finished HTML when nothing is left
// for later, else HTML with the thunks, vnodes and attribute thunks between
// it. The renderer that places the markup renders those in document order
// with h()'s rules for each: a reactive child that throws renders an empty
// region and one that suspends is retried on its own, an attribute whose
// thunk throws is dropped, a component renders in the frame that places it.
// So compiled JSX renders as its h() spelling does, in every renderer.
//
// Trust (compiled.js): a string is text, and only Markup is written as HTML.
// A Markup's strings are the compiler's templates, escaped and validated at
// build time, and the strings this module's helpers return, which compiled
// code only ever passes straight to ssr(). Anything else (a row a .map()
// callback returns, a child, a component's result) is escaped unless it is
// Markup.
//
// The rules a value has to pass are what-core's markup rules, the ones the
// h() renderers apply (the compile-time half is in the compiler's
// babel/ssr.js): every dynamic value is escaped, URL values are
// scheme-checked, srcdoc and outerHTML are never written, spreads and
// classList go through renderAttrs, innerHTML takes { __html } only, the text
// of a <script> or <style> cannot end its element, and a tag computed at run
// time is a vnode the renderer checks with assertSafeTag.

import { h, Fragment } from 'what-core';
import { _$Island } from 'what-core/render';
import { _enterRow, _leaveRow, _symbolChild, getServerContext, isVNode } from 'what-core/internal';
import { TEXT_ONLY_ELEMENTS, isUnsafeUrl } from 'what-core/internal/markup-rules';
import { _afterOpen, _enterSelect, _field, _isDevMode, _leaveSelect, _rawText, _renderOption, _resolveInnerHTML, ElementParts, escapeHtml, OWN_PROPS, renderAttrs, styleText, VOID_ELEMENTS } from './html.js';
import { ARRAY_CLOSE, ARRAY_OPEN, Html, claim, isHtml, rowKeys } from './compiled.js';

// Compiled JSX: HTML, or HTML with what is rendered when it is placed. The
// HTML is `h` followed by `s`, or by the parts in `p`: `h` is the markup's
// leading template string, kept apart so that a hydration key can go into its
// first element without reading (and copying) everything after it.
class Markup extends Html {
  constructor(h, f, list) {
    super();
    this.h = h;
    // The HTML after `h`; null once there are parts.
    /** @type {string | null} */
    this.s = '';
    // HTML strings and, between them, what is rendered on placement: thunks,
    // vnodes and Html, and for a reactive attribute its AttrSlot followed by
    // its function (and, for a row's, by the row's item: AttrSlot.n says how
    // many follow it). What follows a slot is never read as a part. Null when
    // there are none.
    /** @type {any[] | null} */
    this.p = null;
    // It holds SVG or MathML, so what it defers may sit in foreign content.
    this.f = f;
    // The rows of a .map() a reactive child returned: the array h()'s thunk
    // would have returned, so the hydratable renderer brackets it as a list.
    this.list = list;
    // A keyed list's rows' keys, which a hydratable renderer writes after its
    // opening marker (rowKeys); null for any other markup.
    /** @type {any[] | null} */
    this.keys = null;
  }

  // `hk` is null for a plain render, and a hydratable renderer's pending
  // hydration key for a hydratable one (compiled.js): what is written first
  // goes through claim() while one is pending.
  render(renderChild, hk, ns) {
    if (hk !== null && (hk.key !== null || this.list)) return this.renderKeyed(renderChild, hk, ns);
    if (this.s !== null) return this.h + this.s;
    const partNs = this.childNs(ns);
    const p = /** @type {any[]} */ (this.p);
    let html = this.h;
    for (let i = 0; i < p.length; i++) {
      const part = p[i];
      if (typeof part === 'string') html += part;
      else if (typeof part !== 'object' || part === null || !isHtml(part)) html += renderChild(part, partNs);
      else if (part instanceof AttrSlot) {
        html += part.take(p, i);
        i += part.n;
      } else html += part.render(renderChild, hk, partNs);
    }
    return html;
  }

  // The same for a hydratable renderer: list markers, and every string fed to
  // the pending hydration key while there is one.
  renderKeyed(renderChild, hk, ns) {
    let html = this.list ? keyed(hk, ARRAY_OPEN) + this.rowKeys() : '';
    html += keyed(hk, this.h);
    if (this.s !== null) html += keyed(hk, this.s);
    else {
      const partNs = this.childNs(ns);
      const p = /** @type {any[]} */ (this.p);
      for (let i = 0; i < p.length; i++) {
        const part = p[i];
        if (typeof part === 'string') html += hk.key !== null ? claim(hk, part) : part;
        else if (typeof part !== 'object' || part === null || !isHtml(part)) html += renderChild(part, partNs);
        else if (part instanceof AttrSlot) {
          html += keyed(hk, part.take(p, i));
          i += part.n;
        } else html += part.render(renderChild, hk, partNs);
      }
    }
    return this.list ? html + keyed(hk, ARRAY_CLOSE) : html;
  }

  // The keys comment of a keyed list, for the renderers that write one.
  rowKeys() {
    return this.keys === null ? '' : rowKeys(this.keys);
  }

  // Its HTML as a string, or the strings and what is rendered between them
  // (compiled.js). Hydratable markup, list markers included.
  parts() {
    if (this.s !== null) return this.list ? ARRAY_OPEN + this.rowKeys() + this.h + this.s + ARRAY_CLOSE : this.h + this.s;
    const p = /** @type {any[]} */ (this.p);
    /** @type {any[]} */
    const parts = this.list ? [ARRAY_OPEN + this.rowKeys()] : [];
    if (this.h) parts.push(this.h);
    for (let i = 0; i < p.length; i++) {
      const part = p[i];
      if (typeof part === 'object' && part !== null && Html.is(part) && part instanceof AttrSlot) {
        parts.push(new Attr(part, p, i));
        i += part.n;
      } else parts.push(part);
    }
    if (this.list) parts.push(ARRAY_CLOSE);
    return parts;
  }

  // The stream's way through the same parts (compiled.js): the HTML from part
  // `from` on goes to `put`, a reactive attribute is resolved and a keyed
  // row's edge run where it stands, and it stops at the first part the stream
  // has to render itself.
  pour(put, seg, from, frame, root, skip) {
    if (from === 0) {
      if (this.list) put(seg, ARRAY_OPEN + this.rowKeys());
      put(seg, this.h);
      if (this.s !== null) put(seg, this.s);
    }
    const p = this.p;
    if (p !== null) {
      for (let i = from; i < p.length; i++) {
        const part = p[i];
        if (typeof part === 'string') put(seg, part);
        else if (typeof part !== 'object' || part === null || !Html.is(part)) {
          if (!skip) return i;
        } else if (part instanceof AttrSlot) {
          if (!skip) put(seg, part.take(p, i));
          i += part.n;
        } else if (part instanceof RowEdge) part.edge(frame, root);
        else if (!skip) return i;
      }
    }
    if (this.list) put(seg, ARRAY_CLOSE);
    return -1;
  }

  held(at) {
    return /** @type {any[]} */ (this.p)[at];
  }

  rootTag() {
    const open = /^<([A-Za-z][\w:.-]*)/.exec(this.h);
    return open === null ? null : open[1];
  }

  // Markup with no SVG or MathML placed in HTML defers into HTML. Anywhere
  // else, the namespace of a deferred child depends on elements this markup
  // only holds as text, so it is foreign content of no known namespace, where
  // a <script> or <style> is never raw text.
  childNs(ns) {
    return ns === null && !this.f ? null : 'foreign';
  }
}

function keyed(hk, html) {
  return hk !== null && hk.key !== null ? claim(hk, html) : html;
}

// Building Markup: `m.s` is the HTML after the head while it is built. HTML
// is the head until there is a head, HTML after it or a part.
function addHtml(m, html) {
  if (m.h !== '' || m.s !== '' || m.p !== null) m.s += html;
  else m.h = html;
}

// Markup a hole holds goes into the template's, but a list's, which is
// rendered between its own markers (ssrList).
function append(m, hole) {
  if (typeof hole === 'string') addHtml(m, hole);
  else if (typeof hole === 'object' && hole !== null && Html.is(hole) && hole instanceof Markup && !hole.list) inline(m, hole);
  else defer(m, hole);
}

// How many parts that can render a component (anything but a reactive
// attribute) have been deferred: a keyed list reads it around each row
// (ssrList).
let deferred = 0;

function defer(m, item) {
  deferred++;
  if (m.p === null) m.p = [];
  if (m.s) m.p.push(m.s);
  m.s = '';
  m.p.push(item);
}

// A reactive attribute: its slot, then the function called when the markup
// is placed.
function deferAttribute(m, slot, fn) {
  if (m.p === null) m.p = [];
  if (m.s) m.p.push(m.s, slot, fn);
  else m.p.push(slot, fn);
  m.s = '';
}

// A row's reactive attribute: its slot, the function its list made for every
// row (ssrList's `rowFns`), and the row's item, which it is called with.
function deferRowAttribute(m, slot, fn, item) {
  if (m.p === null) m.p = [];
  if (m.s) m.p.push(m.s, slot, fn, item);
  else m.p.push(slot, fn, item);
  m.s = '';
}

function inline(m, markup) {
  if (markup.f) m.f = true;
  addHtml(m, markup.h);
  if (markup.s !== null) {
    m.s += markup.s;
    return;
  }
  const p = markup.p;
  for (let i = 0; i < p.length; i++) {
    const part = p[i];
    if (typeof part === 'string') m.s += part;
    else if (typeof part === 'object' && part !== null && Html.is(part) && part instanceof AttrSlot) {
      if (part.at < 0) deferAttribute(m, part, p[i + 1]);
      else deferRowAttribute(m, part, p[i + 1], p[i + 2]);
      i += part.n;
    } else defer(m, part);
  }
}

function finish(m) {
  if (m.p !== null) {
    if (m.s) m.p.push(m.s);
    m.s = null;
  }
  return m;
}

// One hole of a template, `slot` being what the template declares for it
// (ssrTemplate): an attribute's slot, or null or undefined for a child. The
// hole of a row's reactive attribute is the row's item, and its function is
// one of `fns`: its list's row functions, which the call that fills the
// template was given (ssr). A row never reads them from anywhere else.
function fill(m, slot, hole, fns) {
  if (slot == null) {
    if (typeof hole === 'string') addHtml(m, hole);
    else append(m, hole);
  } else if (slot.at < 0) attributeHole(m, slot, hole);
  else deferRowAttribute(m, slot, fns[slot.at], hole);
}

/**
 * A template: static strings `t`, filled with the holes passed after it. A
 * template that declares a row's reactive attribute (ssrTemplate) takes its
 * list's row functions before its holes: the row's callback was called with
 * them (ssrList) and hands them on.
 */
export function ssr(t) {
  const m = new Markup(t[0], false, false);
  const slots = t.slots;
  // Where the holes start, and the row functions before them, if any.
  let at = 1;
  let fns;
  if (t.fns === true) {
    fns = arguments[1];
    at = 2;
  }
  for (let i = at; i < arguments.length; i++) {
    fill(m, slots === undefined ? null : slots[i - at], arguments[i], fns);
    m.s += t[i - at + 1];
  }
  return finish(m);
}

/** ssr() for a template holding SVG or MathML elements. */
export function ssrForeign(t) {
  const m = new Markup(t[0], true, false);
  const slots = t.slots;
  let at = 1;
  let fns;
  if (t.fns === true) {
    fns = arguments[1];
    at = 2;
  }
  for (let i = at; i < arguments.length; i++) {
    fill(m, slots === undefined ? null : slots[i - at], arguments[i], fns);
    m.s += t[i - at + 1];
  }
  return finish(m);
}

// The list ssrList is filling while it calls a row callback, and what a row
// written into it returns.
/** @type {Markup | null} */
let rows = null;
const WRITTEN = Object.freeze({});

/**
 * A `.map()` row the callback returns as its whole result (`item => <li/>`):
 * written straight into the list ssrList is building, the same HTML a row
 * returned as Markup would add to it, without the Markup. Outside a list
 * (a `.map()` on something that is not an array) it is ssr().
 */
export function ssrRow(t) {
  const m = rows;
  if (m === null) return ssr.apply(null, /** @type {any} */ (arguments));
  addHtml(m, t[0]);
  const slots = t.slots;
  let at = 1;
  let fns;
  if (t.fns === true) {
    fns = arguments[1];
    at = 2;
  }
  for (let i = at; i < arguments.length; i++) {
    fill(m, slots === undefined ? null : slots[i - at], arguments[i], fns);
    m.s += t[i - at + 1];
  }
  return WRITTEN;
}

/**
 * A child written as itself (`{label}`, `{props.children}`, a non-reactive
 * expression): what h() does with the same value as a child. A string is
 * escaped, an array is flattened, a function is a reactive child and a vnode
 * a vnode (both rendered on placement), Markup is markup, and anything else is
 * text: an object is a vnode only by what-core's brand (isVNode), and a DOM
 * node is left for the renderer, which refuses it.
 */
export function ssrText(v) {
  if (typeof v === 'string') return escapeHtml(v);
  if (typeof v === 'number') return '' + v;
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'symbol') {
    _symbolChild(v, 'server');
    return '';
  }
  if (typeof v === 'function' || isHtml(v) || isVNode(v)) return v;
  if (Array.isArray(v)) {
    const m = new Markup('', false, false);
    for (let i = 0; i < v.length; i++) append(m, ssrText(v[i]));
    return finish(m);
  }
  if (typeof v === 'object' && typeof v.nodeType === 'number') return v;
  return escapeHtml(String(v));
}

/**
 * `{src.map(item => <li/>)}`: each row, whatever the callback returned,
 * through ssrText, so a row is markup only when it is Markup. A nullish
 * source (`src?.map(...)`) is an empty list, as the client's is. `asArray` says
 * the list is what a reactive child returns, so the hydratable renderer
 * brackets it as the array it stands for; a plain child's rows are flattened
 * into the parent, as h() flattens an array child. A keyed list's `keyFn`
 * gives its rows' keys, written with its markers, and `slot` is the number
 * what-compiler gave it (the client's list has the same). `rowFns` are the
 * reactive attributes of the row template, each as one function of the row's
 * item made for the whole list. A list that has them calls `fn` with them
 * before the item, `fn(rowFns, item, index, list)`, and the row hands them to
 * its template (ssr): the template's slot names its function, the row passes
 * its item as the hole, and the function is called with it where the row is
 * placed, when the thunk a row of its own would have made is. They reach a
 * row only as that argument, whenever and by whomever its callback is called:
 * nothing here outlives the call.
 */
export function ssrList(list, fn, asArray, keyFn, slot, rowFns) {
  if (list == null) list = [];
  const m = new Markup('', false, asArray);
  if (Array.isArray(list)) {
    const keys = keyFn ? list.map((item, i) => keyFn(item, i)) : null;
    if (asArray) m.keys = keys;
    // A keyed list's rows are keyed rows (what-core hydration-data.js
    // _enterRow): it takes its place where it starts, with no rows too, and
    // the components a row renders take theirs in that row.
    const rowList = keys !== null ? { keys, slot } : null;
    if (rowList !== null) defer(m, new RowEdge(rowList, undefined, 0, null));
    const outer = rows;
    rows = m;
    try {
      for (let i = 0; i < list.length; i++) {
        if (!(i in list)) continue;
        const at = rowList !== null ? /** @type {any[]} */ (m.p).length : 0;
        const before = deferred;
        const row = rowFns === undefined ? fn(list[i], i, list) : fn(rowFns, list[i], i, list);
        if (row !== WRITTEN) append(m, ssrText(row));
        if (rowList !== null && deferred !== before) keyRow(m, at, rowList, i);
      }
    } finally {
      rows = outer;
    }
  } else {
    // The source's own map() calls the callback, when it chooses to and with
    // what it chooses to pass: each call takes this list's functions first.
    const mapped = list.map(rowFns === undefined ? fn : (...args) => fn(rowFns, ...args));
    for (let i = 0; i < mapped.length; i++) append(m, ssrText(mapped[i]));
  }
  return finish(m);
}

// Row `index` of a keyed list, when its markup defers what may render a
// component (it added parts to `m` from `at` on, and not only reactive
// attributes, which render none): between the edges of a keyed row. A row of
// finished HTML renders no component, and needs none.
function keyRow(m, at, list, index) {
  const p = /** @type {any[]} */ (m.p);
  if (p.length === at) return;
  const end = new RowEdge(null, undefined, 0, null);
  // The row's start goes in before its parts, which move up one.
  for (let i = p.length; i > at; i--) p[i] = p[i - 1];
  p[at] = new RowEdge(list, list.keys[index], index, end);
  defer(m, end);
}

// The start of a keyed row of `list` (`key`, its `index` in the list's keys,
// and `end`, its end), the start of the list itself (no key, no end), or a
// row's end (no list), in compiled markup (what-core hydration-data.js
// _enterRow). `edge(frame, root)` runs it in the output of `frame`
// (undefined: the component rendering now): the stream calls it with the
// frame it renders the markup in, and a synchronous renderer reaches it
// through render().
class RowEdge extends Html {
  constructor(list, key, index, end) {
    super();
    this.list = list;
    this.key = key;
    this.index = index;
    this.end = end;
    this.saved = undefined;
    this.entered = false;
  }

  edge(frame, root) {
    if (this.list === null) {
      if (!this.entered) return;
      this.entered = false;
      _leaveRow(frame, root, this.saved);
      return;
    }
    const saved = _enterRow(frame, root, this.list, this.key, this.index);
    if (this.end !== null) {
      this.end.saved = saved;
      this.end.entered = true;
    }
  }

  render() {
    this.edge(undefined, getServerContext());
    return '';
  }

  parts() {
    return '';
  }

  childNs(ns) {
    return ns;
  }
}

/**
 * <For each key fallback>{(item, i) => row}</For>: the reactive child the DOM
 * back end lowers it to. It reads `each` when it is rendered and returns the
 * rows as a list, or the fallback when there are none. A keyed <For> (`key`,
 * its key function, or false) hands each row an accessor for its item, as the
 * compiled client does.
 */
export function ssrFor(each, fn, key, fallback, slot) {
  return () => {
    const list = typeof each === 'function' ? each() : each;
    if (!list || list.length === 0) return key ? emptyList(slot, fallback) : fallback;
    return ssrList(list, key ? (item, i) => fn(() => item, i) : fn, true, key, slot);
  };
}

// A keyed list with no rows, which takes its place (ssrList), and what shows
// in its stead.
function emptyList(slot, fallback) {
  const m = new Markup('', false, false);
  defer(m, new RowEdge({ keys: [], slot }, undefined, 0, null));
  append(m, ssrText(fallback));
  return finish(m);
}

// --- Components --------------------------------------------------------------

/**
 * `<Comp {...props}>children</Comp>`: a vnode, rendered where it is placed.
 * `site` is the number what-compiler gave the JSX, the DOM target's too
 * (what-core hydration-data.js _assignOwnerPath); null when it has none,
 * which still marks the vnode as compiled JSX's (stream.js takesSlot).
 */
export function ssrComponent(Comp, props, children, site) {
  const vnode = h(Comp, props, ...children);
  /** @type {any} */ (vnode)._site = site === undefined ? null : site;
  return vnode;
}

/**
 * `<Comp a={x} />`: ssrComponent() for a component with no children whose
 * props the compiler wrote as an object literal with no spread, so the object
 * is this call's own and holds no `key`. The renderer hands it to the
 * component as it is (html.js OWN_PROPS) instead of a copy. A tag name held
 * in a binding (`<Tag />` with `Tag = 'a'`) is an element, whose children a
 * `children` prop gives: ssrComponent().
 */
export function ssrLeaf(Comp, props, site) {
  if (typeof Comp !== 'function') return ssrComponent(Comp, props, [], site);
  const vnode = h(Comp, props === null ? {} : props);
  /** @type {any} */ (vnode).children = OWN_PROPS;
  /** @type {any} */ (vnode)._site = site === undefined ? null : site;
  return vnode;
}

/** `<>children</>`: a Fragment vnode, the h() spelling of the same JSX. */
export function ssrFragment(children) {
  return h(Fragment, null, ...children);
}

/** `<Comp client:mode />`: the island wrapper around the component, compiled JSX's as ssrComponent's is. */
export function ssrIsland(props, children) {
  const vnode = h(_$Island, props, ...children);
  /** @type {any} */ (vnode)._site = null;
  return vnode;
}

// --- Attributes ----------------------------------------------------------------
//
// An attribute hole is the value h()'s props object would hold, written as
// renderAttrs writes that name: its kind and name are fixed by the compiler
// and declared once with the template (ssrTemplate). A function value is a
// reactive attribute: it is called when the markup is placed, and a throw or a
// function result drops the attribute. false and null drop it, true writes the
// bare name.

const KINDS = { plain: 0, enum: 1, url: 2, class: 3, style: 4, refused: 5 };

const UNRESOLVED = Symbol('unresolved');

// What a reactive attribute's function gives when the markup is placed: a
// row's is called with the row's item.
function resolve(slot, fn, item) {
  let v;
  try {
    v = slot.at < 0 ? fn() : fn(item);
  } catch (e) {
    if (_isDevMode) {
      console.warn(`[what-server] Skipping attribute ${JSON.stringify(slot.name)}: its value threw during SSR: ${e.message}`);
    }
    return UNRESOLVED;
  }
  return typeof v === 'function' ? UNRESOLVED : v;
}

// ` name="value"`, the value escaped. An empty value is the slot's own string.
function quoted(slot, v) {
  if (v === '') return slot.empty;
  return slot.open + escapeHtml(typeof v === 'string' ? v : String(v)) + '"';
}

function attribute(slot, v) {
  if (v == null || v === UNRESOLVED) return '';
  switch (slot.kind) {
    case KINDS.enum:
      return quoted(slot, v);
    case KINDS.refused:
      if (v !== false && _isDevMode) console.warn(`[what-server] Skipping unsafe attribute in SSR: ${JSON.stringify(slot.name)}`);
      return '';
    case KINDS.class:
      return v === false ? '' : quoted(slot, v);
    case KINDS.style:
      if (v === false) return '';
      if (typeof v === 'object') return quoted(slot, styleText(v));
      return v === true ? ' style' : quoted(slot, v);
    case KINDS.url:
      if (v === false) return '';
      if (v === true) return ' ' + slot.name;
      return isUnsafeUrl(typeof v === 'string' ? v : String(v)) ? '' : quoted(slot, v);
    default:
      if (v === false) return '';
      return v === true ? ' ' + slot.name : quoted(slot, v);
  }
}

// One attribute hole of a template: its kind and name (a class slot's name is
// `class`, a style slot's `style`: what-compiler names a slot by the attribute
// it writes), and for a row's reactive attribute the index of its function
// among its list's (`at`; -1 for any other). Markup that defers a reactive
// attribute holds the slot and, right after it, the `n` values it is resolved
// from: the function, and for a row's the row's item.
class AttrSlot extends Html {
  constructor(kind, name, at) {
    super();
    this.kind = kind;
    this.name = name;
    this.at = at;
    this.n = at < 0 ? 1 : 2;
    // What every value of it is written between, and an empty one whole.
    this.open = ' ' + name + '="';
    this.empty = this.open + '"';
  }

  // The attribute, from what follows the slot at `i` in the parts `p`.
  take(p, i) {
    return attribute(this, resolve(this, p[i + 1], this.at < 0 ? undefined : p[i + 2]));
  }
}

// A reactive attribute on its own, as parts() gives it: its slot and where
// its function (and its row's item) stand in the markup's parts.
class Attr extends Html {
  constructor(slot, p, i) {
    super();
    this.slot = slot;
    this.p = p;
    this.i = i;
  }

  render(renderChild, hk) {
    return keyed(hk, this.parts());
  }

  parts() {
    return this.slot.take(this.p, this.i);
  }

  childNs(ns) {
    return ns;
  }
}

/**
 * A template's strings, with its attribute holes declared: `slots` holds, per
 * hole, null for a child or [kind, name] for an attribute, kind being one of
 * plain, enum (aria-*, role, data-*), url (scheme-checked), class, style and
 * refused (srcdoc, outerHTML: never written). [kind, name, at] is a row's
 * reactive attribute, whose function is its list's `at`-th (ssrList's
 * `rowFns`) and whose hole is the row's item. A template that declares one is
 * filled with its list's row functions before its holes (`fns`: ssr).
 */
export function ssrTemplate(strings, slots) {
  let fns = false;
  /** @type {any} */ (strings).slots = slots.map((slot) => {
    if (slot === null) return null;
    if (slot.length > 2) fns = true;
    return new AttrSlot(KINDS[slot[0]], slot[1], slot.length > 2 ? slot[2] : -1);
  });
  /** @type {any} */ (strings).fns = fns;
  return strings;
}

function attributeHole(m, slot, v) {
  if (typeof v === 'function') deferAttribute(m, slot, v);
  else addHtml(m, attribute(slot, v));
}

// --- Elements decided at run time ------------------------------------------------

// An element whose attributes are only known when it is placed: a spread, a
// classList, innerHTML or dangerouslySetInnerHTML, a form field's value or
// default (what-server's _field shows one of them), and every <option>, whose
// mark the select it is placed in decides (html.js Options). `props` is the
// object the h() spelling would build, rendered by renderAttrs and
// _resolveInnerHTML with the checks a vnode gets; `children` is the compiled
// content (Markup or null), used unless innerHTML replaces it, or, for an
// option whose text is its value and the elements inside one, the h()
// children it would be handed (ssrElement), so the renderer writes their text
// as text.
class Element extends Html {
  constructor(tag, props, children) {
    super();
    this.tag = tag;
    this.props = props;
    this.children = children;
  }

  render(renderChild, hk, ns) {
    const { tag, props } = this;
    if (tag === 'option' && ns === null) {
      const option = _renderOption(props, (html) => keyed(hk, html), () => this.content(renderChild, hk, ns, null));
      if (option !== null) return option;
    }
    const field = _field(tag, props);
    const open = keyed(hk, '<' + tag + renderAttrs(field ? field.props : props) + '>');
    if (VOID_ELEMENTS.has(tag)) return open;
    const inner = _resolveInnerHTML(props);
    if (inner != null) return open + keyed(hk, String(inner)) + keyed(hk, '</' + tag + '>');
    return open + _afterOpen(tag, ns) + this.content(renderChild, hk, ns, field) + keyed(hk, '</' + tag + '>');
  }

  // An option's content is its inner HTML too.
  content(renderChild, hk, ns, field) {
    const { tag, props, children } = this;
    if (field === null) {
      const inner = _resolveInnerHTML(props);
      if (inner != null) return keyed(hk, String(inner));
    }
    if (field && field.text !== null) return escapeHtml(field.text);
    if (children === null) return '';
    if (tag !== 'select' || ns !== null) return renderContent(children, renderChild, hk, ns);
    const outer = _enterSelect(field);
    try {
      return renderContent(children, renderChild, hk, ns);
    } finally {
      _leaveSelect(outer);
    }
  }

  // A select, an option and an element with h() children go to the stream as
  // ElementParts, which it places as it places a vnode element.
  parts(ns) {
    const { tag, props, children } = this;
    if (ns === null && (tag === 'option' || tag === 'select' || Array.isArray(children))) {
      return [new ElementParts(tag, props, children === null ? [] : Array.isArray(children) ? children : [children])];
    }
    const field = _field(tag, props);
    const open = '<' + tag + renderAttrs(field ? field.props : props) + '>';
    if (VOID_ELEMENTS.has(tag)) return open;
    const inner = _resolveInnerHTML(props);
    if (inner != null) return open + String(inner) + '</' + tag + '>';
    const head = open + _afterOpen(tag, ns);
    const content = field && field.text !== null ? escapeHtml(field.text) : children === null ? '' : children.parts(ns);
    if (typeof content !== 'string') return [head, ...content, '</' + tag + '>'];
    return head + content + '</' + tag + '>';
  }

  childNs(ns) {
    return this.children === null || Array.isArray(this.children) ? ns : this.children.childNs(ns);
  }

  rootTag() {
    return this.tag;
  }
}

function renderContent(children, renderChild, hk, ns) {
  if (!Array.isArray(children)) return children.render(renderChild, hk, ns);
  let html = '';
  for (let i = 0; i < children.length; i++) html += renderChild(children[i], ns);
  return html;
}

/**
 * An element whose markup is decided where it is placed (see Element). An
 * array of children is the h() children the compiler hands it, collected as
 * h() flattens them: text stays the text it is.
 */
export function ssrElement(tag, props, children) {
  if (!Array.isArray(children)) return new Element(tag, props, children);
  const list = [];
  collect(children, list);
  return new Element(tag, props, list);
}

// The text of a <script> or <style>: written raw in HTML and escaped in SVG or
// MathML, which is only known where the markup is placed. The pieces are
// collected as h() collects children, so what is rendered is what the h()
// spelling renders.
class RawText extends Html {
  constructor(tag, children) {
    super();
    this.tag = tag;
    this.children = children;
  }

  render(renderChild, hk, ns) {
    return keyed(hk, _rawText(this.tag, this.children, ns));
  }

  parts(ns) {
    return _rawText(this.tag, this.children, ns);
  }

  childNs(ns) {
    return ns;
  }

}

function collect(value, out) {
  if (value == null || typeof value === 'boolean') return;
  if (typeof value === 'symbol') {
    _symbolChild(value, 'server');
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) collect(value[i], out);
  } else if (typeof value === 'function' || isVNode(value) || isHtml(value) || (typeof value === 'object' && typeof value.nodeType === 'number')) {
    out.push(value);
  } else {
    out.push(String(value));
  }
}

/**
 * The children of a <script> or <style> whose text is not fixed, or not the
 * same in every namespace, or of a <textarea> or <title> that are not all
 * fixed: the compiler's static strings, plain values and reactive thunks, in
 * order. A <textarea>'s or <title>'s text that is known now is escaped now,
 * the same in every namespace, so the markup around it stays finished HTML.
 */
export function ssrRawText(tag, pieces) {
  const children = [];
  collect(pieces, children);
  if (TEXT_ONLY_ELEMENTS.has(tag) && children.every((c) => typeof c === 'string')) return escapeHtml(children.join(''));
  return new RawText(tag, children);
}
