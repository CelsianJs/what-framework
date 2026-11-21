// What Framework - the markup rules every renderer applies.
//
// One copy of each rule a value has to pass before it is written as HTML or
// set as an attribute: which tag and attribute names can be emitted verbatim,
// which attributes hold URLs and which URL schemes are refused, which props
// are never applied, how a prop name maps to its attribute, which attributes
// are enumerated, which elements are void, and how the text of <script> and
// <style> is kept from ending its element. what-compiler applies them to
// static markup when a module is compiled, what-server to every value it
// renders (compiled or h()), and the client to every attribute it sets, so a
// rule cannot hold on one path and lapse on another
// (packages/server/test/markup-rules-parity.test.js).
//
// Import-free, because what-compiler loads it into the build.

// Names are emitted verbatim (values are escaped, names cannot be), so anything
// outside these patterns could inject markup:
//   h('div', { 'x" onload="alert(1)': '' })  ->  <div x" onload="alert(1)>
// They allow data-*, aria-*, xlink:href, SVG names such as stroke-width and
// clipPath, custom elements, and the internal '__suspense' marker tag.
export const SAFE_ATTR_NAME = /^[a-zA-Z_:][a-zA-Z0-9:._-]*$/;
export const SAFE_TAG_NAME = /^[a-zA-Z_][a-zA-Z0-9._:-]*$/;

// Attributes whose value is a URL the browser follows, fetches or executes:
// xlink:href because SVG <a> executes it, ping and object[data] because they
// are fetched. Compared in lower case, so the camelCase props (formAction,
// xlinkHref) are covered too.
export const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'data', 'ping', 'xlink:href', 'xlinkhref']);

export function isUrlAttr(name) {
  return URL_ATTRS.has(name.toLowerCase());
}

// A URL with a javascript:, vbscript: or data: scheme, after whitespace and
// control characters (a superset of what a browser ignores) are removed. A
// value with no usable toString (Object.create(null), { toString: null }, both
// reachable from JSON) is refused rather than allowed to throw mid-render.
export function isUnsafeUrl(value) {
  if (value == null) return false;
  let normalized;
  try {
    normalized = String(value).replace(/[\p{Cc}\s]+/gu, '').toLowerCase();
  } catch {
    return true;
  }
  return normalized.startsWith('javascript:') || normalized.startsWith('vbscript:') || normalized.startsWith('data:');
}

// Props whose value the browser parses as markup, so escaping is no defense:
// srcdoc is entity-decoded and parsed as a whole document, and outerHTML
// replaces the element with its value parsed as markup. Refused outright, in
// any letter case, on every path. innerHTML and dangerouslySetInnerHTML are the
// other two; they are accepted only as { __html: trustedString }.
export const REFUSED_ATTRS = new Set(['srcdoc', 'outerhtml']);

export function isRefusedAttr(name) {
  return REFUSED_ATTRS.has(name.toLowerCase());
}

export const INNER_HTML_PROPS = new Set(['innerHTML', 'dangerouslySetInnerHTML']);

// Prop names whose HTML attribute is not just the prop name in another case.
// The client reaches the right attribute through the element's reflected DOM
// property (`label.htmlFor = x` writes `for`); markup has no properties, so
// static templates and server markup rename them: an unrenamed `htmlFor="x"`
// parses as a meaningless `htmlfor` attribute, and hydration never corrects a
// static attribute. Names that differ from their attribute only by case
// (tabIndex, readOnly) need no entry: the parser lowercases attribute names.
export const ATTRIBUTE_ALIASES = new Map([
  ['className', 'class'],
  ['htmlFor', 'for'],
  ['httpEquiv', 'http-equiv'],
  ['acceptCharset', 'accept-charset'],
]);

export function attributeName(prop) {
  return ATTRIBUTE_ALIASES.get(prop) || prop;
}

// ARIA attributes and `role` take enumerated string values, never HTML boolean
// syntax: an absent aria-expanded means "unsupported" and aria-expanded="false"
// means "collapsed". data-* attributes are strings too, so `[data-open="false"]`
// keeps matching. Everything else follows HTML boolean semantics: true writes
// the bare name, false omits it.
export function isAriaAttr(name) {
  return name === 'role' || name.startsWith('aria-');
}

export function isEnumeratedAttr(name) {
  return isAriaAttr(name) || name.startsWith('data-');
}

export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// --- Namespaces ---
//
// The parser builds <svg> and <math> content in the SVG and MathML namespaces,
// except where it switches back to HTML (its integration points): the
// children of SVG <foreignObject>, <desc> and <title>; of the MathML token
// elements <mi>, <mo>, <mn>, <ms> and <mtext>, apart from <mglyph> and
// <malignmark>, which stay MathML; and of MathML <annotation-xml> whose
// encoding is text/html or application/xhtml+xml.
export const SVG_HTML_INTEGRATION_POINTS = new Set(['foreignObject', 'desc', 'title']);
export const MATHML_TEXT_INTEGRATION_POINTS = new Set(['mi', 'mo', 'mn', 'ms', 'mtext']);
export const MATHML_IN_TEXT_POINTS = new Set(['mglyph', 'malignmark']);
export const HTML_ENCODINGS = new Set(['text/html', 'application/xhtml+xml']);

// The namespace the children of `tag` are parsed in, given the namespace `tag`
// itself is in: null for HTML, 'svg', 'math', or 'foreign' for SVG or MathML
// content whose exact namespace a renderer does not know, which never switches
// back to HTML. `encoding` is the element's encoding attribute (it decides
// <annotation-xml>).
export function childNamespace(ns, tag, encoding) {
  if (ns === null) {
    if (tag === 'svg') return 'svg';
    return tag === 'math' || MATHML_IN_TEXT_POINTS.has(tag) ? 'math' : null;
  }
  if (ns === 'svg') return SVG_HTML_INTEGRATION_POINTS.has(tag) ? null : 'svg';
  if (ns === 'math') {
    if (MATHML_TEXT_INTEGRATION_POINTS.has(tag)) return null;
    return tag === 'annotation-xml' && typeof encoding === 'string' && HTML_ENCODINGS.has(encoding.toLowerCase()) ? null : 'math';
  }
  return ns;
}

// Elements whose content the HTML parser reads as raw text: nothing in it is
// decoded, so HTML-escaping corrupts it (`a &amp;&amp; b` is not JavaScript),
// and only the closing sequence ends it. Its text is written as it is, apart
// from the sequences encodeRawText replaces. In SVG or MathML they are
// ordinary elements whose content is parsed as markup, so there their text is
// escaped (rawTextContent).
export const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

// The sequences that could end a raw-text element or change how the parser
// reads it: `</` (which starts every closing tag, in any letter case) and, in
// a script, `<!--`, which can switch the parser into a state where the real
// closing tag no longer closes the element.
export function rawTextHazard(tag, text) {
  return text.includes('</') || (tag === 'script' && text.includes('<!--'));
}

// Raw text, encoded so it cannot end its element. `<\/` means `</` inside a
// CSS or JavaScript string and in JSON; `<!--` means `<!--` inside a
// JavaScript or JSON string. Text without either sequence is unchanged, so
// static text that passed rawTextHazard encodes to itself.
export function encodeRawText(tag, text) {
  if (!rawTextHazard(tag, text)) return text;
  const out = text.replace(/<\//g, '<\\/');
  return tag === 'script' ? out.replace(/<!--/g, '\\u003C!--') : out;
}

// The content of a <script> or <style> whose text is `text`, written in
// namespace `ns`. In HTML it is raw text (encodeRawText); in SVG or MathML it
// is parsed as markup, so `&` and `<` are escaped, and nothing else, so text
// that holds neither is the same bytes in every namespace.
export function rawTextContent(tag, text, ns) {
  if (ns === null) return encodeRawText(tag, text);
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

// Text a compiler can write into a raw-text element as it is, whatever
// namespace the element ends up in: no `&` and no `<`.
export function isNamespaceNeutralText(text) {
  return !/[&<]/.test(text);
}

// The five-character HTML escape every server renderer and what-compiler use
// for text and attribute values. One search for the first character that needs
// escaping, an early return for the common clean string, then one pass from
// there: the same output as five chained replace() calls without scanning the
// string five times.
const NEEDS_ESCAPE = /[&<>"']/;

export function escapeHtml(str) {
  const first = str.search(NEEDS_ESCAPE);
  if (first === -1) return str;
  let out = '';
  let last = 0;
  for (let i = first; i < str.length; i++) {
    let replacement;
    switch (str.charCodeAt(i)) {
      case 38: replacement = '&amp;'; break;
      case 60: replacement = '&lt;'; break;
      case 62: replacement = '&gt;'; break;
      case 34: replacement = '&quot;'; break;
      case 39: replacement = '&#39;'; break;
      default: continue;
    }
    if (last < i) out += str.slice(last, i);
    out += replacement;
    last = i + 1;
  }
  return last < str.length ? out + str.slice(last) : out;
}
