// What Framework - Server
// SSR, static site generation, server components.
// Zero-JS pages by default. Islands opt-in to client JS.

import { h } from 'what-core';

// --- SSR Error Collection ---
// Errors that occur during SSR are collected and serialized into the HTML output
// so the client can pick them up during hydration and display/report them.

let _ssrErrors = [];
const MAX_SSR_ERRORS = 50;

function _collectSSRError(error, context = {}) {
  const entry = {
    code: error.code || 'ERR_SSR_RENDER',
    message: error.message || String(error),
    component: context.component || null,
    timestamp: Date.now(),
  };
  // In dev mode, include extra detail for debugging
  if (_isDevMode) {
    entry.suggestion = error.suggestion || null;
    entry.stack = error.stack?.split('\n').slice(0, 5).join('\n') || null;
  }
  _ssrErrors.push(entry);
  if (_ssrErrors.length > MAX_SSR_ERRORS) _ssrErrors.shift();
}

function _resetSSRErrors() {
  _ssrErrors = [];
}

/**
 * Serialize collected SSR errors into a script tag for client hydration.
 * In dev mode: includes full error details (message, suggestion, stack).
 * In production: includes only error code and component name.
 */
export function serializeSSRErrors() {
  if (_ssrErrors.length === 0) return '';
  const payload = _isDevMode
    ? _ssrErrors
    : _ssrErrors.map(e => ({ code: e.code, component: e.component }));
  const json = JSON.stringify(payload).replace(/<\//g, '<\\/'); // prevent XSS via </script>
  return `<script type="application/json" data-what-ssr-errors>${json}</script>`;
}

/**
 * Read SSR errors from the DOM during client hydration.
 * Call this on the client side during hydration to pick up errors from SSR.
 * Returns an array of error objects, or empty array if none.
 */
export function hydrateSSRErrors() {
  if (typeof document === 'undefined') return [];
  const el = document.querySelector('script[data-what-ssr-errors]');
  if (!el) return [];
  try {
    const errors = JSON.parse(el.textContent);
    el.remove(); // clean up after reading
    return errors;
  } catch {
    return [];
  }
}

/**
 * Get collected SSR errors (for programmatic access before serialization).
 */
export function getSSRErrors() {
  return _ssrErrors.slice();
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
  resetHydrationId();
  _resetSSRErrors();
  return _renderHydratable(vnode);
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

  // Reactive function child — wrap in dynamic content markers
  if (typeof vnode === 'function') {
    try {
      return `<!--$-->${_renderHydratable(vnode())}<!--/$-->`;
    } catch (e) {
      _collectSSRError(e, { component: 'reactive-function' });
      if (_isDevMode) {
        console.warn('[what-server] Error rendering reactive function in SSR:', e.message);
      }
      return '<!--$--><!--/$-->';
    }
  }

  // Array — wrap in list markers
  if (Array.isArray(vnode)) {
    return `<!--[]-->${vnode.map(_renderHydratable).join('')}<!--/[]-->`;
  }

  // Component — add hydration key to root element
  if (typeof vnode.tag === 'function') {
    const hkId = nextHydrationId();
    const componentName = vnode.tag.displayName || vnode.tag.name || 'Anonymous';
    try {
      const result = vnode.tag({ ...vnode.props, children: vnode.children });
      const html = _renderHydratable(result);
      // Inject data-hk into the first element tag if present
      return injectHydrationKey(html, hkId);
    } catch (e) {
      _collectSSRError(e, { component: componentName });
      if (_isDevMode) {
        console.warn(`[what-server] Error rendering component "${componentName}" in SSR:`, e.message);
        return `<!--ssr-error:${escapeHtml(componentName)}-->`;
      }
      return `<!--ssr-error-->`;
    }
  }

  // Element
  const { tag, props, children } = vnode;
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
    return html.slice(0, insertAt) + ` data-hk="${hkId}"` + html.slice(insertAt);
  }
  return html;
}

// --- Render to String ---
// Renders a VNode tree to an HTML string. Used for SSR and static gen.

export function renderToString(vnode) {
  if (vnode == null || vnode === false || vnode === true) return '';

  // Text
  if (typeof vnode === 'string' || typeof vnode === 'number') {
    return escapeHtml(String(vnode));
  }

  // Signal — unwrap by calling it
  if (typeof vnode === 'function' && vnode._signal) {
    return renderToString(vnode());
  }

  // Reactive function child — call to get value
  if (typeof vnode === 'function') {
    try {
      return renderToString(vnode());
    } catch (e) {
      _collectSSRError(e, { component: 'reactive-function' });
      if (_isDevMode) {
        console.warn('[what-server] Error rendering reactive function in SSR:', e.message);
      }
      return '';
    }
  }

  // Array
  if (Array.isArray(vnode)) {
    return vnode.map(renderToString).join('');
  }

  // Component
  if (typeof vnode.tag === 'function') {
    const componentName = vnode.tag.displayName || vnode.tag.name || 'Anonymous';
    try {
      const result = vnode.tag({ ...vnode.props, children: vnode.children });
      return renderToString(result);
    } catch (e) {
      _collectSSRError(e, { component: componentName });
      if (_isDevMode) {
        console.warn(`[what-server] Error rendering component "${componentName}" in SSR:`, e.message);
        return `<!-- SSR Error in ${escapeHtml(componentName)}: ${escapeHtml(e.message)} -->`;
      }
      return `<!-- SSR Error -->`;
    }
  }

  // Element
  const { tag, props, children } = vnode;
  const attrs = renderAttrs(props || {});
  const open = `<${tag}${attrs}>`;

  // Void elements
  if (VOID_ELEMENTS.has(tag)) return open;

  const rawInner = _resolveInnerHTML(props);
  const inner = rawInner != null ? String(rawInner) : children.map(renderToString).join('');
  return `${open}${inner}</${tag}>`;
}

// --- Stream Render ---
// Returns an async iterator for streaming SSR.

export async function* renderToStream(vnode) {
  if (vnode == null || vnode === false || vnode === true) return;

  if (typeof vnode === 'string' || typeof vnode === 'number') {
    yield escapeHtml(String(vnode));
    return;
  }

  // Signal — unwrap by calling it
  if (typeof vnode === 'function' && vnode._signal) {
    yield* renderToStream(vnode());
    return;
  }

  // Reactive function child — call to get value
  if (typeof vnode === 'function') {
    try {
      yield* renderToStream(vnode());
    } catch (e) {
      _collectSSRError(e, { component: 'reactive-function' });
      if (_isDevMode) {
        console.warn('[what-server] Error rendering reactive function in stream SSR:', e.message);
      }
    }
    return;
  }

  if (Array.isArray(vnode)) {
    for (const child of vnode) {
      yield* renderToStream(child);
    }
    return;
  }

  if (typeof vnode.tag === 'function') {
    const componentName = vnode.tag.displayName || vnode.tag.name || 'Anonymous';
    try {
      const result = vnode.tag({ ...vnode.props, children: vnode.children });
      // Support async components
      const resolved = result instanceof Promise ? await result : result;
      yield* renderToStream(resolved);
    } catch (e) {
      _collectSSRError(e, { component: componentName });
      if (_isDevMode) {
        console.warn(`[what-server] Error rendering component "${componentName}" in stream SSR:`, e.message);
      }
      yield _isDevMode
        ? `<!-- SSR Error in ${escapeHtml(componentName)}: ${escapeHtml(e.message || 'Component error')} -->`
        : `<!-- SSR Error -->`;
    }
    return;
  }

  const { tag, props, children } = vnode;
  const attrs = renderAttrs(props || {});
  yield `<${tag}${attrs}>`;

  if (!VOID_ELEMENTS.has(tag)) {
    const rawInner = _resolveInnerHTML(props);
    if (rawInner != null) {
      yield String(rawInner);
    } else {
      for (const child of children) {
        yield* renderToStream(child);
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
  _resetSSRErrors();
  const vnode = page.component(data);
  const html = renderToString(vnode);
  const islands = page.islands || [];

  return wrapDocument({
    title: page.title || '',
    meta: page.meta || {},
    body: html,
    islands,
    scripts: page.mode === 'static' ? [] : page.scripts || [],
    styles: page.styles || [],
    mode: page.mode,
    ssrErrors: serializeSSRErrors(),
  });
}

function wrapDocument({ title, meta, body, islands, scripts, styles, mode, ssrErrors = '' }) {
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
    ${ssrErrors}
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

function renderAttrs(props) {
  let out = '';
  for (const [key, val] of Object.entries(props)) {
    if (key === 'key' || key === 'ref' || key === 'children' || key === 'dangerouslySetInnerHTML' || key === 'innerHTML') continue;
    if (key.startsWith('on') && key.length > 2) continue; // Skip event handlers in SSR
    if (val === false || val == null) continue;

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
      out += ` ${key}="${escapeHtml(String(val))}"`;
    }
  }

  return out;
}

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

// SSR error serialization is exported above:
//   serializeSSRErrors()  — serialize collected errors to script tag
//   hydrateSSRErrors()    — read errors from DOM during client hydration
//   getSSRErrors()        — programmatic access to collected errors

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
