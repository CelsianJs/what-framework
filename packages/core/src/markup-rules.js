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
// are fetched, and the SVG animation values (values, to, from, by), which
// <animate> or <set> with attributeName="href" sets as the href after the
// element's own attributes were checked. Compared in lower case, so the
// camelCase props (formAction, xlinkHref) are covered too.
export const URL_ATTRS = /* @__PURE__ */ new Set(['href', 'src', 'action', 'formaction', 'data', 'ping', 'xlink:href', 'xlinkhref', 'values', 'to', 'from', 'by']);

export function isUrlAttr(name) {
  return URL_ATTRS.has(name.toLowerCase());
}

// A URL with a javascript:, vbscript: or data: scheme, after whitespace and
// control characters (a superset of what a browser ignores) are removed, or
// a `;`-separated list (an animation's `values`) with one among its items. A
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
  return normalized.split(';').some((url) => url.startsWith('javascript:') || url.startsWith('vbscript:') || url.startsWith('data:'));
}

// Props whose value the browser parses as markup, so escaping is no defense:
// srcdoc is entity-decoded and parsed as a whole document, and outerHTML
// replaces the element with its value parsed as markup. Refused outright, in
// any letter case, on every path. innerHTML and dangerouslySetInnerHTML are the
// other two; they are accepted only as { __html: trustedString }.
export const REFUSED_ATTRS = /* @__PURE__ */ new Set(['srcdoc', 'outerhtml']);

export function isRefusedAttr(name) {
  return REFUSED_ATTRS.has(name.toLowerCase());
}

export const INNER_HTML_PROPS = /* @__PURE__ */ new Set(['innerHTML', 'dangerouslySetInnerHTML']);

// Prop names whose HTML attribute is not just the prop name in another case.
// The client reaches the right attribute through the element's reflected DOM
// property (`label.htmlFor = x` writes `for`); markup has no properties, so
// static templates and server markup rename them: an unrenamed `htmlFor="x"`
// parses as a meaningless `htmlfor` attribute, and hydration never corrects a
// static attribute. Names that differ from their attribute only by case
// (tabIndex, readOnly) need no entry: the parser lowercases attribute names.
export const ATTRIBUTE_ALIASES = /* @__PURE__ */ new Map([
  ['className', 'class'],
  ['htmlFor', 'for'],
  ['httpEquiv', 'http-equiv'],
  ['acceptCharset', 'accept-charset'],
]);

export function attributeName(prop) {
  return ATTRIBUTE_ALIASES.get(prop) || prop;
}

// The props whose value lives in markup under another attribute: a field's
// default is its content attribute (an <input>'s defaultValue is its `value`
// attribute, what a form reset restores), so markup writes it there. A client
// writes these props as properties, which reflect to the same attributes.
const DEFAULT_ATTRIBUTES = /* @__PURE__ */ new Map([
  ['defaultValue', 'value'],
  ['defaultChecked', 'checked'],
  ['defaultSelected', 'selected'],
]);

/** The attribute `prop` is written as in markup (server HTML, a compiled template). */
export function markupName(prop) {
  return DEFAULT_ATTRIBUTES.get(prop) || attributeName(prop);
}

// --- Form fields ---
//
// The props of a form field that hold its state: `value` (an <input> whose
// value is its own, a <textarea>, a <select>) and `checked` control what it
// shows; `defaultValue` and `defaultChecked` are its default, what a form
// reset restores. A server shows the value (else the default) in the one
// place markup has for both; a client writes the value as a property and the
// default as the attribute (what-core's dom.js, what-server's html.js).
export const FIELD_PROPS = /* @__PURE__ */ new Set(['value', 'defaultValue', 'checked', 'defaultChecked']);
export const FIELD_TAGS = /* @__PURE__ */ new Set(['input', 'textarea', 'select']);

// <input> types whose `value` is the attribute it submits or shows on a
// button, not a value the user edits: for them `value` is an attribute.
export const ATTRIBUTE_VALUE_TYPES = /* @__PURE__ */ new Set(['checkbox', 'radio', 'hidden', 'submit', 'reset', 'button', 'image']);

/** A string with ASCII whitespace stripped from both ends and collapsed to single spaces. */
export function stripAndCollapse(text) {
  return text.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').replace(/[\t\n\f\r ]+/g, ' ');
}

/**
 * The options a <select> value selects, as one boolean per option value in
 * `values`: an array selects every option whose value it holds, any other
 * value the first option with its string, a value no option has none. The
 * client writes it (`select.value =` picks the first match, in a multiple
 * select too) and a server marks it.
 */
export function selectedOptions(values, value) {
  if (Array.isArray(value)) {
    const wanted = value.map(String);
    return values.map((v) => wanted.includes(v));
  }
  const at = values.indexOf(String(value));
  return values.map((_, i) => i === at);
}

// ARIA attributes and `role` take enumerated string values, never HTML boolean
// syntax: an absent aria-expanded means "unsupported" and aria-expanded="false"
// means "collapsed". data-* attributes are strings too, so `[data-open="false"]`
// keeps matching. HTML's own "true"/"false" attributes are enumerated as well:
// draggable="" is the auto state (a <div> is not draggable), and an absent
// spellcheck or contenteditable inherits from the parent, so `false` has to be
// written out. Everything else follows HTML boolean semantics: true writes the
// bare name, false omits it.
export function isAriaAttr(name) {
  return name === 'role' || name.startsWith('aria-');
}

export function isEnumeratedAttr(name) {
  return isAriaAttr(name) || name.startsWith('data-') || /^(draggable|spellcheck|contenteditable)$/i.test(name);
}

export const VOID_ELEMENTS = /* @__PURE__ */ new Set([
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
export const SVG_HTML_INTEGRATION_POINTS = /* @__PURE__ */ new Set(['foreignObject', 'desc', 'title']);
export const MATHML_TEXT_INTEGRATION_POINTS = /* @__PURE__ */ new Set(['mi', 'mo', 'mn', 'ms', 'mtext']);
export const MATHML_IN_TEXT_POINTS = /* @__PURE__ */ new Set(['mglyph', 'malignmark']);
export const HTML_ENCODINGS = /* @__PURE__ */ new Set(['text/html', 'application/xhtml+xml']);

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
export const RAW_TEXT_ELEMENTS = /* @__PURE__ */ new Set(['script', 'style']);

// Elements whose content the HTML parser reads as text that it decodes:
// <textarea> and <title> in HTML. Nothing in it is markup, a comment included,
// so a server writes their children as escaped text with no hydration
// markers, and the client hydrates that text as one text node.
export const TEXT_ONLY_ELEMENTS = /* @__PURE__ */ new Set(['textarea', 'title']);

// The HTML parser drops a newline that comes right after one of these start
// tags, so a server writes one there: the parser drops that one, and content
// that begins with a newline keeps its own.
export const LEADING_NEWLINE_ELEMENTS = /* @__PURE__ */ new Set(['pre', 'textarea', 'listing']);

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
// for text and attribute values. A test() for any character that needs
// escaping, an early return for the common clean string (test() is cheaper
// than search(), which saves and restores the expression's lastIndex), then a
// search for the first one and one pass from there: the same output as five
// chained replace() calls without scanning the string five times.
const NEEDS_ESCAPE = /[&<>"']/;

export function escapeHtml(str) {
  if (!NEEDS_ESCAPE.test(str)) return str;
  const first = str.search(NEEDS_ESCAPE);
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

// A style object as CSS text, as what-server writes a style prop and
// what-framework/dom's style() returns it: camelCase properties in
// kebab-case, custom properties (--x) as they are. A property whose value is
// null, undefined, a boolean or empty is left out, as the client sets none
// for it (React leaves out the same values). A declaration the client's
// CSSOM would refuse (a name that is not a property or a custom property, a
// value that ends the declaration or opens a block) is left out, as the
// client leaves it out: the server must not write
// `color: red; background: url(//tracker)` from one value.
const CSS_PROPERTY = /^(?:--[\w-]+|-?[a-zA-Z][\w-]*)$/;

// Control characters other than CSS whitespace: tab, LF, FF, CR.
const isControl = (code) => (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0c && code !== 0x0d) || code === 0x7f;

// Whether `text` is a value in a conservative CSS grammar, which a CSS parser
// reads as one declaration's value whatever it does with it:
// - no control characters;
// - outside strings, no `\` (an escape makes the next character, a quote or
//   a parenthesis, part of an identifier), no comment (`/*`, which can hide a
//   quote or a parenthesis from a reader that knows no comments) and no braces;
// - strings close on their own line (`\` escapes the next character in them);
// - parentheses and brackets nest and match, and a `;` is allowed only inside
//   them (`url(data:image/png;base64,…)`);
// - an unquoted `url(` holds one url token: a CSS parser reads it to the
//   first `)` whatever it holds, and one with a quote, a `(` or inner
//   whitespace is a bad url, which also ends at the first `)`, so the `;`
//   after that `)` would end the declaration (`url(a(b);x:y)`).
// A value outside the grammar is dropped, even one a browser would accept
// (`red /* note */`): style objects never need one.
export function oneDeclaration(text) {
  const open = [];
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (isControl(text.charCodeAt(i))) return false;
    if (quote !== '') {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      else if (c === '\n' || c === '\r' || c === '\f') return false;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' && isUrlFunction(text, i)) {
      const end = urlTokenEnd(text, i + 1);
      if (end === -1) return false;
      if (end > i) i = end;
      else open.push(')');
    } else if (c === '(' || c === '[') open.push(c === '(' ? ')' : ']');
    else if (c === ')' || c === ']') {
      if (open.pop() !== c) return false;
    } else if (c === '\\' || c === '{' || c === '}' || (c === '/' && text[i + 1] === '*') || (c === ';' && open.length === 0)) return false;
  }
  return open.length === 0 && quote === '';
}

// Whether the `(` at `at` opens `url(`: the identifier before it is `url`, in
// any case.
function isUrlFunction(text, at) {
  return at >= 3 && text.slice(at - 3, at).toLowerCase() === 'url' && (at === 3 || !/[\w\u0080-\uffff-]/.test(text[at - 4]));
}

// Where the url token that starts at `from` (after `url(`) ends: the index of
// its `)`; `from - 1` when the argument is a string instead (a quote after
// any whitespace), read as one; -1 when it is a bad url or never closes.
function urlTokenEnd(text, from) {
  let i = from;
  while (i < text.length && /[ \t\n\r\f]/.test(text[i])) i++;
  if (text[i] === '"' || text[i] === "'") return from - 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === ')') return i;
    if (c === '"' || c === "'" || c === '(' || c === '\\') return -1;
    if (/[ \t\n\r\f]/.test(c)) {
      while (i < text.length && /[ \t\n\r\f]/.test(text[i])) i++;
      return text[i] === ')' ? i : -1;
    }
  }
  return -1;
}

// A property name as it is written (kebab-case; a custom property as it is),
// or null for a name that is no property: decided once per name. Bounded,
// because a style object's keys can come from data.
export const _cssNames = new Map();
export const CSS_NAME_CACHE_SIZE = 1024;

function cssName(property) {
  let name = _cssNames.get(property);
  if (name === undefined) {
    name = !CSS_PROPERTY.test(property) ? null
      : property.startsWith('--') ? property : property.replace(/([A-Z])/g, '-$1').toLowerCase();
    if (_cssNames.size < CSS_NAME_CACHE_SIZE) _cssNames.set(property, name);
  }
  return name;
}

// Values that are one declaration's value by their characters alone: letters,
// digits, `_`, `#`, `%`, `.`, `,`, `-`, `+` and spaces, none of which
// oneDeclaration gives a meaning to. Every other value is read by it.
export const PLAIN_CSS_VALUE = /^[\w#%.,+ -]*$/;

export function styleText(style) {
  let css = '';
  const properties = Object.keys(style);
  for (let i = 0; i < properties.length; i++) {
    const property = properties[i];
    const value = style[property];
    if (value == null || value === '' || typeof value === 'boolean') continue;
    const text = String(value);
    const name = cssName(property);
    if (name === null || !(PLAIN_CSS_VALUE.test(text) || oneDeclaration(text))) continue;
    css += (css ? ';' : '') + name + ':' + text;
  }
  return css;
}
