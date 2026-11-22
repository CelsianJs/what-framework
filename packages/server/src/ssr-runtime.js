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
import { isVNode } from 'what-core/internal';
import { TEXT_ONLY_ELEMENTS, isUnsafeUrl } from 'what-core/internal/markup-rules';
import { _afterOpen, _enterSelect, _field, _isDevMode, _leaveSelect, _rawText, _renderOption, _resolveInnerHTML, ElementParts, escapeHtml, renderAttrs, styleText, VOID_ELEMENTS } from './html.js';
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
    // HTML strings and, between them, the thunks, vnodes and Html rendered on
    // placement. Null when there are none.
    /** @type {any[] | null} */
    this.p = null;
    // It holds SVG or MathML, so what it defers may sit in foreign content.
    this.f = f;
    // The rows of a .map() a reactive child returned: the array h()'s thunk
    // would have returned, so the hydratable renderer brackets it as a list.
    this.list = list;
    // A keyed list's rows' keys, written after its opening marker (rowKeys).
    this.keys = '';
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
      else if (part instanceof AttrSlot) html += part.write(p[++i]);
      else html += part.render(renderChild, hk, partNs);
    }
    return html;
  }

  // The same for a hydratable renderer: list markers, and every string fed to
  // the pending hydration key while there is one.
  renderKeyed(renderChild, hk, ns) {
    let html = this.list ? keyed(hk, ARRAY_OPEN) + this.keys : '';
    html += keyed(hk, this.h);
    if (this.s !== null) html += keyed(hk, this.s);
    else {
      const partNs = this.childNs(ns);
      const p = /** @type {any[]} */ (this.p);
      for (let i = 0; i < p.length; i++) {
        const part = p[i];
        if (typeof part === 'string') html += keyed(hk, part);
        else if (typeof part !== 'object' || part === null || !isHtml(part)) html += renderChild(part, partNs);
        else if (part instanceof AttrSlot) html += keyed(hk, part.write(p[++i]));
        else html += part.render(renderChild, hk, partNs);
      }
    }
    return this.list ? html + keyed(hk, ARRAY_CLOSE) : html;
  }

  // The stream renders hydratable markup, list markers included.
  parts() {
    if (this.s !== null) return this.list ? ARRAY_OPEN + this.keys + this.h + this.s + ARRAY_CLOSE : this.h + this.s;
    const p = /** @type {any[]} */ (this.p);
    const parts = this.list ? [ARRAY_OPEN + this.keys] : [];
    if (this.h) parts.push(this.h);
    for (let i = 0; i < p.length; i++) {
      const part = p[i];
      parts.push(typeof part === 'object' && part !== null && Html.is(part) && part instanceof AttrSlot ? new Attr(part, p[++i]) : part);
    }
    if (this.list) parts.push(ARRAY_CLOSE);
    return parts;
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

// Building Markup: `m.s` is the HTML after the head while it is built.
function isEmpty(m) {
  return m.h === '' && m.s === '' && m.p === null;
}

function addHtml(m, html) {
  if (isEmpty(m)) m.h = html;
  else m.s += html;
}

function append(m, hole) {
  if (typeof hole === 'string') addHtml(m, hole);
  else if (typeof hole === 'object' && hole !== null && Html.is(hole) && hole instanceof Markup) inline(m, hole);
  else defer(m, hole);
}

function defer(m, item) {
  if (m.p === null) m.p = [];
  if (m.s) m.p.push(m.s);
  m.s = '';
  m.p.push(item);
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
    else defer(m, part);
  }
}

function finish(m) {
  if (m.p !== null) {
    if (m.s) m.p.push(m.s);
    m.s = null;
  }
  return m;
}

function fill(m, t, args) {
  const slots = t.slots;
  for (let i = 1; i < args.length; i++) {
    const slot = slots === undefined ? null : slots[i - 1];
    if (slot === null) append(m, args[i]);
    else attributeHole(m, slot, args[i]);
    m.s += t[i];
  }
}

/** A template: static strings `t`, filled with the holes passed after it. */
export function ssr(t) {
  const m = new Markup(t[0], false, false);
  fill(m, t, arguments);
  return finish(m);
}

/** ssr() for a template holding SVG or MathML elements. */
export function ssrForeign(t) {
  const m = new Markup(t[0], true, false);
  fill(m, t, arguments);
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
  if (m === null) {
    const markup = new Markup(t[0], false, false);
    fill(markup, t, arguments);
    return finish(markup);
  }
  addHtml(m, t[0]);
  fill(m, t, arguments);
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
 * gives its rows' keys, written with its markers.
 */
export function ssrList(list, fn, asArray, keyFn) {
  if (list == null) list = [];
  const m = new Markup('', false, asArray);
  if (asArray && keyFn && Array.isArray(list)) m.keys = rowKeys(list.map((item) => keyFn(item)));
  if (Array.isArray(list)) {
    const outer = rows;
    rows = m;
    try {
      for (let i = 0; i < list.length; i++) {
        if (!(i in list)) continue;
        const row = fn(list[i], i, list);
        if (row !== WRITTEN) append(m, ssrText(row));
      }
    } finally {
      rows = outer;
    }
  } else {
    const mapped = list.map(fn);
    for (let i = 0; i < mapped.length; i++) append(m, ssrText(mapped[i]));
  }
  return finish(m);
}

/**
 * <For each key fallback>{(item, i) => row}</For>: the reactive child the DOM
 * back end lowers it to. It reads `each` when it is rendered and returns the
 * rows as a list, or the fallback when there are none. A keyed <For> (`key`,
 * its key function, or false) hands each row an accessor for its item, as the
 * compiled client does.
 */
export function ssrFor(each, fn, key, fallback) {
  return () => {
    const list = typeof each === 'function' ? each() : each;
    if (!list || list.length === 0) return fallback;
    return ssrList(list, key ? (item, i) => fn(() => item, i) : fn, true, key);
  };
}

// --- Components --------------------------------------------------------------

/** `<Comp {...props}>children</Comp>`: a vnode, rendered where it is placed. */
export function ssrComponent(Comp, props, children) {
  return h(Comp, props, ...children);
}

/** `<>children</>`: a Fragment vnode, the h() spelling of the same JSX. */
export function ssrFragment(children) {
  return h(Fragment, null, ...children);
}

/** `<Comp client:mode />`: the island wrapper around the component. */
export function ssrIsland(props, children) {
  return h(_$Island, props, ...children);
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

function resolve(name, fn) {
  let v;
  try {
    v = fn();
  } catch (e) {
    if (_isDevMode) {
      console.warn(`[what-server] Skipping attribute ${JSON.stringify(name)}: its value threw during SSR: ${e.message}`);
    }
    return UNRESOLVED;
  }
  return typeof v === 'function' ? UNRESOLVED : v;
}

function quoted(name, v) {
  return ' ' + name + '="' + escapeHtml(typeof v === 'string' ? v : String(v)) + '"';
}

function attribute(kind, name, v) {
  if (v == null || v === UNRESOLVED) return '';
  switch (kind) {
    case KINDS.enum:
      return quoted(name, v);
    case KINDS.refused:
      if (v !== false && _isDevMode) console.warn(`[what-server] Skipping unsafe attribute in SSR: ${JSON.stringify(name)}`);
      return '';
    case KINDS.class:
      return v === false ? '' : quoted('class', v);
    case KINDS.style:
      if (v === false) return '';
      if (typeof v === 'object') return quoted('style', styleText(v));
      return v === true ? ' style' : quoted('style', v);
    case KINDS.url:
      if (v === false) return '';
      if (v === true) return ' ' + name;
      return isUnsafeUrl(typeof v === 'string' ? v : String(v)) ? '' : quoted(name, v);
    default:
      if (v === false) return '';
      return v === true ? ' ' + name : quoted(name, v);
  }
}

// One attribute hole of a template: its kind and name. Markup that defers a
// reactive attribute holds the slot and, right after it, the function.
class AttrSlot extends Html {
  constructor(kind, name) {
    super();
    this.kind = kind;
    this.name = name;
  }

  write(fn) {
    return attribute(this.kind, this.name, resolve(this.name, fn));
  }
}

// A reactive attribute on its own, as the stream takes it off its work stack.
class Attr extends Html {
  constructor(slot, fn) {
    super();
    this.slot = slot;
    this.fn = fn;
  }

  render(renderChild, hk) {
    return keyed(hk, this.parts());
  }

  parts() {
    return this.slot.write(this.fn);
  }

  childNs(ns) {
    return ns;
  }
}

/**
 * A template's strings, with its attribute holes declared: `slots` holds, per
 * hole, null for a child or [kind, name] for an attribute, kind being one of
 * plain, enum (aria-*, role, data-*), url (scheme-checked), class, style and
 * refused (srcdoc, outerHTML: never written).
 */
export function ssrTemplate(strings, slots) {
  /** @type {any} */ (strings).slots = slots.map((slot) => (slot === null ? null : new AttrSlot(KINDS[slot[0]], slot[1])));
  return strings;
}

function attributeHole(m, slot, v) {
  if (typeof v === 'function') {
    defer(m, slot);
    /** @type {any[]} */ (m.p).push(v);
  } else {
    addHtml(m, attribute(slot.kind, slot.name, v));
  }
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
