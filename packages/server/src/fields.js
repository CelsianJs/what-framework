// What Framework - Server: the fields of a submitted form as an action
// receives them, one value per name and an array for a repeated name.
//
// Every name is a field of its own: `constructor`, `toString` or `__proto__`
// is a key like any other, never what an object inherits under that name
// (which read as a repeat of a built-in function), and never the prototype.

// The fields the framework reads itself, never handed to an action:
// `what-csrf-token` is an alias for `_csrf` matching the
// <meta name="what-csrf-token"> tag SSR pages embed, so templates can reuse
// one name for both surfaces.
export const RESERVED_FIELDS = new Set(['_action', 'data-action', '_csrf', 'what-csrf-token', '_redirect', '_state', '_actionKey']);

export function addField(fields, key, value) {
  if (!Object.hasOwn(fields, key)) {
    Object.defineProperty(fields, key, { value, writable: true, enumerable: true, configurable: true });
  } else if (Array.isArray(fields[key])) {
    fields[key].push(value);
  } else {
    fields[key] = [fields[key], value];
  }
}

// --- application/x-www-form-urlencoded ---
// The name/value pairs of an urlencoded string, exactly as URLSearchParams
// reads them (a leading `?` dropped, `+` a space, `%XX` a byte, the bytes
// UTF-8 with U+FFFD for what is not, a pair with no `=` an empty value), in
// time linear in its length on every Node version. Every form body the server
// reads goes through here, and every query string of the action endpoint (the
// Node middleware, fetchActionHandler, the request handler): on Node 24.22.3
// URLSearchParams is quadratic in the pairs that have no `=`, and a 1 MB body
// of `a&a&…` held the event loop for seconds before any check ran. A page's
// query (what-router's parseQuery, which runs in the browser too) and cache
// keys read the URL itself, which the server's header limit bounds.

const utf8 = /* @__PURE__ */ new TextEncoder();
// A part's bytes decode on their own, so a leading U+FEFF is a character of
// the part, as the standard decodes it, never a byte order mark to drop.
const utf8Text = /* @__PURE__ */ new TextDecoder('utf-8', { ignoreBOM: true });

// `each(name, value)` for every pair of `input`, in order.
function eachUrlEncoded(input, each) {
  const s = String(input);
  for (let start = s.charCodeAt(0) === 63 ? 1 : 0; start <= s.length;) {
    let end = s.indexOf('&', start);
    if (end === -1) end = s.length;
    if (end > start) {
      const pair = s.slice(start, end);
      const eq = pair.indexOf('=');
      if (eq === -1) each(decodePart(pair), '');
      else each(decodePart(pair.slice(0, eq)), decodePart(pair.slice(eq + 1)));
    }
    start = end + 1;
  }
}

/** @returns {Array<[string, string]>} */
export function urlEncodedPairs(input) {
  const pairs = [];
  eachUrlEncoded(input, (name, value) => pairs.push([name, value]));
  return pairs;
}

function decodePart(raw) {
  const text = raw.indexOf('+') === -1 ? raw : raw.replaceAll('+', ' ');
  if (text.indexOf('%') === -1) return text;
  const bytes = utf8.encode(text);
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    const high = i + 2 < bytes.length && bytes[i] === 37 ? hexValue(bytes[i + 1]) : -1;
    const low = high === -1 ? -1 : hexValue(bytes[i + 2]);
    if (low === -1) {
      out[n++] = bytes[i];
    } else {
      out[n++] = high * 16 + low;
      i += 2;
    }
  }
  return utf8Text.decode(out.subarray(0, n));
}

function hexValue(byte) {
  if (byte >= 48 && byte <= 57) return byte - 48;
  if (byte >= 65 && byte <= 70) return byte - 55;
  return byte >= 97 && byte <= 102 ? byte - 87 : -1;
}

/** The fields of an urlencoded string: one value per name, an array for a repeated one. */
export function urlEncodedFields(input) {
  const fields = {};
  eachUrlEncoded(input, (name, value) => addField(fields, name, value));
  return fields;
}
