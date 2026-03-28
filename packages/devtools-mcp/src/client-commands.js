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
// Lazily initialized on first `get-signal-writers` call via ensureEventTracking().
// ---------------------------------------------------------------------------

const MAX_WRITE_LOG = 200;
let _signalWriteLog = [];       // { signalId, signalName, previousValue, newValue, timestamp, writerEffect }
let _lastRunningEffect = null;  // { id, name, timestamp } — most recent effect:run event
let _trackingInitialized = false;
let _unsubTracker = null;

/**
 * Subscribe to devtools events once and populate the write log.
 * Safe to call multiple times — only subscribes once.
 */
function ensureEventTracking(devtools) {
  if (_trackingInitialized || !devtools?.subscribe) return;
  _trackingInitialized = true;

  const registries = devtools._registries;

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
      if (!evalEnabled) {
        return {
          error: 'Eval is disabled. Set window.__WHAT_UNSAFE_EVAL__ = true or enable --unsafe-eval on the MCP server.',
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
    // Uses the module-level ring buffer populated by ensureEventTracking().
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
      ensureEventTracking(devtools);

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
    // Not handled — return null so caller falls through
    // -------------------------------------------------------------------------
    default:
      return null;
  }
}
