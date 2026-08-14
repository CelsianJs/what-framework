// What Framework - Server
// SSR, static site generation, server components.
// Zero-JS pages by default. Islands opt-in to client JS.

import {
  h,
  _isAriaAttr,
  _beginComponentSSR,
  _endComponentSSR,
  _mapArrayToArray,
  getServerContext,
  runWithServerContext,
  beginHeadCollection,
  endHeadCollection,
} from 'what-core';
import { serializeState } from './serialize.js';
import { getIslandStoresSnapshot } from './islands.js';
import { csrfMetaTag } from './actions.js';

// Build a fresh render-scoped server context (head sink, loader data, resources).
function createRenderContext(loaderData) {
  return {
    head: beginHeadCollection(),
    loaderData,
    resources: new Map(),
    islandStores: new Map(),
    resourceCounter: 0,
    boundaryCounter: 0,
    suspended: [],
  };
}

// --- Hydration ID Generator ---
let _hydrationIdCounter = 0;

function resetHydrationId() {
  _hydrationIdCounter = 0;
}

function nextHydrationId() {
  return 'h' + (_hydrationIdCounter++);
}

// --- Render to Hydratable String ---
// Renders with hydration markers (data-hk attributes, comment boundaries)
// so the client can reuse the server-rendered DOM.

export function renderToHydratableString(vnode) {
  // Establish a render scope whenever one isn't already active. This used to be
  // gated on `typeof document === 'undefined'` as a proxy for "are we on the
  // server", but renderToString IS the server render, and the proxy is wrong
  // under any DOM shim (jsdom, happy-dom, a Workers polyfill) where SSR ran with
  // no scope at all and render-scoped state fell back to module globals. Every
  // other consumer of the context checks `typeof document` itself before reading
  // it, so a scope existing on the client changes nothing for them.
  if (!getServerContext()) {
    const ctx = createRenderContext(undefined);
    return runWithServerContext(ctx, () => renderToHydratableString(vnode));
  }
  resetHydrationId();
  return _renderHydratable(vnode);
}

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

function _boundaryFallback(vnode, error) {
  const fallback = vnode.props && vnode.props.fallback;
  if (typeof fallback !== 'function') return fallback;
  const reset = (vnode.props && vnode.props.reset) || (() => {});
  try {
    return fallback({ error, reset });
  } catch (e) {
    if (_isDevMode) {
      console.warn(`[what-server] <ErrorBoundary> fallback threw during SSR: ${e.message}`);
    }
    return null;
  }
}

function _renderHydratable(vnode) {
  if (vnode == null || vnode === false || vnode === true) return '';

  // Text
  if (typeof vnode === 'string' || typeof vnode === 'number') {
    return escapeHtml(String(vnode));
  }

  // Signal — unwrap
  if (typeof vnode === 'function' && vnode._signal) {
    return `<!--$-->${_renderHydratable(vnode())}<!--/$-->`;
  }

  // Compiled keyed list: an inserter taking (parent, marker), not a thunk.
  // Calling it with no arguments threw and SSR swallowed it, so every compiled
  // keyed list server-rendered as an empty container. See _mapArrayToArray.
  if (typeof vnode === 'function' && vnode._mapArray) {
    try {
      return `<!--$-->${_renderHydratable(_mapArrayToArray(vnode))}<!--/$-->`;
    } catch (e) {
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.warn('[what-server] Error rendering keyed list in SSR:', e.message);
      }
      return '<!--$--><!--/$-->';
    }
  }

  // Reactive function child — wrap in dynamic content markers
  if (typeof vnode === 'function') {
    try {
      return `<!--$-->${_renderHydratable(vnode())}<!--/$-->`;
    } catch (e) {
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.warn('[what-server] Error rendering reactive function in SSR:', e.message);
      }
      return '<!--$--><!--/$-->';
    }
  }

  // Array — wrap in list markers
  if (Array.isArray(vnode)) {
    return `<!--[]-->${vnode.map(_renderHydratable).join('')}<!--/[]-->`;
  }

  if (SERVER_SKIPPED_TAGS.has(vnode.tag)) return '';

  // Boundary markers render their subtree, never themselves.
  if (BOUNDARY_TAGS.has(vnode.tag)) {
    try {
      return (vnode.children || []).map(_renderHydratable).join('');
    } catch (e) {
      const suspended = e && typeof e.then === 'function';
      if (suspended && vnode.tag === '__errorBoundary') throw e; // belongs to <Suspense>
      if (!suspended && vnode.tag === '__suspense') throw e;     // belongs to <ErrorBoundary>
      return _renderHydratable(_boundaryFallback(vnode, suspended ? null : e));
    }
  }

  // Component — add hydration key to root element
  if (typeof vnode.tag === 'function') {
    const hkId = nextHydrationId();
    const ctx = _beginComponentSSR(vnode.tag);
    let html;
    try {
      html = _renderHydratable(vnode.tag(_componentProps(vnode)));
    } finally {
      _endComponentSSR(ctx);
    }
    // Inject data-hk into the first element tag if present
    return injectHydrationKey(html, hkId);
  }

  // Element
  const { tag, props, children } = vnode;
  assertSafeTag(tag);
  const attrs = renderAttrs(props || {});
  const open = `<${tag}${attrs}>`;

  // Void elements
  if (VOID_ELEMENTS.has(tag)) return open;

  const rawInner = _resolveInnerHTML(props);
  const inner = rawInner != null ? String(rawInner) : children.map(_renderHydratable).join('');
  return `${open}${inner}</${tag}>`;
}

// Inject data-hk="id" into the first HTML opening tag
function injectHydrationKey(html, hkId) {
  // Skip comment markers to find the first real element
  const match = html.match(/^((?:<!--.*?-->)*)<([a-zA-Z][a-zA-Z0-9-]*)/);
  if (match) {
    const prefix = match[1];
    const tagName = match[2];
    const insertAt = prefix.length + 1 + tagName.length; // after '<tagName'

    // One element, one key. Every component in a chain injects into the first
    // element of its rendered output, and a component that returns another
    // component (the most ordinary composition there is) resolves to the SAME
    // element at every level, so `Outer -> Middle -> Inner -> <p>` emitted
    // `<p data-hk="h0" data-hk="h1" data-hk="h2">`: a duplicate attribute, which
    // is invalid HTML, and browsers silently keep only the first. The innermost
    // component is the one that actually owns the element, and it wins because
    // it renders first, so an existing key means there is nothing to do here.
    const openTagEnd = html.indexOf('>', insertAt);
    const openTag = html.slice(insertAt, openTagEnd === -1 ? undefined : openTagEnd);
    if (/[\s"']data-hk\s*=/.test(openTag) || /^\s*data-hk\s*=/.test(openTag)) return html;

    return html.slice(0, insertAt) + ` data-hk="${hkId}"` + html.slice(insertAt);
  }
  return html;
}

// --- Render to String ---
// Renders a VNode tree to an HTML string. Used for SSR and static gen.

export function renderToString(vnode) {
  // See renderToHydratableString: the scope is established by "no scope yet",
  // not by "no document".
  if (!getServerContext()) {
    const ctx = createRenderContext(undefined);
    return runWithServerContext(ctx, () => renderToString(vnode));
  }
  if (vnode == null || vnode === false || vnode === true) return '';

  // Text
  if (typeof vnode === 'string' || typeof vnode === 'number') {
    return escapeHtml(String(vnode));
  }

  // Signal — unwrap by calling it
  if (typeof vnode === 'function' && vnode._signal) {
    return renderToString(vnode());
  }

  // Compiled keyed list: see _renderHydratable above.
  if (typeof vnode === 'function' && vnode._mapArray) {
    try {
      return renderToString(_mapArrayToArray(vnode));
    } catch (e) {
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.warn('[what-server] Error rendering keyed list in SSR:', e.message);
      }
      return '';
    }
  }

  // Reactive function child — call to get value
  if (typeof vnode === 'function') {
    try {
      return renderToString(vnode());
    } catch (e) {
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.warn('[what-server] Error rendering reactive function in SSR:', e.message);
      }
      return '';
    }
  }

  // Array
  if (Array.isArray(vnode)) {
    return vnode.map(renderToString).join('');
  }

  if (SERVER_SKIPPED_TAGS.has(vnode.tag)) return '';

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
  if (BOUNDARY_TAGS.has(vnode.tag)) {
    try {
      return (vnode.children || []).map(renderToString).join('');
    } catch (e) {
      const suspended = e && typeof e.then === 'function';
      if (suspended && vnode.tag === '__errorBoundary') throw e; // belongs to <Suspense>
      if (!suspended && vnode.tag === '__suspense') throw e;     // belongs to <ErrorBoundary>
      return renderToString(_boundaryFallback(vnode, suspended ? null : e));
    }
  }

  // Component
  //
  // Run it under a component context. Calling it bare left the component stack
  // empty, so every context-dependent hook threw and the render failed outright
  // rather than degrading. The context has to stay on the stack while the
  // result is rendered, because useContext resolves by walking parent contexts.
  if (typeof vnode.tag === 'function') {
    const ctx = _beginComponentSSR(vnode.tag);
    try {
      return renderToString(vnode.tag(_componentProps(vnode)));
    } finally {
      _endComponentSSR(ctx);
    }
  }

  // Element
  const { tag, props, children } = vnode;
  assertSafeTag(tag);
  const attrs = renderAttrs(props || {});
  const open = `<${tag}${attrs}>`;

  // Void elements
  if (VOID_ELEMENTS.has(tag)) return open;

  const rawInner = _resolveInnerHTML(props);
  const inner = rawInner != null ? String(rawInner) : children.map(renderToString).join('');
  return `${open}${inner}</${tag}>`;
}

// --- Render to String + collected <head> ---
// Like renderToString, but captures any <Head> tags declared anywhere in the
// tree into a render-scoped sink and returns them as escaped <head> HTML.
//
// Concurrency: renderToString is synchronous, so the render context set by
// runWithServerContext lives within one uninterrupted tick — safe under
// concurrent requests (no two renders interleave in the sync path).
export function renderToStringWithHead(vnode) {
  const ctx = createRenderContext(undefined);
  const body = runWithServerContext(ctx, () => renderToString(vnode));
  return { body, head: endHeadCollection(ctx.head) };
}

// --- Render a page module (loader + component) ---
// Runs the page's `export const loader` (if any) BEFORE the synchronous render,
// so the resolved value is plain data by the time the render reads it. The
// loader receives { params, query, request }. Its result is passed to the page
// component as a `loaderData` prop and is readable anywhere via useLoaderData().
//
// `pageModule` is `{ default: Component, loader? }` (the shape file-router emits).
export async function renderPage(pageModule, reqCtx = {}) {
  const Component = pageModule.default || pageModule;
  const loaderData = typeof pageModule.loader === 'function'
    ? await pageModule.loader(reqCtx)
    : undefined;
  const ctx = createRenderContext(loaderData);
  const params = reqCtx.params || {};
  const body = runWithServerContext(ctx, () =>
    renderToString(h(Component, { ...params, loaderData }))
  );
  return { body, head: endHeadCollection(ctx.head), loaderData };
}

// --- Async render (resolves Suspense / createResource data) ---
// Renders, then awaits any resources that suspended, then re-renders with the
// resolved data — repeating until the tree is stable. Returns the body, the
// collected head, and the resolved resources for the hydration payload.
const MAX_RESOLVE_PASSES = 12;

export async function renderToStringAsync(vnode, ctx) {
  if (!ctx) ctx = createRenderContext(undefined);
  let body = '';
  for (let pass = 0; pass < MAX_RESOLVE_PASSES; pass++) {
    body = runWithServerContext(ctx, () => renderToString(vnode));
    const pending = [...ctx.resources.values()]
      .filter((r) => r.status === 'pending')
      .map((r) => r.promise);
    if (pending.length === 0) break;
    await Promise.all(pending);
  }
  const resources = {};
  for (const [k, v] of ctx.resources) if (v.status === 'ready') resources[k] = v.value;
  return { body, head: endHeadCollection(ctx.head), loaderData: ctx.loaderData, resources, ctx };
}

// --- Render a complete HTML document (loader + data + head + hydration payload) ---
// The full-stack entry: runs the loader, renders (resolving async resources),
// and emits one consolidated <script id="__what_data"> with { loaderData,
// resources, islandStores } for the client to hydrate from without refetching.
export async function renderDocument(pageModule, reqCtx = {}, options = {}) {
  const Component = pageModule.default || pageModule;
  const loaderData = typeof pageModule.loader === 'function'
    ? await pageModule.loader(reqCtx)
    : undefined;
  const ctx = createRenderContext(loaderData);
  const params = reqCtx.params || {};
  const { body, head, resources } = await renderToStringAsync(
    h(Component, { ...params, loaderData }),
    ctx
  );
  const payload = {
    loaderData: loaderData ?? null,
    resources,
    islandStores: getIslandStoresSnapshot(ctx),
  };
  return wrapHtmlDocument({ body, head, payload, options });
}

function wrapHtmlDocument({ body, head, payload, options = {} }) {
  const lang = options.lang || 'en';
  const dataScript = `<script id="__what_data" type="application/json">${serializeState(payload)}</script>`;
  const clientScript = options.clientEntry
    ? `<script type="module" src="${escapeHtml(options.clientEntry)}"></script>`
    : '';
  // CSRF auto-provisioning: when the caller (e.g. the deploy adapter with
  // default-on CSRF) passes the per-request token, embed it as the meta tag
  // the client action() wrapper and plain <form> posts read it from.
  const csrfHead = options.csrfToken ? csrfMetaTag(options.csrfToken) : '';
  const extraHead = csrfHead + (options.head || '');
  const bodyClass = options.bodyClass ? ` class="${escapeHtml(options.bodyClass)}"` : '';
  return (
    `<!DOCTYPE html><html lang="${escapeHtml(lang)}"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `${head || ''}${extraHead}</head><body${bodyClass}>` +
    `${body}${dataScript}${clientScript}</body></html>`
  );
}

// --- Stream Render ---
// Returns an async iterator for streaming SSR. `ctx` is threaded explicitly so
// concurrent streams never share state across `await` points.

export async function* renderToStream(vnode, ctx) {
  if (ctx === undefined) ctx = createRenderContext(undefined);
  if (vnode == null || vnode === false || vnode === true) return;

  if (typeof vnode === 'string' || typeof vnode === 'number') {
    yield escapeHtml(String(vnode));
    return;
  }

  // Signal — unwrap by calling it
  if (typeof vnode === 'function' && vnode._signal) {
    const value = runWithServerContext(ctx, () => vnode());
    yield* renderToStream(value, ctx);
    return;
  }

  // Compiled keyed list: see _renderHydratable above.
  if (typeof vnode === 'function' && vnode._mapArray) {
    let rows = null;
    try {
      rows = runWithServerContext(ctx, () => _mapArrayToArray(vnode));
    } catch (e) {
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.warn('[what-server] Error rendering keyed list in stream SSR:', e.message);
      }
    }
    if (rows) yield* renderToStream(rows, ctx);
    return;
  }

  // Reactive function child — call to get value
  if (typeof vnode === 'function') {
    try {
      const value = runWithServerContext(ctx, () => vnode());
      yield* renderToStream(value, ctx);
    } catch (e) {
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.warn('[what-server] Error rendering reactive function in stream SSR:', e.message);
      }
    }
    return;
  }

  if (Array.isArray(vnode)) {
    for (const child of vnode) {
      yield* renderToStream(child, ctx);
    }
    return;
  }

  if (SERVER_SKIPPED_TAGS.has(vnode.tag)) return;

  // Error boundary: render the subtree, and on a real error emit the fallback
  // rather than the generic component-error comment the catch below would
  // produce. Rendered eagerly into a string instead of streamed, because a
  // boundary that has already yielded half its subtree cannot take it back.
  if (vnode.tag === '__errorBoundary') {
    let html;
    try {
      html = runWithServerContext(ctx, () => (vnode.children || []).map(renderToString).join(''));
    } catch (e) {
      if (e && typeof e.then === 'function') throw e; // suspended; belongs to <Suspense>
      html = runWithServerContext(ctx, () => renderToString(_boundaryFallback(vnode, e)));
    }
    yield html;
    return;
  }

  // Suspense boundary — render the subtree, awaiting any suspended resources,
  // then emit the resolved content. (In-order; out-of-order swap is a future
  // enhancement.) The synchronous render runs inside the threaded ctx.
  if (vnode.tag === '__suspense') {
    let html = null;
    for (let attempt = 0; attempt < MAX_RESOLVE_PASSES && html === null; attempt++) {
      let suspended = null;
      try {
        html = runWithServerContext(ctx, () => (vnode.children || []).map(renderToString).join(''));
      } catch (e) {
        if (e && typeof e.then === 'function') suspended = e;
        else throw e;
      }
      if (html === null) {
        const pending = [...ctx.resources.values()].filter((r) => r.status === 'pending').map((r) => r.promise);
        await Promise.all([suspended, ...pending].filter(Boolean));
      }
    }
    if (html === null) {
      html = runWithServerContext(ctx, () => renderToString(vnode.props && vnode.props.fallback));
    }
    yield html;
    return;
  }

  if (typeof vnode.tag === 'function') {
    // The frame stays open across the yields below: useContext resolves by
    // walking parent contexts, so a Provider's context has to outlive the
    // streaming of its own subtree.
    const componentCtx = _beginComponentSSR(vnode.tag);
    try {
      const result = runWithServerContext(
        ctx,
        () => vnode.tag(_componentProps(vnode))
      );
      // Support async components
      const resolved = result instanceof Promise ? await result : result;
      yield* renderToStream(resolved, ctx);
    } catch (e) {
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.warn('[what-server] Error rendering component in stream SSR:', e.message);
      }
      yield _isDevMode
        ? `<!-- SSR Error: ${escapeHtml(e.message || 'Component error')} -->`
        : `<!-- SSR Error -->`;
    } finally {
      _endComponentSSR(componentCtx);
    }
    return;
  }

  const { tag, props, children } = vnode;
  assertSafeTag(tag);
  const attrs = renderAttrs(props || {});
  yield `<${tag}${attrs}>`;

  if (!VOID_ELEMENTS.has(tag)) {
    const rawInner = _resolveInnerHTML(props);
    if (rawInner != null) {
      yield String(rawInner);
    } else {
      for (const child of children) {
        yield* renderToStream(child, ctx);
      }
    }
    yield `</${tag}>`;
  }
}

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
  const ctx = createRenderContext(data);
  // Render the page as a vnode instead of calling the component and handing the
  // result over. `page.component(data)` ran BARE, outside the component frame
  // renderToString establishes, so nothing was on the component stack and every
  // context-dependent hook threw: useState, useSignal, useEffect, useMemo,
  // useRef, onMount and <Ctx.Provider> all resolve through
  // getCurrentComponent(). One hook anywhere in the page component's own body
  // meant THE documented static-generation entry point could not render it at
  // all, which rules out most real pages.
  //
  // `data` still reaches the component as its props (the same convention
  // renderPage uses), and the body HTML this produces is byte-identical for a
  // page that does not use hooks, so what wrapDocument receives is unchanged.
  const html = runWithServerContext(ctx, () => renderToString(h(page.component, data)));
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

// --- Helpers ---

// Dev-mode flag for server
const _isDevMode = typeof process !== 'undefined'
  ? process.env?.NODE_ENV !== 'production'
  : true;

/**
 * Resolve innerHTML / dangerouslySetInnerHTML from props.
 * Requires { __html: ... } wrapper. Plain string innerHTML is rejected (XSS prevention).
 */
function _resolveInnerHTML(props) {
  if (!props) return null;

  // dangerouslySetInnerHTML always requires { __html }
  if (props.dangerouslySetInnerHTML) {
    return props.dangerouslySetInnerHTML.__html ?? null;
  }

  // innerHTML with { __html } wrapper — allowed
  if (props.innerHTML && typeof props.innerHTML === 'object' && '__html' in props.innerHTML) {
    return props.innerHTML.__html ?? null;
  }

  // innerHTML as plain string — reject with warning
  if (props.innerHTML != null && typeof props.innerHTML === 'string') {
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

// Attribute NAMES are emitted verbatim into the HTML, so they must be
// validated (values are escaped, names cannot be). Anything outside this
// pattern (spaces, quotes, equals, ...) could otherwise inject attributes:
//   h('div', { 'x" onload="alert(1)': '' })  ->  <div x" onload="alert(1)>
// Allows letters, digits, '_', ':', '.', '-' — covers data-*, aria-*,
// xlink:href, SVG names like stroke-width, and namespaced attributes.
const SAFE_ATTR_NAME = /^[a-zA-Z_:][a-zA-Z0-9:._-]*$/;

// Tag names are emitted verbatim too, so they get the same treatment:
//   h('div onload=alert(1) x', {})  ->  <div onload=alert(1) x>
// Allows custom elements (my-el), SVG camelCase (clipPath) and the internal
// '__suspense' marker tag.
const SAFE_TAG_NAME = /^[a-zA-Z_][a-zA-Z0-9._:-]*$/;

function assertSafeTag(tag) {
  if (typeof tag !== 'string' || !SAFE_TAG_NAME.test(tag)) {
    throw new Error(`[what-server] Invalid tag name in SSR: ${JSON.stringify(tag)}`);
  }
}

function renderAttrs(props) {
  let out = '';
  for (const [key, rawVal] of Object.entries(props)) {
    if (key === 'key' || key === 'ref' || key === 'children' || key === 'dangerouslySetInnerHTML' || key === 'innerHTML') continue;
    const lowerKey = key.toLowerCase();
    if (lowerKey.startsWith('on') && key.length > 2) continue; // Skip event handlers in SSR

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
    let val = rawVal;
    if (typeof val === 'function') {
      try {
        val = val();
      } catch (e) {
        if (_isDevMode) {
          console.warn(`[what-server] Skipping attribute ${JSON.stringify(key)}: its value threw during SSR: ${e.message}`);
        }
        continue;
      }
      // A resolved value that is itself a function is not an attribute value.
      if (typeof val === 'function') continue;
    }
    // aria-*/role are enumerated, so `false` is a real value and must survive:
    // an absent `aria-expanded` means "unsupported", `aria-expanded="false"`
    // means "collapsed". Every other attribute keeps HTML boolean semantics,
    // where false means omit. Checked before the falsy skip for that reason.
    if (val === false && _isAriaAttr(key)) {
      out += ` ${key}="false"`;
      continue;
    }
    if (val === false || val == null) continue;
    if (!SAFE_ATTR_NAME.test(key)) {
      if (_isDevMode) {
        console.warn(`[what-server] Skipping invalid attribute name in SSR: ${JSON.stringify(key)}`);
      }
      continue;
    }
    if (REFUSED_ATTRS.has(lowerKey)) {
      if (_isDevMode) {
        console.warn(`[what-server] Skipping unsafe attribute in SSR: ${JSON.stringify(key)}`);
      }
      continue;
    }

    if (key === 'className' || key === 'class') {
      out += ` class="${escapeHtml(String(val))}"`;
    } else if (key === 'style' && typeof val === 'object') {
      const css = Object.entries(val)
        .map(([p, v]) => `${camelToKebab(p)}:${v}`)
        .join(';');
      out += ` style="${escapeHtml(css)}"`;
    } else if (val === true) {
      // ARIA attributes require explicit ="true", HTML boolean attrs can be bare
      if (key.startsWith('aria-') || key === 'role') {
        out += ` ${key}="true"`;
      } else {
        out += ` ${key}`;
      }
    } else {
      if (isUnsafeUrlAttribute(key, val)) continue;
      out += ` ${key}="${escapeHtml(String(val))}"`;
    }
  }

  return out;
}


function isUnsafeUrlAttribute(key, val) {
  const normalizedKey = key.toLowerCase();
  if (!URL_ATTRS.has(normalizedKey)) return false;
  const normalizedValue = String(val).trim().replace(/[\u0000-\u001f\u007f\s]+/g, '').toLowerCase();
  return normalizedValue.startsWith('javascript:') || normalizedValue.startsWith('vbscript:') || normalizedValue.startsWith('data:');
}

// Must stay in step with URL_ATTRS in what-core's dom.js. Both sets are gated by
// the parity test in test/ssr-security.test.js.
const URL_ATTRS = new Set([
  'href', 'src', 'action', 'formaction', 'data', 'ping', 'xlink:href',
]);

// Attributes whose value the browser parses as markup or code, so escaping is
// not a defense: srcdoc is entity-decoded and parsed as a full document, which
// revives "&lt;script&gt;". These are refused outright.
const REFUSED_ATTRS = new Set(['srcdoc']);

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function camelToKebab(str) {
  if (str.startsWith('--')) return str; // CSS custom properties (variables) — leave unchanged
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Re-export server actions
export {
  action,
  formAction,
  useAction,
  useFormAction,
  useOptimistic,
  useMutation,
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

// Served server actions: wire the /__what_action route (Node + fetch adapters)
export {
  createActionHandler,
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
export { createRequestHandler } from './adapter/core.js';
export { createCloudflareHandler } from './adapter/cloudflare.js';

// Safe state serialization for inlining into <script> tags (AUDIT-2026-06-06 M13)
export { serializeState } from './serialize.js';
