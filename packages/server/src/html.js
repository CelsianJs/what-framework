// What Framework - Server: HTML primitives shared by every server renderer.
// Attribute and tag validation, innerHTML resolution, raw-text content, and the
// vnode rules (boundaries, skipped tags, component props) the string and stream
// renderers and the compiled-markup runtime must agree on. The rules
// themselves (names, URL schemes, refused props, aliases, void and raw-text
// elements, the escape) are what-core's markup rules, which what-compiler
// applies to static markup too.

import {
  escapeHtml,
  SAFE_ATTR_NAME,
  SAFE_TAG_NAME,
  VOID_ELEMENTS,
  RAW_TEXT_ELEMENTS,
  TEXT_ONLY_ELEMENTS,
  LEADING_NEWLINE_ELEMENTS,
  markupName,
  FIELD_PROPS,
  ATTRIBUTE_VALUE_TYPES,
  stripAndCollapse,
  selectedOptions,
  isEnumeratedAttr,
  isRefusedAttr,
  isUnsafeUrl,
  isUrlAttr,
  rawTextContent,
} from 'what-core/internal/markup-rules';
import { isVNode } from 'what-core/internal';
import { isHtml, rowKeys } from './compiled.js';

// <ErrorBoundary> and <Suspense> are not elements. They return vnodes carrying
// the internal marker tags '__errorBoundary' / '__suspense', which every client
// path routes to a boundary handler (dom.js:349-353). The server had no such
// routing outside renderToString's suspense case, so the marker tags fell
// through to the generic element renderer and three things went wrong at once:
//
//   <ErrorBoundary>            ->  <__errorBoundary><p>ok</p></__errorBoundary>
//   <Suspense> (hydratable)    ->  <__suspense boundary="[object Object]"
//                                             fallback="[object Object]">...
//
// An invalid element name in the response, the boundary's internal props
// stringified into attributes, and, worst of the three, a component that threw
// during SSR took down the WHOLE page render instead of being contained:
// renderToString and renderToHydratableString both propagated the error, so the
// one construct whose entire purpose is to stop a subtree failure from becoming
// a page failure did nothing on the server. The stream path did not throw but
// emitted an HTML comment where the fallback belonged.
//
// A thenable is deliberately re-thrown rather than caught: that is a suspended
// resource, not an error, and it belongs to the nearest <Suspense>.
/** @type {Set<unknown>} A vnode's tag: a name or a component. */
const BOUNDARY_TAGS = new Set(['__errorBoundary', '__suspense']);

// <Portal> is client-only by the framework's own decision: Portal() returns null
// when there is no `document` (helpers.js:153). That guard is environmental, not
// a server check, so SSR under a DOM shim (jsdom, happy-dom, a test harness, any
// runtime that polyfills document) sailed past it, built the vnode, and handed
// the server a '__portal' tag it had no branch for. The result was
//
//   <__portal container="[object HTMLDivElement]"><p>inside</p></__portal>
//
// which is three wrongs at once: an invalid element, a DOM node stringified into
// an attribute, and the portal's content emitted INLINE at the portal's own
// position rather than at its target. Hydration would then move it, so the
// server markup contradicted the client's on purpose.
//
// Rendering nothing is the answer that agrees with the no-document path, so the
// same app produces the same HTML whether or not a shim happens to be loaded.
/** @type {Set<unknown>} A vnode's tag: a name or a component. */
const SERVER_SKIPPED_TAGS = new Set(['__portal']);

// The props a component is called with. The server has to hand a component
// exactly what the client hands it, and it did not.
//
// dom.js:593 collapses the children list before it becomes a prop, and when
// there are NO children it sets no `children` key at all, so an ordinary JS
// default parameter
//
//     function SkipLink({ children = 'Skip to content' }) { ... }
//
// applies. The server passed `children: vnode.children` verbatim, which is `[]`
// for a childless component, and `[]` is defined, so the default NEVER applied
// server-side. A server-rendered <SkipLink /> shipped `<a href="#main"></a>`: a
// link with no accessible name (a WCAG 2.4.4 failure) until the client hydrated
// and replaced it, which is exactly the case where the markup has to stand on
// its own. The divergence is general, not specific to SkipLink: every component
// with a defaulted children prop rendered one thing on the client and another on
// the server. The same blanket override also discarded children passed as a
// plain PROP (`h(Card, { children: body })`), which the client keeps precisely
// because there are no vnode children to replace it with.
//
// "Childless" has to mean what it means on the client: an EMPTY list. h() drops
// null/false/true children (h.js:48,66) but keeps '' as the string child it is,
// so `<Comp>{''}</Comp>` has one child and the default must NOT apply there.
// Only length 0 counts, plus a hand-built vnode carrying no children array.
//
// A single child is the child itself, as the client hands it over
// (render.js componentArgs): a component that returns its children (a
// context provider, a pass-through wrapper) returns the same value on both
// sides, so the server writes no array markers the client does not adopt.
function _componentProps(vnode) {
  const children = vnode.children;
  if (!children || children.length === 0) return { ...vnode.props };
  return { ...vnode.props, children: children.length === 1 ? children[0] : children };
}

// `report` receives an error thrown by the fallback function itself; the
// streaming renderer passes its onError hook.
function _boundaryFallback(vnode, error, report) {
  const fallback = vnode.props && vnode.props.fallback;
  if (typeof fallback !== 'function') return fallback;
  const reset = (vnode.props && vnode.props.reset) || (() => {});
  try {
    return fallback({ error, reset });
  } catch (e) {
    _claimThrow(e);
    if (report) report(e);
    else if (_isDevMode) {
      console.warn(`[what-server] <ErrorBoundary> fallback threw during SSR: ${e.message}`);
    }
    return null;
  }
}

// Dev-mode flag for server warnings. Fails open on purpose: a warning that
// prints where it need not costs nothing.
const _isDevMode = typeof process !== 'undefined'
  ? process.env?.NODE_ENV !== 'production'
  : true;

// Whether an error's own message may be written into the page (a resource's
// error record, the `<!-- SSR Error -->` comment). That fails closed: only a
// NODE_ENV of exactly 'development' allows it, so a server started with no
// NODE_ENV, with 'staging', or on a runtime with no `process` at all (Workers
// without nodejs_compat) sends the generic message. Read on every call so the
// environment decides, not the moment this module loaded.
function _exposesErrorDetails() {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'development';
}

/**
 * Resolve innerHTML / dangerouslySetInnerHTML from props.
 * Requires { __html: ... } wrapper. Plain string innerHTML is rejected (XSS prevention).
 * A function value is a reactive prop, as for an attribute: it is called, and
 * a throw renders no inner HTML.
 */
function _resolveInnerHTML(props) {
  if (!props) return null;

  // dangerouslySetInnerHTML always requires { __html }
  const dangerous = resolveAttr('dangerouslySetInnerHTML', props.dangerouslySetInnerHTML);
  if (dangerous && dangerous !== UNRESOLVED) {
    return dangerous.__html ?? null;
  }

  // innerHTML with { __html } wrapper — allowed
  const inner = resolveAttr('innerHTML', props.innerHTML);
  if (inner && typeof inner === 'object' && '__html' in inner) {
    return inner.__html ?? null;
  }

  // innerHTML as plain string — reject with warning
  if (inner != null && typeof inner === 'string') {
    if (_isDevMode) {
      console.warn(
        '[what-server] innerHTML received a raw string. This is a security risk (XSS). ' +
        'Use innerHTML={{ __html: trustedString }} or dangerouslySetInnerHTML={{ __html: trustedString }} instead.'
      );
    }
    return null;
  }

  return null;
}

// A real DOM node reaching a renderer is not a bad tag name, it is a compiled
// component body.
//
// what-compiler's client output lowers a component's own JSX to a module-scope
// `_$template()` and a `cloneNode(true)` at call time, so the component RETURNS
// finished DOM rather than a vnode. Every renderer here destructures
// `vnode.tag` and gets `undefined` off an Element. Reporting that as
// ERR_INVALID_SSR_TAG ("Invalid tag name in SSR: undefined") would name the
// wrong thing entirely and send people looking for a typo'd tag, when the cause
// is a module compiled for the client reaching a server renderer: the client
// output has no server-rendered form, and what-compiler's server target
// (generate: 'ssr') is the one a server renders.
//
// This only fires when a DOM implementation exists in the process (jsdom in a
// test, a shim someone installed). On a bare Node server the component's first
// template use throws `ReferenceError: document is not defined` instead, which
// is why the build-time guard in what-compiler's Vite plugin is the earlier and
// better seam. This is the backstop for the paths that get past it.
// ERR_COMPILED_JSX_IN_SSR must never be swallowed.
//
// Every render path here degrades rather than 500s: a reactive child that throws
// becomes an empty region, a keyed list becomes an empty container, a streamed
// component becomes `<!-- SSR Error -->`, and an <ErrorBoundary> renders its
// fallback. That is right for a RUNTIME error — bad data in one row should not
// take down the page.
//
// It is wrong for this one, because this is not a runtime error. It says the
// module was built with a toolchain that has no server-rendered form, so every
// render of it will fail identically, forever, and no retry or fallback can
// change that. Degrading turns a build misconfiguration into silent data loss:
//
//   renderToString(h('main', null, () => CompiledComponent()))
//     -> "<main></main>"
//
// The component simply vanished from the page. In development a console.warn
// fires; in production `_isDevMode` is false and nothing is logged at all, so
// the page ships with a hole in it and the server reports success.
//
// This mirrors the ownership rethrows already in the boundary branches: some
// throws are not the catcher's to absorb.
//
// A navigation signal is not an error either: what-router's redirect() from a
// component body throws one, and a server render acts on it as the client
// does (core's _handleNavigationSignal), by running its handler, which
// redirects the render's response. The catcher then renders the subtree it
// cut short as it renders a failed one; a signal one catcher rethrows to the
// next (a <Suspense> passes errors on) is acted on once.
const NAV_SIGNAL = Symbol.for('what.navigation.signal.v1');
const _navigated = new WeakSet();

function _claimThrow(e) {
  if (e && e.code === 'ERR_COMPILED_JSX_IN_SSR') throw e;
  if (e !== null && typeof e === 'object' && typeof e[NAV_SIGNAL] === 'function' && !_navigated.has(e)) {
    _navigated.add(e);
    e[NAV_SIGNAL](e);
  }
}

function _isDomNode(value) {
  return !!value && typeof value === 'object' && typeof (/** @type {any} */ (value).nodeType) === 'number';
}

// A child that is neither a vnode (by its brand: what-core's isVNode) nor
// compiled markup renders as its text, whatever properties it carries, the
// way the client renders it. A DOM node is client output that reached a
// server renderer, which assertSafeTag explains, never text.
function _plainText(value) {
  if (_isDomNode(value)) assertSafeTag(undefined, value);
  return escapeHtml(String(value));
}

// Tag names that passed SAFE_TAG_NAME. Bounded, because tag names can come
// from data (<Dynamic component={name}>) and a cache an attacker can grow
// without limit is a memory leak.
const _safeTags = new Set();
const SAFE_TAG_CACHE_SIZE = 512;

function assertSafeTag(tag, vnode) {
  if (typeof tag === 'string') {
    if (_safeTags.has(tag)) return;
    if (SAFE_TAG_NAME.test(tag)) {
      if (_safeTags.size < SAFE_TAG_CACHE_SIZE) _safeTags.add(tag);
      return;
    }
  }
  if (_isDomNode(vnode)) {
    // ERROR_CODES.COMPILED_JSX_IN_SSR
    throw Object.assign(
      new Error(
        '[what-server] Cannot server-render a DOM node. A component compiled by ' +
        'what-compiler returns a cloned template (finished DOM), not a vnode, so it ' +
        'has no server-rendered form. Author server-rendered views with h(), or ' +
        'compile them with the automatic JSX runtime (jsxImportSource: ' +
        '"what-framework") instead of what-compiler.'
      ),
      { code: 'ERR_COMPILED_JSX_IN_SSR' },
    );
  }
  // ERROR_CODES.INVALID_SSR_TAG
  throw Object.assign(
    new Error(`[what-server] Invalid tag name in SSR: ${JSON.stringify(tag)}`),
    { code: 'ERR_INVALID_SSR_TAG' },
  );
}

const SKIPPED_PROPS = new Set(['key', 'ref', 'children', 'dangerouslySetInnerHTML', 'innerHTML']);

// Everything renderAttrs decides from a prop's NAME, computed once per name:
// the alias, whether it is skipped (internal prop or event handler), whether
// the name is safe to emit, the enumerated (aria/role/data) rules, refusal,
// and whether the value needs the URL scheme check. Values are still resolved,
// checked and escaped on every render. Bounded for the same reason as
// _safeTags: spread props can carry arbitrary keys.
const _attrInfo = new Map();
const ATTR_INFO_CACHE_SIZE = 1024;

function attrInfo(propKey) {
  let info = _attrInfo.get(propKey);
  if (info !== undefined) return info;
  const key = markupName(propKey);
  info = {
    key,
    skip: SKIPPED_PROPS.has(propKey) || (key.length > 2 && key.toLowerCase().startsWith('on')),
    safe: SAFE_ATTR_NAME.test(key),
    enumerated: isEnumeratedAttr(key),
    refused: isRefusedAttr(key),
    url: isUrlAttr(key),
    isClass: key === 'class',
    isStyle: key === 'style',
  };
  if (_attrInfo.size < ATTR_INFO_CACHE_SIZE) _attrInfo.set(propKey, info);
  return info;
}

function renderAttrs(props) {
  let out = '';
  const keys = Object.keys(props);
  // With a classList, class, className and classList make one attribute
  // between them, written where the first of them stands.
  const foldClass = props.classList != null;
  let classWritten = false;
  for (let i = 0; i < keys.length; i++) {
    const propKey = keys[i];
    if (foldClass && CLASS_PROPS.has(propKey)) {
      if (classWritten) continue;
      classWritten = true;
      const cls = classAttribute(props, keys);
      if (cls !== null) out += ` class="${escapeHtml(cls)}"`;
      continue;
    }
    const info = attrInfo(propKey);
    if (info.skip) continue; // internal props, and event handlers (never rendered in SSR)
    const key = info.key;

    // A remaining function value is a reactive accessor, so CALL it. Every
    // client path already does (setProp and setAttr both resolve a function
    // value); only the server did not, and fell through to String(val), which
    // stringifies a function as its SOURCE TEXT. So the documented way to make
    // an attribute reactive,
    //
    //     <span className={() => theme()}>
    //
    // server-rendered as class="() =&gt; theme()": the page shipped JavaScript
    // source in its class attribute, lost the real class until hydration
    // replaced it, and any CSS keyed on that class did not apply to the HTML a
    // crawler or a no-JS visitor saw. what-router's <Link> hit it on every
    // link, because Link always passes a thunk as `class`.
    //
    // Fail soft on a throw, matching the rest of this function: one attribute
    // that cannot resolve must not take down the whole response.
    const val = resolveAttr(key, props[propKey]);
    if (val === UNRESOLVED) continue;
    // Validate names before every emission path, including enumerated false.
    if (!info.safe) {
      if (_isDevMode) {
        console.warn(`[what-server] Skipping invalid attribute name in SSR: ${JSON.stringify(key)}`);
      }
      continue;
    }
    // aria-*/role and data-* are enumerated, so `false` is a real value and must
    // survive: an absent `aria-expanded` means "unsupported",
    // `aria-expanded="false"` means "collapsed", and `[data-open="false"]` is an
    // ordinary selector. Every other attribute keeps HTML boolean semantics,
    // where false means omit. Checked before the falsy skip for that reason.
    if (val === false && info.enumerated) {
      out += ` ${key}="false"`;
      continue;
    }
    if (val === false || val == null) continue;
    if (info.refused) {
      if (_isDevMode) {
        console.warn(`[what-server] Skipping unsafe attribute in SSR: ${JSON.stringify(key)}`);
      }
      continue;
    }

    if (info.isClass) {
      out += ` class="${escapeHtml(typeof val === 'string' ? val : String(val))}"`;
    } else if (info.isStyle && typeof val === 'object') {
      out += ` style="${escapeHtml(styleText(val))}"`;
    } else if (val === true) {
      // ARIA and data-* are enumerated and need an explicit ="true" so the
      // markup matches what both client paths produce; genuine HTML boolean
      // attributes can be bare.
      out += info.enumerated ? ` ${key}="true"` : ` ${key}`;
    } else {
      const str = typeof val === 'string' ? val : String(val);
      if (info.url && isUnsafeUrl(str)) continue;
      out += ` ${key}="${escapeHtml(str)}"`;
    }
  }

  return out;
}

const UNRESOLVED = Symbol('unresolved');

function resolveAttr(key, val) {
  if (typeof val !== 'function') return val;
  try {
    val = val();
  } catch (e) {
    if (_isDevMode) {
      console.warn(`[what-server] Skipping attribute ${JSON.stringify(key)}: its value threw during SSR: ${e.message}`);
    }
    return UNRESOLVED;
  }
  // A resolved value that is itself a function is not an attribute value.
  return typeof val === 'function' ? UNRESOLVED : val;
}

const CLASS_PROPS = new Set(['class', 'className', 'classList']);

// --- Form fields ---
//
// A form field a server renders shows, before any script runs, what the
// client shows first (what-core's dom.js has the client's rules): its value
// prop's value when that is not null or undefined, else its default's.
// Markup has one place for both, the content attribute a form reset restores
// (an <input>'s `value` and `checked`, a <textarea>'s text, an <option>'s
// `selected`), so the value shown goes there, and hydration writes the
// declared default back. A function prop is called first, as for any
// attribute, so an accessor that returns null falls back to the default.
//
// _field(tag, props) is null for an element with no field props; otherwise
// { props, text, select }: the props to render as attributes, the text of a
// <textarea> (null: its children's), and the value whose options a <select>
// marks `selected` (null: the options' own marks stand).
export function _field(tag, props) {
  if (props == null || (tag !== 'input' && tag !== 'textarea' && tag !== 'select')) return null;
  let present = false;
  for (const key of FIELD_PROPS) if (Object.hasOwn(props, key)) present = true;
  if (!present) return null;
  const read = (key) => {
    const value = Object.hasOwn(props, key) ? resolveAttr(key, props[key]) : undefined;
    return value === UNRESOLVED ? undefined : value;
  };
  const type = tag === 'input' ? resolveAttr('type', props.type) : null;
  const ownValue = tag !== 'input' || !ATTRIBUTE_VALUE_TYPES.has(typeof type === 'string' ? type.toLowerCase() : '');
  const shown = ownValue ? read('value') ?? read('defaultValue') : undefined;
  const checked = tag === 'input' ? read('checked') ?? read('defaultChecked') : undefined;
  // The props without the field's, the input's shown value and checked
  // written where the first of each pair stood.
  const rest = {};
  let valueDone = false;
  let checkedDone = false;
  for (const key in props) {
    if (ownValue && (key === 'value' || key === 'defaultValue')) {
      if (!valueDone && tag === 'input' && shown != null) rest.value = shown;
      valueDone = true;
    } else if (tag === 'input' && (key === 'checked' || key === 'defaultChecked')) {
      if (!checkedDone && checked) rest.checked = true;
      checkedDone = true;
    } else {
      rest[key] = props[key];
    }
  }
  if (tag === 'input') return { props: rest, text: null, select: null };
  if (tag === 'textarea') return { props: rest, text: shown == null ? null : String(shown), select: null };
  return { props: rest, text: null, select: shown == null ? null : { value: shown } };
}

// An option open tag and its content, up to the next option, optgroup or the
// end of the select.
const OPTION = /<option(\s[^>]*)?>([\s\S]*?)(?=<\/?option[\s>]|<\/?optgroup[\s>]|<\/select>|$)/g;
const SELECTED = /\sselected(?:="[^"]*")?(?=\s|$)/g;
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const unescape = (text) => text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity]);

// An option's value in rendered markup: its value attribute, else its text
// with tags and markers removed, ASCII whitespace stripped and collapsed (the
// HTML rule: a no-break space is kept).
function optionValue(attrs, content) {
  const named = /\svalue="([^"]*)"/.exec(attrs);
  return named ? unescape(named[1]) : stripAndCollapse(unescape(content.replace(/<!--[\s\S]*?-->|<[^>]*>/g, '')));
}

// `html`, a select's rendered content, with exactly the options `value`
// selects marked `selected` (what-core's selectedOptions, the rule the client
// writes): a mark an option carried as its own default goes when the value
// does not select it.
export function _markSelected(html, value) {
  const values = [];
  for (const [, attrs = '', content] of html.matchAll(OPTION)) values.push(optionValue(attrs, content));
  const chosen = selectedOptions(values, value);
  let i = 0;
  return html.replace(OPTION, (option, attrs = '', content) => {
    const own = attrs.replace(SELECTED, '');
    return `<option${own}${chosen[i++] ? ' selected' : ''}>${content}`;
  });
}

// The class attribute the client ends up with when the props carry a classList,
// or null for none. In prop order, `class` or `className` sets the attribute,
// as `el.className = value || ''` does, and `classList` toggles each key's
// classes over it, as setClassList does through the element's DOMTokenList: a
// toggle that changes the set rewrites the attribute as its tokens,
// de-duplicated and joined by single spaces, and one that changes nothing
// leaves the attribute as it was.
function classAttribute(props, keys) {
  /** @type {string | null} */
  let value = null;
  /** @type {string[] | null} */
  let tokens = null;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key === 'class' || key === 'className') {
      const cls = resolveAttr('class', props[key]);
      if (cls === UNRESOLVED) continue;
      value = cls ? String(cls) : '';
      tokens = null;
    } else if (key === 'classList') {
      const list = resolveAttr('classList', props[key]);
      if (list === null || typeof list !== 'object') continue;
      for (const names in list) {
        let on = list[names];
        if (typeof on === 'function') {
          try { on = on(); } catch { continue; }
        }
        for (const name of names.split(/\s+/)) {
          if (!name) continue;
          if (tokens === null) {
            tokens = value === null ? [] : [...new Set(value.split(/[\t\n\f\r ]+/).filter(Boolean))];
          }
          const at = tokens.indexOf(name);
          if (on ? at !== -1 : at === -1) continue;
          if (on) tokens.push(name);
          else tokens.splice(at, 1);
          value = tokens.join(' ');
        }
      }
    }
  }
  return value;
}

// A style object as CSS text: camelCase properties in kebab-case, custom
// properties (--x) as they are. A declaration the client's CSSOM would refuse
// (a name that is not a property or a custom property, a value that ends the
// declaration or opens a block) is left out, as the client leaves it out: the
// server must not write `color: red; background: url(//tracker)` from one value.
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
function oneDeclaration(text) {
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

function styleText(style) {
  let css = '';
  for (const [property, value] of Object.entries(style)) {
    const text = String(value);
    if (!CSS_PROPERTY.test(property) || !oneDeclaration(text)) continue;
    css += (css ? ';' : '') + (property.startsWith('--') ? property : property.replace(/([A-Z])/g, '-$1').toLowerCase()) + ':' + text;
  }
  return css;
}

// The content of a <script> or <style> element sitting in namespace `ns`
// (null for HTML): the text of its children, encoded so it cannot end the
// element (rawTextContent). No hydration markers: comments inside raw text are
// text. A function child is called, and renders nothing when it throws, as a
// reactive child does anywhere else. The h() renderers and compiled markup
// both write raw text through this, so their output is the same.
// The text of a <script> or <style> (raw text, see rawTextContent), or of a
// <textarea> or <title> in HTML (escaped text, no markers).
function _rawText(tag, children, ns, field) {
  const text = field != null && field.text !== null ? field.text : textOf(tag, children);
  return RAW_TEXT_ELEMENTS.has(tag) ? rawTextContent(tag, text, ns) : escapeHtml(text);
}

// Whether `tag`'s children are written as text: raw text, or a text-only
// element in HTML.
function _isTextContent(tag, ns) {
  return RAW_TEXT_ELEMENTS.has(tag) || (ns === null && TEXT_ONLY_ELEMENTS.has(tag));
}

// What follows `tag`'s start tag before its content: a newline for the
// elements whose first newline the parser drops (LEADING_NEWLINE_ELEMENTS).
function _afterOpen(tag, ns) {
  return ns === null && LEADING_NEWLINE_ELEMENTS.has(tag) ? '\n' : '';
}

function textOf(tag, value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'function') {
    try {
      return textOf(tag, value());
    } catch (e) {
      _claimThrow(e);
      if (_isDevMode) console.warn(`[what-server] A child of <${tag}> threw during SSR: ${e && e.message}`);
      return '';
    }
  }
  if (Array.isArray(value)) {
    let text = '';
    for (let i = 0; i < value.length; i++) text += textOf(tag, value[i]);
    return text;
  }
  if (isVNode(value) || isHtml(value) || _isDomNode(value)) {
    if (_isDevMode) {
      console.warn(`[what-server] <${tag}> holds text only: an element, component or markup inside it is not rendered.`);
    }
    return '';
  }
  return String(value);
}

export {
  ATTR_INFO_CACHE_SIZE,
  SAFE_TAG_CACHE_SIZE,
  _attrInfo,
  _safeTags,
  BOUNDARY_TAGS,
  SERVER_SKIPPED_TAGS,
  VOID_ELEMENTS,
  RAW_TEXT_ELEMENTS,
  _componentProps,
  _boundaryFallback,
  _isDevMode,
  _exposesErrorDetails,
  _resolveInnerHTML,
  _claimThrow,
  _rawText,
  _isTextContent,
  _afterOpen,
  _plainText,
  assertSafeTag,
  renderAttrs,
  styleText,
  escapeHtml,
};

/**
 * The keys comment of an array a reactive child returned, which hydrate()
 * adopts as keyed rows: a compiled list's rows (_mapArrayToArray gives them
 * their keys), or h() vnodes that carry one. Vnodes of which only some carry
 * one are marked as keys hydrate() cannot compare (a compiled client keys
 * them all). '' for any other array.
 */
export function arrayKeys(rows) {
  if (rows._keys !== undefined) return rowKeys(rows._keys);
  const keys = [];
  for (const row of rows) {
    if (!isVNode(row)) return '';
    keys.push(row.key);
  }
  const keyed = keys.filter((key) => key != null).length;
  return keyed === 0 ? '' : rowKeys(keyed === keys.length ? keys : [null]);
}
