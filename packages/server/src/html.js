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
  attributeName,
  isEnumeratedAttr,
  isRefusedAttr,
  isUnsafeUrl,
  isUrlAttr,
  rawTextContent,
} from 'what-core/internal/markup-rules';
import { isVNode } from 'what-core/internal';
import { isHtml } from './compiled.js';

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
// Not yet matched: the client also UNWRAPS a single child (`[child]` -> `child`).
// Aligning that here alone would break <Island>, which puts the prop straight
// back onto a vnode's children (islands.js:243) where the element renderer
// requires an array. That one needs both sides changed together.
function _componentProps(vnode) {
  const children = vnode.children;
  if (!children || children.length === 0) return { ...vnode.props };
  return { ...vnode.props, children };
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
    _rethrowIfUnrenderable(e);
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
// what-compiler lowers a component's own JSX to a module-scope `_$template()`
// and a `cloneNode(true)` at call time, so the component RETURNS finished DOM
// rather than a vnode. Every renderer here destructures `vnode.tag`, gets
// `undefined` off an Element, and used to report ERR_INVALID_SSR_TAG: "Invalid
// tag name in SSR: undefined". That message names the wrong thing entirely.
// It sent people looking for a typo'd tag or a component returning a plain
// object, when the actual cause is that what-compiler's fine-grained output is
// client-only and there is no supported way to server-render it.
//
// This only fires when a DOM implementation exists in the process (jsdom in a
// test, a shim someone installed). On a bare Node server the compiled module
// cannot even be IMPORTED — `_$template()` runs at module scope and throws
// `ReferenceError: document is not defined` first — which is why the build-time
// guard in what-compiler's Vite plugin is the earlier and better seam. This is
// the backstop for the paths that get past it.
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
//     -> "<main></main>"          measured on origin/main
//
// The component simply vanished from the page. In development a console.warn
// fires; in production `_isDevMode` is false and nothing is logged at all, so
// the page ships with a hole in it and the server reports success.
//
// This mirrors the ownership rethrows already in the boundary branches: some
// throws are not the catcher's to absorb.
function _rethrowIfUnrenderable(e) {
  if (e && e.code === 'ERR_COMPILED_JSX_IN_SSR') throw e;
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
  const key = attributeName(propKey);
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
// properties (--x) as they are.
function styleText(style) {
  let css = '';
  for (const [property, value] of Object.entries(style)) {
    css += (css ? ';' : '') + (property.startsWith('--') ? property : property.replace(/([A-Z])/g, '-$1').toLowerCase()) + ':' + value;
  }
  return css;
}

// The content of a <script> or <style> element sitting in namespace `ns`
// (null for HTML): the text of its children, encoded so it cannot end the
// element (rawTextContent). No hydration markers: comments inside raw text are
// text. A function child is called, and renders nothing when it throws, as a
// reactive child does anywhere else. The h() renderers and compiled markup
// both write raw text through this, so their output is the same.
function _rawText(tag, children, ns) {
  return rawTextContent(tag, textOf(tag, children), ns);
}

function textOf(tag, value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'function') {
    try {
      return textOf(tag, value());
    } catch (e) {
      _rethrowIfUnrenderable(e);
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
  _rethrowIfUnrenderable,
  _rawText,
  _plainText,
  assertSafeTag,
  renderAttrs,
  styleText,
  escapeHtml,
};
