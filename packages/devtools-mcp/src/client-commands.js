/**
 * Command handlers the browser client loads on first use: eval, dom-inspect,
 * route, navigate, app-info, visual-inspect, page-map, component-screenshot.
 * Every handler returns a JSON-safe, bounded answer or `{ error }`.
 */

// ---------------------------------------------------------------------------
// Helper: resolve the actual DOM Element for a component registry entry.
//
// The devtools stores `ctx._wrapper` which is a comment node (boundary marker,
// nodeType 8). Comment nodes don't have getBoundingClientRect, innerHTML,
// children, or any Element-level API. This helper walks from the stored node
// to find the nearest real Element.
// ---------------------------------------------------------------------------
function getComponentElement(entry) {
  let el = entry.element;
  if (!el) return null;

  // Already a real Element — use it directly
  if (el.nodeType === 1 && typeof el.getBoundingClientRect === 'function') return el;

  // Comment node (component boundary marker) — find the next sibling element
  if (el.nodeType === 8) {
    let sibling = el.nextSibling;
    while (sibling) {
      if (sibling.nodeType === 1) return sibling;
      sibling = sibling.nextSibling;
    }
    // No sibling element found — try parent
    if (el.parentElement) return el.parentElement;
  }

  // Text node — use parent
  if (el.nodeType === 3 && el.parentElement) return el.parentElement;

  return null;
}

// ---------------------------------------------------------------------------
// Route state. what-router names its state signals 'what-router:*' in
// development; reading them through the devtools registry gives the router's
// own view (which can lag the address bar while a guard runs) without a global.
// ---------------------------------------------------------------------------

function routerSignals(devtools) {
  const found = {};
  for (const entry of devtools?._registries?.signals?.values() || []) {
    if (typeof entry.name === 'string' && entry.name.startsWith('what-router:')) found[entry.name.slice(12)] = entry.ref;
  }
  return found.url ? found : null;
}

function routeState(devtools) {
  const loc = window.location;
  const browser = {
    path: loc.pathname,
    query: Object.fromEntries(new URLSearchParams(loc.search)),
    hash: loc.hash,
    href: loc.href,
  };
  const r = routerSignals(devtools);
  if (!r) return { browser, router: null, settled: true };
  const url = String(r.url.peek());
  const navigating = Boolean(r.navigating?.peek());
  const error = r.error?.peek();
  return {
    browser,
    router: {
      url,
      path: new URL(url, loc.href).pathname,
      pattern: r.pattern?.peek() ?? null,
      params: devtools.preview(r.params?.peek() ?? {}, 400),
      query: devtools.preview(r.query?.peek() ?? {}, 400),
      navigating,
      pendingUrl: r.pendingUrl?.peek() ?? null,
      error: error ? String(error.message || error) : null,
    },
    settled: !navigating && url === loc.pathname + loc.search + loc.hash,
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Handle an extended command sent from the MCP server via the bridge.
 *
 * @param {string} command - The command name
 * @param {Record<string, any>} [args] - Command arguments
 * @param {any} [devtools] - window.__WHAT_DEVTOOLS__
 * @returns {Promise<Record<string, any>|null>} Result object, or null if command not handled
 */
export async function handleExtendedCommand(command, args, devtools) {
  args = args || /** @type {Record<string, any>} */ ({});
  switch (command) {

    // -------------------------------------------------------------------------
    // eval — run arbitrary code. The MCP server sends it only when started with
    // --unsafe-eval, and the page refuses it unless the page opted in as well.
    // Safe reads never come here: they are the 'read' command.
    // -------------------------------------------------------------------------
    case 'eval': {
      const evalEnabled = typeof window !== 'undefined' &&
        (window.__WHAT_UNSAFE_EVAL__ === true || devtools?._unsafeEvalEnabled === true);
      if (!evalEnabled) {
        return { error: 'The page has not enabled eval: set window.__WHAT_UNSAFE_EVAL__ = true in the page as well.' };
      }
      const code = String(args.code || '').trim();
      // An expression returns its value; statements need an explicit return.
      let fn;
      try {
        fn = new Function(`return (${code}\n);`);
      } catch {
        fn = new Function(code);
      }
      const start = performance.now();
      try {
        const raw = await fn();
        return {
          result: devtools?.preview ? devtools.preview(raw, 4000) : String(raw),
          type: raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw,
          executionTime: Math.round((performance.now() - start) * 100) / 100,
        };
      } catch (e) {
        return { error: e?.message || String(e), stack: e?.stack ? String(e.stack).slice(0, 2000) : undefined };
      }
    }

    // -------------------------------------------------------------------------
    // dom-inspect — Serialize a component's rendered DOM
    // -------------------------------------------------------------------------
    case 'dom-inspect': {
      const { componentId, depth = 3 } = args || {};
      const registries = devtools?._registries;

      if (!registries?.components) {
        return { error: 'DevTools registries not available' };
      }

      const entry = registries.components.get(componentId);
      if (!entry) {
        return { error: `Component ${componentId} not found` };
      }

      const el = getComponentElement(entry);
      if (!el) {
        return { error: `Component "${entry.name}" (id: ${componentId}) has no DOM element` };
      }

      /**
       * Recursively serialize a DOM node into a plain object.
       * Respects the max depth limit to avoid huge payloads.
       */
      function serializeDOM(node, currentDepth) {
        if (currentDepth > depth) {
          return { tag: '...', text: '(truncated)' };
        }

        // Text node
        if (node.nodeType === 3) {
          const text = node.textContent?.trim() || '';
          if (!text) return null; // skip empty text nodes
          return { text };
        }

        // Skip non-element, non-text nodes (comments, etc.)
        if (node.nodeType !== 1) return null;

        const result = {
          tag: node.tagName.toLowerCase(),
        };

        // Include common identifying attributes
        if (node.id) result.id = node.id;
        if (node.className && typeof node.className === 'string') {
          result.class = node.className;
        }

        // Include data attributes (often useful for debugging)
        const dataAttrs = {};
        for (const attr of node.attributes) {
          if (attr.name.startsWith('data-')) {
            dataAttrs[attr.name] = attr.value;
          }
        }
        if (Object.keys(dataAttrs).length > 0) {
          result.dataAttributes = dataAttrs;
        }

        // Recurse into children
        const children = [];
        for (const child of node.childNodes) {
          const serialized = serializeDOM(child, currentDepth + 1);
          if (serialized && (serialized.tag || serialized.text)) {
            children.push(serialized);
          }
        }
        if (children.length) result.children = children;

        return result;
      }

      const structure = serializeDOM(el, 0);
      // Cap HTML to 5000 chars to prevent huge payloads
      const html = el.innerHTML?.substring(0, 5000) || '';

      return {
        componentName: entry.name,
        owner: entry.owner,
        loc: entry.loc,
        componentId,
        html,
        structure,
      };
    }

    // -------------------------------------------------------------------------
    // route — the address bar and the router's own state, separately
    // -------------------------------------------------------------------------
    case 'route':
      return routeState(devtools);

    // -------------------------------------------------------------------------
    // navigate — change the URL the way back/forward does, so what-router runs
    // its guards and loaders, then wait (bounded) until the router has settled
    // -------------------------------------------------------------------------
    case 'navigate': {
      const { path, replace } = args;
      if (!path) return { error: 'No path provided' };

      // Reject dangerous protocols (the MCP server checks too).
      const trimmedPath = String(path).trim();
      const normalizedUrl = trimmedPath.replace(/[\s\x00-\x1f]/g, '').toLowerCase();
      const isRelativePath = /^[/.#?]/.test(trimmedPath) || !trimmedPath.includes(':');
      if (!isRelativePath && !/^https?:/.test(normalizedUrl)) {
        return { error: `Blocked navigation to unsafe URL: "${path}"` };
      }

      if (replace) history.replaceState(null, '', trimmedPath);
      else history.pushState(null, '', trimmedPath);
      window.dispatchEvent(new PopStateEvent('popstate'));

      const deadline = Date.now() + Math.min(Math.max(Number(args.timeout) || 3000, 0), 10000);
      let state = routeState(devtools);
      // The router claims the navigation synchronously in its popstate handler.
      while (state.router && !state.settled && Date.now() < deadline) {
        await wait(16);
        state = routeState(devtools);
      }
      const target = new URL(trimmedPath, window.location.href);
      const arrived = window.location.pathname + window.location.search + window.location.hash === target.pathname + target.search + target.hash;
      return { requested: trimmedPath, ...state, ...(state.settled && !arrived ? { cancelled: true } : {}) };
    }

    // -------------------------------------------------------------------------
    // get-app-info — Return app metadata for bootstrap
    // -------------------------------------------------------------------------
    case 'app-info': {
      return {
        url: window.location.href,
        title: document.title,
        route: window.location.pathname + window.location.search + window.location.hash,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    }

    // -------------------------------------------------------------------------
    // visual-inspect — Computed visual info about a component (no image)
    // -------------------------------------------------------------------------
    case 'visual-inspect': {
      const { componentId } = args || {};
      const registries = devtools?._registries;
      if (!registries?.components) return { error: 'DevTools registries not available' };

      const entry = registries.components.get(componentId);
      if (!entry) return { error: `Component ${componentId} not found` };

      const el = getComponentElement(entry);
      if (!el) return { error: `Component "${entry.name}" has no DOM element` };

      const rect = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);

      // Key computed styles
      const styles = {
        display: cs.display,
        position: cs.position,
        flexDirection: cs.flexDirection !== 'row' ? cs.flexDirection : undefined,
        flexWrap: cs.flexWrap !== 'nowrap' ? cs.flexWrap : undefined,
        gridTemplateColumns: cs.gridTemplateColumns !== 'none' ? cs.gridTemplateColumns : undefined,
        gridTemplateRows: cs.gridTemplateRows !== 'none' ? cs.gridTemplateRows : undefined,
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily?.split(',')[0]?.trim(),
        padding: cs.padding,
        margin: cs.margin,
        border: cs.border !== 'none' && cs.borderWidth !== '0px' ? cs.border : undefined,
        borderRadius: cs.borderRadius !== '0px' ? cs.borderRadius : undefined,
        zIndex: cs.zIndex !== 'auto' ? cs.zIndex : undefined,
        opacity: cs.opacity !== '1' ? cs.opacity : undefined,
        overflow: cs.overflow !== 'visible' ? cs.overflow : undefined,
        visibility: cs.visibility !== 'visible' ? cs.visibility : undefined,
        width: cs.width,
        height: cs.height,
        maxWidth: cs.maxWidth !== 'none' ? cs.maxWidth : undefined,
      };
      // Remove undefined values
      Object.keys(styles).forEach(k => styles[k] === undefined && delete styles[k]);

      // Text content preview
      const textContent = (el.textContent || '').trim().substring(0, 200);

      // Child element types
      const childTypes = {};
      const selectors = ['button', 'a', 'input', 'select', 'textarea', 'img', 'form', 'table', 'ul', 'ol', 'video', 'canvas', 'svg'];
      for (const sel of selectors) {
        const count = el.querySelectorAll(sel).length;
        if (count > 0) childTypes[sel] = count;
      }

      // Accessibility info
      const a11y = {};
      const role = el.getAttribute('role');
      const ariaLabel = el.getAttribute('aria-label');
      const tabIndex = el.getAttribute('tabindex');
      if (role) a11y.role = role;
      if (ariaLabel) a11y.ariaLabel = ariaLabel;
      if (tabIndex) a11y.tabIndex = tabIndex;

      // Layout classification
      let layout = styles.display || 'block';
      const childCount = el.children.length;
      if (cs.display === 'flex') {
        layout = `flex ${cs.flexDirection === 'column' ? 'column' : 'row'} with ${childCount} children`;
      } else if (cs.display === 'grid') {
        const cols = cs.gridTemplateColumns.split(' ').length;
        const rows = cs.gridTemplateRows.split(' ').length;
        layout = `grid ${cols}×${rows} with ${childCount} children`;
      } else if (cs.display === 'block' || cs.display === 'flow-root') {
        layout = `block with ${childCount} children`;
      } else if (cs.display === 'inline-flex' || cs.display === 'inline-block') {
        layout = `${cs.display} with ${childCount} children`;
      }

      return {
        componentName: entry.name,
        owner: entry.owner,
        loc: entry.loc,
        componentId,
        boundingRect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        styles,
        textContent: textContent || '(empty)',
        childElements: childTypes,
        totalChildren: childCount,
        accessibility: Object.keys(a11y).length > 0 ? a11y : undefined,
        layout,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    }

    // -------------------------------------------------------------------------
    // page-map — Structured map of the entire visible page
    // -------------------------------------------------------------------------
    case 'page-map': {
      // Each category gets its own budget so a page with many landmarks
      // doesn't starve out headings or components. Previous behaviour shared
      // one `count` across all sections — a page with >maxElements landmarks
      // returned headings: [] and components: [], which agents read as
      // "the page has no headings / no components".
      const maxElements = args?.maxElements || 200;
      const perCategory = Math.max(50, Math.floor(maxElements / 2));

      function rectOf(el) {
        // Comment nodes / detached nodes have no rect; element walk handles that.
        if (!el || el.nodeType !== 1) return { x: 0, y: 0, w: 0, h: 0 };
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }

      // Landmarks
      const landmarks = [];
      const landmarkEls = document.querySelectorAll('[role], header, footer, nav, main, aside, section, article');
      for (const el of landmarkEls) {
        if (landmarks.length >= perCategory) break;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        landmarks.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || undefined,
          id: el.id || undefined,
          text: (el.textContent || '').trim().substring(0, 50),
          rect: rectOf(el),
        });
      }

      // Interactive elements
      const interactives = [];
      const interactiveEls = document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=link], [contenteditable]');
      for (const el of interactiveEls) {
        if (interactives.length >= perCategory) break;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const label = el.getAttribute('aria-label') || el.textContent?.trim().substring(0, 40) || el.getAttribute('placeholder') || el.getAttribute('name') || '';
        interactives.push({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || undefined,
          label: label || '(unlabeled)',
          disabled: /** @type {any} */ (el).disabled || undefined,
          rect: rectOf(el),
        });
      }

      // Headings — heading lists are nearly always small so we don't gate
      // on visibility (some agents use display:none headings for SR-only nav).
      const headings = [];
      const headingEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (const el of headingEls) {
        if (headings.length >= perCategory) break;
        const text = (el.textContent || '').trim().substring(0, 80);
        if (!text) continue; // skip truly empty headings
        headings.push({
          level: parseInt(el.tagName[1], 10),
          text,
          id: el.id || undefined,
        });
      }

      // WhatFW component boundaries. Comment-node boundaries have no
      // dimensions, so a strict zero-rect check was filtering everything
      // out. Walk the registry once and emit every component, using the
      // resolved element's rect when available.
      const components = [];
      const registries = devtools?._registries;
      if (registries?.components) {
        for (const [id, entry] of registries.components) {
          if (components.length >= perCategory) break;
          const compEl = getComponentElement(entry);
          components.push({
            id,
            name: entry.name,
            owner: entry.owner,
            loc: entry.loc,
            rect: compEl ? rectOf(compEl) : { x: 0, y: 0, w: 0, h: 0 },
            hasElement: !!compEl,
          });
        }
      }

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        landmarks,
        interactives,
        headings,
        components,
        totalElements: landmarks.length + interactives.length + headings.length + components.length,
      };
    }

    // -------------------------------------------------------------------------
    // component-screenshot — Render component to base64 image via foreignObject
    // -------------------------------------------------------------------------
    case 'component-screenshot': {
      const { componentId, maxWidth = 400, quality = 0.7, format = 'jpeg' } = args || {};
      const registries = devtools?._registries;

      if (!registries?.components) return { error: 'DevTools registries not available' };

      const entry = registries.components.get(componentId);
      if (!entry) return { error: `Component ${componentId} not found` };

      const el = getComponentElement(entry);
      if (!el) return { error: `Component "${entry.name}" has no DOM element` };

      try {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          return { error: `Component "${entry.name}" has zero dimensions (${rect.width}x${rect.height}). It may be hidden.` };
        }

        // Clone and inline styles so foreignObject renders correctly
        const clone = el.cloneNode(true);

        function inlineStyles(source, target) {
          const cs = window.getComputedStyle(source);
          const importantProps = [
            'display', 'position', 'top', 'left', 'right', 'bottom',
            'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
            'margin', 'padding', 'border', 'border-radius',
            'background', 'background-color', 'background-image',
            'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'text-align', 'text-decoration',
            'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap',
            'grid-template-columns', 'grid-template-rows',
            'overflow', 'opacity', 'visibility', 'z-index',
            'box-shadow', 'text-shadow', 'transform',
            'white-space', 'word-break', 'letter-spacing',
          ];
          for (const prop of importantProps) {
            const val = cs.getPropertyValue(prop);
            if (val && val !== '' && val !== 'none' && val !== 'normal' && val !== 'auto' && val !== '0px') {
              target.style.setProperty(prop, val);
            }
          }
          const sourceChildren = source.children;
          const targetChildren = target.children;
          const maxChildren = Math.min(sourceChildren.length, targetChildren.length, 100);
          for (let i = 0; i < maxChildren; i++) {
            inlineStyles(sourceChildren[i], targetChildren[i]);
          }
        }

        inlineStyles(el, clone);

        // Reset position so it renders at 0,0 inside the SVG
        clone.style.position = 'static';
        clone.style.margin = '0';

        // Serialize to SVG foreignObject
        const serialized = new XMLSerializer().serializeToString(clone);
        const svgWidth = Math.ceil(rect.width);
        const svgHeight = Math.ceil(rect.height);

        const svgData = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${svgWidth}px;height:${svgHeight}px;overflow:hidden;">
          ${serialized}
        </div>
      </foreignObject>
    </svg>`;

        // Render SVG to canvas
        const dpr = window.devicePixelRatio || 1;
        const scale = Math.min(1, maxWidth / svgWidth);
        const canvasWidth = Math.ceil(svgWidth * scale * dpr);
        const canvasHeight = Math.ceil(svgHeight * scale * dpr);

        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
        ctx.scale(scale * dpr, scale * dpr);

        // A data: URL, not a blob: URL. Chromium taints the canvas when it
        // draws an SVG with a <foreignObject> loaded from a blob: URL, even on
        // a page with no external resources, and toDataURL then throws.
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('SVG rendering failed — component may contain cross-origin resources'));
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`;
        });

        ctx.drawImage(img, 0, 0);

        // Export to base64
        const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
        let dataUrl = canvas.toDataURL(mimeType, format === 'png' ? undefined : quality);
        let base64 = dataUrl.split(',')[1];
        let sizeBytes = Math.ceil(base64.length * 3 / 4);

        // Size safety: if over 100KB, reduce quality then dimensions
        if (sizeBytes > 102400 && format !== 'png') {
          dataUrl = canvas.toDataURL('image/jpeg', 0.3);
          base64 = dataUrl.split(',')[1];
          sizeBytes = Math.ceil(base64.length * 3 / 4);
        }
        if (sizeBytes > 102400) {
          const smallCanvas = document.createElement('canvas');
          smallCanvas.width = Math.ceil(canvasWidth / 2);
          smallCanvas.height = Math.ceil(canvasHeight / 2);
          const smallCtx = /** @type {CanvasRenderingContext2D} */ (smallCanvas.getContext('2d'));
          smallCtx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
          dataUrl = smallCanvas.toDataURL('image/jpeg', 0.3);
          base64 = dataUrl.split(',')[1];
          sizeBytes = Math.ceil(base64.length * 3 / 4);
        }
        if (sizeBytes > 102400) {
          return { error: 'Screenshot exceeds 100KB even after reduction. Use what_look for text-based visual info instead.' };
        }

        return {
          base64,
          format: format === 'png' ? 'png' : 'jpeg',
          mimeType,
          width: Math.round(svgWidth * scale),
          height: Math.round(svgHeight * scale),
          sizeBytes,
          componentName: entry.name,
          owner: entry.owner,
          loc: entry.loc,
        };
      } catch (e) {
        return {
          error: `Screenshot failed: ${e.message}`,
          fallback: 'Use what_look for text-based visual inspection without an image.',
        };
      }
    }

    // -------------------------------------------------------------------------
    // Not handled — return null so caller falls through
    // -------------------------------------------------------------------------
    default:
      return null;
  }
}
