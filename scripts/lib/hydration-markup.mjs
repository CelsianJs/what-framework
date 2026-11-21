// Reading server HTML the way a check about its content needs to.
//
// Every hydratable renderer (renderDocument, exportStatic, the stream, ...)
// writes the hydration protocol: a data-hk key on a component's first element
// and comment markers around reactive children, arrays and boundaries
// (docs/ARCHITECTURE.md, "hydration protocol"). A check that the HTML holds
// some markup, such as an island's server render, is about content, so it reads
// the HTML with the protocol taken out. The markers come from the renderer's
// own definitions, so this cannot drift from what it writes.

import {
  ARRAY_CLOSE,
  ARRAY_OPEN,
  BOUNDARY_CLOSE,
  BOUNDARY_FALLBACK,
  BOUNDARY_OPEN,
  REGION_CLOSE,
  REGION_OPEN,
} from '../../packages/server/src/compiled.js';

const MARKERS = [REGION_OPEN, REGION_CLOSE, ARRAY_OPEN, ARRAY_CLOSE, BOUNDARY_OPEN, BOUNDARY_FALLBACK, BOUNDARY_CLOSE];
const HYDRATION_KEY = / data-hk="[^"]*"/g;

/** `html` without hydration keys and markers: the markup a reader sees. */
export function stripHydrationMarkup(html) {
  let out = html.replace(HYDRATION_KEY, '');
  for (const marker of MARKERS) out = out.split(marker).join('');
  return out;
}

/**
 * The inner HTML of the element carrying `data-island="<name>"`, with the
 * hydration protocol taken out, or null when the page has no such island.
 */
export function islandServerRender(html, name) {
  const plain = stripHydrationMarkup(html);
  const at = plain.indexOf(`data-island="${name}"`);
  if (at === -1) return null;
  const start = plain.lastIndexOf('<', at);
  const tag = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(plain.slice(start))[1];
  const contentStart = plain.indexOf('>', at) + 1;
  // The host's own closing tag: the first one that brings the depth of
  // same-named elements back to zero.
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g');
  re.lastIndex = contentStart;
  let depth = 1;
  for (let m = re.exec(plain); m; m = re.exec(plain)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return plain.slice(contentStart, m.index);
  }
  return null;
}
