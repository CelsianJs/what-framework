// What Framework - Server
// SSR, static site generation, server components.
// Zero-JS pages by default. Islands opt-in to client JS.

import { h } from 'what-core';

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

  // Component — add hydration key to root element
  if (typeof vnode.tag === 'function') {
    const hkId = nextHydrationId();
    const result = vnode.tag({ ...vnode.props, children: vnode.children });
    const html = _renderHydratable(result);
    // Inject data-hk into the first element tag if present
    return injectHydrationKey(html, hkId);
  }

  // Element
  const { tag, props, children } = vnode;
  const attrs = renderAttrs(props || {});
  const open = `<${tag}${attrs}>`;

  // Void elements
  if (VOID_ELEMENTS.has(tag)) return open;

  const rawInner = props?.dangerouslySetInnerHTML?.__html
    ?? props?.innerHTML?.__html
    ?? props?.innerHTML;
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

  // Component
  if (typeof vnode.tag === 'function') {
    const result = vnode.tag({ ...vnode.props, children: vnode.children });
    return renderToString(result);
  }

  // Element
  const { tag, props, children } = vnode;
  const attrs = renderAttrs(props || {});
  const open = `<${tag}${attrs}>`;

  // Void elements
  if (VOID_ELEMENTS.has(tag)) return open;

  const rawInner = props?.dangerouslySetInnerHTML?.__html
    ?? props?.innerHTML?.__html
    ?? props?.innerHTML;
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
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
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
    try {
      const result = vnode.tag({ ...vnode.props, children: vnode.children });
      // Support async components
      const resolved = result instanceof Promise ? await result : result;
      yield* renderToStream(resolved);
    } catch (e) {
      if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
        console.warn('[what-server] Error rendering component in stream SSR:', e.message);
      }
      yield `<!-- SSR Error: ${escapeHtml(e.message || 'Component error')} -->`;
    }
    return;
  }

  const { tag, props, children } = vnode;
  const attrs = renderAttrs(props || {});
  yield `<${tag}${attrs}>`;

  if (!VOID_ELEMENTS.has(tag)) {
    const rawInner = props?.dangerouslySetInnerHTML?.__html
      ?? props?.innerHTML?.__html
      ?? props?.innerHTML;
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
  });
}

function wrapDocument({ title, meta, body, islands, scripts, styles, mode }) {
  const metaTags = Object.entries(meta)
    .map(([name, content]) => `<meta name="${name}" content="${escapeHtml(content)}">`)
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
