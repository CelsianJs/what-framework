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
//       renderChild(child, ns) renders a child the way the renderer renders
//       it; hk is null for a plain render and, for a hydratable one, holds
//       the hydration key the next element takes (hk.key, or null); ns is the
//       namespace the markup sits in (null for HTML, see what-core's
//       childNamespace).
//   parts(ns)       for the stream: its HTML as a string, or an array of
//                   HTML strings and the children and Html between them.
//   childNs(ns)     the namespace the items of that array sit in.

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
}

const checks = /** @type {Set<(value: object) => boolean>} */ (
  /** @type {any} */ (globalThis)[Symbol.for('what-server.html.v2')] ??= new Set()
);
checks.add(Html.is);

/** Whether `value` is compiled markup made by this or another copy of what-server. */
export function isHtml(value) {
  if (typeof value !== 'object' || value === null) return false;
  if (Html.is(value)) return true;
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
