/**
 * Extended command handlers for the browser client.
 * Handles: eval, dom-inspect, get-route, navigate, get-app-info, visual-inspect, page-map, get-signal-writers, component-screenshot
 *
 * Usage in client.js:
 *   import { handleExtendedCommand } from './client-commands.js';
 *
 *   // Inside handleCommand(), before the default case:
 *   const extResult = await handleExtendedCommand(command, args, devtools);
 *   if (extResult !== null) { result = extResult; break; }
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
// Module-level ring buffer for correlating signal writes with effect runs.
// Auto-initialized when initEventTracking() is called (early, not lazy).
// ---------------------------------------------------------------------------

const MAX_WRITE_LOG = 200;
let _signalWriteLog = [];       // { signalId, signalName, previousValue, newValue, timestamp, writerEffect }
let _lastRunningEffect = null;  // { id, name, timestamp } — most recent effect:run event
let _trackingInitialized = false;
let _unsubTracker = null;

/**
 * Initialize event tracking early so signal writes are always captured.
 * Called from client.js on connection, not lazily on first tool call.
 */
export function initEventTracking(devtools) {
  if (_trackingInitialized || !devtools?.subscribe) return;
  _trackingInitialized = true;

  _unsubTracker = devtools.subscribe((event, data) => {
    if (event === 'effect:run') {
      _lastRunningEffect = {
        id: data?.id,
        name: data?.name,
        timestamp: Date.now(),
      };
    }

    if (event === 'signal:updated' && data?.id != null) {
      // Try to get the previous value from the registry snapshot.
      // The event fires after the value has already changed, so we
      // cannot recover the true previous value retroactively.
      // However, the emit payload from devtools includes `value` (new).
      // We store what we can — the previous value will be the last
      // known `newValue` for this signal in the log, or undefined.
      let previousValue;
      const priorEntry = findLastWrite(data.id);
      if (priorEntry) {
        previousValue = priorEntry.newValue;
      }

      const entry = {
        signalId: data.id,
        signalName: data.name || `signal_${data.id}`,
        previousValue,
        newValue: data.value,
        timestamp: Date.now(),
        writerEffect: _lastRunningEffect ? { ..._lastRunningEffect } : null,
      };

      _signalWriteLog.push(entry);
      if (_signalWriteLog.length > MAX_WRITE_LOG) {
        _signalWriteLog = _signalWriteLog.slice(-MAX_WRITE_LOG);
      }
    }
  });
}

function findLastWrite(signalId) {
  for (let i = _signalWriteLog.length - 1; i >= 0; i--) {
    if (_signalWriteLog[i].signalId === signalId) return _signalWriteLog[i];
  }
  return null;
}

/**
 * Handle extended commands sent from the MCP server via the bridge.
 *
 * @param {string} command - The command name
 * @param {object} args - Command arguments
 * @param {object|null} devtools - window.__WHAT_DEVTOOLS__ reference
 * @returns {Promise<object|null>} Result object, or null if command not handled
 */
export async function handleExtendedCommand(command, args, devtools) {
  switch (command) {

    // -------------------------------------------------------------------------
    // eval — Execute arbitrary JS in the browser context
    // WARNING: This executes arbitrary code. The MCP server guards this behind
    // the --unsafe-eval flag. The browser side also checks a global flag so
    // that even if the command somehow reaches the client, it is rejected
    // unless explicitly enabled.
    // -------------------------------------------------------------------------
    case 'eval': {
      // Guard: only execute if explicitly enabled on the client side
      const evalEnabled = typeof window !== 'undefined' &&
        (window.__WHAT_UNSAFE_EVAL__ === true ||
         devtools?._unsafeEvalEnabled === true);

      // Allow safe read-only expressions without the unsafe flag
      const code = (args.code || '').trim();
      const isSafeRead = /^[\w.[\]'"]+$/.test(code) || // property access: document.title, window.innerWidth
        /^typeof\s+\w+/.test(code) || // typeof checks
        /^document\.(title|URL|readyState|visibilityState|characterSet|contentType)$/.test(code) ||
        /^window\.(innerWidth|innerHeight|devicePixelRatio|screen\.\w+)$/.test(code) ||
        /^navigator\.\w+$/.test(code) ||
        /^location\.\w+$/.test(code);

      if (!evalEnabled && !isSafeRead) {
        return {
          error: 'Eval is disabled for arbitrary code. Safe read-only expressions (document.title, window.innerWidth, etc.) work without the flag. For full eval, set window.__WHAT_UNSAFE_EVAL__ = true or enable --unsafe-eval on the MCP server.',
        };
      }

      const start = performance.now();
      try {
        // Use Function constructor to execute in global scope
        // eslint-disable-next-line no-new-func
        const fn = new Function(args.code);
        const raw = fn();
        const elapsed = performance.now() - start;
        return {
          result: devtools?.safeSerialize ? devtools.safeSerialize(raw) : raw,
          type: typeof raw,
          executionTime: Math.round(elapsed * 100) / 100,
        };
      } catch (e) {
        return {
          error: e.message,
          stack: e.stack,
        };
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
        componentId,
        html,
        structure,
      };
    }

    // -------------------------------------------------------------------------
    // get-route — Return current route information
    // -------------------------------------------------------------------------
    case 'get-route': {
      const loc = typeof window !== 'undefined' ? window.location : {};
      const result = {
        path: loc.pathname || '/',
        query: Object.fromEntries(new URLSearchParams(loc.search || '')),
        hash: loc.hash || '',
        fullUrl: loc.href || '',
      };

      // Try to get What Router state if available
      try {
        const core = window.__WHAT_CORE__;
        if (core?.routerState) {
          const state = typeof core.routerState === 'function'
            ? core.routerState()
            : core.routerState;
          if (state) {
            result.params = state.params || {};
            result.matchedRoute = state.pattern || state.route || null;
          }
        }
      } catch {
        // Router state not available — that's fine, we have window.location
      }

      return result;
    }

    // -------------------------------------------------------------------------
    // navigate — Programmatically change the route
    // -------------------------------------------------------------------------
    case 'navigate': {
      const { path, replace } = args || {};

      if (!path) {
        return { error: 'No path provided' };
      }

      try {
        // Prefer What Router's navigate() if available
        const core = window.__WHAT_CORE__;
        if (core?.navigate) {
          core.navigate(path, { replace: !!replace });
        } else if (replace) {
          history.replaceState(null, '', path);
          window.dispatchEvent(new PopStateEvent('popstate'));
        } else {
          history.pushState(null, '', path);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }

        return {
          navigatedTo: path,
          currentPath: window.location.pathname,
          method: replace ? 'replaceState' : 'pushState',
          usedWhatRouter: !!(core?.navigate),
          success: true,
        };
      } catch (e) {
        return { error: e.message };
      }
    }

    // -------------------------------------------------------------------------
    // validate-code — Compile or statically analyse a code snippet
    // -------------------------------------------------------------------------
    case 'validate-code': {
      const { code, format } = args || {};
      if (!code) return { valid: false, errors: [{ message: 'No code provided' }], warnings: [] };

      const errors = [];
      const warnings = [];

      // 1. Try the Babel/What compiler if available on window
      if (typeof window !== 'undefined' && window.__WHAT_COMPILER__) {
        try {
          const result = window.__WHAT_COMPILER__.compile(code, { format: format || 'jsx' });
          return {
            valid: !result.errors || result.errors.length === 0,
            output: result.output || result.code || null,
            errors: result.errors || [],
            warnings: result.warnings || [],
          };
        } catch (e) {
          // Compiler threw — fall through to static analysis
          errors.push({ message: `Compiler error: ${e.message}` });
        }
      }

      // 2. Static analysis fallback

      // --- Bracket/brace matching ---
      const brackets = { '(': ')', '[': ']', '{': '}' };
      const closers = new Set([')', ']', '}']);
      const stack = [];
      // Strip string literals and comments to avoid false positives
      const stripped = code
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, '');
      for (let i = 0; i < stripped.length; i++) {
        const ch = stripped[i];
        if (brackets[ch]) {
          stack.push({ char: ch, pos: i });
        } else if (closers.has(ch)) {
          const last = stack.pop();
          if (!last) {
            errors.push({ message: `Unexpected '${ch}' at position ${i}`, pos: i });
          } else if (brackets[last.char] !== ch) {
            errors.push({ message: `Mismatched '${last.char}' at position ${last.pos} and '${ch}' at position ${i}`, pos: i });
          }
        }
      }
      if (stack.length > 0) {
        for (const item of stack) {
          errors.push({ message: `Unclosed '${item.char}' at position ${item.pos}`, pos: item.pos });
        }
      }

      // --- Common import errors ---
      const importFromWhat = code.match(/import\s*\{([^}]+)\}\s*from\s*['"]what['"]/g);
      if (importFromWhat) {
        warnings.push({ message: "Import from 'what' detected. Use 'what-framework' instead.", rule: 'import-path' });
      }

      // --- Lint patterns ---

      // 1. Signal read without () — look for JSX expressions like {count} where count is likely a signal
      const signalWithoutCall = stripped.match(/\{(\s*[a-z][a-zA-Z0-9_]*\s*)\}/g);
      if (signalWithoutCall) {
        for (const match of signalWithoutCall) {
          const name = match.replace(/[{}\s]/g, '');
          // Heuristic: if the same name appears with () elsewhere, it's a signal used without ()
          if (stripped.includes(`${name}(`) && !match.includes('(')) {
            warnings.push({ message: `Possible signal '${name}' used without () — renders as [Function]. Use {${name}()}.`, rule: 'signal-read-without-call' });
          }
        }
      }

      // 2. innerHTML without __html marker
      if (/innerHTML\s*=/.test(stripped) && !/__html/.test(stripped)) {
        warnings.push({ message: 'innerHTML set without __html safety marker. XSS risk. Use { __html: content }.', rule: 'unsafe-innerhtml' });
      }

      // 3. Effect cycle — effect that reads and writes the same signal
      const effectBodies = code.matchAll(/effect\s*\(\s*\(\s*\)\s*=>\s*\{([^}]+)\}/g);
      for (const m of effectBodies) {
        const body = m[1];
        // Find signal names that appear as both read sig() and write sig(value)
        const reads = [...body.matchAll(/(\w+)\(\)/g)].map(r => r[1]);
        const writes = [...body.matchAll(/(\w+)\([^)]+\)/g)].map(r => r[1]);
        for (const name of reads) {
          if (writes.includes(name) && name !== 'untrack') {
            warnings.push({ message: `Potential effect cycle: '${name}' is both read and written inside effect. Use untrack() for the read.`, rule: 'effect-cycle' });
          }
        }
      }

      // 4. Missing cleanup — effect with addEventListener but no removeEventListener
      if (/effect\s*\(/.test(code) && /addEventListener/.test(code) && !/removeEventListener/.test(code)) {
        warnings.push({ message: 'Effect adds event listener but no cleanup detected (missing removeEventListener). Return a cleanup function.', rule: 'missing-cleanup' });
      }

      return {
        valid: errors.length === 0,
        output: null,
        errors,
        warnings,
      };
    }

    // -------------------------------------------------------------------------
    // get-app-info — Return app metadata for bootstrap
    // -------------------------------------------------------------------------
    case 'get-app-info': {
      return {
        url: window.location.href,
        title: document.title,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        // Try to detect framework version
        version: window.__WHAT_CORE__?.version || window.__WHAT_DEVTOOLS__?.version || 'unknown',
        // Get the entry point from Vite's module graph if available
        entryPoint: document.querySelector('script[type="module"][src]')?.getAttribute('src') ||
                    document.querySelector('script[type="module"]')?.textContent?.match(/from ['"]([^'"]+)['"]/)?.[1] || 'unknown',
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
      const maxElements = args?.maxElements || 200;
      let count = 0;

      // Landmarks
      const landmarks = [];
      const landmarkEls = document.querySelectorAll('[role], header, footer, nav, main, aside, section, article');
      for (const el of landmarkEls) {
        if (count >= maxElements) break;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        landmarks.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || undefined,
          id: el.id || undefined,
          text: (el.textContent || '').trim().substring(0, 50),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        });
        count++;
      }

      // Interactive elements
      const interactives = [];
      const interactiveEls = document.querySelectorAll('button, a[href], input, select, textarea, [role=button], [role=link], [contenteditable]');
      for (const el of interactiveEls) {
        if (count >= maxElements) break;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const label = el.getAttribute('aria-label') || el.textContent?.trim().substring(0, 40) || el.getAttribute('placeholder') || el.getAttribute('name') || '';
        interactives.push({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || undefined,
          label: label || '(unlabeled)',
          disabled: el.disabled || undefined,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        });
        count++;
      }

      // Headings
      const headings = [];
      const headingEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (const el of headingEls) {
        if (count >= maxElements) break;
        headings.push({
          level: parseInt(el.tagName[1]),
          text: (el.textContent || '').trim().substring(0, 80),
        });
        count++;
      }

      // WhatFW component boundaries
      const components = [];
      const registries = devtools?._registries;
      if (registries?.components) {
        for (const [id, entry] of registries.components) {
          if (count >= maxElements) break;
          const compEl = getComponentElement(entry);
          if (!compEl) continue;
          const rect = compEl.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          components.push({
            id,
            name: entry.name,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          });
          count++;
        }
      }

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        landmarks,
        interactives,
        headings,
        components,
        totalElements: count,
      };
    }

    // -------------------------------------------------------------------------
    // get-signal-writers — Correlate signal writes with effect runs
    // Uses the module-level ring buffer populated by initEventTracking().
    // -------------------------------------------------------------------------
    case 'get-signal-writers': {
      const { signalId } = args || {};
      const registries = devtools?._registries;

      if (!registries?.signals) {
        return { error: 'DevTools registries not available' };
      }

      const sigEntry = registries.signals.get(signalId);
      if (!sigEntry) {
        return { error: `Signal ${signalId} not found` };
      }

      // Lazily initialize event tracking on first call
      initEventTracking(devtools);

      // Filter the write log for this signal
      const writes = _signalWriteLog
        .filter(w => w.signalId === signalId)
        .slice(-20); // Last 20 writes

      const totalWrites = _signalWriteLog.filter(w => w.signalId === signalId).length;

      return {
        signalId,
        signalName: sigEntry.name,
        currentValue: devtools.safeSerialize
          ? devtools.safeSerialize(sigEntry.ref.peek())
          : sigEntry.ref.peek(),
        recentWrites: writes,
        totalWrites,
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
        const ctx = canvas.getContext('2d');
        ctx.scale(scale * dpr, scale * dpr);

        // Load SVG blob as image
        const img = new Image();
        const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error('SVG rendering failed — component may contain cross-origin resources'));
          img.src = url;
        });

        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);

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
          const smallCtx = smallCanvas.getContext('2d');
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
        };
      } catch (e) {
        return {
          error: `Screenshot failed: ${e.message}`,
          fallback: 'Use what_look for text-based visual inspection without an image.',
        };
      }
    }

    // -------------------------------------------------------------------------
    // click — Semantic clicking by text, componentId, role, testId, ariaLabel
    // -------------------------------------------------------------------------
    case 'click': {
      const { text, componentId, role, testId, ariaLabel, index } = args || {};

      // Find the target element using semantic selectors
      let el = null;
      let matchDescription = '';

      // Scope to a component's DOM if componentId given
      let scope = document;
      if (componentId != null) {
        const registries = devtools?._registries;
        if (registries?.components) {
          const entry = registries.components.get(componentId);
          if (entry) {
            const compEl = getComponentElement(entry);
            if (compEl) scope = compEl;
            else return { error: `Component ${componentId} has no DOM element` };
          } else {
            return { error: `Component ${componentId} not found` };
          }
        }
      }

      if (testId) {
        el = scope.querySelector(`[data-testid="${CSS.escape(testId)}"]`);
        matchDescription = `data-testid="${testId}"`;
      } else if (ariaLabel) {
        el = scope.querySelector(`[aria-label="${CSS.escape(ariaLabel)}"]`);
        matchDescription = `aria-label="${ariaLabel}"`;
      } else if (text) {
        // Find interactive elements matching text content
        const interactiveTags = 'button, a, [role=button], [role=link], input[type=submit], input[type=button], summary';
        const candidates = scope.querySelectorAll(interactiveTags);
        const matches = [];
        const lowerText = text.toLowerCase().trim();
        for (const candidate of candidates) {
          const candidateText = (candidate.textContent || '').trim().toLowerCase();
          const candidateLabel = (candidate.getAttribute('aria-label') || '').toLowerCase();
          const candidateValue = (candidate.value || '').toLowerCase();
          if (candidateText === lowerText || candidateLabel === lowerText || candidateValue === lowerText) {
            matches.push(candidate);
          } else if (candidateText.includes(lowerText) || candidateLabel.includes(lowerText)) {
            matches.push(candidate);
          }
        }
        if (matches.length === 0) {
          // Broaden: search all visible elements with the text
          const allEls = scope.querySelectorAll('*');
          for (const candidate of allEls) {
            // Only direct text content, not nested
            const directText = Array.from(candidate.childNodes)
              .filter(n => n.nodeType === 3)
              .map(n => n.textContent.trim())
              .join(' ')
              .toLowerCase();
            if (directText === lowerText || directText.includes(lowerText)) {
              matches.push(candidate);
            }
          }
        }
        const idx = (index != null && index >= 0 && index < matches.length) ? index : 0;
        el = matches[idx] || null;
        matchDescription = `text="${text}"${matches.length > 1 ? ` (${matches.length} matches, using index ${idx})` : ''}`;
        if (!el && matches.length === 0) {
          return {
            error: `No element found with text "${text}"`,
            suggestion: 'Use what_page_map to see available interactive elements and their labels.',
          };
        }
      } else if (role) {
        const candidates = scope.querySelectorAll(`[role="${CSS.escape(role)}"], ${role}`);
        const idx = (index != null && index >= 0 && index < candidates.length) ? index : 0;
        el = candidates[idx] || null;
        matchDescription = `role="${role}"${candidates.length > 1 ? ` (${candidates.length} matches, using index ${idx})` : ''}`;
      }

      if (!el) {
        return { error: `No element found matching: ${matchDescription || 'no selector provided'}` };
      }

      // Capture state before click
      const snapshotBefore = devtools?.getSnapshot ? devtools.safeSerialize(devtools.getSnapshot()) : null;
      const signalsBefore = new Map();
      if (devtools?._registries?.signals) {
        for (const [id, entry] of devtools._registries.signals) {
          signalsBefore.set(id, { name: entry.name, value: entry.ref.peek() });
        }
      }
      const componentsBefore = new Set();
      if (devtools?._registries?.components) {
        for (const [id] of devtools._registries.components) componentsBefore.add(id);
      }

      // Perform the click with proper event sequence
      el.focus?.();
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      el.click();

      // Wait a tick for effects to flush
      await new Promise(r => setTimeout(r, 50));

      // Capture what changed
      const changes = { signalsChanged: [], componentsAdded: [], componentsRemoved: [], effectsTriggered: [] };
      if (devtools?._registries?.signals) {
        for (const [id, entry] of devtools._registries.signals) {
          const before = signalsBefore.get(id);
          const currentVal = entry.ref.peek();
          if (before) {
            if (JSON.stringify(before.value) !== JSON.stringify(currentVal)) {
              changes.signalsChanged.push({
                id, name: entry.name,
                previousValue: devtools.safeSerialize(before.value),
                currentValue: devtools.safeSerialize(currentVal),
              });
            }
          } else {
            changes.signalsChanged.push({
              id, name: entry.name,
              previousValue: undefined,
              currentValue: devtools.safeSerialize(currentVal),
              added: true,
            });
          }
        }
      }
      if (devtools?._registries?.components) {
        for (const [id, entry] of devtools._registries.components) {
          if (!componentsBefore.has(id)) {
            changes.componentsAdded.push({ id, name: entry.name });
          }
        }
        for (const id of componentsBefore) {
          if (!devtools._registries.components.has(id)) {
            changes.componentsRemoved.push({ id });
          }
        }
      }

      // Detect navigation
      const navigated = window.location.pathname !== (args._prevPath || window.location.pathname);

      return {
        clicked: true,
        element: {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().substring(0, 100),
          id: el.id || undefined,
          class: (typeof el.className === 'string' ? el.className : '') || undefined,
        },
        matched: matchDescription,
        changes,
        currentPath: window.location.pathname,
        navigated,
      };
    }

    // -------------------------------------------------------------------------
    // fill — Semantic form filling by label, name, placeholder, componentId
    // -------------------------------------------------------------------------
    case 'fill': {
      const { label, name, placeholder, componentId, value, inputs } = args || {};

      let scope = document;
      if (componentId != null) {
        const registries = devtools?._registries;
        if (registries?.components) {
          const entry = registries.components.get(componentId);
          if (entry) {
            const compEl = getComponentElement(entry);
            if (compEl) scope = compEl;
            else return { error: `Component ${componentId} has no DOM element` };
          } else {
            return { error: `Component ${componentId} not found` };
          }
        }
      }

      // Multi-fill mode: fill all inputs in a scope using an inputs map
      if (inputs && typeof inputs === 'object') {
        const results = [];
        for (const [key, val] of Object.entries(inputs)) {
          const input = scope.querySelector(`[name="${CSS.escape(key)}"]`) ||
            scope.querySelector(`#${CSS.escape(key)}`) ||
            findInputByLabel(scope, key);
          if (input) {
            setInputValue(input, val);
            results.push({ field: key, filled: true, tag: input.tagName.toLowerCase(), type: input.type || undefined });
          } else {
            results.push({ field: key, filled: false, error: `No input found for "${key}"` });
          }
        }

        await new Promise(r => setTimeout(r, 50));

        return {
          filled: true,
          mode: 'multi',
          results,
          filledCount: results.filter(r => r.filled).length,
          failedCount: results.filter(r => !r.filled).length,
        };
      }

      // Single-fill mode
      let input = null;
      let matchDescription = '';

      if (label) {
        input = findInputByLabel(scope, label);
        matchDescription = `label="${label}"`;
      } else if (name) {
        input = scope.querySelector(`[name="${CSS.escape(name)}"]`);
        matchDescription = `name="${name}"`;
      } else if (placeholder) {
        input = scope.querySelector(`[placeholder="${CSS.escape(placeholder)}"]`);
        matchDescription = `placeholder="${placeholder}"`;
      }

      if (!input) {
        return {
          error: `No input found matching: ${matchDescription || 'no selector provided'}`,
          suggestion: 'Use what_page_map to see available form fields.',
        };
      }

      // Capture before
      const beforeVal = input.value;
      setInputValue(input, value);

      await new Promise(r => setTimeout(r, 50));

      // Check validation state
      const validity = input.validity ? {
        valid: input.validity.valid,
        valueMissing: input.validity.valueMissing || undefined,
        typeMismatch: input.validity.typeMismatch || undefined,
        patternMismatch: input.validity.patternMismatch || undefined,
        tooShort: input.validity.tooShort || undefined,
        tooLong: input.validity.tooLong || undefined,
        rangeUnderflow: input.validity.rangeUnderflow || undefined,
        rangeOverflow: input.validity.rangeOverflow || undefined,
        customError: input.validity.customError || undefined,
      } : null;
      // Clean undefined values
      if (validity) Object.keys(validity).forEach(k => validity[k] === undefined && delete validity[k]);

      return {
        filled: true,
        element: {
          tag: input.tagName.toLowerCase(),
          type: input.type || undefined,
          name: input.name || undefined,
          id: input.id || undefined,
        },
        matched: matchDescription,
        previousValue: beforeVal,
        currentValue: input.value,
        validation: validity,
      };
    }

    // -------------------------------------------------------------------------
    // interact — High-level compound interactions
    // -------------------------------------------------------------------------
    case 'interact': {
      const { action, componentId, label, text, value } = args || {};

      if (!action) {
        return { error: 'No action provided. Use: submit_form, select_option, toggle, scroll_to, hover, type, clear, focus' };
      }

      let scope = document;
      if (componentId != null) {
        const registries = devtools?._registries;
        if (registries?.components) {
          const entry = registries.components.get(componentId);
          if (entry) {
            const compEl = getComponentElement(entry);
            if (compEl) scope = compEl;
            else return { error: `Component ${componentId} has no DOM element` };
          } else {
            return { error: `Component ${componentId} not found` };
          }
        }
      }

      switch (action) {
        case 'submit_form': {
          // Find and submit a form
          const form = scope.tagName === 'FORM' ? scope :
            scope.querySelector('form');
          if (!form) {
            return { error: 'No form found in scope. Use componentId to target a specific component.' };
          }
          // Try the submit button first (more realistic)
          const submitBtn = form.querySelector('[type=submit], button:not([type=button]):not([type=reset])');
          if (submitBtn) {
            submitBtn.click();
          } else {
            form.requestSubmit?.() || form.submit();
          }
          await new Promise(r => setTimeout(r, 100));
          return {
            action: 'submit_form',
            submitted: true,
            formAction: form.action || undefined,
            formMethod: form.method || 'get',
            currentPath: window.location.pathname,
          };
        }

        case 'select_option': {
          const select = label
            ? findInputByLabel(scope, label)
            : scope.querySelector('select');
          if (!select || select.tagName !== 'SELECT') {
            return { error: `No <select> found${label ? ` with label "${label}"` : ''}` };
          }
          const prevValue = select.value;
          // Find option by value or text
          let found = false;
          for (const opt of select.options) {
            if (opt.value === value || opt.textContent.trim().toLowerCase() === String(value).toLowerCase()) {
              select.value = opt.value;
              found = true;
              break;
            }
          }
          if (!found) {
            const options = Array.from(select.options).map(o => ({ value: o.value, text: o.textContent.trim() }));
            return { error: `Option "${value}" not found`, availableOptions: options };
          }
          select.dispatchEvent(new Event('input', { bubbles: true }));
          select.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 50));
          return {
            action: 'select_option',
            selected: true,
            previousValue: prevValue,
            currentValue: select.value,
            selectedText: select.options[select.selectedIndex]?.textContent?.trim(),
          };
        }

        case 'toggle': {
          const checkable = text
            ? findCheckableByText(scope, text)
            : label
              ? findInputByLabel(scope, label)
              : scope.querySelector('input[type=checkbox], input[type=radio], [role=switch], [role=checkbox]');
          if (!checkable) {
            return { error: `No toggleable element found${text ? ` with text "${text}"` : ''}${label ? ` with label "${label}"` : ''}` };
          }
          const wasBefore = checkable.checked !== undefined ? checkable.checked :
            checkable.getAttribute('aria-checked') === 'true';
          checkable.click();
          await new Promise(r => setTimeout(r, 50));
          const isNow = checkable.checked !== undefined ? checkable.checked :
            checkable.getAttribute('aria-checked') === 'true';
          return {
            action: 'toggle',
            toggled: true,
            previousState: wasBefore,
            currentState: isNow,
            element: { tag: checkable.tagName.toLowerCase(), type: checkable.type || undefined },
          };
        }

        case 'scroll_to': {
          let target = null;
          if (componentId != null && scope !== document) {
            target = scope;
          } else if (text) {
            // Find element with matching text
            const all = document.querySelectorAll('*');
            for (const el of all) {
              if ((el.textContent || '').trim().toLowerCase().includes(text.toLowerCase())) {
                target = el;
                break;
              }
            }
          }
          if (!target) {
            return { error: 'No element found to scroll to' };
          }
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await new Promise(r => setTimeout(r, 300));
          const rect = target.getBoundingClientRect();
          return {
            action: 'scroll_to',
            scrolled: true,
            elementRect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            viewportPosition: rect.y >= 0 && rect.y <= window.innerHeight ? 'visible' : 'partially visible',
          };
        }

        case 'hover': {
          let hoverTarget = null;
          if (text) {
            const interactiveTags = 'button, a, [role=button], [role=menuitem], [role=tab], summary, details, [tabindex]';
            const candidates = scope.querySelectorAll(interactiveTags);
            for (const c of candidates) {
              if ((c.textContent || '').trim().toLowerCase().includes(text.toLowerCase())) {
                hoverTarget = c;
                break;
              }
            }
          }
          if (!hoverTarget && scope !== document) {
            hoverTarget = scope;
          }
          if (!hoverTarget) {
            return { error: `No element found to hover${text ? ` with text "${text}"` : ''}` };
          }
          hoverTarget.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
          hoverTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
          hoverTarget.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
          hoverTarget.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
          await new Promise(r => setTimeout(r, 100));
          return {
            action: 'hover',
            hovered: true,
            element: {
              tag: hoverTarget.tagName.toLowerCase(),
              text: (hoverTarget.textContent || '').trim().substring(0, 80),
            },
          };
        }

        case 'type': {
          // Type text character by character with keydown/keypress/keyup events
          const target = document.activeElement || scope.querySelector('input, textarea, [contenteditable]');
          if (!target) {
            return { error: 'No focusable input element found. Use what_fill to target by label/name first.' };
          }
          const textToType = value || text || '';
          for (const char of textToType) {
            target.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
            target.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
            if (target.value !== undefined) {
              target.value += char;
            }
            target.dispatchEvent(new InputEvent('input', { data: char, inputType: 'insertText', bubbles: true }));
            target.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
          }
          await new Promise(r => setTimeout(r, 50));
          return {
            action: 'type',
            typed: true,
            text: textToType,
            currentValue: target.value || target.textContent?.substring(0, 100),
          };
        }

        case 'clear': {
          const clearTarget = label
            ? findInputByLabel(scope, label)
            : name
              ? scope.querySelector(`[name="${CSS.escape(name)}"]`)
              : document.activeElement || scope.querySelector('input, textarea');
          if (!clearTarget) {
            return { error: 'No input found to clear' };
          }
          const prevVal = clearTarget.value;
          setInputValue(clearTarget, '');
          await new Promise(r => setTimeout(r, 50));
          return {
            action: 'clear',
            cleared: true,
            previousValue: prevVal,
          };
        }

        case 'focus': {
          let focusTarget = null;
          if (label) {
            focusTarget = findInputByLabel(scope, label);
          } else if (text) {
            const all = scope.querySelectorAll('[tabindex], input, textarea, select, button, a[href]');
            for (const el of all) {
              if ((el.textContent || '').trim().toLowerCase().includes(text.toLowerCase())) {
                focusTarget = el;
                break;
              }
            }
          }
          if (!focusTarget) {
            return { error: 'No focusable element found' };
          }
          focusTarget.focus();
          return {
            action: 'focus',
            focused: true,
            element: { tag: focusTarget.tagName.toLowerCase(), id: focusTarget.id || undefined },
            isActiveElement: document.activeElement === focusTarget,
          };
        }

        default:
          return { error: `Unknown action: ${action}. Available: submit_form, select_option, toggle, scroll_to, hover, type, clear, focus` };
      }
    }

    // -------------------------------------------------------------------------
    // assert — State assertions for testing (no screenshots needed)
    // -------------------------------------------------------------------------
    case 'assert': {
      const { text, visible, componentId, signalName, signalId, value, selector, count, route, exists } = args || {};
      const assertions = [];

      // Text assertion
      if (text != null) {
        const body = document.body;
        const bodyText = body?.textContent || '';
        const found = bodyText.includes(text);
        const isVis = found ? isTextVisible(body, text) : false;
        const assertion = {
          type: 'text',
          expected: text,
          found,
          pass: visible != null ? (visible ? (found && isVis) : (!found || !isVis)) : found,
        };
        if (visible != null) assertion.visible = isVis;
        assertions.push(assertion);
      }

      // Signal value assertion
      if (signalId != null || signalName != null) {
        const registries = devtools?._registries;
        let sigEntry = null;
        if (signalId != null && registries?.signals) {
          sigEntry = registries.signals.get(signalId);
        } else if (signalName && registries?.signals) {
          for (const [, entry] of registries.signals) {
            if (entry.name === signalName) { sigEntry = entry; break; }
          }
        }
        if (sigEntry) {
          const currentVal = sigEntry.ref.peek();
          const assertion = {
            type: 'signal',
            signalId: sigEntry.id || sigEntry._devId,
            signalName: sigEntry.name,
            currentValue: devtools?.safeSerialize ? devtools.safeSerialize(currentVal) : currentVal,
          };
          if (value !== undefined) {
            assertion.expectedValue = value;
            assertion.pass = JSON.stringify(currentVal) === JSON.stringify(value);
          } else {
            assertion.pass = true; // Signal exists
          }
          assertions.push(assertion);
        } else {
          assertions.push({
            type: 'signal',
            pass: false,
            error: `Signal ${signalId != null ? `#${signalId}` : `"${signalName}"`} not found`,
          });
        }
      }

      // Component assertion
      if (componentId != null && !signalName && value === undefined && !signalId) {
        const registries = devtools?._registries;
        const comp = registries?.components?.get(componentId);
        assertions.push({
          type: 'component',
          componentId,
          mounted: !!comp,
          name: comp?.name || null,
          pass: exists !== false ? !!comp : !comp,
        });
      }

      // Selector count assertion
      if (selector != null) {
        const matched = document.querySelectorAll(selector);
        const assertion = {
          type: 'selector',
          selector,
          matchedCount: matched.length,
        };
        if (count != null) {
          assertion.expectedCount = count;
          assertion.pass = matched.length === count;
        } else {
          assertion.pass = matched.length > 0;
        }
        assertions.push(assertion);
      }

      // Route assertion
      if (route != null) {
        const currentPath = window.location.pathname;
        assertions.push({
          type: 'route',
          expected: route,
          actual: currentPath,
          pass: currentPath === route,
        });
      }

      const allPassed = assertions.every(a => a.pass);
      const failedCount = assertions.filter(a => !a.pass).length;

      return {
        pass: allPassed,
        assertions,
        totalAssertions: assertions.length,
        passed: assertions.filter(a => a.pass).length,
        failed: failedCount,
        summary: allPassed
          ? `All ${assertions.length} assertion(s) passed.`
          : `${failedCount} of ${assertions.length} assertion(s) failed.`,
      };
    }

    // -------------------------------------------------------------------------
    // wait — Wait for conditions (text, component, signal, idle)
    // -------------------------------------------------------------------------
    case 'wait': {
      const { text, gone, componentId, mounted, signalId, signalName, value, idle, timeout: waitTimeout } = args || {};
      const maxWait = Math.min(waitTimeout || 5000, 30000);
      const pollInterval = 100;
      const start = Date.now();

      let conditionMet = false;
      let lastState = null;

      while (Date.now() - start < maxWait) {
        // Check condition
        if (text != null) {
          const bodyText = document.body?.textContent || '';
          const found = bodyText.includes(text);
          conditionMet = gone ? !found : found;
          lastState = { text, found, waitingFor: gone ? 'gone' : 'present' };
        } else if (componentId != null) {
          const registries = devtools?._registries;
          const comp = registries?.components?.get(componentId);
          conditionMet = mounted !== false ? !!comp : !comp;
          lastState = { componentId, mounted: !!comp };
        } else if (signalId != null || signalName != null) {
          const registries = devtools?._registries;
          let sigEntry = null;
          if (signalId != null && registries?.signals) {
            sigEntry = registries.signals.get(signalId);
          } else if (signalName && registries?.signals) {
            for (const [, entry] of registries.signals) {
              if (entry.name === signalName) { sigEntry = entry; break; }
            }
          }
          if (sigEntry && value !== undefined) {
            const currentVal = sigEntry.ref.peek();
            conditionMet = JSON.stringify(currentVal) === JSON.stringify(value);
            lastState = {
              signalId: sigEntry.id,
              signalName: sigEntry.name,
              currentValue: devtools?.safeSerialize ? devtools.safeSerialize(currentVal) : currentVal,
              waitingForValue: value,
            };
          } else if (sigEntry) {
            conditionMet = true;
            lastState = { signalId: sigEntry.id, signalName: sigEntry.name, exists: true };
          }
        } else if (idle) {
          // Check if no effects have run recently (last 200ms)
          const recentEffects = _signalWriteLog.filter(w => Date.now() - w.timestamp < 200);
          conditionMet = recentEffects.length === 0;
          lastState = { idle: conditionMet, recentActivity: recentEffects.length };
        }

        if (conditionMet) break;
        await new Promise(r => setTimeout(r, pollInterval));
      }

      const elapsed = Date.now() - start;

      return {
        conditionMet,
        elapsed,
        timedOut: !conditionMet,
        lastState,
        summary: conditionMet
          ? `Condition met after ${elapsed}ms.`
          : `Timed out after ${maxWait}ms. Last state: ${JSON.stringify(lastState)}`,
      };
    }

    // -------------------------------------------------------------------------
    // enhanced-page-map — Full interactive element map with action hints
    // -------------------------------------------------------------------------
    case 'enhanced-page-map': {
      const maxElements = args?.maxElements || 300;
      let count = 0;

      // Interactive elements with full detail
      const interactives = [];
      const interactiveEls = document.querySelectorAll(
        'button, a[href], input, select, textarea, [role=button], [role=link], [role=checkbox], [role=switch], [role=tab], [role=menuitem], [contenteditable], summary, details'
      );
      for (const el of interactiveEls) {
        if (count >= maxElements) break;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;

        const tag = el.tagName.toLowerCase();
        const entry = {
          tag,
          type: el.getAttribute('type') || undefined,
          role: el.getAttribute('role') || undefined,
          text: (el.textContent || '').trim().substring(0, 60) || undefined,
          label: el.getAttribute('aria-label') || undefined,
          name: el.getAttribute('name') || undefined,
          placeholder: el.getAttribute('placeholder') || undefined,
          testId: el.getAttribute('data-testid') || undefined,
          id: el.id || undefined,
          disabled: el.disabled || undefined,
          checked: el.checked !== undefined ? el.checked : undefined,
          value: (tag === 'input' || tag === 'textarea' || tag === 'select')
            ? (el.value || '').substring(0, 80) || undefined
            : undefined,
          required: el.required || undefined,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        };

        // Suggest interaction method
        if (tag === 'button' || el.getAttribute('role') === 'button') {
          entry.interactWith = 'what_click';
          entry.clickArgs = entry.testId ? { testId: entry.testId }
            : entry.text ? { text: entry.text }
            : entry.label ? { ariaLabel: entry.label }
            : undefined;
        } else if (tag === 'a') {
          entry.interactWith = 'what_click';
          entry.href = el.getAttribute('href') || undefined;
          entry.clickArgs = entry.text ? { text: entry.text } : entry.label ? { ariaLabel: entry.label } : undefined;
        } else if (tag === 'input' || tag === 'textarea') {
          entry.interactWith = 'what_fill';
          entry.fillArgs = entry.label ? { label: entry.label }
            : entry.name ? { name: entry.name }
            : entry.placeholder ? { placeholder: entry.placeholder }
            : undefined;
          if (el.type === 'checkbox' || el.type === 'radio') {
            entry.interactWith = 'what_interact';
            entry.interactArgs = { action: 'toggle', text: entry.text || entry.label };
          }
        } else if (tag === 'select') {
          entry.interactWith = 'what_interact';
          entry.options = Array.from(el.options || []).slice(0, 10).map(o => ({
            value: o.value,
            text: o.textContent.trim(),
            selected: o.selected,
          }));
          entry.interactArgs = { action: 'select_option', label: entry.label || entry.name };
        } else if (el.getAttribute('role') === 'checkbox' || el.getAttribute('role') === 'switch') {
          entry.interactWith = 'what_interact';
          entry.interactArgs = { action: 'toggle', text: entry.text || entry.label };
        }

        // Clean undefined values
        Object.keys(entry).forEach(k => entry[k] === undefined && delete entry[k]);

        interactives.push(entry);
        count++;
      }

      // Forms with structure
      const forms = [];
      const formEls = document.querySelectorAll('form');
      for (const form of formEls) {
        if (count >= maxElements) break;
        const fields = [];
        const inputs = form.querySelectorAll('input, textarea, select');
        for (const input of inputs) {
          const fieldLabel = findLabelFor(input);
          fields.push({
            tag: input.tagName.toLowerCase(),
            type: input.type || undefined,
            name: input.name || undefined,
            label: fieldLabel || undefined,
            placeholder: input.placeholder || undefined,
            value: (input.value || '').substring(0, 60) || undefined,
            required: input.required || undefined,
            disabled: input.disabled || undefined,
          });
          // Clean undefined
          const f = fields[fields.length - 1];
          Object.keys(f).forEach(k => f[k] === undefined && delete f[k]);
        }
        forms.push({
          id: form.id || undefined,
          action: form.action || undefined,
          method: form.method || 'get',
          fields,
          fieldCount: fields.length,
        });
        count++;
      }

      // Landmarks
      const landmarks = [];
      const landmarkEls = document.querySelectorAll('[role], header, footer, nav, main, aside, section, article');
      for (const el of landmarkEls) {
        if (count >= maxElements) break;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        landmarks.push({
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || undefined,
          id: el.id || undefined,
          text: (el.textContent || '').trim().substring(0, 50),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        });
        count++;
      }

      // Headings
      const headings = [];
      const headingEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (const el of headingEls) {
        if (count >= maxElements) break;
        headings.push({
          level: parseInt(el.tagName[1]),
          text: (el.textContent || '').trim().substring(0, 80),
        });
        count++;
      }

      // What FW components
      const components = [];
      const registries = devtools?._registries;
      if (registries?.components) {
        for (const [id, entry] of registries.components) {
          if (count >= maxElements) break;
          const compEl = getComponentElement(entry);
          if (!compEl) continue;
          const rect = compEl.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;

          // Count interactive children
          const buttons = compEl.querySelectorAll('button, [role=button]').length;
          const inputs = compEl.querySelectorAll('input, textarea, select').length;
          const links = compEl.querySelectorAll('a[href]').length;

          components.push({
            id,
            name: entry.name,
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            interactiveChildren: { buttons, inputs, links },
          });
          count++;
        }
      }

      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        currentPath: window.location.pathname,
        interactives,
        forms,
        landmarks,
        headings,
        components,
        totalElements: count,
        summary: `${interactives.length} interactive elements, ${forms.length} forms, ${landmarks.length} landmarks, ${headings.length} headings, ${components.length} components`,
      };
    }

    // -------------------------------------------------------------------------
    // Not handled — return null so caller falls through
    // -------------------------------------------------------------------------
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Helper: Find input by its associated label text
// ---------------------------------------------------------------------------
function findInputByLabel(scope, labelText) {
  const lower = labelText.toLowerCase().trim();
  // Try <label> elements first
  const labels = scope.querySelectorAll('label');
  for (const lbl of labels) {
    if ((lbl.textContent || '').trim().toLowerCase().includes(lower)) {
      // Label with for="id"
      if (lbl.htmlFor) {
        const target = scope.querySelector(`#${CSS.escape(lbl.htmlFor)}`);
        if (target) return target;
      }
      // Label wrapping input
      const nested = lbl.querySelector('input, textarea, select');
      if (nested) return nested;
    }
  }
  // Try aria-label
  const ariaMatch = scope.querySelector(`[aria-label="${CSS.escape(labelText)}"]`);
  if (ariaMatch && (ariaMatch.tagName === 'INPUT' || ariaMatch.tagName === 'TEXTAREA' || ariaMatch.tagName === 'SELECT')) {
    return ariaMatch;
  }
  // Try placeholder
  const placeholderMatch = scope.querySelector(`[placeholder="${CSS.escape(labelText)}"]`);
  if (placeholderMatch) return placeholderMatch;
  return null;
}

// ---------------------------------------------------------------------------
// Helper: Find the label text for an input
// ---------------------------------------------------------------------------
function findLabelFor(input) {
  // Check for label with matching for="" attribute
  if (input.id) {
    const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (label) return label.textContent.trim();
  }
  // Check for wrapping label
  const parentLabel = input.closest('label');
  if (parentLabel) {
    // Get label text without the input's own text
    const clone = parentLabel.cloneNode(true);
    const nested = clone.querySelectorAll('input, textarea, select');
    for (const n of nested) n.remove();
    return clone.textContent.trim() || null;
  }
  // Check aria-label
  return input.getAttribute('aria-label') || null;
}

// ---------------------------------------------------------------------------
// Helper: Set input value with proper events
// ---------------------------------------------------------------------------
function setInputValue(input, val) {
  // Use native setter to bypass React/framework wrappers
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value'
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, val);
  } else {
    input.value = val;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Helper: Find checkbox/radio by text near it
// ---------------------------------------------------------------------------
function findCheckableByText(scope, text) {
  const lower = text.toLowerCase().trim();
  // Try labels
  const labels = scope.querySelectorAll('label');
  for (const lbl of labels) {
    if ((lbl.textContent || '').trim().toLowerCase().includes(lower)) {
      const input = lbl.querySelector('input[type=checkbox], input[type=radio]');
      if (input) return input;
      if (lbl.htmlFor) {
        const target = scope.querySelector(`#${CSS.escape(lbl.htmlFor)}`);
        if (target) return target;
      }
      // The label itself might be a toggle (role=switch)
      if (lbl.getAttribute('role') === 'switch' || lbl.getAttribute('role') === 'checkbox') return lbl;
    }
  }
  // Try role=switch or role=checkbox with text
  const switches = scope.querySelectorAll('[role=switch], [role=checkbox]');
  for (const s of switches) {
    if ((s.textContent || '').trim().toLowerCase().includes(lower) ||
      (s.getAttribute('aria-label') || '').toLowerCase().includes(lower)) {
      return s;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: Check if text is visible on the page
// ---------------------------------------------------------------------------
function isTextVisible(root, text) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.textContent.includes(text)) {
      let el = node.parentElement;
      while (el) {
        const cs = window.getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
        el = el.parentElement;
      }
      return true;
    }
  }
  return false;
}
