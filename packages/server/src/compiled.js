// What Framework - Server: how trusted markup is told apart from data.
//
// A string is always text. HTML that what-compiler's server target produced
// travels as an object whose class extends Html (ssr-runtime.js), and every
// renderer writes an object as markup only when isHtml() says it is one. The
// brand is a private class field, so nothing built outside this module can
// carry it: not JSON, not structuredClone, not a store proxy, not a Proxy that
// answers every property (`#brand in proxy` never consults its traps).
//
// The package can be loaded twice in one process: dist/index.min.js bundles
// its own copy of this module beside dist/ssr-runtime.min.js, which compiled
// output imports. Each copy adds its brand check to one process-wide set, so
// every copy recognises the others' markup. The set's key names the version of
// the protocol below; a copy speaking another one is not trusted.
//
// The protocol every Html implements:
//   render(renderChild, hk, ns)  its HTML, for a synchronous renderer.
//       renderChild(child, ns, notHtml) renders a child the way the renderer
//       renders it; `notHtml` true says the caller found the child is not
//       Html (isHtml), so the renderer need not ask again, and leaving it out
//       only costs that question; hk is null for a plain render and, for a hydratable one, holds
//       the hydration key the next element takes (hk.key, or null); ns is the
//       namespace the markup sits in (null for HTML, see what-core's
//       childNamespace).
//   parts(ns)       for the stream: its HTML as a string, or an array of
//                   HTML strings and the children and Html between them.
//   childNs(ns)     the namespace the items of that array sit in.
//   rootTag()       the name of the element it opens with, or null, read
//                   without rendering anything (what-core's <Head> uses it).
//   edge(frame, root)  only on the start or end of a keyed row (ssr-runtime's
//                   RowEdge), which renders no HTML: the stream calls it in
//                   the frame it renders the markup in, in place of parts().
//   pour(put, seg, from, frame, root, skip)  optional, with held(at): the
//                   stream's way through parts() without the array. It calls
//                   put(seg, html) for its HTML from part `from` on, resolves
//                   what needs no renderer where it stands (a reactive
//                   attribute, a keyed row's edge, in `frame` and `root` as
//                   edge() takes them), and returns the index of the first
//                   part the stream has to render, which held(index) gives,
//                   or -1 once it is done. With `skip`, it writes the HTML
//                   and runs the edges only: the rest of markup whose
//                   component failed.

import { _renderSalt, _rowKeyDigest } from 'what-core/internal';

export class Html {
  #brand;

  static is(value) {
    return #brand in value;
  }

  // Markup is not data: a component prop holding JSX is left out of the JSON
  // an island's props are sent in, as a function is.
  toJSON() {
    return undefined;
  }

  /** @returns {string | null} */
  rootTag() {
    return null;
  }
}

const checks = /** @type {Set<(value: object) => boolean>} */ (
  /** @type {any} */ (globalThis)[Symbol.for('what-server.html.v3')] ??= new Set()
);
checks.add(Html.is);

/** Whether `value` is compiled markup made by this or another copy of what-server. */
export function isHtml(value) {
  if (typeof value !== 'object' || value === null) return false;
  return Html.is(value) || isForeignHtml(value);
}

/** Whether `value`, an object this copy's Html.is refused, is compiled markup made by another copy. */
export function isForeignHtml(value) {
  if (checks.size > 1) {
    for (const is of checks) if (is !== Html.is && is(value)) return true;
  }
  return false;
}

// --- Hydration keys and markers ---------------------------------------------
//
// The hydration protocol a hydratable render writes (renderToHydratableString
// and the stream, from h() trees and compiled markup alike) and what-core's
// hydrate() reads:
//
//   data-hk="PATH"   a component's owner path (what-core hydration-data.js),
//                    on the first element of its output when its output
//                    begins with one; of components that begin at the same
//                    element, the innermost owns it.
//   <!--$-->…<!--/$-->     a reactive child (a thunk, a signal, a keyed list)
//   <!--[]-->…<!--/[]-->   an array a reactive child or a component returned
//   <!--k:…-->             right after a keyed list's <!--[]-->: the
//                          render's salt and a digest of each row's key
//                          (rowKeys), so hydrate() takes each server row as
//                          the row of its key; <!--k!--> when a key is one
//                          hydrate() cannot compare, so it takes none
//   <!--b-->…<!--/b-->     an <ErrorBoundary> or <Suspense> showing its
//                          children; <!--b!--> opens one showing its fallback
//
// While a component's key is pending, the first chunk written settles it:
// placed when that chunk opens an element, dropped otherwise. `hk.key` is the
// pending key, or null.

export const REGION_OPEN = '<!--$-->';
export const REGION_CLOSE = '<!--/$-->';
export const ARRAY_OPEN = '<!--[]-->';
export const ARRAY_CLOSE = '<!--/[]-->';
export const BOUNDARY_OPEN = '<!--b-->';
export const BOUNDARY_FALLBACK = '<!--b!-->';
export const BOUNDARY_CLOSE = '<!--/b-->';

/**
 * The comment a keyed list writes after its opening marker,
 * <!--k:SALT:DIGESTS-->: the render's random salt, then a digest of each
 * row's key under it (what-core's _rowKeyDigest, which hydrate() computes for
 * the client's keys), eleven characters each, so the page carries no key
 * itself and no digest of it can be computed before the render. A key with
 * little entropy (a small integer id) can still be confirmed by guessing
 * against a page's salt. Keys are strings and finite numbers. A list with any
 * other key (NaN, an object, a boolean, null) writes <!--k!--> instead: no
 * server row can be told by its key, so hydrate() takes none of them and the
 * client builds the list.
 *
 * A hydratable renderer calls it where it writes the list: a plain render
 * computes no digest.
 */
export function rowKeys(keys) {
  const salt = _renderSalt();
  // The text a digest is taken of is the salt, the key's type, then the key.
  // A salt is eleven digits, so the salt and the type are whole words of the
  // hash: they are absorbed once for the list, not once for each row.
  const lead = salt.length + 1;
  if (lead & 1) return rowKeysOf(keys, salt);
  const count = keys.length;
  const out = new Uint8Array(count * DIGEST_LENGTH);
  /** @type {number[] | null} */
  let strings = null;
  /** @type {number[] | null} */
  let numbers = null;
  for (let i = 0; i < count; i++) {
    const key = keys[i];
    let state;
    if (typeof key === 'string') state = strings ??= absorbed(salt + 's');
    else if (typeof key === 'number' && Number.isFinite(key)) state = numbers ??= absorbed(salt + 'n');
    else return '<!--k!-->';
    digest(state, '' + key, lead, out, i * DIGEST_LENGTH);
  }
  return '<!--k:' + salt + ':' + ASCII.decode(out) + '-->';
}

// The same comment, one _rowKeyDigest call for each key.
function rowKeysOf(keys, salt) {
  let digests = '';
  for (const key of keys) {
    const digest = _rowKeyDigest(key, salt);
    if (digest === null) return '<!--k!-->';
    digests += digest;
  }
  return `<!--k:${salt}:${digests}-->`;
}

// what-core's _rowKeyDigest (render.js), which is the definition: a 64-bit
// HalfSipHash-2-4 with a zero key, a word being two UTF-16 code units, written
// in eleven digits of six bits. This is the same function over the same text,
// with the state in local variables, the words the keys of a list share
// absorbed once (absorbed), and the digits written as bytes into one buffer
// for the list; row-key-digest.test.js holds the two equal.
const DIGEST_LENGTH = 11;
const DIGITS = new Uint8Array(64);
for (let i = 0; i < 64; i++) {
  DIGITS[i] = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_.'.charCodeAt(i);
}
const ASCII = new TextDecoder();

// The hash's state after the words of `text`, whose length is even.
function absorbed(text) {
  let v0 = 0, v1 = 0xee, v2 = 0x6c796765, v3 = 0x74656462;
  for (let i = 0; i < text.length; i += 2) {
    const m = text.charCodeAt(i) | (text.charCodeAt(i + 1) << 16);
    v3 ^= m;
    for (let r = 0; r < 2; r++) {
      v0 = (v0 + v1) | 0; v1 = (v1 << 5) | (v1 >>> 27); v1 ^= v0; v0 = (v0 << 16) | (v0 >>> 16);
      v2 = (v2 + v3) | 0; v3 = (v3 << 8) | (v3 >>> 24); v3 ^= v2;
      v0 = (v0 + v3) | 0; v3 = (v3 << 7) | (v3 >>> 25); v3 ^= v0;
      v2 = (v2 + v1) | 0; v1 = (v1 << 13) | (v1 >>> 19); v1 ^= v2; v2 = (v2 << 16) | (v2 >>> 16);
    }
    v0 ^= m;
  }
  return [v0, v1, v2, v3];
}

// The digest of the text that goes on from `state` (absorbed) with `text`,
// `lead` code units before it: eleven digits written to `out` at `at`.
function digest(state, text, lead, out, at) {
  let v0 = state[0], v1 = state[1], v2 = state[2], v3 = state[3];
  const length = text.length;
  const end = length & ~1;
  // The words of the text, then the last one: its length and its odd unit.
  for (let i = 0; i <= end; i += 2) {
    const m = i < end
      ? text.charCodeAt(i) | (text.charCodeAt(i + 1) << 16)
      : ((lead + length) << 16) | (end < length ? text.charCodeAt(end) : 0);
    v3 ^= m;
    for (let r = 0; r < 2; r++) {
      v0 = (v0 + v1) | 0; v1 = (v1 << 5) | (v1 >>> 27); v1 ^= v0; v0 = (v0 << 16) | (v0 >>> 16);
      v2 = (v2 + v3) | 0; v3 = (v3 << 8) | (v3 >>> 24); v3 ^= v2;
      v0 = (v0 + v3) | 0; v3 = (v3 << 7) | (v3 >>> 25); v3 ^= v0;
      v2 = (v2 + v1) | 0; v1 = (v1 << 13) | (v1 >>> 19); v1 ^= v2; v2 = (v2 << 16) | (v2 >>> 16);
    }
    v0 ^= m;
  }
  // Two halves of four rounds each: the high word, then the low one.
  v2 ^= 0xee;
  let hi = 0;
  for (let half = 0; half < 2; half++) {
    for (let r = 0; r < 4; r++) {
      v0 = (v0 + v1) | 0; v1 = (v1 << 5) | (v1 >>> 27); v1 ^= v0; v0 = (v0 << 16) | (v0 >>> 16);
      v2 = (v2 + v3) | 0; v3 = (v3 << 8) | (v3 >>> 24); v3 ^= v2;
      v0 = (v0 + v3) | 0; v3 = (v3 << 7) | (v3 >>> 25); v3 ^= v0;
      v2 = (v2 + v1) | 0; v1 = (v1 << 13) | (v1 >>> 19); v1 ^= v2; v2 = (v2 << 16) | (v2 >>> 16);
    }
    if (half === 0) {
      hi = v1 ^ v3;
      v1 ^= 0xdd;
    }
  }
  const lo = v1 ^ v3;
  // 64 bits in eleven digits of six: 24 bits, 24 bits, 16 bits.
  const a = hi >>> 8;
  const b = ((hi & 0xff) << 16) | (lo >>> 16);
  const c = lo & 0xffff;
  out[at] = DIGITS[a >>> 18];
  out[at + 1] = DIGITS[(a >>> 12) & 63];
  out[at + 2] = DIGITS[(a >>> 6) & 63];
  out[at + 3] = DIGITS[a & 63];
  out[at + 4] = DIGITS[b >>> 18];
  out[at + 5] = DIGITS[(b >>> 12) & 63];
  out[at + 6] = DIGITS[(b >>> 6) & 63];
  out[at + 7] = DIGITS[b & 63];
  out[at + 8] = DIGITS[c >>> 12];
  out[at + 9] = DIGITS[(c >>> 6) & 63];
  out[at + 10] = DIGITS[c & 63];
}

/** @returns {{ key: string | null }} */
export function createHydrationKeys() {
  return { key: null };
}

/** `chunk`, about to be written, with the pending key placed in it if it opens an element; settles the key. */
export function claim(hk, chunk) {
  if (chunk === '') return chunk;
  const key = hk.key;
  hk.key = null;
  return placeKey(chunk, key);
}

/** `chunk` with ` data-hk="KEY"` after its tag name, when it opens with an element. */
export function placeKey(chunk, key) {
  if (chunk.charCodeAt(0) !== 60 || !isLetter(chunk.charCodeAt(1))) return chunk;
  let end = 2;
  for (let c = chunk.charCodeAt(end); isLetter(c) || (c >= 48 && c <= 57) || c === 45; c = chunk.charCodeAt(++end));
  return chunk.slice(0, end) + ` data-hk="${key}"` + chunk.slice(end);
}

function isLetter(c) {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}
