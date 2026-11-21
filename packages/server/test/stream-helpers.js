// Shared helpers for the streaming tests.

import { JSDOM } from 'jsdom';

/**
 * Streamed boundary ids carry a random part that is new for every stream
 * (`wb3k9x2f1-0`), so page markup can never name one. This gives them back the
 * stable names the assertions use (`wb0`); the random part itself is checked
 * in stream-ids.test.js.
 */
export function stableIds(html) {
  return html.replace(/wb[0-9a-z]+-(\d+)/g, 'wb$1');
}

/** Concatenate every chunk of a stream. */
export async function collect(stream) {
  let out = '';
  for await (const chunk of stream) out += chunk;
  return out;
}

/**
 * What a browser ends up showing for streamed HTML: parse it with scripts
 * enabled, so streamed boundaries are swapped in, then return the body markup
 * without the elements nobody sees (scripts, data elements, templates).
 */
export function settle(html) {
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${html}</body></html>`, { runScripts: 'dangerously' });
  try {
    const { body } = dom.window.document;
    for (const el of body.querySelectorAll('script, template')) el.remove();
    return body.innerHTML;
  } finally {
    dom.window.close();
  }
}

/**
 * Markup with each keyed list's keys comment reduced to its shape: how many
 * rows, and which share a key. Every render salts its digests (compiled.js
 * rowKeys), so two renders of the same tree agree on everything else.
 */
export function keyShape(html) {
  return html.replace(/<!--k:[^:>]*:([^>]*)-->/g, (_, digests) => {
    const seen = new Map();
    const shape = (digests.match(/.{11}/g) || []).map((d) => {
      if (!seen.has(d)) seen.set(d, seen.size);
      return seen.get(d);
    });
    return `<!--k:${shape.join(',')}-->`;
  });
}

/**
 * Markup without the hydration protocol what-server writes for hydrate()
 * (compiled.js): the region, array and boundary markers, a keyed list's row
 * keys and the data-hk keys.
 * For assertions about what a page shows rather than how it hydrates.
 */
export function content(html) {
  return html.replace(/<!--(?:\$|\/\$|\[\]|\/\[\]|b|b!|\/b|k:[^>]*|k!)-->/g, '').replace(/ data-hk="[^"]*"/g, '');
}
