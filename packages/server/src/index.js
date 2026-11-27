// What Framework - Server
// SSR, static site generation, server components.
// Zero-JS pages by default. Islands opt-in to client JS.

import { h } from 'what-core';
import {
  _beginComponentSSR,
  _endComponentSSR,
  _mapArrayToArray,
  _enterRow,
  _leaveRow,
  _tracksRows,
  getServerContext,
  runWithServerContext,
  endHeadCollection,
  _assignOwnerPath,
  _runComponentSync,
  isVNode,
} from 'what-core/internal';
import { childNamespace } from 'what-core/internal/markup-rules';
import { serializeState } from './serialize.js';
import { getIslandStoresSnapshot } from './islands.js';
import { csrfMetaTag } from './actions.js';
import { createRenderContext, ensureServerRuntime, renderContextFrom, resourcePayload, throwIfAborted } from './context.js';
import { startStream, renderBuffered, checkStreamOptions, takesSlot } from './stream.js';
import { createResponse } from './response.js';
import {
  TAG_BOUNDARY,
  TAG_SKIPPED,
  TAG_VOID,
  tagInfo,
  VOID_ELEMENTS,
  _componentProps,
  _boundaryFallback,
  _rawText,
  _isTextContent,
  _afterOpen,
  _resolveInnerHTML,
  _claimThrow,
  _plainText,
  renderAttrs,
  _field,
  _enterSelect,
  _leaveSelect,
  _renderOption,
  _saveSelect,
  _restoreSelect,
  sink,
  escapeHtml,
  arrayKeys,
} from './html.js';
import {
  ARRAY_CLOSE,
  ARRAY_OPEN,
  BOUNDARY_CLOSE,
  BOUNDARY_FALLBACK,
  BOUNDARY_OPEN,
  REGION_CLOSE,
  REGION_OPEN,
  claim,
  createHydrationKeys,
  isHtml,
} from './compiled.js';

// The namespace the node being rendered sits in: null for HTML, else 'svg',
// 'math' or 'foreign' (what-core's childNamespace). It decides whether a
// <script> or <style> holds raw text, and nothing else.
/** @type {'svg' | 'math' | 'foreign' | null} */
let _ns = null;

function renderIn(render, child, ns, notHtml) {
  if (ns === _ns) return render(child, notHtml);
  const outer = _ns;
  _ns = ns;
  try {
    return render(child, notHtml);
  } finally {
    _ns = outer;
  }
}

// What compiled markup (ssr-runtime.js) renders its children with; `notHtml`
// is its word that the child is no Html (compiled.js).
const renderStringIn = (child, ns, notHtml) => renderIn(_renderString, child, ns, notHtml);
// The pending hydration key of the component renderToHydratableString is
// rendering (compiled.js). Compiled markup settles it through the same object.
let HK = createHydrationKeys();
const renderHydratableIn = (child, ns, notHtml) => renderIn(_renderHydratable, child, ns, notHtml);

// An element's children, in the namespace its tag gives them.
// A select carries its scope down to its options (html.js Options): `field`
// is _field's for it.
function renderElementChildren(tag, props, children, render, field) {
  if (tag === 'select' && _ns === null) {
    const outer = _enterSelect(field);
    try {
      return renderChildren(children, render);
    } finally {
      _leaveSelect(outer);
    }
  }
  const ns = childNamespace(_ns, tag, props && props.encoding);
  if (ns === _ns) return renderChildren(children, render);
  const outer = _ns;
  _ns = ns;
  try {
    return renderChildren(children, render);
  } finally {
    _ns = outer;
  }
}

// --- Render to Hydratable String ---
// Renders with the hydration protocol (compiled.js): data-hk owner-path keys
// and the region, array and boundary markers, so hydrate() adopts the
// server-rendered DOM. The stream writes the same protocol.

export function renderToHydratableString(vnode) {
  ensureServerRuntime();
  // Establish a render scope whenever one isn't already active. It is not
  // gated on `typeof document === 'undefined'` as a proxy for "are we on the
  // server": renderToString IS the server render, and the proxy is wrong under
  // any DOM shim (jsdom, happy-dom, a Workers polyfill), where SSR would run
  // with no scope at all and render-scoped state would fall back to module
  // globals. Every
  // other consumer of the context checks `typeof document` itself before reading
  // it, so a scope existing on the client changes nothing for them.
  if (!getServerContext()) return renderInOwnContext(() => renderToHydratableString(vnode));
  HK = createHydrationKeys();
  return _renderHydratable(vnode);
}

// A synchronous render that brings its own context releases it when it
// returns, which disposes every effect and computed its components created.
function renderInOwnContext(render, response) {
  const ctx = createRenderContext(undefined, response ? { response } : undefined);
  try {
    return runWithServerContext(ctx, render);
  } finally {
    ctx.release();
  }
}

// Text and markup the hydratable renderer writes go through this, in the order
// they appear in the output, so a pending hydration key sees them (compiled.js).
function out(chunk) {
  return HK.key !== null ? claim(HK, chunk) : chunk;
}

// What a renderer writes and then throws away (a reactive child that threw,
// a boundary's subtree before its fallback) must not have settled a key, so
// the key is put back as it stood.
function saveKeys() {
  return HK.key;
}

function restoreKeys(saved) {
  HK.key = saved;
}

function renderArray(rows, keys) {
  const html = out(ARRAY_OPEN) + out(keys);
  return html + renderChildren(rows, _renderHydratable) + out(ARRAY_CLOSE);
}

// What a reactive child returned: an array is the region's rows, written with
// their keys when they are keyed (arrayKeys).
function renderRegionValue(value) {
  return Array.isArray(value) ? renderArray(value, arrayKeys(value)) : _renderHydratable(value);
}

// `notHtml` true: the caller found `vnode` is no Html (renderIn).
function _renderHydratable(vnode, notHtml) {
  if (vnode == null || vnode === false || vnode === true) return '';

  // Text. A number's string form has nothing to escape. An option collecting
  // its text (html.js Options) sees it.
  if (typeof vnode === 'string') {
    if (sink.text !== null) sink.text += vnode;
    return out(escapeHtml(vnode));
  }
  if (typeof vnode === 'number') {
    if (sink.text !== null) sink.text += vnode;
    return out(String(vnode));
  }

  // Signal — unwrap
  if (typeof vnode === 'function' && vnode._signal) {
    const open = out(REGION_OPEN);
    return open + renderRegionValue(vnode()) + out(REGION_CLOSE);
  }

  // Compiled keyed list: an inserter taking (parent, marker), not a thunk.
  // Calling it with no arguments threw and SSR swallowed it, so every compiled
  // keyed list server-rendered as an empty container. See _mapArrayToArray.
  if (typeof vnode === 'function' && vnode._mapArray) {
    const saved = saveKeys();
    try {
      const open = out(REGION_OPEN);
      return open + renderRegionValue(_mapArrayToArray(vnode)) + out(REGION_CLOSE);
    } catch (e) {
      _claimThrow(e);
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.warn('[what-server] Error rendering keyed list in SSR:', e.message);
      }
      restoreKeys(saved);
      return out(REGION_OPEN + REGION_CLOSE);
    }
  }

  // Reactive function child — wrap in dynamic content markers
  if (typeof vnode === 'function') {
    const saved = saveKeys();
    try {
      const value = vnode();
      const open = out(REGION_OPEN);
      return open + renderRegionValue(value) + out(REGION_CLOSE);
    } catch (e) {
      _claimThrow(e);
      if (e && typeof e.then === 'function') throw e; // not ready: its <Suspense> shows the fallback
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.warn('[what-server] Error rendering reactive function in SSR:', e.message);
      }
      restoreKeys(saved);
      return out(REGION_OPEN + REGION_CLOSE);
    }
  }

  // Array — wrap in list markers
  if (Array.isArray(vnode)) return renderArray(vnode, '');

  if (notHtml !== true && isHtml(vnode)) return vnode.render(renderHydratableIn, HK, _ns);
  if (!isVNode(vnode)) {
    const text = _plainText(vnode);
    if (sink.text !== null) sink.text += String(vnode);
    return out(text);
  }

  // Component — its owner path is its hydration key, placed on the first
  // element of its output (compiled.js has the rule) as the output is written.
  // A built-in the compiler lowers away has none (hydration-data.js).
  const tag = vnode.tag;
  if (typeof tag === 'function') {
    const ctx = _beginComponentSSR(tag);
    if (!_assignOwnerPath(ctx, ctx._parentCtx, getServerContext(), /** @type {any} */ (vnode)._site)) {
      try {
        return _renderHydratable(_runComponentSync(ctx, callComponent, vnode));
      } finally {
        _endComponentSSR(ctx);
      }
    }
    const outer = HK.key;
    const key = /** @type {string} */ (ctx._ownerPath);
    HK.key = key;
    try {
      return _renderHydratable(_runComponentSync(ctx, callComponent, vnode));
    } finally {
      _endComponentSSR(ctx);
      if (HK.key === key) HK.key = outer;
    }
  }

  // Throws for a name no element may have.
  const info = tagInfo(tag, vnode);
  if (info.kind === TAG_SKIPPED) return '';

  // Boundary markers render their subtree between <!--b--> and <!--/b-->,
  // never themselves; <!--b!--> opens one that shows its fallback.
  if (info.kind === TAG_BOUNDARY) {
    const saved = saveKeys();
    const found = _saveSelect();
    try {
      return out(BOUNDARY_OPEN) + renderChildren(vnode.children, _renderHydratable) + out(BOUNDARY_CLOSE);
    } catch (e) {
      _claimThrow(e);
      const suspended = e && typeof e.then === 'function';
      if (suspended && vnode.tag === '__errorBoundary') throw e; // belongs to <Suspense>
      if (!suspended && vnode.tag === '__suspense') throw e;     // belongs to <ErrorBoundary>
      restoreKeys(saved);
      _restoreSelect(found);
      const open = out(BOUNDARY_FALLBACK);
      return open + _renderHydratable(_boundaryFallback(vnode, suspended ? null : e)) + out(BOUNDARY_CLOSE);
    }
  }

  // Element
  const { props, children } = vnode;
  if (_ns === null && info.kind <= TAG_VOID) {
    const open = out(info.open + (props ? renderAttrs(props) : '') + '>');
    if (info.kind === TAG_VOID) return open;
    const rawInner = _resolveInnerHTML(props);
    if (rawInner != null) return open + out(String(rawInner)) + out(info.close);
    return open + renderChildren(children, _renderHydratable) + out(info.close);
  }
  if (tag === 'option') {
    const option = _renderOption(props, out, () => optionContent(props, children, _renderHydratable));
    if (option !== null) return option;
  }
  const field = _field(tag, props);
  const open = out(`<${tag}${renderAttrs(field ? field.props : props || {})}>`);

  // Void elements
  if (VOID_ELEMENTS.has(tag)) return open;

  const rawInner = _resolveInnerHTML(props);
  if (rawInner != null) return open + out(String(rawInner)) + out(`</${tag}>`);
  const lead = _afterOpen(tag, _ns);
  if (_isTextContent(tag, _ns)) return open + lead + out(_rawText(tag, children, _ns, field)) + out(`</${tag}>`);
  return open + lead + renderElementChildren(tag, props, children, _renderHydratable, field) + out(`</${tag}>`);
}

// An option's content in a select scope: its raw inner HTML, else its children.
function optionContent(props, children, render) {
  const rawInner = _resolveInnerHTML(props);
  return rawInner != null ? String(rawInner) : renderElementChildren('option', props, children, render, null);
}

// The members of an array or of an element's children, each with a key
// (a keyed list's, or a vnode's) as a keyed row (what-core hydration-data.js
// _enterRow), and any other that can hold a component or a list (stream.js
// takesSlot) in its slot (a null list), in the frame rendering them. A keyed
// list with no rows still takes its place. Rows and slots are entered once
// keyed rows are tracked (_tracksRows: an app's first server action); until
// then nothing reads them.
function renderChildren(children, render) {
  if (!children) return '';
  const keys = children._keys;
  const slots = _tracksRows();
  let out = '';
  /** @type {object | null} */
  let list = null;
  if (slots && keys !== undefined && keys.length === 0) _enterRow(undefined, /** @type {object} */ (getServerContext()), { slot: children._slot }, undefined);
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!slots) {
      out += render(child);
      continue;
    }
    const key = keys !== undefined ? keys[i] : isVNode(child) ? child.key : null;
    const keyed = key != null || keys !== undefined;
    if (!keyed && !takesSlot(child)) {
      out += render(child);
      continue;
    }
    if (keyed && list === null) list = { slot: children._slot };
    // A render always runs in a context: the root that counts its components.
    const root = /** @type {object} */ (getServerContext());
    const saved = keyed ? _enterRow(undefined, root, list, key) : _enterRow(undefined, root, null, i);
    try {
      out += render(child);
    } finally {
      _leaveRow(undefined, root, saved);
    }
  }
  return out;
}

// A component vnode's call, which the renderers make in its frame
// (_runComponentSync).
function callComponent(vnode) {
  return vnode.tag(_componentProps(vnode));
}

// --- Render to String ---
// Renders a VNode tree to an HTML string. Used for SSR and static gen.

// `options.response` (a createResponse()) is what getResponse() returns to
// the components it renders: read its status, headers and redirect after.
export function renderToString(vnode, options) {
  ensureServerRuntime();
  // See renderToHydratableString: the scope is established by "no scope yet",
  // not by "no document".
  if (!getServerContext()) return renderInOwnContext(() => _renderString(vnode), options && options.response);
  return _renderString(vnode);
}

// The recursion behind renderToString. Separate from the public entry so the
// render-context lookup above runs once per render, not once per node.
// `notHtml` true: the caller found `vnode` is no Html (renderIn).
function _renderString(vnode, notHtml) {
  if (vnode == null || vnode === false || vnode === true) return '';

  // Text. A number's string form has nothing to escape. An option collecting
  // its text (html.js Options) sees it.
  if (typeof vnode === 'string') {
    if (sink.text !== null) sink.text += vnode;
    return escapeHtml(vnode);
  }
  if (typeof vnode === 'number') {
    if (sink.text !== null) sink.text += vnode;
    return String(vnode);
  }

  // Signal — unwrap by calling it
  if (typeof vnode === 'function' && vnode._signal) {
    return _renderString(vnode());
  }

  // Compiled keyed list: see _renderHydratable above.
  if (typeof vnode === 'function' && vnode._mapArray) {
    try {
      return _renderString(_mapArrayToArray(vnode));
    } catch (e) {
      _claimThrow(e);
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.warn('[what-server] Error rendering keyed list in SSR:', e.message);
      }
      return '';
    }
  }

  // Reactive function child — call to get value
  if (typeof vnode === 'function') {
    try {
      return _renderString(vnode());
    } catch (e) {
      _claimThrow(e);
      if (e && typeof e.then === 'function') throw e; // not ready: its <Suspense> shows the fallback
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.warn('[what-server] Error rendering reactive function in SSR:', e.message);
      }
      return '';
    }
  }

  // Array
  if (Array.isArray(vnode)) return renderChildren(vnode, _renderString);

  if (notHtml !== true && isHtml(vnode)) return vnode.render(renderStringIn, null, _ns);
  if (!isVNode(vnode)) {
    const text = _plainText(vnode);
    if (sink.text !== null) sink.text += String(vnode);
    return text;
  }

  // Component
  //
  // Run it under a component frame (an owner). Calling it bare left no
  // component current, so every context-dependent hook threw and the render
  // failed outright rather than degrading. The frame has to stay current while
  // the result is rendered, because useContext resolves by walking owners.
  const tag = vnode.tag;
  if (typeof tag === 'function') {
    const ctx = _beginComponentSSR(tag);
    _assignOwnerPath(ctx, ctx._parentCtx, getServerContext(), /** @type {any} */ (vnode)._site);
    try {
      return _renderString(_runComponentSync(ctx, callComponent, vnode));
    } finally {
      _endComponentSSR(ctx);
    }
  }

  // Throws for a name no element may have.
  const info = tagInfo(tag, vnode);
  if (info.kind === TAG_SKIPPED) return '';

  // Boundary markers render their subtree, never themselves.
  //
  // <Suspense>: if a child suspends (throws a thenable), show the fallback, since
  // a synchronous render cannot await. renderToStringAsync / renderToStream await
  // the pending resources and re-render with real content.
  //
  // <ErrorBoundary>: if a child throws a real error, show the fallback. Before
  // this branch existed the error propagated out of renderToString and killed the
  // whole page response, which is precisely the failure an ErrorBoundary exists
  // to prevent.
  if (info.kind === TAG_BOUNDARY) {
    const found = _saveSelect();
    try {
      return renderChildren(vnode.children, _renderString);
    } catch (e) {
      _claimThrow(e);
      const suspended = e && typeof e.then === 'function';
      if (suspended && vnode.tag === '__errorBoundary') throw e; // belongs to <Suspense>
      if (!suspended && vnode.tag === '__suspense') throw e;     // belongs to <ErrorBoundary>
      _restoreSelect(found);
      return _renderString(_boundaryFallback(vnode, suspended ? null : e));
    }
  }

  // Element. One whose name asks for no further rule (html.js TAG_PLAIN) is
  // written straight from its tag's record.
  const { props, children } = vnode;
  if (_ns === null && info.kind <= TAG_VOID) {
    const open = info.open + (props ? renderAttrs(props) : '') + '>';
    if (info.kind === TAG_VOID) return open;
    const rawInner = _resolveInnerHTML(props);
    if (rawInner != null) return open + String(rawInner) + info.close;
    return open + renderChildren(children, _renderString) + info.close;
  }
  if (tag === 'option') {
    const option = _renderOption(props, asIs, () => optionContent(props, children, _renderString));
    if (option !== null) return option;
  }
  const field = _field(tag, props);
  const attrs = renderAttrs(field ? field.props : props || {});
  const open = `<${tag}${attrs}>`;

  // Void elements
  if (VOID_ELEMENTS.has(tag)) return open;

  const rawInner = _resolveInnerHTML(props);
  if (rawInner != null) return `${open}${String(rawInner)}</${tag}>`;
  const lead = _afterOpen(tag, _ns);
  if (_isTextContent(tag, _ns)) return `${open}${lead}${_rawText(tag, children, _ns, field)}</${tag}>`;
  return `${open}${lead}${renderElementChildren(tag, props, children, _renderString, field)}</${tag}>`;
}

const asIs = (html) => html;

// --- Render to String + collected <head> ---
// Like renderToString, but captures any <Head> tags declared anywhere in the
// tree into a render-scoped sink and returns them as escaped <head> HTML.
//
// Concurrency: renderToString is synchronous, so the render context set by
// runWithServerContext lives within one uninterrupted tick — safe under
// concurrent requests (no two renders interleave in the sync path).
export function renderToStringWithHead(vnode) {
  ensureServerRuntime();
  const ctx = createRenderContext(undefined);
  try {
    const body = runWithServerContext(ctx, () => renderToString(vnode));
    return { body, head: endHeadCollection(ctx.head) };
  } finally {
    ctx.release();
  }
}

// --- Render a page module (loader + component) ---
// Runs the page's `export const loader` (if any) BEFORE the synchronous render,
// so the resolved value is plain data by the time the render reads it. The
// loader receives { params, query, request, signal, response }. Its result is
// passed to the page component as a `loaderData` prop and is readable anywhere
// via useLoaderData(). `signal` aborts when the client goes away; once it has,
// no render starts. `response` (response.js) sets the status, headers or a
// redirect; pass your own as `reqCtx.response` to read them afterwards. A
// loader that redirects skips the render: the page body is left empty.
//
// `pageModule` is `{ default: Component, loader? }` (the shape file-router emits).
export async function renderPage(pageModule, reqCtx = {}) {
  ensureServerRuntime();
  const page = await loadPage(pageModule, reqCtx);
  try {
    const body = runWithServerContext(page.ctx, () => renderToString(page.vnode));
    return { body, head: endHeadCollection(page.ctx.head), loaderData: page.loaderData };
  } finally {
    page.ctx.release();
  }
}

// Run the loader and set up the render: its context, and the vnode to render
// (null when the loader redirected, so nothing renders for nobody). The loader
// receives the render's own signal (context.js), which follows the request's.
// A loader that throws releases the context it would have rendered in.
async function loadPage(pageModule, reqCtx) {
  const Component = pageModule.default || pageModule;
  const { actionState, ...loaderCtx } = reqCtx;
  const response = reqCtx.response || createResponse();
  const ctx = createRenderContext(undefined, {
    signal: reqCtx.signal || (reqCtx.request && reqCtx.request.signal),
    request: reqCtx.request,
    response,
  });
  // What the action of a form posted to this page without JavaScript
  // returned, for that form's useActionState (actions.js formState).
  if (actionState) ctx.actionState = actionState;
  try {
    throwIfAborted(ctx.signal);
    if (typeof pageModule.loader === 'function') {
      // In the request's render context: the queries it prefetches are this
      // request's, and reach its page and its data channel.
      ctx.loaderData = await runWithServerContext(ctx, () => pageModule.loader({ ...loaderCtx, signal: ctx.signal, response }));
    }
    throwIfAborted(ctx.signal);
  } catch (error) {
    ctx.release();
    throw error;
  }
  const loaderData = ctx.loaderData;
  const vnode = response.location ? null : h(Component, { ...(reqCtx.params || {}), loaderData });
  return { ctx, vnode, loaderData };
}

// --- Async render (resolves Suspense / createResource data) ---
// Renders with the streaming engine and waits for everything it waits for: a
// resource read inside or outside a <Suspense>, an async component, a lazy()
// component. The body is the settled page, each boundary's content in place
// (or its fallback, for a boundary that could not finish), byte for byte what
// the streamed render shows once every swap has run. Returns the body, the
// collected head (including tags set inside boundaries), and the resolved
// resources for the hydration payload. Rejects with the Error that failed the
// render. `options.onError` is the stream's (default console.error).
export async function renderToStringAsync(vnode, init, options = {}) {
  ensureServerRuntime();
  return renderSettled(vnode, renderContextFrom(init, 'renderToStringAsync(vnode, init)'), options);
}

async function renderSettled(vnode, ctx, options) {
  const body = await renderBuffered(vnode, ctx, options);
  const { resources = {}, owned = {} } = resourcePayload(ctx);
  return { body, head: endHeadCollection(ctx.head), loaderData: ctx.loaderData, resources, owned, ctx, response: ctx.response };
}

// --- Render a complete HTML document (loader + data + head + hydration payload) ---
// The full-stack entry: runs the loader, renders (resolving async resources),
// and emits one consolidated <script id="__what_data"> with { loaderData,
// resources, islandStores } for the client to hydrate from without refetching.
export async function renderDocument(pageModule, reqCtx = {}, options = {}) {
  ensureServerRuntime();
  const { ctx, vnode, loaderData } = await loadPage(pageModule, reqCtx);
  const { body, head } = await renderSettled(vnode, ctx, options);
  ctx.response._commit();
  const payload = {
    loaderData: loaderData ?? null,
    resources: {},
    ...resourcePayload(ctx),
    islandStores: getIslandStoresSnapshot(ctx),
  };
  return wrapHtmlDocument({ body, head, payload, options });
}

// --- Streamed document ---
// The same document as renderDocument, streamed: the shell (head, everything
// outside a waiting <Suspense>, the hydration payload and the client entry)
// goes out first and each boundary follows when it is ready (see stream.js).
// Resolves once the loader has run. Await `shellReady` on the result before
// sending a status line; the loader and the shell are what decide it.
export async function renderDocumentStream(pageModule, reqCtx = {}, options = {}) {
  ensureServerRuntime();
  checkStreamOptions(options);
  const { ctx, vnode, loaderData } = await loadPage(pageModule, reqCtx);
  return startStream(vnode, ctx, options, {
    head: true,
    open: (renderCtx) => documentOpen(endHeadCollection(renderCtx.head), options),
    shellData: (renderCtx, sent) => documentData({
      loaderData: loaderData ?? null,
      resources: {},
      ...resourcePayload(renderCtx, sent),
      islandStores: getIslandStoresSnapshot(renderCtx),
    }, options),
    close: DOCUMENT_CLOSE,
  });
}

/**
 * @param {object} args
 * @param {string} args.body
 * @param {string} args.head
 * @param {any} args.payload
 * @param {DocumentOptions} [args.options]
 */
function wrapHtmlDocument({ body, head, payload, options = {} }) {
  return documentOpen(head, options) + body + documentData(payload, options) + DOCUMENT_CLOSE;
}

/**
 * @typedef {{ lang?: string, clientEntry?: string, csrfToken?: string, head?: string, bodyClass?: string, nonce?: string }} DocumentOptions
 */

/** @param {string} head @param {DocumentOptions} options */
function documentOpen(head, options) {
  const lang = options.lang || 'en';
  // CSRF auto-provisioning: when the caller (e.g. the deploy adapter with
  // default-on CSRF) passes the per-request token, embed it as the meta tag
  // the client action() wrapper and plain <form> posts read it from.
  const csrfHead = options.csrfToken ? csrfMetaTag(options.csrfToken) : '';
  const extraHead = csrfHead + (options.head || '');
  const bodyClass = options.bodyClass ? ` class="${escapeHtml(options.bodyClass)}"` : '';
  return (
    `<!DOCTYPE html><html lang="${escapeHtml(lang)}"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `${head || ''}${extraHead}</head><body${bodyClass}>`
  );
}

/** The hydration payload and the client entry. @param {any} payload @param {DocumentOptions} options */
function documentData(payload, options) {
  const nonce = options.nonce ? ` nonce="${escapeHtml(String(options.nonce))}"` : '';
  const dataScript = `<script id="__what_data" type="application/json"${nonce}>${serializeState(payload)}</script>`;
  const clientScript = options.clientEntry
    ? `<script type="module" src="${escapeHtml(options.clientEntry)}"${nonce}></script>`
    : '';
  return dataScript + clientScript;
}

const DOCUMENT_CLOSE = '</body></html>';

// --- Stream Render ---
export { renderToStream } from './stream.js';

export { ensureServerRuntime, getRequest } from './context.js';
export { createResponse } from './response.js';

// --- Static Site Generation ---

export function definePage(config) {
  return {
    // 'static' = pre-render at build time (default)
    // 'server' = render on each request
    // 'client' = render in browser (SPA)
    // 'hybrid' = static shell + islands
    mode: 'static',
    ...config,
  };
}

// Generate static HTML for a page
export function generateStaticPage(page, data = {}) {
  ensureServerRuntime();
  const ctx = createRenderContext(data);
  // Render the page as a vnode instead of calling the component and handing the
  // result over. `page.component(data)` ran BARE, outside the component frame
  // renderToString establishes, so no component was current and every
  // context-dependent hook threw: useState, useSignal, useEffect, useMemo,
  // useRef, onMount and <Ctx.Provider> all resolve through
  // getCurrentComponent(). One hook anywhere in the page component's own body
  // meant THE documented static-generation entry point could not render it at
  // all, which rules out most real pages.
  //
  // `data` still reaches the component as its props (the same convention
  // renderPage uses), and the body HTML this produces is byte-identical for a
  // page that does not use hooks, so what wrapDocument receives is unchanged.
  let html;
  try {
    html = runWithServerContext(ctx, () => renderToString(h(page.component, data)));
  } finally {
    ctx.release();
  }
  const islands = page.islands || [];

  return wrapDocument({
    title: page.title || '',
    meta: page.meta || {},
    body: html,
    islands,
    scripts: page.mode === 'static' ? [] : page.scripts || [],
    styles: page.styles || [],
    mode: page.mode,
  });
}

function wrapDocument({ title, meta, body, islands, scripts, styles, mode }) {
  const metaTags = Object.entries(meta)
    .map(([name, content]) => `<meta name="${escapeHtml(name)}" content="${escapeHtml(content)}">`)
    .join('\n    ');

  const styleTags = styles
    .map(href => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
    .join('\n    ');

  const islandScript = islands.length > 0 ? `
    <script type="module">
      import { hydrateIslands } from '/@what/islands.js';
      hydrateIslands();
    </script>` : '';

  const scriptTags = scripts
    .map(src => `<script type="module" src="${escapeHtml(src)}"></script>`)
    .join('\n    ');

  const clientScript = mode === 'client' ? `
    <script type="module" src="/@what/client.js"></script>` : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${metaTags}
    <title>${escapeHtml(title)}</title>
    ${styleTags}
  </head>
  <body>
    <div id="app">${body}</div>
    ${islandScript}
    ${scriptTags}
    ${clientScript}
  </body>
</html>`;
}

// --- Server Component ---
// Renders on the server, sends HTML to client. No JS shipped.

export function server(Component) {
  Component._server = true;
  return Component;
}

// Re-export server actions
export {
  action,
  useOptimistic,
  onRevalidate,
  invalidatePath,
  handleActionRequest,
  getRegisteredActions,
  generateCsrfToken,
  validateCsrfToken,
  csrfMetaTag,
} from './actions.js';

// <Form>: the progressive-enhancement form that posts to the action endpoint.
export { Form, ACTION_ENDPOINT } from './form.js';

// Served server actions: wire the /__what_action route (Node + fetch adapters),
// and run a form posted to a page.
export {
  createActionHandler,
  createFormPostHandler,
  nodeActionMiddleware,
  fetchActionHandler,
} from './action-handler.js';

// Revalidation registry — app code calls revalidatePath/revalidateTag; the
// deploy adapter binds a what-isr engine via setRevalidationHandler.
export {
  revalidatePath,
  revalidateTag,
  setRevalidationHandler,
  getRevalidationHandler,
} from './revalidation-registry.js';

// Runtime-neutral deploy adapters. Node-only adapters are re-exported by the
// package's conditional Node entry so browser/edge bundles never resolve Node
// builtins merely because they import a client-safe server action.
export { createRequestHandler, createRouteRenderer } from './adapter/core.js';
export { createCloudflareHandler } from './adapter/cloudflare.js';

// Safe state serialization for inlining into <script> tags
export { serializeState } from './serialize.js';
