// What Framework - Head Management
// Declarative <head> updates from any component.
// Supports title, meta, link tags. Auto-deduplicates by key.
//
// Isomorphic: on the client it mutates document.head directly (last-one-wins);
// on the server it writes into the active render context's head sink (see
// server-context.js), which renderToStringWithHead serializes into <head> HTML.
// The server and client use IDENTICAL dedup keys so the rendered head matches
// what the client would produce — no hydration mismatch.

import { getServerContext, isServerRender } from './server-context.js';
import { SAFE_ATTR_NAME, escapeHtml } from './markup-rules.js';
import { isVNode } from './vnode-renderer.js';

const headState = {
  title: null,
  metas: new Map(),
  links: new Map(),
};

// --- Head component ---
// Use in any component to set head tags. Last one wins for title/meta.

export function Head(props) {
  const { title, meta, link, children } = readHeadChildren(props);
  // Decided by the render scope, not by `typeof document`: under a DOM shim
  // (jsdom, happy-dom, a Workers polyfill) a server render would otherwise
  // write one request's title into the process-wide document and send a page
  // with no <title>.
  if (isServerRender()) {
    // Server: collect into the active render context's sink (if a render is
    // collecting head). No active context => no-op (renderToString body-only).
    const ctx = getServerContext();
    if (ctx && ctx.head) writeToSink(ctx.head, { title, meta, link });
    return children ?? null;
  }

  if (title) {
    document.title = title;
    headState.title = title;
  }

  if (meta) {
    for (const attrs of (Array.isArray(meta) ? meta : [meta])) {
      const key = attrs.name || attrs.property || attrs.httpEquiv || JSON.stringify(attrs);
      setHeadTag('meta', key, attrs);
    }
  }

  if (link) {
    for (const attrs of (Array.isArray(link) ? link : [link])) {
      const key = attrs.rel + (attrs.href || '');
      setHeadTag('link', key, attrs);
    }
  }

  return children || null;
}

// --- Head children ---
// <title>, <meta> and <link> children are the props they spell, as React 19
// hoists the same three: <Head><title>Hi</title></Head> sets the title, and a
// child shares the props' dedup keys (later wins, so a child beats a prop of
// the same Head). Any other child renders in place. A child is an h() or
// JSX-runtime vnode, a DOM element (compiled JSX), or in a server render the
// markup of what-compiler's server target (what-server's ssr-runtime).

function readHeadChildren({ title, meta, link, children }) {
  const found = { title, meta: toList(meta), link: toList(link), rest: [] };
  collectHeadChildren(children, found);
  const { rest } = found;
  return { title: found.title, meta: found.meta, link: found.link, children: rest.length > 1 ? rest : rest[0] };
}

function toList(value) {
  return value == null ? [] : Array.isArray(value) ? [...value] : [value];
}

function collectHeadChildren(child, found) {
  if (child == null || typeof child === 'boolean') return;
  if (Array.isArray(child)) {
    for (const c of child) collectHeadChildren(c, found);
    return;
  }
  const tag = readHeadTag(child);
  if (tag === null) found.rest.push(child);
  else if (tag.name === 'title') found.title = tag.text;
  else found[tag.name].push(tag.attrs);
}

/** @returns {{ name: string, attrs: Record<string, any>, text: string } | null} */
function readHeadTag(child) {
  if (typeof child !== 'object') return null;
  if (isServerMarkup(child)) return readHeadMarkup(child.parts(null));
  if (isVNode(child) && typeof child.tag === 'string') {
    if (!isHeadTag(child.tag)) return null;
    const attrs = {};
    for (const [k, v] of Object.entries(child.props || {})) {
      if (k !== 'children' && k !== 'ref') attrs[propName(k)] = typeof v === 'function' ? v() : v;
    }
    return { name: child.tag, attrs, text: textOf(child.children) };
  }
  if (child.nodeType === 1 && isHeadTag(child.localName)) {
    const attrs = {};
    for (const a of child.attributes) attrs[propName(a.name)] = a.value;
    return { name: child.localName, attrs, text: child.textContent };
  }
  return null;
}

function isHeadTag(name) {
  return name === 'title' || name === 'meta' || name === 'link';
}

// The props spell http-equiv as httpEquiv, and metaKey() reads that spelling.
function propName(name) {
  return name === 'http-equiv' ? 'httpEquiv' : name;
}

function textOf(value) {
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'function') return textOf(value());
  if (Array.isArray(value)) return value.map(textOf).join('');
  return String(value);
}

// Markup is compiled JSX only when one of what-server's brand checks
// recognises it (packages/server/src/compiled.js keeps them in this
// process-wide set), so an object that merely looks like markup is a child.
const HTML_CHECKS = Symbol.for('what-server.html.v2');

function isServerMarkup(value) {
  const checks = /** @type {any} */ (globalThis)[HTML_CHECKS];
  if (checks === undefined) return false;
  for (const is of checks) if (is(value)) return true;
  return false;
}

// The server target compiles <title>, <meta> and <link> to markup it escaped
// and quoted itself, so one tag with double-quoted attributes is all there is
// to read. Its parts are one string unless it holds something rendered on
// placement (a reactive child, a component), which renders in place.
const TITLE_MARKUP = /^<title>([^<]*)<\/title>$/;
const VOID_MARKUP = /^<(meta|link)((?:\s[^>]*)?)>$/;
const ATTR_MARKUP = /\s([^\s="'>/]+)(?:="([^"]*)")?/g;

function readHeadMarkup(markup) {
  if (typeof markup !== 'string') return null;
  const title = TITLE_MARKUP.exec(markup);
  if (title) return { name: 'title', attrs: {}, text: unescapeHtml(title[1]) };
  const tag = VOID_MARKUP.exec(markup);
  if (!tag) return null;
  const attrs = {};
  for (const [, name, value] of tag[2].matchAll(ATTR_MARKUP)) attrs[propName(name)] = unescapeHtml(value ?? '');
  return { name: tag[1], attrs, text: '' };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

function unescapeHtml(str) {
  return str.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ENTITIES[e]);
}

// --- Server-side head collection ---

function metaKey(attrs) {
  return attrs.name || attrs.property || attrs.httpEquiv || JSON.stringify(attrs);
}

function writeToSink(sink, { title, meta, link }) {
  if (title != null) sink.title = title;
  if (meta) {
    for (const attrs of (Array.isArray(meta) ? meta : [meta])) {
      sink.metas.set(metaKey(attrs), attrs);
    }
  }
  if (link) {
    for (const attrs of (Array.isArray(link) ? link : [link])) {
      sink.links.set(attrs.rel + (attrs.href || ''), attrs);
    }
  }
}

/** Create a fresh head sink for one render. */
export function beginHeadCollection() {
  return { title: null, metas: new Map(), links: new Map() };
}

/** Serialize a head sink into escaped <head> HTML (title + meta + link). */
export function endHeadCollection(sink) {
  if (!sink) return '';
  let out = '';
  if (sink.title != null) out += `<title>${escapeHtml(String(sink.title))}</title>`;
  for (const attrs of sink.metas.values()) out += renderHeadTag('meta', attrs);
  for (const attrs of sink.links.values()) out += renderHeadTag('link', attrs);
  return out;
}

// Head attributes usually come from CMS/SEO data, so attribute NAMES must be
// validated, not merely escaped: a key of `x" onload="alert(1)` would otherwise
// break out of the quoted value and inject a live handler. what-server's name
// rule, plus a case-insensitive `on*` refusal so `onLoad` cannot slip past an
// uppercase-tolerant name pattern.
function isSafeAttrName(name) {
  if (!SAFE_ATTR_NAME.test(name)) return false;
  const lower = name.toLowerCase();
  return !(lower.startsWith('on') && lower.length > 2);
}

function attrName(key) {
  return key === 'httpEquiv' ? 'http-equiv' : key;
}

function renderHeadTag(tag, attrs) {
  let s = `<${tag}`;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    const name = attrName(k);
    if (!isSafeAttrName(name)) continue;
    s += ` ${name}="${escapeHtml(String(v))}"`;
  }
  return s + '>';
}

// --- Client DOM helpers ---

// Dedup keys come from user-supplied attrs (and fall back to JSON.stringify,
// which always contains quotes), so they cannot go into a selector raw: an
// unescaped one throws DOMException and takes all head management with it.
function escapeSelectorValue(key) {
  const s = String(key);
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s);
  // `c` is a single matched code unit, so codePointAt(0) is always defined.
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${/** @type {number} */ (c.codePointAt(0)).toString(16)} `);
}

function setHeadTag(tag, key, attrs) {
  const existing = document.head.querySelector(`[data-what-head="${escapeSelectorValue(key)}"]`)
    || serverTag(tag, attrs);
  if (existing) {
    existing.setAttribute('data-what-head', key);
    updateElement(existing, attrs);
    return;
  }

  const el = document.createElement(tag);
  el.setAttribute('data-what-head', key);
  for (const [k, v] of Object.entries(attrs)) {
    if (!isSafeAttrName(attrName(k))) continue;
    el.setAttribute(attrName(k), v);
  }
  document.head.appendChild(el);
}

// The tag the server already wrote for these attributes, if it did: a
// server-rendered document (renderToStringWithHead, renderDocument) and a
// streamed boundary's late head carry no data-what-head, so a client <Head>
// that only looked for it added a second copy of every tag when the page
// hydrated. The identity is the one the server deduplicates by (writeToSink)
// and the streamed head is applied with: a meta's name, property or
// http-equiv, a link's rel and href, and for any other meta all of its
// attributes.
function serverTag(tag, attrs) {
  for (let el = document.head.firstElementChild; el; el = el.nextElementSibling) {
    if (el.localName === tag && !el.hasAttribute('data-what-head') && sameTag(tag, el, attrs)) return el;
  }
  return null;
}

function sameTag(tag, el, attrs) {
  if (tag === 'link') {
    return el.getAttribute('rel') === String(attrs.rel)
      && el.getAttribute('href') === (attrs.href == null ? null : String(attrs.href));
  }
  if (attrs.name) return el.getAttribute('name') === String(attrs.name);
  if (attrs.property) return el.getAttribute('property') === String(attrs.property);
  if (attrs.httpEquiv) return el.getAttribute('http-equiv') === String(attrs.httpEquiv);
  const written = Object.entries(attrs).filter(([k, v]) => v != null && v !== false && isSafeAttrName(attrName(k)));
  return el.attributes.length === written.length
    && written.every(([k, v]) => el.getAttribute(attrName(k)) === String(v));
}

function updateElement(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    const name = attrName(k);
    if (!isSafeAttrName(name)) continue;
    if (el.getAttribute(name) !== v) {
      el.setAttribute(name, v);
    }
  }
}

// --- Cleanup: remove head tags added by What ---
export function clearHead() {
  const tags = document.head.querySelectorAll('[data-what-head]');
  for (const tag of tags) tag.remove();
  headState.metas.clear();
  headState.links.clear();
}
