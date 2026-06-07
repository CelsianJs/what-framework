// Safe serialization of state for inlining into an HTML <script> tag.
//
// Stateless on purpose: this module holds no shared state, so it is safe for
// the bundler to inline into multiple server entry points without creating
// divergent instances (unlike islands.js's sharedStores).
//
// JSON.stringify alone is NOT safe to drop inside <script>...</script>: a value
// containing "</script>" (or "<!--", "<script") breaks out of the element and
// injects markup -- stored XSS when any value is user-controlled
// (AUDIT-2026-06-06 H3). Escaping "<", ">", "&" as \uXXXX keeps the output
// valid JSON (so JSON.parse on hydrate still works) while making it inert in
// HTML. U+2028/U+2029 are also escaped: they are valid in JSON strings but are
// illegal in JS string literals and can break inline script parsing.

// Built via new RegExp from escape sequences so this source file contains no
// invisible separator characters. Matches: < > & U+2028 U+2029.
const SCRIPT_UNSAFE = new RegExp('[<>&\\u2028\\u2029]', 'g');

const ESCAPES = {
  0x3c: '\\u003c', // <
  0x3e: '\\u003e', // >
  0x26: '\\u0026', // &
  0x2028: '\\u2028',
  0x2029: '\\u2029',
};

/**
 * Serialize a value to a JSON string that is safe to embed verbatim inside an
 * HTML <script> element. Always use this instead of bare JSON.stringify when
 * inlining hydration/state payloads into server-rendered HTML.
 */
export function serializeState(value) {
  return JSON.stringify(value).replace(SCRIPT_UNSAFE, (c) => ESCAPES[c.charCodeAt(0)]);
}
