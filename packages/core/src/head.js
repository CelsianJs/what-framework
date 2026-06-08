// What Framework - Head Management
// Declarative <head> updates from any component.
// Supports title, meta, link tags. Auto-deduplicates by key.
//
// Isomorphic: on the client it mutates document.head directly (last-one-wins);
// on the server it writes into the active render context's head sink (see
// server-context.js), which renderToStringWithHead serializes into <head> HTML.
// The server and client use IDENTICAL dedup keys so the rendered head matches
// what the client would produce — no hydration mismatch.

import { getServerContext } from './server-context.js';

const headState = {
  title: null,
  metas: new Map(),
  links: new Map(),
};

// --- Head component ---
// Use in any component to set head tags. Last one wins for title/meta.

export function Head({ title, meta, link, children }) {
  if (typeof document === 'undefined') {
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

function renderHeadTag(tag, attrs) {
  let s = `<${tag}`;
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    const name = k === 'httpEquiv' ? 'http-equiv' : k;
    s += ` ${name}="${escapeHtml(String(v))}"`;
  }
  return s + '>';
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Client DOM helpers ---

function setHeadTag(tag, key, attrs) {
  const existing = document.head.querySelector(`[data-what-head="${key}"]`);
  if (existing) {
    updateElement(existing, attrs);
    return;
  }

  const el = document.createElement(tag);
  el.setAttribute('data-what-head', key);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  document.head.appendChild(el);
}

function updateElement(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (el.getAttribute(k) !== v) {
      el.setAttribute(k, v);
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
